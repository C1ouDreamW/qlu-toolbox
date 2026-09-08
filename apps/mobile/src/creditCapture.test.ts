/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import fixture from '../../../packages/academic-core/src/credit-fixtures.json'

const script = readFileSync(new URL('../android/app/src/main/assets/credit-capture.js', import.meta.url), 'utf8')
async function capture(mode = '') {
  const calls: { path: string; body: string }[] = []
  const window: { __LUMATILE_SCHEDULE_IMPORT__?: { result: string | null; base64: string } } = {}
  runInNewContext(script, {
    window, location: { origin: mode === 'origin' ? 'https://sso.qlu.edu.cn' : 'https://jw.qlu.edu.cn' },
    document: { querySelectorAll: (selector: string) => (selector.includes('xnm') ? ['2026', '2025'] : ['3', '12']).map(value => ({ value })) },
    AbortController, setTimeout, clearTimeout, TextEncoder, crypto: webcrypto, btoa,
    fetch: async (path: string, options: RequestInit) => {
      calls.push({ path, body: String(options.body) })
      expect(options.redirect).toBe('error')
      expect(options.credentials).toBe('same-origin')
      let data: unknown = { items: [] }
      if (path.includes('cxJxzxjhckIndex')) {
        if (mode === 'plan-failure') throw Error('unavailable')
        data = { items: [{ jxzxjhxx_id: 'synthetic' }] }
      }
      else if (path.includes('xdyqIndex')) return { ok: true, text: async () => fixture.html }
      else if (path.includes('Kcxx')) data = []
      else if (path.includes('cjcx_cxXsgrcj')) {
        if (mode === 'grade-failure') throw Error('network failure')
        if (mode === 'invalid') data = { error: 'expired' }
        else if (mode === 'pagination') {
          const currentPage = new URLSearchParams(String(options.body)).get('queryModel.currentPage')
          data = { totalPage: 2, items: [{ kch: 'page' + currentPage, kcmc: '合成公选课', xf: 1, cj: '90', xnm: '2026', xqm: '3' }] }
        } else data = { items: [{ kch: 'A', kcmc: '党史', xf: 1, cj: '90', kclbmc: '公共选修课', xnm: '2026', xqm: '3' }, { kch: 'void', cjsfzf: '是' }] }
      } else if (path.includes('xkmdcx')) {
        if (mode === 'enroll-failure') throw Error('unavailable')
        data = { items: [{ kch: 'A', kcmc: '党史', xnm: '2026', xqm: '3' }, { kch: 'B', kcmc: '消防安全', xf: 2, kclbmc: '公共选修课', xnm: '2026', xqm: '12' }] }
      }
      return { ok: true, text: async () => JSON.stringify(data) }
    },
  })
  await expect.poll(() => window.__LUMATILE_SCHEDULE_IMPORT__?.result).toBeTruthy()
  const state = window.__LUMATILE_SCHEDULE_IMPORT__!
  return { result: JSON.parse(state.result!), bytes: state.base64 ? Buffer.from(state.base64, 'base64') : null, calls }
}

it('captures plan, all semesters and latest enrolments with deduplication and a verified transfer digest', async () => {
  const { result, bytes, calls } = await capture()
  expect(result.ok).toBe(true)
  const data = JSON.parse(bytes!.toString('utf8'))
  expect(data.items.map((item: { kch: string }) => item.kch)).toEqual(['A', 'B'])
  expect(data.items[1].cj).toBe('')
  expect(data.html).toBe(fixture.html.trim())
  expect(calls.filter(call => call.path.includes('cjcx_cxXsgrcj'))).toHaveLength(4)
  expect(calls.filter(call => call.path.includes('xkmdcx')).every(call => call.body.includes('xnm=2026'))).toBe(true)
  expect(result.total).toBe(bytes!.length)
  expect(result.sha256).toBe(Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes!)).toString('hex'))
})
it.each(['grade-failure', 'invalid', 'origin'])('does not produce a report on %s', async mode => {
  const { result, bytes } = await capture(mode)
  expect(result.ok).toBe(false)
  expect(bytes).toBeNull()
})
it('makes missing enrolments visible', async () => {
  const { result, bytes } = await capture('enroll-failure')
  expect(result.ok).toBe(true)
  expect(JSON.parse(bytes!.toString('utf8')).warnings.join('')).toContain('在修课程读取失败')
})
it('reads every grade page', async () => {
  const { result, bytes, calls } = await capture('pagination')
  expect(result.ok).toBe(true)
  expect(JSON.parse(bytes!.toString('utf8')).items.slice(0, 2).map((item: { kch: string }) => item.kch)).toEqual(['page1', 'page2'])
  expect(calls.filter(call => call.path.includes('cjcx_cxXsgrcj'))).toHaveLength(8)
})
it('marks fallback when the plan cannot be loaded', async () => {
  const { result, bytes } = await capture('plan-failure')
  expect(result.ok).toBe(true)
  const data = JSON.parse(bytes!.toString('utf8'))
  expect(data.html).toBe('')
  expect(data.warnings.join('')).toContain('培养方案读取失败')
})
