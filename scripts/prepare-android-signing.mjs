import { appendFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createUnsignedReceipt, signAndroidRelease } from './android-signing.mjs'
import { repositoryRoot, sha256, taggedRelease } from './release-artifacts.mjs'
import { assertReleaseSource, releaseRunContext } from './release-source.mjs'
import { readUnsignedBuildInput } from './unsigned-build-input.mjs'

const [mode, tag, apk, receiptPath, output, verification] = process.argv.slice(2)
if (!['record', 'verify', 'sign'].includes(mode) || !tag || !apk || !receiptPath || (mode === 'sign' && (!output || !verification))) {
  throw new Error('Usage: prepare-android-signing.mjs record|verify|sign <tag> <unsigned.apk> <receipt.json> [signed.apk verification.json]')
}
const context = releaseRunContext()
const identity = taggedRelease(repositoryRoot, 'android', tag)
assertReleaseSource(repositoryRoot, identity, context, process.env.RELEASE_EXPECTED_COMMIT || identity.commit)
const tools = join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools', '36.0.0')
if (mode === 'record') {
  const receipt = await createUnsignedReceipt({ identity, context, apk: resolve(apk), tools })
  const content = `${JSON.stringify(receipt, null, 2)}\n`
  await writeFile(resolve(receiptPath), content, { flag: 'wx' })
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `commit=${identity.commit}\nversion=${identity.version}\nchannel=${identity.channel}\nunsigned_sha256=${receipt.artifact.sha256}\nreceipt_sha256=${sha256(content)}\n`)
  console.log(JSON.stringify(receipt, null, 2))
} else {
  const input = await readUnsignedBuildInput({ identity, context, apk: resolve(apk), receiptPath: resolve(receiptPath), expectedSha256: process.env.RELEASE_UNSIGNED_SHA256, expectedReceiptSha256: process.env.RELEASE_RECEIPT_SHA256 })
  if (mode === 'verify') console.log('Unsigned artifact and receipt match the validated build')
  else {
    const report = await signAndroidRelease({ identity, context, apk: resolve(apk), receipt: input.receipt,
      expectedSha256: process.env.RELEASE_UNSIGNED_SHA256, tools, output: resolve(output), verification: resolve(verification) })
    console.log(JSON.stringify(report, null, 2))
  }
}
