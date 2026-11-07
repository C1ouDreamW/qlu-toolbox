import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { npmRuntimeInventory } from './npm-runtime-inventory.mjs'
import { electronRuntimeInventory } from './electron-runtime-inventory.mjs'
import { androidRuntimeInventory, createBuildInventory } from './build-inventory.mjs'
import { assertInventorySource } from './inventory-source.mjs'
import { validateBuildInformation } from '../electron/channel-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const [platform, destination, nativePath] = process.argv.slice(2)
if (!['windows', 'macos', 'android'].includes(platform) || !destination || (platform === 'android' && !nativePath)) throw new Error('Usage: generate-build-inventory.mjs <platform> <output-dir> [android-native-sbom.json]')
const info = validateBuildInformation(JSON.parse(await readFile(join(root, platform === 'android' ? 'apps/mobile/build-info.json' : 'lumatile/build-info.json'), 'utf8')))
if (info.platform !== platform) throw new Error('Inventory platform differs from build identity')
const source = await assertInventorySource(root, info)
const npm = npmRuntimeInventory(root, platform)
const reports = [npm]
if (platform === 'android') reports.push(androidRuntimeInventory(JSON.parse(await readFile(resolve(nativePath), 'utf8')), info, npm))
else {
  const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  reports.push(JSON.parse(execFileSync(python, [join(root, 'scripts/python-runtime-inventory.py')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60_000 })))
  reports.push(await electronRuntimeInventory(root, platform))
}
const builder = { node: process.version, os: process.platform, arch: process.arch }
if (process.env.GITHUB_ACTIONS === 'true') {
  for (const [key, env] of [['runId', 'GITHUB_RUN_ID'], ['runAttempt', 'GITHUB_RUN_ATTEMPT']]) {
    if (!/^[1-9]\d*$/.test(process.env[env] ?? '')) throw new Error('Invalid GitHub build provenance context')
    builder[key] = process.env[env]
  }
  builder.repository = 'C1ouDreamW/qlu-toolbox'
  builder.workflow = process.env.GITHUB_WORKFLOW ?? ''
  builder.event = process.env.GITHUB_EVENT_NAME ?? ''
}
const files = createBuildInventory({ information: info, reports, ...source, builder })
const output = resolve(destination)
if ((await readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error })).length) throw new Error('Build inventory output must be empty')
await mkdir(output, { recursive: true })
for (const [file, content] of Object.entries(files)) await writeFile(join(output, file), content, { flag: 'wx' })
console.log(JSON.stringify({ platform, channel: info.channel, commit: info.commit, files: Object.keys(files) }))
