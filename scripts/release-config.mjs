import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertStableVersion } from '../electron/update-contract.mjs'
export { assertStableVersion } from '../electron/update-contract.mjs'

export const RELEASE_TARGETS = Object.freeze({
  windows: { target: 'windows-x64', prefix: 'win-v' },
  macos: { target: 'macos-arm64', prefix: 'mac-v' },
  android: { target: 'android', prefix: 'android-v' },
})

export function validateReleaseConfig(config) {
  if (!config || config.schemaVersion !== 1) throw new Error('Unsupported release config schema')
  for (const platform of Object.keys(RELEASE_TARGETS)) {
    assertStableVersion(config[platform]?.version)
  }
  const code = config.android.versionCode
  if (!Number.isSafeInteger(code) || code <= 0 || code > 2100000000) {
    throw new Error('Android versionCode must be an integer between 1 and 2100000000')
  }
  return config
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
  if (channel !== 'stable') throw new Error('Only the stable channel is supported')
  const definition = RELEASE_TARGETS[platform]
  if (target !== undefined && target !== definition.target) throw new Error(`Unsupported target: ${target} for ${platform}`)
  const { version, versionCode } = config[platform]
  const expectedTag = `${definition.prefix}${version}`
  if (tag !== undefined && tag !== expectedTag) throw new Error(`Tag mismatch: expected ${expectedTag}, received ${tag}`)
  return { platform, target: definition.target, channel, version, ...(platform === 'android' ? { versionCode } : {}), tag: expectedTag }
}

export function extractReleaseNotes(markdown, version) {
  assertStableVersion(version)
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
