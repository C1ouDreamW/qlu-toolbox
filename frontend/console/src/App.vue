<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import StatusMessage from './components/StatusMessage.vue'
import LoginView from './views/LoginView.vue'
import { useAction } from './useAction'
import { useSession } from './useSession'

const { session, initialize, logout } = useSession()
const { pending, status, run } = useAction()
const route = useRoute()
const router = useRouter()
const accountMenu = ref<HTMLDetailsElement>()
const navigation = [
  { name: 'overview', text: '概览' },
  { name: 'feedback', text: '反馈' },
  { name: 'publish', text: '发布' },
  { name: 'stats', text: '统计' },
]
const showOperations = computed(() => session.value?.permissions.viewOperations === true)
const allowed = computed(() => route.name !== 'operations' || showOperations.value)

watch([() => route.name, () => session.value?.user, allowed], () => {
  if (accountMenu.value) accountMenu.value.open = false
  if (session.value?.user && !allowed.value) void router.replace({ name: 'overview' })
})

async function signOut() {
  if (await run(logout)) await router.replace({ name: 'overview' })
}

function focusMain() {
  document.getElementById('main')?.focus()
}

void initialize()
</script>

<template>
  <a class="skip-link" href="#main" @click.prevent="focusMain">跳到主要内容</a>
  <LoginView v-if="!session?.user" />
  <template v-else>
    <header class="topbar">
      <div class="topbar-inner">
        <RouterLink class="brand" :to="{ name: 'overview' }">
          <img class="brand-icon" src="/logo.png" width="32" height="32" alt="">LumaTile <small>控制台</small>
        </RouterLink>
        <nav class="console-nav" aria-label="控制台导航">
          <RouterLink v-for="item in navigation" :key="item.name" :to="{ name: item.name }">{{ item.text }}</RouterLink>
          <RouterLink v-if="showOperations" :to="{ name: 'operations' }">操作记录</RouterLink>
        </nav>
        <details ref="accountMenu" class="account">
          <summary><span>{{ session.user }}</span></summary>
          <div class="account-menu">
            <RouterLink :to="{ name: 'account' }" @click="accountMenu?.removeAttribute('open')">修改密码</RouterLink>
            <button type="button" :disabled="pending" @click="signOut">退出登录</button>
          </div>
        </details>
      </div>
    </header>
    <main id="main" class="workspace" tabindex="-1">
      <StatusMessage :status="status" />
      <RouterView v-if="allowed" />
    </main>
  </template>
</template>
