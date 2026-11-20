import { resource } from './api.mjs'
import { field, showMessage, textElement } from './ui.mjs'

const feedback = '/v1/feedback-submissions'
const status = field('status')
const search = field('search')
const feedbackRange = field('feedback-range')
const pagination = feedbackRange.closest('nav')
const feedbackDate = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
})
const query = () => feedback + '?' + new URLSearchParams({ status: status.value, q: search.value.trim(), limit: 10 })
let feedbackRequest = 0

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
  const date = new Date(item.created_at)
  const time = textElement('time', 'muted', feedbackDate.format(date))
  time.dateTime = item.created_at
  labels.append(badge, textElement('span', 'muted', [kind, version, item.id].join(' · ')), time)

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
      if (request === feedbackRequest) showMessage('feedback-message', error.message, 'error')
    } finally {
      button.disabled = false
    }
  }
  if (item.contact) actions.append(contact)
  actions.append(button)
  row.append(labels, textElement('p', 'feedback-body', item.content), actions)
  return row
}

export async function loadFeedback(url = query(), restoreFocus = false, confirmation = '') {
  const request = ++feedbackRequest
  const list = field('feedback')
  list.setAttribute('aria-busy', 'true')
  list.replaceChildren()
  pagination.hidden = true
  showMessage('feedback-message', '正在加载反馈…', 'loading')
  const pages = ['previous', 'next']
  for (const key of pages) field(key).disabled = true
  try {
    const result = await resource(url)
    if (request !== feedbackRequest) return
    if (!result.items.length && result.links.previous && result.total) {
      await loadFeedback(result.links.previous, restoreFocus, confirmation)
      return
    }
    field('feedback-counts').textContent = `${result.counts.new} 条待处理 · ${result.counts.resolved} 条已处理`
    const hasItems = result.items.length > 0
    const message = [confirmation, hasItems ? '' : '没有符合条件的反馈。'].filter(Boolean).join('。')
    const state = hasItems ? '' : 'empty'
    showMessage('feedback-message', message, confirmation ? 'success' : state)
    if (hasItems) {
      const offset = Number(new URLSearchParams(result.links.self.split('?')[1]).get('offset'))
      feedbackRange.textContent = `第 ${offset + 1}–${offset + result.items.length} 条，共 ${result.total} 条`
      pagination.hidden = false
    }
    list.append(...result.items.map(item => feedbackRow(item, url, request)))
    for (const key of pages) {
      field(key).disabled = !result.links[key]
      field(key).onclick = () => loadFeedback(result.links[key], true)
    }
  } catch (error) {
    if (request === feedbackRequest) showMessage('feedback-message', error.message, 'error')
  } finally {
    if (request === feedbackRequest) {
      list.setAttribute('aria-busy', 'false')
      if (restoreFocus) field('feedback-title').focus()
    }
  }
}

field('feedback-filter').onsubmit = event => {
  event.preventDefault()
  void loadFeedback()
}
status.onchange = () => loadFeedback()
search.oninput = () => { if (!search.value) void loadFeedback() }
