const STATS_BEACON_URL = 'https://lumatile.ishua.cloud/beacon/android'
const INSTALL_ID_KEY = 'installId'
const REQUEST_TIMEOUT_MS = 10_000

function createInstallId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `android-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getInstallId(): string {
  let id = localStorage.getItem(INSTALL_ID_KEY)
  if (!id) {
    id = createInstallId()
    try { localStorage.setItem(INSTALL_ID_KEY, id) } catch { /* 忽略 */ }
  }
  return id
}

/** 启动心跳：只发送随机安装编号、软件版本和平台，失败静默。 */
export async function sendStatsBeacon(version: string): Promise<void> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const url = new URL(STATS_BEACON_URL)
    url.searchParams.set('v', version)
    url.searchParams.set('os', 'android')
    url.searchParams.set('id', getInstallId())
    await fetch(url, { cache: 'no-store', signal: controller.signal })
  } catch { /* 统计上报失败静默 */ }
  finally { window.clearTimeout(timeout) }
}
