<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, Copy, Plus, Save, Trash2 } from 'lucide-vue-next'
import { parseWeekExpression, SCHEDULE_COLORS } from '@lumatile/academic-core'
import type { ScheduleBook, ScheduleCourse, ScheduleMeeting } from '@lumatile/contracts'

const props = defineProps<{ book: ScheduleBook; course?: ScheduleCourse | null }>()
const emit = defineEmits<{ close: []; saved: [course: ScheduleCourse]; deleted: [id: string] }>()

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

function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
function blankMeeting(): ScheduleMeeting {
  return { id: newId(), weeks: Array.from({ length: props.book.totalWeeks }, (_, index) => index + 1), weekday: null, startPeriod: null, endPeriod: null, location: '', teachers: [], source: 'manual' }
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
  <section class="editor-page">
    <header><button @click="emit('close')"><ArrowLeft /></button><h1>{{ course ? '编辑课程' : '添加课程' }}</h1><button class="save-link" @click="save">保存</button></header>
    <main>
      <p v-if="error" class="form-error">{{ error }}</p>
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
          <label><span>周数</span><input v-model="meeting.weekText" placeholder="1-16 / 单1-15 / 1,3,5" /></label>
          <label><span>星期</span><select v-model="meeting.weekday"><option :value="null">待安排</option><option v-for="day in 7" :key="day" :value="day">周{{ '一二三四五六日'[day - 1] }}</option></select></label>
          <template v-if="meeting.weekday !== null">
            <label><span>开始节次</span><select v-model="meeting.startPeriod"><option v-for="period in book.periods" :key="period.period" :value="period.period">第 {{ period.period }} 节 · {{ period.start }}</option></select></label>
            <label><span>结束节次</span><select v-model="meeting.endPeriod"><option v-for="period in book.periods" :key="period.period" :value="period.period">第 {{ period.period }} 节 · {{ period.end }}</option></select></label>
          </template>
          <label><span>教室</span><input v-model="meeting.location" placeholder="选填" /></label>
          <label><span>本时段教师</span><input v-model="meeting.teacherText" placeholder="留空使用课程教师" /></label>
        </div>
      </section>
      <button class="add-period" @click="addMeeting()"><Plus />添加另一个时段</button>
      <label class="form-card note-field"><span>备注</span><textarea v-model="note" rows="3" placeholder="选填" /></label>
      <button class="primary" @click="save"><Save />保存课程</button>
      <button v-if="course" class="delete-course" @click="emit('deleted', id)"><Trash2 />删除课程</button>
    </main>
  </section>
</template>

<style scoped>
.editor-page{position:fixed;z-index:15;inset:0;overflow:auto;color:#18324b;background:#f4f8fc}.editor-page>header{position:sticky;z-index:2;top:0;display:grid;grid-template-columns:70px 1fr 70px;align-items:center;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;border-bottom:1px solid #dce8f2;background:rgba(244,248,252,.94);backdrop-filter:blur(12px)}header h1{margin:0;text-align:center;font-size:18px}.editor-page>header button{display:flex;align-items:center;border:0;color:#18324b;background:none}.editor-page>header svg{width:21px}.editor-page>header .save-link{justify-content:flex-end;color:#075ebd;font-weight:800}.editor-page main{max-width:680px;margin:auto;padding:15px 16px calc(30px + env(safe-area-inset-bottom))}.form-error{padding:11px 13px;border-radius:12px;color:#984436;background:#ffebe7;font-size:13px}.form-card{margin-bottom:15px;padding:4px 15px;border:1px solid #dce8f2;border-radius:17px;background:#fff;box-shadow:0 6px 20px rgba(17,91,156,.06)}.form-card label,.note-field{display:grid;grid-template-columns:105px 1fr;align-items:center;gap:12px;min-height:51px;border-bottom:1px solid #e8eff5;font-size:13px;font-weight:700}.form-card label:last-child{border-bottom:0}.form-card input,.form-card select,.form-card textarea{min-width:0;width:100%;padding:10px 0;border:0;outline:0;color:#18324b;background:transparent;text-align:right}.form-card textarea{resize:vertical;text-align:left}.course-name{grid-template-columns:1fr!important}.course-name input{font-size:20px!important;text-align:left!important}.color-row{display:flex;align-items:center;gap:9px;min-height:54px}.color-row>span{margin-right:auto;font-size:13px;font-weight:700}.color-row button{width:23px;height:23px;padding:0;border:2px solid transparent;border-radius:50%}.color-row button.active{border-color:#fff;box-shadow:0 0 0 2px #18324b}.meeting-editor>header{display:flex;align-items:center;justify-content:space-between;margin:20px 3px 8px;color:#60788e;font-size:12px;font-weight:800}.meeting-editor>header div{display:flex;gap:4px}.meeting-editor>header button{display:grid;place-items:center;width:34px;height:30px;border:0;color:#60788e;background:transparent}.meeting-editor>header svg{width:17px}.add-period,.delete-course{display:flex;width:100%;align-items:center;justify-content:center;gap:7px;margin:4px 0 15px;padding:13px;border:1px dashed #91b5d4;border-radius:13px;color:#075ebd;background:#eef6ff;font-weight:800}.add-period svg,.delete-course svg{width:18px}.note-field{padding:12px 15px}.primary{margin-top:5px}.delete-course{margin-top:10px;color:#a64235;border-color:#edb9b1;background:#fff0ed}@media(prefers-color-scheme:dark){.editor-page{color:#e8f2fb;background:#0d1722}.editor-page>header{border-color:#263c50;background:rgba(13,23,34,.94)}.editor-page>header button{color:#e8f2fb}.editor-page>header .save-link{color:#62b5ff}.form-card{border-color:#263c50;background:#142231}.form-card label{border-color:#263c50}.form-card input,.form-card select,.form-card textarea{color:#e8f2fb}.color-row button.active{box-shadow:0 0 0 2px #e8f2fb}.add-period{color:#62b5ff;border-color:#365d7d;background:#132f48}}
</style>
