<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, ChevronRight, Copy, Plus, Save, Trash2 } from 'lucide-vue-next'
import { meetingConflicts, SCHEDULE_COLORS } from '@lumatile/academic-core'
import type { ScheduleBook, ScheduleCourse, ScheduleMeeting } from '@lumatile/contracts'
import { formatMeetingSummary, formatWeekSummary } from '@lumatile/schedule-ui'
import WeekPickerSheet from './WeekPickerSheet.vue'
import TimePickerSheet from './TimePickerSheet.vue'

const props = defineProps<{ book: ScheduleBook; course?: ScheduleCourse | null; saveError?: string }>()
const emit = defineEmits<{ close: []; saved: [course: ScheduleCourse]; deleted: [id: string] }>()

type MeetingDraft = Omit<ScheduleMeeting, 'teachers'> & { teacherText: string }

const id = props.course?.id || newId()
const name = ref(props.course?.name || '')
const code = ref(props.course?.code || '')
const teachingClass = ref(props.course?.teachingClass || '')
const teacherText = ref(props.course?.teachers.join('、') || '')
const credit = ref<number | null>(props.course?.credit ?? null)
const color = ref(props.course?.color || SCHEDULE_COLORS[props.book.courses.length % SCHEDULE_COLORS.length])
const note = ref(props.course?.note || '')
const error = ref('')
const meetings = ref<MeetingDraft[]>((props.course?.meetings.length ? props.course.meetings : [blankMeeting()]).map(meeting => ({
  ...meeting,
  weeks: [...meeting.weeks],
  teacherText: meeting.teachers.join('、'),
})))

const weekSheetId = ref<string | null>(null)
const timeSheetId = ref<string | null>(null)
const weekSheetOpen = ref(false)
const timeSheetOpen = ref(false)
const weekSheetMeeting = computed(() => meetings.value.find(meeting => meeting.id === weekSheetId.value) || null)
const timeSheetMeeting = computed(() => meetings.value.find(meeting => meeting.id === timeSheetId.value) || null)

const conflict = computed(() => {
  const drafts = meetings.value.map(meeting => ({ ...meeting, teachers: [] }))
  const ids = new Set(drafts.map(meeting => meeting.id))
  return meetingConflicts([...props.book.courses.filter(course => course.id !== id).flatMap(course => course.meetings), ...drafts])
    .some(pair => pair.some(meetingId => ids.has(meetingId)))
})

function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
function blankMeeting(): ScheduleMeeting {
  return { id: newId(), weeks: Array.from({ length: props.book.totalWeeks }, (_, index) => index + 1), weekday: null, startPeriod: null, endPeriod: null, location: '', teachers: [], source: 'manual' }
}
function splitNames(value: string) { return value.split(/[、,，/]/).map(item => item.trim()).filter(Boolean) }
function addMeeting(source?: MeetingDraft) {
  const base = source
    ? { ...source, id: newId(), weeks: [...source.weeks] }
    : { ...blankMeeting(), teacherText: '' }
  meetings.value.push(base)
}
function removeMeeting(index: number) {
  if (meetings.value.length === 1) meetings.value.splice(0, 1, { ...blankMeeting(), teacherText: '' })
  else meetings.value.splice(index, 1)
}
function openSheet(kind: 'week' | 'time', meeting: MeetingDraft) {
  if (kind === 'week') { weekSheetId.value = meeting.id; weekSheetOpen.value = true }
  else { timeSheetId.value = meeting.id; timeSheetOpen.value = true }
}
function applyWeeks(weeks: number[]) {
  const meeting = meetings.value.find(item => item.id === weekSheetId.value)
  if (meeting) meeting.weeks = weeks
  weekSheetOpen.value = false
}
function applyTime(value: { weekday: number | null; startPeriod: number | null; endPeriod: number | null }) {
  const meeting = meetings.value.find(item => item.id === timeSheetId.value)
  if (meeting) {
    meeting.weekday = value.weekday
    meeting.startPeriod = value.startPeriod
    meeting.endPeriod = value.endPeriod
  }
  timeSheetOpen.value = false
}
function meetingSummary(meeting: MeetingDraft) {
  return formatMeetingSummary(meeting.weekday, meeting.startPeriod, meeting.endPeriod)
}
function handleBack() {
  if (weekSheetOpen.value) { weekSheetOpen.value = false; return true }
  if (timeSheetOpen.value) { timeSheetOpen.value = false; return true }
  return false
}
defineExpose({ handleBack })

function save() {
  error.value = ''
  if (!name.value.trim()) { error.value = '请填写课程名称'; return }
  try {
    const normalized = meetings.value.map(meeting => {
      const weeks = [...new Set(meeting.weeks)].filter(week => week >= 1 && week <= props.book.totalWeeks).sort((left, right) => left - right)
      if (!weeks.length) throw new Error('请至少选择一个周次')
      const pending = meeting.weekday === null
      const startPeriod = pending ? null : Number(meeting.startPeriod)
      const endPeriod = pending ? null : Number(meeting.endPeriod)
      if (!pending && (!startPeriod || !endPeriod || startPeriod > endPeriod)) throw new Error('请检查上课时间')
      return { ...meeting, weeks, startPeriod, endPeriod, teachers: splitNames(meeting.teacherText), source: 'manual' as const }
    })
    emit('saved', {
      id, name: name.value.trim(), code: code.value.trim(), teachingClass: teachingClass.value.trim(),
      teachers: splitNames(teacherText.value), credit: credit.value || null, color: color.value,
      note: note.value.trim(), meetings: normalized.map(({ teacherText: _teacherText, ...meeting }) => meeting),
    })
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
</script>

<template>
  <section class="editor-page">
    <header><button @click="emit('close')"><ArrowLeft /></button><h1>{{ course ? '编辑课程' : '添加课程' }}</h1><button class="save-link" @click="save">保存</button></header>
    <main>
      <p v-if="error || saveError" class="form-error" role="alert">{{ error || saveError }}</p><p v-if="conflict" role="status">该时段与其他课程重叠，请核对；仍可保存。</p>
      <section class="form-card course-basics">
        <label class="course-name"><span>课程名称</span><input v-model="name" placeholder="例如：操作系统" /></label>
        <label><span>任课教师</span><input v-model="teacherText" placeholder="多人用顿号分隔" /></label>
        <label><span>课程代码</span><input v-model="code" placeholder="选填" /></label>
        <label><span>教学班</span><input v-model="teachingClass" placeholder="选填" /></label>
        <label><span>学分</span><input v-model.number="credit" type="number" min="0" step="0.5" placeholder="选填" /></label>
        <div class="color-row"><span>颜色</span><button v-for="item in SCHEDULE_COLORS" :key="item" :class="{ active: color === item }" :style="{ background: item }" @click="color = item" /></div>
      </section>

      <section v-for="(meeting, index) in meetings" :key="meeting.id" class="meeting-editor">
        <header><span>时段 {{ index + 1 }}</span><div><button title="复制" @click="addMeeting(meeting)"><Copy /></button><button title="删除" @click="removeMeeting(index)"><Trash2 /></button></div></header>
        <div class="form-card">
          <button type="button" class="picker-row" @click="openSheet('week', meeting)">
            <span>周数</span><strong :class="{ unset: !meeting.weeks.length }">{{ formatWeekSummary(meeting.weeks) }}</strong><ChevronRight />
          </button>
          <button type="button" class="picker-row" @click="openSheet('time', meeting)">
            <span>上课时间</span><strong :class="{ unset: meeting.weekday === null }">{{ meetingSummary(meeting) }}</strong><ChevronRight />
          </button>
          <label><span>教室</span><input v-model="meeting.location" placeholder="选填" /></label>
          <label><span>本时段教师</span><input v-model="meeting.teacherText" placeholder="留空使用课程教师" /></label>
        </div>
      </section>
      <button class="add-period" @click="addMeeting()"><Plus />添加另一个时段</button>
      <label class="form-card note-field"><span>备注</span><textarea v-model="note" rows="3" placeholder="选填" /></label>
      <button class="primary" @click="save"><Save />保存课程</button>
      <button v-if="course" class="delete-course" @click="emit('deleted', id)"><Trash2 />删除课程</button>
    </main>

    <WeekPickerSheet
      v-if="weekSheetMeeting"
      :open="weekSheetOpen" :weeks="weekSheetMeeting.weeks" :total-weeks="book.totalWeeks"
      @close="weekSheetOpen = false" @save="applyWeeks"
    />
    <TimePickerSheet
      v-if="timeSheetMeeting"
      :open="timeSheetOpen" :weekday="timeSheetMeeting.weekday" :start-period="timeSheetMeeting.startPeriod"
      :end-period="timeSheetMeeting.endPeriod" :periods="book.periods"
      @close="timeSheetOpen = false" @save="applyTime"
    />
  </section>
</template>

<style scoped>
.editor-page{position:fixed;z-index:15;top:0;right:0;bottom:0;left:0;overflow:auto;color:#18324b;background:#f4f8fc}.editor-page>header{position:sticky;z-index:2;top:0;display:grid;grid-template-columns:70px 1fr 70px;align-items:center;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;border-bottom:1px solid #dce8f2;background:rgba(244,248,252,.94);backdrop-filter:blur(12px)}header h1{margin:0;text-align:center;font-size:18px}.editor-page>header button{display:flex;align-items:center;border:0;color:#18324b;background:none}.editor-page>header svg{width:21px}.editor-page>header .save-link{justify-content:flex-end;color:#075ebd;font-weight:800}.editor-page main{max-width:680px;margin:auto;padding:15px 16px calc(30px + env(safe-area-inset-bottom))}.form-error{padding:11px 13px;border-radius:12px;color:#984436;background:#ffebe7;font-size:13px}.form-card{margin-bottom:15px;padding:4px 15px;border:1px solid #dce8f2;border-radius:17px;background:#fff;box-shadow:0 6px 20px rgba(17,91,156,.06)}.form-card label,.note-field{display:grid;grid-template-columns:105px 1fr;align-items:center;gap:12px;min-height:51px;border-bottom:1px solid #e8eff5;font-size:13px;font-weight:700}.form-card label:last-child{border-bottom:0}.form-card input,.form-card select,.form-card textarea{min-width:0;width:100%;padding:10px 0;border:0;outline:0;color:#18324b;background:transparent;text-align:right}.form-card textarea{resize:vertical;text-align:left}.picker-row{display:grid;grid-template-columns:105px 1fr auto;align-items:center;gap:12px;width:100%;min-height:51px;border:0;border-bottom:1px solid #e8eff5;color:#18324b;background:none;font-size:13px;text-align:left}.picker-row span{font-weight:700}.picker-row strong{overflow:hidden;font-weight:800;text-align:right;text-overflow:ellipsis;white-space:nowrap}.picker-row strong.unset{color:#8ba0b2;font-weight:600}.picker-row svg{width:16px;color:#a5b9c9}.form-card .picker-row:last-child{border-bottom:0}.course-name{grid-template-columns:1fr!important}.course-name input{font-size:20px!important;text-align:left!important}.color-row{display:flex;align-items:center;gap:9px;min-height:54px}.color-row>span{margin-right:auto;font-size:13px;font-weight:700}.color-row button{width:23px;height:23px;padding:0;border:2px solid transparent;border-radius:50%}.color-row button.active{border-color:#fff;box-shadow:0 0 0 2px #18324b}.meeting-editor>header{display:flex;align-items:center;justify-content:space-between;margin:20px 3px 8px;color:#60788e;font-size:12px;font-weight:800}.meeting-editor>header div{display:flex;gap:4px}.meeting-editor>header button{display:grid;place-items:center;width:34px;height:30px;border:0;color:#60788e;background:transparent}.meeting-editor>header svg{width:17px}.add-period,.delete-course{display:flex;width:100%;align-items:center;justify-content:center;gap:7px;margin:4px 0 15px;padding:13px;border:1px dashed #91b5d4;border-radius:13px;color:#075ebd;background:#eef6ff;font-weight:800}.add-period svg,.delete-course svg{width:18px}.note-field{padding:12px 15px}.primary{margin-top:5px}.delete-course{margin-top:10px;color:#a64235;border-color:#edb9b1;background:#fff0ed}@media(prefers-color-scheme:dark){.editor-page{color:#e8f2fb;background:#0d1722}.editor-page>header{border-color:#263c50;background:rgba(13,23,34,.94)}.editor-page>header button{color:#e8f2fb}.editor-page>header .save-link{color:#62b5ff}.form-card{border-color:#263c50;background:#142231}.form-card label{border-color:#263c50}.form-card input,.form-card select,.form-card textarea{color:#e8f2fb}.picker-row{border-color:#263c50;color:#e8f2fb}.picker-row strong{color:#e8f2fb}.picker-row strong.unset{color:#6d8496}.picker-row svg{color:#54728a}.color-row button.active{box-shadow:0 0 0 2px #e8f2fb}.add-period{color:#62b5ff;border-color:#365d7d;background:#132f48}}
</style>
