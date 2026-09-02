export type Theme = 'light' | 'dark' | 'system'
export type SemesterCode = '3' | '12'
export type GradeStage =
  | 'idle'
  | 'checking_access'
  | 'opening_login'
  | 'waiting_login'
  | 'opening_scores'
  | 'querying'
  | 'downloading'
  | 'validating'
  | 'artifact_ready'
  | 'awaiting_save'
  | 'success'
  | 'cancelled'
  | 'failed'
  | 'interrupted'

export type TaskOutcome = 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted'
export type ArtifactState = 'none' | 'temporary' | 'saved' | 'unavailable'

export interface GradeExportOptions {
  academicYear: string
  semester: SemesterCode
  keepLoginState: boolean
}

export interface ArtifactHandle {
  id: string
  displayName: string
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  size: number
  sha256: string
  expiresAt: string | null
}

export interface SavedArtifact {
  uri: string
  displayName: string
  mimeType: string
  size: number
}

export interface GradeTaskSnapshot {
  taskId: string
  academicYear: string
  semester: SemesterCode
  stage: GradeStage
  outcome: TaskOutcome
  artifactState: ArtifactState
  message: string
  errorCode: string
  artifact: ArtifactHandle | null
  savedArtifact: SavedArtifact | null
  createdAt: string
  updatedAt: string
}

export interface GradeEvent {
  type: 'snapshot' | 'status' | 'transfer_progress' | 'artifact_ready' | 'artifact_saved' | 'save_cancelled' | 'cancelled' | 'interrupted' | 'error'
  seq: number
  taskId: string
  stage: GradeStage
  message: string
  code?: string
  loaded?: number
  total?: number
  artifact?: ArtifactHandle
  savedArtifact?: SavedArtifact
}

export interface MobileSettings {
  theme: Theme
  keepLoginState: boolean
}

export interface GradeWorkbookRows {
  fileName: string
  rows: string[][]
}

export interface GPAScoreRow {
  name: string
  score: string
  isFinal: boolean
}

export interface GPACourse {
  id: string
  name: string
  code: string
  college: string
  teachingClass: string
  academicYear: string
  semester: string
  credit: number | null
  components: GPAScoreRow[]
  finalScore: string
  gradePoint: number | null
  included: boolean
  issue: string
}

export interface GPAWorkbook {
  fileName: string
  rowCount: number
  courses: GPACourse[]
  warnings: string[]
}

export interface GPASummary {
  selectedCourses: number
  totalCredits: number
  totalGradePoints: number
  averageGpa: number | null
}

export type WeekendMode = 'auto' | 'show' | 'hide'
export type ScheduleStartPage = 'schedule' | 'toolbox' | 'last'

export interface PeriodTime {
  period: number
  start: string
  end: string
}

export interface NoClassDate {
  date: string
  reason: string
}

export interface ScheduleMeeting {
  id: string
  weeks: number[]
  weekday: number | null
  startPeriod: number | null
  endPeriod: number | null
  location: string
  teachers: string[]
  source: 'imported' | 'manual'
}

export interface ScheduleCourse {
  id: string
  name: string
  code: string
  teachingClass: string
  teachers: string[]
  credit: number | null
  color: string
  note: string
  meetings: ScheduleMeeting[]
}

export interface ScheduleBook {
  schemaVersion: 1
  id: string
  name: string
  academicYear: string
  semester: string
  startDate: string
  totalWeeks: number
  weekendMode: WeekendMode
  periods: PeriodTime[]
  noClassDates: NoClassDate[]
  courses: ScheduleCourse[]
  updatedAt: string
}

export interface ScheduleImportPreview {
  schedule: ScheduleBook
  scheduledMeetings: number
  pendingMeetings: number
  warnings: string[]
}

export interface StoredSchedule {
  id: string
  name: string
  payload: string
  updatedAt: string
  isActive: boolean
}

export interface ScheduleImportSource {
  kind: 'workbook' | 'backup'
  fileName: string
  rows?: string[][]
  payload?: string
}
