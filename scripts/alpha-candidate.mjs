import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveRelease, validateReleaseConfig } from './release-config.mjs'
import { buildInformation, validateBuildInformation } from '../electron/channel-contract.mjs'
import { validateMigrationPolicy } from '../electron/update-contract.mjs'
import { assertCandidateSource, releaseRunContext } from './release-source.mjs'
import { sha256 } from './release-artifacts.mjs'

export function alphaCandidateIdentity(root, platform, context = releaseRunContext(), expectedCommit) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = git(['rev-parse', 'HEAD'])
  // Check provenance before reading configuration or accepting signing identity.
  const origin = { channel: 'alpha', purpose: 'candidate', deployable: false, tag: null, commit }
  assertCandidateSource(root, origin, context, expectedCommit ?? commit)
  const config = validateReleaseConfig(JSON.parse(git(['show', `${commit}:config/release-versions.json`])))
  const policy = JSON.parse(git(['show', `${commit}:config/release-migration.json`]))
  const { bridgeVersion } = validateMigrationPolicy(policy)
  const release = resolveRelease(config, { platform, channel: 'alpha' })
  if (platform === 'android' && (!/^[a-f0-9]{64}$/.test(policy.androidAlphaSigningSha256) || policy.androidAlphaSigningSha256 === policy.androidSigningSha256)) throw new Error('Candidate requires an independent registered Alpha certificate')
  return { ...release, ...origin, releaseTag: release.tag, bridgeVersion,
    information: buildInformation(release, commit), androidSigningSha256: policy.androidAlphaSigningSha256,
    repository: context.repository, runId: context.runId, runAttempt: context.runAttempt }
}

export function candidateArtifactNames(identity) {
  if (identity.purpose !== 'candidate' || identity.channel !== 'alpha' || identity.deployable !== false || !/^[a-f0-9]{40}$/.test(identity.commit)) throw new Error('Expected an Alpha candidate identity')
  const info = validateBuildInformation(identity.information)
  for (const key of ['platform', 'target', 'channel', 'version', 'commit']) if (info[key] !== identity[key]) throw new Error('Candidate build identity mismatch')
  const prefix = `LumaTile-Alpha-Candidate-${identity.target}-v${identity.version}-${identity.commit.slice(0, 12)}`
  return identity.platform === 'windows' ? [`${prefix}-Setup.exe`, `${prefix}.zip`] : [`${prefix}${identity.platform === 'android' ? '.apk' : '.dmg'}`]
}

export async function recordCandidate({ identity, verification, artifacts, output }) {
  if (identity.purpose !== 'candidate' || identity.deployable !== false || verification.purpose !== 'candidate' || verification.deployable !== false || verification.verified !== true) throw new Error('Expected a non-deployable candidate verification')
  for (const key of ['platform', 'channel', 'version', 'target', 'commit']) if (identity[key] !== verification[key]) throw new Error(`Candidate verification mismatch: ${key}`)
  const names = candidateArtifactNames(identity)
  const files = (await readdir(artifacts)).sort()
  if (JSON.stringify([...names].sort()) !== JSON.stringify(files)) throw new Error('Candidate artifact set does not match its identity')
  const entries = []
  for (const name of files) {
    if (!(await stat(join(artifacts, name))).isFile()) throw new Error('Expected a candidate installation file')
    const bytes = await readFile(join(artifacts, name))
    if (!bytes.length) throw new Error('Empty candidate installation file')
    entries.push({ file: name, sha256: sha256(bytes), size: bytes.length })
  }
  if (identity.platform === 'android') {
    const item = entries[0], checks = verification.checks
    if (!/^[a-f0-9]{64}$/.test(identity.androidSigningSha256) || !checks || checks.applicationId !== identity.information.applicationId || checks.debuggable !== false ||
        checks.nativeVersionCode !== identity.versionCode || checks.signingSha256 !== identity.androidSigningSha256 ||
        checks.signedSha256 !== item.sha256 || checks.signedSize !== item.size || checks.runId !== identity.runId || checks.runAttempt !== identity.runAttempt) throw new Error('Candidate APK differs from its signed verification')
  }
  if (identity.platform !== 'android') {
    const checks = verification.checks
    if (!checks || checks.channel !== 'alpha' || checks.applicationId !== identity.information.applicationId || checks.electronVersion !== identity.version || checks.pythonVersion !== identity.version) throw new Error('Candidate desktop identity differs from verification')
  }
  if ((await readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error })).length) throw new Error('Candidate output must be empty')
  await mkdir(output, { recursive: true })
  for (const name of files) await copyFile(join(artifacts, name), join(output, name), constants.COPYFILE_EXCL)
  const record = { schemaVersion: 1, ...identity, verification, artifacts: entries }
  await writeFile(join(output, 'candidate-record.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
  const sums = entries.map(item => `${item.sha256}  ${item.file}`)
  sums.push(`${sha256(await readFile(join(output, 'candidate-record.json')))}  candidate-record.json`)
  await writeFile(join(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, { flag: 'wx' })
  return record
}
