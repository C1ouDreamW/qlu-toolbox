<script setup lang="ts">
// 周数选择面板：快捷预设 + 逐周宫格多选 + 表达式输入（复用 academic-core 解析）。
import { computed, ref, watch } from 'vue'
import { parseWeekExpression } from '@lumatile/academic-core'
import FloatingPanel from './FloatingPanel.vue'

const props = defineProps<{
  anchorEl: HTMLElement | null
  weeks: number[]
  totalWeeks: number
}>()
const emit = defineEmits<{ close: []; save: [weeks: number[]] }>()

const selected = ref(new Set<number>())
const expressionOpen = ref(false)
const expression = ref('')
const expressionError = ref('')

function syncFromProps() {
  selected.value = new Set(props.weeks.filter(week => week >= 1 && week <= props.totalWeeks))
  expressionOpen.value = false
  expression.value = ''
  expressionError.value = ''
}
syncFromProps()

watch(() => props.weeks, syncFromProps)

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
  <FloatingPanel title="选择周数" :anchor-el="anchorEl" :width="404" @close="emit('close')">
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
      <div class="panel-actions">
        <button type="button" class="secondary-button" @click="emit('close')">取消</button>
        <button type="button" class="primary-button" :disabled="!selectedCount" @click="save">保存周次</button>
      </div>
    </template>
  </FloatingPanel>
</template>

<style scoped>
.preset-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:4px;border-radius:10px;background:var(--surface-2)}
.preset-tabs button{height:30px;padding:0;border:0;border-radius:7px;color:var(--muted);background:transparent;font-size:var(--font-caption);font-weight:650}
.preset-tabs button:hover{color:var(--text)}
.preset-tabs button.active{color:var(--primary);background:var(--surface);box-shadow:var(--shadow-sm)}
.week-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:10px}
.week-chip{position:relative;display:grid;place-items:center;height:30px;padding:0;border:1px solid var(--line);border-radius:8px;color:var(--muted);background:var(--surface-2);font-size:var(--font-caption);font-weight:650}
.week-chip:hover{border-color:var(--line-strong)}
.week-chip.active{border-color:var(--primary);color:var(--primary);background:var(--primary-soft)}
.week-chip:active{transform:scale(.94)}
.week-count{margin:9px 2px 0;color:var(--muted);font-size:var(--font-caption);text-align:right}
.expr-toggle{display:block;width:100%;padding:7px 0;border:0;color:var(--primary);background:none;font-size:var(--font-caption);font-weight:650;text-align:center}
.expr-toggle:hover{text-decoration:underline}
.expr-box{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:2px}
.expr-box input{min-width:0;height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;outline:0;background:var(--surface-2);color:var(--text);font-size:var(--font-body)}
.expr-box input:focus{border-color:var(--primary)}
.expr-apply{height:34px;padding:0 13px;border:0;border-radius:8px;color:#fff;background:var(--primary);font-size:var(--font-caption);font-weight:650}
.expr-error{margin:7px 2px 0;color:var(--red);font-size:var(--font-caption)}
@media(prefers-reduced-motion:reduce){.week-chip:active{transform:none}}
</style>
