import { computed, reactive, watch } from 'vue'
import type {
  BootstrapData, BrowserComponentEvent, BrowserComponentStatus,
  GradeEvent, PageName, Settings, TaskRecord,
} from './types'

const state = reactive({
  boot: null as BootstrapData | null,
  page: 'home' as PageName,
  loading: true,
  error: '',
  toast: null as null | { message: string; tone: 'success' | 'error' | 'info' },
  grade: {
    running: false,
    taskId: '',
    stage: 'environment',
    status: '准备就绪',
    logs: [] as string[],
    resultPath: '',
    failed: false,
  },
  browser: {
    required: false,
    installing: false,
    progress: 0,
    message: '',
    error: '',
  },
})

let toastTimer: number | undefined
function notify(message: string, tone: 'success' | 'error' | 'info' = 'info') {
  state.toast = { message, tone }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { state.toast = null }, 3500)
}

function applyTheme(theme: Settings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

async function refreshTasks() {
  if (!state.boot) return
  state.boot.tasks = await window.qlu.invoke<TaskRecord[]>('listTasks', { limit: 200 })
}

async function saveSettings(patch: Partial<Settings>) {
  if (!state.boot) return
  state.boot.settings = await window.qlu.invoke<Settings>('saveSettings', patch as Record<string, unknown>)
  applyTheme(state.boot.settings.theme)
  notify('设置已保存', 'success')
}

async function initialize() {
  try {
    state.boot = await window.qlu.invoke<BootstrapData>('bootstrap')
    applyTheme(state.boot.settings.theme)
    window.qlu.onEvent((name, payload) => {
      if (name === 'browserComponent') {
        const event = (payload as { event: BrowserComponentEvent }).event
        if (event.type === 'progress') {
          state.browser.installing = true
          state.browser.progress = event.progress ?? state.browser.progress
          state.browser.message = event.message || '正在下载浏览器组件…'
          state.browser.error = ''
        } else if (event.type === 'success') {
          state.browser.installing = false
          state.browser.progress = 100
          state.browser.message = event.message || '浏览器组件安装完成'
          state.browser.error = ''
          state.browser.required = false
          if (event.status && state.boot) state.boot.browserComponent = event.status
          notify('浏览器组件安装完成', 'success')
        } else if (event.type === 'error' || event.type === 'cancelled') {
          state.browser.installing = false
          state.browser.error = event.message || '浏览器组件下载未完成'
          if (event.status && state.boot) state.boot.browserComponent = event.status
        }
        return
      }
      if (name !== 'gradeExport') return
      const message = payload as { taskId: string; event: GradeEvent }
      const event = message.event
      if (event.type === 'status') {
        state.grade.stage = event.stage || state.grade.stage
        state.grade.status = event.message || '正在处理…'
      } else if (event.type === 'log') {
        state.grade.logs.push(event.message || '')
      } else if (event.type === 'browser_required') {
        state.grade.stage = 'browser'
        state.grade.status = event.message || '需要下载备用浏览器组件'
        state.browser.required = true
        state.browser.installing = false
        state.browser.progress = 0
        state.browser.message = '下载完成后将自动继续当前任务。'
        state.browser.error = ''
      } else if (event.type === 'success') {
        state.grade.running = false
        state.grade.resultPath = event.path || ''
        state.grade.status = '导出完成'
        state.grade.stage = 'success'
        state.browser.required = false
        notify('成绩文件已成功导出', 'success')
        void refreshTasks()
      } else if (event.type === 'cancelled') {
        state.grade.running = false
        state.grade.status = event.message || '操作已取消'
        state.grade.stage = 'cancelled'
        state.browser.required = false
        void refreshTasks()
      } else if (event.type === 'error') {
        state.grade.running = false
        state.grade.failed = true
        state.grade.status = event.message || '导出失败'
        state.grade.stage = 'error'
        state.browser.required = false
        notify(state.grade.status, 'error')
        void refreshTasks()
      }
    })
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.loading = false
  }
}

async function installBrowserComponent() {
  state.browser.installing = true
  state.browser.progress = 0
  state.browser.message = '正在准备下载…'
  state.browser.error = ''
  try {
    const status = await window.qlu.invoke<BrowserComponentStatus>('startBrowserInstall')
    state.browser.installing = status.installing
    if (status.installed) {
      if (state.boot) state.boot.browserComponent = status
      state.browser.required = false
    }
  } catch (error) {
    state.browser.installing = false
    state.browser.error = error instanceof Error ? error.message : String(error)
  }
}

async function cancelBrowserComponentInstall() {
  await window.qlu.invoke('cancelBrowserInstall')
  state.browser.message = '正在取消下载…'
}

async function declineBrowserComponent() {
  if (state.browser.installing) await cancelBrowserComponentInstall()
  await window.qlu.invoke('gradeCommand', { command: 'cancel' })
  state.browser.required = false
}

watch(() => state.page, (page) => { if (page === 'tasks' || page === 'home') void refreshTasks() })

export const appStore = {
  state,
  boot: computed(() => state.boot),
  initialize,
  notify,
  refreshTasks,
  saveSettings,
  installBrowserComponent,
  cancelBrowserComponentInstall,
  declineBrowserComponent,
  navigate(page: PageName) { state.page = page },
}
