import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

// Mounts one reply on each surface; returns the dimmed and bright text, or null where the engine drew its own.
async function skim($: Engine, on: On, text: string, store: Record<string, unknown> = {}) {
  mock.store(on, store)
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  const out: ({ dim: string; bright: string; markdown: string } | null)[] = []
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'skim-mode', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
    if (await ui.find({ key: 'engine' })) out.push(null)
    else {
      const texts = await ui.findAll({ type: 'Text' })
      const leaves = texts.filter(t => t.children.every(c => typeof c === 'string'))
      const dim = leaves.filter(t => t.props.dimColor === true).map(t => t.text).join('')
      // A Text's `text` holds its nested Texts' too, so the bright part is the body less its dim tail.
      const body = texts.filter(t => !leaves.includes(t)).map(t => t.text).join('\n')
      const bright = body.endsWith(dim) ? body.slice(0, body.length - dim.length) : body
      const markdown = (await ui.findAll({ type: 'Markdown' })).map(m => String(m.props.text)).join('\n')
      out.push({ dim, bright, markdown })
    }
    await ui.unmount()
  }
  return out
}

test('a two-sentence point splits after its first sentence', async ($, on) => {
  for (const r of await skim($, on, '- **Risk:** the parser is slow on big files. It needs a `cache.get()` call before release.')) {
    expect(r?.dim).toBe(' It needs a cache.get() call before release.')
    expect(r?.bright).toBe('Risk: the parser is slow on big files.')
  }
})

test('"e.g." does not end a sentence', async ($, on) => {
  expect(await skim($, on, 'Use a short alias, e.g. Foo for the default path in every config file you keep.')).toEqual([null, null])
})

test('a decimal like 1.2 does not end a sentence', async ($, on) => {
  for (const r of await skim($, on, 'Version 1.2 ships the new parser for every user. It also fixes the crash on startup.')) {
    expect(r?.bright).toBe('Version 1.2 ships the new parser for every user.')
    expect(r?.dim).toBe(' It also fixes the crash on startup.')
  }
})

test('a too-short remainder stays bright', async ($, on) => {
  expect(await skim($, on, 'This first sentence is long enough to count. Short end.')).toEqual([null, null])
})

test('a code block alone passes through', async ($, on) => {
  const fence = '```\nThe first line of code is long enough. The second line of code is long too.\n```'
  expect(await skim($, on, fence)).toEqual([null, null])
})

test('a code block beside a paragraph is drawn as Markdown', async ($, on) => {
  const fence = '```\nThe first line of code is long enough. The second line of code is long too.\n```'
  for (const r of await skim($, on, `${fence}\n\nThe paragraph after the code is long. Its second sentence is dimmed here.`)) {
    expect(r?.markdown).toBe(fence)
    expect(r?.dim).toBe(' Its second sentence is dimmed here.')
  }
})

test('/skim off leaves the engine drawing', async ($, on) => {
  expect(await skim($, on, 'The paragraph here is long enough. Its second sentence would be dimmed.', { enabled: false })).toEqual([null, null])
})
