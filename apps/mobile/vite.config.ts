import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import compatibility from './webview-compatibility.json'
import mobilePackage from './package.json'
import { validateBuildInformation } from '../../electron/channel-contract.mjs'

const android = validateBuildInformation(JSON.parse(readFileSync(new URL('./build-info.json', import.meta.url), 'utf8')))
if (android.platform !== 'android' || mobilePackage.version !== android.version) {
  throw new Error('Android Web version is stale; run npm run release:prepare -- --platform android')
}

export default defineConfig({
  define: { __LUMATILE_BUILD__: JSON.stringify(android) },
  plugins: [vue(), {
    name: 'lumatile-release-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'lumatile-version.json', source: JSON.stringify(android) })
    },
  }],
  base: './',
  build: { target: compatibility.target, cssTarget: compatibility.target },
})
