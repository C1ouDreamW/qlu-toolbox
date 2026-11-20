import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientBuildInputs = [
  '.github/workflows/ci.yml', '.gitattributes', 'package.json', 'package-lock.json',
  'packages/', 'config/release-versions.json', 'config/release-migration.json',
  'scripts/doctor.mjs', 'scripts/prepare-release.mjs', 'scripts/set-python-version.mjs',
  'scripts/release-config.mjs', 'scripts/verify-release-build.mjs',
  'scripts/rehearse-release.mjs', 'scripts/release-artifacts.mjs',
  'scripts/generate-desktop-update-manifest.mjs',
]
const windowsInputs = [
  'apps/desktop/scripts/', 'apps/desktop/assets/lumatile.ico', 'apps/desktop/installer-assets/',
]
const macosInputs = [
  'apps/desktop/assets/lumatile.icns', 'apps/desktop/installer-assets/entitlements.mac.plist',
  'scripts/detach-dmg.mjs', 'scripts/detach-dmg.sh',
]

function matches(path, input) {
  return input.endsWith('/') ? path.startsWith(input) : path === input
}

export function affectedChecks(paths) {
  if (paths === undefined) return { windows: true, macos: true, android: true, workflows: true, release: true, legacy: true }
  const files = paths.filter(path => !path.endsWith('.md'))
  const changed = (...inputs) => files.some(file => inputs.some(input => matches(file, input)))
  const windowsOnly = file => !macosInputs.includes(file) && windowsInputs.some(input => matches(file, input))
  const clients = changed(...clientBuildInputs)
  const desktop = clients || changed('.python-version', 'pyproject.toml', 'uv.lock', 'tests/desktop.test.mjs', 'tests/updates.test.mjs')
    || files.some(file => /^tests\/[^/]+\.py$/.test(file)
      || (file.startsWith('apps/desktop/') && !windowsOnly(file) && !macosInputs.includes(file)))
  const androidHelpers = changed('scripts/build-mobile.ps1', 'scripts/build-and-install-android.ps1')
  return {
    windows: desktop || files.some(windowsOnly),
    macos: desktop || changed(...macosInputs),
    android: clients || androidHelpers || changed('apps/mobile/', 'scripts/android-apk-verification.mjs'),
    workflows: androidHelpers || changed(
      '.github/workflows/', '.github/scripts/', 'scripts/workflow-powershell.mjs', 'deploy/server/promote-android.sh',
    ),
    release: changed(
      '.github/workflows/', 'package.json', 'package-lock.json', 'packages/release-contract/',
      'config/release-versions.json', 'config/release-migration.json', 'apps/mobile/package.json',
      'apps/desktop/python/lumatile/__init__.py',
    ) || files.some(file => (/^scripts\/.+\.mjs$/.test(file) && !['scripts/doctor.mjs', 'scripts/workflow-powershell.mjs'].includes(file))
      || (/^tests\/.+\.test\.mjs$/.test(file) && !['tests/desktop.test.mjs', 'tests/updates.test.mjs'].includes(file))),
    legacy: changed('deploy/update-source/', 'scripts/check-update-source.sh', '.github/workflows/ci.yml'),
  }
}

export function changedPaths(eventName, event, cwd = process.cwd()) {
  if (eventName === 'workflow_dispatch') return undefined
  const pull = eventName === 'pull_request'
  const before = pull ? event.pull_request?.base?.sha : event.before
  const after = pull ? event.pull_request?.head?.sha : event.after
  const isCommit = sha => /^[a-f0-9]{40}$/.test(sha) && sha !== '0'.repeat(40)
  if (!isCommit(before) || !isCommit(after)) return undefined
  try {
    const range = `${before}${pull ? '...' : '..'}${after}`
    // Treat both sides of a rename as changes, including moves between apps.
    return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range, '--'], {
      cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0').filter(Boolean)
  } catch {
    console.warn('Git comparison unavailable. Running all client checks.')
    return undefined
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const checks = affectedChecks(changedPaths(process.env.GITHUB_EVENT_NAME, event))
  const outputs = Object.entries(checks).map(([name, enabled]) => `${name}=${enabled}\n`).join('')
  appendFileSync(process.env.GITHUB_OUTPUT, outputs)
  console.log(outputs.trimEnd())
}
