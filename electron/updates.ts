import {
  assertStableVersion, compareVersions, desktopTagVersion, desktopTarget, GITHUB_REPOSITORY,
  isArtifactUrl, UPDATE_ORIGIN, validateDesktopManifest,
  type DesktopTarget, type DesktopManifest,
} from './update-contract.mjs'

type Fetcher = typeof fetch
type UpdateInfo = { version: string; name: string; notes: string; url: string }
type Asset = { name: string; browser_download_url: string; size: number; digest?: string; state?: string }
type Release = { tag_name: string; draft: boolean; prerelease: boolean; assets: Asset[] }
type Options = { platform: string; arch: string; bridgeVersion?: string | null; fetcher?: Fetcher }

const apiRoot = `https://api.github.com/repos/${GITHUB_REPOSITORY}`

class GithubUnavailable extends Error {}

async function jsonRequest(url: string, fetcher: Fetcher, github = false) {
  const response = await fetcher(url, {
    headers: { Accept: github ? 'application/vnd.github+json' : 'application/json', 'User-Agent': 'LumaTile-UpdateChecker' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    if (github && (response.status === 403 || response.status === 429 || response.status >= 500)) {
      throw new GithubUnavailable(`GitHub 更新检查不可用（${response.status}）`)
    }
    throw new Error(`更新源返回 ${response.status}`)
  }
  return { value: await response.json() as unknown, response }
}

function updateInfo(manifest: DesktopManifest, target: DesktopTarget, github = false): UpdateInfo {
  const artifact = manifest.artifacts[target.primary]
  return { version: manifest.version, name: manifest.name, notes: manifest.notes, url: github ? artifact.fallbackUrl : artifact.url }
}

export async function checkSelfHostedUpdate(current: string, target: DesktopTarget, bridgeVersion: string | null, fetcher: Fetcher = fetch) {
  assertStableVersion(current)
  const { value } = await jsonRequest(`${UPDATE_ORIGIN}/stable/${target.id}.json`, fetcher)
  const manifest = validateDesktopManifest(value, target, bridgeVersion)
  return compareVersions(manifest.version, current) > 0 ? updateInfo(manifest, target) : null
}

export async function checkGithubUpdate(current: string, target: DesktopTarget, bridgeVersion: string | null, fetcher: Fetcher = fetch) {
  assertStableVersion(current)
  const candidates: Array<{ release: Release; version: string }> = []
  // Do not infer a complete list from the first page or from publication time.
  for (let page = 1; ; page++) {
    if (page > 100) throw new GithubUnavailable('GitHub 发布列表过长，无法完成更新检查')
    const { value, response } = await jsonRequest(`${apiRoot}/releases?per_page=100&page=${page}`, fetcher, true)
    if (!Array.isArray(value)) throw new GithubUnavailable('GitHub 发布列表无效')
    for (const item of value) {
      if (!item || typeof item !== 'object' || item.draft !== false || item.prerelease !== false) continue
      const version = desktopTagVersion(item.tag_name, target, bridgeVersion)
      if (version && compareVersions(version, current) > 0) candidates.push({ release: item as Release, version })
    }
    if (!response.headers.get('link')?.includes('rel="next"') && value.length < 100) break
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version))
  const errors: string[] = []
  for (const { release, version } of candidates) {
    try {
      if (!Array.isArray(release.assets)) throw new Error('GitHub 发布缺少资产列表')
      const manifestName = `update-${target.id}.json`
      const matching = release.assets.filter(asset => asset.name === manifestName)
      if (matching.length !== 1 || !isArtifactUrl(matching[0].browser_download_url, release.tag_name, manifestName, true)) {
        throw new Error('GitHub 发布缺少本架构清单')
      }
      const { value } = await jsonRequest(matching[0].browser_download_url, fetcher, true)
      const manifest = validateDesktopManifest(value, target, bridgeVersion)
      if (manifest.tag !== release.tag_name || manifest.version !== version) throw new Error('GitHub 清单与发布标签不一致')
      const commit = (await jsonRequest(`${apiRoot}/commits/${encodeURIComponent(release.tag_name)}`, fetcher, true)).value as { sha?: unknown } | null
      if (commit?.sha !== manifest.commit) throw new Error('GitHub 清单与标签 commit 不一致')
      for (const artifact of Object.values(manifest.artifacts)) {
        const assets = release.assets.filter(asset => asset.browser_download_url === artifact.fallbackUrl)
        if (assets.length !== 1 || assets[0].size !== artifact.size ||
            (assets[0].state !== undefined && assets[0].state !== 'uploaded') ||
            (assets[0].digest !== undefined && assets[0].digest !== null && assets[0].digest !== `sha256:${artifact.sha256}`)) {
          throw new Error('GitHub 清单与安装包资产不一致')
        }
      }
      return updateInfo(manifest, target, true)
    } catch (error) {
      if (error instanceof GithubUnavailable) throw error
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (errors.length) throw new Error(`没有可核验的本平台更新：${errors[0]}`)
  return null
}

export async function checkDesktopUpdate(current: string, options: Options) {
  assertStableVersion(current)
  const target = desktopTarget(options.platform, options.arch)
  const bridgeVersion = options.bridgeVersion ?? null
  const fetcher = options.fetcher ?? fetch
  try {
    const primary = await checkSelfHostedUpdate(current, target, bridgeVersion, fetcher)
    if (primary) return primary
  } catch { /* An invalid or unavailable primary must still reach GitHub. */ }
  // A stale but reachable mirror must not hide a published GitHub update.
  return checkGithubUpdate(current, target, bridgeVersion, fetcher)
}

export function verifyBootstrapVersion(value: unknown, expected: string) {
  assertStableVersion(expected)
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== expected) {
    throw new Error('桌面程序与本地服务版本不一致，请重新安装完整的本平台安装包')
  }
  return value
}
