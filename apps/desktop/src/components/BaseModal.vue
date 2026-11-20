<script setup lang="ts">
import { X } from 'lucide-vue-next'
defineProps<{ title: string; dismissible?: boolean }>()
defineEmits<{ close: [] }>()
</script>
<template><div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><button v-if="dismissible" class="modal-close icon-button" @click="$emit('close')"><X :size="18" /></button><h2>{{ title }}</h2><slot /></section></div></template>
