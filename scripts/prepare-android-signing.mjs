import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertUnsignedReceipt, createUnsignedReceipt, signAndroidRelease } from './android-signing.mjs'
import { repositoryRoot, taggedRelease } from './release-artifacts.mjs'
import { assertReleaseSource, releaseRunContext } from './release-source.mjs'

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
  await writeFile(resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `commit=${identity.commit}\nversion=${identity.version}\nchannel=${identity.channel}\nunsigned_sha256=${receipt.artifact.sha256}\n`)
  console.log(JSON.stringify(receipt, null, 2))
} else if (mode === 'verify') {
  assertUnsignedReceipt({ identity, context, receipt: JSON.parse(await readFile(resolve(receiptPath), 'utf8')),
    bytes: await readFile(resolve(apk)), expectedSha256: process.env.RELEASE_UNSIGNED_SHA256 })
  console.log('Unsigned artifact matches the validated build')
} else {
  const report = await signAndroidRelease({ identity, context, apk: resolve(apk), receipt: JSON.parse(await readFile(resolve(receiptPath), 'utf8')),
    expectedSha256: process.env.RELEASE_UNSIGNED_SHA256, tools, output: resolve(output), verification: resolve(verification) })
  console.log(JSON.stringify(report, null, 2))
}
