import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { Draft, DraftInput, Feedback, Session, StatisticsReport } from '../src/api/client'

const site = 'http://127.0.0.1:4177'
const api = 'https://api.lumatile.cn'
const nginx = readFileSync(new URL('../../../deploy/server/nginx/sites.conf.example', import.meta.url), 'utf8')
const csp = nginx.split('server_name console.lumatile.cn;')[1]?.match(/Content-Security-Policy "([^"]+)"/)?.[1] ?? ''
if (!csp) throw new Error('找不到 Console 的 CSP 配置')

const report: StatisticsReport = {
  generated_at: '2026-11-20T00:25:00', range_days: 30, days: ['2026-11-18', '2026-11-19', '2026-11-20'],
  dau: [43, 68, 57], new_installs: [17, 26, 14], raw_checks: [161, 219, 182], downloads: [18, 31, 26],
  totals: { installs: 284, beacons: 840, manifest_checks: 216, update_checks: 1056, downloads_selfhosted: 115, downloads_github: 328 },
  client_dist: [{ label: 'Android', count: 125 }, { label: '桌面端', count: 74 }],
  version_dist: [{ label: '2.0.4', count: 118 }, { label: '2.0.3', count: 43 }, { label: '2.0.2', count: 25 }],
  os_dist: [{ label: 'Android', count: 125 }, { label: 'Windows', count: 52 }, { label: 'macOS', count: 22 }],
  arch_dist: [{ label: 'arm64', count: 146 }, { label: 'x64', count: 52 }],
  top_files: [{ label: 'Android · Stable', count: 90 }, { label: 'Android · Alpha', count: 25 }],
  github_by_asset: [{ label: 'Windows 安装包', count: 221 }, { label: 'macOS 安装包', count: 107 }],
  github_snapshot_day: '2026-11-20',
}

async function mockApi(page: Page, signedIn: boolean, canManage = true, statistics = report) {
  const permissions: Session['permissions'] = {
    addDraft: canManage, editDraft: canManage, deleteDraft: canManage, viewOperations: canManage,
  }
  let token = 'anonymous'
  let nextDraftId = 1
  let drafts: Draft[] = []
  let active: Draft | undefined
  let mode: 'website' | 'server' = 'website'
  const item: Feedback = {
    id: 'FB-A0000001', type: 'bug', platform: 'android', app_version: '2.0.4',
    content: '合成反馈内容', status: 'new', created_at: '2026-11-20T09:00:00Z',
  }

  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === site) {
      if (!request.isNavigationRequest()) return route.continue()
      const response = await route.fetch()
      return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
    }
    if (url.origin !== api) return route.abort()

    const headers = {
      'access-control-allow-origin': site,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-csrftoken',
    }
    const send = (json: object, status = 200) => route.fulfill({ status, headers, json })
    const method = request.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (method !== 'GET') expect(request.headers()['x-csrftoken']).toBe(token)

    if (url.pathname === '/v1/auth/session') {
      if (method === 'POST') {
        expect(request.postDataJSON()).toEqual({ username: 'operator', password: 'synthetic' })
        signedIn = true
        token = 'signed-in'
      }
      if (method === 'DELETE') {
        signedIn = false
        token = 'signed-out'
      }
      return send({ user: signedIn ? 'operator' : null, permissions, csrfToken: token })
    }
    if (!signedIn) return send({ code: 'session_required', detail: '请先登录' }, 403)
    if (url.pathname === '/v1/overview') {
      return send({ windows: '2.0.4', macos: '2.0.4', android: { stable: '2.0.4', alpha: null } })
    }
    if (url.pathname === '/v1/feedback-submissions') {
      const filter = url.searchParams.get('status')
      const items = filter === 'all' || filter === item.status ? [item] : []
      return send({ items, total: items.length, counts: { new: Number(item.status === 'new'), resolved: Number(item.status === 'resolved') },
        links: { self: url.pathname + url.search, next: null, previous: null } })
    }
    if (url.pathname === `/v1/feedback-submissions/${item.id}` && method === 'PATCH') {
      item.status = request.postDataJSON().status
      return send(item)
    }
    if (url.pathname === '/v1/statistics') {
      return send(statistics)
    }
    if (url.pathname === '/v1/operations') {
      return send({ items: [{ actor: 'operator', resource: 'stable-announcement', value: 'withdrawn', created_at: '2026-11-20T01:20:00Z' }], nextOffset: null })
    }
    if (url.pathname === '/v1/auth/password' && method === 'POST') {
      expect(request.postDataJSON()).toEqual({ old_password: 'synthetic', new_password1: 'new-synthetic', new_password2: 'new-synthetic' })
      token = 'changed-password'
      return send({ user: 'operator', permissions, csrfToken: token })
    }
    if (url.pathname === '/v1/distribution-policies/android') {
      if (method === 'PUT') mode = request.postDataJSON().mode
      return send({ mode, websiteUrl: 'https://lumatile.cn/download/#download-android' })
    }
    if (url.pathname === '/v1/announcement-drafts') {
      if (method === 'GET') return send({ items: drafts })
      const payload: DraftInput = request.postDataJSON()
      const draft = { ...payload, id: nextDraftId++ }
      drafts = [draft, ...drafts]
      return send(draft, 201)
    }
    if (url.pathname === '/v1/channels/stable/active-announcement') {
      if (method === 'PUT') active = drafts.find(draft => draft.id === request.postDataJSON().draftId)
      if (method === 'DELETE') {
        active = undefined
        return route.fulfill({ status: 204, headers })
      }
      if (active) return send({ schemaVersion: 1, id: 'synthetic-announcement', title: active.title, body: active.body, level: active.level })
      return send({ detail: '当前没有公告' }, 404)
    }
    return send({ detail: '未配置的测试接口' }, 500)
  })
}

test('logs in from an old feedback link, updates feedback with CSRF, and logs out', async ({ page }) => {
  await mockApi(page, false)
  await page.goto('/#feedback-title')
  await page.getByLabel('用户名').fill('operator')
  await page.getByLabel('密码', { exact: true }).fill('synthetic')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '用户反馈' })).toBeVisible()
  await expect(page.getByText('合成反馈内容')).toBeVisible()
  await page.getByRole('button', { name: '标记已处理 · FB-A0000001' }).click()
  await expect(page.getByText(/反馈已标记为已处理/)).toBeVisible()
  await page.getByRole('button', { name: /^已处理/ }).click()
  await expect(page.getByRole('button', { name: '重新打开 · FB-A0000001' })).toBeVisible()
  await page.getByText('operator', { exact: true }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '登录控制台' })).toBeVisible()
})

test('displays legacy statistics links and falls back from operations without permission', async ({ page }) => {
  await mockApi(page, true, false)
  await page.goto('/#operations')
  await expect(page.getByRole('heading', { name: '运营概览' })).toBeVisible()
  await expect(page.getByRole('link', { name: '操作记录' })).toHaveCount(0)
  await page.goto('/#stats')
  await expect(page.getByRole('heading', { name: '访问统计' })).toBeVisible()
  const chart = page.getByRole('img', { name: /^日活每日趋势/ })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('2d')?.getImageData(12, 0, canvas.width - 12, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)))
    .toBe(true)
  await page.getByRole('group', { name: '趋势指标' }).getByRole('button', { name: '新增安装' }).click()
  const date = page.getByRole('slider', { name: '查看日期' })
  await expect(date).toHaveAttribute('aria-valuetext', '2026-11-20，新增安装 14')
  await date.press('ArrowLeft')
  await expect(date).toHaveAttribute('aria-valuetext', '2026-11-19，新增安装 26')
  await expect(page.getByRole('heading', { name: '版本分布' })).toBeVisible()
  await page.getByText('逐日明细', { exact: true }).click()
  await expect(page.getByRole('cell', { name: '2026-11-20' })).toBeVisible()
})

test('shows an empty report on a narrow screen without overflowing the page', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await mockApi(page, true, true, {
    ...report, days: [], dau: [], new_installs: [], raw_checks: [], downloads: [], client_dist: [],
  })
  await page.goto('/#/stats')
  await expect(page.getByText('暂无逐日数据')).toBeVisible()
  await expect(page.getByRole('img', { name: /每日趋势/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '客户端分布' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
})

test('creates and publishes a draft, withdraws it, and saves the distribution policy', async ({ page }) => {
  await mockApi(page, true)
  await page.goto('/#announcement')
  await page.getByRole('button', { name: '新建草稿' }).click()
  await page.getByLabel('标题').fill('合成公告')
  await page.getByLabel('正文').fill('合成正文')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('草稿已保存')).toBeVisible()
  await page.getByRole('button', { name: '发布到所选渠道' }).click()
  await expect(page.getByText('当前公告 · 合成公告')).toBeVisible()
  await page.getByRole('button', { name: '撤回当前公告' }).click()
  await expect(page.getByText('已撤回该渠道公告')).toBeVisible()
  await page.getByLabel('分发方式').selectOption('server')
  await page.getByRole('button', { name: '保存策略' }).click()
  await expect(page.getByText('自建下载已开启')).toBeVisible()
})

test('reads the operations table and checks password confirmation before saving', async ({ page }) => {
  await mockApi(page, true)
  await page.goto('/#/operations')
  await expect(page.getByRole('cell', { name: 'stable-announcement' })).toBeVisible()
  await page.getByText('operator', { exact: true }).first().click()
  await page.getByRole('link', { name: '修改密码' }).click()
  await page.getByLabel('当前密码', { exact: true }).fill('synthetic')
  await page.getByLabel('新密码', { exact: true }).fill('new-synthetic')
  await page.getByLabel('确认新密码', { exact: true }).fill('different')
  const save = page.getByRole('button', { name: '保存密码' })
  await expect(save).toBeDisabled()
  await page.getByLabel('确认新密码', { exact: true }).fill('new-synthetic')
  await save.click()
  await expect(page.getByText('密码已更新')).toBeVisible()
})
