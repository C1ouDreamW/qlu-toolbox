<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { ChevronDown, RefreshCw } from 'lucide-vue-next'
import type { StatisticsReport } from '../api/client'
import DataTable from '../components/DataTable.vue'
import DistributionChart from '../components/DistributionChart.vue'
import StatusMessage from '../components/StatusMessage.vue'
import TrendChart from '../components/TrendChart.vue'
import { api } from '../useSession'
import { errorText, numberFormat, type Status } from '../ui'

const report = shallowRef<StatisticsReport>()
const loading = ref(false)
const status = ref<Status>()
const metrics = [
  { key: 'dau', label: '日活' },
  { key: 'new_installs', label: '新增安装' },
  { key: 'raw_checks', label: '更新检查' },
  { key: 'downloads', label: '自建源下载' },
] as const
const metric = ref<(typeof metrics)[number]>(metrics[0])
const totals = computed(() => {
  const values = report.value?.totals
  return values ? [
    { label: '识别安装', value: values.installs },
    { label: '匿名心跳', value: values.beacons },
    { label: '更新清单请求', value: values.manifest_checks },
    { label: '自建源下载', value: values.downloads_selfhosted },
    { label: 'GitHub 下载', value: values.downloads_github },
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
  return value ? [
    { title: '客户端分布', rows: value.client_dist }, { title: '版本分布', rows: value.version_dist },
    { title: '系统分布', rows: value.os_dist }, { title: '架构分布', rows: value.arch_dist },
  ] : []
})
const downloadRanks = computed(() => {
  const value = report.value
  return value ? [
    { title: '自建源下载', rows: value.top_files }, { title: 'GitHub 资源下载', rows: value.github_by_asset },
  ] : []
})

async function load() {
  loading.value = true
  status.value = { text: '正在读取统计报告…', state: 'loading' }
  try {
    report.value = await api.statistics()
    status.value = undefined
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
    <div class="page-heading">
      <div>
        <h1>访问统计</h1>
        <p v-if="report" class="page-meta">更新于 {{ report.generated_at.replace('T', ' ') }}</p>
      </div>
      <button type="button" :disabled="loading" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />{{ loading ? '刷新中…' : '刷新报告' }}
      </button>
    </div>
    <StatusMessage :status="status" />
    <div v-if="report" class="dashboard-stack">
      <section aria-labelledby="total-heading">
        <h2 id="total-heading" class="section-heading">累计概览</h2>
        <dl class="stats-totals">
          <div v-for="total in totals" :key="total.label" class="panel stat-tile">
            <dt>{{ total.label }}</dt>
            <dd>{{ numberFormat.format(total.value) }}</dd>
          </div>
        </dl>
      </section>
      <section class="panel">
        <div class="panel-heading trend-heading">
          <div><h2>每日趋势</h2><p class="muted">最近 {{ report.range_days }} 天</p></div>
          <div v-if="report.days.length" class="segment-control" role="group" aria-label="趋势指标">
            <button v-for="option in metrics" :key="option.key" type="button" :aria-pressed="option.key === metric.key"
              @click="metric = option">{{ option.label }}</button>
          </div>
        </div>
        <TrendChart v-if="report.days.length" :dates="report.days" :values="report[metric.key]" :label="metric.label" />
        <p v-else class="empty-state">暂无逐日数据</p>
        <details v-if="days.length" class="details-table disclosure">
          <summary><ChevronDown :size="16" aria-hidden="true" />逐日明细</summary>
          <DataTable :headers="['日期', '日活', '新增安装', '更新检查', '自建源下载']" :rows="days" />
        </details>
      </section>
      <section>
        <h2 class="section-heading">客户端构成</h2>
        <div class="distribution-grid">
          <DistributionChart v-for="entry in distributions" :key="entry.title" :title="entry.title" :rows="entry.rows" />
        </div>
      </section>
      <section>
        <div class="section-heading section-heading-inline">
          <h2>下载排行</h2>
          <p v-if="report.github_snapshot_day" class="muted">GitHub 快照 {{ report.github_snapshot_day }}</p>
        </div>
        <div class="distribution-grid">
          <DistributionChart v-for="entry in downloadRanks" :key="entry.title" :title="entry.title" :rows="entry.rows" />
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.stats-totals { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.stat-tile { padding: 17px 19px; }
.stat-tile dt { color: var(--muted); font-size: .875rem; }
.stat-tile dd { margin-top: 6px; font-size: clamp(1.4rem, 2.8vw, 1.95rem); font-weight: 760; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.stat-tile:first-child { background: #eef4ff; border-color: #d7e5ff; }
.stat-tile:first-child dd { color: var(--action); }
.trend-heading { align-items: flex-start; }
.distribution-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.details-table { border-top: 1px solid var(--line); margin-top: 13px; padding-top: 13px; }
.details-table summary { width: fit-content; }
.details-table :deep(table) { min-width: 430px; }
@media (max-width: 1020px) { .stats-totals { grid-template-columns: repeat(auto-fit, minmax(125px, 1fr)); } }
@media (max-width: 560px) {
  .stats-totals { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
  .stat-tile { grid-column: span 2; padding: 11px 10px; }
  .stat-tile:nth-child(-n+2) { grid-column: span 3; }
  .stat-tile dt { font-size: .8rem; }
  .stat-tile dd { margin-top: 3px; }
  .trend-heading .segment-control { width: 100%; }
  .trend-heading .segment-control button { flex: 1 0 auto; padding-inline: 5px; font-size: .76rem; }
  .distribution-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
