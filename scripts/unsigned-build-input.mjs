import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { assertUnsignedReceipt } from './android-signing.mjs'

export async function readUnsignedBuildInput({ identity, context, apk, receiptPath, expectedSha256, expectedReceiptSha256 }) {
  const receiptBytes = await readFile(receiptPath)
  if (!/^[a-f0-9]{64}$/.test(expectedReceiptSha256) || createHash('sha256').update(receiptBytes).digest('hex') !== expectedReceiptSha256) throw new Error('Unsigned receipt differs from the validated build job output')
  const receipt = JSON.parse(receiptBytes)
  assertUnsignedReceipt({ identity, context, receipt, bytes: await readFile(apk), expectedSha256 })
  return { receipt }
}
