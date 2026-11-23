<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { OperationPage } from '../api/client'
import DataTable from '../components/DataTable.vue'
import StatusMessage from '../components/StatusMessage.vue'
import { api } from '../useSession'
import { dateFormat, errorText, type Status } from '../ui'

const search = ref('')
const offset = ref(0)
const page = shallowRef<OperationPage>()
const status = ref<Status>()
const loading = ref(false)
let request = 0

const rows = computed(() => page.value?.items.map(item => [
  dateFormat.format(new Date(item.created_at)), item.actor, item.resource, item.value,
]) ?? [])

async function load(start = 0) {
  const current = ++request
  loading.value = true
  status.value = { text: '正在读取操作记录…', state: 'loading' }
  try {
    const result = await api.operations(new URLSearchParams({ offset: String(start), q: search.value.trim() }))
    if (current !== request) return
    offset.value = start
    page.value = result
    status.value = result.items.length ? undefined : { text: '没有符合条件的操作记录。' }
  } catch (error) {
    if (current === request) status.value = { text: errorText(error), state: 'error' }
  } finally {
    if (current === request) loading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <section class="view">
    <div class="page-heading"><h1>操作记录</h1></div>
    <div class="panel">
      <form class="form-grid operation-filter" @submit.prevent="load()">
        <label>搜索<input v-model="search" type="search" maxlength="120" placeholder="操作者、对象或结果"></label>
        <button class="primary" type="submit">搜索</button>
      </form>
      <StatusMessage :status="status" />
      <DataTable v-if="rows.length" :headers="['时间', '操作者', '对象', '结果']" :rows="rows" />
      <div class="actions">
        <button type="button" :disabled="loading || !offset" @click="load(Math.max(0, offset - 50))">上一页</button>
        <button type="button" :disabled="loading || page?.nextOffset == null" @click="page?.nextOffset != null && load(page.nextOffset)">下一页</button>
      </div>
    </div>
  </section>
</template>
