import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { assertUnsignedReceipt } from './android-signing.mjs'
import { readBuildInventory } from './inventory-artifacts.mjs'

export async function readUnsignedBuildInput({ identity, context, apk, receiptPath, expectedSha256, expectedReceiptSha256 }) {
  const receiptBytes = await readFile(receiptPath)
  if (!/^[a-f0-9]{64}$/.test(expectedReceiptSha256) || createHash('sha256').update(receiptBytes).digest('hex') !== expectedReceiptSha256) throw new Error('Unsigned receipt differs from the validated build job output')
  const receipt = JSON.parse(receiptBytes)
  assertUnsignedReceipt({ identity, context, receipt, bytes: await readFile(apk), expectedSha256 })
  const inventoryDirectory = join(dirname(receiptPath), 'inventory')
  const inventory = await readBuildInventory(inventoryDirectory, identity.information, receipt.inventorySha256)
  for (const [key, value] of Object.entries({ runId: context.runId, runAttempt: context.runAttempt, repository: context.repository })) {
    if (inventory.provenance.builder?.[key] !== value) throw new Error('Inventory differs from this workflow run and attempt')
  }
  return { receipt, inventoryDirectory, inventory }
}
