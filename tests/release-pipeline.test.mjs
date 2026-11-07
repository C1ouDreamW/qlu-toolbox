import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { androidArtifactName } from '../electron/android-update-contract.mjs'
import { channelIdentity } from '../electron/channel-contract.mjs'
import { artifactFileNames, desktopTarget } from '../electron/update-contract.mjs'
import { assertPromotion, createReleaseBundle, manifestTarget, sha256, taggedRelease, verifyReleaseFiles } from '../scripts/release-artifacts.mjs'
import { prepareAndroidBackup } from '../scripts/prepare-android-backup.mjs'
import { promoteManifest } from '../scripts/promote-update-manifest.mjs'
import { publishPlatformRelease } from '../scripts/publish-platform-release.mjs'

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lumatile-pipeline-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function buildFixture(t, platform = 'windows', version = '2.0.6', code = 16, channel = 'stable') {
  const root = await temporary(t)
  const target = platform === 'android' ? null : desktopTarget(platform === 'windows' ? 'win32' : 'darwin', platform === 'windows' ? 'x64' : 'arm64')
  const prefix = channel === 'alpha' ? (target?.prefix ?? 'android-v').replace('-v', '-alpha-v') : target?.prefix ?? 'android-v'
  const identity = { platform, channel, target: target?.id ?? 'android', version, versionCode: code, tag: `${prefix}${version}`,
    commit: 'a'.repeat(40), bridgeVersion: '2.0.5', androidSigningSha256: 'b'.repeat(64), notes: '- Platform fix', publishedAt: '2026-11-06T00:00:00Z' }
  const artifacts = join(root, 'artifacts')
  await mkdir(artifacts)
  const names = platform === 'android' ? { apk: androidArtifactName(version, channel) } : artifactFileNames(target, version, false, channel)
  for (const [role, name] of Object.entries(names)) await writeFile(join(artifacts, name), `${platform} ${version} ${role} fixture`)
  const verification = { platform, channel, version, commit: identity.commit, target: identity.target, verified: true, checks: { testFixture: true } }
  if (platform === 'android') {
    const bytes = await readFile(join(artifacts, names.apk))
    verification.checks = { applicationId: channelIdentity(channel, 'android').applicationId, debuggable: false, nativeVersionCode: code,
      signingSha256: identity.androidSigningSha256, signedSha256: sha256(bytes), signedSize: bytes.length }
  }
  const output = join(root, 'bundle')
  const bundle = await createReleaseBundle({ identity, artifacts, verification, output })
  return { root, artifacts, output, identity, verification, ...bundle }
}

function priorManifest(platform, version = '2.0.5', code = 15) {
  if (platform === 'android') return { schemaVersion: 1, applicationId: 'io.github.c1oudreamw.lumatile', channel: 'stable', versionName: version, versionCode: code,
    sha256: 'b'.repeat(64), size: 123, title: 'Earlier release', mandatory: false, notes: '- Old', publishedAt: '2026-11-05T00:00:00Z', apkUrl: `https://lumatile.ishua.cloud/releases/v${version}/LumaTile-Android-v${version}.apk` }
  const target = desktopTarget(platform === 'windows' ? 'win32' : 'darwin', platform === 'windows' ? 'x64' : 'arm64')
  const bridge = version === '2.0.5'
  const tag = `${bridge ? 'v' : target.prefix}${version}`
  const file = artifactFileNames(target, version, bridge)[target.primary]
  return { schemaVersion: 2, platform, arch: target.arch, channel: 'stable', version, tag, commit: 'b'.repeat(40), name: 'Earlier release', notes: '- Earlier release', publishedAt: '2026-11-05T00:00:00Z',
    artifacts: { [target.primary]: { url: `https://lumatile.ishua.cloud/releases/${tag}/${file}`, fallbackUrl: `https://github.com/C1ouDreamW/qlu-toolbox/releases/download/${tag}/${file}`, size: 123, sha256: 'b'.repeat(64) } } }
}

test('each deployment bundle contains exactly its own stable pointer and verified release assets', async t => {
  for (const platform of ['windows', 'macos', 'android']) {
    const fixture = await buildFixture(t, platform)
    assert.deepEqual(await readdir(join(fixture.output, 'stable')), [`${manifestTarget(platform)}.json`])
    const files = await verifyReleaseFiles(fixture.releaseDir)
    assert.ok(files.includes('release-record.json'))
    assert.ok(files.includes(`update-${manifestTarget(platform)}.json`))
    assert.ok(!files.some(file => platform !== 'android' && file.endsWith('.apk')))
    if (platform === 'android') {
      assert.equal(fixture.manifest.sha256, fixture.stable.sha256)
      assert.equal(fixture.manifest.size, fixture.stable.size)
      assert.ok(fixture.manifest.apkUrl.startsWith('https://github.com/'))
      assert.ok(fixture.stable.apkUrl.startsWith('https://lumatile.ishua.cloud/'))
    }
    await writeFile(join(fixture.releaseDir, 'release-notes.md'), '- Corrupted after verification')
    await assert.rejects(verifyReleaseFiles(fixture.releaseDir), /Checksum mismatch/)
  }
})

test('bundle generation refuses missing portable assets and mismatched build identity', async t => {
  const fixture = await buildFixture(t)
  const options = { identity: fixture.identity, artifacts: fixture.artifacts, verification: fixture.verification, output: join(fixture.root, 'new-bundle') }
  await assert.rejects(createReleaseBundle({ ...options, verification: { ...fixture.verification, version: '2.0.4' } }), /verification/)
  await rm(join(fixture.artifacts, 'LumaTile-Windows-v2.0.6-x64.zip'))
  await assert.rejects(createReleaseBundle(options), /ENOENT/)
  await assert.rejects(readdir(options.output), /ENOENT/)
})

test('independent promotion preserves other platforms and refuses late older deployments', async t => {
  const win = await buildFixture(t, 'windows', '2.0.7')
  const old = await buildFixture(t, 'windows', '2.0.6')
  const mac = await buildFixture(t, 'macos', '2.0.8')
  const data = await temporary(t)
  await mkdir(join(data, 'stable'))
  const sentinel = '{"versionCode":15,"preserve":"Android"}\n'
  await writeFile(join(data, 'stable/android.json'), sentinel)
  await writeFile(join(data, 'stable/announcement.json'), '{"preserve":"announcement"}\n')
  for (const bundle of [old, win, mac]) await cp(join(bundle.output, 'releases'), join(data, 'releases'), { recursive: true })
  await Promise.all([
    promoteManifest({ platform: 'windows', manifest: win.stable, data }),
    promoteManifest({ platform: 'macos', manifest: mac.stable, data }),
  ])
  await assert.rejects(promoteManifest({ platform: 'windows', manifest: old.stable, data }), /rollback/)
  assert.equal(JSON.parse(await readFile(join(data, 'stable/windows-x64.json'), 'utf8')).version, '2.0.7')
  assert.equal(await readFile(join(data, 'stable/android.json'), 'utf8'), sentinel)
  assert.equal(await readFile(join(data, 'stable/announcement.json'), 'utf8'), '{"preserve":"announcement"}\n')
  assert.deepEqual((await readdir(join(data, 'stable'))).sort(), ['android.json', 'announcement.json', 'macos-arm64.json', 'windows-x64.json'])
})

test('promotion refuses missing or corrupted uploaded artifacts before switching stable', async t => {
  const fixture = await buildFixture(t, 'android')
  const data = await temporary(t)
  await assert.rejects(promoteManifest({ platform: 'android', manifest: fixture.stable, data }), /ENOENT/)
  await cp(join(fixture.output, 'releases'), join(data, 'releases'), { recursive: true })
  await writeFile(join(data, 'releases', fixture.identity.tag, 'LumaTile-Android-v2.0.6.apk'), 'corrupted bytes')
  await assert.rejects(promoteManifest({ platform: 'android', manifest: fixture.stable, data }), /does not match/)
  assert.deepEqual(await readdir(join(data, 'stable')), [])
})

test('Android bundles reject APK replacement after signing and mismatched certificate reports', async t => {
  const fixture = await buildFixture(t, 'android')
  const options = { identity: fixture.identity, artifacts: fixture.artifacts, verification: fixture.verification, output: join(fixture.root, 'another-output') }
  await assert.rejects(createReleaseBundle({ ...options, verification: { ...fixture.verification,
    checks: { ...fixture.verification.checks, signingSha256: 'f'.repeat(64) } } }), /Signed APK differs/)
  await writeFile(join(fixture.artifacts, 'LumaTile-Android-v2.0.6.apk'), 'replaced after signing')
  await assert.rejects(createReleaseBundle(options), /Signed APK differs/)
  await assert.rejects(readdir(options.output), /ENOENT/)
})

test('Android rejects code rollback, same-code conflicts and replacing a published version', () => {
  const current = priorManifest('android', '2.0.6', 16)
  for (const next of [
    { ...current, versionName: '2.0.7', versionCode: 15 },
    { ...current, versionName: '2.0.7', versionCode: 16 },
    { ...current, sha256: 'f'.repeat(64) },
    { ...current, versionCode: 17 },
  ]) assert.throws(() => assertPromotion('android', current, next))
  assert.doesNotThrow(() => assertPromotion('android', current, { ...current }))
  assert.doesNotThrow(() => assertPromotion('android', current, { ...current, versionName: '2.0.7', versionCode: 17, sha256: 'f'.repeat(64) }))
})

function githubMock(fixture, { published = false, partial = [], prior = priorManifest(fixture.identity.platform), otherReleases = [], failUpload, remoteCommit, backup, releaseManifests = new Map() } = {}) {
  const assets = [...partial]
  let exists = published || partial.length > 0
  let draft = !published
  let attempts = 0
  const calls = []
  const api = 'https://api.github.com/repos/C1ouDreamW/qlu-toolbox'
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status })
  const release = () => ({ id: 123, tag_name: fixture.identity.tag, draft, prerelease: fixture.identity.channel === 'alpha', assets })
  const fetcher = async (input, options = {}) => {
    const url = new URL(input)
    const method = options.method ?? 'GET'
    calls.push({ url: String(url), method })
    if (url.hostname === 'lumatile.ishua.cloud') {
      assert.equal(options.headers.Authorization, undefined, 'Never send the GitHub token to a different origin')
      return prior === null ? response({}, 404) : response(typeof prior === 'function' ? prior() : prior)
    }
    if (url.hostname === 'raw.githubusercontent.com') return backup ? response(backup) : response({}, 404)
    if (url.hostname === 'github.com') {
      assert.equal(options.headers.Authorization, undefined)
      return releaseManifests.has(String(url)) ? response(releaseManifests.get(String(url))) : response({}, 404)
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    if (String(url).startsWith(`${api}/commits/`)) return response({ sha: remoteCommit ?? fixture.identity.commit })
    if (String(url).startsWith(`${api}/releases/tags/`)) return response(exists ? release() : {}, exists ? 200 : 404)
    if (url.hostname === 'uploads.github.com' && method === 'POST') {
      attempts++
      if (attempts === failUpload) return response({}, 503)
      const name = url.searchParams.get('name')
      assert.ok(!assets.some(asset => asset.name === name), 'Never overwrite an already-uploaded asset')
      assets.push({ id: assets.length + 1, name, size: options.body.length, digest: `sha256:${sha256(options.body)}`, state: 'uploaded' })
      return response(assets.at(-1), 201)
    }
    if (/\/releases\/assets\/\d+$/.test(url.pathname)) {
      const asset = assets.find(asset => asset.id === Number(url.pathname.split('/').at(-1)))
      return new Response(await readFile(join(fixture.releaseDir, asset.name)))
    }
    if (url.pathname.endsWith('/assets')) return response(assets)
    if (method === 'POST' && url.pathname.endsWith('/releases')) {
      assert.equal(JSON.parse(options.body).draft, true)
      assert.equal(JSON.parse(options.body).prerelease, fixture.identity.channel === 'alpha')
      assert.equal(JSON.parse(options.body).make_latest, 'false')
      exists = true
      return response(release(), 201)
    }
    if (method === 'PATCH') {
      assert.equal(JSON.parse(options.body).draft, false)
      draft = false
      return response(release())
    }
    if (url.pathname.endsWith('/releases')) return response([...otherReleases, ...(exists ? [release()] : [])])
    throw new Error(`Unexpected mock request: ${method} ${url}`)
  }
  return { fetcher, calls, assets, get draft() { return draft } }
}

test('Release remains draft until all assets have been verified; retries only fill missing assets', async t => {
  const fixture = await buildFixture(t)
  const mock = githubMock(fixture, { failUpload: 3 })
  const options = { identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: mock.fetcher }
  await assert.rejects(publishPlatformRelease(options), /503/)
  assert.equal(mock.draft, true)
  assert.equal(mock.assets.length, 2)
  assert.ok(!mock.calls.some(call => call.method === 'PATCH'))
  assert.equal((await publishPlatformRelease(options)).status, 'published')
  assert.equal(mock.draft, false)
  assert.equal(mock.assets.length, (await verifyReleaseFiles(fixture.releaseDir)).length)
  assert.equal(mock.calls.filter(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/releases')).length, 1)
  const offset = mock.calls.length
  assert.equal((await publishPlatformRelease(options)).status, 'already-published')
  assert.ok(mock.calls.slice(offset).every(call => call.method === 'GET'))
})

test('draft or public assets with the same name and different hash cannot be overwritten', async t => {
  const fixture = await buildFixture(t)
  const name = (await verifyReleaseFiles(fixture.releaseDir))[0]
  const bytes = await readFile(join(fixture.releaseDir, name))
  const partial = [{ id: 1, name, size: bytes.length, digest: `sha256:${'f'.repeat(64)}`, state: 'uploaded' }]
  const draft = githubMock(fixture, { partial })
  await assert.rejects(publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: draft.fetcher }), /different asset/)
  assert.ok(draft.calls.every(call => call.method === 'GET'))
  const published = githubMock(fixture, { partial, published: true })
  await assert.rejects(publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: published.fetcher }), /asset set/)
  assert.ok(published.calls.every(call => call.method === 'GET'))
})

test('newer stable or GitHub version, moved tag or Android backup conflict blocks all release mutations', async t => {
  const fixture = await buildFixture(t)
  for (const setup of [
    { prior: priorManifest('windows', '2.0.9') },
    { otherReleases: [{ tag_name: 'win-v2.0.9', draft: false, prerelease: false }] },
    { remoteCommit: 'f'.repeat(40) },
  ]) {
    const mock = githubMock(fixture, setup)
    await assert.rejects(publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: mock.fetcher }))
    assert.ok(mock.calls.every(call => call.method === 'GET'))
  }
  const android = await buildFixture(t, 'android')
  const mock = githubMock(android, { prior: priorManifest('android', '2.0.4', 15), backup: priorManifest('android', '2.0.6', 16) })
  await assert.rejects(publishPlatformRelease({ identity: android.identity, directory: android.releaseDir, token: 'fixture-token', fetcher: mock.fetcher }), /different APK/)
  assert.ok(mock.calls.every(call => call.method === 'GET'))
})

test('rollout policy comes from the tag commit; working-tree edits cannot enable publishing', async t => {
  const root = await temporary(t)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  await mkdir(join(root, 'config'))
  await mkdir(join(root, 'changelogs'))
  await writeFile(join(root, 'config/release-versions.json'), JSON.stringify({ schemaVersion: 1, windows: { version: '2.0.6' }, macos: { version: '2.0.5' }, android: { version: '2.0.4', versionCode: 15 } }))
  const policy = { schemaVersion: 1, bridgeVersion: '2.0.5', independentPublishingEnabled: false }
  await writeFile(join(root, 'config/release-migration.json'), JSON.stringify(policy))
  await writeFile(join(root, 'changelogs/windows.md'), '## [2.0.6]\n\n- Windows fix\n')
  git(['init', '-q']); git(['add', '.'])
  git(['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: 发布门禁测试夹具'])
  git(['tag', 'win-v2.0.6'])
  assert.throws(() => taggedRelease(root, 'windows', 'win-v2.0.6'), /disabled/)
  policy.independentPublishingEnabled = true
  await writeFile(join(root, 'config/release-migration.json'), JSON.stringify(policy))
  assert.throws(() => taggedRelease(root, 'windows', 'win-v2.0.6'), /disabled/)
  assert.equal(taggedRelease(root, 'windows', 'win-v2.0.6', false).version, '2.0.6')
  assert.throws(() => taggedRelease(root, 'macos', 'win-v2.0.6', false), /release tag/)
})

test('publication rechecks monotonicity after uploading and leaves a superseded build in draft', async t => {
  const fixture = await buildFixture(t)
  let checks = 0
  const mock = githubMock(fixture, { prior: () => priorManifest('windows', ++checks === 1 ? '2.0.5' : '2.0.9') })
  await assert.rejects(publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: mock.fetcher }), /rollback/)
  assert.equal(mock.draft, true)
  assert.ok(mock.assets.length > 0)
  assert.ok(mock.calls.every(call => call.method !== 'PATCH'))
})

test('published retries verify asset bytes when GitHub does not supply a digest', async t => {
  const fixture = await buildFixture(t)
  const assets = []
  for (const name of await verifyReleaseFiles(fixture.releaseDir)) assets.push({ id: assets.length + 1, name, size: (await readFile(join(fixture.releaseDir, name))).length, state: 'uploaded' })
  const mock = githubMock(fixture, { published: true, partial: assets })
  assert.equal((await publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: mock.fetcher })).status, 'already-published')
  assert.ok(mock.calls.some(call => /\/releases\/assets\/\d+$/.test(new URL(call.url).pathname)))
  assert.ok(mock.calls.every(call => call.method === 'GET'))
})

test('equal desktop retries compare artifact content independently of JSON field order', () => {
  const current = priorManifest('windows')
  const next = structuredClone(current)
  next.artifacts.installer = Object.fromEntries(Object.entries(next.artifacts.installer).reverse())
  assert.doesNotThrow(() => assertPromotion('windows', current, next))
  next.artifacts.installer.sha256 = 'f'.repeat(64)
  assert.throws(() => assertPromotion('windows', current, next), /cannot be replaced/)
})

test('Android publishing checks all public platform versionCodes and keeps every mirror on one APK', async t => {
  const earlierUrl = 'https://github.com/C1ouDreamW/qlu-toolbox/releases/download/android-v2.0.5/update-android.json'
  const prior = priorManifest('android', '2.0.4', 15)
  const earlier = priorManifest('android', '2.0.5', 16)
  const releases = [{ tag_name: 'android-v2.0.5', draft: false, prerelease: false, assets: [{ name: 'update-android.json', browser_download_url: earlierUrl }] }]
  const setup = { prior, backup: prior, otherReleases: releases, releaseManifests: new Map([[earlierUrl, earlier]]) }
  const conflict = await buildFixture(t, 'android', '2.0.6', 16)
  const rejected = githubMock(conflict, setup)
  await assert.rejects(publishPlatformRelease({ identity: conflict.identity, directory: conflict.releaseDir, token: 'fixture-token', fetcher: rejected.fetcher }), /different APK/)
  assert.ok(rejected.calls.every(call => call.method === 'GET'))
  const next = await buildFixture(t, 'android', '2.0.6', 17)
  const accepted = githubMock(next, setup)
  assert.equal((await publishPlatformRelease({ identity: next.identity, directory: next.releaseDir, token: 'fixture-token', fetcher: accepted.fetcher })).status, 'published')
  assert.equal(next.manifest.sha256, next.stable.sha256)
})

test('Alpha bundles and concurrent promotion touch only their own channel and platform', async t => {
  const alpha = await buildFixture(t, 'windows', '2.1.0-alpha.10', 16, 'alpha')
  const old = await buildFixture(t, 'windows', '2.1.0-alpha.2', 16, 'alpha')
  const android = await buildFixture(t, 'android', '2.1.0-alpha.1', 1, 'alpha')
  const stable = await buildFixture(t, 'windows', '2.0.7')
  assert.deepEqual((await readdir(alpha.output)).sort(), ['alpha', 'releases'])
  assert.ok((await verifyReleaseFiles(alpha.releaseDir)).includes('LumaTile-Alpha-Windows-v2.1.0-alpha.10-x64-Setup.exe'))
  assert.equal(android.manifest.applicationId, 'io.github.c1oudreamw.lumatile.alpha')
  assert.equal(android.manifest.tag, android.identity.tag)
  assert.equal(android.manifest.commit, android.identity.commit)
  const data = await temporary(t)
  for (const bundle of [alpha, old, stable, android]) await cp(join(bundle.output, 'releases'), join(data, 'releases'), { recursive: true })
  await Promise.all([
    promoteManifest({ platform: 'windows', channel: 'alpha', manifest: alpha.stable, data }),
    promoteManifest({ platform: 'windows', manifest: stable.stable, data }),
    promoteManifest({ platform: 'android', channel: 'alpha', manifest: android.stable, data }),
  ])
  const stableBytes = await readFile(join(data, 'stable/windows-x64.json'), 'utf8')
  await assert.rejects(promoteManifest({ platform: 'windows', channel: 'alpha', manifest: old.stable, data }), /rollback/)
  await assert.rejects(promoteManifest({ platform: 'windows', channel: 'stable', manifest: alpha.stable, data }))
  assert.equal(await readFile(join(data, 'stable/windows-x64.json'), 'utf8'), stableBytes)
  assert.deepEqual((await readdir(join(data, 'stable'))), ['windows-x64.json'])
  assert.deepEqual((await readdir(join(data, 'alpha'))).sort(), ['android.json', 'windows-x64.json'])
  assert.throws(() => assertPromotion('windows', stable.stable, alpha.stable), /channels/)
  assert.throws(() => assertPromotion('android', android.stable, { ...android.stable, applicationId: 'io.github.c1oudreamw.lumatile' }), /application IDs/)
})

test('first Alpha publication permits absent Alpha baselines and ignores all Stable counters', async t => {
  for (const platform of ['windows', 'macos', 'android']) {
    const fixture = await buildFixture(t, platform, '2.1.0-alpha.1', 1, 'alpha')
    const mock = githubMock(fixture, { prior: null, otherReleases: [
      { tag_name: 'android-v99.0.0', draft: false, prerelease: false },
      { tag_name: 'win-v99.0.0', draft: false, prerelease: false },
      { tag_name: 'mac-v99.0.0', draft: false, prerelease: false },
    ] })
    assert.equal((await publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: mock.fetcher })).status, 'published')
    assert.ok(mock.calls.some(call => call.url.includes(`/alpha/${manifestTarget(platform)}.json`)))
    assert.ok(!mock.calls.some(call => call.url.includes('/stable/') || call.url.endsWith('/updates/android.json')))
    if (platform === 'android') assert.ok(mock.calls.some(call => call.url.endsWith('/updates/android-alpha.json')))
  }
})

test('newer Alpha versions and same-code mirror conflicts prevent publication before mutations', async t => {
  const fixture = await buildFixture(t, 'windows', '2.1.0-alpha.2', 1, 'alpha')
  const mock = githubMock(fixture, { prior: null, otherReleases: [{ tag_name: 'win-alpha-v2.1.0-alpha.10', draft: false, prerelease: true }] })
  await assert.rejects(publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: mock.fetcher }), /newer/)
  assert.ok(mock.calls.every(call => call.method === 'GET'))
  const android = await buildFixture(t, 'android', '2.1.0-alpha.2', 2, 'alpha')
  const conflicted = githubMock(android, { prior: null, backup: { ...android.manifest, size: android.manifest.size + 1 } })
  await assert.rejects(publishPlatformRelease({ identity: android.identity, directory: android.releaseDir, token: 'fixture-token', fetcher: conflicted.fetcher }), /different APK/)
  assert.ok(conflicted.calls.every(call => call.method === 'GET'))
})

test('Alpha uses an immutable independent gate and Android requires its own certificate', async t => {
  const root = await temporary(t)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  await mkdir(join(root, 'config')); await mkdir(join(root, 'changelogs'))
  const config = { schemaVersion: 2 }
  for (const platform of ['windows', 'macos', 'android']) {
    const counter = platform === 'android' ? { versionCode: 1 } : { buildNumber: 1 }
    config[platform] = { stable: { version: '2.0.4', ...counter }, alpha: { version: '2.1.0-alpha.1', ...counter } }
    await writeFile(join(root, `changelogs/${platform}.md`), '## [2.1.0-alpha.1]\n\n- Alpha test\n')
  }
  await writeFile(join(root, 'config/release-versions.json'), JSON.stringify(config))
  const policy = { schemaVersion: 1, bridgeVersion: null, independentPublishingEnabled: false, alphaPublishingEnabled: false, androidSigningSha256: 'b'.repeat(64), androidAlphaSigningSha256: null }
  const save = async () => {
    await writeFile(join(root, 'config/release-migration.json'), JSON.stringify(policy))
    git(['add', '.']); git(['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: Alpha 门禁夹具'])
    for (const prefix of ['win', 'mac', 'android']) git(['tag', '-f', `${prefix}-alpha-v2.1.0-alpha.1`])
  }
  git(['init', '-q']); await save()
  assert.throws(() => taggedRelease(root, 'windows', 'win-alpha-v2.1.0-alpha.1'), /Alpha publishing is disabled/)
  policy.alphaPublishingEnabled = true
  await writeFile(join(root, 'config/release-migration.json'), JSON.stringify(policy))
  assert.throws(() => taggedRelease(root, 'windows', 'win-alpha-v2.1.0-alpha.1'), /disabled/)
  await save()
  assert.equal(taggedRelease(root, 'windows', 'win-alpha-v2.1.0-alpha.1').channel, 'alpha')
  assert.throws(() => taggedRelease(root, 'android', 'android-alpha-v2.1.0-alpha.1'), /signing certificate/)
  policy.androidAlphaSigningSha256 = policy.androidSigningSha256; await save()
  assert.throws(() => taggedRelease(root, 'android', 'android-alpha-v2.1.0-alpha.1'), /signing certificate/)
  policy.androidAlphaSigningSha256 = 'c'.repeat(64); await save()
  assert.equal(taggedRelease(root, 'android', 'android-alpha-v2.1.0-alpha.1').androidSigningSha256, 'c'.repeat(64))
  assert.throws(() => taggedRelease(root, 'windows', 'win-alpha-v2.1.0-alpha.01'))
})

test('Android backup preparation creates Alpha independently and preserves the Stable manifest', async t => {
  const fixture = await buildFixture(t, 'android', '2.1.0-alpha.2', 2, 'alpha')
  const root = await temporary(t)
  await mkdir(join(root, 'updates'))
  const sentinel = JSON.stringify(priorManifest('android'))
  await writeFile(join(root, 'updates/android.json'), sentinel)
  assert.equal(await prepareAndroidBackup({ checkout: root, manifest: fixture.manifest, channel: 'alpha' }), 'updates/android-alpha.json')
  assert.equal(await readFile(join(root, 'updates/android.json'), 'utf8'), sentinel)
  await assert.rejects(prepareAndroidBackup({ checkout: root, manifest: { ...fixture.manifest, versionCode: 1 }, channel: 'alpha' }), /rollback/)
  await assert.rejects(prepareAndroidBackup({ checkout: root, manifest: fixture.manifest, channel: 'stable' }))
  await assert.rejects(prepareAndroidBackup({ checkout: root, manifest: fixture.manifest, channel: '../stable' }))
  assert.equal(await readFile(join(root, 'updates/android.json'), 'utf8'), sentinel)
})

test('first Alpha can ignore a missing baseline but cannot treat invalid JSON as absence', async t => {
  const fixture = await buildFixture(t, 'windows', '2.1.0-alpha.1', 1, 'alpha')
  for (const value of [null, [], 'invalid']) {
    const mock = githubMock(fixture, { prior: () => value })
    await assert.rejects(publishPlatformRelease({ identity: fixture.identity, directory: fixture.releaseDir, token: 'fixture-token', fetcher: mock.fetcher }), /baseline JSON/)
    assert.ok(mock.calls.every(call => call.method === 'GET'))
  }
})
