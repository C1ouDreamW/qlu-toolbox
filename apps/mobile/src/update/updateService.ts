import type { AvailableUpdate, CurrentAppVersion, UpdateManifest } from './types'
import { UPDATE_APPLICATION_ID } from './types'

export const UPDATE_MANIFEST_URLS = [
  'https://raw.githubusercontent.com/C1ouDreamW/qlu-toolbox/main/updates/android.json',
  'https://raw.githubusercontent.com/C1ouDreamW/lumatile/main/updates/android.json',
] as const

const REQUEST_TIMEOUT_MS = 10_000

export async function findAvailableUpdate(current: CurrentAppVersion): Promise<AvailableUpdate | null> {
  if (current.applicationId !== UPDATE_APPLICATION_ID) {
    throw new Error(`当前应用 ID 不受更新器支持：${current.applicationId}`)
  }

  const results = await Promise.allSettled(UPDATE_MANIFEST_URLS.map(fetchManifest))
  const candidates = results.flatMap((result, index) => result.status === 'fulfilled'
    ? [{ ...result.value, source: UPDATE_MANIFEST_URLS[index] }]
    : [])

  if (!candidates.length) {
    const reasons = results.flatMap(result => result.status === 'rejected' ? [errorMessage(result.reason)] : [])
    throw new Error(`无法读取更新清单${reasons.length ? `：${reasons.join('；')}` : ''}`)
  }

  const newer = candidates.filter(item => item.versionCode > current.versionCode)
  if (!newer.length) return null
  const highestVersionCode = Math.max(...newer.map(item => item.versionCode))
  const highest = newer.filter(item => item.versionCode === highestVersionCode)
  const hashes = new Set(highest.map(item => item.sha256.toLowerCase()))
  if (hashes.size > 1) {
    throw new Error(`更新清单冲突：versionCode ${highestVersionCode} 对应多个不同的 APK`)
  }

  return highest.at(-1) ?? null
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
  if (!value || typeof value !== 'object') throw new Error(`${shortSource(source)} 内容不是 JSON 对象`)
  const item = value as Record<string, unknown>
  if (item.schemaVersion !== 1) throw new Error(`${shortSource(source)} 使用了不支持的清单版本`)
  if (item.applicationId !== UPDATE_APPLICATION_ID) throw new Error(`${shortSource(source)} 的 applicationId 不匹配`)
  if (!Number.isSafeInteger(item.versionCode) || Number(item.versionCode) <= 0) throw new Error(`${shortSource(source)} 的 versionCode 无效`)
  if (typeof item.versionName !== 'string' || !item.versionName.trim()) throw new Error(`${shortSource(source)} 的 versionName 无效`)
  if (item.channel !== 'stable' && item.channel !== 'beta') throw new Error(`${shortSource(source)} 的 channel 无效`)
  if (typeof item.title !== 'string' || typeof item.notes !== 'string') throw new Error(`${shortSource(source)} 的更新文案无效`)
  if (typeof item.publishedAt !== 'string' || Number.isNaN(Date.parse(item.publishedAt))) throw new Error(`${shortSource(source)} 的发布时间无效`)
  if (typeof item.apkUrl !== 'string' || !isAllowedApkUrl(item.apkUrl)) throw new Error(`${shortSource(source)} 的 APK 地址不受信任`)
  if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.sha256)) throw new Error(`${shortSource(source)} 的 SHA-256 无效`)
  if (!Number.isSafeInteger(item.size) || Number(item.size) <= 0) throw new Error(`${shortSource(source)} 的 APK 大小无效`)
  if (typeof item.mandatory !== 'boolean') throw new Error(`${shortSource(source)} 的 mandatory 无效`)
  return item as unknown as UpdateManifest
}

function isAllowedApkUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    if (url.hostname !== 'github.com') return false
    return url.pathname.startsWith('/C1ouDreamW/qlu-toolbox/releases/download/') ||
      url.pathname.startsWith('/C1ouDreamW/lumatile/releases/download/')
  } catch {
    return false
  }
}

function shortSource(value: string): string {
  try { return new URL(value).pathname.split('/').filter(Boolean)[1] || value }
  catch { return value }
}

function errorMessage(value: unknown): string {
  if (value instanceof DOMException && value.name === 'AbortError') return '请求超时'
  return value instanceof Error ? value.message : String(value)
}
