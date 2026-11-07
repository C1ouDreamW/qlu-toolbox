import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { prepareRelease } from '../scripts/prepare-release.mjs'
import { assertStableVersion, extractReleaseNotes, hostReleasePlatform, resolveRelease, validateReleaseConfig } from '../scripts/release-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = ['package.json', 'package-lock.json', 'apps/mobile/package.json', 'lumatile/__init__.py', 'pyproject.toml', 'uv.lock']
const versions = () => ({ schemaVersion: 1, windows: { version: '2.0.5' }, macos: { version: '2.0.6' }, android: { version: '2.0.7', versionCode: 16 } })
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`)

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lumatile-release-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true })
    await copyFile(join(root, file), join(dir, file))
  }
  await mkdir(join(dir, 'config'))
  await writeJson(join(dir, 'config/release-versions.json'), versions())
  await mkdir(join(dir, 'changelogs'))
  for (const [platform, entry] of Object.entries(versions()).filter(([key]) => key !== 'schemaVersion')) {
    await writeFile(join(dir, `changelogs/${platform}.md`), `# Changes\n\n## [${entry.version}] - 2026-11-05\n\n- Change for ${platform}.\n`)
  }
  return dir
}

async function snapshot(dir) {
  return Object.fromEntries(await Promise.all([...files, 'config/release-versions.json'].map(async file => [file, await readFile(join(dir, file), 'utf8')])))
}

test('stable versions reject prefixes, prereleases, coercions, leading zeroes and trailing newlines', () => {
  for (const value of [undefined, null, 205, 'v2.0.5', 'win-v2.0.5', '2.0', '2.0.5-beta.1', '2.0.5+build', '02.0.5', '2.00.5', '2.0.05', '2.0.5\n', '2.0.5 ', '2.0.-1', '9007199254740992.0.0']) {
    assert.throws(() => assertStableVersion(value), /Invalid stable version/)
  }
  assert.equal(assertStableVersion('0.0.0'), '0.0.0')
  assert.equal(assertStableVersion('12.30.41'), '12.30.41')
})

test('release identity binds tag, platform, target and stable channel to config', () => {
  assert.deepEqual(resolveRelease(versions(), { platform: 'windows', tag: 'win-v2.0.5', target: 'windows-x64' }), {
    platform: 'windows', target: 'windows-x64', channel: 'stable', version: '2.0.5', tag: 'win-v2.0.5',
  })
  for (const options of [
    {}, { platform: '__proto__' }, { platform: 'linux' },
    { platform: 'macos', tag: 'win-v2.0.6' }, { platform: 'macos', tag: 'mac-v2.0.5' },
    { platform: 'macos', tag: 'v2.0.6' }, { platform: 'macos', tag: 'mac-v2.0.6-beta' },
    { platform: 'macos', channel: 'beta' }, { platform: 'macos', target: 'macos-x64' },
    { platform: 'android', target: 'windows-x64' },
  ]) assert.throws(() => resolveRelease(versions(), options))
  for (const code of [0, -1, 1.5, '16', 2100000001]) {
    const config = versions()
    config.android.versionCode = code
    assert.throws(() => validateReleaseConfig(config), /versionCode/)
  }
  assert.throws(() => validateReleaseConfig({ ...versions(), schemaVersion: 3 }), /schema/)
})

test('desktop host mapping never substitutes an architecture, including Rosetta', () => {
  assert.equal(hostReleasePlatform('win32', 'x64'), 'windows')
  assert.equal(hostReleasePlatform('darwin', 'arm64'), 'macos')
  for (const [platform, arch] of [['darwin', 'x64'], ['win32', 'arm64'], ['linux', 'x64']]) {
    assert.throws(() => hostReleasePlatform(platform, arch), /Unsupported desktop host/)
  }
})

test('release notes require a unique, nonempty exact version section', () => {
  const log = '# Log\n\n## [Unreleased]\n\nLater\n\n## [2.0.5] - 2026-11-05\n\n### Fixed\n\n- Windows change\n\n## [2.0.4]\n\nOld\n'
  assert.equal(extractReleaseNotes(log, '2.0.5'), '### Fixed\n\n- Windows change')
  for (const bad of ['## [2.0.50]\nWrong', '## [2.0.5]\n\n## [2.0.4]\nOld', '## [2.0.5]\n### Fixed\n', '## [2.0.5]\nOne\n## [2.0.5]\nTwo']) {
    assert.throws(() => extractReleaseNotes(bad, '2.0.5'))
  }
})

test('check is read-only; verify rejects stale carriers without changing them', async t => {
  const dir = await fixture(t)
  const before = await snapshot(dir)
  const result = await prepareRelease({ root: dir, platform: 'macos', tag: 'mac-v2.0.6', check: true })
  assert.deepEqual(result.files, ['package.json', 'package-lock.json', 'lumatile/__init__.py'])
  assert.deepEqual(await snapshot(dir), before)
  await assert.rejects(prepareRelease({ root: dir, platform: 'macos', verify: true }), /stale/)
  assert.deepEqual(await snapshot(dir), before)
})

test('one checkout prepares distinct desktop versions while preserving Android and dependency resolutions', async t => {
  const dir = await fixture(t)
  const before = await snapshot(dir)
  // A user edit outside a version field must survive preparation.
  const pkg = await readJson(join(dir, 'package.json'))
  pkg.description = 'User edit retained'
  await writeJson(join(dir, 'package.json'), pkg)
  for (const [platform, version] of [['windows', '2.0.5'], ['macos', '2.0.6']]) {
    await prepareRelease({ root: dir, platform })
    assert.equal((await readJson(join(dir, 'package.json'))).version, version)
    assert.equal((await readJson(join(dir, 'package.json'))).description, 'User edit retained')
    assert.match(await readFile(join(dir, 'lumatile/__init__.py'), 'utf8'), new RegExp(`__version__ = "${version.replaceAll('.', '\\.')}"`))
    const lock = await readJson(join(dir, 'package-lock.json'))
    assert.equal(lock.version, version)
    assert.equal(lock.packages[''].version, version)
    const originalLock = JSON.parse(before['package-lock.json'])
    lock.version = originalLock.version
    lock.packages[''].version = originalLock.packages[''].version
    assert.deepEqual(lock, originalLock)
    assert.equal(await readFile(join(dir, 'apps/mobile/package.json'), 'utf8'), before['apps/mobile/package.json'])
    assert.deepEqual((await prepareRelease({ root: dir, platform, verify: true })).files, [])
    assert.deepEqual((await prepareRelease({ root: dir, platform })).files, [])
  }
  const after = await snapshot(dir)
  for (const file of ['pyproject.toml', 'uv.lock', 'config/release-versions.json']) assert.equal(after[file], before[file])
})

test('Android preparation changes only mobile version records and preserves desktop versions', async t => {
  const dir = await fixture(t)
  const before = await snapshot(dir)
  const result = await prepareRelease({ root: dir, platform: 'android', tag: 'android-v2.0.7' })
  assert.equal(result.versionCode, 16)
  assert.deepEqual(result.files, ['apps/mobile/package.json', 'package-lock.json'])
  assert.equal((await readJson(join(dir, 'apps/mobile/package.json'))).version, '2.0.7')
  const lock = await readJson(join(dir, 'package-lock.json'))
  assert.equal(lock.packages['apps/mobile'].version, '2.0.7')
  const originalLock = JSON.parse(before['package-lock.json'])
  lock.packages['apps/mobile'].version = originalLock.packages['apps/mobile'].version
  assert.deepEqual(lock, originalLock)
  const after = await snapshot(dir)
  for (const file of files.filter(file => !result.files.includes(file))) assert.equal(after[file], before[file])
  assert.equal(after['config/release-versions.json'], before['config/release-versions.json'])
  assert.deepEqual((await prepareRelease({ root: dir, platform: 'android', verify: true })).files, [])
})

test('bad identity, missing notes and invalid carriers fail before any mutation', async t => {
  const dir = await fixture(t)
  const before = await snapshot(dir)
  await assert.rejects(prepareRelease({ root: dir, platform: 'windows', tag: 'win-v2.0.6' }), /Tag mismatch/)
  assert.deepEqual(await snapshot(dir), before)
  await writeFile(join(dir, 'changelogs/windows.md'), '# Log\n\n## [Unreleased]\n\nFuture')
  await assert.rejects(prepareRelease({ root: dir, platform: 'windows', tag: 'win-v2.0.5' }), /changelog/)
  assert.deepEqual(await snapshot(dir), before)
  await writeJson(join(dir, 'package-lock.json'), { lockfileVersion: 3, packages: {} })
  const invalidLockSnapshot = await snapshot(dir)
  await assert.rejects(prepareRelease({ root: dir, platform: 'windows' }), /lockfile/)
  assert.deepEqual(await snapshot(dir), invalidLockSnapshot)
})

test('missing Python version fails without partially updating package and lockfile', async t => {
  const dir = await fixture(t)
  await writeFile(join(dir, 'lumatile/__init__.py'), '"""User file without a version."""\n')
  const before = await snapshot(dir)
  await assert.rejects(prepareRelease({ root: dir, platform: 'windows' }), /__version__/)
  assert.deepEqual(await snapshot(dir), before)
})

test('CLI anchors to the repository, rejects typos and never mutates in check mode', async () => {
  const before = await snapshot(root)
  const script = join(root, 'scripts/prepare-release.mjs')
  const result = spawnSync(process.execPath, [script, '--platform', 'android', '--check'], { cwd: tmpdir(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).mode, 'check')
  for (const args of [[], ['--platfrom', 'android'], ['--platform', 'android', '--check', '--verify']]) {
    assert.notEqual(spawnSync(process.execPath, [script, ...args]).status, 0)
  }
  assert.deepEqual(await snapshot(root), before)
})
