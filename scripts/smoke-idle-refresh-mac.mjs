#!/usr/bin/env node
// The existing smoke controller owns packaging, the Profile snapshot and cleanup.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "openglance-idle-smoke-"));
const repo = path.join(temporaryRoot, "repo");
const userData = path.join(temporaryRoot, "profile");
const output = path.join(sourceRoot, "dist", "idle-refresh");
mkdirSync(repo);
mkdirSync(path.join(repo, "docs"));
mkdirSync(output, { recursive: true });
const filePath = path.join(repo, "README.md");
const source = (title, snippet = "AlphaMagic") => `---\ntitle: ${title}\nai_snippet: ${snippet}\n---\n# Reading\n\nCurrent revision: ${title}\n\n## Details\n\n${"Readable content for scrolling.\n\n".repeat(80)}`;
writeFileSync(filePath, source("Original title"));
writeFileSync(path.join(repo, "docs", "frontmatter-rules.json"), JSON.stringify({ version: 1, basicFields: ["title", "ai_snippet", "domain"] }));
writeFileSync(path.join(repo, ".gitignore"), "build/\n");
const git = args => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git(["init", "-q"]);
git(["add", "."]);
git(["-c", "user.name=Smoke", "-c", "user.email=smoke@example.invalid", "commit", "-qm", "Fixture"]);
let target, child, childDone, exitCode;
let log = "";
const evidence = [];
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw new Error(message);
}
async function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      clearTimeout(timer); socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
      else resolve(message.result);
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error(`CDP connection: ${method}`)); };
  });
}
const evaluate = async expression => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
const processes = () => execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n").filter(line => line.includes(`--openglance-dev-user-data-dir=${userData}`)).map(line => Number(line.trim().split(/\s+/, 1)[0]));
const row = `document.querySelector('[data-tree-path="README.md"]')`;
const rowTitle = () => evaluate(`${row}?.textContent`);
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const search = text => evaluate(`document.querySelector('#tree-filter').value=${JSON.stringify(text)};document.querySelector('#tree-filter').dispatchEvent(new Event('input',{bubbles:true}));`);
async function screenshot(name) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(output, `${name}.png`), Buffer.from(data, "base64"));
}
function minimize(value) {
  const [pid] = processes();
  assert.ok(pid > 0, "Only the isolated Profile process may be controlled");
  execFileSync("osascript", ["-e", `tell application "System Events" to tell (first application process whose unix id is ${pid}) to set value of attribute "AXMinimized" of window 1 to ${value}`]);
}
try {
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  child = spawn("make", ["smoke-dev-mac"], { cwd: sourceRoot, env: { ...process.env,
    OPENGLANCE_SMOKE_USER_DATA_DIR: userData,
    OPENGLANCE_SMOKE_REPO_ROOT: repo,
    OPENGLANCE_SMOKE_FILE: "README.md",
    OPENGLANCE_SMOKE_REMOTE_DEBUGGING_PORT: String(port),
  }, stdio: ["ignore", "pipe", "pipe"] });
  childDone = new Promise(resolve => child.on("exit", code => { exitCode = code; resolve(code); }));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log += String(data); process.stdout.write(data); });
  await until(async () => {
    if (exitCode != null) throw new Error(`Smoke controller exited: ${exitCode}`);
    if (!log.includes(`Agent smoke profile: ${userData}`)) return false;
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.type === "page" && t.url.includes("file=README.md"));
      return Boolean(target);
    } catch { return false; }
  }, "Isolated App did not start", 240000);
  await until(async () => (await rowTitle())?.includes("Original title"), "Initial tree missing");
  await click("#mode-preview");
  await until(() => evaluate(`!document.documentElement.classList.contains('is-workbench-loading') && document.querySelector('#document-content').textContent.includes('Readable content')`), "Preview is not visible");
  await screenshot("preview");
  await evaluate(`window.idleRequests=[];new PerformanceObserver(list=>window.idleRequests.push(...list.getEntries().filter(e=>e.name.includes('/api/')).map(e=>new URL(e.name).pathname))).observe({type:'resource'});`);
  await delay(16000);
  const visibleRequests = await evaluate("window.idleRequests");
  const treeRequests = visibleRequests.filter(p => p === "/api/tree").length;
  assert.ok(treeRequests >= 3 && treeRequests <= 4);
  evidence.push({ scenario: "visible-idle-16s", requests: visibleRequests });
  for (const title of ["Dirty once", "Dirty twice"]) {
    const started = Date.now();
    writeFileSync(filePath, source(title));
    await until(async () => (await rowTitle())?.includes(title), "Repeated dirty edit did not refresh tree");
    evidence.push({ scenario: title, refreshMs: Date.now() - started });
  }
  await search("AlphaMagic");
  await until(async () => (await rowTitle())?.includes("Dirty twice"), "Snippet search did not load");
  writeFileSync(filePath, source("Dirty twice", "BetaMagic"));
  await until(async () => !(await rowTitle()), "Old snippet search remained cached");
  await search("BetaMagic");
  await until(async () => (await rowTitle())?.includes("Dirty twice"), "New snippet search missing");
  evidence.push({ scenario: "metadata-only-search-refresh", passed: true });
  await search("");
  minimize(true);
  await until(async () => await evaluate("document.visibilityState") === "hidden", "Window did not become hidden");
  await delay(1000); // Drain requests begun before minimizing.
  await evaluate("window.idleRequests=[]");
  writeFileSync(filePath, source("Changed while hidden", "BetaMagic"));
  writeFileSync(path.join(repo, "new.md"), "# New while hidden\n");
  await delay(11000);
  const hiddenRequests = await evaluate("window.idleRequests");
  const localPolls = hiddenRequests.filter(p => ["/api/tree", "/api/worktrees", "/api/git-status", "/api/document-status"].includes(p));
  assert.deepEqual(localPolls, []);
  evidence.push({ scenario: "hidden-11s", requests: hiddenRequests });
  const resumed = Date.now();
  minimize(false);
  await until(async () => (await rowTitle())?.includes("Changed while hidden"), "Visible tree did not catch up");
  await until(() => evaluate(`!!document.querySelector('[data-tree-path="new.md"]')`), "New file missing after resume");
  await until(() => evaluate(`document.querySelector('#document-content').textContent.includes('Current revision: Changed while hidden')`), "Current document did not catch up after resume");
  evidence.push({ scenario: "visibility-resume", refreshMs: Date.now() - resumed });
  await click("#mode-live");
  await until(() => evaluate(`!!document.querySelector('.cm-content[contenteditable="true"]')`), "Live editor is not editable");
  await evaluate("document.querySelector('.cm-content').focus()");
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", modifiers: 4 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", modifiers: 4 });
  await cdp("Input.insertText", { text: "\n\nLive writeback marker " });
  await until(() => readFileSync(filePath, "utf8").includes("Live writeback marker"), "Live edit did not reach disk");
  assert.ok(readFileSync(filePath, "utf8").startsWith("---\ntitle: Changed while hidden\n"), "Live body editing must preserve frontmatter");
  await screenshot("live");
  await click("#mode-preview");
  await until(() => evaluate("document.querySelector('#document-content').textContent.includes('Live writeback marker')"), "Preview did not show saved Live edit");
  evidence.push({ scenario: "live-writeback-preview", passed: true });
  writeFileSync(path.join(output, "verification.json"), JSON.stringify(evidence, null, 2));
} finally {
  if (child && exitCode == null) {
    for (const pid of processes()) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await until(() => exitCode != null, "Isolated App did not exit", 30000);
  }
  if (childDone) assert.equal(await childDone, 0, "Profile verification and cleanup must pass");
  writeFileSync(path.join(output, "controller.log"), log);
  rmSync(temporaryRoot, { recursive: true, force: true });
}
console.log(`Idle refresh smoke passed. Evidence: ${output}`);
