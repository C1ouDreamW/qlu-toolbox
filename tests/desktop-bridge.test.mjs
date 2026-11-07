import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import test from 'node:test'
import { desktopBridgeSource, taggedDesktopBridge } from '../scripts/desktop-bridge.mjs'
import { artifactFileNames, validateMigrationPolicy } from '../electron/update-contract.mjs'
import { createReleaseBundle, targetFor, verifyReleaseFiles } from '../scripts/release-artifacts.mjs'
import { publishPlatformRelease } from '../scripts/publish-platform-release.mjs'
import { createDesktopBridgeBundle } from '../scripts/desktop-bridge-bundle.mjs'
import { readBuildInventory } from '../scripts/inventory-artifacts.mjs'
import { writeInventoryFixture } from './inventory-fixture.mjs'
import { verifyDesktopBridgeBundle } from '../scripts/verify-desktop-bridge-bundle.mjs'
import { sha256 } from '../scripts/release-artifacts.mjs'
import yaml from 'js-yaml'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lumatile-bridge-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let date = '2026-11-01T00:00:00Z'
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).trim()
  const write = async (file, value) => { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value)) }
  const policy = { schemaVersion: 1, bridgeVersion: '2.1.0', independentPublishingEnabled: false, desktopBridgePublishingEnabled: true, desktopCutoverEnabled: false, desktopMigrationComplete: false }
  const versions = { schemaVersion: 2 }
  for (const platform of ['windows', 'macos', 'android']) versions[platform] = { stable: { version: platform === 'android' ? '2.0.4' : '2.1.0', ...(platform === 'android' ? { versionCode: 15 } : { buildNumber: 4 }) }, alpha: { version: '2.1.0-alpha.1', ...(platform === 'android' ? { versionCode: 1 } : { buildNumber: 1 }) } }
  await write('config/release-migration.json', policy); await write('config/release-versions.json', versions)
  for (const platform of ['windows', 'macos']) await write(`changelogs/${platform}.md`, '## [2.1.0]\n\n- Desktop bridge\n')
  git(['init', '-qb', 'main'])
  const commit = when => { if (when) date = when; git(['add', '.']); git(['-c', 'user.name=Bridge Test', '-c', 'user.email=bridge@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: 桌面桥接夹具']); const sha = git(['rev-parse', 'HEAD']); git(['update-ref', 'refs/remotes/origin/main', sha]); return sha }
  const sha = commit(); git(['tag', 'v2.1.0'])
  const context = { repository: 'C1ouDreamW/qlu-toolbox', event: 'push', ref: 'refs/tags/v2.1.0', sha, runId: '42', runAttempt: '1' }
  return { root, git, write, policy, versions, context, commit }
}

test('desktop bridge has exactly two immutable Stable targets without coupling Android versions', async t => {
  const f = await fixture(t), identities = desktopBridgeSource(f.root, 'v2.1.0')
  assert.deepEqual(Object.keys(identities), ['windows', 'macos'])
  for (const identity of Object.values(identities)) {
    assert.equal(identity.tag, 'v2.1.0'); assert.equal(identity.channel, 'stable')
    assert.equal(identity.information.dataNamespace, 'QLUToolbox'); assert.equal(identity.purpose, 'bridge')
    assert.equal(identity.commit, f.context.sha)
  }
  f.policy.desktopBridgePublishingEnabled = false; await f.write('config/release-migration.json', f.policy)
  assert.equal(desktopBridgeSource(f.root, 'v2.1.0').windows.version, '2.1.0', 'Uncommitted policy cannot change tagged identity')
})

test('bridge requires its reserved version, explicit gate, both desktop versions and verified source', async t => {
  const f = await fixture(t)
  for (const tag of ['v2.1.0-alpha.1', 'win-v2.1.0', 'v02.1.0']) assert.throws(() => desktopBridgeSource(f.root, tag))
  await assert.rejects(Promise.resolve().then(() => taggedDesktopBridge(f.root, 'v2.1.0', { ...f.context, event: 'pull_request' })), /tag push/)
  assert.throws(() => taggedDesktopBridge(f.root, 'v2.1.0', f.context), /Missing or invalid Stable promotion/)
  f.policy.desktopBridgePublishingEnabled = false; await f.write('config/release-migration.json', f.policy)
  f.commit(); f.git(['tag', '-f', 'v2.1.0'])
  assert.throws(() => desktopBridgeSource(f.root, 'v2.1.0'), /disabled/)
  f.policy.desktopBridgePublishingEnabled = true; f.versions.macos.stable.version = '2.0.9'
  await f.write('config/release-migration.json', f.policy); await f.write('config/release-versions.json', f.versions)
  f.commit(); f.git(['tag', '-f', 'v2.1.0'])
  assert.throws(() => desktopBridgeSource(f.root, 'v2.1.0'), /Both desktop Stable versions/)
})

async function approve(f) {
  for (const [platform, prefix] of [['windows', 'win'], ['macos', 'mac']]) {
    const tag = `${prefix}-alpha-v2.1.0-alpha.1`; f.git(['tag', tag])
    await f.write(`config/promotions/${platform}-2.1.0.json`, { schemaVersion: 1, mode: 'alpha', platform, stableVersion: '2.1.0', alpha: { tag, commit: f.context.sha },
      review: { approvedBy: 'test-maintainer', observationStartedAt: '2026-11-02T00:00:00Z', observationEndedAt: '2026-11-03T00:00:00Z', approvedAt: '2026-11-04T00:00:00Z', summary: 'Synthetic review', tests: [{ name: 'Synthetic bridge installation', result: 'passed', evidence: 'fixture only' }] } })
  }
  const sha = f.commit('2026-11-05T00:00:00Z'); f.git(['tag', '-f', 'v2.1.0'])
  return taggedDesktopBridge(f.root, 'v2.1.0', { ...f.context, sha })
}

test('publishing a bridge requires both actual Alpha source reviews and rejects business changes', async t => {
  const f = await fixture(t), identities = await approve(f)
  assert.equal(identities.windows.promotion.alphaVersion, '2.1.0-alpha.1')
  assert.equal(identities.macos.promotion.alphaVersion, '2.1.0-alpha.1')
  await f.write('business.mjs', 'export const changed = true')
  const sha = f.commit('2026-11-06T00:00:00Z'); f.git(['tag', '-f', 'v2.1.0'])
  assert.throws(() => taggedDesktopBridge(f.root, 'v2.1.0', { ...f.context, sha }), /require another Alpha/)
})

async function bundleFixture(t) {
  const f = await fixture(t), identities = await approve(f), artifacts = {}, verifications = {}
  for (const platform of ['windows', 'macos']) {
    const identity = identities[platform], info = identity.information
    const directory = join(f.root, platform); await mkdir(directory)
    artifacts[platform] = directory
    for (const file of Object.values(artifactFileNames(targetFor(platform), identity.version, true))) await writeFile(join(directory, file), `Synthetic ${platform} installation bytes`)
    await writeInventoryFixture(directory, identity, { repository: f.context.repository, runId: f.context.runId, runAttempt: f.context.runAttempt })
    verifications[platform] = { platform, target: identity.target, channel: 'stable', commit: identity.commit, version: identity.version, purpose: 'bridge', deployable: true, verified: true,
      checks: { channel: 'stable', applicationId: info.applicationId, electronVersion: info.version, pythonVersion: info.version, nativeBuildVersion: info.nativeBuildVersion } }
  }
  return { ...f, identities, artifacts, verifications, output: join(f.root, 'bundle') }
}

test('bridge bundle preserves all legacy installation names, generates three pointers and keeps inventories separate', async t => {
  const f = await bundleFixture(t), bundle = await createDesktopBridgeBundle(f)
  assert.deepEqual((await readdir(join(f.output, 'stable'))).sort(), ['desktop.json', 'macos-arm64.json', 'windows-x64.json'])
  const files = await verifyReleaseFiles(bundle.releaseDir)
  for (const file of ['LumaTile_v2.1.0.zip', 'LumaTile_v2.1.0_x64_Setup.exe', 'LumaTile_v2.1.0_arm64.dmg']) assert.ok(files.includes(file))
  assert.ok(!files.some(file => file.endsWith('.apk') || file.includes('android')))
  for (const platform of ['windows', 'macos']) {
    const item = bundle.record.targets[platform], prefix = `${item.identity.target}-`
    await readBuildInventory(bundle.releaseDir, item.identity.information, item.inventory.provenanceSha256, prefix)
    assert.ok(item.inventory.entries.every(entry => entry.file.startsWith(prefix)))
  }
  await assert.rejects(readBuildInventory(bundle.releaseDir, f.identities.windows.information, undefined, 'macos-arm64-'), /archive prefix/)
  assert.equal(bundle.legacy.downloads.win32, bundle.manifests.windows.artifacts.installer.url)
  assert.equal(bundle.legacy.downloads.darwin, bundle.manifests.macos.artifacts.dmg.url)
  assert.equal(JSON.parse(await readFile(join(bundle.releaseDir, 'desktop.json'))).schemaVersion, 1)
  const checked = await verifyDesktopBridgeBundle({ identities: f.identities, directory: bundle.releaseDir, context: f.context })
  assert.deepEqual(checked.manifests, bundle.manifests)
  await assert.rejects(verifyDesktopBridgeBundle({ identities: f.identities, directory: bundle.releaseDir, context: { repository: 'C1ouDreamW/qlu-toolbox', runId: 'wrong', runAttempt: '1' } }), /workflow run and attempt/)
})

async function replaceChecksummed(directory, file, value) {
  await writeFile(join(directory, file), typeof value === 'string' ? value : JSON.stringify(value))
  const sums = []
  for (const name of (await readdir(directory)).filter(name => name !== 'SHA256SUMS.txt').sort()) sums.push(`${sha256(await readFile(join(directory, name)))}  ${name}`)
  await writeFile(join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
}

test('fresh bridge verification rejects recomputed checksums for changed pointers, bytes and source reviews', async t => {
  for (const mutate of [
    async b => replaceChecksummed(b.releaseDir, 'desktop.json', { ...b.legacy, downloads: { ...b.legacy.downloads, darwin: b.legacy.downloads.win32 } }),
    async b => replaceChecksummed(b.releaseDir, 'LumaTile_v2.1.0.zip', 'replacement installation bytes'),
    async b => replaceChecksummed(b.releaseDir, 'update-windows-x64.json', { ...b.manifests.windows, buildNumber: 99, nativeBuildVersion: '2.1.0.99' }),
    async b => { b.record.targets.macos.identity.promotion.review.approvedBy = 'replacement'; await replaceChecksummed(b.releaseDir, 'bridge-record.json', b.record) },
    async b => replaceChecksummed(b.releaseDir, 'unexpected.apk', 'unrelated Android bytes'),
  ]) {
    const f = await bundleFixture(t), b = await createDesktopBridgeBundle(f)
    // De-serialize the record: changing the downloaded artifact cannot mutate trusted source objects.
    b.record = JSON.parse(JSON.stringify(b.record))
    await mutate(b)
    await assert.rejects(verifyDesktopBridgeBundle({ identities: f.identities, directory: b.releaseDir }))
  }
})

test('bridge bundle validates both targets before output and rejects mixed channels, source commits and partial packages', async t => {
  const f = await bundleFixture(t)
  await assert.rejects(createDesktopBridgeBundle({ ...f, artifacts: { windows: f.artifacts.windows } }), /exactly Windows and macOS/)
  await assert.rejects(createDesktopBridgeBundle({ ...f, identities: { ...f.identities, macos: { ...f.identities.macos, channel: 'alpha' } } }), /identity/)
  await assert.rejects(createDesktopBridgeBundle({ ...f, verifications: { ...f.verifications, macos: { ...f.verifications.macos, commit: 'b'.repeat(40) } } }), /identity/)
  await assert.rejects(createDesktopBridgeBundle({ ...f, verifications: { ...f.verifications, macos: { ...f.verifications.macos, checks: { ...f.verifications.macos.checks, nativeBuildVersion: '1' } } } }), /verified Stable native/)
  const notice = join(f.artifacts.macos, 'THIRD-PARTY-NOTICES.txt'), original = await readFile(notice)
  await writeFile(notice, 'Replaced license notice')
  await assert.rejects(createDesktopBridgeBundle(f), /content differs/)
  await writeFile(notice, original)
  await rm(join(f.artifacts.windows, 'LumaTile_v2.1.0.zip'))
  await assert.rejects(createDesktopBridgeBundle(f), /ENOENT/)
  await assert.rejects(readdir(f.output), /ENOENT/)
})

test('desktop migration distinguishes bridge publishing, controlled cutover and completion', () => {
  const base = { schemaVersion: 1, bridgeVersion: null }
  assert.doesNotThrow(() => validateMigrationPolicy(base), 'Historical clients remain readable')
  for (const key of ['desktopBridgePublishingEnabled', 'desktopCutoverEnabled', 'desktopMigrationComplete']) {
    assert.throws(() => validateMigrationPolicy({ ...base, [key]: 'true' }))
    assert.throws(() => validateMigrationPolicy({ ...base, [key]: true }))
  }
  assert.throws(() => validateMigrationPolicy({ ...base, bridgeVersion: '2.1.0', desktopMigrationComplete: true }))
  assert.doesNotThrow(() => validateMigrationPolicy({ ...base, bridgeVersion: '2.1.0', desktopCutoverEnabled: true, desktopMigrationComplete: false }))
  assert.doesNotThrow(() => validateMigrationPolicy({ ...base, bridgeVersion: '2.1.0', desktopCutoverEnabled: true, desktopMigrationComplete: true, desktopBridgePublishingEnabled: false }))
})

test('single-platform bundle and publisher cannot accidentally publish half a desktop bridge', async t => {
  const f = await fixture(t), identity = desktopBridgeSource(f.root, 'v2.1.0').windows
  await assert.rejects(createReleaseBundle({ identity }), /both desktop targets/)
  let called = false
  await assert.rejects(publishPlatformRelease({ identity, fetcher: async () => { called = true } }), /both desktop targets/)
  assert.equal(called, false)
})

test('bridge build workflow keeps both native builds and final assembly read-only with exact same-run inputs', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/desktop-bridge-build.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.on, { push: { tags: ['v*'] } })
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.deepEqual(Object.keys(workflow.jobs), ['validate', 'windows', 'macos', 'bundle'])
  assert.deepEqual(workflow.jobs.bundle.needs, ['validate', 'windows', 'macos'])
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\s*[.\[]|github\.token|:\s*write\b|publish-platform-release|publish-desktop-bridge|promote-update-manifest|workflow_run|pull_request_target/)
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.environment, undefined)
    assert.equal(job.permissions?.contents ?? workflow.permissions.contents, 'read')
    const recheck = job.steps.findIndex(step => step.run?.includes('validate-desktop-bridge.mjs'))
    assert.ok(recheck >= 0)
    for (const [index, step] of job.steps.entries()) {
      if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/)
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with['persist-credentials'], false)
        if (name !== 'validate') assert.equal(step.with.ref, '${{ needs.validate.outputs.commit }}')
      }
      assert.doesNotMatch(step.run ?? '', /git (?:push|tag)\b/)
      if (step.run?.includes('npm ci')) assert.ok(index > recheck)
      if (step.uses?.startsWith('actions/download-artifact@')) assert.match(step.with.name, /github.run_id.*github.run_attempt/)
      if (name === 'bundle') assert.doesNotMatch(step.run ?? '', /\b(?:npm|npx|uv|gradle|gradlew)\b/)
    }
  }
  for (const platform of ['windows', 'macos']) {
    const job = workflow.jobs[platform]
    assert.deepEqual(job.needs, ['validate'])
    assert.match(JSON.stringify(job.steps), new RegExp(`verify-release-build.mjs --bridge ${platform}`))
    assert.match(JSON.stringify(job.steps), /generate-build-inventory.mjs/)
    const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))
    const download = workflow.jobs.bundle.steps.find(step => step.uses?.startsWith('actions/download-artifact@') && step.with.name.startsWith(`bridge-${platform}-`))
    assert.equal(download.with.name, upload.with.name)
  }
  assert.match(JSON.stringify(workflow.jobs.bundle), /build-desktop-bridge-bundle.mjs/)
  assert.match(JSON.stringify(workflow.jobs.bundle), /verify-desktop-bridge-bundle.mjs/)
})
