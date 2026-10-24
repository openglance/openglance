#!/usr/bin/env node
// The existing smoke controller owns packaging, the Profile snapshot and cleanup.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "openglance-quiet-smoke-"));
const repo = path.join(temporaryRoot, "repo");
const userData = path.join(temporaryRoot, "profile");
const output = path.join(sourceRoot, "dist", "quiet-reading");
mkdirSync(repo);
mkdirSync(path.join(repo, "docs"));
mkdirSync(output, { recursive: true });
const filePath = path.join(repo, "README.md");
const source = (title, snippet = "AlphaMagic") => `---\ntitle: ${title}\nai_snippet: ${snippet}\n---\n# Reading\n\nCurrent revision: ${title}\n\n## Details\n\n${"Readable content for scrolling.\n\n".repeat(80)}`;
writeFileSync(filePath, source("Original title"));
writeFileSync(path.join(repo, "docs", "frontmatter-rules.json"), JSON.stringify({ version: 1, basicFields: ["title", "ai_snippet", "domain"] }));
writeFileSync(path.join(repo, ".gitignore"), "build/\n");
writeFileSync(path.join(repo, "other.md"), "# Other document\n\nNavigation target body\n");
writeFileSync(path.join(repo, "report.mdx"), '<DataTable title="Revenue" dataset="./data.dataset.json" columns="date,revenue" />\n');
writeFileSync(path.join(repo, "data.csv"), 'date,revenue\n2026-01-01,10\n');
writeFileSync(path.join(repo, "data.dataset.json"), JSON.stringify({schemaVersion:1,id:"smoke",title:"Revenue",data:"./data.csv",format:"csv",grain:["date"],primaryKey:["date"],time:{field:"date",type:"date",calendar:"calendar",sourceGranularity:"day"},fields:[{name:"date",type:"date",required:true},{name:"revenue",type:"decimal",required:true,rollup:"sum"}]}));
const git = args => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git(["init", "-q"]);
git(["add", "."]);
git(["-c", "user.name=Smoke", "-c", "user.email=smoke@example.invalid", "commit", "-qm", "Fixture"]);
let target, child, childDone, exitCode;
let log = "";
const evidence = [];
function record(row) { evidence.push(row); console.log(JSON.stringify(row)); }
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

  if (process.env.OPENGLANCE_QUIET_FOCUS_ONLY === "1") {
    await evaluate(`window.idleRequests=[];new PerformanceObserver(list=>window.idleRequests.push(...list.getEntries().filter(e=>e.name.includes('/api/')).map(e=>({path:new URL(e.name).pathname,bytes:e.decodedBodySize})))).observe({type:'resource'});window.originalFocusFetch=window.fetch;window.waitingFocusStatus=false;window.holdFocusStatus=true;window.fetch=async(...args)=>{const url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href);if(url.pathname==='/api/document-status'&&window.holdFocusStatus){window.holdFocusStatus=false;window.waitingFocusStatus=true;await new Promise(resolve=>window.releaseFocusStatus=resolve);}return window.originalFocusFetch(...args);};window.dispatchEvent(new Event('focus'));`);
    await until(()=>evaluate(`window.waitingFocusStatus && window.idleRequests.some(r=>r.path==='/api/tree')`),'Older focus request did not reach its hold');
    writeFileSync(path.join(repo,'later-focus.md'),'# Later focus state\n');
    await evaluate("window.dispatchEvent(new Event('focus'))");await delay(150);
    await evaluate('window.releaseFocusStatus()');
    await until(()=>evaluate(`!!document.querySelector('[data-tree-path="later-focus.md"]')`),'New focus swallowed an older request');
    await evaluate('window.fetch=window.originalFocusFetch');
    record({scenario:'new-focus-rechecks-after-older-request',requests:await evaluate('window.idleRequests')});
    minimize(true);await until(async()=>await evaluate('document.visibilityState')==='hidden','Not hidden');await delay(1000);await evaluate('window.idleRequests=[]');
    writeFileSync(path.join(repo,'native-resume.md'),'# Native resume\n');await delay(10000);minimize(false);
    await until(()=>evaluate(`!!document.querySelector('[data-tree-path="native-resume.md"]')`),'Native resume failed');await delay(300);
    const resumedRequests=await evaluate('window.idleRequests');assert.equal(resumedRequests.filter(r=>r.path==='/api/tree').length,1);
    record({scenario:'native-resume-single-scan',requests:resumedRequests});
    writeFileSync(path.join(output,'focus-verification.json'),JSON.stringify(evidence,null,2));
  } else {
  await evaluate(`window.idleRequests=[];window.modeActivations=[];new PerformanceObserver(list=>window.idleRequests.push(...list.getEntries().filter(e=>e.name.includes('/api/')).map(e=>({path:new URL(e.name).pathname,bytes:e.decodedBodySize})))).observe({type:'resource'});`);
  await delay(65000);
  let requests = await evaluate("window.idleRequests");
  const count = route => requests.filter(r => r.path === route).length;
  assert.ok(count('/api/tree') >= 1 && count('/api/tree') <= 2);
  assert.ok(count('/api/document-status') >= 1 && count('/api/document-status') <= 2);
  assert.ok(requests.filter(r => r.path === '/api/tree').every(r => r.bytes < 1000), 'Unchanged tree must use small version response');
  record({scenario:'preview-65s',requests});

  // A status response succeeds but the required new body fails. Stay in Preview.
  await evaluate(`window.originalQuietFetch=window.fetch;window.failedBody=false;window.fetch=async(...args)=>{const url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href);if(url.pathname==='/api/document'&&(!args[1]?.method||args[1].method==='GET')){window.failedBody=true;return new Response('{}',{status:500});}const response=await window.originalQuietFetch(...args);if(url.pathname==='/api/document-status'){const data=await response.json();data.sourceHash='require-new-body';return new Response(JSON.stringify(data),{status:200});}return response;};`);
  await click('#mode-source');
  await until(()=>evaluate('window.failedBody'), 'Required body request was not exercised');
  await delay(300);
  assert.equal(await evaluate(`document.querySelector('#mode-preview').getAttribute('aria-pressed')`),'true');
  await evaluate('window.fetch=window.originalQuietFetch');
  record({scenario:'body-read-failure-keeps-preview',passed:true});

  async function holdStatus() {
    await evaluate(`window.waitingQuietStatus=false;window.holdQuietStatus=true;window.fetch=async(...args)=>{const url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href);if(url.pathname==='/api/document-status'&&window.holdQuietStatus){window.holdQuietStatus=false;window.waitingQuietStatus=true;await new Promise(resolve=>window.releaseQuietStatus=resolve);}return window.originalQuietFetch(...args);};`);
  }
  await holdStatus();
  await click('#mode-source');
  await until(()=>evaluate('window.waitingQuietStatus'),'Mode preflight did not start');
  assert.equal(await evaluate(`document.querySelector('#mode-preview').getAttribute('aria-pressed')`),'true');
  assert.equal(await evaluate(`document.querySelector('#source-editor-pane').inert`),true);
  const beforeInput=readFileSync(filePath,'utf8');
  await cdp('Input.insertText',{text:'must-not-edit-stale-document'});
  assert.equal(readFileSync(filePath,'utf8'),beforeInput);
  await click('#mode-live');
  await evaluate('window.releaseQuietStatus()');
  await until(()=>evaluate(`document.querySelector('#mode-live').getAttribute('aria-pressed')==='true'`),'Latest mode did not win');
  await evaluate('window.fetch=window.originalQuietFetch');
  await click('#mode-preview');
  await until(()=>evaluate(`document.querySelector('#mode-preview').getAttribute('aria-pressed')==='true'`),'Preview switch did not finish');
  await holdStatus();await click('#mode-source');
  await until(()=>evaluate('window.waitingQuietStatus'),'Second preflight did not start');
  await click('[data-tree-path="other.md"]');
  await until(()=>evaluate(`document.querySelector('#document-content').textContent.includes('Navigation target body')`),'Navigation while preflight pending failed');
  await evaluate('window.releaseQuietStatus()');await delay(500);
  assert.equal(await evaluate(`document.querySelector('#mode-preview').getAttribute('aria-pressed')`),'true');
  await evaluate('window.fetch=window.originalQuietFetch');
  record({scenario:'mode-preflight-input-rapid-switch-navigation',passed:true});
  await click('[data-tree-path="README.md"]');
  await until(()=>evaluate(`document.querySelector('#document-content').textContent.includes('Original title')`),'README missing');

  for (const title of ['Atomic first','Atomic second','Atomic third']) {
    writeFileSync(path.join(repo,'replacement.tmp'),source(title));renameSync(path.join(repo,'replacement.tmp'),filePath);
    await until(()=>evaluate(`document.querySelector('#document-content').textContent.includes(${JSON.stringify(title)})`),'Atomic replacement not observed',5000);
  }
  await click('#workbench-refresh');
  await until(async()=> (await rowTitle())?.includes('Atomic third'),'Manual tree refresh failed');
  record({scenario:'continuous-atomic-sse-and-manual-refresh',passed:true});

  for (const mode of ['source','live']) {
    await search('AlphaMagic');await until(async()=>!!(await rowTitle()),'Active metadata search missing');
    await click(`#mode-${mode}`);
    await until(()=>evaluate(`document.querySelector('#mode-${mode}').getAttribute('aria-pressed')==='true'`),'Editor entry failed');
    await evaluate('window.idleRequests=[]');await delay(11000);
    requests=await evaluate('window.idleRequests');
    assert.ok(count('/api/document-status')>=5,'Editor must retain 2s fallback');
    // Normal body autosaves must not request a forced full-tree rebuild.
    await evaluate("window.idleRequests=[];document.querySelector('.cm-content').focus()");
    for (let i=0;i<3;i++) {
      await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',modifiers:4});
      await cdp('Input.insertText',{text:`\n${mode} save ${i}`});await delay(850);
    }
    await until(()=>readFileSync(filePath,'utf8').includes(`${mode} save 2`),'Autosave missing');
    requests=await evaluate('window.idleRequests');
    assert.equal(count('/api/tree'),0,'Ordinary autosaves must not scan the tree');
    assert.equal(count('/api/frontmatter-facets'),0,'Body autosaves must not rescan metadata');
    record({scenario:`${mode}-2s-check-and-autosave`,requests});
  }
  await search('');
  await click('#mode-source');await until(()=>evaluate(`document.querySelector('#mode-source').getAttribute('aria-pressed')==='true'`),'Source title entry failed');
  await evaluate("document.querySelector('.cm-content').focus();window.idleRequests=[]");
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4});
  await cdp('Input.insertText',{text:source('Local saved title')});
  await until(async()=>(await rowTitle())?.includes('Local saved title'),'Saved title was not reflected promptly');
  requests=await evaluate('window.idleRequests');assert.equal(count('/api/tree'),0,'Title autosave must update the known file without a whole-tree request');
  record({scenario:'local-title-save-without-tree-scan',requests});
  await click('#mode-live');await until(()=>evaluate(`document.querySelector('#mode-live').getAttribute('aria-pressed')==='true'`),'Live switch failed');
  await screenshot('live');
  await click('#mode-preview');
  await until(()=>evaluate(`document.querySelector('#mode-preview').getAttribute('aria-pressed')==='true'`),'Preview not restored');

  git(['add','.']);git(['-c','user.name=Smoke','-c','user.email=smoke@example.invalid','commit','-qm','Saved edits']);
  git(['checkout','--detach','-q','HEAD']);
  await click('#workbench-refresh');
  await until(()=>evaluate(`!document.querySelector('#branch-status').hidden`),'Detached branch state not refreshed');
  await click('#mode-live');await until(()=>evaluate(`document.querySelector('#mode-live').getAttribute('aria-pressed')==='true'`),'Detached editor failed');
  await evaluate("document.querySelector('.cm-content').focus()");await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',modifiers:4});await cdp('Input.insertText',{text:'\nprotected branch write '});
  await until(()=>git(['branch','--show-current']).startsWith('openglance/detached-'),'Detached write did not protect branch');
  record({scenario:'head-baseline-detached-write-protection',passed:true});
  await click('#mode-preview');await until(()=>evaluate(`document.querySelector('#mode-preview').getAttribute('aria-pressed')==='true'`),'Preview missing');

  minimize(true);await until(async()=>await evaluate('document.visibilityState')==='hidden','Not hidden');await delay(1000);await evaluate('window.idleRequests=[]');
  writeFileSync(filePath,source('Hidden change'));writeFileSync(path.join(repo,'new.md'),'# New file\n');await delay(11000);
  requests=await evaluate('window.idleRequests');assert.equal(count('/api/tree')+count('/api/document-status')+count('/api/git-status')+count('/api/worktrees'),0);
  minimize(false);await until(async()=>(await rowTitle())?.includes('Hidden change'),'Resume did not refresh');
  await delay(300);requests=await evaluate('window.idleRequests');assert.equal(count('/api/tree'),1,'Visibility/focus burst duplicated full scan');
  // A focus on an already visible window also refreshes immediately.
  writeFileSync(path.join(repo,'focused.md'),'# Focus added\n');
  await evaluate("window.dispatchEvent(new Event('focus'))");await until(()=>evaluate(`!!document.querySelector('[data-tree-path="focused.md"]')`),'Visible focus did not refresh');
  record({scenario:'hidden-pause-resume-coalescing-and-visible-focus',passed:true});

  await click('[data-tree-path="report.mdx"]');
  await until(()=>evaluate(`!!document.querySelector('[data-mdx-dataset-view]')`),'Dataset document not loaded');
  await until(()=>evaluate(`Array.from(document.querySelectorAll('[data-mdx-dataset-view] td')).some(td=>/^10(?:\\.0+)?$/.test(td.textContent.trim()))`),'Initial dataset value was not displayed');
  await search('AlphaMagic');
  await until(async()=>!!(await rowTitle()),'Initial metadata search missing');
  await evaluate('window.idleRequests=[]');
  writeFileSync(filePath,source('Hidden change','BetaMagic'));
  writeFileSync(path.join(repo,'data.csv'),'date,revenue\n2026-01-01,9876\n');
  const dataStarted=Date.now();
  await until(()=>evaluate(`document.querySelector('#document-content').textContent.includes('9,876') || document.querySelector('#document-content').textContent.includes('9876')`),'MDX data fallback did not refresh',75000);
  requests=await evaluate('window.idleRequests');
  assert.ok(Date.now()-dataStarted > 45000,'Initial async data load must not masquerade as fallback');
  assert.ok(count('/api/document-status')>=1 && count('/api/document')>=1);
  await until(async()=>!(await rowTitle()),'Metadata search did not catch up');
  await search('BetaMagic');await until(async()=>!!(await rowTitle()),'Updated snippet missing');
  record({scenario:'mdx-data-and-metadata-60s-fallback',refreshMs:Date.now()-dataStarted,requests});
  await screenshot('preview');
  writeFileSync(path.join(output,'verification.json'),JSON.stringify(evidence,null,2));
  }

} finally {
  if (child && exitCode == null) {
    for (const pid of processes()) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await until(() => exitCode != null, "Isolated App did not exit", 30000);
  }
  if (childDone) assert.equal(await childDone, 0, "Profile verification and cleanup must pass");
  writeFileSync(path.join(output, "controller.log"), log);
  rmSync(temporaryRoot, { recursive: true, force: true });
}
console.log(`Quiet reading smoke passed. Evidence: ${output}`);
