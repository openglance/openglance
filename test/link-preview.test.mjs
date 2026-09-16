import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { linkPreviewTarget } from "../public/link-preview-target.js";
import { markdownLinkPreview, renderMarkdown } from "../src/content/markdown.mjs";
import { createLinkPreviewProvider } from "../src/server/link-preview.mjs";
import { createPreviewServer } from "../src/server/index.mjs";
import { worktreeIdForPath } from "../src/server/git-worktrees.mjs";

const context = { file: "docs/index.md", repo: "local", origin: "http://127.0.0.1:1234" };
const github = "https://github.com/example/private";
const source = "---\ntitle: Preview title\nsummary: >\n  A saved\n  summary.\n---\n# Document\n\nOpening paragraph.\n\n## Details\n\nFirst section.\n\n### Child\n\nNested text.\n\n## Details\n\nSecond section.\n";

test("link targets resolve local paths and recognize only supported GitHub resources", () => {
  assert.deepEqual(linkPreviewTarget("../guide.md#details", context), { kind: "document", file: "guide.md", hash: "#details" });
  assert.equal(linkPreviewTarget("#details", context).file, "docs/index.md");
  assert.equal(linkPreviewTarget("/?repo=local&file=guide.md#L3-L8", context).hash, "#L3-L8");
  for (const href of ["../../private.md", "file:///tmp/a.md", "https://github.com.evil.org/a/b", "https://me@github.com/a/b", "https://github.com:123/a/b", "https://github.com/a/b/actions", "javascript:alert(1)", "//evil.test/a.md", "a%00.md", "a%5Cb.md", "/?repo=other&file=a.md"]) {
    assert.equal(linkPreviewTarget(href, context), null, href);
  }
  for (const [suffix, type] of [["", "repository"], ["/issues/12", "issue"], ["/pull/2", "pull"], ["/blob/feature/topic/a.md", "file"], ["/commit/abcdef123", "commit"], ["/releases/tag/v1", "release"], ["/releases/latest", "release"]]) {
    assert.equal(linkPreviewTarget(github + suffix, context)?.type, type);
  }
});

test("document previews use metadata, exact rendered heading IDs and source line numbers", () => {
  const whole = markdownLinkPreview(source, { file: "test.md" });
  assert.equal(whole.title, "Preview title");
  assert.equal(whole.excerpt, "A saved summary.");
  assert.match(whole.detail, /Opening paragraph/);
  const html = renderMarkdown(source);
  const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((item) => item[1]);
  assert.equal(ids.length, 2);
  const first = markdownLinkPreview(source, { hash: `#${ids[0]}` });
  assert.match(first.excerpt, /First section/);
  assert.match(first.excerpt, /Nested text/);
  assert.doesNotMatch(first.excerpt, /Second section|saved summary/);
  assert.equal(markdownLinkPreview(source, { hash: `#${ids[1]}` }).excerpt, "Second section.");
  assert.equal(markdownLinkPreview(source, { hash: "#L2-L3" }).excerpt, "title: Preview title\nsummary: >");
  for (const hash of ["#missing", "#L0", "#L10-L2", "#L999", "#%xx"]) assert.equal(markdownLinkPreview(source, { hash }).status, "location_missing");
});

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "openglance-preview-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "repo");
  await mkdir(repoRoot);
  const git = (args) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Preview test"]); git(["config", "user.email", "test@example.invalid"]);
  git(["remote", "add", "origin", `${github}.git`]);
  await writeFile(path.join(repoRoot, "README.md"), source);
  git(["add", "."]); git(["commit", "-m", "Fixture"]);
  return { root, repoRoot, repo: { root: repoRoot, id: "local", githubBlobRoot: `${github}/blob/main` }, git };
}

test("local previews reflect saved changes and reject missing or escaping files", async (t) => {
  const { root, repoRoot, repo } = await fixture(t);
  const preview = createLinkPreviewProvider();
  const request = { href: "README.md", file: "index.md", repo, origin: context.origin };
  assert.equal((await preview(request)).excerpt, "A saved summary.");
  await writeFile(path.join(repoRoot, "README.md"), "# Changed\n\nFresh saved text.");
  assert.equal((await preview(request)).excerpt, "Fresh saved text.");
  await writeFile(path.join(root, "outside.md"), "Secret outside");
  if (process.platform !== "win32") {
    await symlink(path.join(root, "outside.md"), path.join(repoRoot, "escape.md"));
    assert.equal((await preview({ ...request, href: "escape.md" })).status, "unavailable");
  }
  assert.equal((await preview({ ...request, href: "missing.md" })).status, "unavailable");
  assert.equal((await preview({ ...request, href: "../outside.md" })).status, "unsupported");
  await writeFile(path.join(repoRoot, "large.md"), "x".repeat(1024 * 1024 + 1));
  assert.equal((await preview({ ...request, href: "large.md" })).status, "too_large");
});

test("hosted links preview their primary or exact worktree without switching or publishing", async (t) => {
  const { root, repoRoot, repo, git } = await fixture(t);
  const linked = path.join(root, "linked");
  git(["worktree", "add", "-b", "feature", linked]);
  await writeFile(path.join(linked, "README.md"), "# Worktree\n\nDifferent local copy.");
  const preview = createLinkPreviewProvider();
  const href = "https://gitleaf.mangofuture.com/open?repo=example/private&path=README.md";
  const request = { href, repo: { ...repo, root: linked }, file: "README.md", origin: context.origin };
  assert.equal((await preview(request)).title, "Preview title");
  assert.equal((await preview({ ...request, href: `${href}&worktree=${worktreeIdForPath(linked)}` })).title, "Worktree");
  assert.equal((await preview({ ...request, href: href.replace("example/private", "other/repo") })).status, "repository_unavailable");
  const share = href.replace("/open?", "/share?v=1&rev=" + "a".repeat(40) + "&");
  assert.equal((await preview({ ...request, href: share })).notice, "local_copy");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).trim(), "main");
});

function githubProvider(responses, calls = []) {
  return createLinkPreviewProvider({ ghRunner: async (command, args, options) => {
    calls.push({ command, args, options });
    const response = responses[args.at(-1)];
    if (response instanceof Error) throw response;
    assert.notEqual(response, undefined, `Unexpected endpoint ${args.at(-1)}`);
    return { stdout: JSON.stringify(response) };
  } });
}
const request = (suffix = "") => ({ href: github + suffix, file: "README.md", repo: { id: "local" }, origin: context.origin });

test("GitHub reads use fixed authenticated GET endpoints and never retain account content", async () => {
  const calls = [];
  const responses = { "repos/example/private/issues/42": { title: "Private issue", body: "Actual issue content.", state: "open", user: { login: "author" }, labels: [{ name: "bug" }] } };
  const preview = githubProvider(responses, calls);
  const first = await preview(request("/issues/42"));
  assert.equal(first.title, "#42 Private issue");
  assert.deepEqual(first.metadata, ["open", "author", "bug"]);
  assert.deepEqual(calls[0].args.slice(0, 5), ["api", "--hostname", "github.com", "--method", "GET"]);
  assert.ok(calls[0].options.timeout <= 20000);
  responses["repos/example/private/issues/42"] = new Error("HTTP 404 hidden private error");
  assert.deepEqual(await preview(request("/issues/42")), { kind: "github", status: "unavailable" });
  assert.equal(calls.length, 2);
});

test("GitHub file links preserve slash-containing refs and exact line ranges", async () => {
  const sha = "b".repeat(40);
  const preview = githubProvider({
    "repos/example/private/git/matching-refs/heads/feature": [{ ref: "refs/heads/feature/topic", object: { sha } }],
    "repos/example/private/git/matching-refs/tags/feature": [],
    [`repos/example/private/contents/docs/a.md?ref=${sha}`]: { type: "file", encoding: "base64", size: 50, content: Buffer.from("# Title\n\nThe target line.\nMore.").toString("base64") },
  });
  const result = await preview(request("/blob/feature/topic/docs/a.md#L3"));
  assert.equal(result.excerpt, "The target line.");
  assert.equal(result.path, "example/private/docs/a.md");
  assert.equal(result.location, "L3");
});

test("GitHub failures become safe actionable states without exposing command output", async () => {
  for (const [error, status] of [
    [Object.assign(new Error("private credential path"), { code: "ENOENT" }), "gh_missing"],
    [new Error("Run gh auth login; secret token"), "authentication_required"],
    [new Error("HTTP 403 Organization requires SSO"), "forbidden"],
    [new Error("HTTP 403 API rate limit exceeded"), "rate_limited"],
    [new Error("timeout with private URL"), "network_error"],
  ]) {
    const preview = createLinkPreviewProvider({ ghRunner: async () => { throw error; } });
    assert.deepEqual(await preview(request()), { kind: "github", status });
  }
});

test("GitHub cards show repository, merged PR, commit and release facts", async () => {
  const preview = githubProvider({
    "repos/example/private": { full_name: "example/private", private: true, description: "Repository summary", language: "JavaScript", default_branch: "main" },
    "repos/example/private/pulls/8": { title: "Merge preview support", body: "Changes to preview.", merged_at: "2026-09-16T00:00:00Z", state: "closed" },
    "repos/example/private/commits/abcdef123": { sha: "abcdef123", commit: { message: "Add previews\n\nDetails", author: { name: "Maintainer" } } },
    "repos/example/private/releases/tags/v1": { name: "Version 1", tag_name: "v1", body: "Release notes.", prerelease: false },
  });
  assert.deepEqual((await preview(request())).metadata, ["Private", "JavaScript", "main"]);
  const pr = await preview(request("/pull/8#discussion_r1"));
  assert.equal(pr.metadata[0], "Merged");
  assert.equal(pr.notice, "resource_excerpt");
  assert.equal((await preview(request("/commit/abcdef123"))).title, "Add previews");
  assert.equal((await preview(request("/releases/tag/v1"))).excerpt, "Release notes.");
});

test("unambiguous GitHub file URLs need one request and unknown anchors remain labeled excerpts", async () => {
  const calls = [];
  const responses = { "repos/example/private/contents/README.md?ref=main": { type: "file", encoding: "base64", size: 20, content: Buffer.from("# Title\n\nFile content.").toString("base64") } };
  const preview = githubProvider(responses, calls);
  const result = await preview(request("/blob/main/README.md#user-content-title"));
  assert.equal(calls.length, 1);
  assert.equal(result.notice, "file_excerpt");
  assert.equal(result.excerpt, "File content.");
  responses["repos/example/private/contents/README.md?ref=main"].content = "";
  assert.equal((await preview(request("/blob/main/README.md"))).status, "ok");
  responses["repos/example/private/contents/README.md?ref=main"].content = Buffer.from([0, 255]).toString("base64");
  assert.equal((await preview(request("/blob/main/README.md"))).status, "unsupported");
});

test("bounded GitHub concurrency recovers after pending operations complete", async () => {
  const pending = [];
  const preview = createLinkPreviewProvider({ ghRunner: () => new Promise((resolve) => pending.push(resolve)) });
  const first = preview(request()); const second = preview(request());
  assert.equal((await preview(request())).status, "busy");
  for (const resolve of pending) resolve({ stdout: '{"full_name":"example/private"}' });
  assert.equal((await first).status, "ok"); assert.equal((await second).status, "ok");
  const next = preview(request());
  pending.at(-1)({ stdout: '{"full_name":"example/private"}' });
  assert.equal((await next).status, "ok");
});

test("a failed ref lookup retains its concurrency slot until the other lookup settles", async () => {
  const pending = [];
  const preview = createLinkPreviewProvider({ ghRunner: async (_command, args) => {
    if (args.at(-1).includes("/tags/")) throw new Error("HTTP 403");
    return new Promise((resolve) => pending.push(resolve));
  } });
  const first = preview(request("/blob/feature/topic/a.md"));
  const second = preview(request("/blob/feature/topic/a.md"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await preview(request())).status, "busy");
  for (const resolve of pending) resolve({ stdout: "[]" });
  assert.equal((await first).status, "forbidden");
  assert.equal((await second).status, "forbidden");
});

test("preview API rejects cross-origin access and mutation while disabling response caching", async (t) => {
  const { repoRoot } = await fixture(t);
  let calls = 0;
  const server = createPreviewServer({ repoRoot, initialFile: null, ghRunner: async () => { calls++; return { stdout: '{"full_name":"example/private","private":true}' }; } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/link-preview?href=${encodeURIComponent(github)}`;
  assert.equal((await fetch(url, { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await fetch(url, { method: "POST" })).status, 405);
  assert.equal(calls, 0);
  const response = await fetch(url);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).title, "example/private");
  assert.equal(calls, 1);
});
