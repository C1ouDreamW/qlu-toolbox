import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateStablePromotion } from './release-promotion.mjs'
import { resolveRelease } from './release-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const [platform, input] = process.argv.slice(2)
if (!['windows', 'macos', 'android'].includes(platform) || (input && !/^[a-f0-9]{40}$/.test(input))) throw new Error('Usage: node scripts/check-stable-promotion.mjs <windows|macos|android> [full-commit-sha]')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commit = input ?? git(['rev-parse', 'HEAD'])
const release = resolveRelease(JSON.parse(git(['show', `${commit}:config/release-versions.json`])), { platform, channel: 'stable' })
console.log(JSON.stringify(validateStablePromotion(root, { ...release, commit }), null, 2))
