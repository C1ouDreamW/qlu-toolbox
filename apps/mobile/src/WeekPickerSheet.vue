<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseWeekExpression } from '@lumatile/academic-core'
import BottomSheet from './BottomSheet.vue'

const props = defineProps<{ open: boolean; weeks: number[]; totalWeeks: number }>()
const emit = defineEmits<{ close: []; save: [weeks: number[]] }>()

const selected = ref(new Set<number>())
const expressionOpen = ref(false)
const expression = ref('')
const expressionError = ref('')

watch(() => props.open, open => {
  if (!open) return
  syncFromProps()
})

function syncFromProps() {
  selected.value = new Set(props.weeks.filter(week => week >= 1 && week <= props.totalWeeks))
  expressionOpen.value = false
  expression.value = ''
  expressionError.value = ''
}
syncFromProps()

const selectedCount = computed(() => selected.value.size)
const allSelected = computed(() => selectedCount.value === props.totalWeeks)
const oddOnly = computed(() => hasParity(1))
const evenOnly = computed(() => hasParity(0))

function hasParity(parity: number) {
  if (!selectedCount.value) return false
  for (const week of selected.value) {
    if (week % 2 !== parity) return false
  }
  return true
}

function applyPreset(preset: 'all' | 'odd' | 'even' | 'none') {
  const next = new Set<number>()
  if (preset === 'all') {
    for (let week = 1; week <= props.totalWeeks; week += 1) next.add(week)
  } else if (preset === 'odd') {
    for (let week = 1; week <= props.totalWeeks; week += 2) next.add(week)
  } else if (preset === 'even') {
    for (let week = 2; week <= props.totalWeeks; week += 2) next.add(week)
  }
  selected.value = next
}

function toggleWeek(week: number) {
  const next = new Set(selected.value)
  if (next.has(week)) next.delete(week)
  else next.add(week)
  selected.value = next
}

function applyExpression() {
  expressionError.value = ''
  try {
    const weeks = parseWeekExpression(expression.value, props.totalWeeks)
    if (!weeks.length) { expressionError.value = '表达式没有选中任何周次'; return }
    selected.value = new Set(weeks)
    expressionOpen.value = false
  } catch (reason) {
    expressionError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function save() {
  emit('save', [...selected.value].sort((left, right) => left - right))
}
</script>

<template>
  <BottomSheet title="选择周数" :open="open" @close="emit('close')">
    <div class="preset-tabs" role="group" aria-label="快捷选择">
      <button type="button" :class="{ active: allSelected }" @click="applyPreset('all')">全选</button>
      <button type="button" :class="{ active: oddOnly }" @click="applyPreset('odd')">单周</button>
      <button type="button" :class="{ active: evenOnly }" @click="applyPreset('even')">双周</button>
      <button type="button" :class="{ active: !selectedCount }" @click="applyPreset('none')">清空</button>
    </div>

    <div class="week-grid" role="group" aria-label="逐周点选">
      <button
        v-for="week in totalWeeks" :key="week" type="button" class="week-chip"
        :class="{ active: selected.has(week) }" :aria-pressed="selected.has(week)" @click="toggleWeek(week)"
      >
        <span>{{ week }}</span>
      </button>
    </div>

    <p class="week-count" role="status">已选 {{ selectedCount }} / {{ totalWeeks }} 周</p>

    <button type="button" class="expr-toggle" :aria-expanded="expressionOpen" @click="expressionOpen = !expressionOpen">
      {{ expressionOpen ? '收起表达式输入' : '使用表达式输入（如 1-8单、3,5,7）' }}
    </button>
    <div v-if="expressionOpen" class="expr-box">
      <input v-model="expression" placeholder="例如：1-15单 或 1,3,5" @keyup.enter="applyExpression" />
      <button type="button" class="expr-apply" @click="applyExpression">应用</button>
    </div>
    <p v-if="expressionError" class="expr-error" role="alert">{{ expressionError }}</p>

    <template #footer>
      <button type="button" class="primary" :disabled="!selectedCount" @click="save">保存周次</button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.preset-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:4px;border-radius:12px;background:#edf3f8}
.preset-tabs button{padding:10px 0;border:0;border-radius:9px;color:#667d93;background:transparent;font-weight:700}
.preset-tabs button.active{color:#075ebd;background:#fff;box-shadow:0 2px 8px rgba(20,65,104,.1)}
.week-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px}
.week-chip{position:relative;display:grid;place-items:center;height:42px;padding:0;border:1px solid #dce8f2;border-radius:12px;color:#557087;background:#f8fbfe;font-weight:700}
.week-chip span{font-size:15px}
.week-chip.active{border-color:#0b76e8;color:#075ebd;background:#e8f3ff}
.week-chip:active{transform:scale(.94)}
.week-count{margin:12px 2px 0;color:#667d93;font-size:12px;text-align:right}
.expr-toggle{display:block;width:100%;margin-top:2px;padding:9px 0;border:0;color:#075ebd;background:none;font-size:12px;font-weight:700;text-align:center}
.expr-box{display:grid;grid-template-columns:1fr auto;gap:9px;margin-top:4px;padding:10px;border:1px solid #dce8f2;border-radius:12px;background:#f8fbfe}
.expr-box input{min-width:0;padding:10px 12px;border:1px solid #cfdeea;border-radius:10px;color:#18324b;background:#fff}
.expr-apply{padding:0 16px;border:0;border-radius:10px;color:#fff;background:#0b76e8;font-weight:700}
.expr-error{margin:8px 2px 0;color:#984436;font-size:12px}
@media(prefers-color-scheme:dark){
  .preset-tabs{background:#1b2e40}
  .preset-tabs button{color:#8ba0b2}
  .preset-tabs button.active{color:#83c5ff;background:#27435a}
  .week-chip{border-color:#324c63;color:#8ba0b2;background:#0d1722}
  .week-chip.active{border-color:#168cf4;color:#83c5ff;background:#17344d}
  .week-count{color:#8ba0b2}
  .expr-toggle{color:#62b5ff}
  .expr-box{border-color:#324c63;background:#0d1722}
  .expr-box input{color:#e8f2fb;border-color:#36536b;background:#142231}
  .expr-error{color:#e89a8c}
}
</style>
