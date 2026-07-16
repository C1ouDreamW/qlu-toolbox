<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CheckCircle2, AlertCircle, Info, Download, HardDrive, ShieldCheck, XCircle,
} from 'lucide-vue-next'
import TitleBar from '@/components/TitleBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import BaseModal from '@/components/BaseModal.vue'
import HomePage from '@/pages/HomePage.vue'
import ToolsPage from '@/pages/ToolsPage.vue'
import TasksPage from '@/pages/TasksPage.vue'
import SettingsPage from '@/pages/SettingsPage.vue'
import AboutPage from '@/pages/AboutPage.vue'
import GradeExportPage from '@/pages/GradeExportPage.vue'
import GPACalculatorPage from '@/pages/GPACalculatorPage.vue'
import { appStore } from '@/store'
import { logoUrl } from '@/assets'
import type { PageName } from '@/types'

const update = ref<UpdateInfo | null>(null)
const disclaimerConfirmed = ref(false)
const api = window.qlu
const reloadApp = () => window.location.reload()
const checkingUpdate = ref(false)
const boot = appStore.boot
const pageComponent = computed(() => ({ home: HomePage, tools: ToolsPage, tasks: TasksPage, settings: SettingsPage, about: AboutPage, grade: GradeExportPage, gpa: GPACalculatorPage }[appStore.state.page]))
const browser = appStore.state.browser

function navigate(page: PageName) { appStore.navigate(page) }
async function acceptWelcome() { await appStore.saveSettings({ welcome_accepted: true }) }
async function checkUpdate(manual = false) {
  if (!boot.value || checkingUpdate.value) return
  checkingUpdate.value = true
  try {
    update.value = await window.qlu.checkUpdate(boot.value.version)
    if (manual && !update.value) appStore.notify('当前已是最新版本', 'success')
  } catch (error) {
    if (manual) appStore.notify(`检查更新失败：${error instanceof Error ? error.message : error}`, 'error')
  } finally { checkingUpdate.value = false }
}

onMounted(async () => {
  await appStore.initialize()
  if (boot.value?.settings.check_updates && boot.value.settings.welcome_accepted) void checkUpdate()
})
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <div v-if="appStore.state.loading" class="launch-screen"><div class="launch-logo"><img :src="logoUrl" alt="QLU 工具箱 Logo" /></div><div class="spinner" /><p>正在准备你的工作台…</p></div>
    <div v-else-if="appStore.state.error" class="fatal-screen"><AlertCircle :size="38" /><h2>无法启动本地服务</h2><p>{{ appStore.state.error }}</p><button class="primary-button" @click="reloadApp">重新尝试</button></div>
    <div v-else-if="boot" class="workspace">
      <Sidebar :current="appStore.state.page" :version="boot.version" @navigate="navigate" />
      <main class="content"><component :is="pageComponent" :key="appStore.state.page" :data="boot" @navigate="navigate" @check-update="checkUpdate(true)" /></main>
    </div>

    <Transition name="toast"><div v-if="appStore.state.toast" class="toast" :data-tone="appStore.state.toast.tone"><CheckCircle2 v-if="appStore.state.toast.tone === 'success'" :size="19" /><AlertCircle v-else-if="appStore.state.toast.tone === 'error'" :size="19" /><Info v-else :size="19" /><span>{{ appStore.state.toast.message }}</span></div></Transition>

    <BaseModal v-if="boot && !boot.settings.welcome_accepted" title="免责声明与使用须知">
      <div class="welcome-mark"><img :src="logoUrl" alt="QLU 工具箱 Logo" /></div><p class="modal-lead">一个更清爽、更安全的本地校园效率工作台。</p>
      <div class="notice-list"><div><span><strong>隐私说明</strong>账号、验证码和成绩不会发送给开发者，登录在教务系统浏览器页面完成。</span></div><div><span><strong>非官方声明</strong>本软件与齐鲁工业大学及教务系统服务商不存在隶属、授权、合作或担保关系。</span></div><div><span><strong>使用责任</strong>本项目仅供个人学习、交流和非商业用途。禁止将本项目或其修改版本用于收费服务、商业产品、商业推广、代运营或其他营利活动。软件不保证功能持续可用或结果绝对准确。请仅处理本人有权访问的数据，并自行核对结果、承担使用风险。使用者应仅处理本人有权访问的数据，遵守学校规定、目标系统规则及适用法律法规。</span></div></div>
      <label class="disclaimer-confirm"><input v-model="disclaimerConfirmed" type="checkbox" /><span>我已阅读并理解上述免责声明与使用须知</span></label>
      <button class="primary-button wide" :disabled="!disclaimerConfirmed" @click="acceptWelcome">确认并开始使用</button>
    </BaseModal>
    <BaseModal v-if="update" title="发现新版本" dismissible @close="update = null"><span class="update-version">{{ update.version }}</span><p class="modal-lead">{{ update.name || 'QLU 工具箱更新' }}</p><p class="update-notes">{{ update.notes || '本次发布暂无详细说明。' }}</p><div class="modal-actions"><button class="secondary-button" @click="update = null">稍后再说</button><button class="primary-button" @click="api.openExternal(update!.url)">查看新版本</button></div></BaseModal>
    <BaseModal v-if="browser.required" :title="browser.error ? '浏览器组件下载未完成' : browser.installing ? '正在准备备用浏览器' : '需要备用浏览器组件'">
      <div class="browser-download-mark" :data-state="browser.error ? 'error' : browser.installing ? 'loading' : 'ready'">
        <XCircle v-if="browser.error" :size="28" />
        <Download v-else :size="28" />
      </div>
      <p class="modal-lead browser-download-lead">
        {{ browser.error || (browser.installing ? browser.message : '没有可用的 Edge 或 Chrome。下载一次后，今后可直接使用备用 Chromium。') }}
      </p>
      <div class="browser-download-facts">
        <div><Download :size="17" /><span><strong>约 {{ boot?.browserComponent.downloadSizeMiB || 180 }} MiB</strong><small>本次下载</small></span></div>
        <div><HardDrive :size="17" /><span><strong>约 {{ boot?.browserComponent.installedSizeMiB || 350 }} MiB</strong><small>安装后占用</small></span></div>
        <div><ShieldCheck :size="17" /><span><strong>仅保存在本机</strong><small>可随时在设置中删除</small></span></div>
      </div>
      <div v-if="browser.installing" class="browser-download-progress">
        <div><span>下载与安装进度</span><strong>{{ browser.progress }}%</strong></div>
        <div class="progress-track"><i :style="{ width: `${browser.progress}%` }" /></div>
        <p>请保持网络连接，完成后当前导出任务会自动继续。</p>
      </div>
      <div class="modal-actions browser-download-actions">
        <button v-if="browser.installing" class="secondary-button" @click="appStore.cancelBrowserComponentInstall">取消下载</button>
        <template v-else>
          <button class="secondary-button" @click="appStore.declineBrowserComponent">暂不下载</button>
          <button class="primary-button" @click="appStore.installBrowserComponent"><Download :size="16" /> {{ browser.error ? '重新下载' : '下载并继续' }}</button>
        </template>
      </div>
    </BaseModal>
  </div>
</template>
