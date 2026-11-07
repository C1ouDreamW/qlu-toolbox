import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { taggedDesktopBridge } from './desktop-bridge.mjs'
import { createDesktopBridgeBundle } from './desktop-bridge-bundle.mjs'

const [tag, windows, macos, windowsVerification, macosVerification, output] = process.argv.slice(2)
if (![tag, windows, macos, windowsVerification, macosVerification, output].every(Boolean)) throw new Error('Usage: build-desktop-bridge-bundle.mjs <vB> <windows-artifacts> <macos-artifacts> <windows-verification.json> <macos-verification.json> <output>')
const identities = taggedDesktopBridge(fileURLToPath(new URL('../', import.meta.url)), tag, undefined, process.env.RELEASE_EXPECTED_COMMIT)
const verifications = { windows: JSON.parse(await readFile(resolve(windowsVerification), 'utf8')), macos: JSON.parse(await readFile(resolve(macosVerification), 'utf8')) }
const bundle = await createDesktopBridgeBundle({ identities, artifacts: { windows: resolve(windows), macos: resolve(macos) }, verifications, output: resolve(output) })
console.log(JSON.stringify({ tag, commit: bundle.record.commit, releaseDir: bundle.releaseDir }))
