/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import fixture from '../../../packages/academic-core/src/credit-fixtures.json'

const script = readFileSync(new URL('../android/app/src/main/assets/credit-capture.js', import.meta.url), 'utf8')
const observer = readFileSync(new URL('../android/app/src/main/assets/credit-plan-observer.js', import.meta.url), 'utf8')
// 学校公共脚本覆盖标准数组方法，回调参数顺序是 (index, value)，与原生相反。
const schoolArrays = `
  Array.prototype.filter = function(callback) {
    const out = [];
    for (let index = 0; index < this.length; index++) if (callback(index, this[index], this)) out.push(this[index]);
    return out;
  };
  Array.prototype.some = function(callback) {
    for (let index = 0; index < this.length; index++) if (callback(index, this[index], this)) return true;
    return false;
  };
  Array.prototype.every = function() { return true; };
`
async function capture(mode = '', gradeResponse?: unknown, legacyArrays = false) {
  const calls: { path: string; body: string }[] = []
  async function runPage(phase: 'plan' | 'grades') {
    const window: { __LUMATILE_SCHEDULE_IMPORT__?: { result: string | null; base64: string } } = {}
    const pathname = '/jwglxt/' + (phase === 'plan' ? 'jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html' : 'cjcx/cjcx_cxDgXscj.html')
    const context = {
      window, location: { origin: mode === 'origin' ? 'https://sso.qlu.edu.cn' : 'https://jw.qlu.edu.cn', pathname, href: 'https://jw.qlu.edu.cn' + pathname },
      document: { querySelectorAll: (selector: string) => {
        expect(phase).toBe('grades')
        return (selector.includes('xnm') ? ['', 'all', '2026', '2025'] : ['', '3', '12']).map(value => ({ value }))
      } },
      AbortController, setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay === 3500 ? 1 : delay), clearTimeout, TextEncoder, crypto: webcrypto, btoa, URL,
      XMLHttpRequest: class { open() {} },
      fetch: async (path: string, options: RequestInit) => {
        calls.push({ path, body: String(options.body) })
        expect(options.redirect).toBe('error')
        expect(options.credentials).toBe('same-origin')
        let data: unknown = { items: [] }
        if (path.includes('cxJxzxjhckIndex')) {
          expect(phase).toBe('plan')
          if (mode === 'plan-failure') throw Error('unavailable')
          data = { items: [{ jxzxjhxx_id: 'synthetic' }] }
        }
        else if (path.includes('xdyqIndex')) {
          expect(phase).toBe('plan')
          return { ok: true, text: async () => fixture.html }
        }
        else if (path.includes('Kcxx')) data = [{ KCH: 'synthetic-map', KCMC: '合成映射课程' }]
        else if (path.includes('cjcx_cxXsgrcj')) {
          expect(phase).toBe('grades')
          if (mode === 'grade-failure') throw Error('network failure')
          if (mode === 'response' && new URLSearchParams(String(options.body)).get('xnm') === '2026') data = gradeResponse
          else if (mode === 'invalid') data = { error: 'expired' }
          else if (mode === 'pagination' || mode === 'pagination-mixed') {
            const currentPage = new URLSearchParams(String(options.body)).get('queryModel.currentPage')
            const items = [{ kch: 'page' + currentPage, kcmc: '合成公选课', xf: 1, cj: '90', xnm: '2026', xqm: '3' }]
            data = mode === 'pagination' ? { totalPage: 2, items }
              : { items: currentPage === '1' ? [...Array(999).fill(null), ...items] : items }
          } else data = { items: [{ kch: 'A', kcmc: '党史', xf: 1, cj: '90', kclbmc: '公共选修课', xnm: '2026', xqm: '3' }, { kch: 'void', cjsfzf: '是' }] }
        } else if (path.includes('xkmdcx')) {
          if (mode === 'enroll-failure') throw Error('unavailable')
          data = { items: [{ kch: 'A', kcmc: '党史', xnm: '2026', xqm: '3' }, { kch: 'B', kcmc: '消防安全', xf: 2, kclbmc: '公共选修课', xnm: '2026', xqm: '12' }] }
        }
        if (mode === 'mixed' && (path.includes('cjcx_cxXsgrcj') || path.includes('xkmdcx'))) {
          const batch = data as { items: unknown[] }
          batch.items = [null, '非课程记录', 0, false, [], ...batch.items, null]
        }
        return { ok: true, text: async () => JSON.stringify(data), clone: () => ({ text: async () => JSON.stringify(data) }) }
      },
    }
    if (phase === 'plan') {
      const pageWindow = Object.assign(window, { fetch: context.fetch })
      runInNewContext(observer, context)
      // 模拟培养方案页面自己的请求；采集脚本不得自行发起列表查询。
      await pageWindow.fetch(pathname + '?doType=query&gnmkdm=N153540', { credentials: 'same-origin', redirect: 'error' }).catch(() => {})
    } else Object.assign(window, { __LUMATILE_CREDIT_PLAN_READY__: true })
    runInNewContext((legacyArrays ? schoolArrays : '') + script, context)
    await expect.poll(() => window.__LUMATILE_SCHEDULE_IMPORT__?.result).toBeTruthy()
    const state = window.__LUMATILE_SCHEDULE_IMPORT__!
    return { result: JSON.parse(state.result!), bytes: state.base64 ? Buffer.from(state.base64, 'base64') : null, calls }
  }
  const plan = await runPage('plan')
  if (!plan.result.ok) return plan
  const grades = await runPage('grades')
  if (!grades.result.ok) return grades
  const planData = JSON.parse(plan.bytes!.toString('utf8'))
  expect(plan.result.sha256).toBe(Buffer.from(await webcrypto.subtle.digest('SHA-256', plan.bytes!)).toString('hex'))
  expect(planData.items).toEqual([])
  const data = JSON.parse(grades.bytes!.toString('utf8'))
  // 对应原生层：两个阶段分别验证摘要后，只在本机合并方案和成绩。
  data.html = planData.html
  data.course_map = planData.course_map
  data.warnings.push(...planData.warnings)
  expect(grades.result.sha256).toBe(Buffer.from(await webcrypto.subtle.digest('SHA-256', grades.bytes!)).toString('hex'))
  return { ...grades, bytes: Buffer.from(JSON.stringify(data)), plan }
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
  expect(calls.filter(call => call.path.includes('cxJxzxjhckIndex'))).toHaveLength(1)
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
it.each(['pagination', 'pagination-mixed'])('reads every grade page using the unfiltered page size: %s', async mode => {
  const { result, bytes, calls } = await capture(mode)
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

it.each([
  { items: null, totalResult: 0, totalPage: 0 },
  { totalResult: '0', totalPage: '0' },
])('continues to older grades after an explicitly empty semester: %j', async response => {
  const { result, bytes, calls } = await capture('response', response)
  expect(result.ok).toBe(true)
  expect(JSON.parse(bytes!.toString('utf8')).items.map((item: { kch: string }) => item.kch)).toEqual(['A', 'B'])
  expect(calls.filter(call => call.path.includes('cjcx_cxXsgrcj'))).toHaveLength(4)
})

it.each([
  null, {}, { error: 'expired' }, { items: null },
  { items: null, totalResult: 1, totalPage: 1 },
  { items: null, totalResult: null, totalPage: '' },
  { items: {}, totalResult: 0, totalPage: 0 },
])('rejects invalid responses without silently omitting grades: %j', async response => {
  const { result, bytes } = await capture('response', response)
  expect(result.ok).toBe(false)
  expect(bytes).toBeNull()
  expect(result.message).toContain('2026 学年（学期 3）')
  expect(result.message).toContain('教务响应格式异常')
})

it('matches the clean capture when grades and enrolments contain non-object entries, as on desktop', async () => {
  const clean = await capture()
  const mixed = await capture('mixed')
  expect(mixed.result.ok).toBe(true)
  expect(JSON.parse(mixed.bytes!.toString('utf8'))).toEqual(JSON.parse(clean.bytes!.toString('utf8')))
  expect(mixed.calls).toHaveLength(clean.calls.length)
})

it('captures the plan page XHR before collection starts and ignores unrelated responses', () => {
  class PageRequest extends EventTarget {
    responseType = ''
    responseText = ''
    open(_method: string, _url: string) {}
  }
  const window = { fetch: async () => { throw Error('no fetch expected') }, __LUMATILE_PLAN_LIST__: undefined as { items: unknown } | undefined }
  const pathname = '/jwglxt/jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html'
  const context = { window, URL, XMLHttpRequest: PageRequest, location: { origin: 'https://jw.qlu.edu.cn', pathname, href: 'https://jw.qlu.edu.cn' + pathname } }
  runInNewContext(observer, context)
  const request = new PageRequest()
  request.open('POST', 'https://untrusted.example' + pathname + '?doType=query')
  request.responseText = JSON.stringify({ items: [{ jxzxjhxx_id: 'wrong' }] })
  request.dispatchEvent(new Event('load'))
  expect(window.__LUMATILE_PLAN_LIST__!.items).toBeNull()
  request.open('POST', pathname + '?doType=query&gnmkdm=N153540')
  request.responseText = JSON.stringify({ items: [{ jxzxjhxx_id: 'synthetic' }] })
  request.dispatchEvent(new Event('load'))
  expect(window.__LUMATILE_PLAN_LIST__!.items).toEqual([{ jxzxjhxx_id: 'synthetic' }])
})

it('refuses to collect grades when the plan stage has not completed', async () => {
  const window: { __LUMATILE_SCHEDULE_IMPORT__?: { result: string } } = {}
  runInNewContext(script, { window, location: { origin: 'https://jw.qlu.edu.cn', pathname: '/jwglxt/cjcx/cjcx_cxDgXscj.html' } })
  await expect.poll(() => window.__LUMATILE_SCHEDULE_IMPORT__?.result).toBeTruthy()
  expect(JSON.parse(window.__LUMATILE_SCHEDULE_IMPORT__!.result).message).toContain('请先读取培养方案')
})

it('preserves grades, course maps and term options when school scripts override Array methods', async () => {
  const clean = await capture()
  const legacy = await capture('', undefined, true)
  expect(legacy.result.ok).toBe(true)
  expect(JSON.parse(legacy.bytes!.toString('utf8'))).toEqual(JSON.parse(clean.bytes!.toString('utf8')))
  expect(legacy.calls.map(call => [call.path, new URLSearchParams(call.body).get('xnm'), new URLSearchParams(call.body).get('xqm')]))
    .toEqual(clean.calls.map(call => [call.path, new URLSearchParams(call.body).get('xnm'), new URLSearchParams(call.body).get('xqm')]))
})
