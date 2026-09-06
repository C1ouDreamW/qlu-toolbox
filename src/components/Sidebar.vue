<script setup lang="ts">
import { CalendarDays, Home, LayoutGrid, ListChecks, Settings, Info, ChevronRight, MessageSquareText } from 'lucide-vue-next'
import { logoUrl } from '@/assets'
import type { PageName } from '@/types'

defineProps<{ current: PageName; version: string }>()
const emit = defineEmits<{ navigate: [page: PageName]; feedback: [] }>()
const items = [
  { id: 'schedule' as const, label: '课表', icon: CalendarDays },
  { id: 'home' as const, label: '首页', icon: Home },
  { id: 'tools' as const, label: '全部工具', icon: LayoutGrid },
  { id: 'tasks' as const, label: '任务记录', icon: ListChecks },
  { id: 'settings' as const, label: '设置', icon: Settings },
  { id: 'about' as const, label: '关于', icon: Info },
]
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark"><img :src="logoUrl" alt="一格有光 Logo" /></div>
      <div><strong>一格有光</strong><span>LumaTile · 校园效率工作台</span></div>
    </div>
    <nav class="side-nav" aria-label="主导航">
      <button v-for="item in items" :key="item.id" :class="{ active: current === item.id }" @click="emit('navigate', item.id)">
        <component :is="item.icon" :size="19" /><span>{{ item.label }}</span><ChevronRight v-if="current === item.id" class="nav-chevron" :size="15" />
      </button>
    </nav>
    <div class="sidebar-spacer" />
    <button class="sidebar-feedback" @click="emit('feedback')"><MessageSquareText :size="17" /><span>反馈与建议</span></button>
    <div class="privacy-note"><div class="pulse-dot" /><div><strong>完全本地运行</strong><span>账号与成绩不会上传</span></div></div>
    <div class="sidebar-footer"><span>非学校官方软件</span><span>v{{ version }}</span></div>
  </aside>
</template>
