import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitSyncAgentPrompt,
  createGitSyncGuard,
  publishCurrentBranch,
  repositoryChangesFromPorcelain,
  syncSelectedFiles as syncSelectedFilesImpl,
  syncStateDriftKind,
} from "../src/server/git-sync.mjs";

const REPO = { id: "docs-repo", root: "/repo/docs-repo", branch: "main" };
const TEST_HEAD = "a".repeat(40);

function stableSyncGuard() {
  return {
    capture: async () => ({ head: TEST_HEAD, fingerprint: "stable" }),
    currentHead: async () => TEST_HEAD,
    isWorktreeClean: async () => true,
  };
}

function syncSelectedFiles(options) {
  return syncSelectedFilesImpl({
    syncGuard: stableSyncGuard(),
    ...options,
  });
}

function successfulPreflight(args) {
  const command = args.join(" ");
  if (command === "config --get user.name") return { stdout: "Jane\n", stderr: "" };
  if (command === "config --get user.email") return { stdout: "jane@example.com\n", stderr: "" };
  if (command === "remote get-url origin") {
    return { stdout: "git@github.com:example-org/docs-repo.git\n", stderr: "" };
  }
  return null;
}

test("repositoryChangesFromPorcelain returns every Git file change", () => {
  const changes = repositoryChangesFromPorcelain([
    " M docs/changed.md",
    "A  docs/new.mdx",
    "?? public/app.js",
    " D assets/slides.pptx",
    "R  docs/new name.md",
    "docs/old name.md",
    "C  docs/copied.md",
    "docs/source.md",
    "",
  ].join("\0"));

  assert.deepEqual(changes, [
    { path: "docs/changed.md", status: "modified", rawStatus: " M" },
    { path: "docs/new.mdx", status: "added", rawStatus: "A " },
    { path: "public/app.js", status: "untracked", rawStatus: "??" },
    { path: "assets/slides.pptx", status: "deleted", rawStatus: " D" },
    {
      path: "docs/new name.md",
      oldPath: "docs/old name.md",
      status: "renamed",
      rawStatus: "R ",
    },
    {
      path: "docs/copied.md",
      oldPath: "docs/source.md",
      status: "copied",
      rawStatus: "C ",
    },
  ]);
});

test("buildGitSyncAgentPrompt localizes instructions without rewriting repository details", () => {
  const repo = {
    id: "知识库",
    root: "/repo/公司资料",
    branch: "feature/同步",
  };
  const files = ["docs/说明.md", "assets/example.png"];
  const error = "fatal: Updates were rejected for refs/heads/feature/同步";
  const english = buildGitSyncAgentPrompt({
    repo,
    files,
    step: "push",
    error,
  });
  const chinese = buildGitSyncAgentPrompt({
    repo,
    files,
    step: "push",
    error,
    language: "zh-Hans",
  });

  assert.match(english, /^Please resolve this OpenGlance sync failure:/);
  assert.match(english, /Repository path: \/repo\/公司资料/);
  assert.match(english, /Current branch: feature\/同步/);
  assert.match(english, /Selected files:\n- docs\/说明\.md\n- assets\/example\.png/);
  assert.match(english, /fatal: Updates were rejected for refs\/heads\/feature\/同步/);
  assert.match(english, /commit and push the current branch feature\/同步/);

  assert.match(chinese, /^请处理 OpenGlance 同步失败：/);
  assert.match(chinese, /仓库路径：\/repo\/公司资料/);
  assert.match(chinese, /当前分支：feature\/同步/);
  assert.match(chinese, /选中文件：\n- docs\/说明\.md\n- assets\/example\.png/);
  assert.match(chinese, /fatal: Updates were rejected for refs\/heads\/feature\/同步/);
  assert.match(chinese, /提交并推送当前分支 feature\/同步/);
});

test("syncSelectedFiles localizes structured failure copy and preserves raw Git output", async () => {
  const rawStderr = "fatal: permission denied for /repo/公司资料";
  const result = await syncSelectedFiles({
    repo: {
      id: "知识库",
      root: "/repo/公司资料",
      branch: "feature/同步",
    },
    files: ["docs/说明.md"],
    locale: "zh-CN",
    gitRunner: async () => {
      const error = new Error("spawn git EACCES");
      error.code = "EACCES";
      error.stderr = rawStderr;
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.resultTitle, "同步遇到异常");
  assert.equal(result.resultHelp, "点击复制提示词，然后粘贴到你选择的 AI Agent 中继续处理。");
  assert.match(result.error, /^Git 命令或仓库访问被拒绝/);
  assert.match(result.error, new RegExp(rawStderr.replaceAll("/", "\\/")));
  assert.match(result.agentPrompt, /仓库路径：\/repo\/公司资料/);
  assert.match(result.agentPrompt, /当前分支：feature\/同步/);
  assert.match(result.agentPrompt, /- docs\/说明\.md/);
  assert.match(result.agentPrompt, /fatal: permission denied for \/repo\/公司资料/);
});

test("validation failures default to English and do not create an Agent prompt", async () => {
  const result = await syncSelectedFiles({
    repo: REPO,
    files: [],
    gitRunner: async () => {
      assert.fail("Git must not run without a selected file");
    },
  });

  assert.equal(result.error, "Select at least one file to sync.");
  assert.equal(result.resultTitle, "Sync encountered a problem");
  assert.equal(
    result.resultHelp,
    "Copy the prompt and paste it into the AI Agent of your choice.",
  );
  assert.equal(result.agentPrompt, "");
});

test("syncSelectedFiles fetches first, commits every selected file type, rebases, and pushes", async () => {
  const calls = [];
  const files = ["docs/changed.md", "assets/slides.pptx"];
  const result = await syncSelectedFiles({
    repo: REPO,
    files,
    note: "补充发布说明",
    gitRunner: async (cwd, args) => {
      calls.push({ cwd, args });
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M docs/changed.md\0 M assets/slides.pptx\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t1\n", stderr: "" };
      if (args[0] === "diff") return { stdout: files.join("\0") + "\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.files, files);
  assert.deepEqual(calls.map((call) => call.args), [
    ["config", "--get", "user.name"],
    ["config", "--get", "user.email"],
    ["remote", "get-url", "origin"],
    ["ls-files", "--unmerged", "-z"],
    ["rev-parse", "-q", "--verify", "MERGE_HEAD"],
    ["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"],
    ["rev-parse", "-q", "--verify", "REVERT_HEAD"],
    ["rev-parse", "--git-path", "rebase-merge"],
    ["rev-parse", "--git-path", "rebase-apply"],
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ["fetch", "origin", "main"],
    ["rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main"],
    ["add", "-A", "--", ...files],
    ["diff", "--cached", "--name-only", "-z", "--", ...files],
    [
      "commit",
      "-m",
      "补充发布说明",
      "--",
      ...files,
    ],
    ["rebase", "refs/remotes/origin/main"],
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
  assert.equal(calls.every((call) => call.cwd === REPO.root), true);
});

test("syncSelectedFiles skips rebase when the fetched remote is not ahead", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["public/app.js"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M public/app.js\0 M docs/unselected.md\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "public/app.js\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.some((args) => args[0] === "rebase"), false);
  assert.deepEqual(calls.slice(-3), [
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
});

test("syncSelectedFiles does not report success until origin contains the published commit", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M docs/changed.md\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      if (args[0] === "merge-base") {
        const error = new Error("published commit is missing from origin/main");
        error.code = 1;
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "verify publication");
  assert.match(result.error, /origin\/main/);
  assert.deepEqual(calls.slice(-3), [
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
});

test("syncSelectedFiles blocks before staging when remote updates meet unselected local changes", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M docs/changed.md\0 M assets/image.png\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t2\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "validate");
  assert.match(result.error, /some local changes are not selected/);
  assert.match(result.error, /assets\/image\.png/);
  assert.equal(calls.some((args) => args[0] === "add"), false);
  assert.equal(calls.some((args) => args[0] === "commit"), false);
});

test("syncSelectedFiles blocks a diverged branch before staging", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "2\t3\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "compare remote");
  assert.match(result.error, /has diverged/);
  assert.equal(calls.some((args) => args[0] === "add"), false);
});

test("syncSelectedFiles stops when a successful Git comparison has invalid output", async () => {
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "unexpected\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "compare remote");
  assert.match(result.error, /could not recognize/);
});

test("syncSelectedFiles returns an all-file Agent prompt when rebase fails", async () => {
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t1\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      if (args[0] === "rebase" && args[1] !== "--abort") {
        const error = new Error("rebase failed");
        error.stderr = "CONFLICT (content): Merge conflict in docs/changed.md";
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "rebase remote");
  assert.match(result.error, /CONFLICT/);
  assert.match(result.error, /exited the failed rebase automatically/);
  assert.match(result.agentPrompt, /Selected files:\n- docs\/changed\.md/);
  assert.match(result.agentPrompt, /Preserve the OpenGlance user's changes/);
});

test("syncSelectedFiles refuses unresolved conflicts and in-progress Git operations", async () => {
  const conflicts = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args[0] === "ls-files") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(conflicts.step, "preflight");
  assert.match(conflicts.error, /unresolved conflicts/);

  const rebase = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    operationPathExists: async (filePath) => filePath.endsWith("rebase-merge"),
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.join(" ") === "rev-parse --git-path rebase-merge") {
        return { stdout: ".git/rebase-merge\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(rebase.step, "preflight");
  assert.match(rebase.error, /rebase operation is in progress/);
});

test("syncSelectedFiles publishes a branch without an upstream", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: { ...REPO, branch: "openglance/detached-1234567" },
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) throw expectedGitExit(128, "fatal: no upstream configured for branch");
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.slice(-4), [[
    "push",
    "origin",
    `${TEST_HEAD}:refs/heads/openglance/detached-1234567`,
  ], [
    "fetch",
    "origin",
    "openglance/detached-1234567",
  ], [
    "merge-base",
    "--is-ancestor",
    TEST_HEAD,
    "refs/remotes/origin/openglance/detached-1234567",
  ], [
    "branch",
    "--set-upstream-to=origin/openglance/detached-1234567",
    "--",
    "openglance/detached-1234567",
  ]]);
});

test("publishCurrentBranch retries an already committed main and verifies origin", async () => {
  const calls = [];
  const result = await publishCurrentBranch({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: "", stderr: "" };
      if (args.join(" ") === "rev-parse --verify HEAD") {
        return { stdout: `${TEST_HEAD}\n`, stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "1\t0\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.publishedHead, TEST_HEAD);
  assert.deepEqual(calls.slice(-5), [
    ["fetch", "origin", "main"],
    ["rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main"],
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
});

test("publishCurrentBranch accepts the language alias for localized failure copy", async () => {
  const result = await publishCurrentBranch({
    repo: REPO,
    files: ["docs/changed.md"],
    language: "zh-Hans",
    operationPathExists: async () => false,
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args[0] === "status") {
        return { stdout: " M docs/changed.md\0", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "当前仍有未提交的本地改动，请先完成同步后再发布。");
  assert.equal(result.resultTitle, "同步遇到异常");
  assert.match(result.agentPrompt, /^请处理 OpenGlance 同步失败：/);
  assert.match(result.agentPrompt, /当前分支：main/);
});

test("syncSelectedFiles checks Git identity before staging files", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      if (args.join(" ") === "config --get user.name") return { stdout: "Jane\n", stderr: "" };
      throw expectedGitExit(1, "");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "preflight");
  assert.match(result.error, /Git user.email/);
  assert.deepEqual(calls.map((args) => args.join(" ")), [
    "config --get user.name",
    "config --get user.email",
  ]);
});

test("syncSelectedFiles checks origin remote before staging files", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight && args[0] !== "remote") return preflight;
      throw expectedGitExit(2, "fatal: No such remote 'origin'");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "preflight");
  assert.match(result.error, /origin/);
  assert.deepEqual(calls.map((args) => args.join(" ")), [
    "config --get user.name",
    "config --get user.email",
    "remote get-url origin",
  ]);
});

test("syncSelectedFiles rejects unsafe paths but accepts code and binary paths", async () => {
  let called = false;
  const unsafe = await syncSelectedFiles({
    repo: REPO,
    files: ["../secret.md", "docs/../secret.md", ".git/config"],
    gitRunner: async () => {
      called = true;
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(called, false);
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error, /Select at least one file to sync/);

  const selected = ["public/app.js", "assets/slides.pptx"];
  const accepted = await syncSelectedFiles({
    repo: { ...REPO, branch: "feature" },
    files: selected,
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) throw expectedGitExit(128, "fatal: no upstream configured for branch");
      if (args[0] === "status") {
        return { stdout: " M public/app.js\0 M assets/slides.pptx\0", stderr: "" };
      }
      if (args[0] === "diff") return { stdout: selected.join("\0") + "\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(accepted.ok, true);
});

test("syncSelectedFiles does not turn a missing Git command into missing config", async () => {
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async () => {
      const error = new Error("spawn git ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.equal(result.step, "preflight");
  assert.match(result.error, /spawn git ENOENT/);
  assert.doesNotMatch(result.error, /user\.name is not configured/);
});

test("syncSelectedFiles does not turn dependency failures into absent operation refs or upstream", async () => {
  for (const failingCommand of ["MERGE_HEAD", "@{upstream}"]) {
    const result = await syncSelectedFiles({
      repo: REPO,
      files: ["docs/changed.md"],
      gitRunner: async (_cwd, args) => {
        const preflight = successfulPreflight(args);
        if (preflight) return preflight;
        if (args.at(-1) === failingCommand) {
          const error = new Error("spawn git EACCES");
          error.code = "EACCES";
          throw error;
        }
        if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /spawn git EACCES/);
  }
});

test("syncStateDriftKind distinguishes branch movement from content drift", () => {
  assert.equal(syncStateDriftKind(
    { head: TEST_HEAD, fingerprint: "before" },
    { head: "b".repeat(40), fingerprint: "before" },
  ), "head_changed");
  assert.equal(syncStateDriftKind(
    { head: TEST_HEAD, fingerprint: "before" },
    { head: TEST_HEAD, fingerprint: "after" },
  ), "content_changed");
  assert.equal(syncStateDriftKind(
    { head: TEST_HEAD, fingerprint: "same" },
    { head: TEST_HEAD, fingerprint: "same" },
  ), "none");
});

test("syncSelectedFiles retries preparation once when content changes during fetch", async () => {
  const captures = [
    { head: TEST_HEAD, fingerprint: "first" },
    { head: TEST_HEAD, fingerprint: "changed" },
    { head: TEST_HEAD, fingerprint: "stable" },
    { head: TEST_HEAD, fingerprint: "stable" },
  ];
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    files: ["docs/changed.md"],
    syncGuard: {
      capture: async () => captures.shift(),
      currentHead: async () => TEST_HEAD,
      isWorktreeClean: async () => true,
    },
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.retryCount, 1);
  assert.equal(result.driftKind, "content_changed");
  assert.equal(calls.filter((args) => args[0] === "fetch").length, 3);
  assert.equal(calls.filter((args) => args[0] === "commit").length, 1);
});

test("all-change sync commits the frozen index instead of rereading worktree paths", async () => {
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    allChanges: true,
    syncGuard: stableSyncGuard(),
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  const commitArgs = calls.find((args) => args[0] === "commit");
  assert.ok(commitArgs);
  assert.equal(commitArgs.includes("--"), false);
  assert.equal(commitArgs.includes("docs/changed.md"), false);
});

test("syncSelectedFiles stops before staging when the workspace changes twice", async () => {
  const captures = [
    { head: TEST_HEAD, fingerprint: "one" },
    { head: TEST_HEAD, fingerprint: "two" },
    { head: TEST_HEAD, fingerprint: "three" },
    { head: TEST_HEAD, fingerprint: "four" },
  ];
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    files: ["docs/changed.md"],
    syncGuard: {
      capture: async () => captures.shift(),
      currentHead: async () => TEST_HEAD,
      isWorktreeClean: async () => true,
    },
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "workspace changed");
  assert.equal(result.retryCount, 1);
  assert.equal(result.driftKind, "content_changed");
  assert.equal(calls.some((args) => args[0] === "add"), false);
});

test("syncSelectedFiles never rebases a worktree that changed after commit", async () => {
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    files: ["docs/changed.md"],
    syncGuard: {
      capture: async () => ({ head: TEST_HEAD, fingerprint: "stable" }),
      currentHead: async () => TEST_HEAD,
      isWorktreeClean: async () => false,
    },
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t1\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "workspace changed");
  assert.equal(result.driftKind, "post_commit_changed");
  assert.equal(calls.some((args) => args[0] === "rebase"), false);
  assert.equal(calls.some((args) => args[0] === "push"), false);
});

test("createGitSyncGuard fingerprints status, tracked diffs, and untracked content", async () => {
  const calls = [];
  const guard = createGitSyncGuard({
    repo: REPO,
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      if (args.join(" ") === "rev-parse --verify HEAD") return { stdout: `${TEST_HEAD}\n`, stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0?? assets/new.png\0", stderr: "" };
      if (args[0] === "diff") return { stdout: "binary patch", stderr: "" };
      if (args[0] === "hash-object") return { stdout: `${"b".repeat(40)}\n`, stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  const first = await guard.capture({
    changes: [
      { path: "docs/changed.md", status: "modified", rawStatus: " M" },
      { path: "assets/new.png", status: "untracked", rawStatus: "??" },
    ],
    files: ["docs/changed.md", "assets/new.png"],
  });
  const second = await guard.capture({
    changes: [
      { path: "docs/changed.md", status: "modified", rawStatus: " M" },
      { path: "assets/new.png", status: "untracked", rawStatus: "??" },
    ],
    files: ["docs/changed.md", "assets/new.png"],
  });

  assert.equal(first.head, TEST_HEAD);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(calls.some((args) => args[0] === "hash-object" && args.at(-1) === "assets/new.png"), true);
});

function expectedGitExit(code, stderr) {
  const error = new Error(stderr || `git exited with code ${code}`);
  error.code = code;
  error.stderr = stderr;
  return error;
}
