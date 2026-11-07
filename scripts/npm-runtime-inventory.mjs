import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const digest = value => createHash('sha256').update(value).digest('hex')
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i
function inside(root, file) { const value = relative(root, file); return !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value) }
function json(file) { return JSON.parse(readFileSync(file, 'utf8')) }

function resolvePackage(root, start, name) {
  if (!packageName.test(name)) throw new Error(`Invalid dependency package name: ${name}`)
  let directory = start
  while (inside(root, directory)) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (directory === root) break
    directory = dirname(directory)
  }
  return null
}

// Read the installed graph and verify every instance against npm's lockfile.
// Optional peers are build-time conveniences, not automatic runtime requirements.
export function npmRuntimeInventory(root, platform) {
  if (!['windows', 'macos', 'android'].includes(platform)) throw new Error('Unknown inventory platform')
  root = realpathSync(root)
  const app = platform === 'android' ? join(root, 'apps/mobile') : root
  const metadata = json(join(app, 'package.json'))
  const lock = json(join(root, 'package-lock.json'))
  if (lock.lockfileVersion !== 3) throw new Error('Runtime inventory requires npm lockfile v3')
  const nodes = new Map(), dependencies = new Map(), unresolvedLicenses = [], notices = []
  function visit(path, expectedName) {
    const directory = realpathSync(path)
    if (!inside(root, directory)) throw new Error('Dependency resolves outside this checkout')
    const item = json(join(directory, 'package.json'))
    if (item.name !== expectedName || !packageName.test(item.name) || typeof item.version !== 'string' || !item.version) throw new Error('Installed package identity mismatch')
    const installPath = relative(root, path).split(sep).join('/')
    const entry = lock.packages?.[installPath]
    const locked = entry?.link ? lock.packages[entry.resolved] : entry
    if (!locked || locked.version !== item.version) throw new Error(`Installed dependency differs from lockfile: ${expectedName}`)
    const reference = `npm:${item.name}@${item.version}:${digest(installPath).slice(0, 12)}`
    if (nodes.has(directory)) return nodes.get(directory)['bom-ref']
    const license = typeof item.license === 'string' ? item.license : item.license?.type
    const component = { type: 'library', 'bom-ref': reference, name: item.name, version: item.version,
      purl: `pkg:npm/${item.name.startsWith('@') ? item.name.replace('@', '%40') : encodeURIComponent(item.name)}@${encodeURIComponent(item.version)}`,
      properties: [{ name: 'lumatile:npm:installPath', value: installPath }],
      ...(license ? { licenses: [{ license: { name: license } }] } : {}) }
    if (locked.integrity) component.properties.push({ name: 'lumatile:npm:integrity', value: locked.integrity })
    if (!license) unresolvedLicenses.push({ component: reference, reason: 'Package metadata does not declare a license' })
    nodes.set(directory, component)
    const files = readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && /^(?:licen[sc]es?|copying|notices?)(?:[._-].*)?$/i.test(file.name)).sort((a, b) => a.name.localeCompare(b.name))
    for (const file of files) {
      const bytes = readFileSync(join(directory, file.name))
      if (bytes.length > 32 * 1024 * 1024) throw new Error(`License file exceeds inventory limit: ${item.name}`)
      notices.push({ component: reference, file: file.name, sha256: digest(bytes), text: bytes.toString('utf8') })
    }
    const required = { ...item.dependencies }
    for (const [name, version] of Object.entries(item.peerDependencies ?? {})) if (!item.peerDependenciesMeta?.[name]?.optional) required[name] ??= version
    const optional = item.optionalDependencies ?? {}
    const children = []
    for (const name of [...new Set([...Object.keys(required), ...Object.keys(optional)])].sort()) {
      const dependency = resolvePackage(root, directory, name)
      if (!dependency) {
        if (Object.hasOwn(optional, name)) continue
        throw new Error(`Missing installed runtime dependency: ${item.name} -> ${name}`)
      }
      children.push(visit(dependency, name))
    }
    dependencies.set(reference, { ref: reference, dependsOn: [...new Set(children)].sort() })
    return reference
  }
  const roots = []
  for (const name of Object.keys(metadata.dependencies ?? {}).sort()) {
    const path = resolvePackage(root, app, name)
    if (!path) throw new Error(`Missing installed application dependency: ${name}`)
    roots.push(visit(path, name))
  }
  return { components: [...nodes.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
    dependencies: [...dependencies.values()].sort((a, b) => a.ref.localeCompare(b.ref)), roots,
    notices, unresolvedLicenses }
}
