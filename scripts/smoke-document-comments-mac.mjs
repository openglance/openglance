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
  writeFileSync(path.join(fixture, "unsupported.mdx"), "# MDX document\n\nComments are not enabled for MDX documents.\n");
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
  if (process.argv.includes('--toolbar')) {
    const observed=await evaluate(`(() => { const actions=document.querySelector('#floating-document-actions'); const favorite=document.querySelector('#document-favorite-toggle'); const comments=document.querySelector('#document-comments-toggle'); return {visibleActions:[...actions.querySelectorAll('button')].filter(node=>!node.hidden).map(node=>node.id),favorite:{width:favorite.getBoundingClientRect().width,height:favorite.getBoundingClientRect().height},comments:{width:comments.getBoundingClientRect().width,height:comments.getBoundingClientRect().height,label:comments.getAttribute('aria-label'),tooltip:comments.dataset.uiTooltip}}; })()`);
    console.log('Document toolbar layout:', JSON.stringify(observed));
    await screenshot(process.argv.includes('--expect-wide-comment-actions') ? 'document-comments-toolbar-before.png' : 'document-comments-toolbar-after.png');
    if(process.argv.includes('--expect-wide-comment-actions')) {
      assert.ok(observed.comments.width>observed.favorite.width);
      await click('#comment-selection');
      assert.equal(await evaluate('!!document.querySelector("#document-comments [role=alert]")'),true);
      console.log('REPRODUCED: a wide comment control and an unanchored Add comment action occupy the document toolbar.');
    } else {
      assert.deepEqual(observed.visibleActions,['document-favorite-toggle','copy-share-link','document-comments-toggle','document-actions-more']);
      assert.equal(observed.comments.width,observed.favorite.width); assert.equal(observed.comments.height,observed.favorite.height);
      assert.ok(observed.comments.label); assert.ok(observed.comments.tooltip);
      for(const mode of ['preview','live']) {
        await click(`#mode-${mode}`);
        await click('#document-comments-toggle');
        assert.equal(await evaluate('!document.querySelector("#document-comments").hidden && document.querySelector("#document-comments-toggle").getAttribute("aria-expanded")==="true"'),true);
        assert.equal(await evaluate('document.querySelector("[data-comment-action=create]").disabled'),true,'new discussions need a source selection');
        assert.equal(await evaluate('!!document.querySelector("#document-comments [role=alert]")'),false,'opening comments does not initiate an unanchored creation');
        await click('#document-comments-toggle');
        assert.equal(await evaluate('document.querySelector("#document-comments").hidden && document.querySelector("#document-comments-toggle").getAttribute("aria-expanded")==="false"'),true);
      }
      await click('#mode-preview');
      await click('#document-comments-toggle');
      await click('#document-content [data-source-line="3"]');
      await until(() => evaluate('!document.querySelector("[data-comment-action=create]").disabled'));
      await click('[data-comment-action=create]');
      await until(() => evaluate('!!document.querySelector(".comment-new textarea")'));
      assert.equal(await evaluate('document.querySelector(".comment-new blockquote").textContent'),'Repeated paragraph for review.');
      await screenshot('document-comments-toolbar-open.png');
      await screenshot('document-comments-toolbar-closed.png');
      console.log('PASS: compact comment icon after sharing, accessible tooltip, and sidebar toggling in Preview and Live.');
    }
  } else if (process.argv.includes('--selection-entry')) {
    await evaluate(`(() => {
      window.selectionEntryEvents = [];
      const target = [...document.querySelectorAll('#document-content p')].filter(node => node.textContent.includes('Repeated paragraph')).at(-1);
      window.selectionEntryOriginalNode = target;
      for (const type of ['selectionchange', 'pointerup', 'mouseup', 'click']) document.addEventListener(type, () => {
        window.selectionEntryEvents.push({ type, text: getSelection()?.toString(), connected: window.selectionEntryOriginalNode.isConnected,
          lineSelections: document.querySelectorAll('[data-source-line].is-selected').length, linePopoverHidden: document.querySelector('#selection-popover').hidden });
      });
    })()`);
    const point = await evaluate(`(() => { const node = window.selectionEntryOriginalNode.firstChild; const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 18); const rect = range.getBoundingClientRect(); return {from:rect.left+1,to:rect.right-1,y:rect.top+rect.height/2}; })()`);
    await cdp('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,x:point.from,y:point.y});
    for (let i=1;i<=8;i++) await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',button:'left',buttons:1,x:point.from+(point.to-point.from)*i/8,y:point.y});
    await cdp('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,x:point.to,y:point.y});
    await until(() => evaluate('getSelection()?.toString().length > 5'));
    await delay(500);
    const observed = await evaluate(`({selected:getSelection().toString(),connected:window.selectionEntryOriginalNode.isConnected,
      linePopoverHidden:document.querySelector('#selection-popover').hidden,
      floatingCommentVisible:!!document.querySelector('#comment-text-selection:not([hidden])'),
      commentPanelControlVisible:!document.querySelector('#document-comments-toggle').hidden,events:window.selectionEntryEvents})`);
    console.log('Native selection reproduction:', JSON.stringify(observed));
    await screenshot(process.argv.includes('--expect-missing-selection-entry') ? 'document-comments-selection-before.png' : 'document-comments-selection-after.png');
    if (process.argv.includes('--expect-missing-selection-entry')) {
      assert.equal(observed.linePopoverHidden, true); assert.equal(observed.floatingCommentVisible, false);
      console.log('REPRODUCED: selecting body text does not reveal a contextual comment action.');
    } else {
      assert.equal(observed.floatingCommentVisible, true, 'native text selection must reveal a contextual comment action');
      await click('#comment-text-selection-button');
      await until(() => evaluate('!!document.querySelector("#document-comments .comment-new textarea")'));
      assert.equal(await evaluate('document.querySelector(".comment-new blockquote").textContent'), observed.selected);
      assert.equal(await evaluate('document.querySelector("#comment-text-selection").hidden'), true, 'composer input must not show a body-selection action');
      async function saveSelectionComment(text) {
        await evaluate(`(() => { const text = document.querySelector('.comment-new textarea'); text.value = ${JSON.stringify(text)}; text.dispatchEvent(new Event('input',{bubbles:true})); text.form.requestSubmit(); })()`);
        await until(() => evaluate('!document.querySelector(".comment-new") && !!document.querySelector("[data-comment-action=resolve]:not(:disabled)")'));
      }
      await saveSelectionComment('Preview selection entry.');
      for (const mode of ['live', 'source']) {
        await click('#document-comments-toggle');
        await click(`#mode-${mode}`);
        const point = await evaluate(`(() => { const lines = [...document.querySelectorAll('.cm-content .cm-line')].filter(node => node.textContent === 'Repeated paragraph for review.'); const line = lines.at(-1); line.scrollIntoView({block:'nearest'}); const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let node; while(node=walk.nextNode()) if(node.textContent.startsWith('Repeated paragraph')) { const range = document.createRange(); range.setStart(node,0); range.setEnd(node,18); const rect=range.getBoundingClientRect(); return {from:rect.left+1,to:rect.right-1,y:rect.top+rect.height/2}; } })()`);
        assert.ok(point, `rendered body text is selectable in ${mode}`);
        await cdp('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,x:point.from,y:point.y});
        for (let i=1;i<=8;i++) await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',button:'left',buttons:1,x:point.from+(point.to-point.from)*i/8,y:point.y});
        await cdp('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,x:point.to,y:point.y});
        await until(() => evaluate('!document.querySelector("#comment-text-selection").hidden'));
        if (mode === 'live') {
          const stable = await evaluate(`new Promise(resolve => { let samples=0; const timer=setInterval(() => { if(document.querySelector('#comment-text-selection').hidden) { clearInterval(timer);resolve(false); } else if(++samples===105) {clearInterval(timer);resolve(true);} },100); })`);
          assert.equal(stable,true,'a stationary Live selection keeps its comment action visible for at least ten seconds');
        } else {
          await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
          await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
          await until(() => evaluate('document.querySelector("#comment-text-selection").hidden'));
          for (let i=0;i<5;i++) {
            await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',modifiers:8});
            await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',modifiers:0});
          }
          await until(() => evaluate('!document.querySelector("#comment-text-selection").hidden'));
        }
        await screenshot(`document-comments-selection-${mode}.png`);
        await click('#comment-text-selection-button');
        await until(() => evaluate('!!document.querySelector(".comment-new textarea")'));
        const quote=await evaluate('document.querySelector(".comment-new blockquote").textContent');
        assert.equal(quote, mode === 'live' ? 'Repeated paragraph' : 'graph', `the ${mode} quote uses the selected range`);
        await saveSelectionComment(`${mode} selection entry.`);
      }
      const saved = await evaluate('fetch("/api/document?file=README.md").then(r=>r.json()).then(d=>d.comments.threads)');
      assert.equal(saved.length,3); assert.ok(saved.every(thread=>thread.location.startLine===7));
      assert.equal(git(['rev-parse','HEAD']),originalHead); assert.equal(git(['diff','--cached']),'');
      await click('[data-tree-path="unsupported.mdx"]'); await waitForDocument('MDX document'); await click('#mode-preview');
      await evaluate(`(() => { const node = document.querySelector('#document-content p').firstChild; const range=document.createRange(); range.setStart(node,0);range.setEnd(node,8);getSelection().removeAllRanges();getSelection().addRange(range); })()`);
      await delay(300);
      assert.equal(await evaluate('document.querySelector("#comment-text-selection").hidden && document.querySelector("#document-comments-toggle").hidden && document.querySelector("#add-selection-comment").hidden'),true,'unsupported MDX does not advertise a comment write');
      console.log('PASS: native Preview/Live/Source selection, keyboard selection, stable action, exact saved anchors, composer focus, and MDX capability boundary.');
    }
  } else {
  await evaluate(`(() => {
    window.commentSmokeRequests = [];
    const originalFetch = window.fetch;
    window.fetch = (input, options) => { if (options?.method === 'POST') window.commentSmokeRequests.push(String(input)); return originalFetch(input, options); };
    const p = [...document.querySelectorAll('#document-content p')].filter(p => p.textContent.includes('Repeated paragraph')).at(-1);
    const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 18);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  })()`);
  await click('#comment-text-selection-button');
  async function writeMessage(text) {
    await until(() => evaluate('!!document.querySelector("#document-comments textarea:not(:disabled)")'));
    await evaluate(`(() => { const text = document.querySelector('#document-comments textarea'); text.value = ${JSON.stringify(text)}; text.dispatchEvent(new Event('input', { bubbles: true })); text.form.requestSubmit(); })()`);
  }
  await writeMessage('Please clarify the second occurrence.');
  await until(() => evaluate('document.querySelectorAll("[data-comment-id]").length === 1 && !!document.querySelector(".comment-pin")'));
  const metadata = await evaluate('fetch("/api/document?file=README.md").then(r => r.json()).then(d => d.comments.threads[0])');
  assert.equal(await evaluate('document.querySelector("#document-comments-toggle").getBoundingClientRect().width === document.querySelector("#document-favorite-toggle").getBoundingClientRect().width'),true,'thread counts do not widen the icon control');
  assert.match(await evaluate('document.querySelector("#document-comments-toggle").getAttribute("aria-label")'),/1/);
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
  }
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
