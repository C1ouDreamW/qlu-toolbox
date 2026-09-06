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
  selectFile: (options?: string | { title?: string; defaultPath?: string; filterName?: string; extensions?: string[] }) =>
    ipcRenderer.invoke('system:select-file', options),
  saveTextFile: (options: { defaultName?: string; title?: string; contents: string }) =>
    ipcRenderer.invoke('system:save-text-file', options),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  openPath: (target: string) => ipcRenderer.invoke('system:open-path', target),
  showItem: (target: string) => ipcRenderer.invoke('system:show-item', target),
  copyText: (value: string) => ipcRenderer.invoke('system:copy-text', value),
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
  checkUpdate: (currentVersion: string) => ipcRenderer.invoke('system:check-update', currentVersion),
  sendStatsBeacon: () => ipcRenderer.invoke('system:send-stats-beacon'),
  fetchAnnouncement: () => ipcRenderer.invoke('system:fetch-announcement'),
  submitFeedback: (payload: { type: 'bug' | 'suggestion'; content: string; contact: string }) =>
    ipcRenderer.invoke('system:submit-feedback', payload),
  windowAction: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send('window:action', action),
})
