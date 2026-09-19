#!/usr/bin/env node

import fs from "node:fs";

const target = process.argv[2];
const checkOnly = process.argv.includes("--check");

if (!target) {
  console.error("Usage: remember-last-agent.mjs <webview.js> [--check]");
  process.exit(2);
}

const storageKey = "kilo:last-selected-agent";
const replacements = [
  [
    'function ly(e){return e.replace(/[\\s:_-]*\\(free\\)\\s*$/i,"").trim()}',
    'function ly(e){return e.replace(/[\\s:_-]*\\((?:free|\\$+)\\)\\s*$/i,"").trim()}',
  ],
  [
    'function qnt(e,t,n,r,a,i,o){return e?t===ci?OE(e):e:',
    'function qnt(e,t,n,r,a,i,o){return e?t===ci?ly(OE(e)):ly(e):',
  ],
  [
    "[fn,Jt]=xe(null)",
    `[fn,Jt]=xe(localStorage.getItem("${storageKey}"))`,
  ],
  [
    "function Oge(re,ze){let ft=ze??o();",
    `function Oge(re,ze){localStorage.setItem("${storageKey}",re);let ft=ze??o();`,
  ],
  [
    'function fBn(){if(!n.isConnected()){console.warn("[Kilo New] Cannot create session: not connected");return}sn.prune(g()),Jt(null),t.postMessage({type:"createSession"})}',
    'function fBn(){if(!n.isConnected()){console.warn("[Kilo New] Cannot create session: not connected");return}let re=tr();sn.prune(g()),Jt(re),t.postMessage({type:"createSession"})}',
  ],
  [
    'function ABn(){sn.prune(g()),b(!0),s(void 0),f(void 0),an(null),Y(!1),Jt(null),t.postMessage({type:"clearSession"})}',
    'function ABn(){let re=tr();sn.prune(g()),b(!0),s(void 0),f(void 0),an(null),Y(!1),Jt(re),t.postMessage({type:"clearSession"})}',
  ],
  [
    "w=()=>{let T=i();return A(Z8n(f(),T)),b(T),T},C=T=>",
    "w=()=>{let T=i(),F=r.selectedAgent(d());return A(Z8n(f(),T)),r.setSessionAgent(T,F),b(T),T},C=T=>",
  ],
];

let source = fs.readFileSync(target, "utf8");
let changed = false;

for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  const matches = source.split(before).length - 1;
  if (matches !== 1) {
    console.error(`Refusing to patch: expected one match, found ${matches}: ${before.slice(0, 80)}`);
    process.exit(1);
  }
  source = source.replace(before, after);
  changed = true;
}

if (checkOnly) {
  if (changed) {
    console.error("Patch is not installed.");
    process.exit(1);
  }
  console.log("Remember-last-agent patch is installed.");
  process.exit(0);
}

if (!changed) {
  console.log("Remember-last-agent patch is already installed.");
  process.exit(0);
}

const backup = `${target}.pre-remember-last-agent`;
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);

const temporary = `${target}.remember-last-agent-${process.pid}`;
fs.writeFileSync(temporary, source);
fs.renameSync(temporary, target);
console.log(`Patched ${target}`);
console.log(`Backup ${backup}`);
