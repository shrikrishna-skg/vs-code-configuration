// Replays chat switch / reload and live streaming against the installed __kiloGlide.
// Usage: node smooth-follow.test.mjs [path/to/webview.js]
import fs from "node:fs";
import os from "node:os";

const file = process.argv[2] || `${os.homedir()}/.vscode/extensions/${fs.readdirSync(`${os.homedir()}/.vscode/extensions`).filter((d) => d.startsWith("shrikrishna-skg.kilo-code-local-")).sort().at(-1)}/dist/webview.js`;
const bundle = fs.readFileSync(file, "utf8");
const start = bundle.indexOf("/*kilo-glide:v1*/");
if (start < 0) throw new Error("__kiloGlide not found in bundle");
const source = bundle.slice(start, bundle.indexOf("var Jia=300", start));

let now = 0;
let frames = [];
const fake = {
  performance: { now: () => now },
  requestAnimationFrame: (fn) => frames.push(fn) && frames.length,
  cancelAnimationFrame: () => { frames = []; },
  globalThis: { matchMedia: () => ({ matches: false }), document: { hidden: false } }
};
const make = new Function(...Object.keys(fake), `${source}; return __kiloGlide;`)(...Object.values(fake));

function element(height) {
  let top = 0;
  return {
    scrollHeight: height, clientHeight: 800,
    get scrollTop() { return top; },
    set scrollTop(v) { top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); },
    addEventListener() {}
  };
}
const run = (ms) => { const end = now + ms; while (now < end) { now += 16; const due = frames; frames = []; due.forEach((fn) => fn(now)); } };
const atBottom = (el) => el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
const failures = [];

// 1. Chat switch / reload: history snaps in, then late blocks (code, images) add 400px.
for (const live of [false, true]) {
  now = 1000; frames = [];
  const el = element(6000);
  const glide = make(el);
  glide.to(live);
  if (!atBottom(el)) failures.push(`load (working=${live}): first render did not land at the bottom`);
  run(80);
  el.scrollHeight += 400;
  glide.to(live);
  if (!atBottom(el)) failures.push(`load (working=${live}): late content made the chat move down a second time instead of landing in place`);
}

// 2. Short chat opened: fits in under two screens, must not visibly scroll on open.
now = 5000; frames = [];
const short = element(1300);
make(short).to(true);
if (!atBottom(short)) failures.push("short chat: opened with a visible glide instead of landing at the bottom");

// 3. Streaming well after load: a small addition should glide, then finish at the bottom.
now = 10000; frames = [];
const el = element(6000);
const glide = make(el);
glide.to(true);
run(2000);
el.scrollHeight += 60;
glide.to(true);
if (atBottom(el)) failures.push("streaming: a new line snapped instead of gliding");
run(400);
if (!atBottom(el)) failures.push("streaming: glide did not finish at the bottom");

// 4. Idle chat: content change without a running agent never glides.
el.scrollHeight += 60;
glide.to(false);
if (!atBottom(el)) failures.push("idle: content change glided while no agent was working");

if (failures.length) { console.error(`FAIL\n- ${failures.join("\n- ")}`); process.exit(1); }
console.log("smooth-follow: load, short chat, streaming and idle cases pass");
