<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, Plus, Save, Trash2 } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'
import { meetingConflicts, parseWeekExpression, SCHEDULE_COLORS } from '@lumatile/academic-core'
import type { ScheduleBook, ScheduleCourse, ScheduleMeeting } from '@lumatile/contracts'

const props = defineProps<{ book: ScheduleBook; course?: ScheduleCourse | null }>()
const emit = defineEmits<{ cancel: []; saved: [course: ScheduleCourse]; deleted: [id: string] }>()

type MeetingDraft = Omit<ScheduleMeeting, 'weeks' | 'teachers'> & { weekText: string; teacherText: string }
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
  weekText: formatWeeks(meeting.weeks),
  teacherText: meeting.teachers.join('、'),
})))

const conflict = computed(() => {
  try {
    const drafts = meetings.value.map(meeting => ({ ...meeting, weeks: parseWeekExpression(meeting.weekText, props.book.totalWeeks), teachers: [] }))
    const ids = new Set(drafts.map(meeting => meeting.id))
    return meetingConflicts([...props.book.courses.filter(course => course.id !== id).flatMap(course => course.meetings), ...drafts])
      .some(pair => pair.some(meetingId => ids.has(meetingId)))
  } catch { return false }
})

function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
function blankMeeting(): ScheduleMeeting {
  return {
    id: newId(), weeks: Array.from({ length: props.book.totalWeeks }, (_, index) => index + 1),
    weekday: null, startPeriod: null, endPeriod: null, location: '', teachers: [], source: 'manual',
  }
}
function formatWeeks(weeks: number[]) {
  if (weeks.length === props.book.totalWeeks) return `1-${props.book.totalWeeks}`
  return weeks.join(',')
}
function splitNames(value: string) { return value.split(/[、,，/]/).map(item => item.trim()).filter(Boolean) }
function addMeeting(source?: MeetingDraft) {
  const base = source ? { ...source, id: newId() } : { ...blankMeeting(), weekText: `1-${props.book.totalWeeks}`, teacherText: '' }
  meetings.value.push(base)
}
function removeMeeting(index: number) {
  if (meetings.value.length === 1) meetings.value[0] = { ...blankMeeting(), weekText: `1-${props.book.totalWeeks}`, teacherText: '' }
  else meetings.value.splice(index, 1)
}
function save() {
  error.value = ''
  if (!name.value.trim()) { error.value = '请填写课程名称'; return }
  try {
    const normalized = meetings.value.map(meeting => {
      const weeks = parseWeekExpression(meeting.weekText, props.book.totalWeeks)
      if (!weeks.length) throw new Error('周数不能为空，请填写如 1-16、单1-15 或 双2-16')
      const pending = meeting.weekday === null
      const startPeriod = pending ? null : Number(meeting.startPeriod)
      const endPeriod = pending ? null : Number(meeting.endPeriod)
      if (!pending && (!startPeriod || !endPeriod || startPeriod > endPeriod)) throw new Error('请检查上课节次')
      return { ...meeting, weeks, startPeriod, endPeriod, teachers: splitNames(meeting.teacherText), source: 'manual' as const }
    })
    emit('saved', {
      id, name: name.value.trim(), code: code.value.trim(), teachingClass: teachingClass.value.trim(),
      teachers: splitNames(teacherText.value), credit: credit.value || null, color: color.value,
      note: note.value.trim(), meetings: normalized.map(({ weekText: _weekText, teacherText: _teacherText, ...meeting }) => meeting),
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
        <div class="editor-grid">
          <label class="editor-field"><span>周数</span><input v-model="meeting.weekText" placeholder="1-16 / 单1-15 / 1,3,5" /></label>
          <label class="editor-field"><span>星期</span>
            <select v-model="meeting.weekday">
              <option :value="null">待安排</option>
              <option v-for="day in 7" :key="day" :value="day">周{{ '一二三四五六日'[day - 1] }}</option>
            </select>
          </label>
          <template v-if="meeting.weekday !== null">
            <label class="editor-field"><span>开始节次</span>
              <select v-model="meeting.startPeriod">
                <option v-for="period in book.periods" :key="period.period" :value="period.period">第 {{ period.period }} 节 · {{ period.start }}</option>
              </select>
            </label>
            <label class="editor-field"><span>结束节次</span>
              <select v-model="meeting.endPeriod">
                <option v-for="period in book.periods" :key="period.period" :value="period.period">第 {{ period.period }} 节 · {{ period.end }}</option>
              </select>
            </label>
          </template>
          <label class="editor-field"><span>教室</span><input v-model="meeting.location" placeholder="选填" /></label>
          <label class="editor-field"><span>本时段教师</span><input v-model="meeting.teacherText" placeholder="留空使用课程教师" /></label>
        </div>
      </section>
      <button class="text-button add-meeting" type="button" @click="addMeeting()"><Plus :size="15" /> 添加另一个时段</button>
      <label class="editor-field note-field"><span>备注</span><textarea v-model="note" rows="2" placeholder="选填" /></label>
    </div>
    <div class="modal-actions editor-actions">
      <button v-if="course" class="danger-ghost" @click="emit('deleted', id)"><Trash2 :size="15" /> 删除课程</button>
      <button class="primary-button" @click="save"><Save :size="15" /> 保存课程</button>
    </div>
  </BaseModal>
</template>

