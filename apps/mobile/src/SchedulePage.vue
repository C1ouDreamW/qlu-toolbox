<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  AlertCircle, BookOpen, CalendarDays, Check, Clock3, Download,
  FileSpreadsheet, FolderOpen, MapPin, MoreHorizontal, Plus, RefreshCw, School, Share2,
  SlidersHorizontal, Users, X,
} from 'lucide-vue-next'
import {
  datesForWeek, isNoClassDate, parseScheduleBackup, parseScheduleRows, QLU_PERIODS,
  visibleWeekdays, weekForDate, validateSchedule, formatScheduleWeeks,
} from '@lumatile/academic-core'
import type {
  ScheduleBook, ScheduleCourse, ScheduleImportPreview, ScheduleImportSource, ScheduleMeeting, StoredSchedule,
} from '@lumatile/contracts'
import { scheduleStorage } from './schedule'
import { nearbyWeeks, weekDeltaForSwipe } from './scheduleSwipe'
import ScheduleEditor from './ScheduleEditor.vue'
import ScheduleManager from './ScheduleManager.vue'

const props = defineProps<{ nativeAndroid: boolean }>()

const stored = ref<StoredSchedule[]>([])
const schedule = ref<ScheduleBook | null>(null)
const week = ref(1)
const menuOpen = ref(false)
const importMenuOpen = ref(false)
const switching = ref(false)
const selected = ref<{ course: ScheduleCourse; meeting: ScheduleMeeting } | null>(null)
const importPreview = ref<ScheduleImportPreview | null>(null)
const importMode = ref<'create' | 'overwrite'>('create')
const overwriteId = ref('')
const busy = ref(false)
const error = ref('')
const workspace = ref<'calendar' | 'courses' | 'settings' | 'editor'>('calendar')
const editorReturnWorkspace = ref<'calendar' | 'courses' | 'settings'>('calendar')
const editingCourse = ref<ScheduleCourse | null>(null)
const scheduleTrack = ref<HTMLElement | null>(null)
let touchX = 0
let touchY = 0
let dragOffset = 0
let dragTarget: HTMLElement | null = null
let dragging = false
let settling = false
let touchAxis: 'pending' | 'horizontal' | 'vertical' = 'pending'

const dates = computed(() => schedule.value ? datesForWeek(schedule.value, week.value) : [])
const carouselWeeks = computed(() => schedule.value ? nearbyWeeks(week.value, schedule.value.totalWeeks) : [])
const todayKey = dateKey(new Date())
const pendingCount = computed(() => schedule.value?.courses.reduce(
  (sum, course) => sum + course.meetings.filter(meeting => meeting.weekday === null).length, 0,
) || 0)
function meetingsForWeek(targetWeek: number) {
  if (!schedule.value) return []
  const visibleDays = visibleWeekdays(schedule.value, targetWeek)
  return schedule.value.courses.flatMap(course => course.meetings
    .filter(meeting => meeting.weekday !== null && meeting.startPeriod !== null && meeting.endPeriod !== null
      && meeting.weeks.includes(targetWeek) && visibleDays.includes(meeting.weekday))
    .map(meeting => ({ course, meeting })))
}
const title = computed(() => {
  if (!schedule.value) return '我的课表'
  const current = weekForDate(schedule.value)
  if (week.value < 1) return '开学前'
  if (week.value > schedule.value.totalWeeks) return `第 ${schedule.value.totalWeeks} 周后`
  return `第 ${week.value} 周${current > schedule.value.totalWeeks ? '（学期结束）' : ''}`
})
const dateRange = computed(() => {
  if (!dates.value.length) return ''
  const first = dates.value[0]
  const last = dates.value[6]
  return `${first.getMonth() + 1}月${first.getDate()}日—${last.getMonth() + 1}月${last.getDate()}日`
})

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function datesAt(targetWeek: number) { return schedule.value ? datesForWeek(schedule.value, targetWeek) : [] }
function dayDate(day: number, targetWeek = week.value) { return datesAt(targetWeek)[day - 1] }
function noClass(day: number, targetWeek = week.value) {
  const date = dayDate(day, targetWeek)
  return schedule.value && date ? isNoClassDate(schedule.value, date) : undefined
}
function monthAt(targetWeek: number) {
  const first = datesAt(targetWeek)[0]
  return first ? `${first.getMonth() + 1}月` : ''
}
function periodText(period: number) {
  const item = schedule.value?.periods.find(candidate => candidate.period === period)
  return item ? `${item.start}\n${item.end}` : ''
}
function meetingTime(meeting: ScheduleMeeting) {
  const start = schedule.value?.periods.find(item => item.period === meeting.startPeriod)?.start
  const end = schedule.value?.periods.find(item => item.period === meeting.endPeriod)?.end
  return start && end ? `${start}–${end}` : ''
}
function weekdayName(day: number) { return '一二三四五六日'[day - 1] }
function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
function emptyBook(): ScheduleBook {
  const now = new Date()
  const academicYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return {
    schemaVersion: 1, id: newId(), name: '我的课表', academicYear: `${academicYear}-${academicYear + 1}`,
    semester: '1', startDate: '2026-09-07', totalWeeks: 19, weekendMode: 'show',
    periods: QLU_PERIODS.map(period => ({ ...period })), noClassDates: [], courses: [], updatedAt: new Date().toISOString(),
  }
}

function openEditor(course: ScheduleCourse | null = null) {
  if (!schedule.value) schedule.value = emptyBook()
  editorReturnWorkspace.value = workspace.value === 'editor' ? 'calendar' : workspace.value
  editingCourse.value = course
  workspace.value = 'editor'
}
function closeEditor() { workspace.value = editorReturnWorkspace.value }
let saveQueue = Promise.resolve(true)
function saveBook(next: ScheduleBook) {
  const snapshot = JSON.parse(JSON.stringify(next)) as ScheduleBook
  saveQueue = saveQueue.then(async () => {
  try {
    error.value = ''
    validateSchedule(snapshot)
    await scheduleStorage.save(snapshot, true)
    await loadSchedules(snapshot.id)
    return true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    return false
  }
  })
  return saveQueue
}
async function saveCourse(course: ScheduleCourse) {
  if (!schedule.value) return
  const courses = schedule.value.courses.some(item => item.id === course.id)
    ? schedule.value.courses.map(item => item.id === course.id ? course : item)
    : [...schedule.value.courses, course]
  if (await saveBook({ ...schedule.value, courses, updatedAt: new Date().toISOString() })) closeEditor()
}
async function deleteCourse(id: string) {
  if (!schedule.value || !window.confirm('确定删除这门课程及其所有时段吗？')) return
  if (await saveBook({ ...schedule.value, courses: schedule.value.courses.filter(course => course.id !== id), updatedAt: new Date().toISOString() })) closeEditor()
}
async function deleteBook() {
  if (!schedule.value || !window.confirm('确定删除整份课表吗？此操作不可撤销。')) return
  await scheduleStorage.delete(schedule.value.id)
  closeWorkspace()
  await loadSchedules()
}
function closeWorkspace() {
  workspace.value = 'calendar'
  requestAnimationFrame(() => window.scrollTo({ top: 0 }))
}
async function saveSettings(next: ScheduleBook) {
  await saveBook(next)
}

async function loadSchedules(preferredId = '') {
  try {
  stored.value = await scheduleStorage.list()
  const item = stored.value.find(candidate => candidate.id === preferredId)
    || stored.value.find(candidate => candidate.isActive) || stored.value[0]
  schedule.value = item ? parseScheduleBackup(item.payload) : null
  if (schedule.value) week.value = Math.min(schedule.value.totalWeeks, Math.max(1, weekForDate(schedule.value)))
  await nextTick()
  resetTrack()
  } catch (reason) {
    schedule.value = null
    error.value = `无法读取课表：${reason instanceof Error ? reason.message : String(reason)}。请切换课表或删除损坏的数据后重新导入。`
  }
}

async function deleteBroken(item: StoredSchedule) {
  if (!window.confirm(`确定删除无法读取的课表「${item.name}」？`)) return
  try { await scheduleStorage.delete(item.id); error.value = ''; await loadSchedules() }
  catch (reason) { error.value = String(reason) }
}

async function chooseImport() {
  menuOpen.value = false
  importMenuOpen.value = false
  busy.value = true
  error.value = ''
  try {
    const source = await scheduleStorage.pickImport()
    if (source) previewImport(source)
    importMode.value = 'create'
    overwriteId.value = stored.value.find(item => item.isActive)?.id || stored.value[0]?.id || ''
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { busy.value = false }
}

async function importFromSchool() {
  menuOpen.value = false
  importMenuOpen.value = false
  busy.value = true
  error.value = ''
  try {
    const source = await scheduleStorage.importFromSchool()
    if (source) previewImport(source)
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { busy.value = false }
}

function previewImport(source: ScheduleImportSource) {
  if (source.kind === 'workbook' && source.rows) importPreview.value = parseScheduleRows({ fileName: source.fileName, rows: source.rows })
  else if (source.kind === 'backup' && source.payload) {
    const imported = parseScheduleBackup(source.payload)
    const meetings = imported.courses.flatMap(course => course.meetings)
    importPreview.value = {
      schedule: imported,
      scheduledMeetings: meetings.filter(item => item.weekday !== null).length,
      pendingMeetings: meetings.filter(item => item.weekday === null).length,
      warnings: [],
    }
  }
  importMode.value = 'create'
  overwriteId.value = stored.value.find(item => item.isActive)?.id || stored.value[0]?.id || ''
}

async function confirmImport() {
  if (!importPreview.value) return
  busy.value = true
  error.value = ''
  try {
    const original = importPreview.value.schedule
    const target = importMode.value === 'overwrite' ? stored.value.find(item => item.id === overwriteId.value) : null
    const saved: ScheduleBook = {
      ...original,
      id: target?.id || newId(),
      name: target?.name || original.name,
      updatedAt: new Date().toISOString(),
    }
    validateSchedule(saved)
    await scheduleStorage.save(saved, true)
    importPreview.value = null
    await loadSchedules(saved.id)
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { busy.value = false }
}

async function switchSchedule(item: StoredSchedule) {
  await scheduleStorage.activate(item.id)
  switching.value = false
  await loadSchedules(item.id)
}

async function shareSchedule() {
  if (!schedule.value) return
  menuOpen.value = false
  try { await scheduleStorage.share(schedule.value) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}

function changeWeek(delta: number) {
  if (!schedule.value) return
  week.value = Math.max(1, Math.min(schedule.value.totalWeeks, week.value + delta))
}
function currentWeek() {
  if (!schedule.value) return
  const target = Math.max(1, Math.min(schedule.value.totalWeeks, weekForDate(schedule.value)))
  week.value = target
  void nextTick(resetTrack)
}
function currentTrackIndex() { return week.value === 1 ? 0 : 1 }
function resetTrack(instant = true) {
  const track = scheduleTrack.value
  if (!track) return
  if (instant) track.classList.add('dragging')
  track.style.transform = `translate3d(${-currentTrackIndex() * track.parentElement!.clientWidth}px,0,0)`
  if (instant) {
    void track.offsetWidth
    track.classList.remove('dragging')
  }
}
function touchStart(event: PointerEvent) {
  if (settling || (event.pointerType === 'mouse' && event.button !== 0)) return
  const track = scheduleTrack.value
  if (!track) return
  touchX = event.clientX
  touchY = event.clientY
  touchAxis = 'pending'
  dragging = true
  dragOffset = 0
  dragTarget = track
  track.classList.add('dragging')
}
function touchMove(event: PointerEvent) {
  if (!dragging || !schedule.value || !dragTarget) return
  const dx = event.clientX - touchX
  const dy = event.clientY - touchY
  if (touchAxis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 7) {
    touchAxis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    if (touchAxis === 'horizontal') (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }
  if (touchAxis !== 'horizontal') return
  event.preventDefault()
  const atEdge = (week.value === 1 && dx > 0) || (week.value === schedule.value.totalWeeks && dx < 0)
  dragOffset = atEdge ? dx * 0.22 : dx
  const width = (event.currentTarget as HTMLElement).clientWidth
  dragTarget.style.transform = `translate3d(${-currentTrackIndex() * width + dragOffset}px,0,0)`
}
function touchEnd(event: PointerEvent) {
  if (!dragging) return
  const width = (event.currentTarget as HTMLElement).clientWidth
  const delta = weekDeltaForSwipe(dragOffset, width, week.value, schedule.value?.totalWeeks || 1)
  const change = touchAxis === 'horizontal' && delta
  dragging = false
  dragTarget?.classList.remove('dragging')
  if (change) {
    settling = true
    if (dragTarget) dragTarget.style.transform = `translate3d(${-(currentTrackIndex() + delta) * width}px,0,0)`
    window.setTimeout(async () => { changeWeek(delta); await nextTick(); resetTrack(); settling = false }, 220)
  } else resetTrack(false)
  dragOffset = 0
  dragTarget = null
  touchAxis = 'pending'
}
function touchCancel() {
  dragging = false
  dragTarget?.classList.remove('dragging')
  resetTrack(false)
  dragOffset = 0
  dragTarget = null
  touchAxis = 'pending'
}

function handleBack() {
  if (importPreview.value) { importPreview.value = null; return true }
  if (selected.value) { selected.value = null; return true }
  if (switching.value) { switching.value = false; return true }
  if (importMenuOpen.value) { importMenuOpen.value = false; return true }
  if (menuOpen.value) { menuOpen.value = false; return true }
  if (workspace.value === 'editor') {
    closeEditor()
    return true
  }
  if (workspace.value !== 'calendar') { closeWorkspace(); return true }
  return false
}

defineExpose({ handleBack })
onMounted(() => { void loadSchedules() })
</script>

<template>
  <section class="schedule-page">
    <header class="schedule-header">
      <div><div class="schedule-title-row"><h1>{{ title }}</h1><button v-if="schedule && week !== Math.max(1, Math.min(schedule.totalWeeks, weekForDate(schedule)))" class="current-week-button" @click="currentWeek">回到本周</button></div><p><span class="schedule-kicker">{{ schedule?.name || 'LUMATILE SCHEDULE' }}</span><i v-if="dateRange">·</i><span>{{ dateRange || '把教务课表装进口袋' }}</span></p></div>
      <div class="schedule-actions"><button aria-label="添加课程" @click="openEditor()"><Plus /></button><button aria-label="导入课表" :aria-expanded="importMenuOpen" @click="menuOpen = false; importMenuOpen = !importMenuOpen"><Download /></button><button aria-label="更多" @click="importMenuOpen = false; menuOpen = !menuOpen"><MoreHorizontal /></button></div>
    </header>

    <Transition name="fade"><button v-if="importMenuOpen" class="import-menu-scrim" aria-label="关闭导入菜单" @click="importMenuOpen = false" /></Transition>
    <Transition name="import-pop"><section v-if="importMenuOpen" class="import-menu">
      <button :disabled="!nativeAndroid || busy" @click="importFromSchool"><School /><span><strong>从教务导入</strong><small>登录教务并导出 Excel</small></span></button>
      <button :disabled="!nativeAndroid || busy" @click="chooseImport"><FileSpreadsheet /><span><strong>从文件导入</strong><small>Excel 或课表备份</small></span></button>
    </section></Transition>

    <div v-if="error" class="schedule-alert"><AlertCircle />{{ error }}<button @click="error = ''"><X /></button></div>

    <template v-if="schedule">
      <div
        class="schedule-viewport"
        @pointerdown="touchStart" @pointermove="touchMove" @pointerup="touchEnd" @pointercancel="touchCancel"
      ><div ref="scheduleTrack" class="schedule-track"><div v-for="pageWeek in carouselWeeks" :key="pageWeek" class="schedule-slide"><div
        class="schedule-grid" :style="{ '--day-count': visibleWeekdays(schedule, pageWeek).length }"
      >
        <div class="grid-corner">{{ monthAt(pageWeek) }}</div>
        <div
          v-for="(day, index) in visibleWeekdays(schedule, pageWeek)" :key="`head-${day}`" class="day-head"
          :class="{ today: dateKey(dayDate(day, pageWeek)) === todayKey }" :style="{ gridColumn: index + 2 }"
        ><span>周{{ weekdayName(day) }}</span><strong>{{ dayDate(day, pageWeek).getDate() }}</strong></div>
        <template v-for="period in 11" :key="`period-${period}`">
          <div class="period-label" :style="{ gridRow: period + 1 }"><strong>{{ period }}</strong><span>{{ periodText(period) }}</span></div>
          <div
            v-for="(day, index) in visibleWeekdays(schedule, pageWeek)" :key="`${day}-${period}`" class="grid-cell"
            :class="{ today: dateKey(dayDate(day, pageWeek)) === todayKey }"
            :style="{ gridColumn: index + 2, gridRow: period + 1 }"
          />
        </template>
        <div
          v-for="day in visibleWeekdays(schedule, pageWeek).filter(day => noClass(day, pageWeek))" :key="`off-${day}`"
          class="no-class-column" :style="{ gridColumn: visibleWeekdays(schedule, pageWeek).indexOf(day) + 2 }"
        ><span>停课</span><small>{{ noClass(day, pageWeek)?.reason }}</small></div>
        <button
          v-for="item in meetingsForWeek(pageWeek)" :key="item.meeting.id" class="meeting-card"
          :style="{
            gridColumn: visibleWeekdays(schedule, pageWeek).indexOf(item.meeting.weekday!) + 2,
            gridRow: `${item.meeting.startPeriod! + 1} / ${item.meeting.endPeriod! + 2}`,
            background: item.course.color,
          }"
          @click="selected = item"
        ><strong>{{ item.course.name }}</strong><span v-if="item.meeting.location">{{ item.meeting.location }}</span><small>{{ item.meeting.teachers[0] || item.course.teachers[0] || '' }}</small></button>
      </div></div></div></div>
    </template>

    <div v-else class="schedule-empty">
      <div v-if="stored.length">
        <p>已保存的课表</p>
        <div v-for="item in stored" :key="item.id">
          <button class="secondary" @click="switchSchedule(item)">{{ item.name }}</button>
          <button class="secondary" @click="deleteBroken(item)">删除此课表</button>
        </div>
      </div>
      <span><CalendarDays /></span><h1>还没有课表</h1><p>从教务导入 XLS 或 XLSX，也可以从同学分享的备份开始。</p>
      <button class="primary" :disabled="!nativeAndroid || busy" @click="importFromSchool"><School />{{ busy ? '正在读取…' : '从教务导入' }}</button>
      <button class="secondary" :disabled="!nativeAndroid || busy" @click="chooseImport"><FolderOpen />从文件导入</button>
      <button class="secondary" @click="openEditor()"><Plus />手工新建</button>
    </div>

    <Transition name="fade"><button v-if="menuOpen" class="sheet-scrim" aria-label="关闭菜单" @click="menuOpen = false" /></Transition>
    <Transition name="sheet"><section v-if="menuOpen" class="schedule-menu">
      <div class="sheet-handle" />
      <button @click="chooseImport"><FileSpreadsheet />从文件导入</button>
      <button v-if="stored.length > 1" @click="menuOpen = false; switching = true"><RefreshCw />切换课表</button>
      <button @click="menuOpen = false; workspace = 'courses'"><Users />管理课程 <em v-if="pendingCount">{{ pendingCount }} 待安排</em></button>
      <button @click="menuOpen = false; workspace = 'settings'"><SlidersHorizontal />课表设置</button>
      <button @click="shareSchedule"><Share2 />导出并分享</button>
    </section></Transition>

    <Transition name="fade"><button v-if="selected" class="sheet-scrim" aria-label="关闭详情" @click="selected = null" /></Transition>
    <Transition name="sheet"><section v-if="selected" class="course-detail">
      <div class="sheet-handle" /><header><i :style="{ background: selected.course.color }" /><h2>{{ selected.course.name }}</h2><button @click="selected = null"><X /></button></header>
      <p><CalendarDays />{{ formatScheduleWeeks(selected.meeting.weeks) }}</p>
      <p><Clock3 />周{{ weekdayName(selected.meeting.weekday!) }} 第 {{ selected.meeting.startPeriod }}–{{ selected.meeting.endPeriod }} 节 <small>{{ meetingTime(selected.meeting) }}</small></p>
      <p><MapPin />{{ selected.meeting.location || '地点待定' }}</p>
      <p><Users />{{ selected.meeting.teachers.join('、') || selected.course.teachers.join('、') || '教师待定' }}</p>
      <button class="primary" @click="openEditor(selected.course); selected = null"><BookOpen />查看与编辑课程</button>
    </section></Transition>

    <Transition name="fade"><button v-if="switching" class="sheet-scrim" aria-label="关闭切换" @click="switching = false" /></Transition>
    <Transition name="sheet"><section v-if="switching" class="switch-sheet">
      <div class="sheet-handle" /><h2>切换课表</h2>
      <button v-for="item in stored" :key="item.id" @click="switchSchedule(item)"><span><strong>{{ item.name }}</strong><small>{{ new Date(item.updatedAt).toLocaleDateString() }} 更新</small></span><Check v-if="item.isActive" /></button>
    </section></Transition>

    <Transition name="fade"><div v-if="importPreview" class="dialog-scrim"><section class="import-dialog">
      <header><span><Download /></span><div><small>已识别课表</small><h2>{{ importPreview.schedule.name }}</h2></div><button @click="importPreview = null"><X /></button></header>
      <div class="import-stats"><span><strong>{{ importPreview.schedule.courses.length }}</strong>门课程</span><span><strong>{{ importPreview.scheduledMeetings }}</strong>个时段</span><span><strong>{{ importPreview.pendingMeetings }}</strong>待安排</span></div>
      <p v-for="warning in importPreview.warnings" :key="warning" role="alert">{{ warning }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <label>开学日期<input v-model="importPreview.schedule.startDate" type="date" /></label>
      <label>学期周数<input v-model.number="importPreview.schedule.totalWeeks" type="number" min="1" max="30" /></label>
      <div v-if="stored.length" class="mode-tabs"><button :class="{ active: importMode === 'create' }" @click="importMode = 'create'">创建新课表</button><button :class="{ active: importMode === 'overwrite' }" @click="importMode = 'overwrite'">覆盖已有课表</button></div>
      <label v-if="importMode === 'overwrite'">覆盖目标<select v-model="overwriteId"><option v-for="item in stored" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <p v-if="importMode === 'overwrite'" class="overwrite-note"><AlertCircle />目标课表中的手工修改会被完整替换。</p>
      <button class="primary" :disabled="busy" @click="confirmImport">{{ busy ? '正在保存…' : importMode === 'create' ? '创建并使用' : '覆盖并使用' }}</button>
    </section></div></Transition>

    <ScheduleManager
      v-if="schedule && (workspace === 'courses' || workspace === 'settings')"
      :book="schedule" :initial-tab="workspace" :save-error="error"
      @close="closeWorkspace" @add="openEditor()" @edit="openEditor"
      @saved="saveSettings" @delete-book="deleteBook"
    />
    <ScheduleEditor
      v-if="schedule && workspace === 'editor'" :key="editingCourse?.id || 'new'"
      :book="schedule" :course="editingCourse"
      @close="closeEditor" @saved="saveCourse" @deleted="deleteCourse"
    />
  </section>
</template>

<style scoped>
.schedule-page{min-height:100vh;padding:calc(18px + env(safe-area-inset-top)) 10px calc(84px + env(safe-area-inset-bottom));overflow:hidden;background:linear-gradient(180deg,#eef6ff 0,#f7faff 38%,#f4f8fc 100%);color:#18324b}.schedule-header{display:flex;align-items:flex-start;justify-content:space-between;padding:8px 7px 12px}.schedule-kicker{display:block;max-width:230px;overflow:hidden;color:#6b8298;font-size:11px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.schedule-header h1{margin:3px 0 2px;font-size:25px;letter-spacing:-.04em}.schedule-header p{margin:0;color:#667d93;font-size:12px}.schedule-actions{display:flex;gap:4px}.schedule-actions button,.course-detail header button{display:grid;place-items:center;width:42px;height:42px;border:0;border-radius:13px;background:transparent;color:#18324b}.schedule-actions svg{width:24px}.schedule-alert{display:flex;align-items:center;gap:8px;margin:0 7px 8px;padding:10px 12px;border-radius:12px;color:#99483d;background:#fff0ed;font-size:12px}.schedule-alert>svg{width:17px;flex:none}.schedule-alert button{display:grid;place-items:center;margin-left:auto;border:0;background:none}.schedule-alert button svg{width:15px}.pending-chip,.today-chip{display:flex;align-items:center;gap:6px;margin:0 7px 8px;padding:7px 10px;border:0;border-radius:999px;color:#075ebd;background:#dfeeff;font-size:11px;font-weight:700}.pending-chip svg{width:14px}.pending-chip svg:last-child{margin-left:auto}.today-chip{position:absolute;z-index:4;right:10px;margin-top:1px;color:#fff;background:#0b76e8}.schedule-grid{--row-height:62px;position:relative;display:grid;grid-template-columns:54px repeat(var(--day-count),minmax(0,1fr));grid-template-rows:58px repeat(11,var(--row-height));min-width:0;border:1px solid rgba(129,163,194,.18);border-radius:18px;overflow:hidden;background:rgba(255,255,255,.52);box-shadow:0 12px 34px rgba(14,73,127,.07);touch-action:pan-y}.grid-corner,.day-head,.period-label,.grid-cell{border-right:1px solid rgba(129,163,194,.14);border-bottom:1px solid rgba(129,163,194,.14)}.grid-corner{display:grid;place-items:center;color:#7d91a3;font-size:11px;font-weight:700}.day-head{grid-row:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;color:#7890a5}.day-head span{font-size:10px}.day-head strong{font-size:15px}.day-head.today{color:#075ebd;background:#e4f2ff}.period-label{grid-column:1;display:flex;align-items:center;justify-content:center;flex-direction:column;white-space:pre-line}.period-label strong{font-size:16px}.period-label span{margin-top:2px;color:#8799a9;font-size:8px;line-height:1.25;text-align:center}.grid-cell.today{background:rgba(11,118,232,.035)}.meeting-card{z-index:2;min-width:0;margin:3px;padding:7px 5px;border:1px solid rgba(255,255,255,.72);border-radius:9px;overflow:hidden;color:#fff;text-align:left;box-shadow:0 3px 8px rgba(34,66,96,.13);text-shadow:0 1px 1px rgba(24,50,75,.12)}.meeting-card strong,.meeting-card span,.meeting-card small{display:block;overflow:hidden;text-overflow:ellipsis}.meeting-card strong{font-size:11px;line-height:1.32}.meeting-card span,.meeting-card small{margin-top:3px;font-size:9px;line-height:1.25}.no-class-column{z-index:3;grid-row:2/13;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;padding:4px;color:#8d6270;background:repeating-linear-gradient(-45deg,rgba(236,210,218,.5),rgba(236,210,218,.5) 5px,rgba(255,255,255,.35) 5px,rgba(255,255,255,.35) 10px);pointer-events:none}.no-class-column span{font-size:11px;font-weight:800}.no-class-column small{font-size:8px;text-align:center}.schedule-empty{display:flex;min-height:calc(100vh - 220px);align-items:center;justify-content:center;flex-direction:column;padding:30px;text-align:center}.schedule-empty>span{display:grid;place-items:center;width:72px;height:72px;border-radius:23px;color:#0b76e8;background:#e2f0ff;box-shadow:0 12px 32px rgba(11,118,232,.12)}.schedule-empty>span svg{width:34px}.schedule-empty h1{margin:18px 0 7px;font-size:23px}.schedule-empty p{max-width:310px;margin:0 0 20px;color:#667d93;font-size:13px;line-height:1.65}.schedule-empty .primary,.schedule-empty .secondary{max-width:310px}.sheet-scrim,.dialog-scrim{position:fixed;z-index:20;top:0;right:0;bottom:0;left:0;border:0;background:rgba(11,28,44,.48);backdrop-filter:blur(4px)}.schedule-menu,.course-detail,.switch-sheet{position:fixed;z-index:21;right:0;bottom:0;left:0;max-width:680px;margin:auto;padding:8px 16px calc(18px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;background:#fff;box-shadow:0 -20px 60px rgba(9,35,59,.2)}.sheet-handle{width:42px;height:4px;margin:0 auto 10px;border-radius:9px;background:#cfdae3}.schedule-menu button,.switch-sheet button{display:flex;width:100%;align-items:center;gap:13px;padding:15px 8px;border:0;border-bottom:1px solid #e8eff5;color:#18324b;background:none;text-align:left;font-weight:700}.schedule-menu button:last-child,.switch-sheet button:last-child{border-bottom:0}.schedule-menu svg{width:20px;color:#0b76e8}.schedule-menu em{margin-left:auto;padding:4px 7px;border-radius:99px;color:#a76400;background:#fff1cc;font-size:10px;font-style:normal}.course-detail header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:8px 0 12px;border-bottom:1px solid #e8eff5}.course-detail header i{width:5px;height:28px;border-radius:9px}.course-detail h2,.switch-sheet h2{margin:0;font-size:20px}.course-detail p{display:flex;align-items:center;gap:11px;margin:0;padding:13px 4px;border-bottom:1px solid #edf2f6}.course-detail p svg{width:19px;color:#86a0b6}.course-detail p small{margin-left:auto;color:#667d93}.course-detail>.primary{margin-top:16px}.switch-sheet h2{padding:7px 5px 13px}.switch-sheet button span{display:flex;flex:1;flex-direction:column;gap:4px}.switch-sheet button small{color:#778da1;font-weight:400}.switch-sheet button>svg{width:20px;color:#0b76e8}.dialog-scrim{z-index:30;display:flex;align-items:flex-end;justify-content:center}.import-dialog{width:min(680px,100%);max-height:calc(100vh - 26px);overflow:auto;padding:18px 18px calc(20px + env(safe-area-inset-bottom));border-radius:26px 26px 0 0;background:#fff}.import-dialog header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px}.import-dialog header>span{display:grid;place-items:center;width:47px;height:47px;border-radius:15px;color:#0b76e8;background:#e4f2ff}.import-dialog header h2{margin:2px 0 0;font-size:17px}.import-dialog header small{color:#6b8298}.import-dialog header button{border:0;background:none}.import-dialog header button svg{width:20px}.import-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:17px 0}.import-stats span{display:flex;align-items:baseline;justify-content:center;gap:3px;padding:12px 6px;border-radius:12px;color:#667d93;background:#f1f6fa;font-size:10px}.import-stats strong{color:#18324b;font-size:18px}.import-dialog label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;padding:12px 2px;border-bottom:1px solid #edf2f6;font-size:13px;font-weight:700}.import-dialog input,.import-dialog select{max-width:190px;padding:9px 10px;border:1px solid #cfdeea;border-radius:10px;color:#18324b;background:#f8fbfe}.mode-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:16px;padding:4px;border-radius:12px;background:#edf3f8}.mode-tabs button{padding:10px;border:0;border-radius:9px;color:#667d93;background:transparent;font-weight:700}.mode-tabs button.active{color:#075ebd;background:#fff;box-shadow:0 2px 8px rgba(20,65,104,.1)}.overwrite-note{display:flex;align-items:center;gap:7px;color:#9b5346;font-size:11px}.overwrite-note svg{width:16px}.import-dialog>.primary{margin-top:14px}.sheet-enter-active,.sheet-leave-active,.fade-enter-active,.fade-leave-active{transition:.2s ease}.sheet-enter-from,.sheet-leave-to{transform:translateY(100%)}.fade-enter-from,.fade-leave-to{opacity:0}@media(max-width:390px){.schedule-grid{--row-height:58px}.meeting-card{margin:2px;padding:5px 3px}.meeting-card strong{font-size:10px}.meeting-card span,.meeting-card small{font-size:8px}}@media(prefers-color-scheme:dark){.schedule-page{color:#e8f2fb;background:linear-gradient(180deg,#0c1b29,#0d1722 45%)}.schedule-header p,.schedule-kicker{color:#96acbd}.schedule-actions button{color:#e8f2fb}.schedule-grid{border-color:#274156;background:rgba(20,34,49,.74)}.grid-corner,.day-head,.period-label,.grid-cell{border-color:#263d51}.day-head{color:#98adbe}.day-head.today{color:#78c1ff;background:#153650}.grid-cell.today{background:rgba(52,153,241,.06)}.period-label span{color:#8298aa}.schedule-menu,.course-detail,.switch-sheet,.import-dialog{color:#e8f2fb;background:#142231}.schedule-menu button,.switch-sheet button,.course-detail header,.course-detail p,.import-dialog label{color:#e8f2fb;border-color:#263c50}.import-stats span,.mode-tabs{background:#1b2e40}.import-stats strong{color:#e8f2fb}.import-dialog input,.import-dialog select{color:#e8f2fb;border-color:#36536b;background:#0d1722}.mode-tabs button.active{background:#27435a}.sheet-handle{background:#456075}}
.schedule-page{padding-top:calc(3px + env(safe-area-inset-top))}.schedule-header{padding:3px 7px 8px}.schedule-header h1{margin:0 0 2px}.schedule-header p{display:flex;align-items:center;gap:5px;min-width:0;margin:0;font-size:11px;white-space:nowrap}.schedule-header p i{font-style:normal}.schedule-kicker{display:block;max-width:125px;font-size:inherit}.schedule-title-row{display:flex;align-items:center;gap:9px}.current-week-button{padding:5px 9px;border:1px solid #bad9f4;border-radius:99px;color:#075ebd;background:#e5f2ff;font-size:10px;font-weight:800;white-space:nowrap}.schedule-viewport{position:relative;overflow:hidden;border-radius:18px}.schedule-slide{position:relative}.schedule-grid{transform:translate3d(var(--drag-x),0,0);transition:transform .18s cubic-bezier(.22,.75,.28,1)}.schedule-grid.dragging{transition:none}.week-next-enter-active,.week-next-leave-active,.week-prev-enter-active,.week-prev-leave-active{transition:transform .25s cubic-bezier(.22,.75,.28,1)}.week-next-leave-active,.week-prev-leave-active{position:absolute;top:0;right:0;left:0}.week-next-enter-from,.week-prev-leave-to{transform:translateX(100%)}.week-next-leave-to,.week-prev-enter-from{transform:translateX(-100%)}
.schedule-header>div:first-child{min-width:0}.schedule-header p>span:last-child{overflow:hidden;text-overflow:ellipsis}
.import-menu-scrim{position:fixed;z-index:20;top:0;right:0;bottom:0;left:0;border:0;background:transparent}.import-menu{position:fixed;z-index:21;top:calc(57px + env(safe-area-inset-top));right:53px;width:220px;padding:6px;border:1px solid #e3edf5;border-radius:17px;background:#fff;box-shadow:0 14px 38px rgba(9,35,59,.2);transform-origin:top right}.import-menu button{display:flex;width:100%;align-items:center;gap:11px;padding:12px;border:0;border-radius:12px;color:#18324b;background:transparent;text-align:left}.import-menu button:active{background:#edf5fb}.import-menu svg{width:21px;color:#0b76e8}.import-menu span{display:flex;min-width:0;flex-direction:column;gap:2px}.import-menu strong{font-size:13px}.import-menu small{color:#748a9d;font-size:10px}.import-pop-enter-active,.import-pop-leave-active{transition:.16s ease}.import-pop-enter-from,.import-pop-leave-to{opacity:0;transform:translateY(-5px) scale(.96)}@media(prefers-color-scheme:dark){.import-menu{border-color:#294257;background:#142231}.import-menu button{color:#e8f2fb}.import-menu button:active{background:#20384c}.import-menu small{color:#91a7b9}}
.schedule-track{display:flex;will-change:transform;transition:transform .22s cubic-bezier(.22,.75,.28,1)}.schedule-track.dragging{transition:none}.schedule-slide{min-width:0;flex:0 0 100%}
.day-head.today{color:#075ebd;background:#e7f3ff}.day-head.today strong{display:grid;min-width:26px;height:26px;place-items:center;padding:0 5px;border-radius:999px;background:#cbe6ff}.grid-cell.today{background:rgba(11,118,232,.055)}
.schedule-grid.dragging{will-change:transform}.current-week-button{margin-left:10px}
@media(prefers-color-scheme:dark){.current-week-button{color:#78c1ff;border-color:#315979;background:#153650}.day-head.today{color:#9fd3ff;background:#153650}.day-head.today strong{background:#24567d}.grid-cell.today{background:rgba(82,172,248,.07)}}
@media(prefers-reduced-motion:reduce){.schedule-grid,.week-next-enter-active,.week-next-leave-active,.week-prev-enter-active,.week-prev-leave-active,.sheet-enter-active,.sheet-leave-active,.fade-enter-active,.fade-leave-active{transition:none}}
</style>
