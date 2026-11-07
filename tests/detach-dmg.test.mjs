import assert from 'node:assert/strict'
import test from 'node:test'
import { detachDmg } from '../scripts/detach-dmg.mjs'

const image = () => ({ 'image-path': '/build/debug.dmg', 'system-entities': [{ 'dev-entry': '/dev/disk5' }, { 'dev-entry': '/dev/disk5s1', 'mount-point': '/mount/debug' }] })
function fixture(change, initial = [image()]) {
  let state = initial
  const calls = [], delays = []
  const options = { mountpoint: '/mount/debug', normalize: value => value, sleep: async delay => { delays.push(delay) }, run(name, args, input) {
    if (name === 'plutil') return input
    if (args[0] === 'info') return JSON.stringify({ images: state })
    calls.push(args)
    const result = change(calls.length, state)
    if (result.state) state = result.state
    if (result.error) throw new Error('Resource busy')
    return ''
  } }
  return { options, calls, delays }
}

test('DMG cleanup retries the captured device after its mount path disappears', async () => {
  const f = fixture(attempt => attempt === 1 ? { state: [{ ...image(), 'system-entities': [{ 'dev-entry': '/dev/disk5' }] }], error: true } : { state: [] })
  assert.equal((await detachDmg(f.options)).detached, true)
  assert.deepEqual(f.calls, [['detach', '/dev/disk5'], ['detach', '/dev/disk5']])
  assert.deepEqual(f.delays, [1000])
})

test('an asynchronously completed detach is success even if hdiutil returned a busy error', async () => {
  const f = fixture(() => ({ state: [], error: true }))
  assert.equal((await detachDmg(f.options)).detached, true)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.delays, [])
})

test('persistent busy images remain a failure and are never force-detached', async () => {
  const f = fixture(() => ({ error: true }))
  await assert.rejects(detachDmg(f.options), /remains attached/)
  assert.equal(f.calls.length, 5)
  assert.ok(f.calls.every(args => args.length === 2 && args[1] === '/dev/disk5'))
})

test('already detached images are idempotent and a reused disk device does not detach a different image', async () => {
  const empty = fixture(() => { throw new Error('Must not detach') }, [])
  assert.equal((await detachDmg(empty.options)).alreadyDetached, true)
  const f = fixture(() => ({ state: [{ ...image(), 'image-path': '/other/unrelated.dmg' }], error: true }))
  assert.equal((await detachDmg(f.options)).detached, true)
  assert.equal(f.calls.length, 1)
})

test('unreadable or ambiguous inventory cannot be mistaken for successful cleanup', async () => {
  await assert.rejects(detachDmg({ mountpoint: '/mount/debug', run() { throw new Error('inspection failed') } }), /Cannot inspect/)
  const f = fixture(() => ({}), [image(), image()])
  await assert.rejects(detachDmg(f.options), /Ambiguous/)
  await assert.rejects(detachDmg({ ...f.options, mountpoint: '/' }), /absolute DMG mount/)
})
