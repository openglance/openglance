#!/usr/bin/env node
// Run through make smoke-dev-mac so the controller owns the Profile snapshot and cleanup.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { replaceMacAppContents } from '../src/desktop/mac-app-contents.mjs';
import { macUpdateCachePaths, prepareMacUpdateAppPath } from '../src/desktop/mac-update-cache.mjs';
import { pathToFileURL } from 'node:url';

const [requestedAppPath, requestedProfile] = process.argv.slice(2);
const appPath = realpathSync(requestedAppPath);
const profile = realpathSync(requestedProfile);
assert.equal(process.platform, 'darwin');
assert.equal(path.dirname(appPath), path.join(profile, 'Applications'));
assert.equal(JSON.parse(readFileSync(path.join(profile, '.git-leaf-dev-smoke-profile.json'))).profileMode, 'smoke');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'dist', 'mac-app-name');
mkdirSync(output, { recursive: true });
rmSync(path.join(output, process.env.OPENGLANCE_SMOKE_EXPECT_LEGACY_NAME === '1' ? 'reproduction.json' : 'verification.json'), { force: true });
const legacy = path.join(path.dirname(appPath), 'Git Leaf.app');
const plist = path.join(appPath, 'Contents', 'Info.plist');
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const field = (file, key) => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file]);
const originalExecutable = field(plist, 'CFBundleExecutable');
// Give the isolated Community fixture the internal executable's compatibility name.
if (originalExecutable !== 'Git Leaf') {
  renameSync(path.join(appPath, 'Contents', 'MacOS', originalExecutable), path.join(appPath, 'Contents', 'MacOS', 'Git Leaf'));
  run('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleExecutable Git Leaf', plist]);
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]);
}
renameSync(appPath, legacy);
const originalInode = lstatSync(legacy).ino;
const repo = path.join(profile, 'name-smoke-repo');
mkdirSync(repo);
writeFileSync(path.join(repo, 'README.md'), '# OpenGlance upgrade continuity\n\nThe same repository opens after the App is renamed.\n');
run('git', ['-C', repo, 'init', '-q']);
run('git', ['-C', repo, 'add', 'README.md']);
run('git', ['-C', repo, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Fixture']);
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const args = [`--openglance-dev-user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--repo=${repo}`, '--file=README.md'];
const evidence = [];
let target;
const appProcesses = () => run('ps', ['-axo', 'pid=,command=']).split('\n').map(line => line.trim().match(/^(\d+)\s+(.*)$/)).filter(match => match && match[2].startsWith(path.dirname(appPath) + '/')).map(match => ({ pid: Number(match[1]), command: match[2] }));
async function until(check, message, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await delay(100); }
  throw new Error(message);
}
async function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = ({ data }) => {
      const reply = JSON.parse(String(data));
      if (reply.id !== 1) return;
      clearTimeout(timer); ws.close();
      if (reply.error || reply.result?.exceptionDetails) reject(new Error(JSON.stringify(reply)));
      else resolve(reply.result);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
  });
}
const evaluate = async expression => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
async function stop() {
  for (const { pid } of appProcesses()) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await until(() => appProcesses().length === 0, 'Isolated App did not stop');
}
async function launch(bundle, { viaHelper = false } = {}) {
  const executable = path.join(bundle, 'Contents', 'MacOS', 'Git Leaf');
  const child = viaHelper
    ? spawn(executable, ['-e', `const {spawn}=require('node:child_process'); const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE; const child=spawn(process.execPath, ${JSON.stringify(args)}, {env,stdio:'ignore'}); setTimeout(()=>{if(child.exitCode!==null)process.exit(1);},2000);`], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    : spawn(executable, args, { stdio: 'ignore' });
  child.on('error', error => console.error(error));
  await until(async () => {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
      target = targets.find(t => t.type === 'page' && t.url.includes('file=README.md'));
      return target && await evaluate('!!document.querySelector("#mode-preview")');
    } catch { return false; }
  }, 'Migrated App did not open its original document');
  await delay(3000); // Includes the detached migration helper's launch confirmation.
}
try {
  if (process.env.OPENGLANCE_SMOKE_EXPECT_LEGACY_NAME !== '1') {
    mkdirSync(appPath);
    await launch(legacy);
    assert.equal(lstatSync(legacy).ino, originalInode);
    assert.ok(appProcesses().length > 0);
    evidence.push({ scenario: 'occupied-destination', preserved: true });
    await stop();
    rmdirSync(appPath);
    chmodSync(path.dirname(appPath), 0o555);
    try {
      await launch(legacy);
      assert.equal(existsSync(appPath), false);
      assert.equal(lstatSync(legacy).ino, originalInode);
      evidence.push({ scenario: 'non-writable-parent', preserved: true });
      await stop();
    } finally { chmodSync(path.dirname(appPath), 0o755); }
    await launch(legacy, { viaHelper: true });
    assert.equal(existsSync(appPath), false);
    assert.equal(lstatSync(legacy).ino, originalInode);
    evidence.push({ scenario: 'handoff-launch-confirmation', preserved: true });
    await stop();
  }
  await launch(legacy);
  if (process.env.OPENGLANCE_SMOKE_EXPECT_LEGACY_NAME === '1') {
    assert.equal(existsSync(appPath), false);
    assert.equal(existsSync(legacy), true);
    evidence.push({ scenario: 'before-fix', outerName: path.basename(legacy), executable: 'Git Leaf', processes: appProcesses() });
    console.log('Reproduced: the real isolated App opens as OpenGlance but keeps Git Leaf.app.');
  } else {
    assert.equal(existsSync(legacy), false);
    assert.equal(lstatSync(appPath).ino, originalInode);
    assert.equal(field(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleExecutable'), 'Git Leaf');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
    for (const mode of ['preview', 'live']) {
      await evaluate(`document.querySelector('#mode-${mode}').click()`);
      await delay(500);
      assert.ok((await evaluate('document.body.innerText')).includes('OpenGlance upgrade continuity'));
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(output, `${mode}.png`), Buffer.from(data, 'base64'));
    }
    evidence.push({ scenario: 'migrated', outerName: path.basename(appPath), inode: originalInode, executable: 'Git Leaf', processes: appProcesses() });
    assert.ok(appProcesses().length > 0);
    assert.ok(appProcesses().every(({ command }) => command.startsWith(appPath + '/')));
    await stop();
    await launch(appPath);
    assert.equal(existsSync(legacy), false);
    assert.equal(lstatSync(appPath).ino, originalInode);
    evidence.push({ scenario: 'second-launch', outerName: path.basename(appPath), processes: appProcesses() });
    await stop();
    const nextApp = path.join(profile, 'next-package', 'OpenGlance.app');
    run('/usr/bin/ditto', [appPath, nextApp]);
    const nextPlist = path.join(nextApp, 'Contents', 'Info.plist');
    const nextVersion = '999.0.1'; // Local fixture only; never published or offered by an update feed.
    run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${nextVersion}`, nextPlist]);
    run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleVersion ${nextVersion}`, nextPlist]);
    writeFileSync(path.join(nextApp, 'Contents', 'Resources', 'name-migration-generation'), 'next');
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', nextApp]);
    const cache = macUpdateCachePaths({ homeDir: path.join(profile, 'isolated-home') });
    const stagedApp = path.join(cache.updateRoot, 'update.NEXT', 'OpenGlance.app');
    mkdirSync(stagedApp, { recursive: true });
    writeFileSync(cache.stateFile, JSON.stringify({
      targetBundleURL: pathToFileURL(appPath).href,
      updateBundleURL: pathToFileURL(stagedApp).href,
      useUpdateBundleName: true,
    }));
    await prepareMacUpdateAppPath({ homeDir: path.join(profile, 'isolated-home'), targetAppPath: appPath });
    assert.equal(JSON.parse(readFileSync(cache.stateFile)).useUpdateBundleName, false);
    // Exercise the real nonprivileged Contents installer with an ad-hoc signed dev fixture.
    replaceMacAppContents({
      sourceAppPath: nextApp, targetAppPath: appPath, expectedVersion: nextVersion,
      verifyApp: bundle => run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]),
    });
    assert.equal(field(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleShortVersionString'), nextVersion);
    assert.equal(readFileSync(path.join(appPath, 'Contents', 'Resources', 'name-migration-generation'), 'utf8'), 'next');
    await launch(appPath);
    assert.equal(existsSync(legacy), false);
    assert.equal(lstatSync(appPath).ino, originalInode);
    evidence.push({ scenario: 'next-contents-install', version: nextVersion, outerName: path.basename(appPath), processes: appProcesses() });
    console.log('Canonical App relaunched after another Contents installation with the same Profile and document; Preview and Live work.');
  }
  writeFileSync(path.join(output, process.env.OPENGLANCE_SMOKE_EXPECT_LEGACY_NAME === '1' ? 'reproduction.json' : 'verification.json'), JSON.stringify(evidence, null, 2));
} finally { await stop(); }
