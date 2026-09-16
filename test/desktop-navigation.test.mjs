import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import path from "node:path";

import { classifyDesktopNavigation, openActiveWorkbenchDocument } from "../src/desktop/navigation.mjs";
import { DESKTOP_OPEN_DOCUMENT_EVENT, createDesktopDocumentNavigationHandler } from "../public/desktop-document-navigation.js";

function workbench({ prepareNavigation = async () => {}, navigate = async () => true, ready = true } = {}) {
  const window = new EventTarget();
  const errors = [];
  window.addEventListener(DESKTOP_OPEN_DOCUMENT_EVENT, createDesktopDocumentNavigationHandler({
    isReady: () => ready,
    getWorktreeId: () => "primary-worktree",
    prepareNavigation,
    navigate,
    onError: (error) => errors.push(error),
  }));
  const server = { repoRoot: path.resolve("primary"), url: "http://127.0.0.1:4317/", worktreeId: "primary-worktree" };
  const webContents = {
    getURL: () => server.url,
    executeJavaScript: (source) => vm.runInNewContext(source, { window, CustomEvent }),
  };
  const open = (file = "README.md", overrides = {}) => openActiveWorkbenchDocument({
    server, webContents, repoRoot: server.repoRoot, file, ...overrides,
  });
  return { open, errors, server, webContents };
}

test("a current-worktree link waits for pending edits and the actual document navigation", async () => {
  const calls = [];
  let saved;
  const saving = new Promise((resolve) => { saved = resolve; });
  const { open } = workbench({
    prepareNavigation: async () => { calls.push("saving"); await saving; },
    navigate: async (file) => { calls.push(file); return true; },
  });
  const opening = open("docs/guide.md");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["saving"]);
  saved();
  assert.equal(await opening, true);
  assert.deepEqual(calls, ["saving", "docs/guide.md"]);
});

test("save failures and missing documents are handled failures, never permission to replace the workbench", async () => {
  let navigated = false;
  const failedSave = workbench({
    prepareNavigation: async () => { throw new Error("write failed"); },
    navigate: async () => { navigated = true; return true; },
  });
  assert.equal(await failedSave.open(), false);
  assert.equal(navigated, false);
  assert.equal(failedSave.errors.length, 1);
  assert.equal(await workbench({ navigate: async () => false }).open("missing.md"), false);
});

test("worktree identity and the active page bound desktop reuse", async () => {
  const { open, server, webContents } = workbench();
  assert.equal(await open("README.md", { repoRoot: path.resolve("linked") }), null);
  assert.equal(await open("README.md", { server: { ...server, worktreeId: "linked-worktree" } }), null);
  assert.equal(await open("README.md", { webContents: { ...webContents, getURL: () => "data:text/html,home" } }), null);
  assert.equal(await workbench({ ready: false }).open(), null);
  assert.equal(await open("../outside.md"), false);
  assert.equal(await open(path.join(server.repoRoot, "README.md")), true);
});

test("successive desktop links finish in order and continue after a failed navigation", async () => {
  const calls = [];
  const { open } = workbench({ navigate: async (file) => {
    calls.push(file);
    await new Promise((resolve) => setImmediate(resolve));
    return file !== "missing.md";
  } });
  assert.deepEqual(await Promise.all([open("missing.md"), open("README.md")]), [false, true]);
  assert.deepEqual(calls, ["missing.md", "README.md"]);
});

test("opening the active repository without a file keeps its current document", async () => {
  const { open } = workbench({ navigate: async () => { assert.fail("No document was requested"); } });
  assert.equal(await open(""), true);
});

test("desktop navigation keeps only same-origin OpenGlance URLs inside the app", () => {
  const currentUrl = "http://127.0.0.1:4317/?repo=docs-repo&file=README.md";

  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "http://127.0.0.1:4317/?repo=docs-repo&file=docs%2Fguide.md",
    }),
    "internal",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "https://github.com/example-org/docs-repo",
    }),
    "external",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "mailto:ops@example.com",
    }),
    "external",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "file:///Users/maintainer/secret.md",
    }),
    "blocked",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "javascript:alert(1)",
    }),
    "blocked",
  );
});
