<script setup lang="ts">
import { computed } from 'vue'
import { numberFormat } from '../ui'

const props = defineProps<{ title: string; rows: { label: string; count: number }[] }>()
const maximum = computed(() => Math.max(1, ...props.rows.map(item => item.count)))
</script>

<template>
  <section class="panel distribution-chart">
    <h3>{{ title }}</h3>
    <ul v-if="rows.length" class="distribution-list">
      <li v-for="item in rows" :key="item.label">
        <span>{{ item.label }}</span>
        <strong>{{ numberFormat.format(item.count) }}</strong>
        <meter min="0" :max="maximum" :value="item.count" aria-hidden="true" />
      </li>
    </ul>
    <p v-else class="empty-state">暂无数据</p>
  </section>
</template>

<style scoped>
.distribution-list { display: grid; gap: 13px; padding: 0; margin: 16px 0 0; list-style: none; }
.distribution-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 14px; font-size: .875rem; overflow-wrap: anywhere; }
.distribution-list strong { font-variant-numeric: tabular-nums; }
.distribution-list meter { grid-column: 1 / -1; width: 100%; height: 7px; appearance: none; border: 0; border-radius: 6px; background: #ebf0fa; }
.distribution-list meter::-webkit-meter-bar { height: 7px; border: 0; background: #ebf0fa; }
.distribution-list meter::-webkit-meter-optimum-value { border-radius: 6px; background: #376bdf; }
.distribution-list meter::-moz-meter-bar { border-radius: 6px; background: #376bdf; }
</style>
