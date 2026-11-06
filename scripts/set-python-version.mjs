import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { assertStableVersion } from './release-config.mjs'

export function replacePythonVersion(source, version) {
  assertStableVersion(version)
  const pattern = /^__version__\s*=\s*["'][^"']+["']/gm
  if ([...source.matchAll(pattern)].length !== 1) {
    throw new Error('Expected exactly one __version__ in lumatile/__init__.py')
  }
  return source.replace(pattern, `__version__ = "${version}"`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const versionFile = fileURLToPath(new URL('../lumatile/__init__.py', import.meta.url))
  const source = await readFile(versionFile, 'utf8')
  await writeFile(versionFile, replacePythonVersion(source, process.argv[2]), 'utf8')
}
