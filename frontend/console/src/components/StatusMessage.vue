<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-vue-next'
import type { Status } from '../ui'

defineProps<{ status?: Status }>()

const icons = { loading: LoaderCircle, error: CircleAlert, success: CircleCheck, empty: Info, info: Info }
</script>

<template>
  <p class="message" :data-state="status?.state" role="status">
    <component v-if="status?.text && status.state" :is="icons[status.state]" :size="17" aria-hidden="true" />
    <span v-if="status?.text">{{ status.text }}</span>
  </p>
</template>
