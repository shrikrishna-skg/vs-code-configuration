'use strict';
const assert = require('node:assert');
const vm = require('node:vm');
const path = require('node:path');
const { buildMap } = require('./session-map.cjs');

// ---------------------------------------------------------------------------
// Fixture: 46 turns, kinds a=ask o=approval x=auto.
// ---------------------------------------------------------------------------
const KINDS = 'aoaaaoxxxoaoaaaxaoaaaaoxxxxxaxxaoxxxxaxxooxxxo';

const APPROVALS = {
  2: 'Continue with the recommended next step.',
  6: 'Go ahead and wire it up.',
  10: 'Approved, carry on.',
  12: 'Yes, please.',
  18: "Sure, I like the A option. Let's implement it.",
  23: 'Okay.',
  33: 'I like a',
  41: 'Please continue.',
  42: 'Yes.',
  46: 'Please continue.',
};

const ASKS = {
  1: 'Align sponsored listing UI with standards.',
  3: 'Make the rail match the review card spacing.',
  4: 'Still if you see the icon right this tooltip it is not following us.',
  5: 'Show me two variations.',
  11: 'Move the badge to the top corner.',
  13: 'Draft the rail mockup with the new hierarchy.',
  14: 'Keep the counts at the right edge.',
  15: 'Use the same spacing as the review cards.',
  17: 'Write the mockup now.',
  19: 'Implement the chosen rail.',
  20: 'Add the hover state.',
  21: 'Now the empty state.',
  22: 'I mean i want to see our present UI with this psychology',
  29: 'Run the checks on the rail.',
  32: 'Tighten the labels.',
  38: 'Fix the tooltip alignment.',
};

const IMAGE_TURNS = new Set([5, 20]);
const EDIT_TURNS = new Set([19, 29]);
const CHECK_TURNS = new Set([21]);

function taskPart(subagentType) {
  return { type: 'tool', tool: 'task', state: { status: 'completed', input: { subagent_type: subagentType }, time: { start: 0, end: 1 } } };
}
function writePart(filePath) {
  return { type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath }, time: { start: 0, end: 1 } } };
}
function editPart(filePath) {
  return { type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath }, time: { start: 0, end: 1 } } };
}
function browserPart() {
  return { type: 'tool', tool: 'playwright_browser_click', state: { status: 'completed', input: {}, time: { start: 0, end: 1 } } };
}

function buildFixture() {
  const base = 1700000000000;
  const messages = [];
  for (let n = 1; n <= KINDS.length; n++) {
    const kind = KINDS[n - 1];
    const userParts = [];
    if (kind === 'x') userParts.push({ type: 'text', text: 'task finished', synthetic: true });
    else userParts.push({ type: 'text', text: ASKS[n] || APPROVALS[n] || 'Do the thing.' });
    if (IMAGE_TURNS.has(n)) userParts.push({ type: 'file', mime: 'image/png' });
    const created = base + n * 60000;
    const user = { info: { id: 'm' + n, role: 'user', time: { created } }, parts: userParts };

    const assistantParts = [{ type: 'text', text: 'Working on it.' }];
    if (n === 6) assistantParts.push(taskPart('deepseek-implementer'), taskPart('deepseek-implementer'), taskPart('glm-investigator'));
    if (n === 17) assistantParts.push(writePart('mockups/draft-rail-mockup.html'));
    if (EDIT_TURNS.has(n)) assistantParts.push(editPart('src/rail.tsx'));
    if (CHECK_TURNS.has(n)) assistantParts.push(browserPart());
    const assistant = {
      info: { id: 'a' + n, role: 'assistant', time: { created: created + 1000, completed: created + 30000 + (n % 5) * 15000 } },
      parts: assistantParts,
    };
    messages.push(user, assistant);
  }
  return messages;
}

// 1. the full fixture
{
  const map = buildMap(buildFixture());

  assert.equal(map.turns.length, 46);
  assert.equal(map.totals.turns, 46);
  assert.equal(map.totals.asks, 16);
  assert.equal(map.totals.approvals, 10);
  assert.equal(map.totals.autos, 20);

  assert.equal(map.loops.length, 7);
  assert.deepEqual(map.loops.map(l => l.from), [1, 3, 11, 13, 19, 29, 38]);

  // turn 4 and turn 22 are asks, not approvals
  assert.equal(map.turns[3].kind, 'ask');
  assert.equal(map.turns[21].kind, 'ask');

  // loop starting at 13: mock + "Chose A"
  const mockLoop = map.loops.find(l => l.from === 13);
  assert.ok(mockLoop);
  assert.equal(mockLoop.call.tag, 'Chose A');
  assert.equal(mockLoop.call.n, 18);
  assert.ok(mockLoop.mock);
  assert.ok(mockLoop.mock.path.endsWith('draft-rail-mockup.html'));
  assert.equal(mockLoop.mock.n, 17);

  // redirects
  assert.equal(map.loops.find(l => l.from === 3).call.tag, 'Corrected');
  assert.equal(map.loops.find(l => l.from === 3).call.n, 4);
  assert.equal(map.loops.find(l => l.from === 19).call.tag, 'Clarified');
  assert.equal(map.loops.find(l => l.from === 19).call.n, 22);

  // helpers
  assert.equal(map.totals.helpers, 3);
  const helperLoop = map.loops.find(l => l.from === 3);
  assert.deepEqual(helperLoop.build.agents, { 'deepseek-implementer': 2, 'glm-investigator': 1 });
  assert.equal(map.turns[5].tasks, 3);

  // last loop is active, others done
  assert.equal(map.loops[map.loops.length - 1].status, 'active');
  assert.ok(map.loops.slice(0, -1).every(l => l.status === 'done'));

  // images land in the ask loops
  assert.equal(map.totals.images, 2);
  assert.equal(helperLoop.ask.images, 1);

  // check stage
  assert.equal(map.loops.find(l => l.from === 19).check.n, 21);

  // messageID is the user message id
  assert.equal(map.turns[0].messageID, 'm1');

  // minutes add up (per-loop rounding may drift a little from the single-rounded total)
  const loopMinutes = map.loops.reduce((s, l) => s + l.build.minutes, 0);
  assert.ok(Math.abs(map.totals.minutes - loopMinutes) < 0.5);
  assert.ok(map.totals.minutes > 0);
}

// 2. empty input
{
  const map = buildMap([]);
  assert.deepEqual(map.turns, []);
  assert.equal(map.loops.length, 0);
  assert.equal(map.totals.turns, 0);
  assert.equal(map.totals.helpers, 0);
  assert.doesNotThrow(() => buildMap());
  assert.doesNotThrow(() => buildMap([{ info: {}, parts: [] }]));
}

// 3. canned text becomes an approval
{
  const long = 'Please apply the recommended fix and then re-run the focused checks.';
  const messages = [{ info: { id: 'u1', role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: long }] }];
  assert.equal(buildMap(messages).turns[0].kind, 'ask');
  assert.equal(buildMap(messages, { canned: [long] }).turns[0].kind, 'approval');
}

// 4. per-turn detail
{
  const root = '/repo';
  const home = '/Users/demo';
  const edit = (filePath, diff) => ({
    type: 'tool', tool: 'edit',
    state: { status: 'completed', input: { filePath }, metadata: { diff }, time: { start: 0, end: 1 } },
  });
  const messages = [
    { info: { id: 'u1', role: 'user', time: { created: 1000 } }, parts: [{ type: 'text', text: 'Do the work.' }] },
    {
      info: { id: 'a1', role: 'assistant', time: { created: 2000, completed: 5000 }, tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 3 } } },
      parts: [
        { type: 'text', text: '## Answer\nDid the work.\n- first\n- second\n\n## Next step\nShip it.' },
        edit('/repo/src/a.ts', '--- a/src/a.ts\n+++ b/src/a.ts\n+one\n+two\n+three\n-old'),
        edit('/repo/src/a.ts', '+extra'),
        { type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: '/repo/mockups/x.html', content: 'l1\nl2\nl3\nl4' }, time: { start: 0, end: 1 } } },
        edit('/Users/demo/notes.md', '+n\n-n'),
        { type: 'tool', tool: 'bash', state: { status: 'completed', input: { description: 'Run tests', command: 'npm test\necho more' }, metadata: { exit: 1 }, time: { start: 0, end: 1 } } },
        { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, metadata: { exit: 0 }, time: { start: 0, end: 1 } } },
        { type: 'tool', tool: 'read', state: { status: 'error', input: { filePath: '/repo/readme' }, error: '### Error\nError: boom', time: { start: 0, end: 1 } } },
        { type: 'tool', tool: 'task', state: { status: 'completed', input: { subagent_type: 'glm-investigator', description: 'Investigate foo' }, time: { start: 0, end: 1 } } },
        { type: 'tool', tool: 'playwright_browser_click', state: { status: 'completed', input: {}, time: { start: 0, end: 1 } } },
      ],
    },
  ];

  const map = buildMap(messages, { root, home });
  const t = map.turns[0];

  assert.equal(t.text, 'Do the work.');
  assert.equal(t.tokens, 38);
  assert.equal(t.checks, 1);
  assert.deepEqual(t.agents, [{ type: 'glm-investigator', desc: 'Investigate foo', status: 'completed' }]);

  assert.equal(t.errors.length, 1);
  assert.equal(t.errors[0].tool, 'read');
  assert.equal(t.errors[0].text, 'Error: boom');

  // two edits to src/a.ts merge (3+1 add, 1 del); write counts content lines; home becomes ~
  assert.equal(t.files.length, 3);
  assert.deepEqual(t.files[0], { file: 'src/a.ts', add: 4, del: 1 });
  assert.deepEqual(t.files.find(f => f.file === 'mockups/x.html'), { file: 'mockups/x.html', add: 4, del: 0 });
  assert.deepEqual(t.files.find(f => f.file === '~/notes.md'), { file: '~/notes.md', add: 1, del: 1 });
  assert.equal(map.totals.files, 3);

  assert.deepEqual(t.commands[0], { desc: 'Run tests', cmd: 'npm test', exit: 1, status: 'completed' });
  assert.deepEqual(t.commands[1], { desc: '', cmd: 'ls', exit: 0, status: 'completed' });

  assert.equal(t.reply, 'Did the work.\n\u2022 first\n\u2022 second');
  assert.equal(t.next, 'Ship it.');
}

// 5. UI defaults and the close / full-screen controls.
// A tiny hand-rolled DOM: just the surface session-map-ui.js touches.
{
  const uiSource = require('node:fs').readFileSync(path.join(__dirname, 'session-map-ui.js'), 'utf8');

  function makeDom() {
    class Node {}
    class TextNode extends Node {
      constructor(t) { super(); this.nodeType = 3; this.parentNode = null; this._t = String(t); }
      get textContent() { return this._t; }
      set textContent(v) { this._t = String(v); }
    }
    const makeStyle = () => ({ setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } });
    class El extends Node {
      constructor(tag) {
        super();
        this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.parentNode = null;
        this.childNodes = []; this.attrs = Object.create(null); this._classes = new Set();
        this._listeners = Object.create(null); this.dataset = Object.create(null);
        this.style = makeStyle(); this.hidden = false; this.inert = false; this.tabIndex = 0;
        this.offsetTop = this.offsetLeft = this.offsetWidth = this.offsetHeight = 0;
        this.clientWidth = this.clientHeight = 0; this.scrollTop = 0;
      }
      get isConnected() { return true; }
      get children() { return this.childNodes.filter(n => n.nodeType === 1); }
      get className() { return [...this._classes].join(' '); }
      set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
      get classList() {
        const s = this._classes;
        return {
          add: (...c) => c.forEach(x => s.add(x)),
          remove: (...c) => c.forEach(x => s.delete(x)),
          contains: c => s.has(c),
          toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; },
        };
      }
      get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
      set textContent(v) { this.childNodes = []; if (v !== '') this.childNodes.push(new TextNode(v)); }
      setAttribute(k, v) { if (k === 'class') this.className = v; else this.attrs[k] = String(v); }
      getAttribute(k) { return k === 'class' ? this.className : (k in this.attrs ? this.attrs[k] : null); }
      appendChild(k) { this.append(k); return k; }
      append(...kids) { for (const k of kids) this.childNodes.push(k instanceof Node ? k : new TextNode(k)); }
      prepend(k) { this.childNodes.unshift(k instanceof Node ? k : new TextNode(k)); }
      replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
      remove() { const p = this.parentNode; if (p) p.childNodes.splice(p.childNodes.indexOf(this), 1); }
      addEventListener(t, fn) { (this._listeners[t] || (this._listeners[t] = [])).push(fn); }
      removeEventListener(t, fn) { const a = this._listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
      dispatchEvent(e) { e.target = this; for (const fn of (this._listeners[e.type] || []).slice()) fn(e); }
      click() { this.dispatchEvent({ type: 'click' }); }
      focus() { this._focused = true; }
      scrollTo() {}
      _matches(sel) { return sel.split('.').filter(Boolean).every(c => this._classes.has(c)); }
      _all() { const out = []; for (const c of this.childNodes) if (c.nodeType === 1) { out.push(c, ...c._all()); } return out; }
      querySelectorAll(sel) { const parts = sel.split(',').map(s => s.trim()).filter(Boolean); return this._all().filter(n => parts.some(p => n._matches(p))); }
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    }
    const raf = [];
    const document = { createElement: t => new El(t), createElementNS: (_ns, t) => new El(t) };
    const window = { matchMedia: () => ({ matches: false }) };
    return { document, window, Node, raf, flush: () => { while (raf.length) raf.shift()(); } };
  }

  const tick = () => new Promise(r => setTimeout(r, 5));
  const keyEscape = { type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} };
  const map = {
    title: 'Demo', totals: { turns: 2, helpers: 0, minutes: 1 },
    loops: [{ title: 'Loop', from: 1, to: 2, status: 'done' }],
    turns: [
      { n: 1, kind: 'ask', text: 'hi', files: [], commands: [], errors: [], agents: [], checks: 0, tokens: 0, minutes: 0, messageID: 'm1' },
      { n: 2, kind: 'auto', text: 'ok', files: [], commands: [], errors: [], agents: [], checks: 0, tokens: 0, minutes: 0, messageID: 'm2' },
    ],
  };
  const dom = makeDom();
  const sandbox = { document: dom.document, window: dom.window, Node: dom.Node, requestAnimationFrame: fn => dom.raf.push(fn) };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(uiSource, sandbox);

  const mount = dom.document.createElement('div');
  const button = dom.document.createElement('button');
  dom.document.createElement('body').appendChild(mount);
  sandbox.__kiloSessionMap.attach({ mount, button, load: () => Promise.resolve(map), jump: () => {} });

  const open = async () => { button.click(); await tick(); dom.flush(); return mount.querySelector('.ksm-map'); };
  const tools = root => root.querySelectorAll('.ksm-tool');
  const btnByText = (root, text) => tools(root).find(b => b.textContent.trim() === text);

  (async () => {
    // 5a. diagram is off by default when the map opens.
    let root = await open();
    assert.equal(root.hidden, false, 'map opens');
    assert.ok(root.querySelector('.ksm-close'), 'close button exists');
    assert.equal(root.querySelector('.ksm-dg').hidden, true, 'diagram hidden on open');
    assert.equal(btnByText(root, 'Diagram').getAttribute('aria-pressed'), 'false', 'Diagram toggle off');

    // 5b. the Diagram toggle shows it and hides it again.
    btnByText(root, 'Diagram').click();
    assert.equal(root.querySelector('.ksm-dg').hidden, false, 'diagram shown on toggle');
    assert.equal(btnByText(root, 'Diagram').getAttribute('aria-pressed'), 'true');
    btnByText(root, 'Diagram').click();
    assert.equal(root.querySelector('.ksm-dg').hidden, true, 'diagram hidden again');

    // 5c. full screen adds the class; Escape exits it without closing the map.
    btnByText(root, 'Diagram').click();
    let fullBtn = btnByText(root, 'Full screen');
    assert.ok(fullBtn, 'full-screen button exists');
    assert.equal(fullBtn.getAttribute('aria-pressed'), 'false');
    fullBtn.click();
    assert.equal(root.querySelector('.ksm-dg').classList.contains('ksm-dg-full'), true, 'full-screen class added');
    assert.equal(fullBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(fullBtn.textContent.trim(), 'Exit full screen');
    root.dispatchEvent(keyEscape);
    assert.equal(root.querySelector('.ksm-dg').classList.contains('ksm-dg-full'), false, 'Escape exits full screen');
    assert.equal(root.hidden, false, 'Escape keeps the map open');
    assert.equal(btnByText(root, 'Full screen').getAttribute('aria-pressed'), 'false');

    // full screen is dropped when the Diagram toggle hides the aside.
    fullBtn = btnByText(root, 'Full screen'); fullBtn.click();
    assert.equal(root.querySelector('.ksm-dg').classList.contains('ksm-dg-full'), true);
    btnByText(root, 'Diagram').click();
    assert.equal(root.querySelector('.ksm-dg').classList.contains('ksm-dg-full'), false, 'hiding the diagram exits full screen');
    assert.equal(root.querySelector('.ksm-dg').hidden, true);

    // a second Escape closes the map.
    root.dispatchEvent(keyEscape);
    assert.equal(root.hidden, true, 'Escape closes the map');

    // 5d. the Close button closes the map and returns focus to the trigger.
    root = await open();
    btnByText(root, 'Diagram').click();
    assert.equal(root.querySelector('.ksm-dg').classList.contains('ksm-dg-full'), false);
    root.querySelector('.ksm-close').click();
    assert.equal(root.hidden, true, 'Close closes the map');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button._focused, true, 'focus returns to the trigger');

    console.log('session-map: all checks passed');
  })().catch(err => { console.error(err); process.exitCode = 1; });
}