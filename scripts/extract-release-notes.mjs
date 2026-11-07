import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractReleaseNotes, readReleaseConfig, resolveRelease } from './release-config.mjs'

const [platform, tag, output] = process.argv.slice(2)
if (!platform || !tag || !output) throw new Error('Usage: node scripts/extract-release-notes.mjs <platform> <tag> <output>')
const root = fileURLToPath(new URL('../', import.meta.url))
const release = resolveRelease(await readReleaseConfig(root), { platform, tag })
const notes = extractReleaseNotes(await readFile(resolve(root, `changelogs/${platform}.md`), 'utf8'), release.version)
await writeFile(resolve(output), `${notes}\n`, 'utf8')
