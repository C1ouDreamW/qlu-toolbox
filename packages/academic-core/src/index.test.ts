import { describe, expect, it } from 'vitest'
import {
  EXPORT_COLUMNS,
  academicYearLabel,
  buildExportBody,
  calculateGpa,
  defaultAcademicYear,
  gradePoint,
  datesForWeek,
  isNoClassDate,
  meetingConflicts,
  parseScheduleBackup,
  parseScheduleRows,
  parseWeekExpression,
  parseGradeRows,
  semesterNumber,
  suggestedGradeFileName,
  visibleWeekdays,
  weekForDate,
} from './index'

describe('academic year and semester contracts', () => {
  it('changes the default academic year in August', () => {
    expect(defaultAcademicYear(new Date(2026, 6, 31))).toBe('2025')
    expect(defaultAcademicYear(new Date(2026, 7, 1))).toBe('2026')
  })

  it('keeps school request codes separate from workbook semester values', () => {
    expect(semesterNumber('3')).toBe('1')
    expect(semesterNumber('12')).toBe('2')
    expect(suggestedGradeFileName('2025', '12')).toContain('2025-2026_第2学期.xlsx')
  })

  it('rejects invalid academic years', () => {
    expect(() => academicYearLabel('2025-2026')).toThrow('学年参数无效')
  })
})

describe('schedule week rules', () => {
  it('expands ranges, odd weeks and even weeks', () => {
    expect(parseWeekExpression('1-6周')).toEqual([1, 2, 3, 4, 5, 6])
    expect(parseWeekExpression('1-7周(单)')).toEqual([1, 3, 5, 7])
    expect(parseWeekExpression('2-8周(双)')).toEqual([2, 4, 6, 8])
    expect(parseWeekExpression('1-6')).toEqual([1, 2, 3, 4, 5, 6])
    expect(parseWeekExpression('单1-7')).toEqual([1, 3, 5, 7])
    expect(parseWeekExpression('2,4,8')).toEqual([2, 4, 8])
  })
})

describe('QLU schedule workbook rows', () => {
  const rows = [
    ['2026-2027年第1学期', '', '', '某同学的课表', '', '', '', '学号：已脱敏'],
    ['时', '节', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
    ['上午', '1'],
    ['', '2'],
    ['', '3', '操作系统◇1-12周(3-4节)◇彩石北322323◇管老师,鹿老师◇教学班：(2026-2027-1)-B034910-03◇总学时：48◇学分：3.5'],
    ['', '4'],
    ['其他课程：操作系统管老师,鹿老师(共4周)/6-12周(双)/无  ;  软件工程综合设计吕老师,史老师(共2周)/16-17周/无'],
    ['注--内容顺序为：课程<>周次<>地点<>教师<>教学班<>考试方式<>选课备注<>总学时<>学分'],
  ]

  it('parses scheduled and pending meetings without retaining identity text', () => {
    const preview = parseScheduleRows({ fileName: '脱敏课表.xls', rows }, new Date('2026-09-02T08:00:00Z'))
    expect(preview.schedule).toMatchObject({
      academicYear: '2026-2027', semester: '1', startDate: '2026-09-07', totalWeeks: 19,
    })
    expect(preview.schedule.name).not.toContain('某同学')
    expect(preview.scheduledMeetings).toBe(1)
    expect(preview.pendingMeetings).toBe(2)
    expect(preview.schedule.courses[0].meetings[0]).toMatchObject({
      weekday: 1, startPeriod: 3, endPeriod: 4, weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    })
    expect(preview.schedule.courses.find(course => course.name === '软件工程综合设计')).toBeTruthy()
  })

  it('calculates weeks, dates, no-class days and automatic weekends', () => {
    const schedule = parseScheduleRows({ fileName: '脱敏课表.xls', rows }).schedule
    schedule.noClassDates = [{ date: '2026-09-08', reason: '专业活动' }]
    expect(weekForDate(schedule, new Date(2026, 8, 7))).toBe(1)
    expect(datesForWeek(schedule, 2)[0]).toEqual(new Date(2026, 8, 14))
    expect(isNoClassDate(schedule, new Date(2026, 8, 8))?.reason).toBe('专业活动')
    expect(visibleWeekdays(schedule, 1)).toEqual([1, 2, 3, 4, 5])
    schedule.courses[0].meetings.push({
      id: 'weekend', weeks: [1], weekday: 6, startPeriod: 1, endPeriod: 2,
      location: '', teachers: [], source: 'manual',
    })
    expect(visibleWeekdays(schedule, 1)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('detects overlapping meetings only on shared weeks', () => {
    const base = { weekday: 1, startPeriod: 1, endPeriod: 2, location: '', teachers: [], source: 'manual' as const }
    expect(meetingConflicts([
      { ...base, id: 'a', weeks: [1, 3] },
      { ...base, id: 'b', weeks: [2, 3], startPeriod: 2, endPeriod: 4 },
      { ...base, id: 'c', weeks: [1], startPeriod: 5, endPeriod: 6 },
    ])).toEqual([['a', 'b']])
  })

  it('validates shared backup data', () => {
    const schedule = parseScheduleRows({ fileName: '脱敏课表.xls', rows }).schedule
    expect(parseScheduleBackup(JSON.stringify(schedule)).name).toBe(schedule.name)
    expect(() => parseScheduleBackup('{"schemaVersion":99}')).toThrow('格式不受支持')
  })
})

describe('grade export body', () => {
  it('uses the selected page term without converting 12 to 2', () => {
    const body = buildExportBody('2025', '12')
    expect(body.get('xnm')).toBe('2025')
    expect(body.get('xqm')).toBe('12')
    expect(body.get('gnmkdmKey')).toBe('N305005')
    expect(body.get('dcclbh')).toBe('JW_N305005_GLY')
  })

  it('preserves all repeated export columns', () => {
    expect(buildExportBody('2025', '3').getAll('exportModel.selectCol')).toEqual([...EXPORT_COLUMNS])
  })
})

describe('grade point rules', () => {
  it('matches the desktop score mapping', () => {
    expect(gradePoint('95')).toBe(5)
    expect(gradePoint('90')).toBe(4.5)
    expect(gradePoint('60')).toBe(1.5)
    expect(gradePoint('59')).toBe(0)
    expect(gradePoint('A+')).toBe(5)
    expect(gradePoint('A')).toBe(4.5)
    expect(gradePoint('A-')).toBe(4.2)
    expect(gradePoint('B+')).toBe(3.8)
    expect(gradePoint('优秀')).toBe(4.5)
    expect(gradePoint('良好')).toBe(3.5)
    expect(gradePoint('0x50')).toBeNull()
    expect(gradePoint('unknown')).toBeNull()
  })
})

describe('GPA workbook rows', () => {
  const rows = [
    ['课程名称', '学年', '学期', '开课学院', '课程代码', '教学班', '学分', '成绩', '成绩分项'],
    ['大学英语 4', '2025-2026', '2', '外国语学院', 'B101004', '英语-07', '2.0', '86.68', '平时成绩(30%)'],
    ['大学英语 4', '2025-2026', '2', '外国语学院', 'B101004', '英语-07', '2.0', '73', '总评'],
    ['开放实验', '2025-2026', '2', '实验中心', 'X100', '实验-01', '1.0', '90', '实验成绩'],
  ]

  it('groups components and excludes courses without a final score', () => {
    const workbook = parseGradeRows({ fileName: '脱敏成绩.xlsx', rows })
    expect(workbook.rowCount).toBe(3)
    expect(workbook.courses).toHaveLength(2)
    expect(workbook.courses[0]).toMatchObject({ finalScore: '73', gradePoint: 2.8, included: true })
    expect(workbook.courses[0].components).toHaveLength(2)
    expect(workbook.courses[1]).toMatchObject({ included: false, issue: '没有找到总评成绩' })
  })

  it('calculates a credit-weighted GPA from selected valid courses', () => {
    const workbook = parseGradeRows({
      fileName: '脱敏成绩.xlsx',
      rows: [
        rows[0],
        ['课程一', '2025-2026', '2', '', 'A', '1', '2', '95', '总评'],
        ['课程二', '2025-2026', '2', '', 'B', '1', '3', '73', '总评成绩'],
      ],
    })
    expect(calculateGpa(workbook.courses)).toEqual({
      selectedCourses: 2,
      totalCredits: 5,
      totalGradePoints: 18.4,
      averageGpa: 3.6799999999999997,
    })
    workbook.courses[1].included = false
    expect(calculateGpa(workbook.courses).averageGpa).toBe(5)
  })

  it('rejects a workbook without required headers', () => {
    expect(() => parseGradeRows({ fileName: '错误.xlsx', rows: [['课程名称', '成绩']] })).toThrow(
      '文件缺少课程名称、学分、成绩或成绩分项列',
    )
  })
})
