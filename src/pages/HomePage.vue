<script setup lang="ts">
import { ArrowRight, FileSpreadsheet, ShieldCheck, Clock3, CheckCircle2, Sparkles, Wifi } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import StatusPill from '@/components/StatusPill.vue'
import type { BootstrapData, PageName } from '@/types'

const props = defineProps<{ data: BootstrapData }>()
const api = window.lumatile
const emit = defineEmits<{ navigate: [page: PageName] }>()
const formatTime = (value: string) => value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
</script>

<template>
  <div class="page home-page">
    <PageHeader eyebrow="GOOD DAY" title="今天想完成什么？" description="把繁琐的校园事务，变成几次简单点击。" />
    <section class="hero-card">
      <div class="hero-glow" />
      <div class="hero-copy"><span class="hero-badge"><Sparkles :size="14" /> 常用工具</span><h2>分项成绩，一键整理导出</h2><p>登录过程只在教务系统中完成。我们帮你查询、校验并保存为 Excel。</p><button class="hero-button" @click="emit('navigate', 'grade')">开始导出 <ArrowRight :size="18" /></button></div>
      <div class="hero-visual"><div class="floating-sheet"><FileSpreadsheet :size="34" /><div><strong>成绩明细.xlsx</strong><span>已校验 · 保存在本地</span></div><CheckCircle2 class="sheet-check" :size="22" /></div><div class="mini-card card-security"><ShieldCheck :size="18" /> 隐私保护</div><div class="mini-card card-network"><Wifi :size="18" /> 校园网络</div></div>
    </section>
    <div class="section-heading"><div><h2>最近任务</h2><p>继续查看刚刚完成的工作</p></div><button class="text-button" @click="emit('navigate', 'tasks')">查看全部 <ArrowRight :size="15" /></button></div>
    <section v-if="data.tasks.length" class="recent-list">
      <article v-for="task in data.tasks.slice(0, 4)" :key="task.id" class="recent-row"><div class="tool-icon excel"><FileSpreadsheet :size="20" /></div><div class="recent-main"><strong>{{ task.tool_name }}</strong><span>{{ task.summary }}</span></div><StatusPill :status="task.status" /><span class="recent-time"><Clock3 :size="14" /> {{ formatTime(task.created_at) }}</span><button v-if="task.result_path" class="icon-arrow" title="打开结果" @click="api.openPath(task.result_path)"><ArrowRight :size="17" /></button></article>
    </section>
    <section v-else class="empty-card"><div class="empty-icon"><Clock3 :size="25" /></div><h3>还没有任务记录</h3><p>完成一次工具任务后，结果会出现在这里。</p></section>
  </div>
</template>
