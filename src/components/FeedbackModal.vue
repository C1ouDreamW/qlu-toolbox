<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bug, CheckCircle2, Lightbulb, LockKeyhole, Send } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'

defineProps<{ version: string }>()
const emit = defineEmits<{ close: [] }>()
const type = ref<'bug' | 'suggestion'>('bug')
const content = ref('')
const contact = ref('')
const submitting = ref(false)
const error = ref('')
const feedbackId = ref('')
const canSubmit = computed(() => content.value.trim().length >= 2 && !submitting.value)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = ''
  try {
    const result = await window.qlu.submitFeedback({
      type: type.value,
      content: content.value.trim(),
      contact: contact.value.trim(),
    })
    feedbackId.value = result.id
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '暂时无法发送，请稍后再试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseModal title="反馈与建议" dismissible @close="emit('close')">
    <div v-if="feedbackId" class="feedback-success">
      <span><CheckCircle2 :size="28" /></span>
      <strong>已经收到，谢谢你</strong>
      <p>反馈编号 {{ feedbackId }}，我们会认真查看。</p>
      <button class="primary-button wide" @click="emit('close')">完成</button>
    </div>
    <form v-else class="feedback-form" @submit.prevent="submit">
      <p class="modal-lead">哪里不顺手？一句话也可以。</p>
      <div class="feedback-types" role="group" aria-label="反馈类型">
        <button type="button" :class="{ active: type === 'bug' }" :aria-pressed="type === 'bug'" @click="type = 'bug'">
          <Bug :size="18" /><span><strong>遇到问题</strong><small>功能异常或结果不对</small></span>
        </button>
        <button type="button" :class="{ active: type === 'suggestion' }" :aria-pressed="type === 'suggestion'" @click="type = 'suggestion'">
          <Lightbulb :size="18" /><span><strong>有个想法</strong><small>希望增加或改进功能</small></span>
        </button>
      </div>
      <label class="feedback-field">
        <span>反馈内容</span>
        <textarea v-model="content" maxlength="2000" autofocus :placeholder="type === 'bug' ? '例如：导入课表后，周三的课程没有显示' : '例如：希望可以给不同课表设置不同颜色'" />
        <small>{{ content.length }}/2000</small>
      </label>
      <label class="feedback-field compact">
        <span>联系方式 <em>选填</em></span>
        <input v-model="contact" maxlength="120" placeholder="QQ 或邮箱，方便需要时与你确认" />
      </label>
      <div class="feedback-privacy"><LockKeyhole :size="16" /><span>将附带版本 {{ version }} 和系统类型。请勿填写姓名、学号、账号、密码、验证码或成绩。</span></div>
      <p v-if="error" class="feedback-error">{{ error }}</p>
      <button class="primary-button wide" type="submit" :disabled="!canSubmit"><Send :size="16" />{{ submitting ? '正在发送…' : '发送反馈' }}</button>
    </form>
  </BaseModal>
</template>
