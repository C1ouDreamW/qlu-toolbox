import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.c1oudreamw.lumatile',
  appName: '一格有光',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    // 安全区由 MainActivity 读取原生 Insets 后注入 CSS 变量，避免受 WebView
    // 版本及 OEM 对 env(safe-area-inset-*) 支持差异影响；保持关闭以免重复处理。
    SystemBars: { insetsHandling: 'disable' },
  },
}

export default config
