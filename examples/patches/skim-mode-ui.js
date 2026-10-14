/* skim-mode-ui:v2 */
(() => {
  const MIN_LEAD = 25, MIN_DETAIL = 20, MASK = '￼', MAX_ROW = 180;
  const ABBREVIATION = /(?:^|[^\p{L}])(?:e\.g|i\.e|etc|vs|approx|fig|inc|ltd)$/iu;
  const DOTTED_INITIAL = /\.\p{Lu}$/u;
  const FLAGS = [['bad', /^(?:failed|blocked|blocker|broken)\b/i], ['warn', /^(?:risks?|warning|caution|not checked)\b/i]];

  // Returns where the first sentence ends, or -1 when the text should stay fully bright.
  // ponytail: sentence ends are only trusted before a capital, digit or code span; other scripts stay undimmed.
  function splitIndex(text) {
    const end = /[.!?]+["'”’)\]]*(?=\s+["'“‘(\[]?[\p{Lu}\p{N}￼])/gu;
    for (let m; (m = end.exec(text));) {
      const before = text.slice(0, m.index), at = m.index + m[0].length;
      if (m[0][0] === '.' && (ABBREVIATION.test(before) || DOTTED_INITIAL.test(before) || /^\s*\d+$/.test(before))) continue;
      if (text.slice(0, at).trim().length < MIN_LEAD) continue;
      return text.slice(at).trim().length < MIN_DETAIL ? -1 : at;
    }
    return -1;
  }
  // A bold label such as "Risk:" or "Failed:" at the start of a point marks it; returns 'warn', 'bad' or null.
  const flagKind = label => (FLAGS.find(([, re]) => re.test(label.trim())) || [])[0] || null;
  const isDecisionHeading = text => /^next steps?$/i.test(text.trim());
  const isAnswerHeading = text => /^answer$/i.test(text.trim());
  // The first sentence of a point for the bottom-line strip. `masked` is the same text with code, links and
  // math replaced by MASK (same length), so a full stop inside them never ends the sentence.
  function lead(text, masked = text) {
    const skip = text.match(/^[\s:\u2013\u2014-]*/)[0].length;
    text = text.slice(skip);
    masked = masked.slice(skip);
    const at = splitIndex(masked);
    let s = (at < 0 ? text : text.slice(0, at)).replace(/\s+/g, ' ').trim();
    if (s.length > MAX_ROW) s = s.slice(0, MAX_ROW - 1).trimEnd() + '\u2026';
    return masked.trimStart().charAt(0) === MASK ? s : s.charAt(0).toUpperCase() + s.slice(1);
  }

  if (typeof document === 'undefined' || typeof Highlight === 'undefined' || !globalThis.CSS?.highlights) {
    globalThis.__kiloSkim = { splitIndex, flagKind, isDecisionHeading, lead };
    return;
  }

  const ROOT = '[data-component="text-part"] [data-component="markdown"]';
  const OPAQUE = 'code, kbd, a, .katex';
  const HEADINGS = 'h1, h2, h3, h4, h5, h6';
  const BLOCKS = new Set(['P', 'UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'DETAILS']);
  const DECISION = 'data-kilo-decision', FLAG = 'data-kilo-flag', LINE = 'kilo-bottom-line';
  const accent = 'var(--vscode-textLink-foreground,#6b9bff)', warn = 'var(--vscode-editorWarning-foreground,#e5b567)', bad = 'var(--vscode-errorForeground,#f07b72)';
  const STATIC = `[${DECISION}]{padding:6px 10px;border-left:2px solid ${accent};border-radius:0 6px 6px 0;background:color-mix(in srgb,${accent} 10%,transparent)}
[${FLAG}=warn]>strong:first-child,li[${FLAG}=warn]::marker{color:${warn}}
[${FLAG}=bad]>strong:first-child,li[${FLAG}=bad]::marker{color:${bad}}
.${LINE}{margin:0 0 10px;padding:8px 10px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:color-mix(in srgb,currentColor 4%,transparent);line-height:1.45;user-select:none}
.${LINE}-title{margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.7}
.${LINE}-row{display:flex;gap:8px;align-items:baseline;margin:3px 0 0}
.${LINE}-chip{flex:none;min-width:58px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-align:center;text-transform:uppercase;background:color-mix(in srgb,currentColor 14%,transparent)}
.${LINE}-chip[data-kind=do]{color:${accent}}.${LINE}-chip[data-kind=warn]{color:${warn}}.${LINE}-chip[data-kind=bad]{color:${bad}}
`;
  const highlight = new Highlight(), ranges = new Map(), lines = new Map(), owners = new WeakMap(), settle = new Map(), dirty = new Set();
  const style = document.createElement('style');
  let enabled = true, scheduled = false, color = '';
  try { enabled = localStorage.getItem('kilo.skimMode') !== 'off'; } catch { /* Storage can be unavailable; stay on. */ }
  CSS.highlights.set('kilo-skim-detail', highlight);

  const active = () => enabled && !/\bvscode-high-contrast/.test(document.body.className) && !matchMedia('(forced-colors: active)').matches;

  function detail(block) {
    if (block.closest('pre, table')) return null;
    let limit = null;
    if (block.tagName === 'LI') {
      for (const child of block.children) if (BLOCKS.has(child.tagName)) { limit = child; break; }
      if (limit && limit.tagName === 'P') return null;
    }
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), parts = [];
    let text = '';
    for (let node; (node = walker.nextNode());) {
      if (limit && (limit.compareDocumentPosition(node) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING))) break;
      const opaque = node.parentElement.closest(OPAQUE);
      parts.push({ node, start: text.length });
      text += opaque && block.contains(opaque) ? MASK.repeat(node.data.length) : node.data;
    }
    const at = splitIndex(text);
    if (at < 0) return null;
    const part = parts.findLast(p => p.start <= at), range = document.createRange();
    range.setStart(part.node, at - part.start);
    if (limit) range.setEndBefore(limit); else range.setEnd(block, block.childNodes.length);
    return range;
  }

  // The bold label that opens a point, or null when the point starts with plain text.
  function label(block) {
    const first = block.firstElementChild;
    if (!first || first.tagName !== 'STRONG') return null;
    for (let node = block.firstChild; node && node !== first; node = node.nextSibling) if (node.textContent.trim()) return null;
    return first;
  }
  // Text of a point without nested lists, and optionally without its label, split on the masked text.
  function pointText(block, dropLabel) {
    const copy = block.cloneNode(true);
    for (const nested of copy.querySelectorAll('ul, ol')) nested.remove();
    if (dropLabel) label(copy)?.remove();
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    let text = '', masked = '';
    for (let node; (node = walker.nextNode());) {
      text += node.data;
      masked += node.parentElement.closest(OPAQUE) ? MASK.repeat(node.data.length) : node.data;
    }
    return lead(text, masked);
  }
  const after = (root, test) => { const h = [...root.querySelectorAll(HEADINGS)].find(e => test(e.textContent)); return h && h.nextElementSibling; };

  // keepLine leaves the bottom-line strip in place while a reply is still streaming, so it does not flicker.
  function undecorate(root, keepLine) {
    for (const el of root.querySelectorAll(`[${DECISION}], [${FLAG}]`)) { el.removeAttribute(DECISION); el.removeAttribute(FLAG); }
    if (keepLine) return;
    const strip = lines.get(root);
    if (strip) { owners.delete(strip); strip.remove(); }
    lines.delete(root);
  }
  // Decision highlight: the paragraph after a Next step heading is tinted and stays bright,
  // and points opening with Risk, Failed or a similar label get a colour.
  // Decision first: once the reply settles, a bottom-line strip above it repeats the answer, the next step and those points.
  // ponytail: found by heading and label words only; replies that use other words are not marked. The strip sits
  // outside Kilo's markdown node, so streaming re-renders never touch it; it is aria-hidden because it repeats the reply.
  function decorate(root, final) {
    const next = after(root, isDecisionHeading);
    const decision = next && next.tagName === 'P' ? next : null;
    decision?.setAttribute(DECISION, '');
    const flagged = [];
    for (const block of root.querySelectorAll('p, li')) {
      const tag = label(block), kind = tag && flagKind(tag.textContent);
      if (kind) { block.setAttribute(FLAG, kind); flagged.push({ kind, name: tag.textContent.replace(/[:\s]+$/, ''), block }); }
    }
    if (!final || !next) return;
    const rows = [], answer = after(root, isAnswerHeading);
    if (answer && answer.tagName === 'P') rows.push(['point', 'Answer', pointText(answer)]);
    const first = next.tagName === 'P' ? next : next.querySelector('li');
    if (first) rows.push(['do', 'Do', pointText(first)]);
    for (const { kind, name, block } of flagged.filter(f => f.kind === 'bad').concat(flagged.filter(f => f.kind === 'warn')).slice(0, 5)) rows.push([kind, name, pointText(block, true)]);
    const filled = rows.filter(row => row[2]);
    if (!filled.length) return;
    const strip = document.createElement('div'), title = document.createElement('div');
    strip.className = LINE;
    strip.setAttribute('aria-hidden', 'true');
    title.className = LINE + '-title';
    title.textContent = 'Bottom line';
    strip.append(title);
    for (const [kind, name, text] of filled) {
      const row = document.createElement('div'), chip = document.createElement('span'), body = document.createElement('span');
      row.className = LINE + '-row';
      chip.className = LINE + '-chip';
      chip.dataset.kind = kind;
      chip.textContent = name;
      body.textContent = text;
      row.append(chip, body);
      strip.append(row);
    }
    root.before(strip);
    lines.set(root, strip);
    owners.set(strip, root);
  }

  function update(root, final) {
    for (const range of ranges.get(root) || []) highlight.delete(range);
    ranges.delete(root);
    const live = active() && root.isConnected;
    undecorate(root, live && !final);
    if (!live) return;
    decorate(root, final);
    // The decision stays fully bright, so it is never dimmed.
    const blocks = [...root.querySelectorAll('p, li')].filter(b => !b.closest(`[${DECISION}]`));
    // The last block of a reply that is still being written stays bright until it settles.
    if (!final) blocks.pop();
    const found = blocks.map(detail).filter(Boolean);
    for (const range of found) highlight.add(range);
    if (found.length) ranges.set(root, found);
  }

  function flush() {
    scheduled = false;
    for (const root of [...ranges.keys(), ...lines.keys()]) if (!root.isConnected) dirty.add(root);
    for (const root of dirty) update(root, !settle.has(root));
    dirty.clear();
    const next = getComputedStyle(ranges.keys().next().value || document.body).color;
    if (next === color) return;
    color = next;
    style.textContent = STATIC + `::highlight(kilo-skim-detail){color:color-mix(in srgb,${color} 55%,transparent)}`;
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }
  function touch(root, streaming) {
    dirty.add(root);
    if (streaming) {
      clearTimeout(settle.get(root));
      settle.set(root, setTimeout(() => { settle.delete(root); dirty.add(root); schedule(); }, 1200));
    }
    schedule();
  }
  function refresh() {
    color = '';
    for (const root of [...ranges.keys(), ...lines.keys()]) dirty.add(root);
    for (const root of document.querySelectorAll(ROOT)) dirty.add(root);
    schedule();
  }

  const content = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const root = target && target.closest(ROOT);
      if (root) { touch(root, true); continue; }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(ROOT)) touch(node, false);
        for (const inner of node.querySelectorAll(ROOT)) touch(inner, false);
      }
      // A strip removed by Kilo (not by this helper) is rebuilt for its reply on the next flush.
      for (const node of record.removedNodes) { const owner = owners.get(node); if (owner && owner.isConnected) dirty.add(owner); }
      if (record.removedNodes.length) schedule();
    }
  });
  const theme = new MutationObserver(refresh);

  addEventListener('keydown', event => {
    if (!event.ctrlKey || !event.altKey || event.metaKey || event.code !== 'KeyS') return;
    event.preventDefault();
    enabled = !enabled;
    try { localStorage.setItem('kilo.skimMode', enabled ? 'on' : 'off'); } catch { /* Keep the in-memory choice. */ }
    refresh();
  }, true);

  function start() {
    document.head.append(style);
    content.observe(document.body, { childList: true, subtree: true, characterData: true });
    theme.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    refresh();
  }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start, { once: true });
  globalThis.__kiloSkim = { splitIndex, flagKind, isDecisionHeading, lead, refresh, details: () => [...highlight].map(String) };
})();
/* end skim-mode-ui */
