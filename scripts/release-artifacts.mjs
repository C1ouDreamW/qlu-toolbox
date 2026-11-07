import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactFileNames, compareVersions, desktopTarget, UPDATE_ORIGIN, validateDesktopManifest, validateMigrationPolicy } from '../electron/update-contract.mjs'
import { extractReleaseNotes, parseReleaseTag, resolveRelease, validateReleaseConfig } from './release-config.mjs'
import { generateDesktopManifest } from './generate-desktop-update-manifest.mjs'
import { androidArtifactName, validateAndroidManifest } from '../electron/android-update-contract.mjs'
export { validateAndroidManifest } from '../electron/android-update-contract.mjs'
import { assertChannelVersion, compareChannelVersions, channelIdentity, buildInformation } from '../electron/channel-contract.mjs'

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function assertWindowsX64(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Expected a Windows x64 executable')
  const offset = bytes.readUInt32LE(0x3c)
  if (offset > bytes.length - 6 || bytes.readUInt32LE(offset) !== 0x00004550 || bytes.readUInt16LE(offset + 4) !== 0x8664) throw new Error('Expected a Windows x64 executable')
}

// PE ProductVersion may include the builder's fourth numeric build component.
export function assertWindowsProductVersion(actual, expected) {
  compareVersions(expected, expected)
  if (typeof actual !== 'string') throw new Error('Windows executable version mismatch')
  const parts = actual.split('.')
  if ((parts.length !== 3 && parts.length !== 4) || parts.slice(0, 3).join('.') !== expected ||
      (parts.length === 4 && (!/^(0|[1-9]\d*)$/.test(parts[3]) || Number(parts[3]) > 65535))) throw new Error('Windows executable version mismatch')
}

export function taggedRelease(root, platform, tag, requireEnabled = true) {
  const { channel } = parseReleaseTag(platform, tag)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
  if (git(['rev-parse', 'HEAD']) !== commit) throw new Error('Release tag must match HEAD')
  const config = validateReleaseConfig(JSON.parse(git(['show', `${commit}:config/release-versions.json`])))
  const policy = JSON.parse(git(['show', `${commit}:config/release-migration.json`]))
  const { bridgeVersion } = validateMigrationPolicy(policy)
  if (requireEnabled && channel === 'alpha' && policy.alphaPublishingEnabled !== true) throw new Error('Alpha publishing is disabled until its channel is configured')
  if (requireEnabled && channel === 'stable' && (policy.independentPublishingEnabled !== true || bridgeVersion === null)) {
    throw new Error('Independent publishing is disabled until the desktop bridge upgrade chains are verified')
  }
  const androidSigningSha256 = channel === 'alpha' ? policy.androidAlphaSigningSha256 : policy.androidSigningSha256
  if (platform === 'android' && requireEnabled && (!/^[a-f0-9]{64}$/.test(androidSigningSha256) || (channel === 'alpha' && androidSigningSha256 === policy.androidSigningSha256))) throw new Error('Missing or invalid independent Android signing certificate digest')
  const release = resolveRelease(config, { platform, tag, channel })
  if (channel === 'stable' && platform !== 'android' && bridgeVersion !== null && compareVersions(release.version, bridgeVersion) <= 0) throw new Error('Independent desktop version must exceed the bridge')
  const notes = extractReleaseNotes(git(['show', `${commit}:changelogs/${platform}.md`]), release.version)
  return { ...release, commit, information: buildInformation(release, commit), bridgeVersion, androidSigningSha256,
    publishedAt: new Date(git(['show', '-s', '--format=%cI', commit])).toISOString(), notes }
}

export function targetFor(platform) {
  if (platform === 'windows') return desktopTarget('win32', 'x64')
  if (platform === 'macos') return desktopTarget('darwin', 'arm64')
  throw new Error(`Unknown desktop platform: ${platform}`)
}

export function manifestTarget(platform) {
  return platform === 'android' ? 'android' : targetFor(platform).id
}

export function validatePlatformManifest(platform, value, bridgeVersion = null, channel = 'stable') {
  return platform === 'android' ? validateAndroidManifest(value, channel) : validateDesktopManifest(value, targetFor(platform), bridgeVersion, channel)
}

// Equal versions are only valid retries of the exact same installation artifacts.
export function assertPromotion(platform, current, next) {
  const a = platform === 'android' ? current.versionName : current.version
  const b = platform === 'android' ? next.versionName : next.version
  const channel = current.channel
  if (!['stable', 'alpha'].includes(channel) || next.channel !== channel || (platform === 'android' && current.applicationId !== next.applicationId)) throw new Error('Cannot promote across release channels or application IDs')
  if (compareChannelVersions(b, a, channel) < 0) throw new Error('Refusing version rollback')
  if (platform === 'android') {
    if (next.versionCode < current.versionCode) throw new Error('Refusing Android versionCode rollback')
    if (next.versionCode === current.versionCode && (a !== b || current.sha256 !== next.sha256 || current.size !== next.size)) throw new Error('Android versionCode already identifies a different APK')
    if (a === b && (next.versionCode !== current.versionCode || current.sha256 !== next.sha256 || current.size !== next.size)) throw new Error('Published Android version cannot be replaced')
  } else if (a === b && (current.tag !== next.tag || current.commit !== next.commit || artifactIdentity(current.artifacts) !== artifactIdentity(next.artifacts))) {
    throw new Error('Published desktop version cannot be replaced')
  }
}

function artifactIdentity(artifacts) {
  return JSON.stringify(Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b)).map(([role, value]) => [role, value.url, value.fallbackUrl, value.sha256, value.size]))
}

export async function createReleaseBundle({ identity, artifacts, verification, output }) {
  if (identity.purpose === 'rehearsal' || identity.deployable === false || verification.purpose === 'rehearsal' || verification.deployable === false) throw new Error('Rehearsal artifacts cannot generate a release bundle')
  const { platform, version, tag, commit, bridgeVersion } = identity
  const channel = identity.channel ?? 'stable'
  assertChannelVersion(version, channel)
  if (!['stable', 'alpha'].includes(channel) || (verification.channel ?? 'stable') !== channel) throw new Error('Build verification channel mismatch')
  if (verification.platform !== platform || verification.version !== version || verification.commit !== commit || verification.target !== identity.target || verification.verified !== true) throw new Error('Build verification does not match release identity')
  const names = platform === 'android' ? { apk: androidArtifactName(version, channel) } : artifactFileNames(targetFor(platform), version, false, channel)
  const releaseDir = join(output, 'releases', tag)
  const channelDir = join(output, channel)
  // Validate the complete input set before creating a deployable output.
  for (const name of Object.values(names)) {
    const info = await stat(join(artifacts, name))
    if (!info.isFile() || info.size <= 0) throw new Error(`Missing build artifact: ${name}`)
  }
  if (platform === 'android') {
    const bytes = await readFile(join(artifacts, names.apk))
    const checks = verification.checks
    if (!checks || checks.applicationId !== channelIdentity(channel, 'android').applicationId || checks.debuggable !== false ||
        checks.nativeVersionCode !== identity.versionCode || !/^[a-f0-9]{64}$/.test(identity.androidSigningSha256) ||
        checks.signingSha256 !== identity.androidSigningSha256 || checks.signedSha256 !== sha256(bytes) || checks.signedSize !== bytes.length) {
      throw new Error('Signed APK differs from the verified release identity or final bytes')
    }
  }
  if ((await readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error })).length) throw new Error('Bundle output must be empty')
  await mkdir(releaseDir, { recursive: true })
  let manifest
  if (platform === 'android') {
    const bytes = await readFile(join(artifacts, names.apk))
    manifest = validateAndroidManifest({ schemaVersion: 1, applicationId: channelIdentity(channel, 'android').applicationId, versionName: version, versionCode: identity.versionCode,
      channel, tag, commit, title: '一格有光版本更新', notes: identity.notes, publishedAt: identity.publishedAt,
      apkUrl: `https://github.com/C1ouDreamW/qlu-toolbox/releases/download/${tag}/${names.apk}`, sha256: sha256(bytes), size: bytes.length, mandatory: false }, channel)
  } else {
    manifest = await generateDesktopManifest({ ...identity, channel, artifacts, notes: identity.notes })
  }
  for (const name of Object.values(names)) await copyFile(join(artifacts, name), join(releaseDir, name))
  const manifestName = `update-${manifestTarget(platform)}.json`
  await writeFile(join(releaseDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`)
  const record = { schemaVersion: 1, platform, version, tag, commit, target: identity.target, channel, verification }
  await writeFile(join(releaseDir, 'release-record.json'), `${JSON.stringify(record, null, 2)}\n`)
  await writeFile(join(releaseDir, 'release-notes.md'), `${identity.notes}\n`)
  const sums = []
  for (const name of (await readdir(releaseDir)).sort()) sums.push(`${sha256(await readFile(join(releaseDir, name)))}  ${name}`)
  await writeFile(join(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
  await mkdir(channelDir, { recursive: true })
  const stable = platform === 'android' ? { ...manifest, apkUrl: `${UPDATE_ORIGIN}/releases/${tag}/${names.apk}` } : manifest
  await writeFile(join(channelDir, `${manifestTarget(platform)}.json`), `${JSON.stringify(stable, null, 2)}\n`)
  return { releaseDir, manifest, stable, record }
}

export async function verifyReleaseFiles(directory) {
  const lines = (await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')
  const names = new Set()
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line)
    if (!match || names.has(match[2])) throw new Error('Invalid or duplicate checksum entry')
    if (sha256(await readFile(join(directory, match[2]))) !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`)
    names.add(match[2])
  }
  const actual = (await readdir(directory)).filter(name => name !== 'SHA256SUMS.txt')
  if (actual.length !== names.size || !actual.every(name => names.has(name))) throw new Error('Release asset set does not match checksums')
  return [...names, 'SHA256SUMS.txt']
}
