import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { npmRuntimeInventory } from '../scripts/npm-runtime-inventory.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lumatile-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (file, value) => { await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value)) }
  const lock = { lockfileVersion: 3, packages: {} }
  const pkg = async (name, data) => {
    const path = `node_modules/${name}`
    await write(`${path}/package.json`, { name, version: '1.0.0', license: 'MIT', ...data })
    lock.packages[path] = { version: data?.version ?? '1.0.0', integrity: 'sha512-test' }
  }
  await write('package.json', { dependencies: { framework: '^1' }, devDependencies: { buildtool: '1' } })
  await write('apps/mobile/package.json', { dependencies: { mobile: '1' } })
  await pkg('framework', { dependencies: { vue: '1' }, peerDependencies: { optionaltype: '1' }, peerDependenciesMeta: { optionaltype: { optional: true } } })
  await pkg('vue', { dependencies: { framework: '1' } })
  await pkg('mobile', { dependencies: { vue: '1' }, optionalDependencies: { unavailable: '1' } })
  await pkg('buildtool', {}); await pkg('optionaltype', {})
  await write('node_modules/vue/LICENSES.txt', 'MIT license fixture\n')
  await write('package-lock.json', lock)
  return { root, lock, write, pkg }
}

test('installed production graph includes peer-labelled Vue and cycles but excludes unrelated workspaces and dev tools', async t => {
  const f = await fixture(t)
  const desktop = npmRuntimeInventory(f.root, 'windows')
  assert.deepEqual(desktop.components.map(item => item.name).sort(), ['framework', 'vue'])
  assert.equal(desktop.dependencies.length, 2)
  assert.equal(desktop.notices[0].text, 'MIT license fixture\n')
  assert.ok(!JSON.stringify(desktop).includes(f.root), 'Published inventory must not include machine paths')
  const android = npmRuntimeInventory(f.root, 'android')
  assert.deepEqual(android.components.map(item => item.name).sort(), ['framework', 'mobile', 'vue'])
  const refs = new Set(android.components.map(item => item['bom-ref']))
  for (const row of android.dependencies) for (const ref of [row.ref, ...row.dependsOn]) assert.ok(refs.has(ref))
})

test('missing runtime packages and installed versions that differ from the lockfile fail instead of producing incomplete inventories', async t => {
  const f = await fixture(t)
  await f.write('node_modules/vue/package.json', { name: 'vue', version: '2.0.0' })
  assert.throws(() => npmRuntimeInventory(f.root, 'windows'), /differs from lockfile/)
  await rm(join(f.root, 'node_modules/vue'), { recursive: true })
  assert.throws(() => npmRuntimeInventory(f.root, 'windows'), /Missing installed runtime dependency/)
})

test('unknown license metadata is reported explicitly without inventing a project license', async t => {
  const f = await fixture(t)
  await f.pkg('vue', { license: undefined })
  const value = npmRuntimeInventory(f.root, 'windows')
  assert.equal(value.components.find(item => item.name === 'vue').licenses, undefined)
  assert.equal(value.unresolvedLicenses.length, 1)
  assert.match(value.unresolvedLicenses[0].component, /^npm:vue@/)
})
