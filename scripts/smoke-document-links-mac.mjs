#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { openGlanceDeepLinkUrl } from "../src/desktop/deep-link.mjs";
import { worktreeIdForPath } from "../src/server/git-worktrees.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const expectBug = process.argv.includes("--expect-bug");
const root = mkdtempSync(path.join(tmpdir(), "openglance-link-smoke-"));
const fixture = path.join(realpathSync(root), "repo");
const linked = path.join(realpathSync(root), "task-worktree");
const repository = "exampleorg/link-smoke";
const file = "docs/published.md";
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
function isolatedAppProcess() {
  const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  const line = processes.split("\n").find((item) => item.includes(`--openglance-dev-user-data-dir=${userData}`) && item.includes("--remote-debugging-port="));
  const match = line?.match(/^\s*(\d+)\s+(.*?\/Contents\/MacOS\/OpenGlance)\s/);
  assert.ok(match, "The smoke App must use the explicit temporary Profile");
  return { pid: Number(match[1]), executable: match[2] };
}
async function openRequest(args) {
  await delay(1200);
  const request = spawn(isolatedAppProcess().executable, [
    `--openglance-dev-user-data-dir=${userData}`,
    ...args,
  ], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    request.once("error", reject);
    request.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Open request exited: ${code}`)));
  });
}
async function waitForDocument(text) {
  await until(() => evaluate(`!!document.querySelector("#sidebar-tab-all") && !document.documentElement.classList.contains("is-workbench-loading") && document.querySelector("#document-content")?.textContent.includes(${JSON.stringify(text)})`));
}
async function screenshot(name) {
  const capture = await cdp("Page.captureScreenshot", { format: "png" });
  mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
  writeFileSync(path.join(repoRoot, "dist", name), Buffer.from(capture.data, "base64"));
}

try {
  assert.equal(process.platform, "darwin", "This smoke requires macOS");
  mkdirSync(fixture);
  git(["init", "-b", "main"]);
  git(["config", "user.name", "OpenGlance smoke"]);
  git(["config", "user.email", "smoke@example.invalid"]);
  writeFileSync(path.join(fixture, "README.md"), "# Original document\n");
  git(["add", "."]);
  git(["commit", "-m", "Initial"]);
  git(["remote", "add", "origin", `https://github.com/${repository}.git`]);
  git(["worktree", "add", "-b", "task", linked]);
  writeFileSync(path.join(linked, "README.md"), "# Task worktree\n");
  // Keep unrelated uncommitted task work, as in the reported scenario.
  mkdirSync(path.join(fixture, "docs"));
  writeFileSync(path.join(fixture, file), "# Published document\n\nAvailable in the primary checkout.\n");
  writeFileSync(path.join(fixture, "README.md"), "# Primary document\n");
  git(["add", "."]);
  git(["commit", "-m", "Publish document"]);
  const taskStatus = git(["status", "--porcelain"], linked);
  const portServer = createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  console.log(`Link smoke fixture: ${root}`);
  child = spawn("make", ["smoke-dev-mac"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENGLANCE_SMOKE_USER_DATA_DIR: userData,
      OPENGLANCE_SMOKE_REPO_ROOT: linked,
      OPENGLANCE_SMOKE_FILE: "README.md",
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
      target = targets.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:"));
      return target && await evaluate('!!document.querySelector("#sidebar-tab-all")');
    } catch { return false; }
  }, 240000);
  assert.equal(realpathSync(isolatedAppProcess().executable), realpathSync(path.join(userData, "Applications", "OpenGlance.app", "Contents", "MacOS", "OpenGlance")));
  console.log("Verified smoke App executable is inside its disposable Profile.");
  await waitForDocument("Task worktree");
  const ordinaryLink = openGlanceDeepLinkUrl({ repository, file });
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await openRequest([`--repo=${linked}`, "--file=README.md"]);
    await waitForDocument("Task worktree");
    await openRequest([ordinaryLink.replace("openglance:", "git-leaf:")]);
    if (expectBug) {
      await until(() => evaluate('!!document.querySelector(".error-message")'));
      const failure = await evaluate('document.querySelector(".error-message").textContent');
      assert.match(failure, /ENOENT|not found|不存在|找不到/i);
      console.log(`Reproduced ordinary-link failure, cycle ${cycle}: ${failure}`);
      await screenshot(`ordinary-link-before-${cycle}.png`);
    } else {
      await waitForDocument("Published document");
      assert.equal(await evaluate('fetch("/api/worktrees").then(r => r.json()).then(r => r.currentWorktreeId)'), worktreeIdForPath(fixture));
      console.log(`Ordinary link opened primary checkout, cycle ${cycle}.`);
    }
  }
  if (!expectBug) {
    for (const mode of ["preview", "live"]) {
      await click(`#mode-${mode}`);
      await until(() => evaluate(`document.querySelector("#mode-${mode}").getAttribute("aria-pressed") === "true"`));
      if (mode === "live") await until(() => evaluate('!!document.querySelector(".cm-content[contenteditable=true]")'));
      await screenshot(`ordinary-link-${mode}.png`);
    }
    const exactLink = openGlanceDeepLinkUrl({ repository, file: "README.md", worktree: worktreeIdForPath(linked) });
    await openRequest([exactLink]);
    await waitForDocument("Task worktree");
    assert.equal(await evaluate('fetch("/api/worktrees").then(r => r.json()).then(r => r.currentWorktreeId)'), worktreeIdForPath(linked));
    console.log("Explicit worktree link opened the requested task checkout.");
    // A document present only in main must still fail for an exact task link.
    await openRequest([openGlanceDeepLinkUrl({ repository, file, worktree: worktreeIdForPath(linked) })]);
    await until(() => evaluate('!!document.querySelector("#document-content .error-message")'));
    assert.equal(await evaluate('fetch("/api/worktrees").then(r => r.json()).then(r => r.currentWorktreeId)'), worktreeIdForPath(linked));
    await click('[data-tree-path="README.md"]');
    await waitForDocument("Task worktree");
    await openRequest([openGlanceDeepLinkUrl({ repository, file: "docs/missing.md" })]);
    await until(() => evaluate('!!document.querySelector("#document-content .error-message")'));
    assert.equal(await evaluate('fetch("/api/worktrees").then(r => r.json()).then(r => r.currentWorktreeId)'), worktreeIdForPath(fixture));
    const error = await evaluate('document.querySelector(".error-message").textContent');
    assert.doesNotMatch(error, /cannot find the local Git|找不到本机 Git/);
    await click('[data-tree-path="README.md"]');
    await waitForDocument("Primary document");
    console.log("Missing documents retain the requested checkout and a working file tree.");
    assert.equal(git(["status", "--porcelain"], linked), taskStatus);
    git(["worktree", "remove", "--force", linked]); // Only this smoke's own fixture.
    await openRequest([ordinaryLink]);
    await waitForDocument("Published document");
    console.log("Ordinary link still opens primary after the temporary worktree is removed.");
  }
} catch (error) {
  if (target && exitCode == null) {
    console.error("Link failure state:", await evaluate('({url:location.href.slice(0,120), error:document.querySelector(".error-message")?.textContent})').catch(() => null));
    await screenshot("ordinary-link-failure.png").catch(() => {});
  }
  throw error;
} finally {
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
console.log(`${expectBug ? "Link reproduction" : "Link smoke"} passed; make smoke-dev-mac verified the real Profile.`);
