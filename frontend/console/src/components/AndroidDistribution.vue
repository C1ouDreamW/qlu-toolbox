<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DistributionPolicy } from '../api/client'
import { api } from '../useSession'
import { useAction } from '../useAction'
import { errorText } from '../ui'
import StatusMessage from './StatusMessage.vue'

const saved = ref<DistributionPolicy['mode']>()
const mode = ref<DistributionPolicy['mode']>('website')
const { pending, status, run } = useAction()

function showPolicy(policy: DistributionPolicy) {
  saved.value = policy.mode
  mode.value = policy.mode
}

function save() {
  return run(async () => showPolicy(await api.setDistribution(mode.value)), '分发策略已保存')
}

onMounted(async () => {
  try {
    showPolicy(await api.distribution())
  } catch (error) {
    status.value = { text: errorText(error), state: 'error' }
  }
})
</script>

<template>
  <section class="panel">
    <div class="panel-heading">
      <h2>Android 分发</h2>
      <span class="badge" :data-tone="saved === 'server' ? 'success' : undefined">{{ saved === 'server' ? '自建下载已开启' : saved === 'website' ? '外部下载模式' : status?.state === 'error' ? '读取失败' : '读取中' }}</span>
    </div>
    <label>分发方式<select v-model="mode" :disabled="!saved || pending"><option value="website">官网外部下载</option><option value="server">服务器 APK 下载</option></select></label>
    <div class="actions"><button class="primary" type="button" :disabled="!saved || pending || mode === saved" @click="save">保存策略</button></div>
    <StatusMessage :status="status" />
  </section>
</template>
