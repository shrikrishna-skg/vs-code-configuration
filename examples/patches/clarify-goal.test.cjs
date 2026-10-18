'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { clarify, modelSettings } = require('./clarify-goal.cjs');

const modelID = 'deepseek-ai/DeepSeek-V4.1-Flash-ultra-chat';
const legacyModelID = 'deepseek-ai/DeepSeek-V4.1-Flash-ultra';
function mockClient(models) {
  const calls = [];
  return {
    calls,
    provider: { list: async () => ({ data: { connected: ['lithosai'], all: [{ id: 'lithosai', name: 'LithosAI', key: 'must-not-leak', models }] } }) },
    session: {
      create: async args => { calls.push(['create', args]); return { data: { id: 'temporary' } }; },
      prompt: async args => { calls.push(['prompt', args]); return { data: { parts: [{ type: 'text', text: 'Clarified goal.' }] } }; },
      abort: async () => { calls.push(['abort']); },
      delete: async () => { calls.push(['delete']); },
    },
  };
}

(async () => {
  const client = mockClient({ [modelID]: {}, [legacyModelID]: {} });
  const message = { text: 'Explain the current behavior.', providerID: 'another-provider', modelID: 'another-model' };
  const result = await clarify(client, message, '/tmp');
  assert.equal(result.model, `lithosai/${modelID}`);
  assert.deepEqual(client.calls.find(([name]) => name === 'prompt')[1].model, { providerID: 'lithosai', modelID });
  assert.equal(message.text, 'Explain the current behavior.');
  assert.deepEqual(client.calls.map(([name]) => name), ['create', 'prompt', 'abort', 'delete']);
  const unavailable = mockClient({ [legacyModelID]: {} });
  await assert.rejects(clarify(unavailable, message, '/tmp'), /unavailable.*draft was kept/);
  assert.deepEqual(unavailable.calls, []);
  const store = new Map();
  const owner = () => ({ extensionContext: { globalState: {
    get: key => store.get(key), update: async (key, value) => store.set(key, value),
  } } });
  const initial = await modelSettings(client, { type: 'requestGoalModels' }, '/tmp', owner());
  assert.equal(initial.selected.modelID, modelID);
  assert.equal(JSON.stringify(initial).includes('must-not-leak'), false);
  const saved = await modelSettings(client, { type: 'setGoalModel', providerID: 'lithosai', modelID: legacyModelID }, '/tmp', owner());
  assert.equal(saved.selected.modelID, legacyModelID);
  const nextChat = await clarify(client, { ...message, requestId: 'another-chat' }, '/tmp', owner());
  assert.equal(nextChat.model, `lithosai/${legacyModelID}`);
  assert.equal((await modelSettings(client, { type: 'requestGoalModels' }, '/tmp', owner())).selected.modelID, legacyModelID);
  await assert.rejects(modelSettings(client, { type: 'setGoalModel', providerID: 'unknown', modelID }, '/tmp', owner()), /no longer available/);
  assert.equal(store.get('goalClarificationModel').modelID, legacyModelID);
  await assert.rejects(clarify(unavailable, { ...message, files: [{ url: 'data:image/png;base64,AA==', mime: 'image/png' }] }, '/tmp', owner()), /cannot read images/);

  const { createRequire } = require('node:module');
  const { chromium } = createRequire(path.join(require('node:os').homedir(), '.config/shared-computer/runtime/package.json'))('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div class="prompt-input-container"><textarea id="draft">Original draft</textarea></div>');
    await page.addScriptTag({ path: path.join(__dirname, 'clarify-goal-ui.js') });
    await page.evaluate(() => {
      window.sent = [];
      window.__kiloGoal.begin(document.querySelector('#draft'), 'unchanged', () => 'unchanged', {
        requestId: 'first', post: message => window.sent.push(message), cancel: () => {},
      });
    });
    await page.evaluate(settings => window.__kiloGoal.modelSettings(document.querySelector('#draft'), {
      ...settings, requestId: 'first-models',
    }), initial);
    await page.getByRole('combobox', { name: 'Clarification model' }).selectOption(String(initial.models.findIndex(model => model.modelID === legacyModelID)));
    const requested = await page.evaluate(() => window.sent.at(-1));
    assert.equal(requested.type, 'setGoalModel');
    assert.equal(requested.modelID, legacyModelID);
    assert.equal(await page.locator('#draft').inputValue(), 'Original draft');
    await page.evaluate(settings => window.__kiloGoal.modelSettings(document.querySelector('#draft'), settings), {
      ...saved, saved: true, requestId: requested.requestId,
    });
    assert.equal(await page.getByRole('combobox').isEnabled(), true);
    assert.ok(await page.getByRole('status').filter({ hasText: 'Saved for goal' }).count());
    await page.evaluate(() => window.__kiloGoal.preview(document.querySelector('#draft'), {
      text: 'Rewritten draft', model: 'lithosai/original-running-model', attachments: 0, contextMessages: 0,
    }, value => { document.querySelector('#draft').value = value; }));
    assert.equal(await page.getByRole('combobox').inputValue(), String(initial.models.findIndex(model => model.modelID === legacyModelID)));
    assert.equal(await page.locator('#draft').inputValue(), 'Original draft');
    await page.getByRole('button', { name: 'Use this prompt' }).click();
    assert.equal(await page.locator('#draft').inputValue(), 'Rewritten draft');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  console.log('PASS: saved model across chats, default routing, unavailable models, image guard, cleanup, dropdown selection, and draft preservation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
