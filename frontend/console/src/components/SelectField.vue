<script setup lang="ts" generic="T extends string | number | undefined">
import { computed, useId, useTemplateRef } from 'vue'
import { Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions } from '@headlessui/vue'
import { Check, ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  label: string
  options: readonly { value: T; label: string }[]
  placeholder?: string
  disabled?: boolean
}>()
const model = defineModel<T>({ required: true })
const labelId = useId()
const trigger = useTemplateRef<{ $el: HTMLButtonElement }>('trigger')
const selection = computed(() => props.options.find(option => option.value === model.value))

defineExpose({ focus: () => trigger.value?.$el.focus() })
</script>

<template>
  <Listbox v-model="model" as="div" class="select-field" :disabled="disabled">
    <ListboxLabel :id="labelId" as="span" class="field-label">{{ label }}</ListboxLabel>
    <div class="select-control">
      <ListboxButton ref="trigger" type="button" class="select-trigger">
        <span :class="{ 'select-placeholder': !selection }">{{ selection?.label ?? placeholder ?? '请选择' }}</span>
        <ChevronDown class="select-chevron" :size="16" aria-hidden="true" />
      </ListboxButton>
      <ListboxOptions class="popup select-options" :aria-labelledby="labelId">
        <ListboxOption v-for="option in options" :key="option.value" :value="option.value"
          v-slot="{ selected }" class="popup-item">
          <span>{{ option.label }}</span>
          <Check v-if="selected" :size="16" aria-hidden="true" />
        </ListboxOption>
      </ListboxOptions>
    </div>
  </Listbox>
</template>
