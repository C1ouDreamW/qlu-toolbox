import type { Announcement, AvailableUpdate, CurrentAppVersion, UpdateManifest } from './types'
import { androidReleaseTag, androidUpdateSources, validateAndroidManifest } from '../../../../electron/android-update-contract.mjs'
import { assertChannelVersion, compareChannelVersions } from '../../../../electron/version-contract.mjs'
import { GITHUB_REPOSITORY, isArtifactUrl, UPDATE_ORIGIN } from '../../../../electron/update-contract.mjs'
import { buildInformation } from '../build-info'

export const ANNOUNCEMENT_URL = `${UPDATE_ORIGIN}/${buildInformation.channel}/announcement.json`

const REQUEST_TIMEOUT_MS = 10_000

/** 拉取服务器公告；无公告（404/过期/网络失败）一律返回 null，调用方无需报错。 */
export async function fetchAnnouncement(): Promise<Announcement | null> {
  if (buildInformation.channel === 'debug') return null
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(ANNOUNCEMENT_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const item = await response.json() as Record<string, unknown>
    if (item.schemaVersion !== 1 || typeof item.id !== 'string' || !item.id.trim() ||
        typeof item.title !== 'string' || !item.title.trim() || typeof item.body !== 'string') return null
    if (typeof item.expiresAt === 'string' && Number.isFinite(Date.parse(item.expiresAt)) &&
        Date.parse(item.expiresAt) < Date.now()) return null
    let url: string | undefined
    if (typeof item.url === 'string') {
      try { url = new URL(item.url).protocol === 'https:' ? item.url : undefined } catch { url = undefined }
    }
    return {
      id: item.id,
      title: item.title,
      body: item.body,
      level: item.level === 'warning' ? 'warning' : 'info',
      url,
      expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : undefined,
    }
  } catch { return null }
  finally { window.clearTimeout(timeout) }
}

export async function findAvailableUpdate(current: CurrentAppVersion): Promise<AvailableUpdate | null> {
  if (!buildInformation.updatesEnabled || buildInformation.channel === 'debug') throw new Error('Debug 版本不提供在线更新')
  if (current.applicationId !== buildInformation.applicationId || current.channel !== buildInformation.channel ||
      current.versionName !== buildInformation.version || !Number.isSafeInteger(current.versionCode) || current.versionCode < 1) {
    throw new Error(`当前应用 ID 不受更新器支持：${current.applicationId}`)
  }

  assertChannelVersion(current.versionName, buildInformation.channel)
  const sources = androidUpdateSources(buildInformation.channel)
  const results = await Promise.allSettled([...sources.map(fetchManifest), fetchGithubManifest(current)])
  for (const result of results) if (result.status === 'rejected' && result.reason instanceof ManifestConflict) throw result.reason
  const candidates = results.flatMap((result, index) => result.status === 'fulfilled' && result.value
    ? [{ ...result.value, source: sources[index] ?? 'GitHub Releases' }]
    : [])

  if (!candidates.length) {
    const reasons = results.flatMap(result => result.status === 'rejected' ? [errorMessage(result.reason)] : [])
    throw new Error(`无法读取更新清单${reasons.length ? `：${reasons.join('；')}` : ''}`)
  }

  for (const code of new Set(candidates.map(item => item.versionCode))) {
    const sameCode = candidates.filter(item => item.versionCode === code)
    if (new Set(sameCode.map(item => `${item.versionName}:${item.sha256}:${item.size}`)).size > 1) throw new ManifestConflict(`更新清单冲突：versionCode ${code} 对应多个不同的 APK`)
  }
  if (candidates.some(item => item.versionCode > current.versionCode && compareChannelVersions(item.versionName, current.versionName, buildInformation.channel) <= 0)) throw new Error('更新清单的版本与 code 顺序不一致')
  const newer = candidates.filter(item => item.versionCode > current.versionCode && compareChannelVersions(item.versionName, current.versionName, buildInformation.channel) > 0)
  if (!newer.length) {
    if (results.some(result => result.status === 'rejected')) throw new Error('部分更新源不可用，无法确认已是最新版本')
    return null
  }
  const highestVersionCode = Math.max(...newer.map(item => item.versionCode))
  const highest = newer.filter(item => item.versionCode === highestVersionCode)
  const hashes = new Set(highest.map(item => `${item.versionName}:${item.sha256.toLowerCase()}:${item.size}`))
  if (hashes.size > 1) {
    throw new Error(`更新清单冲突：versionCode ${highestVersionCode} 对应多个不同的 APK`)
  }

  const selected = highest[0]
  return { ...selected, fallbackApkUrls: [...new Set(highest.map(item => item.apkUrl))].filter(url => url !== selected.apkUrl) }
}

async function fetchManifest(url: string): Promise<UpdateManifest> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${shortSource(url)} 返回 HTTP ${response.status}`)
    return validateManifest(await response.json(), url)
  } finally {
    window.clearTimeout(timeout)
  }
}

function validateManifest(value: unknown, source: string): UpdateManifest {
  try { return validateAndroidManifest(value, buildInformation.channel) as UpdateManifest }
  catch (error) { throw new Error(`${shortSource(source)}：${errorMessage(error)}`) }
}

class GithubUnavailable extends Error {}
class ManifestConflict extends Error {}

type GithubAsset = { name: string; browser_download_url: string; size: number; state: string; digest?: string | null }
type GithubRelease = { tag_name: string; draft: boolean; prerelease: boolean; assets: GithubAsset[] }

async function githubJson(url: string): Promise<{ value: unknown; response: Response }> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal })
    if (!response.ok) throw new GithubUnavailable(`GitHub 更新检查不可用（${response.status}）`)
    return { value: await response.json(), response }
  } finally { window.clearTimeout(timeout) }
}

async function fetchGithubManifest(current: CurrentAppVersion): Promise<UpdateManifest | null> {
  const channel = buildInformation.channel
  if (channel === 'debug') throw new Error('Debug 版本不提供在线更新')
  const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`
  const candidates: GithubRelease[] = []
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('GitHub 发布列表过长，无法完成更新检查')
    const { value, response } = await githubJson(`${api}/releases?per_page=100&page=${page}`)
    if (!Array.isArray(value)) throw new Error('GitHub 发布列表无效')
    for (const item of value) {
      if (!item || item.draft !== false || item.prerelease !== (channel === 'alpha') || typeof item.tag_name !== 'string') continue
      const prefix = channel === 'alpha' ? 'android-alpha-v' : 'android-v'
      if (!item.tag_name.startsWith(prefix)) continue
      try {
        const version = assertChannelVersion(item.tag_name.slice(prefix.length), channel)
        if (compareChannelVersions(version, current.versionName, channel) > 0) candidates.push(item)
      } catch { /* Another tag format is outside this channel. */ }
    }
    if (value.length < 100 && !response.headers.get('link')?.includes('rel="next"')) break
  }
  const manifests: UpdateManifest[] = []
  const errors: string[] = []
  for (const release of candidates) {
    try {
      const assets = release.assets
      if (!Array.isArray(assets)) throw new Error('GitHub 发布缺少资产列表')
      const found = assets.filter(asset => asset.name === 'update-android.json')
      if (found.length !== 1 || !isArtifactUrl(found[0].browser_download_url, release.tag_name, 'update-android.json', true)) throw new Error('GitHub 发布缺少 Android 清单')
      const manifest = validateManifest((await githubJson(found[0].browser_download_url)).value, 'GitHub')
      if (androidReleaseTag(manifest.versionName, channel) !== release.tag_name || manifest.tag !== release.tag_name ||
          typeof manifest.commit !== 'string' || !/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error('GitHub 清单与发布标签不一致')
      const commit = (await githubJson(`${api}/commits/${encodeURIComponent(release.tag_name)}`)).value as { sha?: unknown } | null
      if (commit?.sha !== manifest.commit) throw new Error('GitHub 清单与标签 commit 不一致')
      const packages = assets.filter(asset => asset.browser_download_url === manifest.apkUrl)
      if (!isArtifactUrl(manifest.apkUrl, release.tag_name, manifest.apkUrl.split('/').pop()!, true) || packages.length !== 1 ||
          packages[0].size !== manifest.size || packages[0].state !== 'uploaded' ||
          (packages[0].digest != null && packages[0].digest !== `sha256:${manifest.sha256}`)) throw new Error('GitHub APK 资产与清单不一致')
      if (manifest.versionCode <= current.versionCode) throw new Error('GitHub 更新版本 code 未递增')
      manifests.push(manifest)
    } catch (error) {
      if (error instanceof GithubUnavailable) throw error
      errors.push(errorMessage(error))
    }
  }
  if (!manifests.length && errors.length) throw new Error(`没有可核验的 Android 更新：${errors[0]}`)
  if (!manifests.length) return null
  const code = Math.max(...manifests.map(item => item.versionCode))
  const highest = manifests.filter(item => item.versionCode === code)
  if (new Set(highest.map(item => `${item.versionName}:${item.sha256}:${item.size}`)).size > 1) throw new ManifestConflict('GitHub APK 更新清单冲突')
  return highest[0]
}

function shortSource(value: string): string {
  try { return new URL(value).pathname.split('/').filter(Boolean)[1] || value }
  catch { return value }
}

function errorMessage(value: unknown): string {
  if (value instanceof DOMException && value.name === 'AbortError') return '请求超时'
  return value instanceof Error ? value.message : String(value)
}
