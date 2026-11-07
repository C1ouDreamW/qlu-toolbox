import { assertStableVersion, compareVersions } from './update-contract.mjs'

export const CHANNELS = Object.freeze(['stable', 'alpha', 'debug'])

export function versionChannel(version) {
  if (typeof version !== 'string') throw new Error('Invalid channel version')
  if (/^\d+\.\d+\.\d+-alpha\.[1-9]\d*$/.test(version)) return 'alpha'
  if (/^\d+\.\d+\.\d+-debug\.(?:0|[1-9]\d*)$/.test(version)) return 'debug'
  assertStableVersion(version)
  return 'stable'
}

export function assertChannelVersion(version, channel) {
  if (!CHANNELS.includes(channel) || versionChannel(version) !== channel) throw new Error('Version does not match the build channel')
  const [base, suffix] = version.split('-')
  assertStableVersion(base)
  if (suffix && !Number.isSafeInteger(Number(suffix.split('.')[1]))) throw new Error('Channel sequence exceeds the safe integer range')
  return version
}

export function compareChannelVersions(a, b, channel) {
  assertChannelVersion(a, channel)
  assertChannelVersion(b, channel)
  const result = compareVersions(a.split('-')[0], b.split('-')[0])
  if (result || channel === 'stable') return result
  const left = Number(a.split('-')[1].split('.')[1])
  const right = Number(b.split('-')[1].split('.')[1])
  return left === right ? 0 : left > right ? 1 : -1
}

export function channelIdentity(channel, platform) {
  if (!CHANNELS.includes(channel) || !['windows', 'macos', 'android'].includes(platform)) throw new Error('Unknown build identity')
  const suffix = channel === 'stable' ? '' : `.${channel}`
  return {
    applicationId: platform === 'android' ? `io.github.c1oudreamw.lumatile${suffix}` : `student.qlu.toolbox${suffix}`,
    productName: channel === 'stable' ? 'LumaTile' : `LumaTile ${channel === 'alpha' ? 'Alpha' : 'Debug'}`,
    dataNamespace: channel === 'stable' ? 'QLUToolbox' : `LumaTile-${channel === 'alpha' ? 'Alpha' : 'Debug'}`,
    updatesEnabled: channel !== 'debug', telemetryEnabled: channel === 'stable',
  }
}

export function buildInformation(release, commit = null) {
  const { platform, target, channel, version } = release
  assertChannelVersion(version, channel)
  const expectedTarget = { windows: 'windows-x64', macos: 'macos-arm64', android: 'android' }[platform]
  if (!expectedTarget || target !== expectedTarget || (commit !== null && !/^[a-f0-9]{40}$/.test(commit))) throw new Error('Invalid build target or source commit')
  const baseVersion = version.split('-')[0]
  const identity = channelIdentity(channel, platform)
  if (platform === 'android') {
    if (!Number.isSafeInteger(release.versionCode) || release.versionCode < 1 || release.versionCode > 2100000000) throw new Error('Invalid Android build code')
    return { schemaVersion: 1, platform, target, channel, version, baseVersion, versionCode: release.versionCode, ...identity, commit }
  }
  const buildNumber = release.buildNumber ?? 1
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1 || buildNumber > (platform === 'windows' ? 65535 : 9999)) throw new Error('Invalid native build counter')
  return { schemaVersion: 1, platform, target, channel, version, baseVersion, buildNumber,
    nativeBuildVersion: platform === 'windows' ? `${baseVersion}.${buildNumber}` : String(buildNumber), ...identity, commit }
}

export function validateBuildInformation(value) {
  if (!value || value.schemaVersion !== 1) throw new Error('Missing or unsupported build information')
  const expected = buildInformation(value, value.commit)
  for (const [key, item] of Object.entries(expected)) if (value[key] !== item) throw new Error(`Build information mismatch: ${key}`)
  return expected
}
