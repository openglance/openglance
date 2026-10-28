import { randomUUID } from "node:crypto";
import { open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runExternalCommand } from "./external-command.mjs";
import { CommentError } from "../content/document-comments.mjs";

export async function canonicalRoot(repoRoot) {
  const root = await realpath(repoRoot);
  const result = await runExternalCommand("git", ["rev-parse", "--show-toplevel"], { cwd: root });
  if (await realpath(result.stdout.trim()) !== root) throw new CommentError("invalid_root", "Use the exact worktree root.");
  return root;
}

export async function withWorktreeMutation(repoRoot, action, { timeoutMs = 5000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 5000) throw new CommentError("invalid_timeout", "Invalid lock timeout.");
  const root = await canonicalRoot(repoRoot);
  const gitDirectory = await runExternalCommand("git", ["rev-parse", "--absolute-git-dir"], { cwd: root });
  const lockPath = path.join(gitDirectory.stdout.trim(), "openglance-worktree-mutation.lock");
  const started = performance.now();
  let lock;
  for (;;) {
    try { lock = await open(lockPath, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (performance.now() - started >= timeoutMs) throw new CommentError("worktree_busy", "The worktree is busy. Your input is retained; retry shortly.");
      await delay(20);
    }
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() }));
    return await action(root);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
