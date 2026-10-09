#!/usr/bin/env node
// Opt-in paid model test. Uses a disposable workspace, never the product repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { run, parseEvents } from '../examples/cto/worker.mjs';
import { discoverBinary, git } from '../examples/cto/manager.mjs';

const fixture = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cto-goal-validation-'));
if (!process.argv[2]) {
  fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Overview comparison</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Overview comparison</h1><p>Compare the current and previous account overviews.</p>' + ['current', 'previous'].map((version, i) => `<section data-version="${version}"><h2>${i ? 'Previous' : 'Current'} overview</h2><label class="account-label" for="${version}-account">Account</label><select id="${version}-account"><option>All accounts</option><option>North property</option></select><p class="summary">${i ? 'Previous total: 38' : 'Current total: 42'} reviews</p></section>`).join('') + '</main></body></html>');
  fs.writeFileSync(path.join(fixture, 'styles.css'), 'body { font: 16px system-ui; margin: 32px; background: #f4f6f8; color: #17222c; }\nmain { max-width: 800px; margin: auto; }\nsection { padding: 24px; margin-block: 20px; background: white; border: 1px solid #bbc3ca; border-radius: 8px; }\nh2 { margin-block: 0 20px; }\n.account-label { display: block; margin-bottom: 2px; font-weight: 600; }\nselect { padding: 8px; min-width: 180px; }\n');
  fs.writeFileSync(path.join(fixture, 'README.md'), 'Local disposable overview comparison. Open index.html directly; no build or dependencies. Keep Current and Previous content and both account selectors. Shared styles live in styles.css.\n');
  git(fixture, ['init']); git(fixture, ['add', '.']);
  git(fixture, ['-c', 'user.name=Local validation', '-c', 'user.email=validation@localhost', 'commit', '-m', 'Baseline comparison fixture']);
}
const workspace = fs.realpathSync(fixture);
assert(path.basename(workspace).startsWith('cto-goal-validation-'), 'Use the disposable validation fixture only');
const model = process.argv[3] || 'lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra';
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'cto-goal-evidence-'));
let session;
const turns = [];
const prompts = [
  'Make this page an interactive comparison using accessible Current and Previous tabs. Keep both existing overviews and account selectors intact. Default to Current, support keyboard switching, and do not add dependencies.',
  'The Account label looks cramped. I want 12px below it in both versions while keeping the earlier behavior. Check the cause and tell me the smallest fix, but do not edit yet.',
  'Sure.',
  'Is it working now?',
];
const files = () => ['index.html', 'styles.css', 'README.md'].map(name => fs.readFileSync(path.join(workspace, name), 'utf8'));
console.log(JSON.stringify({ workspace, artifacts, model }));
try {
  for (const [index, prompt] of prompts.entries()) {
    const before = files();
    const start = Date.now();
    // Match the UI's existing auto-approve setting for this disposable test only;
    // explicit deny rules still apply and no persistent permissions are changed.
    const args = ['run', '--pure', '--auto', '--format', 'json', '--agent', 'CTO (Recommended)', '--model', model, '--variant', 'high', '--dir', workspace];
    if (session) args.push('--session', session);
    else args.push('--title', 'CTO goal continuity — DeepSeek validation');
    const result = await run(discoverBinary(), args, { cwd: workspace, input: prompt, timeout: 360000, outputFile: path.join(artifacts, `turn-${index + 1}.jsonl`), errorFile: path.join(artifacts, `turn-${index + 1}.stderr`) });
    assert.equal(result.exitCode, 0, result.stderr.slice(-1000));
    const parsed = parseEvents(result.stdout); session ||= parsed.session;
    const events = result.stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const tools = events.filter(event => event.type === 'tool_use').map(event => ({ tool: event.part.tool, status: event.part.state?.status }));
    const steps = events.filter(event => event.type === 'step_finish');
    const tokens = steps.reduce((sum, event) => {
      const t = event.part.tokens || {};
      for (const key of ['input', 'output', 'reasoning']) sum[key] += t[key] || 0;
      sum.cacheRead += t.cache?.read || 0; sum.cacheWrite += t.cache?.write || 0;
      return sum;
    }, { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
    const turn = { prompt, session, seconds: Math.round((Date.now() - start) / 100) / 10, steps: steps.length, tokens, tools, report: parsed.report };
    turns.push(turn); console.log(JSON.stringify(turn));
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ workspace, model, session, turns }, null, 2));
    if (index === 0) assert(files()[0].includes('tab'), 'No comparison tabs implemented');
    if (index === 1) assert.deepEqual(files(), before, 'Inspection-only request edited the fixture');
    if (index === 2) assert.notDeepEqual(files(), before, 'The short approval failed to execute the proposed fix');
    if (index === 3) {
      assert.deepEqual(files(), before, 'Status-only request changed implementation');
      assert.equal(tools.length, 0, 'Fresh verification should be reused for a status-only reply');
    }
  }

  // An independent browser oracle checks actual behavior, not the model's claims.
  const require = createRequire(path.join(os.homedir(), '.config/shared-computer/runtime/package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('file://' + path.join(workspace, 'index.html'));
    const current = page.getByRole('tab', { name: /^Current$/i });
    const previous = page.getByRole('tab', { name: /^Previous$/i });
    assert.equal(await current.getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[data-version="current"]').isVisible(), true);
    assert.equal(await page.locator('[data-version="previous"]').isVisible(), false);
    await current.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await previous.getAttribute('aria-selected'), 'true', 'Keyboard switching failed');
    assert.equal(await page.locator('[data-version="previous"]').isVisible(), true);
    await page.locator('#previous-account').selectOption({ label: 'North property' });
    await current.click(); await page.locator('#current-account').selectOption({ label: 'North property' });
    await previous.click(); assert.equal(await page.locator('#previous-account').inputValue(), 'North property');
    for (const version of ['current', 'previous']) {
      await page.getByRole('tab', { name: new RegExp('^' + version + '$', 'i') }).click();
      assert.equal(await page.locator(`[data-version="${version}"] .account-label`).evaluate(el => getComputedStyle(el).marginBottom), '12px');
    }
    assert.equal(await page.locator('.summary').allTextContents().then(values => values.join('|')), 'Current total: 42 reviews|Previous total: 38 reviews');
    await page.screenshot({ path: path.join(artifacts, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
    await page.screenshot({ path: path.join(artifacts, 'mobile.png') });
    assert.deepEqual(errors, [], 'Browser runtime error');
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(artifacts, 'verified.json'), JSON.stringify({ passed: true, workspace, model, session, turns }, null, 2));
  console.log(JSON.stringify({ passed: true, session, artifacts }));
} catch (error) {
  fs.writeFileSync(path.join(artifacts, 'failure.txt'), error.stack);
  throw error;
}
