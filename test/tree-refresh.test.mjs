import assert from "node:assert/strict";
import test from "node:test";

import { hasTreeChanged } from "../public/tree-refresh.js";

test("hasTreeChanged detects repository markdown tree changes", () => {
  const previous = [{ type: "file", name: "README.md", path: "README.md" }];
  const same = [{ type: "file", name: "README.md", path: "README.md" }];
  const next = [
    { type: "file", name: "README.md", path: "README.md" },
    { type: "file", name: "new.md", path: "new.md" },
  ];

  assert.equal(hasTreeChanged(previous, same), false);
  assert.equal(hasTreeChanged(previous, next), true);
});

test("hasTreeChanged refreshes a visible document title without changing its path", () => {
  const previous = [{
    type: "file",
    name: "weekly-report.md",
    path: "weekly-report.md",
    kind: "markdown",
    title: "本周报告",
  }];
  const next = [{
    ...previous[0],
    title: "本周报告与下周计划",
  }];

  assert.equal(hasTreeChanged(previous, next), true);
});

test("successful local title edits update only their existing tree entry without file discovery", async () => {
  const { updateTreeDocumentTitle } = await import("../public/tree-refresh.js");
  const tree = [{ type: "directory", name: "docs", children: [{ type: "file", path: "docs/a.md", title: "Old" }] }];
  assert.equal(updateTreeDocumentTitle(tree, "docs/a.md", "New"), true);
  assert.equal(tree[0].children[0].title, "New");
  assert.equal(updateTreeDocumentTitle(tree, "docs/a.md", "New"), false);
  assert.equal(updateTreeDocumentTitle(tree, "docs/a.md", ""), true);
  assert.equal(tree[0].children[0].title, undefined);
  assert.equal(updateTreeDocumentTitle(tree, "missing.md", "Unknown"), false);
});
