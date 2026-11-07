import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createReleaseBundle, repositoryRoot, taggedRelease } from './release-artifacts.mjs'
const [platform, tag, artifacts, verification, output] = process.argv.slice(2)
if (![platform, tag, artifacts, verification, output].every(Boolean)) throw new Error('Usage: node scripts/build-release-bundle.mjs <platform> <tag> <artifacts> <verification.json> <output>')
const result = await createReleaseBundle({ identity: taggedRelease(repositoryRoot, platform, tag), artifacts: resolve(artifacts),
  verification: JSON.parse(await readFile(resolve(verification), 'utf8')), output: resolve(output) })
console.log(JSON.stringify(result.record, null, 2))
