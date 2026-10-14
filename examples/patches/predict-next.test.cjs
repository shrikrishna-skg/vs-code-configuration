'use strict';
const assert = require('node:assert');
process.env.KILO_PREDICT_LOG = require('node:os').devNull;
const { predict, cancel, contextFrom, clean, instructions } = require('./predict-next.cjs');

function makeClient(options = {}) {
  const calls = [];
  const prompts = [];
  const models = options.glmMissing
    ? { 'deepseek-ai/DeepSeek-V4.1-Flash-ultra': {} }
    : { 'zai-org/GLM-5.3-Flash-ultra': {}, 'deepseek-ai/DeepSeek-V4.1-Flash-ultra': {} };
  const client = {
    provider: { list: async () => { calls.push('list'); return { data: { all: [{ id: 'lithosai', models }] } }; } },
    session: {
      messages: async () => { calls.push('messages'); return { data: options.messages || [] }; },
      create: async () => { calls.push('create'); return { data: { id: 'tmp-1' } }; },
      prompt: async (args, opts) => {
        calls.push('prompt');
        prompts.push(args);
        if (options.prompt) return options.prompt(args, opts);
        return { data: { parts: [{ type: 'text', text: 'Looks good, run the tests.' }] } };
      },
      abort: async () => { calls.push('abort'); },
      delete: async () => { calls.push('delete'); },
    },
  };
  return { client, calls, prompts };
}

(async () => {
  // 1. clean()
  assert.equal(clean('NONE'), '');
  assert.equal(clean('none'), '');
  assert.equal(clean('  None  '), '');
  assert.equal(clean('"Looks good, run the tests."'), 'Looks good, run the tests.');
  assert.equal(clean('`review the changes`'), 'review the changes');
  assert.equal(clean('User: apply the patch'), 'apply the patch');
  assert.equal(clean('Next message: verify it'), 'verify it');
  assert.equal(clean('User: "Looks good"'), 'Looks good');
  assert.equal(clean('first line\nsecond line'), 'first line');
  assert.equal(clean('   \n\n  hello   world  '), 'hello world');
  assert.equal(clean('a'.repeat(201)), '');
  assert.equal(clean('a'.repeat(200)), 'a'.repeat(200));
  assert.equal(clean(''), '');
  assert.equal(clean(undefined), '');
  assert.equal(clean('## Answer\n\nLooks good, run it.'), '');
  assert.equal(clean('Go ahead.\n\n## My opinion\nFine.'), '');
  assert.equal(clean('- **Go** with B'), 'Go with B');
  assert.ok(instructions.includes('NONE'));

  // 2. contextFrom()
  const ctx = contextFrom([
    { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'A'.repeat(2000) }] },
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'U'.repeat(700) }] },
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'drop', synthetic: true }] },
  ]);
  assert.equal(ctx.length, 2);
  assert.equal(ctx[0].role, 'assistant');
  assert.equal(ctx[0].text, 'A'.repeat(2000).slice(-1500));
  assert.equal(ctx[1].role, 'user');
  assert.equal(ctx[1].text, 'U'.repeat(700).slice(0, 600));
  const many = contextFrom(Array.from({ length: 8 }, (_, i) => ({ info: { role: 'user', i }, parts: [{ type: 'text', text: 'm' + i }] })));
  assert.equal(many.length, 6);
  assert.equal(many[0].text, 'm2');

  // 3. predict() order, args and cleaned text
  {
    const { client, calls, prompts } = makeClient({ messages: [] });
    const result = await predict(client, { sessionID: 's1', requestId: 'r1' }, '/tmp', {});
    assert.equal(result.text, 'Looks good, run the tests.');
    assert.ok(Number.isInteger(result.ms) && result.ms >= 0);
    assert.equal(result.model, 'lithosai/zai-org/GLM-5.3-Flash-ultra');
    assert.ok(calls.indexOf('create') < calls.indexOf('prompt'));
    assert.ok(calls.indexOf('prompt') < calls.indexOf('delete'));
    assert.ok(calls.includes('abort'));
    assert.equal(prompts[0].model.modelID, 'zai-org/GLM-5.3-Flash-ultra');
    assert.equal(prompts[0].variant, 'low');
    assert.equal(prompts[0].agent, 'next-message-predictor');
    assert.equal(prompts[0].parts[0].type, 'text');
    assert.deepEqual(JSON.parse(prompts[0].parts[0].text), { recentChat: [] });
  }

  // cleaned text is applied
  {
    const { client } = makeClient({ prompt: async () => ({ data: { parts: [{ type: 'text', text: '"Do it."' }] } }) });
    const result = await predict(client, { sessionID: 's1' }, '/tmp', {});
    assert.equal(result.text, 'Do it.');
  }

  // tool call -> empty text
  {
    const { client } = makeClient({ prompt: async () => ({ data: { parts: [{ type: 'tool', tool: 'x' }] } }) });
    const result = await predict(client, { sessionID: 's1' }, '/tmp', {});
    assert.equal(result.text, '');
  }

  // 4. delete still runs when prompt rejects
  {
    const { client, calls } = makeClient({ prompt: async () => { throw new Error('boom'); } });
    await assert.rejects(() => predict(client, { sessionID: 's1', requestId: 'r2' }, '/tmp', {}), /boom/);
    assert.ok(calls.indexOf('create') < calls.indexOf('delete'));
    assert.ok(calls.includes('delete'));
  }

  // 5. fallback to DeepSeek when GLM is absent
  {
    const { client, prompts } = makeClient({ glmMissing: true });
    const result = await predict(client, { sessionID: 's1', requestId: 'r3' }, '/tmp', {});
    assert.equal(result.model, 'lithosai/deepseek-ai/DeepSeek-V4.1-Flash-ultra');
    assert.equal(prompts[0].model.modelID, 'deepseek-ai/DeepSeek-V4.1-Flash-ultra');
  }

  // 6. a second predict for the same owner aborts the first
  {
    const { client, calls } = makeClient({
      prompt: (args, opts) => new Promise((resolve, reject) => {
        const stop = () => reject(opts.signal.reason);
        if (opts.signal.aborted) return stop();
        opts.signal.addEventListener('abort', stop, { once: true });
        setTimeout(() => resolve({ data: { parts: [{ type: 'text', text: 'second answer' }] } }), 30);
      }),
    });
    const owner = {};
    const first = predict(client, { sessionID: 's1', requestId: 'a' }, '/tmp', owner).then(() => 'resolved', () => 'aborted');
    await new Promise(r => setImmediate(r));
    const second = await predict(client, { sessionID: 's1', requestId: 'b' }, '/tmp', owner);
    assert.equal(await first, 'aborted');
    assert.equal(second.text, 'second answer');
    assert.equal(calls.filter(c => c === 'create').length, 2);
  }

  // predictions for different sessions do not cancel each other
  {
    const { client } = makeClient({ prompt: () => new Promise(resolve => setTimeout(() => resolve({ data: { parts: [{ type: 'text', text: 'ok' }] } }), 20)) });
    const owner = {};
    const [one, two] = await Promise.all([
      predict(client, { sessionID: 's1', requestId: 'a' }, '/tmp', owner),
      predict(client, { sessionID: 's2', requestId: 'b' }, '/tmp', owner),
    ]);
    assert.equal(one.text, 'ok');
    assert.equal(two.text, 'ok');
    assert.equal(clean('None.'), '');
  }

  // cancel() semantics
  {
    const owner = {};
    assert.equal(cancel(owner, 'missing'), false);
  }

  // missing sessionID rejects
  {
    const { client } = makeClient();
    await assert.rejects(() => predict(client, { requestId: 'x' }, '/tmp', {}), /session ID/);
  }

  console.log('predict-next: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });