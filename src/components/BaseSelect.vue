<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

export interface SelectOption {
  value: string
  label: string
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: SelectOption[]
  disabled?: boolean
  ariaLabel?: string
  placeholder?: string
}>(), {
  disabled: false,
  ariaLabel: '请选择',
  placeholder: '请选择',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const optionElements = ref<HTMLElement[]>([])
const open = ref(false)
const activeIndex = ref(0)
const listboxId = `select-${useId()}`
const selected = computed(() => props.options.find(option => option.value === props.modelValue))

function openMenu() {
  if (props.disabled) return
  activeIndex.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue))
  open.value = true
}

function closeMenu() {
  open.value = false
}

function toggleMenu() {
  if (open.value) closeMenu()
  else openMenu()
}

function selectOption(index: number) {
  const option = props.options[index]
  if (!option) return
  emit('update:modelValue', option.value)
  closeMenu()
}

function moveActive(step: number) {
  if (!props.options.length) return
  if (!open.value) openMenu()
  else activeIndex.value = (activeIndex.value + step + props.options.length) % props.options.length
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Home':
      if (!open.value) return
      event.preventDefault()
      activeIndex.value = 0
      break
    case 'End':
      if (!open.value) return
      event.preventDefault()
      activeIndex.value = props.options.length - 1
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (open.value) selectOption(activeIndex.value)
      else openMenu()
      break
    case 'Escape':
      if (!open.value) return
      event.preventDefault()
      closeMenu()
      break
    case 'Tab':
      closeMenu()
      break
  }
}

function onPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) closeMenu()
}

watch(activeIndex, async index => {
  await nextTick()
  optionElements.value[index]?.scrollIntoView({ block: 'nearest' })
})

watch(() => props.disabled, disabled => {
  if (disabled) closeMenu()
})

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div ref="root" class="base-select" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <button
      type="button"
      class="select-trigger"
      role="combobox"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-activedescendant="open ? `${listboxId}-option-${activeIndex}` : undefined"
      :disabled="disabled"
      @click="toggleMenu"
      @keydown="onKeydown"
    >
      <span class="select-value">{{ selected?.label ?? placeholder }}</span>
      <span class="select-chevron"><ChevronDown :size="15" /></span>
    </button>

    <Transition name="select-menu">
      <ul v-if="open" :id="listboxId" class="select-menu" role="listbox" :aria-label="ariaLabel">
        <li
          v-for="(option, index) in options"
          :id="`${listboxId}-option-${index}`"
          :key="option.value"
          :ref="element => { if (element) optionElements[index] = element as HTMLElement }"
          class="select-option"
          :class="{ 'is-active': activeIndex === index, 'is-selected': modelValue === option.value }"
          role="option"
          :aria-selected="modelValue === option.value"
          @mouseenter="activeIndex = index"
          @mousedown.prevent
          @click="selectOption(index)"
        >
          <span>{{ option.label }}</span>
          <Check v-if="modelValue === option.value" :size="15" />
        </li>
      </ul>
    </Transition>
  </div>
</template>
