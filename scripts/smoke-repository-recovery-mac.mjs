#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(path.join(tmpdir(), "openglance-recovery-smoke-"));
const fixture = path.join(realpathSync(root), "repo");
const secondRepo = path.join(realpathSync(root), "second-repo");
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
async function openRequest(repository, file = "") {
  const request = spawn(isolatedAppProcess().executable, [
    `--openglance-dev-user-data-dir=${userData}`,
    `--repo=${repository}`,
    ...(file ? [`--file=${file}`] : []),
  ], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    request.once("error", reject);
    request.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Open request exited: ${code}`)));
  });
}
async function waitForDocument(text) {
  await until(() => evaluate(`!!document.querySelector("#sidebar-tab-all") && !document.documentElement.classList.contains("is-workbench-loading") && document.querySelector("#document-content")?.textContent.includes(${JSON.stringify(text)})`));
}
async function openRepositoryPanel() {
  // The shell finishes its final paint and configuration save after renderer readiness.
  await delay(1200);
  await click("#repository-panel-toggle");
  await until(() => evaluate('!document.querySelector("#repository-panel").hidden'));
}
async function screenshot(name) {
  const capture = await cdp("Page.captureScreenshot", { format: "png" });
  mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
  writeFileSync(path.join(repoRoot, "dist", name), Buffer.from(capture.data, "base64"));
}

try {
  assert.equal(process.platform, "darwin", "This smoke requires macOS");
  for (const [directory, title] of [[fixture, "Recovery document"], [secondRepo, "Second repository"]]) {
    mkdirSync(directory);
    git(["init", "-b", "main"], directory);
    git(["config", "user.name", "OpenGlance smoke"], directory);
    git(["config", "user.email", "smoke@example.invalid"], directory);
    writeFileSync(path.join(directory, "guide.md"), `# ${title}\n\n[Missing document](missing.md)\n`);
    git(["add", "guide.md"], directory);
    git(["commit", "-m", "Initial"], directory);
  }
  const portServer = createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  console.log(`Recovery smoke fixture: ${root}`);
  child = spawn("make", ["smoke-dev-mac"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENGLANCE_SMOKE_USER_DATA_DIR: userData,
      OPENGLANCE_SMOKE_REPO_ROOT: fixture,
      OPENGLANCE_SMOKE_FILE: "missing.md",
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
      target = targets.find((item) => item.type === "page" && (item.url.startsWith("http://127.0.0.1:") || item.url.startsWith("data:")));
      if (!target) return false;
      return evaluate('!!document.querySelector(".error-message, #sidebar-tab-all")');
    } catch { return false; }
  }, 240000);
  await until(() => evaluate('!document.documentElement.classList.contains("is-workbench-loading") && !!document.querySelector(".error-message")'));
  assert.equal(await evaluate('!!document.querySelector("#sidebar-tab-all")'), true, "A missing document must leave its healthy repository accessible");
  console.log("Missing startup document remains in the workbench:", await evaluate('document.querySelector(".error-message").textContent'));
  await screenshot("repository-recovery-document.png");
  await click('[data-tree-path="guide.md"]');
  await waitForDocument("Recovery document");
  for (const mode of ["preview", "live"]) {
    await click(`#mode-${mode}`);
    await until(() => evaluate(`document.querySelector("#mode-${mode}").getAttribute("aria-pressed") === "true"`));
    await openRequest(fixture, "missing.md");
    await until(() => evaluate('new URL(location.href).searchParams.get("file") === "missing.md" && !!document.querySelector("#document-content .error-message")'));
    await click('[data-tree-path="guide.md"]');
    await waitForDocument("Recovery document");
    await click(`#mode-${mode}`);
    await until(() => evaluate(`document.querySelector("#mode-${mode}").getAttribute("aria-pressed") === "true"`));
    if (mode === "live") {
      await until(() => evaluate('!!document.querySelector(".cm-content[contenteditable=true]")'));
    }
  }
  console.log("Preview and Live both recover by opening another document from the tree.");

  await openRequest(secondRepo, "guide.md");
  await waitForDocument("Second repository");
  await openRequest(path.join(root, "removed-worktree"), "guide.md");
  await until(() => evaluate('location.protocol === "data:" && !!document.querySelector(".saved-repository")'));
  const savedNames = await evaluate('[...document.querySelectorAll("a.saved-repository")].map(a => a.textContent)');
  assert.ok(savedNames.includes("repo"));
  assert.ok(savedNames.includes("second-repo"));
  console.log("After a missing worktree, saved repository entries remain visible.");

  // The previous server can still exist when repository discovery fails. Its
  // own entry on Home must recover too, rather than being treated as a no-op.
  await evaluate('[...document.querySelectorAll("a.saved-repository")].find(a => a.textContent === "second-repo").click()');
  await waitForDocument("Second repository");
  rmSync(fixture, { recursive: true, force: true });
  await openRepositoryPanel();
  await evaluate('[...document.querySelectorAll("[data-repository-panel-id]")].find(a => a.querySelector(".repository-panel-row-name")?.textContent === "repo").click()');
  await until(() => evaluate('location.protocol === "data:" && !!document.querySelector(".saved-repository")'));
  await screenshot("repository-recovery-home.png");
  await evaluate('[...document.querySelectorAll("a.saved-repository")].find(a => a.textContent === "second-repo").click()');
  await waitForDocument("Second repository");
  await openRepositoryPanel();
  await click("#repository-panel-close");
  await click("#mode-live");
  await until(() => evaluate('!!document.querySelector(".cm-content[contenteditable=true]")'));
  await click("#mode-preview");
  console.log("A removed saved repository does not block reopening or editing the remaining repository.");
} catch (error) {
  if (target && exitCode == null) {
    console.error("Recovery failure state:", await evaluate('({url:location.href.slice(0,120), error:document.querySelector(".error-message")?.textContent, panelHidden:document.querySelector("#repository-panel")?.hidden})').catch(() => null));
    await screenshot("repository-recovery-failure.png").catch(() => {});
  }
  throw error;
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
console.log("Repository recovery smoke passed; the real Profile was verified by make smoke-dev-mac.");
