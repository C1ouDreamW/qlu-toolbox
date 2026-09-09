import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonBridge } from './bridge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bridge = new PythonBridge()
let mainWindow: BrowserWindow | null = null
const UPDATE_MANIFEST_URL = 'https://lumatile.ishua.cloud/stable/desktop.json'
const ANNOUNCEMENT_URL = 'https://lumatile.ishua.cloud/stable/announcement.json'
const STATS_BEACON_URL = 'https://lumatile.ishua.cloud/beacon/desktop'
const FEEDBACK_URL = 'https://lumatile.ishua.cloud/api/feedback'

function isNewerVersion(candidate: string, current: string) {
  const numeric = (value: string) => value.replace(/^v/, '').split('-')[0].split('.').map(Number)
  const [a, b] = [numeric(candidate), numeric(current)]
  return a.some((part, i) => part > (b[i] || 0) && a.slice(0, i).every((value, j) => value === (b[j] || 0)))
}

function isTrustedUpdateUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    if (url.hostname === 'lumatile.ishua.cloud') return url.pathname.startsWith('/releases/')
    return url.hostname === 'github.com' && (
      url.pathname.startsWith('/C1ouDreamW/qlu-toolbox/releases/') ||
      url.pathname.startsWith('/C1ouDreamW/lumatile/releases/')
    )
  } catch {
    return false
  }
}

async function checkSelfHostedUpdate(currentVersion: string) {
  const response = await fetch(UPDATE_MANIFEST_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'LumaTile-UpdateChecker' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`更新源返回 ${response.status}`)
  const item = await response.json() as Record<string, unknown>
  const downloads = item.downloads as Record<string, unknown> | undefined
  const url = downloads?.[process.platform]
  if (item.schemaVersion !== 1 || typeof item.version !== 'string' || typeof item.name !== 'string' ||
      typeof item.notes !== 'string' || typeof url !== 'string' || !isTrustedUpdateUrl(url)) {
    throw new Error('更新清单无效')
  }
  return isNewerVersion(item.version, currentVersion)
    ? { version: item.version, name: item.name, notes: item.notes, url }
    : null
}

async function checkGithubUpdate(currentVersion: string) {
  const response = await fetch('https://api.github.com/repos/C1ouDreamW/qlu-toolbox/releases?per_page=20', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LumaTile-UpdateChecker' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
  const releases = await response.json() as Array<Record<string, unknown>>
  const currentPrerelease = currentVersion.includes('-')
  const latest = releases.find(item => !item.draft && (currentPrerelease || !item.prerelease))
  if (!latest || !isNewerVersion(String(latest.tag_name || ''), currentVersion)) return null
  const url = String(latest.html_url || '')
  if (!isTrustedUpdateUrl(url)) throw new Error('GitHub 更新地址无效')
  return { version: String(latest.tag_name), name: String(latest.name || ''), notes: String(latest.body || ''), url }
}

async function loadInstallId(): Promise<string> {
  const file = path.join(app.getPath('userData'), 'stats-client.json')
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { installId?: unknown }
    if (typeof raw.installId === 'string' && raw.installId) return raw.installId
  } catch { /* 首次生成 */ }
  const installId = randomUUID()
  try {
    await writeFile(file, JSON.stringify({ installId }, null, 2), 'utf8')
  } catch { /* 写入失败则本轮使用一次性随机 id */ }
  return installId
}

async function sendStatsBeacon() {
  try {
    const url = new URL(STATS_BEACON_URL)
    url.searchParams.set('v', app.getVersion())
    url.searchParams.set('os', process.platform)
    url.searchParams.set('arch', process.arch)
    url.searchParams.set('id', await loadInstallId())
    await fetch(url, {
      headers: { 'User-Agent': 'LumaTile-Stats' },
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* 统计上报失败静默，不影响使用 */ }
}

async function fetchAnnouncement() {
  try {
    const response = await fetch(ANNOUNCEMENT_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'LumaTile-Announcement' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    const item = await response.json() as Record<string, unknown>
    if (item.schemaVersion !== 1 || typeof item.id !== 'string' || typeof item.title !== 'string' ||
        typeof item.body !== 'string') return null
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
      level: item.level === 'warning' ? 'warning' as const : 'info' as const,
      url,
      expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : undefined,
    }
  } catch { /* 公告拉取失败静默 */ }
}

async function submitFeedback(payload: { type?: unknown; content?: unknown; contact?: unknown }) {
  const type = payload.type
  const content = typeof payload.content === 'string' ? payload.content.trim() : ''
  const contact = typeof payload.contact === 'string' ? payload.contact.trim() : ''
  if (!['bug', 'suggestion'].includes(String(type)) || content.length < 2 || content.length > 2000 || contact.length > 120) {
    throw new Error('请检查反馈内容后重试')
  }
  const response = await fetch(FEEDBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LumaTile-Feedback' },
    body: JSON.stringify({
      type, content, contact, platform: 'desktop', appVersion: app.getVersion(),
      systemVersion: `${process.platform} ${release()} · ${process.arch}`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const result = await response.json().catch(() => ({})) as { id?: unknown; error?: unknown }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `反馈服务返回 ${response.status}`)
  if (typeof result.id !== 'string') throw new Error('反馈服务响应无效')
  return { id: result.id }
}

// 与 src/styles.css 中两套主题的 --bg 保持一致，避免窗口原生背景与页面底色出现色差。
const WINDOW_BACKGROUND = { light: '#f3f6fb', dark: '#0f1420' } as const

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 790,
    minWidth: 980,
    minHeight: 650,
    frame: isMac,
    ...(isMac ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 14, y: 12 },
    } : {}),
    show: false,
    backgroundColor: windowBackgroundColor(),
    icon: path.join(
      app.getAppPath(),
      'assets',
      process.platform === 'win32' ? 'qlu-toolbox.ico' : 'qlu-toolbox.png',
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'))
}

function registerIpc() {
  ipcMain.handle('bridge:invoke', (_event, method: string, params = {}) => bridge.invoke(method, params))
  ipcMain.on('theme:sync', (_event, theme: string) => {
    if (theme === 'light' || theme === 'dark' || theme === 'system') nativeTheme.themeSource = theme
  })
  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(windowBackgroundColor())
  })
  ipcMain.handle('system:select-directory', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择保存位置', defaultPath, properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('system:select-file', async (_event, options?: string | {
    title?: string; defaultPath?: string; filterName?: string; extensions?: string[]
  }) => {
    const opts = typeof options === 'string' ? { defaultPath: options } : options ?? {}
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: opts.title || '选择文件',
      defaultPath: opts.defaultPath,
      properties: ['openFile'],
      filters: [{ name: opts.filterName || '所有文件', extensions: opts.extensions || ['*'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('system:save-text-file', async (_event, options: { defaultName?: string; title?: string; contents: string }) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: options.title || '保存文件',
      defaultPath: options.defaultName,
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, options.contents, 'utf8')
    return result.filePath
  })
  ipcMain.handle('system:open-path', async (_event, target: string) => shell.openPath(target))
  ipcMain.handle('system:show-item', (_event, target: string) => shell.showItemInFolder(target))
  ipcMain.handle('system:copy-text', (_event, value: string) => clipboard.writeText(value))
  ipcMain.handle('system:open-external', async (_event, url: string) => {
    const parsed = new URL(url)
    if (!['https:', 'mailto:'].includes(parsed.protocol)) throw new Error('不允许打开此链接')
    await shell.openExternal(url)
  })
  ipcMain.handle('system:check-update', async (_event, currentVersion: string) => {
    try {
      const primary = await checkSelfHostedUpdate(currentVersion)
      if (primary) return primary
    } catch { return checkGithubUpdate(currentVersion) }
    // A stale but reachable mirror must not hide a published GitHub update.
    return checkGithubUpdate(currentVersion)
  })
  ipcMain.handle('system:send-stats-beacon', () => sendStatsBeacon())
  ipcMain.handle('system:fetch-announcement', () => fetchAnnouncement())
  ipcMain.handle('system:submit-feedback', (_event, payload) => submitFeedback(payload ?? {}))
  ipcMain.on('window:action', (_event, action: string) => {
    if (action === 'minimize') mainWindow?.minimize()
    else if (action === 'maximize') mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
    else if (action === 'close') mainWindow?.close()
  })
}

const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(() => {
    registerIpc()
    bridge.onEvent = (name, payload) => mainWindow?.webContents.send('bridge:event', name, payload)
    bridge.start()
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => bridge.stop())
}
