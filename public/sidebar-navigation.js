import { favoriteNodesFromTree } from "./sidebar-favorites.js";

export const SIDEBAR_TABS = Object.freeze(["all", "favorites", "sync"]);
const SPARSE_FAVORITES_LIMIT = 2;

export function normalizeSidebarTab(value) {
  return SIDEBAR_TABS.includes(value) ? value : "all";
}

export function sidebarTabFromKey(currentTab, key) {
  const currentIndex = SIDEBAR_TABS.indexOf(normalizeSidebarTab(currentTab));
  if (key === "Home") {
    return SIDEBAR_TABS[0];
  }
  if (key === "End") {
    return SIDEBAR_TABS.at(-1);
  }
  if (key === "ArrowLeft") {
    return SIDEBAR_TABS[(currentIndex - 1 + SIDEBAR_TABS.length) % SIDEBAR_TABS.length];
  }
  if (key === "ArrowRight") {
    return SIDEBAR_TABS[(currentIndex + 1) % SIDEBAR_TABS.length];
  }
  return "";
}

export function sidebarTabFromShortcut({
  key = "",
  code = "",
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
} = {}) {
  if (!altKey || metaKey || ctrlKey || shiftKey) {
    return "";
  }
  const physicalKeyMatch = /^(?:Digit|Numpad)([1-3])$/.exec(String(code));
  const keyMatch = /^([1-3])$/.exec(String(key));
  const index = Number((physicalKeyMatch ?? keyMatch)?.[1]) - 1;
  return SIDEBAR_TABS[index] ?? "";
}

export function sidebarControlsForView(view) {
  const normalizedView = normalizeSidebarTab(view);
  if (normalizedView === "all") {
    return "search-and-filter";
  }
  if (normalizedView === "sync") {
    return "sync";
  }
  return "none";
}

export function sidebarEmptyStateKind({
  view = "all",
  search = "",
  frontmatterFilterCount = 0,
} = {}) {
  const normalizedView = normalizeSidebarTab(view);
  const filtering = normalizedView === "all" && (
    String(search).trim().length > 0 ||
    Number(frontmatterFilterCount) > 0
  );
  return filtering ? "filtered" : normalizedView;
}

export function shouldShowSparseFavoritesGuidance({
  view = "all",
  favoriteCount = 0,
} = {}) {
  const count = Number(favoriteCount);
  return normalizeSidebarTab(view) === "favorites"
    && Number.isInteger(count)
    && count > 0
    && count <= SPARSE_FAVORITES_LIMIT;
}

export function sidebarTreeForView(nodes, {
  view = "all",
  favorites = [],
  changedPaths = [],
  gitChanges = [],
} = {}) {
  const normalizedView = normalizeSidebarTab(view);
  if (normalizedView === "favorites") {
    return favoriteNodesFromTree(nodes, favorites);
  }
  if (normalizedView === "sync") {
    return syncTree(nodes, { changedPaths, gitChanges });
  }
  return Array.isArray(nodes) ? nodes : [];
}

function syncTree(nodes, { changedPaths, gitChanges }) {
  const changes = normalizeChanges({ changedPaths, gitChanges });
  const paths = new Set(changes.map((change) => change.path));
  const existingFiles = new Set();
  const existingDirectories = new Map();
  indexTree(nodes, "", { existingFiles, existingDirectories });

  const filtered = filterChangedNodes(nodes, paths);
  for (const change of changes) {
    if (
      existingFiles.has(change.path) ||
      (change.status && change.status !== "deleted")
    ) {
      continue;
    }
    insertReadonlyFile(filtered, change.path, existingDirectories);
    existingFiles.add(change.path);
  }
  return filtered;
}

function filterChangedNodes(nodes, changedPaths) {
  const filtered = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.type === "file") {
      if (changedPaths.has(normalizeRelativePath(node.path))) {
        filtered.push(node);
      }
      continue;
    }
    if (node?.type !== "directory") {
      continue;
    }
    const children = filterChangedNodes(node.children, changedPaths);
    if (children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function normalizeChanges({ changedPaths, gitChanges }) {
  const changes = new Map();
  const pathValues = changedPaths instanceof Set || Array.isArray(changedPaths)
    ? changedPaths
    : [];
  for (const value of pathValues) {
    const path = normalizeRelativePath(typeof value === "string" ? value : value?.path);
    if (path) {
      changes.set(path, {
        path,
        status: typeof value?.status === "string" ? value.status : "",
      });
    }
  }
  for (const value of Array.isArray(gitChanges) ? gitChanges : []) {
    const path = normalizeRelativePath(value?.path);
    if (!path) {
      continue;
    }
    changes.set(path, {
      path,
      status: typeof value.status === "string" ? value.status : "",
    });
  }
  return [...changes.values()];
}

function indexTree(nodes, parentPath, { existingFiles, existingDirectories }) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.type === "file") {
      const path = normalizeRelativePath(node.path);
      if (path) {
        existingFiles.add(path);
      }
      continue;
    }
    if (node?.type !== "directory") {
      continue;
    }
    const path = normalizeRelativePath([parentPath, node.name].filter(Boolean).join("/"));
    if (!path) {
      continue;
    }
    existingDirectories.set(path, node);
    indexTree(node.children, path, { existingFiles, existingDirectories });
  }
}

function insertReadonlyFile(nodes, filePath, existingDirectories) {
  const parts = filePath.split("/");
  const name = parts.pop();
  let children = nodes;
  let parentPath = "";

  for (const part of parts) {
    const directoryPath = [parentPath, part].filter(Boolean).join("/");
    let directory = children.find((node) => (
      node?.type === "directory" && node.name === part
    ));
    if (!directory) {
      const existing = existingDirectories.get(directoryPath);
      directory = {
        ...(existing ?? {}),
        type: "directory",
        name: part,
        children: [],
      };
      insertNode(children, directory);
    }
    children = directory.children;
    parentPath = directoryPath;
  }

  if (children.some((node) => (
    node?.type === "file" && normalizeRelativePath(node.path) === filePath
  ))) {
    return;
  }
  insertNode(children, {
    type: "file",
    name,
    path: filePath,
    kind: "readonly",
    missing: true,
  });
}

function insertNode(nodes, node) {
  const index = nodes.findIndex((candidate) => compareTreeNodes(node, candidate) < 0);
  nodes.splice(index < 0 ? nodes.length : index, 0, node);
}

function compareTreeNodes(left, right) {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }
  if (left.type === "directory") {
    const leftUnderscoreRank = left.name.startsWith("_") ? 1 : 0;
    const rightUnderscoreRank = right.name.startsWith("_") ? 1 : 0;
    if (leftUnderscoreRank !== rightUnderscoreRank) {
      return leftUnderscoreRank - rightUnderscoreRank;
    }
  }
  return left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true });
}

function normalizeRelativePath(value) {
  const path = String(value ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
  if (
    !path ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return "";
  }
  return path;
}
