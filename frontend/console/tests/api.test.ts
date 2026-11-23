import { expect, test, vi } from 'vitest'
import { ApiError, createApi } from '../src/api/client'

test('sends API cookies and rotates the CSRF token after login and password changes', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ user: null, csrfToken: 'anonymous' }))
    .mockResolvedValueOnce(Response.json({ user: 'operator', csrfToken: 'signed-in' }))
    .mockResolvedValueOnce(Response.json({ user: 'operator', csrfToken: 'new-password' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  const api = createApi(fetcher)

  await api.session()
  await api.login({ username: 'operator', password: 'synthetic' })
  await api.changePassword({ old_password: 'synthetic', new_password1: 'replacement', new_password2: 'replacement' })
  await expect(api.withdraw('alpha')).resolves.toBeUndefined()
  expect(fetcher.mock.calls.map(([, options]) => (options?.headers as Record<string, string>)['X-CSRFToken']))
    .toEqual([undefined, 'anonymous', 'signed-in', 'new-password'])
  for (const [url, options] of fetcher.mock.calls) {
    expect(url).toMatch(/^https:\/\/api\.lumatile\.cn\/v1\//)
    expect(options).toMatchObject({ credentials: 'include', redirect: 'error', cache: 'no-store' })
  }
})

test('rejects foreign pagination links and writes without a CSRF token before fetching', async () => {
  const fetcher = vi.fn<typeof fetch>()
  const api = createApi(fetcher)
  await expect(api.feedback('https://console.lumatile.cn/v1/feedback-submissions')).rejects.toThrow('接口地址无效')
  await expect(api.feedback('/v1/operations')).rejects.toThrow('接口地址无效')
  await expect(api.login({ username: 'operator', password: 'synthetic' })).rejects.toThrow('请先刷新登录状态')
  expect(fetcher).not.toHaveBeenCalled()
})

test('announces session expiry and preserves a distinct CSRF error', async () => {
  const expire = vi.fn()
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ code: 'session_required', detail: '请先登录' }, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ user: null, csrfToken: 'anonymous' }))
    .mockResolvedValueOnce(Response.json({ code: 'csrf_failed' }, { status: 403 }))
  const api = createApi(fetcher, expire)

  await expect(api.operations(new URLSearchParams())).rejects.toMatchObject({ status: 403, message: '请先登录' })
  expect(expire).toHaveBeenCalledTimes(1)
  await api.session()
  await expect(api.login({ username: 'operator', password: 'synthetic' })).rejects.toEqual(
    new ApiError(403, '登录验证已更新，请刷新页面后重试'),
  )
  expect(expire).toHaveBeenCalledTimes(1)
})
