<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  FolderOpen, Monitor, Moon, Sun, RefreshCw, Shield, Database, Trash2,
  ExternalLink, Save, HardDriveDownload, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import BaseSelect from '@/components/BaseSelect.vue'
import BaseModal from '@/components/BaseModal.vue'
import { appStore } from '@/store'
import type { BootstrapData, BrowserComponentStatus, Settings } from '@/types'

const props = defineProps<{ data: BootstrapData }>()
const api = window.qlu
const emit = defineEmits<{ 'check-update': [] }>()
const form = reactive<Settings>({ ...props.data.settings })
const confirmBrowserRemoval = ref(false)
const removingBrowser = ref(false)
const browser = computed(() => props.data.browserComponent)
const browserOptions = [
  { value: 'auto', label: '自动选择（推荐）' },
  { value: 'edge', label: 'Microsoft Edge' },
  { value: 'chrome', label: 'Google Chrome' },
  { value: 'chromium', label: '备用 Chromium' },
]
const preferredBrowser = computed({
  get: () => form.preferred_browser,
  set: (value: string) => { form.preferred_browser = value as Settings['preferred_browser'] },
})

function formatBytes(value: number) {
  if (!value) return '0 MiB'
  return `${(value / 1024 / 1024).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MiB`
}

async function browse() {
  const selected = await window.qlu.selectDirectory(form.default_output_dir)
  if (selected) form.default_output_dir = selected
}
async function save() { await appStore.saveSettings({ ...form }) }
async function clear(kind: 'clearProfiles'|'clearLogs') {
  const label = kind === 'clearProfiles' ? '浏览器登录状态' : '日志与缓存'
  if (!confirm(`确定清除${label}吗？此操作无法撤销。`)) return
  await window.qlu.invoke(kind)
  appStore.notify(`${label}已清除`, 'success')
}
function openDataLocation(key: 'settings' | 'tasks' | 'logs' | 'profiles' | 'browsers') {
  const target = props.data.paths[key]
  return key === 'settings' || key === 'tasks' ? api.showItem(target) : api.openPath(target)
}
async function removeBrowser() {
  removingBrowser.value = true
  try {
    props.data.browserComponent = await api.invoke<BrowserComponentStatus>('removeBrowserComponent')
    confirmBrowserRemoval.value = false
    appStore.notify('备用浏览器组件已删除', 'success')
  } catch (error) {
    appStore.notify(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    removingBrowser.value = false
  }
}
</script>

<template>
  <div class="page settings-page">
    <PageHeader eyebrow="PREFERENCES" title="设置" description="按照你的习惯调整工具箱。">
      <button class="primary-button save-top" @click="save"><Save :size="17" /> 保存更改</button>
    </PageHeader>

    <section class="settings-section">
      <div class="settings-title"><Monitor :size="20" /><div><h2>通用</h2><p>外观、文件保存和浏览器偏好</p></div></div>
      <div class="settings-card">
        <div class="setting-row"><div><strong>默认保存位置</strong><span>导出的 Excel 文件会优先保存到这里</span></div><div class="path-picker"><input v-model="form.default_output_dir" /><button class="secondary-button" @click="browse"><FolderOpen :size="16" /> 选择</button></div></div>
        <div class="setting-row"><div><strong>首选浏览器</strong><span>登录教务系统时优先尝试使用</span></div><BaseSelect v-model="preferredBrowser" :options="browserOptions" aria-label="选择首选浏览器" /></div>
        <div class="setting-row"><div><strong>界面主题</strong><span>更改会在保存后立即生效</span></div><div class="segmented theme-segments"><button :class="{active:form.theme==='light'}" @click="form.theme='light'"><Sun :size="15" />浅色</button><button :class="{active:form.theme==='dark'}" @click="form.theme='dark'"><Moon :size="15" />深色</button><button :class="{active:form.theme==='system'}" @click="form.theme='system'"><Monitor :size="15" />跟随系统</button></div></div>
        <label class="setting-row toggle-row"><div><strong>保留浏览器登录状态</strong><span>下次使用时可能无需重新登录</span></div><input v-model="form.keep_login_state" type="checkbox" class="switch" /></label>
        <label class="setting-row toggle-row"><div><strong>启动时检查更新</strong><span>只访问公开的 GitHub Releases，不发送个人数据</span></div><input v-model="form.check_updates" type="checkbox" class="switch" /></label>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-title"><HardDriveDownload :size="20" /><div><h2>浏览器组件</h2><p>管理查询功能按需下载的备用 Chromium</p></div></div>
      <div class="settings-card browser-component-card">
        <div class="browser-component-main">
          <div class="browser-component-icon" :data-installed="browser.installed"><CheckCircle2 v-if="browser.installed" :size="22" /><HardDriveDownload v-else :size="22" /></div>
          <div class="browser-component-copy">
            <div><strong>备用 Chromium</strong><span class="browser-state-pill" :data-state="browser.installed ? 'installed' : browser.hasFiles ? 'stale' : 'empty'">{{ browser.installed ? '已安装' : browser.hasFiles ? '需要更新' : '未安装' }}</span></div>
            <p v-if="browser.installed">版本 {{ browser.version || browser.revision }} · 占用 {{ formatBytes(browser.sizeBytes) }}</p>
            <p v-else-if="browser.hasFiles">检测到旧版或不完整组件，可删除后在下次需要时重新下载。</p>
            <p v-else>仅在 Edge 和 Chrome 都不可用时提示下载，不会占用额外空间。</p>
            <button v-if="browser.hasFiles" class="browser-path" title="打开组件位置" @click="openDataLocation('browsers')"><ExternalLink :size="13" /> {{ browser.path }}</button>
          </div>
        </div>
        <button v-if="browser.hasFiles" class="danger-ghost" :disabled="browser.installing" @click="confirmBrowserRemoval = true"><Trash2 :size="16" /> 删除组件</button>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-title"><Database :size="20" /><div><h2>数据与隐私</h2><p>查看和管理保存在本机的数据</p></div></div>
      <div class="settings-card data-card">
        <div v-for="item in [{k:'settings',n:'设置文件'},{k:'tasks',n:'任务记录'},{k:'logs',n:'运行日志'},{k:'profiles',n:'浏览器登录状态'}]" :key="item.k" class="data-row"><div><strong>{{ item.n }}</strong><span>{{ data.paths[item.k as keyof typeof data.paths] }}</span></div><button class="icon-button" title="打开位置" @click="openDataLocation(item.k as 'settings' | 'tasks' | 'logs' | 'profiles')"><ExternalLink :size="16" /></button></div>
        <div class="danger-zone"><button class="danger-ghost" @click="clear('clearProfiles')"><Shield :size="16" /> 清除登录状态</button><button class="danger-ghost" @click="clear('clearLogs')"><Trash2 :size="16" /> 清除日志缓存</button></div>
      </div>
    </section>

    <section class="settings-section"><div class="settings-title"><RefreshCw :size="20" /><div><h2>软件更新</h2><p>当前版本 v{{ data.version }}</p></div></div><button class="secondary-button" @click="emit('check-update')"><RefreshCw :size="16" /> 检查更新</button></section>

    <BaseModal v-if="confirmBrowserRemoval" title="删除备用浏览器组件">
      <div class="browser-removal-mark"><AlertCircle :size="27" /></div>
      <p class="modal-lead">将释放约 {{ formatBytes(browser.sizeBytes) }} 空间。以后 Edge 和 Chrome 都不可用时，可再次按需下载。</p>
      <div class="modal-actions"><button class="secondary-button" :disabled="removingBrowser" @click="confirmBrowserRemoval = false">取消</button><button class="danger-ghost" :disabled="removingBrowser" @click="removeBrowser"><Loader2 v-if="removingBrowser" class="spin" :size="16" /><Trash2 v-else :size="16" />确认删除</button></div>
    </BaseModal>
  </div>
</template>
