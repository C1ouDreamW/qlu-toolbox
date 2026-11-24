<script setup lang="ts">
import { computed, watch } from 'vue'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/vue'
import { ChartNoAxesCombined, ChevronsUpDown, ClipboardList, KeyRound, LayoutDashboard, LogOut, MessageSquare, Rocket } from 'lucide-vue-next'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import StatusMessage from './components/StatusMessage.vue'
import LoginView from './views/LoginView.vue'
import { useAction } from './useAction'
import { useSession } from './useSession'

const { session, initialize, logout } = useSession()
const { pending, status, run } = useAction()
const route = useRoute()
const router = useRouter()
const navigation = [
  { name: 'overview', text: '概览', icon: LayoutDashboard },
  { name: 'feedback', text: '反馈', icon: MessageSquare },
  { name: 'publish', text: '发布', icon: Rocket },
  { name: 'stats', text: '统计', icon: ChartNoAxesCombined },
  { name: 'operations', text: '操作记录', icon: ClipboardList },
]
const showOperations = computed(() => session.value?.permissions.viewOperations === true)
const links = computed(() => showOperations.value ? navigation : navigation.filter(item => item.name !== 'operations'))
const allowed = computed(() => route.name !== 'operations' || showOperations.value)

watch([() => route.name, () => session.value?.user, allowed], () => {
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
  <div v-else class="console-shell">
    <header class="sidebar">
      <RouterLink class="brand" :to="{ name: 'overview' }">
        <img class="brand-icon" src="/logo.png" width="36" height="36" alt="">
        <div>LumaTile <small>运营控制台</small></div>
      </RouterLink>
      <nav class="console-nav" aria-label="控制台导航">
        <RouterLink v-for="item in links" :key="item.name" :to="{ name: item.name }">
          <component :is="item.icon" :size="18" aria-hidden="true" />
          {{ item.text }}
        </RouterLink>
      </nav>
      <Menu :key="route.name" as="div" class="account">
        <MenuButton type="button" class="account-trigger" aria-label="账号菜单" :title="session.user">
          <span class="account-avatar" aria-hidden="true">{{ Array.from(session.user)[0]?.toUpperCase() }}</span>
          <span class="account-name">{{ session.user }}</span>
          <ChevronsUpDown :size="15" aria-hidden="true" />
        </MenuButton>
        <MenuItems class="popup account-menu">
          <MenuItem as="template" v-slot="{ close }">
            <RouterLink class="popup-item" :to="{ name: 'account' }" @click="close">
              <KeyRound :size="16" aria-hidden="true" />修改密码
            </RouterLink>
          </MenuItem>
          <MenuItem as="template" :disabled="pending">
            <button class="popup-item danger" type="button" :disabled="pending" @click="signOut">
              <LogOut :size="16" aria-hidden="true" />退出登录
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </header>
    <main id="main" class="workspace" tabindex="-1">
      <StatusMessage :status="status" />
      <RouterView v-if="allowed" />
    </main>
  </div>
</template>
