<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, BookOpen, CalendarOff, ChevronRight, Clock3, Plus, Save, Trash2 } from 'lucide-vue-next'
import type { ScheduleBook, ScheduleCourse, WeekendMode } from '@lumatile/contracts'

const props = defineProps<{ book: ScheduleBook; initialTab: 'courses' | 'settings' }>()
const emit = defineEmits<{ close: []; add: []; edit: [course: ScheduleCourse]; saved: [book: ScheduleBook]; deleteBook: [] }>()
const tab = ref(props.initialTab)
const draft = ref<ScheduleBook>(JSON.parse(JSON.stringify(props.book)))
const newOffDate = ref('')
const newOffReason = ref('停课')

function pending(course: ScheduleCourse) { return course.meetings.some(meeting => meeting.weekday === null) }
function addNoClassDate() {
  if (!newOffDate.value || draft.value.noClassDates.some(item => item.date === newOffDate.value)) return
  draft.value.noClassDates.push({ date: newOffDate.value, reason: newOffReason.value.trim() || '停课' })
  draft.value.noClassDates.sort((a, b) => a.date.localeCompare(b.date))
  newOffDate.value = ''
}
function save() { emit('saved', { ...draft.value, updatedAt: new Date().toISOString() }) }
</script>

<template>
  <section class="manager-page">
    <header><button @click="emit('close')"><ArrowLeft /></button><h1>课表管理</h1><span /></header>
    <div class="tabs"><button :class="{ active: tab === 'courses' }" @click="tab = 'courses'">课程</button><button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button></div>
    <main v-if="tab === 'courses'">
      <button class="primary add-course" @click="emit('add')"><Plus />添加课程</button>
      <div v-if="!book.courses.length" class="manager-empty"><BookOpen /><strong>暂无课程</strong><span>可以手工添加，或回到课表页从教务文件导入。</span></div>
      <button v-for="course in book.courses" :key="course.id" class="course-row" @click="emit('edit', course)">
        <i :style="{ background: course.color }" /><span><strong>{{ course.name }}</strong><small>{{ course.teachers.join('、') || '教师待定' }} · {{ course.meetings.length }} 个时段</small></span><em v-if="pending(course)">待安排</em><ChevronRight />
      </button>
    </main>
    <main v-else>
      <section class="settings-group">
        <h2>学期</h2>
        <div class="settings-card">
          <label><span>课表名称</span><input v-model="draft.name" /></label>
          <label><span>开学日期</span><input v-model="draft.startDate" type="date" /></label>
          <label><span>学期周数</span><input v-model.number="draft.totalWeeks" type="number" min="1" max="30" /></label>
          <label><span>周末显示</span><select v-model="draft.weekendMode"><option value="auto">有课时显示</option><option value="show">始终显示</option><option value="hide">始终隐藏</option></select></label>
        </div>
      </section>
      <section class="settings-group">
        <h2><CalendarOff />整天停课</h2>
        <div class="settings-card off-adder"><input v-model="newOffDate" type="date" /><input v-model="newOffReason" placeholder="原因" /><button @click="addNoClassDate"><Plus /></button></div>
        <div v-if="!draft.noClassDates.length" class="setting-hint">尚未设置特殊停课日期</div>
        <div v-for="(item, index) in draft.noClassDates" :key="item.date" class="off-row"><span><strong>{{ item.date }}</strong><small>{{ item.reason }}</small></span><button @click="draft.noClassDates.splice(index, 1)"><Trash2 /></button></div>
      </section>
      <section class="settings-group">
        <h2><Clock3 />上课时间</h2>
        <div class="period-list"><label v-for="period in draft.periods" :key="period.period"><strong>{{ period.period }}</strong><input v-model="period.start" type="time" /><span>—</span><input v-model="period.end" type="time" /></label></div>
      </section>
      <button class="primary" @click="save"><Save />保存课表设置</button>
      <button class="delete-book" @click="emit('deleteBook')"><Trash2 />删除这份课表</button>
    </main>
  </section>
</template>

<style scoped>
.manager-page{position:fixed;z-index:14;inset:0;overflow:auto;color:#18324b;background:#f4f8fc}.manager-page>header{position:sticky;z-index:3;top:0;display:grid;grid-template-columns:48px 1fr 48px;align-items:center;padding:calc(10px + env(safe-area-inset-top)) 15px 10px;border-bottom:1px solid #dce8f2;background:rgba(244,248,252,.94);backdrop-filter:blur(12px)}.manager-page>header button{display:grid;place-items:center;width:40px;height:40px;border:0;color:inherit;background:none}.manager-page>header svg{width:21px}.manager-page h1{margin:0;text-align:center;font-size:18px}.tabs{position:sticky;z-index:3;top:calc(60px + env(safe-area-inset-top));display:grid;grid-template-columns:1fr 1fr;padding:5px 16px 9px;background:#f4f8fc}.tabs button{padding:10px;border:0;border-bottom:2px solid transparent;color:#73899d;background:none;font-weight:800}.tabs button.active{color:#075ebd;border-color:#0b76e8}.manager-page main{max-width:680px;margin:auto;padding:12px 16px calc(28px + env(safe-area-inset-bottom))}.add-course{margin-bottom:14px}.course-row{display:grid;width:100%;grid-template-columns:6px 1fr auto auto;align-items:center;gap:12px;margin-bottom:10px;padding:15px;border:1px solid #dce8f2;border-radius:15px;color:inherit;background:#fff;text-align:left;box-shadow:0 5px 17px rgba(17,91,156,.06)}.course-row i{width:6px;height:38px;border-radius:9px}.course-row>span{display:flex;min-width:0;flex-direction:column;gap:4px}.course-row small{overflow:hidden;color:#71879a;text-overflow:ellipsis;white-space:nowrap}.course-row em{padding:4px 7px;border-radius:99px;color:#9a6200;background:#fff1cd;font-size:10px;font-style:normal}.course-row>svg{width:18px;color:#90a5b7}.manager-empty{display:flex;min-height:300px;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:#71879a;text-align:center}.manager-empty svg{width:38px}.manager-empty span{max-width:280px;font-size:12px}.settings-group{margin-bottom:20px}.settings-group h2{display:flex;align-items:center;gap:7px;margin:0 3px 8px;color:#60788e;font-size:12px}.settings-group h2 svg{width:16px}.settings-card,.period-list,.off-row{border:1px solid #dce8f2;border-radius:15px;background:#fff;box-shadow:0 5px 17px rgba(17,91,156,.05)}.settings-card label{display:grid;grid-template-columns:105px 1fr;align-items:center;min-height:52px;padding:0 14px;border-bottom:1px solid #e8eff5;font-size:13px;font-weight:700}.settings-card label:last-child{border-bottom:0}.settings-card input,.settings-card select{min-width:0;padding:9px 0;border:0;outline:0;color:inherit;background:transparent;text-align:right}.off-adder{display:grid;grid-template-columns:1.2fr 1fr 42px;gap:7px;padding:9px}.off-adder input{min-width:0;padding:9px 5px;border:1px solid #dce8f2;border-radius:9px}.off-adder button,.off-row button{display:grid;place-items:center;border:0;border-radius:9px;color:#075ebd;background:#e8f3ff}.off-adder svg,.off-row svg{width:17px}.setting-hint{padding:15px;color:#7a8fa1;font-size:12px;text-align:center}.off-row{display:flex;align-items:center;margin-top:8px;padding:11px 12px}.off-row span{display:flex;flex:1;flex-direction:column;gap:3px}.off-row small{color:#71879a}.off-row button{width:38px;height:38px;color:#a64235;background:#fff0ed}.period-list{overflow:hidden}.period-list label{display:grid;grid-template-columns:30px 1fr auto 1fr;align-items:center;gap:8px;padding:8px 13px;border-bottom:1px solid #e8eff5}.period-list label:last-child{border-bottom:0}.period-list input{min-width:0;padding:7px;border:1px solid #dce8f2;border-radius:8px;color:inherit;background:#f8fbfe}.delete-book{display:flex;width:100%;align-items:center;justify-content:center;gap:7px;margin-top:10px;padding:13px;border:0;color:#a64235;background:transparent;font-weight:800}.delete-book svg{width:18px}@media(prefers-color-scheme:dark){.manager-page,.tabs{color:#e8f2fb;background:#0d1722}.manager-page>header{border-color:#263c50;background:rgba(13,23,34,.94)}.course-row,.settings-card,.period-list,.off-row{border-color:#263c50;background:#142231}.settings-card label,.period-list label{border-color:#263c50}.tabs button.active{color:#62b5ff}.off-adder input,.period-list input{color:#e8f2fb;border-color:#324c63;background:#0d1722}}
</style>
