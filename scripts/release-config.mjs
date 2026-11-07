import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertChannelVersion } from '../electron/channel-contract.mjs'
export { assertStableVersion } from '../electron/update-contract.mjs'

export const RELEASE_TARGETS = Object.freeze({
  windows: { target: 'windows-x64', prefix: 'win-v' },
  macos: { target: 'macos-arm64', prefix: 'mac-v' },
  android: { target: 'android', prefix: 'android-v' },
})

export function validateReleaseConfig(config) {
  if (!config || ![1, 2].includes(config.schemaVersion)) throw new Error('Unsupported release config schema')
  for (const platform of Object.keys(RELEASE_TARGETS)) {
    for (const channel of config.schemaVersion === 1 ? ['stable'] : ['stable', 'alpha']) {
      const entry = config.schemaVersion === 1 ? config[platform] : config[platform]?.[channel]
      assertChannelVersion(entry?.version, channel)
      if (platform === 'android') {
        if (!Number.isSafeInteger(entry.versionCode) || entry.versionCode <= 0 || entry.versionCode > 2100000000) throw new Error('Android versionCode must be an integer between 1 and 2100000000')
      } else if (config.schemaVersion === 2) {
        if (!Number.isSafeInteger(entry.buildNumber) || entry.buildNumber < 1 || entry.buildNumber > (platform === 'windows' ? 65535 : 9999)) throw new Error('Invalid native buildNumber')
        if (platform === 'windows' && entry.version.split('-')[0].split('.').some(part => Number(part) > 65535)) throw new Error('Windows native version component exceeds 65535')
      }
    }
  }
  return config
}

export function releaseVersion(config, platform, channel = 'stable') {
  validateReleaseConfig(config)
  if (!Object.hasOwn(RELEASE_TARGETS, platform) || !['stable', 'alpha', 'debug'].includes(channel)) throw new Error('Unknown platform or channel')
  const sourceChannel = channel === 'debug' ? (config.schemaVersion === 2 ? 'alpha' : 'stable') : channel
  const entry = config.schemaVersion === 1 ? (sourceChannel === 'stable' ? config[platform] : null) : config[platform][sourceChannel]
  if (!entry) throw new Error('This version config has no Alpha channel')
  return channel === 'debug' ? { ...entry, version: `${entry.version.split('-')[0]}-debug.0` } : entry
}

export async function readReleaseConfig(root) {
  return validateReleaseConfig(JSON.parse(await readFile(resolve(root, 'config/release-versions.json'), 'utf8')))
}

export function hostReleasePlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'windows'
  if (platform === 'darwin' && arch === 'arm64') return 'macos'
  throw new Error(`Unsupported desktop host: ${platform}/${arch}; use native Windows x64 or macOS arm64 (no Rosetta)`)
}

export function resolveRelease(config, { platform, tag, channel = 'stable', target } = {}) {
  validateReleaseConfig(config)
  if (!Object.hasOwn(RELEASE_TARGETS, platform)) throw new Error(`Unknown release platform: ${platform}`)
  if (!['stable', 'alpha', 'debug'].includes(channel)) throw new Error('Unsupported release channel')
  const definition = RELEASE_TARGETS[platform]
  if (target !== undefined && target !== definition.target) throw new Error(`Unsupported target: ${target} for ${platform}`)
  const { version, versionCode, buildNumber } = releaseVersion(config, platform, channel)
  const prefix = channel === 'alpha' ? definition.prefix.replace('-v', '-alpha-v') : definition.prefix
  const expectedTag = channel === 'debug' ? undefined : `${prefix}${version}`
  if (channel === 'debug' && tag !== undefined) throw new Error('Debug builds cannot have release tags')
  if (tag !== undefined && tag !== expectedTag) throw new Error(`Tag mismatch: expected ${expectedTag}, received ${tag}`)
  return { platform, target: definition.target, channel, version, ...(platform === 'android' ? { versionCode } : {}),
    ...(buildNumber === undefined ? {} : { buildNumber }), tag: expectedTag }
}

export function parseReleaseTag(platform, tag) {
  const definition = RELEASE_TARGETS[platform]
  if (!definition || typeof tag !== 'string') throw new Error('Invalid independent release tag')
  for (const channel of ['stable', 'alpha']) {
    const prefix = channel === 'alpha' ? definition.prefix.replace('-v', '-alpha-v') : definition.prefix
    if (!tag.startsWith(prefix)) continue
    return { channel, version: assertChannelVersion(tag.slice(prefix.length), channel) }
  }
  throw new Error('Invalid independent release tag for this platform')
}

export function extractReleaseNotes(markdown, version) {
  assertChannelVersion(version, typeof version === 'string' && version.includes('-alpha.') ? 'alpha' : 'stable')
  const sections = [...markdown.matchAll(/^## \[([^\]\r\n]+)\][^\r\n]*$/gm)]
  const matches = sections.filter(section => section[1] === version)
  if (matches.length !== 1) throw new Error(`Expected one changelog section for ${version}`)
  const section = matches[0]
  const end = sections.find(next => next.index > section.index)?.index ?? markdown.length
  const notes = markdown.slice(section.index + section[0].length, end).trim()
  if (!notes || !notes.replace(/^\s*#{1,6}[^\n]*(?:\n|$)/gm, '').trim()) {
    throw new Error(`Empty release notes for ${version}`)
  }
  return notes
}
