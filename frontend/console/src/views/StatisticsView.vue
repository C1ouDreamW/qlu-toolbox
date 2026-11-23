<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { StatisticsReport } from '../api/client'
import DataTable from '../components/DataTable.vue'
import StatusMessage from '../components/StatusMessage.vue'
import { api } from '../useSession'
import { errorText, type Status } from '../ui'

const report = shallowRef<StatisticsReport>()
const loading = ref(false)
const status = ref<Status>()
const totals = computed(() => {
  const values = report.value?.totals
  return values ? [
    ['识别安装', values.installs], ['匿名心跳', values.beacons], ['更新清单请求', values.manifest_checks],
    ['自建源下载', values.downloads_selfhosted], ['GitHub 下载', values.downloads_github],
  ] : []
})
const days = computed(() => {
  const value = report.value
  return value?.days.map((day, index) => [
    day, value.dau[index], value.new_installs[index], value.raw_checks[index], value.downloads[index],
  ]).reverse() ?? []
})
const distributions = computed(() => {
  const value = report.value
  if (!value) return []
  return [
    { title: '客户端分布', rows: value.client_dist }, { title: '版本分布', rows: value.version_dist },
    { title: '系统分布', rows: value.os_dist }, { title: '架构分布', rows: value.arch_dist },
    { title: '自建源下载', rows: value.top_files }, { title: 'GitHub 资源下载', rows: value.github_by_asset },
  ]
})

async function load() {
  loading.value = true
  status.value = { text: '正在读取统计报告…', state: 'loading' }
  try {
    const result = await api.statistics()
    report.value = result
    const snapshot = result.github_snapshot_day ? ` · GitHub 快照 ${result.github_snapshot_day}` : ''
    status.value = { text: `更新于 ${result.generated_at.replace('T', ' ')}${snapshot}` }
  } catch (error) {
    status.value = { text: errorText(error), state: 'error' }
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <section class="view">
    <div class="page-heading"><h1>访问统计</h1><button type="button" :disabled="loading" @click="load">刷新报告</button></div>
    <StatusMessage :status="status" />
    <div v-if="report" class="stack">
      <div class="panel">
        <h2>累计概览</h2>
        <DataTable :headers="['指标', '累计']" :rows="totals" />
      </div>
      <div class="panel">
        <h2>每日明细 · 最近 {{ report.range_days }} 天</h2>
        <DataTable v-if="days.length" :headers="['日期', '日活', '新增安装', '更新检查', '自建源下载']" :rows="days" />
        <p v-else class="message">暂无逐日数据</p>
      </div>
      <div class="publish-grid">
        <div v-for="entry in distributions" :key="entry.title" class="panel">
          <h2>{{ entry.title }}</h2>
          <DataTable v-if="entry.rows.length" :headers="['项目', '次数']" :rows="entry.rows.map(item => [item.label, item.count])" />
          <p v-else class="message">暂无数据</p>
        </div>
      </div>
    </div>
  </section>
</template>
