import type { Register, TextProps } from 'claude-code'

// Sentence rules copied from Kilo's skim mode (examples/patches/skim-mode-ui.js, splitIndex).
const MIN_LEAD = 25, MIN_DETAIL = 20, MASK = '￼'
const ABBREVIATION = /(?:^|[^\p{L}])(?:e\.g|i\.e|etc|vs|approx|fig|inc|ltd)$/iu
const DOTTED_INITIAL = /\.\p{Lu}$/u

// Returns where the first sentence ends, or -1 when the text should stay fully bright.
// ponytail: sentence ends are only trusted before a capital, digit or code span; other scripts stay undimmed.
function splitIndex(text: string): number {
  const end = /[.!?]+["'”’)\]]*(?=\s+["'“‘(\[]?[\p{Lu}\p{N}￼])/gu
  for (let m; (m = end.exec(text));) {
    const before = text.slice(0, m.index), at = m.index + m[0].length
    if (m[0][0] === '.' && (ABBREVIATION.test(before) || DOTTED_INITIAL.test(before) || /^\s*\d+$/.test(before))) continue
    if (text.slice(0, at).trim().length < MIN_LEAD) continue
    return text.slice(at).trim().length < MIN_DETAIL ? -1 : at
  }
  return -1
}

// ponytail: inline code is drawn as plain text; the engine (2.1.296) refuses Text's `mono` on every surface.
type Run = { text: string; style?: 'bold' | 'italic'; opaque?: true }
type Item = { marker: string; head: Run[]; tail: Run[] }
type Section = { raw: string } | { items: Item[] }

// code span | **bold** | __bold__ | *italic* | _italic_ | [link](url)
const INLINE = /(`+)(.+?)\1(?!`)|\*\*(.+?)\*\*|__(.+?)__|(?<![\p{L}\p{N}*])\*(?![\s*])(.+?)(?<!\s)\*(?!\*)|(?<![\p{L}\p{N}_])_(?![\s_])(.+?)(?<!\s)_(?![\p{L}\p{N}_])|\[([^\]]+)\]\([^)\s]+(?:\s+"[^"]*")?\)/gu
// Markup the small parser does not draw: left over in plain text, or nested in a styled run.
const LEFTOVER = /[*`\\[\]]|~~|<[a-z/!]|&#?\w+;/i
const NESTED = /[*_`[\]<\\]/

// Inline markdown as styled runs, or null when it is too complex to draw faithfully.
function inline(src: string): Run[] | null {
  const runs: Run[] = []
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    const plain = src.slice(last, m.index)
    if (LEFTOVER.test(plain)) return null
    if (plain) runs.push({ text: plain })
    last = m.index + m[0].length
    const [, , code, b1, b2, i1, i2, link] = m
    const styled = b1 ?? b2 ?? i1 ?? i2 ?? link ?? ''
    if (code === undefined && NESTED.test(styled)) return null
    if (code !== undefined) runs.push({ text: code, opaque: true })
    else if (link !== undefined) runs.push({ text: link, opaque: true })
    else runs.push({ text: styled, style: b1 ?? b2 ? 'bold' : 'italic' })
  }
  const rest = src.slice(last)
  if (LEFTOVER.test(rest)) return null
  if (rest) runs.push({ text: rest })
  return runs
}

// Splits runs into the bright first sentence and the dim rest; tail is empty when it does not split.
function skim(runs: Run[]): { head: Run[]; tail: Run[] } {
  // Code and link text is masked so a full stop inside it never ends the sentence.
  const at = splitIndex(runs.map(r => (r.opaque ? MASK.repeat(r.text.length) : r.text)).join(''))
  if (at < 0) return { head: runs, tail: [] }
  const head: Run[] = [], tail: Run[] = []
  let pos = 0
  for (const r of runs) {
    const end = pos + r.text.length
    if (end <= at) head.push(r)
    else if (pos >= at) tail.push(r)
    else {
      head.push({ ...r, text: r.text.slice(0, at - pos) })
      tail.push({ ...r, text: r.text.slice(at - pos) })
    }
    pos = end
  }
  return { head, tail }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const ITEM = /^([-*+]|\d{1,9}[.)])\s+(.*)$/
// Headings, quotes, tables, HTML, fences, rules, setext underlines, indented code and nested lists.
const SPECIAL = /^\s*(?:#|>|\||<|`{3}|~{3})|^[\s|:=-]+$|^\s*([*_])(?:\s*\1){2,}\s*$|^(?: {4}|\t)|^\s+(?:[-*+]|\d{1,9}[.)])\s/

// Splits a chunk of lines (no blank line inside) into items to draw, or null to leave it to Markdown.
function items(lines: string[]): Item[] | null {
  if (/^\s/.test(lines[0]!) || lines.some(l => SPECIAL.test(l))) return null
  const isList = ITEM.test(lines[0]!)
  const parts: { marker: string; text: string }[] = []
  for (const line of lines) {
    const m = ITEM.exec(line)
    if (m && !isList) return null
    if (m) parts.push({ marker: /\d/.test(m[1]!) ? `${m[1]} ` : '- ', text: m[2]! })
    else if (parts.length) parts[parts.length - 1]!.text += ' ' + line.trim()
    else parts.push({ marker: '', text: line.trim() })
  }
  const out: Item[] = []
  for (const { marker, text } of parts) {
    const runs = inline(text.trim())
    if (!runs) return null
    out.push({ marker, ...skim(runs) })
  }
  return out.some(i => i.tail.length) ? out : null
}

// The reply as sections, or null when nothing in it splits (the engine then draws its own).
function sections(text: string): Section[] | null {
  const chunks: string[][] = []
  let cur: string[] = [], fence: string | null = null
  for (const line of text.split('\n')) {
    if (fence) {
      cur.push(line)
      if (line.trim().startsWith(fence)) fence = null
      continue
    }
    const f = FENCE.exec(line)
    if (f) fence = f[1]!
    if (line.trim() || f) cur.push(line)
    else if (cur.length) (chunks.push(cur), (cur = []))
  }
  if (cur.length) chunks.push(cur)
  const out: Section[] = []
  for (const chunk of chunks) {
    const drawn = items(chunk), prev = out[out.length - 1]
    if (drawn) out.push({ items: drawn })
    else if (prev && 'raw' in prev) prev.raw += '\n\n' + chunk.join('\n')
    else out.push({ raw: chunk.join('\n') })
  }
  return out.some(s => 'items' in s) ? out : null
}


const look = (r: Run, dim: boolean): TextProps => ({ ...(r.style && { [r.style]: true }), ...(dim && { dimColor: true }) })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skim',
      description: 'Toggle skim mode: dim all but the first sentence of each paragraph and list item',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'skim' }, async $ => {
    const isOn = (await $.store.get('enabled')) === false
    await $.store.set('enabled', isOn)
    $.ui.invalidate('ui.render')
    return { text: `Skim mode is ${isOn ? 'on' : 'off'}.` }
  })

  // ponytail: AssistantMessage says nothing about streaming, so a block still being written is dimmed too.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || (await $.store.get('enabled')) === false) return next(e)
    const parsed = sections(e.props.text)
    if (!parsed) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const draw = (runs: Run[], dim: boolean) => runs.map(r => (r.style || dim ? <Text {...look(r, dim)}>{r.text}</Text> : r.text))
    return (
      <Box flexDirection="column" gap={1}>
        {parsed.map(s =>
          'raw' in s ? (
            <Markdown text={s.raw} />
          ) : (
            <Box flexDirection="column">
              {s.items.map(i => (
                <Box flexDirection="row">
                  {i.marker ? <Text>{i.marker}</Text> : null}
                  <Text>
                    {draw(i.head, false)}
                    {draw(i.tail, true)}
                  </Text>
                </Box>
              ))}
            </Box>
          ),
        )}
      </Box>
    )
  })
}
