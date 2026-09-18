<script setup lang="ts">
import type { MarkdownInline } from '@lumatile/update-notes'

defineProps<{ tokens: MarkdownInline[] }>()

function openLink(href: string) {
  void window.qlu.openExternal(href)
}
</script>

<template>
  <template v-for="(token, index) in tokens" :key="index"><strong v-if="token.kind === 'strong'">{{ token.text }}</strong><em v-else-if="token.kind === 'emphasis'">{{ token.text }}</em><code v-else-if="token.kind === 'code'">{{ token.text }}</code><a v-else-if="token.kind === 'link'" :href="token.href" rel="noreferrer noopener" @click.prevent="openLink(token.href)" @auxclick.prevent="openLink(token.href)">{{ token.text }}</a><template v-else>{{ token.text }}</template></template>
</template>
