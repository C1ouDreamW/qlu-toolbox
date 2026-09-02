import { registerPlugin } from '@capacitor/core'
import type { ScheduleBook, ScheduleImportSource, StoredSchedule } from '@lumatile/contracts'

interface NativeSchedulePlugin {
  list(): Promise<{ schedules: StoredSchedule[] }>
  save(options: { id: string; name: string; payload: string; makeActive: boolean }): Promise<StoredSchedule>
  activate(options: { id: string }): Promise<{ ok: boolean }>
  delete(options: { id: string }): Promise<{ ok: boolean }>
  pickImport(): Promise<{ source: ScheduleImportSource | null }>
  share(options: { fileName: string; payload: string }): Promise<void>
}

const nativePlugin = registerPlugin<NativeSchedulePlugin>('Schedule')

export const scheduleStorage = {
  list: async () => (await nativePlugin.list()).schedules,
  save: (schedule: ScheduleBook, makeActive = false) => nativePlugin.save({
    id: schedule.id,
    name: schedule.name,
    payload: JSON.stringify(schedule),
    makeActive,
  }),
  activate: (id: string) => nativePlugin.activate({ id }),
  delete: (id: string) => nativePlugin.delete({ id }),
  pickImport: async () => (await nativePlugin.pickImport()).source,
  share: (schedule: ScheduleBook) => nativePlugin.share({
    fileName: `${schedule.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.lumatile-schedule.json`,
    payload: JSON.stringify(schedule),
  }),
}
