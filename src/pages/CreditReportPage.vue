<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowLeft, BookOpenCheck, Check, Circle, Loader2, LogIn, Play, Square,
  RotateCcw, ShieldCheck, Wifi, AlertTriangle, ChevronDown, ChevronUp,
  Save, GraduationCap, Compass,
} from 'lucide-vue-next'
import { appStore } from '@/store'
import type { BootstrapData, CreditModuleStat, CreditRules, PageName } from '@/types'

defineProps<{ data: BootstrapData }>()
const api = window.qlu
const emit = defineEmits<{ navigate: [page: PageName] }>()
const credit = appStore.state.credit
const showLogs = ref(false)
const showCourses = ref<string | null>(null)
const showUnmatched = ref(false)
const showExtra = ref(false)
const rules = ref<CreditRules | null>(null)

const stages = [
  { id: 'environment', label: '检查环境' },
  { id: 'browser', label: '启动浏览器' },
  { id: 'login', label: '登录教务系统' },
  { id: 'plan', label: '读取培养方案' },
  { id: 'grades', label: '读取全部成绩' },
  { id: 'analyze', label: '统计学分' },
]
const activeIndex = computed(() => stages.findIndex(stage => stage.id === credit.stage))

function stageState(index: number) {
  if (credit.stage === 'success') return 'done'
  if (credit.stage === 'error' && index === Math.max(activeIndex.value, 0)) return 'error'
  if (index < activeIndex.value) return 'done'
  if (index === activeIndex.value && credit.running) return 'active'
  return 'waiting'
}

const majorOptions = [
  { value: false, label: '非艺术类专业', hint: '须修公共艺术类课程 2 学分' },
  { value: true, label: '艺术类专业', hint: '公共艺术要求自动豁免' },
]

const report = computed(() => credit.report)
const recommendations = computed(() => report.value?.recommendations || [])
const extraElective = computed(() => report.value?.extra_elective || [])
const unmatchedList = computed(() => report.value?.unmatched || [])
const activeModules = computed(() =>
  (report.value?.modules || []).filter(module => module.required > 0 || module.earned > 0 || module.in_progress > 0),
)
const progressPercent = computed(() => {
  const total = report.value?.total_required || 0
  return total > 0 ? Math.min(100, Math.round(((report.value?.total_earned || 0) / total) * 100)) : 0
})
const display = (value: number) => Number(value.toFixed(2)).toString()

onMounted(async () => {
  try {
    rules.value = await api.invoke<CreditRules>('getCreditRules')
  } catch {
    rules.value = null
  }
})

async function setArtMajor(artMajor: boolean) {
  if (!rules.value || credit.running) return
  const previous = rules.value.art_major
  rules.value.art_major = artMajor
  const saved = await saveRules(false)
  if (!saved) rules.value.art_major = previous
}

async function saveRules(notify = true) {
  if (!rules.value) return false
  try {
    // Vue 的 reactive 代理无法通过 IPC 结构化克隆，必须先转成纯对象。
    const plain = JSON.parse(JSON.stringify(rules.value)) as unknown as Record<string, unknown>
    rules.value = await api.invoke<CreditRules>('saveCreditRules', plain)
    if (notify) appStore.notify('学分要求已保存', 'success')
    return true
  } catch (error) {
    appStore.notify(error instanceof Error ? error.message : String(error), 'error')
    return false
  }
}

async function resetRules() {
  if (credit.running) return
  try {
    rules.value = await api.invoke<CreditRules>('resetCreditRules')
    appStore.notify('已恢复默认学分要求', 'success')
  } catch (error) {
    appStore.notify(error instanceof Error ? error.message : String(error), 'error')
  }
}

async function start() {
  credit.running = true
  credit.failed = false
  credit.logs = []
  credit.report = null
  credit.stage = 'environment'
  credit.status = '正在启动任务…'
  try {
    const result = await api.invoke<{ taskId: string }>('startCreditReport', {})
    credit.taskId = result.taskId
  } catch (error) {
    credit.running = false
    credit.failed = true
    credit.status = error instanceof Error ? error.message : String(error)
    appStore.notify(credit.status, 'error')
  }
}

async function command(commandName: 'continue' | 'cancel') {
  await api.invoke('creditCommand', { command: commandName })
}

function reset() {
  credit.running = false
  credit.failed = false
  credit.logs = []
  credit.report = null
  credit.stage = 'environment'
  credit.status = '准备就绪'
}

function moduleWidth(module: CreditModuleStat) {
  if (module.required <= 0) return 100
  return Math.min(100, Math.round((module.earned / module.required) * 100))
}
</script>

<template>
  <div class="page credit-page">
    <button class="back-button" @click="emit('navigate', 'tools')"><ArrowLeft :size="17" /> 返回全部工具</button>
    <div class="grade-heading">
      <div class="tool-icon xl credit"><BookOpenCheck :size="29" /></div>
      <div><span class="eyebrow">ACADEMIC TOOL</span><h1>学分修读情况</h1><p>对照培养方案核对综合素质选修课等学分要求，列出尚未修满的项目。</p></div>
      <div class="trust-badges"><span><ShieldCheck :size="15" /> 本地处理</span><span><Wifi :size="15" /> 需要校园网或 VPN</span></div>
    </div>
    <div class="grade-layout">
      <section class="form-panel">
        <div class="panel-heading"><span>01</span><div><h2>统计设置</h2><p>确认专业类型，然后开始统计</p></div></div>
        <div class="field">
          <span>专业类型</span>
          <div class="semester-options">
            <button
              v-for="option in majorOptions"
              :key="String(option.value)"
              :class="{ active: (rules?.art_major ?? false) === option.value }"
              :disabled="credit.running || !rules"
              @click="setArtMajor(option.value)"
            >
              <strong>{{ option.label }}</strong><small>{{ option.hint }}</small>
            </button>
          </div>
        </div>
        <details v-if="rules" class="credit-rules">
          <summary>
            <span>学分要求调整</span>
            <small>培养方案读取成功时以其为准，此处为兜底与补充</small>
          </summary>
          <label class="field">
            <span>综合素质选修课总学分要求</span>
            <input v-model.number="rules.total_required" type="number" min="0" step="0.5" :disabled="credit.running" />
          </label>
          <div v-for="module in rules.modules" :key="module.key" class="credit-rule-row">
            <span>{{ module.label }}<small v-if="module.art_only">（公共艺术类）</small></span>
            <input v-model.number="module.required" type="number" min="0" step="0.5" :disabled="credit.running" />
          </div>
          <div class="credit-rule-actions">
            <button class="secondary-button" :disabled="credit.running" @click="resetRules"><RotateCcw :size="14" /> 恢复默认</button>
            <button class="primary-button" :disabled="credit.running" @click="saveRules()"><Save :size="14" /> 保存要求</button>
          </div>
        </details>
        <div class="privacy-strip"><ShieldCheck :size="19" /><p><strong>成绩与培养方案数据仅在本机处理</strong><span>你将在独立浏览器窗口中完成登录。</span></p></div>
        <button v-if="!credit.running && !credit.report" class="primary-button wide large-button" @click="start"><Play :size="18" fill="currentColor" /> 开始统计</button>
        <button v-if="credit.running" class="cancel-button wide" @click="command('cancel')"><Square :size="16" fill="currentColor" /> 取消任务</button>
      </section>
      <section class="status-panel" :data-state="credit.failed ? 'error' : credit.report ? 'success' : credit.running ? 'running' : 'idle'">
        <div class="panel-heading"><span>02</span><div><h2>任务进度</h2><p>{{ credit.status }}</p></div></div>
        <div class="steps">
          <div v-for="(stage, index) in stages" :key="stage.id" class="step" :data-state="stageState(index)">
            <div class="step-line" />
            <div class="step-icon"><Check v-if="stageState(index) === 'done'" :size="15" /><Loader2 v-else-if="stageState(index) === 'active'" class="spin" :size="17" /><Circle v-else :size="13" /></div>
            <div><strong>{{ stage.label }}</strong><span>{{ stageState(index) === 'done' ? '已完成' : stageState(index) === 'active' ? '正在进行' : '等待中' }}</span></div>
          </div>
        </div>
        <button v-if="credit.running && credit.stage === 'login'" class="login-button" @click="command('continue')"><LogIn :size="18" /> 我已完成登录，继续</button>

        <template v-if="report">
          <section class="credit-overview">
            <div class="credit-ring" :data-state="report.total_gap <= 0 ? 'done' : 'pending'" :style="{ '--pct': progressPercent }">
              <strong>{{ progressPercent }}%</strong><span>已修 {{ display(report.total_earned) }} / {{ display(report.total_required) }}<br />学分</span>
            </div>
            <div class="credit-facts">
              <div><GraduationCap :size="16" /><span><strong>在修 {{ display(report.total_in_progress) }} 学分</strong><small>本学期尚未出成绩的课程</small></span></div>
              <div :data-tone="report.total_gap <= 0 ? 'good' : 'warn'"><AlertTriangle :size="16" /><span><strong>还差 {{ display(report.total_gap) }} 学分</strong><small>{{ report.total_gap <= 0 ? '总学分要求已满足' : '距毕业最低学分要求' }}</small></span></div>
              <div><BookOpenCheck :size="16" /><span><strong>{{ report.source === 'plan' ? '按培养方案核对' : '使用内置要求' }}</strong><small>{{ report.source === 'plan' ? '要求取自你的培养方案' : '培养方案未读取到，已使用 24/25 级模板' }}</small></span></div>
            </div>
          </section>

          <section v-if="report.unfulfilled.length" class="credit-gaps">
            <h3><AlertTriangle :size="14" /> 未修读完的项目</h3>
            <p v-for="item in report.unfulfilled" :key="item">{{ item }}</p>
          </section>
          <section v-else class="credit-gaps" data-tone="good">
            <h3><Check :size="14" /> 太棒了，全部最低学分要求都已满足</h3>
          </section>

          <section v-if="recommendations.length" class="credit-recs">
            <h3><Compass :size="14" /> 推荐选课方向</h3>
            <div v-for="rec in recommendations" :key="rec.key" class="credit-rec">
              <div class="credit-rec-main">
                <strong>{{ rec.label }}</strong>
                <span>{{ rec.detail }}</span>
              </div>
              <em>建议 {{ display(rec.credit) }} 学分</em>
            </div>
            <p class="credit-rec-note">建议从第二学期开始尽早选修，以学校最新选课通知为准。</p>
          </section>

          <section class="credit-modules">
            <article v-for="module in activeModules" :key="module.key" :data-satisfied="module.satisfied">
              <header>
                <strong>{{ module.label }}</strong>
                <span class="credit-nums">已修 {{ display(module.earned) }} / {{ display(module.required) }} 学分<span v-if="module.in_progress > 0"> · 在修 {{ display(module.in_progress) }}</span></span>
                <em v-if="module.art_only && report.art_major">艺术类专业豁免</em>
                <em v-else-if="module.required === 0">计入总学分</em>
                <em v-else-if="!module.satisfied && module.gap > 0">还差 {{ display(module.gap) }}</em>
                <em v-else class="ok"><Check :size="11" /> 已满足</em>
              </header>
              <div class="progress-track"><i :style="{ width: `${moduleWidth(module)}%` }" /></div>
              <div v-if="module.subs.length" class="credit-subs">
                <span v-for="sub in module.subs" :key="sub.key" :data-satisfied="sub.satisfied">
                  {{ sub.label }} {{ display(sub.earned) }}/{{ display(sub.required) }}<template v-if="sub.in_progress > 0">（在修 {{ display(sub.in_progress) }}）</template>
                </span>
              </div>
              <button class="credit-course-toggle" @click="showCourses = showCourses === module.key ? null : module.key">
                认定课程（{{ module.courses.length }}）{{ showCourses === module.key ? '收起' : '展开' }}
                <ChevronUp v-if="showCourses === module.key" :size="13" /><ChevronDown v-else :size="13" />
              </button>
              <ul v-if="showCourses === module.key" class="credit-courses">
                <li v-for="course in module.courses" :key="`${course.code}-${course.term}`" :data-state="course.state">
                  <strong>{{ course.name }}</strong>
                  <span>{{ course.term }} · {{ course.credit }} 学分 · {{ course.state === 'passed' ? `成绩 ${course.score}` : course.state === 'in_progress' ? '在修' : '未通过' }}</span>
                </li>
                <li v-if="!module.courses.length" class="empty">暂无匹配课程</li>
              </ul>
            </article>
          </section>

          <div v-if="extraElective.length" class="credit-unmatched">
            <button @click="showExtra = !showExtra">
              <span>其他公选课（{{ extraElective.length }} 门，计入总学分）</span>
              <ChevronUp v-if="showExtra" :size="15" /><ChevronDown v-else :size="15" />
            </button>
            <ul v-if="showExtra">
              <li v-for="course in extraElective" :key="`extra-${course.code}-${course.term}`"><strong>{{ course.name }}</strong><span>{{ course.term }} · {{ course.credit }} 学分</span></li>
            </ul>
          </div>
          <div v-if="unmatchedList.length" class="credit-unmatched">
            <button @click="showUnmatched = !showUnmatched">
              <span>未归类课程（{{ unmatchedList.length }}，不计入以上模块）</span>
              <ChevronUp v-if="showUnmatched" :size="15" /><ChevronDown v-else :size="15" />
            </button>
            <ul v-if="showUnmatched">
              <li v-for="course in unmatchedList" :key="`${course.code}-${course.term}`"><strong>{{ course.name }}</strong><span>{{ course.term }} · {{ course.credit }} 学分</span></li>
            </ul>
          </div>
          <button class="text-button" @click="reset"><RotateCcw :size="15" /> 重新统计</button>
        </template>

        <div v-if="credit.logs.length" class="log-area">
          <button @click="showLogs = !showLogs"><span>运行详情（{{ credit.logs.length }}）</span><ChevronUp v-if="showLogs" :size="16" /><ChevronDown v-else :size="16" /></button>
          <pre v-if="showLogs">{{ credit.logs.join('\n') }}</pre>
        </div>
      </section>
    </div>
  </div>
</template>
