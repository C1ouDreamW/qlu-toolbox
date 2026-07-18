export const UPDATE_APPLICATION_ID = 'io.github.c1oudreamw.lumatile'

export interface CurrentAppVersion {
  applicationId: string
  versionCode: number
  versionName: string
}

export interface UpdateManifest {
  schemaVersion: 1
  applicationId: string
  versionCode: number
  versionName: string
  channel: 'stable' | 'beta'
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
}

export interface UpdateDownloadProgress {
  state: 'downloading' | 'ready'
  received?: number
  total?: number
  percent?: number
  message?: string
}
