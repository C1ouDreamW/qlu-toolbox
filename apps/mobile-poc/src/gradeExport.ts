import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type GradeStage =
  | 'idle'
  | 'checking_access'
  | 'opening_login'
  | 'waiting_login'
  | 'opening_scores'
  | 'querying'
  | 'downloading'
  | 'validating'
  | 'awaiting_save'
  | 'success'
  | 'cancelled'
  | 'failed'

export interface GradeExportOptions {
  academicYear: string
  semester: '3' | '12'
  keepLoginState: boolean
}

export type GradeExportEvent =
  | { type: 'status'; taskId: string; stage: GradeStage; message: string }
  | { type: 'login_required'; taskId: string; stage: 'waiting_login'; message: string }
  | { type: 'transfer_progress'; taskId: string; stage: 'downloading'; message: string; loaded: number; total: number }
  | { type: 'success'; taskId: string; stage: 'success'; message: string; displayName: string }
  | { type: 'cancelled'; taskId: string; stage: 'cancelled'; message: string }
  | { type: 'error'; taskId: string; stage: 'failed'; code: string; message: string }

interface GradeExportPlugin {
  start(options: GradeExportOptions): Promise<{ taskId: string }>
  continueAfterLogin(options: { taskId: string }): Promise<void>
  cancel(options: { taskId: string }): Promise<void>
  clearLoginState(): Promise<void>
  addListener(eventName: 'gradeExportEvent', listener: (event: GradeExportEvent) => void): Promise<PluginListenerHandle>
}

const NativeGradeExport = registerPlugin<GradeExportPlugin>('GradeExport')

export const gradeExport = {
  isNativeAndroid: () => Capacitor.getPlatform() === 'android',
  start: (options: GradeExportOptions) => NativeGradeExport.start(options),
  continueAfterLogin: (taskId: string) => NativeGradeExport.continueAfterLogin({ taskId }),
  cancel: (taskId: string) => NativeGradeExport.cancel({ taskId }),
  clearLoginState: () => NativeGradeExport.clearLoginState(),
  onEvent: (listener: (event: GradeExportEvent) => void) => NativeGradeExport.addListener('gradeExportEvent', listener),
}
