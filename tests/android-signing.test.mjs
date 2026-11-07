import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import yaml from 'js-yaml'
import { assertUnsignedReceipt, signAndroidRelease, toolEnvironment } from '../scripts/android-signing.mjs'
import { assertReleaseRun, assertReleaseSource } from '../scripts/release-source.mjs'
import { sha256 } from '../scripts/release-artifacts.mjs'

const identity = { platform: 'android', target: 'android', channel: 'stable', version: '2.0.6', versionCode: 17,
  tag: 'android-v2.0.6', commit: 'a'.repeat(40), androidSigningSha256: 'b'.repeat(64) }
const context = { repository: 'C1ouDreamW/qlu-toolbox', event: 'push', ref: 'refs/tags/android-v2.0.6',
  sha: identity.commit, runId: '42', runAttempt: '1' }
const bytes = Buffer.from('unsigned APK fixture')
function receipt() {
  return { schemaVersion: 1, purpose: 'unsigned-android-release', deployable: false,
    platform: 'android', channel: 'stable', tag: identity.tag, commit: identity.commit, version: identity.version,
    versionCode: identity.versionCode, applicationId: 'io.github.c1oudreamw.lumatile', signingSha256: identity.androidSigningSha256,
    repository: context.repository, runId: context.runId, runAttempt: context.runAttempt,
    artifact: { file: 'app-release-unsigned.apk', sha256: sha256(bytes), size: bytes.length } }
}

test('release context rejects PR, manual, branch and cross-repository signing', () => {
  assert.doesNotThrow(() => assertReleaseRun(identity, context))
  for (const change of [{ event: 'pull_request' }, { event: 'workflow_dispatch' }, { ref: 'refs/heads/main' },
    { ref: 'refs/tags/android-v2.0.7' }, { repository: 'someone/fork' }, { sha: 'main' }, { runId: undefined }, { runAttempt: '0' }]) {
    assert.throws(() => assertReleaseRun(identity, { ...context, ...change }))
  }
})

test('signing input is bound to the exact commit, run attempt, native identity and unsigned bytes', () => {
  const options = { identity, context, receipt: receipt(), bytes, expectedSha256: sha256(bytes) }
  assert.doesNotThrow(() => assertUnsignedReceipt(options))
  for (const change of [{ commit: 'c'.repeat(40) }, { tag: 'android-v2.0.7' }, { channel: 'alpha' }, { applicationId: 'other.app' },
    { signingSha256: 'c'.repeat(64) }, { runId: '43' }, { runAttempt: '2' }, { versionCode: 18 }, { deployable: true }, { purpose: 'rehearsal' }]) {
    assert.throws(() => assertUnsignedReceipt({ ...options, receipt: { ...receipt(), ...change } }))
  }
  assert.throws(() => assertUnsignedReceipt({ ...options, bytes: Buffer.from('replaced bytes') }))
  assert.throws(() => assertUnsignedReceipt({ ...options, expectedSha256: 'c'.repeat(64) }))
  assert.throws(() => assertUnsignedReceipt({ ...options, expectedSha256: undefined }))
  assert.throws(() => assertUnsignedReceipt({ ...options, receipt: { ...receipt(), artifact: { ...receipt().artifact, size: 0 } } }))
})

test('invalid artifact is rejected before tools execute or signing credentials are read', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lumatile-signing-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const apk = join(directory, 'input.apk')
  await writeFile(apk, 'replaced bytes')
  const env = new Proxy({}, { get() { throw new Error('Credentials must not be read') } })
  await assert.rejects(signAndroidRelease({ identity, context, receipt: receipt(), apk, expectedSha256: sha256(bytes),
    tools: '/must-not-run', output: join(directory, 'output.apk'), verification: join(directory, 'verification.json'), env }), /bytes differ/)
})

test('metadata tools do not inherit signing secrets or GitHub write credentials', () => {
  const filtered = toolEnvironment({ PATH: '/tools', JAVA_HOME: '/jdk', HOME: '/private-home',
    ANDROID_KEYSTORE_BASE64: 'private', ANDROID_KEYSTORE_PASSWORD: 'password', ANDROID_KEY_ALIAS: 'private-alias',
    ANDROID_KEY_PASSWORD: 'password', GITHUB_TOKEN: 'token', ACTIONS_RUNTIME_TOKEN: 'token' })
  assert.deepEqual(filtered, { PATH: '/tools', JAVA_HOME: '/jdk' })
})

test('Android release YAML separates no-secret build, signature-only credentials and publication write access', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/release-android.yml', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(workflow.on), ['push'])
  assert.deepEqual(workflow.on.push.tags, ['android-v*'])
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  const { build, sign, publish } = workflow.jobs
  assert.deepEqual(sign.needs, ['build'])
  assert.deepEqual(publish.needs, ['build', 'sign'])
  assert.deepEqual(publish.permissions, { contents: 'write' })
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.environment, undefined, 'Use existing repository Secrets, not Environment')
    if (name !== 'publish') assert.equal(job.permissions?.contents ?? workflow.permissions.contents, 'read')
    assert.doesNotMatch(JSON.stringify(job.env ?? {}), /secrets\s*[.\[]/, 'Credentials belong only to the signing step')
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/, 'Pin Actions in the privileged pipeline')
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false)
      const serialized = JSON.stringify(step)
      if (/secrets\s*[.\[]/.test(serialized)) {
        assert.equal(name, 'sign')
        assert.match(step.run, /^node scripts\/prepare-android-signing\.mjs sign /)
        const keys = Object.keys(step.env).filter(key => key.startsWith('ANDROID_')).sort()
        assert.deepEqual(keys, ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'].sort())
        for (const key of keys) assert.equal(step.env[key], '${{ secrets.' + key + ' }}')
      }
      if (name === 'sign') assert.doesNotMatch(step.run ?? '', /\b(?:npm|npx|gradle|gradlew|uv)\b/, 'Do not execute business build tools in the signing job')
    }
  }
  assert.equal(sign.steps.filter(step => /secrets\s*[.\[]/.test(JSON.stringify(step))).length, 1)
})

test('a release tag must resolve to the build commit already contained in origin/main', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lumatile-release-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = message => git(['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message])
  git(['init', '-qb', 'main'])
  await writeFile(join(root, 'file'), 'main')
  git(['add', '.']); commit('test: 主线夹具')
  const main = git(['rev-parse', 'HEAD'])
  git(['update-ref', 'refs/remotes/origin/main', main])
  git(['tag', identity.tag])
  const release = { ...identity, commit: main }
  const run = { ...context, sha: main }
  assert.doesNotThrow(() => assertReleaseSource(root, release, run))
  assert.throws(() => assertReleaseSource(root, release, run, 'f'.repeat(40)), /validated build/)
  git(['checkout', '-qb', 'unreviewed'])
  await writeFile(join(root, 'file'), 'unreviewed')
  git(['add', '.']); commit('test: 未合入主线的夹具')
  const other = git(['rev-parse', 'HEAD'])
  git(['tag', '-f', identity.tag])
  assert.throws(() => assertReleaseSource(root, { ...release, commit: other }, { ...run, sha: other }), /origin\/main/)
  assert.throws(() => assertReleaseSource(root, release, run), /resolve to the validated commit/)
  git(['update-ref', 'refs/remotes/origin/main', other])
  assert.doesNotThrow(() => assertReleaseSource(root, { ...release, commit: other }, { ...run, sha: other }))
})
