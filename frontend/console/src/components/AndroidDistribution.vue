<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Smartphone } from 'lucide-vue-next'
import type { DistributionPolicy } from '../api/client'
import { api } from '../useSession'
import { useAction } from '../useAction'
import { errorText } from '../ui'
import SelectField from './SelectField.vue'
import StatusMessage from './StatusMessage.vue'

const saved = ref<DistributionPolicy['mode']>()
const mode = ref<DistributionPolicy['mode']>('website')
const modes = [{ value: 'website', label: '官网外部下载' }, { value: 'server', label: '服务器 APK 下载' }] as const
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
      <h2 class="panel-title"><span class="icon-tile"><Smartphone :size="18" aria-hidden="true" /></span>Android 分发</h2>
      <span class="badge" :data-tone="saved === 'server' ? 'success' : undefined">{{ saved === 'server' ? '自建下载已开启' : saved === 'website' ? '外部下载模式' : status?.state === 'error' ? '读取失败' : '读取中' }}</span>
    </div>
    <SelectField v-model="mode" label="分发方式" :options="modes" :disabled="!saved || pending" />
    <div class="actions"><button class="primary" type="button" :disabled="!saved || pending || mode === saved" @click="save">保存策略</button></div>
    <StatusMessage :status="status" />
  </section>
</template>
