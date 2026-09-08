<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{ title: string; open: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Transition name="picker-fade">
    <button v-if="open" type="button" class="picker-scrim" aria-label="关闭" @click="emit('close')" />
  </Transition>
  <Transition name="picker-sheet">
    <section v-if="open" class="picker-sheet" role="dialog" aria-modal="true" :aria-label="title">
      <div class="sheet-handle" />
      <header>
        <h2>{{ title }}</h2>
        <button type="button" aria-label="关闭" @click="emit('close')"><X /></button>
      </header>
      <div class="picker-sheet-body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </section>
  </Transition>
</template>

<style scoped>
.picker-scrim{position:fixed;z-index:40;top:0;right:0;bottom:0;left:0;border:0;background:rgba(11,28,44,.48);backdrop-filter:blur(4px)}
.picker-sheet{position:fixed;z-index:41;right:0;bottom:0;left:0;max-width:680px;margin:auto;padding:8px 18px calc(16px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;background:#fff;box-shadow:0 -20px 60px rgba(9,35,59,.2)}
.sheet-handle{width:42px;height:4px;margin:0 auto 10px;border-radius:9px;background:#cfdae3}
.picker-sheet header{display:flex;align-items:center;justify-content:space-between;padding:2px 0 4px}
.picker-sheet h2{margin:0;font-size:19px}
.picker-sheet header button{display:grid;place-items:center;width:38px;height:38px;margin-right:-8px;border:0;border-radius:12px;color:#667d93;background:transparent}
.picker-sheet header button svg{width:19px}
.picker-sheet footer{margin-top:14px}
.picker-sheet footer :deep(.primary){margin-top:0}
.picker-fade-enter-active,.picker-fade-leave-active,.picker-sheet-enter-active,.picker-sheet-leave-active{transition:.2s ease}
.picker-sheet-enter-from,.picker-sheet-leave-to{transform:translateY(100%)}
.picker-fade-enter-from,.picker-fade-leave-to{opacity:0}
@media(prefers-reduced-motion:reduce){.picker-fade-enter-active,.picker-fade-leave-active,.picker-sheet-enter-active,.picker-sheet-leave-active{transition:none}}
@media(prefers-color-scheme:dark){.picker-sheet{color:#e8f2fb;background:#142231}.sheet-handle{background:#456075}.picker-sheet h2{color:#e8f2fb}.picker-sheet header button{color:#91a7b9}}
</style>
