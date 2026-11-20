const origin = 'https://api.lumatile.cn'

export function createApi(fetcher, sessionEnded = () => {}) {
  let csrfToken

  return async function request(path, method = 'GET', data) {
    const url = new URL(path, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) {
      throw new Error('接口地址无效')
    }
    const headers = { Accept: 'application/json' }
    if (method !== 'GET') {
      if (!csrfToken) throw new Error('请先刷新登录状态')
      headers['X-CSRFToken'] = csrfToken
    }
    if (data !== undefined) headers['Content-Type'] = 'application/json'

    const response = await fetcher(url.href, {
      method, headers, credentials: 'include', cache: 'no-store', redirect: 'error',
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    if (response.status === 204) return undefined
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      if (result?.code === 'session_required') sessionEnded()
      if (result?.code === 'csrf_failed') throw new Error('登录验证已更新，请刷新页面后重试')
      throw Object.assign(new Error(result?.detail || `请求失败 (${response.status})`), { status: response.status })
    }
    if (!result) throw new Error('服务器返回了无效的响应')
    if (typeof result.csrfToken === 'string') csrfToken = result.csrfToken
    return result
  }
}

export const resource = createApi(fetch, () => window.dispatchEvent(new Event('console-session-ended')))
