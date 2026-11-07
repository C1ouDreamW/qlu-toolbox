import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import compatibility from './webview-compatibility.json'
import mobilePackage from './package.json'
import releaseVersions from '../../config/release-versions.json'

const android = releaseVersions.android.stable
if (releaseVersions.schemaVersion !== 2 || mobilePackage.version !== android.version) {
  throw new Error('Android Web version is stale; run npm run release:prepare -- --platform android')
}

export default defineConfig({
  plugins: [vue(), {
    name: 'lumatile-release-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'lumatile-version.json', source: JSON.stringify({
        platform: 'android', version: android.version, versionCode: android.versionCode,
      }) })
    },
  }],
  base: './',
  build: { target: compatibility.target, cssTarget: compatibility.target },
})
