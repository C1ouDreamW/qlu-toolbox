import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { validateBuildInformation } from '../electron/channel-contract.mjs'
import { INVENTORY_FILES } from './build-inventory.mjs'
import { isPublicationDate } from '../electron/update-contract.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// Pure Node validation is deliberately usable on the signature-only and publication runners.
export async function readBuildInventory(directory, information, expectedProvenanceSha256) {
  const info = validateBuildInformation(information)
  const files = {}, entries = []
  for (const file of INVENTORY_FILES) {
    const path = join(directory, file)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024 * 1024) throw new Error('Invalid inventory sidecar file')
    files[file] = await readFile(path)
    entries.push({ file, sha256: sha256(files[file]), size: files[file].length })
  }
  const provenanceSha256 = sha256(files['build-provenance.json'])
  if (expectedProvenanceSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedProvenanceSha256) || provenanceSha256 !== expectedProvenanceSha256)) throw new Error('Inventory differs from the validated build provenance digest')
  const provenance = JSON.parse(files['build-provenance.json'])
  if (provenance.schemaVersion !== 1 || provenance.type !== 'unsigned-build-provenance' || !isDeepStrictEqual(provenance.identity, info) || !isPublicationDate(provenance.createdAt)) throw new Error('Inventory provenance identity mismatch')
  const expected = entries.filter(item => item.file !== 'build-provenance.json').sort((a, b) => a.file.localeCompare(b.file))
  if (!Array.isArray(provenance.files) || !isDeepStrictEqual([...provenance.files].sort((a, b) => a.file.localeCompare(b.file)), expected)) throw new Error('Inventory content differs from its provenance record')
  if (!provenance.sourceInputs || !Object.keys(provenance.sourceInputs).length || Object.values(provenance.sourceInputs).some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error('Inventory lacks source input digests')
  const sbom = JSON.parse(files['dependency-inventory.cdx.json']), review = JSON.parse(files['license-review.json'])
  const root = `lumatile:${info.target}:${info.channel}:${info.version}:${info.commit}`
  const properties = Object.fromEntries((sbom.metadata?.component?.properties ?? []).map(item => [item.name, item.value]))
  if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6' || sbom.metadata?.component?.['bom-ref'] !== root || sbom.metadata.component.version !== info.version ||
      ['platform', 'target', 'channel', 'applicationId', 'commit'].some(key => properties[`lumatile:build:${key}`] !== info[key]) ||
      review.schemaVersion !== 1 || review.status !== 'requires-maintainer-review' || !isDeepStrictEqual(review.identity, info) || !files['PROJECT-TERMS.txt'].toString('utf8').trim()) throw new Error('Inventory sidecar identity mismatch')
  return { entries, provenanceSha256, provenance }
}

export async function copyBuildInventory(source, destination) {
  for (const file of INVENTORY_FILES) await copyFile(join(source, file), join(destination, file), constants.COPYFILE_EXCL)
}
