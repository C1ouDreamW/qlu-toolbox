import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      // 线上静态部署脚本使用固定入口校验构件，其余资源使用内容哈希。
      output: { entryFileNames: 'app.mjs' },
    },
  },
})
