import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonBridge } from './bridge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bridge = new PythonBridge()
let mainWindow: BrowserWindow | null = null
const UPDATE_MANIFEST_URL = 'https://lumatile.ishua.cloud/stable/desktop.json'

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
    backgroundColor: '#f4f7fb',
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
  ipcMain.handle('system:select-directory', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择保存位置', defaultPath, properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('system:select-file', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择分项成绩文件', defaultPath, properties: ['openFile'],
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    })
    return result.canceled ? null : result.filePaths[0]
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
    try { return await checkSelfHostedUpdate(currentVersion) }
    catch { return checkGithubUpdate(currentVersion) }
  })
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
