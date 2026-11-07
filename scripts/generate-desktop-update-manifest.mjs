import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { artifactFileNames, assertStableVersion, desktopTagVersion, desktopTarget, GITHUB_REPOSITORY, UPDATE_ORIGIN, validateDesktopManifest, validateMigrationPolicy } from '../electron/update-contract.mjs'
import { parseReleaseTag, releaseVersion, validateReleaseConfig } from './release-config.mjs'

/** Pure generation entry for verified build artifacts; the CLI resolves identity from Git. */
export async function generateDesktopManifest({ platform, version, tag, commit, artifacts, notes, channel = 'stable', bridgeVersion = null, publishedAt = new Date().toISOString() }) {
  const target = platform === 'windows' ? desktopTarget('win32', 'x64') : platform === 'macos' ? desktopTarget('darwin', 'arm64') : null
  if (!target || desktopTagVersion(tag, target, bridgeVersion, channel) !== version) throw new Error('Desktop release target, tag and version do not match')
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected a full commit SHA')
  const files = await readdir(artifacts)
  const names = artifactFileNames(target, version, tag === `v${bridgeVersion}`, channel)
  const entries = {}
  for (const [role, file] of Object.entries(names)) {
    if (!files.includes(file)) {
      if (role === target.primary) throw new Error(`Missing artifact: ${file}`)
      continue
    }
    const bytes = await readFile(resolve(artifacts, file))
    entries[role] = {
      url: `${UPDATE_ORIGIN}/releases/${tag}/${file}`,
      fallbackUrl: `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tag}/${file}`,
      sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    }
  }
  return validateDesktopManifest({
    schemaVersion: 2, platform, arch: target.arch, channel, version, tag, commit,
    name: `LumaTile for ${platform === 'windows' ? 'Windows' : 'macOS'} ${version}`,
    notes: notes.trim(), publishedAt, artifacts: entries,
  }, target, bridgeVersion, channel)
}

export function taggedDesktopIdentity(root, tag, platform) {
  const channel = typeof tag === 'string' && tag.startsWith('v') ? (assertStableVersion(tag.slice(1)), 'stable') : parseReleaseTag(platform, tag).channel
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
  if (git(['rev-parse', 'HEAD']) !== commit) throw new Error('Release tag must point to the checked-out commit')
  const versions = validateReleaseConfig(JSON.parse(git(['show', `${commit}:config/release-versions.json`])))
  const policy = validateMigrationPolicy(JSON.parse(git(['show', `${commit}:config/release-migration.json`])))
  if (!Object.hasOwn(versions, platform) || platform === 'android') throw new Error('Expected windows or macos')
  return { channel, version: releaseVersion(versions, platform, channel).version, commit, bridgeVersion: policy.bridgeVersion,
    publishedAt: new Date(git(['show', '-s', '--format=%cI', commit])).toISOString() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    platform: { type: 'string' }, artifacts: { type: 'string' }, output: { type: 'string' }, tag: { type: 'string' }, notes: { type: 'string' },
  } })
  if (!values.platform || !values.artifacts || !values.output || !values.tag || !values.notes) {
    throw new Error('Usage: node scripts/generate-desktop-update-manifest.mjs --platform <windows|macos> --artifacts <dir> --output <file> --tag <tag> --notes <file>')
  }
  const root = fileURLToPath(new URL('../', import.meta.url))
  const identity = taggedDesktopIdentity(root, values.tag, values.platform)
  const manifest = await generateDesktopManifest({ ...values, ...identity, notes: await readFile(resolve(values.notes), 'utf8') })
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  await writeFile(resolve(values.output), `${JSON.stringify(manifest, null, 2)}\n`)
}
