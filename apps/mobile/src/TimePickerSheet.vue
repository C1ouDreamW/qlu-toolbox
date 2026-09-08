<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PeriodTime } from '@lumatile/contracts'
import BottomSheet from './BottomSheet.vue'
import WheelPicker from './WheelPicker.vue'
import type { WheelOption } from './WheelPicker.vue'

const props = defineProps<{
  open: boolean
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

watch(() => props.open, open => {
  if (!open) return
  pending.value = props.weekday === null
  day.value = props.weekday ?? 1
  start.value = props.startPeriod ?? 1
  end.value = props.endPeriod ?? props.startPeriod ?? 1
})

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
  <BottomSheet title="选择上课时间" :open="open" @close="emit('close')">
    <button type="button" class="pending-toggle" role="switch" :aria-checked="pending" @click="pending = !pending">
      <span class="pending-switch" :class="{ on: pending }" /><span>暂时不确定时间（待安排）</span>
    </button>

    <div class="time-wheels" :class="{ dimmed: pending }">
      <WheelPicker v-model="day" :options="dayOptions" :disabled="pending" aria-label="星期" class="wheel-day" />
      <WheelPicker v-model="start" :options="startOptions" :disabled="pending" aria-label="开始节次" class="wheel-start" />
      <span class="wheel-dash">—</span>
      <WheelPicker v-model="end" :options="endOptions" :disabled="pending" :min="start" aria-label="结束节次" class="wheel-end" />
    </div>
    <p class="time-hint" role="status">{{ timeHint || '未设置具体时间' }}</p>

    <template #footer>
      <button type="button" class="primary" @click="save">{{ pending ? '保存为待安排' : '保存时间' }}</button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.pending-toggle{display:flex;width:100%;align-items:center;gap:11px;padding:8px 2px;border:0;background:none;color:#55708e;font-size:13px;font-weight:700;text-align:left}
.pending-switch{position:relative;flex:none;width:42px;height:24px;border-radius:99px;background:#c3d4e2;transition:background .18s}
.pending-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(9,35,59,.25);transition:transform .18s}
.pending-switch.on{background:#0b76e8}
.pending-switch.on::after{transform:translateX(18px)}
.time-wheels{display:grid;grid-template-columns:1fr 1.2fr auto 1.2fr;align-items:center;gap:6px;margin-top:6px;transition:opacity .18s}
.time-wheels.dimmed{opacity:.35;pointer-events:none}
.wheel-dash{color:#9fb4c4;font-weight:700}
.time-hint{min-height:18px;margin:8px 2px 0;color:#667d93;font-size:12px;text-align:center}
@media(prefers-reduced-motion:reduce){.pending-switch,.time-wheels{transition:none}}
@media(prefers-color-scheme:dark){
  .pending-toggle{color:#8ba0b2}
  .pending-switch{background:#3b5870}
  .pending-switch.on{background:#168cf4}
  .wheel-dash{color:#6d8496}
  .time-hint{color:#8ba0b2}
}
</style>
