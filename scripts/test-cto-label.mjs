import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patch } from '../examples/patches/cto-selected-label.mjs';
for (const [binding,variable,formatter] of [['b','A','MWe'],['A','b','DUe']]) {
  const source = `let ${binding}=()=>{let ${variable}=e.agents.find(y=>y.name===e.value);return ${variable}?${formatter}(${variable}):e.value||"Code"}`;
  const after = patch(source);
  assert.equal(patch(after), after);
  assert.equal(patch(after,true),source);
  assert.throws(()=>patch(source+source));
  for (const [value, expected] of [['CTO (Recommended)','CTO'],['CTO + JEV','CTO + JEV'],['Other','Other'],['','Code']]) {
    const agents = value ? [{name:value}] : [];
    assert.equal(vm.runInNewContext(`${after};${binding}()`, {e:{agents,value},[formatter]:a=>a.name}), expected);
    assert.equal(agents[0]?.name ?? '',value,'Display must not rename the selected agent or menu entry');
  }
}
assert.throws(()=>patch('unknown bundle'));
console.log('CTO label checks passed: trigger only, other agents preserved, idempotence, restoration and unknown-bundle refusal.');
