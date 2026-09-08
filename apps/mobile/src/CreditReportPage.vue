<script setup lang="ts">
import { computed, ref } from 'vue'
import { registerPlugin } from '@capacitor/core'
import { ArrowLeft, BookOpenCheck, Play, RotateCcw, Save, ShieldCheck } from 'lucide-vue-next'
import { defaultCreditRules, normalizeCreditRules, parseCreditPlan, summarizeCredits, type CreditCapture } from '@lumatile/academic-core'

defineProps<{ nativeAndroid: boolean; gradeBusy: boolean }>()
const emit = defineEmits<{ back: [] }>()
const native = registerPlugin<{ start(): Promise<{ capture: CreditCapture | null }> }>('CreditReport')
const storageKey = 'lumatileCreditRules'
function loadRules() {
  try { return normalizeCreditRules(JSON.parse(localStorage.getItem(storageKey) || 'null')) }
  catch { return defaultCreditRules() }
}
const rules = ref(loadRules())
const running = ref(false), error = ref(''), status = ref('确认专业类型，然后开始统计')
const report = ref<ReturnType<typeof summarizeCredits> | null>(null)
const warnings = ref<string[]>([])
const modules = computed(() => report.value?.modules.filter(module => module.required > 0 || module.earned > 0 || module.in_progress > 0) || [])
const percent = computed(() => report.value ? Math.min(100, Math.round(report.value.total_earned / report.value.total_required * 100)) : 0)
const display = (value: number) => Number(value.toFixed(2))

function saveRules() {
  error.value = ''
  const requirements = [rules.value.total_required, ...rules.value.modules.map(module => module.required)]
  if (requirements.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0) || rules.value.total_required <= 0) {
    error.value = '请输入有效学分：总要求须大于 0，模块要求不能为负数。'; return false
  }
  try {
    const normalized = normalizeCreditRules(rules.value)
    localStorage.setItem(storageKey, JSON.stringify(normalized))
    rules.value = normalized
    status.value = '学分要求已保存，下次统计时使用'
    return true
  } catch { error.value = '学分要求保存失败，请检查设备存储后重试。'; return false }
}
function resetRules() { rules.value = defaultCreditRules(); saveRules() }
function setMajor(value: boolean) { rules.value.art_major = value; saveRules() }
async function start() {
  if (!saveRules()) return
  running.value = true; report.value = null; warnings.value = []; status.value = '请在学校页面完成登录，可随时关闭页面取消'
  try {
    const { capture } = await native.start()
    if (!capture) { status.value = '统计已取消，可重新开始'; return }
    if (!Array.isArray(capture.items) || capture.items.some(item => !item || typeof item !== 'object' || Array.isArray(item)) || typeof capture.html !== 'string' || !capture.course_map || typeof capture.course_map !== 'object') throw Error('学分数据格式无效，请重新统计')
    const plan = parseCreditPlan(capture.html)
    if (plan) plan.course_map = Object.fromEntries(Object.entries(plan.node_ids).map(([key, id]) => {
      const courses = capture.course_map[id] || []
      if (!Array.isArray(courses) || courses.some(course => typeof course?.code !== 'string' || typeof course?.name !== 'string')) throw Error('课程映射格式无效，请重新统计')
      return [key, courses]
    }))
    warnings.value = Array.isArray(capture.warnings) ? capture.warnings.filter(item => typeof item === 'string') : []
    if (!plan && !warnings.value.length) warnings.value.push('未找到综合素质选修课培养方案，使用内置 24/25 级要求与已保存的调整值。')
    report.value = summarizeCredits(capture.items, rules.value, plan)
    status.value = '统计完成'
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); status.value = '统计失败，请重试' }
  finally { running.value = false }
}
</script>

<template>
  <section class="page credit-page">
    <button class="page-back" :disabled="running" @click="emit('back')"><ArrowLeft />返回工具箱</button>
    <div class="page-title"><p class="eyebrow">CREDIT REPORT</p><h1>学分修读情况</h1><p>对照培养方案，核对综合素质选修课的已修、在修学分与各模块要求。</p></div>
    <section class="card credit-settings">
      <h2><BookOpenCheck />统计设置</h2>
      <div class="credit-major" role="group" aria-label="专业类型">
        <button v-for="option in [{ value: false, label: '非艺术类专业', hint: '须修公共艺术 2 学分' }, { value: true, label: '艺术类专业', hint: '公共艺术要求豁免' }]" :key="String(option.value)" :aria-pressed="rules.art_major === option.value" :disabled="running" @click="setMajor(option.value)"><strong>{{ option.label }}</strong><small>{{ option.hint }}</small></button>
      </div>
      <details class="credit-rules">
        <summary>学分要求调整<small>培养方案要求与本地要求取较高值</small></summary>
        <label><span>综合素质选修课总要求</span><input v-model.number="rules.total_required" type="number" min="0.5" step="0.5" :disabled="running" /></label>
        <label v-for="module in rules.modules" :key="module.key"><span>{{ module.label }}</span><input v-model.number="module.required" type="number" min="0" step="0.5" :disabled="running" /></label>
        <div class="credit-actions"><button class="secondary" :disabled="running" @click="resetRules"><RotateCcw />恢复默认</button><button class="secondary" :disabled="running" @click="saveRules"><Save />保存要求</button></div>
      </details>
      <p class="credit-privacy"><ShieldCheck />请连接校园网或学校 VPN，登录在学校原始页面完成，数据仅在本机处理。</p>
      <button class="primary" :disabled="running || !nativeAndroid || gradeBusy" @click="start"><Play />{{ running ? '正在统计…' : report ? '重新统计' : '开始统计' }}</button>
      <p v-if="!nativeAndroid" class="credit-note">请在 Android 应用中登录教务并统计。</p>
      <p v-else-if="gradeBusy" class="credit-note">请先完成或取消分项成绩导出任务。</p>
      <p role="status" class="credit-note">{{ status }}</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
    </section>
    <template v-if="report">
      <p v-for="warning in warnings" :key="warning" class="credit-warning" role="status">{{ warning }}</p>
      <section class="card credit-overview">
        <span class="eyebrow">综合素质选修课</span><strong class="credit-total">{{ display(report.total_earned) }}<small> / {{ display(report.total_required) }} 学分</small></strong>
        <progress :value="percent" max="100" :aria-label="`已修进度 ${percent}%`" />
        <div class="credit-facts"><span>在修 <strong>{{ display(report.total_in_progress) }}</strong></span><span>还差 <strong>{{ display(report.total_gap) }}</strong></span></div>
        <p class="credit-note">{{ report.source === 'plan' ? '按培养方案与本地要求核对' : '使用内置 24/25 级模板与本地要求' }} · 在修学分不计入已修</p>
      </section>
      <section class="card credit-result"><h2>{{ report.unfulfilled.length ? '未修读完的项目' : '全部最低学分要求已满足' }}</h2><p v-for="item in report.unfulfilled" :key="item">{{ item }}</p></section>
      <section v-if="report.recommendations.length" class="card credit-result"><h2>推荐选课方向</h2><article v-for="rec in report.recommendations" :key="rec.key"><strong>{{ rec.label }} · {{ display(rec.credit) }} 学分</strong><p>{{ rec.detail }}</p></article><small>建议尽早选修，以学校最新选课通知为准。</small></section>
      <section v-for="module in modules" :key="module.key" class="card credit-module">
        <h2>{{ module.label }}</h2><p>已修 {{ display(module.earned) }} / {{ display(module.required) }} 学分<span v-if="module.in_progress"> · 在修 {{ display(module.in_progress) }}</span></p>
        <strong class="credit-badge" :data-satisfied="module.satisfied">{{ module.art_only && report.art_major ? '艺术类专业豁免' : module.required === 0 ? '计入总学分' : module.satisfied ? '已满足' : module.gap > 0 ? `还差 ${display(module.gap)} 学分` : '子类要求尚未满足' }}</strong>
        <ul v-if="module.subs.length && !(module.art_only && report.art_major)" class="credit-subs"><li v-for="sub in module.subs" :key="sub.key">{{ sub.label }} {{ display(sub.earned) }}/{{ display(sub.required) }}<span v-if="sub.in_progress">（在修 {{ display(sub.in_progress) }}）</span></li></ul>
        <details><summary>认定课程（{{ module.courses.length }}）</summary><ul class="credit-courses"><li v-for="(course, index) in module.courses" :key="index"><strong>{{ course.name }}</strong><span>{{ course.term }} · {{ course.credit }} 学分 · {{ course.state === 'passed' ? `成绩 ${course.score}` : course.state === 'in_progress' ? '在修' : '未通过' }}</span></li><li v-if="!module.courses.length">暂无匹配课程</li></ul></details>
      </section>
      <details v-for="group in [{ label: '其他公选课（计入总学分）', courses: report.extra_elective }, { label: '未归类课程（不计入以上模块）', courses: report.unmatched }]" :key="group.label" class="card credit-result"><summary>{{ group.label }} · {{ group.courses.length }} 门</summary><ul class="credit-courses"><li v-for="(course, index) in group.courses" :key="index"><strong>{{ course.name }}</strong><span>{{ course.term }} · {{ course.credit }} 学分 · {{ course.state === 'passed' ? `成绩 ${course.score}` : course.state === 'in_progress' ? '在修' : '未通过' }}</span></li></ul></details>
    </template>
  </section>
</template>

<style scoped>
.credit-page{--credit-muted:#667d93;--credit-surface:#f1f6fa;--credit-line:#d8e6f1;--credit-blue:#075ebd}
.credit-page .card{display:block;margin-bottom:16px}.credit-page h2{display:flex;align-items:center;margin:0 0 14px;font-size:17px}.credit-page h2 svg{width:20px;margin-right:8px}
.credit-major{display:grid;grid-template-columns:1fr 1fr;gap:10px}.credit-major button{padding:13px 6px;border:1px solid var(--credit-line);border-radius:12px;background:var(--credit-surface);color:inherit}.credit-major button[aria-pressed=true]{border-color:var(--credit-blue);color:var(--credit-blue)}.credit-major strong,.credit-major small{display:block}.credit-major strong{font-size:14px}.credit-major small{margin-top:6px;font-size:11px}
.credit-rules{margin-top:18px}.credit-page summary{padding:10px 0;cursor:pointer;font-size:13px;font-weight:650}.credit-rules summary small{display:block;margin-top:5px;color:var(--credit-muted);font-weight:400}.credit-rules label{display:grid;grid-template-columns:minmax(0,1fr) 80px;align-items:center;gap:10px;margin:12px 0;font-size:13px}.credit-rules input{width:100%;padding:10px;border:1px solid var(--credit-line);border-radius:8px;background:var(--credit-surface);color:inherit;font:inherit}.credit-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.credit-actions .secondary{margin:0}
.credit-privacy{font-size:12px;line-height:1.7;color:var(--credit-muted);margin:18px 0}.credit-privacy svg{width:15px;height:15px;vertical-align:middle;margin-right:5px}.credit-note{font-size:12px;line-height:1.6;color:var(--credit-muted)}.credit-warning{padding:14px;border-radius:12px;background:#fff3d6;color:#795510;font-size:13px;line-height:1.6}.credit-total{display:block;margin:10px 0 18px;font-size:42px;letter-spacing:-1px;color:var(--credit-blue);font-variant-numeric:tabular-nums}.credit-total small{font-size:16px;letter-spacing:0;color:var(--credit-muted);font-weight:400}.credit-overview progress{width:100%;height:10px;accent-color:var(--credit-blue)}.credit-facts{display:grid;grid-template-columns:1fr 1fr;margin-top:14px;font-size:13px;color:var(--credit-muted)}.credit-facts strong{margin-left:6px;font-size:22px;color:var(--credit-blue)}
.credit-result p,.credit-module p{font-size:13px;line-height:1.7}.credit-result article{padding:12px 0;border-top:1px solid var(--credit-line);font-size:14px}.credit-result article p{margin-bottom:0;color:var(--credit-muted)}.credit-result>small{color:var(--credit-muted);font-size:11px}.credit-badge{display:inline-block;padding:6px 10px;border-radius:8px;background:#fff3d6;color:#795510;font-size:12px}.credit-badge[data-satisfied=true]{background:#e3f3eb;color:#176442}.credit-subs{padding-left:18px;font-size:12px;line-height:1.9}.credit-courses{list-style:none;padding:0;margin:0}.credit-courses li{padding:11px 0;border-top:1px solid var(--credit-line);font-size:13px;overflow-wrap:anywhere}.credit-courses strong,.credit-courses span{display:block}.credit-courses span{margin-top:5px;color:var(--credit-muted);font-size:12px;line-height:1.6}
@media(prefers-color-scheme:dark){.credit-page{--credit-muted:#9eb1c1;--credit-surface:#1b2e40;--credit-line:#324c63;--credit-blue:#83c5ff}.credit-warning,.credit-badge{color:#ffd979;background:#302817}.credit-badge[data-satisfied=true]{color:#91dfb4;background:#173e30}}
</style>
