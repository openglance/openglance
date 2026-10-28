// Cooperative prototype only: the existing App routes do not acquire this lock yet.
import { randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TextDecoder } from "node:util";
import { ensureWorktreeBranch } from "../../src/server/git-worktrees.mjs";
import {
  assertNoGitOperationInProgress, gitOperationPathExists, runGitCommand,
} from "../../src/server/git-sync.mjs";
import { CommentError, LIMITS, hashText, mutateComments, parseComments } from "./format.mjs";

async function canonicalRoot(repoRoot) {
  const root = await realpath(repoRoot);
  const result = await runGitCommand(root, ["rev-parse", "--show-toplevel"]);
  if (await realpath(result.stdout.trim()) !== root) {
    throw new CommentError("invalid_root", "Use the exact worktree root.");
  }
  return root;
}

async function documentPath(root, file) {
  if (typeof file !== "string" || file.includes("\0") || file.includes("\\") || path.isAbsolute(file)
    || file.split(/[\\/]/).some((part) => part === ".." || part === ".git")
    || path.extname(file).toLowerCase() !== ".md") {
    throw new CommentError("invalid_path", "Expected a repository-relative .md path within this worktree.");
  }
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || await realpath(absolute) !== absolute) {
    throw new CommentError("invalid_path", "Symbolic links and paths outside the worktree are not supported.");
  }
  const info = await lstat(absolute);
  if (!info.isFile() || info.nlink !== 1) {
    throw new CommentError("invalid_path", "Expected one regular file, without hard-link aliases.");
  }
  return { absolute, info };
}

async function readSource(absolute) {
  const handle = await open(absolute, "r");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, LIMITS.documentBytes + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > LIMITS.documentBytes) throw new CommentError("document_limit", "Document exceeds size limit.");
      chunks.push(buffer.subarray(0, bytesRead));
    }
  } finally { await handle.close(); }
  const bytes = Buffer.concat(chunks);
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new CommentError("invalid_utf8", "Refusing to rewrite a file that is not valid UTF-8."); }
}

async function preflight(root) {
  await assertNoGitOperationInProgress({ repo: { root }, locale: "en" }, runGitCommand, gitOperationPathExists);
  const index = await runGitCommand(root, ["rev-parse", "--git-path", "index.lock"]);
  if (await gitOperationPathExists(path.resolve(root, index.stdout.trim()))) {
    throw new CommentError("git_busy", "The Git index is locked; retain the draft and retry later.");
  }
}

export async function withWorktreeMutation(repoRoot, action, { timeoutMs = 5000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 5000) {
    throw new CommentError("invalid_timeout", "Lock wait must be between zero and 5000 milliseconds.");
  }
  const root = await canonicalRoot(repoRoot);
  const gitDirectory = await runGitCommand(root, ["rev-parse", "--absolute-git-dir"]);
  const lockPath = path.join(gitDirectory.stdout.trim(), "openglance-comments-prototype.lock");
  const started = performance.now();
  let lock;
  for (;;) {
    try { lock = await open(lockPath, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (performance.now() - started >= timeoutMs) throw new CommentError("worktree_busy", "Another cooperating mutation holds the worktree; retain the draft.");
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

export async function inspectDocument({ repoRoot, file }) {
  const root = await canonicalRoot(repoRoot);
  const { absolute } = await documentPath(root, file);
  return parseComments(await readSource(absolute));
}

export async function transactDocument({
  repoRoot, file, expectedHash, mutate, timeoutMs, replaceFile = rename,
}) {
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedHash)) {
    throw new CommentError("expected_hash_required", "Every write requires the full source hash returned by inspect.");
  }
  return withWorktreeMutation(repoRoot, async (root) => {
    await preflight(root);
    const { absolute, info } = await documentPath(root, file);
    const source = await readSource(absolute);
    if (hashText(source) !== expectedHash) throw new CommentError("stale_source", "File changed; retain the operation/draft and re-read.");
    const nextSource = await mutate(source);
    const parsed = parseComments(nextSource);
    if (nextSource === source) return parsed;
    // Validate the proposed change before creating a branch or replacing any document bytes.
    await ensureWorktreeBranch(root);
    const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.comments-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, "wx", info.mode & 0o777);
      await handle.chmod(info.mode & 0o777);
      await handle.writeFile(nextSource, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await preflight(root);
      const current = await documentPath(root, file);
      if (current.info.ino !== info.ino || current.info.dev !== info.dev || current.info.mode !== info.mode
        || hashText(await readSource(absolute)) !== expectedHash) {
        throw new CommentError("stale_source", "File changed during the transaction; retain the operation/draft.");
      }
      await replaceFile(temporary, absolute);
      return parsed;
    } finally {
      if (handle) await handle.close();
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }, { timeoutMs });
}

export async function applyCommentOperation(options) {
  return transactDocument({ ...options, mutate: (source) => mutateComments(source, options.operation) });
}
