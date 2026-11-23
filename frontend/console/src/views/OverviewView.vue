<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { Overview } from '../api/client'
import StatusMessage from '../components/StatusMessage.vue'
import { api } from '../useSession'
import { errorText, type Status } from '../ui'

const versions = shallowRef<Overview>()
const pendingFeedback = ref<number>()
const status = ref<Status | undefined>({ text: '正在读取线上信息…', state: 'loading' })

onMounted(async () => {
  try {
    const [overview, feedback] = await Promise.all([
      api.overview(), api.feedback(new URLSearchParams({ status: 'new', limit: '1' })),
    ])
    versions.value = overview
    pendingFeedback.value = feedback.counts.new
    status.value = undefined
  } catch (error) {
    status.value = { text: errorText(error), state: 'error' }
  }
})
</script>

<template>
  <section class="view">
    <div class="page-heading">
      <h1>运营概览</h1>
      <a class="outline-link" href="https://lumatile.cn/">访问官网</a>
    </div>
    <div class="panel versions">
      <h2>线上版本</h2>
      <dl>
        <div><dt>Windows</dt><dd>{{ versions?.windows ?? '—' }}</dd></div>
        <div><dt>macOS</dt><dd>{{ versions?.macos ?? '—' }}</dd></div>
        <div><dt>Android Stable</dt><dd>{{ versions?.android.stable ?? '—' }}</dd></div>
        <div><dt>Android Alpha</dt><dd>{{ versions?.android.alpha ?? '—' }}</dd></div>
      </dl>
    </div>
    <div class="panel">
      <h2>待处理反馈</h2>
      <p class="pending" aria-live="polite">{{ pendingFeedback ?? '—' }}</p>
      <RouterLink :to="{ name: 'feedback' }">查看反馈</RouterLink>
    </div>
    <StatusMessage :status="status" />
  </section>
</template>
