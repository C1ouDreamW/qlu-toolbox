import defaults from './credit-defaults.json'

export type CreditRules = typeof defaults
export interface CreditPlan {
  total_required: number
  modules: Record<string, number>
  subs: Record<string, number>
  node_ids: Record<string, string>
  node_jdkcsx: Record<string, string>
  course_map?: Record<string, { code: string; name: string }[]>
}
export type CreditItem = Record<string, unknown>
export interface CreditCapture { html: string; course_map: NonNullable<CreditPlan['course_map']>; items: CreditItem[]; warnings: string[] }
export const defaultCreditRules = (): CreditRules => JSON.parse(JSON.stringify(defaults))
const number = (value: unknown) => /^\d+(?:\.\d+)?$/.test(String(value).trim()) && Number.isFinite(Number(value)) ? Number(value) : 0
const field = (item: CreditItem, keys: string[]) => keys.map(key => String(item[key] || '').trim()).find(Boolean) || ''
const hit = (text: string, words: string[]) => words.some(word => word && text.includes(word))
export const normalizeCreditName = (name: string) => name.replace(/[（(][^（）()]*[）)]/g, '').replace(/\s+/g, '')

export function normalizeCreditRules(value: unknown): CreditRules {
  const rules = defaultCreditRules()
  if (!value || typeof value !== 'object') return rules
  const data = value as Partial<CreditRules>
  rules.art_major = data.art_major === true
  rules.total_required = number(data.total_required) || rules.total_required
  for (const module of rules.modules) {
    const override = Array.isArray(data.modules) && data.modules.find(item => item?.key === module.key)
    if (!override) continue
    if (override.required != null) module.required = number(override.required)
    if (Array.isArray(override.keywords)) module.keywords = override.keywords.filter(word => typeof word === 'string' && word.length > 0)
    for (const sub of module.subs) {
      const overrideSub = Array.isArray(override.subs) && override.subs.find(item => item?.key === sub.key)
      if (overrideSub && overrideSub.required != null) sub.required = number(overrideSub.required)
    }
  }
  return rules
}

export function classifyCreditScore(text: string): 'passed' | 'failed' | 'in_progress' {
  text = text.trim()
  if (!text || hit(text, ['在修', '未评', '暂无', '待定', '--'])) return 'in_progress'
  if (hit(text, ['不及格', '缺考', '作弊', '违纪', '旷考', '取消资格', '无效', '缓考'])) return 'failed'
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) >= 60 ? 'passed' : 'failed'
  return hit(text, ['合格', '及格', '优秀', '良好', '中等', '通过']) ? 'passed' : 'failed'
}

// 与桌面端解析同一份服务端模板，不执行学校返回的 HTML/脚本。
export function parseCreditPlan(html: string): CreditPlan | null {
  const starts = [...html.matchAll(/li id='li([0-9A-Fa-f]{32})'/g)]
  const nodes = new Map<string, { id: string; label: string; required: number; parent: string; jdkcsx: string }>()
  starts.forEach((match, index) => {
    const id = match[1]
    if (nodes.has(id)) return
    const chunk = html.slice(match.index, starts[index + 1]?.index ?? match.index! + 6000)
    const title = chunk.match(/id='p[0-9A-Fa-f]{32}'\s+yqzdxf='([\d.]+)'\s*>([^<]*)/)
    nodes.set(id, { id, label: (title?.[2] || '').split('"')[0].replace(/&nbsp;|\s/g, ''), required: number(title?.[1]),
      parent: chunk.match(/appendTo\(\$\\?\("#li([0-9A-Fa-f]{32})"\\?\)\)/)?.[1] || '',
      jdkcsx: chunk.match(/class='more' jdkcsx='([^']*)'/)?.[1] || '' })
  })
  const all = [...nodes.values()]
  const total = all.find(node => node.label.includes('综合素质选修课'))
  if (!total) return null
  const plan: CreditPlan = { total_required: total.required, modules: {}, subs: {}, node_ids: {}, node_jdkcsx: {} }
  for (const [key, label] of Object.entries({ sizheng: '思想政治理论', anquan: '安全教育', yishu: '艺术体育', sishi: '四史', wenhua: '文化' })) {
    const parent = ['sishi', 'wenhua'].includes(key) ? plan.node_ids.sizheng : total.id
    const node = all.find(item => item.parent === parent && item.label.includes(label))
    if (!node) continue
    ;(['sishi', 'wenhua'].includes(key) ? plan.subs : plan.modules)[key] = node.required
    plan.node_ids[key] = node.id
    plan.node_jdkcsx[key] = node.jdkcsx
  }
  return plan
}

const emptyStat = (required: number) => ({ required, earned: 0, in_progress: 0, gap: required, satisfied: required <= 0 })
type CourseView = { code: string; name: string; credit: number; state: ReturnType<typeof classifyCreditScore>; score: string; term: string; module: string; source: string }

export function summarizeCredits(items: CreditItem[], input: CreditRules, plan: CreditPlan | null = null) {
  const rules = normalizeCreditRules(input)
  if (plan) {
    rules.total_required = Math.max(rules.total_required, number(plan.total_required))
    for (const module of rules.modules) {
      module.required = Math.max(module.required, number(plan.modules[module.key]))
      for (const sub of module.subs) sub.required = Math.max(sub.required, number(plan.subs[sub.key]))
    }
  }
  const modules = rules.modules.map(module => ({ key: module.key, label: module.label, ...emptyStat(module.required), art_only: module.art_only,
    subs: module.subs.map(sub => ({ key: sub.key, label: sub.label, ...emptyStat(sub.required) })), courses: [] as CourseView[] }))
  const codes = new Map<string, [string, string]>()
  const names = new Map<string, [string, string]>()
  for (const [key, courses] of Object.entries(plan?.course_map || {})) {
    const target: [string, string] = ['sishi', 'wenhua'].includes(key) ? ['sizheng', key] : [key, '']
    for (const course of courses) {
      if (course.code && !codes.has(course.code.trim())) codes.set(course.code.trim(), target)
      const name = normalizeCreditName(course.name)
      if (name && !names.has(name)) names.set(name, target)
    }
  }
  const extra_elective: CourseView[] = [], unmatched: CourseView[] = []
  const passed = new Set<string>()
  let total_earned = 0, total_in_progress = 0
  for (const item of items) {
    const code = field(item, ['kch', 'kcbh', 'kcmc']), name = field(item, ['kcmc'])
    if (code && passed.has(code)) continue
    const category = field(item, ['kclbmc', 'kcflmc', 'kcbdlbmc', 'kcxzmc', 'kclb', 'kcfl', 'kcxz'])
    const nature = field(item, ['kcxzmc', 'kcxz', 'kclbmc', 'kclbdm'])
    const general = hit(`${category} ${nature}`, ['公选', '通识选修']) || (nature.includes('选修') && category.includes('公共'))
    let [moduleKey, subKey] = codes.get(code) || names.get(normalizeCreditName(name)) || ['', '']
    let source = moduleKey ? 'official' : ''
    let rule = rules.modules.find(module => module.key === moduleKey)
    if (!rule) { moduleKey = ''; subKey = '' }
    if (!moduleKey && general) {
      rule = rules.modules.find(module => hit(`${name} ${category} ${nature}`, [...module.keywords, ...module.subs.flatMap(sub => sub.keywords)]))
      moduleKey = rule?.key || ''
      if (rule) source = 'keyword'
    }
    if (rule && !subKey) subKey = rule.subs.find(sub => hit(name, sub.keywords) || hit(category, sub.keywords))?.key || ''
    const score = field(item, ['zcjmc', 'cj', 'xmcj'])
    const state = item.cjsfzf === '是' ? 'failed' : classifyCreditScore(score)
    const course: CourseView = { code, name, credit: number(item.xf), score, state, module: moduleKey, source,
      term: `${field(item, ['xnm', 'xnmmc'])}-${field(item, ['xqm', 'xqmmc'])}`.replace(/^-|-$/g, '') }
    const stat = modules.find(module => module.key === moduleKey)
    let counted = false
    if (stat) {
      stat.courses.push(course)
      const sub = stat.subs.find(item => item.key === subKey)
      if (state !== 'failed') {
        const key = state === 'passed' ? 'earned' : 'in_progress'
        stat[key] += course.credit
        if (sub) sub[key] += course.credit
      }
      counted = true
    } else if (general && state !== 'failed') {
      extra_elective.push({ ...course, source: 'extra' }); counted = true
    } else unmatched.push({ ...course, source: 'ignored' })
    if (counted && state === 'passed') { total_earned += course.credit; if (code) passed.add(code) }
    else if (counted && state === 'in_progress') total_in_progress += course.credit
  }
  const unfulfilled: string[] = []
  for (const module of modules) {
    const subMessages: string[] = []
    module.gap = Math.max(0, module.required - module.earned)
    for (const sub of module.subs) {
      sub.gap = Math.max(0, sub.required - sub.earned)
      sub.satisfied = sub.earned >= sub.required
      if (!sub.satisfied) subMessages.push(`${sub.label}类还差 ${sub.gap} 学分`)
    }
    const waived = module.art_only && rules.art_major
    module.satisfied = waived || module.required <= 0 || (module.earned >= module.required && module.subs.every(sub => sub.satisfied))
    if (waived) module.gap = 0
    if (module.required > 0 && !module.satisfied) {
      const parts = [`${module.label}：已修 ${module.earned}/${module.required} 学分`]
      if (subMessages.length) parts.push(subMessages.join('；'))
      else if (module.in_progress > 0) parts.push(`另有 ${module.in_progress} 学分在修`)
      unfulfilled.push(parts.join('，'))
    }
  }
  if (total_earned < rules.total_required) unfulfilled.unshift(`总学分：已修 ${total_earned}/${rules.total_required} 学分，还差 ${Math.max(0, rules.total_required - total_earned - total_in_progress)} 学分${total_in_progress > 0 ? `（另有 ${total_in_progress} 学分在修）` : ''}`)
  const hints: Record<string, string> = { sishi: '党史、新中国史、改革开放史、社会主义发展史等课程', wenhua: '文化类素质教育课程', gongyi: '公共艺术类课程（体育类不计入该要求）', sizheng: '思想政治理论类公选课', anquan: '安全教育类公选课', yishu: '艺术体育模块公选课' }
  const recommendations: { key: string; label: string; detail: string; credit: number }[] = []
  let hard = 0
  for (const module of modules) {
    if (module.required <= 0 || module.satisfied) continue
    const need = Math.max(0, module.required - module.earned - module.in_progress)
    let subTotal = 0
    for (const sub of module.subs) {
      if (sub.satisfied) continue
      const credit = Math.max(0, sub.required - sub.earned - sub.in_progress)
      if (credit > 0.005) { recommendations.push({ key: `${module.key}.${sub.key}`, label: `${module.label}·${sub.label}`, detail: hints[sub.key] || '', credit }); hard += credit }
      subTotal += credit
    }
    if (need - subTotal > 0.005) { recommendations.push({ key: module.key, label: module.label, detail: hints[module.key] || '该模块公选课', credit: need - subTotal }); hard += need - subTotal }
  }
  const flex = Math.max(0, rules.total_required - total_earned - total_in_progress - hard)
  if (flex > 0.005) recommendations.push({ key: 'flex', label: '任选综合素质选修课', detail: '人文社科 / 自然科学 / 经济管理 / 外语等七类任选，超出模块下限的部分也计入', credit: flex })
  return { source: plan ? 'plan' : 'fallback', art_major: rules.art_major, total_required: rules.total_required, total_earned, total_in_progress,
    total_gap: Math.max(0, rules.total_required - total_earned), modules, unfulfilled, recommendations, extra_elective, unmatched }
}
