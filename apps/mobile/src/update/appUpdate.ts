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
  downloadAndInstall: (update: AvailableUpdate) => nativePlugin.downloadAndInstall({
    apkUrl: update.apkUrl,
    sha256: update.sha256,
    size: update.size,
    versionCode: update.versionCode,
  }),
  onProgress: (listener: (event: UpdateDownloadProgress) => void) => nativePlugin.addListener('updateDownloadProgress', listener),
}
