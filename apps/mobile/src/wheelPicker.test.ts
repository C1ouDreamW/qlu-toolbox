import { describe, expect, it } from 'vitest'
import {
  WHEEL_COPIES,
  baseIndexFor,
  clampIndexToLoop,
  indexForValue,
  normalizeIndex,
  optionValueAt,
  positionForIndex,
  targetIndexForDrag,
  targetIndexForTap,
  valueForIndex,
} from './wheelPicker'

const COUNT = 7
const ITEM = 44

describe('wheel index helpers', () => {
  it('starts in the middle copy and wraps back into it', () => {
    expect(baseIndexFor(0, COUNT)).toBe(Math.floor(WHEEL_COPIES / 2) * COUNT)
    expect(normalizeIndex(baseIndexFor(0, COUNT) - 1, COUNT)).toBe(baseIndexFor(COUNT - 1, COUNT))
    expect(normalizeIndex(baseIndexFor(COUNT - 1, COUNT) + 1, COUNT)).toBe(baseIndexFor(0, COUNT))
  })

  it('reads option values across copies', () => {
    expect(optionValueAt(baseIndexFor(3, COUNT), COUNT)).toBe(3)
    expect(optionValueAt(baseIndexFor(0, COUNT) - 4, COUNT)).toBe(3)
  })

  it('maps absolute indices back to option values, not positions', () => {
    const options = [10, 20, 30]
    expect(valueForIndex(baseIndexFor(0, 3), options)).toBe(10)
    expect(valueForIndex(baseIndexFor(2, 3), options)).toBe(30)
    expect(valueForIndex(baseIndexFor(0, 3) - 1, options)).toBe(30)
    expect(valueForIndex(baseIndexFor(2, 3) + 1, options)).toBe(10)
  })

  it('locates a value in the middle copy', () => {
    expect(indexForValue(5, COUNT, [1, 2, 3, 4, 5, 6, 7])).toBe(baseIndexFor(4, COUNT))
    expect(indexForValue(9, COUNT, [1, 2, 3])).toBeNull()
  })

  it('keeps drag targets within middle plus one copy', () => {
    expect(clampIndexToLoop(baseIndexFor(0, COUNT), COUNT)).toBe(baseIndexFor(0, COUNT))
    expect(clampIndexToLoop(0, COUNT)).toBe(COUNT)
    expect(clampIndexToLoop(WHEEL_COPIES * COUNT, COUNT)).toBe((WHEEL_COPIES - 1) * COUNT - 1)
  })
})

describe('wheel drag projection', () => {
  const start = baseIndexFor(2, COUNT)

  it('keeps index when released without movement', () => {
    expect(targetIndexForDrag({ startIndex: start, dragDelta: 0, velocity: 0, itemHeight: ITEM, optionCount: COUNT }))
      .toBe(start)
  })

  it('snaps to the nearest item after a slow drag', () => {
    expect(targetIndexForDrag({ startIndex: start, dragDelta: 50, velocity: 0, itemHeight: ITEM, optionCount: COUNT }))
      .toBe(baseIndexFor(1, COUNT))
  })

  it('extends momentum of an upward fling forward', () => {
    const target = targetIndexForDrag({ startIndex: start, dragDelta: -20, velocity: -1.5, itemHeight: ITEM, optionCount: COUNT })
    expect(target).toBeGreaterThan(baseIndexFor(2, COUNT))
  })

  it('clamps fast flings to three items', () => {
    expect(targetIndexForDrag({ startIndex: start, dragDelta: 0, velocity: -40, itemHeight: ITEM, optionCount: COUNT }))
      .toBe(start + 3)
    expect(targetIndexForDrag({ startIndex: start, dragDelta: 0, velocity: 40, itemHeight: ITEM, optionCount: COUNT }))
      .toBe(start - 3)
  })

  it('never leaves the loop window', () => {
    expect(targetIndexForDrag({ startIndex: baseIndexFor(0, COUNT), dragDelta: 0, velocity: -99, itemHeight: ITEM, optionCount: COUNT }))
      .toBeLessThan(WHEEL_COPIES * COUNT)
    expect(targetIndexForDrag({ startIndex: baseIndexFor(0, COUNT), dragDelta: 0, velocity: -99, itemHeight: ITEM, optionCount: COUNT }))
      .toBeGreaterThanOrEqual(COUNT)
  })
})

describe('wheel tap targeting', () => {
  const position = positionForIndex(baseIndexFor(2, COUNT), ITEM, 220)

  it('selects the item two rows below the highlight band', () => {
    expect(targetIndexForTap({ pointerY: 110 + 2 * ITEM, position, itemHeight: ITEM, optionCount: COUNT }))
      .toBe(baseIndexFor(4, COUNT))
  })

  it('selects the item two rows above the highlight band', () => {
    expect(targetIndexForTap({ pointerY: 110 - 2 * ITEM, position, itemHeight: ITEM, optionCount: COUNT }))
      .toBe(baseIndexFor(0, COUNT))
  })

  it('selects the center item when tapped on the highlight band', () => {
    expect(targetIndexForTap({ pointerY: 110, position, itemHeight: ITEM, optionCount: COUNT }))
      .toBe(baseIndexFor(2, COUNT))
  })
})

describe('wheel positioning', () => {
  it('centers the selected item in the viewport', () => {
    const position = positionForIndex(10, ITEM, 220)
    const centerY = position + 10.5 * ITEM
    expect(centerY).toBe(110)
  })
})
