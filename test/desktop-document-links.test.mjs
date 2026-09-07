import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { parseDesktopArgs } from "../src/desktop/args.mjs";
import { openGlanceDeepLinkUrl } from "../src/desktop/deep-link.mjs";
import { startDesktopOpenGlanceServer } from "../src/desktop/server.mjs";
import { startupRepositoryErrorMessage } from "../src/desktop/repository-errors.mjs";
import { findGithubRepositoryRoot } from "../src/server/repositories.mjs";
import { worktreeIdForPath } from "../src/server/git-worktrees.mjs";
import { sharedMainWorktree } from "../src/server/git-share-open.mjs";
import { runExternalCommand } from "../src/server/external-command.mjs";

const execFileAsync = promisify(execFile);
const repository = "exampleorg/document-links";
const file = "docs/published.md";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "openglance-document-links-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const primary = path.join(root, "primary");
  const linked = path.join(root, "task");
  await mkdir(primary);
  const git = (args) => execFileAsync("git", args, { cwd: primary });
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "OpenGlance Tests"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(primary, "README.md"), "# Original\n");
  await git(["add", "."]);
  await git(["commit", "-m", "Initial"]);
  await git(["remote", "add", "origin", `https://github.com/${repository}.git`]);
  await git(["worktree", "add", "-b", "task", linked]);
  await writeFile(path.join(linked, "README.md"), "# Uncommitted task work\n");
  await mkdir(path.join(primary, "docs"));
  await writeFile(path.join(primary, file), "# Published document\n");
  await git(["add", "."]);
  await git(["commit", "-m", "Publish"]);
  return { root, primary, linked, git };
}

function request(target = {}) {
  return parseDesktopArgs([openGlanceDeepLinkUrl({ repository, file, ...target })]);
}

async function openDocument(options, candidates) {
  const repoRoot = options.repoRoot || await findGithubRepositoryRoot(options.repository, candidates, {
    worktree: options.worktree,
    primary: true,
  });
  const desktop = await startDesktopOpenGlanceServer({ repoRoot, initialFilePath: options.file, port: 0 });
  const response = await fetch(new URL(`/api/document?file=${encodeURIComponent(options.file)}`, desktop.url));
  return { desktop, response };
}

test("ordinary desktop links open the primary document regardless of the active old worktree", async (t) => {
  const { primary, linked } = await fixture(t);
  for (const candidates of [[linked, primary], [primary, linked], [linked]]) {
    const { desktop, response } = await openDocument(request(), candidates);
    try {
      assert.equal(desktop.repoRoot, primary);
      assert.equal(response.status, 200);
      assert.match((await response.json()).html, /Published document/);
    } finally {
      await desktop.close();
    }
  }
});

test("ordinary links skip a removed remembered worktree and still open the primary checkout", async (t) => {
  const { primary, linked, git } = await fixture(t);
  const worktree = worktreeIdForPath(linked);
  await git(["worktree", "remove", "--force", linked]);
  const { desktop, response } = await openDocument(request(), [linked, primary]);
  try {
    assert.equal(desktop.repoRoot, primary);
    assert.equal(response.status, 200);
  } finally {
    await desktop.close();
  }
  assert.equal(await findGithubRepositoryRoot(repository, [linked, primary], { worktree, primary: true }), "");
});

test("explicit worktree and local-path requests keep their exact checkout even if only primary has the document", async (t) => {
  const { primary, linked } = await fixture(t);
  for (const options of [request({ worktree: worktreeIdForPath(linked) }), parseDesktopArgs([`--repo=${linked}`, `--file=${file}`])]) {
    const { desktop, response } = await openDocument(options, [primary, linked]);
    try {
      assert.equal(desktop.repoRoot, linked);
      assert.equal(response.ok, false);
      const existing = await fetch(new URL("/api/document?file=README.md", desktop.url));
      assert.match((await existing.json()).html, /Uncommitted task work/);
    } finally {
      await desktop.close();
    }
  }
});

test("a missing ordinary-link document keeps primary navigation available and does not search other worktrees", async (t) => {
  const { primary, linked } = await fixture(t);
  await writeFile(path.join(linked, "task-only.md"), "# Only in task\n");
  for (const missing of ["missing.md", "task-only.md"]) {
    const { desktop, response } = await openDocument(request({ file: missing }), [linked, primary]);
    try {
      assert.equal(desktop.repoRoot, primary);
      assert.equal(response.ok, false);
      const tree = await fetch(new URL("/api/tree", desktop.url));
      assert.equal(tree.status, 200);
      assert.equal((await fetch(new URL("/api/document?file=README.md", desktop.url))).status, 200);
    } finally {
      await desktop.close();
    }
  }
});

test("primary resolution never substitutes an available linked checkout when the primary is unavailable", async () => {
  assert.equal(await findGithubRepositoryRoot(repository, ["/task"], {
    primary: true,
    candidateAccess: async () => {},
    originReader: async () => `https://github.com/${repository}`,
    readWorktrees: async () => [
      { primary: true, root: "/removed", available: false },
      { primary: false, root: "/task", available: true },
    ],
  }), "");
});

test("shared links retain identity discovery followed by the stricter primary-main gate", async (t) => {
  const { primary, linked, git } = await fixture(t);
  const match = await findGithubRepositoryRoot(repository, [linked, primary]);
  assert.equal(match, linked);
  assert.equal((await sharedMainWorktree(match)).primary.root, primary);
  await git(["switch", "-c", "review"]);
  assert.equal((await sharedMainWorktree(match)).state, "primary_not_main");
  // Ordinary /open reads the primary checkout without changing its branch.
  assert.equal(await findGithubRepositoryRoot(repository, [linked], { primary: true }), primary);
});

test("an actual missing Git executable remains an environment error during link discovery", async (t) => {
  const { root, primary } = await fixture(t);
  const emptyPath = path.join(root, "empty-path");
  await mkdir(emptyPath);
  await assert.rejects(findGithubRepositoryRoot(repository, [primary], {
    primary: true,
    originReader: (cwd) => runExternalCommand("git", ["remote", "get-url", "origin"], { cwd, env: { PATH: emptyPath } }),
  }), (error) => {
    assert.equal(error.externalCommandState, "unavailable");
    assert.match(startupRepositoryErrorMessage(primary, error), /cannot find the local Git command/);
    assert.match(startupRepositoryErrorMessage(primary, error, { language: "zh-CN" }), /找不到本机 Git/);
    return true;
  });
});
