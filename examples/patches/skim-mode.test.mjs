import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { patch } from './skim-mode.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const helper = fs.readFileSync(path.join(root, 'skim-mode-ui.js'), 'utf8');

// --- patch(): placement, idempotency, upgrade, restore, mismatch ---
const plain = 'top();/* clarify-goal-patch:v1 */\nrest();';
const withPredict = 'top();/* predict-next-ui:v2 */\nP();\n/* clarify-goal-patch:v1 */\nrest();';
for (const base of [plain, withPredict]) {
  const once = patch(base);
  assert.notEqual(once, base);
  assert.equal(patch(once), once, 'idempotent');
  assert.equal(patch(once, true), base, 'restore exact');
  assert.equal(patch(base, true), base, 'restore without patch is a no-op');
}
assert.ok(patch(plain).startsWith('top();/* skim-mode-ui:v1 */'), 'before clarify marker');
assert.ok(patch(withPredict).indexOf('/* end skim-mode-ui */\n/* predict-next-ui:v2 */') > 0, 'before predict-next block, which owns the span up to clarify');
const older = plain.replace('/* clarify-goal-patch:v1 */', '/* skim-mode-ui:v0 */\nOLD();\n/* end skim-mode-ui */\n/* clarify-goal-patch:v1 */');
assert.equal(patch(older), patch(plain), 'older installed version is replaced');
assert.throws(() => patch('nothing here'), /no changes made/);
assert.throws(() => patch(plain, false, 'not a helper'), /no changes made/);

// --- splitIndex(): where the first sentence ends ---
const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(helper, sandbox);
const { splitIndex } = sandbox.__kiloSkim;
const M = '￼';
const lead = text => { const at = splitIndex(text); return at < 0 ? null : text.slice(0, at); };
const cases = [
  ['The suggestion model was reading your global rules. That is why it sometimes produced a heading.', 'The suggestion model was reading your global rules.'],
  ['Run the reload command and check that the chat text changed.', null],
  ['Yes. It works because the patch now waits for the page to be ready.', null],
  ['It works now. Reload the window to see it.', null],
  ['Each call takes about 1.9 s on average. That is fast enough for typing a reply.', 'Each call takes about 1.9 s on average.'],
  ['Use a fast model, e.g. GLM Flash, for this call. DeepSeek is the fallback when it is missing.', 'Use a fast model, e.g. GLM Flash, for this call.'],
  ['Compare the two, i.e. Hanken vs. Atkinson, side by side. Then pick the one that reads faster.', 'Compare the two, i.e. Hanken vs. Atkinson, side by side.'],
  ['The U.S. Army example is not relevant here at all. Skip it and move to the next one.', 'The U.S. Army example is not relevant here at all.'],
  ['After comparing all four cards, go with option C. It is the easiest one to read at small sizes.', 'After comparing all four cards, go with option C.'],
  ['Did the reload actually load the new bundle? Check the log line to be sure about it.', 'Did the reload actually load the new bundle?'],
  ['The build finally passes on every platform! Ship it once the review is done today.', 'The build finally passes on every platform!'],
  ['The fix lives in predict-next.cjs and nowhere else. It is ready before you finish reading.', 'The fix lives in predict-next.cjs and nowhere else.'],
  ['The file is popup.css. it then loads the font from the same folder as before.', null],
  ['He said "it works now and passes every check." Then we shipped it to everyone on the team.', 'He said "it works now and passes every check."'],
  ['This sentence is long enough to be a lead. Ok.', null],
  ['1. First do the long thing that takes some time. Then do the other thing right after it.', '1. First do the long thing that takes some time.'],
  ['The patch waits for the page to load... Then it paints the detail in a dimmer colour.', 'The patch waits for the page to load...'],
  [`Run ${M.repeat(12)} to apply the patch to both bundles. ${M.repeat(5)} then verifies that it worked.`, `Run ${M.repeat(12)} to apply the patch to both bundles.`],
  [`The write-up is in ${M.repeat(20)} for this change. Open it when you need the details.`, `The write-up is in ${M.repeat(20)} for this change.`],
  ['इस उत्तर में दो वाक्य हैं और पहला काफी लंबा है। दूसरा वाक्य यहाँ है और यह भी लंबा है।', null],
  ['', null],
];
for (const [text, expected] of cases) assert.equal(lead(text), expected, text);

console.log(`PASS: skim-mode patch placement/idempotent/upgrade/restore/mismatch and ${cases.length} sentence cases.`);
