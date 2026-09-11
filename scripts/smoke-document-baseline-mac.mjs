#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupDocumentChangesSmokeFixture,
  createDocumentChangesSmokeFixture,
} from "./document-changes-smoke-fixture.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(path.join(tmpdir(), "openglance-baseline-smoke-"));
const fixture = createDocumentChangesSmokeFixture();
const userData = path.join(root, "profile");
const output = path.join(repoRoot, "dist", "baseline-refresh");
const filePath = path.join(fixture.repoRoot, fixture.file);
const git = (args) => execFileSync("git", args, { cwd: fixture.repoRoot, encoding: "utf8" }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let target;
let child;
let childDone;
let exitCode;
let log = "";
const evidence = [];

async function until(check, message, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

async function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
      else resolve(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP failed: ${method}`));
    });
  });
}

async function evaluate(expression) {
  return (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
}

async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

async function uiState() {
  return evaluate(`({
    mode: document.querySelector('[id^="mode-"][aria-pressed="true"]')?.id,
    outline: document.querySelectorAll('.has-document-change').length,
    preview: document.querySelectorAll('.document-change-content').length,
    editor: document.querySelectorAll('.cm-document-change-line,.cm-document-change-text').length,
    deletionsHidden: document.querySelector('#document-deletions-toggle').hidden
  })`);
}

async function status() {
  const url = new URL(target.url);
  url.pathname = "/api/document-status";
  return fetch(url).then((response) => response.json());
}

async function screenshot(name) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(output, `${name}.png`), Buffer.from(data, "base64"));
}

function commit() {
  git(["add", "-A"]);
  git(["-c", "user.name=OpenGlance Smoke", "-c", "user.email=smoke@example.invalid", "commit", "-qm", "Commit open document"]);
  assert.equal(git(["status", "--porcelain"]), "");
}

async function expectClean() {
  await until(async () => {
    const state = await uiState();
    return state.outline === 0 && state.preview === 0 && state.editor === 0 && state.deletionsHidden;
  }, "Committed document still shows edit cues", 8000);
}

try {
  assert.equal(process.platform, "darwin", "This smoke requires macOS");
  mkdirSync(output, { recursive: true });
  const portServer = createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  child = spawn("make", ["smoke-dev-mac"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENGLANCE_SMOKE_USER_DATA_DIR: userData,
      OPENGLANCE_SMOKE_REPO_ROOT: fixture.repoRoot,
      OPENGLANCE_SMOKE_FILE: fixture.file,
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
    if (!log.includes(`Agent smoke profile: ${userData}`)) return false;
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === "page" && item.url.includes(`file=${fixture.file}`));
      return Boolean(target);
    } catch { return false; }
  }, "Isolated smoke did not open its document", 240000);
  await until(() => evaluate('!!document.querySelector("#mode-preview")'), "Workbench did not start");

  for (const mode of ["preview", "source", "live"]) {
    await click(`#mode-${mode}`);
    if (mode !== "preview") {
      await evaluate('document.querySelector(".cm-content").focus()');
      const marker = ` ${mode} baseline smoke `;
      await cdp("Input.insertText", { text: marker });
      await until(() => readFileSync(filePath, "utf8").includes(marker), "Editor change did not reach disk");
    }
    await until(async () => (await uiState()).outline > 0, "Local edits did not show change cues");
    const before = await status();
    await screenshot(`${mode}-before-commit`);
    await evaluate(`window.baselineSmokeSurface = {
      node: document.querySelector('#document-content').firstElementChild,
      editor: document.querySelector('.cm-content'),
      active: document.activeElement,
      selection: document.getSelection()?.toString(),
      scroll: document.querySelector('.cm-scroller')?.scrollTop ?? 0
    }; undefined`);
    const started = Date.now();
    commit();
    await expectClean();
    const refreshMs = Date.now() - started;
    const after = await status();
    assert.equal(after.sourceHash, before.sourceHash);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.notEqual(after.changeBaselineRevision, before.changeBaselineRevision);
    assert.equal(await evaluate(`window.baselineSmokeSurface.node === document.querySelector('#document-content').firstElementChild`), true);
    if (mode !== "preview") {
      assert.equal(await evaluate(`window.baselineSmokeSurface.editor === document.querySelector('.cm-content') &&
        window.baselineSmokeSurface.active === document.activeElement &&
        window.baselineSmokeSurface.selection === document.getSelection()?.toString() &&
        Math.abs(window.baselineSmokeSurface.scroll - document.querySelector('.cm-scroller').scrollTop) < 2`), true);
    }
    for (let index = 0; index < 10; index += 1) {
      const state = await uiState();
      assert.equal(state.outline + state.preview + state.editor, 0, "Clean cues must remain stable across polling cycles");
      await delay(1000);
    }
    await screenshot(`${mode}-after-commit`);
    evidence.push({ mode, refreshMs, before, after, ui: await uiState() });
    console.log(`${mode}: commit cleared all edit cues in ${refreshMs} ms and stayed clean for 10 seconds.`);
  }

  // Pause a baseline response while real editor input arrives, then resume that same response.
  await evaluate(`window.originalBaselineFetch = window.fetch;
    window.holdBaselineRead = false;
    window.fetch = async (...args) => {
      const response = await window.originalBaselineFetch(...args);
      const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
      if (window.holdBaselineRead && url.pathname === '/api/document' && (!args[1]?.method || args[1].method === 'GET')) {
        window.holdBaselineRead = false;
        await new Promise(resolve => { window.releaseBaselineRead = resolve; });
      }
      return response;
    };
    window.holdBaselineRead = true;`);
  git(["reset", "--soft", "HEAD^"]);
  await until(() => evaluate('typeof window.releaseBaselineRead === "function"'), "Baseline refresh was not requested after soft reset");
  await evaluate('document.querySelector(".cm-content").focus()');
  const pendingMarker = " pending baseline input ";
  await cdp("Input.insertText", { text: pendingMarker });
  await evaluate('window.releaseBaselineRead()');
  await until(() => readFileSync(filePath, "utf8").includes(pendingMarker), "Baseline response discarded editor input");
  await until(async () => (await uiState()).outline > 0, "Soft reset should restore edit cues");
  commit();
  await expectClean();
  console.log("Soft reset refreshed the baseline; input arriving during the refresh reached disk and survived the next commit.");
  writeFileSync(path.join(output, "verification.json"), JSON.stringify(evidence, null, 2));
} finally {
  // Stop only the App launched with this one-time Profile; the smoke controller owns its cleanup.
  if (child && exitCode == null) {
    const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    for (const line of processes.split("\n")) {
      if (!line.includes(`--openglance-dev-user-data-dir=${userData}`) && !line.includes(`--git-leaf-dev-user-data-dir=${userData}`)) continue;
      const pid = Number(line.trim().split(/\s+/, 1)[0]);
      if (pid > 0) process.kill(pid, "SIGTERM");
    }
    await until(() => exitCode != null, "Isolated App did not exit", 30000);
  }
  if (childDone) assert.equal(await childDone, 0, "Real Profile verification and smoke cleanup must pass");
  cleanupDocumentChangesSmokeFixture(fixture);
  rmSync(root, { recursive: true, force: true });
}
console.log(`Document baseline smoke passed. Evidence: ${output}`);
