import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createOpenGlanceOpenLink as createCanonicalOpenLink,
} from "../src/server/openglance-open-link.mjs";
import {
  createOpenGlanceOpenLink,
  githubRepositoryIdentityFromRemote,
  normalizeMarkdownPath,
  parseGitWorktreeRoots,
  worktreeIdForPath,
} from "../tools/generate-openglance-open-link.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL("../tools/generate-openglance-open-link.mjs", import.meta.url),
);

test("portable link tool supports common GitHub origin formats", () => {
  assert.equal(
    githubRepositoryIdentityFromRemote("git@github.com:ExampleOrg/shared-context.git"),
    "exampleorg/shared-context",
  );
  assert.equal(
    githubRepositoryIdentityFromRemote("https://person@github.com/ExampleOrg/shared-context"),
    "exampleorg/shared-context",
  );
  assert.equal(githubRepositoryIdentityFromRemote("https://example.com/acme/docs.git"), "");
});

test("portable link tool accepts only repository-relative Markdown and MDX paths", () => {
  assert.equal(normalizeMarkdownPath("docs\\guides\\preview.mdx"), "docs/guides/preview.mdx");
  assert.throws(() => normalizeMarkdownPath("../outside.md"), /repository-relative/);
  assert.throws(() => normalizeMarkdownPath("docs/report.pdf"), /repository-relative/);
});

test("portable link tool parses null- and newline-delimited worktree records", () => {
  const fields = [
    "worktree /repos/shared-context",
    "HEAD 1111111",
    "branch refs/heads/main",
    "",
    "worktree /repos/shared-context-task",
    "HEAD 2222222",
    "branch refs/heads/task",
    "",
  ];
  assert.deepEqual(parseGitWorktreeRoots(fields.join("\0")), [
    "/repos/shared-context",
    "/repos/shared-context-task",
  ]);
  assert.deepEqual(parseGitWorktreeRoots(fields.join("\n")), [
    "/repos/shared-context",
    "/repos/shared-context-task",
  ]);
  assert.deepEqual(parseGitWorktreeRoots(fields.join("\r\n")), [
    "/repos/shared-context",
    "/repos/shared-context-task",
  ]);
});

test("portable link tool matches OpenGlance for primary and linked worktrees", async (t) => {
  const fixture = await createRepositoryFixture(t);
  const expectedPrimaryLink =
    "https://gitleaf.mangofuture.com/open?repo=exampleorg%2Fshared-context&path=docs%2Freport.md&title=Report";

  assert.equal(
    await createOpenGlanceOpenLink({ repoRoot: fixture.primaryRoot, file: "docs/report.md" }),
    expectedPrimaryLink,
  );
  assert.equal(
    await createCanonicalOpenLink({ repoRoot: fixture.primaryRoot, file: "docs/report.md" }),
    expectedPrimaryLink,
  );

  const linkedRoot = await realpath(fixture.linkedRoot);
  const expectedLinkedLink =
    `${expectedPrimaryLink.replace("&title=Report", "")}&worktree=${worktreeIdForPath(linkedRoot)}&title=Report`;
  assert.equal(
    await createOpenGlanceOpenLink({ repoRoot: fixture.linkedRoot, file: "docs/report.md" }),
    expectedLinkedLink,
  );
  assert.equal(
    await createCanonicalOpenLink({ repoRoot: fixture.linkedRoot, file: "docs/report.md" }),
    expectedLinkedLink,
  );

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--repo-root",
    fixture.linkedRoot,
    "--file",
    "docs/report.md",
  ]);
  assert.equal(stdout.trim(), expectedLinkedLink);
});

async function createRepositoryFixture(t) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "openglance-open-link-tool-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  const primaryRoot = path.join(fixtureRoot, "shared-context");
  const linkedRoot = path.join(fixtureRoot, "shared-context-task");
  await mkdir(path.join(primaryRoot, "docs"), { recursive: true });
  await runGit(primaryRoot, ["init", "-q", "-b", "main"]);
  await runGit(primaryRoot, ["config", "user.name", "Test User"]);
  await runGit(primaryRoot, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(primaryRoot, "docs", "report.md"), "# Report\n");
  await runGit(primaryRoot, ["add", "docs/report.md"]);
  await runGit(primaryRoot, ["commit", "-q", "-m", "initial"]);
  await runGit(primaryRoot, [
    "remote",
    "add",
    "origin",
    "https://github.com/ExampleOrg/shared-context.git",
  ]);
  await runGit(primaryRoot, ["worktree", "add", "-q", "-b", "task", linkedRoot]);

  return { primaryRoot, linkedRoot };
}

async function runGit(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

test("both link generators expose only the bounded title and support omitting it", async (t) => {
  const fixture = await createRepositoryFixture(t);
  for (const source of [
    '---\ntitle: "团队 & 计划"\nai_snippet: PRIVATE_SUMMARY\n---\n# Old heading\nPRIVATE_BODY',
    '# **Release** [guide](https://example.com)\nPRIVATE_BODY',
    `---\ntitle: ${"长".repeat(140)}\n---\nPRIVATE_BODY`,
    '---\ntitle: >\n  PRIVATE_SUMMARY\n---\n# Fallback heading\nPRIVATE_BODY',
  ]) {
    await writeFile(path.join(fixture.primaryRoot, "docs/report.md"), source);
    const links = await Promise.all([createOpenGlanceOpenLink, createCanonicalOpenLink].map(
      (generate) => generate({ repoRoot: fixture.primaryRoot, file: "docs/report.md" }),
    ));
    assert.equal(links[0], links[1]);
    const url = new URL(links[0]);
    assert.ok(url.searchParams.get("title").length <= 100);
    assert.doesNotMatch(decodeURIComponent(links[0]), /PRIVATE_BODY|PRIVATE_SUMMARY/);
    for (const generate of [createOpenGlanceOpenLink, createCanonicalOpenLink]) {
      const omitted = new URL(await generate({ repoRoot: fixture.primaryRoot, file: "docs/report.md", previewTitle: false }));
      assert.equal(omitted.searchParams.has("title"), false);
      assert.equal(omitted.searchParams.get("path"), "docs/report.md");
    }
  }
  const result = await execFileAsync(process.execPath, [scriptPath, "--repo-root", fixture.primaryRoot, "--file", "docs/report.md", "--no-preview-title"]);
  assert.equal(new URL(result.stdout.trim()).searchParams.has("title"), false);
});

test("link previews never read titles outside the repository or require a present document", async (t) => {
  const fixture = await createRepositoryFixture(t);
  const outside = path.join(path.dirname(fixture.primaryRoot), "outside.md");
  await writeFile(outside, "# PRIVATE_OUTSIDE_TITLE\n");
  await symlink(outside, path.join(fixture.primaryRoot, "docs/escape.md"));
  for (const generate of [createOpenGlanceOpenLink, createCanonicalOpenLink]) {
    for (const file of ["docs/escape.md", "docs/missing.md"]) {
      assert.equal(new URL(await generate({ repoRoot: fixture.primaryRoot, file })).searchParams.has("title"), false);
    }
    await assert.rejects(generate({ repoRoot: fixture.primaryRoot, file: "../outside.md" }));
  }
});
