/**
 * flex 容器的 `gap` 属性需要 Chromium 84+（flex gap），国产 ROM 出厂自带的
 * System WebView 常年停留在旧版本（实测 Redmi Note 7 的 WebView 83 完全不生效），
 * 导致图标与文字直接贴在一起。这里通过真实布局测量检测 flex gap 是否生效，
 * 不支持时给 <html> 挂上 `no-flexgap` 类，由 flex-gap-compat.css 用 margin 兜底。
 * 支持 flex gap 的 WebView 上该类永远不会被加上，兜底规则不参与渲染。
 */
export function detectFlexGapSupport(): boolean {
  const probe = document.createElement('div')
  probe.style.cssText = 'display:flex;gap:20px;position:absolute;visibility:hidden;pointer-events:none'
  const first = document.createElement('span')
  const second = document.createElement('span')
  first.style.width = second.style.width = '10px'
  probe.appendChild(first)
  probe.appendChild(second)
  document.body.appendChild(probe)
  const spacing = second.getBoundingClientRect().left - first.getBoundingClientRect().right
  probe.remove()
  return spacing >= 20
}

export function applyFlexGapCompat(): void {
  if (!detectFlexGapSupport()) {
    document.documentElement.classList.add('no-flexgap')
  }
}
