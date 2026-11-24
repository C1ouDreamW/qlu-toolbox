<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { Overview } from '../api/client'
import StatusMessage from '../components/StatusMessage.vue'
import { api } from '../useSession'
import { errorText, numberFormat, type Status } from '../ui'

const versions = shallowRef<Overview>()
const pendingFeedback = ref<number>()
const status = ref<Status | undefined>({ text: '正在读取线上信息…', state: 'loading' })
const releases = computed(() => [
  { platform: 'Windows', version: versions.value?.windows },
  { platform: 'macOS', version: versions.value?.macos },
  { platform: 'Android', channel: 'Stable', version: versions.value?.android.stable },
  { platform: 'Android', channel: 'Alpha', version: versions.value?.android.alpha },
])

async function load() {
  status.value = { text: '正在读取线上信息…', state: 'loading' }
  const [overview, feedback] = await Promise.allSettled([
    api.overview(), api.feedback(new URLSearchParams({ status: 'new', limit: '1' })),
  ])
  if (overview.status === 'fulfilled') versions.value = overview.value
  if (feedback.status === 'fulfilled') pendingFeedback.value = feedback.value.counts.new
  const errors = []
  if (overview.status === 'rejected') errors.push(`线上版本：${errorText(overview.reason)}`)
  if (feedback.status === 'rejected') errors.push(`反馈：${errorText(feedback.reason)}`)
  status.value = errors.length ? { text: errors.join(' · '), state: 'error' } : undefined
}

onMounted(() => void load())
</script>

<template>
  <section class="view">
    <div class="page-heading">
      <h1>运营概览</h1>
      <a class="outline-link" href="https://lumatile.cn/">访问官网</a>
    </div>
    <div class="overview-grid">
      <section class="panel feedback-summary">
        <h2>待处理反馈</h2>
        <p class="queue-count" aria-live="polite">{{ pendingFeedback === undefined ? '—' : numberFormat.format(pendingFeedback) }}</p>
        <RouterLink class="outline-link" :to="{ name: 'feedback' }">查看反馈</RouterLink>
      </section>
      <section class="panel versions">
        <div class="panel-heading">
          <h2>线上版本</h2>
          <RouterLink :to="{ name: 'publish' }">前往发布</RouterLink>
        </div>
        <dl>
          <div v-for="release in releases" :key="release.platform + (release.channel ?? '')">
            <dt>{{ release.platform }}<span v-if="release.channel" class="badge">{{ release.channel }}</span></dt>
            <dd>{{ release.version ?? '—' }}</dd>
          </div>
        </dl>
      </section>
    </div>
    <StatusMessage :status="status" />
    <button v-if="status?.state === 'error'" type="button" @click="load">重新加载</button>
  </section>
</template>

<style scoped>
.overview-grid { display: grid; grid-template-columns: minmax(170px, .65fr) minmax(0, 1.35fr); gap: 16px; }
.feedback-summary { display: grid; align-content: start; justify-items: start; gap: 12px; border-color: #d5e3fb; background: linear-gradient(135deg, #e8f0ff, #f5f8ff); }
.feedback-summary h2 { color: #3a507b; }
.feedback-summary .queue-count { font-size: clamp(2.4rem, 7vw, 4rem); line-height: 1.1; font-weight: 760; letter-spacing: -.04em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.versions .panel-heading a { font-size: .875rem; }
.versions dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.versions dl > div { min-width: 0; padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; background: var(--page); }
.versions dt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--muted); font-size: .875rem; }
.versions dd { margin-top: 4px; font-size: 1.2rem; font-weight: 730; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
@media (max-width: 640px) { .overview-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
