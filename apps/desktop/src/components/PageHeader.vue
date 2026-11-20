<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description: string }>()
</script>
<template><header class="page-header"><span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span><h1>{{ title }}</h1><p>{{ description }}</p><slot /></header></template>
