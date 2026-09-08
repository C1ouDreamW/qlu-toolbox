import { describe, expect, it } from 'vitest'
import { formatMeetingSummary, formatWeekSummary } from './scheduleEditorText'

describe('formatWeekSummary', () => {
  it('shows a hint for empty selections', () => {
    expect(formatWeekSummary([])).toBe('未选择')
  })

  it('collapses a full contiguous range', () => {
    expect(formatWeekSummary([3, 1, 2, 4])).toBe('第 1-4 周')
  })

  it('collapses single-parity selections', () => {
    expect(formatWeekSummary([1, 3, 5, 7, 9])).toBe('第 1-9 周(单)')
    expect(formatWeekSummary([2, 4, 6, 8])).toBe('第 2-8 周(双)')
  })

  it('joins mixed runs with enumeration marks', () => {
    expect(formatWeekSummary([1, 2, 3, 5, 7, 8, 9])).toBe('第 1-3、5、7-9 周')
    expect(formatWeekSummary([1, 3, 4, 5])).toBe('第 1、3-5 周')
  })

  it('handles a single week', () => {
    expect(formatWeekSummary([6])).toBe('第 6 周')
  })
})

describe('formatMeetingSummary', () => {
  it('describes a scheduled meeting', () => {
    expect(formatMeetingSummary(1, 1, 2)).toBe('周一 第1-2节')
    expect(formatMeetingSummary(7, 10, 11)).toBe('周日 第10-11节')
  })

  it('marks pending meetings', () => {
    expect(formatMeetingSummary(null, null, null)).toBe('待安排')
    expect(formatMeetingSummary(3, null, null)).toBe('待安排')
  })
})
