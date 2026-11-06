import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { repositoryRoot, taggedRelease } from './release-artifacts.mjs'
import { validateMigrationPolicy } from '../electron/update-contract.mjs'

const [platform, tag, input, output] = process.argv.slice(2)
if (![platform, tag, input, output].every(Boolean)) throw new Error('Usage: node scripts/verify-release-build.mjs <platform> <tag> <app-or-apk> <output.json>')
const identity = taggedRelease(repositoryRoot, platform, tag)
const location = resolve(input)
const checks = {}
if (platform === 'android') {
  const tools = join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools', '36.0.0')
  const badging = execFileSync(join(tools, 'aapt'), ['dump', 'badging', location], { encoding: 'utf8' }).split('\n')[0]
  if (!badging.includes("name='io.github.c1oudreamw.lumatile'") || !badging.includes(`versionCode='${identity.versionCode}'`) || !badging.includes(`versionName='${identity.version}'`)) throw new Error('APK native metadata mismatch')
  const signature = execFileSync(join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', location], { encoding: 'utf8' })
  const signers = [...signature.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})/g)]
  if (signers.length !== 1 || signers[0][1] !== identity.androidSigningSha256) throw new Error('APK signing certificate differs from the verified production baseline')
  const metadata = JSON.parse(execFileSync('unzip', ['-p', location, 'assets/public/lumatile-version.json'], { encoding: 'utf8' }))
  if (metadata.platform !== 'android' || metadata.version !== identity.version || metadata.versionCode !== identity.versionCode) throw new Error('APK Web metadata mismatch')
  checks.signingSha256 = signers[0][1]
  checks.nativeVersionCode = identity.versionCode
} else {
  const asar = createRequire(import.meta.url)('@electron/asar')
  const resources = platform === 'macos' ? join(location, 'Contents', 'Resources') : join(location, 'resources')
  const archive = join(resources, 'app.asar')
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString())
  if (pkg.version !== identity.version) throw new Error('Packaged Electron version mismatch')
  const policy = validateMigrationPolicy(JSON.parse(asar.extractFile(archive, 'config/release-migration.json').toString()))
  if (policy.bridgeVersion !== identity.bridgeVersion) throw new Error('Packaged bridge policy mismatch')
  if (platform === 'macos') {
    const plistVersion = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(location, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim()
    if (plistVersion !== identity.version) throw new Error('macOS bundle version mismatch')
    if (execFileSync('lipo', ['-archs', join(location, 'Contents', 'MacOS', 'LumaTile')], { encoding: 'utf8' }).trim() !== 'arm64') throw new Error('Expected a native arm64 macOS executable')
    execFileSync('codesign', ['--verify', '--deep', '--strict', location])
    checks.signing = 'ad-hoc'
  } else {
    const nativeVersion = execFileSync('pwsh', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:LUMATILE_VERIFY_EXE).VersionInfo.ProductVersion'], {
      env: { ...process.env, LUMATILE_VERIFY_EXE: join(location, 'LumaTile.exe') }, encoding: 'utf8',
    }).trim()
    if (nativeVersion !== identity.version) throw new Error('Windows executable version mismatch')
    checks.signing = 'unsigned'
  }
  const worker = join(resources, 'backend', platform === 'windows' ? 'LumaTileWorker.exe' : 'LumaTileWorker')
  const messages = execFileSync(worker, ['--bridge'], { input: '{"id":"release-version","method":"bootstrap","params":{}}\n', encoding: 'utf8', timeout: 30_000 }).trim().split('\n').map(line => JSON.parse(line))
  const bootstrap = messages.find(message => message.id === 'release-version')?.result
  if (bootstrap?.version !== identity.version || bootstrap?.browserComponent?.error) throw new Error('Packaged Python bootstrap version or browser component check failed')
  checks.electronVersion = pkg.version
  checks.pythonVersion = bootstrap.version
}
await writeFile(resolve(output), `${JSON.stringify({ platform, version: identity.version, commit: identity.commit, target: identity.target, verified: true, checks }, null, 2)}\n`)
