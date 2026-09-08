export type PageName = 'home' | 'tools' | 'tasks' | 'settings' | 'about' | 'grade' | 'gpa' | 'schedule' | 'credit'
export type Theme = 'light' | 'dark' | 'system'

import type { StoredSchedule } from '@lumatile/contracts'

export type {
  NoClassDate, PeriodTime, ScheduleBook, ScheduleCourse, ScheduleImportPreview,
  ScheduleImportSource, ScheduleMeeting, StoredSchedule, WeekendMode,
} from '@lumatile/contracts'

export interface Settings {
  schema_version: number
  welcome_accepted: boolean
  default_output_dir: string
  preferred_browser: 'auto' | 'edge' | 'chrome' | 'chromium'
  keep_login_state: boolean
  theme: Theme
  check_updates: boolean
  anonymous_stats: boolean
  start_page: 'schedule' | 'home' | 'last'
}

export interface Announcement {
  id: string
  title: string
  body: string
  level: 'info' | 'warning'
  url?: string
  expiresAt?: string
}

export interface TaskRecord {
  id: string; tool_id: string; tool_name: string; tool_version: string
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted'
  summary: string; result_path: string; error_message: string
  created_at: string; started_at: string; finished_at: string
}

export interface ToolManifest {
  id: string; name: string; description: string; category: string; version: string; icon_text: string
}

export interface BrowserComponentStatus {
  installed: boolean
  hasFiles: boolean
  installing: boolean
  version: string
  revision: string
  path: string
  executable: string
  sizeBytes: number
  downloadSizeMiB: number
  installedSizeMiB: number
  error: string
}

export interface BootstrapData {
  version: string
  settings: Settings
  tasks: TaskRecord[]
  schedules: StoredSchedule[]
  defaultAcademicYear: string
  semesters: Record<string, string>
  tool: ToolManifest
  tools: ToolManifest[]
  browserComponent: BrowserComponentStatus
  paths: Record<'settings' | 'tasks' | 'schedules' | 'logs' | 'profiles' | 'browsers' | 'data', string>
  metadata: Record<'author' | 'email' | 'github' | 'repository' | 'issues' | 'releases', string>
}

export interface GradeEvent {
  type: 'status' | 'log' | 'success' | 'error' | 'cancelled' | 'browser_required'
  stage?: string; message?: string; path?: string; code?: string
  downloadSizeMiB?: number; installedSizeMiB?: number
}

export interface ScheduleImportEvent {
  type: 'status' | 'log' | 'success' | 'error' | 'cancelled' | 'browser_required'
  stage?: string; message?: string; code?: string
  kind?: 'workbook'; fileName?: string; rows?: string[][]
}

export interface BrowserComponentEvent {
  type: 'progress' | 'success' | 'error' | 'cancelled'
  progress?: number
  message?: string
  status?: BrowserComponentStatus
}

export interface GPAScoreRow {
  name: string
  score: string
  is_final: boolean
}

export interface GPACourse {
  id: string
  name: string
  code: string
  college: string
  teaching_class: string
  academic_year: string
  semester: string
  credit: number | null
  components: GPAScoreRow[]
  final_score: string
  grade_point: number | null
  included: boolean
  issue: string
}

export interface GPAWorkbook {
  fileName: string
  filePath: string
  rowCount: number
  courses: GPACourse[]
  warnings: string[]
}

export interface CreditCourseStat {
  code: string
  name: string
  credit: number
  state: 'passed' | 'in_progress' | 'failed'
  score: string
  term: string
  module: string
  source: 'official' | 'keyword' | 'extra' | 'ignored'
}

export interface CreditSubStat {
  key: string
  label: string
  required: number
  earned: number
  in_progress: number
  gap: number
  satisfied: boolean
}

export interface CreditModuleStat {
  key: string
  label: string
  required: number
  earned: number
  in_progress: number
  gap: number
  satisfied: boolean
  art_only: boolean
  subs: CreditSubStat[]
  courses: CreditCourseStat[]
}

export interface CreditRecommendation {
  key: string
  label: string
  detail: string
  credit: number
}

export interface CreditReport {
  source: 'plan' | 'fallback'
  art_major: boolean
  total_required: number
  total_earned: number
  total_in_progress: number
  total_gap: number
  modules: CreditModuleStat[]
  unfulfilled: string[]
  recommendations: CreditRecommendation[]
  extra_elective: CreditCourseStat[]
  unmatched: CreditCourseStat[]
  snapshotDir?: string
}

export interface CreditEvent {
  type: 'status' | 'log' | 'success' | 'error' | 'cancelled' | 'browser_required'
  stage?: string; message?: string; code?: string; report?: CreditReport
}

export interface CreditRulesSub {
  key: string
  label: string
  required: number
  keywords: string[]
}

export interface CreditRulesModule {
  key: string
  label: string
  required: number
  art_only: boolean
  keywords: string[]
  subs: CreditRulesSub[]
}

export interface CreditRules {
  schema_version: number
  art_major: boolean
  total_required: number
  modules: CreditRulesModule[]
}
