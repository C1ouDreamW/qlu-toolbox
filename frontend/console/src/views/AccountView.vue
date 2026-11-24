<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { PasswordChange } from '../api/client'
import StatusMessage from '../components/StatusMessage.vue'
import { useAction } from '../useAction'
import { useSession } from '../useSession'

const { changePassword, session } = useSession()
const passwords = reactive<PasswordChange>({ old_password: '', new_password1: '', new_password2: '' })
const { pending, status, run } = useAction()
const mismatch = computed(() => Boolean(passwords.new_password2 && passwords.new_password1 !== passwords.new_password2))

async function save() {
  if (mismatch.value) return
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
    <div class="account-layout">
      <form class="panel stack account-form" method="post" @submit.prevent="save">
        <label>当前密码<input v-model="passwords.old_password" type="password" name="old_password" autocomplete="current-password" required></label>
        <div class="password-fields">
          <label>新密码<input v-model="passwords.new_password1" type="password" name="new_password1" autocomplete="new-password" required></label>
          <label>确认新密码<input v-model="passwords.new_password2" type="password" name="new_password2" autocomplete="new-password" required
            :aria-invalid="mismatch || undefined" :aria-describedby="mismatch ? 'password-mismatch' : undefined"></label>
        </div>
        <p v-if="mismatch" id="password-mismatch" class="password-error" role="status">两次输入的新密码不一致。</p>
        <div class="save-password"><button class="primary" type="submit" :disabled="pending || mismatch">保存密码</button></div>
        <StatusMessage :status="status" />
      </form>
      <section class="panel account-details">
        <h2>当前账号</h2>
        <p>{{ session?.user }}</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.account-layout { display: grid; grid-template-columns: minmax(0, 550px) minmax(165px, 220px); align-items: start; gap: 16px; }
.account-form > label { max-width: 320px; }
.password-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.password-error { color: var(--danger); font-size: .875rem; }
.password-fields input[aria-invalid="true"] { border-color: var(--danger); }
.save-password { border-top: 1px solid var(--line); padding-top: 12px; }
.account-details { background: var(--soft-blue); border-color: #d9e5fb; overflow-wrap: anywhere; }
.account-details p { margin-top: 6px; font-weight: 650; }
@media (max-width: 600px) { .account-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 460px) { .password-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
