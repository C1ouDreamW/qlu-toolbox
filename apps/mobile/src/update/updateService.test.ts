import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ANDROID_UPDATE_ORIGIN, androidArtifactName, androidReleaseTag, androidUpdateSources } from '../../../../electron/android-update-contract.mjs'
const native = vi.hoisted(() => ({ downloadAndInstall: vi.fn() }))
const information = vi.hoisted(() => ({ channel: 'stable', applicationId: 'io.github.c1oudreamw.lumatile', version: '2.0.0', updatesEnabled: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: {}, registerPlugin: () => native }))
vi.mock('../build-info', () => ({ buildInformation: information }))
import { DISTRIBUTION_URL, findAvailableUpdate, isServerDistributionEnabled } from './updateService'
import { appUpdate } from './appUpdate'
import type { CurrentAppVersion, UpdateManifest } from './types'
const api = 'https://api.github.com/repos/C1ouDreamW/qlu-toolbox'
const commit = 'c'.repeat(40)
let current: CurrentAppVersion

function manifest(channel: 'stable' | 'alpha' = 'stable', version = channel === 'stable' ? '2.0.1' : '2.1.0-alpha.2', code = 11): UpdateManifest {
  const tag = androidReleaseTag(version, channel)
  return { schemaVersion: 1, applicationId: `io.github.c1oudreamw.lumatile${channel === 'alpha' ? '.alpha' : ''}`, versionCode: code,
    versionName: version, channel, title: 'update', notes: '- Fix', publishedAt: '2026-11-07T00:00:00Z',
    apkUrl: `https://lumatile.ishua.cloud/releases/${tag}/${androidArtifactName(version, channel)}`, sha256: 'a'.repeat(64), size: 100, mandatory: false, tag, commit }
}
function githubUrl(item: UpdateManifest) {
  return `https://github.com/C1ouDreamW/qlu-toolbox/releases/download/${item.tag}/${androidArtifactName(item.versionName, item.channel)}`
}
function record(item: UpdateManifest) {
  return { tag_name: item.tag, draft: false, prerelease: item.channel === 'alpha', assets: [
    { name: 'update-android.json', browser_download_url: githubUrl(item).replace(/[^/]+$/, 'update-android.json'), size: 500, state: 'uploaded' },
    { name: androidArtifactName(item.versionName, item.channel), browser_download_url: githubUrl(item), size: item.size, state: 'uploaded', digest: `sha256:${item.sha256}` },
  ] }
}
function network(routes: Map<string, unknown>) {
  const mock = vi.fn(async (url: string) => {
    const value = routes.get(String(url))
    if (value instanceof Response) return value
    return new Response(value === undefined ? 'missing' : JSON.stringify(value), { status: value === undefined ? 404 : 200 })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
function sources(item: UpdateManifest) {
  const urls = androidUpdateSources(item.channel)
  urls[0] = `${ANDROID_UPDATE_ORIGIN}/${item.channel}/android.json`
  return new Map<string, unknown>([
    ...urls.map((url, index) => [url, { ...item, apkUrl: index ? githubUrl(item) : item.apkUrl }] as [string, unknown]),
    [`${api}/releases?per_page=100&page=1`, []],
  ])
}
function alpha() {
  Object.assign(information, { channel: 'alpha', applicationId: 'io.github.c1oudreamw.lumatile.alpha', version: '2.1.0-alpha.1' })
  current = { applicationId: information.applicationId, versionName: information.version, versionCode: 10, channel: 'alpha' }
}
beforeEach(() => {
  vi.stubGlobal('window', globalThis)
  native.downloadAndInstall.mockReset()
  Object.assign(information, { channel: 'stable', applicationId: 'io.github.c1oudreamw.lumatile', version: '2.0.0', updatesEnabled: true })
  current = { applicationId: information.applicationId, versionName: information.version, versionCode: 10, channel: 'stable' }
})
afterEach(() => vi.unstubAllGlobals())
it('prefers self-hosted and retries a matching mirror only for transport failures', async () => {
  const item = manifest()
  network(sources(item))
  const update = (await findAvailableUpdate(current))!
  const primary = item.apkUrl.replace('https://lumatile.ishua.cloud', ANDROID_UPDATE_ORIGIN)
  expect(update.apkUrl).toBe(primary)
  expect(update.fallbackApkUrls).toEqual([githubUrl(item)])
  native.downloadAndInstall.mockRejectedValueOnce({ code: 'UPDATE_HTTP_ERROR' }).mockResolvedValueOnce({ ready: true })
  await appUpdate.downloadAndInstall(update)
  expect(native.downloadAndInstall.mock.calls.map(call => call[0].apkUrl)).toEqual([primary, githubUrl(item)])
  native.downloadAndInstall.mockReset().mockRejectedValue({ code: 'UPDATE_SIGNATURE_MISMATCH' })
  await expect(appUpdate.downloadAndInstall(update)).rejects.toMatchObject({ code: 'UPDATE_SIGNATURE_MISMATCH' })
  expect(native.downloadAndInstall).toHaveBeenCalledTimes(1)
})
it('rejects inconsistent APK identity across mirrors for the highest code', async () => {
  for (const change of [{ size: 200 }, { sha256: 'b'.repeat(64) }, { versionName: '2.0.2', tag: 'android-v2.0.2', apkUrl: manifest('stable', '2.0.2').apkUrl }]) {
    const item = manifest()
    network(sources(item).set(androidUpdateSources('stable')[1], { ...item, ...change }))
    await expect(findAvailableUpdate(current)).rejects.toThrow('冲突')
  }
})
it('Alpha checks only Alpha sources and never accepts Stable IDs, channels or paths', async () => {
  alpha()
  for (const change of [{ applicationId: 'io.github.c1oudreamw.lumatile' }, { channel: 'stable' }, { apkUrl: manifest().apkUrl }, { versionName: '2.1.0' }]) {
    const item = { ...manifest('alpha'), ...change }
    const routes = sources(manifest('alpha'))
    for (const url of androidUpdateSources('alpha')) routes.set(url.replace("https://lumatile.ishua.cloud", ANDROID_UPDATE_ORIGIN), item)
    const fetcher = network(routes)
    await expect(findAvailableUpdate(current)).rejects.toThrow('无法读取')
    expect(fetcher.mock.calls.some(([url]) => url.includes('/stable/') || url.endsWith('/updates/android.json'))).toBe(false)
  }
})
it('Debug and mismatched native identity fail before making network requests', async () => {
  const fetcher = network(new Map())
  await expect(findAvailableUpdate({ ...current, channel: 'alpha' })).rejects.toThrow('ID')
  Object.assign(information, { channel: 'debug', updatesEnabled: false })
  await expect(findAvailableUpdate(current)).rejects.toThrow('Debug')
  expect(fetcher).not.toHaveBeenCalled()
})
it('GitHub paginates unrelated releases, enforces prerelease and selects the highest valid Alpha code', async () => {
  alpha()
  const lower = manifest('alpha', '2.1.0-alpha.2', 12)
  const higher = manifest('alpha', '2.1.0-alpha.10', 20)
  const unrelated = Array.from({ length: 100 }, () => record(manifest('stable', '99.0.0', 999)))
  const routes = new Map<string, unknown>([
    [`${api}/releases?per_page=100&page=1`, unrelated],
    [`${api}/releases?per_page=100&page=2`, [record(lower), { ...record(higher), prerelease: false }, record(higher)]],
  ])
  for (const item of [lower, higher]) {
    routes.set(record(item).assets[0].browser_download_url, { ...item, apkUrl: githubUrl(item) })
    routes.set(`${api}/commits/${item.tag}`, { sha: commit })
  }
  const fetcher = network(routes)
  const update = (await findAvailableUpdate(current))!
  expect(update.versionName).toBe('2.1.0-alpha.10')
  expect(update.apkUrl).toBe(githubUrl(higher))
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('page=2'))).toBe(true)
})
it('rejects GitHub tag commit, size, digest, missing asset and rate limit failures', async () => {
  alpha()
  for (const fault of ['commit', 'size', 'digest', 'asset', 'rate']) {
    const item = manifest('alpha')
    const release = record(item)
    if (fault === 'size') release.assets[1].size++
    if (fault === 'digest') release.assets[1].digest = `sha256:${'b'.repeat(64)}`
    if (fault === 'asset') release.assets.pop()
    const routes = new Map<string, unknown>([
      [`${api}/releases?per_page=100&page=1`, [release]],
      [release.assets[0].browser_download_url, fault === 'rate' ? new Response('limit', { status: 403 }) : { ...item, apkUrl: githubUrl(item) }],
      [`${api}/commits/${item.tag}`, { sha: fault === 'commit' ? 'd'.repeat(40) : commit }],
    ])
    network(routes)
    await expect(findAvailableUpdate(current)).rejects.toThrow('无法读取')
  }
})
it('an unavailable later page cannot be mistaken for being current', async () => {
  const routes = sources(manifest('stable', '2.0.0', 10))
  routes.set(`${api}/releases?per_page=100&page=1`, Array.from({ length: 100 }, () => record(manifest('alpha'))))
  network(routes)
  await expect(findAvailableUpdate(current)).rejects.toThrow('无法确认')
})
it('Stable ignores a higher Alpha code in both raw manifests and GitHub prereleases', async () => {
  const item = manifest('stable', '2.0.0', 10)
  const routes = sources(item)
  routes.set(androidUpdateSources('stable')[1], manifest('alpha', '99.0.0-alpha.1', 999))
  routes.set(`${api}/releases?per_page=100&page=1`, [record(manifest('alpha', '99.0.0-alpha.1', 999))])
  network(routes)
  await expect(findAvailableUpdate(current)).rejects.toThrow('无法确认')
})
it('same-code conflicts remain errors even when they are current or a healthy mirror is available', async () => {
  const item = manifest('stable', '2.0.0', 10)
  const routes = sources(item).set(androidUpdateSources('stable')[1], { ...item, size: 999 })
  network(routes)
  await expect(findAvailableUpdate(current)).rejects.toThrow('冲突')
})
it('higher code cannot disguise a rollback in the channel version', async () => {
  network(sources(manifest('stable', '1.0.0', 12)))
  await expect(findAvailableUpdate(current)).rejects.toThrow('顺序')
})

it('allows APK checks only when the public distribution policy explicitly enables them', async () => {
  for (const [policy, expected] of [[{ mode: 'server' }, true], [{ mode: 'website' }, false], [null, false], [undefined, false]] as const) {
    network(new Map([[DISTRIBUTION_URL, policy]]))
    expect(await isServerDistributionEnabled()).toBe(expected)
  }
})
