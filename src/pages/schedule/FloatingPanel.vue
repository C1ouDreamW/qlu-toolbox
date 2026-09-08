<script setup lang="ts">
// 锚定式浮层面板：挂在 body 下（Teleport），按锚点元素矩形做 fixed 定位，
// 避免被弹窗内部的滚动容器裁剪；点击遮罩或按 ESC 关闭，滚动/缩放时重新定位。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  title: string
  anchorEl: HTMLElement | null
  width?: number
}>(), { width: 380 })
const emit = defineEmits<{ close: [] }>()

const style = ref<{ left: string; top?: string; bottom?: string; maxHeight: string }>({ left: '0px', top: '0px', maxHeight: '60vh' })

function place() {
  const anchor = props.anchorEl
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  const margin = 12
  const gap = 8
  const width = Math.min(props.width, window.innerWidth - margin * 2)
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin)
  const below = window.innerHeight - rect.bottom - gap - margin
  const above = rect.top - gap - margin
  if (below >= 340 || below >= above) {
    style.value = { left: `${left}px`, top: `${rect.bottom + gap}px`, maxHeight: `${Math.max(below, 260)}px` }
  } else {
    style.value = { left: `${left}px`, bottom: `${window.innerHeight - rect.top + gap}px`, maxHeight: `${Math.max(above, 260)}px` }
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  place()
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <Teleport to="body">
    <div class="panel-layer">
      <button type="button" class="panel-scrim" aria-label="关闭" @click="emit('close')" />
      <section class="picker-panel" role="dialog" aria-modal="true" :aria-label="title" :style="style">
        <header>
          <h2>{{ title }}</h2>
          <button type="button" class="icon-button panel-close" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
        </header>
        <div class="picker-panel-body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.panel-layer{position:fixed;z-index:130;inset:0}
.panel-scrim{position:absolute;inset:0;border:0;background:rgba(13,20,34,.28)}
.picker-panel{position:absolute;display:flex;flex-direction:column;padding:14px 16px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:0 22px 54px rgba(15,23,42,.24),0 4px 14px rgba(15,23,42,.1)}
.picker-panel header{display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;margin-bottom:10px}
.picker-panel h2{margin:0;font-size:var(--font-label);font-weight:650}
.panel-close{width:28px;height:28px;border-radius:8px}
.picker-panel-body{min-height:0;overflow-y:auto}
.picker-panel footer{flex:0 0 auto;margin-top:12px}
.panel-actions{display:flex;justify-content:flex-end;gap:8px}
@media(prefers-reduced-motion:reduce){.picker-panel{transition:none}}
</style>
