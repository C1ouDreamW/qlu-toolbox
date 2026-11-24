<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { ArrowRight, ArrowUpRight, Inbox, Laptop, Monitor, PackageCheck, Smartphone } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import type { Overview } from '../api/client'
import StatusMessage from '../components/StatusMessage.vue'
import { api } from '../useSession'
import { errorText, numberFormat, type Status } from '../ui'

const versions = shallowRef<Overview>()
const pendingFeedback = ref<number>()
const status = ref<Status | undefined>({ text: '正在读取线上信息…', state: 'loading' })
const releases = computed(() => [
  { platform: 'Windows', icon: Monitor, version: versions.value?.windows },
  { platform: 'macOS', icon: Laptop, version: versions.value?.macos },
  { platform: 'Android', icon: Smartphone, channel: 'Stable', version: versions.value?.android.stable },
  { platform: 'Android', icon: Smartphone, channel: 'Alpha', version: versions.value?.android.alpha },
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
      <a class="outline-link" href="https://lumatile.cn/">访问官网<ArrowUpRight :size="16" aria-hidden="true" /></a>
    </div>
    <div class="overview-grid">
      <section class="panel feedback-summary">
        <h2 class="panel-title"><span class="icon-tile"><Inbox :size="18" aria-hidden="true" /></span>待处理反馈</h2>
        <p class="queue-count" aria-live="polite">{{ pendingFeedback === undefined ? '—' : numberFormat.format(pendingFeedback) }}</p>
        <RouterLink class="action-link" :to="{ name: 'feedback' }">查看反馈<ArrowRight :size="16" aria-hidden="true" /></RouterLink>
      </section>
      <section class="panel versions">
        <div class="panel-heading">
          <h2 class="panel-title"><span class="icon-tile"><PackageCheck :size="18" aria-hidden="true" /></span>线上版本</h2>
          <RouterLink class="action-link" :to="{ name: 'publish' }">前往发布<ArrowRight :size="16" aria-hidden="true" /></RouterLink>
        </div>
        <dl>
          <div v-for="release in releases" :key="release.platform + (release.channel ?? '')">
            <dt>
              <component :is="release.icon" :size="16" aria-hidden="true" />
              {{ release.platform }}
              <span v-if="release.channel" class="badge" :data-tone="release.channel === 'Alpha' ? 'warning' : 'success'">{{ release.channel }}</span>
            </dt>
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
.overview-grid { display: grid; grid-template-columns: minmax(190px, .7fr) minmax(0, 1.3fr); gap: var(--panel-gap); }
.feedback-summary { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; border-color: #d9e5fc; background: linear-gradient(145deg, #eaf2ff, #f6f9ff); }
.feedback-summary .icon-tile { background: #dce9ff; }
.feedback-summary .queue-count { margin-block: 4px; font-size: clamp(2.75rem, 6vw, 3.65rem); line-height: 1; font-weight: 725; letter-spacing: -.06em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.feedback-summary .action-link { margin: auto 0 0 -8px; }
.versions dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.versions dl > div { min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--subtle); }
.versions dt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--muted); font-size: .875rem; }
.versions dt svg { flex: none; }
.versions dd { margin-top: 4px; font-size: 1.22rem; font-weight: 720; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
@media (max-width: 720px) { .overview-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
