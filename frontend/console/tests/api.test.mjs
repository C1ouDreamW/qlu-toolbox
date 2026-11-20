import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createApi } from '../public/api.mjs'

test('uses API-host credentials and replaces the CSRF token after login', async () => {
  const requests = []
  const values = [
    { user: null, csrfToken: 'before-login' },
    { user: 'operator', csrfToken: 'after-login' },
    { mode: 'server' },
  ]
  const request = createApi(async (url, options) => {
    requests.push({ url, ...options })
    return Response.json(values.shift())
  })
  await request('/v1/auth/session')
  await request('/v1/auth/session', 'POST', { username: 'operator', password: 'synthetic' })
  await request('/v1/distribution-policies/android', 'PUT', { mode: 'server' })
  assert.ok(requests.every(({ url, credentials, redirect }) => url.startsWith('https://api.lumatile.cn/v1/') &&
    credentials === 'include' && redirect === 'error'))
  assert.equal(requests[0].headers['X-CSRFToken'], undefined)
  assert.equal(requests[1].headers['X-CSRFToken'], 'before-login')
  assert.equal(requests[2].headers['X-CSRFToken'], 'after-login')
})

test('withholds CSRF credentials from foreign URLs and notifies the app on session expiry', async () => {
  let expired = 0
  let fetched = 0
  const request = createApi(async () => {
    fetched++
    return Response.json({ code: 'session_required', detail: '请先登录' }, { status: 403 })
  }, () => { expired++ })
  await assert.rejects(request('https://console.lumatile.cn/v1/auth/session'), /接口地址无效/)
  await assert.rejects(request('/v1/auth/session', 'POST', {}), /刷新登录状态/)
  assert.equal(fetched, 0)
  await assert.rejects(request('/v1/operations'), /请先登录/)
  assert.equal(expired, 1)
})

test('static entry point loads the console modules and assets', async () => {
  const index = new URL('../public/index.html', import.meta.url)
  const markup = await readFile(index, 'utf8')
  assert.match(markup, /<title>LumaTile 控制台<\/title>/)
  assert.doesNotMatch(markup, /\{%|\{\{/)
  for (const match of markup.matchAll(/(?:src|href)="\/(\w[\w.-]+)"/g)) {
    assert.ok((await readFile(new URL(match[1], index))).length, match[1])
  }
  assert.deepEqual([...markup.matchAll(/id="view-(\w+)"/g)].map(match => match[1]),
    ['overview', 'feedback', 'publish', 'stats', 'operations', 'account'])
})
