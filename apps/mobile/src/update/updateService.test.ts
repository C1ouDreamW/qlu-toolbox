import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ downloadAndInstall: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: {}, registerPlugin: () => native }))
import { findAvailableUpdate, UPDATE_MANIFEST_URLS } from './updateService'
import { appUpdate } from './appUpdate'
const self = 'https://lumatile.ishua.cloud/releases/v2.0.1/a.apk'
const github = 'https://github.com/C1ouDreamW/qlu-toolbox/releases/download/v2.0.1/a.apk'
const manifest = {schemaVersion:1,applicationId:'io.github.c1oudreamw.lumatile',versionCode:11,versionName:'2.0.1',channel:'stable',title:'update',notes:'notes',publishedAt:'2026-09-07',apkUrl:self,sha256:'a'.repeat(64),size:100,mandatory:false}
const current = {applicationId:manifest.applicationId,versionCode:10,versionName:'2.0.0'}
beforeEach(() => { vi.stubGlobal('window',globalThis); native.downloadAndInstall.mockReset() })
afterEach(() => vi.unstubAllGlobals())
it('prefers self-hosted and retries a matching mirror only for transport failures', async () => {
  vi.stubGlobal('fetch',vi.fn(async url => ({ok:true,json:async()=>({...manifest,apkUrl:url===UPDATE_MANIFEST_URLS[0]?self:github})})))
  const update = (await findAvailableUpdate(current))!
  expect(update.apkUrl).toBe(self)
  expect(update.fallbackApkUrls).toEqual([github])
  native.downloadAndInstall.mockRejectedValueOnce({code:'UPDATE_HTTP_ERROR'}).mockResolvedValueOnce({ready:true})
  await appUpdate.downloadAndInstall(update)
  expect(native.downloadAndInstall.mock.calls.map(call=>call[0].apkUrl)).toEqual([self,github])
  native.downloadAndInstall.mockReset().mockRejectedValue({code:'UPDATE_SIGNATURE_MISMATCH'})
  await expect(appUpdate.downloadAndInstall(update)).rejects.toMatchObject({code:'UPDATE_SIGNATURE_MISMATCH'})
  expect(native.downloadAndInstall).toHaveBeenCalledTimes(1)
})
it('rejects inconsistent APK metadata across mirrors', async () => {
  vi.stubGlobal('fetch',vi.fn(async url => ({ok:true,json:async()=>({...manifest,size:url===UPDATE_MANIFEST_URLS[0]?100:200})})))
  await expect(findAvailableUpdate(current)).rejects.toThrow('冲突')
})
