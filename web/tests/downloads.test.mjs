import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchManifest, readDownload } from '../frontend/downloads.mjs'

const android = {
  schemaVersion: 1, applicationId: 'io.github.c1oudreamw.lumatile',
  versionName: '2.0.4', size: 6447321, sha256: 'a'.repeat(64),
  apkUrl: 'https://lumatile.ishua.cloud/releases/v2.0.4/LumaTile-Android-v2.0.4.apk',
}
const desktop = {
  schemaVersion: 1, version: '2.0.4', downloads: {
    win32: 'https://lumatile.ishua.cloud/releases/v2.0.4/LumaTile_v2.0.4_x64_Setup.exe',
    darwin: 'https://lumatile.ishua.cloud/releases/v2.0.4/LumaTile_v2.0.4_arm64.dmg',
  },
}

test('读取三个平台的正式安装包，不将桌面版本号套用到 Android', () => {
  assert.deepEqual(readDownload('android', android), { version: '2.0.4', url: android.apkUrl, size: 6447321 })
  assert.equal(readDownload('windows', desktop).url, desktop.downloads.win32)
  assert.equal(readDownload('mac', { ...desktop, version: '2.0.5' }).version, '2.0.5')
})
test('允许项目 GitHub Release 安装包', () => {
  const apkUrl = 'https://github.com/C1ouDreamW/qlu-toolbox/releases/download/v2.0.4/LumaTile-Android-v2.0.4.apk'
  assert.equal(readDownload('android', { ...android, apkUrl }).url, apkUrl)
})
test('拒绝任意域名、其他仓库、凭据、脚本及不匹配的安装包格式', () => {
  for (const apkUrl of [
    'https://evil.example/app.apk',
    'https://lumatile.ishua.cloud.evil.example/releases/app.apk',
    'https://github.com/other/repo/releases/download/v2/app.apk',
    'https://user:pass@lumatile.ishua.cloud/releases/app.apk',
    'http://lumatile.ishua.cloud/releases/app.apk',
    'javascript:alert(1)',
    'https://lumatile.ishua.cloud/admin/app.apk',
    'https://lumatile.ishua.cloud/releases/app.exe',
    'https://lumatile.ishua.cloud/releases/app.apk?redirect=evil',
  ]) assert.throws(() => readDownload('android', { ...android, apkUrl }), apkUrl)
})
test('拒绝损坏的清单和错误的 Android 应用身份', () => {
  for (const patch of [
    { schemaVersion: 2 }, { versionName: '<script>bad</script>' },
    { applicationId: 'other.app' }, { size: 0 }, { size: 1.5 }, { sha256: 'invalid' },
  ]) assert.throws(() => readDownload('android', { ...android, ...patch }))
  assert.throws(() => readDownload('mac', { ...desktop, downloads: {} }))
  assert.throws(() => readDownload('ios', desktop))
  assert.throws(() => readDownload('android', null))
})
test('清单网络失败与 HTTP 错误交给调用方处理', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => android }))
  assert.deepEqual(await fetchManifest('https://example.test/manifest'), android)
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false }))
  await assert.rejects(fetchManifest('https://example.test/manifest'), /更新源/)
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error('offline') })
  await assert.rejects(fetchManifest('https://example.test/manifest'), /offline/)
})
