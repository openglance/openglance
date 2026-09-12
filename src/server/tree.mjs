import { lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { treeFileCanShowDocumentTitle } from "../../public/tree-file-title.js";
import { extractDocumentTitle } from "../content/markdown.mjs";
import { fileTypeForPath, isMarkdownPath } from "./file-types.mjs";
import { externalCommandState, runExternalCommand } from "./external-command.mjs";
import { toPosixPath } from "./paths.mjs";

const TREE_TITLE_READ_CONCURRENCY = 24;
const TREE_TITLE_FULL_READ_MAX_BYTES = 2 * 1024 * 1024;
const TREE_TITLE_PREFIX_BYTES = 256 * 1024;
const treeTitleCacheByRepo = new Map();

export async function buildMarkdownTree(repoRoot) {
  const files = await listRepositoryFiles(repoRoot);
  return treeFromFiles(files.filter((file) => isMarkdownPath(file.path)));
}

export async function buildFileTree(repoRoot) {
  const files = await listRepositoryFiles(repoRoot);
  await attachDocumentTitles(repoRoot, files);
  return treeFromFiles(files);
}

export async function listRepositoryFiles(repoRoot) {
  try {
    return await listGitWorktreeFiles(repoRoot);
  } catch (error) {
    if (externalCommandState(error) === "invalid_context") {
      return listFilesystemFiles(repoRoot);
    }
    throw error;
  }
}

async function listGitWorktreeFiles(repoRoot) {
  const [trackedResult, untrackedResult, stagedResult] = await Promise.all([
    runGit(repoRoot, ["ls-files", "--cached", "-z"]),
    runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    runGit(repoRoot, ["ls-files", "--stage", "-z"]),
  ]);
  const stagedModes = stageModesFromOutput(stagedResult.stdout);
  const paths = new Set([
    ...nulPaths(trackedResult.stdout),
    ...nulPaths(untrackedResult.stdout),
  ]);
  const files = [];
  for (const relativePath of paths) {
    const absolutePath = path.join(repoRoot, ...relativePath.split("/"));
    let fileStat;
    try {
      fileStat = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const mode = stagedModes.get(relativePath) ?? "";
    if (mode === "160000") {
      files.push(fileRecord(relativePath, "submodule"));
      continue;
    }
    if (fileStat.isSymbolicLink()) {
      files.push(fileRecord(relativePath, "symlink"));
      continue;
    }
    if (fileStat.isFile()) {
      files.push(fileRecord(relativePath, "", {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        ctimeMs: fileStat.ctimeMs,
      }));
    }
  }
  return files;
}

async function listFilesystemFiles(repoRoot) {
  const files = [];
  await scanFilesystemDirectory(repoRoot, repoRoot, files);
  return files;
}

async function scanFilesystemDirectory(repoRoot, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosixPath(path.relative(repoRoot, absolutePath));
    if (entry.isDirectory()) {
      await scanFilesystemDirectory(repoRoot, absolutePath, files);
    } else if (entry.isSymbolicLink()) {
      files.push(fileRecord(relativePath, "symlink"));
    } else if (entry.isFile()) {
      const needsStat = entry.name === ".gitkeep" || isMarkdownPath(relativePath);
      const fileStat = needsStat ? await lstat(absolutePath) : null;
      const options = fileStat
        ? {
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs,
            ctimeMs: fileStat.ctimeMs,
          }
        : {};
      files.push(fileRecord(relativePath, "", options));
    }
  }
}

function fileRecord(
  relativePath,
  forcedKind = "",
  { size = null, mtimeMs = null, ctimeMs = null } = {},
) {
  const normalizedPath = toPosixPath(relativePath);
  const placeholder = !forcedKind &&
    size === 0 &&
    path.posix.basename(normalizedPath) === ".gitkeep";
  const fileType = fileTypeForPath(normalizedPath);
  return {
    path: normalizedPath,
    kind: forcedKind || (placeholder ? "placeholder" : fileType?.kind) || "unknown",
    size,
    mtimeMs,
    ctimeMs,
    ...(placeholder ? { placeholder: true } : {}),
  };
}

async function attachDocumentTitles(repoRoot, files) {
  const cache = treeTitleCacheByRepo.get(repoRoot) ?? new Map();
  treeTitleCacheByRepo.set(repoRoot, cache);
  const candidates = files.filter(treeFileCanShowDocumentTitle);
  const currentPaths = new Set(candidates.map((file) => file.path));

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(TREE_TITLE_READ_CONCURRENCY, candidates.length) },
    async () => {
      while (cursor < candidates.length) {
        const file = candidates[cursor];
        cursor += 1;
        const signature = `${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
        const cached = cache.get(file.path);
        let title = cached?.signature === signature ? cached.title : null;
        if (title === null) {
          try {
            const source = await readTreeDocumentTitleSource(
              path.join(repoRoot, ...file.path.split("/")),
              file.size,
            );
            title = extractDocumentTitle(source);
          } catch {
            title = "";
          }
          cache.set(file.path, { signature, title });
        }
        if (title) {
          file.title = title;
        }
      }
    },
  );
  await Promise.all(workers);

  for (const cachedPath of cache.keys()) {
    if (!currentPaths.has(cachedPath)) {
      cache.delete(cachedPath);
    }
  }
}

async function readTreeDocumentTitleSource(absolutePath, size) {
  if (!Number.isFinite(size) || size <= TREE_TITLE_FULL_READ_MAX_BYTES) {
    return readFile(absolutePath, "utf8");
  }

  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(TREE_TITLE_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function treeFromFiles(files) {
  const root = directoryBuilder("");
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    let directory = root;
    for (const name of parts.slice(0, -1)) {
      if (!directory.directories.has(name)) {
        directory.directories.set(name, directoryBuilder(name));
      }
      directory = directory.directories.get(name);
    }
    const name = parts.at(-1);
    directory.files.set(name, {
      type: "file",
      name,
      path: file.path,
      kind: file.kind,
      ...(file.title ? { title: file.title } : {}),
      ...(file.placeholder ? { placeholder: true } : {}),
    });
  }
  return finalizeDirectory(root);
}

function directoryBuilder(name) {
  return { name, directories: new Map(), files: new Map() };
}

function finalizeDirectory(directory) {
  return sortNodes([
    ...directory.files.values(),
    ...[...directory.directories.values()].map((child) => {
      const children = finalizeDirectory(child);
      const placeholderOnly = children.length === 1 &&
        children[0].type === "file" &&
        children[0].placeholder === true;
      return {
        type: "directory",
        name: child.name,
        children,
        ...(placeholderOnly ? { placeholderOnly: true } : {}),
      };
    }),
  ]);
}

function sortNodes(nodes) {
  return nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    if (left.type === "directory") {
      const leftUnderscoreRank = left.name.startsWith("_") ? 1 : 0;
      const rightUnderscoreRank = right.name.startsWith("_") ? 1 : 0;
      if (leftUnderscoreRank !== rightUnderscoreRank) {
        return leftUnderscoreRank - rightUnderscoreRank;
      }
    }
    return left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true });
  });
}

function stageModesFromOutput(output) {
  const modes = new Map();
  for (const record of String(output ?? "").split("\0").filter(Boolean)) {
    const match = record.match(/^(\d+)\s+[0-9a-f]+\s+\d+\t([\s\S]+)$/);
    if (match) {
      modes.set(toPosixPath(match[2]), match[1]);
    }
  }
  return modes;
}

function nulPaths(output) {
  return String(output ?? "")
    .split("\0")
    .map((value) => toPosixPath(value))
    .filter(Boolean);
}

function runGit(cwd, args) {
  return runExternalCommand("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
}
