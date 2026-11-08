const UPDATE_ORIGIN = 'https://lumatile.ishua.cloud'
const REPO_PATH = '/C1ouDreamW/qlu-toolbox/releases/download/'

export const MANIFEST_URLS = {
  android: `${UPDATE_ORIGIN}/stable/android.json`,
  desktop: `${UPDATE_ORIGIN}/stable/desktop.json`,
}

function downloadUrl(value, extension) {
  const url = new URL(value)
  const trusted = url.origin === UPDATE_ORIGIN && url.pathname.startsWith('/releases/')
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
    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache', credentials: 'omit' })
    if (!response.ok) throw new Error('更新源暂时不可用')
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}
