<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AlertCircle, Archive, BookOpen, Calculator, Check, ChevronRight, Code2, Eraser, FileDown, FileSpreadsheet, FolderOpen, Heart, Home, Info, LockKeyhole, Play, RefreshCw, RotateCcw, Search, Settings, ShieldAlert, ShieldCheck, SquareActivity, UploadCloud, UserRoundCheck, Wifi } from 'lucide-vue-next'
import { calculateGpa, defaultAcademicYear, semesterName } from '@qlu-toolbox/academic-core'
import type { GPACourse, GPAWorkbook, GradeEvent, GradeTaskSnapshot, SemesterCode } from '@qlu-toolbox/contracts'
import { gradeExport } from './gradeExport'
import { parseGradeWorkbook } from './gpaWorker'
import brandIconUrl from '../../../assets/qlu-toolbox.png'
import mobilePackage from '../package.json'

type Page = 'home' | 'grade' | 'gpa' | 'tasks' | 'settings' | 'about'
const legalNoticeVersion = '2026-07-19'
const page = ref<Page>('home')
const legalNoticeAccepted = ref(localStorage.getItem('legalNoticeAcceptedVersion') === legalNoticeVersion)
const legalNoticeConfirmed = ref(false)
const nativeAndroid = gradeExport.isNativeAndroid()
const currentYear = Number(defaultAcademicYear())
const years = Array.from({ length: 8 }, (_, index) => currentYear - index)
const academicYear = ref(String(currentYear))
const semester = ref<SemesterCode>('12')
const keepLoginState = ref(localStorage.getItem('keepLoginState') !== 'false')
const task = ref<GradeTaskSnapshot | null>(null)
const tasks = ref<GradeTaskSnapshot[]>([])
const uiError = ref('')
const gpaWorkbook = ref<GPAWorkbook | null>(null)
const gpaLoading = ref(false)
const gpaError = ref('')
const gpaQuery = ref('')
const busy = computed(() => task.value?.outcome === 'running')
const message = computed(() => task.value?.message || '选择范围后即可开始查询')
const gpaSummary = computed(() => calculateGpa(gpaWorkbook.value?.courses ?? []))
const calculableCourses = computed(() => gpaWorkbook.value?.courses.filter(course => !course.issue) ?? [])
const allCoursesSelected = computed(() => calculableCourses.value.length > 0 && calculableCourses.value.every(course => course.included))
const visibleGpaCourses = computed(() => {
  const keyword = gpaQuery.value.trim().toLowerCase()
  const courses = gpaWorkbook.value?.courses ?? []
  if (!keyword) return courses
  return courses.filter(course => `${course.name}${course.code}${course.college}${course.teachingClass}`.toLowerCase().includes(keyword))
})
let listener: PluginListenerHandleLike | undefined

interface PluginListenerHandleLike { remove: () => Promise<void> }

function snapshotFromEvent(event: GradeEvent): GradeTaskSnapshot | null {
  if (!task.value || task.value.taskId !== event.taskId) return null
  const next = { ...task.value, stage: event.stage, message: event.message, updatedAt: new Date().toISOString() }
  if (event.type === 'error') { next.outcome = 'failed'; next.errorCode = event.code || 'UNKNOWN' }
  if (event.type === 'cancelled') next.outcome = 'cancelled'
  if (event.type === 'interrupted') { next.outcome = 'interrupted'; next.errorCode = event.code || 'TASK_INTERRUPTED' }
  if (event.type === 'artifact_ready') { next.outcome = 'success'; next.artifactState = 'temporary'; next.artifact = event.artifact || next.artifact }
  if (event.type === 'artifact_saved') { next.outcome = 'success'; next.stage = 'success'; next.artifactState = 'saved'; next.savedArtifact = event.savedArtifact || null }
  return next
}

async function refreshTasks() {
  if (!nativeAndroid) return
  tasks.value = await gradeExport.listTasks()
}

async function receive(event: GradeEvent) {
  const next = snapshotFromEvent(event)
  if (next) task.value = next
  if (['artifact_ready', 'artifact_saved', 'error', 'cancelled', 'interrupted'].includes(event.type)) await refreshTasks()
}

async function start() {
  if (!nativeAndroid) return
  task.value = null
  uiError.value = ''
  try {
    const { taskId } = await gradeExport.start({ academicYear: String(academicYear.value), semester: semester.value, keepLoginState: keepLoginState.value })
    task.value = await gradeExport.getTask(taskId)
    page.value = 'grade'
  } catch (error) { uiError.value = error instanceof Error ? error.message : String(error) }
}

async function cancel() { if (task.value) await gradeExport.cancel(task.value.taskId) }
async function retrySave(item = task.value) { if (item) try { uiError.value = ''; await gradeExport.retrySave(item.taskId) } catch (error) { uiError.value = error instanceof Error ? error.message : String(error) } }
async function openSaved(item: GradeTaskSnapshot) { try { uiError.value = ''; await gradeExport.openSavedArtifact(item.taskId) } catch (error) { uiError.value = error instanceof Error ? error.message : String(error) } }
async function share(item: GradeTaskSnapshot) { if (item.artifact) try { uiError.value = ''; await gradeExport.shareArtifact(item.artifact) } catch (error) { uiError.value = error instanceof Error ? error.message : String(error) } }
async function clearLogin() { try { uiError.value = ''; await gradeExport.clearLoginState() } catch (error) { uiError.value = error instanceof Error ? error.message : String(error) } }
function persistKeepLoginState() { window.localStorage.setItem('keepLoginState', String(keepLoginState.value)) }
function acceptLegalNotice() {
  if (!legalNoticeConfirmed.value) return
  window.localStorage.setItem('legalNoticeAcceptedVersion', legalNoticeVersion)
  legalNoticeAccepted.value = true
}

async function acceptGpaRows(source: Awaited<ReturnType<typeof gradeExport.readArtifactWorkbook>>) {
  gpaWorkbook.value = await parseGradeWorkbook(source)
  gpaQuery.value = ''
}

async function calculateFromTask(item: GradeTaskSnapshot) {
  if (!item.artifact) return
  page.value = 'gpa'
  gpaLoading.value = true
  gpaError.value = ''
  try { await acceptGpaRows(await gradeExport.readArtifactWorkbook(item.artifact.id)) }
  catch (error) { gpaError.value = error instanceof Error ? error.message : String(error) }
  finally { gpaLoading.value = false }
}

async function chooseGpaWorkbook() {
  if (!nativeAndroid) return
  gpaLoading.value = true
  gpaError.value = ''
  try {
    const source = await gradeExport.pickGradeWorkbook()
    if (source) await acceptGpaRows(source)
  } catch (error) { gpaError.value = error instanceof Error ? error.message : String(error) }
  finally { gpaLoading.value = false }
}

function toggleAllCourses() {
  const included = !allCoursesSelected.value
  for (const course of calculableCourses.value) course.included = included
}

function toggleCourse(course: GPACourse) {
  if (!course.issue) course.included = !course.included
}

function displayNumber(value: number | null, digits: number) {
  return value === null ? '—' : value.toFixed(digits)
}

function courseSemester(course: GPACourse) {
  return [course.academicYear, course.semester ? `第 ${course.semester} 学期` : ''].filter(Boolean).join(' · ')
}

async function selectPage(next: Page) {
  page.value = next
  if (next === 'tasks') await refreshTasks()
}

onMounted(async () => {
  if (!nativeAndroid) return
  listener = await gradeExport.onEvent(event => void receive(event))
  task.value = await gradeExport.getActiveTask()
  await refreshTasks()
})
onBeforeUnmount(() => void listener?.remove())
</script>

<template>
  <main class="app-shell">
    <header class="topbar"><div class="brand"><span><img :src="brandIconUrl" alt="" /></span><strong>QLU 工具箱</strong></div><span class="beta">Android Kotlin 测试版</span></header>

    <section v-if="page === 'home'" class="page">
      <div class="hero"><p class="eyebrow">QLU TOOLBOX MOBILE</p><h1>校园工具，装进口袋</h1><p>数据留在设备本地，登录始终在学校原始页面完成。</p></div>
      <div class="unofficial-banner"><ShieldAlert /><span><strong>非学校官方应用</strong><small>仅供个人学习与交流使用，不代表学校官方立场</small></span></div>
      <div v-if="!nativeAndroid" class="notice error">当前为网页预览，原生功能仅在 Android 安装包中可用。</div>
      <button class="tool-card" @click="selectPage('grade')"><span class="tool-icon"><FileDown /></span><span><strong>分项成绩查询</strong><small>选择学年学期，登录后自动导出 XLSX</small></span><em>已可用</em></button>
      <button class="tool-card" @click="selectPage('gpa')"><span class="tool-icon gpa-icon"><Calculator /></span><span><strong>绩点计算器</strong><small>导入成绩文件，自由选择课程并计算加权 GPA</small></span><em>测试版</em></button>
      <div class="privacy"><span><ShieldCheck />不上传成绩</span><span><LockKeyhole />不读取密码</span></div>
    </section>

    <section v-else-if="page === 'grade'" class="page">
      <div class="page-title"><p class="eyebrow">GRADE EXPORT</p><h1>分项成绩查询</h1><p>请先通过 aTrust 或校园网确保教务系统可访问。</p></div>
      <div class="card">
        <label><span>学年</span><select v-model="academicYear" :disabled="busy"><option v-for="year in years" :key="year" :value="String(year)">{{ year }}-{{ year + 1 }}</option></select></label>
        <div class="field-label">学期</div>
        <div class="segments"><button v-for="code in (['3','12'] as SemesterCode[])" :key="code" :class="{ active: semester === code }" :disabled="busy" @click="semester = code">{{ semesterName(code) }}</button></div>
        <label class="toggle"><span><strong>保留登录状态</strong><small>Cookie 仅保存在 Android WebView</small></span><input v-model="keepLoginState" type="checkbox" :disabled="busy" @change="persistKeepLoginState" /></label>
      </div>
      <div class="notice"><Wifi /><span><strong>网络由你控制</strong><small>工具箱不会安装、启动或配置 VPN。</small></span></div>
      <div v-if="uiError" class="notice error">{{ uiError }}</div>
      <div class="card status"><SquareActivity /><span><strong>{{ message }}</strong><small v-if="task">{{ task.academicYear }}-{{ Number(task.academicYear)+1 }} · {{ semesterName(task.semester) }}<template v-if="task.errorCode"> · {{ task.errorCode }}</template></small></span></div>
      <button v-if="!busy" class="primary" :disabled="!nativeAndroid" @click="start"><Play />打开教务系统并开始</button>
      <button v-else class="secondary danger" @click="cancel">取消本次任务</button>
      <button v-if="task?.artifactState === 'temporary'" class="secondary" @click="retrySave()"><RotateCcw />重新保存文件</button>
      <button v-if="task?.artifactState === 'saved'" class="secondary" @click="openSaved(task)"><FolderOpen />打开已保存文件</button>
      <button v-if="task?.artifact" class="secondary" @click="share(task)"><FileDown />分享成绩文件</button>
      <button v-if="task?.artifact" class="secondary gpa-action" @click="calculateFromTask(task)"><Calculator />用此文件计算 GPA</button>
    </section>

    <section v-else-if="page === 'gpa'" class="page">
      <div class="page-title"><p class="eyebrow">GPA CALCULATOR</p><h1>绩点计算器</h1><p>课程成绩只在本机读取和计算，可随时排除不参与统计的课程。</p></div>
      <div class="notice"><ShieldCheck /><span><strong>成绩不会上传</strong><small>原生层安全读取 XLSX，共享核心在设备本地计算。</small></span></div>
      <div v-if="gpaError" class="notice error"><AlertCircle /><span><strong>无法读取成绩</strong><small>{{ gpaError }}</small></span></div>

      <div v-if="!gpaWorkbook" class="card gpa-import">
        <span class="import-icon"><UploadCloud /></span>
        <strong>{{ gpaLoading ? '正在读取成绩…' : '导入分项成绩 XLSX' }}</strong>
        <small>可选择查分工具刚导出的文件，或从手机存储导入。</small>
        <button class="primary" :disabled="!nativeAndroid || gpaLoading" @click="chooseGpaWorkbook"><FolderOpen />选择 XLSX 文件</button>
      </div>

      <template v-else>
        <div class="card gpa-filebar"><FileSpreadsheet /><span><strong>{{ gpaWorkbook.fileName }}</strong><small>{{ gpaWorkbook.rowCount }} 条成绩数据 · {{ gpaWorkbook.courses.length }} 门课程</small></span><button :disabled="gpaLoading" @click="chooseGpaWorkbook"><RefreshCw :class="{ spin: gpaLoading }" /></button></div>
        <div class="gpa-summary">
          <article><span>课程</span><strong>{{ gpaSummary.selectedCourses }}</strong><small>已选择</small></article>
          <article><span>总学分</span><strong>{{ displayNumber(gpaSummary.totalCredits, 2) }}</strong><small>所选课程</small></article>
          <article><span>成绩点</span><strong>{{ displayNumber(gpaSummary.totalGradePoints, 2) }}</strong><small>绩点 × 学分</small></article>
          <article class="highlight"><span>加权 GPA</span><strong>{{ displayNumber(gpaSummary.averageGpa, 3) }}</strong><small>满绩点 5.0</small></article>
        </div>
        <div class="gpa-controls"><button :class="{ active: allCoursesSelected }" @click="toggleAllCourses"><Check />{{ allCoursesSelected ? '取消全选' : '全选可计算课程' }}</button><label><Search /><input v-model="gpaQuery" placeholder="搜索课程" /></label></div>
        <div v-if="gpaWorkbook.warnings.length" class="notice error"><AlertCircle /><span><strong>{{ gpaWorkbook.warnings.length }} 门课程未自动计入</strong><small>请查看课程卡片中的具体原因。</small></span></div>
        <div class="gpa-course-list">
          <article v-for="course in visibleGpaCourses" :key="course.id" class="card gpa-course" :class="{ invalid: course.issue }">
            <button class="course-check" :class="{ active: course.included }" :disabled="Boolean(course.issue)" @click="toggleCourse(course)"><Check /></button>
            <div class="course-main"><strong>{{ course.name }}</strong><small>{{ [course.code, course.college, course.teachingClass].filter(Boolean).join(' · ') || '未提供课程信息' }}</small><small>{{ courseSemester(course) || '学期未知' }}</small></div>
            <div class="course-metrics"><span><small>学分</small><strong>{{ displayNumber(course.credit, 1) }}</strong></span><span><small>总评</small><strong>{{ course.finalScore || '—' }}</strong></span><span><small>绩点</small><strong>{{ displayNumber(course.gradePoint, 3) }}</strong></span></div>
            <div class="component-list"><span v-for="(component, index) in course.components" :key="`${course.id}-${index}`" :class="{ final: component.isFinal }">{{ component.name }}：<strong>{{ component.score || '—' }}</strong></span></div>
            <div v-if="course.issue" class="course-issue"><AlertCircle />{{ course.issue }}，未纳入 GPA 计算</div>
          </article>
          <div v-if="!visibleGpaCourses.length" class="empty compact">没有匹配的课程</div>
        </div>
      </template>
    </section>

    <section v-else-if="page === 'tasks'" class="page">
      <div class="page-title"><p class="eyebrow">TASK HISTORY</p><h1>最近任务</h1><p>历史结果与文件保存状态分开记录。</p></div>
      <div v-if="!tasks.length" class="empty"><Archive /><strong>暂无任务</strong><span>完成一次成绩查询后会显示在这里。</span></div>
      <article v-for="item in tasks" :key="item.taskId" class="task-card"><div><strong>{{ item.academicYear }}-{{ Number(item.academicYear)+1 }} · {{ semesterName(item.semester) }}</strong><small>{{ item.message }}</small></div><span :class="['pill', item.outcome]">{{ item.outcome }}</span><button v-if="item.artifactState === 'temporary'" @click="retrySave(item)">保存</button><button v-if="item.artifactState === 'saved'" @click="openSaved(item)">打开</button><button v-if="item.artifact" @click="share(item)">分享</button><button v-if="item.artifact" @click="calculateFromTask(item)">计算 GPA</button></article>
    </section>

    <section v-else-if="page === 'settings'" class="page">
      <div class="page-title"><p class="eyebrow">PRIVACY & DATA</p><h1>设置</h1><p>管理学校登录状态和本地数据。</p></div>
      <button class="setting-card" @click="clearLogin"><Eraser /><span><strong>清除教务登录状态</strong><small>清除 Cookie、缓存与站点数据</small></span></button>
      <button class="setting-card about-entry" @click="selectPage('about')"><Info /><span><strong>关于与声明</strong><small>查看非官方声明、职责声明和免责声明</small></span><ChevronRight /></button>
      <div class="settings-footnote"><ShieldAlert />非学校官方 · 仅供学习交流</div>
    </section>

    <section v-else class="page about-page">
      <div class="page-title"><p class="eyebrow">ABOUT & LEGAL</p><h1>关于 QLU 工具箱</h1><p>由学生开发者维护的本地校园效率工具。</p></div>
      <div class="card about-identity">
        <span class="about-logo"><img :src="brandIconUrl" alt="QLU 工具箱 Logo" /></span>
        <span><strong>QLU 工具箱</strong><small>Android v{{ mobilePackage.version }} · 测试版</small><small>Vue 3 + TypeScript + Capacitor + Kotlin</small></span>
      </div>
      <div class="unofficial-banner prominent"><ShieldAlert /><span><strong>本应用并非齐鲁工业大学官方应用</strong><small>与齐鲁工业大学及其教务系统服务商不存在隶属、授权、合作或担保关系，也不代表学校官方立场。</small></span></div>
      <div class="about-values">
        <article class="card"><ShieldCheck /><div><h2>隐私说明</h2><p>工具箱不会要求你在应用界面填写账号、密码或验证码；登录在教务系统原始页面完成。成绩文件在本机处理，不会发送给开发者。</p></div></article>
        <article class="card"><Heart /><div><h2>仅供学习交流</h2><p>本项目仅供个人学习、交流和非商业用途。未经开发者明确书面许可，不得用于收费服务、商业产品、商业推广、代运营或其他营利活动。</p></div></article>
        <article class="card"><UserRoundCheck /><div><h2>职责声明</h2><p>本工具仅提供本地查询、导出和计算辅助，不参与账号管理、学业评定或任何学校业务决策。请仅处理本人有权访问的数据，并自行核对结果。</p></div></article>
      </div>
      <section class="card legal-section">
        <div class="legal-title"><BookOpen /><h2>免责声明</h2></div>
        <p>本软件按“现状”提供。受学校系统、网络环境、设备兼容性等因素影响，不保证功能持续可用，也不保证查询、导出或计算结果绝对完整、准确。</p>
        <p>使用者应自行承担使用、误用或无法使用本软件产生的风险和后果。在适用法律允许的范围内，开发者不承担由此造成的账号、数据、学业、设备或其他损失。</p>
        <p>应用中出现的学校名称仅用于说明工具的适用场景和兼容对象，不表示学校对本应用的认可、推荐或授权。</p>
      </section>
      <section class="card contact-section">
        <div><Code2 /><span><strong>项目与反馈</strong><small>开源项目：github.com/C1ouDreamW/qlu-toolbox</small><small>联系邮箱：cloud_aaa@163.com</small><small>QQ 交流群：438767737</small></span></div>
      </section>
    </section>

    <nav><button :class="{active:page==='home'}" @click="selectPage('home')"><Home />首页</button><button :class="{active:page==='grade'}" @click="selectPage('grade')"><FileDown />查分</button><button :class="{active:page==='gpa'}" @click="selectPage('gpa')"><Calculator />GPA</button><button :class="{active:page==='tasks'}" @click="selectPage('tasks')"><Archive />任务</button><button :class="{active:page==='settings'||page==='about'}" @click="selectPage('settings')"><Settings />设置</button></nav>

    <div v-if="!legalNoticeAccepted" class="legal-backdrop">
      <section class="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-dialog-title">
        <span class="dialog-logo"><img :src="brandIconUrl" alt="" /></span>
        <p class="eyebrow">BEFORE YOU START</p>
        <h1 id="legal-dialog-title">免责声明与使用须知</h1>
        <p class="dialog-lead">请先了解本应用的性质和使用边界。</p>
        <div class="legal-notice-list">
          <article class="critical"><ShieldAlert /><span><strong>非学校官方</strong><small>本应用与齐鲁工业大学及教务系统服务商不存在隶属、授权、合作或担保关系，不代表学校官方立场。</small></span></article>
          <article><Heart /><span><strong>仅供学习交流</strong><small>仅限个人学习、交流和非商业用途，禁止用于收费服务、商业推广、代运营或其他营利活动。</small></span></article>
          <article><UserRoundCheck /><span><strong>职责与使用责任</strong><small>工具仅提供本地辅助；请仅处理本人有权访问的数据，遵守学校与目标系统规则，自行核对结果并承担使用风险。</small></span></article>
          <article><ShieldCheck /><span><strong>隐私与登录</strong><small>登录在教务系统原始页面完成；成绩仅在本机处理，不会上传给开发者。</small></span></article>
        </div>
        <label class="legal-confirm"><input v-model="legalNoticeConfirmed" type="checkbox" /><span>我已阅读、理解并同意上述声明与使用须知</span></label>
        <button class="primary" :disabled="!legalNoticeConfirmed" @click="acceptLegalNotice"><Check />确认并开始使用</button>
      </section>
    </div>
  </main>
</template>
