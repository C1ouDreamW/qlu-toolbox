<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { ChevronDown, Megaphone, Plus } from 'lucide-vue-next'
import { ApiError, type Channel, type Draft, type DraftInput } from '../api/client'
import AndroidDistribution from '../components/AndroidDistribution.vue'
import SelectField from '../components/SelectField.vue'
import StatusMessage from '../components/StatusMessage.vue'
import { useAction } from '../useAction'
import { api, useSession } from '../useSession'
import { dateFormat, errorText, type Status } from '../ui'

const { session } = useSession()
const permissions = computed(() => session.value?.permissions)
const channel = ref<Channel>('stable')
const channelLabels: Record<Channel, string> = { stable: 'Stable', alpha: 'Alpha' }
const channels = (['stable', 'alpha'] as const).map(value => ({ value, label: channelLabels[value] }))
const levels = [{ value: 'info', label: '普通' }, { value: 'warning', label: '重要' }] as const
const drafts = shallowRef<Draft[]>([])
const draftOptions = computed(() => drafts.value.map(item => ({ value: item.id, label: item.title })))
const draftId = ref<number>()
const draft = computed(() => drafts.value.find(item => item.id === draftId.value))
const picker = ref<{ focus: () => void }>()
const titleField = ref<HTMLInputElement>()
const activeStatus = ref<Status>()
const hasActive = ref(false)
const { pending: publishing, status: announcementStatus, run: runAnnouncement } = useAction()
const { pending: saving, status: draftStatus, run: runDraft } = useAction()
const editing = ref<number>()
const editorOpen = ref(false)
const form = reactive({ title: '', body: '', level: 'info' as DraftInput['level'], url: '', expiresAt: '' })
let activeRequest = 0

async function loadDrafts(selected = draftId.value) {
  const { items } = await api.drafts()
  drafts.value = items
  draftId.value = items.some(item => item.id === selected) ? selected : items[0]?.id
}

async function loadActive() {
  const current = ++activeRequest
  hasActive.value = false
  activeStatus.value = { text: '正在读取当前公告…', state: 'loading' }
  try {
    const announcement = await api.activeAnnouncement(channel.value)
    if (current !== activeRequest) return
    hasActive.value = true
    activeStatus.value = { text: `当前公告 · ${announcement.title}`, state: 'success' }
  } catch (error) {
    if (current !== activeRequest) return
    activeStatus.value = error instanceof ApiError && error.status === 404
      ? { text: '该渠道暂无公告', state: 'info' }
      : { text: errorText(error), state: 'error' }
  }
}

function publish() {
  const id = draftId.value
  const target = channel.value
  if (id === undefined) return
  return runAnnouncement(async () => {
    await api.publish(target, id)
    await loadActive()
  }, `已发布至 ${channelLabels[target]}`)
}

function withdraw() {
  return runAnnouncement(async () => {
    await api.withdraw(channel.value)
    await loadActive()
  }, '已撤回该渠道公告')
}

async function openEditor(item?: Draft) {
  editing.value = item?.id
  form.title = item?.title ?? ''
  form.body = item?.body ?? ''
  form.level = item?.level ?? 'info'
  form.url = item?.url ?? ''
  const expires = item?.expiresAt ? new Date(item.expiresAt) : null
  form.expiresAt = expires
    ? new Date(expires.valueOf() - expires.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : ''
  draftStatus.value = undefined
  editorOpen.value = true
  await nextTick()
  titleField.value?.focus()
}

function deleteDraft() {
  const item = draft.value
  if (!item || !window.confirm(`删除草稿「${item.title}」？`)) return
  return runAnnouncement(async () => {
    await api.deleteDraft(item.id)
    if (editing.value === item.id) editorOpen.value = false
    await loadDrafts()
  }, '草稿已删除')
}

async function saveDraft() {
  const saved = await runDraft(async () => {
    const data: DraftInput = { ...form, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null }
    const item = editing.value === undefined ? await api.createDraft(data) : await api.updateDraft(editing.value, data)
    // 保存成功后刷新失败时，重试应更新同一草稿。
    editing.value = item.id
    await loadDrafts(item.id)
  })
  if (saved) {
    editorOpen.value = false
    announcementStatus.value = { text: '草稿已保存', state: 'success' }
    picker.value?.focus()
  }
}

watch(channel, () => void loadActive(), { immediate: true })
onMounted(async () => {
  try {
    await loadDrafts()
  } catch (error) {
    announcementStatus.value = { text: errorText(error), state: 'error' }
  }
})
</script>

<template>
  <section class="view">
    <div class="page-heading"><h1>发布</h1></div>
    <div class="publish-layout">
      <section class="panel">
        <div class="panel-heading">
          <h2 class="panel-title"><span class="icon-tile"><Megaphone :size="18" aria-hidden="true" /></span>应用内公告</h2>
          <button v-if="permissions?.addDraft" type="button" :disabled="saving || publishing" @click="openEditor()">
            <Plus :size="16" aria-hidden="true" />新建草稿
          </button>
        </div>
        <div class="form-grid announcement-fields">
          <SelectField v-model="channel" label="渠道" :options="channels" :disabled="publishing" />
          <SelectField ref="picker" v-model="draftId" label="草稿" :options="draftOptions" placeholder="暂无草稿"
            :disabled="!drafts.length || saving || publishing" />
        </div>
        <StatusMessage class="active-announcement" :status="activeStatus" />
        <details v-if="draft" class="preview disclosure" open>
          <summary><ChevronDown :size="16" aria-hidden="true" />预览所选草稿</summary>
          <article>
            <div class="preview-title">
              <h3>{{ draft.title }}</h3>
              <span class="badge" :data-tone="draft.level === 'warning' ? 'warning' : undefined">{{ draft.level === 'warning' ? '重要' : '普通' }}</span>
            </div>
            <p class="feedback-body">{{ draft.body }}</p>
            <p v-if="draft.url" class="muted">详情链接 {{ draft.url }}</p>
            <p v-if="draft.expiresAt" class="muted">到期时间 {{ dateFormat.format(new Date(draft.expiresAt)) }}</p>
          </article>
        </details>
        <div class="actions">
          <button class="primary" type="button" :disabled="!draft || publishing || saving" @click="publish">发布到所选渠道</button>
          <button type="button" :disabled="!hasActive || publishing" @click="withdraw">撤回当前公告</button>
          <button v-if="draft && permissions?.editDraft" type="button" :disabled="saving || publishing" @click="openEditor(draft)">编辑草稿</button>
          <button v-if="draft && permissions?.deleteDraft" class="danger" type="button" :disabled="saving || publishing" @click="deleteDraft">删除草稿</button>
        </div>
        <StatusMessage :status="announcementStatus" />
        <form v-if="editorOpen" class="draft-form stack" @submit.prevent="saveDraft">
          <h3>{{ editing === undefined ? '新建公告草稿' : '编辑公告草稿' }}</h3>
          <label>标题<input ref="titleField" v-model="form.title" maxlength="120" required></label>
          <label>正文<textarea v-model="form.body" rows="5" required></textarea></label>
          <div class="draft-options">
            <SelectField v-model="form.level" label="级别" :options="levels" />
            <label>到期时间（本机时间）<input v-model="form.expiresAt" type="datetime-local"></label>
          </div>
          <label>详情链接<input v-model="form.url" type="url" maxlength="200" placeholder="https://"></label>
          <div class="draft-actions"><button class="primary" type="submit" :disabled="saving || publishing">保存草稿</button><button type="button" :disabled="saving" @click="editorOpen = false">取消</button></div>
          <StatusMessage :status="draftStatus" />
        </form>
      </section>
      <AndroidDistribution />
    </div>
  </section>
</template>

<style scoped>
.publish-layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(265px, 1fr); align-items: start; gap: var(--panel-gap); }
.active-announcement.message { margin-top: 16px; }
.preview { margin-top: 16px; border: 1px solid var(--line); border-radius: 10px; overflow-wrap: anywhere; }
.preview summary { margin: 4px; }
.preview article { margin: 0 13px; padding: 12px 0; border-top: 1px solid var(--line); }
.preview-title { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.preview p { margin-top: 6px; }
.feedback-body { white-space: pre-wrap; }
.draft-form { margin-top: 18px; padding: 16px; border: 1px solid var(--line); border-radius: 11px; background: var(--page); }
.draft-options { display: grid; grid-template-columns: minmax(70px, .5fr) minmax(0, 1fr); gap: 10px; }
.draft-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 920px) { .publish-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 440px) { .draft-options { grid-template-columns: minmax(0, 1fr); } }
</style>
