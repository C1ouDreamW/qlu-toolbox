import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPromotion } from './release-artifacts.mjs'
import { validateAndroidManifest } from '../electron/android-update-contract.mjs'

// Called in a separate checkout of the latest main; never changes the other channel.
export async function prepareAndroidBackup({ checkout, manifest, channel }) {
  if (!['stable', 'alpha'].includes(channel)) throw new Error('Invalid backup channel')
  const next = validateAndroidManifest(manifest, channel)
  const file = `updates/${channel === 'alpha' ? 'android-alpha.json' : 'android.json'}`
  let previous
  try { previous = JSON.parse(await readFile(join(checkout, file), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT' || channel !== 'alpha') throw error }
  if (previous) assertPromotion('android', validateAndroidManifest(previous, channel), next)
  await mkdir(join(checkout, 'updates'), { recursive: true })
  await writeFile(join(checkout, file), `${JSON.stringify(next, null, 2)}\n`)
  return file
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [checkout, input, channel] = process.argv.slice(2)
  if (!checkout || !input || !['stable', 'alpha'].includes(channel)) throw new Error('Usage: prepare-android-backup.mjs <checkout> <manifest.json> <stable|alpha>')
  console.log(await prepareAndroidBackup({ checkout: resolve(checkout), manifest: JSON.parse(await readFile(resolve(input), 'utf8')), channel }))
}
