import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { createRepositoryTreeCache } from "../src/server/repository-tree-cache.mjs";
import { buildFileTree } from "../src/server/tree.mjs";

const exec = promisify(execFile);
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "openglance-tree-cache-"));
  const git = (args) => exec("git", args, { cwd: root });
  await git(["init", "-q"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(root, "sample.md"), "# Original\n");
  await writeFile(path.join(root, ".gitignore"), "build/\n");
  await git(["add", "."]);
  await git(["commit", "-qm", "Fixture"]);
  let builds = 0;
  const cache = createRepositoryTreeCache({
    repoRoot: root,
    buildTree: async (...args) => { builds++; return buildFileTree(...args); },
    ...options,
  });
  t.after(async () => { cache.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, git, cache, builds: () => builds };
}
const title = (tree, name = "sample.md") => tree.find(node => node.path === name)?.title;
const settle = () => delay(100);

test("idle and concurrent refreshes reuse one complete repository tree", async t => {
  const f = await fixture(t);
  const trees = await Promise.all(Array.from({ length: 8 }, () => f.cache.get({ head: "first" })));
  assert.equal(f.builds(), 1);
  assert.equal(title(trees[0]), "Original");
  assert.deepEqual(await f.cache.get({ head: "first" }), trees[0]);
  assert.equal(f.builds(), 1);
});

test("a dirty document's second title edit and an atomic replacement both refresh", async t => {
  const f = await fixture(t);
  await f.cache.get();
  for (const nextTitle of ["Dirty once", "Dirty twice"]) {
    await writeFile(path.join(f.root, "sample.md"), `---\ntitle: ${nextTitle}\n---\n# Body\n`);
    await settle();
    assert.equal(title(await f.cache.get()), nextTitle);
  }
  await writeFile(path.join(f.root, "replacement.tmp"), "# Atomic title\n");
  await rename(path.join(f.root, "replacement.tmp"), path.join(f.root, "sample.md"));
  await settle();
  assert.equal(title(await f.cache.get()), "Atomic title");
});

test("new folders, renamed files, tracked deletion and restoration remain discoverable", async t => {
  const f = await fixture(t);
  await f.cache.get();
  await mkdir(path.join(f.root, "new"));
  await writeFile(path.join(f.root, "new", "draft.md"), "# Draft\n");
  await settle();
  assert.equal((await f.cache.get()).find(n => n.name === "new").children[0].title, "Draft");
  await rename(path.join(f.root, "new"), path.join(f.root, "renamed"));
  await rm(path.join(f.root, "sample.md"));
  await settle();
  const removed = await f.cache.get();
  assert.equal(title(removed), undefined);
  assert.equal(removed.find(n => n.name === "new"), undefined);
  assert.equal(removed.find(n => n.name === "renamed").children[0].title, "Draft");
  await writeFile(path.join(f.root, "sample.md"), "# Restored\n");
  await settle();
  assert.equal(title(await f.cache.get()), "Restored");
});

test("ignored build churn never causes file stat/title scans, but ignore-rule edits refresh discovery", async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, "docs"));
  await writeFile(path.join(f.root, "docs", "reference.md"), "# Reference\n");
  await f.cache.get();
  // Drain the platform's initial event batch for fixture creation before measuring
  // steady-state build churn; those events can arrive after the watcher starts.
  await settle();
  await f.cache.get();
  const idleBuilds = f.builds();
  await mkdir(path.join(f.root, "build"));
  await mkdir(path.join(f.root, "docs", "build"));
  for (let cycle = 0; cycle < 3; cycle++) {
    await Promise.all(["build", "docs/build"].flatMap(directory => Array.from({ length: 20 }, (_, i) => writeFile(path.join(f.root, directory, `${i}.md`), `# ${cycle}\n`))));
    await settle();
    assert.equal((await f.cache.get()).find(n => n.name === "build"), undefined);
    assert.equal(f.builds(), idleBuilds);
  }
  await writeFile(path.join(f.root, ".gitignore"), "");
  await settle();
  assert.equal((await f.cache.get()).find(n => n.name === "build").children.length, 20);
});

test("a changed HEAD refreshes clean content even without a watcher event", async t => {
  const f = await fixture(t, { watchFn: () => new EventEmitter().setMaxListeners(0) });
  const head = async () => (await f.git(["rev-parse", "HEAD"])).stdout.trim();
  await f.cache.get({ head: await head() });
  await writeFile(path.join(f.root, "sample.md"), "# Committed new title\n");
  await f.git(["add", "."]);
  await f.git(["commit", "-qm", "New content"]);
  assert.equal(title(await f.cache.get({ head: await head() })), "Committed new title");
});

test("watch failure expires the snapshot, retries watching and explicit refresh bypasses it", async t => {
  let time = 0;
  let attempts = 0;
  const f = await fixture(t, {
    now: () => time,
    fallbackMs: 10,
    watchFn: () => { attempts++; throw new Error("Unavailable"); },
  });
  await f.cache.get();
  await writeFile(path.join(f.root, "sample.md"), "# Fallback\n");
  time = 11;
  assert.equal(title(await f.cache.get()), "Fallback");
  assert.ok(attempts >= 2);
  await writeFile(path.join(f.root, "sample.md"), "# Forced\n");
  assert.equal(title(await f.cache.get({ force: true })), "Forced");
});

test("metadata-only edits advance the snapshot revision while idle reads keep it stable", async t => {
  const f = await fixture(t);
  const first = await f.cache.get();
  const revision = f.cache.revision;
  await f.cache.get();
  assert.equal(f.cache.revision, revision);
  await writeFile(path.join(f.root, "sample.md"), "---\nai_snippet: Changed search metadata\n---\n# Original\n");
  await settle();
  assert.deepEqual(await f.cache.get(), first);
  assert.ok(f.cache.revision > revision);
});

test("linked worktree shared exclude rules and local index changes update discovery", async t => {
  const f = await fixture(t);
  const linked = path.join(f.root, "linked");
  await f.git(["worktree", "add", "-qb", "linked", linked]);
  const cache = createRepositoryTreeCache({ repoRoot: linked });
  t.after(() => cache.dispose());
  await writeFile(path.join(linked, "draft.md"), "# Draft\n");
  assert.equal(title(await cache.get(), "draft.md"), "Draft");
  await writeFile(path.join(f.root, ".git", "info", "exclude"), "draft.md\n");
  await settle();
  assert.equal(title(await cache.get(), "draft.md"), undefined);
  await exec("git", ["add", "-f", "draft.md"], { cwd: linked });
  await settle();
  assert.equal(title(await cache.get(), "draft.md"), "Draft");
});

test("edits observed during a rebuild survive to the next refresh and disposal closes watchers", async t => {
  let callback;
  let closed = 0;
  const watchers = [];
  let edited = false;
  const f = await fixture(t, {
    watchFn: (_root, _options, listener) => {
      callback = listener;
      const watcher = new EventEmitter();
      watcher.close = () => { closed++; };
      watchers.push(watcher);
      return watcher;
    },
    buildTree: async (...args) => {
      const result = await buildFileTree(...args);
      if (!edited) {
        edited = true;
        await writeFile(path.join(args[0], "sample.md"), "# During scan\n");
        callback("change", "sample.md");
      }
      return result;
    },
  });
  assert.equal(title(await f.cache.get()), "Original");
  assert.equal(title(await f.cache.get()), "During scan");
  f.cache.dispose();
  assert.equal(closed, watchers.length);
});

test("a failed rebuild reports the failure and retries rather than serving a successful stale result", async t => {
  let fail = false;
  const f = await fixture(t, { buildTree: (...args) => {
    if (fail) throw new Error("Cannot read repository");
    return buildFileTree(...args);
  } });
  await f.cache.get();
  fail = true;
  await assert.rejects(f.cache.get({ force: true }), /Cannot read repository/);
  fail = false;
  await writeFile(path.join(f.root, "sample.md"), "# Recovered\n");
  assert.equal(title(await f.cache.get()), "Recovered");
});

test("a concurrent request for a newer HEAD rechecks after the older scan completes", async t => {
  let unblock;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  let builds = 0;
  const f = await fixture(t, {
    watchFn: () => new EventEmitter(),
    buildTree: async (...args) => {
      builds++;
      const tree = await buildFileTree(...args);
      if (builds === 1) { entered(); await gate; }
      return tree;
    },
  });
  const old = f.cache.get({ head: "A" });
  await started;
  await writeFile(path.join(f.root, "sample.md"), "# New HEAD\n");
  const next = f.cache.get({ head: "B" });
  unblock();
  assert.equal(title(await old), "Original");
  assert.equal(title(await next), "New HEAD");
  assert.equal(builds, 2);
});

test("unexpected watcher closure rebuilds and returns to native watching after retry", async t => {
  let time = 0;
  const watchers = [];
  const f = await fixture(t, {
    now: () => time, fallbackMs: 10,
    watchFn: () => {
      const watcher = new EventEmitter();
      watcher.close = () => {};
      watchers.push(watcher);
      return watcher;
    },
  });
  await f.cache.get();
  watchers[0].emit("close");
  await writeFile(path.join(f.root, "sample.md"), "# Reopened\n");
  time = 11;
  assert.equal(title(await f.cache.get()), "Reopened");
  assert.ok(watchers.length > 1);
});

test("bounded reconciliation refreshes content when the platform silently misses an event", async t => {
  let time = 0;
  const f = await fixture(t, { now: () => time, reconcileMs: 10, watchFn: () => new EventEmitter() });
  await f.cache.get();
  await writeFile(path.join(f.root, "sample.md"), "# Missed event\n");
  time = 11;
  assert.equal(title(await f.cache.get()), "Missed event");
});
