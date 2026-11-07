import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import yaml from 'js-yaml'
import { alphaCandidateIdentity, candidateArtifactNames, recordCandidate } from '../scripts/alpha-candidate.mjs'
import { assertCandidateRun, assertCandidateSource } from '../scripts/release-source.mjs'
import { assertUnsignedReceipt, signAndroidRelease } from '../scripts/android-signing.mjs'
import { createReleaseBundle, sha256 } from '../scripts/release-artifacts.mjs'
import { publishPlatformRelease } from '../scripts/publish-platform-release.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lumatile-alpha-candidate-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const json = async (file, data) => writeFile(join(root, file), JSON.stringify(data) + '\n')
  git(['init', '-qb', 'main'])
  await mkdir(join(root, 'config'))
  const config = { schemaVersion: 2 }
  for (const platform of ['windows', 'macos', 'android']) config[platform] = {
    stable: { version: '2.0.4', ...(platform === 'android' ? { versionCode: 15 } : { buildNumber: 3 }) },
    alpha: { version: '2.1.0-alpha.1', ...(platform === 'android' ? { versionCode: 1 } : { buildNumber: 1 }) },
  }
  const policy = { schemaVersion: 1, bridgeVersion: null, independentPublishingEnabled: false, alphaPublishingEnabled: false, androidSigningSha256: 'b'.repeat(64), androidAlphaSigningSha256: 'c'.repeat(64) }
  await json('config/release-versions.json', config); await json('config/release-migration.json', policy)
  const commit = () => {
    git(['add', '.']); git(['-c', 'user.name=Candidate Test', '-c', 'user.email=candidate@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'test: 主线候选夹具'])
    const sha = git(['rev-parse', 'HEAD']); git(['update-ref', 'refs/remotes/origin/main', sha]); return sha
  }
  const sha = commit()
  const context = { repository: 'C1ouDreamW/qlu-toolbox', event: 'workflow_dispatch', ref: 'refs/heads/main', sha, runId: '100', runAttempt: '1' }
  return { root, git, json, config, policy, context, commit }
}

function unsigned(identity, context, bytes) {
  return { schemaVersion: 1, purpose: 'unsigned-android-candidate', deployable: false, platform: 'android', channel: 'alpha', tag: null,
    commit: identity.commit, version: identity.version, versionCode: identity.versionCode, applicationId: identity.information.applicationId, signingSha256: identity.androidSigningSha256,
    repository: context.repository, runId: context.runId, runAttempt: context.runAttempt, artifact: { file: 'app-release-unsigned.apk', sha256: sha256(bytes), size: bytes.length } }
}

test('Alpha candidate identity uses immutable main without a tag, release log or publishing gate', async t => {
  const f = await fixture(t)
  for (const platform of ['windows', 'macos', 'android']) {
    const identity = alphaCandidateIdentity(f.root, platform, f.context)
    assert.equal(identity.purpose, 'candidate'); assert.equal(identity.deployable, false)
    assert.equal(identity.channel, 'alpha'); assert.equal(identity.tag, null)
    assert.equal(identity.information.commit, f.context.sha)
    assert.equal(identity.version, '2.1.0-alpha.1')
    assert.equal(identity.releaseTag, `${{ windows: 'win', macos: 'mac', android: 'android' }[platform]}-alpha-v2.1.0-alpha.1`)
  }
  f.config.android.alpha.version = '99.0.0-alpha.1'
  await f.json('config/release-versions.json', f.config)
  assert.equal(alphaCandidateIdentity(f.root, 'android', f.context).version, '2.1.0-alpha.1')
})

test('PR, fork, branch, tag, push and mismatched explicit commit never become signing candidates', async t => {
  const f = await fixture(t), identity = alphaCandidateIdentity(f.root, 'android', f.context)
  assert.doesNotThrow(() => assertCandidateRun(identity, f.context))
  for (const change of [{ event: 'pull_request' }, { event: 'push' }, { ref: 'refs/heads/feature' }, { ref: 'refs/tags/android-alpha-v2.1.0-alpha.1' }, { repository: 'someone/fork' }, { sha: 'f'.repeat(40) }, { runAttempt: '0' }]) {
    assert.throws(() => alphaCandidateIdentity(f.root, 'android', { ...f.context, ...change }))
  }
  for (const change of [{ channel: 'stable' }, { purpose: 'release' }, { deployable: true }, { tag: identity.releaseTag }]) assert.throws(() => assertCandidateRun({ ...identity, ...change }, f.context))
  assert.throws(() => alphaCandidateIdentity(f.root, 'android', f.context, 'f'.repeat(40)), /validated dispatch/)
})

test('even a merged ancestor cannot replace the exact reviewed current main dispatch', async t => {
  const f = await fixture(t), identity = alphaCandidateIdentity(f.root, 'android', f.context)
  const newer = f.commit()
  assert.notEqual(newer, f.context.sha)
  f.git(['checkout', '--detach', f.context.sha])
  assert.throws(() => assertCandidateSource(f.root, identity, f.context), /current origin\/main exactly/)
  f.git(['checkout', '--detach', newer])
  assert.throws(() => alphaCandidateIdentity(f.root, 'android', f.context))
})

test('missing or production Alpha certificates block Android while desktop candidates remain usable', async t => {
  const f = await fixture(t)
  for (const digest of [null, f.policy.androidSigningSha256]) {
    f.policy.androidAlphaSigningSha256 = digest; await f.json('config/release-migration.json', f.policy)
    const context = { ...f.context, sha: f.commit() }
    assert.throws(() => alphaCandidateIdentity(f.root, 'android', context), /independent registered Alpha certificate/)
    assert.equal(alphaCandidateIdentity(f.root, 'macos', context).channel, 'alpha')
  }
})

test('candidate receipts bind actual manual provenance and cannot be converted into release receipts', async t => {
  const f = await fixture(t), identity = alphaCandidateIdentity(f.root, 'android', f.context)
  const bytes = Buffer.from('unsigned candidate fixture'), receipt = unsigned(identity, f.context, bytes)
  const options = { identity, context: f.context, bytes, receipt, expectedSha256: sha256(bytes) }
  assert.doesNotThrow(() => assertUnsignedReceipt(options))
  for (const change of [{ purpose: 'unsigned-android-release' }, { tag: identity.releaseTag }, { applicationId: 'io.github.c1oudreamw.lumatile' }, { runId: '101' }, { signingSha256: f.policy.androidSigningSha256 }]) assert.throws(() => assertUnsignedReceipt({ ...options, receipt: { ...receipt, ...change } }))
  const apk = join(f.root, 'unsigned.apk'); await writeFile(apk, 'replaced')
  const env = new Proxy({}, { get() { throw new Error('Credentials must not be read') } })
  await assert.rejects(signAndroidRelease({ ...options, apk, tools: '/must-not-run', output: join(f.root, 'signed.apk'), verification: join(f.root, 'verification.json'), env }), /bytes differ/)
})

test('candidate records bind final signed APK bytes and never produce deployable pointers', async t => {
  const f = await fixture(t), identity = alphaCandidateIdentity(f.root, 'android', f.context)
  const artifacts = join(f.root, 'artifacts'); await mkdir(artifacts)
  const name = candidateArtifactNames(identity)[0], bytes = Buffer.from('signed fixture')
  await writeFile(join(artifacts, name), bytes)
  const verification = { platform: identity.platform, channel: 'alpha', target: identity.target, version: identity.version, commit: identity.commit, purpose: 'candidate', deployable: false, verified: true,
    checks: { applicationId: identity.information.applicationId, debuggable: false, nativeVersionCode: identity.versionCode, signingSha256: identity.androidSigningSha256, signedSha256: sha256(bytes), signedSize: bytes.length, runId: identity.runId, runAttempt: identity.runAttempt } }
  const output = join(f.root, 'out')
  const record = await recordCandidate({ identity, verification, artifacts, output })
  assert.equal(record.deployable, false)
  assert.deepEqual((await readdir(output)).sort(), [name, 'SHA256SUMS.txt', 'candidate-record.json'].sort())
  await assert.rejects(createReleaseBundle({ identity, verification }), /cannot generate a release bundle/)
  let called = false
  await assert.rejects(publishPlatformRelease({ identity, fetcher: async () => { called = true } }), /cannot be published/)
  assert.equal(called, false)
  await writeFile(join(artifacts, name), 'modified after signature')
  await assert.rejects(recordCandidate({ identity, verification, artifacts, output: join(f.root, 'new') }), /differs from its signed verification/)
})

test('candidate workflow is manual-main-only, read-only and injects only Alpha secrets into an isolated signer', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/alpha-candidate.yml', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.equal(workflow.on.workflow_dispatch.inputs.commit.required, true)
  assert.deepEqual(workflow.jobs['android-sign'].needs, ['android-build'])
  let secretSteps = 0
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.match(job.if, /github.ref == 'refs\/heads\/main'/)
    assert.match(job.if, /github.event_name == 'workflow_dispatch'/)
    assert.match(job.if, /github.repository == 'C1ouDreamW\/qlu-toolbox'/)
    assert.equal(job.environment, undefined)
    assert.equal(job.permissions?.contents ?? workflow.permissions.contents, 'read')
    assert.doesNotMatch(JSON.stringify(job.env ?? {}), /secrets\s*[.\[]/)
    const steps = job.steps
    const recheck = steps.findIndex(step => step.run?.includes('prepare-alpha-candidate.mjs identity'))
    assert.ok(recheck >= 0)
    for (const [index, step] of steps.entries()) {
      if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/)
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false)
      assert.doesNotMatch(step.run ?? '', /publish-platform-release|build-release-bundle|git (?:push|tag)/)
      if (name === 'android-sign') assert.doesNotMatch(step.run ?? '', /\b(?:npm|npx|gradle|gradlew|uv)\b/)
      if (/secrets\s*[.\[]/.test(JSON.stringify(step))) {
        secretSteps++; assert.equal(name, 'android-sign'); assert.ok(index > recheck)
        assert.match(step.run, /^node scripts\/prepare-alpha-candidate.mjs sign android /)
        for (const key of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) assert.equal(step.env[key], '${{ secrets.' + key.replace('ANDROID_', 'ANDROID_ALPHA_') + ' }}')
      }
    }
  }
  assert.equal(secretSteps, 1)
})

test('desktop candidate archives require all target files and matching Alpha worker identity', async t => {
  const f = await fixture(t)
  for (const platform of ['windows', 'macos']) {
    const identity = alphaCandidateIdentity(f.root, platform, f.context)
    const artifacts = join(f.root, platform); await mkdir(artifacts)
    const names = candidateArtifactNames(identity)
    for (const name of names) await writeFile(join(artifacts, name), 'native candidate fixture')
    const verification = { platform, channel: 'alpha', target: identity.target, commit: identity.commit, version: identity.version, purpose: 'candidate', deployable: false, verified: true,
      checks: { channel: 'alpha', applicationId: identity.information.applicationId, electronVersion: identity.version, pythonVersion: identity.version } }
    const record = await recordCandidate({ identity, verification, artifacts, output: join(f.root, `${platform}-output`) })
    assert.equal(record.artifacts.length, names.length)
    await assert.rejects(recordCandidate({ identity, verification: { ...verification, checks: { ...verification.checks, applicationId: 'student.qlu.toolbox' } }, artifacts, output: join(f.root, `${platform}-invalid`) }), /desktop identity/)
    await rm(join(artifacts, names[0]))
    await assert.rejects(recordCandidate({ identity, verification, artifacts, output: join(f.root, `${platform}-missing`) }), /artifact set/)
  }
})
