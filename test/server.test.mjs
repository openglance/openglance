import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createPreviewServer, documentPayload } from "../src/server/index.mjs";
import {
  resolveNewDocumentPath,
  resolveOpenablePath,
  resolvePreviewPath,
} from "../src/server/paths.mjs";
import { createRepositoryInfo } from "../src/server/repositories.mjs";

const execFileAsync = promisify(execFile);

test("index page can start without an initial document", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const server = createPreviewServer({ repoRoot, initialFile: null });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    assert.equal(response.ok, true);
    assert.match(html, /window\.OPENGLANCE_INITIAL_FILE = "";/);
    assert.match(html, /window\.OPENGLANCE_DESKTOP_PREFERENCES = null;/);
    assert.match(html, /window\.OPENGLANCE_TELEMETRY_ENABLED = false;/);
    assert.match(html, /id="theme-toggle"/);
    assert.match(html, /aria-label="切换到深色模式"/);
    assert.match(html, /id="theme-toggle"[\s\S]*hidden[\s\S]*><\/button>/);
    assert.match(html, /href="\/styles\.css\?v=[^"]+"/);
    assert.match(html, /src="\/app\.js\?v=[^"]+"/);
    assert.doesNotMatch(html, /__OPENGLANCE_INITIAL_FILE__/);
    assert.doesNotMatch(html, /__OPENGLANCE_ASSET_VERSION__/);
    assert.doesNotMatch(html, /__OPENGLANCE_DESKTOP_PREFERENCES__/);
    assert.doesNotMatch(html, /__OPENGLANCE_TELEMETRY_ENABLED__/);
  } finally {
    await close(server);
  }
});

test("telemetry API is available only when a desktop recorder is supplied", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-api-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const recorded = [];
  const server = createPreviewServer({
    repoRoot,
    initialFile: null,
    recordTelemetryActions: async (actions) => {
      recorded.push(...actions);
      return actions.length;
    },
  });
  const baseUrl = await listen(server);

  try {
    const page = await fetch(`${baseUrl}/`);
    assert.match(await page.text(), /window\.OPENGLANCE_TELEMETRY_ENABLED = true;/);
    const actions = [{ kind: "mode", mode: "live" }];
    const response = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: 1 });
    assert.deepEqual(recorded, actions);
  } finally {
    await close(server);
  }
});

test("document API requires a file when OpenGlance starts as a workbench", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const server = createPreviewServer({ repoRoot, initialFile: null });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/document`);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /No document selected/);
  } finally {
    await close(server);
  }
});

test("create document API writes Markdown and MDX beside the selected context", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-create-document-"));
  await mkdir(path.join(repoRoot, "campaigns"));
  const server = createPreviewServer({ repoRoot, initialFile: null });
  const baseUrl = await listen(server);

  try {
    const markdownResponse = await fetch(`${baseUrl}/api/create-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: "campaigns", name: "活动复盘", format: "md" }),
    });
    const markdown = await markdownResponse.json();
    assert.equal(markdownResponse.status, 201);
    assert.equal(markdown.path, "campaigns/活动复盘.md");
    assert.equal(await readFile(path.join(repoRoot, markdown.path), "utf8"), "# 活动复盘\n\n");

    const mdxResponse = await fetch(`${baseUrl}/api/create-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: "", name: "增强内容.mdx", format: "mdx" }),
    });
    const mdx = await mdxResponse.json();
    assert.equal(mdxResponse.status, 201);
    assert.equal(mdx.path, "增强内容.mdx");
    assert.equal(await readFile(path.join(repoRoot, mdx.path), "utf8"), "# 增强内容\n\n");
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("create document API never overwrites and rejects unsafe locations", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-create-document-safe-"));
  await writeFile(path.join(repoRoot, "existing.md"), "# Existing\n");
  const server = createPreviewServer({ repoRoot, initialFile: null });
  const baseUrl = await listen(server);

  try {
    const conflict = await fetch(`${baseUrl}/api/create-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "existing", format: "md" }),
    });
    assert.equal(conflict.status, 409);
    assert.equal(await readFile(path.join(repoRoot, "existing.md"), "utf8"), "# Existing\n");

    const unsafe = await fetch(`${baseUrl}/api/create-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: "../outside", name: "escape", format: "md" }),
    });
    assert.equal(unsafe.status, 400);
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("file operation APIs create Git-visible folders, rename references, and guard direct deletion", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-file-operation-api-"));
  await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "old.md"), "# Old\n");
  await writeFile(path.join(repoRoot, "index.md"), "[Old](old.md)\n");
  const server = createPreviewServer({ repoRoot, initialFile: null });
  const baseUrl = await listen(server);

  try {
    const createFolderResponse = await fetch(`${baseUrl}/api/create-directory?locale=zh-CN`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPath: "", name: "plans" }),
    });
    const createdFolder = await createFolderResponse.json();
    assert.equal(createFolderResponse.status, 201);
    assert.equal(createdFolder.markerPath, "plans/.gitkeep");
    assert.equal(await readFile(path.join(repoRoot, "plans", ".gitkeep"), "utf8"), "");

    const treeWithFolder = await getJson(`${baseUrl}/api/tree`);
    assert.deepEqual(treeWithFolder.tree.find((node) => node.name === "plans"), {
      type: "directory",
      name: "plans",
      placeholderOnly: true,
      children: [{
        type: "file",
        name: ".gitkeep",
        path: "plans/.gitkeep",
        kind: "placeholder",
        placeholder: true,
      }],
    });

    const createDocumentResponse = await fetch(`${baseUrl}/api/create-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: "plans", name: "brief", format: "md" }),
    });
    assert.equal(createDocumentResponse.status, 201);
    await assert.rejects(readFile(path.join(repoRoot, "plans", ".gitkeep")), /ENOENT/);

    const renamePreviewResponse = await fetch(`${baseUrl}/api/rename-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "old.md", name: "new.md" }),
    });
    const renamePreview = await renamePreviewResponse.json();
    assert.equal(renamePreviewResponse.status, 200);
    assert.equal(renamePreview.referenceCount, 1);
    assert.equal("_source" in renamePreview, false);
    assert.equal("_referencePlan" in renamePreview, false);

    const renameResponse = await fetch(`${baseUrl}/api/rename-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "old.md",
        name: "new.md",
        fingerprint: renamePreview.fingerprint,
      }),
    });
    const renamed = await renameResponse.json();
    assert.equal(renameResponse.status, 200);
    assert.equal(renamed.targetPath, "new.md");
    assert.equal(await readFile(path.join(repoRoot, "index.md"), "utf8"), "[Old](new.md)\n");

    const deletePreviewResponse = await fetch(`${baseUrl}/api/delete-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new.md" }),
    });
    const deletePreview = await deletePreviewResponse.json();
    assert.equal(deletePreviewResponse.status, 200);
    assert.equal(deletePreview.requiresUnrecoverableConfirmation, true);
    assert.equal(deletePreview.referenceCount, 1);

    const unconfirmedDelete = await fetch(`${baseUrl}/api/delete-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "new.md",
        fingerprint: deletePreview.fingerprint,
      }),
    });
    assert.equal(unconfirmedDelete.status, 409);
    assert.equal(await readFile(path.join(repoRoot, "new.md"), "utf8"), "# Old\n");

    const confirmedDelete = await fetch(`${baseUrl}/api/delete-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "new.md",
        fingerprint: deletePreview.fingerprint,
        confirmUnrecoverable: true,
      }),
    });
    assert.equal(confirmedDelete.status, 200);
    await assert.rejects(readFile(path.join(repoRoot, "new.md")), /ENOENT/);
    assert.equal(await readFile(path.join(repoRoot, "index.md"), "utf8"), "[Old](new.md)\n");

    const nonEmptyDelete = await fetch(`${baseUrl}/api/delete-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "plans" }),
    });
    assert.equal(nonEmptyDelete.status, 409);
    assert.equal((await nonEmptyDelete.json()).code, "directory_not_empty");
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("resolveNewDocumentPath normalizes extensions and rejects invalid names", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-new-path-"));
  try {
    const resolved = await resolveNewDocumentPath(repoRoot, {
      name: "Brief.md",
      format: "mdx",
    });
    assert.equal(resolved.relativePath, "Brief.mdx");
    await assert.rejects(
      resolveNewDocumentPath(repoRoot, { name: "bad/name", format: "md" }),
      /characters that are not supported/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("health API identifies a reusable OpenGlance server", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const server = createPreviewServer({
    repoRoot,
    initialFile: null,
    toolVersionMonitor: fakeToolVersionMonitor({ startupFingerprint: "abc123" }),
  });
  const baseUrl = await listen(server);

  try {
    const payload = await getJson(`${baseUrl}/api/health`);

    assert.equal(payload.app, "openglance");
    assert.equal(payload.repoRoot, repoRoot);
    assert.equal(payload.initialFile, "");
    assert.equal(payload.toolFingerprint, "abc123");
    assert.equal(payload.stale, false);
    assert.deepEqual(Object.keys(payload).sort(), [
      "buildInfo",
      "app",
      "initialFile",
      "repoRoot",
      "stale",
      "toolFingerprint",
    ].sort());
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(payload.buildInfo.version, packageJson.version);
    assert.match(payload.buildInfo.commit, /^[a-z0-9.-]+$/);
    assert.match(payload.buildInfo.builtAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(payload.buildInfo.buildId, /^[a-z0-9.-]+$/);
  } finally {
    await close(server);
  }
});

test("tool status API checks for runtime updates on user activity", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  let checked = false;
  const server = createPreviewServer({
    repoRoot,
    initialFile: null,
    toolVersionMonitor: {
      startupFingerprint: "old",
      checkForUpdate: async () => {
        checked = true;
        return {
          fingerprint: "new",
          startupFingerprint: "old",
          stale: true,
        };
      },
    },
  });
  const baseUrl = await listen(server);

  try {
    const payload = await getJson(`${baseUrl}/api/tool-status?force=1`);

    assert.equal(checked, true);
    assert.deepEqual(payload, {
      toolFingerprint: "new",
      startupFingerprint: "old",
      stale: true,
    });
  } finally {
    await close(server);
  }
});

test("restart API triggers the supplied soft restart hook", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  let restartCount = 0;
  const server = createPreviewServer({
    repoRoot,
    initialFile: null,
    toolVersionMonitor: fakeToolVersionMonitor({ startupFingerprint: "abc123" }),
    restartSelf: async () => {
      restartCount += 1;
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/restart`, { method: "POST" });
    const payload = await response.json();

    assert.equal(response.ok, true);
    assert.deepEqual(payload, { restarting: true });
    assert.equal(restartCount, 1);
  } finally {
    await close(server);
  }
});

test("preferences API reads and updates desktop app preferences", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  let persistedPreferences = null;
  const server = createPreviewServer({
    repoRoot,
    initialFile: null,
    desktopPreferences: {
      mode: "live",
      theme: "dark",
    },
    saveDesktopPreferences: async (preferences) => {
      persistedPreferences = preferences;
      return {
        mode: "source",
        theme: "dark",
        sidebarWidth: preferences.sidebarWidth,
      };
    },
  });
  const baseUrl = await listen(server);

  try {
    const page = await fetch(`${baseUrl}/`);
    const html = await page.text();

    assert.match(html, /window\.OPENGLANCE_DESKTOP_PREFERENCES = \{"mode":"live","theme":"dark"\};/);
    assert.deepEqual(await getJson(`${baseUrl}/api/preferences`), {
      available: true,
      preferences: {
        mode: "live",
        theme: "dark",
      },
    });

    const response = await fetch(`${baseUrl}/api/preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sidebarWidth: 360 }),
    });
    const payload = await response.json();

    assert.equal(response.ok, true);
    assert.deepEqual(persistedPreferences, { sidebarWidth: 360 });
    assert.deepEqual(payload, {
      available: true,
      preferences: {
        mode: "source",
        theme: "dark",
        sidebarWidth: 360,
      },
    });
    assert.deepEqual(await getJson(`${baseUrl}/api/preferences`), payload);
  } finally {
    await close(server);
  }
});

test("favorites API scopes finite mutations to the current repository", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "README.md"), "# Sample\n");
  const operations = [];
  let favorites = [];
  const server = createPreviewServer({
    repoRoot,
    initialFile: null,
    getRepositoryFavorites: async (repositoryRoot) => {
      assert.equal(repositoryRoot, repoRoot);
      return favorites;
    },
    mutateRepositoryFavorite: async ({ repositoryRoot, operation }) => {
      assert.equal(repositoryRoot, repoRoot);
      operations.push(operation);
      if (operation.action === "add") {
        favorites = [...favorites, { type: operation.type, path: operation.path }];
      } else if (operation.action === "remove-many") {
        const removals = new Set(operation.entries.map((entry) => `${entry.type}:${entry.path}`));
        favorites = favorites.filter((item) => !removals.has(`${item.type}:${item.path}`));
      } else {
        favorites = favorites.filter((item) => (
          item.type !== operation.type || item.path !== operation.path
        ));
      }
      return favorites;
    },
  });
  const baseUrl = await listen(server);

  try {
    assert.deepEqual(await getJson(`${baseUrl}/api/favorites`), {
      available: true,
      favorites: [],
    });

    const add = await fetch(`${baseUrl}/api/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        type: "document",
        path: "README.md",
      }),
    });
    assert.equal(add.status, 200);
    assert.deepEqual(await add.json(), {
      available: true,
      favorites: [{ type: "document", path: "README.md" }],
    });
    assert.deepEqual(operations, [{
      action: "add",
      type: "document",
      path: "README.md",
    }]);

    const prune = await fetch(`${baseUrl}/api/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove-many",
        entries: [{ type: "document", path: "README.md" }],
      }),
    });
    assert.equal(prune.status, 200);
    assert.deepEqual(await prune.json(), {
      available: true,
      favorites: [],
    });
    assert.deepEqual(operations.at(-1), {
      action: "remove-many",
      entries: [{ type: "document", path: "README.md" }],
    });

    const unsafe = await fetch(`${baseUrl}/api/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        type: "document",
        path: "../outside.md",
      }),
    });
    assert.equal(unsafe.status, 400);
    assert.deepEqual(operations.length, 2);

    const unsafeBatch = await fetch(`${baseUrl}/api/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove-many",
        entries: [{ type: "document", path: "../outside.md" }],
      }),
    });
    assert.equal(unsafeBatch.status, 400);
    assert.deepEqual(operations.length, 2);

    const unsupported = await fetch(`${baseUrl}/api/favorites`, {
      method: "PUT",
    });
    assert.equal(unsupported.status, 405);
    assert.deepEqual(operations.length, 2);
  } finally {
    await close(server);
  }
});

test("document API returns file metadata for auto refresh and actions", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n\nBody\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/document?file=sample.md`);
    const payload = await response.json();

    assert.equal(payload.path, "sample.md");
    assert.equal(typeof payload.mtimeMs, "number");
    assert.equal(payload.repoRoot, repoRoot);
    assert.equal(payload.absolutePath, await realpath(path.join(repoRoot, "sample.md")));
    assert.equal(payload.changeBaselineAvailable, false);
    assert.deepEqual(payload.sourceLines, [
      { number: 1, text: "# Sample" },
      { number: 2, text: "" },
      { number: 3, text: "Body" },
    ]);
    assert.match(payload.html, /title="Select line 1" aria-label="Select line 1"/);
    assert.match(payload.html, /aria-label="Source line numbers"/);

    const chinese = await getJson(`${baseUrl}/api/document?file=sample.md&locale=zh-CN`);
    assert.match(chinese.html, /title="选择第 1 行" aria-label="选择第 1 行"/);
    assert.match(chinese.html, /aria-label="源文件行号"/);

    const unsupported = await getJson(`${baseUrl}/api/document?file=sample.md&locale=zh`);
    assert.match(unsupported.html, /title="Select line 1" aria-label="Select line 1"/);
  } finally {
    await close(server);
  }
});

test("document API exposes edit cues only when the document has a committed baseline", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-document-baseline-"));
  const baseline = "# Plan\n\nBefore launch.\n\n## Delivery\n\nKeep this.\n";
  const current = "# Plan\n\nLaunch this week.\n\n## Delivery\n\nKeep this.\n";
  await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "sample.md"), baseline);
  await writeFile(path.join(repoRoot, "empty.md"), "");
  await execFileAsync("git", ["add", "sample.md", "empty.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-qm", "Initial"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "sample.md"), current);
  await writeFile(path.join(repoRoot, "empty.md"), "# Added after commit\n");
  await writeFile(path.join(repoRoot, "new.md"), "# New\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const edited = await getJson(`${baseUrl}/api/document?file=sample.md`);
    assert.equal(edited.source, current);
    assert.equal(edited.changeBaselineAvailable, true);
    assert.equal(edited.changeBaselineSource, baseline);

    const formerlyEmpty = await getJson(`${baseUrl}/api/document?file=empty.md`);
    assert.equal(formerlyEmpty.changeBaselineAvailable, true);
    assert.equal(formerlyEmpty.changeBaselineSource, "");

    const untracked = await getJson(`${baseUrl}/api/document?file=new.md`);
    assert.equal(untracked.changeBaselineAvailable, false);
    assert.equal(Object.hasOwn(untracked, "changeBaselineSource"), false);
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("tree API always returns every repository file", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  await writeFile(path.join(repoRoot, "docs", "data.json"), "{\"ok\":true}\n");
  await writeFile(path.join(repoRoot, "docs", "events.ndjson"), "{\"event\":1}\n");
  await writeFile(path.join(repoRoot, "docs", "page.html"), "<h1>Page</h1>");
  await writeFile(path.join(repoRoot, "docs", "script.js"), "export const ok = true;\n");
  await writeFile(path.join(repoRoot, "docs", "slides.pptx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const payload = await getJson(`${baseUrl}/api/tree`);
    const docs = payload.tree.find((node) => node.name === "docs");
    const sample = payload.tree.find((node) => node.name === "sample.md");

    assert.equal(Object.hasOwn(payload, "view"), false);
    assert.equal(sample?.title, "Sample");
    assert.ok(docs);
    assert.deepEqual(
      docs.children.map(({ name, kind }) => ({ name, kind })),
      [
        { name: "data.json", kind: "json" },
        { name: "events.ndjson", kind: "ndjson" },
        { name: "page.html", kind: "html" },
        { name: "script.js", kind: "code" },
        { name: "slides.pptx", kind: "unknown" },
      ],
    );
  } finally {
    await close(server);
  }
});

test("document API returns readonly payloads for previewable, code, and unsupported files", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  await writeFile(path.join(repoRoot, "data.json"), "{\"ok\":true,\"items\":[1,2]}\n");
  await writeFile(path.join(repoRoot, "invalid.json"), "{\"broken\":\n");
  await writeFile(
    path.join(repoRoot, "events.ndjson"),
    '{"event":1,"message":"first"}\n{"event":2,"message":"second"}\n',
  );
  await writeFile(path.join(repoRoot, "page.html"), '<link rel="stylesheet" href="./page.css"><h1>Page</h1>');
  await writeFile(path.join(repoRoot, "script.js"), "export const ok = true;\n");
  await writeFile(path.join(repoRoot, "slides.pptx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const jsonPayload = await getJson(`${baseUrl}/api/document?file=data.json`);
    assert.equal(jsonPayload.kind, "json");
    assert.equal(jsonPayload.editable, false);
    assert.equal(jsonPayload.canEdit, false);
    assert.match(jsonPayload.text, /"items"/);
    assert.equal(Object.hasOwn(jsonPayload, "source"), false);
    assert.equal(Object.hasOwn(jsonPayload, "html"), false);

    const ndjsonPayload = await getJson(`${baseUrl}/api/document?file=events.ndjson`);
    assert.equal(ndjsonPayload.kind, "ndjson");
    assert.equal(ndjsonPayload.editable, false);
    assert.equal(ndjsonPayload.canEdit, false);
    assert.equal(
      ndjsonPayload.text,
      '{"event":1,"message":"first"}\n{"event":2,"message":"second"}\n',
    );
    assert.equal(Object.hasOwn(ndjsonPayload, "source"), false);

    const invalidJson = await getJson(`${baseUrl}/api/document?file=invalid.json`);
    assert.equal(invalidJson.parseError, "JSON parsing failed. The original text is shown.");
    const chineseInvalidJson = await getJson(
      `${baseUrl}/api/document?file=invalid.json&locale=zh-CN`,
    );
    assert.equal(chineseInvalidJson.parseError, "JSON 解析失败，已按原始文本显示。");

    const htmlPayload = await getJson(`${baseUrl}/api/document?file=page.html`);
    assert.equal(htmlPayload.kind, "html");
    assert.equal(htmlPayload.editable, false);
    assert.equal(htmlPayload.canEdit, false);
    assert.equal(Object.hasOwn(htmlPayload, "text"), false);
    assert.match(htmlPayload.dependencySource, /href="\.\/page\.css"/);

    const codePayload = await getJson(`${baseUrl}/api/document?file=script.js`);
    assert.equal(codePayload.kind, "code");
    assert.equal(codePayload.editable, false);
    assert.match(codePayload.text, /export const ok/);

    const unsupportedPayload = await getJson(`${baseUrl}/api/document?file=slides.pptx`);
    assert.equal(unsupportedPayload.kind, "unsupported");
    assert.equal(unsupportedPayload.editable, false);
    assert.equal(Object.hasOwn(unsupportedPayload, "text"), false);
  } finally {
    await close(server);
  }
});

test("document status API updates when the file changes", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  const filePath = path.join(repoRoot, "sample.md");
  await writeFile(filePath, "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const first = await getJson(`${baseUrl}/api/document-status?file=sample.md`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(filePath, "# Changed\n");
    const second = await getJson(`${baseUrl}/api/document-status?file=sample.md`);

    assert.equal(first.path, "sample.md");
    assert.equal(second.path, "sample.md");
    assert.equal(typeof first.sourceHash, "string");
    assert.equal(typeof second.sourceHash, "string");
    assert.notEqual(second.sourceHash, first.sourceHash);
    assert.ok(second.mtimeMs > first.mtimeMs);
  } finally {
    await close(server);
  }
});

test("dataset query API aggregates external daily data and refreshes its dependency hash", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-dataset-api-"));
  const documentPath = path.join(repoRoot, "report.mdx");
  const dataPath = path.join(repoRoot, "company.csv");
  await writeFile(
    documentPath,
    [
      "<Chart",
      '  title="收入趋势"',
      '  dataset="./company.dataset.json"',
      '  x="period"',
      '  series="revenue"',
      '  granularity="quarter"',
      "/>\n",
    ].join("\n"),
  );
  await writeFile(path.join(repoRoot, "company.dataset.json"), JSON.stringify({
    schemaVersion: 1,
    id: "company_daily",
    title: "Company daily report",
    data: "./company.csv",
    format: "csv",
    grain: ["date"],
    primaryKey: ["date"],
    time: {
      field: "date",
      type: "date",
      weekStartsOn: "monday",
      calendar: "calendar",
      sourceGranularity: "day",
    },
    fields: [
      { name: "date", type: "date", required: true },
      { name: "revenue", type: "decimal", required: true, rollup: "sum" },
    ],
  }));
  await writeFile(dataPath, "date,revenue\n2026-01-01,10\n2026-01-02,20\n");
  const initialFile = await resolvePreviewPath(repoRoot, "report.mdx");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const document = await getJson(`${baseUrl}/api/document?file=report.mdx&locale=zh-CN`);
    assert.match(document.html, /data-mdx-dataset-view="true"/);
    assert.equal(typeof document.dependencyHash, "string");
    assert.equal(document.dependencyHash.length, 64);

    const response = await fetch(`${baseUrl}/api/dataset-query?file=report.mdx&locale=zh-CN`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        component: "Chart",
        dataset: "./company.dataset.json",
        attributes: { title: "收入趋势", x: "period", series: "revenue" },
        query: {},
        granularity: "quarter",
        granularityOptions: ["day", "week", "month", "quarter"],
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.match(payload.html, /data-mdx-component="Chart"/);
    assert.match(payload.html, /2026-Q1/);
    assert.match(payload.html, />30<\/text>/);
    assert.equal(payload.meta.granularity, "quarter");
    assert.equal(payload.meta.sourceGranularity, "day");
    assert.deepEqual(payload.meta.availableGranularities, ["day", "week", "month", "quarter"]);
    assert.equal(payload.meta.sourceRows, 2);
    assert.equal(payload.meta.partialPeriodCount, 1);
    assert.equal(payload.meta.sourcePath, "company.csv");

    await writeFile(
      path.join(repoRoot, "weekly.csv"),
      [
        "date,revenue",
        "2025-12-29,10",
        "2026-01-05,20",
        "2026-01-12,30",
        "2026-01-19,40",
        "2026-01-26,50",
        "",
      ].join("\n"),
    );
    await writeFile(path.join(repoRoot, "weekly.dataset.json"), JSON.stringify({
      schemaVersion: 1,
      id: "company_weekly",
      title: "Company weekly report",
      data: "./weekly.csv",
      format: "csv",
      grain: ["date"],
      primaryKey: ["date"],
      time: {
        field: "date",
        type: "date",
        weekStartsOn: "monday",
        calendar: "calendar",
        sourceGranularity: "week",
      },
      fields: [
        { name: "date", type: "date", required: true },
        { name: "revenue", type: "decimal", required: true, rollup: "sum" },
      ],
    }));
    const weeklyResponse = await fetch(
      `${baseUrl}/api/dataset-query?file=report.mdx&locale=zh-CN`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          component: "Chart",
          dataset: "./weekly.dataset.json",
          attributes: { title: "周收入", x: "period", series: "revenue" },
          query: {},
          granularity: "auto",
          granularityOptions: ["day", "week", "month", "quarter"],
        }),
      },
    );
    const weeklyPayload = await weeklyResponse.json();
    assert.equal(weeklyResponse.status, 200);
    assert.equal(weeklyPayload.meta.granularity, "week");
    assert.deepEqual(weeklyPayload.meta.availableGranularities, ["week", "month", "quarter"]);

    const monthlyResponse = await fetch(
      `${baseUrl}/api/dataset-query?file=report.mdx&locale=zh-CN`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          component: "Chart",
          dataset: "./weekly.dataset.json",
          attributes: { title: "周收入", x: "period", series: "revenue" },
          query: {},
          granularity: "month",
          granularityOptions: ["day", "week", "month", "quarter"],
        }),
      },
    );
    const monthlyPayload = await monthlyResponse.json();
    assert.equal(monthlyResponse.status, 200);
    assert.equal(monthlyPayload.meta.granularity, "month");
    assert.match(monthlyPayload.html, /2026-01/);
    assert.match(monthlyPayload.html, />150<\/text>/);
    assert.equal(monthlyPayload.meta.omittedBoundaryPeriodCount, 0);

    const statusBefore = await getJson(`${baseUrl}/api/document-status?file=report.mdx`);
    await new Promise((resolve) => setTimeout(resolve, 8));
    await writeFile(dataPath, "date,revenue\n2026-01-01,10\n2026-01-02,25\n");
    const statusAfter = await getJson(`${baseUrl}/api/document-status?file=report.mdx`);
    assert.equal(statusAfter.sourceHash, statusBefore.sourceHash);
    assert.notEqual(statusAfter.dependencyHash, statusBefore.dependencyHash);
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("document write API syncs source content to disk", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  const filePath = path.join(repoRoot, "sample.md");
  await writeFile(filePath, "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/document?file=sample.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "# Changed\n\nBody\n" }),
    });
    const payload = await response.json();

    assert.equal(response.ok, true);
    assert.equal(payload.path, "sample.md");
    assert.equal(typeof payload.mtimeMs, "number");
    assert.equal(typeof payload.sourceHash, "string");
    assert.equal(await readFile(filePath, "utf8"), "# Changed\n\nBody\n");
  } finally {
    await close(server);
  }
});

test("document write API rejects readonly preview files", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  await writeFile(path.join(repoRoot, "data.json"), "{\"ok\":true}\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/document?file=data.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "{}\n" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /Markdown and MDX/);
  } finally {
    await close(server);
  }
});

test("document write API rejects non-string source bodies", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/document?file=sample.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: 42 }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /source must be a string/);
  } finally {
    await close(server);
  }
});

test("document write API rejects cross-origin local POSTs", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  const filePath = path.join(repoRoot, "sample.md");
  await writeFile(filePath, "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/document?file=sample.md`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Origin: "https://example.invalid",
      },
      body: JSON.stringify({ source: "# Changed\n" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.match(payload.error, /local session/i);
    assert.equal(await readFile(filePath, "utf8"), "# Sample\n");
  } finally {
    await close(server);
  }
});

test("image asset API writes pasted images beside the current document", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await writeFile(path.join(repoRoot, "docs", "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "docs/sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);
  const imageData = Buffer.from("png-image").toString("base64");

  try {
    const response = await fetch(`${baseUrl}/api/image-assets?file=docs/sample.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${imageData}` }),
    });
    const payload = await response.json();

    assert.equal(response.ok, true);
    assert.match(payload.path, /^docs\/_assets\/sample-\d{8}-\d{6}-[a-f0-9]{8}\.png$/);
    assert.match(payload.src, /^_assets\/sample-\d{8}-\d{6}-[a-f0-9]{8}\.png$/);
    assert.match(payload.tag, /^<img src="_assets\/sample-\d{8}-\d{6}-[a-f0-9]{8}\.png" alt="" width="760">$/);
    assert.equal(await readFile(path.join(repoRoot, payload.path), "utf8"), "png-image");
  } finally {
    await close(server);
  }
});

test("image asset API accepts pasted AVIF images", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await writeFile(path.join(repoRoot, "docs", "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "docs/sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);
  const imageData = Buffer.from("avif-image").toString("base64");

  try {
    const response = await fetch(`${baseUrl}/api/image-assets?file=docs/sample.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl: `data:image/avif;base64,${imageData}` }),
    });
    const payload = await response.json();

    assert.equal(response.ok, true);
    assert.match(payload.path, /^docs\/_assets\/sample-\d{8}-\d{6}-[a-f0-9]{8}\.avif$/);
    assert.equal(payload.mimeType, "image/avif");
    assert.equal(await readFile(path.join(repoRoot, payload.path), "utf8"), "avif-image");
  } finally {
    await close(server);
  }
});

test("image asset API localizes unsupported image types", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await writeFile(path.join(repoRoot, "docs", "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "docs/sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);
  const imageData = Buffer.from("tiff-image").toString("base64");

  try {
    for (const [locale, expected] of [
      ["en", "Unsupported image type: image/tiff"],
      ["zh-CN", "不支持的图片类型：image/tiff"],
    ]) {
      const response = await fetch(
        `${baseUrl}/api/image-assets?file=docs/sample.md&locale=${encodeURIComponent(locale)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: `data:image/tiff;base64,${imageData}` }),
        },
      );
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.error, expected);
    }
  } finally {
    await close(server);
  }
});

test("link target API returns titled safe repository document links", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs", "guides", "deep"), { recursive: true });
  await mkdir(path.join(repoRoot, "company"), { recursive: true });
  await writeFile(path.join(repoRoot, "docs", "source.md"), "# Source\n");
  await writeFile(path.join(repoRoot, "docs", "peer.md"), "---\ntitle: Peer Doc\n---\n\n# Fallback\n");
  await writeFile(path.join(repoRoot, "docs", "guides", "guide.md"), "# Guide Doc\n");
  await writeFile(path.join(repoRoot, "docs", "guides", "deep", "deep.md"), "# Deep Doc\n");
  await writeFile(path.join(repoRoot, "company", "org.md"), "# Company Org\n");
  const initialFile = await resolvePreviewPath(repoRoot, "docs/source.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const peer = await getJson(`${baseUrl}/api/link-target?file=docs/source.md&target=peer.md`);
    const child = await getJson(`${baseUrl}/api/link-target?file=docs/source.md&target=guides/guide.md`);
    const deep = await getJson(`${baseUrl}/api/link-target?file=docs/source.md&target=guides/deep/deep.md`);
    const absolute = await getJson(`${baseUrl}/api/link-target?file=docs/source.md&target=${encodeURIComponent(path.join(repoRoot, "company", "org.md"))}`);
    const openGlanceUrl = await getJson(`${baseUrl}/api/link-target?file=docs/source.md&target=${encodeURIComponent(`${baseUrl}/?repo=${path.basename(repoRoot)}&file=docs%2Fpeer.md#L3`)}`);

    assert.deepEqual(
      { title: peer.title, href: peer.href, markdown: peer.markdown },
      { title: "Peer Doc", href: "./peer.md", markdown: "[Peer Doc](./peer.md)" },
    );
    assert.equal(child.href, "./guides/guide.md");
    assert.equal(child.markdown, "[Guide Doc](./guides/guide.md)");
    assert.equal(deep.href, "/docs/guides/deep/deep.md");
    assert.equal(deep.markdown, "[Deep Doc](/docs/guides/deep/deep.md)");
    assert.equal(absolute.href, "../company/org.md");
    assert.equal(absolute.markdown, "[Company Org](../company/org.md)");
    assert.doesNotMatch(absolute.markdown, /Users|private|var|tmp/);
    assert.equal(openGlanceUrl.href, "./peer.md#L3");
    assert.equal(openGlanceUrl.markdown, "[Peer Doc](./peer.md#L3)");
  } finally {
    await close(server);
  }
});

test("link target API opens a repository document relative to a CSV preview", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-csv-link-"));
  await mkdir(path.join(repoRoot, "reviews", "views"), { recursive: true });
  await mkdir(path.join(repoRoot, "reviews", "teachers"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "reviews", "views", "pending-reviews.csv"),
    "teacher_id,teacher\nexample,[Example](../teachers/example.md)\n",
  );
  await writeFile(
    path.join(repoRoot, "reviews", "teachers", "example.md"),
    "# Example Teacher\n",
  );
  const initialFile = await resolveOpenablePath(
    repoRoot,
    "reviews/views/pending-reviews.csv",
  );
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(
      `${baseUrl}/api/link-target?file=reviews%2Fviews%2Fpending-reviews.csv&target=..%2Fteachers%2Fexample.md`,
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.path, "reviews/teachers/example.md");
    assert.equal(payload.href, "../teachers/example.md");
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("link target API rejects OpenGlance URLs for another repository", async () => {
  const currentRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-current-"));
  await mkdir(path.join(currentRoot, "docs"), { recursive: true });
  await writeFile(path.join(currentRoot, "docs", "source.md"), "# Source\n");
  const initialFile = await resolvePreviewPath(currentRoot, "docs/source.md");
  const server = createPreviewServer({ repoRoot: currentRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const target = encodeURIComponent("http://127.0.0.1:4317/?repo=content-repo&file=AGENTS.md");
    const response = await fetch(`${baseUrl}/api/link-target?file=docs/source.md&target=${target}`);
    const payload = await response.json();
    const chineseResponse = await fetch(
      `${baseUrl}/api/link-target?file=docs/source.md&target=${target}&locale=zh-CN`,
    );
    const chinesePayload = await chineseResponse.json();
    const missingResponse = await fetch(
      `${baseUrl}/api/link-target?file=docs/source.md&target=missing.md&locale=zh-CN`,
    );
    const missingPayload = await missingResponse.json();

    assert.equal(response.status, 404);
    assert.equal(payload.error, "Repository is not available: content-repo");
    assert.equal(chineseResponse.status, 404);
    assert.equal(chinesePayload.error, "仓库不可用：content-repo");
    assert.equal(missingResponse.status, 404);
    assert.equal(missingPayload.error, "目标文档不可用。");
  } finally {
    await close(server);
  }
});

test("link title API reads public page titles and falls back cleanly", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const previewServer = createPreviewServer({ repoRoot, initialFile });
  const pageServer = http.createServer((request, response) => {
    if (request.url === "/private") {
      response.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<title>Forbidden</title>");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end('<!doctype html><meta property="og:title" content="Public Report"><title>Fallback</title>');
  });
  const baseUrl = await listen(previewServer);
  const pageUrl = await listen(pageServer);

  try {
    const title = await getJson(`${baseUrl}/api/link-title?url=${encodeURIComponent(`${pageUrl}/article`)}`);
    const missing = await getJson(`${baseUrl}/api/link-title?url=${encodeURIComponent(`${pageUrl}/private`)}`);

    assert.equal(title.title, "Public Report");
    assert.equal(missing.title, "");
  } finally {
    await close(previewServer);
    await close(pageServer);
  }
});

test("document rename API upgrades a Markdown file to MDX and returns the renamed document", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  const markdownPath = path.join(repoRoot, "sample.md");
  const mdxPath = path.join(repoRoot, "sample.mdx");
  await writeFile(markdownPath, "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/rename-document?file=sample.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extension: ".mdx" }),
    });
    const payload = await response.json();

    assert.equal(response.ok, true);
    assert.equal(payload.path, "sample.mdx");
    assert.equal(payload.source, "# Sample\n");
    assert.equal(await readFile(mdxPath, "utf8"), "# Sample\n");
    await assert.rejects(readFile(markdownPath, "utf8"), /ENOENT/);
  } finally {
    await close(server);
  }
});

test("document rename API rejects an MDX target that already exists", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  const markdownPath = path.join(repoRoot, "sample.md");
  const mdxPath = path.join(repoRoot, "sample.mdx");
  await writeFile(markdownPath, "# Sample\n");
  await writeFile(mdxPath, "# Existing\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/rename-document?file=sample.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extension: ".mdx" }),
    });
    const payload = await response.json();
    const chineseResponse = await fetch(
      `${baseUrl}/api/rename-document?file=sample.md&locale=zh-CN`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extension: ".mdx" }),
      },
    );
    const chinesePayload = await chineseResponse.json();

    assert.equal(response.status, 409);
    assert.equal(payload.error, "Target document already exists: sample.mdx");
    assert.equal(chineseResponse.status, 409);
    assert.equal(chinesePayload.error, "目标文档已存在：sample.mdx");
    assert.equal(await readFile(markdownPath, "utf8"), "# Sample\n");
    assert.equal(await readFile(mdxPath, "utf8"), "# Existing\n");
  } finally {
    await close(server);
  }
});

test("document watch API emits a change event for the current file", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  const filePath = path.join(repoRoot, "sample.md");
  await writeFile(filePath, "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);
  const abortController = new AbortController();

  try {
    const response = await fetch(`${baseUrl}/api/watch?file=sample.md`, {
      signal: abortController.signal,
    });
    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const eventPromise = readNextServerSentEvent(response);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(filePath, "# External\n");
    const event = await eventPromise;

    assert.equal(event.event, "change");
    assert.equal(event.data.path, "sample.md");
    assert.equal(typeof event.data.sourceHash, "string");
  } finally {
    abortController.abort();
    await close(server);
  }
});

test("frontmatter facets API returns allowed key values and file metadata", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "docs", "frontmatter-rules.json"),
    `${JSON.stringify({
      version: 1,
      basicFields: ["title", "domain", "type", "owner", "last_updated", "ai_snippet"],
      fieldValues: {
        canonical: ["true", "false"],
        decision_status: ["proposed", "accepted", "rejected", "superseded"],
      },
      rules: [
        {
          id: "product-releases",
          paths: ["product/*/releases/**/*.md"],
          infer: {
            domain: "product",
            product: "secondSegment",
          },
          suggestFields: ["title", "domain", "product", "type", "owner", "source", "last_updated"],
        },
      ],
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(repoRoot, "standard.md"),
    [
      "---",
      "title: Standard",
      "domain: docs",
      "type: standard",
      "owner: ai",
      "product: sample-product",
      "decision_status: accepted",
      "canonical: true",
      "ai_snippet: OpenGlance editor supports live preview and frontmatter filters",
      "ignored: value",
      "---",
      "# Standard",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(repoRoot, "draft.md"),
    [
      "---",
      "domain: docs",
      "type: draft",
      "owner: product",
      "canonical: false",
      "---",
      "# Draft",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(repoRoot, "plain.md"), "# Plain\n");
  const initialFile = await resolvePreviewPath(repoRoot, "standard.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const treePayload = await getJson(`${baseUrl}/api/tree`);
    const payload = await getJson(`${baseUrl}/api/frontmatter-facets`);
    const expectedAllowedKeys = [
      "domain",
      "type",
      "owner",
      "canonical",
      "decision_status",
      "product",
    ];

    assert.deepEqual(treePayload.frontmatterAllowedKeys, expectedAllowedKeys);
    assert.deepEqual(payload.allowedKeys, expectedAllowedKeys);
    assert.deepEqual(payload.files["standard.md"], {
      domain: "docs",
      type: "standard",
      owner: "ai",
      product: "sample-product",
      decision_status: "accepted",
      canonical: true,
      ai_snippet: "OpenGlance editor supports live preview and frontmatter filters",
    });
    assert.equal(payload.files["plain.md"], undefined);
    assert.equal(payload.facets.domain.find((item) => item.value === "docs")?.count, 2);
    assert.equal(payload.facets.type.find((item) => item.value === "standard")?.count, 1);
    assert.equal(payload.facets.product.find((item) => item.value === "sample-product")?.count, 1);
    assert.equal(payload.facets.decision_status.find((item) => item.value === "accepted")?.count, 1);
    assert.equal(payload.facets.canonical.find((item) => item.value === "true")?.count, 1);
    assert.equal(payload.facets.canonical.find((item) => item.value === "false")?.count, 1);
    assert.equal(payload.facets.title, undefined);
    assert.equal(payload.facets.ai_snippet, undefined);
    assert.equal(payload.facets.ignored, undefined);

    const documentPayload = await getJson(`${baseUrl}/api/document?file=standard.md`);
    assert.deepEqual(documentPayload.frontmatterProfile.fields.find((field) => field.key === "domain"), {
      key: "domain",
      type: "enum",
      values: [],
      inferredValue: "",
      required: false,
      suggested: true,
    });
    assert.deepEqual(
      documentPayload.frontmatterProfile.fields.find((field) => field.key === "canonical"),
      {
        key: "canonical",
        type: "boolean",
        values: ["true", "false"],
        inferredValue: "",
        required: false,
        suggested: false,
      },
    );
    assert.deepEqual(
      documentPayload.frontmatterProfile.fields.find((field) => field.key === "product"),
      {
        key: "product",
        type: "text",
        values: [],
        inferredValue: "",
        required: false,
        suggested: false,
      },
    );
  } finally {
    await close(server);
  }
});

test("document profile includes existing unconfigured boolean frontmatter fields", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "docs", "frontmatter-rules.json"),
    `${JSON.stringify({
      version: 1,
      basicFields: ["title", "domain", "type", "owner", "last_updated", "ai_snippet"],
      domains: ["repo"],
      types: ["standard"],
      rules: [{
        id: "repo-docs",
        paths: ["docs/**/*.md"],
        infer: { domain: "repo" },
        suggestFields: ["title", "domain", "type", "owner", "last_updated", "ai_snippet"],
      }],
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(repoRoot, "docs", "standard.md"),
    [
      "---",
      "title: Standard",
      "domain: repo",
      "type: standard",
      "owner: ai",
      "canonical: true",
      "custom_flag: false",
      "custom_note: hello",
      "---",
      "# Standard",
      "",
    ].join("\n"),
  );

  const initialFile = await resolvePreviewPath(repoRoot, "docs/standard.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const documentPayload = await getJson(`${baseUrl}/api/document?file=docs%2Fstandard.md`);
    assert.deepEqual(
      documentPayload.frontmatterProfile.fields.find((field) => field.key === "canonical"),
      {
        key: "canonical",
        type: "boolean",
        values: ["true", "false"],
        inferredValue: "",
        required: false,
        suggested: false,
      },
    );
    assert.deepEqual(
      documentPayload.frontmatterProfile.fields.find((field) => field.key === "custom_flag"),
      {
        key: "custom_flag",
        type: "boolean",
        values: ["true", "false"],
        inferredValue: "",
        required: false,
        suggested: false,
      },
    );
    assert.deepEqual(
      documentPayload.frontmatterProfile.fields.find((field) => field.key === "custom_note"),
      {
        key: "custom_note",
        type: "text",
        values: [],
        inferredValue: "",
        required: false,
        suggested: false,
      },
    );
  } finally {
    await close(server);
  }
});

test("frontmatter facets API is disabled when a repository has no frontmatter rules", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(
    path.join(repoRoot, "standard.md"),
    [
      "---",
      "domain: docs",
      "type: standard",
      "owner: ai",
      "canonical: true",
      "ai_snippet: This should not enable repository-independent filters",
      "---",
      "# Standard",
      "",
    ].join("\n"),
  );
  const initialFile = await resolvePreviewPath(repoRoot, "standard.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const treePayload = await getJson(`${baseUrl}/api/tree`);
    const payload = await getJson(`${baseUrl}/api/frontmatter-facets`);

    assert.deepEqual(treePayload.frontmatterAllowedKeys, []);
    assert.deepEqual(payload.allowedKeys, []);
    assert.deepEqual(payload.files, {});
    assert.deepEqual(payload.facets, {});

    const documentPayload = await getJson(`${baseUrl}/api/document?file=standard.md`);
    assert.deepEqual(documentPayload.frontmatterProfile, {
      enabled: false,
      fields: [],
    });
  } finally {
    await close(server);
  }
});

test("git status API returns local changes for every file type", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({
    repoRoot,
    initialFile,
    gitRunner: async () => ({
      stdout: " M sample.md\0?? draft.mdx\0 M public/app.js\0?? assets/slides.pptx\0",
      stderr: "",
    }),
  });
  const baseUrl = await listen(server);

  try {
    const payload = await getJson(`${baseUrl}/api/git-status`);

    assert.equal(payload.repo, path.basename(repoRoot));
    assert.equal(payload.branch, "main");
    assert.deepEqual(payload.changes, [
      { path: "sample.md", status: "modified", rawStatus: " M" },
      { path: "draft.mdx", status: "untracked", rawStatus: "??" },
      { path: "public/app.js", status: "modified", rawStatus: " M" },
      { path: "assets/slides.pptx", status: "untracked", rawStatus: "??" },
    ]);
  } finally {
    await close(server);
  }
});

test("remote status API fetches origin and reports incoming files separately from local changes", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-remote-status-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const head = "a".repeat(40);
  const remoteHead = "b".repeat(40);
  const calls = [];
  const server = createPreviewServer({
    repoRoot,
    initialFile,
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command === "remote get-url origin") {
        return { stdout: "git@example.test:docs/repo.git\n", stderr: "" };
      }
      if (command === "rev-parse --verify HEAD") {
        return { stdout: `${head}\n`, stderr: "" };
      }
      if (command === "rev-parse --verify refs/remotes/origin/main") {
        return { stdout: `${remoteHead}\n`, stderr: "" };
      }
      if (command.startsWith("rev-list --left-right --count")) {
        return { stdout: "0 1\n", stderr: "" };
      }
      if (command.startsWith("status --porcelain")) {
        return { stdout: " M sample.md\0", stderr: "" };
      }
      if (command.startsWith("diff --name-only")) {
        return { stdout: "remote.md\0", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });
  const baseUrl = await listen(server);

  try {
    const payload = await getJson(`${baseUrl}/api/git-remote-status?refresh=1`);

    assert.equal(payload.ok, true);
    assert.equal(payload.state, "remote_ahead");
    assert.equal(payload.localChangeCount, 1);
    assert.deepEqual(payload.incomingFiles, ["remote.md"]);
    assert.equal(payload.incomingCount, 1);
    assert.ok(calls.some((args) => args[0] === "fetch" && args.includes("origin")));
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("prepared merge API stays read-only until apply and then preserves dirty local edits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-merge-remote-api-"));
  const bare = path.join(root, "remote.git");
  const repoRoot = path.join(root, "repo");
  const coworker = path.join(root, "coworker");
  await mkdir(bare, { recursive: true });
  await execFileAsync("git", ["init", "--bare", "--initial-branch=main"], { cwd: bare });
  await execFileAsync("git", ["clone", bare, repoRoot], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Tests"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "sample.md"), "before\n");
  await writeFile(path.join(repoRoot, "remote.md"), "remote before\n");
  await execFileAsync("git", ["add", "-A"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: repoRoot });
  await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: repoRoot });
  await execFileAsync("git", ["clone", bare, coworker], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Tests"], { cwd: coworker });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: coworker });
  await writeFile(path.join(coworker, "remote.md"), "remote after\n");
  await execFileAsync("git", ["add", "-A"], { cwd: coworker });
  await execFileAsync("git", ["commit", "-m", "Remote update"], { cwd: coworker });
  await execFileAsync("git", ["push", "origin", "main"], { cwd: coworker });
  await writeFile(path.join(repoRoot, "sample.md"), "local draft\n");

  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const repository = await createRepositoryInfo({ repoRoot, initialFile });
  const server = createPreviewServer({ repoRoot, initialFile, repository });
  const baseUrl = await listen(server);

  try {
    const localHead = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
    ).stdout.trim();
    const prepareResponse = await fetch(
      `${baseUrl}/api/git-prepare-remote-merge?locale=zh-CN`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowLocalChanges: true }),
      },
    );
    const prepared = await prepareResponse.json();

    assert.equal(prepareResponse.status, 200, prepared.error);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.prepared, true);
    assert.ok(prepared.preparationToken);
    assert.equal(
      (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim(),
      localHead,
    );
    assert.equal(await readFile(path.join(repoRoot, "remote.md"), "utf8"), "remote before\n");

    const response = await fetch(`${baseUrl}/api/git-apply-prepared-remote-merge?locale=zh-CN`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preparationToken: prepared.preparationToken }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "preserve_local_changes");
    assert.equal(
      (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim(),
      (await execFileAsync("git", ["rev-parse", "main"], { cwd: bare })).stdout.trim(),
    );
    assert.equal(await readFile(path.join(repoRoot, "sample.md"), "utf8"), "local draft\n");
    assert.equal(
      normalizeCheckoutLineEndings(
        await readFile(path.join(repoRoot, "remote.md"), "utf8"),
      ),
      "remote after\n",
    );
    assert.equal(
      (await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot })).stdout,
      " M sample.md\n",
    );
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("git sync API returns an Agent prompt when the fixed Git flow fails", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({
    repoRoot,
    initialFile,
    gitRunner: async (_cwd, args) => {
      if (args.join(" ") === "config --get user.name") {
        return { stdout: "Jane\n", stderr: "" };
      }
      if (args.join(" ") === "config --get user.email") {
        return { stdout: "jane@example.com\n", stderr: "" };
      }
      if (args.join(" ") === "remote get-url origin") {
        return { stdout: "git@github.com:example-org/docs-repo.git\n", stderr: "" };
      }
      if (args.join(" ") === "rev-parse --verify HEAD") {
        return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
      }
      if (args.includes("status")) {
        return { stdout: " M sample.md\0", stderr: "" };
      }
      if (args.includes("diff")) {
        return { stdout: "sample.md\0", stderr: "" };
      }
      if (args.includes("push")) {
        const error = new Error("push rejected");
        error.stderr = "Updates were rejected because the remote contains work";
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/git-sync?locale=zh-CN`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: ["sample.md"], note: "同步文档" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.equal(payload.step, "push");
    assert.match(payload.error, /remote contains work/);
    assert.match(payload.agentPrompt, /请处理 OpenGlance 同步失败/);
    assert.match(payload.agentPrompt, /选中文件：\n- sample\.md/);
    assert.match(payload.agentPrompt, /失败步骤：push/);
  } finally {
    await close(server);
  }
});

test("share-link API returns a main-primary published document link", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-share-api-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Tests"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "sample.md"), [
    "---",
    "title: Share Me",
    "ai_snippet: '[Guide] Share Me | concise context for coworkers'",
    "---",
    "# Fallback",
    "",
  ].join("\n"));
  await execFileAsync("git", ["add", "sample.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "Add sample"], { cwd: repoRoot });
  await execFileAsync("git", ["remote", "add", "origin", "git@github.com:ExampleOrg/docs-repo.git"], {
    cwd: repoRoot,
  });
  await execFileAsync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: repoRoot });
  const { stdout: headOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const repository = await createRepositoryInfo({ repoRoot, initialFile });
  const server = createPreviewServer({ repoRoot, initialFile, repository });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/share-link?repo=${repository.id}&file=sample.md`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    const shareUrl = new URL(payload.url);
    assert.equal(shareUrl.searchParams.get("repo"), "exampleorg/docs-repo");
    assert.equal(shareUrl.searchParams.get("path"), "sample.md");
    assert.equal(shareUrl.searchParams.get("rev"), headOutput.trim());
    assert.equal(shareUrl.searchParams.get("title"), "Share Me");
    assert.equal(shareUrl.searchParams.has("snippet"), false);
  } finally {
    await close(server);
  }
});

test("share-link publish API commits, pushes, verifies origin/main, and returns the link", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-share-publish-api-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Tests"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "# Initial\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: repoRoot });
  await execFileAsync("git", ["remote", "add", "origin", "git@github.com:ExampleOrg/docs-repo.git"], {
    cwd: repoRoot,
  });
  await writeFile(path.join(repoRoot, "sample.md"), "# Ready to share\n");

  const initialHead = "a".repeat(40);
  const publishedHead = "b".repeat(40);
  const calls = [];
  let committed = false;
  let pushed = false;
  const gitRunner = async (_cwd, args) => {
    calls.push(args);
    const command = args.join(" ");
    if (command === "config --get user.name") return { stdout: "OpenGlance Tests\n", stderr: "" };
    if (command === "config --get user.email") return { stdout: "git-leaf@example.test\n", stderr: "" };
    if (command === "remote get-url origin") {
      return { stdout: "git@github.com:ExampleOrg/docs-repo.git\n", stderr: "" };
    }
    if (command === "rev-parse --verify HEAD") {
      return { stdout: `${committed ? publishedHead : initialHead}\n`, stderr: "" };
    }
    if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
    if (args[0] === "status") {
      return { stdout: committed ? "" : "?? sample.md\0", stderr: "" };
    }
    if (args[0] === "diff" && args[1] === "--cached") {
      return { stdout: "sample.md\0", stderr: "" };
    }
    if (args[0] === "diff") return { stdout: committed ? "" : "sample.md\0", stderr: "" };
    if (args[0] === "hash-object") return { stdout: `${"c".repeat(40)}\n`, stderr: "" };
    if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
    if (args[0] === "commit") {
      committed = true;
      return { stdout: `[main ${publishedHead.slice(0, 7)}] Sync OpenGlance files\n`, stderr: "" };
    }
    if (args[0] === "push") {
      pushed = true;
      return { stdout: "", stderr: "" };
    }
    if (args[0] === "merge-base") {
      if (pushed) return { stdout: "", stderr: "" };
      const error = new Error("not published");
      error.code = 1;
      throw error;
    }
    if (args[0] === "log") return { stdout: `${publishedHead}\n`, stderr: "" };
    if (args[0] === "show") return { stdout: "# Ready to share\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const repository = await createRepositoryInfo({ repoRoot, initialFile });
  const server = createPreviewServer({ repoRoot, initialFile, repository, gitRunner });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(
      `${baseUrl}/api/share-link?repo=${repository.id}&file=sample.md`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Explain the sharing workflow" }),
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.published, true);
    assert.equal(new URL(payload.url).searchParams.get("rev"), publishedHead);
    assert.equal(calls.find((args) => args[0] === "commit")[2], "Explain the sharing workflow");
    const pushIndex = calls.findIndex((args) => args[0] === "push");
    assert.ok(pushIndex >= 0);
    assert.deepEqual(calls.slice(pushIndex, pushIndex + 3), [
      ["push", "origin", `${publishedHead}:refs/heads/main`],
      ["fetch", "origin", "main"],
      ["merge-base", "--is-ancestor", publishedHead, "refs/remotes/origin/main"],
    ]);
  } finally {
    await close(server);
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("index page exposes edit capability for the current browser", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/?file=sample.md`);
    const html = await response.text();

    assert.equal(response.ok, true);
    assert.match(html, /window\.OPENGLANCE_CAN_EDIT = true;/);
    assert.match(html, /window\.OPENGLANCE_INITIAL_REPO = "git-leaf-/);
    assert.doesNotMatch(html, /__OPENGLANCE_CAN_EDIT__/);
    assert.doesNotMatch(html, /__OPENGLANCE_INITIAL_REPO__/);
  } finally {
    await close(server);
  }
});

test("repository payloads contain no sharing tokens", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const repository = {
    id: "docs-repo",
    name: "Docs Repo",
    root: repoRoot,
    defaultFile: "sample.md",
    branch: "main",
    githubBlobRoot: "https://github.com/ExampleOrg/docs-repo/blob/main",
  };
  const server = createPreviewServer({ repoRoot, initialFile, repository });
  const baseUrl = await listen(server);

  try {
    const htmlResponse = await fetch(`${baseUrl}/?repo=docs-repo&file=sample.md`);
    const html = await htmlResponse.text();
    assert.match(html, /window\.OPENGLANCE_CAN_EDIT = true;/);

    const reposPayload = await getJson(`${baseUrl}/api/repos?repo=docs-repo`);
    assert.equal(reposPayload.canEdit, true);
    assert.equal(reposPayload.repositories[0]?.id, "docs-repo");
    assert.equal(reposPayload.repositories[0]?.defaultFile, "sample.md");
    assert.equal(reposPayload.repositories[0]?.branch, "main");
    assert.equal(
      reposPayload.repositories[0]?.githubBlobRoot,
      "https://github.com/ExampleOrg/docs-repo/blob/main",
    );
    assert.equal(Object.hasOwn(reposPayload.repositories[0], "shareToken"), false);
    assert.equal(reposPayload.repositories[0]?.canEdit, true);

    const documentPayload = await getJson(`${baseUrl}/api/document?repo=docs-repo&file=sample.md`);
    assert.equal(documentPayload.canEdit, true);
    assert.equal(documentPayload.source, "# Sample\n");

    const writeResponse = await fetch(`${baseUrl}/api/document?repo=docs-repo&file=sample.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "# Changed\n" }),
    });
    assert.equal(writeResponse.ok, true);
    assert.equal(await readFile(path.join(repoRoot, "sample.md"), "utf8"), "# Changed\n");
  } finally {
    await close(server);
  }
});

test("repository APIs read the current repository", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-repos-"));
  const docsRoot = path.join(rootDir, "docs-repo");
  await mkdir(docsRoot, { recursive: true });
  await writeFile(path.join(docsRoot, "README.md"), "# Docs\n");
  await writeFile(path.join(docsRoot, "content.md"), "# Content\n");

  const initialFile = await resolvePreviewPath(docsRoot, "README.md");
  const server = createPreviewServer({ repoRoot: docsRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    const reposPayload = await getJson(`${baseUrl}/api/repos`);
    assert.deepEqual(reposPayload.repositories.map((repo) => repo.id), ["docs-repo"]);
    assert.equal(Object.hasOwn(reposPayload.repositories[0], "shareToken"), false);
    assert.equal(reposPayload.repositories[0]?.canEdit, true);

    const treePayload = await getJson(`${baseUrl}/api/tree?repo=docs-repo`);
    assert.equal(treePayload.repo, "docs-repo");
    assert.equal(treePayload.tree.some((node) => node.name === "content.md"), true);

    const documentPayload = await getJson(
      `${baseUrl}/api/document?repo=docs-repo&file=content.md`,
    );
    assert.equal(documentPayload.repo, "docs-repo");
    assert.equal(documentPayload.repoRoot, docsRoot);
    assert.equal(documentPayload.branch, "main");
    assert.equal(documentPayload.canEdit, true);
    assert.equal(documentPayload.path, "content.md");
  } finally {
    await close(server);
  }
});

test("non-main repositories remain locally editable", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-repos-"));
  const repoRoot = path.join(rootDir, "branch-repo");
  await mkdir(repoRoot, { recursive: true });
  await writeFile(path.join(repoRoot, "branch.md"), "# Branch Preview\n");

  const initialFile = await resolvePreviewPath(repoRoot, "branch.md");
  const repository = {
    id: "branch-repo",
    name: "branch-repo",
    root: repoRoot,
    defaultFile: "branch.md",
    branch: "feature/non-main-editing",
    detached: false,
    githubBlobRoot: null,
  };
  const server = createPreviewServer({ repoRoot, initialFile, repository });
  const baseUrl = await listen(server);

  try {
    const reposPayload = await getJson(`${baseUrl}/api/repos?repo=branch-repo`);
    const currentRepo = reposPayload.repositories.find((repo) => repo.id === "branch-repo");
    assert.equal(reposPayload.currentRepo, "branch-repo");
    assert.equal(reposPayload.canEdit, true);
    assert.equal(currentRepo?.branch, "feature/non-main-editing");
    assert.equal(currentRepo?.canEdit, true);

    const documentPayload = await getJson(
      `${baseUrl}/api/document?repo=branch-repo&file=branch.md`,
    );
    assert.equal(documentPayload.repo, "branch-repo");
    assert.equal(documentPayload.branch, "feature/non-main-editing");
    assert.equal(documentPayload.canEdit, true);
    assert.equal(documentPayload.path, "branch.md");
    assert.equal(documentPayload.source, "# Branch Preview\n");
    assert.match(documentPayload.html, /Branch Preview/);

    const writeResponse = await fetch(`${baseUrl}/api/document?repo=branch-repo&file=branch.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "# Changed\n" }),
    });
    assert.equal(writeResponse.ok, true);
    assert.equal(await readFile(path.join(repoRoot, "branch.md"), "utf8"), "# Changed\n");
  } finally {
    await close(server);
  }
});

test("document payload can explicitly omit source and local paths", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n\nBody\n");

  const payload = await documentPayload(
    {
      id: "docs-repo",
      branch: "main",
      root: repoRoot,
      githubBlobRoot: "https://github.com/ExampleOrg/docs-repo/blob/main",
    },
    "sample.md",
    { includeSource: false, canEdit: false },
  );

  assert.equal(payload.repo, "docs-repo");
  assert.equal(payload.branch, "main");
  assert.equal(payload.canEdit, false);
  assert.equal(payload.path, "sample.md");
  assert.equal(payload.githubUrl, "https://github.com/ExampleOrg/docs-repo/blob/main/sample.md");
  assert.deepEqual(payload.sourceLines, [
    { number: 1, text: "# Sample" },
    { number: 2, text: "" },
    { number: 3, text: "Body" },
  ]);
  assert.equal(Object.hasOwn(payload, "source"), false);
  assert.equal(Object.hasOwn(payload, "repoRoot"), false);
  assert.equal(Object.hasOwn(payload, "absolutePath"), false);
  assert.equal(Object.hasOwn(payload, "changeBaselineAvailable"), false);
  assert.equal(Object.hasOwn(payload, "changeBaselineSource"), false);
});

test("worktree API lists linked worktrees and detached writes create a protection branch", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-server-worktrees-"));
  const repoRoot = path.join(rootDir, "docs-repo");
  const detachedRoot = path.join(rootDir, "docs-review");
  await mkdir(repoRoot, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Tests"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "# Docs\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: repoRoot });
  await execFileAsync("git", ["worktree", "add", "--detach", detachedRoot, "HEAD"], { cwd: repoRoot });

  const repository = await createRepositoryInfo({ repoRoot: detachedRoot });
  const initialFile = await resolvePreviewPath(detachedRoot, "README.md");
  const server = createPreviewServer({
    repoRoot: detachedRoot,
    initialFile,
    repository,
    desktopPreferences: {},
  });
  const baseUrl = await listen(server);

  try {
    const worktreePayload = await getJson(`${baseUrl}/api/worktrees?repo=docs-repo`);
    assert.equal(worktreePayload.worktrees.length, 2);
    assert.equal(worktreePayload.canSwitch, true);
    assert.equal(worktreePayload.worktrees.find((item) => item.current)?.detached, true);

    const invalidResponse = await fetch(`${baseUrl}/api/document?repo=docs-repo&file=README.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: 42 }),
    });
    const { stdout: detachedBranchOutput } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd: detachedRoot,
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(detachedBranchOutput.trim(), "");

    const response = await fetch(`${baseUrl}/api/document?repo=docs-repo&file=README.md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "# Protected edit\n" }),
    });
    const payload = await response.json();
    const { stdout: branchOutput } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd: detachedRoot,
    });

    assert.equal(response.ok, true);
    assert.equal(payload.branchCreated, true);
    assert.match(payload.branch, /^openglance\/detached-[a-f0-9]{7}-/);
    assert.equal(branchOutput.trim(), payload.branch);
    assert.equal(await readFile(path.join(detachedRoot, "README.md"), "utf8"), "# Protected edit\n");

    const refreshed = await getJson(`${baseUrl}/api/worktrees?repo=docs-repo`);
    assert.equal(refreshed.worktrees.find((item) => item.current)?.branch, payload.branch);
    assert.equal(refreshed.worktrees.find((item) => item.current)?.detached, false);
  } finally {
    await close(server);
  }
});

test("worktree API stops listing a linked worktree after its directory is removed", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-removed-worktree-"));
  const repoRoot = path.join(rootDir, "docs-repo");
  const removedRoot = path.join(rootDir, "removed-review");
  await mkdir(repoRoot, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Tests"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "# Docs\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: repoRoot });
  await execFileAsync("git", ["worktree", "add", "--detach", removedRoot, "HEAD"], { cwd: repoRoot });

  const repository = await createRepositoryInfo({ repoRoot });
  const initialFile = await resolvePreviewPath(repoRoot, "README.md");
  const server = createPreviewServer({
    repoRoot,
    initialFile,
    repository,
    desktopPreferences: {},
  });
  const baseUrl = await listen(server);

  try {
    const initial = await getJson(`${baseUrl}/api/worktrees?repo=docs-repo`);
    assert.equal(initial.worktrees.length, 2);

    await rm(removedRoot, { recursive: true, force: true });
    const refreshed = await getJson(`${baseUrl}/api/worktrees?repo=docs-repo`);
    assert.equal(refreshed.worktrees.length, 1);
    assert.equal(refreshed.worktrees[0].current, true);
  } finally {
    await close(server);
  }
});

test("public module assets are served for the browser", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");
  const initialFile = await resolvePreviewPath(repoRoot, "sample.md");
  const server = createPreviewServer({ repoRoot, initialFile });
  const baseUrl = await listen(server);

  try {
    for (const asset of [
      "app.js",
      "image-preview.js",
      "line-selection.js",
      "agent-context.js",
      "layout.js",
      "ui-tooltip.js",
      "tree-item-tooltip.js",
      "tree-file-title.js",
      "file-capability.js",
      "ndjson.js",
      "csv-preview.js",
      "file-actions.js",
      "pointer-resize.js",
      "outline.js",
      "tree-refresh.js",
      "document-refresh.js",
      "document-changes.js",
      "chart-tooltip.js",
      "dataset-view.js",
      "mermaid-layout.js",
      "mermaid-view.js",
      "mermaid-renderer.bundle.js",
      "source-sync.js",
      "source-split.js",
      "mode-preference.js",
      "theme-preference.js",
      "settings-preferences.js",
      "sidebar-favorites.js",
      "sidebar-navigation.js",
      "i18n.js",
      "workbench-locales.js",
      "file-tree-visibility.js",
      "document-tabs.js",
      "document-search.js",
      "keyboard-shortcuts.js",
      "repository-panel.js",
      "help-content.js",
      "frontmatter-filters.js",
      "frontmatter-edit.js",
      "git-sync-ui.js",
      "update-ui.js",
      "tree-state.js",
      "workbench-session.js",
      "workbench-startup.js",
      "telemetry.js",
      "source-editor.bundle.js",
    ]) {
      const response = await fetch(`${baseUrl}/${asset}`);
      assert.equal(response.ok, true, `${asset} should be served`);
      assert.match(response.headers.get("content-type") ?? "", /text\/javascript/);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
  } finally {
    await close(server);
  }
});

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}

async function readNextServerSentEvent(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      assert.equal(done, false, "watch stream ended before an event arrived");
      buffer += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  const eventMatch = buffer.match(/^event: (.+)$/m);
  const dataMatch = buffer.match(/^data: (.+)$/m);
  assert.ok(eventMatch, `missing SSE event line in ${buffer}`);
  assert.ok(dataMatch, `missing SSE data line in ${buffer}`);
  return {
    event: eventMatch[1],
    data: JSON.parse(dataMatch[1]),
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function fakeToolVersionMonitor({ startupFingerprint }) {
  return {
    startupFingerprint,
    checkForUpdate: async () => ({
      fingerprint: startupFingerprint,
      startupFingerprint,
      stale: false,
    }),
  };
}

function normalizeCheckoutLineEndings(value) {
  return value.replaceAll("\r\n", "\n");
}
