import { describe, expect, it } from 'vitest'
import { parseMarkdownInlines, parseMarkdownNotes, type MarkdownBlock } from './markdown'

function blockOfKind<K extends MarkdownBlock['kind']>(block: MarkdownBlock, kind: K) {
  expect(block.kind).toBe(kind)
  if (block.kind !== kind) throw new Error(`expected ${kind}, got ${block.kind}`)
  return block as Extract<MarkdownBlock, { kind: K }>
}

const CHANGELOG_EXCERPT = [
  '这是以桌面端深色模式显示修复与移动端学分统计兼容性为主的修复版本。',
  '',
  '### 修复',
  '',
  '- 修复桌面端深色模式启动时的闪白问题（#8）。',
  '- 修复 `分项成绩导出` 所选学年学期暂无成绩时的误导性报错。',
  '',
  '### 更改',
  '',
  '- Android versionCode 提升至 `13`。',
  '',
].join('\n')

describe('parseMarkdownNotes', () => {
  it('把 CHANGELOG 片段拆成段落、标题与列表', () => {
    const blocks = parseMarkdownNotes(CHANGELOG_EXCERPT)
    expect(blocks.map(block => block.kind)).toEqual(['paragraph', 'heading', 'list', 'heading', 'list'])

    const heading = blockOfKind(blocks[1], 'heading')
    expect(heading.level).toBe(3)
    expect(heading.inlines).toEqual([{ kind: 'text', text: '修复' }])

    const list = blockOfKind(blocks[2], 'list')
    expect(list.ordered).toBe(false)
    expect(list.items.length).toBe(2)
    expect(list.items[1]).toEqual([
      { kind: 'text', text: '修复 ' },
      { kind: 'code', text: '分项成绩导出' },
      { kind: 'text', text: ' 所选学年学期暂无成绩时的误导性报错。' },
    ])
  })

  it('保留 GitHub Release 自动生成的星号列表、加粗与裸链接', () => {
    const notes = [
      '## What\'s Changed',
      '* fix wheel picker by @XiaoYu070310 in https://github.com/C1ouDreamW/lumatile/pull/8',
      '',
      '**Full Changelog**: https://github.com/C1ouDreamW/lumatile/compare/v2.0.2...v2.0.3',
      '',
    ].join('\n')
    const blocks = parseMarkdownNotes(notes)
    expect(blocks.map(block => block.kind)).toEqual(['heading', 'list', 'paragraph'])
    const list = blockOfKind(blocks[1], 'list')
    expect(list.ordered).toBe(false)
    const link = list.items[0].find(token => token.kind === 'link')
    expect(link && link.href).toBe('https://github.com/C1ouDreamW/lumatile/pull/8')
    const paragraph = blockOfKind(blocks[2], 'paragraph')
    expect(paragraph.inlines[0]).toEqual({ kind: 'strong', text: 'Full Changelog' })
    expect(paragraph.inlines.some(token => token.kind === 'link')).toBe(true)
  })

  it('普通文本保持原样，空文本不产生块', () => {
    expect(parseMarkdownNotes('')).toEqual([])
    expect(parseMarkdownNotes('   \n\n')).toEqual([])
    expect(parseMarkdownNotes('只修了一个问题。')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '只修了一个问题。' }] },
    ])
  })

  it('支持有序列表、引用、围栏代码与分隔线', () => {
    const blocks = parseMarkdownNotes('1. 第一步\n2. 第二步\n\n> 提示\n\n```\ncode\n```\n\n---\n')
    expect(blocks.map(block => block.kind)).toEqual(['list', 'quote', 'code', 'rule'])
    expect(blockOfKind(blocks[0], 'list').ordered).toBe(true)
    expect(blockOfKind(blocks[2], 'code').text).toBe('code')
  })

  it('不把原始 HTML 当作标记处理', () => {
    const blocks = parseMarkdownNotes('<script>alert(1)</script>')
    expect(blocks).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '<script>alert(1)</script>' }] },
    ])
  })
})

describe('parseMarkdownInlines', () => {
  it('识别行内代码、加粗、斜体与链接', () => {
    const tokens = parseMarkdownInlines('使用 `code`、**粗体**、*斜体* 与 [链接](https://example.com)')
    expect(tokens.map(token => token.kind)).toEqual(['text', 'code', 'text', 'strong', 'text', 'emphasis', 'text', 'link'])
    expect(tokens.at(-1)).toEqual({ kind: 'link', text: '链接', href: 'https://example.com' })
  })

  it('不会把标识符里的下划线当成斜体', () => {
    expect(parseMarkdownInlines('字段 snake_case_name 保持不变。')).toEqual([
      { kind: 'text', text: '字段 snake_case_name 保持不变。' },
    ])
  })

  it('剥掉裸链接末尾的中英文标点', () => {
    expect(parseMarkdownInlines('见 https://github.com/C1ouDreamW/lumatile/releases 。')).toEqual([
      { kind: 'text', text: '见 ' },
      { kind: 'link', text: 'https://github.com/C1ouDreamW/lumatile/releases', href: 'https://github.com/C1ouDreamW/lumatile/releases' },
      { kind: 'text', text: ' 。' },
    ])
  })
})
