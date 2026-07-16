export type PageName = 'home' | 'tools' | 'tasks' | 'settings' | 'about' | 'grade' | 'gpa'
export type Theme = 'light' | 'dark' | 'system'

export interface Settings {
  schema_version: number
  welcome_accepted: boolean
  default_output_dir: string
  preferred_browser: 'auto' | 'edge' | 'chrome' | 'chromium'
  keep_login_state: boolean
  theme: Theme
  check_updates: boolean
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
  defaultAcademicYear: string
  semesters: Record<string, string>
  tool: ToolManifest
  tools: ToolManifest[]
  browserComponent: BrowserComponentStatus
  paths: Record<'settings' | 'tasks' | 'logs' | 'profiles' | 'browsers' | 'data', string>
  metadata: Record<'author' | 'email' | 'github' | 'repository' | 'issues' | 'releases', string>
}

export interface GradeEvent {
  type: 'status' | 'log' | 'success' | 'error' | 'cancelled' | 'browser_required'
  stage?: string; message?: string; path?: string; code?: string
  downloadSizeMiB?: number; installedSizeMiB?: number
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
