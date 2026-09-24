import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { backupPath, patchSource, workParent } from "./codex-thinking-status.mjs";

const runtime = await readFile(new URL("./codex-thinking-status-runtime.js", import.meta.url), "utf8");
const fixture = "function dc(){ return true; }\nconst label = `thinkingShimmer.default`;\n//# sourceMappingURL=fixture.js.map";
const patched = patchSource(fixture, runtime);

assert.equal(patched.changed, true);
assert.match(patched.source, /codex-thinking-status-runtime:v1/);
assert.equal(patchSource(patched.source, runtime).changed, false);
assert.throws(() => patchSource("//# sourceMappingURL=fixture.js.map", runtime), /expected Codex thinking component/);
assert.equal(backupPath("/Applications/ChatGPT.app/Contents/Resources/app.asar", "fixture"), "/Applications/.ChatGPT.app.asar.pre-codex-thinking-status-fixture");
assert.equal(workParent("/Applications/ChatGPT.app/Contents/Resources/app.asar"), "/Applications");
assert.equal(workParent("/tmp/app.asar"), "/tmp");

console.log(`codex-thinking-status patch check passed (${fileURLToPath(new URL(".", import.meta.url))})`);
