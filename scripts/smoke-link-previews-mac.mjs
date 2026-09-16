#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(path.join(tmpdir(), "openglance-preview-smoke-"));
const fixture = path.join(realpathSync(root), "repo");
const userData = path.join(root, "profile");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, childDone, exitCode, target, log = "";

async function until(check, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error("Preview smoke condition timed out");
}
async function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => { socket.close(); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      clearTimeout(timeout); socket.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
      else resolve(message.result);
    });
  });
}
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
async function point(selector) {
  return evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
}
async function hover(selector) { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...await point(selector) }); }
async function click(selector) {
  const position = await point(selector);
  for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...position, button: "left", clickCount: 1 });
}
const previewText = () => evaluate('document.querySelector("#link-preview:not([hidden])")?.textContent || ""');
async function waitText(text) { await until(async () => (await previewText()).includes(text)); }
async function screenshot(name) {
  const capture = await cdp("Page.captureScreenshot", { format: "png" });
  mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
  writeFileSync(path.join(repoRoot, "dist", name), Buffer.from(capture.data, "base64"));
}
async function dismiss() {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.querySelector("#link-preview").hidden'), true);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 15 });
}

try {
  assert.equal(process.platform, "darwin");
  mkdirSync(fixture);
  const git = (args) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
  git(["init", "-b", "main"]); git(["config", "user.name", "Preview smoke"]); git(["config", "user.email", "smoke@example.invalid"]);
  writeFileSync(path.join(fixture, "README.md"), "# Link previews\n\nHover over a link to read without leaving this document.\n\n[Document overview](guide.md) · [Specific section](guide.md#rollout) · [Source lines](guide.md#L7-L9)\n\n[GitHub issue](https://github.com/exampleorg/preview-smoke/issues/42) · [Missing issue](https://github.com/exampleorg/preview-smoke/issues/404)\n\n[Slow issue](https://github.com/exampleorg/preview-smoke/issues/43) · [Milestone](https://github.com/exampleorg/preview-smoke/milestone/7)\n");
  const guide = "---\ntitle: Release guide\ndescription: A short overview of the release workflow, with a checklist for the next rollout.\n---\n# Release guide\n\nRead the checklist before publishing.\n\n## Rollout\n\nRollout details stay scoped to this section.\n\n" + "Verify the build, document the change and check the deployment.\n\n".repeat(10) + "## Next section\n\nUnrelated text.\n";
  writeFileSync(path.join(fixture, "guide.md"), guide);
  git(["add", "."]); git(["commit", "-m", "Fixture"]);
  const bin = path.join(root, "bin"); mkdirSync(bin);
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!${process.execPath}\nconst endpoint=process.argv.at(-1);\nif (!process.argv.includes("api")) { console.log("github.com: logged in for preview smoke"); process.exit(0); }\nif (endpoint.endsWith("/404")) { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }\nif (endpoint.includes("/milestones/")) { console.log(JSON.stringify({title:"Next release",description:"Ship link previews for local documents and GitHub.",state:"open",due_on:"2026-09-30T23:59:59Z",open_issues:2,closed_issues:8})); process.exit(0); }\nconst slow=endpoint.endsWith("/43");\nsetTimeout(()=>console.log(JSON.stringify({title:slow?"Slow response":"Review link preview behavior",body:"Private GitHub issue content returned by the local gh fixture.\\n\\nCheck the hover card in both Preview and Live.",state:"open",user:{login:"preview-tester"},labels:[{name:"enhancement"}]})),slow?1800:80);\n`);
  chmodSync(gh, 0o755);
  const portServer = createServer(); await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
  console.log(`Preview smoke fixture: ${root}`);
  child = spawn("make", ["smoke-dev-mac"], { cwd: repoRoot, env: { ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`, OPENGLANCE_SMOKE_USER_DATA_DIR: userData,
    OPENGLANCE_SMOKE_REPO_ROOT: fixture, OPENGLANCE_SMOKE_FILE: "README.md", OPENGLANCE_SMOKE_REMOTE_DEBUGGING_PORT: String(port),
  }, stdio: ["ignore", "pipe", "pipe"] });
  childDone = new Promise((resolve) => child.on("exit", (code) => { exitCode = code; resolve(code); }));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { log += String(data); process.stdout.write(data); });
  await until(async () => {
    if (exitCode != null) throw new Error(`Smoke launcher exited: ${exitCode}`);
    if (!log.includes(userData)) return false;
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:"));
      return target && await evaluate('!!document.querySelector("#mode-preview") && !document.documentElement.classList.contains("is-workbench-loading")');
    } catch { return false; }
  }, 240000);
  const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  assert.ok(processes.split("\n").some((line) => line.includes(path.join(userData, "Applications", "OpenGlance.app", "Contents", "MacOS", "OpenGlance")) && line.includes(`--openglance-dev-user-data-dir=${userData}`)), "Only the isolated App may be automated");
  await evaluate(`(() => { window.previewRequests=0; const f=window.fetch; window.fetch=(...a)=>{if(String(a[0]).includes('/api/link-preview')) window.previewRequests++; return f(...a);}; })()`);
  for (const mode of ["preview", "live"]) {
    await click(`#mode-${mode}`);
    const link = mode === "preview" ? '#document-content a[href*="guide.md"]' : '[data-link-preview-href="guide.md"]';
    await until(() => evaluate(`!!document.querySelector(${JSON.stringify(link)})`));
    await hover(link); await waitText("A short overview");
    const requests = await evaluate("window.previewRequests");
    // Multiple watch/status cycles must not replace a stationary hover or refetch it.
    for (let second = 0; second < 11; second++) {
      await delay(1000); assert.match(await previewText(), /A short overview/);
    }
    assert.equal(await evaluate("window.previewRequests"), requests);
    await hover("#link-preview .link-preview-title");
    await delay(400); assert.match(await previewText(), /Release guide/);
    await click("#link-preview .link-preview-expand");
    assert.equal(await evaluate('document.querySelector(".link-preview-body").classList.contains("is-expanded")'), true);
    assert.match(await previewText(), /Read the checklist/);
    await screenshot(`link-preview-${mode}.png`);
    await dismiss();
    const section = mode === "preview" ? '#document-content a[href*="%23rollout"], #document-content a[href$="#rollout"]' : '[data-link-preview-href="guide.md#rollout"]';
    await hover(section); await waitText("Rollout details stay scoped");
    assert.doesNotMatch(await previewText(), /Unrelated text/); await dismiss();
    const issue = mode === "preview" ? '#document-content a[href$="issues/42"]' : '[data-link-preview-href$="issues/42"]';
    await hover(issue); await waitText("Private GitHub issue content");
    await screenshot(`link-preview-github-${mode}.png`); await dismiss();
    const milestone = mode === "preview" ? '#document-content a[href$="milestone/7"]' : '[data-link-preview-href$="milestone/7"]';
    await hover(milestone); await waitText("Next release");
    assert.match(await previewText(), /Ship link previews for local documents and GitHub/);
    assert.match(await previewText(), /2026-09-30/);
    assert.match(await previewText(), /8\/10.*80%/);
    assert.equal(await evaluate('document.querySelector("#link-preview .link-preview-open").href'), "https://github.com/exampleorg/preview-smoke/milestone/7");
    await screenshot(`link-preview-milestone-${mode}.png`); await dismiss();
    const missing = mode === "preview" ? '#document-content a[href$="issues/404"]' : '[data-link-preview-href$="issues/404"]';
    await hover(missing); await until(async () => /does not have access|没有访问权限/.test(await previewText())); await dismiss();
    const slow = mode === "preview" ? '#document-content a[href$="issues/43"]' : '[data-link-preview-href$="issues/43"]';
    await hover(slow); await until(() => evaluate('!document.querySelector("#link-preview").hidden'));
    await hover(link); await waitText("A short overview"); await delay(2200);
    assert.doesNotMatch(await previewText(), /Slow response/); await dismiss();
    console.log(`${mode}: stationary hover, card retention, expand, section, gh milestone, denied access, stale responses and Escape passed.`);
  }
  await click("#mode-preview");
  await evaluate('document.querySelector("#document-content a").focus()');
  await waitText("A short overview");
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", modifiers: 1, windowsVirtualKeyCode: 40 });
  assert.equal(await evaluate('document.querySelector("#link-preview").contains(document.activeElement)'), true);
  await dismiss();
  await hover('#document-content a[href*="guide.md"]'); await waitText("A short overview");
  await click("#link-preview .link-preview-open");
  await until(() => evaluate('document.querySelector("#document-content").textContent.includes("Read the checklist")'));
  console.log("Keyboard focus and the card Open action passed.");
} catch (error) {
  if (target && exitCode == null) {
    console.error("Preview failure state:", await evaluate('({text:document.querySelector("#link-preview")?.textContent, mode:document.querySelector("[data-mode][aria-pressed=true]")?.dataset.mode})').catch(() => null));
    await screenshot("link-preview-failure.png").catch(() => {});
  }
  throw error;
} finally {
  if (child && exitCode == null) {
    const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    for (const line of processes.split("\n")) {
      if (!line.includes(`--openglance-dev-user-data-dir=${userData}`)) continue;
      const pid = Number(line.trim().split(/\s+/, 1)[0]); if (pid > 0) process.kill(pid, "SIGTERM");
    }
    await until(() => exitCode != null, 30000);
  }
  if (childDone) assert.equal(await childDone, 0, "Profile verification and cleanup must succeed");
  rmSync(root, { recursive: true, force: true });
}
console.log("Link previews smoke passed; make smoke-dev-mac verified the real Profile.");
