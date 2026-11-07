import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alphaCandidateIdentity, candidateArtifactNames, recordCandidate } from './alpha-candidate.mjs'
import { assertUnsignedReceipt, createUnsignedReceipt, signAndroidRelease } from './android-signing.mjs'
import { releaseRunContext } from './release-source.mjs'

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
    const receipt = await createUnsignedReceipt({ identity, context, apk: resolve(input), tools })
    await writeFile(resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
    await outputs(`unsigned_sha256=${receipt.artifact.sha256}\n`)
    console.log(JSON.stringify(receipt, null, 2))
  } else if (mode === 'verify-unsigned') {
    assertUnsignedReceipt({ identity, context, receipt: JSON.parse(await readFile(resolve(receiptPath), 'utf8')), bytes: await readFile(resolve(input)), expectedSha256: process.env.RELEASE_UNSIGNED_SHA256 })
    console.log('Candidate unsigned input matches this main dispatch and build attempt')
  } else {
    if (!output || !verificationPath) throw new Error('sign android <unsigned.apk> <receipt.json> <artifacts-dir> <verification.json>')
    await mkdir(resolve(output), { recursive: true })
    console.log(JSON.stringify(await signAndroidRelease({ identity, context, receipt: JSON.parse(await readFile(resolve(receiptPath), 'utf8')), apk: resolve(input), expectedSha256: process.env.RELEASE_UNSIGNED_SHA256,
      tools, output: join(resolve(output), names[0]), verification: resolve(verificationPath) }), null, 2))
  }
}
