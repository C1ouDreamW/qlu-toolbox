<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Copy, Plus, Save, Trash2 } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'
import { meetingConflicts, SCHEDULE_COLORS } from '@lumatile/academic-core'
import { formatMeetingSummary, formatWeekSummary } from '@lumatile/schedule-ui'
import type { ScheduleBook, ScheduleCourse, ScheduleMeeting } from '@lumatile/contracts'
import ScheduleWeekPicker from './ScheduleWeekPicker.vue'
import ScheduleTimePicker from './ScheduleTimePicker.vue'

const props = defineProps<{ book: ScheduleBook; course?: ScheduleCourse | null }>()
const emit = defineEmits<{ cancel: []; saved: [course: ScheduleCourse]; deleted: [id: string] }>()

type MeetingDraft = ScheduleMeeting & { teacherText: string }
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
  teacherText: meeting.teachers.join('、'),
})))

const picker = ref<{ kind: 'week' | 'time'; meetingId: string; anchorEl: HTMLElement } | null>(null)
const pickerMeeting = computed(() => meetings.value.find(meeting => meeting.id === picker.value?.meetingId) || null)

const conflict = computed(() => {
  try {
    const drafts = meetings.value.map(meeting => ({ ...meeting, teachers: [] }))
    const ids = new Set(drafts.map(meeting => meeting.id))
    return meetingConflicts([...props.book.courses.filter(course => course.id !== id).flatMap(course => course.meetings), ...drafts])
      .some(pair => pair.some(meetingId => ids.has(meetingId)))
  } catch { return false }
})

function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
function blankMeeting(): MeetingDraft {
  return {
    id: newId(), weeks: Array.from({ length: props.book.totalWeeks }, (_, index) => index + 1),
    weekday: null, startPeriod: null, endPeriod: null, location: '', teachers: [], source: 'manual',
    teacherText: '',
  }
}
function splitNames(value: string) { return value.split(/[、,，/]/).map(item => item.trim()).filter(Boolean) }
function addMeeting(source?: MeetingDraft) {
  meetings.value.push(source ? { ...source, id: newId() } : blankMeeting())
}
function removeMeeting(index: number) {
  if (meetings.value.length === 1) meetings.value[0] = blankMeeting()
  else meetings.value.splice(index, 1)
}

function openPicker(kind: 'week' | 'time', meeting: MeetingDraft, event: MouseEvent) {
  picker.value = { kind, meetingId: meeting.id, anchorEl: event.currentTarget as HTMLElement }
}
function closePicker() { picker.value = null }
function applyWeeks(weeks: number[]) {
  if (pickerMeeting.value) pickerMeeting.value.weeks = weeks
  closePicker()
}
function applyTime(value: { weekday: number | null; startPeriod: number | null; endPeriod: number | null }) {
  if (pickerMeeting.value) {
    pickerMeeting.value.weekday = value.weekday
    pickerMeeting.value.startPeriod = value.startPeriod
    pickerMeeting.value.endPeriod = value.endPeriod
  }
  closePicker()
}

function save() {
  error.value = ''
  if (!name.value.trim()) { error.value = '请填写课程名称'; return }
  try {
    const normalized = meetings.value.map(meeting => {
      if (!meeting.weeks.length) throw new Error('周数不能为空，请在周数选择中勾选上课周次')
      const pending = meeting.weekday === null
      const startPeriod = pending ? null : meeting.startPeriod
      const endPeriod = pending ? null : meeting.endPeriod
      if (!pending && (!startPeriod || !endPeriod || startPeriod > endPeriod)) throw new Error('请检查上课节次')
      return { ...meeting, weeks: [...meeting.weeks].sort((left, right) => left - right), startPeriod, endPeriod, teachers: splitNames(meeting.teacherText), source: 'manual' as const }
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
  <BaseModal class="modal-wide" :title="course ? '编辑课程' : '添加课程'" dismissible @close="emit('cancel')">
    <div class="course-editor">
      <p v-if="error" class="form-error">{{ error }}</p><p v-if="conflict" role="status">该时段与其他课程重叠，请核对；仍可保存。</p>
      <div class="editor-grid">
        <label class="editor-field span-2"><span>课程名称</span><input v-model="name" placeholder="例如：操作系统" /></label>
        <label class="editor-field"><span>任课教师</span><input v-model="teacherText" placeholder="多人用顿号分隔" /></label>
        <label class="editor-field"><span>学分</span><input v-model.number="credit" type="number" min="0" step="0.5" placeholder="选填" /></label>
        <label class="editor-field"><span>课程代码</span><input v-model="code" placeholder="选填" /></label>
        <label class="editor-field"><span>教学班</span><input v-model="teachingClass" placeholder="选填" /></label>
      </div>
      <div class="color-row"><span>颜色</span><button
        v-for="item in SCHEDULE_COLORS" :key="item" type="button"
        :class="{ active: color === item }" :style="{ background: item }" @click="color = item"
      /></div>

      <section v-for="(meeting, index) in meetings" :key="meeting.id" class="meeting-block">
        <header>
          <span>时段 {{ index + 1 }}</span>
          <span class="meeting-tools">
            <button type="button" title="复制该时段" @click="addMeeting(meeting)"><Copy :size="15" /></button>
            <button type="button" title="删除该时段" @click="removeMeeting(index)"><Trash2 :size="15" /></button>
          </span>
        </header>
        <div class="meeting-rows">
          <button type="button" class="picker-row" @click="openPicker('week', meeting, $event)">
            <span class="picker-label">周数</span>
            <span class="picker-value">{{ formatWeekSummary(meeting.weeks) }}</span>
            <ChevronRight :size="14" class="picker-chevron" />
          </button>
          <button type="button" class="picker-row" @click="openPicker('time', meeting, $event)">
            <span class="picker-label">上课时间</span>
            <span class="picker-value" :class="{ pending: meeting.weekday === null }">{{ formatMeetingSummary(meeting.weekday, meeting.startPeriod, meeting.endPeriod) }}</span>
            <ChevronRight :size="14" class="picker-chevron" />
          </button>
          <div class="editor-grid">
            <label class="editor-field"><span>教室</span><input v-model="meeting.location" placeholder="选填" /></label>
            <label class="editor-field"><span>本时段教师</span><input v-model="meeting.teacherText" placeholder="留空使用课程教师" /></label>
          </div>
        </div>
      </section>
      <button class="text-button add-meeting" type="button" @click="addMeeting()"><Plus :size="15" /> 添加另一个时段</button>
      <label class="editor-field note-field"><span>备注</span><textarea v-model="note" rows="2" placeholder="选填" /></label>
    </div>
    <div class="modal-actions editor-actions">
      <button v-if="course" class="danger-ghost" @click="emit('deleted', id)"><Trash2 :size="15" /> 删除课程</button>
      <button class="primary-button" @click="save"><Save :size="15" /> 保存课程</button>
    </div>

    <ScheduleWeekPicker
      v-if="picker?.kind === 'week' && pickerMeeting"
      :anchor-el="picker.anchorEl" :weeks="pickerMeeting.weeks" :total-weeks="book.totalWeeks"
      @close="closePicker" @save="applyWeeks"
    />
    <ScheduleTimePicker
      v-if="picker?.kind === 'time' && pickerMeeting"
      :anchor-el="picker.anchorEl" :weekday="pickerMeeting.weekday" :start-period="pickerMeeting.startPeriod"
      :end-period="pickerMeeting.endPeriod" :periods="book.periods"
      @close="closePicker" @save="applyTime"
    />
  </BaseModal>
</template>

<style scoped>
.meeting-rows{display:grid;gap:8px}
.picker-row{display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:0 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2);text-align:left;transition:border-color .15s ease,background-color .15s ease}
.picker-row:hover{border-color:var(--line-strong);background:color-mix(in srgb,var(--surface-2) 60%,var(--surface))}
.picker-row:focus-visible{outline:none;border-color:var(--primary)}
.picker-label{flex:0 0 auto;color:var(--muted);font-size:var(--font-caption)}
.picker-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-weight:600}
.picker-value.pending{color:var(--muted);font-weight:500}
.picker-chevron{flex:0 0 auto;color:var(--faint)}
</style>
