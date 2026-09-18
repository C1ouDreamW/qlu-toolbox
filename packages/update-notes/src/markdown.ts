/**
 * 更新说明用的极简 Markdown 子集解析，桌面端与 Android 端共用。
 *
 * 更新文案来自更新源清单或 GitHub Release，二者都是 Markdown（CHANGELOG 片段、
 * `### 修复`、`- ` 列表、`**加粗**`、链接等）。这里只解析弹窗需要的块级与行内结构，
 * 由各端用 Vue 模板渲染，不生成 HTML 字符串，避免注入风险。
 */

export type MarkdownInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type MarkdownBlock =
  | { kind: 'heading'; level: number; inlines: MarkdownInline[] }
  | { kind: 'paragraph'; inlines: MarkdownInline[] }
  | { kind: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { kind: 'quote'; inlines: MarkdownInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }

const FENCE_RE = /^ {0,3}(?:```+|~~~+)\s*\S*\s*$/
const FENCE_CLOSE_RE = /^ {0,3}(?:```+|~~~+)\s*$/
const RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const QUOTE_RE = /^ {0,3}>\s?(.*)$/
const BULLET_RE = /^ {0,3}[-*+]\s+(.*)$/
const ORDERED_RE = /^ {0,3}\d{1,9}[.)]\s+(.*)$/
const INLINE_RE = /`([^`\n]+)`|\[([^\]\n]*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|(?<![0-9A-Za-z_])_([^_\n]+)_(?![0-9A-Za-z_])|(https?:\/\/[^\s<>()]+)/g
const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：、）)]+$/

function isBlockStart(line: string) {
  return FENCE_RE.test(line) || RULE_RE.test(line) || HEADING_RE.test(line) ||
    QUOTE_RE.test(line) || BULLET_RE.test(line) || ORDERED_RE.test(line)
}

/** 解析行内标记；无法识别的语法原样保留为文本。 */
export function parseMarkdownInlines(source: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = []
  let cursor = 0
  for (const match of source.matchAll(INLINE_RE)) {
    const start = match.index ?? 0
    if (start > cursor) tokens.push({ kind: 'text', text: source.slice(cursor, start) })
    const [full, code, linkText, linkHref, strongStar, strongUnderscore, emStar, emUnderscore, bareUrl] = match
    if (code !== undefined) tokens.push({ kind: 'code', text: code })
    else if (linkHref !== undefined) tokens.push({ kind: 'link', text: linkText || linkHref, href: linkHref })
    else if (strongStar !== undefined) tokens.push({ kind: 'strong', text: strongStar })
    else if (strongUnderscore !== undefined) tokens.push({ kind: 'strong', text: strongUnderscore })
    else if (emStar !== undefined) tokens.push({ kind: 'emphasis', text: emStar })
    else if (emUnderscore !== undefined) tokens.push({ kind: 'emphasis', text: emUnderscore })
    else if (bareUrl !== undefined) {
      const href = bareUrl.replace(TRAILING_PUNCTUATION_RE, '')
      tokens.push({ kind: 'link', text: href, href })
      const rest = bareUrl.slice(href.length)
      if (rest) tokens.push({ kind: 'text', text: rest })
    }
    cursor = start + full.length
  }
  if (cursor < source.length) tokens.push({ kind: 'text', text: source.slice(cursor) })
  return tokens
}

/** 把更新说明解析为块级结构；空文本返回空数组，由调用方决定兜底文案。 */
export function parseMarkdownNotes(source: string): MarkdownBlock[] {
  const lines = (source || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }

    if (FENCE_RE.test(line)) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE_CLOSE_RE.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, inlines: parseMarkdownInlines(heading[2]) })
      index += 1
      continue
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = []
      while (index < lines.length) {
        const quote = QUOTE_RE.exec(lines[index])
        if (!quote) break
        body.push(quote[1])
        index += 1
      }
      blocks.push({ kind: 'quote', inlines: parseMarkdownInlines(body.join('\n')) })
      continue
    }

    const listItem = BULLET_RE.exec(line) || ORDERED_RE.exec(line)
    if (listItem) {
      const ordered = !BULLET_RE.test(line)
      const matcher = ordered ? ORDERED_RE : BULLET_RE
      const items: MarkdownInline[][] = []
      while (index < lines.length) {
        const item = matcher.exec(lines[index])
        if (!item) break
        items.push(parseMarkdownInlines(item[1]))
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    if (!paragraph.length) {
      paragraph.push(line.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', inlines: parseMarkdownInlines(paragraph.join('\n')) })
  }
  return blocks
}
