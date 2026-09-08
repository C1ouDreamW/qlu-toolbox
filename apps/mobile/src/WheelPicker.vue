<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  clampIndexToLoop, indexForValue, normalizeIndex, valueForIndex,
  positionForIndex, targetIndexForDrag, targetIndexForTap,
} from './wheelPicker'

export interface WheelOption { value: number; label: string; sublabel?: string }

const props = withDefaults(defineProps<{
  options: WheelOption[]
  modelValue: number
  disabled?: boolean
  min?: number
  max?: number
  ariaLabel?: string
}>(), { disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const ITEM_HEIGHT = 44
const VIEWPORT_HEIGHT = 220

const rootEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const position = ref(0)
const settling = ref(false)

const items = computed(() => {
  const repeated: Array<WheelOption & { key: number }> = []
  for (let copy = 0; copy < 5; copy += 1) {
    props.options.forEach((option, index) => repeated.push({ ...option, key: copy * 100 + index }))
  }
  return repeated
})
const count = computed(() => props.options.length)
const values = computed(() => props.options.map(option => option.value))
const currentText = computed(() => {
  const active = props.options.find(option => option.value === props.modelValue)
  return active ? active.label : ''
})

let currentIndex = 0
let dragging = false
let dragStartY = 0
let dragStartOffset = 0
let dragMoved = false
let samples: Array<{ time: number; y: number }> = []

function indexAtPosition(offset: number) {
  return Math.round(((VIEWPORT_HEIGHT - ITEM_HEIGHT) / 2 - offset) / ITEM_HEIGHT)
}

function currentTranslateY() {
  if (!trackEl.value) return position.value
  if (!settling.value) return position.value
  const transform = getComputedStyle(trackEl.value).transform
  if (transform && transform !== 'none') {
    const parts = transform.match(/matrix\(([^)]+)\)/)
    if (parts) return Number(parts[1].split(',')[5]) || 0
  }
  return position.value
}

function valueAtIndex(index: number) {
  return valueForIndex(index, props.options)?.value
}

function clampValue(value: number) {
  let next = value
  if (props.min !== undefined) next = Math.max(props.min, next)
  if (props.max !== undefined) next = Math.min(props.max, next)
  return next
}

function moveTo(index: number, animate: boolean) {
  if (!count.value) return
  let target = clampIndexToLoop(index, count.value)
  const raw = valueAtIndex(target)
  const clamped = clampValue(raw)
  if (clamped !== raw) {
    const mapped = indexForValue(clamped, count.value, values.value)
    if (mapped !== null) target = mapped
  }
  currentIndex = target
  settling.value = animate
  position.value = positionForIndex(target, ITEM_HEIGHT, VIEWPORT_HEIGHT)
  if (!animate) normalizeAfterSettle()
}

function normalizeAfterSettle() {
  const middle = normalizeIndex(currentIndex, count.value)
  if (middle !== currentIndex) {
    currentIndex = middle
    position.value = positionForIndex(middle, ITEM_HEIGHT, VIEWPORT_HEIGHT)
  }
}

function onTransitionEnd(event: TransitionEvent) {
  if (event.target !== trackEl.value || event.propertyName !== 'transform') return
  settling.value = false
  normalizeAfterSettle()
  emit('update:modelValue', valueAtIndex(currentIndex))
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled || !count.value) return
  dragging = true
  dragMoved = false
  dragStartY = event.clientY
  dragStartOffset = currentTranslateY()
  settling.value = false
  position.value = dragStartOffset
  samples = [{ time: event.timeStamp, y: event.clientY }]
  try { rootEl.value?.setPointerCapture(event.pointerId) } catch { /* synthetic or inactive pointer */ }
}

function onPointerMove(event: PointerEvent) {
  if (!dragging) return
  const delta = event.clientY - dragStartY
  if (Math.abs(delta) > 3) dragMoved = true
  position.value = dragStartOffset + delta
  samples.push({ time: event.timeStamp, y: event.clientY })
  if (samples.length > 6) samples.shift()
}

function onPointerUp(event: PointerEvent) {
  if (!dragging) return
  dragging = false
  const delta = event.clientY - dragStartY
  if (!dragMoved) {
    const rect = rootEl.value?.getBoundingClientRect()
    const localY = rect ? event.clientY - rect.top : VIEWPORT_HEIGHT / 2
    moveTo(targetIndexForTap({ pointerY: localY, position: dragStartOffset, itemHeight: ITEM_HEIGHT, optionCount: count.value }), true)
    return
  }
  const first = samples[0]
  const last = samples[samples.length - 1]
  const span = Math.max(last.time - first.time, 1)
  const velocity = span >= 8 ? (last.y - first.y) / span : 0
  moveTo(targetIndexForDrag({
    startIndex: indexAtPosition(dragStartOffset), dragDelta: delta, velocity,
    itemHeight: ITEM_HEIGHT, optionCount: count.value,
  }), true)
}

function step(direction: number) {
  if (props.disabled || !count.value) return
  moveTo(clampIndexToLoop(currentIndex + direction, count.value), true)
}

function onWheel(event: WheelEvent) {
  step(event.deltaY > 0 ? 1 : -1)
}

function syncFromModel(animate: boolean) {
  const index = indexForValue(props.modelValue, count.value, values.value)
  if (index !== null) moveTo(index, animate)
}

watch(() => props.modelValue, value => {
  if (!count.value) return
  if (value === valueAtIndex(currentIndex)) return
  syncFromModel(true)
})
watch(() => [props.min, props.max], () => {
  if (props.modelValue !== clampValue(props.modelValue)) syncFromModel(true)
})
syncFromModel(false)
</script>

<template>
  <div
    ref="rootEl" class="wheel" :class="{ 'wheel-disabled': disabled }" role="spinbutton"
    :aria-label="ariaLabel" :aria-valuetext="currentText" :tabindex="disabled ? -1 : 0"
    @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
    @pointercancel="onPointerUp" @wheel.prevent="onWheel" @keydown.up.prevent="step(-1)"
    @keydown.down.prevent="step(1)"
  >
    <div
      ref="trackEl" class="wheel-track" :class="{ settling }"
      :style="{ transform: `translate3d(0, ${position}px, 0)` }" @transitionend="onTransitionEnd"
    >
      <div
        v-for="item in items" :key="item.key" class="wheel-item"
        :class="{ active: item.value === modelValue }"
      >
        <span class="wheel-label">{{ item.label }}</span>
        <span v-if="item.sublabel" class="wheel-sub">{{ item.sublabel }}</span>
      </div>
    </div>
    <div class="wheel-mask wheel-mask-top" /><div class="wheel-mask wheel-mask-bottom" />
    <div class="wheel-band" />
  </div>
</template>

<style scoped>
.wheel{position:relative;height:220px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;outline:none}
.wheel-track{will-change:transform}
.wheel-track.settling{transition:transform .22s cubic-bezier(.2,.75,.3,1)}
.wheel-item{display:flex;height:44px;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.wheel-item .wheel-label{font-size:15px;font-weight:700;color:#557087}
.wheel-item .wheel-sub{font-size:10px;font-weight:600;color:#8ba0b2}
.wheel-item.active .wheel-label{color:#0b76e8}
.wheel-band{position:absolute;top:50%;right:14px;left:14px;height:44px;transform:translateY(-50%);border-top:1px solid #e3edf5;border-bottom:1px solid #e3edf5;border-radius:10px;background:rgba(11,118,232,.05);pointer-events:none}
.wheel-mask{position:absolute;right:0;left:0;height:74px;pointer-events:none}
.wheel-mask-top{top:0;background:linear-gradient(180deg,#fff 12%,rgba(255,255,255,0))}
.wheel-mask-bottom{bottom:0;background:linear-gradient(0deg,#fff 12%,rgba(255,255,255,0))}
.wheel-disabled{opacity:.35;pointer-events:none}
.wheel:focus-visible .wheel-band{outline:3px solid rgba(11,118,232,.28);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.wheel-track.settling{transition:none}}
@media(prefers-color-scheme:dark){
  .wheel-item .wheel-label{color:#8ba0b2}.wheel-item .wheel-sub{color:#6d8496}
  .wheel-item.active .wheel-label{color:#62b5ff}
  .wheel-band{border-color:#324c63;background:rgba(52,153,241,.08)}
  .wheel-mask-top{background:linear-gradient(180deg,#142231 12%,rgba(20,34,49,0))}
  .wheel-mask-bottom{background:linear-gradient(0deg,#142231 12%,rgba(20,34,49,0))}
}
</style>
