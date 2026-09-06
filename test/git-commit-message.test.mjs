import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSyncCommitMessage } from "../src/server/git-commit-message.mjs";
import { runGitCommand } from "../src/server/git-sync.mjs";

async function fixture(t, source) {
  const root = await mkdtemp(path.join(tmpdir(), "openglance-commit-message-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args) => runGitCommand(root, args);
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Commit test"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(root, "document.md"), source);
  await git(["add", "-A"]);
  await git(["commit", "-m", "Initial"]);
  return {
    root, git,
    async stage(source, file = "document.md") {
      await writeFile(path.join(root, file), source);
      await git(["add", "-A"]);
    },
    message(options = {}) {
      return createSyncCommitMessage({
        repo: { root }, files: ["document.md"], changes: [],
        locale: "zh-CN", gitRunner: runGitCommand, ...options,
      });
    },
  };
}

const oldEntry = "  - changed: 2099-01-01\n    summary: 历史摘要\n";
function document(log, body = "正文") {
  return `---\ntitle: 发布指南\nchange_log:\n${log}---\n# 发布指南\n${body}\n`;
}

test("commit summary uses only staged changelog additions, regardless of their dates", async (t) => {
  const f = await fixture(t, document(oldEntry));
  await f.stage(document(`  - changed: 2000-01-01\n    summary: 补充发布前的检查步骤\n${oldEntry}`));
  await writeFile(path.join(f.root, "document.md"), document("  - summary: 尚未暂存的修改\n"));
  const message = await f.message();
  assert.equal(message.subject, "补充发布前的检查步骤");
  assert.equal(message.body, "- 发布指南: 补充发布前的检查步骤");
});

test("editing a summary includes the new text and supports folded YAML scalars", async (t) => {
  const f = await fixture(t, document(oldEntry));
  await f.stage(document("  - changed: 2099-01-01\n    summary: >-\n      更新发布步骤，\n      补充失败恢复。\n"));
  const message = await f.message();
  assert.equal(message.subject, "更新发布步骤， 补充失败恢复。");
});

test("ordinary body edits and reordered history use the document title", async (t) => {
  const otherEntry = "  - summary: 更早的历史\n";
  const f = await fixture(t, document(oldEntry + otherEntry));
  await f.stage(document(otherEntry + oldEntry, "更新了正文"));
  const message = await f.message();
  assert.equal(message.subject, "更新 发布指南");
  assert.equal(message.body, "- 更新 发布指南");
});

test("a rename does not treat retained history as a new summary", async (t) => {
  const f = await fixture(t, document(oldEntry));
  await rename(path.join(f.root, "document.md"), path.join(f.root, "renamed.md"));
  await f.git(["add", "-A"]);
  const message = await f.message({ files: ["document.md", "renamed.md"] });
  assert.equal(message.subject, "重命名 发布指南");
  assert.equal(message.body, "- 重命名 发布指南");
});

test("changing only a changelog date does not reuse its summary", async (t) => {
  const f = await fixture(t, document(oldEntry));
  await f.stage(document(oldEntry.replace("2099-01-01", "2100-01-01")));
  assert.equal((await f.message()).subject, "更新 发布指南");
});

test("multiple files share a concise directory scope while retaining readable document titles", async (t) => {
  const f = await fixture(t, "# Original\n");
  await mkdir(path.join(f.root, "publishing/notes"), { recursive: true });
  await mkdir(path.join(f.root, "publishing/drafts"), { recursive: true });
  await f.stage("# Release checks\n", "publishing/notes/checks.md");
  await f.stage("# Recovery steps\n", "publishing/drafts/recovery.md");
  const message = await f.message({ files: ["publishing/notes/checks.md", "publishing/drafts/recovery.md"] });
  assert.equal(message.subject, "publishing: 新增 2 个文件");
  assert.equal(message.body, "- 新增 Recovery steps\n- 新增 Release checks");
});

test("new documents with copied history use an add title, not a historical claim", async (t) => {
  const f = await fixture(t, "# Existing\n");
  await f.stage(document(oldEntry), "new.md");
  const message = await f.message({ files: ["new.md"] });
  assert.equal(message.subject, "新增 发布指南");
  assert.equal(message.body, "- 新增 发布指南");
});

test("mixed document and binary changes describe each operation without reading symlink targets", async (t) => {
  const f = await fixture(t, "# Guide\n");
  await writeFile(path.join(f.root, "document.md"), "# Guide\nUpdated\n");
  await writeFile(path.join(f.root, "image.png"), Buffer.from([0, 255, 1]));
  if (process.platform !== "win32") await symlink("document.md", path.join(f.root, "link.md"));
  await f.git(["add", "-A"]);
  const files = process.platform === "win32" ? ["document.md", "image.png"] : ["document.md", "image.png", "link.md"];
  const message = await f.message({ files, locale: "en" });
  assert.equal(message.subject, `Update 1 file; Add ${files.length - 1} ${files.length === 2 ? "file" : "files"}`);
  assert.ok(message.body.includes("- Update Guide"));
  assert.ok(message.body.includes("- Add image.png"));
  if (process.platform !== "win32") assert.ok(message.body.includes("- Add link.md"));
});

test("summary fields outside change_log and nested unrelated fields do not describe the edit", async (t) => {
  const source = "---\ntitle: Guide\nsummary: Old description\nchange_log:\n  - changed: today\n    details:\n      summary: Nested text\n---\n# Guide\n";
  const f = await fixture(t, source);
  await f.stage(source.replace("Old description", "New description").replace("Nested text", "New nested text"));
  assert.equal((await f.message({ locale: "en" })).subject, "Update Guide");
});

test("custom notes retain title and body without generated content or splitting Unicode characters", async () => {
  const message = await createSyncCommitMessage({
    note: "  完善发布说明\n\n补充验证步骤与恢复方式。  ",
    gitRunner: () => assert.fail("Custom notes do not need metadata reads"),
  });
  assert.deepEqual(message, { subject: "完善发布说明", body: "补充验证步骤与恢复方式。" });
  const long = "😀".repeat(80);
  const longMessage = await createSyncCommitMessage({ note: long });
  assert.equal([...longMessage.subject].length, 72);
  assert.equal(longMessage.body, long);
});

test("unavailable or oversized metadata falls back to filenames without blocking publication", async (t) => {
  const f = await fixture(t, "# Original\n");
  await f.stage(`# Large\n${"x".repeat(300 * 1024)}`);
  // Use the old readable title when only the new blob exceeds the size budget.
  assert.equal((await f.message({ locale: "en" })).subject, "Update Original");
  const message = await f.message({
    changes: [{ path: "document.md", status: "modified" }],
    gitRunner: async () => { throw new Error("Unavailable metadata"); },
  });
  assert.equal(message.subject, "更新 document.md");
});
