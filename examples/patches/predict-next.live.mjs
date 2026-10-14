#!/usr/bin/env node
// Live check: runs predict-next.cjs against the real model with canned chat endings and prints the raw and shown output.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.KILO_PREDICT_LOG = os.devNull;
const root = path.dirname(fileURLToPath(import.meta.url));
const { predict } = createRequire(import.meta.url)(path.join(root, 'predict-next.cjs'));
const kilo = process.env.KILO_BIN || path.join(os.homedir(), '.vscode/extensions/shrikrishna-skg.kilo-code-local-7.8.2/bin/kilo');
const port = Number(process.env.KILO_LIVE_PORT || 48911), base = `http://127.0.0.1:${port}`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'predict-next-live-'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/SERVER_(PASSWORD|USERNAME)$/.test(key)) delete env[key];
const server = spawn(kilo, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], { cwd: directory, env, stdio: 'ignore' });

let raw = '';
async function call(method, url, { query = {}, body, signal } = {}) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined));
  const res = await fetch(`${base}${url}?${q}`, { method, signal, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw Error(`${method} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  return { data: text ? JSON.parse(text) : undefined };
}
const client = history => ({
  provider: { list: ({ directory }, o) => call('GET', '/provider', { query: { directory }, signal: o.signal }) },
  session: {
    messages: async () => ({ data: history }),
    create: ({ directory, ...body }, o) => call('POST', '/session', { query: { directory }, body, signal: o.signal }),
    prompt: async ({ sessionID, directory, ...body }, o) => {
      const r = await call('POST', `/session/${sessionID}/message`, { query: { directory }, body, signal: o.signal });
      raw = (r.data?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
      return r;
    },
    abort: ({ sessionID, directory }, o) => call('POST', `/session/${sessionID}/abort`, { query: { directory }, signal: o.signal }),
    delete: ({ sessionID, directory }, o) => call('DELETE', `/session/${sessionID}`, { query: { directory }, signal: o.signal }),
  },
});

const u = text => ({ info: { role: 'user' }, parts: [{ type: 'text', text }] });
const a = text => ({ info: { role: 'assistant' }, parts: [{ type: 'text', text }] });
const scenarios = [
  { name: 'plan proposed', actual: "I like it. Let's go ahead make a plan and start working on it. Use multiple agents to do it.", history: [
    u('Right, so inspect everything, the setup that we have, and use multiple agents for that. For predicting the next message use GLM 5.3 Flash. So tell me how we will be doing it.'),
    a('## Answer\n\n**How we build it**\n\n- **Model:** a hidden `next-message-predictor` agent pinned to GLM 5.3 Flash Ultra, low reasoning, no tools.\n\n- **Display:** when a turn completes and the input is empty, show the prediction as grey text; Tab inserts, typing or Esc clears.\n\n- **Delivery:** one patch script with check, apply and restore.\n\n## My opinion\n\nA separate GLM call is the better choice. The main risk is latency.\n\n## Next step\n\nBuild in the order above, starting with a five-call latency check of GLM at low reasoning before touching the webview.'),
  ] },
  { name: 'asked to reload', actual: 'done', history: [
    u("I like it. Let's go ahead make a plan and start working on it. Use multiple agents to do it."),
    a('## Answer\n\n**Built and installed, not yet seen working.** It only takes effect after a window reload, which I did not do.\n\n- **Display:** when a turn completes and the input is empty, the prediction appears as grey text; Tab inserts it.\n\n## Verification\n\n- **Passed:** both new test files and all 22 existing patch checks.\n\n- **Not tested:** the live chat UI.\n\n## My opinion\n\nThe wiring is low risk. Speed is the open question.\n\n## Next step\n\nRun "Developer: Reload Window", then send one message and watch the empty input for the grey suggestion.'),
  ] },
  { name: 'pick an option', actual: "I like this let's implement it.", history: [
    u('Can you create a comparison mockup for me so I can see two, three different fonts and decide?'),
    a('## Answer\n\n**The comparison mockup is open in Chrome.** It shows the same chat reply in four fonts:\n\n- **A. Apple system font (SF Pro)**\n\n- **B. Hanken Grotesk**\n\n- **C. Atkinson Hyperlegible:** my suggestion.\n\n- **D. Inter**\n\n## My opinion\n\nAtkinson is the only one where I, l and 1 are clearly different.\n\n## Next step\n\nCompare the look-alike row across the four cards and name the letter to install.'),
  ] },
  { name: 'UI work not built yet', actual: '(habit) first create a mockup or 2-3 variations', history: [
    u('I want to redesign the popup header of my review reply extension so it looks cleaner and more premium.'),
    a('## Answer\n\n- The header lives in `popup.html` and is styled in `popup.css`.\n\n- Two directions fit: a compact single row with the logo and status, or a two-row header that adds the property name.\n\n## My opinion\n\nThe compact single row is cleaner and keeps more room for replies.\n\n## Next step\n\nApprove the compact single-row direction and I will implement it in `popup.css`.'),
  ] },
  { name: 'work finished', actual: '(any sensible follow-up, or nothing)', history: [
    u('The submit button on the popup overlaps the footer on small windows, fix it.'),
    a('## Answer\n\n- **Fixed:** the button row now wraps instead of overlapping the footer below 360px.\n\n- **Cause:** a fixed height on `.actions` in `popup.css`.\n\n## Verification\n\n- **Passed:** checked the popup at 320px and 400px wide in the browser.\n\n## My opinion\n\nThis was a one-line cause and the fix is low risk.\n\n## Next step\n\nNo further action is needed.'),
  ] },
  { name: 'asks permission', actual: '(want) Yes, patch Claude Code.', history: [
    u('Add the font to my other chat extensions too.'),
    a('## Answer\n\n- Claude Code and Codex are separate extensions that update automatically, so each needs its own patch.\n\n## My opinion\n\nPatching Claude Code first makes sense because you use it daily.\n\n## Next step\n\nApprove patching the Claude Code chat and I will add the font there.'),
  ] },
  { name: 'non-visual next step', actual: '(want) Yes, switch to streaming and rerun it.', history: [
    u('The reply generator times out on long reviews.'),
    a('## Answer\n\n- **Cause:** `service-worker.js` waits for the whole response, so the 30 s timeout fires on long reviews.\n\n## My opinion\n\nStreaming the response fixes this at the root.\n\n## Next step\n\nSwitch the request in `service-worker.js` to streaming and rerun the long-review case.'),
  ] },
];

try {
  const deadline = Date.now() + 60000;
  for (;;) {
    try { await call('GET', '/provider', { query: { directory } }); break; }
    catch (error) { if (Date.now() > deadline) throw Error('Kilo server did not start: ' + error.message); await new Promise(r => setTimeout(r, 500)); }
  }
  for (const s of scenarios) {
    raw = '';
    try {
      const result = await predict(client(s.history), { sessionID: 'live', requestId: s.name }, directory, {});
      console.log(`== ${s.name} (${result.ms}ms)\n   raw:    ${JSON.stringify(raw.slice(0, 400))}\n   shown:  ${JSON.stringify(result.text)}\n   actual: ${JSON.stringify(s.actual)}`);
    } catch (error) {
      console.log(`== ${s.name}\n   ERROR:  ${error.message}\n   raw:    ${JSON.stringify(raw.slice(0, 400))}`);
    }
  }
} finally {
  server.kill();
}
