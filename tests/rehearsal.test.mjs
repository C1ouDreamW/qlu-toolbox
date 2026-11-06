import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { rehearsalIdentity, recordRehearsal } from '../scripts/rehearse-release.mjs'
import { assertWindowsX64, createReleaseBundle } from '../scripts/release-artifacts.mjs'
import { publishPlatformRelease } from '../scripts/publish-platform-release.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lumatile-rehearsal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'config'))
  await writeFile(join(root, 'config/release-versions.json'), JSON.stringify({ schemaVersion: 1, windows: { version: '2.0.6' }, macos: { version: '2.0.5' }, android: { version: '2.0.4', versionCode: 15 } }))
  await writeFile(join(root, 'config/release-migration.json'), JSON.stringify({ schemaVersion: 1, bridgeVersion: null, independentPublishingEnabled: false, androidSigningSha256: 'a'.repeat(64) }))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['add', '.'])
  git(['-c', 'user.name=Rehearsal Test', '-c', 'user.email=rehearsal@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: 构建演练测试夹具'])
  return { root, git }
}

test('rehearsals resolve immutable HEAD without a tag, release log or enabled gate', async t => {
  const { root, git } = await fixture(t)
  for (const [platform, version] of [['windows', '2.0.6'], ['macos', '2.0.5'], ['android', '2.0.4']]) {
    const value = rehearsalIdentity(root, platform)
    assert.equal(value.commit, git(['rev-parse', 'HEAD']))
    assert.equal(value.version, version)
    assert.equal(value.purpose, 'rehearsal')
    assert.equal(value.deployable, false)
    assert.equal(value.tag, undefined)
  }
  await writeFile(join(root, 'config/release-versions.json'), '{}')
  assert.equal(rehearsalIdentity(root, 'windows').version, '2.0.6')
  assert.equal(git(['tag', '--list']), '')
  assert.throws(() => rehearsalIdentity(root, 'linux'))
})

test('rehearsal artifacts are recorded with hashes and no stable or release pointers', async t => {
  const { root } = await fixture(t)
  for (const [platform, files] of [['windows', ['LumaTile-Rehearsal-Windows-x64-Setup.exe', 'LumaTile-Rehearsal-Windows-x64.zip']], ['macos', ['LumaTile-Rehearsal-macOS-arm64.dmg']], ['android', ['LumaTile-Rehearsal-Android.apk']]]) {
    const identity = rehearsalIdentity(root, platform)
    const verification = { ...identity, verified: true }
    const artifacts = join(root, `${platform}-artifacts`)
    const output = join(root, `${platform}-output`)
    await mkdir(artifacts)
    for (const file of files) await writeFile(join(artifacts, file), `${platform} bytes`)
    const record = await recordRehearsal({ identity, verification, artifacts, output })
    assert.equal(record.deployable, false)
    assert.equal(record.artifacts.length, files.length)
    assert.deepEqual((await readdir(output)).sort(), [...files, 'rehearsal-record.json', 'SHA256SUMS.txt'].sort())
    const sums = await readFile(join(output, 'SHA256SUMS.txt'), 'utf8')
    assert.match(sums, /[a-f0-9]{64}  rehearsal-record.json/)
    assert.ok(!sums.includes('release-record.json'))
    await assert.rejects(recordRehearsal({ identity, verification: { ...verification, commit: 'f'.repeat(40) }, artifacts, output }), /identity mismatch/)
  }
})

test('rehearsals cannot produce deployment bundles or invoke publication APIs', async t => {
  const { root } = await fixture(t)
  const identity = rehearsalIdentity(root, 'windows')
  const verification = { ...identity, verified: true }
  await assert.rejects(createReleaseBundle({ identity, verification }), /cannot generate a release bundle/)
  const { purpose, deployable, ...stripped } = identity
  await assert.rejects(createReleaseBundle({ identity: stripped, verification }), /cannot generate a release bundle/)
  let called = false
  await assert.rejects(publishPlatformRelease({ identity, fetcher: async () => { called = true } }), /cannot be published/)
  assert.equal(called, false)
})

test('Windows native metadata rejects arm64, x86, truncated and invalid PE headers', () => {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.writeUInt32LE(0x00004550, 64); bytes.writeUInt16LE(0x8664, 68)
  assert.doesNotThrow(() => assertWindowsX64(bytes))
  for (const machine of [0xaa64, 0x14c]) {
    const other = Buffer.from(bytes); other.writeUInt16LE(machine, 68)
    assert.throws(() => assertWindowsX64(other), /x64/)
  }
  assert.throws(() => assertWindowsX64(bytes.subarray(0, 64)), /x64/)
  bytes.writeUInt32LE(0xffffffff, 0x3c)
  assert.throws(() => assertWindowsX64(bytes), /x64/)
})
