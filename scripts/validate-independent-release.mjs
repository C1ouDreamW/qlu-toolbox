import { taggedRelease, repositoryRoot } from './release-artifacts.mjs'
const [platform, tag] = process.argv.slice(2)
console.log(JSON.stringify(taggedRelease(repositoryRoot, platform, tag), null, 2))
