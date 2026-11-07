import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { validateBuildInformation } from '../electron/channel-contract.mjs'
import { artifactFileNames, isPublicationDate, UPDATE_ORIGIN } from '../electron/update-contract.mjs'
import { generateDesktopManifest } from './generate-desktop-update-manifest.mjs'
import { readBuildInventory, copyBuildInventory } from './inventory-artifacts.mjs'
import { sha256, targetFor } from './release-artifacts.mjs'

export function assertBridgeTarget(identity, verification, platform, first) {
  const info = validateBuildInformation(identity.information)
  if (identity.platform !== platform || identity.purpose !== 'bridge' || identity.deployable !== true || identity.channel !== 'stable' || identity.tag !== `v${identity.version}` || identity.bridgeVersion !== identity.version ||
      !/^[a-f0-9]{40}$/.test(identity.commit) || identity.commit !== first.commit || identity.version !== first.version || !isPublicationDate(identity.publishedAt) || !identity.notes?.trim() ||
      !identity.promotion || identity.promotion.stableCommit !== identity.commit || identity.promotion.platform !== platform || identity.promotion.stableVersion !== identity.version) throw new Error('Bridge identity or promotion review mismatch')
  for (const key of ['platform', 'target', 'version', 'channel', 'commit']) if (identity[key] !== info[key] || identity[key] !== verification[key]) throw new Error('Bridge build identity mismatch')
  const checks = verification.checks
  if (verification.purpose !== 'bridge' || verification.deployable !== true || verification.verified !== true || !checks || checks.applicationId !== info.applicationId || checks.channel !== 'stable' || checks.electronVersion !== info.version || checks.pythonVersion !== info.version || checks.nativeBuildVersion !== info.nativeBuildVersion) throw new Error('Bridge requires verified Stable native packages for both desktops')
  return info
}

export async function createDesktopBridgeBundle({ identities, artifacts, verifications, output }) {
  const platforms = ['windows', 'macos']
  for (const values of [identities, artifacts, verifications]) if (!values || !isDeepStrictEqual(Object.keys(values).sort(), [...platforms].sort())) throw new Error('Bridge requires exactly Windows and macOS inputs')
  const first = identities.windows, validated = {}
  for (const platform of platforms) {
    const identity = identities[platform], verification = verifications[platform]
    const info = assertBridgeTarget(identity, verification, platform, first)
    const names = artifactFileNames(targetFor(platform), identity.version, true)
    const entries = []
    for (const file of Object.values(names)) {
      const path = join(artifacts[platform], file), statResult = await stat(path)
      if (!statResult.isFile() || statResult.size <= 0) throw new Error('Missing bridge installation artifact')
      const bytes = await readFile(path)
      entries.push({ file, sha256: sha256(bytes), size: bytes.length })
    }
    const inventory = await readBuildInventory(artifacts[platform], info)
    const manifest = await generateDesktopManifest({ ...identity, artifacts: artifacts[platform] })
    validated[platform] = { identity, verification, entries, inventory, manifest }
  }
  // No deployable output is created until both complete target sets have passed validation.
  if ((await readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error })).length) throw new Error('Bridge bundle output must be empty')
  const releaseDir = join(output, 'releases', first.tag), stableDir = join(output, 'stable')
  await mkdir(releaseDir, { recursive: true }); await mkdir(stableDir)
  const records = {}
  for (const platform of platforms) {
    const item = validated[platform], target = item.identity.target
    for (const entry of item.entries) await copyFile(join(artifacts[platform], entry.file), join(releaseDir, entry.file), constants.COPYFILE_EXCL)
    await copyBuildInventory(artifacts[platform], releaseDir, `${target}-`)
    const inventory = await readBuildInventory(releaseDir, item.identity.information, item.inventory.provenanceSha256, `${target}-`)
    const manifest = JSON.stringify(item.manifest, null, 2) + '\n'
    await writeFile(join(releaseDir, `update-${target}.json`), manifest, { flag: 'wx' })
    await writeFile(join(stableDir, `${target}.json`), manifest, { flag: 'wx' })
    records[platform] = { identity: item.identity, verification: item.verification, artifacts: item.entries, inventory: { provenanceSha256: inventory.provenanceSha256, entries: inventory.entries } }
  }
  const legacy = { schemaVersion: 1, version: first.version, name: `一格有光 v${first.version}`,
    notes: `Windows\n${first.notes}\n\nmacOS\n${identities.macos.notes}`, publishedAt: first.publishedAt,
    downloads: { win32: validated.windows.manifest.artifacts.installer.url, darwin: validated.macos.manifest.artifacts.dmg.url } }
  // Legacy readers still consume the stable paths generated by the same final bytes.
  if (!Object.values(legacy.downloads).every(url => url.startsWith(`${UPDATE_ORIGIN}/releases/${first.tag}/`))) throw new Error('Invalid legacy bridge download path')
  const record = { schemaVersion: 1, purpose: 'bridge', channel: 'stable', version: first.version, tag: first.tag, commit: first.commit, targets: records }
  for (const directory of [releaseDir, stableDir]) await writeFile(join(directory, 'desktop.json'), JSON.stringify(legacy, null, 2) + '\n', { flag: 'wx' })
  await writeFile(join(releaseDir, 'bridge-record.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  await writeFile(join(releaseDir, 'release-notes.md'), legacy.notes + '\n', { flag: 'wx' })
  const sums = []
  for (const file of (await readdir(releaseDir)).sort()) sums.push(`${sha256(await readFile(join(releaseDir, file)))}  ${file}`)
  await writeFile(join(releaseDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n', { flag: 'wx' })
  return { releaseDir, legacy, record, manifests: Object.fromEntries(platforms.map(platform => [platform, validated[platform].manifest])) }
}
