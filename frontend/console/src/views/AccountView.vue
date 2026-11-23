<script setup lang="ts">
import { reactive } from 'vue'
import type { PasswordChange } from '../api/client'
import StatusMessage from '../components/StatusMessage.vue'
import { useAction } from '../useAction'
import { useSession } from '../useSession'

const { changePassword } = useSession()
const passwords = reactive<PasswordChange>({ old_password: '', new_password1: '', new_password2: '' })
const { pending, status, run } = useAction()

async function save() {
  if (await run(() => changePassword(passwords), '密码已更新')) {
    passwords.old_password = ''
    passwords.new_password1 = ''
    passwords.new_password2 = ''
  }
}
</script>

<template>
  <section class="view">
    <div class="page-heading"><h1>修改密码</h1></div>
    <form class="panel stack account-form" method="post" @submit.prevent="save">
      <label>当前密码<input v-model="passwords.old_password" type="password" name="old_password" autocomplete="current-password" required></label>
      <label>新密码<input v-model="passwords.new_password1" type="password" name="new_password1" autocomplete="new-password" required></label>
      <label>确认新密码<input v-model="passwords.new_password2" type="password" name="new_password2" autocomplete="new-password" required></label>
      <div><button class="primary" type="submit" :disabled="pending">保存密码</button></div>
      <StatusMessage :status="status" />
    </form>
  </section>
</template>
