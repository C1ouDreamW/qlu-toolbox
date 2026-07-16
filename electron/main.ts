import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonBridge } from './bridge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bridge = new PythonBridge()
let mainWindow: BrowserWindow | null = null

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
    const response = await fetch('https://api.github.com/repos/C1ouDreamW/qlu-toolbox/releases?per_page=20', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'QLUToolbox-UpdateChecker' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
    const releases = await response.json() as Array<Record<string, unknown>>
    const currentPrerelease = currentVersion.includes('-')
    const candidates = releases.filter((item) => !item.draft && (currentPrerelease || !item.prerelease))
    const latest = candidates[0]
    if (!latest) return null
    const tag = String(latest.tag_name || '').replace(/^v/, '')
    const numeric = (value: string) => value.split('-')[0].split('.').map(Number)
    const [a, b] = [numeric(tag), numeric(currentVersion)]
    const newer = a.some((part, i) => part > (b[i] || 0) && a.slice(0, i).every((v, j) => v === (b[j] || 0)))
    return newer ? { version: String(latest.tag_name), name: latest.name, notes: latest.body, url: latest.html_url } : null
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
