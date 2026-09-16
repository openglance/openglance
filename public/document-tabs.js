import { documentTitleForFile } from "./tree-file-title.js";

export const MAX_DOCUMENT_TAB_HISTORY_ENTRIES = 50;

export function tabTitleFromPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) || normalized || "Untitled";
}

export function documentTabPresentations({
  tabs = [],
  tree = [],
  currentDocument = null,
} = {}) {
  const normalizedTabs = normalizeDocumentTabs(tabs);
  const filesByPath = new Map();
  indexDocumentTabFiles(tree, filesByPath);

  const currentPath = normalizePath(currentDocument?.path);
  if (currentPath) {
    filesByPath.set(currentPath, {
      ...filesByPath.get(currentPath),
      ...currentDocument,
      name: filesByPath.get(currentPath)?.name || tabTitleFromPath(currentPath),
      path: currentPath,
    });
  }

  const presentations = normalizedTabs.map(({ id, path }) => ({
    id,
    path,
    filename: tabTitleFromPath(path),
    title: documentTitleForFile(filesByPath.get(path)),
  }));
  const collisionGroups = new Map();
  for (const presentation of presentations) {
    const key = `${presentation.filename}\0${presentation.title}`;
    const group = collisionGroups.get(key) ?? [];
    group.push(presentation);
    collisionGroups.set(key, group);
  }
  for (const group of collisionGroups.values()) {
    if (group.length < 2) {
      continue;
    }
    const paths = group.map(({ path }) => path);
    for (const presentation of group) {
      presentation.filename = shortestUniquePathSuffix(presentation.path, paths);
    }
  }
  return presentations;
}

export function documentTabBehaviorFromModifiers({
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
} = {}) {
  const opensSeparateTab = metaKey || ctrlKey;
  if (opensSeparateTab && shiftKey) {
    return "foreground";
  }
  return opensSeparateTab ? "background" : "current";
}

export function treeDocumentTabBehaviorFromModifiers({
  metaKey = false,
  ctrlKey = false,
} = {}) {
  return metaKey || ctrlKey ? "foreground" : "current";
}

export function isTreeDocumentNewTabShortcut({
  key = "",
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  isComposing = false,
} = {}) {
  return (
    !isComposing &&
    String(key).toLowerCase() === "enter" &&
    (metaKey || ctrlKey) &&
    !shiftKey &&
    !altKey
  );
}

export function normalizeDocumentTabs(tabs = []) {
  if (!Array.isArray(tabs)) {
    return [];
  }

  const usedIds = new Set();
  let generatedId = 1;
  const nextId = () => {
    while (usedIds.has(`tab-${generatedId}`)) {
      generatedId += 1;
    }
    const id = `tab-${generatedId}`;
    generatedId += 1;
    return id;
  };

  const normalized = [];
  for (const rawTab of tabs) {
    const fallbackPath = normalizePath(rawTab?.path);
    const history = normalizeHistory(rawTab?.history, fallbackPath);
    if (!history) {
      continue;
    }

    const requestedId = normalizeTabId(rawTab?.id);
    const id = requestedId && !usedIds.has(requestedId) ? requestedId : nextId();
    usedIds.add(id);
    const current = history.entries[history.index];
    normalized.push({ id, path: current.path, history });
  }
  return normalized;
}

export function resolveActiveDocumentTabId({ tabs = [], activeTabId = "", activePath = "" } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const requestedId = normalizeTabId(activeTabId);
  if (requestedId && normalized.some((tab) => tab.id === requestedId)) {
    return requestedId;
  }

  const requestedPath = normalizePath(activePath);
  return normalized.find((tab) => tab.path === requestedPath)?.id || normalized[0]?.id || "";
}

export function activeDocumentTab({ tabs = [], activeTabId = "" } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const id = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  return normalized.find((tab) => tab.id === id) || null;
}

export function activeDocumentPath({ tabs = [], activeTabId = "" } = {}) {
  return activeDocumentTab({ tabs, activeTabId })?.path || "";
}

export function activeDocumentLocation({ tabs = [], activeTabId = "" } = {}) {
  const tab = activeDocumentTab({ tabs, activeTabId });
  return tab ? { ...tab.history.entries[tab.history.index] } : null;
}

export function navigateDocumentTab({
  tabs = [],
  activeTabId = "",
  location,
  behavior = "current",
} = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const activeId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  const target = normalizeLocation(location);
  if (!target) {
    return navigationResult(normalized, activeId);
  }

  if (behavior === "reuse") {
    const existing = normalized.find((tab) => tab.id === activeId && tab.path === target.path)
      ?? normalized.find((tab) => tab.path === target.path);
    if (existing) return navigationResult(normalized, existing.id);
  }

  if (behavior === "background" || behavior === "foreground" || behavior === "reuse") {
    const nextTab = createDocumentTab(normalized, target);
    const nextTabs = [...normalized, nextTab];
    return navigationResult(nextTabs, behavior === "background" ? activeId : nextTab.id, nextTab.id);
  }

  const activeIndex = normalized.findIndex((tab) => tab.id === activeId);
  if (activeIndex < 0) {
    const nextTab = createDocumentTab(normalized, target);
    return navigationResult([nextTab], nextTab.id, nextTab.id);
  }

  const activeTab = normalized[activeIndex];
  const current = activeTab.history.entries[activeTab.history.index];
  if (sameAddress(current, target)) {
    return navigationResult(normalized, activeId);
  }

  const entries = [...activeTab.history.entries.slice(0, activeTab.history.index + 1), target];
  const trimmedEntries = entries.slice(-MAX_DOCUMENT_TAB_HISTORY_ENTRIES);
  const nextTab = {
    ...activeTab,
    path: target.path,
    history: {
      entries: trimmedEntries,
      index: trimmedEntries.length - 1,
    },
  };
  const nextTabs = normalized.map((tab, index) => index === activeIndex ? nextTab : tab);
  return navigationResult(nextTabs, activeId);
}

export function activateDocumentTab({ tabs = [], activeTabId = "", targetTabId = "" } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const activeId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  const requestedId = normalizeTabId(targetTabId);
  const nextId = normalized.some((tab) => tab.id === requestedId) ? requestedId : activeId;
  return navigationResult(normalized, nextId);
}

export function moveDocumentTabHistory({ tabs = [], activeTabId = "", direction = 0 } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const activeId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  const activeIndex = normalized.findIndex((tab) => tab.id === activeId);
  const step = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0;
  if (activeIndex < 0 || step === 0) {
    return navigationResult(normalized, activeId);
  }

  const activeTab = normalized[activeIndex];
  const historyIndex = Math.max(0, Math.min(
    activeTab.history.entries.length - 1,
    activeTab.history.index + step,
  ));
  if (historyIndex === activeTab.history.index) {
    return navigationResult(normalized, activeId);
  }

  const location = activeTab.history.entries[historyIndex];
  const nextTab = {
    ...activeTab,
    path: location.path,
    history: { ...activeTab.history, index: historyIndex },
  };
  const nextTabs = normalized.map((tab, index) => index === activeIndex ? nextTab : tab);
  return navigationResult(nextTabs, activeId);
}

export function documentTabHistoryAvailability({ tabs = [], activeTabId = "" } = {}) {
  const activeTab = activeDocumentTab({ tabs, activeTabId });
  if (!activeTab) {
    return { canGoBack: false, canGoForward: false };
  }
  return {
    canGoBack: activeTab.history.index > 0,
    canGoForward: activeTab.history.index < activeTab.history.entries.length - 1,
  };
}

export function updateActiveDocumentTabLocation({ tabs = [], activeTabId = "", location = {} } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const activeId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  const activeIndex = normalized.findIndex((tab) => tab.id === activeId);
  if (activeIndex < 0) {
    return navigationResult(normalized, activeId);
  }

  const activeTab = normalized[activeIndex];
  const current = activeTab.history.entries[activeTab.history.index];
  const nextLocation = normalizeLocation({
    path: location.path ?? current.path,
    hash: location.hash ?? current.hash,
    scrollTop: location.scrollTop ?? current.scrollTop,
  });
  if (!nextLocation || sameLocation(current, nextLocation)) {
    return navigationResult(normalized, activeId);
  }

  const entries = activeTab.history.entries.map((entry, index) =>
    index === activeTab.history.index ? nextLocation : entry,
  );
  const nextTab = {
    ...activeTab,
    path: nextLocation.path,
    history: { ...activeTab.history, entries },
  };
  const nextTabs = normalized.map((tab, index) => index === activeIndex ? nextTab : tab);
  return navigationResult(nextTabs, activeId);
}

export function closeDocumentTab({ tabs = [], activeTabId = "", targetTabId = "" } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const activeId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  const targetId = normalizeTabId(targetTabId);
  const closeIndex = normalized.findIndex((tab) => tab.id === targetId);
  if (closeIndex < 0) {
    return navigationResult(normalized, activeId);
  }

  const nextTabs = normalized.filter((_, index) => index !== closeIndex);
  if (nextTabs.length === 0) {
    return navigationResult([], "");
  }
  if (targetId !== activeId) {
    return navigationResult(nextTabs, activeId);
  }

  return navigationResult(nextTabs, nextTabs[Math.min(closeIndex, nextTabs.length - 1)].id);
}

export function closeOtherDocumentTabs({ tabs = [], targetTabId = "" } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const targetId = normalizeTabId(targetTabId);
  const target = normalized.find((tab) => tab.id === targetId);
  return target ? navigationResult([target], target.id) : navigationResult(normalized, normalized[0]?.id || "");
}

export function closeDocumentTabsToRight({ tabs = [], activeTabId = "", targetTabId = "" } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const activeId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  const targetId = normalizeTabId(targetTabId);
  const targetIndex = normalized.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0 || targetIndex === normalized.length - 1) {
    return navigationResult(normalized, activeId);
  }

  const nextTabs = normalized.slice(0, targetIndex + 1);
  const nextActiveId = nextTabs.some((tab) => tab.id === activeId) ? activeId : targetId;
  return navigationResult(nextTabs, nextActiveId);
}

export function reorderDocumentTabs({ tabs = [], sourceTabId = "", targetTabId = "", placement = "before" } = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const sourceId = normalizeTabId(sourceTabId);
  const targetId = normalizeTabId(targetTabId);
  const sourceIndex = normalized.findIndex((tab) => tab.id === sourceId);
  const targetIndex = normalized.findIndex((tab) => tab.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return normalized;
  }

  const [source] = normalized.splice(sourceIndex, 1);
  const nextTargetIndex = normalized.findIndex((tab) => tab.id === targetId);
  normalized.splice(placement === "after" ? nextTargetIndex + 1 : nextTargetIndex, 0, source);
  return normalized;
}

export function replaceDocumentTabPath({ tabs = [], fromPath, toPath } = {}) {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  const normalized = normalizeDocumentTabs(tabs);
  if (!from || !to || from === to) {
    return normalized;
  }

  return normalized.map((tab) => {
    const entries = tab.history.entries.map((entry) => entry.path === from ? { ...entry, path: to } : entry);
    const current = entries[tab.history.index];
    return {
      ...tab,
      path: current.path,
      history: { ...tab.history, entries },
    };
  });
}

export function removeDocumentTabPath({
  tabs = [],
  activeTabId = "",
  filePath = "",
} = {}) {
  const normalized = normalizeDocumentTabs(tabs);
  const activeId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  const targetPath = normalizePath(filePath);
  if (!targetPath) {
    return navigationResult(normalized, activeId);
  }

  const activeIndex = normalized.findIndex((tab) => tab.id === activeId);
  const nextTabs = [];
  for (const tab of normalized) {
    const entries = tab.history.entries.filter((entry) => entry.path !== targetPath);
    if (entries.length === 0) {
      continue;
    }
    const removedThroughCurrent = tab.history.entries
      .slice(0, tab.history.index + 1)
      .filter((entry) => entry.path === targetPath)
      .length;
    const index = Math.max(0, Math.min(
      entries.length - 1,
      tab.history.index - removedThroughCurrent,
    ));
    nextTabs.push({
      ...tab,
      path: entries[index].path,
      history: { entries, index },
    });
  }

  if (nextTabs.length === 0) {
    return navigationResult([], "");
  }
  if (nextTabs.some((tab) => tab.id === activeId)) {
    return navigationResult(nextTabs, activeId);
  }
  const fallbackIndex = Math.max(0, Math.min(activeIndex, nextTabs.length - 1));
  return navigationResult(nextTabs, nextTabs[fallbackIndex].id);
}

function navigationResult(tabs, activeTabId, openedTabId = "") {
  const normalized = normalizeDocumentTabs(tabs);
  const resolvedId = resolveActiveDocumentTabId({ tabs: normalized, activeTabId });
  return {
    tabs: normalized,
    activeTabId: resolvedId,
    openedTabId,
    location: activeDocumentLocation({ tabs: normalized, activeTabId: resolvedId }),
  };
}

function createDocumentTab(tabs, location) {
  const id = nextDocumentTabId(tabs);
  return {
    id,
    path: location.path,
    history: { entries: [location], index: 0 },
  };
}

function nextDocumentTabId(tabs) {
  const usedIds = new Set(tabs.map((tab) => tab.id));
  let index = 1;
  while (usedIds.has(`tab-${index}`)) {
    index += 1;
  }
  return `tab-${index}`;
}

function indexDocumentTabFiles(nodes, index) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.type === "file") {
      const path = normalizePath(node.path);
      if (path) {
        index.set(path, {
          ...node,
          name: String(node.name || tabTitleFromPath(path)),
          path,
        });
      }
      continue;
    }
    if (node?.type === "directory") {
      indexDocumentTabFiles(node.children, index);
    }
  }
}

function shortestUniquePathSuffix(filePath, peerPaths) {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  const peers = peerPaths.map((path) => normalizePath(path).split("/").filter(Boolean));
  for (let length = 2; length <= parts.length; length += 1) {
    const suffix = parts.slice(-length).join("/");
    const matches = peers.filter((peer) => peer.slice(-length).join("/") === suffix).length;
    if (matches === 1) {
      return suffix;
    }
  }
  return tabTitleFromPath(filePath);
}

function normalizeHistory(value, fallbackPath) {
  const rawEntries = Array.isArray(value?.entries) ? value.entries : [];
  const entries = rawEntries.map(normalizeLocation).filter(Boolean);
  if (entries.length === 0) {
    const initial = normalizeLocation({ path: fallbackPath });
    return initial ? { entries: [initial], index: 0 } : null;
  }

  const requestedIndex = Number.isInteger(value?.index) ? value.index : entries.length - 1;
  const boundedIndex = Math.max(0, Math.min(entries.length - 1, requestedIndex));
  const start = entries.length > MAX_DOCUMENT_TAB_HISTORY_ENTRIES
    ? Math.min(
      Math.max(0, boundedIndex - (MAX_DOCUMENT_TAB_HISTORY_ENTRIES - 1)),
      entries.length - MAX_DOCUMENT_TAB_HISTORY_ENTRIES,
    )
    : 0;
  const trimmedEntries = entries.slice(start, start + MAX_DOCUMENT_TAB_HISTORY_ENTRIES);
  return {
    entries: trimmedEntries,
    index: Math.max(0, Math.min(trimmedEntries.length - 1, boundedIndex - start)),
  };
}

function normalizeLocation(value) {
  const path = normalizePath(value?.path);
  if (!path) {
    return null;
  }
  return {
    path,
    hash: normalizeHash(value?.hash),
    scrollTop: normalizeScrollTop(value?.scrollTop),
  };
}

function normalizePath(value) {
  const rawPath = String(value || "").replace(/\\/g, "/").trim();
  if (
    !rawPath ||
    rawPath.startsWith("/") ||
    /^[a-zA-Z]:/.test(rawPath) ||
    rawPath.split("/").some((segment) => segment === "..")
  ) {
    return "";
  }
  return rawPath.split("/").filter((segment) => segment && segment !== ".").join("/");
}

function normalizeHash(value) {
  const hash = String(value || "").trim();
  if (!hash) {
    return "";
  }
  return hash.startsWith("#") ? hash.slice(0, 512) : `#${hash.slice(0, 511)}`;
}

function normalizeScrollTop(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.round(number), 10_000_000) : 0;
}

function normalizeTabId(value) {
  const id = String(value || "").trim();
  return id && id.length <= 128 ? id : "";
}

function sameLocation(left, right) {
  return left.path === right.path && left.hash === right.hash && left.scrollTop === right.scrollTop;
}

function sameAddress(left, right) {
  return left.path === right.path && left.hash === right.hash;
}
