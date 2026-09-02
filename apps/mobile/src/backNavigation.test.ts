import { describe, expect, it } from 'vitest'
import { isSecondBackPress } from './backNavigation'

describe('isSecondBackPress', () => {
  it('only accepts a second press within two seconds', () => {
    expect(isSecondBackPress(0, 1_000)).toBe(false)
    expect(isSecondBackPress(1_000, 3_000)).toBe(true)
    expect(isSecondBackPress(1_000, 3_001)).toBe(false)
  })
})
