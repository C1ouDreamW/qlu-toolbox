import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { taggedDesktopBridge } from './desktop-bridge.mjs'
import { validatePublishedAlpha } from './promotion-publication.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const identities = taggedDesktopBridge(root, process.argv[2], undefined, process.env.RELEASE_EXPECTED_COMMIT)
for (const identity of Object.values(identities)) await validatePublishedAlpha(identity.promotion)
const { commit, version } = identities.windows
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `commit=${commit}\nversion=${version}\n`)
console.log(JSON.stringify(identities, null, 2))
