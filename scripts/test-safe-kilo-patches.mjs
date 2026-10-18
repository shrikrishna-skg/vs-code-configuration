import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install } from '../examples/patches/safe-kilo-patches.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-kilo-gate-'));
const source = 'document.getElementById("root").innerHTML="<button>Chat ready</button>";';
function fixture(name, code) {
  const dir = path.join(temp, name, 'dist');
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ['webview.js', 'agent-manager.js']) fs.writeFileSync(path.join(dir, file), source);
  fs.writeFileSync(path.join(dir, 'extension.js'), 'module.exports={};');
  const patch = path.join(temp, name, 'patch.mjs');
  fs.writeFileSync(patch, 'import fs from "node:fs";const target=process.argv[2];' + code);
  return { dir, patch, target: path.join(dir, 'webview.js') };
}
async function rejected(name, code, pattern) {
  const f = fixture(name, code);
  await assert.rejects(install('patch', f.patch, [f.target]), pattern, name);
  assert.equal(fs.readFileSync(f.target, 'utf8'), source, name + ': working bundle preserved');
  assert.equal(fs.readFileSync(path.join(f.dir, 'agent-manager.js'), 'utf8'), source);
  assert(!fs.readdirSync(f.dir).some(name => name.includes('.safe-patch-')), 'No candidate left behind');
  console.log('PASS blocked ' + name + '; installed files unchanged');
}
try {
  const f = fixture('valid', 'if(!process.argv.includes("--check")&&!fs.readFileSync(target,"utf8").includes("//done"))fs.appendFileSync(target,"\\n//done");');
  assert.equal(await install('patch', f.patch, [f.target]), 1);
  assert.equal(await install('patch', f.patch, [f.target]), 0);
  assert(fs.readdirSync(f.dir).some(name => name.includes('.pre-validated-')), 'Working version backed up');
  fs.writeFileSync(f.dir + '.kilo-patch-lock', 'another installer');
  await assert.rejects(install('patch', f.patch, [f.target]), /EEXIST/);
  fs.unlinkSync(f.dir + '.kilo-patch-lock');
  await rejected('syntax despite passing marker check', 'if(!process.argv.includes("--check"))fs.writeFileSync(target,"const value=;");', /failed/);
  await rejected('runtime exception', 'if(!process.argv.includes("--check"))fs.writeFileSync(target,' + JSON.stringify(source + 'throw Error("render failed");') + ');', /runtime errors/);
  await rejected('blank renderer', 'if(!process.argv.includes("--check"))fs.writeFileSync(target,"// marker says installed");', /Timeout/);
  await rejected('hidden renderer', 'if(!process.argv.includes("--check"))fs.writeFileSync(target,' + JSON.stringify(source + 'document.getElementById("root").style.display="none";') + ');', /root is hidden/);
  await rejected('invalid generated helper', 'if(!process.argv.includes("--check"))fs.writeFileSync(target.replace("webview.js","helper.cjs"),"const invalid = ;");', /failed/);
  await rejected('unstable second application', 'if(!process.argv.includes("--check"))fs.appendFileSync(target,"\\n//"+Math.random());', /not idempotent/);
  await rejected('patch crashes after writing', 'fs.writeFileSync(target,"broken");throw Error("patch crashed");', /failed/);
  const race = fixture('concurrent edit', 'if(!process.argv.includes("--check"))fs.writeFileSync(' + JSON.stringify(path.join(temp, 'concurrent edit/dist/extension.js')) + ',"module.exports={newer:true}");');
  await assert.rejects(install('patch', race.patch, [race.target]), /changed during validation/);
  assert.equal(fs.readFileSync(path.join(race.dir, 'extension.js'), 'utf8'), 'module.exports={newer:true}');
  assert.equal(fs.readFileSync(race.target, 'utf8'), source);
  console.log('PASS concurrent edit is preserved');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
