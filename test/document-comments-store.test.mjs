import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { history, undo, redo, isolateHistory } from "@codemirror/commands";
import { createGitSyncGuard, runGitCommand, syncStateDriftKind } from "../src/server/git-sync.mjs";
import { createImmutableGitSnapshot, runGitSnapshotCommand } from "../src/server/git-immutable-snapshot.mjs";
import { applyPreparedRemoteChanges, createRemoteMergePreparationStore, prepareRemoteChanges } from "../src/server/git-remote-sync.mjs";
import { captureAnchor, hashText, mutateComments, parseComments } from "../scripts/document-comments/format.mjs";
import { applyCommentOperation, inspectDocument, transactDocument, withWorktreeMutation } from "../scripts/document-comments/store.mjs";
import { synchronizeCommentChanges } from "../scripts/document-comments/history.mjs";

const cliPath = fileURLToPath(new URL("../scripts/document-comments-prototype.mjs", import.meta.url));
const initial = "# Plan\r\n\r\nLaunch soon.\r\n";
function message(body = "Name a date.", kind = "human") {
  return { id: randomUUID(), author: { name: kind, kind }, created_at: "2026-10-28T04:00:00Z", body };
}
function thread() {
  const body = initial.replaceAll("\r\n", "\n");
  const from = body.indexOf("soon");
  return { id: randomUUID(), status: "open", anchor: captureAnchor(body, from, from + 4), messages: [message()] };
}
async function fixture(t, { commit = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "openglance-comment-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await runGitCommand(root, ["init", "-b", "main"]);
  await runGitCommand(root, ["config", "user.name", "Comments Prototype"]);
  await runGitCommand(root, ["config", "user.email", "comments@example.invalid"]);
  await writeFile(path.join(root, "plan.md"), initial);
  if (commit) {
    await runGitCommand(root, ["add", "plan.md"]);
    await runGitCommand(root, ["commit", "-m", "Fixture"]);
  }
  return { root, target: { repoRoot: root, file: "plan.md" } };
}
function cli(args, operation) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, result: JSON.parse(code === 0 ? stdout : stderr) }));
    child.stdin.end(operation === undefined ? undefined : JSON.stringify(operation));
  });
}

async function remoteFixture(t) {
  const result = await fixture(t);
  const bare = await mkdtemp(path.join(tmpdir(), "openglance-comment-remote-"));
  const coworker = await mkdtemp(path.join(tmpdir(), "openglance-comment-peer-"));
  t.after(() => rm(bare, { recursive: true, force: true }));
  t.after(() => rm(coworker, { recursive: true, force: true }));
  await runGitCommand(bare, ["init", "--bare", "--initial-branch=main"]);
  await writeFile(path.join(result.root, "remote.md"), "Remote before.\n");
  await runGitCommand(result.root, ["add", "remote.md"]);
  await runGitCommand(result.root, ["commit", "-m", "Remote fixture"]);
  await runGitCommand(result.root, ["remote", "add", "origin", bare]);
  await runGitCommand(result.root, ["push", "-u", "origin", "main"]);
  await runGitCommand(coworker, ["clone", bare, "."]);
  await runGitCommand(coworker, ["config", "user.name", "Peer"]);
  await runGitCommand(coworker, ["config", "user.email", "peer@example.invalid"]);
  await writeFile(path.join(coworker, "remote.md"), "Remote after.\n");
  await runGitCommand(coworker, ["add", "remote.md"]);
  await runGitCommand(coworker, ["commit", "-m", "Remote update"]);
  await runGitCommand(coworker, ["push", "origin", "main"]);
  const preparationStore = createRemoteMergePreparationStore();
  t.after(() => preparationStore.dispose());
  return { ...result, repo: { id: "comments-test", root: result.root, branch: "main" }, preparationStore };
}

test("fresh full-source preconditions preserve agent replies and reject stale editor saves", async (t) => {
  const { root, target } = await fixture(t);
  const inspected = await inspectDocument(target);
  const data = thread();
  const written = await applyCommentOperation({ ...target, expectedHash: inspected.sourceHash, operation: { type: "create", thread: data } });
  await assert.rejects(transactDocument({ ...target, expectedHash: inspected.sourceHash, mutate: () => initial }), { code: "stale_source" });
  assert.equal((await inspectDocument(target)).source, written.source);
  assert.equal((await runGitCommand(root, ["diff", "--cached", "--name-only"])).stdout, "");
  assert.equal((await runGitCommand(root, ["rev-list", "--count", "HEAD"])).stdout.trim(), "1");
});

test("independent agent CLI processes retry replies without losing messages, then write a versioned revision", async (t) => {
  const { root, target } = await fixture(t);
  const data = thread();
  data.location = { custom: "Keep unknown persisted data separate from derived locations." };
  const start = await inspectDocument(target);
  const created = await applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: data } });
  const operations = ["First reply", "Second reply"].map((body) => ({ type: "reply", thread_id: data.id, message: message(body, "agent") }));
  const args = ["apply", "--repo", root, "--file", "plan.md", "--expected-hash", created.sourceHash];
  const results = await Promise.all(operations.map((operation) => cli(args, operation)));
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 1]);
  const failed = results.findIndex((result) => result.code !== 0);
  assert.equal(results[failed].result.error, "stale_source");
  const current = await cli(["inspect", "--repo", root, "--file", "plan.md"]);
  const retry = await cli(["apply", "--repo", root, "--file", "plan.md", "--expected-hash", current.result.source_hash], operations[failed]);
  assert.equal(retry.code, 0);
  assert.equal(retry.result.threads[0].messages.length, 3);
  assert.deepEqual(retry.result.threads[0].location, data.location);
  assert.deepEqual(new Set(retry.result.threads[0].messages.slice(1).map((item) => item.body)), new Set(["First reply", "Second reply"]));
  const from = retry.result.body.indexOf("soon");
  const revised = await cli(["apply", "--repo", root, "--file", "plan.md", "--expected-hash", retry.result.source_hash],
    { type: "revise", thread_id: data.id, from, to: from + 4, expected_text: "soon", insert: "on November 1", message: message("Named the date.", "agent") });
  assert.equal(revised.code, 0);
  assert.equal(revised.result.threads[0].anchor.exact, "soon");
  assert.equal(revised.result.threads[0].status, "open");
  assert.equal(revised.result.locations[0].revisions.at(-1).state, "located");
  assert((await readFile(path.join(root, "plan.md"), "utf8")).includes("Launch on November 1."));
});

test("external drift during a transaction is detected before replacement and retains the external file", async (t) => {
  const { root, target } = await fixture(t);
  const inspected = await inspectDocument(target);
  const outside = initial + "\r\nExternal update.\r\n";
  await assert.rejects(transactDocument({ ...target, expectedHash: inspected.sourceHash, mutate: async (source) => {
    await writeFile(path.join(root, "plan.md"), outside);
    return mutateComments(source, { type: "create", thread: thread() });
  } }), { code: "stale_source" });
  assert.equal(await readFile(path.join(root, "plan.md"), "utf8"), outside);
  assert.deepEqual((await readdir(root)).sort(), [".git", "plan.md"]);
});

test("failed atomic replacement leaves the original bytes intact, removes temporary files, and releases the guard", async (t) => {
  const { root, target } = await fixture(t);
  const data = thread();
  const start = await inspectDocument(target);
  await assert.rejects(applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: data },
    replaceFile: async () => { throw new Error("Injected replacement failure"); } }), /Injected replacement failure/);
  assert.equal(await readFile(path.join(root, "plan.md"), "utf8"), initial);
  assert.deepEqual((await readdir(root)).sort(), [".git", "plan.md"]);
  const retry = await applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: data } });
  assert.equal(retry.records[0].data.id, data.id);
});

test("a held worktree mutation defers file writers and releases them after a failed critical section", async (t) => {
  const { target, root } = await fixture(t);
  const inspected = await inspectDocument(target);
  const operation = { type: "create", thread: thread() };
  await assert.rejects(withWorktreeMutation(root, async () => {
    await assert.rejects(applyCommentOperation({ ...target, expectedHash: inspected.sourceHash, operation, timeoutMs: 0 }), { code: "worktree_busy" });
    throw new Error("Critical section failed");
  }), /Critical section failed/);
  assert.equal((await inspectDocument(target)).source, initial);
  const after = await applyCommentOperation({ ...target, expectedHash: inspected.sourceHash, operation });
  assert.equal(after.records.length, 1);
});

test("a comment changes the real Git preparation fingerprint and stays outside an earlier frozen snapshot", async (t) => {
  const { target, root } = await fixture(t);
  const guard = createGitSyncGuard({ repo: { root } });
  const baseline = await guard.capture();
  const snapshot = await withWorktreeMutation(root, () => createImmutableGitSnapshot({ repoRoot: root, indexPath: path.join(root, ".git", "comments-test.index") }));
  const inspected = await inspectDocument(target);
  await applyCommentOperation({ ...target, expectedHash: inspected.sourceHash, operation: { type: "create", thread: thread() } });
  assert.equal(syncStateDriftKind(baseline, await guard.capture()), "content_changed");
  assert.equal(parseComments((await runGitCommand(root, ["show", `${snapshot.snapshotCommit}:plan.md`])).stdout).records.length, 0);
  assert.equal((await inspectDocument(target)).records.length, 1);
  assert.equal((await runGitCommand(root, ["diff", "--cached", "--name-only"])).stdout, "");
});

test("a comment accepted after real remote-merge preparation invalidates apply without losing the comment", async (t) => {
  const { root, target, repo, preparationStore } = await remoteFixture(t);
  const prepared = await prepareRemoteChanges({ repo, preparationStore, allowLocalChanges: true });
  assert.equal(prepared.ok, true, prepared.error);
  const start = await inspectDocument(target);
  const written = await applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: thread() } });
  const head = (await runGitCommand(root, ["rev-parse", "HEAD"])).stdout;
  const result = await applyPreparedRemoteChanges({ repo, preparationStore, preparationToken: prepared.preparationToken });
  assert.equal(result.code, "workspace_changed");
  assert.equal((await inspectDocument(target)).source, written.source);
  assert.equal((await runGitCommand(root, ["rev-parse", "HEAD"])).stdout, head);
});

for (const failAfterPatch of [false, true]) {
  test(`cooperative comments defer during real Git ${failAfterPatch ? "apply and rollback" : "apply"} and can retry afterward`, async (t) => {
    const { root, target, repo, preparationStore } = await remoteFixture(t);
    const data = thread();
    const start = await inspectDocument(target);
    const written = await applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: data } });
    const prepared = await prepareRemoteChanges({ repo, preparationStore, allowLocalChanges: true });
    assert.equal(prepared.ok, true, prepared.error);
    let blocked = 0;
    const reply = { type: "reply", thread_id: data.id, message: message("Retained draft.", "agent") };
    const result = await withWorktreeMutation(root, () => applyPreparedRemoteChanges({
      repo, preparationStore, preparationToken: prepared.preparationToken,
      snapshotCommandRunner: async (cwd, args, options) => {
        if (args[0] === "apply" && !args.includes("--check")) {
          await assert.rejects(applyCommentOperation({ ...target, expectedHash: written.sourceHash, operation: reply, timeoutMs: 0 }), { code: "worktree_busy" });
          blocked += 1;
        }
        return runGitSnapshotCommand(cwd, args, options);
      },
      gitRunner: async (cwd, args) => {
        if (failAfterPatch && args.includes("OpenGlance merged remote changes")) throw new Error("Injected branch-update failure after patch");
        return runGitCommand(cwd, args);
      },
    }));
    assert.equal(result.ok, !failAfterPatch, result.error);
    assert.equal(blocked, failAfterPatch ? 2 : 1);
    assert.equal((await readFile(path.join(root, "remote.md"), "utf8")).trim(), failAfterPatch ? "Remote before." : "Remote after.");
    const current = await inspectDocument(target);
    assert.equal(current.records[0].data.messages.length, 1);
    const retried = await applyCommentOperation({ ...target, expectedHash: current.sourceHash, operation: reply });
    assert.equal(retried.records[0].data.messages[1].body, "Retained draft.");
  });
}

test("undo and redo can save through the file transaction while retaining a received comment", async (t) => {
  const { root, target } = await fixture(t);
  const base = initial.replaceAll("\r\n", "\n");
  await writeFile(path.join(root, "plan.md"), base);
  let disk = await inspectDocument(target);
  let state = EditorState.create({ doc: base, extensions: [history()] });
  const from = base.indexOf("soon");
  state = state.update({ changes: { from, to: from + 4, insert: "on November 1" }, annotations: isolateHistory.of("full") }).state;
  const local = state.doc.toString();
  disk = await transactDocument({ ...target, expectedHash: disk.sourceHash, mutate: () => local });
  disk = await applyCommentOperation({ ...target, expectedHash: disk.sourceHash, operation: { type: "create", thread: thread() } });
  state = synchronizeCommentChanges(state, disk.source, { protectedRanges: [{ from, to: from + 13 }] }).state;
  const dispatch = (transaction) => { state = transaction.state; };
  assert.equal(undo({ state, dispatch }), true);
  disk = await transactDocument({ ...target, expectedHash: disk.sourceHash, mutate: () => state.doc.toString() });
  assert(disk.source.startsWith(base));
  assert.equal(disk.records.length, 1);
  assert.equal(redo({ state, dispatch }), true);
  disk = await transactDocument({ ...target, expectedHash: disk.sourceHash, mutate: () => state.doc.toString() });
  assert(disk.source.startsWith(local));
  assert.equal(disk.records.length, 1);
});

test("detached worktree writes create the existing protective branch before changing document bytes", async (t) => {
  const { target, root } = await fixture(t);
  await runGitCommand(root, ["checkout", "--detach"]);
  const start = await inspectDocument(target);
  const result = await applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: thread() } });
  assert.match((await runGitCommand(root, ["branch", "--show-current"])).stdout.trim(), /^openglance\/detached-/);
  assert.equal(result.records.length, 1);
});

test("linked worktrees use distinct mutation guards and protect a detached target without changing main", async (t) => {
  const { root, target } = await fixture(t);
  const linked = path.join(root, ".git", "comments-linked");
  await runGitCommand(root, ["worktree", "add", "--detach", linked, "HEAD"]);
  const peerTarget = { repoRoot: linked, file: "plan.md" };
  const start = await inspectDocument(peerTarget);
  const written = await withWorktreeMutation(root, () => applyCommentOperation({ ...peerTarget,
    expectedHash: start.sourceHash, operation: { type: "create", thread: thread() }, timeoutMs: 0 }));
  assert.equal(written.records.length, 1);
  assert.match((await runGitCommand(linked, ["branch", "--show-current"])).stdout, /^openglance\/detached-/);
  assert.equal((await runGitCommand(root, ["branch", "--show-current"])).stdout.trim(), "main");
  assert.equal((await inspectDocument(target)).records.length, 0);
});

test("a real conflicting Git merge keeps both file versions and refuses comment mutation", async (t) => {
  const { root, target } = await fixture(t);
  const data = thread();
  let disk = await inspectDocument(target);
  await applyCommentOperation({ ...target, expectedHash: disk.sourceHash, operation: { type: "create", thread: data } });
  await runGitCommand(root, ["add", "plan.md"]);
  await runGitCommand(root, ["commit", "-m", "Shared thread"]);
  await runGitCommand(root, ["checkout", "-b", "peer"]);
  for (const [branch, text] of [["peer", "Peer reply"], ["main", "Main reply"]]) {
    await runGitCommand(root, ["checkout", branch]);
    disk = await inspectDocument(target);
    await applyCommentOperation({ ...target, expectedHash: disk.sourceHash, operation: { type: "reply", thread_id: data.id, message: message(text) } });
    await runGitCommand(root, ["add", "plan.md"]);
    await runGitCommand(root, ["commit", "-m", text]);
  }
  await assert.rejects(runGitCommand(root, ["merge", "peer"]));
  const conflict = await readFile(path.join(root, "plan.md"), "utf8");
  assert((await runGitCommand(root, ["ls-files", "--unmerged"])).stdout.length > 0);
  await assert.rejects(applyCommentOperation({ ...target, expectedHash: hashText(conflict), operation: { type: "set-status", thread_id: data.id, status: "resolved" } }), /conflict/i);
  assert.equal(await readFile(path.join(root, "plan.md"), "utf8"), conflict);
  assert(conflict.includes("Main reply") && conflict.includes("Peer reply"));
});

test("untracked documents in an unborn repository can carry comments without creating a commit", async (t) => {
  const { target, root } = await fixture(t, { commit: false });
  const start = await inspectDocument(target);
  await applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: thread() } });
  assert.equal((await runGitCommand(root, ["status", "--porcelain"])).stdout.trim(), "?? plan.md");
});

test("an in-progress Git merge or index lock refuses comments without changing the draft or document", async (t) => {
  const { root, target } = await fixture(t);
  const start = await inspectDocument(target);
  const operation = { type: "create", thread: thread() };
  const before = structuredClone(operation);
  const head = (await runGitCommand(root, ["rev-parse", "HEAD"])).stdout.trim();
  await writeFile(path.join(root, ".git", "MERGE_HEAD"), head + "\n");
  await assert.rejects(applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation }), /progress|merge/);
  await rm(path.join(root, ".git", "MERGE_HEAD"));
  await writeFile(path.join(root, ".git", "index.lock"), "busy");
  await assert.rejects(applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation }), { code: "git_busy" });
  assert.equal((await inspectDocument(target)).source, initial);
  assert.deepEqual(operation, before);
});

test("path, encoding, and version boundaries reject unsafe writes before changing repository content", async (t) => {
  const { target, root } = await fixture(t);
  const start = await inspectDocument(target);
  const operation = { type: "create", thread: thread() };
  for (const file of ["../outside.md", "/tmp/outside.md", ".git/config.md", "plan.mdx", "sub/../../plan.md", "sub\\plan.md"]) {
    await assert.rejects(applyCommentOperation({ ...target, file, expectedHash: start.sourceHash, operation }), { code: "invalid_path" });
  }
  await assert.rejects(applyCommentOperation({ ...target, operation }), { code: "expected_hash_required" });
  if (process.platform !== "win32") {
    await symlink(path.join(root, "plan.md"), path.join(root, "alias.md"));
    await assert.rejects(applyCommentOperation({ ...target, file: "alias.md", expectedHash: start.sourceHash, operation }), { code: "invalid_path" });
  }
  await writeFile(path.join(root, "invalid.md"), Buffer.from([0xff, 0x61]));
  await assert.rejects(inspectDocument({ ...target, file: "invalid.md" }), { code: "invalid_utf8" });
  assert.equal((await inspectDocument(target)).source, initial);
});

test("atomic writes preserve file permissions and a UTF-8 BOM", async (t) => {
  const { target, root } = await fixture(t);
  const source = "\uFEFF" + initial;
  await writeFile(path.join(root, "plan.md"), source);
  await chmod(path.join(root, "plan.md"), 0o640);
  const before = await lstat(path.join(root, "plan.md"));
  const start = await inspectDocument(target);
  assert.equal(start.sourceHash, hashText(source));
  await applyCommentOperation({ ...target, expectedHash: start.sourceHash, operation: { type: "create", thread: thread() } });
  assert((await readFile(path.join(root, "plan.md"), "utf8")).startsWith(source));
  assert.equal((await lstat(path.join(root, "plan.md"))).mode & 0o777, before.mode & 0o777);
});
