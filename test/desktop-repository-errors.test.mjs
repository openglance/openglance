import assert from "node:assert/strict";
import test from "node:test";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  repositorySelectionErrorMessage,
  startupRepositoryErrorMessage,
} from "../src/desktop/repository-errors.mjs";
import { GitRepositoryNotFoundError } from "../src/server/git-errors.mjs";

test("a filesystem ENOENT explains the missing path instead of reporting Git unavailable", async () => {
  const file = path.join(tmpdir(), `openglance-missing-${randomUUID()}.md`);
  const error = await lstat(file).catch((failure) => failure);
  for (const format of [repositorySelectionErrorMessage, startupRepositoryErrorMessage]) {
    assert.match(format("/repo", error), /requested file or folder no longer exists/);
    assert.match(format("/repo", error, { language: "zh-CN" }), /文件或目录已不存在/);
  }
});

test("repository selection defaults to English for non-Git directories", () => {
  const message = repositorySelectionErrorMessage(
    "/Users/example/Documents",
    new GitRepositoryNotFoundError("/Users/example/Documents"),
  );

  assert.equal(message, [
    "Could not open this folder: /Users/example/Documents",
    "This folder is not inside a Git repository.",
    "Choose a Git repository folder or any folder inside one.",
  ].join("\n"));
  assert.doesNotMatch(message, /Could not find|Command failed|升级 Git|旧版 OpenGlance/);
});

test("repository selection accepts language and locale options for Chinese", () => {
  const error = new GitRepositoryNotFoundError("/Users/example/Documents");
  const expected = [
    "无法打开这个目录：/Users/example/Documents",
    "这个目录不在 Git 仓库中。",
    "请选择 Git 仓库目录，或仓库中的任意子目录。",
  ].join("\n");

  assert.equal(
    repositorySelectionErrorMessage(
      "/Users/example/Documents",
      error,
      { language: "zh-CN" },
    ),
    expected,
  );
  assert.equal(
    repositorySelectionErrorMessage(
      "/Users/example/Documents",
      error,
      { locale: "zh-Hans-CN" },
    ),
    expected,
  );
});

test("repository selection keeps unexpected Git failures concise", () => {
  const error = new Error([
    "Command failed: git worktree list --porcelain -z",
    "fatal: repository metadata is corrupt",
    "usage: git worktree list [<options>]",
  ].join("\n"));
  const message = repositorySelectionErrorMessage("/Users/example/repo", error);

  assert.match(message, /OpenGlance encountered a problem while reading this repository\./);
  assert.match(message, /Technical information: fatal: repository metadata is corrupt/);
  assert.doesNotMatch(message, /请选择 Git 仓库目录|usage:|升级 Git|旧版 OpenGlance/);

  const chinese = repositorySelectionErrorMessage(
    "/Users/example/repo",
    error,
    { language: "zh-CN" },
  );
  assert.match(chinese, /OpenGlance 读取这个仓库时遇到问题。/);
  assert.match(chinese, /技术信息：fatal: repository metadata is corrupt/);
});

test("startup repository errors distinguish a missing repository", () => {
  const message = startupRepositoryErrorMessage(
    "/Users/example/removed-repo",
    new GitRepositoryNotFoundError("/Users/example/removed-repo"),
  );

  assert.equal(message, [
    "The previously opened repository is unavailable: /Users/example/removed-repo",
    "This folder is no longer inside a Git repository. Choose another local Git repository.",
  ].join("\n"));

  const chinese = startupRepositoryErrorMessage(
    "/Users/example/removed-repo",
    new GitRepositoryNotFoundError("/Users/example/removed-repo"),
    { language: "zh-CN" },
  );
  assert.equal(chinese, [
    "上次打开的仓库已不可用：/Users/example/removed-repo",
    "这个目录已经不在 Git 仓库中，请重新选择一个本地 Git 仓库。",
  ].join("\n"));
});

test("repository selection explains each actionable command dependency state", () => {
  const cases = [
    ["ENOENT", "cannot find the local Git command"],
    ["EACCES", "does not have permission to run Git or read this folder"],
  ];
  for (const [code, expected] of cases) {
    const error = new Error(`spawn git ${code}`);
    error.code = code;
    assert.match(repositorySelectionErrorMessage("/repo", error), new RegExp(expected));
  }

  const unsupported = new Error("git failed");
  unsupported.code = 129;
  unsupported.stderr = "error: unknown option `example'";
  assert.match(
    repositorySelectionErrorMessage("/repo", unsupported),
    /does not support the command capability/,
  );

  const invalidOutput = new Error("empty output");
  invalidOutput.externalCommandState = "invalid_output";
  assert.match(
    repositorySelectionErrorMessage("/repo", invalidOutput),
    /Git returned a result that OpenGlance could not recognize/,
  );
});

test("repository error localization preserves paths and technical details", () => {
  const path = "/tmp/资料/{repo}";
  const error = new Error("fatal: raw detail {unchanged}");
  const english = repositorySelectionErrorMessage(path, error, { language: "fr-FR" });
  const chinese = repositorySelectionErrorMessage(path, error, { language: "zh-CN" });

  assert.match(english, /Could not open this folder: \/tmp\/资料\/\{repo\}/);
  assert.match(english, /Technical information: fatal: raw detail \{unchanged\}/);
  assert.match(chinese, /无法打开这个目录：\/tmp\/资料\/\{repo\}/);
  assert.match(chinese, /技术信息：fatal: raw detail \{unchanged\}/);
});
