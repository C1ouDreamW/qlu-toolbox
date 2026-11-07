import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPromotion, manifestTarget, sha256, validatePlatformManifest } from './release-artifacts.mjs'
import { validateMigrationPolicy } from '../electron/update-contract.mjs'

export async function promoteManifest({ platform, manifest, data, bridgeVersion = null, channel = 'stable' }) {
  const next = validatePlatformManifest(platform, manifest, bridgeVersion, channel)
  if (platform !== 'android' && !Number.isSafeInteger(next.buildNumber)) throw new Error('Desktop deployment requires a verified native build counter')
  const stable = join(data, channel)
  await mkdir(stable, { recursive: true })
  const name = `${manifestTarget(platform)}.json`
  const lockPath = join(stable, `.${name}.lock`)
  const lock = await open(lockPath, 'wx')
  const temporary = join(stable, `.${name}.${process.pid}.tmp`)
  try {
    const artifacts = platform === 'android' ? [{ url: next.apkUrl, sha256: next.sha256, size: next.size }] : Object.values(next.artifacts)
    for (const artifact of artifacts) {
      // Validators restrict this to the exact known release path and filename.
      const parts = new URL(artifact.url).pathname.split('/')
      const tag = platform === 'android' ? parts.at(-2) : next.tag
      const relative = join('releases', tag, parts.at(-1))
      const bytes = await readFile(join(data, relative))
      if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) throw new Error('Installed release artifact does not match manifest')
    }
    let previous
    try { previous = JSON.parse(await readFile(join(stable, name), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (previous) assertPromotion(platform, validatePlatformManifest(platform, previous, bridgeVersion, channel), next)
    const file = await open(temporary, 'wx')
    try { await file.writeFile(`${JSON.stringify(next, null, 2)}\n`); await file.sync() } finally { await file.close() }
    await rename(temporary, join(stable, name))
    return { platform, channel, version: platform === 'android' ? next.versionName : next.version, file: name }
  } finally {
    await rm(temporary, { force: true })
    await lock.close()
    await rm(lockPath)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, input, data, channel = 'stable'] = process.argv.slice(2)
  if (!platform || !input || !data) throw new Error('Usage: node scripts/promote-update-manifest.mjs <platform> <manifest.json> <server-data-directory> [stable|alpha]')
  const policy = validateMigrationPolicy(JSON.parse(await readFile(new URL('../config/release-migration.json', import.meta.url), 'utf8')))
  console.log(JSON.stringify(await promoteManifest({ platform, channel, manifest: JSON.parse(await readFile(resolve(input), 'utf8')), data: resolve(data), bridgeVersion: policy.bridgeVersion })))
}
