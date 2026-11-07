import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { assertWindowsProductVersion, assertWindowsX64, repositoryRoot, taggedRelease } from './release-artifacts.mjs'
import { sha256 } from './release-artifacts.mjs'
import { rehearsalIdentity } from './rehearse-release.mjs'
import { validateMigrationPolicy } from '../electron/update-contract.mjs'
import { assertAndroidApkIdentity } from './android-apk-verification.mjs'
import { validateBuildInformation } from '../electron/channel-contract.mjs'

const { values, positionals } = parseArgs({ options: { rehearsal: { type: 'boolean' } }, allowPositionals: true })
const [platform, ...args] = positionals
const [tag, input, output] = values.rehearsal ? [null, ...args] : args
if (!platform || !input || !output || (!values.rehearsal && !tag)) throw new Error('Usage: node scripts/verify-release-build.mjs [--rehearsal] <platform> [tag] <app-or-apk> <output.json>')
const identity = values.rehearsal ? rehearsalIdentity(repositoryRoot, platform) : taggedRelease(repositoryRoot, platform, tag)
const location = resolve(input)
const checks = {}
if (platform === 'android') {
  const tools = join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools', '36.0.0')
  const badging = execFileSync(join(tools, 'aapt'), ['dump', 'badging', location], { encoding: 'utf8' })
  const signature = execFileSync(join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', location], { encoding: 'utf8' })
  const metadata = JSON.parse(execFileSync('unzip', ['-p', location, 'assets/public/lumatile-version.json'], { encoding: 'utf8' }))
  // This is the SDK's public, disposable Debug certificate; no long-term key is read.
  const debugSigningSha256 = values.rehearsal ? createHash('sha256').update(execFileSync('keytool', [
    '-exportcert', '-alias', 'androiddebugkey', '-storepass', 'android', '-keystore', process.env.LUMATILE_DEBUG_KEYSTORE_FILE || join(homedir(), '.android', 'debug.keystore'),
  ])).digest('hex') : undefined
  Object.assign(checks, assertAndroidApkIdentity({ identity, badging, signature, metadata, debugSigningSha256 }))
  const finalBytes = await readFile(location)
  Object.assign(checks, { signedSha256: sha256(finalBytes), signedSize: finalBytes.length })
} else {
  const asar = createRequire(import.meta.url)('@electron/asar')
  const resources = platform === 'macos' ? join(location, 'Contents', 'Resources') : join(location, 'resources')
  const archive = join(resources, 'app.asar')
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString())
  if (pkg.version !== identity.version) throw new Error('Packaged Electron version mismatch')
  const information = validateBuildInformation(JSON.parse(asar.extractFile(archive, 'lumatile/build-info.json').toString()))
  for (const key of ['platform', 'target', 'channel', 'version', 'applicationId', 'dataNamespace', 'commit']) {
    if (information[key] !== identity.information[key]) throw new Error(`Packaged build identity mismatch: ${key}`)
  }
  const policy = validateMigrationPolicy(JSON.parse(asar.extractFile(archive, 'config/release-migration.json').toString()))
  if (policy.bridgeVersion !== identity.bridgeVersion) throw new Error('Packaged bridge policy mismatch')
  if (platform === 'macos') {
    const plistVersion = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(location, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim()
    if (plistVersion !== information.baseVersion) throw new Error('macOS bundle version mismatch')
    const plist = join(location, 'Contents', 'Info.plist')
    if (execFileSync('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim() !== information.nativeBuildVersion ||
        execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim() !== information.applicationId) throw new Error('macOS native build identity mismatch')
    if (execFileSync('lipo', ['-archs', join(location, 'Contents', 'MacOS', information.productName)], { encoding: 'utf8' }).trim() !== 'arm64') throw new Error('Expected a native arm64 macOS executable')
    execFileSync('codesign', ['--verify', '--deep', '--strict', location])
    checks.signing = 'ad-hoc'
  } else {
    assertWindowsX64(await readFile(join(location, `${information.productName}.exe`)))
    const versions = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command', '$v = (Get-Item -LiteralPath $env:LUMATILE_VERIFY_EXE).VersionInfo; @{ProductVersion=$v.ProductVersion; FileVersion=$v.FileVersion} | ConvertTo-Json -Compress'], {
      env: { ...process.env, LUMATILE_VERIFY_EXE: join(location, `${information.productName}.exe`) }, encoding: 'utf8',
    }))
    if (versions.ProductVersion !== identity.version) assertWindowsProductVersion(versions.ProductVersion, information.baseVersion)
    if (versions.FileVersion !== information.nativeBuildVersion) throw new Error('Windows native build counter mismatch')
    checks.nativeProductVersion = versions.ProductVersion
    checks.nativeFileVersion = versions.FileVersion
    checks.signing = 'unsigned'
  }
  const worker = join(resources, 'backend', platform === 'windows' ? 'LumaTileWorker.exe' : 'LumaTileWorker')
  if (platform === 'windows') assertWindowsX64(await readFile(worker))
  else if (execFileSync('lipo', ['-archs', worker], { encoding: 'utf8' }).trim() !== 'arm64') throw new Error('Expected a native arm64 Python worker')
  const messages = execFileSync(worker, ['--bridge'], { input: '{"id":"release-version","method":"bootstrap","params":{}}\n', encoding: 'utf8', timeout: 30_000 }).trim().split('\n').map(line => JSON.parse(line))
  const bootstrap = messages.find(message => message.id === 'release-version')?.result
  if (bootstrap?.version !== identity.version || bootstrap?.browserComponent?.error) throw new Error('Packaged Python bootstrap version or browser component check failed')
  if (bootstrap?.build?.channel !== information.channel || bootstrap?.build?.dataNamespace !== information.dataNamespace || bootstrap?.build?.commit !== information.commit) throw new Error('Packaged Python channel mismatch')
  checks.electronVersion = pkg.version
  checks.pythonVersion = bootstrap.version
  checks.channel = information.channel
  checks.applicationId = information.applicationId
}
await writeFile(resolve(output), `${JSON.stringify({ platform, version: identity.version, commit: identity.commit, target: identity.target,
  purpose: values.rehearsal ? 'rehearsal' : 'release', deployable: !values.rehearsal, verified: true, checks }, null, 2)}\n`)
