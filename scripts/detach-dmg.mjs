import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const command = (name, args, input) => execFileSync(name, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 })
const canonical = path => { try { return realpathSync(path) } catch { return resolve(path) } }

export async function detachDmg({ mountpoint, run = command, normalize = canonical, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
  if (typeof mountpoint !== 'string' || !isAbsolute(mountpoint) || mountpoint === '/') throw new Error('Expected an absolute DMG mount directory')
  const target = normalize(mountpoint)
  const images = () => {
    try {
      const plist = run('hdiutil', ['info', '-plist'])
      const value = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '--', '-'], plist))
      if (!Array.isArray(value.images)) throw new Error('Invalid disk image inventory')
      return value.images
    } catch { throw new Error('Cannot inspect the current disk image inventory') }
  }
  const matches = images().filter(image => image['system-entities']?.some(entity => typeof entity['mount-point'] === 'string' && normalize(entity['mount-point']) === target))
  if (!matches.length) return { detached: true, alreadyDetached: true }
  if (matches.length !== 1) throw new Error('Ambiguous DMG mount directory')
  const image = matches[0], imagePath = image['image-path']
  const device = image['system-entities'].find(entity => /^\/dev\/disk\d+$/.test(entity['dev-entry']))?.['dev-entry']
  if (!device || typeof imagePath !== 'string' || !imagePath) throw new Error('Cannot identify the mounted DMG device')
  const remains = () => images().some(item => item['image-path'] === imagePath && item['system-entities']?.some(entity => entity['dev-entry'] === device))
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (!remains()) return { detached: true, device }
    try { run('hdiutil', ['detach', device]) } catch { /* A busy detach can finish asynchronously; inspect before retrying. */ }
    if (!remains()) return { detached: true, device }
    if (attempt < 5) await sleep(attempt * 1000)
  }
  throw new Error('DMG remains attached after five normal detach attempts')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: detach-dmg.mjs <mount-directory>')
    console.log(JSON.stringify(await detachDmg({ mountpoint: process.argv[2] })))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
