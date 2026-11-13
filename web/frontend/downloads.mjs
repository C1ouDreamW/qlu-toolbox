const UPDATE_ORIGIN = 'https://updates.lumatile.cn'
const LEGACY_ORIGIN = 'https://lumatile.ishua.cloud'
const REPO_PATH = '/C1ouDreamW/qlu-toolbox/releases/download/'

export const MANIFEST_URLS = {
  android: `${UPDATE_ORIGIN}/stable/android.json`,
  distribution: `${UPDATE_ORIGIN}/android/distribution.json`,
}

function downloadUrl(value, extension) {
  const url = new URL(value)
  const trusted = [UPDATE_ORIGIN, LEGACY_ORIGIN].includes(url.origin) && url.pathname.startsWith('/releases/')
    || url.origin === 'https://github.com' && url.pathname.startsWith(REPO_PATH)
  if (!trusted || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(extension)) {
    throw new Error('安装包下载地址无效')
  }
  return url.href
}

export function readDownload(platform, manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error('不支持的更新清单')
  const version = platform === 'android' ? manifest.versionName : manifest.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本号无效')
  if (platform === 'android') {
    if (manifest.applicationId !== 'io.github.c1oudreamw.lumatile'
      || !Number.isSafeInteger(manifest.size) || manifest.size <= 0
      || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
      throw new Error('Android 更新清单无效')
    }
    return { version, url: downloadUrl(manifest.apkUrl, '.apk'), size: manifest.size }
  }
  if (platform !== 'windows' && platform !== 'mac') throw new Error('平台无效')
  return { version, url: downloadUrl(manifest.downloads?.[platform === 'windows' ? 'win32' : 'darwin'], platform === 'windows' ? '.exe' : '.dmg') }
}

export async function fetchManifest(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
    if (!response.ok) throw new Error('更新源暂时不可用')
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function loadAndroidDownload() {
  try {
    const policy = await fetchManifest(MANIFEST_URLS.distribution)
    if (policy?.mode !== 'server') return null
    const download = readDownload('android', await fetchManifest(MANIFEST_URLS.android))
    if (download.url.startsWith(`${LEGACY_ORIGIN}/releases/`)) {
      download.url = UPDATE_ORIGIN + download.url.slice(LEGACY_ORIGIN.length)
    }
    return download
  } catch {
    return null
  }
}
