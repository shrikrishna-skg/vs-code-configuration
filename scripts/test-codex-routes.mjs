import assert from 'node:assert/strict';
import { KILO_MODELS, effectiveEffort, strictWorkspace, kiloInvocation, kiloResult } from '../examples/codex-router/kilo-route.mjs';

const model = KILO_MODELS['deepseek-high'];
assert.equal(effectiveEffort(model), 'high');
assert.equal(effectiveEffort(model, 'max'), 'max');
assert.throws(() => effectiveEffort(model, 'ultra'), /Unsupported/);
await assert.rejects(strictWorkspace('missing workspace'), /absolute workspace/);
await assert.rejects(strictWorkspace('<cwd>relative</cwd>'), /absolute workspace/);
await assert.rejects(strictWorkspace('<cwd>/definitely-missing-codex-test-directory</cwd>'));
assert.equal(await strictWorkspace('<cwd>/invalid</cwd><cwd>/tmp</cwd>'), '/tmp');
for (const profile of Object.values(KILO_MODELS)) {
  const spec = await kiloInvocation(profile, '<cwd>/tmp</cwd>', profile.effort);
  const config = JSON.parse(spec.env.KILO_CONFIG_CONTENT);
  const task = config.agent[profile.agent].permission.task;
  assert.equal(config.agent['deepseek-workstream-lead'].permission.task['luna-utility'], 'deny');
  if (profile.agent === 'codex-astra-lead') {
    assert.equal(task['deepseek-implementer'], 'allow');
    assert.equal(task['glm-investigator'], 'allow');
    assert.equal(task['*'], 'deny');
  } else assert.equal(task, 'deny');
  assert.ok(!spec.args.includes('--auto'));
  assert.equal(spec.args[spec.args.indexOf('--model') + 1], profile.model);
}
const event = value => JSON.stringify(value) + '\n';
const output = event({type:'text',part:{text:'Done'}}) + event({type:'step_finish',part:{reason:'stop',tokens:{input:3,output:2}}});
assert.equal(kiloResult(output).result, 'Done');
assert.equal(kiloResult(output).usage.output_tokens, 2);
assert.equal(kiloResult(event({type:'text',part:{text:'Interim progress'}}) + event({type:'step_start'}) + output).result, 'Done');
assert.throws(() => kiloResult('invalid'), /Malformed/);
assert.throws(() => kiloResult(''), /completed/);
assert.throws(() => kiloResult(event({type:'text',part:{text:'Working...'}})), /completed/);
assert.throws(() => kiloResult(event({type:'error',error:{data:{message:'auth expired'}}})), /auth expired/);
assert.throws(() => kiloResult(output + event({type:'step_finish',part:{reason:'tool-calls'}})), /completed/);
console.log('Codex route assertions passed: effort, workspace, delegation isolation, model mapping, completion and error parsing.');
