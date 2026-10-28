#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const root = mkdtempSync(path.join(tmpdir(), "openglance-comments-smoke-"));
const fixture = path.join(realpathSync(root), "repo");
const userData = path.join(root, "profile");
const git = (args, cwd = fixture) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let childDone;
let exitCode;
let target;
let log = "";
let diagnostics;
const browserErrors = [];

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
  console.log(`Click: ${selector}`);
  await until(() => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); return node && !node.disabled && node.getBoundingClientRect().height > 0; })()`));
  const point = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.scrollIntoView({block:'nearest'}); const rect = node.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
  await cdp('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...point });
  await cdp('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...point });
  if (selector.startsWith('#mode-')) await until(() => evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed') === 'true' && !document.querySelector('#source-editor-pane').inert`));
}

function isolatedAppProcess() {
  const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  const line = processes.split("\n").find((item) => item.includes(`--openglance-dev-user-data-dir=${userData}`) && item.includes("--remote-debugging-port="));
  const match = line?.match(/^\s*(\d+)\s+(.*?\/Contents\/MacOS\/OpenGlance)\s/);
  assert.ok(match, "The smoke App must use the explicit temporary Profile");
  return { pid: Number(match[1]), executable: match[2] };
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
  assert.equal(process.platform, "darwin");
  mkdirSync(fixture);
  git(["init", "-b", "main"]); git(["config", "user.name", "Comment smoke"]); git(["config", "user.email", "smoke@example.invalid"]);
  const original = "# Comment smoke\n\nRepeated paragraph for review.\n\nSecond section.\n\nRepeated paragraph for review.\n";
  writeFileSync(path.join(fixture, "README.md"), original);
  git(["add", "."]); git(["commit", "-m", "Initial"]); const originalHead = git(["rev-parse", "HEAD"]);
  const portServer = createServer(); await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
  child = spawn("make", ["smoke-dev-mac"], {
    cwd: repoRoot, env: { ...process.env, OPENGLANCE_SMOKE_USER_DATA_DIR: userData,
      OPENGLANCE_SMOKE_REPO_ROOT: fixture, OPENGLANCE_SMOKE_FILE: "README.md", OPENGLANCE_SMOKE_REMOTE_DEBUGGING_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  childDone = new Promise((resolve) => child.on("exit", (code) => { exitCode = code; resolve(code); }));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { log += String(data); process.stdout.write(data); });
  await until(async () => {
    if (exitCode != null) throw new Error(`Smoke launcher exited: ${exitCode}`);
    if (!log.includes(userData)) return false;
    try { const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()); target = targets.find((item) => item.type === "page");
      if (target && !diagnostics) {
        diagnostics = new WebSocket(target.webSocketDebuggerUrl);
        diagnostics.addEventListener('open', () => { diagnostics.send(JSON.stringify({id: 901, method:'Runtime.enable'})); diagnostics.send(JSON.stringify({id:902,method:'Log.enable'})); });
        diagnostics.addEventListener('message', ({data}) => { const message = JSON.parse(String(data)); if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') { browserErrors.push(message); console.error('Browser diagnostic:', JSON.stringify(message)); } });
      }
      return target?.url.startsWith("http://127.0.0.1:") && await evaluate('!!document.querySelector("#sidebar-tab-all")'); } catch { return false; }
  }, 240000);
  assert.equal(realpathSync(isolatedAppProcess().executable), realpathSync(path.join(userData, "Applications", "OpenGlance.app", "Contents", "MacOS", "OpenGlance")));
  await waitForDocument("Comment smoke"); await click('#mode-preview');
  await evaluate(`(() => {
    window.commentSmokeRequests = [];
    const originalFetch = window.fetch;
    window.fetch = (input, options) => { if (options?.method === 'POST') window.commentSmokeRequests.push(String(input)); return originalFetch(input, options); };
    const p = [...document.querySelectorAll('#document-content p')].filter(p => p.textContent.includes('Repeated paragraph')).at(-1);
    const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 18);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  })()`);
  await click('#comment-selection');
  async function writeMessage(text) {
    await until(() => evaluate('!!document.querySelector("#document-comments textarea:not(:disabled)")'));
    await evaluate(`(() => { const text = document.querySelector('#document-comments textarea'); text.value = ${JSON.stringify(text)}; text.dispatchEvent(new Event('input', { bubbles: true })); text.form.requestSubmit(); })()`);
  }
  await writeMessage('Please clarify the second occurrence.');
  await until(() => evaluate('document.querySelectorAll("[data-comment-id]").length === 1 && !!document.querySelector(".comment-pin")'));
  const metadata = await evaluate('fetch("/api/document?file=README.md").then(r => r.json()).then(d => d.comments.threads[0])');
  assert.equal(metadata.location.startLine, 7, 'actual selected occurrence');
  await click('[data-comment-action="locate"]');
  await writeMessage('Reply from the sidebar.');
  await until(() => evaluate('document.querySelectorAll(".comment-message").length === 2'));
  await screenshot('document-comments-open.png');
  await click('[data-comment-action="resolve"]');
  await until(() => evaluate('document.querySelectorAll(".comment-pin, .has-open-comment, .cm-comment-anchor").length === 0 && document.querySelector("[data-comment-filter=resolved]").textContent.includes("1")'));
  assert.equal(await evaluate('document.querySelector("#document-content").textContent.includes("Please clarify")'), false);
  await click('[data-comment-filter="resolved"]');
  assert.equal(await evaluate('document.querySelectorAll(".comment-message").length'), 2);
  assert.equal(await evaluate('document.querySelectorAll(".has-document-change, .document-change-content").length'), 0, 'comment-only writes leave Preview and outline clean');
  await screenshot('document-comments-resolved.png');
  await click('[data-comment-action="reopen"]');
  await click('[data-comment-filter="open"]');
  await until(() => evaluate('!!document.querySelector(".comment-pin")'));
  await click('#mode-live');
  await until(() => evaluate('!!document.querySelector(".cm-content[contenteditable=true]")'));
  assert.equal(await evaluate('document.querySelector(".cm-content").textContent.includes("openglance-comment:")'), false, 'Live hides storage records');
  assert.equal(await evaluate('!!document.querySelector(".cm-comment-anchor")'), true, 'Live shows the unresolved range');
  await click('[data-comment-action="resolve"]');
  await until(() => evaluate('document.querySelectorAll(".comment-pin, .has-open-comment, .cm-comment-anchor").length === 0'));
  await until(() => evaluate('document.querySelectorAll(".cm-document-change-line, .cm-document-change-text").length === 0'));
  await screenshot('document-comments-live-resolved.png');
  await click('[data-comment-filter="resolved"]'); await click('[data-comment-action="reopen"]'); await click('[data-comment-filter="open"]');
  await until(() => evaluate('!!document.querySelector(".cm-comment-anchor")'));
  await screenshot('document-comments-live.png');
  // Text history and comment history are independent. Exercise actual CodeMirror Undo after an incoming Agent reply.
  await click('#mode-source');
  await click('.cm-content[contenteditable=true] .cm-line');
  await evaluate('document.querySelector(".cm-content[contenteditable=true]").focus()');
  await cdp('Input.insertText', { text: 'Local edit ' });
  console.log('Source input state:', await evaluate('({focused:document.hasFocus(),selection:getSelection()?.toString(),hasText:document.querySelector(".cm-content").textContent.includes("Local edit "),active:document.activeElement?.className})'));
  await until(() => readFileSync(path.join(fixture, 'README.md'), 'utf8').includes('Local edit '));
  const { inspectDocument, applyCommentOperation } = await import('../src/server/document-writes.mjs');
  const { randomUUID } = await import('node:crypto');
  const targetFile = { repoRoot: fixture, file: 'README.md' }; const disk = await inspectDocument(targetFile);
  await applyCommentOperation({ ...targetFile, expectedHash: disk.sourceHash, operation: { type: 'reply', thread_id: metadata.id,
    message: { id: randomUUID(), author: { name: 'Agent smoke', kind: 'agent' }, created_at: new Date().toISOString(), body: 'Incoming Agent reply survives undo.' } } });
  await until(() => evaluate('document.querySelector("#source-editor").textContent.includes("Incoming Agent reply")'));
  await click('.cm-content[contenteditable=true] .cm-line');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 0 });
  await until(() => !readFileSync(path.join(fixture, 'README.md'), 'utf8').includes('Local edit '));
  assert.ok(readFileSync(path.join(fixture, 'README.md'), 'utf8').includes('Incoming Agent reply survives undo.'));
  assert.equal(git(['rev-parse', 'HEAD']), originalHead); assert.equal(git(['diff', '--cached']), '');
  const posts = await evaluate('window.commentSmokeRequests');
  assert.equal(posts.some(url => /git-sync|share-link|git-merge/.test(url)), false, 'comment lifecycle does not publish');
  await click('#mode-preview');
  await cdp('Page.reload'); await waitForDocument('Comment smoke'); await click('#document-comments-toggle');
  await until(() => evaluate('document.querySelectorAll(".comment-message").length === 3'));
  await screenshot('document-comments-final.png');
  console.log('PASS: Preview and Live lifecycle, second-occurrence selection, resolved body cleanup, persistent file state, Agent reply + Source Undo, no commit/publish.');
} catch (error) {
  if (target && exitCode == null) { console.error('Comment smoke state:', await evaluate('({url:location.href,errors:window.commentSmokeErrors,error:document.querySelector("[role=alert]")?.textContent,focus:document.activeElement?.outerHTML.slice(0,250),sync:document.querySelector("#source-sync-status")?.textContent,inert:document.querySelector("#source-editor-pane").inert,posts:window.commentSmokeRequests,resources:performance.getEntriesByType("resource").filter(r=>r.responseStatus>=400).map(r=>({url:r.name,status:r.responseStatus})), body:document.body.innerText.slice(0,600)})').catch(() => null)); await screenshot('document-comments-failure.png').catch(() => {}); }
  throw error;
} finally {
  diagnostics?.close();
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
console.log("Comment smoke passed; make smoke-dev-mac verified the real Profile.");
