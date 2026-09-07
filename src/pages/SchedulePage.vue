<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BookOpen, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check, Download, FilePlus2,
  FolderOpen, Loader2, MoreHorizontal, Pencil, Plus, Repeat, SlidersHorizontal, Trash2,
} from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import BaseModal from '@/components/BaseModal.vue'
import ScheduleCourseEditor from '@/pages/schedule/ScheduleCourseEditor.vue'
import ScheduleManager from '@/pages/schedule/ScheduleManager.vue'
import { appStore } from '@/store'
import {
  datesForWeek, isNoClassDate, parseScheduleBackup, parseScheduleRows, QLU_PERIODS,
  visibleWeekdays, weekForDate, validateSchedule, meetingConflicts,
} from '@lumatile/academic-core'
import type {
  ScheduleBook, ScheduleCourse, ScheduleImportPreview, ScheduleImportSource,
  ScheduleMeeting, StoredSchedule,
} from '@/types'
import type { BootstrapData, PageName } from '@/types'

const props = defineProps<{ data: BootstrapData }>()
defineEmits<{ navigate: [page: PageName] }>()

const schedule = ref<ScheduleBook | null>(null)
const scheduleId = ref('')
const week = ref(1)
const loadError = ref('')
const selected = ref<ScheduleCourse | null>(null)
const conflictsOpen = ref(false)
const switching = ref(false)
const confirmDelete = ref(false)
const busy = ref(false)
const editorOpen = ref(false)
const editingCourse = ref<ScheduleCourse | null>(null)
const returnToManager = ref(false)
const managerOpen = ref(false)
const managerTab = ref<'courses' | 'settings'>('courses')
const menu = ref<'import' | 'more' | null>(null)
const importPreview = ref<ScheduleImportPreview | null>(null)
const importMode = ref<'create' | 'overwrite'>('create')
const overwriteId = ref('')

const rows = computed(() => props.data.schedules || [])
const pendingCount = computed(() => schedule.value?.courses.reduce(
  (sum, course) => sum + course.meetings.filter(meeting => meeting.weekday === null).length, 0,
) || 0)
const dates = computed(() => schedule.value ? datesForWeek(schedule.value, week.value) : [])
const days = computed(() => schedule.value ? visibleWeekdays(schedule.value, week.value) : [])
const todayWeekday = new Date().getDay() === 0 ? 7 : new Date().getDay()
const isCurrentWeek = computed(() => schedule.value ? weekForDate(schedule.value) === week.value : false)
const currentWeek = computed(() => {
  if (!schedule.value) return 1
  return Math.min(Math.max(weekForDate(schedule.value), 1), schedule.value.totalWeeks)
})
const title = computed(() => {
  if (!schedule.value) return ''
  const current = weekForDate(schedule.value)
  if (week.value < 1) return '开学前'
  if (week.value > schedule.value.totalWeeks) return `第 ${schedule.value.totalWeeks} 周后`
  return `第 ${week.value} 周${current > schedule.value.totalWeeks ? '（学期结束）' : ''}`
})
const dateRange = computed(() => {
  if (dates.value.length < 7) return ''
  const first = dates.value[0]
  const last = dates.value[6]
  return `${first.getMonth() + 1}月${first.getDate()}日 — ${last.getMonth() + 1}月${last.getDate()}日`
})
const placedMeetings = computed(() => {
  if (!schedule.value) return []
  const visible = days.value
  return schedule.value.courses.flatMap(course => course.meetings
    .filter(meeting => meeting.weekday !== null && meeting.startPeriod !== null && meeting.endPeriod !== null
      && meeting.weeks.includes(week.value) && visible.includes(meeting.weekday))
    .map(meeting => ({ course, meeting })))
})

const conflictIds = computed(() => new Set(meetingConflicts(placedMeetings.value.map(item => item.meeting)).flat()))
function dayDate(day: number) { return dates.value[day - 1] }
function noClass(day: number) {
  const date = dayDate(day)
  return schedule.value && date ? isNoClassDate(schedule.value, date) : undefined
}
function weekdayName(day: number) { return '一二三四五六日'[day - 1] }
function periodStart(period: number) {
  return schedule.value?.periods.find(item => item.period === period)?.start || ''
}
function columnFor(day: number) { return days.value.indexOf(day) + 2 }
function formatTime(value: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value)) : '—'
}

function formatWeeks(weeks: number[]): string {
  if (!weeks.length) return '未安排周次'
  const parts: string[] = []
  let index = 0
  while (index < weeks.length) {
    const start = weeks[index]
    const step = index + 2 < weeks.length && weeks[index + 1] - start === 2 && weeks[index + 2] - weeks[index + 1] === 2
      ? 2
      : index + 1 < weeks.length && weeks[index + 1] - start === 1 ? 1 : 0
    let end = start
    if (step) {
      end = start
      while (index + 1 < weeks.length && weeks[index + 1] - end === step) {
        end = weeks[index + 1]
        index += 1
      }
    }
    let label = start === end ? `${start}` : `${start}-${end}`
    if (step === 2) label += start % 2 ? '（单）' : '（双）'
    parts.push(label)
    index += 1
  }
  return `${parts.join('、')} 周`
}

function meetingLine(meeting: ScheduleMeeting): string {
  const pieces: string[] = []
  if (meeting.weekday === null || meeting.startPeriod === null || meeting.endPeriod === null) {
    pieces.push('待安排时间')
  } else {
    pieces.push(`周${weekdayName(meeting.weekday)} 第 ${meeting.startPeriod}-${meeting.endPeriod} 节`)
    const start = schedule.value?.periods.find(item => item.period === meeting.startPeriod)?.start
    const end = schedule.value?.periods.find(item => item.period === meeting.endPeriod)?.end
    if (start && end) pieces.push(`${start}–${end}`)
  }
  if (meeting.location) pieces.push(meeting.location)
  if (meeting.teachers.length) pieces.push(meeting.teachers.join('、'))
  return pieces.join(' · ')
}

function changeWeek(delta: number) {
  if (!schedule.value) return
  week.value = Math.min(Math.max(week.value + delta, 1), schedule.value.totalWeeks)
}
function backToCurrentWeek() { week.value = currentWeek.value }

function onKeydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
  if (conflictsOpen.value || selected.value || switching.value || confirmDelete.value || editorOpen.value || managerOpen.value || importPreview.value) return
  if (event.key === 'ArrowLeft') changeWeek(-1)
  else if (event.key === 'ArrowRight') changeWeek(1)
}

async function load(preferredId?: string) {
  await appStore.refreshSchedules()
  const row = (preferredId ? rows.value.find(item => item.id === preferredId) : null)
    ?? rows.value.find(item => item.isActive)
    ?? rows.value[0]
  if (!row) {
    schedule.value = null
    scheduleId.value = ''
    return
  }
  try {
    const parsed = parseScheduleBackup(row.payload)
    schedule.value = parsed
    scheduleId.value = row.id
    week.value = Math.min(Math.max(weekForDate(parsed), 1), parsed.totalWeeks)
    loadError.value = ''
  } catch {
    schedule.value = null
    scheduleId.value = row.id
    loadError.value = `课表「${row.name}」的数据无法读取，可以删除后重新导入。`
  }
}

async function run(action: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true
  try {
    await action()
    return true
  } catch (reason) {
    appStore.notify(reason instanceof Error ? reason.message : String(reason), 'error')
    return false
  } finally {
    busy.value = false
  }
}

function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }

function emptyBook(): ScheduleBook {
  const now = new Date()
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return {
    schemaVersion: 1, id: newId(), name: '我的课表', academicYear: `${year}-${year + 1}`,
    semester: '1', startDate: '2026-09-07', totalWeeks: 19, weekendMode: 'show',
    periods: QLU_PERIODS.map(period => ({ ...period })), noClassDates: [], courses: [], updatedAt: new Date().toISOString(),
  }
}

let saveQueue = Promise.resolve(true)
function saveBook(book: ScheduleBook, makeActive = false) {
  const snapshot = JSON.parse(JSON.stringify(book)) as ScheduleBook
  saveQueue = saveQueue.then(() => run(async () => {
    validateSchedule(snapshot)
    await window.qlu.invoke('saveSchedule', {
      id: snapshot.id, name: snapshot.name, payload: JSON.stringify(snapshot), makeActive,
    })
    await load(snapshot.id)
  }))
  return saveQueue
}

function createBlank() { void saveBook(emptyBook(), true) }

function openAddCourse() {
  returnToManager.value = managerOpen.value
  managerOpen.value = false
  editingCourse.value = null
  editorOpen.value = true
}

function openManager(tab: 'courses' | 'settings') {
  managerTab.value = tab
  managerOpen.value = true
}

function editFromDetail() {
  if (!selected.value) return
  returnToManager.value = false
  editingCourse.value = selected.value
  selected.value = null
  editorOpen.value = true
}

async function upsertCourse(course: ScheduleCourse) {
  if (!schedule.value) return
  const book: ScheduleBook = {
    ...schedule.value,
    courses: schedule.value.courses.some(item => item.id === course.id)
      ? schedule.value.courses.map(item => item.id === course.id ? course : item)
      : [...schedule.value.courses, course],
    updatedAt: new Date().toISOString(),
  }
  return saveBook(book, true)
}

async function onCourseSaved(course: ScheduleCourse) {
  if (!await upsertCourse(course)) return
  editorOpen.value = false
  if (returnToManager.value) managerOpen.value = true
  appStore.notify('课程已保存', 'success')
}

async function onCourseDeleted(courseId: string) {
  if (!schedule.value) return
  const book: ScheduleBook = {
    ...schedule.value,
    courses: schedule.value.courses.filter(item => item.id !== courseId),
    updatedAt: new Date().toISOString(),
  }
  if (!await saveBook(book, true)) return
  editorOpen.value = false
  if (returnToManager.value) managerOpen.value = true
  appStore.notify('课程已删除', 'success')
}

function onEditorCancel() {
  editorOpen.value = false
  if (returnToManager.value) managerOpen.value = true
}

async function onBookSaved(book: ScheduleBook) {
  await saveBook(book, true)
}

function requestDeleteBook() {
  managerOpen.value = false
  menu.value = null
  confirmDelete.value = true
}

function toggleMenu(target: 'import' | 'more') {
  menu.value = menu.value === target ? null : target
}

function openImportPreview(source: ScheduleImportSource) {
  if (source.kind === 'backup') {
    const book = parseScheduleBackup(source.payload || '')
    const meetings = book.courses.flatMap(course => course.meetings)
    importPreview.value = {
      schedule: book,
      scheduledMeetings: meetings.filter(meeting => meeting.weekday !== null).length,
      pendingMeetings: meetings.filter(meeting => meeting.weekday === null).length,
      warnings: [],
    }
  } else {
    importPreview.value = parseScheduleRows({ fileName: source.fileName, rows: source.rows || [] })
  }
  importMode.value = 'create'
  overwriteId.value = ''
}

function importFromFile() {
  menu.value = null
  void run(async () => {
    const filePath = await window.qlu.selectFile({
      title: '选择课表文件',
      filterName: '课表文件（xls/xlsx/备份 JSON）',
      extensions: ['xls', 'xlsx', 'json'],
    })
    if (!filePath) return
    const source = await window.qlu.invoke<ScheduleImportSource>('parseScheduleSource', { filePath })
    openImportPreview(source)
  })
}

const importState = appStore.state.scheduleImport

function importFromSchool() {
  menu.value = null
  void run(async () => {
    await appStore.startScheduleImport()
  })
}

function cancelSchoolImport() { void appStore.cancelScheduleImport() }

watch(() => importState.result, (source) => {
  if (!source) return
  try { openImportPreview(source) }
  catch (reason) { appStore.notify(reason instanceof Error ? reason.message : String(reason), 'error') }
  finally { importState.result = null }
}, { immediate: true })

async function confirmImport() {
  const preview = importPreview.value
  if (!preview) return
  if (importMode.value === 'overwrite' && !rows.value.some(row => row.id === overwriteId.value)) {
    appStore.notify('请选择要覆盖的课表', 'error')
    return
  }
  const target = importMode.value === 'overwrite' ? rows.value.find(row => row.id === overwriteId.value) : null
  const book: ScheduleBook = {
    ...preview.schedule,
    id: target ? target.id : newId(),
    name: target ? target.name : preview.schedule.name,
    updatedAt: new Date().toISOString(),
  }
  if (!await saveBook(book, true)) return
  importPreview.value = null
  appStore.notify(target ? `已覆盖「${book.name}」` : `已导入「${book.name}」`, 'success')
}

function exportBackup() {
  menu.value = null
  if (!schedule.value) return
  const safe = schedule.value.name.replace(/[^\p{L}\p{N}._-]/gu, '_')
  void run(async () => {
    const path = await window.qlu.saveTextFile({
      defaultName: `${safe}.lumatile-schedule.json`,
      title: '导出课表备份',
      contents: JSON.stringify(schedule.value),
    })
    if (path) {
      appStore.notify('课表备份已导出', 'success')
      void window.qlu.showItem(path)
    }
  })
}

function activate(row: StoredSchedule) {
  void run(async () => {
    await window.qlu.invoke('activateSchedule', { id: row.id })
    await load(row.id)
    switching.value = false
  })
}

function removeBook() {
  void run(async () => {
    await window.qlu.invoke('deleteSchedule', { id: scheduleId.value })
    confirmDelete.value = false
    await load()
    appStore.notify('课表已删除', 'success')
  })
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void load().catch(reason => appStore.notify(String(reason), 'error'))
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="page schedule-page">
    <div v-if="importState.running" class="school-import-status">
      <Loader2 class="spin" :size="15" />
      <span>{{ importState.status || '正在导入课表…' }}</span>
      <button class="text-button" @click="cancelSchoolImport">取消</button>
    </div>

    <button v-if="conflictIds.size" class="secondary-button" @click="conflictsOpen = true">本周有 {{ conflictIds.size }} 个冲突时段，查看全部冲突课程</button>
    <BaseModal v-if="conflictsOpen" title="本周冲突课程" dismissible @close="conflictsOpen = false">
      <p>以下课程时间重叠，请核对安排；仍可正常保存和编辑。</p>
      <button v-for="item in placedMeetings.filter(item => conflictIds.has(item.meeting.id))" :key="item.meeting.id" class="switch-row" @click="selected = item.course; conflictsOpen = false">{{ item.course.name }} · {{ meetingLine(item.meeting) }}</button>
    </BaseModal>
    <template v-if="schedule">
      <header class="schedule-header">
        <div class="schedule-heading">
          <span class="eyebrow">TIMETABLE</span>
          <h1>{{ schedule.name }}</h1>
          <p>{{ title }}<template v-if="dateRange"> · {{ dateRange }}</template><template v-if="rows.length > 1"> · 共 {{ rows.length }} 份课表</template></p>
        </div>
        <div class="schedule-controls">
          <div class="week-nav" role="group" aria-label="周次切换">
            <button class="icon-button week-arrow" :disabled="week <= 1" aria-label="上一周" @click="changeWeek(-1)"><ChevronLeft :size="18" /></button>
            <label class="week-picker">
              <select v-model.number="week" aria-label="选择周次">
                <option v-for="item in schedule.totalWeeks" :key="item" :value="item">第 {{ item }} 周</option>
              </select>
            </label>
            <button class="icon-button week-arrow" :disabled="week >= schedule.totalWeeks" aria-label="下一周" @click="changeWeek(1)"><ChevronRight :size="18" /></button>
            <button v-if="!isCurrentWeek" class="text-button back-to-current" @click="backToCurrentWeek">回到本周</button>
          </div>
          <div class="schedule-actions">
            <button class="primary-button" :disabled="busy" @click="openAddCourse"><Plus :size="15" /> 添加课程</button>
            <div class="menu-anchor">
              <button class="secondary-button" :disabled="busy" @click="toggleMenu('import')">导入 <ChevronDown :size="14" /></button>
              <div v-if="menu === 'import'" class="menu-pop">
                <button :disabled="busy" @click="importFromSchool"><Download :size="15" /> 从教务导入…</button>
                <button :disabled="busy" @click="importFromFile"><FolderOpen :size="15" /> 从文件导入…</button>
              </div>
            </div>
            <button class="secondary-button" :disabled="busy" @click="openManager('courses')"><BookOpen :size="15" /> 课程管理<span v-if="pendingCount" class="pending-badge">{{ pendingCount }}</span></button>
            <button class="secondary-button" :disabled="busy" @click="openManager('settings')"><SlidersHorizontal :size="15" /> 课表设置</button>
            <div class="menu-anchor">
              <button class="secondary-button schedule-more" :disabled="busy" aria-label="更多操作" @click="toggleMenu('more')"><MoreHorizontal :size="16" /></button>
              <div v-if="menu === 'more'" class="menu-pop">
                <button :disabled="busy" @click="switching = true; menu = null"><Repeat :size="15" /> 切换课表…</button>
                <button :disabled="busy" @click="exportBackup"><Download :size="15" /> 导出备份…</button>
                <button class="menu-danger" :disabled="busy" @click="requestDeleteBook"><Trash2 :size="15" /> 删除课表…</button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div class="timetable-scroll">
        <div class="timetable" :style="{ '--day-count': days.length }">
          <div class="tt-corner">节次</div>
          <div
            v-for="day in days" :key="`head-${day}`"
            class="tt-day" :class="{ 'tt-today': isCurrentWeek && day === todayWeekday }"
            :style="{ gridColumn: String(columnFor(day)) }"
          >
            <span class="tt-day-name">周{{ weekdayName(day) }}</span>
            <span class="tt-day-date">
              <template v-if="dayDate(day)">{{ dayDate(day)!.getMonth() + 1 }}/{{ dayDate(day)!.getDate() }}</template>
            </span>
          </div>

          <div
            v-for="day in days" :key="`bg-${day}`"
            class="tt-col" :class="{ 'tt-col-today': isCurrentWeek && day === todayWeekday, 'tt-col-noclass': noClass(day) }"
            :style="{ gridColumn: String(columnFor(day)) }"
          >
            <span v-if="noClass(day)" class="tt-noclass-reason">{{ noClass(day)!.reason || '本日停课' }}</span>
          </div>

          <div v-for="period in 11" :key="`period-${period}`" class="tt-period" :style="{ gridRow: String(period + 1) }">
            <strong>{{ period }}</strong>
            <span>{{ periodStart(period) }}</span>
          </div>

          <button
            v-for="item in placedMeetings" :key="item.meeting.id"
            class="tt-course" :style="{ '--course': item.course.color, gridColumn: String(columnFor(item.meeting.weekday!)), gridRow: `${item.meeting.startPeriod! + 1} / span ${item.meeting.endPeriod! - item.meeting.startPeriod! + 1}` }"
            @click="selected = item.course"
          >
            <strong>{{ item.course.name }}</strong>
            <small v-if="item.meeting.location">{{ item.meeting.location }}</small>
          </button>
        </div>
        <div v-if="!placedMeetings.length" class="tt-empty-hint"><CalendarDays :size="18" /> 本周没有课程安排</div>
      </div>
    </template>

    <template v-else-if="loadError">
      <PageHeader eyebrow="TIMETABLE" title="课表" description="课表数据出现问题，暂时无法显示。" />
      <section class="empty-card"><div class="empty-icon"><CalendarDays :size="25" /></div><h3>无法读取课表</h3><p>{{ loadError }}</p><button class="secondary-button" @click="switching = true">切换课表</button><button class="danger-ghost" @click="confirmDelete = true">删除无法读取的课表</button></section>
    </template>

    <template v-else>
      <PageHeader eyebrow="TIMETABLE" title="课表" description="把一学期的课程安排在一张周视图里，本地保存，随开随看。" />
      <section class="empty-card schedule-empty">
        <div class="empty-icon"><CalendarDays :size="28" /></div>
        <h3>还没有课表</h3>
        <p>新建一份空白课表手工维护，或导入教务导出的课表文件和同学分享的备份。</p>
        <div class="empty-actions">
          <button class="primary-button" :disabled="busy" @click="importFromSchool"><Download :size="16" /> 从教务导入</button>
          <button class="secondary-button" :disabled="busy" @click="importFromFile"><FolderOpen :size="16" /> 从文件导入…</button>
          <button class="secondary-button" :disabled="busy" @click="createBlank"><FilePlus2 :size="16" /> 新建空白课表</button>
        </div>
      </section>
    </template>

    <BaseModal v-if="selected" :title="selected.name" dismissible @close="selected = null">
      <div class="course-detail">
        <p v-if="selected.teachers.length" class="course-detail-line"><strong>教师</strong>{{ selected.teachers.join('、') }}</p>
        <p v-if="selected.code" class="course-detail-line"><strong>课程代码</strong>{{ selected.code }}</p>
        <p v-if="selected.teachingClass" class="course-detail-line"><strong>教学班</strong>{{ selected.teachingClass }}</p>
        <p v-if="selected.credit !== null" class="course-detail-line"><strong>学分</strong>{{ selected.credit }}</p>
        <div class="course-detail-meetings">
          <div v-for="meeting in selected.meetings" :key="meeting.id" class="course-detail-meeting">
            <span>{{ meetingLine(meeting) }}</span>
            <small>{{ formatWeeks(meeting.weeks) }}</small>
          </div>
          <p v-if="!selected.meetings.length" class="course-detail-line">这门课程还没有安排上课时段。</p>
        </div>
        <p v-if="selected.note" class="course-detail-line"><strong>备注</strong>{{ selected.note }}</p>
      </div>
      <div class="modal-actions course-detail-actions">
        <button class="secondary-button" @click="editFromDetail"><Pencil :size="15" /> 编辑课程</button>
      </div>
    </BaseModal>

    <ScheduleCourseEditor
      v-if="schedule && editorOpen"
      :key="editingCourse?.id || 'new'"
      :book="schedule" :course="editingCourse"
      @cancel="onEditorCancel" @saved="onCourseSaved" @deleted="onCourseDeleted"
    />

    <ScheduleManager
      v-if="schedule && managerOpen"
      :book="schedule" :initial-tab="managerTab"
      @cancel="managerOpen = false" @add="openAddCourse"
      @edit="(course: ScheduleCourse) => { returnToManager = true; editingCourse = course; managerOpen = false; editorOpen = true }"
      @saved="onBookSaved" @delete-book="requestDeleteBook"
    />

    <BaseModal v-if="switching" title="切换课表" dismissible @close="switching = false">
      <div class="switch-list">
        <button
          v-for="row in rows" :key="row.id"
          class="switch-row" :class="{ active: row.id === scheduleId }"
          @click="activate(row)"
        >
          <span class="switch-main"><strong>{{ row.name }}</strong><small>{{ formatTime(row.updatedAt) }}</small></span>
          <span v-if="row.isActive || row.id === scheduleId" class="switch-badge"><Check :size="14" /> 当前</span>
        </button>
      </div>
      <div class="modal-actions switch-actions">
        <button class="secondary-button" :disabled="busy" @click="createBlank"><FilePlus2 :size="15" /> 新建空白课表</button>
      </div>
    </BaseModal>

    <BaseModal v-if="confirmDelete" title="删除课表">
      <p class="modal-lead">将删除「{{ schedule?.name }}」及其全部 {{ schedule?.courses.length ?? 0 }} 门课程记录，此操作无法恢复。</p>
      <div class="modal-actions">
        <button class="secondary-button" @click="confirmDelete = false">取消</button>
        <button class="danger-ghost" :disabled="busy" @click="removeBook"><Trash2 :size="15" /> 确认删除</button>
      </div>
    </BaseModal>

    <BaseModal v-if="importPreview" class="modal-wide" title="导入预览" dismissible @close="importPreview = null">
      <div class="import-preview">
        <div class="import-summary">
          <div class="import-stat"><strong>{{ importPreview.scheduledMeetings }}</strong><span>已排课程时段</span></div>
          <div class="import-stat" :class="{ warn: importPreview.pendingMeetings > 0 }"><strong>{{ importPreview.pendingMeetings }}</strong><span>待安排时段</span></div>
          <div class="import-stat"><strong>{{ importPreview.schedule.courses.length }}</strong><span>门课程</span></div>
        </div>
        <p class="import-name">「{{ importPreview.schedule.name }}」 · {{ importPreview.schedule.academicYear }} 第 {{ importPreview.schedule.semester === '2' ? '二' : '一' }} 学期</p>
        <p v-if="importPreview.warnings.length" class="import-warnings">
          {{ importPreview.warnings.length }} 个单元格未能识别（已在导入结果外忽略）：
          <span>{{ importPreview.warnings.slice(0, 3).join('；') }}</span>
        </p>

        <div class="import-mode" role="tablist">
          <button type="button" :class="{ active: importMode === 'create' }" @click="importMode = 'create'">创建新课表</button>
          <button type="button" :class="{ active: importMode === 'overwrite' }" @click="importMode = 'overwrite'">覆盖已有课表</button>
        </div>

        <div class="editor-grid">
          <label class="editor-field"><span>开学日期</span><input v-model="importPreview.schedule.startDate" type="date" /></label>
          <label class="editor-field"><span>学期周数</span><input v-model.number="importPreview.schedule.totalWeeks" type="number" min="1" max="30" /></label>
          <label v-if="importMode === 'overwrite'" class="editor-field span-2"><span>覆盖目标</span>
            <select v-model="overwriteId">
              <option value="" disabled>选择要覆盖的课表</option>
              <option v-for="row in rows" :key="row.id" :value="row.id">{{ row.name }}</option>
            </select>
          </label>
        </div>
        <p v-if="importMode === 'overwrite'" class="import-overwrite-hint">覆盖会替换目标课表中的全部课程与设置，且无法撤销。</p>
      </div>
      <div class="modal-actions">
        <button class="secondary-button" @click="importPreview = null">取消</button>
        <button class="primary-button" :disabled="busy || (importMode === 'overwrite' && !overwriteId)" @click="confirmImport">确认导入</button>
      </div>
    </BaseModal>

    <div v-if="menu" class="menu-backdrop" @click="menu = null" />
  </div>
</template>
