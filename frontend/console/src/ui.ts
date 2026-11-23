export const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
})

export function errorText(error: unknown) {
  if (!(error instanceof Error)) return '请求失败，请稍后重试'
  return error.message === 'Failed to fetch' ? '无法连接 API，请稍后重试' : error.message
}

export interface Status {
  text: string
  state?: 'loading' | 'error' | 'success' | 'empty'
}
