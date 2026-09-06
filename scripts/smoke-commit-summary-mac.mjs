#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(path.join(tmpdir(), "openglance-commit-smoke-"));
const fixture = path.join(root, "repo");
const remote = path.join(root, "remote.git");
const userData = path.join(root, "profile");
const git = (args, cwd = fixture) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let childDone;
let exitCode;
let target;
let log = "";

async function until(check, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(250);
  }
  throw new Error("Smoke condition timed out");
}

async function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => { socket.close(); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
      else resolve(message.result);
    });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error(`CDP failed: ${method}`)); });
  });
}
async function evaluate(expression) {
  return (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function noteValue() {
  return evaluate('document.querySelector("#git-sync-note").value');
}

try {
  assert.equal(process.platform, "darwin", "This smoke requires macOS");
  mkdirSync(fixture);
  mkdirSync(remote);
  git(["init", "--bare", "-b", "main"], remote);
  git(["init", "-b", "main"]);
  git(["config", "user.name", "OpenGlance smoke"]);
  git(["config", "user.email", "smoke@example.invalid"]);
  git(["remote", "add", "origin", remote]);
  const original = "---\ntitle: Commit summary smoke\nchange_log:\n  - changed: 2099-01-01\n    summary: Old history\n---\n# Commit summary smoke\n\nOriginal text.\n";
  writeFileSync(path.join(fixture, "guide.md"), original);
  git(["add", "-A"]);
  git(["commit", "-m", "Initial"]);
  git(["push", "-u", "origin", "main"]);
  writeFileSync(path.join(fixture, "guide.md"), `${original}\nLocal edit.\n`);
  const portServer = createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  console.log(`Commit smoke fixture: ${root}`);
  child = spawn("make", ["smoke-dev-mac"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENGLANCE_SMOKE_USER_DATA_DIR: userData,
      OPENGLANCE_SMOKE_REPO_ROOT: fixture,
      OPENGLANCE_SMOKE_FILE: "guide.md",
      OPENGLANCE_SMOKE_REMOTE_DEBUGGING_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  childDone = new Promise((resolve) => child.on("exit", (code) => { exitCode = code; resolve(code); }));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => {
    log += String(data);
    process.stdout.write(data);
  });
  await until(async () => {
    if (exitCode != null) throw new Error(`Smoke launcher exited: ${exitCode}`);
    if (!log.includes(userData)) return false;
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === "page" && item.url.includes("file=guide.md"));
      return Boolean(target);
    } catch { return false; }
  }, 240000);
  await until(() => evaluate('!!document.querySelector("#sidebar-tab-sync")'));
  await click("#sidebar-tab-sync");
  await until(() => evaluate('!document.querySelector("#git-sync-note-wrap").hidden && !document.querySelector("#git-sync-note").disabled'));
  const note = "补充同步使用说明\n\n明确发布前的检查步骤。";
  await evaluate('document.querySelector("#git-sync-note").focus()');
  await cdp("Input.insertText", { text: note });
  assert.equal(await noteValue(), note);
  await click("#mode-live");
  await until(() => evaluate('document.querySelector("#mode-live").getAttribute("aria-pressed") === "true"'));
  assert.equal(await noteValue(), note);
  await click("#mode-preview");
  await click("#sidebar-tab-all");
  await click("#sidebar-tab-sync");
  await delay(10000);
  assert.equal(await noteValue(), note);
  console.log("Preview, Live, tab switching, and 10-second draft retention passed.");

  git(["config", "user.name", ""]);
  await click("#git-sync-open");
  await until(() => evaluate('!document.querySelector("#git-sync-panel").hidden'));
  assert.equal(await noteValue(), note);
  git(["config", "user.name", "OpenGlance smoke"]);
  await click("#git-sync-close");
  await click("#git-sync-open");
  await until(() => git(["log", "-1", "--format=%B"], remote) === note);
  await until(() => noteValue().then((value) => value === ""));
  assert.equal(git(["rev-parse", "HEAD"]), git(["rev-parse", "main"], remote));
  console.log("Custom title/body reached the local remote; failed publish retained the draft, success cleared it.");

  const current = original.replace("change_log:\n", "change_log:\n  - changed: 2000-01-01\n    summary: Clarify publishing checks\n");
  writeFileSync(path.join(fixture, "guide.md"), current);
  await until(() => evaluate('!document.querySelector("#git-sync-note-wrap").hidden && !document.querySelector("#git-sync-open").disabled'));
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  const screenshotPath = path.join(repoRoot, "dist", "commit-summary-smoke.png");
  mkdirSync(path.dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await click("#git-sync-open");
  await until(() => git(["log", "-1", "--format=%s"], remote) === "Clarify publishing checks");
  assert.equal(git(["log", "-1", "--format=%b"], remote), "- Commit summary smoke: Clarify publishing checks");
  assert.equal(git(["status", "--porcelain"]), "");
  console.log(`Automatic summary used only the newly changed entry. Screenshot: ${screenshotPath}`);
} finally {
  // Match the explicit one-time profile; never stop the human App.
  if (child && exitCode == null) {
    const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    for (const line of processes.split("\n")) {
      if (!line.includes(`--openglance-dev-user-data-dir=${userData}`) && !line.includes(`--git-leaf-dev-user-data-dir=${userData}`)) continue;
      const pid = Number(line.trim().split(/\s+/, 1)[0]);
      if (pid > 0) process.kill(pid, "SIGTERM");
    }
    await until(() => exitCode != null, 30000);
  }
  if (childDone) assert.equal(await childDone, 0, "Profile verification and cleanup must succeed");
  rmSync(root, { recursive: true, force: true });
}
console.log("Commit summary smoke passed; the real Profile was verified by make smoke-dev-mac.");
