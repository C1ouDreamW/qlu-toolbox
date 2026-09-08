import { describe, expect, it } from 'vitest'
import fixtures from './credit-fixtures.json'
import { classifyCreditScore, defaultCreditRules, normalizeCreditRules, parseCreditPlan, summarizeCredits, type CreditPlan } from './credit'

describe('credit report parity with desktop Python', () => {
  it.each(fixtures.cases.map((sample, index) => ({ ...sample, index })))('matches desktop sample $index', ({ items, rules, plan, expected }) => {
    expect(summarizeCredits(items, rules, plan as CreditPlan | null)).toEqual(expected)
  })
  it('parses the same requirement tree and ignores the other-module bucket', () => {
    const plan = parseCreditPlan(fixtures.html)!
    expect(plan.total_required).toBe(10)
    expect(plan.modules).toEqual({ sizheng: 2, anquan: 2, yishu: 2 })
    expect(plan.subs).toEqual({ sishi: 1, wenhua: 1 })
    expect(Object.keys(plan.node_ids)).toEqual(['sizheng', 'anquan', 'yishu', 'sishi', 'wenhua'])
    expect(parseCreditPlan('<html>登录已过期</html>')).toBeNull()
  })
  it('normalizes untrusted settings and classifies cancelled or unknown scores conservatively', () => {
    const rules = normalizeCreditRules({ total_required: Infinity, modules: [{ key: 'anquan', required: -1 }, { key: '__proto__', required: 99 }] })
    expect(rules.total_required).toBe(10)
    expect(rules.modules.find(module => module.key === 'anquan')?.required).toBe(0)
    expect(rules.modules).toHaveLength(7)
    expect(classifyCreditScore('59.5')).toBe('failed')
    expect(classifyCreditScore('缓考')).toBe('failed')
    expect(classifyCreditScore('未知')).toBe('failed')
    expect(summarizeCredits([{ kch: 'A', kcmc: '党史', xf: 1, cj: '90', cjsfzf: '是', kcxzmc: '公选' }], defaultCreditRules()).total_earned).toBe(0)
  })
})
