import { createHash } from 'node:crypto'
import { validateBuildInformation } from '../electron/channel-contract.mjs'
import { GITHUB_REPOSITORY, isPublicationDate } from '../electron/update-contract.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
export const INVENTORY_FILES = ['dependency-inventory.cdx.json', 'THIRD-PARTY-NOTICES.txt', 'license-review.json', 'build-provenance.json', 'PROJECT-TERMS.txt']

export function androidRuntimeInventory(value, information, npm) {
  if (!value || value.bomFormat !== 'CycloneDX' || value.specVersion !== '1.6' || value.metadata?.component?.version !== information.version ||
      value.metadata.component.description !== `LumaTile Android ${information.channel} resolved runtime dependencies for commit ${information.commit}` ||
      !Array.isArray(value.components) || !Array.isArray(value.dependencies)) throw new Error('Native Android SBOM differs from this build identity')
  const components = [value.metadata.component, ...value.components].map(item => structuredClone(item))
  const notices = [], unresolvedLicenses = []
  for (const component of components) {
    // Never publish a remote URL with embedded credentials (including Git's SSH form).
    component.externalReferences = (component.externalReferences ?? []).filter(item => {
      try { const url = new URL(item.url); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
    })
    const packageName = { 'capacitor-android': '@capacitor/android', 'capacitor-app': '@capacitor/app' }[component.name]
    if (packageName) {
      const source = npm.components.find(item => item.name === packageName && item.version === component.version)
      if (!source) throw new Error('Native Capacitor component differs from the resolved npm source')
      component.licenses = source.licenses
      component.properties = [...(component.properties ?? []), { name: 'lumatile:npm:source', value: source['bom-ref'] }]
    }
    if (!component.licenses?.length) unresolvedLicenses.push({ component: component['bom-ref'], reason: 'Project or generated native component needs license review' })
    for (const [index, license] of (component.licenses ?? []).entries()) {
      const text = license.license?.text
      if (!text?.content) continue
      const content = text.encoding === 'base64' ? Buffer.from(text.content, 'base64').toString('utf8') : text.content
      notices.push({ component: component['bom-ref'], file: `${component.name}-license-${index + 1}`, sha256: hash(content), text: content })
    }
  }
  const root = value.metadata.component['bom-ref']
  const refs = new Set(components.map(item => item['bom-ref']))
  if (!value.dependencies.find(item => item.ref === root)?.dependsOn?.length) throw new Error('Android SBOM root is disconnected')
  for (const item of value.dependencies) for (const ref of [item.ref, ...(item.dependsOn ?? [])]) if (!refs.has(ref)) throw new Error('Android SBOM has unresolved dependency references')
  return { components, dependencies: value.dependencies, roots: [root], notices, unresolvedLicenses }
}

export function createBuildInventory({ information, reports, projectTerms, sourceInputs, builder = {}, createdAt = new Date().toISOString() }) {
  const info = validateBuildInformation(information)
  if (!/^[a-f0-9]{40}$/.test(info.commit) || !projectTerms.trim()) throw new Error('Inventory requires immutable source identity and a project terms snapshot')
  if (!isPublicationDate(createdAt) || !sourceInputs || !Object.keys(sourceInputs).length || Object.values(sourceInputs).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new Error('Inventory requires verified source input digests and a valid generation time')
  const allowedBuilderFields = ['node', 'os', 'arch', 'runId', 'runAttempt', 'repository', 'workflow', 'event']
  if (Object.keys(builder).some(key => !allowedBuilderFields.includes(key)) || Object.values(builder).some(value => typeof value !== 'string')) throw new Error('Builder provenance contains unexpected environment data')
  const root = `lumatile:${info.target}:${info.channel}:${info.version}:${info.commit}`
  if (!Array.isArray(reports) || !reports.length) throw new Error('Inventory requires resolved runtime reports')
  const components = reports.flatMap(item => item.components), dependencies = reports.flatMap(item => item.dependencies)
  const references = new Set(components.map(item => item['bom-ref']))
  if (references.size !== components.length || references.has(root)) throw new Error('Inventory has duplicate component references')
  const graph = new Map(dependencies.map(item => [item.ref, item.dependsOn ?? []]))
  if (graph.size !== dependencies.length) throw new Error('Inventory has duplicate dependency rows')
  if (graph.size !== references.size || [...references].some(ref => !graph.has(ref))) throw new Error('Inventory is missing dependency rows')
  const roots = [...new Set(reports.flatMap(item => item.roots))].sort()
  for (const item of dependencies) for (const reference of [item.ref, ...(item.dependsOn ?? [])]) if (!references.has(reference)) throw new Error('Inventory has an unresolved component reference')
  const reachable = new Set(), queue = [...roots]
  while (queue.length) { const ref = queue.pop(); if (reachable.has(ref)) continue; if (!references.has(ref)) throw new Error('Inventory root is missing'); reachable.add(ref); queue.push(...(graph.get(ref) ?? [])) }
  if (reachable.size !== references.size) throw new Error('Inventory contains disconnected components')
  const project = { type: 'application', 'bom-ref': root, name: info.productName, version: info.version,
    externalReferences: [{ type: 'vcs', url: `https://github.com/${GITHUB_REPOSITORY}/tree/${info.commit}` }],
    properties: ['platform', 'target', 'channel', 'applicationId', 'commit'].map(key => ({ name: `lumatile:build:${key}`, value: info[key] })) }
  project.properties.push({ name: 'lumatile:project-license-status', value: 'Formal project license pending; existing README noncommercial notice preserved in PROJECT-TERMS.txt' })
  const opaque = reports.flatMap(item => item.opaqueComponents ?? [])
  if (opaque.some(ref => !references.has(ref))) throw new Error('Unknown opaque runtime component')
  const sbom = { $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json', bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { timestamp: createdAt, component: project, tools: { components: [{ type: 'application', name: 'LumaTile resolved build inventory', version: '1' }] } },
    components: components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])), dependencies: [{ ref: root, dependsOn: roots }, ...dependencies].sort((a, b) => a.ref.localeCompare(b.ref)),
    compositions: [{ aggregate: opaque.length ? 'incomplete' : 'complete', assemblies: [root] }],
    properties: [{ name: 'lumatile:inventory:boundary', value: 'Resolved production dependency inputs and included runtime vendors; excludes OS-provided components and separately downloaded browsers' }] }
  const unresolved = [{ component: root, reason: 'Formal project license not selected; README noncommercial terms remain in effect' }, ...reports.flatMap(item => item.unresolvedLicenses ?? [])]
  const licenseReview = { schemaVersion: 1, identity: info, status: 'requires-maintainer-review', unresolved,
    opaqueVendorComponents: opaque, note: 'Inventory and copied notices are evidence, not an automatic license-compliance approval' }
  const notices = ['Third-party notices for ' + info.productName + ' ' + info.version, 'Project-owned terms are separate in PROJECT-TERMS.txt.', '']
  const texts = new Set()
  for (const item of reports.flatMap(value => value.notices ?? []).sort((a, b) => (a.component + a.file).localeCompare(b.component + b.file))) {
    if (!references.has(item.component)) throw new Error('License notice refers to an unknown runtime component')
    if (hash(item.text) !== item.sha256) throw new Error('License notice content differs from its recorded digest')
    const id = `${item.component}:${item.sha256}`
    if (texts.has(id)) continue
    texts.add(id)
    notices.push(`===== ${item.component} / ${item.file} / SHA-256 ${item.sha256} =====`, item.text, '')
  }
  const files = {
    'dependency-inventory.cdx.json': JSON.stringify(sbom, null, 2) + '\n',
    'THIRD-PARTY-NOTICES.txt': notices.join('\n'),
    'license-review.json': JSON.stringify(licenseReview, null, 2) + '\n',
    'PROJECT-TERMS.txt': projectTerms,
  }
  const provenance = { schemaVersion: 1, type: 'unsigned-build-provenance', identity: info, createdAt, builder, sourceInputs,
    files: Object.entries(files).map(([file, content]) => ({ file, sha256: hash(content), size: Buffer.byteLength(content) })) }
  files['build-provenance.json'] = JSON.stringify(provenance, null, 2) + '\n'
  return files
}
