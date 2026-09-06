import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { renderMarkdown } from "../src/content/markdown.mjs";
import { createPreviewServer } from "../src/server/index.mjs";
import { LOCAL_LINK_CASES, LOCAL_LINK_SOURCE, writeLocalLinkRepository } from "./fixtures/local-link-repository.mjs";

function destinationFromHtml(html) {
  return html.match(/(?:href|src)="([^"]+)"/)[1].replaceAll("&amp;", "&");
}

test("rendered document links and assets open the exact repository file through HTTP", async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "openglance-local-links-"));
  await writeLocalLinkRepository(repoRoot);
  const server = createPreviewServer({ repoRoot, initialFile: null, gitRunner: async () => ({ stdout: "" }) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sourceResponse = await fetch(`${base}/api/document?${new URLSearchParams({ file: LOCAL_LINK_SOURCE })}`);
    assert.equal(sourceResponse.status, 200);
    const source = await sourceResponse.json();
    const destinations = [...source.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    assert.equal(destinations.length, LOCAL_LINK_CASES.length);
    for (const [index, entry] of LOCAL_LINK_CASES.entries()) {
      await t.test(entry.name, async () => {
        const url = new URL(destinations[index], base);
        const response = await fetch(entry.content ? url : `${base}/api/document${url.search}`);
        assert.equal(response.status, 200, await response.clone().text());
        if (entry.content) {
          assert.equal(await response.text(), entry.content);
          assert.equal(url.pathname, "/raw");
        } else {
          const target = await response.json();
          assert.equal(target.path, entry.file);
          assert.match(target.html, /Correct local target/);
          assert.equal(url.pathname, "/");
        }
        assert.equal(url.searchParams.get("file"), entry.file);
        assert.equal(url.searchParams.get("repo"), source.repo);
        assert.equal(url.hash, entry.hash ?? "");
        for (const [key, value] of Object.entries(entry.query ?? {})) {
          assert.deepEqual(url.searchParams.getAll(key), Array.isArray(value) ? value : [value]);
        }
      });
    }
    await t.test("current source directory is a filesystem path, including literal percent sequences", async () => {
      const html = renderMarkdown("[Sibling](page.md)", { currentFile: "目录 %25/README.md" });
      const url = new URL(destinationFromHtml(html), base);
      const response = await fetch(`${base}/api/document${url.search}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).path, "目录 %25/page.md");
    });
    await t.test("encoded traversal and symlinks cannot read outside the repository", async () => {
      const outside = await mkdtemp(path.join(tmpdir(), "openglance-outside-"));
      try {
        await writeFile(path.join(outside, "private.md"), "# Private\n");
        await writeFile(path.join(outside, "private.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
        if (process.platform !== "win32") await symlink(outside, path.join(repoRoot, "escape"));
        const escape = path.posix.relative("docs", `../${path.basename(outside)}/private.md`);
        const destinations = [escape, escape.replaceAll("..", "%2e%2e").replaceAll("/", "%2f")];
        if (process.platform !== "win32") destinations.push("../escape/private.md");
        for (const destination of destinations) {
          const url = new URL(destinationFromHtml(renderMarkdown(`[Escape](${destination})`, { currentFile: LOCAL_LINK_SOURCE })), base);
          const response = await fetch(`${base}/api/document${url.search}`);
          assert.equal(response.ok, false);
          assert.doesNotMatch(await response.text(), /# Private/);
          const imageUrl = new URL(destinationFromHtml(renderMarkdown(`![Escape](${destination.replace(".md", ".svg")})`, { currentFile: LOCAL_LINK_SOURCE })), base);
          const rawResponse = await fetch(imageUrl);
          assert.equal(rawResponse.ok, false);
          const liveResponse = await fetch(`${base}/api/link-target?${new URLSearchParams({
            file: LOCAL_LINK_SOURCE, target: destination, targetFormat: "markdown",
          })}`);
          assert.equal(liveResponse.ok, false);
        }
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("Live resolves Markdown URL paths once while plain file inputs retain literal percent sequences", async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "openglance-live-links-"));
  await writeLocalLinkRepository(repoRoot);
  const server = createPreviewServer({ repoRoot, initialFile: null, gitRunner: async () => ({ stdout: "" }) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const entry of LOCAL_LINK_CASES.filter((entry) => !entry.content)) {
      await t.test(entry.name, async () => {
        const response = await fetch(`${base}/api/link-target?${new URLSearchParams({
          file: LOCAL_LINK_SOURCE, target: entry.destination, targetFormat: "markdown",
        })}`);
        assert.equal(response.status, 200, await response.clone().text());
        const target = await response.json();
        assert.equal(target.path, entry.file);
        assert.equal(new URL(target.href, base).hash, entry.hash ?? "");
        const rendered = new URL(destinationFromHtml(renderMarkdown(target.markdown, { currentFile: LOCAL_LINK_SOURCE })), base);
        assert.equal(rendered.searchParams.get("file"), entry.file);
      });
    }
    const response = await fetch(`${base}/api/link-target?${new URLSearchParams({
      file: LOCAL_LINK_SOURCE, target: "notes/literal%20.md",
    })}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).path, "docs/notes/literal%20.md");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("encoded filename delimiters remain part of file, separate from query and fragment", () => {
  const html = renderMarkdown("[File](notes/a%23b%3Fc%26d%2Be.md?view=full#details)", { currentFile: LOCAL_LINK_SOURCE });
  const url = new URL(destinationFromHtml(html), "http://localhost");
  assert.equal(url.searchParams.get("file"), "docs/notes/a#b?c&d+e.md");
  assert.equal(url.searchParams.get("view"), "full");
  assert.equal(url.hash, "#details");
});

test("malformed image escapes do not prevent the surrounding document from rendering", () => {
  const html = renderMarkdown('<img src="assets/%E0.svg" alt="Malformed" />\n\n[Next](notes/plain.md)', { currentFile: LOCAL_LINK_SOURCE });
  assert.match(html, />Next<\/a>/);
});
