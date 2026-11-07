export interface CurrentAppVersion {
  applicationId: string
  versionCode: number
  versionName: string
  channel: 'stable' | 'alpha' | 'debug'
}

export interface UpdateManifest {
  schemaVersion: 1
  applicationId: string
  versionCode: number
  versionName: string
  channel: 'stable' | 'alpha'
  tag?: string
  commit?: string
  title: string
  notes: string
  publishedAt: string
  apkUrl: string
  sha256: string
  size: number
  mandatory: boolean
}

export interface AvailableUpdate extends UpdateManifest {
  source: string
  fallbackApkUrls?: string[]
}

export interface UpdateDownloadProgress {
  state: 'downloading' | 'ready'
  received?: number
  total?: number
  percent?: number
  message?: string
}

export interface Announcement {
  id: string
  title: string
  body: string
  level: 'info' | 'warning'
  url?: string
  expiresAt?: string
}
