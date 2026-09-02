import { describe, expect, it } from 'vitest'
import { weekDeltaForSwipe } from './scheduleSwipe'

describe('schedule swipe', () => {
  it('changes only after the threshold and stays inside the semester', () => {
    expect(weekDeltaForSwipe(-90, 400, 3, 19)).toBe(1)
    expect(weekDeltaForSwipe(90, 400, 3, 19)).toBe(-1)
    expect(weekDeltaForSwipe(-70, 400, 3, 19)).toBe(0)
    expect(weekDeltaForSwipe(90, 400, 1, 19)).toBe(0)
    expect(weekDeltaForSwipe(-90, 400, 19, 19)).toBe(0)
  })
})
