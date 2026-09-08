import { afterEach, expect, it, vi } from 'vitest'
import { readScheduleDisplayChoices, saveScheduleDisplayChoices } from './scheduleDisplayChoices'

afterEach(() => vi.unstubAllGlobals())

it('stores choices per schedule and tolerates unavailable or malformed storage', () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  })
  expect(saveScheduleDisplayChoices('one', { segment: 'meeting' })).toBe(true)
  expect(readScheduleDisplayChoices('one')).toEqual({ segment: 'meeting' })
  expect(readScheduleDisplayChoices('two')).toEqual({})
  for (const value of ['null', '[]', '{broken', '{"bad":42,"valid":"meeting"}']) {
    data.set('lumatile.scheduleDisplayChoices.one', value)
    expect(readScheduleDisplayChoices('one')).toEqual(value.includes('valid') ? { valid: 'meeting' } : {})
  }
  vi.stubGlobal('localStorage', { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } })
  expect(readScheduleDisplayChoices('one')).toEqual({})
  expect(saveScheduleDisplayChoices('one', {})).toBe(false)
})
