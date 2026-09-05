import type {
  GPACourse,
  GPAScoreRow,
  GPASummary,
  GPAWorkbook,
  GradeWorkbookRows,
  NoClassDate,
  PeriodTime,
  ScheduleBook,
  ScheduleCourse,
  ScheduleImportPreview,
  ScheduleMeeting,
  SemesterCode,
} from '@lumatile/contracts'

export const GRADE_EXPORT_MAX_BYTES = 20 * 1024 * 1024
export const GRADE_EXPORT_CHUNK_CHARS = 128 * 1024

export const QLU_PERIODS: PeriodTime[] = [
  ['08:30', '09:15'], ['09:20', '10:05'], ['10:25', '11:10'], ['11:15', '12:00'],
  ['13:30', '14:15'], ['14:20', '15:05'], ['15:20', '16:05'], ['16:05', '16:50'],
  ['17:50', '18:35'], ['18:35', '19:20'], ['19:30', '20:15'],
].map(([start, end], index) => ({ period: index + 1, start, end }))

export const SCHEDULE_COLORS = [
  '#4F86C6', '#E77792', '#7B6FD0', '#2CA6A4', '#E4875D', '#5D9B76', '#A66DB0', '#C18B35',
] as const

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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function parseWeekExpression(value: string, totalWeeks = 30): number[] {
  const weeks = new Set<number>()
  const normalizedValue = value.replace(/[－—~～]/g, '-').replace(/\s+/g, '')
  const pattern = /(\d+)(?:-(\d+))?周(?:\((单|双)\))?/g
  for (const match of normalizedValue.matchAll(pattern)) {
    const start = Number(match[1])
    const end = Number(match[2] || match[1])
    const parity = match[3]
    for (let week = Math.max(1, start); week <= Math.min(totalWeeks, end); week += 1) {
      if (parity === '单' && week % 2 === 0) continue
      if (parity === '双' && week % 2 !== 0) continue
      weeks.add(week)
    }
  }
  if (!weeks.size) {
    for (const token of normalizedValue.split(/[,，、;；]/)) {
      const match = token.match(/^(单|双)?(\d+)(?:-(\d+))?(单|双)?$/)
      if (!match) continue
      const parity = match[1] || match[4]
      const start = Number(match[2])
      const end = Number(match[3] || match[2])
      for (let week = Math.max(1, start); week <= Math.min(totalWeeks, end); week += 1) {
        if (parity === '单' && week % 2 === 0) continue
        if (parity === '双' && week % 2 !== 0) continue
        weeks.add(week)
      }
    }
  }
  return [...weeks].sort((left, right) => left - right)
}

function periodRange(value: string): [number | null, number | null] {
  const match = value.replace(/[－—~～]/g, '-').match(/\((\d+)(?:-(\d+))?节\)/)
  if (!match) return [null, null]
  return [Number(match[1]), Number(match[2] || match[1])]
}

function defaultTermSettings(academicYear: string, semester: string): { startDate: string; totalWeeks: number } {
  if (academicYear === '2026-2027' && semester === '1') return { startDate: '2026-09-07', totalWeeks: 19 }
  const year = Number(academicYear.slice(0, 4)) || new Date().getFullYear()
  return { startDate: `${year}-09-01`, totalWeeks: 20 }
}

function splitTeachers(value: string): string[] {
  return unique(value.split(/[,，、]/).map(item => item.trim()).filter(Boolean))
}

function parseCourseCell(value: string, weekday: number, number: number, totalWeeks: number): {
  course: Omit<ScheduleCourse, 'id' | 'color' | 'meetings'>
  meeting: ScheduleMeeting
} | null {
  const parts = value.replace(/\r?\n/g, '').split('◇').map(item => item.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const schedulePart = parts.find(part => /周.*节/.test(part)) || ''
  const scheduleIndex = parts.indexOf(schedulePart)
  const [startPeriod, endPeriod] = periodRange(schedulePart)
  const teachingClass = value.match(/教学班[：:]\s*([^◇]+)/)?.[1]?.trim() || ''
  const creditValue = finiteNumber(value.match(/学分[：:]\s*([\d.]+)/)?.[1] || '')
  const teachers = splitTeachers(parts[scheduleIndex + 2] || '')
  return {
    course: {
      name: parts[0],
      code: '',
      teachingClass,
      teachers,
      credit: creditValue,
      note: '',
    },
    meeting: {
      id: `meeting-${number}`,
      weeks: parseWeekExpression(schedulePart, totalWeeks),
      weekday,
      startPeriod,
      endPeriod,
      location: parts[scheduleIndex + 1] || '',
      teachers,
      source: 'imported',
    },
  }
}

function pendingNameAndTeachers(value: string, knownNames: string[]): { name: string; teachers: string[] } {
  const known = [...knownNames].sort((left, right) => right.length - left.length).find(name => value.startsWith(name))
  if (known) return { name: known, teachers: splitTeachers(value.slice(known.length)) }
  const comma = value.search(/[,，、]/)
  if (comma > 3) {
    const firstPart = value.slice(0, comma)
    const teacherLength = firstPart.length >= 3 ? 3 : 2
    return {
      name: firstPart.slice(0, -teacherLength).trim(),
      teachers: splitTeachers(`${firstPart.slice(-teacherLength)},${value.slice(comma + 1)}`),
    }
  }
  const single = value.match(/^(.+)([\u4e00-\u9fff]{3})$/)
  return single ? { name: single[1].trim(), teachers: [single[2]] } : { name: value.trim(), teachers: [] }
}

function mergeCourse(courses: ScheduleCourse[], parsed: ReturnType<typeof parseCourseCell> extends infer T ? Exclude<T, null> : never) {
  const key = parsed.course.teachingClass || parsed.course.code || parsed.course.name
  let course = courses.find(item => (item.teachingClass || item.code || item.name) === key)
  if (!course) {
    course = {
      ...parsed.course,
      id: `course-${courses.length + 1}`,
      color: SCHEDULE_COLORS[courses.length % SCHEDULE_COLORS.length],
      meetings: [],
    }
    courses.push(course)
  }
  course.teachers = unique([...course.teachers, ...parsed.course.teachers])
  course.meetings.push(parsed.meeting)
}

export class ScheduleParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleParseError'
  }
}

export function parseScheduleRows(source: GradeWorkbookRows, now = new Date()): ScheduleImportPreview {
  const headerIndex = source.rows.slice(0, 10).findIndex(row => row.some(cell => normalized(cell) === '星期一'))
  if (headerIndex < 0) throw new ScheduleParseError('课表中没有找到星期表头')
  const headers = source.rows[headerIndex].map(normalized)
  const dayColumns = new Map<number, number>()
  const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
  dayNames.forEach((name, day) => {
    const column = headers.indexOf(name)
    if (column >= 0) dayColumns.set(column, day + 1)
  })

  const heading = source.rows.slice(0, headerIndex + 1).flat().join(' ')
  const term = heading.match(/(20\d{2})-(20\d{2})年第([12])学期/)
  const academicYear = term ? `${term[1]}-${term[2]}` : `${now.getFullYear()}-${now.getFullYear() + 1}`
  const semester = term?.[3] || '1'
  const defaults = defaultTermSettings(academicYear, semester)
  const courses: ScheduleCourse[] = []
  const warnings: string[] = []
  let meetingNumber = 0

  for (const row of source.rows.slice(headerIndex + 1)) {
    if (normalized(row[0] || '').startsWith('其他课程')) break
    for (const [column, weekday] of dayColumns) {
      const value = (row[column] || '').trim()
      if (!value) continue
      const parsed = parseCourseCell(value, weekday, ++meetingNumber, defaults.totalWeeks)
      if (parsed) mergeCourse(courses, parsed)
      else warnings.push(`无法识别课程单元格：${value.slice(0, 20)}`)
    }
  }

  const other = source.rows.find(row => normalized(row[0] || '').startsWith('其他课程'))?.[0] || ''
  const pendingItems = other.replace(/^\s*其他课程[：:]?/, '').split(/\s*;\s*/).map(item => item.trim()).filter(Boolean)
  for (const item of pendingItems) {
    const [identity = '', weeksText = '', location = ''] = item.split('/').map(part => part.trim())
    const withoutCount = identity.replace(/\(共\d+周\)$/, '')
    const { name, teachers } = pendingNameAndTeachers(withoutCount, courses.map(course => course.name))
    const teachingClass = ''
    const key = name
    let course = courses.find(candidate => candidate.name === key)
    if (!course) {
      course = {
        id: `course-${courses.length + 1}`,
        name,
        code: '',
        teachingClass,
        teachers,
        credit: null,
        color: SCHEDULE_COLORS[courses.length % SCHEDULE_COLORS.length],
        note: '',
        meetings: [],
      }
      courses.push(course)
    }
    meetingNumber += 1
    course.teachers = unique([...course.teachers, ...teachers])
    course.meetings.push({
      id: `meeting-${meetingNumber}`,
      weeks: parseWeekExpression(weeksText, defaults.totalWeeks),
      weekday: null,
      startPeriod: null,
      endPeriod: null,
      location: location === '无' ? '' : location,
      teachers,
      source: 'imported',
    })
  }

  if (!courses.length) throw new ScheduleParseError('课表中没有可识别的课程')
  const timestamp = now.toISOString()
  const schedule: ScheduleBook = {
    schemaVersion: 1,
    id: `schedule-${now.getTime()}`,
    name: `${academicYear} 第${semester}学期课表`,
    academicYear,
    semester,
    ...defaults,
    weekendMode: 'show',
    periods: QLU_PERIODS.map(period => ({ ...period })),
    noClassDates: [],
    courses,
    updatedAt: timestamp,
  }
  const meetings = courses.flatMap(course => course.meetings)
  return {
    schedule,
    scheduledMeetings: meetings.filter(meeting => meeting.weekday !== null).length,
    pendingMeetings: meetings.filter(meeting => meeting.weekday === null).length,
    warnings,
  }
}

export function weekForDate(schedule: ScheduleBook, date = new Date()): number {
  const start = new Date(`${schedule.startDate}T00:00:00`)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((target.getTime() - start.getTime()) / 604_800_000) + 1
}

export function datesForWeek(schedule: ScheduleBook, week: number): Date[] {
  const start = new Date(`${schedule.startDate}T00:00:00`)
  start.setDate(start.getDate() + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
}

export function isNoClassDate(schedule: ScheduleBook, date: Date): NoClassDate | undefined {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return schedule.noClassDates.find(item => item.date === key)
}

export function visibleWeekdays(schedule: ScheduleBook, week: number): number[] {
  if (schedule.weekendMode === 'show') return [1, 2, 3, 4, 5, 6, 7]
  if (schedule.weekendMode === 'hide') return [1, 2, 3, 4, 5]
  const hasWeekend = schedule.courses.some(course => course.meetings.some(
    meeting => (meeting.weekday === 6 || meeting.weekday === 7) && meeting.weeks.includes(week),
  ))
  return hasWeekend ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]
}

export function meetingConflicts(meetings: ScheduleMeeting[]): [string, string][] {
  const scheduled = meetings.filter(meeting => meeting.weekday && meeting.startPeriod && meeting.endPeriod)
  const conflicts: [string, string][] = []
  for (let left = 0; left < scheduled.length; left += 1) {
    for (let right = left + 1; right < scheduled.length; right += 1) {
      const a = scheduled[left]
      const b = scheduled[right]
      if (a.weekday !== b.weekday || Math.max(a.startPeriod!, b.startPeriod!) > Math.min(a.endPeriod!, b.endPeriod!)) continue
      if (a.weeks.some(week => b.weeks.includes(week))) conflicts.push([a.id, b.id])
    }
  }
  return conflicts
}

export function parseScheduleBackup(payload: string): ScheduleBook {
  let value: unknown
  try { value = JSON.parse(payload) } catch { throw new ScheduleParseError('课表备份不是有效的 JSON 文件') }
  const schedule = value as Partial<ScheduleBook>
  if (schedule.schemaVersion !== 1 || !schedule.id || !schedule.name || !Array.isArray(schedule.courses)) {
    throw new ScheduleParseError('课表备份格式不受支持')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.startDate || '') || !Number.isInteger(schedule.totalWeeks)
    || schedule.totalWeeks! < 1 || schedule.totalWeeks! > 30) {
    throw new ScheduleParseError('课表备份中的校历参数无效')
  }
  return schedule as ScheduleBook
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
