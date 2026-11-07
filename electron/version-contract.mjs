// Pure strict versions shared by build, publishing and update clients.
/** @param {unknown} version @returns {string} */
export function assertStableVersion(version) {
  if (typeof version !== 'string' || version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !version.split('.').every(part => Number.isSafeInteger(Number(part)))) {
    throw new Error(`Invalid stable version: ${version}; expected major.minor.patch`)
  }
  return version
}

/** @param {string} a @param {string} b */
export function compareVersions(a, b) {
  const left = assertStableVersion(a).split('.').map(Number)
  const right = assertStableVersion(b).split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

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

