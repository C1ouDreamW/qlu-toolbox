import { execFileSync, spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertAndroidApkIdentity, assertAndroidApkMetadata } from './android-apk-verification.mjs'
import { sha256 } from './release-artifacts.mjs'
import { channelIdentity } from '../electron/channel-contract.mjs'
import { assertCandidateRun, assertReleaseRun } from './release-source.mjs'

export function toolEnvironment(env = process.env) {
  return Object.fromEntries(['PATH', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot']
    .filter(key => env[key] !== undefined).map(key => [key, env[key]]))
}

function tool(command, args, env) {
  try {
    return execFileSync(command, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
  } catch {
    // Do not expose execFile's argv/env/stderr: alias and tool diagnostics may contain credentials.
    throw new Error('Android signing or metadata tool failed')
  }
}

function apkMetadata(apk, tools, env) {
  return { badging: tool(join(tools, 'aapt'), ['dump', 'badging', apk], env),
    metadata: JSON.parse(tool('unzip', ['-p', apk, 'assets/public/lumatile-version.json'], env)) }
}

function signingRun(identity, context) {
  if (identity.purpose === 'candidate') assertCandidateRun(identity, context)
  else assertReleaseRun(identity, context)
}

function receiptPurpose(identity) { return identity.purpose === 'candidate' ? 'unsigned-android-candidate' : 'unsigned-android-release' }

function signingIdentity(identity) {
  const candidate = identity.purpose === 'candidate' && identity.channel === 'alpha' && identity.deployable === false && identity.tag === null
  const release = [undefined, 'release'].includes(identity.purpose) && [undefined, true].includes(identity.deployable)
  if (identity.platform !== 'android' || !['stable', 'alpha'].includes(identity.channel) || !(candidate || release) ||
      !/^[a-f0-9]{40}$/.test(identity.commit) || !/^[a-f0-9]{64}$/.test(identity.androidSigningSha256)) throw new Error('Expected an Android release signing identity')
  return { platform: identity.platform, channel: identity.channel, tag: identity.tag, commit: identity.commit,
    version: identity.version, versionCode: identity.versionCode, applicationId: channelIdentity(identity.channel, 'android').applicationId, signingSha256: identity.androidSigningSha256 }
}

export async function createUnsignedReceipt({ identity, context, apk, tools, env = process.env }) {
  signingRun(identity, context)
  const expected = signingIdentity(identity)
  const toolEnv = toolEnvironment(env)
  assertAndroidApkMetadata({ identity, ...apkMetadata(apk, tools, toolEnv) })
  const result = spawnSync(join(tools, 'apksigner'), ['verify', apk], { env: toolEnv, stdio: 'pipe', timeout: 120_000 })
  if (result.error || result.status === null) throw new Error('Cannot check unsigned APK')
  if (result.status === 0) throw new Error('Expected an unsigned APK, not an already-signed package')
  const bytes = await readFile(apk)
  return { schemaVersion: 1, purpose: receiptPurpose(identity), deployable: false, ...expected,
    repository: context.repository, runId: context.runId, runAttempt: context.runAttempt,
    artifact: { file: 'app-release-unsigned.apk', sha256: sha256(bytes), size: bytes.length } }
}

export function assertUnsignedReceipt({ identity, context, receipt, bytes, expectedSha256 }) {
  signingRun(identity, context)
  if (!receipt || receipt.schemaVersion !== 1 || receipt.purpose !== receiptPurpose(identity) || receipt.deployable !== false) throw new Error('Invalid unsigned build receipt')
  const expected = { ...signingIdentity(identity), repository: context.repository, runId: context.runId, runAttempt: context.runAttempt }
  for (const [key, value] of Object.entries(expected)) if (receipt[key] !== value) throw new Error(`Unsigned build receipt mismatch: ${key}`)
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || receipt.artifact?.file !== 'app-release-unsigned.apk' ||
      receipt.artifact.sha256 !== expectedSha256 || sha256(bytes) !== expectedSha256 || !bytes.length || receipt.artifact.size !== bytes.length) {
    throw new Error('Unsigned APK bytes differ from the validated build')
  }
  return receipt
}

export async function signAndroidRelease({ identity, context, receipt, apk, expectedSha256, tools, output, verification, env = process.env }) {
  const bytes = await readFile(apk)
  assertUnsignedReceipt({ identity, context, receipt, bytes, expectedSha256 })
  const toolEnv = toolEnvironment(env)
  assertAndroidApkMetadata({ identity, ...apkMetadata(apk, tools, toolEnv) })
  for (const key of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    if (typeof env[key] !== 'string' || !env[key].length) throw new Error(`Missing signing credential: ${key}`)
  }
  const base64 = env.ANDROID_KEYSTORE_BASE64.replace(/\s/g, '')
  const keyBytes = Buffer.from(base64, 'base64')
  if (!keyBytes.length || keyBytes.length > 16 * 1024 * 1024 || keyBytes.toString('base64') !== base64) throw new Error('Invalid signing keystore encoding')
  const temporary = await mkdtemp(join(tmpdir(), 'lumatile-signing-'))
  try {
    const key = join(temporary, 'signing.jks')
    const aligned = join(temporary, 'aligned.apk')
    const signed = join(temporary, 'signed.apk')
    await writeFile(key, keyBytes, { mode: 0o600, flag: 'wx' })
    tool(join(tools, 'zipalign'), ['-P', '16', '-f', '4', apk, aligned], toolEnv)
    tool(join(tools, 'apksigner'), ['sign', '--ks', key, '--ks-key-alias', env.ANDROID_KEY_ALIAS,
      '--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:ANDROID_KEY_PASSWORD', '--out', signed, aligned],
    { ...toolEnv, ANDROID_KEYSTORE_PASSWORD: env.ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD: env.ANDROID_KEY_PASSWORD })
    const signature = tool(join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', signed], toolEnv)
    const checks = assertAndroidApkIdentity({ identity, signature, ...apkMetadata(signed, tools, toolEnv) })
    const finalBytes = await readFile(signed)
    const report = { platform: identity.platform, channel: identity.channel, version: identity.version, commit: identity.commit, target: identity.target,
      purpose: identity.purpose === 'candidate' ? 'candidate' : 'release', deployable: identity.purpose !== 'candidate', verified: true,
      checks: { ...checks, unsignedSha256: expectedSha256, signedSha256: sha256(finalBytes), signedSize: finalBytes.length,
        runId: context.runId, runAttempt: context.runAttempt } }
    await copyFile(signed, output, constants.COPYFILE_EXCL)
    await writeFile(verification, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    return report
  } finally {
    keyBytes.fill(0)
    await rm(temporary, { recursive: true, force: true })
  }
}
