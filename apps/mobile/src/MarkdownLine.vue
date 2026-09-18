<script setup lang="ts">
import type { MarkdownInline } from '@lumatile/update-notes'

defineProps<{ tokens: MarkdownInline[] }>()
</script>

<template>
  <template v-for="(token, index) in tokens" :key="index"><strong v-if="token.kind === 'strong'">{{ token.text }}</strong><em v-else-if="token.kind === 'emphasis'">{{ token.text }}</em><code v-else-if="token.kind === 'code'">{{ token.text }}</code><template v-else>{{ token.text }}</template></template>
</template>
