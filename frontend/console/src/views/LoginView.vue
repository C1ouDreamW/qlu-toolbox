<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ArrowUpRight } from 'lucide-vue-next'
import type { Credentials } from '../api/client'
import StatusMessage from '../components/StatusMessage.vue'
import { useAction } from '../useAction'
import { useSession } from '../useSession'
import type { Status } from '../ui'

const { session, checking, connectionError, initialize, login } = useSession()
const credentials = reactive<Credentials>({ username: '', password: '' })
const showPassword = ref(false)
const { pending, status, run } = useAction()
const message = computed<Status | undefined>(() => {
  if (checking.value) return { text: '正在检查登录状态…', state: 'loading' }
  if (connectionError.value) return { text: connectionError.value, state: 'error' }
  return status.value
})

async function signIn() {
  if (!session.value || pending.value) return
  try {
    await run(() => login(credentials))
  } finally {
    credentials.password = ''
  }
}
</script>

<template>
  <main id="main" class="login" tabindex="-1">
    <div class="login-shell">
      <div class="login-brand">
        <img class="brand-icon" src="/logo.png" width="64" height="64" alt="">
        <p class="login-brand-name">LumaTile</p>
        <p class="login-brand-product">运营控制台</p>
        <a href="https://lumatile.cn/">访问官网<ArrowUpRight :size="15" aria-hidden="true" /></a>
      </div>
      <div class="login-panel">
        <h1>登录控制台</h1>
        <StatusMessage :status="message" />
        <form method="post" @submit.prevent="signIn">
          <label>用户名<input v-model="credentials.username" name="username" autocomplete="username" maxlength="150" required></label>
          <div>
            <label for="login-password">密码</label>
            <div class="password-input">
              <input id="login-password" v-model="credentials.password" name="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" maxlength="1024" required>
              <button type="button" aria-controls="login-password" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button>
            </div>
          </div>
          <button class="primary" type="submit" :disabled="!session || checking || pending">{{ pending ? '登录中…' : '登录' }}</button>
          <button v-if="connectionError" type="button" @click="initialize">重试连接</button>
        </form>
      </div>
    </div>
  </main>
</template>
