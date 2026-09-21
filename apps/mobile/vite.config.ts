import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import compatibility from './webview-compatibility.json'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { target: compatibility.target, cssTarget: compatibility.target },
})
