import { appendFile } from 'node:fs/promises'
import { taggedRelease, repositoryRoot } from './release-artifacts.mjs'
import { assertReleaseSource, releaseRunContext } from './release-source.mjs'
const [platform, tag] = process.argv.slice(2)
const identity = taggedRelease(repositoryRoot, platform, tag)
assertReleaseSource(repositoryRoot, identity, releaseRunContext(), process.env.RELEASE_EXPECTED_COMMIT || identity.commit)
console.log(JSON.stringify(identity, null, 2))

if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `commit=${identity.commit}\nversion=${identity.version}\nchannel=${identity.channel}\n`)
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `LUMATILE_BUILD_CHANNEL=${identity.channel}\n`)
