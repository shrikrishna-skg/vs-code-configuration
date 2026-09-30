#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedAgents = {
  "continuous-qa-engineer": { model: "sonnet", effort: "high", background: "true", canDelegate: true, readOnly: true },
  "opus-delivery-lead": { model: "claude-opus-5-5", effort: "high", background: "true", canDelegate: true },
  "opus-implementer-high": { model: "claude-opus-5-5", effort: "high", background: "false" },
  "opus-implementer-fast": { model: "claude-opus-5-5", effort: "low", background: "false" },
  "opus-test-integrator": { model: "claude-opus-5-5", effort: "high", background: "false" },
  "sonnet-investigator": { model: "sonnet", effort: "high", background: "false", readOnly: true }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, "Missing YAML frontmatter");
  return Object.fromEntries(match[1].split("\n").flatMap((line) => {
    const index = line.indexOf(":");
    return index < 0 ? [] : [[line.slice(0, index).trim(), line.slice(index + 1).trim()]];
  }));
}

const settings = JSON.parse(await readFile(resolve(root, "config/settings.json"), "utf8"));
assert(settings.model === "fable", "Default model must be Fable");
assert(settings.effortLevel === "high", "Default effort must be high");
assert(settings.disableAgentView === false, "Agent view must be enabled");
assert(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "0", "Experimental teams must remain disabled");
assert(settings.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH === "2", "Nesting must be capped at two");
assert(settings.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS === "6", "Concurrency must be capped at six");

const vscodeSettings = JSON.parse(await readFile(resolve(root, "config/vscode-settings.json"), "utf8"));
assert(vscodeSettings["claudeCode.focusView"] === true, "Claude Focus view must be enabled");
assert(vscodeSettings["claudeCode.preferredLocation"] === "panel", "Claude must open in the panel");

const policy = await readFile(resolve(root, "config/CLAUDE.md"), "utf8");
for (const phrase of [
  "Fable Engineering Lead",
  "continuous-qa-engineer",
  "opus-delivery-lead",
  "sonnet-investigator",
  "Delegating: **<subject>**",
  "three-to-five-word subject",
  "do not launch a retry storm",
  "Never claim completion without evidence",
  "Claude Code's native Focus view",
  "`## Answer`, optional `## Verification`, `## My opinion`, and",
  "roughly 80-180 words",
  "at most three concise",
  "Avoid dense walls of text"
]) assert(policy.includes(phrase), `Policy is missing: ${phrase}`);

const agentDir = resolve(root, "config/agents");
const actualFiles = (await readdir(agentDir)).filter((file) => file.endsWith(".md")).sort();
assert(actualFiles.length === Object.keys(expectedAgents).length, "Unexpected Claude agent file count");

for (const [name, expected] of Object.entries(expectedAgents)) {
  const markdown = await readFile(resolve(agentDir, `${name}.md`), "utf8");
  const fields = frontmatter(markdown);
  const tools = new Set((fields.tools || "").split(",").map((tool) => tool.trim()).filter(Boolean));
  assert(fields.name === name, `${name} has the wrong name`);
  assert(fields.model === expected.model, `${name} has the wrong model`);
  assert(fields.effort === expected.effort, `${name} has the wrong effort`);
  assert(fields.background === expected.background, `${name} has the wrong background policy`);
  assert(Number(fields.maxTurns) > 0, `${name} needs a positive maxTurns`);
  assert(expected.canDelegate ? tools.has("Agent") : !tools.has("Agent"), `${name} has the wrong Agent-tool policy`);
  if (expected.readOnly) {
    assert(!tools.has("Edit") && !tools.has("Write") && !tools.has("NotebookEdit"), `${name} must be read-only`);
    assert(fields.disallowedTools?.includes("Edit") && fields.disallowedTools?.includes("Write"), `${name} needs explicit write denials`);
  }
}

const qa = await readFile(resolve(agentDir, "continuous-qa-engineer.md"), "utf8");
const normalizedQa = qa.replace(/\s+/g, " ");
for (const phrase of [
  "one bounded QA cycle per invocation",
  "Missing repair authority means report-only",
  "at most one `opus-test-integrator` at a time",
  "Rerun a failing check at most once",
  "mark its result stale",
  "do not launch a retry storm",
]) assert(normalizedQa.toLowerCase().includes(phrase.toLowerCase()), `Continuous QA policy is missing: ${phrase}`);

console.log("Claude Code configuration snapshot is valid.");
