import assert from "node:assert/strict";
import test from "node:test";

import { publishOpenGlanceShareLink } from "../src/server/git-share-publish.mjs";

const REPO = {
  id: "docs-repo",
  root: "/repos/docs-repo",
  branch: "main",
};

test("share publication can retry a failed push after the document was committed", async () => {
  let dirty = true;
  let published = false;
  let syncCalls = 0;
  let publishCalls = 0;
  const shareLinkOptions = [];
  const createShareLink = async (options) => {
    shareLinkOptions.push(options);
    if (published) {
      return "https://gitleaf.mangofuture.com/share?v=1";
    }
    const error = new Error(dirty
      ? "当前文档还有未提交修改。"
      : "当前文档已经提交，但尚未发布到 origin/main。");
    error.code = dirty ? "document_not_committed" : "document_not_published";
    throw error;
  };
  const options = {
    repo: REPO,
    file: "docs/report.md",
    note: "Explain the report changes",
    createShareLink,
    readStatus: async () => ({
      changes: dirty
        ? [{ path: "docs/report.md", status: "modified", rawStatus: " M" }]
        : [],
    }),
    syncChanges: async (options) => {
      assert.equal(options.note, "Explain the report changes");
      syncCalls += 1;
      dirty = false;
      return {
        ok: false,
        step: "push",
        error: "远端暂时不可用。",
        agentPrompt: "retry push",
      };
    },
    publishBranch: async () => {
      publishCalls += 1;
      published = true;
      return {
        ok: true,
        publishedHead: "a".repeat(40),
      };
    },
  };

  const failed = await publishOpenGlanceShareLink(options);
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "push");
  assert.equal(failed.retryable, true);
  assert.equal(failed.error, "远端暂时不可用。");
  assert.match(failed.agentPrompt, /Please resolve this OpenGlance share publication failure/);
  assert.match(failed.agentPrompt, /Repository path: \/repos\/docs-repo/);
  assert.match(failed.agentPrompt, /Selected files:\n- docs\/report\.md/);
  assert.match(failed.agentPrompt, /Error output:\n远端暂时不可用。/);
  assert.match(failed.agentPrompt, /commit and push the current branch main/);

  const retried = await publishOpenGlanceShareLink(options);
  assert.equal(retried.ok, true);
  assert.equal(retried.published, true);
  assert.equal(retried.url, "https://gitleaf.mangofuture.com/share?v=1");
  assert.equal(syncCalls, 1);
  assert.equal(publishCalls, 1);
  assert.equal(shareLinkOptions.every((entry) => entry.language === "en"), true);
  assert.equal(shareLinkOptions.every((entry) => entry.repoRoot === REPO.root), true);
  assert.equal(shareLinkOptions.every((entry) => entry.file === "docs/report.md"), true);
});

test("share publication localizes its Agent prompt while preserving raw Git output", async () => {
  const rawGitOutput = "fatal: remote rejected refs/heads/main";
  const result = await publishOpenGlanceShareLink({
    repo: REPO,
    file: "docs/report.md",
    locale: "zh-CN",
    createShareLink: async (options) => {
      assert.equal(options.locale, "zh-CN");
      assert.equal(options.language, "zh-CN");
      const error = new Error("当前文档还有未提交修改。");
      error.code = "document_not_committed";
      throw error;
    },
    readStatus: async () => ({
      changes: [{ path: "docs/report.md", status: "modified", rawStatus: " M" }],
    }),
    syncChanges: async (options) => {
      assert.equal(options.locale, "zh-CN");
      return {
        ok: false,
        step: "push",
        error: rawGitOutput,
        agentPrompt: "unlocalized dependency prompt",
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, rawGitOutput);
  assert.match(result.agentPrompt, /请处理 OpenGlance 分享链接发布失败/);
  assert.match(result.agentPrompt, /仓库路径：\/repos\/docs-repo/);
  assert.match(result.agentPrompt, /选中文件：\n- docs\/report\.md/);
  assert.equal(result.agentPrompt.includes(`错误输出：\n${rawGitOutput}`), true);
  assert.match(result.agentPrompt, /提交并推送当前分支 main/);
  assert.doesNotMatch(result.agentPrompt, /unlocalized dependency prompt/);
});

test("share publication localizes fallback errors before and after publishing", async () => {
  const publishFailure = await publishOpenGlanceShareLink({
    repo: REPO,
    file: "docs/report.md",
    language: "zh-CN",
    createShareLink: async () => {
      const error = new Error("当前文档还有未提交修改。");
      error.code = "document_not_committed";
      throw error;
    },
    readStatus: async () => ({
      changes: [{ path: "docs/report.md", status: "modified", rawStatus: " M" }],
    }),
    syncChanges: async () => {
      throw null;
    },
  });
  assert.equal(publishFailure.error, "无法完成远端发布。");
  assert.match(publishFailure.agentPrompt, /错误输出：\n无法完成远端发布。/);

  let shareAttempts = 0;
  const verificationFailure = await publishOpenGlanceShareLink({
    repo: REPO,
    file: "docs/report.md",
    createShareLink: async () => {
      shareAttempts += 1;
      if (shareAttempts === 1) {
        const error = new Error("This document has not been published.");
        error.code = "document_not_published";
        throw error;
      }
      throw null;
    },
    readStatus: async () => ({ changes: [] }),
    publishBranch: async () => ({
      ok: true,
      publishedHead: "a".repeat(40),
    }),
  });
  assert.equal(
    verificationFailure.error,
    "A share link still could not be created after the remote publication.",
  );
  assert.match(verificationFailure.agentPrompt, /Failed step: verify publication/);
});
