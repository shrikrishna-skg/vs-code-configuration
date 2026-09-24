// Runnable check for the status-card mockup's state machine.
// Run: node examples/mockups/check-thinking-card.mjs
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./thinking-card.html", import.meta.url), "utf8");
const script = html.split("<script>")[1].split("</script>")[0];

// Boots the mockup's inline script against a stub DOM plus a controlled clock,
// so the timing rules can be asserted without a browser.
function boot(search = "") {
  const nodes = new Map();
  for (const id of ["card", "phase", "elapsed", "detail", "btn-running", "btn-failed"]) {
    nodes.set(id, {
      id,
      textContent: "",
      dataset: {},
      attrs: {},
      listeners: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
    });
  }

  const clock = { now: 0 };
  let interval = null;
  globalThis.document = { getElementById: (id) => nodes.get(id) };
  globalThis.location = { search };
  globalThis.performance = { now: () => clock.now };
  globalThis.setInterval = (fn) => (interval = fn);
  globalThis.clearInterval = () => (interval = null);

  new Function(script)();

  return {
    advance(ms) {
      clock.now = ms;
      if (!interval) throw new Error("no tick scheduled");
      interval();
    },
    idle(ms) { clock.now = ms; },
    isTicking: () => interval !== null,
    text: (id) => nodes.get(id).textContent,
    dataset: (id) => nodes.get(id).dataset,
    click: (id) => nodes.get(id).listeners.click(),
  };
}

const assert = (label, actual, expected) => {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
};

const app = boot();
app.advance(1000);
assert("elapsed after 1s", app.text("elapsed"), "0:01");

app.advance(4000);
assert("elapsed after 4s", app.text("elapsed"), "0:04");
assert("phase advances at 2.6s", app.text("phase"), "Planning edits");

app.click("btn-failed");
assert("failed card state", app.dataset("card").state, "failed");
assert("failed phase label", app.text("phase"), "Stream disconnected");
assert("frozen elapsed", app.text("elapsed"), "0:04");
assert("failed state stops ticking", app.isTicking(), false);

app.idle(9000);
assert("timer stays frozen", app.text("elapsed"), "0:04");

app.click("btn-running");
assert("resumes from the failure point", app.text("elapsed"), "0:04");
assert("phase resumes", app.text("phase"), "Planning edits");

app.advance(11000);
assert("counts on after resuming", app.text("elapsed"), "0:06");

app.advance(12000);
assert("keeps counting", app.text("elapsed"), "0:07");
assert("phase advances again", app.text("phase"), "Editing src/app.ts");

const failed = boot("?state=failed");
assert("deep link opens failed", failed.dataset("card").state, "failed");
assert("deep link does not tick", failed.isTicking(), false);
failed.idle(6000);
assert("deep link does not count up", failed.text("elapsed"), "0:00");

const dropped = boot("?state=failed&at=14");
assert("frozen at the failure point", dropped.text("elapsed"), "0:14");
dropped.idle(6000);
assert("stays at the failure point", dropped.text("elapsed"), "0:14");

console.log("thinking-card mockup check passed");
