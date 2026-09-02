import { Capacitor, registerPlugin } from '@capacitor/core'
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
const previewKey = 'lumatilePreviewSchedules'

function previewList(): StoredSchedule[] {
  try { return JSON.parse(localStorage.getItem(previewKey) || '[]') as StoredSchedule[] }
  catch { return [] }
}
function storePreview(items: StoredSchedule[]) { localStorage.setItem(previewKey, JSON.stringify(items)) }
function savePreview(schedule: ScheduleBook, makeActive: boolean) {
  const items = previewList()
  const previous = items.find(item => item.id === schedule.id)
  const saved: StoredSchedule = {
    id: schedule.id, name: schedule.name, payload: JSON.stringify(schedule), updatedAt: new Date().toISOString(),
    isActive: makeActive || previous?.isActive || false,
  }
  storePreview([...items.filter(item => item.id !== schedule.id).map(item => makeActive ? { ...item, isActive: false } : item), saved])
  return saved
}

export const scheduleStorage = {
  list: async () => Capacitor.isNativePlatform() ? (await nativePlugin.list()).schedules : previewList(),
  save: (schedule: ScheduleBook, makeActive = false) => Capacitor.isNativePlatform() ? nativePlugin.save({
    id: schedule.id,
    name: schedule.name,
    payload: JSON.stringify(schedule),
    makeActive,
  }) : Promise.resolve(savePreview(schedule, makeActive)),
  activate: async (id: string) => {
    if (Capacitor.isNativePlatform()) return nativePlugin.activate({ id })
    storePreview(previewList().map(item => ({ ...item, isActive: item.id === id })))
    return { ok: true }
  },
  delete: async (id: string) => {
    if (Capacitor.isNativePlatform()) return nativePlugin.delete({ id })
    const remaining = previewList().filter(item => item.id !== id)
    if (remaining.length && !remaining.some(item => item.isActive)) remaining[0].isActive = true
    storePreview(remaining)
    return { ok: true }
  },
  pickImport: async () => Capacitor.isNativePlatform() ? (await nativePlugin.pickImport()).source : null,
  share: (schedule: ScheduleBook) => Capacitor.isNativePlatform() ? nativePlugin.share({
    fileName: `${schedule.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.lumatile-schedule.json`,
    payload: JSON.stringify(schedule),
  }) : Promise.resolve(),
}
