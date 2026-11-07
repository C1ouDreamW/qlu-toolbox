import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { extractReleaseNotes, hostReleasePlatform, readReleaseConfig, resolveRelease } from './release-config.mjs'
import { replacePythonVersion } from './set-python-version.mjs'
import { buildInformation } from '../electron/channel-contract.mjs'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

// Read and validate every input before writing any version carrier. Never reset a checkout.
export async function prepareRelease({ root = repositoryRoot, platform, tag, channel, target, check = false, verify = false }) {
  if (check && verify) throw new Error('--check and --verify are mutually exclusive')
  if (platform === 'host') platform = hostReleasePlatform()
  const release = resolveRelease(await readReleaseConfig(root), { platform, tag, channel, target })
  let commit = null
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch { /* Source archive / isolated fixture. */ }
  const information = buildInformation(release, commit)
  if (tag !== undefined) {
    extractReleaseNotes(await readFile(resolve(root, `changelogs/${platform}.md`), 'utf8'), release.version)
  }
  const changes = []
  async function jsonVersion(file, transform) {
    const before = await readFile(resolve(root, file), 'utf8')
    const value = JSON.parse(before)
    const original = JSON.stringify(value)
    transform(value)
    if (JSON.stringify(value) !== original) changes.push({ file, before, after: `${JSON.stringify(value, null, 2)}\n` })
  }
  const desktop = platform !== 'android'
  await jsonVersion(desktop ? 'package.json' : 'apps/mobile/package.json', value => {
    value.version = release.version
    if (desktop) {
      value.build.appId = information.applicationId
      value.build.productName = information.productName
      value.build.buildVersion = information.nativeBuildVersion
      value.build.nsis.shortcutName = information.productName
      value.build.win.executableName = information.productName
      value.build.mac.executableName = information.productName
      value.build.mac.bundleVersion = information.nativeBuildVersion
      value.build.mac.extendInfo = { ...value.build.mac.extendInfo, CFBundleShortVersionString: information.baseVersion }
      if (!value.build.files.includes('lumatile/build-info.json')) value.build.files.push('lumatile/build-info.json')
      // Stable retains old filenames for the one-time bridge; all other channels are explicit.
      const prefix = release.channel === 'stable' ? 'LumaTile' : information.productName.replace(' ', '-')
      value.build.win.artifactName = `${prefix}_v\${version}_\${arch}.\${ext}`
      value.build.nsis.artifactName = `${prefix}_v\${version}_\${arch}_Setup.\${ext}`
      value.build.mac.artifactName = `${prefix}_v\${version}_\${arch}.\${ext}`
      value.build.dmg.artifactName = `${prefix}_v\${version}_\${arch}.\${ext}`
      value.build.dmg.title = `${information.productName} \${version}`
    }
  })
  await jsonVersion('package-lock.json', value => {
    if (value.lockfileVersion !== 3 || !value.packages?.[''] || !value.packages?.['apps/mobile']) {
      throw new Error('Expected npm lockfile v3 with root and mobile workspace records')
    }
    if (desktop) {
      value.version = release.version
      value.packages[''].version = release.version
    } else {
      value.packages['apps/mobile'].version = release.version
    }
  })
  if (desktop) {
    const file = 'lumatile/__init__.py'
    const before = await readFile(resolve(root, file), 'utf8')
    const after = replacePythonVersion(before, release.version)
    if (before !== after) changes.push({ file, before, after })
  }
  const metadataFile = desktop ? 'lumatile/build-info.json' : 'apps/mobile/build-info.json'
  const before = await readFile(resolve(root, metadataFile), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
  const after = `${JSON.stringify(information, null, 2)}\n`
  if (before !== after) changes.push({ file: metadataFile, before, after })
  if (verify && changes.length) throw new Error(`Version carriers are stale for ${platform}: ${changes.map(change => change.file).join(', ')}`)
  if (!check && !verify) {
    // Detect changes made while the plan was being prepared, without overwriting them.
    for (const change of changes) {
      const current = await readFile(resolve(root, change.file), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (current !== change.before) throw new Error(`File changed during preparation: ${change.file}`)
    }
    for (const change of changes) {
      await mkdir(dirname(resolve(root, change.file)), { recursive: true })
      await writeFile(resolve(root, change.file), change.after, 'utf8')
    }
  }
  return { ...release, mode: check ? 'check' : verify ? 'verify' : 'prepare', files: changes.map(change => change.file) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    platform: { type: 'string' }, tag: { type: 'string' }, channel: { type: 'string' }, target: { type: 'string' },
    check: { type: 'boolean' }, verify: { type: 'boolean' },
  } })
  if (!values.channel) {
    values.channel = process.env.LUMATILE_BUILD_CHANNEL
    if (!values.channel && values.verify) {
      const desktop = values.platform !== 'android'
      try { values.channel = JSON.parse(await readFile(resolve(repositoryRoot, desktop ? 'lumatile/build-info.json' : 'apps/mobile/build-info.json'), 'utf8')).channel } catch { /* Require preparation below. */ }
    }
    values.channel ||= 'debug'
  }
  console.log(JSON.stringify(await prepareRelease(values), null, 2))
}
