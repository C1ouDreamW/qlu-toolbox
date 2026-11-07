import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alphaCandidateIdentity, candidateArtifactNames, recordCandidate } from './alpha-candidate.mjs'
import { createUnsignedReceipt, signAndroidRelease } from './android-signing.mjs'
import { releaseRunContext } from './release-source.mjs'
import { readBuildInventory, copyBuildInventory } from './inventory-artifacts.mjs'
import { readUnsignedBuildInput } from './unsigned-build-input.mjs'
import { sha256 } from './release-artifacts.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const [mode, platform, input, receiptPath, output, verificationPath] = process.argv.slice(2)
if (!['identity', 'record-unsigned', 'verify-unsigned', 'sign', 'record'].includes(mode)) throw new Error('Usage: prepare-alpha-candidate.mjs identity|record-unsigned|verify-unsigned|sign|record <platform> [inputs / outputs]')
const context = releaseRunContext()
const identity = alphaCandidateIdentity(root, platform, context, process.env.RELEASE_EXPECTED_COMMIT)
const names = candidateArtifactNames(identity)
const tools = join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools', '36.0.0')
async function outputs(extra = '') {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `commit=${identity.commit}\nversion=${identity.version}\nfilename=${names[0]}\nportable=${names[1] ?? ''}\n${extra}`)
}
if (mode === 'identity') {
  await outputs()
  console.log(JSON.stringify(identity, null, 2))
} else if (mode === 'record') {
  if (!input || !receiptPath || !output) throw new Error('record <platform> <verification.json> <artifacts-dir> <output-dir>')
  console.log(JSON.stringify(await recordCandidate({ identity, verification: JSON.parse(await readFile(resolve(input), 'utf8')), artifacts: resolve(receiptPath), output: resolve(output) }), null, 2))
} else {
  if (platform !== 'android' || !input || !receiptPath) throw new Error('Android candidate commands require <unsigned.apk> <receipt.json>')
  if (mode === 'record-unsigned') {
    const inventory = await readBuildInventory(join(dirname(resolve(receiptPath)), 'inventory'), identity.information)
    const receipt = await createUnsignedReceipt({ identity, context, apk: resolve(input), tools, inventorySha256: inventory.provenanceSha256 })
    const content = `${JSON.stringify(receipt, null, 2)}\n`
    await writeFile(resolve(receiptPath), content, { flag: 'wx' })
    await outputs(`unsigned_sha256=${receipt.artifact.sha256}\nreceipt_sha256=${sha256(content)}\n`)
    console.log(JSON.stringify(receipt, null, 2))
  } else {
    const verified = await readUnsignedBuildInput({ identity, context, apk: resolve(input), receiptPath: resolve(receiptPath), expectedSha256: process.env.RELEASE_UNSIGNED_SHA256, expectedReceiptSha256: process.env.RELEASE_RECEIPT_SHA256 })
    if (mode === 'verify-unsigned') console.log('Candidate unsigned input and inventory match this main dispatch and build attempt')
    else {
      if (!output || !verificationPath) throw new Error('sign android <unsigned.apk> <receipt.json> <artifacts-dir> <verification.json>')
      await mkdir(resolve(output), { recursive: true })
      console.log(JSON.stringify(await signAndroidRelease({ identity, context, receipt: verified.receipt, apk: resolve(input), expectedSha256: process.env.RELEASE_UNSIGNED_SHA256,
        tools, output: join(resolve(output), names[0]), verification: resolve(verificationPath) }), null, 2))
      await copyBuildInventory(verified.inventoryDirectory, resolve(output))
    }
  }
}
