// Pure checks shared by native-tool verification and failure-boundary tests.
export function assertAndroidApkMetadata({ identity, badging, metadata }) {
  const debug = identity.purpose === 'rehearsal'
  const applicationId = debug ? identity.applicationId : 'io.github.c1oudreamw.lumatile'
  const versionName = debug ? identity.nativeVersionName : identity.version
  const packageLine = badging.split('\n')[0]
  if (!packageLine.includes(`name='${applicationId}'`) || !packageLine.includes(`versionCode='${identity.versionCode}'`) || !packageLine.includes(`versionName='${versionName}'`)) throw new Error('APK native metadata mismatch')
  const debuggable = /^application-debuggable(?:\s|$)/m.test(badging)
  if (debuggable !== debug) throw new Error('APK debuggable flag does not match its purpose')
  if (metadata.platform !== 'android' || metadata.version !== identity.version || metadata.versionCode !== identity.versionCode) throw new Error('APK Web metadata mismatch')
  return { nativeVersionCode: identity.versionCode, applicationId, debuggable }
}

export function assertAndroidApkIdentity({ identity, badging, signature, metadata, debugSigningSha256 }) {
  const checks = assertAndroidApkMetadata({ identity, badging, metadata })
  const debug = identity.purpose === 'rehearsal'
  const signers = [...signature.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})/g)]
  const expected = debug ? debugSigningSha256 : identity.androidSigningSha256
  if (!/^[a-f0-9]{64}$/.test(expected) || signers.length !== 1 || signers[0][1] !== expected) throw new Error('APK signing certificate mismatch')
  if (debug && (identity.signing !== 'debug' || expected === identity.androidSigningSha256 || checks.applicationId === 'io.github.c1oudreamw.lumatile')) throw new Error('Rehearsal must use an isolated Debug identity and non-production certificate')
  return { ...checks, signingSha256: expected }
}
