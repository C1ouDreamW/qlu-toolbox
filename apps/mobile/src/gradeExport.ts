import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { ArtifactHandle, GradeEvent, GradeExportOptions, GradeTaskSnapshot, GradeWorkbookRows, SavedArtifact } from '@lumatile/contracts'

interface NativeGradeExportPlugin {
  start(options: GradeExportOptions): Promise<{ taskId: string }>
  cancel(options: { taskId: string }): Promise<void>
  getActiveTask(): Promise<{ task: GradeTaskSnapshot | null }>
  getTask(options: { taskId: string }): Promise<{ task: GradeTaskSnapshot | null }>
  listTasks(options?: { limit?: number }): Promise<{ tasks: GradeTaskSnapshot[] }>
  saveArtifact(options: { artifactId: string }): Promise<{ savedArtifact: SavedArtifact | null }>
  retrySave(options: { taskId: string }): Promise<{ savedArtifact: SavedArtifact | null }>
  shareArtifact(options: { artifactId: string }): Promise<void>
  openSavedArtifact(options: { taskId: string }): Promise<void>
  releaseArtifact(options: { artifactId: string }): Promise<void>
  readArtifactWorkbook(options: { artifactId: string }): Promise<{ workbook: GradeWorkbookRows }>
  pickGradeWorkbook(): Promise<{ workbook: GradeWorkbookRows | null }>
  clearLoginState(): Promise<void>
  addListener(eventName: 'gradeExportEvent', listener: (event: GradeEvent) => void): Promise<PluginListenerHandle>
}

const nativePlugin = registerPlugin<NativeGradeExportPlugin>('GradeExport')

export const gradeExport = {
  isNativeAndroid: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  start: (options: GradeExportOptions) => nativePlugin.start(options),
  cancel: (taskId: string) => nativePlugin.cancel({ taskId }),
  getActiveTask: async () => (await nativePlugin.getActiveTask()).task,
  getTask: async (taskId: string) => (await nativePlugin.getTask({ taskId })).task,
  listTasks: async (limit = 100) => (await nativePlugin.listTasks({ limit })).tasks,
  saveArtifact: async (artifactId: string) => (await nativePlugin.saveArtifact({ artifactId })).savedArtifact,
  retrySave: async (taskId: string) => (await nativePlugin.retrySave({ taskId })).savedArtifact,
  shareArtifact: (artifact: ArtifactHandle) => nativePlugin.shareArtifact({ artifactId: artifact.id }),
  openSavedArtifact: (taskId: string) => nativePlugin.openSavedArtifact({ taskId }),
  releaseArtifact: (artifactId: string) => nativePlugin.releaseArtifact({ artifactId }),
  readArtifactWorkbook: async (artifactId: string) => (await nativePlugin.readArtifactWorkbook({ artifactId })).workbook,
  pickGradeWorkbook: async () => (await nativePlugin.pickGradeWorkbook()).workbook,
  clearLoginState: () => nativePlugin.clearLoginState(),
  onEvent: (listener: (event: GradeEvent) => void) => nativePlugin.addListener('gradeExportEvent', listener),
}
