<script setup lang="ts">
import type { Status } from '../ui'

defineProps<{ status?: Status }>()
</script>

<template>
  <p class="message" :class="{ error: status?.state === 'error' }" :data-state="status?.state" role="status">{{ status?.text }}</p>
</template>
