import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { artifactFileNames } from '../electron/update-contract.mjs'
import { INVENTORY_FILES } from './build-inventory.mjs'
import { assertBridgeTarget } from './desktop-bridge-bundle.mjs'
import { generateDesktopManifest } from './generate-desktop-update-manifest.mjs'
import { readBuildInventory } from './inventory-artifacts.mjs'
import { sha256, targetFor, verifyReleaseFiles } from './release-artifacts.mjs'
import { taggedDesktopBridge } from './desktop-bridge.mjs'
import { releaseRunContext } from './release-source.mjs'

// Runs without npm/Python tooling on the fresh bridge publisher and deployer.
export async function verifyDesktopBridgeBundle({ identities, directory, context }) {
  const platforms = ['windows', 'macos']
  if (!identities || !isDeepStrictEqual(Object.keys(identities).sort(), [...platforms].sort())) throw new Error('Expected both immutable desktop bridge identities')
  const names = await verifyReleaseFiles(directory)
  const first = identities.windows
  const record = JSON.parse(await readFile(join(directory, 'bridge-record.json'), 'utf8'))
  if (record.schemaVersion !== 1 || record.purpose !== 'bridge' || record.channel !== 'stable' ||
      record.version !== first.version || record.tag !== first.tag || record.commit !== first.commit ||
      !record.targets || !isDeepStrictEqual(Object.keys(record.targets).sort(), [...platforms].sort())) throw new Error('Bridge record differs from the immutable source')
  const expectedNames = ['bridge-record.json', 'desktop.json', 'release-notes.md', 'SHA256SUMS.txt'], manifests = {}
  for (const platform of platforms) {
    const identity = identities[platform], item = record.targets[platform]
    if (!isDeepStrictEqual(item.identity, identity)) throw new Error('Bridge target or promotion evidence differs from the immutable source')
    const info = assertBridgeTarget(identity, item.verification, platform, first)
    const files = Object.values(artifactFileNames(targetFor(platform), identity.version, true))
    expectedNames.push(...files, `update-${info.target}.json`, ...INVENTORY_FILES.map(file => `${info.target}-${file}`))
    const entries = []
    for (const file of files) {
      const bytes = await readFile(join(directory, file))
      if (!bytes.length) throw new Error('Empty bridge installation artifact')
      entries.push({ file, sha256: sha256(bytes), size: bytes.length })
    }
    if (!isDeepStrictEqual(item.artifacts, entries)) throw new Error('Bridge installation bytes differ from their verified record')
    if (!/^[a-f0-9]{64}$/.test(item.inventory?.provenanceSha256)) throw new Error('Missing bridge inventory digest')
    const inventory = await readBuildInventory(directory, info, item.inventory.provenanceSha256, `${info.target}-`)
    if (!isDeepStrictEqual(item.inventory.entries, inventory.entries)) throw new Error('Bridge inventory differs from the verified record')
    if (context) for (const key of ['repository', 'runId', 'runAttempt']) if (inventory.provenance.builder?.[key] !== context[key]) throw new Error('Bridge inventory differs from this workflow run and attempt')
    const expected = await generateDesktopManifest({ ...identity, artifacts: directory })
    const actual = JSON.parse(await readFile(join(directory, `update-${info.target}.json`), 'utf8'))
    if (!isDeepStrictEqual(actual, expected)) throw new Error('Bridge update manifest differs from verified source and installation bytes')
    manifests[platform] = actual
  }
  if (!isDeepStrictEqual([...names].sort(), expectedNames.sort())) throw new Error('Bridge asset set must contain exactly both desktop targets and their evidence')
  const notes = `Windows\n${first.notes}\n\nmacOS\n${identities.macos.notes}`
  const legacy = { schemaVersion: 1, version: first.version, name: `一格有光 v${first.version}`, notes, publishedAt: first.publishedAt,
    downloads: { win32: manifests.windows.artifacts.installer.url, darwin: manifests.macos.artifacts.dmg.url } }
  if (!isDeepStrictEqual(JSON.parse(await readFile(join(directory, 'desktop.json'), 'utf8')), legacy) || await readFile(join(directory, 'release-notes.md'), 'utf8') !== notes + '\n') throw new Error('Legacy bridge pointer or release notes differ from the verified desktop targets')
  return { names, record, manifests, legacy }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, directory] = process.argv.slice(2)
  if (!directory) throw new Error('Usage: verify-desktop-bridge-bundle.mjs <vB> <release-assets-directory>')
  const context = releaseRunContext()
  const identities = taggedDesktopBridge(fileURLToPath(new URL('../', import.meta.url)), tag, context, process.env.RELEASE_EXPECTED_COMMIT)
  const checked = await verifyDesktopBridgeBundle({ identities, directory: resolve(directory), context })
  console.log(JSON.stringify({ tag, commit: checked.record.commit, verified: true, files: checked.names.length }))
}
