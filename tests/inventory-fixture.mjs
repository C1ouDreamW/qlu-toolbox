import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuildInventory, INVENTORY_FILES } from '../scripts/build-inventory.mjs'
import { readBuildInventory } from '../scripts/inventory-artifacts.mjs'
export { INVENTORY_FILES }

// Small, explicitly synthetic dependency evidence for bundle-boundary tests.
export async function writeInventoryFixture(directory, identity, builder = {}) {
  const files = createBuildInventory({ information: identity.information, sourceInputs: { 'fixture.lock': 'b'.repeat(64) },
    projectTerms: 'Test fixture project terms; no license grant\n', builder, createdAt: '2026-11-07T00:00:00.000Z',
    reports: [{ components: [{ type: 'library', 'bom-ref': 'fixture', name: 'fixture', version: '1' }], roots: ['fixture'], dependencies: [{ ref: 'fixture', dependsOn: [] }], notices: [], unresolvedLicenses: [{ component: 'fixture', reason: 'Synthetic test component' }] }] })
  for (const [file, content] of Object.entries(files)) await writeFile(join(directory, file), content)
  return readBuildInventory(directory, identity.information)
}
