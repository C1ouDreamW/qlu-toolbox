<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, FileSpreadsheet, Calculator, CalendarDays, ArrowUpRight, ShieldCheck, Sparkles } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import type { BootstrapData, PageName, ToolManifest } from '@/types'

const props = defineProps<{ data: BootstrapData }>()
const emit = defineEmits<{ navigate: [page: PageName] }>()
const query = ref('')
const tools = computed(() => (props.data.tools || [props.data.tool]).filter(tool =>
  !query.value || `${tool.name}${tool.description}`.toLowerCase().includes(query.value.toLowerCase()),
))
const pageFor = (tool: ToolManifest): PageName =>
  tool.id === 'gpa-calculator' ? 'gpa' : tool.id === 'schedule' ? 'schedule' : 'grade'
</script>

<template>
  <div class="page">
    <PageHeader eyebrow="TOOLBOX" title="全部工具" description="为校园生活准备的一组轻量、本地化工具。">
      <label class="search-box"><Search :size="18" /><input v-model="query" placeholder="搜索工具…" /></label>
    </PageHeader>
    <div class="tool-grid">
      <article v-for="tool in tools" :key="tool.id" class="tool-card featured" @click="emit('navigate', pageFor(tool))">
        <div class="tool-card-top">
          <div class="tool-icon large excel">
            <CalendarDays v-if="tool.id === 'schedule'" :size="25" />
            <Calculator v-else-if="tool.id === 'gpa-calculator'" :size="25" />
            <FileSpreadsheet v-else :size="25" />
          </div>
          <span class="tool-version">v{{ tool.version }}</span>
        </div>
        <span class="category">{{ tool.category }}</span><h2>{{ tool.name }}</h2><p>{{ tool.description }}</p>
        <div class="tool-meta"><span><ShieldCheck :size="15" /> 本地处理</span><span><Sparkles :size="15" /> {{ tool.id === 'gpa-calculator' ? '动态计算' : '自动校验' }}</span></div>
        <button>打开工具 <ArrowUpRight :size="17" /></button>
      </article>
      <article class="tool-card coming"><div class="coming-mark">+</div><h2>更多工具正在路上</h2><p>工具箱会保持克制，只加入真正有用且经过安全评估的功能。</p></article>
    </div>
  </div>
</template>
