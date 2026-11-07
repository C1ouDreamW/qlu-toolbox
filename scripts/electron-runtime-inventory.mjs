import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from './release-artifacts.mjs'

export async function electronRuntimeInventory(root, platform) {
  const pkg = JSON.parse(await readFile(join(root, 'node_modules/electron/package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  if (lock.packages?.['node_modules/electron']?.version !== pkg.version) throw new Error('Electron input differs from npm lockfile')
  const directory = join(root, 'node_modules/electron/dist')
  const binary = platform === 'macos' ? join(directory, 'Electron.app/Contents/MacOS/Electron') : join(directory, 'electron.exe')
  const versions = JSON.parse(execFileSync(binary, ['-p', 'JSON.stringify(process.versions)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000 }))
  if (versions.electron !== pkg.version) throw new Error('Electron binary version differs from its installed package')
  const reference = `pkg:npm/electron@${pkg.version}`
  const component = { type: 'framework', 'bom-ref': reference, name: 'Electron', version: pkg.version, purl: reference,
    licenses: [{ license: { name: pkg.license } }], properties: Object.entries(versions).sort().map(([key, value]) => ({ name: `lumatile:electron:runtime:${key}`, value })) }
  const notices = []
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
    const bytes = await readFile(join(directory, file))
    notices.push({ component: reference, file: `Electron/${file}`, sha256: sha256(bytes), text: bytes.toString('utf8') })
  }
  return { components: [component], dependencies: [{ ref: reference, dependsOn: [] }], roots: [reference], notices, unresolvedLicenses: [],
    opaqueComponents: [reference] }
}
