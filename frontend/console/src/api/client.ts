import type { components, operations } from './schema'

export type Session = components['responses']['ConsoleSession']['content']['application/json']
export type Credentials = operations['createConsoleSession']['requestBody']['content']['application/json']
export type PasswordChange = operations['changeConsolePassword']['requestBody']['content']['application/json']
export type Feedback = components['schemas']['Feedback']
export type FeedbackPage = operations['listFeedbackSubmissions']['responses'][200]['content']['application/json']
export type Overview = operations['getConsoleOverview']['responses'][200]['content']['application/json']
export type Draft = components['schemas']['AnnouncementDraft']
export type DraftInput = components['requestBodies']['AnnouncementDraft']['content']['application/json']
export type StatisticsReport = components['schemas']['StatisticsReport']
export type OperationPage = operations['listOperations']['responses'][200]['content']['application/json']
export type DistributionPolicy = components['responses']['Policy']['content']['application/json']
export type Channel = NonNullable<operations['getActiveAnnouncement']['parameters']['path']>['channel']
type Announcement = components['responses']['Announcement']['content']['application/json']
type DraftList = operations['listAnnouncementDrafts']['responses'][200]['content']['application/json']

const origin = 'https://api.lumatile.cn'
const sessionPath = '/v1/auth/session'
const feedbackPath = '/v1/feedback-submissions'
const draftPath = '/v1/announcement-drafts'
const policyPath = '/v1/distribution-policies/android'
const announcementPath = (channel: Channel) => `/v1/channels/${encodeURIComponent(channel)}/active-announcement`

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export function createApi(fetcher: typeof fetch, sessionEnded = () => {}) {
  let csrfToken: string | undefined

  async function request<T>(path: string, method = 'GET', data?: object): Promise<T> {
    const url = new URL(path, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) throw new Error('接口地址无效')

    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = csrfToken
    if (method !== 'GET') {
      if (!token) throw new Error('请先刷新登录状态')
      headers['X-CSRFToken'] = token
    }
    if (data !== undefined) headers['Content-Type'] = 'application/json'

    const response = await fetcher(url.href, {
      method, headers, credentials: 'include', cache: 'no-store', redirect: 'error',
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    if (response.status === 204) return undefined as T
    const json: unknown = await response.json().catch(() => null)
    const result = json && typeof json === 'object' ? json as Record<string, unknown> : null
    if (!response.ok) {
      if (result?.code === 'session_required' && token === csrfToken) {
        csrfToken = undefined
        sessionEnded()
      }
      if (result?.code === 'csrf_failed') throw new ApiError(response.status, '登录验证已更新，请刷新页面后重试')
      const detail = typeof result?.detail === 'string' ? result.detail : `请求失败 (${response.status})`
      throw new ApiError(response.status, detail)
    }
    if (!result) throw new Error('服务器返回了无效的响应')
    if (typeof result.csrfToken === 'string') csrfToken = result.csrfToken
    return result as T
  }

  return {
    session: () => request<Session>(sessionPath),
    login: (credentials: Credentials) => request<Session>(sessionPath, 'POST', credentials),
    logout: () => request<Session>(sessionPath, 'DELETE'),
    changePassword: (passwords: PasswordChange) => request<Session>('/v1/auth/password', 'POST', passwords),
    overview: () => request<Overview>('/v1/overview'),
    async feedback(query: URLSearchParams | string) {
      const url = new URL(typeof query === 'string' ? query : `${feedbackPath}?${query}`, origin)
      if (url.pathname !== feedbackPath) throw new Error('接口地址无效')
      return request<FeedbackPage>(url.href)
    },
    setFeedbackStatus: (id: string, status: Feedback['status']) =>
      request<Feedback>(`${feedbackPath}/${encodeURIComponent(id)}`, 'PATCH', { status }),
    drafts: () => request<DraftList>(draftPath),
    createDraft: (draft: DraftInput) => request<Draft>(draftPath, 'POST', draft),
    updateDraft: (id: number, draft: DraftInput) => request<Draft>(`${draftPath}/${id}`, 'PUT', draft),
    deleteDraft: (id: number) => request<void>(`${draftPath}/${id}`, 'DELETE'),
    distribution: () => request<DistributionPolicy>(policyPath),
    setDistribution: (mode: DistributionPolicy['mode']) => request<DistributionPolicy>(policyPath, 'PUT', { mode }),
    activeAnnouncement: (channel: Channel) => request<Announcement>(announcementPath(channel)),
    publish: (channel: Channel, draftId: number) => request<Announcement>(announcementPath(channel), 'PUT', { draftId }),
    withdraw: (channel: Channel) => request<void>(announcementPath(channel), 'DELETE'),
    statistics: () => request<StatisticsReport>('/v1/statistics'),
    operations: (query: URLSearchParams) => request<OperationPage>(`/v1/operations?${query}`),
  }
}
