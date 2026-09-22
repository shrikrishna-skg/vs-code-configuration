import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KILO_MODELS, effectiveEffort, strictWorkspace, kiloInvocation, kiloResult } from '../examples/codex-router/kilo-route.mjs';

const model = KILO_MODELS['deepseek-high'];
assert.equal(effectiveEffort(model), 'high');
assert.equal(effectiveEffort(model, 'max'), 'max');
assert.throws(() => effectiveEffort(model, 'ultra'), /Unsupported/);
await assert.rejects(strictWorkspace('missing workspace'), /absolute workspace/);
await assert.rejects(strictWorkspace('<cwd>relative</cwd>'), /absolute workspace/);
await assert.rejects(strictWorkspace('<cwd>/definitely-missing-codex-test-directory</cwd>'));
assert.equal(await strictWorkspace('<cwd>/invalid</cwd><cwd>/tmp</cwd>'), '/tmp');
const renamedWorkspace = await mkdtemp(path.join(os.tmpdir(), 'codex-renamed-workspace-'));
try {
  const target = path.join(renamedWorkspace, 'target');
  const alias = path.join(renamedWorkspace, 'old-name');
  const image = path.join(renamedWorkspace, 'image.png');
  await mkdir(target);
  await symlink(target, alias);
  await writeFile(image, 'fixture');
  assert.equal(await strictWorkspace(`<cwd>${alias}</cwd>`), alias);
  const aliasConfig = JSON.parse((await kiloInvocation(model, `<cwd>${alias}</cwd>`, 'high')).env.KILO_CONFIG_CONTENT);
  assert.equal(aliasConfig.permission.external_directory[alias + '/*'], 'allow');
  assert.equal(aliasConfig.permission.external_directory[(await realpath(target)) + '/*'], 'allow');
  const imageSpec = await kiloInvocation(model, `<cwd>${alias}</cwd>`, 'high', [image]);
  assert.equal(imageSpec.args[imageSpec.args.indexOf('--file') + 1], image);
  const imageConfig = JSON.parse(imageSpec.env.KILO_CONFIG_CONTENT);
  assert.equal(imageConfig.permission.external_directory[renamedWorkspace + '/*'], 'allow');
} finally {
  await rm(renamedWorkspace, { recursive: true, force: true });
}
for (const profile of Object.values(KILO_MODELS)) {
  assert.deepEqual(profile.inputModalities, ['text', 'image']);
  const spec = await kiloInvocation(profile, '<cwd>/tmp</cwd>', profile.effort);
  const config = JSON.parse(spec.env.KILO_CONFIG_CONTENT);
  const task = config.agent[profile.agent].permission.task;
  assert.equal(config.agent['deepseek-workstream-lead'].permission.task['luna-utility'], 'deny');
  if (profile.lead) {
    assert.equal(task['deepseek-implementer'], 'allow');
    assert.equal(task['glm-investigator'], 'allow');
    assert.equal(task['*'], 'deny');
  } else assert.equal(task, 'deny');
  assert.ok(!spec.args.includes('--auto'));
  assert.equal(spec.args[spec.args.indexOf('--model') + 1], profile.model);
}
const fable = KILO_MODELS['fable-engineering-lead'];
const fableHigh = await kiloInvocation(fable, '<cwd>/tmp</cwd>');
assert.equal(fableHigh.args[fableHigh.args.indexOf('--model') + 1], 'claude-local-cli/fable-5-1-high');
// The lead prompt must come from the installed fable-engineering-lead.md, which names its bound model.
assert.match(JSON.parse(fableHigh.env.KILO_CONFIG_CONTENT).agent['codex-fable-lead'].prompt, /claude-local-cli\/fable-5-1-high/);
const fableMax = await kiloInvocation(fable, '<cwd>/tmp</cwd>', 'max');
assert.equal(fableMax.args[fableMax.args.indexOf('--model') + 1], 'claude-local-cli/fable-5-1-max');
assert.equal(JSON.parse(fableMax.env.KILO_CONFIG_CONTENT).agent['codex-fable-lead'].model, 'claude-local-cli/fable-5-1-max');

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
