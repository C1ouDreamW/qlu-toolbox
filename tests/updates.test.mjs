import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDesktopUpdate, checkGithubUpdate, verifyBootstrapVersion } from '../dist-electron/updates.js'
import { artifactFileNames, compareVersions, desktopTarget, validateDesktopManifest, validateMigrationPolicy } from '../electron/update-contract.mjs'

const windows = desktopTarget('win32', 'x64')
const macos = desktopTarget('darwin', 'arm64')
const commit = 'a'.repeat(40)
const api = 'https://api.github.com/repos/C1ouDreamW/qlu-toolbox'
const github = 'https://github.com/C1ouDreamW/qlu-toolbox/releases/download'

function manifest(version = '2.0.6', target = windows, bridge = false) {
  const tag = `${bridge ? 'v' : target.prefix}${version}`
  const name = artifactFileNames(target, version, bridge)[target.primary]
  return { schemaVersion: 2, platform: target.platform, arch: target.arch, channel: 'stable',
    version, tag, commit, name: `LumaTile ${version}`, notes: '- Fix', publishedAt: '2026-11-06T00:00:00Z',
    artifacts: { [target.primary]: { url: `https://lumatile.ishua.cloud/releases/${tag}/${name}`, fallbackUrl: `${github}/${tag}/${name}`, sha256: 'b'.repeat(64), size: 123 } } }
}

function release(item) {
  return { tag_name: item.tag, draft: false, prerelease: false, assets: [
    { name: `update-${item.platform === 'windows' ? 'windows-x64' : 'macos-arm64'}.json`, browser_download_url: `${github}/${item.tag}/update-${item.platform === 'windows' ? 'windows-x64' : 'macos-arm64'}.json`, size: 999 },
    ...Object.values(item.artifacts).map(artifact => ({ name: artifact.fallbackUrl.split('/').at(-1), browser_download_url: artifact.fallbackUrl, size: artifact.size, state: 'uploaded', digest: `sha256:${artifact.sha256}` })),
  ] }
}

function network(items, { records = items.map(release), pages = [records], primary, overrides = new Map() } = {}) {
  const calls = []
  const routes = new Map()
  pages.forEach((page, index) => routes.set(`${api}/releases?per_page=100&page=${index + 1}`, page))
  for (const item of items) {
    const target = item.platform === 'windows' ? windows : macos
    routes.set(`${github}/${item.tag}/update-${target.id}.json`, item)
    routes.set(`${api}/commits/${item.tag}`, { sha: item.commit })
  }
  if (primary) routes.set(`https://lumatile.ishua.cloud/stable/${primary.platform === 'windows' ? windows.id : macos.id}.json`, primary)
  for (const [url, value] of overrides) routes.set(url, value)
  const fetcher = async (url, init) => {
    calls.push(String(url))
    assert.equal(init.headers['User-Agent'], 'LumaTile-UpdateChecker')
    const value = routes.get(String(url))
    if (value instanceof Error) throw value
    if (value instanceof Response) return value
    return new Response(value === undefined ? 'Not found' : JSON.stringify(value), { status: value === undefined ? 404 : 200 })
  }
  return { fetcher, calls }
}

test('strict comparison handles numeric segments and rejects decorated runtime versions', () => {
  assert.equal(compareVersions('2.0.10', '2.0.9'), 1)
  assert.equal(compareVersions('2.1.0', '2.0.999'), 1)
  assert.equal(compareVersions('1.99.0', '2.0.0'), -1)
  assert.equal(compareVersions('2.0.6', '2.0.6'), 0)
  for (const value of ['v2.0.6', 'android-v2.0.6', '2.0.6-beta', '2.0.6+build', '2.00.6']) assert.throws(() => compareVersions(value, '2.0.4'))
})

test('manifest trust binds target, date, version, tag, artifact paths and checksums', () => {
  const valid = manifest()
  assert.equal(validateDesktopManifest(valid, windows), valid)
  for (const mutate of [
    item => { item.arch = 'arm64' }, item => { item.platform = 'macos' }, item => { item.channel = 'beta' },
    item => { item.version = '2.0.6-beta' }, item => { item.tag = 'mac-v2.0.6' }, item => { item.commit = 'abc' },
    item => { item.publishedAt = '2026-02-30T00:00:00Z' }, item => { item.publishedAt = 'yesterday' },
    item => { item.artifacts.installer.sha256 = 'bad' }, item => { item.artifacts.installer.size = 0 },
    item => { item.artifacts.installer.url += '?redirect=bad' }, item => { item.artifacts.installer.fallbackUrl = item.artifacts.installer.url },
    item => { item.artifacts.installer.url = item.artifacts.installer.url.replace('lumatile.ishua.cloud', 'lumatile.ishua.cloud.evil.test') },
    item => { item.artifacts.installer.url = item.artifacts.installer.url.replace('https://', 'http://') },
    item => { item.artifacts.installer.url = item.artifacts.installer.url.replace('x64-Setup', 'arm64-Setup') },
    item => { item.artifacts.installer.fallbackUrl = item.artifacts.installer.fallbackUrl.replace('C1ouDreamW', 'other') },
    item => { delete item.artifacts.installer },
  ]) {
    const item = structuredClone(valid)
    mutate(item)
    assert.throws(() => validateDesktopManifest(item, windows), JSON.stringify(item))
  }
})

test('mixed platform releases are sorted by version instead of release time or array order', async () => {
  const lower = manifest('2.0.6')
  const higher = manifest('2.0.10')
  higher.publishedAt = '2026-01-01T00:00:00Z'
  const net = network([lower, manifest('99.0.0', macos), higher], { records: [release(lower), { ...release(lower), tag_name: 'android-v99.0.0' }, release(manifest('99.0.0', macos)), release(higher)] })
  const update = await checkGithubUpdate('2.0.4', windows, null, net.fetcher)
  assert.equal(update.version, '2.0.10')
  assert.equal(update.url, higher.artifacts.installer.fallbackUrl)
  assert.ok(!net.calls.some(url => url.includes('update-macos')))
})

test('pagination finds this platform after more than 100 unrelated releases', async () => {
  const next = manifest()
  const unrelated = Array.from({ length: 100 }, (_, index) => ({ ...release(next), tag_name: `android-v3.0.${index}` }))
  const net = network([next], { pages: [unrelated, [release(next)]] })
  assert.equal((await checkGithubUpdate('2.0.4', windows, null, net.fetcher)).version, '2.0.6')
  assert.ok(net.calls.includes(`${api}/releases?per_page=100&page=2`))
})

test('drafts, prereleases, unprefixed historical tags and other platforms never become updates', async () => {
  const next = manifest()
  const records = [{ ...release(next), draft: true }, { ...release(next), prerelease: true },
    ...['v99.0.0', 'win-v2.0.6-beta', 'mac-v99.0.0', 'android-v99.0.0'].map(tag => ({ ...release(next), tag_name: tag }))]
  const net = network([next], { records })
  assert.equal(await checkGithubUpdate('2.0.4', windows, null, net.fetcher), null)
  assert.equal(net.calls.length, 1)
})

test('unsupported architectures stop before requesting or recommending another package', async () => {
  for (const [platform, arch] of [['darwin', 'x64'], ['win32', 'arm64'], ['linux', 'x64']]) {
    let called = false
    await assert.rejects(checkDesktopUpdate('2.0.4', { platform, arch, fetcher: async () => { called = true; throw new Error('unexpected') } }), /暂不支持/)
    assert.equal(called, false)
  }
})

test('invalid highest release continues to a lower verified candidate', async () => {
  for (const mutate of [
    (item, record) => { record.assets = [] }, (item) => { item.arch = 'arm64' },
    (item) => { item.version = '2.0.8' }, (item, record) => { record.assets[1].size++ },
    (item, record) => { record.assets[1].digest = `sha256:${'f'.repeat(64)}` },
    (item, record) => { record.assets[1].state = 'new' },
  ]) {
    const higher = manifest('2.0.9')
    const record = release(higher)
    mutate(higher, record)
    const lower = manifest('2.0.7')
    const net = network([higher, lower], { records: [record, release(lower)] })
    assert.equal((await checkGithubUpdate('2.0.4', windows, null, net.fetcher)).version, '2.0.7')
  }
})

test('a manifest from a different commit is rejected even when names and sizes match', async () => {
  const next = manifest()
  const net = network([next], { overrides: new Map([[`${api}/commits/${next.tag}`, { sha: 'c'.repeat(40) }]]) })
  await assert.rejects(checkGithubUpdate('2.0.4', windows, null, net.fetcher), /commit/)
})

test('missing or broken manifests are unavailable, never falsely reported as current', async () => {
  const next = manifest()
  for (const response of [new Response('missing', { status: 404 }), new Response('{invalid JSON')]) {
    const net = network([next], { overrides: new Map([[`${github}/${next.tag}/update-windows-x64.json`, response]]) })
    await assert.rejects(checkGithubUpdate('2.0.4', windows, null, net.fetcher), /没有可核验/)
  }
})

test('GitHub listing failure, including later pages and rate limits, never means latest', async () => {
  const next = manifest()
  for (const status of [403, 429, 503]) {
    const net = network([next], { overrides: new Map([[`${api}/releases?per_page=100&page=1`, new Response('unavailable', { status })]]) })
    await assert.rejects(checkGithubUpdate('2.0.4', windows, null, net.fetcher), /不可用/)
  }
  const pages = [[release(next), ...Array.from({ length: 99 }, () => ({ ...release(next), tag_name: 'android-v2.0.6' }))]]
  const net = network([next], { pages, overrides: new Map([[`${api}/releases?per_page=100&page=2`, new Response('rate limit', { status: 403 })]]) })
  await assert.rejects(checkGithubUpdate('2.0.4', windows, null, net.fetcher), /不可用/)
})

test('a primary outage or stale primary falls back to a GitHub download, with no return to the failed origin', async () => {
  const next = manifest()
  for (const primary of [undefined, manifest('2.0.4')]) {
    const net = network([next], { primary })
    const result = await checkDesktopUpdate('2.0.4', { platform: 'win32', arch: 'x64', fetcher: net.fetcher })
    assert.equal(result.url, next.artifacts.installer.fallbackUrl)
  }
  const net = network([next], { primary: manifest('3.0.0', macos) })
  assert.equal((await checkDesktopUpdate('2.0.4', { platform: 'darwin', arch: 'arm64', fetcher: net.fetcher })).version, '3.0.0')
  assert.equal(net.calls.length, 1)
})

test('only the explicitly configured bridge tag is accepted by primary and GitHub', async () => {
  const bridge = manifest('2.0.5', windows, true)
  assert.deepEqual(validateMigrationPolicy({ schemaVersion: 1, bridgeVersion: null }), { schemaVersion: 1, bridgeVersion: null })
  assert.throws(() => validateMigrationPolicy({ schemaVersion: 1, bridgeVersion: 'v2.0.5' }))
  assert.throws(() => validateMigrationPolicy({ schemaVersion: 1 }))
  assert.throws(() => validateMigrationPolicy({ schemaVersion: 1, bridgeVersion: null, independentPublishingEnabled: 'true' }))
  assert.throws(() => validateDesktopManifest(bridge, windows))
  validateDesktopManifest(bridge, windows, '2.0.5')
  const net = network([bridge])
  assert.equal((await checkGithubUpdate('2.0.4', windows, '2.0.5', net.fetcher)).version, '2.0.5')
  assert.equal(await checkGithubUpdate('2.0.4', windows, '2.0.6', network([bridge]).fetcher), null)
})

test('runtime bootstrap must agree with the packaged Electron version', () => {
  const bootstrap = { version: '2.0.6', settings: {} }
  assert.equal(verifyBootstrapVersion(bootstrap, '2.0.6'), bootstrap)
  for (const value of [null, {}, { version: 'v2.0.6' }, { version: '2.0.5' }]) assert.throws(() => verifyBootstrapVersion(value, '2.0.6'), /版本不一致/)
})

test('macOS GitHub fallback cannot recommend a newer Windows or Android release', async () => {
  const mac = manifest('2.0.7', macos)
  const win = manifest('9.0.0')
  const net = network([win, mac])
  const update = await checkDesktopUpdate('2.0.5', { platform: 'darwin', arch: 'arm64', fetcher: net.fetcher })
  assert.equal(update.version, '2.0.7')
  assert.equal(update.url, mac.artifacts.dmg.fallbackUrl)
})

test('bridge to one independent Windows release leaves macOS at its bridge version', async () => {
  const bridgeVersion = '2.0.5'
  const win = manifest('2.0.6')
  const mac = manifest(bridgeVersion, macos, true)
  const sharedBridge = release(mac)
  sharedBridge.assets.push(...release(manifest(bridgeVersion, windows, true)).assets)
  const options = { records: [release(win), sharedBridge] }
  const winNet = network([win, mac], { ...options, primary: win })
  const macNet = network([win, mac], { ...options, primary: mac })
  assert.equal((await checkDesktopUpdate(bridgeVersion, { platform: 'win32', arch: 'x64', bridgeVersion, fetcher: winNet.fetcher })).version, '2.0.6')
  assert.equal(await checkDesktopUpdate(bridgeVersion, { platform: 'darwin', arch: 'arm64', bridgeVersion, fetcher: macNet.fetcher }), null)
})

test('rate limiting while reading a candidate manifest aborts rather than hiding a newer version', async () => {
  const next = manifest('2.0.9')
  const lower = manifest('2.0.6')
  const net = network([next, lower], { overrides: new Map([[`${github}/${next.tag}/update-windows-x64.json`, new Response('rate limit', { status: 403 })]]) })
  await assert.rejects(checkGithubUpdate('2.0.4', windows, null, net.fetcher), /不可用/)
  assert.ok(!net.calls.some(url => url.includes(`${lower.tag}/update-`)))
})
