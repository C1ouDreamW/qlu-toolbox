import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { buildInformation } from '../electron/channel-contract.mjs'
import { resolveRelease } from '../scripts/release-config.mjs'
import { createBuildInventory, androidRuntimeInventory, INVENTORY_FILES } from '../scripts/build-inventory.mjs'
import { assertInventorySource } from '../scripts/inventory-source.mjs'
import { prepareRelease } from '../scripts/prepare-release.mjs'
import { sha256 } from '../scripts/release-artifacts.mjs'
import { readBuildInventory } from '../scripts/inventory-artifacts.mjs'
import { readUnsignedBuildInput } from '../scripts/unsigned-build-input.mjs'
import { writeInventoryFixture } from './inventory-fixture.mjs'
import yaml from 'js-yaml'

const versions = JSON.parse(await readFile(new URL('../config/release-versions.json', import.meta.url)))
const information = (platform = 'android', commit = 'a'.repeat(40)) => buildInformation(resolveRelease(versions, { platform, channel: 'alpha' }), commit)
const report = () => ({ components: [{ type: 'library', name: 'fixture', version: '1', 'bom-ref': 'fixture' }], dependencies: [{ ref: 'fixture', dependsOn: [] }], roots: ['fixture'], notices: [{ component: 'fixture', file: 'LICENSE', text: 'Fixture license\n', sha256: sha256('Fixture license\n') }] })
const options = () => ({ information: information(), reports: [report()], projectTerms: '仅供个人学习、交流和非商业用途\n', sourceInputs: { 'package-lock.json': 'b'.repeat(64) }, createdAt: '2026-11-07T00:00:00.000Z' })

test('inventory preserves project terms and unknown licensing, and provenance binds the exact notice bytes', () => {
  const input = options(), files = createBuildInventory(input)
  assert.deepEqual(Object.keys(files).sort(), [...INVENTORY_FILES].sort())
  const sbom = JSON.parse(files['dependency-inventory.cdx.json'])
  assert.equal(sbom.metadata.component.licenses, undefined)
  assert.equal(sbom.metadata.component.version, input.information.version)
  assert.equal(files['PROJECT-TERMS.txt'], input.projectTerms)
  assert.match(files['THIRD-PARTY-NOTICES.txt'], /Fixture license/)
  assert.equal(JSON.parse(files['license-review.json']).status, 'requires-maintainer-review')
  const provenance = JSON.parse(files['build-provenance.json'])
  assert.deepEqual(provenance.identity, input.information)
  for (const entry of provenance.files) {
    assert.equal(entry.sha256, sha256(files[entry.file]))
    assert.equal(entry.size, Buffer.byteLength(files[entry.file]))
  }
})

test('inventory rejects incomplete graphs, replaced notices and accidental environment dumps', () => {
  for (const edit of [
    r => r.components.push({ type: 'library', name: 'disconnected', 'bom-ref': 'lost' }),
    r => r.dependencies[0].dependsOn.push('missing'),
    r => r.dependencies.push(r.dependencies[0]),
    r => { r.notices[0].text = 'replaced' },
    r => { r.notices[0].component = 'unknown' },
    r => { r.dependencies = [] },
  ]) {
    const input = options(); edit(input.reports[0]); assert.throws(() => createBuildInventory(input))
  }
  assert.throws(() => createBuildInventory({ ...options(), builder: { HOME: '/Users/private' } }), /unexpected environment/)
  assert.throws(() => createBuildInventory({ ...options(), sourceInputs: { lock: 'unverified' } }), /source input/)
})

test('native Android inventory rejects stale commits and disconnected roots and removes private remote URLs', () => {
  const info = information()
  const native = { bomFormat: 'CycloneDX', specVersion: '1.6', metadata: { component: { type: 'application', 'bom-ref': 'app', name: 'app', version: info.version, description: `LumaTile Android alpha resolved runtime dependencies for commit ${info.commit}`, externalReferences: [{ type: 'vcs', url: 'https://user:password@example.invalid/repo' }, { type: 'vcs', url: 'https://example.invalid/repo' }] } }, components: [{ type: 'library', name: 'native', 'bom-ref': 'native' }], dependencies: [{ ref: 'app', dependsOn: ['native'] }, { ref: 'native', dependsOn: [] }] }
  const resolved = androidRuntimeInventory(native, info, { components: [] })
  assert.equal(resolved.components[0].externalReferences.length, 1)
  assert.equal(resolved.unresolvedLicenses.length, 2)
  assert.throws(() => androidRuntimeInventory(native, { ...info, commit: 'b'.repeat(40) }, { components: [] }), /build identity/)
  native.dependencies[0].dependsOn = []
  assert.throws(() => androidRuntimeInventory(native, info, { components: [] }), /disconnected/)
})

async function sourceFixture(t, platform) {
  const root = await mkdtemp(join(tmpdir(), 'lumatile-inventory-git-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = ['package.json', 'package-lock.json', 'apps/mobile/package.json', 'lumatile/__init__.py', 'config/release-versions.json', 'config/release-migration.json', 'README.md', 'scripts/android-sbom.init.gradle', 'uv.lock', 'pyproject.toml', 'LumaTileWorker.spec', '.gitignore']
  for (const file of files) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), await readFile(new URL('../' + file, import.meta.url))) }
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-qb', 'main']); git(['add', '.'])
  git(['-c', 'user.name=Inventory Test', '-c', 'user.email=inventory@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: 构建来源夹具'])
  await prepareRelease({ root, platform, channel: 'alpha' })
  return { root, git, info: information(platform, git(['rev-parse', 'HEAD'])) }
}

test('source provenance accepts only exact generated version carriers and rejects hidden dependency edits', async t => {
  for (const platform of ['android', 'macos']) {
    const f = await sourceFixture(t, platform)
    const source = await assertInventorySource(f.root, f.info)
    assert.match(source.projectTerms, /非商业用途/)
    assert.ok(Object.values(source.sourceInputs).every(value => /^[a-f0-9]{64}$/.test(value)))
    const path = join(f.root, platform === 'android' ? 'apps/mobile/package.json' : 'package.json')
    const pkg = JSON.parse(await readFile(path)); pkg.dependencies.vue = '0.0.1'; await writeFile(path, JSON.stringify(pkg))
    await assert.rejects(assertInventorySource(f.root, f.info), /outside the recorded source/)
  }
})

test('source provenance rejects untracked inputs, unrelated edits and changed executable modes', async t => {
  const f = await sourceFixture(t, 'macos')
  await writeFile(join(f.root, 'unreviewed.mjs'), 'export const altered = true')
  await assert.rejects(assertInventorySource(f.root, f.info), /Untracked source/)
  await rm(join(f.root, 'unreviewed.mjs'))
  await writeFile(join(f.root, 'README.md'), 'changed')
  await assert.rejects(assertInventorySource(f.root, f.info), /outside generated version carriers/)
  f.git(['checkout', '--', 'README.md'])
  if (process.platform !== 'win32') {
    await chmod(join(f.root, 'package.json'), 0o755)
    await assert.rejects(assertInventorySource(f.root, f.info), /file modes/)
  }
})

test('downloaded inventories cannot change channel, notices or source identity after being bound to a build', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lumatile-inventory-download-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const info = information(), identity = { information: info }
  const inventory = await writeInventoryFixture(directory, identity)
  await readBuildInventory(directory, info, inventory.provenanceSha256)
  await assert.rejects(readBuildInventory(directory, information('macos'), inventory.provenanceSha256), /identity mismatch/)
  await writeFile(join(directory, 'THIRD-PARTY-NOTICES.txt'), 'replacement')
  await assert.rejects(readBuildInventory(directory, info, inventory.provenanceSha256), /content differs/)
})

test('signing rejects a coherently replaced inventory and receipt even if the unsigned APK is unchanged', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lumatile-unsigned-inventory-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const info = information(), identity = { ...info, information: info, tag: 'android-alpha-v' + info.version, androidSigningSha256: 'c'.repeat(64) }
  const context = { repository: 'C1ouDreamW/qlu-toolbox', event: 'push', ref: `refs/tags/${identity.tag}`, sha: info.commit, runId: '42', runAttempt: '1' }
  const inventoryDirectory = join(directory, 'inventory'); await mkdir(inventoryDirectory)
  const inventory = await writeInventoryFixture(inventoryDirectory, identity, { repository: context.repository, runId: context.runId, runAttempt: context.runAttempt })
  const apk = join(directory, 'app-release-unsigned.apk'), receiptPath = join(directory, 'unsigned-receipt.json'), bytes = Buffer.from('unsigned APK fixture')
  await writeFile(apk, bytes)
  const receipt = { schemaVersion: 2, purpose: 'unsigned-android-release', deployable: false, inventorySha256: inventory.provenanceSha256,
    platform: 'android', channel: 'alpha', tag: identity.tag, commit: info.commit, version: info.version, versionCode: info.versionCode,
    applicationId: info.applicationId, signingSha256: identity.androidSigningSha256, repository: context.repository, runId: context.runId, runAttempt: context.runAttempt,
    artifact: { file: 'app-release-unsigned.apk', sha256: sha256(bytes), size: bytes.length } }
  const original = JSON.stringify(receipt); await writeFile(receiptPath, original)
  const input = { identity, context, apk, receiptPath, expectedSha256: sha256(bytes), expectedReceiptSha256: sha256(original) }
  await readUnsignedBuildInput(input)
  // Recompute every downloaded local hash; the independent job output still anchors the receipt.
  const provenancePath = join(inventoryDirectory, 'build-provenance.json')
  const provenance = JSON.parse(await readFile(provenancePath)); provenance.builder.runId = '43'
  const replacement = JSON.stringify(provenance); await writeFile(provenancePath, replacement)
  receipt.inventorySha256 = sha256(replacement); await writeFile(receiptPath, JSON.stringify(receipt))
  await assert.rejects(readUnsignedBuildInput(input), /validated build job output/)
  await assert.rejects(readUnsignedBuildInput({ ...input, expectedReceiptSha256: sha256(JSON.stringify(receipt)) }), /workflow run and attempt/)
  await assert.rejects(readUnsignedBuildInput({ ...input, expectedReceiptSha256: undefined }), /validated build job output/)
})

test('all distributed build workflows generate inventory without credentials; Android signers bind a separate receipt job output', async () => {
  for (const file of ['release-windows.yml', 'release-macos.yml', 'release-android.yml', 'alpha-candidate.yml', 'release-rehearsal.yml']) {
    const workflow = yaml.load(await readFile(new URL('../.github/workflows/' + file, import.meta.url), 'utf8'))
    let generators = 0
    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.run?.includes('generate-build-inventory.mjs')) {
          generators++
          assert.doesNotMatch(JSON.stringify(step), /secrets\s*[.\[]/)
          assert.ok(!['sign', 'android-sign', 'publish'].includes(name))
        }
        if (['sign', 'android-sign'].includes(name)) assert.doesNotMatch(step.run ?? '', /generate-build-inventory|cyclonedxDirectBom/)
      }
    }
    assert.equal(generators, ['alpha-candidate.yml', 'release-rehearsal.yml'].includes(file) ? 3 : 1)
    const build = workflow.jobs.build ?? workflow.jobs['android-build'], sign = workflow.jobs.sign ?? workflow.jobs['android-sign']
    if (sign) {
      assert.equal(build.outputs.receipt_sha256, '${{ steps.receipt.outputs.receipt_sha256 }}')
      assert.equal(sign.env.RELEASE_RECEIPT_SHA256, '${{ needs.' + (workflow.jobs.build ? 'build' : 'android-build') + '.outputs.receipt_sha256 }}')
    }
  }
})
