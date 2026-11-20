<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  ArrowLeft, FileSpreadsheet, FolderOpen, Play, Square, Check, Circle,
  Loader2, LogIn, ExternalLink, RotateCcw, ChevronDown, ChevronUp,
  ShieldCheck, Wifi, Calculator, ArrowRight, Sparkles,
} from 'lucide-vue-next'
import BaseSelect from '@/components/BaseSelect.vue'
import { appStore } from '@/store'
import type { BootstrapData, PageName } from '@/types'

const props = defineProps<{ data: BootstrapData }>()
const api = window.lumatile
const emit = defineEmits<{ navigate: [page: PageName] }>()
const baseYear = Number(props.data.defaultAcademicYear)
const academicYears = Array.from({ length: 8 }, (_, index) => {
  const year = baseYear - index
  return `${year}-${year + 1}`
})
const academicYearOptions = academicYears.map(year => ({ value: year, label: `${year} 学年` }))
const form = reactive({
  academicYear: academicYears[0],
  semester: props.data.semesters['1'],
  outputDir: props.data.settings.default_output_dir,
})
const showLogs = ref(false)
const grade = appStore.state.grade
const stages = [
  { id: 'environment', label: '检查环境' },
  { id: 'browser', label: '启动浏览器' },
  { id: 'login', label: '登录教务系统' },
  { id: 'query', label: '查询成绩' },
  { id: 'validate', label: '校验文件' },
  { id: 'save', label: '保存结果' },
]
const activeIndex = computed(() => stages.findIndex(stage => stage.id === grade.stage))

function stageState(index: number) {
  if (grade.stage === 'success') return 'done'
  if (grade.stage === 'error' && index === Math.max(activeIndex.value, 0)) return 'error'
  if (index < activeIndex.value) return 'done'
  if (index === activeIndex.value && grade.running) return 'active'
  return 'waiting'
}

async function browse() {
  const selected = await api.selectDirectory(form.outputDir)
  if (selected) form.outputDir = selected
}

async function start() {
  grade.running = true
  grade.failed = false
  grade.logs = []
  grade.resultPath = ''
  grade.stage = 'environment'
  grade.status = '正在启动任务…'
  try {
    const params = {
      academicYear: form.academicYear,
      semester: form.semester,
      outputDir: form.outputDir,
    }
    const result = await api.invoke<{ taskId: string }>('startGradeExport', params)
    grade.taskId = result.taskId
  } catch (error) {
    grade.running = false
    grade.failed = true
    grade.status = error instanceof Error ? error.message : String(error)
    appStore.notify(grade.status, 'error')
  }
}

async function command(commandName: 'continue' | 'cancel') {
  await api.invoke('gradeCommand', { command: commandName })
}

function reset() {
  grade.running = false
  grade.failed = false
  grade.logs = []
  grade.resultPath = ''
  grade.stage = 'environment'
  grade.status = '准备就绪'
}
</script>

<template>
  <div class="page grade-page">
    <button class="back-button" @click="emit('navigate', 'tools')"><ArrowLeft :size="17" /> 返回全部工具</button>
    <div class="grade-heading">
      <div class="tool-icon xl excel"><FileSpreadsheet :size="29" /></div>
      <div><span class="eyebrow">ACADEMIC TOOL</span><h1>分项成绩导出</h1><p>从教务系统获取经过校验的成绩明细 Excel。</p></div>
      <div class="trust-badges"><span><ShieldCheck :size="15" /> 本地处理</span><span><Wifi :size="15" /> 需要校园网或 VPN</span></div>
    </div>
    <div class="grade-layout">
      <section class="form-panel">
        <div class="panel-heading"><span>01</span><div><h2>导出设置</h2><p>选择需要查询的学期和保存位置</p></div></div>
        <div class="field">
          <span>学年</span>
          <BaseSelect v-model="form.academicYear" :options="academicYearOptions" :disabled="grade.running" aria-label="选择学年" />
        </div>
        <label class="field">
          <span>学期</span>
          <div class="semester-options">
            <button v-for="(value, label) in data.semesters" :key="value" :class="{ active: form.semester === value }" :disabled="grade.running" @click="form.semester = value">
              <strong>第 {{ label }} 学期</strong><small>{{ label === '1' ? '秋季学期' : '春季学期' }}</small>
            </button>
          </div>
        </label>
        <label class="field">
          <span>保存位置</span>
          <div class="path-picker large"><input v-model="form.outputDir" :disabled="grade.running" /><button :disabled="grade.running" @click="browse"><FolderOpen :size="17" /></button></div>
        </label>
        <div class="privacy-strip"><ShieldCheck :size="19" /><p><strong>账号信息不会被工具箱收集</strong><span>你将在独立浏览器窗口中完成登录。</span></p></div>
        <button v-if="!grade.running && !grade.resultPath" class="primary-button wide large-button" @click="start"><Play :size="18" fill="currentColor" /> 开始导出</button>
        <button v-if="grade.running" class="cancel-button wide" @click="command('cancel')"><Square :size="16" fill="currentColor" /> 取消任务</button>
      </section>
      <section class="status-panel" :data-state="grade.failed ? 'error' : grade.resultPath ? 'success' : grade.running ? 'running' : 'idle'">
        <div class="panel-heading"><span>02</span><div><h2>任务进度</h2><p>{{ grade.status }}</p></div></div>
        <div class="steps">
          <div v-for="(stage, index) in stages" :key="stage.id" class="step" :data-state="stageState(index)">
            <div class="step-line" />
            <div class="step-icon"><Check v-if="stageState(index) === 'done'" :size="15" /><Loader2 v-else-if="stageState(index) === 'active'" class="spin" :size="17" /><Circle v-else :size="13" /></div>
            <div><strong>{{ stage.label }}</strong><span>{{ stageState(index) === 'done' ? '已完成' : stageState(index) === 'active' ? '正在进行' : '等待中' }}</span></div>
          </div>
        </div>
        <button v-if="grade.running && grade.stage === 'login'" class="login-button" @click="command('continue')"><LogIn :size="18" /> 我已完成登录，继续</button>
        <div v-if="grade.resultPath" class="result-card">
          <div class="success-orb"><Check :size="28" /></div><h3>导出完成</h3><p>{{ grade.resultPath }}</p>
          <div><button class="primary-button" @click="api.openPath(grade.resultPath)"><ExternalLink :size="16" /> 打开文件</button><button class="secondary-button" @click="api.showItem(grade.resultPath)"><FolderOpen :size="16" /> 所在文件夹</button></div>
          <button class="gpa-guide" @click="emit('navigate', 'gpa')">
            <span class="gpa-guide-icon"><Calculator :size="21" /></span>
            <span class="gpa-guide-copy"><small><Sparkles :size="13" /> 下一步</small><strong>用刚导出的成绩计算 GPA</strong></span>
            <span class="gpa-guide-action">前往绩点计算器 <ArrowRight :size="17" /></span>
          </button>
          <button class="text-button" @click="reset"><RotateCcw :size="15" /> 再次导出</button>
        </div>
        <div v-if="grade.logs.length" class="log-area">
          <button @click="showLogs = !showLogs"><span>运行详情（{{ grade.logs.length }}）</span><ChevronUp v-if="showLogs" :size="16" /><ChevronDown v-else :size="16" /></button>
          <pre v-if="showLogs">{{ grade.logs.join('\n') }}</pre>
        </div>
      </section>
    </div>
  </div>
</template>
