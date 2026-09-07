import { randomUUID } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

import {
  gitCommonDirectory,
  listGitWorktrees,
  worktreeIdForPath,
} from "./git-worktrees.mjs";
import {
  gitCommandReportsMissingRepository,
  GitRepositoryNotFoundError,
} from "./git-errors.mjs";
import {
  externalCommandOutput,
  externalCommandState,
  isExternalCommandExit,
  runExternalCommand,
} from "./external-command.mjs";

export function createRepository({
  repoRoot,
  initialFile,
  branch = "main",
  githubBlobRoot = null,
} = {}) {
  const id = path.basename(repoRoot);
  return {
    id,
    name: id,
    root: repoRoot,
    defaultFile: initialFile?.relativePath ?? "",
    branch,
    detached: !branch,
    head: "",
    worktreeId: worktreeIdForPath(repoRoot),
    worktreeName: id,
    repositoryRoot: repoRoot,
    commonDir: "",
    githubBlobRoot,
    instanceId: randomUUID(),
  };
}

export function canEditRepository({ repo, isLocalRequest }) {
  return Boolean(isLocalRequest) && Boolean(repo);
}

export async function createRepositoryInfo({ repoRoot, initialFile }) {
  try {
    await runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (gitCommandReportsMissingRepository(error)) {
      throw new GitRepositoryNotFoundError(repoRoot, { cause: error });
    }
    throw error;
  }

  const root = await realpath(repoRoot);
  const worktrees = await listGitWorktrees(root);
  const currentWorktree = worktrees.find((worktree) => worktree.current) ?? worktrees[0];
  const primaryWorktree = worktrees.find((worktree) => !worktree.bare) ?? currentWorktree;
  const branch = currentWorktree?.branch ?? await currentBranch(root);
  const id = path.basename(primaryWorktree?.root ?? root);
  const head = currentWorktree?.head ?? await currentHead(root);

  return {
    id,
    name: id,
    root,
    defaultFile: initialFile?.relativePath ?? await defaultMarkdownFile(repoRoot),
    branch,
    detached: !branch,
    head,
    worktreeId: worktreeIdForPath(root),
    worktreeName: currentWorktree?.name ?? path.basename(root),
    repositoryRoot: primaryWorktree?.root ?? root,
    commonDir: await gitCommonDirectory(root),
    githubBlobRoot: await githubBlobRoot(repoRoot, branch || head),
    instanceId: randomUUID(),
  };
}

export async function currentBranch(repoRoot) {
  const { stdout } = await runGit(repoRoot, ["branch", "--show-current"]);
  return stdout.trim();
}

export async function currentBranchOrFallback(repo) {
  try {
    return await currentBranch(repo.root);
  } catch {
    return repo.branch;
  }
}

export async function currentHead(repoRoot) {
  const { stdout } = await runGit(repoRoot, ["rev-parse", "HEAD"]);
  return stdout.trim();
}

async function defaultMarkdownFile(repoRoot) {
  for (const candidate of ["AGENTS.md", "README.md", "CONTEXT.md"]) {
    try {
      await access(path.join(repoRoot, candidate), constants.F_OK);
      return candidate;
    } catch {
      // Try the next conventional entrypoint.
    }
  }
  return "README.md";
}

export async function githubBlobRoot(repoRoot, branch) {
  try {
    const { stdout } = await runGit(repoRoot, ["remote", "get-url", "origin"]);
    const repository = githubRepositoryFromRemote(stdout.trim());
    if (!repository) {
      return null;
    }
    return `https://github.com/${repository.owner}/${repository.name}/blob/${branch}`;
  } catch {
    return null;
  }
}

export function githubRepositoryIdentityFromRemote(remote) {
  const repository = githubRepositoryFromRemote(String(remote || "").trim());
  return repository
    ? canonicalGithubRepositoryIdentity(`${repository.owner}/${repository.name}`)
    : "";
}

export function canonicalGithubRepositoryIdentity(identity) {
  const normalized = String(identity || "").trim().replace(/\.git$/i, "").toLowerCase();
  return GITHUB_REPOSITORY_RENAME_ALIASES.get(normalized) ?? normalized;
}

export async function findGithubRepositoryRoot(
  repository,
  candidates = [],
  {
    worktree = "",
    primary = false,
    originReader = readOrigin,
    readWorktrees = listGitWorktrees,
    candidateAccess = access,
  } = {},
) {
  const expectedIdentity = githubRepositoryIdentityFromRemote(
    `https://github.com/${String(repository || "").trim()}`,
  );
  if (!expectedIdentity) {
    return "";
  }

  for (const repoRoot of [...new Set(candidates.filter(Boolean))]) {
    try {
      await candidateAccess(repoRoot, constants.F_OK);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    try {
      const origin = await originReader(repoRoot);
      if (githubRepositoryIdentityFromRemote(origin) === expectedIdentity) {
        if (!worktree && !primary) {
          return repoRoot;
        }
        const selected = (await readWorktrees(repoRoot)).find(
          (candidate) => candidate.available && (worktree ? candidate.id === worktree : candidate.primary),
        );
        if (selected) {
          return selected.root;
        }
      }
    } catch (error) {
      if (repositoryCandidateCanBeSkipped(error)) {
        continue;
      }
      throw error;
    }
  }
  return "";
}

async function readOrigin(repoRoot) {
  const { stdout } = await runGit(repoRoot, ["remote", "get-url", "origin"]);
  return stdout;
}

function runGit(cwd, args) {
  return runExternalCommand("git", args, { cwd });
}

function repositoryCandidateCanBeSkipped(error) {
  if (externalCommandState(error) === "invalid_context") {
    return true;
  }
  return isExternalCommandExit(error, 2, 128)
    && /no such remote/i.test(externalCommandOutput(error));
}

function githubRepositoryFromRemote(remote) {
  const sshMatch = remote.match(/^git@github\.com:(?<owner>[^/]+)\/(?<name>.+)$/);
  if (sshMatch?.groups) {
    return normalizeGithubRepositoryMatch(sshMatch.groups);
  }

  try {
    const url = new URL(remote);
    if (url.hostname !== "github.com") {
      return null;
    }
    const [owner, name] = url.pathname.replace(/^\/+/, "").split("/");
    return normalizeGithubRepositoryMatch({ owner, name });
  } catch {
    return null;
  }
}

function normalizeGithubRepositoryMatch({ owner, name }) {
  if (!owner || !name) {
    return null;
  }
  return {
    owner,
    name: name.replace(/\.git$/, ""),
  };
}

const GITHUB_REPOSITORY_RENAME_ALIASES = new Map([
  ["mangofuture1210/git-leaf", "openglance/openglance"],
  ["mangofuture1210/openglance", "openglance/openglance"],
  [
    "mangofuture1210/git-leaf-example-knowledge-base",
    "openglance/openglance-example-knowledge-base",
  ],
  [
    "mangofuture1210/openglance-example-knowledge-base",
    "openglance/openglance-example-knowledge-base",
  ],
]);
