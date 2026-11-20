<script setup lang="ts">
import { computed, ref } from 'vue'
import { ListChecks, Trash2, FolderOpen, FileSpreadsheet, Search } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import StatusPill from '@/components/StatusPill.vue'
import { appStore } from '@/store'
import type { BootstrapData } from '@/types'
const props = defineProps<{ data: BootstrapData }>()
const api = window.lumatile
const filter = ref('all')
const query = ref('')
const tasks = computed(() => props.data.tasks.filter(task => (filter.value === 'all' || task.status === filter.value) && (!query.value || `${task.tool_name}${task.summary}`.includes(query.value))))
const format = (value: string) => value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
async function clearAll() { if (!confirm('确定清除所有已结束的任务记录吗？导出的文件不会被删除。')) return; await window.lumatile.invoke('clearTasks'); await appStore.refreshTasks(); appStore.notify('任务记录已清理', 'success') }
</script>
<template><div class="page"><PageHeader eyebrow="HISTORY" title="任务记录" description="每次操作都有迹可循，结果文件仍由你掌控。"><div class="header-actions"><label class="search-box compact"><Search :size="17" /><input v-model="query" placeholder="搜索记录…" /></label><button class="danger-ghost" @click="clearAll"><Trash2 :size="17" /> 清理记录</button></div></PageHeader><div class="filter-tabs"><button v-for="item in [{v:'all',l:'全部'},{v:'success',l:'已完成'},{v:'failed',l:'失败'},{v:'cancelled',l:'已取消'}]" :key="item.v" :class="{active:filter===item.v}" @click="filter=item.v">{{ item.l }}</button></div><section v-if="tasks.length" class="task-table"><div class="table-head"><span>任务</span><span>状态</span><span>创建时间</span><span>结果</span></div><article v-for="task in tasks" :key="task.id" class="table-row"><div class="task-name"><div class="tool-icon excel"><FileSpreadsheet :size="19" /></div><div><strong>{{ task.tool_name }}</strong><span>{{ task.summary }}</span><small v-if="task.error_message">{{ task.error_message }}</small></div></div><StatusPill :status="task.status" /><span class="muted">{{ format(task.created_at) }}</span><button v-if="task.result_path" class="open-result" @click="api.showItem(task.result_path)"><FolderOpen :size="16" /> 查看文件</button><span v-else class="muted">—</span></article></section><section v-else class="empty-card"><div class="empty-icon"><ListChecks :size="26" /></div><h3>没有符合条件的记录</h3><p>调整筛选条件，或者开始一次新的任务。</p></section></div></template>
