<script setup lang="ts">
// 上课时间选择面板：待安排开关 + 星期/开始节次/结束节次三列滚轮联动，结束节次不早于开始节次。
import { computed, ref, watch } from 'vue'
import type { PeriodTime } from '@lumatile/contracts'
import FloatingPanel from './FloatingPanel.vue'
import ScheduleWheelPicker from './ScheduleWheelPicker.vue'
import type { WheelOption } from './ScheduleWheelPicker.vue'

const props = defineProps<{
  anchorEl: HTMLElement | null
  weekday: number | null
  startPeriod: number | null
  endPeriod: number | null
  periods: PeriodTime[]
}>()
const emit = defineEmits<{ close: []; save: [value: { weekday: number | null; startPeriod: number | null; endPeriod: number | null }] }>()

const pending = ref(false)
const day = ref(1)
const start = ref(1)
const end = ref(1)

function syncFromProps() {
  pending.value = props.weekday === null
  day.value = props.weekday ?? 1
  start.value = props.startPeriod ?? props.periods[0]?.period ?? 1
  end.value = props.endPeriod ?? props.startPeriod ?? props.periods[0]?.period ?? 1
}
syncFromProps()

watch(() => [props.weekday, props.startPeriod, props.endPeriod], syncFromProps)

const dayOptions: WheelOption[] = '一二三四五六日'.split('').map((name, index) => ({
  value: index + 1, label: `周${name}`,
}))
const startOptions = computed<WheelOption[]>(() => props.periods.map(period => ({
  value: period.period, label: `第 ${period.period} 节`, sublabel: period.start || undefined,
})))
const endOptions = computed<WheelOption[]>(() => props.periods.map(period => ({
  value: period.period, label: `第 ${period.period} 节`, sublabel: period.end || undefined,
})))

watch(start, value => { if (end.value < value) end.value = value })

const timeHint = computed(() => {
  if (pending.value) return ''
  const startItem = props.periods.find(item => item.period === start.value)
  const endItem = props.periods.find(item => item.period === end.value)
  const name = '一二三四五六日'[day.value - 1]
  if (startItem?.start && endItem?.end) return `每周${name} · ${startItem.start} – ${endItem.end}`
  if (startItem?.start) return `每周${name} · ${startItem.start} 上课`
  return `每周${name}`
})

function save() {
  if (pending.value) { emit('save', { weekday: null, startPeriod: null, endPeriod: null }); return }
  emit('save', { weekday: day.value, startPeriod: start.value, endPeriod: Math.max(end.value, start.value) })
}
</script>

<template>
  <FloatingPanel title="选择上课时间" :anchor-el="anchorEl" :width="436" @close="emit('close')">
    <button type="button" class="pending-toggle" role="switch" :aria-checked="pending" @click="pending = !pending">
      <span class="pending-switch" :class="{ on: pending }" /><span>暂时不确定时间（待安排）</span>
    </button>

    <div class="time-wheels" :class="{ dimmed: pending }">
      <ScheduleWheelPicker v-model="day" :options="dayOptions" :disabled="pending" aria-label="星期" class="wheel-day" />
      <ScheduleWheelPicker v-model="start" :options="startOptions" :disabled="pending" aria-label="开始节次" class="wheel-start" />
      <span class="wheel-dash">—</span>
      <ScheduleWheelPicker v-model="end" :options="endOptions" :disabled="pending" :min="start" aria-label="结束节次" class="wheel-end" />
    </div>
    <p class="time-hint" role="status">{{ timeHint || '未设置具体时间' }}</p>

    <template #footer>
      <div class="panel-actions">
        <button type="button" class="secondary-button" @click="emit('close')">取消</button>
        <button type="button" class="primary-button" @click="save">{{ pending ? '保存为待安排' : '保存时间' }}</button>
      </div>
    </template>
  </FloatingPanel>
</template>

<style scoped>
.pending-toggle{display:flex;width:100%;align-items:center;gap:9px;padding:2px 2px 6px;border:0;background:none;color:var(--muted);font-size:var(--font-caption);font-weight:650;text-align:left}
.pending-switch{position:relative;flex:none;width:36px;height:20px;border-radius:99px;background:var(--line-strong);transition:background .18s}
.pending-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--surface);box-shadow:0 1px 4px rgba(9,35,59,.25);transition:transform .18s}
.pending-switch.on{background:var(--primary)}
.pending-switch.on::after{transform:translateX(16px)}
.time-wheels{display:grid;grid-template-columns:0.9fr 1.25fr auto 1.25fr;align-items:center;gap:4px;transition:opacity .18s}
.time-wheels.dimmed{opacity:.35;pointer-events:none}
.wheel-dash{color:var(--faint);font-weight:700}
.time-hint{min-height:17px;margin:7px 2px 0;color:var(--muted);font-size:var(--font-caption);text-align:center}
@media(prefers-reduced-motion:reduce){.pending-switch,.time-wheels{transition:none}}
</style>
