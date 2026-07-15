<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft, Calculator, Check, FileSpreadsheet, FolderOpen, Search,
  ShieldCheck, UploadCloud, AlertCircle, RefreshCw,
} from 'lucide-vue-next'
import { appStore } from '@/store'
import type { BootstrapData, GPACourse, GPAWorkbook, PageName } from '@/types'

const props = defineProps<{ data: BootstrapData }>()
const emit = defineEmits<{ navigate: [page: PageName] }>()
const workbook = ref<GPAWorkbook | null>(null)
const loading = ref(false)
const dragging = ref(false)
const error = ref('')
const query = ref('')

const calculable = computed(() => workbook.value?.courses.filter(
  course => course.grade_point !== null && course.credit !== null,
) || [])
const selected = computed(() => calculable.value.filter(course => course.included))
const totalCredits = computed(() => selected.value.reduce((sum, course) => sum + (course.credit || 0), 0))
const totalGradePoints = computed(() => selected.value.reduce(
  (sum, course) => sum + (course.credit || 0) * (course.grade_point || 0), 0,
))
const averageGPA = computed(() => totalCredits.value ? totalGradePoints.value / totalCredits.value : null)
const allSelected = computed(() => calculable.value.length > 0 && selected.value.length === calculable.value.length)
const visibleCourses = computed(() => {
  const courses = workbook.value?.courses || []
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return courses
  return courses.filter(course => `${course.name}${course.code}${course.college}${course.teaching_class}`.toLowerCase().includes(keyword))
})

const display = (value: number | null, digits: number) => value === null ? '—' : value.toFixed(digits)
const semesterText = (course: GPACourse) => [course.academic_year, course.semester ? `第 ${course.semester} 学期` : ''].filter(Boolean).join(' · ')

async function chooseFile() {
  const selectedPath = await window.qlu.selectFile(props.data.settings.default_output_dir)
  if (selectedPath) await loadFile(selectedPath)
}

async function loadFile(filePath: string) {
  if (!filePath) {
    error.value = '无法获取拖入文件的路径，请点击选择文件。'
    return
  }
  loading.value = true
  error.value = ''
  try {
    workbook.value = await window.qlu.invoke<GPAWorkbook>('parseGradeWorkbook', { filePath })
    query.value = ''
    appStore.notify(`已读取 ${workbook.value.courses.length} 门课程`, 'success')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    appStore.notify(error.value, 'error')
  } finally {
    loading.value = false
  }
}

async function drop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    error.value = '请选择 .xlsx 格式的分项成绩文件。'
    return
  }
  await loadFile(window.qlu.getFilePath(file))
}

function toggleAll() {
  const next = !allSelected.value
  for (const course of calculable.value) course.included = next
}

function toggleCourse(course: GPACourse) {
  if (!course.issue) course.included = !course.included
}

</script>

<template>
  <div class="page gpa-page">
    <button class="back-button" @click="emit('navigate', 'tools')"><ArrowLeft :size="17" /> 返回全部工具</button>
    <div class="grade-heading">
      <div class="tool-icon xl gpa"><Calculator :size="29" /></div>
      <div><span class="eyebrow">ACADEMIC TOOL</span><h1>绩点计算器</h1><p>导入分项成绩 Excel，勾选需要的课程并实时计算 GPA。</p></div>
      <div class="trust-badges"><span><ShieldCheck :size="15" /> 成绩仅在本地读取</span></div>
    </div>

    <section
      v-if="!workbook"
      class="gpa-dropzone"
      :class="{ dragging, loading }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="drop"
      @click="chooseFile"
    >
      <div class="drop-orb"><RefreshCw v-if="loading" class="spin" :size="30" /><UploadCloud v-else :size="31" /></div>
      <h2>{{ loading ? '正在读取成绩…' : '拖放 XLSX 文件到这里' }}</h2>
      <p>使用“分项成绩导出”工具生成的文件，或点击此处选择文件</p>
      <button class="primary-button" :disabled="loading" @click.stop="chooseFile"><FolderOpen :size="16" /> 选择 XLSX 文件</button>
      <div v-if="error" class="gpa-error"><AlertCircle :size="16" /> {{ error }}</div>
    </section>

    <template v-else>
      <section class="gpa-filebar">
        <div class="file-mark"><FileSpreadsheet :size="22" /></div>
        <div><strong>{{ workbook.fileName }}</strong><span>{{ workbook.rowCount }} 条成绩数据 · {{ workbook.courses.length }} 门课程</span></div>
        <button class="secondary-button" :disabled="loading" @click="chooseFile"><RefreshCw :class="{ spin: loading }" :size="15" /> 更换文件</button>
      </section>

      <section class="gpa-summary">
        <article><span>所选课程</span><strong>{{ selected.length }}</strong><small>/ {{ workbook.courses.length }} 门</small></article>
        <article><span>总学分</span><strong>{{ display(totalCredits, 2) }}</strong><small>所选课程</small></article>
        <article><span>总成绩点</span><strong>{{ display(totalGradePoints, 2) }}</strong><small>绩点 × 学分</small></article>
        <article class="primary"><span>加权平均 GPA</span><strong>{{ display(averageGPA, 3) }}</strong><small>满绩点 5.0</small></article>
      </section>

      <section class="gpa-controls">
        <button class="check-all" :class="{ active: allSelected }" @click="toggleAll"><span><Check :size="14" /></span>{{ allSelected ? '取消全选' : '选择全部可计算课程' }}</button>
        <label class="search-box compact"><Search :size="17" /><input v-model="query" placeholder="搜索课程…" /></label>
      </section>

      <div v-if="workbook.warnings.length" class="gpa-notice"><AlertCircle :size="16" /><span>有 {{ workbook.warnings.length }} 门课程无法自动计算，已保留原始成绩并取消勾选。</span></div>

      <section class="gpa-course-list">
        <article v-for="course in visibleCourses" :key="course.id" class="gpa-course" :class="{ invalid: course.issue }">
          <header>
            <button
              type="button"
              class="course-check"
              :class="{ active: course.included }"
              :aria-label="course.included ? `不计算${course.name}` : `计算${course.name}`"
              :aria-pressed="course.included"
              :disabled="Boolean(course.issue)"
              :title="course.issue || '纳入 GPA 计算'"
              @click="toggleCourse(course)"
            ><Check :size="14" /></button>
            <div class="course-title"><strong>{{ course.name }}</strong><span>{{ [course.code, course.college, course.teaching_class].filter(Boolean).join(' · ') || '未提供课程信息' }}</span></div>
            <span class="course-semester">{{ semesterText(course) || '学期未知' }}</span>
            <div class="course-number"><span>学分</span><strong>{{ display(course.credit, 1) }}</strong></div>
            <div class="course-number"><span>总评</span><strong>{{ course.final_score || '—' }}</strong></div>
            <div class="course-number point"><span>绩点</span><strong>{{ display(course.grade_point, 3) }}</strong></div>
          </header>
          <div class="score-table">
            <div class="score-head"><span>成绩分项</span><span>成绩</span></div>
            <div v-for="(component, index) in course.components" :key="`${course.id}-${index}`" class="score-row" :class="{ final: component.is_final }">
              <span>{{ component.name }}</span><strong>{{ component.score || '—' }}</strong>
            </div>
          </div>
          <div v-if="course.issue" class="course-issue"><AlertCircle :size="14" /> {{ course.issue }}，未纳入 GPA 计算</div>
        </article>
        <div v-if="!visibleCourses.length" class="gpa-empty">没有匹配的课程</div>
      </section>
    </template>
  </div>
</template>
