import { describe, expect, it } from 'vitest'
import type { ScheduleBook, ScheduleMeeting } from '@lumatile/contracts'
import { parseScheduleRows, scheduleSegments } from './index'

function book(ranges: [number, number][]): ScheduleBook {
  const schedule = parseScheduleRows({ fileName: 'synthetic.xls', rows: [
    ['2026-2027年第1学期'], ['', '星期一'], ['', '合成课程◇1-16周(1-2节)◇测试教室◇测试教师◇教学班：测试'],
  ] }).schedule
  const base = schedule.courses[0]
  schedule.courses = ranges.map(([startPeriod, endPeriod], index) => ({
    ...base, id: `course-${index}`, name: `合成课程${index}`, meetings: [{
      ...base.meetings[0], id: `meeting-${index}`, weekday: 1, startPeriod, endPeriod, weeks: [1, 3],
    }],
  }))
  return schedule
}

describe('schedule display segments', () => {
  it.each([
    [[1, 2], [1, 2]], [[5, 8], [7, 8]], [[5, 8], [6, 7]],
    [[1, 3], [3, 5]], [[1, 2], [2, 3], [3, 4]],
    [[1, 2], [3, 4]], [[1, 9], [1, 2], [3, 4], [7, 8]],
  ] as [number, number][][])('preserves coverage and all candidates for %j', (...ranges) => {
    const schedule = book(ranges)
    const original = JSON.stringify(schedule)
    const segments = scheduleSegments(schedule, 1)
    for (let period = 1; period <= 11; period += 1) {
      const expected = schedule.courses.flatMap(course => course.meetings)
        .filter(meeting => meeting.startPeriod! <= period && meeting.endPeriod! >= period).map(meeting => meeting.id).sort()
      const covering = segments.filter(segment => segment.startPeriod <= period && segment.endPeriod >= period)
      expect(covering).toHaveLength(expected.length ? 1 : 0)
      if (expected.length) expect(covering[0].candidates.map(item => item.meeting.id).sort()).toEqual(expected)
    }
    for (const segment of segments) {
      for (const candidate of segment.candidates) {
        const switched = scheduleSegments(schedule, 1, { [segment.key]: candidate.meeting.id })
        expect(switched.find(item => item.key === segment.key)?.item).toEqual(candidate)
        expect(switched.filter(item => item.key !== segment.key)).toEqual(segments.filter(item => item.key !== segment.key))
      }
    }
    expect(JSON.stringify(schedule)).toBe(original)
    schedule.courses.reverse()
    expect(scheduleSegments(schedule, 1)).toEqual(segments)
  })

  it('keeps explicit boundaries, continuation labels, and stable per-week choices', () => {
    const schedule = book([[5, 8], [7, 8]])
    const segments = scheduleSegments(schedule, 1)
    expect(segments.map(item => [item.startPeriod, item.endPeriod, item.continued, item.candidates.length]))
      .toEqual([[5, 6, false, 1], [7, 8, true, 2]])
    const choices = { [segments[1].key]: 'meeting-1' }
    expect(scheduleSegments(schedule, 1, choices)[1].item.meeting.id).toBe('meeting-1')
    expect(scheduleSegments(schedule, 3, choices)[1].item.meeting.id).toBe('meeting-0')
    expect(scheduleSegments({ ...schedule, id: 'another' }, 1, choices)[1].item.meeting.id).toBe('meeting-0')
    schedule.courses[1].meetings[0].startPeriod = 6
    expect(scheduleSegments(schedule, 1, choices)[1].item.meeting.id).toBe('meeting-0')
    schedule.courses.pop()
    expect(scheduleSegments(schedule, 1, choices)).toHaveLength(1)
  })

  it('filters weeks, weekdays and pending meetings without merging same-course meetings', () => {
    const schedule = book([[1, 2], [1, 2]])
    expect(scheduleSegments(schedule, 2)).toEqual([])
    const other = schedule.courses.pop()!.meetings[0]
    schedule.courses[0].meetings.push(other)
    expect(scheduleSegments(schedule, 1)[0].candidates).toHaveLength(2)
    other.weekday = 6
    schedule.weekendMode = 'hide'
    expect(scheduleSegments(schedule, 1)).toHaveLength(1)
    schedule.weekendMode = 'auto'
    expect(scheduleSegments(schedule, 1)).toHaveLength(2)
    other.weekday = null
    expect(scheduleSegments(schedule, 1)).toHaveLength(1)
    Object.assign(other, { weekday: 1, startPeriod: null } satisfies Partial<ScheduleMeeting>)
    expect(scheduleSegments(schedule, 1)[0].candidates).toHaveLength(1)
  })
})
