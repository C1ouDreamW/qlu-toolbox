import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateDesktopManifest, taggedDesktopIdentity } from '../scripts/generate-desktop-update-manifest.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lumatile-manifest-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
const identity = { version: '2.0.6', commit: 'a'.repeat(40), notes: '- Fix', publishedAt: '2026-11-06T00:00:00Z' }
const root = fileURLToPath(new URL('../', import.meta.url))

test('single-target desktop manifests use actual artifact bytes without requiring another platform', async t => {
  const dir = await fixture(t)
  const file = 'LumaTile-Windows-v2.0.6-x64-Setup.exe'
  const bytes = Buffer.from('windows artifact fixture')
  await writeFile(join(dir, file), bytes)
  const result = await generateDesktopManifest({ ...identity, platform: 'windows', tag: 'win-v2.0.6', artifacts: dir })
  assert.deepEqual(Object.keys(result.artifacts), ['installer'])
  assert.equal(result.artifacts.installer.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(result.artifacts.installer.size, bytes.length)
  assert.equal(result.arch, 'x64')
  assert.equal(result.schemaVersion, 2)
  assert.equal(result.buildNumber, 1)
  assert.equal(result.nativeBuildVersion, '2.0.6.1')
  assert.match(result.artifacts.installer.fallbackUrl, /github.com\/C1ouDreamW\/qlu-toolbox\/releases\/download\/win-v2.0.6\//)
  await writeFile(join(dir, 'LumaTile-Windows-v2.0.6-x64.zip'), 'portable fixture')
  const withPortable = await generateDesktopManifest({ ...identity, platform: 'windows', tag: 'win-v2.0.6', artifacts: dir })
  assert.deepEqual(Object.keys(withPortable.artifacts), ['installer', 'portable'])
})

test('wrong or missing target artifacts and prerelease or mismatched tags cannot generate a stable pointer', async t => {
  const dir = await fixture(t)
  await writeFile(join(dir, 'LumaTile-macOS-v2.0.6-arm64.dmg'), 'mac fixture')
  for (const options of [{ platform: 'windows', tag: 'win-v2.0.6' }, { platform: 'macos', tag: 'mac-v2.0.7' }, { platform: 'macos', tag: 'mac-v2.0.6-beta' }, { platform: 'macos', tag: 'v2.0.6' }]) {
    await assert.rejects(generateDesktopManifest({ ...identity, artifacts: dir, ...options }))
  }
  const result = await generateDesktopManifest({ ...identity, artifacts: dir, platform: 'macos', tag: 'mac-v2.0.6' })
  assert.equal(result.arch, 'arm64')
  assert.equal(result.nativeBuildVersion, '1')
  assert.deepEqual(Object.keys(result.artifacts), ['dmg'])
})

test('bridge manifests use the legacy filenames only for the configured bridge version', async t => {
  const dir = await fixture(t)
  await writeFile(join(dir, 'LumaTile_v2.0.6_arm64.dmg'), 'bridge mac fixture')
  const options = { ...identity, artifacts: dir, platform: 'macos', tag: 'v2.0.6' }
  await assert.rejects(generateDesktopManifest(options))
  const result = await generateDesktopManifest({ ...options, bridgeVersion: '2.0.6' })
  assert.match(result.artifacts.dmg.url, /releases\/v2.0.6\/LumaTile_v2.0.6_arm64.dmg$/)
})

test('CLI identity is taken from the immutable tag commit rather than edited working files', async t => {
  const dir = await fixture(t)
  const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  await mkdir(join(dir, 'config'))
  const config = { schemaVersion: 1, windows: { version: '2.0.6' }, macos: { version: '2.0.4' }, android: { version: '2.0.4', versionCode: 15 } }
  await writeFile(join(dir, 'config/release-versions.json'), JSON.stringify(config))
  await writeFile(join(dir, 'config/release-migration.json'), JSON.stringify({ schemaVersion: 1, bridgeVersion: null }))
  git(['init', '-q'])
  git(['add', '.'])
  git(['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: 发布身份测试夹具'])
  git(['tag', 'win-v2.0.6'])
  config.windows.version = '99.0.0'
  await writeFile(join(dir, 'config/release-versions.json'), JSON.stringify(config))
  const result = taggedDesktopIdentity(dir, 'win-v2.0.6', 'windows')
  assert.equal(result.version, '2.0.6')
  assert.equal(result.commit, git(['rev-parse', 'HEAD']))
  await writeFile(join(dir, 'next'), 'next commit')
  git(['add', 'next'])
  git(['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: 后续提交夹具'])
  assert.throws(() => taggedDesktopIdentity(dir, 'win-v2.0.6', 'windows'), /checked-out commit/)
})

test('legacy desktop generation keeps schema 1 and requires both matching desktop artifacts', async t => {
  const dir = await fixture(t)
  const notes = join(dir, 'notes.md')
  const output = join(dir, 'desktop.json')
  await writeFile(notes, '- Bridge')
  await writeFile(join(dir, 'LumaTile_v2.0.6_x64_Setup.exe'), 'windows')
  const args = [join(root, 'scripts/generate-legacy-desktop-update-manifest.mjs'), dir, output, '2.0.6', 'https://lumatile.ishua.cloud/releases/v2.0.6', notes]
  assert.notEqual(spawnSync(process.execPath, args).status, 0)
  await writeFile(join(dir, 'LumaTile_v2.0.5_arm64.dmg'), 'wrong mac version')
  assert.notEqual(spawnSync(process.execPath, args).status, 0)
  await writeFile(join(dir, 'LumaTile_v2.0.6_arm64.dmg'), 'mac')
  assert.equal(spawnSync(process.execPath, args).status, 0)
  const manifest = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.version, '2.0.6')
  assert.match(manifest.downloads.win32, /x64_Setup.exe$/)
  assert.match(manifest.downloads.darwin, /arm64.dmg$/)
})

test('Android platform tags preserve schema 1 and identical APK identity across mirrors', async t => {
  const dir = await fixture(t)
  const apk = join(dir, 'LumaTile-Android-v2.0.6.apk')
  const notes = join(dir, 'notes.md')
  await writeFile(apk, 'one signed APK fixture')
  await writeFile(notes, '- Android fix')
  const run = (tag, version, code, base) => {
    const output = join(dir, `${tag}.json`)
    const args = [join(root, 'scripts/generate-android-update-manifest.mjs'), apk, output, String(code), version, 'C1ouDreamW/qlu-toolbox', tag, notes, ...(base ? [base] : [])]
    return { result: spawnSync(process.execPath, args), output }
  }
  const primary = run('android-v2.0.6', '2.0.6', 16, 'https://lumatile.ishua.cloud/releases/android-v2.0.6')
  assert.equal(primary.result.status, 0, primary.result.stderr.toString())
  const a = JSON.parse(await readFile(primary.output, 'utf8'))
  const fallback = run('android-v2.0.6', '2.0.6', 16)
  assert.equal(fallback.result.status, 0)
  const b = JSON.parse(await readFile(fallback.output, 'utf8'))
  assert.equal(a.schemaVersion, 1)
  assert.equal(a.applicationId, 'io.github.c1oudreamw.lumatile')
  assert.equal(a.sha256, b.sha256)
  assert.equal(a.size, b.size)
  for (const [tag, version, code] of [['win-v2.0.6', '2.0.6', 16], ['android-v2.0.7', '2.0.6', 16], ['android-v2.0.6-beta', '2.0.6-beta', 16], ['android-v2.0.6', '2.0.6', 0]]) {
    assert.notEqual(run(tag, version, code).result.status, 0)
  }
})
