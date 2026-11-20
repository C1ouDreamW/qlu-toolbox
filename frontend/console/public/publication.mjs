import { resource } from './api.mjs'
import { dateFormat, field, runAction, showError, showMessage, textElement } from './ui.mjs'

const distribution = '/v1/distribution-policies/android'
const draftsPath = '/v1/announcement-drafts'
const form = field('draft-form')
const picker = field('draft')
const channel = field('channel')
const mode = field('mode')
const saveMode = field('save-mode')
const publish = field('publish')
const withdraw = field('withdraw')
let permissions = {}
let drafts = []
let editing = null
let savedMode
let announcementRequest = 0
let publicationInProgress = false

const selectedDraft = () => drafts.find(item => item.id === Number(picker.value))
const channelPath = () => `/v1/channels/${channel.value}/active-announcement`

function showPolicy(policy) {
  savedMode = policy.mode
  mode.value = savedMode
  mode.disabled = false
  saveMode.disabled = true
  const state = field('mode-state')
  state.dataset.active = String(savedMode === 'server')
  state.textContent = savedMode === 'server' ? '自建下载已开启' : '外部下载模式'
}

mode.onchange = () => { saveMode.disabled = savedMode === mode.value }
saveMode.onclick = async () => {
  mode.disabled = true
  try {
    await runAction('mode-message', saveMode, async () => {
      showPolicy(await resource(distribution, 'PUT', { mode: mode.value }))
      return '分发策略已保存'
    })
  } finally {
    mode.disabled = false
    mode.onchange()
  }
}

function displayDraft() {
  const draft = selectedDraft()
  field('draft-preview').hidden = !draft
  field('edit-draft').hidden = !draft || !permissions.editDraft
  field('delete-draft').hidden = !draft || !permissions.deleteDraft
  publish.disabled = !draft || publicationInProgress
  if (!draft) return
  field('preview-title').textContent = draft.title
  field('preview-body').textContent = draft.body
  field('preview-url').textContent = draft.url ? `详情链接 ${draft.url}` : ''
  field('preview-expiry').textContent = draft.expiresAt ? `到期时间 ${dateFormat.format(new Date(draft.expiresAt))}` : ''
}

async function loadDrafts(id = picker.value) {
  const result = await resource(draftsPath)
  drafts = result.items
  const options = drafts.map(item => {
    const option = textElement('option', '', item.title)
    option.value = item.id
    return option
  })
  picker.replaceChildren(...(options.length ? options : [textElement('option', '', '暂无草稿')]))
  if (drafts.some(item => item.id === Number(id))) picker.value = String(id)
  picker.disabled = !drafts.length
  displayDraft()
}

async function loadActive() {
  const request = ++announcementRequest
  withdraw.disabled = true
  try {
    const result = await resource(channelPath())
    if (request !== announcementRequest) return
    showMessage('active-announcement', `当前公告 · ${result.title}`)
    withdraw.disabled = publicationInProgress
  } catch (error) {
    if (request !== announcementRequest) return
    if (error.status === 404) showMessage('active-announcement', '该渠道暂无公告')
    else showError('active-announcement', error)
  }
}

async function changeAnnouncement(button, method, data, message) {
  const path = channelPath()
  publicationInProgress = true
  channel.disabled = true
  publish.disabled = true
  withdraw.disabled = true
  try {
    await runAction('announcement-message', button, async () => {
      await resource(path, method, data)
      return message
    })
  } finally {
    publicationInProgress = false
    channel.disabled = false
    displayDraft()
    await loadActive()
  }
}

function editDraft(draft) {
  editing = draft?.id ?? null
  field('draft-form-title').textContent = draft ? '编辑公告草稿' : '新建公告草稿'
  form.reset()
  for (const name of ['title', 'body', 'level', 'url']) {
    if (draft) form.elements.namedItem(name).value = draft[name]
  }
  if (draft?.expiresAt) {
    const date = new Date(draft.expiresAt)
    const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
    form.elements.namedItem('expiresAt').value = local.toISOString().slice(0, 16)
  }
  showMessage('draft-message', '')
  form.hidden = false
  form.elements.namedItem('title').focus()
}

picker.onchange = displayDraft
channel.onchange = loadActive
publish.onclick = () => {
  const draft = selectedDraft()
  if (draft) return changeAnnouncement(publish, 'PUT', { draftId: draft.id }, `已发布至 ${channel.selectedOptions[0].textContent}`)
}
withdraw.onclick = () => changeAnnouncement(withdraw, 'DELETE', undefined, '已撤回该渠道公告')
field('new-draft').onclick = () => editDraft(null)
field('edit-draft').onclick = () => editDraft(selectedDraft())
field('cancel-draft').onclick = () => { form.hidden = true }
field('delete-draft').onclick = async () => {
  const draft = selectedDraft()
  if (!draft || !window.confirm(`删除草稿「${draft.title}」？`)) return
  await runAction('announcement-message', field('delete-draft'), async () => {
    await resource(`${draftsPath}/${draft.id}`, 'DELETE')
    if (editing === draft.id) form.hidden = true
    await loadDrafts()
    return '草稿已删除'
  })
}

form.onsubmit = async event => {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(form))
  data.expiresAt = data.expiresAt ? new Date(data.expiresAt).toISOString() : null
  const saved = await runAction('draft-message', field('save-draft'), async () => {
    const draft = editing ? await resource(`${draftsPath}/${editing}`, 'PUT', data) : await resource(draftsPath, 'POST', data)
    // A retry after a transient read failure should update the saved draft.
    editing = draft.id
    await loadDrafts(draft.id)
    return '草稿已保存'
  })
  if (saved) {
    form.hidden = true
    showMessage('announcement-message', '草稿已保存', 'success')
    picker.focus()
  }
}

export async function loadPublication(sessionPermissions) {
  permissions = sessionPermissions
  field('new-draft').hidden = !permissions.addDraft
  await Promise.all([
    resource(distribution).then(showPolicy).catch(error => {
      field('mode-state').textContent = '读取失败'
      showError('mode-message', error)
    }),
    loadDrafts().catch(error => showError('announcement-message', error)),
    loadActive(),
  ])
}
