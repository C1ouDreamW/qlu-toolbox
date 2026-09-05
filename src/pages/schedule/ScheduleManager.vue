<script setup lang="ts">
import { ref } from 'vue'
import { CalendarOff, ChevronRight, Clock3, Plus, Trash2 } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'
import type { ScheduleBook, ScheduleCourse, WeekendMode } from '@lumatile/contracts'

const props = defineProps<{ book: ScheduleBook; initialTab: 'courses' | 'settings' }>()
const emit = defineEmits<{
  cancel: []; add: []; edit: [course: ScheduleCourse]; saved: [book: ScheduleBook]; deleteBook: []
}>()
const tab = ref(props.initialTab)
const draft = ref<ScheduleBook>(JSON.parse(JSON.stringify(props.book)))
const newOffDate = ref('')
const newOffReason = ref('停课')

function pending(course: ScheduleCourse) { return course.meetings.some(meeting => meeting.weekday === null) }
function save() { emit('saved', { ...draft.value, updatedAt: new Date().toISOString() }) }
function addNoClassDate() {
  if (!newOffDate.value || draft.value.noClassDates.some(item => item.date === newOffDate.value)) return
  draft.value.noClassDates.push({ date: newOffDate.value, reason: newOffReason.value.trim() || '停课' })
  draft.value.noClassDates.sort((left, right) => left.date.localeCompare(right.date))
  newOffDate.value = ''
  save()
}
function removeNoClassDate(index: number) {
  draft.value.noClassDates.splice(index, 1)
  save()
}
</script>

<template>
  <BaseModal class="modal-wide" title="课表管理" dismissible @close="emit('cancel')">
    <div class="manager-tabs" role="tablist">
      <button type="button" role="tab" :class="{ active: tab === 'courses' }" :aria-selected="tab === 'courses'" @click="tab = 'courses'">课程</button>
      <button type="button" role="tab" :class="{ active: tab === 'settings' }" :aria-selected="tab === 'settings'" @click="tab = 'settings'">课表设置</button>
    </div>

    <div v-if="tab === 'courses'" class="manager-courses">
      <button
        v-for="course in draft.courses" :key="course.id" type="button"
        class="manager-course-row" @click="emit('edit', course)"
      >
        <i :style="{ background: course.color }" />
        <span class="manager-course-main">
          <strong>{{ course.name }}</strong>
          <small>{{ course.teachers.join('、') || '教师待定' }} · {{ course.meetings.length }} 个时段</small>
        </span>
        <em v-if="pending(course)">待安排</em>
        <ChevronRight :size="16" />
      </button>
      <div v-if="!draft.courses.length" class="manager-empty">
        <p>暂无课程。可以手工添加，或稍后从教务文件导入。</p>
      </div>
    </div>

    <div v-else class="manager-settings">
      <section class="settings-group">
        <h2>学期</h2>
        <div class="settings-card">
          <label><span>课表名称</span><input v-model="draft.name" @change="save" /></label>
          <label><span>开学日期</span><input v-model="draft.startDate" type="date" @change="save" /></label>
          <label><span>学期周数</span><input v-model.number="draft.totalWeeks" type="number" min="1" max="30" @change="save" /></label>
          <label><span>周末显示</span>
            <select v-model="draft.weekendMode" @change="save">
              <option value="auto">有课时显示</option>
              <option value="show">始终显示</option>
              <option value="hide">始终隐藏</option>
            </select>
          </label>
        </div>
      </section>

      <section class="settings-group">
        <h2><CalendarOff :size="15" /> 整天停课</h2>
        <div class="off-adder">
          <input v-model="newOffDate" type="date" aria-label="停课日期" />
          <input v-model="newOffReason" placeholder="原因" aria-label="停课原因" />
          <button type="button" aria-label="添加停课日期" @click="addNoClassDate"><Plus :size="16" /></button>
        </div>
        <p v-if="!draft.noClassDates.length" class="setting-hint">尚未设置特殊停课日期</p>
        <div v-for="(item, index) in draft.noClassDates" :key="item.date" class="off-row">
          <span class="off-info"><strong>{{ item.date }}</strong><small>{{ item.reason }}</small></span>
          <button type="button" aria-label="移除停课日期" @click="removeNoClassDate(index)"><Trash2 :size="15" /></button>
        </div>
      </section>

      <section class="settings-group">
        <h2><Clock3 :size="15" /> 上课时间</h2>
        <div class="period-list">
          <label v-for="period in draft.periods" :key="period.period">
            <strong>第 {{ period.period }} 节</strong>
            <input v-model="period.start" type="time" @change="save" />
            <span>—</span>
            <input v-model="period.end" type="time" @change="save" />
          </label>
        </div>
      </section>
    </div>

    <div class="modal-actions manager-actions">
      <button class="danger-ghost" @click="emit('deleteBook')"><Trash2 :size="15" /> 删除这份课表</button>
      <button class="primary-button" @click="emit('add')"><Plus :size="15" /> 添加课程</button>
    </div>
  </BaseModal>
</template>
