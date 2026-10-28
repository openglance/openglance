// Shared guarded writes for App document edits and cooperating Agent tools.
import { randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { ensureWorktreeBranch } from "./git-worktrees.mjs";
import {
  assertNoGitOperationInProgress, gitOperationPathExists, runGitCommand,
} from "./git-sync.mjs";
import { CommentError, LIMITS, hashText, mutateComments, parseComments } from "./document-comments-format.mjs";
import { canonicalRoot, withWorktreeMutation } from "./worktree-mutation.mjs";
export { withWorktreeMutation } from "./worktree-mutation.mjs";

async function documentPath(root, file, allowMdx = false) {
  if (typeof file !== "string" || file.includes("\0") || file.includes("\\") || path.isAbsolute(file)
    || file.split(/[\\/]/).some((part) => part === ".." || part === ".git")
    || ![".md", ...(allowMdx ? [".mdx"] : [])].includes(path.extname(file).toLowerCase())) {
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

async function readSource(absolute, maxBytes = LIMITS.documentBytes) {
  const handle = await open(absolute, "r");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maxBytes) throw new CommentError("document_limit", "Document exceeds size limit.");
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

export async function inspectDocument({ repoRoot, file }) {
  const root = await canonicalRoot(repoRoot);
  const { absolute } = await documentPath(root, file);
  return parseComments(await readSource(absolute));
}

export async function transactDocument({
  repoRoot, file, expectedHash, mutate, timeoutMs, replaceFile = rename,
  allowMdx = false, maxBytes = LIMITS.documentBytes, validate = parseComments, beforeWrite,
}) {
  if (!/^sha256:[0-9a-f]{64}$/.test(expectedHash)) {
    throw new CommentError("expected_hash_required", "Every write requires the full source hash returned by inspect.");
  }
  return withWorktreeMutation(repoRoot, async (root) => {
    await preflight(root);
    const { absolute, info } = await documentPath(root, file, allowMdx);
    const source = await readSource(absolute, maxBytes);
    if (hashText(source) !== expectedHash) throw new CommentError("stale_source", "File changed; retain the operation/draft and re-read.");
    const nextSource = await mutate(source);
    if (typeof nextSource !== "string" || Buffer.byteLength(nextSource) > maxBytes) throw new CommentError("document_limit", "Document exceeds the write limit.");
    const parsed = validate(nextSource);
    if (nextSource === source) return parsed;
    // Validate the proposed change before creating a branch or replacing any document bytes.
    const protection = await ensureWorktreeBranch(root);
    await beforeWrite?.(protection);
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
      const current = await documentPath(root, file, allowMdx);
      if (current.info.ino !== info.ino || current.info.dev !== info.dev || current.info.mode !== info.mode
        || hashText(await readSource(absolute, maxBytes)) !== expectedHash) {
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
