import { describe, expect, it } from 'vitest'
import { datesForWeek, parseScheduleBackup, parseScheduleRows, parseWeekExpression, validateSchedule, weekForDate } from './index'

const cell = (name: string, weeks = '1-16') => `${name}◇${weeks}周(1-2节)◇教室◇教师◇教学班：${name}`
const preview = (value = cell('甲'), term = '2026-2027年第1学期') => parseScheduleRows({fileName:'test.xls',rows:[[term],['','星期一'],['',value]]})
describe('schedule input boundaries', () => {
  it('validates every consumed backup field and real dates', () => {
    const book = preview().schedule
    expect(parseScheduleBackup(JSON.stringify(book))).toEqual(book)
    for (const patch of [{periods:undefined},{noClassDates:undefined},{totalWeeks:0},{startDate:'2026-02-30'},{courses:[null]}]) {
      expect(() => validateSchedule({...book,...patch})).toThrow()
    }
    expect(() => parseScheduleBackup('null')).toThrow('格式')
    book.periods[0].end = '08:00'
    expect(() => validateSchedule(book)).toThrow('上课时间')
  })
  it('preserves discrete, mixed and late weeks without partial acceptance', () => {
    expect(parseWeekExpression('1,3,5周')).toEqual([1,3,5])
    expect(parseWeekExpression('1-3周,5')).toEqual([1,2,3,5])
    expect(() => parseWeekExpression('1,错误,5')).toThrow()
    expect(preview(cell('甲','20-22')).schedule.totalWeeks).toBe(22)
    expect(preview(cell('甲','20-22')).schedule.courses[0].meetings[0].weeks).toEqual([20,21,22])
    expect(preview(cell('甲')+'\n'+cell('乙')).schedule.courses).toHaveLength(2)
  })
  it('accepts 第N周 expressions and degrades bad other-course items to warnings', () => {
    expect(parseWeekExpression('第18周')).toEqual([18])
    expect(parseWeekExpression('第1-3周,第5周')).toEqual([1,2,3,5])
    const result = parseScheduleRows({ fileName: 'test.xls', rows: [
      ['2026-2027年第1学期'], ['', '星期一'], ['', cell('甲')],
      ['其他课程：保密技术专业高级实践1李健,马宾(共1周)/第18周/无  ;   坏课程张三(共1周)/错误周次/无'],
    ] })
    const practice = result.schedule.courses.find(course => course.name.includes('高级实践'))
    expect(practice?.meetings[0]?.weeks).toEqual([18])
    expect(result.pendingMeetings).toBe(1)
    expect(result.warnings.some(warning => warning.includes('错误周次'))).toBe(true)
  })
  it('aligns to Monday and handles spring academic year', () => {
    const book = preview().schedule
    book.startDate='2026-09-01'
    expect(datesForWeek(book,1)[0]).toEqual(new Date(2026,7,31))
    expect(weekForDate(book,new Date(2026,8,7))).toBe(2)
    expect(preview(cell('甲'),'2025-2026年第2学期').schedule.startDate).toBe('2026-03-01')
  })
})
