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

function run(action) {
  field('message').textContent = ''
  return action().catch(error => { field('message').textContent = error.message })
}

const distribution = '/v1/distribution-policies/android'
const announcement = () => `/v1/channels/${field('channel').value}/active-announcement`
const feedback = '/v1/feedback-submissions'
const query = () => feedback + '?' + new URLSearchParams({ status: field('status').value, q: field('search').value })
field('save-mode').onclick = () => run(async () => {
  const result = await resource(distribution, 'PUT', { mode: field('mode').value })
  field('mode').value = result.mode
  field('message').textContent = '分发策略已生效'
})
field('publish').onclick = () => run(async () => {
  await resource(announcement(), 'PUT', { draftId: Number(field('draft').value) })
  field('message').textContent = '公告已发布'
})
field('withdraw').onclick = () => run(async () => {
  await resource(announcement(), 'DELETE')
  field('message').textContent = '公告已撤回'
})

async function loadFeedback(url = query()) {
  const result = await resource(url)
  const items = result.items.map(item => {
    const row = document.createElement('li')
    const details = document.createElement('p')
    details.textContent = [item.id, item.platform, item.app_version, item.content, item.contact].filter(Boolean).join(' · ')
    const button = document.createElement('button')
    const status = item.status === 'new' ? 'resolved' : 'new'
    button.textContent = status === 'resolved' ? '标记已处理' : '重新打开'
    button.onclick = () => run(async () => {
      await resource(`${feedback}/${item.id}`, 'PATCH', { status })
      await loadFeedback(url)
    })
    row.append(details, button)
    return row
  })
  field('feedback').replaceChildren(...items)
  for (const key of ['previous', 'next']) {
    field(key).disabled = !result.links[key]
    field(key).onclick = () => run(() => loadFeedback(result.links[key]))
  }
}
field('reload').onclick = () => run(loadFeedback)
void run(async () => { field('mode').value = (await resource(distribution)).mode })
void run(loadFeedback)
