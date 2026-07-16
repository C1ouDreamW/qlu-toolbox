const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron')

contextBridge.exposeInMainWorld('qlu', {
  platform: process.platform,
  invoke: (method: string, params?: Record<string, unknown>) => ipcRenderer.invoke('bridge:invoke', method, params),
  onEvent: (callback: (name: string, payload: unknown) => void) => {
    const listener = (_event: unknown, name: string, payload: unknown) => callback(name, payload)
    ipcRenderer.on('bridge:event', listener)
    return () => ipcRenderer.removeListener('bridge:event', listener)
  },
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('system:select-directory', defaultPath),
  selectFile: (defaultPath?: string) => ipcRenderer.invoke('system:select-file', defaultPath),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  openPath: (target: string) => ipcRenderer.invoke('system:open-path', target),
  showItem: (target: string) => ipcRenderer.invoke('system:show-item', target),
  copyText: (value: string) => ipcRenderer.invoke('system:copy-text', value),
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
  checkUpdate: (currentVersion: string) => ipcRenderer.invoke('system:check-update', currentVersion),
  windowAction: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send('window:action', action),
})
