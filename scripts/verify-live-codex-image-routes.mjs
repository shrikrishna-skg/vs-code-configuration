// Live check: uses the configured local router and consumes provider capacity.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const image = await readFile(path.join(root, "agent-vision/assets/visual-loop.png"));
const imageUrl = `data:image/png;base64,${image.toString("base64")}`;
const models = process.argv.slice(2).length ? process.argv.slice(2) : [
  "claude-opus-5-5",
  "claude-opus-5-5-fast",
  "claude-fable-5-1",
  "claude-fable-5-1-max",
  "claude-opus-5-5-medium",
  "claude-fable-5-1-medium",
  "astra-engineering-lead",
  "fable-engineering-lead",
  "deepseek-high",
  "glm-high",
];

if (models.some((model) => model.startsWith("gpt-"))) {
  throw new Error("Native OpenAI models require Codex's authenticated client. Verify those with the Codex CLI or desktop app, not a raw loopback request.");
}

function events(text) {
  return text.split(/\r?\n\r?\n/).flatMap((frame) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return [];
    try { return [JSON.parse(data)]; } catch { return []; }
  });
}

for (const model of models) {
  const response = await fetch("http://127.0.0.1:43128/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      max_output_tokens: 128,
      input: [{
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: `<cwd>${root}</cwd> This is a vision-transport check. Inspect the attached PNG, do not modify files or delegate, and include its exact large top heading in your answer.` },
          { type: "input_image", image_url: imageUrl },
        ],
      }],
    }),
  });
  const stream = await response.text();
  assert.equal(response.status, 200, `${model}: ${stream.slice(0, 800)}`);
  const received = events(stream);
  assert.equal(received.some((event) => event.type === "response.failed"), false, `${model}: response.failed`);
  const completed = received.findLast((event) => event.type === "response.completed");
  assert.ok(completed, `${model}: no completed response`);
  const output = JSON.stringify(completed.response?.output || []);
  assert.match(output, /What VS Code becomes/, `${model}: image heading was not returned`);
  console.log(`${model}: image received`);
}

console.log(`Live image-route verification passed for ${models.length} model(s).`);
