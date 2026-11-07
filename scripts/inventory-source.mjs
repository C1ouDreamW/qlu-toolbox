import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { prepareRelease } from './prepare-release.mjs'
import { buildInformation, validateBuildInformation } from '../electron/channel-contract.mjs'
import { resolveRelease, validateReleaseConfig } from './release-config.mjs'
import { sha256 } from './release-artifacts.mjs'

const INPUTS = ['package.json', 'package-lock.json', 'apps/mobile/package.json', 'lumatile/__init__.py', 'config/release-versions.json', 'config/release-migration.json', 'README.md']

export async function assertInventorySource(root, information) {
  const info = validateBuildInformation(information)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  if (!/^[a-f0-9]{40}$/.test(info.commit) || git(['rev-parse', 'HEAD']).trim() !== info.commit) throw new Error('Inventory source commit differs from its build identity')
  if (git(['ls-files', '--others', '--exclude-standard', '-z']).length) throw new Error('Untracked source files must be reviewed and committed before generating release provenance')
  const changed = git(['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean)
  if (git(['diff', '--summary', 'HEAD']).trim()) throw new Error('Source file modes or names differ from the recorded commit')
  const carriers = info.platform === 'android' ? ['apps/mobile/package.json', 'package-lock.json'] : ['package.json', 'package-lock.json', 'lumatile/__init__.py']
  if (changed.some(file => !carriers.includes(file))) throw new Error('Source changes outside generated version carriers are not part of the recorded commit')
  const sources = Object.fromEntries(INPUTS.map(file => [file, git(['show', `${info.commit}:${file}`])]))
  const config = validateReleaseConfig(JSON.parse(sources['config/release-versions.json']))
  if (!isDeepStrictEqual(buildInformation(resolveRelease(config, { platform: info.platform, channel: info.channel }), info.commit), info)) throw new Error('Build identity differs from immutable version config')
  // Prepare only immutable source carriers in an isolated folder, then compare exact expected output.
  // This preserves dependency/build changes rather than treating all package.json changes as versions.
  const temporary = await mkdtemp(join(tmpdir(), 'lumatile-inventory-source-'))
  try {
    for (const [file, value] of Object.entries(sources)) {
      await mkdir(dirname(join(temporary, file)), { recursive: true }); await writeFile(join(temporary, file), value)
    }
    await prepareRelease({ root: temporary, platform: info.platform, channel: info.channel })
    for (const file of carriers) {
      const [expected, actual] = await Promise.all([readFile(join(temporary, file), 'utf8'), readFile(join(root, file), 'utf8')])
      const same = file.endsWith('.json') ? isDeepStrictEqual(JSON.parse(expected), JSON.parse(actual)) : expected === actual
      if (!same) throw new Error(`Version carrier contains changes outside the recorded source: ${file}`)
    }
  } finally { await rm(temporary, { recursive: true, force: true }) }
  const inputFiles = [...INPUTS, ...(info.platform === 'android' ? ['scripts/android-sbom.init.gradle'] : ['uv.lock', 'pyproject.toml', 'LumaTileWorker.spec'])]
  const inputs = Object.fromEntries(inputFiles.sort().map(file => [file, sha256(git(['show', `${info.commit}:${file}`]))]))
  const readme = sources['README.md']
  const marker = '## 使用说明与免责声明'
  const start = readme.indexOf(marker)
  if (start < 0) throw new Error('Missing project terms snapshot')
  const next = readme.indexOf('\n## ', start + marker.length)
  return { sourceInputs: inputs, projectTerms: readme.slice(start, next < 0 ? undefined : next).trim() + '\n' }
}
