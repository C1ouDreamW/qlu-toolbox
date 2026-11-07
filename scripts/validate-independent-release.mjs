import { taggedRelease, repositoryRoot } from './release-artifacts.mjs'
import { assertReleaseSource, releaseRunContext } from './release-source.mjs'
const [platform, tag] = process.argv.slice(2)
const identity = taggedRelease(repositoryRoot, platform, tag)
assertReleaseSource(repositoryRoot, identity, releaseRunContext(), process.env.RELEASE_EXPECTED_COMMIT || identity.commit)
console.log(JSON.stringify(identity, null, 2))
