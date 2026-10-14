/* skim-mode-ui:v1 */
(() => {
  const MIN_LEAD = 25, MIN_DETAIL = 20, MASK = '￼';
  const ABBREVIATION = /(?:^|[^\p{L}])(?:e\.g|i\.e|etc|vs|approx|fig|inc|ltd)$/iu;
  const DOTTED_INITIAL = /\.\p{Lu}$/u;

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

  if (typeof document === 'undefined' || typeof Highlight === 'undefined' || !globalThis.CSS?.highlights) {
    globalThis.__kiloSkim = { splitIndex };
    return;
  }

  const ROOT = '[data-component="text-part"] [data-component="markdown"]';
  const OPAQUE = 'code, kbd, a, .katex';
  const BLOCKS = new Set(['P', 'UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'DETAILS']);
  const highlight = new Highlight(), ranges = new Map(), settle = new Map(), dirty = new Set();
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

  function update(root, final) {
    for (const range of ranges.get(root) || []) highlight.delete(range);
    ranges.delete(root);
    if (!active() || !root.isConnected) return;
    const blocks = [...root.querySelectorAll('p, li')];
    // The last block of a reply that is still being written stays bright until it settles.
    if (!final) blocks.pop();
    const found = blocks.map(detail).filter(Boolean);
    for (const range of found) highlight.add(range);
    if (found.length) ranges.set(root, found);
  }

  function flush() {
    scheduled = false;
    for (const root of [...ranges.keys()]) if (!root.isConnected) dirty.add(root);
    for (const root of dirty) update(root, !settle.has(root));
    dirty.clear();
    const next = getComputedStyle(ranges.keys().next().value || document.body).color;
    if (next === color) return;
    color = next;
    style.textContent = `::highlight(kilo-skim-detail){color:color-mix(in srgb,${color} 55%,transparent)}`;
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
    for (const root of ranges.keys()) dirty.add(root);
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
  globalThis.__kiloSkim = { splitIndex, refresh, details: () => [...highlight].map(String) };
})();
/* end skim-mode-ui */
