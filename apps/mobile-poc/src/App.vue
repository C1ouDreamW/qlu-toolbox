<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CheckCircle2, ChevronRight, Eraser, FlaskConical, LockKeyhole, Play, ShieldCheck, Smartphone, Wifi } from 'lucide-vue-next'
import { gradeExport, type GradeExportEvent, type GradeStage } from './gradeExport'

const currentYear = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1
const years = Array.from({ length: 6 }, (_, index) => currentYear - index)
const academicYear = ref(String(currentYear))
const semester = ref<'3' | '12'>('12')
const keepLoginState = ref(true)
const taskId = ref('')
const stage = ref<GradeStage>('idle')
const message = ref('选择学期后即可开始真机验证')
const errorCode = ref('')
const running = computed(() => !['idle', 'success', 'cancelled', 'failed'].includes(stage.value))
const nativeAndroid = gradeExport.isNativeAndroid()
let listener: { remove: () => Promise<void> } | undefined

const stages: Array<{ id: GradeStage; label: string }> = [
  { id: 'opening_login', label: '登录' },
  { id: 'querying', label: '查分' },
  { id: 'downloading', label: '导出' },
  { id: 'awaiting_save', label: '保存' },
]

const stageIndex = computed(() => {
  const aliases: Partial<Record<GradeStage, GradeStage>> = {
    checking_access: 'opening_login',
    waiting_login: 'opening_login',
    opening_scores: 'querying',
    validating: 'downloading',
    success: 'awaiting_save',
  }
  return stages.findIndex(item => item.id === (aliases[stage.value] ?? stage.value))
})

function receive(event: GradeExportEvent) {
  if (taskId.value && event.taskId !== taskId.value) return
  taskId.value = event.taskId
  stage.value = event.stage
  message.value = event.message
  errorCode.value = event.type === 'error' ? event.code : ''
}

async function start() {
  taskId.value = ''
  errorCode.value = ''
  stage.value = 'checking_access'
  message.value = '正在打开受限教务 WebView…'
  try {
    const result = await gradeExport.start({
      academicYear: academicYear.value,
      semester: semester.value,
      keepLoginState: keepLoginState.value,
    })
    taskId.value = result.taskId
  } catch (error) {
    stage.value = 'failed'
    message.value = error instanceof Error ? error.message : String(error)
  }
}

async function cancel() {
  if (taskId.value) await gradeExport.cancel(taskId.value)
}

async function clearLogin() {
  await gradeExport.clearLoginState()
  message.value = '教务系统 Cookie、缓存与站点数据已清除'
  stage.value = 'idle'
}

onMounted(async () => {
  if (nativeAndroid) listener = await gradeExport.onEvent(receive)
})

onBeforeUnmount(() => void listener?.remove())
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span>QLU</span><strong>工具箱</strong></div>
      <span class="poc"><FlaskConical :size="14" /> Android PoC</span>
    </header>

    <section class="hero">
      <div class="hero-icon"><Smartphone :size="28" /></div>
      <p class="eyebrow">MOBILE FEASIBILITY</p>
      <h1>分项成绩查分验证</h1>
      <p>在学校原始页面手动登录，App 只在本机完成查询、导出与保存。</p>
    </section>

    <section v-if="!nativeAndroid" class="web-warning">
      当前是网页预览。查分能力需要安装 Android 调试包后在真机运行。
    </section>

    <section class="card form-card">
      <div class="section-title"><span>01</span><div><h2>选择查询范围</h2><p>参数会在登录成功后自动填写</p></div></div>
      <label>
        <span>学年</span>
        <select v-model="academicYear" :disabled="running">
          <option v-for="year in years" :key="year" :value="String(year)">{{ year }}-{{ year + 1 }} 学年</option>
        </select>
      </label>
      <div class="field-label">学期</div>
      <div class="semester-tabs">
        <button :class="{ active: semester === '3' }" :disabled="running" @click="semester = '3'">第一学期</button>
        <button :class="{ active: semester === '12' }" :disabled="running" @click="semester = '12'">第二学期</button>
      </div>
      <label class="switch-row">
        <span><strong>保留登录状态</strong><small>下次可减少重复登录</small></span>
        <input v-model="keepLoginState" type="checkbox" :disabled="running" />
      </label>
    </section>

    <section class="notice"><Wifi :size="20" /><p><strong>开始前请确认网络</strong><span>工具箱不会连接或控制 VPN。请先通过 aTrust 或校园网确保教务系统可访问。</span></p></section>

    <section class="card status-card">
      <div class="section-title"><span>02</span><div><h2>验证进度</h2><p>{{ message }}</p></div></div>
      <div class="steps">
        <template v-for="(item, index) in stages" :key="item.id">
          <div :class="['step', { done: stage === 'success' || index < stageIndex, active: index === stageIndex && running }]">
            <CheckCircle2 v-if="stage === 'success' || index < stageIndex" :size="19" />
            <span v-else>{{ index + 1 }}</span>
            <small>{{ item.label }}</small>
          </div>
          <ChevronRight v-if="index < stages.length - 1" class="step-arrow" :size="15" />
        </template>
      </div>
      <p v-if="errorCode" class="error-code">{{ errorCode }}</p>
    </section>

    <button v-if="!running" class="primary" :disabled="!nativeAndroid" @click="start"><Play :size="19" fill="currentColor" />打开教务系统并开始</button>
    <button v-else class="cancel" @click="cancel">取消本次验证</button>
    <button class="clear" :disabled="running || !nativeAndroid" @click="clearLogin"><Eraser :size="17" />清除教务登录状态</button>

    <footer>
      <span><ShieldCheck :size="15" /> 不上传成绩数据</span>
      <span><LockKeyhole :size="15" /> 不读取账号密码</span>
    </footer>
  </main>
</template>
