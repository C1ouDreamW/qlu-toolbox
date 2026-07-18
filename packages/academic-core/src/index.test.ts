import { describe, expect, it } from 'vitest'
import {
  EXPORT_COLUMNS,
  academicYearLabel,
  buildExportBody,
  calculateGpa,
  defaultAcademicYear,
  gradePoint,
  parseGradeRows,
  semesterNumber,
  suggestedGradeFileName,
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
