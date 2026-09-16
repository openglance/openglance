import assert from "node:assert/strict";
import test from "node:test";

import {
  activateDocumentTab,
  activeDocumentLocation,
  closeDocumentTab,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  documentTabBehaviorFromModifiers,
  documentTabHistoryAvailability,
  documentTabPresentations,
  isTreeDocumentNewTabShortcut,
  moveDocumentTabHistory,
  navigateDocumentTab,
  normalizeDocumentTabs,
  reorderDocumentTabs,
  removeDocumentTabPath,
  replaceDocumentTabPath,
  tabTitleFromPath,
  treeDocumentTabBehaviorFromModifiers,
  updateActiveDocumentTabLocation,
} from "../public/document-tabs.js";

function tab(id, path, entries = [{ path }], index = entries.length - 1) {
  return {
    id,
    path,
    history: { entries, index },
  };
}

function location(path, { hash = "", scrollTop = 0 } = {}) {
  return { path, hash, scrollTop };
}

test("desktop document navigation reuses an existing tab with its history and otherwise opens a new tab", () => {
  const tabs = [tab("readme", "README.md"), tab("guide", "guide.md", [location("guide.md", { scrollTop: 120 })])];
  const reused = navigateDocumentTab({ tabs, activeTabId: "readme", location: { path: "guide.md" }, behavior: "reuse" });
  assert.equal(reused.activeTabId, "guide");
  assert.equal(reused.tabs.length, 2);
  assert.equal(reused.location.scrollTop, 120);
  const opened = navigateDocumentTab({ ...reused, location: { path: "new.md" }, behavior: "reuse" });
  assert.equal(opened.tabs.length, 3);
  assert.equal(opened.location.path, "new.md");
  assert.deepEqual(opened.tabs.slice(0, 2), reused.tabs);
  const repeated = navigateDocumentTab({ ...opened, location: { path: "new.md" }, behavior: "reuse" });
  assert.equal(repeated.activeTabId, opened.activeTabId);
  assert.equal(repeated.tabs.length, 3);
});

test("tabTitleFromPath shows the file name", () => {
  assert.equal(tabTitleFromPath("docs/guides/github-apps-management.md"), "github-apps-management.md");
});

test("document tabs show a human title beneath an opaque Markdown filename", () => {
  const path = "teachers/15a634e2-8056-4915-ab8a-21cf55aa4363.md";
  const presentations = documentTabPresentations({
    tabs: [tab("tab-1", path)],
    tree: [{
      type: "directory",
      name: "teachers",
      children: [{
        type: "file",
        kind: "markdown",
        name: "15a634e2-8056-4915-ab8a-21cf55aa4363.md",
        path,
        title: "Teacher profile",
      }],
    }],
  });

  assert.deepEqual(presentations, [{
    id: "tab-1",
    path,
    filename: "15a634e2-8056-4915-ab8a-21cf55aa4363.md",
    title: "Teacher profile",
  }]);
});

test("document tabs keep readable Chinese filenames and titleless files on one line", () => {
  const presentations = documentTabPresentations({
    tabs: [tab("tab-1", "教师档案.md"), tab("tab-2", "notes.txt")],
    tree: [
      {
        type: "file",
        kind: "markdown",
        name: "教师档案.md",
        path: "教师档案.md",
        title: "Teacher profile",
      },
      {
        type: "file",
        kind: "text",
        name: "notes.txt",
        path: "notes.txt",
      },
    ],
  });

  assert.deepEqual(
    presentations.map(({ filename, title }) => ({ filename, title })),
    [
      { filename: "教师档案.md", title: "" },
      { filename: "notes.txt", title: "" },
    ],
  );
});

test("document tabs use the shortest unique path when filename and title both repeat", () => {
  const presentations = documentTabPresentations({
    tabs: [tab("tab-1", "guides/README.md"), tab("tab-2", "api/README.md")],
    tree: [
      {
        type: "directory",
        name: "guides",
        children: [{
          type: "file",
          kind: "markdown",
          name: "README.md",
          path: "guides/README.md",
          title: "Overview",
        }],
      },
      {
        type: "directory",
        name: "api",
        children: [{
          type: "file",
          kind: "markdown",
          name: "README.md",
          path: "api/README.md",
          title: "Overview",
        }],
      },
    ],
  });

  assert.deepEqual(
    presentations.map(({ filename, title }) => ({ filename, title })),
    [
      { filename: "guides/README.md", title: "Overview" },
      { filename: "api/README.md", title: "Overview" },
    ],
  );
});

test("the loaded current document title wins over stale tree metadata", () => {
  const path = "reports/weekly-report.md";
  const [presentation] = documentTabPresentations({
    tabs: [tab("tab-1", path)],
    tree: [{
      type: "file",
      kind: "markdown",
      name: "weekly-report.md",
      path,
      title: "Last week",
    }],
    currentDocument: {
      kind: "markdown",
      path,
      title: "This week",
    },
  });

  assert.equal(presentation.title, "This week");
});

test("internal-link modifiers select current, background, and foreground tab intents", () => {
  assert.equal(documentTabBehaviorFromModifiers(), "current");
  assert.equal(documentTabBehaviorFromModifiers({ shiftKey: true }), "current");
  assert.equal(documentTabBehaviorFromModifiers({ metaKey: true }), "background");
  assert.equal(documentTabBehaviorFromModifiers({ ctrlKey: true }), "background");
  assert.equal(documentTabBehaviorFromModifiers({ metaKey: true, shiftKey: true }), "foreground");
});

test("file-tree modifiers reuse the active tab unless Command or Ctrl is held", () => {
  assert.equal(treeDocumentTabBehaviorFromModifiers(), "current");
  assert.equal(treeDocumentTabBehaviorFromModifiers({ shiftKey: true }), "current");
  assert.equal(treeDocumentTabBehaviorFromModifiers({ metaKey: true }), "foreground");
  assert.equal(treeDocumentTabBehaviorFromModifiers({ ctrlKey: true }), "foreground");
  assert.equal(
    treeDocumentTabBehaviorFromModifiers({ metaKey: true, shiftKey: true }),
    "foreground",
  );
});

test("Command-Enter and Ctrl-Enter are file-tree new-tab shortcuts", () => {
  assert.equal(isTreeDocumentNewTabShortcut({ key: "Enter", metaKey: true }), true);
  assert.equal(isTreeDocumentNewTabShortcut({ key: "Enter", ctrlKey: true }), true);
  assert.equal(isTreeDocumentNewTabShortcut({ key: "Enter" }), false);
  assert.equal(
    isTreeDocumentNewTabShortcut({ key: "Enter", metaKey: true, shiftKey: true }),
    false,
  );
  assert.equal(
    isTreeDocumentNewTabShortcut({ key: "Enter", metaKey: true, altKey: true }),
    false,
  );
  assert.equal(isTreeDocumentNewTabShortcut({ key: "Space", metaKey: true }), false);
});

test("normal document navigation replaces the active third tab and records its own history", () => {
  const result = navigateDocumentTab({
    tabs: [tab("tab-1", "AGENTS.md"), tab("tab-2", "CONTRIBUTING.md"), tab("tab-3", "README.md")],
    activeTabId: "tab-3",
    location: location("docs/architecture.md"),
  });

  assert.deepEqual(result.tabs.map((item) => item.path), [
    "AGENTS.md",
    "CONTRIBUTING.md",
    "docs/architecture.md",
  ]);
  assert.equal(result.activeTabId, "tab-3");
  assert.deepEqual(result.tabs[2].history.entries.map((entry) => entry.path), [
    "README.md",
    "docs/architecture.md",
  ]);
});

test("back and forward stay in the active tab instead of activating a sibling tab", () => {
  const tabs = [
    tab("tab-1", "README.md"),
    tab("tab-2", "CONTRIBUTING.md"),
    tab("tab-3", "docs/architecture.md", [location("README.zh-CN.md"), location("docs/architecture.md")]),
  ];

  const back = moveDocumentTabHistory({ tabs, activeTabId: "tab-3", direction: -1 });
  assert.equal(back.activeTabId, "tab-3");
  assert.deepEqual(activeDocumentLocation(back), location("README.zh-CN.md"));
  assert.deepEqual(back.tabs.map((item) => item.path), ["README.md", "CONTRIBUTING.md", "README.zh-CN.md"]);

  const forward = moveDocumentTabHistory({
    tabs: back.tabs,
    activeTabId: back.activeTabId,
    direction: 1,
  });
  assert.equal(forward.activeTabId, "tab-3");
  assert.deepEqual(activeDocumentLocation(forward), location("docs/architecture.md"));
});

test("histories remain independent when two tabs visit the same document", () => {
  const tabs = [
    tab("tab-1", "README.md", [location("AGENTS.md"), location("README.md")]),
    tab("tab-2", "README.md", [location("CONTRIBUTING.md"), location("README.md")]),
  ];

  const result = moveDocumentTabHistory({ tabs, activeTabId: "tab-2", direction: -1 });
  assert.equal(result.activeTabId, "tab-2");
  assert.equal(result.tabs[0].path, "README.md");
  assert.equal(result.tabs[1].path, "CONTRIBUTING.md");
  assert.equal(result.tabs[0].history.index, 1);
  assert.equal(result.tabs[1].history.index, 0);
});

test("new navigation after Back clears only that tab's forward branch", () => {
  const tabs = [
    tab("tab-1", "README.md", [
      location("AGENTS.md"),
      location("README.md"),
      location("release.md"),
    ], 1),
    tab("tab-2", "CONTRIBUTING.md", [location("CONTRIBUTING.md"), location("SECURITY.md")]),
  ];

  const result = navigateDocumentTab({
    tabs,
    activeTabId: "tab-1",
    location: location("docs/architecture.md"),
  });
  assert.deepEqual(result.tabs[0].history.entries.map((entry) => entry.path), [
    "AGENTS.md",
    "README.md",
    "docs/architecture.md",
  ]);
  assert.equal(result.tabs[1].history.entries.at(-1).path, "SECURITY.md");
  assert.deepEqual(documentTabHistoryAvailability(result), { canGoBack: true, canGoForward: false });
});

test("Command-style background navigation creates an independent background tab", () => {
  const result = navigateDocumentTab({
    tabs: [tab("tab-1", "README.md", [location("AGENTS.md"), location("README.md")])],
    activeTabId: "tab-1",
    location: location("docs/architecture.md", { hash: "#L12" }),
    behavior: "background",
  });

  assert.equal(result.activeTabId, "tab-1");
  assert.deepEqual(result.tabs.map((item) => item.path), ["README.md", "docs/architecture.md"]);
  assert.deepEqual(result.tabs[0].history.entries.map((entry) => entry.path), ["AGENTS.md", "README.md"]);
  assert.deepEqual(result.tabs[1].history, {
    entries: [location("docs/architecture.md", { hash: "#L12" })],
    index: 0,
  });
});

test("Command-Shift-style foreground navigation activates the new tab", () => {
  const result = navigateDocumentTab({
    tabs: [tab("tab-1", "README.md")],
    activeTabId: "tab-1",
    location: location("docs/architecture.md"),
    behavior: "foreground",
  });

  assert.notEqual(result.activeTabId, "tab-1");
  assert.equal(result.tabs.find((item) => item.id === result.activeTabId)?.path, "docs/architecture.md");
});

test("tab activation does not add a document-history entry", () => {
  const result = activateDocumentTab({
    tabs: [
      tab("tab-1", "README.md", [location("AGENTS.md"), location("README.md")]),
      tab("tab-2", "CONTRIBUTING.md"),
    ],
    activeTabId: "tab-1",
    targetTabId: "tab-2",
  });

  assert.equal(result.activeTabId, "tab-2");
  assert.deepEqual(result.tabs[0].history.entries.map((entry) => entry.path), ["AGENTS.md", "README.md"]);
});

test("scroll state is kept on the current history entry before leaving a document", () => {
  const updated = updateActiveDocumentTabLocation({
    tabs: [tab("tab-1", "README.md")],
    activeTabId: "tab-1",
    location: { scrollTop: 360 },
  });
  const result = navigateDocumentTab({
    tabs: updated.tabs,
    activeTabId: updated.activeTabId,
    location: location("docs/architecture.md"),
  });

  const back = moveDocumentTabHistory({
    tabs: result.tabs,
    activeTabId: result.activeTabId,
    direction: -1,
  });
  assert.equal(activeDocumentLocation(back).scrollTop, 360);
});

test("close and reorder use stable tab IDs, even when document paths repeat", () => {
  const tabs = [tab("tab-1", "README.md"), tab("tab-2", "README.md"), tab("tab-3", "CONTRIBUTING.md")];
  const reordered = reorderDocumentTabs({
    tabs,
    sourceTabId: "tab-3",
    targetTabId: "tab-1",
    placement: "before",
  });
  assert.deepEqual(reordered.map((item) => item.id), ["tab-3", "tab-1", "tab-2"]);

  const closed = closeDocumentTab({
    tabs: reordered,
    activeTabId: "tab-2",
    targetTabId: "tab-1",
  });
  assert.equal(closed.activeTabId, "tab-2");
  assert.deepEqual(closed.tabs.map((item) => item.id), ["tab-3", "tab-2"]);
});

test("close other and close right retain the correct active tab identity", () => {
  const tabs = [tab("tab-1", "AGENTS.md"), tab("tab-2", "README.md"), tab("tab-3", "release.md")];
  const others = closeOtherDocumentTabs({ tabs, targetTabId: "tab-2" });
  assert.deepEqual(others.tabs.map((item) => item.id), ["tab-2"]);
  assert.equal(others.activeTabId, "tab-2");

  const right = closeDocumentTabsToRight({
    tabs,
    activeTabId: "tab-3",
    targetTabId: "tab-2",
  });
  assert.deepEqual(right.tabs.map((item) => item.id), ["tab-1", "tab-2"]);
  assert.equal(right.activeTabId, "tab-2");
});

test("renaming a document updates every current and historical entry", () => {
  const result = replaceDocumentTabPath({
    tabs: [
      tab("tab-1", "README.md", [location("old.md"), location("README.md")]),
      tab("tab-2", "old.md", [location("old.md")]),
    ],
    fromPath: "old.md",
    toPath: "new.md",
  });

  assert.equal(result[1].path, "new.md");
  assert.deepEqual(result[0].history.entries.map((entry) => entry.path), ["new.md", "README.md"]);
  assert.equal(result[1].history.entries[0].path, "new.md");
});

test("deleting a document removes it from every history and closes only tabs left empty", () => {
  const result = removeDocumentTabPath({
    tabs: [
      tab("tab-1", "deleted.md", [location("README.md"), location("deleted.md")]),
      tab("tab-2", "deleted.md", [location("deleted.md")]),
      tab("tab-3", "guide.md", [location("deleted.md"), location("guide.md")]),
    ],
    activeTabId: "tab-2",
    filePath: "deleted.md",
  });

  assert.deepEqual(result.tabs.map((item) => item.id), ["tab-1", "tab-3"]);
  assert.deepEqual(result.tabs.map((item) => item.path), ["README.md", "guide.md"]);
  assert.equal(result.activeTabId, "tab-3");
  assert.equal(result.tabs.every((item) => (
    item.history.entries.every((entry) => entry.path !== "deleted.md")
  )), true);
});

test("legacy path-only tabs hydrate into stable identities and one-entry histories", () => {
  const tabs = normalizeDocumentTabs([{ path: "README.md" }, { path: "README.md" }, { path: "AGENTS.md" }]);
  assert.deepEqual(tabs.map((item) => item.path), ["README.md", "README.md", "AGENTS.md"]);
  assert.equal(new Set(tabs.map((item) => item.id)).size, 3);
  assert.deepEqual(tabs[0].history, { entries: [location("README.md")], index: 0 });
});

test("tab history accepts only repository-relative document paths", () => {
  const tabs = normalizeDocumentTabs([
    { path: "../another-repository/README.md" },
    { path: "/absolute/README.md" },
    { path: "docs/./guide.md" },
  ]);

  assert.deepEqual(tabs.map((item) => item.path), ["docs/guide.md"]);

  const result = navigateDocumentTab({
    tabs,
    activeTabId: tabs[0].id,
    location: location("../../outside.md"),
    behavior: "background",
  });
  assert.equal(result.openedTabId, "");
  assert.deepEqual(result.tabs.map((item) => item.path), ["docs/guide.md"]);
});
