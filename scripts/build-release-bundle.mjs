import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { androidReleaseTag } from '../packages/release-contract/android-update-contract.mjs'
import { createReleaseBundle, repositoryRoot, taggedRelease } from './release-artifacts.mjs'
const [platform, tag, artifacts, verification, output, mode] = process.argv.slice(2)
if (![platform, tag, artifacts, verification, output].every(Boolean) ||
    (mode !== undefined && (mode !== '--android-mirror' || platform !== 'android'))) {
  throw new Error('Usage: node scripts/build-release-bundle.mjs <platform> <tag> <artifacts> <verification.json> <output> [--android-mirror]')
}
const identity = taggedRelease(repositoryRoot, platform, tag)
// The deployed mirror uses platform-prefixed storage paths; GitHub uses the shared tag.
if (mode === '--android-mirror') identity.tag = androidReleaseTag(identity.version, identity.channel)
const result = await createReleaseBundle({ identity, artifacts: resolve(artifacts),
  verification: JSON.parse(await readFile(resolve(verification), 'utf8')), output: resolve(output) })
console.log(JSON.stringify(result.record, null, 2))
