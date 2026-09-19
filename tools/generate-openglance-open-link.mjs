#!/usr/bin/env node

/**
 * Standalone OpenGlance `/open` link generator for Git-backed content repositories.
 *
 * This file is intentionally self-contained and uses only Node.js built-ins. It is ready to copy to
 * `tools/generate-openglance-open-link.mjs` in another repository and call from that repository's
 * `AGENTS.md` or equivalent Agent instructions.
 *
 * Requirements:
 * - Node.js 22 or newer and Git must be available.
 * - The target repository must have a recognizable GitHub `origin`.
 * - `--file` must be a repository-relative Markdown or MDX path.
 *
 * The command reads local Git metadata and the document title, then prints an HTTPS URL. The URL contains the GitHub
 * `owner/repository`, document path, and—only for a linked worktree—a same-machine worktree ID derived
 * from its canonical path, plus an optional title of at most 100 characters. Use --no-preview-title
 * to omit the title. It never includes the document body, Git credentials, or an absolute path.
 *
 * `/open` is a navigation and preview link. It does not sync or publish the file and does not prove a
 * revision exists on `origin/main`. Use OpenGlance's in-app Copy share link flow for a published document
 * intended for another person.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OPENGLANCE_OPEN_URL = "https://gitleaf.mangofuture.com/open";

export function parseArguments(args) {
  const options = { repoRoot: process.cwd(), file: "", help: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo-root" || arg === "--file") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      options[arg === "--repo-root" ? "repoRoot" : "file"] = value;
      index += 1;
    } else if (arg.startsWith("--repo-root=")) {
      options.repoRoot = arg.slice("--repo-root=".length);
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg === "--no-preview-title") {
      options.previewTitle = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function githubRepositoryIdentityFromRemote(remote) {
  const value = String(remote ?? "").trim();
  const sshMatch = value.match(/^git@github\.com:(?<owner>[^/]+)\/(?<name>[^/]+)$/i);
  if (sshMatch?.groups) {
    return normalizeRepositoryIdentity(sshMatch.groups.owner, sshMatch.groups.name);
  }

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") {
      return "";
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) {
      return "";
    }
    return normalizeRepositoryIdentity(segments[0], segments[1]);
  } catch {
    return "";
  }
}

export function normalizeMarkdownPath(file) {
  const cleanFile = String(file ?? "").trim().replaceAll("\\", "/");
  if (
    !cleanFile
    || path.posix.isAbsolute(cleanFile)
    || path.win32.isAbsolute(cleanFile)
    || cleanFile.includes("\0")
  ) {
    throw new Error("--file must be a repository-relative Markdown or MDX path.");
  }

  const normalizedFile = path.posix.normalize(cleanFile);
  if (
    normalizedFile === ".."
    || normalizedFile.startsWith("../")
    || !/\.mdx?$/i.test(normalizedFile)
  ) {
    throw new Error("--file must be a repository-relative Markdown or MDX path.");
  }

  return normalizedFile;
}

export function parseGitWorktreeRoots(output) {
  const separator = String(output).includes("\0") ? "\0" : "\n";
  const roots = [];
  let currentRoot = "";

  for (const rawField of String(output).split(separator)) {
    const field = separator === "\n" ? rawField.replace(/\r$/, "") : rawField;
    if (!field) {
      if (currentRoot) {
        roots.push(currentRoot);
        currentRoot = "";
      }
    } else if (field.startsWith("worktree ")) {
      currentRoot = field.slice("worktree ".length);
    }
  }
  if (currentRoot) {
    roots.push(currentRoot);
  }

  return roots;
}

export function worktreeIdForPath(worktreeRoot) {
  return createHash("sha256")
    .update(path.resolve(worktreeRoot))
    .digest("hex")
    .slice(0, 16);
}

export async function createOpenGlanceOpenLink({
  repoRoot = process.cwd(),
  file,
  gitRunner = runGit,
  canonicalPath = resolveCanonicalPath,
  previewTitle = true,
} = {}) {
  const requestedRoot = await canonicalPath(repoRoot);
  const rootOutput = await gitRunner(requestedRoot, ["rev-parse", "--show-toplevel"]);
  const currentRoot = await canonicalPath(rootOutput.trim());
  const remote = (await gitRunner(currentRoot, ["remote", "get-url", "origin"])).trim();
  const repository = githubRepositoryIdentityFromRemote(remote);
  if (!repository) {
    throw new Error("The repository must have a GitHub origin before creating a OpenGlance link.");
  }

  const worktreeOutput = await readWorktreeList(currentRoot, gitRunner);
  const worktreeRoots = parseGitWorktreeRoots(worktreeOutput);
  if (worktreeRoots.length === 0) {
    throw new Error("Could not identify the repository's Git worktrees.");
  }

  const canonicalWorktreeRoots = await Promise.all(
    worktreeRoots.map((root) => canonicalPath(root)),
  );
  const currentIndex = canonicalWorktreeRoots.indexOf(currentRoot);
  if (currentIndex === -1) {
    throw new Error("Could not identify the current Git worktree.");
  }

  const url = new URL(OPENGLANCE_OPEN_URL);
  url.searchParams.set("repo", repository);
  url.searchParams.set("path", normalizeMarkdownPath(file));
  if (currentIndex > 0) {
    url.searchParams.set("worktree", worktreeIdForPath(currentRoot));
  }
  if (previewTitle) {
    const title = (await readOpenLinkPreviewTitle(currentRoot, url.searchParams.get("path")))
      .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (title) url.searchParams.set("title", title.length <= 100 ? title : `${title.slice(0, 99).trimEnd()}…`);
  }
  return url.toString();
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.file) {
    throw new Error("--file is required.");
  }

  console.log(await createOpenGlanceOpenLink(options));
}

async function readWorktreeList(repoRoot, gitRunner) {
  try {
    return await gitRunner(repoRoot, ["worktree", "list", "--porcelain", "-z"]);
  } catch (error) {
    const output = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
    if (!/(unknown (?:option|switch)|usage: git worktree list)/i.test(output)) {
      throw error;
    }
    return gitRunner(repoRoot, ["worktree", "list", "--porcelain"]);
  }
}

async function runGit(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function resolveCanonicalPath(value) {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

function normalizeRepositoryIdentity(owner, name) {
  const cleanOwner = String(owner ?? "").trim().toLowerCase();
  const cleanName = String(name ?? "").trim().replace(/\.git$/i, "").toLowerCase();
  return /^[a-z0-9_.-]+$/.test(cleanOwner) && /^[a-z0-9_.-]+$/.test(cleanName)
    ? `${cleanOwner}/${cleanName}`
    : "";
}

function printHelp() {
  console.log(`Usage: node tools/generate-openglance-open-link.mjs --file <repo-relative.md> [--repo-root <path>]

Creates a portable link for the primary worktree or a local-exact link containing the
worktree id for a linked worktree. The target repository must have a GitHub origin.
Includes a document title for external previews; --no-preview-title omits it.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

// Kept self-contained for copying to content repositories; parity is covered by repository-open-link-tool tests.
// Metadata is optional. Never follow a document symlink outside the selected repository,
// and read only a bounded prefix rather than loading arbitrary files into a shared URL.
export async function readOpenLinkPreviewTitle(repoRoot, file) {
  let handle;
  try {
    const root = await realpath(repoRoot);
    const target = await realpath(path.resolve(root, file));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return "";
    handle = await open(target, "r");
    if (!(await handle.stat()).isFile()) return "";
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return extractDocumentTitle(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return "";
  } finally {
    await handle?.close();
  }
}

function extractDocumentTitle(markdown) {
  const frontmatter = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)?.[1];
  const scalar = frontmatter?.match(/^title:[ \t]*(.+?)[ \t]*$/m)?.[1]?.trim();
  if (scalar && !/^[|>][+-]?\d?$/.test(scalar)) {
    const quote = scalar[0];
    return ((quote === '"' || quote === "'") && scalar.endsWith(quote)) ? scalar.slice(1, -1).trim() : scalar;
  }
  const heading = markdown.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "").match(/^#\s+(.+?)\s*$/m)?.[1];
  return (heading || "").replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1").replace(/[*_`~]/g, "").trim();
}
