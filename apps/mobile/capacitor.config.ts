import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.c1oudreamw.lumatile',
  appName: '一格有光',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    // SystemBars 的 CSS insets 处理按设备 WebView 版本分派：WebView 140 之前
    // Chromium 的 env(safe-area-inset-*) 恒为 0，140+ 的透传路径在部分 OEM 构建
    // 上仍不生效，顶栏会被状态栏遮挡。insets 统一由 MainActivity 原生接管，
    // 这里必须保持关闭，避免两套 padding 叠加。
    SystemBars: { insetsHandling: 'disable' },
  },
}

export default config
