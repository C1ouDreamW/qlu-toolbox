import { describe, expect, it } from 'vitest'
import { nearbyWeeks, weekDeltaForSwipe } from './scheduleSwipe'

describe('schedule swipe', () => {
  it('keeps only the adjacent pages around the current week', () => {
    expect(nearbyWeeks(1, 19)).toEqual([1, 2])
    expect(nearbyWeeks(10, 19)).toEqual([9, 10, 11])
    expect(nearbyWeeks(19, 19)).toEqual([18, 19])
  })

  it('changes only after the threshold and stays inside the semester', () => {
    expect(weekDeltaForSwipe(-90, 400, 3, 19)).toBe(1)
    expect(weekDeltaForSwipe(90, 400, 3, 19)).toBe(-1)
    expect(weekDeltaForSwipe(-70, 400, 3, 19)).toBe(0)
    expect(weekDeltaForSwipe(90, 400, 1, 19)).toBe(0)
    expect(weekDeltaForSwipe(-90, 400, 19, 19)).toBe(0)
  })
})
