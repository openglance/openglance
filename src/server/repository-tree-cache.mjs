import { watch } from "node:fs";
import path from "node:path";

import { externalCommandState, runExternalCommand } from "./external-command.mjs";
import { buildFileTree, listGitWorktreeEntries } from "./tree.mjs";

// Native events handle ordinary edits; bounded reconciliation also covers dropped
// events, network filesystems and Git ignore configuration outside the worktree.
const RECONCILE_MS = 5 * 60_000;
const FALLBACK_MS = 5000;
const MAX_PENDING_PATHS = 2048;

export function createRepositoryTreeCache({
  repoRoot,
  buildTree = buildFileTree,
  discover = listGitWorktreeEntries,
  watchFn = watch,
  now = Date.now,
  reconcileMs = RECONCILE_MS,
  fallbackMs = FALLBACK_MS,
} = {}) {
  let snapshot = null;
  let discoverySignature = "";
  let knownPaths = new Set();
  let discoveredPaths = new Set();
  let knownDirectories = new Set();
  let pendingPaths = new Set();
  let dirty = true;
  let discoveryDirty = false;
  let watchers = [];
  let watching = false;
  let lastWatchAttempt = -Infinity;
  let inFlight = null;
  let disposed = false;
  let revision = 0;

  function changed(relativePath) {
    if (disposed) return;
    const file = String(relativePath ?? "").replaceAll("\\", "/");
    if (!file) {
      dirty = true;
    } else if (file === ".git" || file.startsWith(".git/")) {
      // Object writes, logs and lock files cannot change the tree. HEAD is checked
      // by each request, while index/ignore changes can alter discovery or kinds.
      const gitPath = file.slice(5);
      if (["index", "info/exclude", "config"].includes(gitPath)) discoveryDirty = true;
    } else if (knownPaths.has(file) || discoveredPaths.has(file)) {
      dirty = true;
    } else if (knownDirectories.has(file)) {
      // Directory notifications can describe ignored child creation (notably on
      // Windows). Reconcile membership before deciding to rescan visible files.
      discoveryDirty = true;
    } else if (pendingPaths.size < MAX_PENDING_PATHS) {
      pendingPaths.add(file);
    } else {
      discoveryDirty = true;
    }
  }

  function stopWatching() {
    watching = false;
    for (const watcher of watchers) watcher.close?.();
    watchers = [];
  }

  async function startWatching() {
    if (watching || now() - lastWatchAttempt < fallbackMs || disposed) return;
    lastWatchAttempt = now();
    stopWatching();
    try {
      const add = (root, listener) => {
        const watcher = watchFn(root, { recursive: true, persistent: false }, listener);
        watcher.on("error", () => { dirty = true; stopWatching(); });
        watcher.on("close", () => {
          if (watchers.includes(watcher)) { dirty = true; stopWatching(); }
        });
        watchers.push(watcher);
      };
      add(repoRoot, (_event, file) => changed(file));
      // Linked worktrees keep their index and shared ignore rules outside repoRoot.
      const { stdout } = await runExternalCommand("git", ["rev-parse", "--git-dir", "--git-common-dir"], { cwd: repoRoot });
      for (const directory of new Set(stdout.trim().split("\n").map(p => path.resolve(repoRoot, p)))) {
        const relative = path.relative(repoRoot, directory);
        if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) continue;
        add(directory, (_event, file) => changed(file ? `.git/${file}` : null));
      }
      if (disposed) stopWatching();
      else watching = watchers.length > 0;
    } catch (error) {
      // Plain directories still have a useful root watcher. Unsupported recursive
      // watching and other failures fall back to the existing refresh cadence.
      if (externalCommandState(error) === "invalid_context" && watchers.length) watching = true;
      else stopWatching();
    }
  }

  async function read({ head = "", force = false } = {}) {
    await startWatching();
    const expired = !snapshot || now() - snapshot.at >= (watching ? reconcileMs : fallbackMs);
    const changedHead = snapshot && snapshot.head !== head;
    if (!force && !expired && !changedHead && !dirty && !discoveryDirty && !pendingPaths.size) return snapshot.tree;

    // Consume only events already observed. Events delivered during asynchronous
    // discovery/build stay pending and invalidate the next request.
    const paths = pendingPaths;
    pendingPaths = new Set();
    const mustBuild = force || expired || changedHead || dirty;
    dirty = false;
    discoveryDirty = false;
    try {
      let entries = null;
      try {
        entries = await discover(repoRoot);
      } catch (error) {
        if (externalCommandState(error) !== "invalid_context") throw error;
      }
      const signature = entries ? JSON.stringify(entries) : "";
      const touchedVisiblePath = !mustBuild && entries?.some(entry => {
        let candidate = entry.path;
        while (candidate !== ".") {
          if (paths.has(candidate)) return true;
          candidate = path.posix.dirname(candidate);
        }
        return false;
      });
      if (mustBuild || !entries || signature !== discoverySignature || touchedVisiblePath) {
        const tree = await buildTree(repoRoot, { entries });
        knownPaths = new Set();
        knownDirectories = new Set();
        const collect = (nodes, parent = "") => {
          for (const node of nodes) {
            if (node.type === "directory") {
              const directory = parent ? `${parent}/${node.name}` : node.name;
              knownDirectories.add(directory);
              collect(node.children, directory);
            } else {
              knownPaths.add(node.path);
            }
          }
        };
        collect(tree);
        discoveredPaths = new Set(entries?.map(entry => entry.path) ?? knownPaths);
        snapshot = { tree, head, at: now() };
        discoverySignature = signature;
        revision++;
      }
      return snapshot.tree;
    } catch (error) {
      dirty = true;
      throw error;
    }
  }

  return {
    async get(options = {}) {
      // A forced local-write/focus refresh must run after any older request rather
      // than returning a scan that began before that action.
      while (inFlight) {
        await inFlight;
      }
      inFlight = read(options);
      try { return await inFlight; }
      finally { inFlight = null; }
    },
    dispose() { disposed = true; stopWatching(); },
    get revision() { return revision; },
  };
}
