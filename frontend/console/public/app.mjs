import { resource } from './api.mjs'
import { loadFeedback } from './feedback.mjs'
import { loadPublication } from './publication.mjs'
import { loadOperations, loadStatistics } from './reports.mjs'
import { field, runAction, showError, showMessage } from './ui.mjs'

const sessionPath = '/v1/auth/session'
let session
let activeView
const login = field('login')
const workspace = field('workspace')
const loginForm = field('login-form')
const loginSubmit = field('login-submit')

async function loadOverview() {
  showMessage('overview-message', '正在读取线上信息…', 'loading')
  try {
    const [overview, feedback] = await Promise.all([
      resource('/v1/overview'), resource('/v1/feedback-submissions?status=new&limit=1'),
    ])
    const versions = { windows: overview.windows, macos: overview.macos, ...overview.android }
    for (const [key, version] of Object.entries(versions)) {
      field(`${key}-version`).textContent = version ?? '—'
    }
    field('pending-feedback').textContent = feedback.counts.new
    showMessage('overview-message', '')
  } catch (error) {
    showError('overview-message', error)
  }
}

const views = {
  overview: loadOverview, feedback: loadFeedback, publish: () => loadPublication(session.permissions),
  stats: loadStatistics, operations: loadOperations, account: () => {},
}
const viewsByLegacyHash = { 'feedback-title': 'feedback', distribution: 'publish', announcement: 'publish' }

function navigate() {
  if (!session?.user) return
  const hash = location.hash.slice(1)
  if (hash === 'main') return
  const requested = viewsByLegacyHash[hash] ?? hash
  const allowed = Object.hasOwn(views, requested) && (requested !== 'operations' || session.permissions.viewOperations)
  const page = allowed ? requested : 'overview'
  if (page === activeView) return
  activeView = page
  for (const name of Object.keys(views)) field(`view-${name}`).hidden = name !== page
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === page) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  document.querySelector('.account').open = false
  void views[page]()
}

function setSession(value) {
  session = value
  login.hidden = Boolean(value.user)
  workspace.hidden = !value.user
  if (value.user) {
    field('username').textContent = value.user
    document.querySelector('[data-view="operations"]').hidden = !value.permissions.viewOperations
    activeView = undefined
    navigate()
    if (location.hash === '#main') {
      history.replaceState(null, '', '#overview')
      navigate()
    }
  } else {
    loginSubmit.disabled = false
    showMessage('login-message', '')
  }
}

async function initialize() {
  const retry = field('retry-session')
  retry.hidden = true
  showMessage('login-message', '正在检查登录状态…', 'loading')
  try {
    setSession(await resource(sessionPath))
  } catch (error) {
    showError('login-message', error)
    retry.hidden = false
  }
}

loginForm.onsubmit = async event => {
  event.preventDefault()
  await runAction('login-message', loginSubmit, async () => {
    const credentials = Object.fromEntries(new FormData(loginForm))
    try {
      setSession(await resource(sessionPath, 'POST', credentials))
      return ''
    } finally {
      loginForm.elements.namedItem('password').value = ''
    }
  })
}
field('retry-session').onclick = initialize
field('show-password').onclick = event => {
  const password = field('login-password')
  const visible = password.type === 'password'
  password.type = visible ? 'text' : 'password'
  event.currentTarget.setAttribute('aria-pressed', String(visible))
  event.currentTarget.textContent = visible ? '隐藏' : '显示'
}
field('logout').onclick = () => runAction('account-status', field('logout'), async () => {
  await resource(sessionPath, 'DELETE')
  location.replace('/')
  return '已退出登录'
})
field('password-form').onsubmit = async event => {
  event.preventDefault()
  const form = event.currentTarget
  await runAction('password-message', field('password-submit'), async () => {
    session = await resource('/v1/auth/password', 'POST', Object.fromEntries(new FormData(form)))
    form.reset()
    return '密码已更新'
  })
}

window.addEventListener('hashchange', navigate)
window.addEventListener('console-session-ended', () => location.reload())
void initialize()
