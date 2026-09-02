import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [artifactsArg, outputArg, version, baseUrl, notesArg] = process.argv.slice(2)
if (![artifactsArg, outputArg, version, baseUrl, notesArg].every(Boolean)) {
  throw new Error('Usage: node scripts/generate-desktop-update-manifest.mjs <artifacts> <output> <version> <baseUrl> <notes>')
}

const files = await readdir(resolve(artifactsArg))
const find = pattern => files.find(file => pattern.test(file))
const windows = find(/^LumaTile_v.+_x64_Setup\.exe$/)
const mac = find(/^LumaTile_v.+_arm64\.dmg$/)
if (!windows || !mac) throw new Error('Windows installer or macOS DMG is missing')

const root = baseUrl.replace(/\/$/, '')
const manifest = {
  schemaVersion: 1,
  version,
  name: `一格有光 v${version}`,
  notes: (await readFile(resolve(notesArg), 'utf8')).trim(),
  publishedAt: new Date().toISOString(),
  downloads: {
    win32: `${root}/${windows}`,
    darwin: `${root}/${mac}`,
  },
}

await writeFile(resolve(outputArg), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
