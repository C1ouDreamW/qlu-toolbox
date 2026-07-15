<script setup lang="ts">
import { Github, Mail, Bug, ExternalLink, Copy, ShieldCheck, Heart, Code2 } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import type { BootstrapData } from '@/types'
import { logoUrl } from '@/assets'
import { appStore } from '@/store'

defineProps<{ data: BootstrapData }>()
const api = window.qlu
const qqGroupNumber = '438767737'

function copyWithSelection(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, value.length)
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

async function copyQQGroupNumber() {
  let copied = false

  if (typeof api.copyText === 'function') {
    try {
      await api.copyText(qqGroupNumber)
      copied = true
    } catch { /* Fall back to renderer clipboard methods. */ }
  }

  if (!copied) copied = copyWithSelection(qqGroupNumber)

  if (!copied && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(qqGroupNumber)
      copied = true
    } catch { /* The final notification explains the failure. */ }
  }

  if (copied) {
    appStore.notify(`QQ群号 ${qqGroupNumber} 已复制，请在 QQ 中搜索加入`, 'success')
  } else {
    appStore.notify(`复制失败，请手动搜索 QQ 群 ${qqGroupNumber}`, 'error')
  }
}
</script>

<template>
  <div class="page about-page">
    <PageHeader eyebrow="ABOUT" title="关于 QLU 工具箱" description="由学生开发者维护，为更轻松的校园生活而做。" />
    <section class="about-hero">
      <div class="about-logo"><img :src="logoUrl" alt="QLU 工具箱 Logo" /></div>
      <div>
        <h2>QLU 工具箱 <span>v{{ data.version }}</span></h2>
        <p>一个注重隐私、完全本地运行的校园效率工具。</p>
        <div class="about-links">
          <button @click="api.openExternal(data.metadata.repository)"><Github :size="18" /><span><strong>GitHub</strong><small>查看项目源码</small></span><ExternalLink :size="13" /></button>
          <button class="about-contact-card" type="button" title="点击复制群号" :aria-label="`复制 QQ 群号 ${qqGroupNumber}`" @click="copyQQGroupNumber"><span class="qq-symbol">Q</span><span><strong>加入 QQ 群</strong><small>{{ qqGroupNumber }}</small></span><Copy :size="13" /></button>
          <button @click="api.openExternal(`mailto:${data.metadata.email}`)"><Mail :size="18" /><span><strong>联系作者</strong><small>cloud_aaa@163.com</small></span></button>
          <button @click="api.openExternal(data.metadata.issues)"><Bug :size="18" /><span><strong>反馈问题</strong><small>提交 Bug 或建议</small></span></button>
        </div>
      </div>
    </section>
    <div class="about-grid">
      <article><ShieldCheck :size="22" /><h3>隐私承诺</h3><p>不采集账号、密码、验证码、Cookie 或成绩内容，不包含遥测和自动上传。</p></article>
      <article><Code2 :size="22" /><h3>技术与许可</h3><p>界面基于 Vue 3 与 Electron，自动化能力由 Python 和 Playwright 提供。各依赖适用其自身许可。</p></article>
      <article><Heart :size="22" /><h3>非商业使用</h3><p>项目仅供个人学习与交流。未经明确书面许可，不得用于收费服务或商业推广。</p></article>
    </div>
    <section class="legal-card">
      <h3>非官方声明与使用责任</h3>
      <p>QLU 工具箱是由学生开发者维护的非官方软件，与齐鲁工业大学及其教务系统服务商不存在隶属、授权、合作或担保关系。本软件不代表学校官方立场。</p>
      <p>本软件按“现状”提供，不保证功能始终可用，也不保证导出结果绝对完整或准确。请仅处理本人有权访问的数据，并自行核对导出结果。</p>
    </section>
  </div>
</template>
