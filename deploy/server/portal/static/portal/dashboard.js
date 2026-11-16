const field = id => document.getElementById(id)
const csrf = document.querySelector('[name=csrfmiddlewaretoken]').value

async function resource(url, method = 'GET', data) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `请求失败 (${response.status})`)
  }
  if (response.status !== 204) return response.json()
}

function showMessage(id, text, isError = false) {
  const message = field(id)
  message.classList.toggle('error', isError)
  message.textContent = text
}

async function runAction(message, button, action) {
  button.disabled = true
  showMessage(message, '处理中…')
  try {
    showMessage(message, await action())
  } catch (error) {
    showMessage(message, error.message, true)
  } finally {
    button.disabled = false
  }
}

const distribution = '/v1/distribution-policies/android'
const mode = field('mode')
const saveMode = field('save-mode')

function showPolicy(policy) {
  mode.value = policy.mode
  const state = field('mode-state')
  state.dataset.active = String(policy.mode === 'server')
  state.textContent = policy.mode === 'server' ? '自建下载已开启' : '外部下载模式'
}

async function loadPolicy() {
  try {
    showPolicy(await resource(distribution))
    mode.disabled = false
    saveMode.disabled = false
  } catch (error) {
    field('mode-state').textContent = '读取失败'
    showMessage('mode-message', error.message, true)
  }
}

saveMode.onclick = () => runAction('mode-message', saveMode, async () => {
  mode.disabled = true
  try {
    showPolicy(await resource(distribution, 'PUT', { mode: mode.value }))
    return '分发策略已保存'
  } finally {
    mode.disabled = false
  }
})

const channel = field('channel')
const draft = field('draft')
const publish = field('publish')
const withdraw = field('withdraw')
const announcement = () => `/v1/channels/${channel.value}/active-announcement`
draft.onchange = () => {
  for (const preview of document.querySelectorAll('[data-draft]')) {
    preview.hidden = preview.dataset.draft !== draft.value
  }
}

function changeAnnouncement(button, method, data, confirmation) {
  const other = button === publish ? withdraw : publish
  const wasDisabled = other.disabled
  other.disabled = true
  return runAction('announcement-message', button, async () => {
    await resource(announcement(), method, data)
    return confirmation
  }).finally(() => { other.disabled = wasDisabled })
}

publish.onclick = () => changeAnnouncement(publish, 'PUT', { draftId: Number(draft.value) }, `已发布至 ${channel.selectedOptions[0].textContent}`)
withdraw.onclick = () => changeAnnouncement(withdraw, 'DELETE', undefined, `已撤回 ${channel.selectedOptions[0].textContent} 公告`)

const feedback = '/v1/feedback-submissions'
const query = () => feedback + '?' + new URLSearchParams({ status: field('status').value, q: field('search').value })
let feedbackRequest = 0

function textElement(tag, className, value) {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = value
  return element
}

function feedbackRow(item, url, request) {
  const row = document.createElement('li')
  const labels = document.createElement('div')
  labels.className = 'feedback-meta'
  const pending = item.status === 'new'
  const badge = textElement('span', 'badge', pending ? '待处理' : '已处理')
  badge.dataset.active = String(pending)
  const platform = item.platform === 'android' ? 'Android' : '桌面端'
  const version = item.app_version ? `${platform} v${item.app_version}` : platform
  const kind = item.type === 'bug' ? '问题' : '建议'
  labels.append(badge, textElement('span', 'muted', [kind, version, item.id].join(' · ')))

  const actions = document.createElement('div')
  actions.className = 'actions'
  const contact = textElement('span', 'muted', item.contact ? `联系方式：${item.contact}` : '')
  const button = textElement('button', '', pending ? '标记已处理' : '重新打开')
  button.type = 'button'
  button.setAttribute('aria-label', `${button.textContent} · ${item.id}`)
  button.onclick = async () => {
    button.disabled = true
    try {
      await resource(`${feedback}/${item.id}`, 'PATCH', { status: pending ? 'resolved' : 'new' })
      if (request === feedbackRequest) await loadFeedback(url, true, pending ? '反馈已标记为已处理' : '反馈已重新打开')
    } catch (error) {
      if (request === feedbackRequest) showMessage('feedback-message', error.message, true)
    } finally {
      button.disabled = false
    }
  }
  actions.append(contact, button)
  row.append(labels, textElement('p', 'feedback-body', item.content), actions)
  return row
}

async function loadFeedback(url = query(), focusStatus = false, confirmation = '') {
  const request = ++feedbackRequest
  const list = field('feedback')
  list.setAttribute('aria-busy', 'true')
  list.replaceChildren()
  showMessage('feedback-message', '正在加载反馈…')
  const pages = ['previous', 'next']
  for (const key of pages) field(key).disabled = true
  try {
    const result = await resource(url)
    if (request !== feedbackRequest) return
    if (!result.items.length && result.links.previous && result.total) {
      await loadFeedback(result.links.previous, focusStatus, confirmation)
      return
    }
    field('feedback-counts').textContent = `${result.counts.new} 条待处理 · ${result.counts.resolved} 条已处理`
    showMessage('feedback-message', [confirmation, result.items.length ? '' : '没有符合条件的反馈。'].filter(Boolean).join('。'))
    list.append(...result.items.map(item => feedbackRow(item, url, request)))
    for (const key of pages) {
      field(key).disabled = !result.links[key]
      field(key).onclick = () => loadFeedback(result.links[key])
    }
  } catch (error) {
    if (request === feedbackRequest) showMessage('feedback-message', error.message, true)
  } finally {
    if (request === feedbackRequest) {
      list.setAttribute('aria-busy', 'false')
      if (focusStatus) field('status').focus()
    }
  }
}

field('feedback-filter').onsubmit = event => {
  event.preventDefault()
  void loadFeedback()
}
void loadPolicy()
void loadFeedback()
