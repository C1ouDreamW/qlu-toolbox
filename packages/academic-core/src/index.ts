import type {
  GPACourse,
  GPAScoreRow,
  GPASummary,
  GPAWorkbook,
  GradeWorkbookRows,
  SemesterCode,
} from '@lumatile/contracts'

export const GRADE_EXPORT_MAX_BYTES = 20 * 1024 * 1024
export const GRADE_EXPORT_CHUNK_CHARS = 128 * 1024

export const EXPORT_COLUMNS = [
  'kcmc@课程名称',
  'xnmmc@学年',
  'xqmmc@学期',
  'kkbmmc@开课学院',
  'kch@课程代码',
  'jxbmc@教学班',
  'xf@学分',
  'xmcj@成绩',
  'xmblmc@成绩分项',
] as const

export function defaultAcademicYear(now = new Date()): string {
  return String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1)
}

export function isAcademicYear(value: string): boolean {
  return /^20\d{2}$/.test(value)
}

export function semesterNumber(value: SemesterCode): '1' | '2' {
  return value === '3' ? '1' : '2'
}

export function semesterName(value: SemesterCode): '第一学期' | '第二学期' {
  return value === '3' ? '第一学期' : '第二学期'
}

export function academicYearLabel(value: string): string {
  if (!isAcademicYear(value)) throw new Error('学年参数无效')
  return `${value}-${Number(value) + 1}`
}

export function suggestedGradeFileName(academicYear: string, semester: SemesterCode): string {
  return `齐鲁工业大学分项成绩_${academicYearLabel(academicYear)}_第${semesterNumber(semester)}学期.xlsx`
}

export function buildExportBody(academicYear: string, selectedTerm: string): URLSearchParams {
  if (!isAcademicYear(academicYear)) throw new Error('学年参数无效')
  const body = new URLSearchParams()
  body.append('gnmkdmKey', 'N305005')
  body.append('xnm', academicYear)
  body.append('xqm', selectedTerm)
  body.append('dcclbh', 'JW_N305005_GLY')
  for (const column of EXPORT_COLUMNS) body.append('exportModel.selectCol', column)
  body.append('exportModel.exportWjgs', 'xls')
  body.append('fileName', '成绩单')
  return body
}

const LETTER_POINTS: Record<string, number> = {
  'A+': 5,
  A: 4.5,
  'A-': 4.2,
  'B+': 3.8,
  B: 3.5,
  'B-': 3.2,
  'C+': 2.8,
  C: 2.5,
  'C-': 2.2,
  D: 1.5,
  F: 0,
}
const CHINESE_POINTS: Record<string, number> = { 优秀: 4.5, 良好: 3.5, 中等: 2.5, 及格: 1.5, 不及格: 0 }

const REQUIRED_GPA_HEADERS = ['课程名称', '学分', '成绩', '成绩分项'] as const

export class GPAParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GPAParseError'
  }
}

function normalized(value: string): string {
  return value.replace(/\s+/g, '').replace(/^\ufeff/, '')
}

function finiteNumber(value: string): number | null {
  const candidate = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(candidate)) return null
  const result = Number(candidate)
  return Number.isFinite(result) ? result : null
}

export function gradePoint(score: string): number | null {
  const normalizedScore = normalized(score).toUpperCase()
  if (normalizedScore in LETTER_POINTS) return LETTER_POINTS[normalizedScore]
  if (normalizedScore in CHINESE_POINTS) return CHINESE_POINTS[normalizedScore]
  const numeric = finiteNumber(score)
  if (numeric === null || numeric < 0 || numeric > 100) return null
  if (numeric >= 95) return 5
  if (numeric >= 60) return numeric / 10 - 4.5
  return 0
}

export function parseGradeRows(source: GradeWorkbookRows): GPAWorkbook {
  if (!source.rows.length) throw new GPAParseError('Excel 中没有成绩数据')

  let headerRowIndex = -1
  let headers: string[] = []
  for (let index = 0; index < Math.min(source.rows.length, 10); index += 1) {
    const candidate = source.rows[index].map(normalized)
    const names = new Set(candidate)
    if (REQUIRED_GPA_HEADERS.every(name => names.has(name))) {
      headerRowIndex = index
      headers = candidate
      break
    }
  }
  if (headerRowIndex < 0) throw new GPAParseError('文件缺少课程名称、学分、成绩或成绩分项列')

  const columns = new Map<string, number>()
  headers.forEach((name, index) => { if (name) columns.set(name, index) })
  const groups = new Map<string, Record<string, string>[]>()
  for (const row of source.rows.slice(headerRowIndex + 1)) {
    const record: Record<string, string> = {}
    for (const [name, index] of columns) record[name] = (row[index] ?? '').trim()
    if (!Object.values(record).some(Boolean) || !record['课程名称']) continue
    const key = JSON.stringify([
      record['学年'] ?? '',
      record['学期'] ?? '',
      record['课程代码'] ?? '',
      record['教学班'] ?? '',
      record['课程名称'] ?? '',
    ])
    const records = groups.get(key) ?? []
    records.push(record)
    groups.set(key, records)
  }

  const courses: GPACourse[] = []
  const warnings: string[] = []
  let number = 0
  for (const records of groups.values()) {
    number += 1
    const first = records[0]
    const components: GPAScoreRow[] = records.map(record => ({
      name: record['成绩分项'] || '未命名分项',
      score: record['成绩'] || '',
      isFinal: ['总评', '总评成绩'].includes(normalized(record['成绩分项'] || '')),
    }))
    const finals = components.filter(component => component.isFinal)
    const finalScore = finals.at(-1)?.score ?? ''
    const credit = finiteNumber(first['学分'] || '')
    let point = finalScore ? gradePoint(finalScore) : null
    let issue = ''
    if (!finals.length) issue = '没有找到总评成绩'
    else if (new Set(finals.map(item => item.score)).size > 1) {
      issue = '存在多个不同的总评成绩'
      point = null
    } else if (credit === null || credit <= 0) issue = '学分无法识别'
    else if (point === null) issue = '总评成绩无法识别'

    const name = first['课程名称'] || '未命名课程'
    if (issue) warnings.push(`${name}：${issue}`)
    courses.push({
      id: `course-${number}`,
      name,
      code: first['课程代码'] || '',
      college: first['开课学院'] || '',
      teachingClass: first['教学班'] || '',
      academicYear: first['学年'] || '',
      semester: first['学期'] || '',
      credit,
      components,
      finalScore,
      gradePoint: point,
      included: !issue,
      issue,
    })
  }

  if (!courses.length) throw new GPAParseError('Excel 中没有可识别的课程')
  return {
    fileName: source.fileName,
    rowCount: [...groups.values()].reduce((sum, records) => sum + records.length, 0),
    courses,
    warnings,
  }
}

export function calculateGpa(courses: GPACourse[]): GPASummary {
  const selected = courses.filter(course => course.included && course.credit !== null && course.gradePoint !== null)
  const totalCredits = selected.reduce((sum, course) => sum + (course.credit ?? 0), 0)
  const totalGradePoints = selected.reduce(
    (sum, course) => sum + (course.credit ?? 0) * (course.gradePoint ?? 0),
    0,
  )
  return {
    selectedCourses: selected.length,
    totalCredits,
    totalGradePoints,
    averageGpa: totalCredits > 0 ? totalGradePoints / totalCredits : null,
  }
}
