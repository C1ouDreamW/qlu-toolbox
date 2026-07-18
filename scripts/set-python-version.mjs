import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node scripts/set-python-version.mjs <semver>')
}

const versionFile = fileURLToPath(new URL('../qlu_toolbox/__init__.py', import.meta.url))
const source = await readFile(versionFile, 'utf8')
const pattern = /__version__\s*=\s*["'][^"']+["']/
if (!pattern.test(source)) {
  throw new Error('Unable to find __version__ in qlu_toolbox/__init__.py')
}

await writeFile(versionFile, source.replace(pattern, `__version__ = "${version}"`), 'utf8')
