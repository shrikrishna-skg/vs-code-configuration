'use strict';
const assert = require('node:assert');
const { ask, digest, clean, system } = require('./session-map-ask.cjs');

// ---------------------------------------------------------------------------
// A tiny hand-made map: two loops, three turns, one of each detail type.
// ---------------------------------------------------------------------------
function makeMap() {
  return {
    title: 'Demo chat',
    loops: [
      { title: 'First loop', from: 1, to: 2, status: 'done' },
      { title: 'Second loop', from: 3, to: 3, status: 'active' },
    ],
    turns: [
      { n: 1, kind: 'ask', text: 'Do A', reply: 'Did A', files: [{ file: 'a.ts', add: 2, del: 1 }], agents: [], errors: [], minutes: 1 },
      { n: 2, kind: 'approval', text: 'ok', reply: '', files: [], agents: [], errors: [], minutes: 0.5 },
      { n: 3, kind: 'ask', text: 'Do B', reply: 'Did B', files: [], agents: [{ type: 'glm', desc: 'investigate' }], errors: [{ tool: 'read', text: 'boom' }], minutes: 2 },
    ],
  };
}

const okLoad = map => () => Promise.resolve(map);
const captureRun = () => {
  const seen = {};
  const run = (sys, input) => { seen.sys = sys; seen.input = input; return Promise.resolve('An answer (#1).'); };
  return { run, seen: () => seen };
};

(async () => {
  // 1. digest: loop headers and per-turn lines.
  {
    const text = digest(makeMap(), 'all');
    assert.ok(text.includes('#1 ask'), 'turn 1 present');
    assert.ok(text.includes('Loop 1: First loop (turns 1-2, done)'), 'loop 1 header');
    assert.ok(text.includes('Loop 2: Second loop (turns 3-3, in progress)'), 'loop 2 header');
    assert.ok(text.includes('You: Do A'), 'user text');
    assert.ok(text.includes('Kilo: Did A'), 'reply');
    assert.ok(text.includes('Files: a.ts +2 -1'), 'files');
    assert.ok(text.includes('Helpers: glm: investigate'), 'helpers');
    assert.ok(text.includes('Problems: read: boom'), 'problems');
    assert.ok(text.includes('Time: 1 min'), 'time');
  }

  // 2. scope=1 excludes other loops' turns.
  {
    const text = digest(makeMap(), 1);
    assert.ok(text.includes('#1 ask') && text.includes('#2 approval'), 'scope keeps its turns');
    assert.ok(!text.includes('#3'), 'scope excludes other loops');
    assert.ok(text.includes('Loop 1:') && !text.includes('Loop 2:'), 'only loop 1 header');
  }

  // 3. 60000 cap drops the oldest turns and adds the marker.
  {
    const turns = [];
    for (let n = 1; n <= 200; n++) {
      turns.push({ n, kind: 'ask', text: 'x'.repeat(2000), reply: '', files: [], agents: [], errors: [], minutes: 0 });
    }
    const big = { title: 'big', loops: [{ title: 'All', from: 1, to: 200, status: 'done' }], turns };
    const text = digest(big, 'all');
    assert.ok(text.length <= 60000, 'digest within cap: ' + text.length);
    assert.ok(text.includes('(older turns omitted)'), 'omission marker present');
    assert.ok(!text.includes('#1 ask'), 'oldest turn dropped');
    assert.ok(text.includes('#200 ask'), 'newest turn kept');
  }

  // 4. empty and too-long questions throw; missing session id throws.
  {
    await assert.rejects(() => ask({}, { sessionID: 's', question: '   ' }, '/d', { load: okLoad(makeMap()) }),
      /Type a question first\./);
    await assert.rejects(() => ask({}, { sessionID: 's', question: 'q'.repeat(2001) }, '/d', { load: okLoad(makeMap()) }),
      /The question is too long\./);
    await assert.rejects(() => ask({}, { question: 'hi' }, '/d', { load: okLoad(makeMap()) }), /No chat is open\./);
  }

  // 5. invalid scope falls back to the whole chat.
  {
    for (const scope of [0, 99, 'nonsense', 1.5, null]) {
      const cap = captureRun();
      await ask({}, { sessionID: 's', question: 'what happened?', scope }, '/d', { load: okLoad(makeMap()), run: cap.run });
      const parsed = JSON.parse(cap.seen().input);
      assert.equal(parsed.scope, 'Whole chat', 'scope ' + JSON.stringify(scope) + ' -> whole chat');
      assert.ok(parsed.chat.includes('Loop 1:') && parsed.chat.includes('Loop 2:'), 'whole chat includes both loops');
    }
    // a valid index is labelled and scoped.
    const cap = captureRun();
    await ask({}, { sessionID: 's', question: 'q', scope: 2 }, '/d', { load: okLoad(makeMap()), run: cap.run });
    const parsed = JSON.parse(cap.seen().input);
    assert.equal(parsed.scope, 'Loop 2: Second loop');
    assert.ok(parsed.chat.includes('#3') && !parsed.chat.includes('#1 '));
  }

  // 6. history trimmed to 6 and long strings cut.
  {
    const history = [];
    for (let i = 0; i < 8; i++) history.push({ q: 'Q' + i + 'x'.repeat(600), a: 'A' + i + 'y'.repeat(1600) });
    const cap = captureRun();
    await ask({}, { sessionID: 's', question: 'q', history }, '/d', { load: okLoad(makeMap()), run: cap.run });
    const parsed = JSON.parse(cap.seen().input);
    assert.equal(parsed.history.length, 6, 'history trimmed to 6');
    assert.equal(parsed.history[0].q.slice(0, 2), 'Q2', 'oldest two dropped');
    assert.ok(parsed.history.every(h => h.q.length <= 500), 'q cut to 500');
    assert.ok(parsed.history.every(h => h.a.length <= 1500), 'a cut to 1500');
  }

  // 7. run receives the system string and the input JSON with the question.
  {
    const cap = captureRun();
    const { answer } = await ask({}, { sessionID: 's', question: 'what did I ask for?' }, '/d',
      { load: okLoad(makeMap()), run: cap.run });
    assert.equal(cap.seen().sys, system, 'system string passed');
    const parsed = JSON.parse(cap.seen().input);
    assert.equal(parsed.question, 'what did I ask for?');
    assert.equal(parsed.title, 'Demo chat');
    assert.equal(answer, 'An answer (#1).');
  }

  // 8. clean keeps '#3' but strips headings and blank runs.
  {
    const out = clean('## Heading\n#3 is where it happened.\n\n\n\n### Sub\ndone');
    assert.ok(!out.includes('## Heading'), 'heading stripped');
    assert.ok(!out.includes('### Sub'), 'sub-heading stripped');
    assert.ok(out.includes('#3'), 'turn citation kept');
  }

  // 9. empty answer throws.
  {
    await assert.rejects(
      () => ask({}, { sessionID: 's', question: 'q' }, '/d', { load: okLoad(makeMap()), run: () => Promise.resolve('   ') }),
      /No answer came back\. Try again\./);
  }

  console.log('session-map-ask: all checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });