import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveRelease, validateReleaseConfig } from './release-config.mjs'
import { sha256, repositoryRoot } from './release-artifacts.mjs'
import { validateMigrationPolicy } from '../electron/update-contract.mjs'
import { buildInformation } from '../electron/channel-contract.mjs'
import { readBuildInventory, copyBuildInventory } from './inventory-artifacts.mjs'
import { INVENTORY_FILES } from './build-inventory.mjs'

// A rehearsal uses immutable HEAD metadata without creating a tag or enabling rollout.
export function rehearsalIdentity(root, platform) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const commit = git(['rev-parse', 'HEAD'])
  const config = validateReleaseConfig(JSON.parse(git(['show', `${commit}:config/release-versions.json`])))
  const policy = JSON.parse(git(['show', `${commit}:config/release-migration.json`]))
  const { bridgeVersion } = validateMigrationPolicy(policy)
  if (platform === 'android' && !/^[a-f0-9]{64}$/.test(policy.androidSigningSha256)) throw new Error('The production certificate digest is required to reject production-signed rehearsals')
  const { tag: _tag, ...release } = resolveRelease(config, { platform, channel: 'debug' })
  const information = buildInformation(release, commit)
  return { ...release, commit, bridgeVersion, androidSigningSha256: policy.androidSigningSha256,
    information,
    ...(platform === 'android' ? { applicationId: information.applicationId, nativeVersionName: release.version, signing: 'debug' } : {}),
    purpose: 'rehearsal', deployable: false }
}

export async function recordRehearsal({ identity, verification, artifacts, output }) {
  if (identity.purpose !== 'rehearsal' || identity.deployable !== false || verification.purpose !== 'rehearsal' || verification.deployable !== false || !verification.verified) throw new Error('Expected a non-deployable rehearsal verification')
  for (const key of ['platform', 'version', 'target', 'commit']) if (identity[key] !== verification[key]) throw new Error(`Rehearsal identity mismatch: ${key}`)
  const extensions = identity.platform === 'windows' ? ['.exe', '.zip'] : identity.platform === 'macos' ? ['.dmg'] : ['.apk']
  const files = (await readdir(artifacts)).filter(file => !INVENTORY_FILES.includes(file)).sort()
  if (files.length !== extensions.length || !extensions.every(extension => files.filter(name => name.startsWith('LumaTile-Rehearsal-') && name.endsWith(extension)).length === 1)) throw new Error('Rehearsal must include exactly this platform\'s build artifacts')
  if ((await readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error })).length) throw new Error('Rehearsal output must be empty')
  const entries = []
  for (const name of files) {
    const path = join(artifacts, name)
    if (!(await stat(path)).isFile()) throw new Error('Expected a rehearsal file')
    const bytes = await readFile(path)
    if (!bytes.length) throw new Error('Empty rehearsal artifact')
    entries.push({ file: basename(name), sha256: sha256(bytes), size: bytes.length })
  }
  const inventory = await readBuildInventory(artifacts, identity.information)
  await mkdir(output, { recursive: true })
  for (const file of files) await copyFile(join(artifacts, file), join(output, file))
  await copyBuildInventory(artifacts, output)
  const record = { schemaVersion: 1, ...identity, verification, artifacts: entries, inventory: { provenanceSha256: inventory.provenanceSha256, entries: inventory.entries } }
  await writeFile(join(output, 'rehearsal-record.json'), `${JSON.stringify(record, null, 2)}\n`)
  const sums = [...entries, ...inventory.entries].map(entry => `${entry.sha256}  ${entry.file}`)
  sums.push(`${sha256(await readFile(join(output, 'rehearsal-record.json')))}  rehearsal-record.json`)
  await writeFile(join(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
  return record
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ options: { record: { type: 'boolean' } }, allowPositionals: true })
  const [platform, verification, artifacts, output] = positionals
  if (!platform || (values.record && (!verification || !artifacts || !output))) throw new Error('Usage: node scripts/rehearse-release.mjs <platform> [--record <verification.json> <artifacts> <output>]')
  const identity = rehearsalIdentity(repositoryRoot, platform)
  const record = values.record ? await recordRehearsal({ identity, verification: JSON.parse(await readFile(resolve(verification), 'utf8')), artifacts: resolve(artifacts), output: resolve(output) }) : identity
  console.log(JSON.stringify(record, null, 2))
}
