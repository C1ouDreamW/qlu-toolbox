import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { validateStablePromotion } from '../scripts/release-promotion.mjs'
import { validatePublishedAlpha } from '../scripts/promotion-publication.mjs'
import { artifactFileNames, desktopTarget } from '../electron/update-contract.mjs'
import { androidArtifactName } from '../electron/android-update-contract.mjs'
import { taggedRelease } from '../scripts/release-artifacts.mjs'

async function fixture(t, platform = 'windows') {
  const root = await mkdtemp(join(tmpdir(), 'lumatile-promotion-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const json = async (file, data) => { await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), JSON.stringify(data, null, 2) + '\n') }
  const commit = date => {
    git(['add', '.'])
    execFileSync('git', ['-c', 'user.name=Promotion Test', '-c', 'user.email=promotion@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'test: 晋级审查夹具'], {
      cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: 'pipe',
    })
    return git(['rev-parse', 'HEAD'])
  }
  git(['init', '-q'])
  const versions = { schemaVersion: 2 }
  for (const name of ['windows', 'macos', 'android']) versions[name] = {
    stable: { version: '2.0.6', ...(name === 'android' ? { versionCode: 16 } : { buildNumber: 4 }) },
    alpha: { version: '2.1.0-alpha.2', ...(name === 'android' ? { versionCode: 2 } : { buildNumber: 2 }) },
  }
  await json('config/release-versions.json', versions)
  await json('config/release-migration.json', { schemaVersion: 1, bridgeVersion: '2.0.5', independentPublishingEnabled: true, alphaPublishingEnabled: true, androidSigningSha256: 'a'.repeat(64), androidAlphaSigningSha256: 'b'.repeat(64) })
  await json('package.json', { name: 'lumatile', version: '2.0.6', dependencies: { vue: '3.5.0' }, build: { appId: 'student.qlu.toolbox', files: ['dist/**/*'], mac: {}, nsis: {}, win: {} } })
  await json('apps/mobile/package.json', { name: 'mobile', version: '2.0.6', dependencies: { vue: '3.5.0' } })
  await json('package-lock.json', { name: 'lumatile', version: '2.0.6', lockfileVersion: 3, packages: { '': { version: '2.0.6', dependencies: { vue: '3.5.0' } }, 'apps/mobile': { version: '2.0.6' }, 'node_modules/vue': { version: '3.5.0', integrity: 'sha512-fixture' } } })
  await mkdir(join(root, 'lumatile')); await writeFile(join(root, 'lumatile/__init__.py'), '__version__ = "2.0.6"\n')
  await mkdir(join(root, 'src')); await writeFile(join(root, 'src/feature.ts'), 'export const feature = true\n')
  await mkdir(join(root, 'changelogs')); await writeFile(join(root, `changelogs/${platform}.md`), '## [2.1.0-alpha.2]\n\n- Test\n')
  const alphaCommit = commit('2026-11-01T00:00:00Z')
  const alphaTag = `${{ windows: 'win', macos: 'mac', android: 'android' }[platform]}-alpha-v2.1.0-alpha.2`
  git(['tag', alphaTag])
  versions[platform].stable.version = '2.1.0'
  if (platform === 'android') versions[platform].stable.versionCode++
  else versions[platform].stable.buildNumber++
  await json('config/release-versions.json', versions)
  await writeFile(join(root, `changelogs/${platform}.md`), '## [2.1.0]\n\n- Stable release\n')
  const evidence = { schemaVersion: 1, mode: 'alpha', platform, stableVersion: '2.1.0', alpha: { tag: alphaTag, commit: alphaCommit },
    review: { approvedBy: 'maintainer', observationStartedAt: '2026-11-02T00:00:00Z', observationEndedAt: '2026-11-03T00:00:00Z', approvedAt: '2026-11-04T00:00:00Z', summary: 'Candidate installation and updates verified', tests: [{ name: 'Upgrade data preservation', result: 'passed', evidence: 'Acceptance record #1' }] } }
  const evidenceFile = `config/promotions/${platform}-2.1.0.json`
  await json(evidenceFile, evidence)
  const identity = { platform, channel: 'stable', version: '2.1.0', tag: `${{ windows: 'win', macos: 'mac', android: 'android' }[platform]}-v2.1.0` }
  const finish = async () => {
    identity.commit = commit('2026-11-05T00:00:00Z')
    git(['tag', '-f', identity.tag])
    return identity
  }
  const mutate = async (file, fn) => { const data = JSON.parse(await readFile(join(root, file), 'utf8')); fn(data); await json(file, data) }
  return { root, git, commit, json, identity, alphaCommit, alphaTag, versions, evidence, evidenceFile, finish, mutate }
}

test('each Stable platform binds the reviewed immutable Alpha source without coupling other versions', async t => {
  for (const platform of ['windows', 'macos', 'android']) {
    const f = await fixture(t, platform)
    const result = validateStablePromotion(f.root, await f.finish())
    assert.equal(result.alpha.commit, f.alphaCommit)
    assert.equal(result.alphaVersion, '2.1.0-alpha.2')
    assert.equal(result.stableCommit, f.identity.commit)
    assert.deepEqual(result.untestedPaths, [])
    assert.deepEqual(taggedRelease(f.root, platform, f.identity.tag).promotion, result)
    // Working-tree changes cannot rewrite the committed approval or source comparison.
    await f.json(f.evidenceFile, { ...f.evidence, alpha: { tag: 'wrong', commit: 'f'.repeat(40) } })
    assert.equal(validateStablePromotion(f.root, f.identity).alpha.commit, f.alphaCommit)
  }
})

test('explicit version carriers and generated build identity may change without hiding dependencies', async t => {
  const f = await fixture(t)
  await f.mutate('package.json', p => { p.version = '2.1.0'; p.build.appId = 'student.qlu.toolbox'; p.build.buildVersion = '2.1.0.5'; p.build.win.executableName = 'LumaTile'; p.build.mac.extendInfo = { CFBundleShortVersionString: '2.1.0' }; p.build.files.push('lumatile/build-info.json') })
  await f.mutate('package-lock.json', p => { p.version = p.packages[''].version = '2.1.0' })
  await writeFile(join(f.root, 'lumatile/__init__.py'), '__version__ = "2.1.0"\n')
  assert.deepEqual(validateStablePromotion(f.root, await f.finish()).untestedPaths, [])
  const android = await fixture(t, 'android')
  await android.mutate('apps/mobile/package.json', p => { p.version = '2.1.0' })
  await android.mutate('package-lock.json', p => { p.packages['apps/mobile'].version = '2.1.0' })
  assert.deepEqual(validateStablePromotion(android.root, await android.finish()).untestedPaths, [])
})

test('business, dependency, workflow, native, build flags and other target changes require another Alpha', async t => {
  const cases = [
    ['src/feature.ts', async f => writeFile(join(f.root, 'src/feature.ts'), 'export const feature = false\n')],
    ['package.json', f => f.mutate('package.json', p => { p.dependencies.vue = '9.0.0' })],
    ['package.json', f => f.mutate('package.json', p => { p.build.appId = 'other.app' })],
    ['package.json', f => f.mutate('package.json', p => { p.build.win.executableName = 'wrong' })],
    ['package.json', f => f.mutate('package.json', p => { p.build.mac.hardenedRuntime = false })],
    ['package-lock.json', f => f.mutate('package-lock.json', p => { p.packages['node_modules/vue'].integrity = 'different' })],
    ['config/release-versions.json', f => f.mutate('config/release-versions.json', p => { p.android.stable.version = '3.0.0' })],
    ['config/release-versions.json', f => f.mutate('config/release-versions.json', p => { p.windows.stable.newBehavior = true })],
    ['config/release-migration.json', f => f.mutate('config/release-migration.json', p => { p.androidSigningSha256 = 'c'.repeat(64) })],
    ['.github/workflows/release.yml', f => f.json('.github/workflows/release.yml', { permissions: 'write-all' })],
    ['lumatile/__init__.py', f => writeFile(join(f.root, 'lumatile/__init__.py'), '__version__ = "2.1.0"\nprint("new logic")\n')],
  ]
  for (const [path, mutate] of cases) {
    const f = await fixture(t)
    await mutate(f)
    await f.finish()
    assert.throws(() => validateStablePromotion(f.root, f.identity), error => error.message.includes('require another Alpha') && error.message.includes(path), path)
  }
})

test('moved Alpha tags, unrelated source, mismatched version, missing approval and invalid chronology fail closed', async t => {
  for (const mutate of [
    f => { f.evidence.alpha.commit = 'f'.repeat(40) },
    f => { f.evidence.stableVersion = '2.1.1' },
    f => { f.evidence.review.tests = [] },
    f => { f.evidence.review.tests[0].result = 'pending' },
    f => { f.evidence.review.approvedBy = '' },
    f => { f.evidence.review.approvedAt = '2026-11-06T00:00:00Z' },
    f => { f.evidence.review.observationStartedAt = '2026-10-30T00:00:00Z' },
    f => { f.evidence.review.observationEndedAt = '2026-11-01T00:00:00Z' },
    f => { f.evidence.alpha.tag = 'win-v2.1.0' },
  ]) {
    const f = await fixture(t)
    mutate(f); await f.json(f.evidenceFile, f.evidence)
    await f.finish()
    assert.throws(() => validateStablePromotion(f.root, f.identity))
  }
  const f = await fixture(t)
  await f.finish(); f.git(['tag', '-f', f.alphaTag, f.identity.commit])
  assert.throws(() => validateStablePromotion(f.root, f.identity), /tag/)
})

test('file deletion and executable mode changes cannot hide inside allowed metadata paths', async t => {
  for (const change of [async f => rm(join(f.root, 'src/feature.ts')), async f => { f.git(['config', 'core.filemode', 'false']); f.git(['update-index', '--chmod=+x', 'package.json']) }]) {
    const f = await fixture(t); await change(f)
    await f.finish()
    assert.throws(() => validateStablePromotion(f.root, f.identity), /require another Alpha/)
  }
})

test('emergency promotion records explicit approval of every remaining code path', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'src/feature.ts'), 'export const feature = false\n')
  f.evidence.mode = 'emergency'
  f.evidence.emergency = { reason: 'Urgent security fix', approvedChangedPaths: ['src/feature.ts'] }
  await f.json(f.evidenceFile, f.evidence)
  const result = validateStablePromotion(f.root, await f.finish())
  assert.deepEqual(result.untestedPaths, ['src/feature.ts'])
  f.evidence.emergency.approvedChangedPaths = ['src/*']
  await f.json(f.evidenceFile, f.evidence); await f.finish()
  assert.throws(() => validateStablePromotion(f.root, f.identity), /exact untested paths/)
})

test('missing evidence, mismatched Alpha base and unrelated history cannot authorize Stable', async t => {
  const missing = await fixture(t)
  await rm(join(missing.root, missing.evidenceFile)); await missing.finish()
  assert.throws(() => validateStablePromotion(missing.root, missing.identity), /Missing/)
  const base = await fixture(t)
  await base.mutate('config/release-versions.json', p => { p.windows.stable.version = '2.1.1' })
  base.evidence.stableVersion = '2.1.1'
  await base.json('config/promotions/windows-2.1.1.json', base.evidence)
  await base.finish()
  assert.throws(() => validateStablePromotion(base.root, { ...base.identity, version: '2.1.1', tag: 'win-v2.1.1' }), /tested Alpha base/)
  const unrelated = await fixture(t)
  unrelated.git(['checkout', '--orphan', 'separate-root'])
  await unrelated.finish()
  assert.throws(() => validateStablePromotion(unrelated.root, unrelated.identity), /ancestor/)
})

function publicAlpha(promotion, change = () => {}) {
  const platform = promotion.platform
  const target = platform === 'android' ? null : desktopTarget(platform === 'windows' ? 'win32' : 'darwin', platform === 'windows' ? 'x64' : 'arm64')
  const root = `https://github.com/C1ouDreamW/qlu-toolbox/releases/download/${promotion.alpha.tag}`
  const file = platform === 'android' ? androidArtifactName(promotion.alphaVersion, 'alpha') : artifactFileNames(target, promotion.alphaVersion, false, 'alpha')[target.primary]
  const artifact = { url: `${root}/${file}`, fallbackUrl: `${root}/${file}`, sha256: 'b'.repeat(64), size: 123 }
  const manifest = platform === 'android'
    ? { schemaVersion: 1, applicationId: 'io.github.c1oudreamw.lumatile.alpha', channel: 'alpha', versionName: promotion.alphaVersion, versionCode: 2,
        tag: promotion.alpha.tag, commit: promotion.alpha.commit, title: 'Alpha', notes: '- Verified', publishedAt: '2026-11-02T00:00:00Z', mandatory: false, apkUrl: artifact.url, sha256: artifact.sha256, size: artifact.size }
    : { schemaVersion: 2, platform, arch: target.arch, channel: 'alpha', tag: promotion.alpha.tag, commit: promotion.alpha.commit, version: promotion.alphaVersion,
        name: 'Alpha', notes: '- Verified', publishedAt: '2026-11-02T00:00:00Z', artifacts: { [target.primary]: artifact } }
  const manifestUrl = `${root}/update-${target?.id ?? 'android'}.json`
  const release = { tag_name: promotion.alpha.tag, draft: false, prerelease: true, published_at: '2026-11-02T00:00:00Z', assets: [
    { name: manifestUrl.split('/').at(-1), browser_download_url: manifestUrl, state: 'uploaded', size: 0 },
    { name: file, browser_download_url: artifact.url, state: 'uploaded', size: artifact.size, digest: `sha256:${artifact.sha256}` },
  ] }
  const source = { sha: promotion.alpha.commit }
  change({ manifest, release, source })
  const bytes = Buffer.from(JSON.stringify(manifest))
  release.assets.filter(asset => asset.name.startsWith('update-')).forEach(asset => { asset.size = bytes.length })
  const calls = []
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Authorization, undefined)
    calls.push(url)
    if (url === manifestUrl) return new Response(bytes)
    if (url.includes('/releases/tags/')) return new Response(JSON.stringify(release))
    if (url.includes('/commits/')) return new Response(JSON.stringify(source))
    throw new Error(`Unexpected request: ${url}`)
  }
  return { fetcher, calls }
}

test('promotion verifies a public Alpha prerelease and installation assets for each target without credentials', async t => {
  for (const platform of ['windows', 'macos', 'android']) {
    const f = await fixture(t, platform)
    const promotion = validateStablePromotion(f.root, await f.finish())
    const remote = publicAlpha(promotion)
    const result = await validatePublishedAlpha(promotion, remote.fetcher)
    assert.equal(result.commit, f.alphaCommit)
    assert.equal(result.tag, f.alphaTag)
    assert.match(result.manifestSha256, /^[a-f0-9]{64}$/)
    assert.equal(remote.calls.length, 3)
  }
})

test('drafts, moved tags, missing artifacts and invalid Alpha review/publication relations fail before signing', async t => {
  const f = await fixture(t)
  const promotion = validateStablePromotion(f.root, await f.finish())
  for (const change of [
    ({ release }) => { release.draft = true },
    ({ release }) => { release.prerelease = false },
    ({ release }) => { release.tag_name = 'win-v2.1.0' },
    ({ release }) => { release.published_at = '2026-11-05T00:00:00Z' },
    ({ source }) => { source.sha = 'f'.repeat(40) },
    ({ manifest }) => { manifest.channel = 'stable' },
    ({ manifest }) => { manifest.arch = 'arm64' },
    ({ manifest }) => { manifest.commit = 'f'.repeat(40) },
    ({ release }) => { release.assets.pop() },
    ({ release }) => { release.assets[1].size++ },
    ({ release }) => { release.assets[1].digest = `sha256:${'f'.repeat(64)}` },
    ({ release }) => { release.assets[0].browser_download_url = 'https://evil.invalid/update.json' },
    ({ release }) => { release.assets[0].digest = `sha256:${'f'.repeat(64)}` },
  ]) await assert.rejects(validatePublishedAlpha(promotion, publicAlpha(promotion, change).fetcher))
  for (const code of [403, 404, 429, 503]) await assert.rejects(validatePublishedAlpha(promotion, async () => new Response('unavailable', { status: code })), /Cannot verify/)
})
