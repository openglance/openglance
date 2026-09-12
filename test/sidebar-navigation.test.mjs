import assert from "node:assert/strict";
import test from "node:test";

import {
  sidebarControlsForView,
  sidebarEmptyStateKind,
  normalizeSidebarTab,
  shouldShowSparseFavoritesGuidance,
  sidebarTabFromKey,
  sidebarTabFromShortcut,
  sidebarTreeForView,
} from "../public/sidebar-navigation.js";

const tree = [
  { type: "file", name: "README.md", path: "README.md", kind: "markdown" },
  {
    type: "directory",
    name: "docs",
    children: [
      { type: "file", name: "guide.md", path: "docs/guide.md", kind: "markdown" },
      { type: "file", name: "plan.md", path: "docs/plan.md", kind: "markdown" },
    ],
  },
];

test("sidebar navigation defaults to all and supports tablist arrow keys", () => {
  assert.equal(normalizeSidebarTab("invalid"), "all");
  assert.equal(sidebarTabFromKey("all", "ArrowRight"), "favorites");
  assert.equal(sidebarTabFromKey("all", "ArrowLeft"), "sync");
  assert.equal(sidebarTabFromKey("sync", "Home"), "all");
  assert.equal(sidebarTabFromKey("all", "End"), "sync");
  assert.equal(sidebarTabFromKey("favorites", "Enter"), "");
});

test("sidebar views have direct non-conflicting option number shortcuts", () => {
  assert.equal(sidebarTabFromShortcut({
    key: "¡",
    code: "Digit1",
    altKey: true,
  }), "all");
  assert.equal(sidebarTabFromShortcut({
    key: "™",
    code: "Digit2",
    altKey: true,
  }), "favorites");
  assert.equal(sidebarTabFromShortcut({
    key: "£",
    code: "Digit3",
    altKey: true,
  }), "sync");
  assert.equal(sidebarTabFromShortcut({
    key: "2",
    code: "Numpad2",
    altKey: true,
  }), "favorites");
  assert.equal(sidebarTabFromShortcut({
    key: "1",
    code: "Digit1",
    metaKey: true,
    altKey: true,
  }), "");
  assert.equal(sidebarTabFromShortcut({
    key: "4",
    code: "Digit4",
    altKey: true,
  }), "");
  assert.equal(sidebarTabFromShortcut({
    key: "1",
    code: "Digit1",
    ctrlKey: true,
    shiftKey: true,
  }), "");
  assert.equal(sidebarTabFromShortcut({
    key: "1",
    code: "Digit1",
    altKey: true,
    shiftKey: true,
  }), "");
});

test("only the all view exposes search and frontmatter filters", () => {
  assert.equal(sidebarControlsForView("all"), "search-and-filter");
  assert.equal(sidebarControlsForView("favorites"), "none");
  assert.equal(sidebarControlsForView("sync"), "sync");
  assert.equal(sidebarControlsForView("invalid"), "search-and-filter");
});

test("search and filters affect only the all view empty state", () => {
  assert.equal(sidebarEmptyStateKind({
    view: "all",
    search: "missing",
  }), "filtered");
  assert.equal(sidebarEmptyStateKind({
    view: "all",
    frontmatterFilterCount: 1,
  }), "filtered");
  assert.equal(sidebarEmptyStateKind({ view: "favorites" }), "favorites");
  assert.equal(sidebarEmptyStateKind({ view: "sync" }), "sync");
  assert.equal(sidebarEmptyStateKind({
    view: "favorites",
    search: "missing",
  }), "favorites");
  assert.equal(sidebarEmptyStateKind({
    view: "favorites",
    frontmatterFilterCount: 1,
  }), "favorites");
  assert.equal(sidebarEmptyStateKind({
    view: "sync",
    search: "missing",
  }), "sync");
  assert.equal(sidebarEmptyStateKind({
    view: "sync",
    frontmatterFilterCount: 1,
  }), "sync");
});

test("favorites guidance stays visible only while the saved list is sparse", () => {
  assert.equal(shouldShowSparseFavoritesGuidance({
    view: "favorites",
    favoriteCount: 0,
  }), false);
  assert.equal(shouldShowSparseFavoritesGuidance({
    view: "favorites",
    favoriteCount: 1,
  }), true);
  assert.equal(shouldShowSparseFavoritesGuidance({
    view: "favorites",
    favoriteCount: 2,
  }), true);
  assert.equal(shouldShowSparseFavoritesGuidance({
    view: "favorites",
    favoriteCount: 3,
  }), false);
  assert.equal(shouldShowSparseFavoritesGuidance({
    view: "all",
    favoriteCount: 1,
  }), false);
});

test("favorites view contains explicit folders and documents in saved order", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "favorites",
    favorites: [
      { type: "directory", path: "docs" },
      { type: "document", path: "README.md" },
    ],
  }), [{ ...tree[1], path: "docs" }, tree[0]]);
});

test("sync view keeps only changed files with their directory ancestry", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    changedPaths: ["docs/plan.md"],
  }), [{
    type: "directory",
    name: "docs",
    children: [
      { type: "file", name: "plan.md", path: "docs/plan.md", kind: "markdown" },
    ],
  }]);
  assert.deepEqual(sidebarTreeForView(tree, { view: "sync" }), []);
});

test("sync view adds a readonly node for a deleted file missing from the tree", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    changedPaths: ["docs/removed.md"],
  }), [{
    type: "directory",
    name: "docs",
    children: [{
      type: "file",
      name: "removed.md",
      path: "docs/removed.md",
      kind: "readonly",
      missing: true,
    }],
  }]);
});

test("sync view builds missing directory ancestry for deleted git changes", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    gitChanges: [
      { path: "archive/2025/removed.md", status: "deleted" },
      { path: "docs/guide.md", status: "modified" },
    ],
  }), [
    {
      type: "directory",
      name: "archive",
      children: [{
        type: "directory",
        name: "2025",
        children: [{
          type: "file",
          name: "removed.md",
          path: "archive/2025/removed.md",
          kind: "readonly",
          missing: true,
        }],
      }],
    },
    {
      type: "directory",
      name: "docs",
      children: [
        { type: "file", name: "guide.md", path: "docs/guide.md", kind: "markdown" },
      ],
    },
  ]);
});

test("sync view does not duplicate an existing file node", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    changedPaths: ["docs/plan.md"],
    gitChanges: [{ path: "docs/plan.md", status: "deleted" }],
  }), [{
    type: "directory",
    name: "docs",
    children: [
      { type: "file", name: "plan.md", path: "docs/plan.md", kind: "markdown" },
    ],
  }]);
});

test("sync inserts deleted paths with folders first and natural name order", () => {
  const existing = [
    { type: "directory", name: "docs10", children: [
      { type: "file", name: "chapter10.md", path: "docs10/chapter10.md" },
    ] },
    { type: "file", name: "10.md", path: "10.md" },
  ];
  const result = sidebarTreeForView(existing, {
    view: "sync",
    changedPaths: ["10.md", "docs10/chapter10.md"],
    gitChanges: ["2.md", "docs2/README.md", "_draft10/README.md", "_draft2/README.md",
      "docs10/chapter2.md", "docs10/nested/README.md"].map((path) => ({ path, status: "deleted" })),
  });
  assert.deepEqual(result.map((node) => node.name), ["docs2", "docs10", "_draft2", "_draft10", "2.md", "10.md"]);
  assert.deepEqual(result[1].children.map((node) => node.name), ["nested", "chapter2.md", "chapter10.md"]);
});
