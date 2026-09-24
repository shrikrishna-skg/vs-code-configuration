#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, copyFile, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const marker = "/* codex-thinking-status-runtime:v1 */";
const runtimePath = fileURLToPath(new URL("./codex-thinking-status-runtime.js", import.meta.url));

function usage() {
  console.error("Usage: codex-thinking-status.mjs <app.asar> [--check] [--no-sign]");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

function runAsar(args) {
  return run("npx", ["--yes", "@electron/asar", ...args]);
}

function sourcemapOffset(source) {
  const match = /\n\/\/# sourceMappingURL=[^\n]+\s*$/.exec(source);
  if (!match || match.index == null) throw new Error("Refusing to patch: the local-conversation source map marker changed.");
  return match.index;
}

export function patchSource(source, runtime) {
  if (source.includes(marker)) return { changed: false, source };
  if (!source.includes("thinkingShimmer.default") || !source.includes("function dc(")) {
    throw new Error("Refusing to patch: the expected Codex thinking component is not present.");
  }
  if (!runtime.includes(marker)) throw new Error("The status runtime is missing its identity marker.");
  const at = sourcemapOffset(source);
  return { changed: true, source: `${source.slice(0, at)}\n${runtime.trim()}\n${source.slice(at)}` };
}

async function turnAsset(root) {
  const directory = path.join(root, "webview", "assets");
  const files = (await readdir(directory)).filter((file) => /^local-conversation-turn-[\w-]+\.js$/.test(file));
  if (files.length !== 1) throw new Error(`Refusing to patch: expected one local-conversation turn asset, found ${files.length}.`);
  return path.join(directory, files[0]);
}

async function inspect(archive) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "codex-thinking-inspect-"));
  try {
    await runAsar(["extract", archive, temporary]);
    const asset = await turnAsset(temporary);
    return { asset: path.basename(asset), source: await readFile(asset, "utf8") };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function appBundleFor(archive) {
  const resources = path.dirname(archive);
  const contents = path.dirname(resources);
  const app = path.dirname(contents);
  return path.basename(archive) === "app.asar" && path.basename(resources) === "Resources" && path.basename(contents) === "Contents" && app.endsWith(".app") ? app : null;
}

export function backupPath(archive, fingerprint) {
  const app = appBundleFor(archive);
  return app ? path.join(path.dirname(app), `.${path.basename(app)}.asar.pre-codex-thinking-status-${fingerprint}`) : `${archive}.pre-codex-thinking-status-${fingerprint}`;
}

export function workParent(archive) {
  const app = appBundleFor(archive);
  return app ? path.dirname(app) : path.dirname(archive);
}

async function verifySignedApp(archive) {
  const app = appBundleFor(archive);
  if (!app) return;
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
}

async function resign(archive) {
  const app = appBundleFor(archive);
  if (!app) return;
  await run("/usr/bin/codesign", ["--force", "--sign", "-", "--preserve-metadata=identifier,entitlements,flags,runtime", app]);
  await verifySignedApp(archive);
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function apply(archive, { checkOnly, sign }) {
  const runtime = await readFile(runtimePath, "utf8");
  const before = await inspect(archive);
  const preview = patchSource(before.source, runtime);
  if (checkOnly) {
    if (preview.changed) throw new Error("Codex thinking-status patch is not installed.");
    if (appBundleFor(archive)) await verifySignedApp(archive);
    console.log("Codex thinking-status patch is installed and the app signature is valid.");
    return;
  }
  if (!preview.changed) {
    let repairedSignature = false;
    if (sign && appBundleFor(archive)) {
      try {
        await verifySignedApp(archive);
      } catch {
        await resign(archive);
        repairedSignature = true;
      }
    }
    console.log(`Codex thinking-status patch is already installed${repairedSignature ? "; repaired the app signature." : "."}`);
    return;
  }

  const work = await mkdtemp(path.join(workParent(archive), ".codex-thinking-status-"));
  const unpacked = path.join(work, "unpacked");
  const packed = path.join(work, "app.asar");
  const rollback = path.join(work, "original.asar");
  const fingerprint = createHash("sha256").update(before.source).digest("hex").slice(0, 12);
  const backup = backupPath(archive, fingerprint);
  try {
    if (sign) await verifySignedApp(archive);
    await runAsar(["extract", archive, unpacked]);
    const asset = await turnAsset(unpacked);
    const source = await readFile(asset, "utf8");
    const patched = patchSource(source, runtime);
    if (!patched.changed) throw new Error("The archive changed while the patch was being prepared.");
    await writeFile(asset, patched.source);
    await runAsar(["pack", unpacked, packed]);
    await copyFile(archive, rollback);
    if (!await exists(backup)) await copyFile(archive, backup);
    await rename(packed, archive);
    try {
      if (sign) await resign(archive);
    } catch (error) {
      await copyFile(rollback, archive);
      throw new Error(`The archive was restored because signing failed: ${error.message}`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(`Patched ${archive}`);
  console.log(`Backup ${backup}`);
  console.log("Restart Codex to load the new status treatment.");
}

async function main() {
  const args = process.argv.slice(2);
  const archive = args.find((arg) => !arg.startsWith("-"));
  if (!archive || args.some((arg) => ![archive, "--check", "--no-sign"].includes(arg))) {
    usage();
    process.exitCode = 2;
    return;
  }
  try {
    const details = await stat(archive);
    if (!details.isFile()) throw new Error("The target must be an app.asar file.");
    await apply(archive, { checkOnly: args.includes("--check"), sign: !args.includes("--no-sign") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
