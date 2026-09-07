import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { AvailableUpdate, CurrentAppVersion, UpdateDownloadProgress } from './types'

interface NativeAppUpdatePlugin {
  getCurrentVersion(): Promise<CurrentAppVersion>
  canInstallPackages(): Promise<{ allowed: boolean }>
  openInstallPermissionSettings(): Promise<void>
  downloadAndInstall(options: Pick<AvailableUpdate, 'apkUrl' | 'sha256' | 'size' | 'versionCode'>): Promise<{ ready: boolean }>
  addListener(eventName: 'updateDownloadProgress', listener: (event: UpdateDownloadProgress) => void): Promise<PluginListenerHandle>
}

const nativePlugin = registerPlugin<NativeAppUpdatePlugin>('AppUpdate')

export const appUpdate = {
  isNativeAndroid: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  getCurrentVersion: () => nativePlugin.getCurrentVersion(),
  canInstallPackages: async () => (await nativePlugin.canInstallPackages()).allowed,
  openInstallPermissionSettings: () => nativePlugin.openInstallPermissionSettings(),
  downloadAndInstall: async (update: AvailableUpdate) => {
    const urls = [update.apkUrl, ...(update.fallbackApkUrls || [])]
    for (let index = 0; index < urls.length; index++) {
      try {
        return await nativePlugin.downloadAndInstall({
          apkUrl: urls[index], sha256: update.sha256, size: update.size, versionCode: update.versionCode,
        })
      } catch (error) {
        const code = (error as { code?: string })?.code
        if (index === urls.length - 1 || !['UPDATE_HTTP_ERROR', 'UPDATE_DOWNLOAD_FAILED', 'INVALID_REDIRECT'].includes(code || '')) throw error
      }
    }
    throw new Error('没有可用的更新下载地址')
  },
  onProgress: (listener: (event: UpdateDownloadProgress) => void) => nativePlugin.addListener('updateDownloadProgress', listener),
}
