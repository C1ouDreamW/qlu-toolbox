<script setup lang="ts">
import { computed } from 'vue'
import MarkdownLine from '@/components/MarkdownLine.vue'
import { parseMarkdownNotes } from '@/markdown'

const props = defineProps<{ text: string }>()
const blocks = computed(() => parseMarkdownNotes(props.text))
</script>

<template>
  <div class="markdown-notes">
    <template v-for="(block, index) in blocks" :key="index">
      <h3 v-if="block.kind === 'heading'" class="md-heading"><MarkdownLine :tokens="block.inlines" /></h3>
      <ul v-else-if="block.kind === 'list' && !block.ordered"><li v-for="(item, itemIndex) in block.items" :key="itemIndex"><MarkdownLine :tokens="item" /></li></ul>
      <ol v-else-if="block.kind === 'list'"><li v-for="(item, itemIndex) in block.items" :key="itemIndex"><MarkdownLine :tokens="item" /></li></ol>
      <blockquote v-else-if="block.kind === 'quote'"><MarkdownLine :tokens="block.inlines" /></blockquote>
      <pre v-else-if="block.kind === 'code'"><code>{{ block.text }}</code></pre>
      <hr v-else-if="block.kind === 'rule'" />
      <p v-else><MarkdownLine :tokens="block.inlines" /></p>
    </template>
  </div>
</template>
