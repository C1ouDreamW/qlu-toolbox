import { describe, expect, it } from 'vitest'
import { datesForWeek, parseQluScheduleDom, parseScheduleBackup, parseScheduleRows, parseWeekExpression, validateSchedule, weekForDate } from './index'

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
  it('expands multiple period ranges without filling the gap', () => {
    const course = preview('高等数学◇1-4周,7-9周(1-2节，5～6节)◇教室◇教师◇教学班：高数').schedule.courses[0]
    expect(course.meetings).toMatchObject([
      { weeks: [1,2,3,4,7,8,9], startPeriod: 1, endPeriod: 2 },
      { weeks: [1,2,3,4,7,8,9], startPeriod: 5, endPeriod: 6 },
    ])
    expect(() => preview('坏课程◇1-4周(0-2节)◇教室◇教师')).toThrow('课表中没有可识别的课程')
    const partial = preview(`${cell('正常课程')}\n坏课程◇1-4周(4-2节)◇教室◇教师`)
    expect(partial.warnings.some(warning => warning.includes('节次需在 1-11 内：4-2'))).toBe(true)
  })
it('splits wrapped course names in multi-course cells', () => {
    const course = (name: string, schedule: string, wrapped = false) =>
      `${name}${wrapped ? '\r\n' : ''}◇${schedule}(1-2节)◇教室◇教师◇教学班：${name}`
    const result = preview([
      course('高等数学', '1-15周(单)'),
      course('线性代数', '2-16周(双)', true),
      course('劳动教育', '第12周', true),
    ].join('\r\n'))
    expect(result.warnings).toEqual([])
    expect(result.schedule.courses.map(item => item.name)).toEqual(['高等数学', '线性代数', '劳动教育'])
    expect(result.schedule.courses[0].meetings[0].weeks).toEqual([1,3,5,7,9,11,13,15])
    expect(result.schedule.courses[1].meetings[0].weeks).toEqual([2,4,6,8,10,12,14,16])
    expect(result.schedule.courses[2].meetings[0].weeks).toEqual([12])
  })
  it('splits real教务 cells where course name is followed by a newline before ◇', () => {
    // 真实教务导出格式：课程名\r\n◇周次◇...，同一单元格可含多门课（单双周交替）
    const realCell = (name: string, weeks = '1-16周(1-2节)') =>
      `${name}\r\n◇${weeks}◇教室◇教师◇教学班：${name}`
    const single = preview(realCell('马克思主义基本原理', '1-14周(1-2节)')).schedule
    expect(single.courses).toHaveLength(1)
    expect(single.courses[0].meetings[0].weeks).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
    // 同一单元格两门课（单双周交替）
    const two = preview(
      realCell('毛概', '1-13周(单)(7-8节)') + '\r\n' + realCell('概率论', '2-16周(双)(7-8节)'),
    ).schedule
    expect(two.courses.map(c => c.name)).toEqual(['毛概', '概率论'])
    expect(two.courses[0].meetings[0].weeks).toEqual([1, 3, 5, 7, 9, 11, 13])
    expect(two.courses[1].meetings[0].weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
  })
  it('keeps 第N周 cells and trailing spaces before ◇ splittable', () => {
    const realCell = (name: string, weeks: string, tail = '') => `${name}${tail}\r\n◇${weeks}◇教室◇教师◇教学班：${name}`
    // 两门课都是「第N周」形态，不能被整体丢弃
    const singleWeeks = preview([realCell('形势与政策', '第3周(1-2节)'), realCell('劳动教育', '第12周(3-4节)')].join('\r\n'))
    expect(singleWeeks.warnings).toEqual([])
    expect(singleWeeks.schedule.courses.map(item => item.name)).toEqual(['形势与政策', '劳动教育'])
    expect(singleWeeks.schedule.courses[1].meetings[0].weeks).toEqual([12])
    // 同一单元格混合两种形态：直接跟 ◇ 与换行后跟 ◇ 混用
    const mixed = preview(['数据结构◇1-15周(1-2节)◇教室◇教师', realCell('操作系统', '2-16周(双)(3-4节)')].join('\r\n'))
    expect(mixed.warnings).toEqual([])
    expect(mixed.schedule.courses.map(item => item.name)).toEqual(['数据结构', '操作系统'])
    // 备注换行里的「… 3周 …」不得被误判为新课程块，仍按单门课解析
    const noted = preview(`${cell('甲')}\r\n备注：实习 3周 另行安排`)
    expect(noted.schedule.courses.map(item => item.name)).toEqual(['甲'])
    expect(singleWeeks.schedule.courses[0].meetings[0].weeks).toEqual([3])
    // 「◇ 前有空格」不得被误判为新课程块（英文说明里的 "xxx 3周" 不能触发切分）
    // 课程名后有行尾空格
    const trailing = preview([realCell('高等数学', '1-15周(单)(1-2节)', ' '), realCell('线性代数', '2-16周(双)(1-2节)')].join('\r\n'))
    expect(trailing.warnings).toEqual([])
    expect(trailing.schedule.courses.map(item => item.name)).toEqual(['高等数学', '线性代数'])
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
  it('parses semantic QLU DOM records strictly and keeps pending courses', () => {
    const result = parseQluScheduleDom({
      academicYear: '2026-2027', semester: '1', candidateCount: 1,
      records: [{
        name: '软件项目管理', weekday: 3, scheduleText: '(3-4节，7-8节)1-15周(单)',
        location: '彩石校区 彩石南215216', teacherText: '张老师，李老师', creditText: '2.5', note: '校企合作',
      }],
      pendingItems: ['专业实践王老师(共1周)/第18周/无'],
    }, new Date('2026-09-02T08:00:00Z'))
    expect(result.scheduledMeetings).toBe(2)
    expect(result.pendingMeetings).toBe(1)
    expect(result.schedule.courses[0]).toMatchObject({
      name: '软件项目管理', credit: 2.5, teachers: ['张老师', '李老师'], note: '校企合作',
    })
    expect(result.schedule.courses[0].meetings).toMatchObject([
      { weekday: 3, startPeriod: 3, endPeriod: 4, weeks: [1,3,5,7,9,11,13,15] },
      { weekday: 3, startPeriod: 7, endPeriod: 8, weeks: [1,3,5,7,9,11,13,15] },
    ])
    expect(() => parseQluScheduleDom({
      academicYear: '2026-2027', semester: '1', candidateCount: 2,
      records: [{ name: '只提取到一门', weekday: 1, scheduleText: '(1-2节)1-16周' }],
    })).toThrow('课程块数量不一致')
    expect(() => parseQluScheduleDom({
      academicYear: '2026-2027', semester: '1', candidateCount: 1,
      records: [{ name: '坏课程', weekday: 1, scheduleText: '(1-2节)错误周次', rawText: '坏课程原文' }],
    })).toThrow('坏课程原文')
  })
  it('merges only adjacent meetings with identical scheduling attributes', () => {
    const result = parseQluScheduleDom({
      academicYear: '2026-2027', semester: '1', candidateCount: 4,
      records: [
        { name: '合并课程', weekday: 1, scheduleText: '(1-2节)1-8周', location: 'A101', teacherText: '张老师' },
        { name: '合并课程', weekday: 1, scheduleText: '(3-4节)1-8周', location: 'A101', teacherText: '张老师' },
        { name: '合并课程', weekday: 1, scheduleText: '(6-7节)1-8周', location: 'A101', teacherText: '张老师' },
        { name: '合并课程', weekday: 1, scheduleText: '(8节)1-8周', location: 'A102', teacherText: '张老师' },
      ],
    }).schedule.courses[0].meetings
    expect(result).toMatchObject([
      { startPeriod: 1, endPeriod: 4, location: 'A101' },
      { startPeriod: 6, endPeriod: 7, location: 'A101' },
      { startPeriod: 8, endPeriod: 8, location: 'A102' },
    ])
  })
  it('aligns to Monday and handles spring academic year', () => {
    const book = preview().schedule
    book.startDate='2026-09-01'
    expect(datesForWeek(book,1)[0]).toEqual(new Date(2026,7,31))
    expect(weekForDate(book,new Date(2026,8,7))).toBe(2)
    expect(preview(cell('甲'),'2025-2026年第2学期').schedule.startDate).toBe('2026-03-01')
  })
})
