<script setup lang="ts">
import type { TaskRecord } from '@/types'
defineProps<{ status: TaskRecord['status'] }>()
const labels = { running: '进行中', success: '已完成', failed: '失败', cancelled: '已取消', interrupted: '异常中断' }
</script>
<template><span class="status-pill" :data-status="status"><i />{{ labels[status] }}</span></template>
