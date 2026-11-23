<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, shallowRef } from 'vue'
import type { Feedback, FeedbackPage } from '../api/client'
import StatusMessage from '../components/StatusMessage.vue'
import { api } from '../useSession'
import { dateFormat, errorText, type Status } from '../ui'

const heading = ref<HTMLHeadingElement>()
const filter = ref('new')
const search = ref('')
const page = shallowRef<FeedbackPage>()
const counts = shallowRef<FeedbackPage['counts']>()
const status = ref<Status>()
const loading = ref(false)
const updating = reactive(new Set<string>())
let request = 0

const offset = computed(() => {
  const link = page.value?.links.self ?? ''
  return Number(new URLSearchParams(link.split('?')[1]).get('offset'))
})

async function load(link?: string, restoreFocus = false, confirmation = '') {
  const current = ++request
  const query = link ?? new URLSearchParams({ status: filter.value, q: search.value.trim(), limit: '10' })
  loading.value = true
  page.value = undefined
  status.value = { text: '正在加载反馈…', state: 'loading' }
  try {
    const result = await api.feedback(query)
    if (current !== request) return
    if (!result.items.length && result.total && result.links.previous) {
      await load(result.links.previous, restoreFocus, confirmation)
      return
    }
    counts.value = result.counts
    page.value = result
    const text = [confirmation, result.items.length ? '' : '没有符合条件的反馈。'].filter(Boolean).join('。')
    status.value = { text, state: confirmation ? 'success' : result.items.length ? undefined : 'empty' }
  } catch (error) {
    if (current === request) status.value = { text: errorText(error), state: 'error' }
  } finally {
    if (current === request) {
      loading.value = false
      if (restoreFocus) {
        await nextTick()
        heading.value?.focus()
      }
    }
  }
}

async function changeStatus(item: Feedback) {
  const link = page.value?.links.self
  const current = request
  const pending = item.status === 'new'
  updating.add(item.id)
  try {
    await api.setFeedbackStatus(item.id, pending ? 'resolved' : 'new')
    if (current === request) await load(link, true, pending ? '反馈已标记为已处理' : '反馈已重新打开')
  } catch (error) {
    if (current === request) status.value = { text: errorText(error), state: 'error' }
  } finally {
    updating.delete(item.id)
  }
}

function itemLabel(item: Feedback) {
  const platform = item.platform === 'android' ? 'Android' : '桌面端'
  const version = item.app_version ? `${platform} v${item.app_version}` : platform
  return [item.type === 'bug' ? '问题' : '建议', version, item.id].join(' · ')
}

const actionLabel = (item: Feedback) => item.status === 'new' ? '标记已处理' : '重新打开'

function updateSearch(event: Event) {
  search.value = (event.target as HTMLInputElement).value
  if (!search.value) void load()
}

onMounted(() => void load())
</script>

<template>
  <section class="view">
    <div class="page-heading"><h1 id="feedback-title" ref="heading" tabindex="-1">用户反馈</h1></div>
    <div class="panel">
      <form id="feedback-filter" class="form-grid" @submit.prevent="load()">
        <label>状态<select v-model="filter" @change="load()"><option value="new">待处理</option><option value="resolved">已处理</option><option value="all">全部</option></select></label>
        <label>搜索<input :value="search" type="search" maxlength="120" placeholder="内容、联系方式或编号" @input="updateSearch"></label>
        <button class="primary" type="submit">搜索</button>
      </form>
      <p id="feedback-counts" class="muted" aria-live="polite">{{ counts ? `${counts.new} 条待处理 · ${counts.resolved} 条已处理` : '' }}</p>
      <StatusMessage :status="status" />
      <ul class="feedback-list" :aria-busy="loading">
        <li v-for="item in page?.items" :key="item.id">
          <div class="feedback-meta">
            <span class="badge" :data-active="item.status === 'new'">{{ item.status === 'new' ? '待处理' : '已处理' }}</span>
            <span class="muted">{{ itemLabel(item) }}</span>
            <time class="muted" :datetime="item.created_at">{{ dateFormat.format(new Date(item.created_at)) }}</time>
          </div>
          <p class="feedback-body">{{ item.content }}</p>
          <div class="actions">
            <span v-if="item.contact" class="muted">联系方式：{{ item.contact }}</span>
            <button type="button" :aria-label="`${actionLabel(item)} · ${item.id}`" :disabled="updating.has(item.id)" @click="changeStatus(item)">{{ actionLabel(item) }}</button>
          </div>
        </li>
      </ul>
      <nav v-if="page?.items.length" class="pagination" aria-label="反馈分页">
        <p class="muted" aria-live="polite">第 {{ offset + 1 }}–{{ offset + page.items.length }} 条，共 {{ page.total }} 条</p>
        <div>
          <button type="button" :disabled="!page.links.previous" @click="page.links.previous && load(page.links.previous, true)">上一页</button>
          <button type="button" :disabled="!page.links.next" @click="page.links.next && load(page.links.next, true)">下一页</button>
        </div>
      </nav>
    </div>
  </section>
</template>
