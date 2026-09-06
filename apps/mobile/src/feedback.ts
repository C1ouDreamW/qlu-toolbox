const FEEDBACK_URL = 'https://lumatile.ishua.cloud/api/feedback'
const REQUEST_TIMEOUT_MS = 10_000

export interface FeedbackInput {
  type: 'bug' | 'suggestion'
  content: string
  contact: string
}

export async function submitFeedback(input: FeedbackInput, appVersion: string): Promise<{ id: string }> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        platform: 'android',
        appVersion,
        systemVersion: navigator.userAgent.slice(0, 120),
      }),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => ({})) as { id?: unknown; error?: unknown }
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `反馈服务返回 ${response.status}`)
    if (typeof result.id !== 'string') throw new Error('反馈服务响应无效')
    return { id: result.id }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('发送超时，请检查网络后重试')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}
