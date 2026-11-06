// Pure release contract shared by the publisher and the desktop updater.
/** @typedef {{ platform: 'windows' | 'macos', arch: 'x64' | 'arm64', id: string, prefix: string, primary: 'installer' | 'dmg' }} DesktopTarget */
/** @typedef {{ url: string, fallbackUrl: string, sha256: string, size: number }} UpdateArtifact */
/** @typedef {{ schemaVersion: number, platform: string, arch: string, channel: string, version: string, tag: string, commit: string, name: string, notes: string, publishedAt: string, artifacts: Record<string, UpdateArtifact> }} DesktopManifest */

export const UPDATE_ORIGIN = 'https://lumatile.ishua.cloud'
export const GITHUB_REPOSITORY = 'C1ouDreamW/qlu-toolbox'
export const UPDATE_REPOSITORIES = [GITHUB_REPOSITORY, 'C1ouDreamW/lumatile']

/** @param {unknown} version @returns {string} */
export function assertStableVersion(version) {
  if (typeof version !== 'string' || version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !version.split('.').every(part => Number.isSafeInteger(Number(part)))) {
    throw new Error(`Invalid stable version: ${version}; expected major.minor.patch`)
  }
  return version
}

/** @param {string} a @param {string} b */
export function compareVersions(a, b) {
  const left = assertStableVersion(a).split('.').map(Number)
  const right = assertStableVersion(b).split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

/** @param {string} platform @param {string} arch @returns {DesktopTarget} */
export function desktopTarget(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return { platform: 'windows', arch, id: 'windows-x64', prefix: 'win-v', primary: 'installer' }
  if (platform === 'darwin' && arch === 'arm64') return { platform: 'macos', arch, id: 'macos-arm64', prefix: 'mac-v', primary: 'dmg' }
  throw new Error(`暂不支持此更新目标：${platform}/${arch}。请使用 Windows x64 或原生 macOS arm64；Rosetta 下请安装原生版本。`)
}

/** @param {unknown} value @returns {{ schemaVersion: number, bridgeVersion: string | null }} */
export function validateMigrationPolicy(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid release migration policy')
  const policy = /** @type {{ schemaVersion?: unknown, bridgeVersion?: unknown }} */ (value)
  if (policy.schemaVersion !== 1 || !Object.hasOwn(policy, 'bridgeVersion')) throw new Error('Invalid release migration policy')
  return { schemaVersion: 1, bridgeVersion: policy.bridgeVersion === null ? null : assertStableVersion(policy.bridgeVersion) }
}

/** @param {unknown} tag @param {DesktopTarget} target @param {string | null} [bridgeVersion] @returns {string | null} */
export function desktopTagVersion(tag, target, bridgeVersion = null) {
  if (typeof tag !== 'string') return null
  if (bridgeVersion !== null && tag === `v${assertStableVersion(bridgeVersion)}`) return bridgeVersion
  if (!tag.startsWith(target.prefix)) return null
  try { return assertStableVersion(tag.slice(target.prefix.length)) } catch { return null }
}

/** @param {DesktopTarget} target @param {string} version @param {boolean} [bridge] */
export function artifactFileNames(target, version, bridge = false) {
  assertStableVersion(version)
  return target.platform === 'windows'
    ? { installer: bridge ? `LumaTile_v${version}_x64_Setup.exe` : `LumaTile-Windows-v${version}-x64-Setup.exe`,
        portable: bridge ? `LumaTile_v${version}.zip` : `LumaTile-Windows-v${version}-x64.zip` }
    : { dmg: bridge ? `LumaTile_v${version}_arm64.dmg` : `LumaTile-macOS-v${version}-arm64.dmg` }
}

/** @param {unknown} value */
export function isPublicationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19)
}

/** @param {unknown} value @param {string} tag @param {string} file @param {boolean} [githubOnly] */
export function isArtifactUrl(value, tag, file, githubOnly = false) {
  if (!githubOnly && value === `${UPDATE_ORIGIN}/releases/${tag}/${file}`) return true
  return UPDATE_REPOSITORIES.some(repository => value === `https://github.com/${repository}/releases/download/${tag}/${file}`)
}

/** @param {unknown} value @param {DesktopTarget} target @param {string | null} [bridgeVersion] @returns {DesktopManifest} */
export function validateDesktopManifest(value, target, bridgeVersion = null) {
  if (!value || typeof value !== 'object') throw new Error('更新清单无效')
  const item = /** @type {DesktopManifest} */ (value)
  if (item.schemaVersion !== 2 || item.platform !== target.platform || item.arch !== target.arch || item.channel !== 'stable' ||
      desktopTagVersion(item.tag, target, bridgeVersion) !== assertStableVersion(item.version) ||
      typeof item.commit !== 'string' || !/^[a-f0-9]{40}$/.test(item.commit) ||
      typeof item.name !== 'string' || !item.name.trim() || typeof item.notes !== 'string' || !item.notes.trim() ||
      !isPublicationDate(item.publishedAt) || !item.artifacts || typeof item.artifacts !== 'object') {
    throw new Error('更新清单身份、版本或发布日期无效')
  }
  const names = artifactFileNames(target, item.version, item.tag === `v${bridgeVersion}`)
  if (!Object.hasOwn(item.artifacts, target.primary)) throw new Error('更新清单缺少本架构安装包')
  for (const [role, artifact] of Object.entries(item.artifacts)) {
    const file = /** @type {Record<string, string>} */ (names)[role]
    if (!file || !artifact || !isArtifactUrl(artifact.url, item.tag, file) || !isArtifactUrl(artifact.fallbackUrl, item.tag, file, true) ||
        typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      throw new Error(`更新清单安装包无效：${role}`)
    }
  }
  return item
}
