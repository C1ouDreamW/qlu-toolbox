import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertStableVersion, isArtifactUrl } from '../electron/update-contract.mjs'

const [artifactsArg, outputArg, version, baseUrl, notesArg] = process.argv.slice(2)
if (![artifactsArg, outputArg, version, baseUrl, notesArg].every(Boolean)) {
  throw new Error('Usage: node scripts/generate-legacy-desktop-update-manifest.mjs <artifacts> <output> <version> <baseUrl> <notes>')
}

assertStableVersion(version)
const files = await readdir(resolve(artifactsArg))
const windows = `LumaTile_v${version}_x64_Setup.exe`
const mac = `LumaTile_v${version}_arm64.dmg`
if (!files.includes(windows) || !files.includes(mac)) throw new Error('Matching Windows installer or macOS DMG is missing')

const root = baseUrl.replace(/\/$/, '')
if (![windows, mac].every(file => isArtifactUrl(`${root}/${file}`, `v${version}`, file))) throw new Error('Untrusted legacy download URL')
const notes = (await readFile(resolve(notesArg), 'utf8')).trim()
if (!notes) throw new Error('Empty legacy release notes')
const manifest = {
  schemaVersion: 1,
  version,
  name: `一格有光 v${version}`,
  notes,
  publishedAt: new Date().toISOString(),
  downloads: {
    win32: `${root}/${windows}`,
    darwin: `${root}/${mac}`,
  },
}

await mkdir(dirname(resolve(outputArg)), { recursive: true })
await writeFile(resolve(outputArg), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
