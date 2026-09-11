import {
  formatLineRange,
  formatLineReference,
  hashFromLines,
  lineFromGutterPoint,
  parseLineHash,
  selectionForSourceRange,
  sourceLinesFromMarkdown,
  shouldClearLineSelection,
} from "./line-selection.js";
import {
  addAgentContextItem,
  agentContextItemLabel,
  agentContextScopeKey,
  createAgentContextItem,
  formatAgentContextMarkdown,
  readAgentContextItems,
  removeAgentContextItem,
  writeAgentContextItems,
} from "./agent-context.js";
import {
  DOCUMENT_OUTLINE_DEFAULT_WIDTH,
  DOCUMENT_OUTLINE_MAX_WIDTH,
  DOCUMENT_OUTLINE_MIN_WIDTH,
  clampDocumentOutlineWidth,
  clampSidebarWidth,
  documentOutlineWidthFromStorageValue,
  sidebarCollapsedFromStorageValue,
  sidebarWidthFromStorageValue,
} from "./layout.js";
import { createUiTooltip, elementIsOverflowing } from "./ui-tooltip.js";
import { attachHorizontalPointerResize } from "./pointer-resize.js";
import {
  activeOutlineIdForSourceLine,
  createOutlineActiveViewportState,
  createOutlineClickViewportGuard,
  outlineItemsFromHeadings,
} from "./outline.js";
import { createTreeItemTooltipSource } from "./tree-item-tooltip.js";
import { treeDirectoryPresentation, treeFilePresentation } from "./tree-file-title.js";
import {
  shouldShowReadonlyModeStatus,
  treeFileCapability,
} from "./file-capability.js";
import { parseNdjsonRecords } from "./ndjson.js";
import { csvMarkdownDocumentLink, parseCsvRows } from "./csv-preview.js";
import { githubFileUrl } from "./file-actions.js";
import { hasTreeChanged } from "./tree-refresh.js";
import {
  documentStatusRefreshKind,
  shouldReplaceDocumentHtml,
  withDocumentChangeBaseline,
} from "./document-refresh.js";
import {
  changedOutlineTargets,
  createDocumentChangeModel,
  emptyDocumentChangeModel,
  sourceRangeHasChanged,
} from "./document-changes.js";
import { attachChartTooltips } from "./chart-tooltip.js";
import { attachDatasetViews } from "./dataset-view.js";
import { attachMermaidDiagrams } from "./mermaid-view.js";
import {
  sourceLineFromPreviewScroll,
  sourceLineForPreviewSync,
  syncLabelForState,
} from "./source-sync.js";
import {
  clampSourcePreviewRatio,
  sourcePreviewRatioFromStorageValue,
} from "./source-split.js";
import {
  modeFromStorageValue,
  readModePreference,
  writeModePreference,
} from "./mode-preference.js";
import {
  nextTheme,
  readThemePreference,
  writeThemePreference,
} from "./theme-preference.js";
import {
  DEFAULT_USER_PREFERENCES,
  LEGACY_USER_PREFERENCES,
  effectiveColorScheme,
  normalizeUserPreferences,
  shouldRebuildFileTreeForPreferences,
} from "./settings-preferences.js";
import { filterWorkbenchFileTree } from "./file-tree-visibility.js";
import {
  applySidebarFavoriteOperation,
  createSidebarFavoriteToggleQueue,
  isSidebarFavoriteEntry,
  isToggleFavoriteShortcut,
  missingSidebarFavoritesFromTree,
  normalizeSidebarFavoriteScopes,
  normalizeSidebarFavorites,
  replaceSidebarFavoritePath,
  sidebarFavoritesForScope,
} from "./sidebar-favorites.js";
import {
  SIDEBAR_TABS,
  normalizeSidebarTab,
  sidebarControlsForView,
  sidebarEmptyStateKind,
  sidebarTabFromKey,
  sidebarTabFromShortcut,
  sidebarTreeForView,
  shouldShowSparseFavoritesGuidance,
} from "./sidebar-navigation.js";
import {
  activateDocumentTab,
  activeDocumentLocation,
  activeDocumentPath,
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
  resolveActiveDocumentTabId,
  tabTitleFromPath,
  treeDocumentTabBehaviorFromModifiers,
  updateActiveDocumentTabLocation,
} from "./document-tabs.js";
import {
  normalizeWorkbenchSessions,
  serializeWorkbenchSession,
  workbenchSessionForLaunch,
  workbenchSessionForRepo,
} from "./workbench-session.js";
import {
  getKeyboardShortcutGroups,
  isKeyboardShortcutsHelpShortcut,
} from "./keyboard-shortcuts.js";
import {
  findTextRanges,
  nextSearchIndex,
} from "./document-search.js";
import {
  getOpenGlanceHelpSections,
  getFileTypeHelpRows,
} from "./help-content.js";
import {
  createTranslator,
  localizeDocument,
  resolveLocalePreference,
} from "./i18n.js";
import { WORKBENCH_MESSAGES } from "./workbench-locales.js";
import {
  completeWorkbenchStartup,
  restoreDocumentTabsForStartup,
} from "./workbench-startup.js";
import {
  directoryMatchesTextFilter,
  fileTextFilterMatchDetails,
  fileMatchesTextFilter,
  fileMatchesFrontmatterFilters,
  filterTextTree,
  normalizeFrontmatterFilters,
  textFilterMatchRanges,
} from "./frontmatter-filters.js";
import {
  addFrontmatterFieldToSource,
  deleteFrontmatterLineFromSource,
  frontmatterKeysFromSource,
  frontmatterLineForValue,
} from "./frontmatter-edit.js";
import {
  automaticRemoteMergeDelayMs,
  automaticRemoteMergeFailureIsBlocking,
  automaticRemoteMergeShouldWaitForEditor,
  hasGitChangesChanged,
  remoteSyncCheckDue,
  remoteSyncDecision,
  remoteSyncIntervalMs,
} from "./git-sync-ui.js";
import { sidebarUpdateView } from "./update-ui.js";
import {
  defaultRepositoryPanelSelection,
  moveRepositoryPanelSelection,
  normalizeRepositoryPanelItems,
  reorderRepositoryPanelItems,
  repositoryPanelActionUrl,
  repositoryHeaderUsesWorktreeSelector,
  repositoryPanelItemForShortcut,
  repositoryPanelReorderUrl,
  visibleRepositoryPanelItems,
} from "./repository-panel.js";
import {
  normalizeTreeDirectoryStates,
  serializeTreeDirectoryState,
  shouldRecordTreeDirectoryToggle,
  shouldOpenTreeDirectory,
  treeAncestorDirectories,
  treeDirectoryPath,
  treeDirectoryStateForView,
  treeDirectoryStatesFromPreference,
  treeDirectoryStateScope,
} from "./tree-state.js";
import {
  createSourceEditor,
  imageLineAttributes,
  imageLineForAction,
  normalizeImageAlign,
  normalizeImageCaption,
  normalizeImageWidth,
} from "./source-editor.bundle.js";
import {
  flushRendererTelemetry,
  recordTelemetryFeature,
  setTelemetryMode,
} from "./telemetry.js";
import {
  attachImageLoadState,
  enhanceImageLoadStates,
} from "./image-preview.js";

const SIDEBAR_WIDTH_STORAGE_KEY = "git-leaf-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "git-leaf-sidebar-collapsed";
const DOCUMENT_OUTLINE_COLLAPSED_STORAGE_KEY = "git-leaf-document-outline-collapsed";
const DOCUMENT_OUTLINE_WIDTH_STORAGE_KEY = "git-leaf-document-outline-width";
const SOURCE_SPLIT_STORAGE_KEY = "git-leaf-source-preview-ratio";
const TREE_DIRECTORY_STORAGE_KEY = "git-leaf-tree-directories";
const WORKBENCH_SESSION_STORAGE_KEY = "git-leaf-workbench-sessions";
const SIDEBAR_FAVORITES_STORAGE_KEY = "git-leaf-sidebar-favorites";
const SIDEBAR_WIDTH_STEP = 24;
const DOCUMENT_OUTLINE_WIDTH_STEP = 24;
const SOURCE_SPLIT_STEP = 5;
const NDJSON_RECORD_BATCH_SIZE = 100;
const TREE_REFRESH_INTERVAL_MS = 5000;
const SOURCE_SYNC_DELAY_MS = 500;
const AUTOMATIC_REMOTE_MERGE_IDLE_MS = 2500;
const GIT_STATUS_REFRESH_DELAY_MS = 800;
const TOOL_STATUS_CHECK_INTERVAL_MS = 30_000;
const TOOL_RESTART_WAIT_INTERVAL_MS = 150;
const TOOL_RESTART_WAIT_TIMEOUT_MS = 5_000;
const EDITING_TELEMETRY_INTERVAL_MS = 5 * 60 * 1000;
const DOCUMENT_SEARCH_MATCH_HIGHLIGHT = "git-leaf-document-search-match";
const DOCUMENT_SEARCH_ACTIVE_HIGHLIGHT = "git-leaf-document-search-active";
const OUTLINE_CONTENT_NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);
const initialSearchParams = new URLSearchParams(window.location.search);
const initialDesktopPreferences = readInitialDesktopPreferences();
const initialLegacyThemeMigrationPending =
  initialDesktopPreferences?.legacyThemeMigrationPending === true;
const initialUserPreferences = normalizeUserPreferences(
  initialDesktopPreferences
    ? {
        ...initialDesktopPreferences,
        ...(initialLegacyThemeMigrationPending
          ? { colorMode: readThemePreference() }
          : {}),
      }
    : { theme: readThemePreference() },
  {
    defaults: initialDesktopPreferences ? DEFAULT_USER_PREFERENCES : LEGACY_USER_PREFERENCES,
  },
);
const initialLocale = resolveLocalePreference(
  window.OPENGLANCE_INITIAL_LOCALE
    ?? initialDesktopPreferences?.resolvedLanguage
    ?? initialDesktopPreferences?.language
    ?? "system",
  window.navigator.languages ?? [window.navigator.language],
);
const t = createTranslator(WORKBENCH_MESSAGES, initialLocale);
localizeDocument(document, t);
const systemColorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
const initialWorkbenchSessions = readWorkbenchSessions({ preferences: initialDesktopPreferences });
const initialRepoId = initialSearchParams.get("repo") ||
  (initialSearchParams.has("file") ? window.OPENGLANCE_INITIAL_REPO : null) ||
  window.OPENGLANCE_INITIAL_REPO;
const initialWorktreeId = window.OPENGLANCE_WORKTREE_ID || initialRepoId;
const requestedInitialFile = initialSearchParams.get("file") || window.OPENGLANCE_INITIAL_FILE;
const initialWorkbenchSession = workbenchSessionForLaunch(
  initialWorkbenchSessions,
  initialWorktreeId,
  requestedInitialFile,
);
const initialDocumentTabs = normalizeDocumentTabs(
  initialWorkbenchSession?.tabs ?? (requestedInitialFile ? [{ path: requestedInitialFile }] : []),
);
const initialActiveTabId = resolveActiveDocumentTabId({
  tabs: initialDocumentTabs,
  activeTabId: initialWorkbenchSession?.activeTabId,
  activePath: initialWorkbenchSession?.activeTabPath || requestedInitialFile,
});
const initialFile = activeDocumentPath({
  tabs: initialDocumentTabs,
  activeTabId: initialActiveTabId,
});
let fileSearchTelemetryActive = false;
let documentSearchTelemetryActive = false;
let lastEditingTelemetryAt = 0;
const outlineClickViewportGuard = createOutlineClickViewportGuard();
const outlineActiveViewportState = createOutlineActiveViewportState();

const state = {
  tree: [],
  currentRepo: initialRepoId,
  currentWorktreeId: initialWorktreeId,
  worktrees: [],
  canSwitchWorktrees: false,
  currentFile: initialFile,
  currentDocument: null,
  documentChangeModel: emptyDocumentChangeModel(),
  showDeletedChanges: false,
  documentTabs: initialDocumentTabs,
  activeTabId: initialActiveTabId,
  activeTabPath: initialFile || "",
  documentNavigationRequestId: 0,
  canEdit: window.OPENGLANCE_CAN_EDIT !== false,
  currentRepoBranch: "main",
  currentRepoDetached: false,
  currentRepoCanEdit: window.OPENGLANCE_CAN_EDIT !== false,
  repositories: [],
  mode: readModePreference({ preferences: initialDesktopPreferences }),
  colorMode: initialUserPreferences.colorMode,
  theme: effectiveColorScheme(initialUserPreferences.colorMode, {
    systemDark: systemColorSchemeQuery?.matches === true,
  }),
  documentFont: initialUserPreferences.documentFont,
  documentFontSize: initialUserPreferences.documentFontSize,
  fileTreeMode: initialUserPreferences.fileTreeMode,
  showDocumentTitles: initialUserPreferences.showDocumentTitles,
  gitRemoteCheckIntervalMinutes: initialUserPreferences.gitRemoteCheckIntervalMinutes,
  sidebarTab: "all",
  sidebarFavorites: [],
  sidebarFavoritesAvailable: false,
  locale: initialLocale,
  sidebarCollapsed: false,
  documentOutlineCollapsed: false,
  desktopPreferences: initialDesktopPreferences ?? {},
  desktopPreferencesAvailable: initialDesktopPreferences !== null,
  filter: "",
  searchAutoExpandedTreeDirectories: new Set(),
  searchExpandedTreeDirectories: new Set(),
  searchCollapsedTreeDirectories: new Set(),
  selectedLines: new Set(),
  selectionAnchor: null,
  agentContextItems: [],
  agentContextLoadedScopeKey: "",
  activeAgentContextItemId: "",
  activeImage: null,
  activeLink: null,
  activeFrontmatterField: null,
  statusTimer: null,
  treeTimer: null,
  watchStream: null,
  sourceEditor: null,
  sourceSyncTimer: null,
  sourceWriteInFlight: false,
  lastSourceEditAt: 0,
  sourceRevision: 0,
  scrollSyncSource: null,
  lastSourceVisibleLine: null,
  lastPreviewVisibleLine: null,
  selectionPopoverFrame: null,
  anchoredSourceLineGutterFrame: null,
  lastWrittenHash: null,
  outlineItems: [],
  copyToastTimer: null,
  frontmatterAllowedKeys: [],
  frontmatterFilters: [],
  frontmatterFacets: null,
  frontmatterFiles: {},
  frontmatterActiveKey: "domain",
  frontmatterFacetsLoading: false,
  gitChanges: [],
  gitSyncNotes: new Map(),
  gitStatusTimer: null,
  remoteSync: {
    ok: null,
    state: "checking",
    checkedAt: "",
    updatedAt: "",
    ahead: 0,
    behind: 0,
    incomingCount: 0,
    incomingFiles: [],
    head: "",
    remoteCommit: "",
    error: "",
  },
  remoteSyncTimer: null,
  remoteSyncOperation: "",
  remoteSyncRequestId: 0,
  lastRemoteSyncAttemptAt: 0,
  remoteSyncAutoMergeFailedKey: "",
  remoteSyncAutoMergeBlockedKey: "",
  remoteSyncAutoMergeDeferredKey: "",
  remoteSyncAutoMergeTimer: null,
  remoteSyncPreparedMerge: null,
  remoteSyncApplyingDocumentPath: "",
  sidebarShortcutFeedbackTimer: null,
  treeOperationFeedbackTimer: null,
  treeOperationFeedbackElement: null,
  lastToolStatusCheckAt: 0,
  toolRestartInFlight: false,
  toolFingerprint: "",
  treeDirectoryStates: readTreeDirectoryStates({ preferences: initialDesktopPreferences }),
  expandedTreeDirectories: new Set(),
  collapsedTreeDirectories: new Set(),
  workbenchSessions: initialWorkbenchSessions,
  workbenchSessionTimer: null,
  pendingWorkbenchTreeViewportRestore: Boolean(initialWorkbenchSession),
  lastTreeFocus: initialWorkbenchSession?.treeFocus ?? null,
  documentSearchQuery: "",
  documentSearchMatches: [],
  documentSearchIndex: -1,
  documentSearchReturnFocus: null,
  fileActionTarget: null,
  fileActionReturnFocus: null,
  fileTreePointerReturnFocus: null,
  documentTabPointerDrag: null,
  activeDialog: null,
  repositoryPanelItems: [],
  repositoryPanelVisibleItems: [],
  repositoryPanelSelectedId: "",
  repositoryPanelDraggingId: "",
  repositoryPanelPointerDrag: null,
  repositoryPanelReturnFocus: null,
};

const queueSidebarFavoriteToggle = createSidebarFavoriteToggleQueue({
  isActive: ({ type, path }) => isFavoriteItem(type, path),
  setActive: setSidebarFavorite,
});

const appShell = document.querySelector("#app-shell");
const workbenchLoading = document.querySelector("#workbench-loading");
const previewPane = document.querySelector(".preview-pane");
const sidebar = document.querySelector(".sidebar");
const workspaceSidebarHeader = document.querySelector("#workspace-sidebar-header");
const fileTree = document.querySelector("#file-tree");
const sidebarTreeTabs = document.querySelector("#sidebar-tree-tabs");
const sidebarTabButtons = [...document.querySelectorAll("[data-sidebar-tab]")];
const sidebarSyncCount = document.querySelector("#sidebar-sync-count");
const treeControls = document.querySelector("#tree-controls");
const treeSearchRow = document.querySelector("#tree-search-row");
const repositoryTitle = document.querySelector("#repository-title");
const repositoryPanelToggle = document.querySelector("#repository-panel-toggle");
const repositoryPanel = document.querySelector("#repository-panel");
const repositoryPanelClose = document.querySelector("#repository-panel-close");
const repositoryPanelSearch = document.querySelector("#repository-panel-search");
const repositoryPanelList = document.querySelector("#repository-panel-list");
const repositoryPanelEmpty = document.querySelector("#repository-panel-empty");
const repositoryPanelOpen = document.querySelector("#repository-panel-open");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const historyBackButton = document.querySelector("#history-back");
const historyForwardButton = document.querySelector("#history-forward");
const documentTabs = document.querySelector("#document-tabs");
const documentNewButton = document.querySelector("#document-new");
const floatingDocumentActions = document.querySelector("#floating-document-actions");
const documentDeletionsToggle = document.querySelector("#document-deletions-toggle");
const documentFavoriteToggle = document.querySelector("#document-favorite-toggle");
const copyShareLinkButton = document.querySelector("#copy-share-link");
const documentActionsMore = document.querySelector("#document-actions-more");
const emptyNewDocument = document.querySelector("#empty-new-document");
const fileActionMenu = document.querySelector("#file-action-menu");
const documentBody = document.querySelector("#document-body");
const documentOutline = document.querySelector("#document-outline");
const documentOutlineResizer = document.querySelector("#document-outline-resizer");
const documentOutlineToggle = document.querySelector("#document-outline-toggle");
const documentWorkspace = document.querySelector("#document-workspace");
const documentContent = document.querySelector("#document-content");
const documentEmptyState = document.querySelector("#document-empty-state");
const sourceSplitter = document.querySelector("#source-splitter");
const sourceEditorPane = document.querySelector("#source-editor-pane");
const sourceEditorHost = document.querySelector("#source-editor");
const documentRemoteMergeStatus = document.querySelector("#document-remote-merge-status");
const treeFilter = document.querySelector("#tree-filter");
const uiTooltip = document.querySelector("#ui-tooltip");
const treeItemSearchTooltips = new WeakMap();
const worktreeSwitcher = document.querySelector("#worktree-switcher");
const worktreeSwitcherToggle = document.querySelector("#worktree-switcher-toggle");
const worktreeSwitcherMenu = document.querySelector("#worktree-switcher-menu");
const worktreeCurrentName = document.querySelector("#worktree-current-name");
const worktreeCurrentBranch = document.querySelector("#worktree-current-branch");
const branchStatus = document.querySelector("#branch-status");
const frontmatterFilterToggle = document.querySelector("#frontmatter-filter-toggle");
const frontmatterActiveFilters = document.querySelector("#frontmatter-active-filters");
const frontmatterFilterPopover = document.querySelector("#frontmatter-filter-popover");
const gitChangeToolbar = document.querySelector("#git-change-toolbar");
const gitChangeLabel = document.querySelector("#git-change-label");
const gitRemoteStatus = document.querySelector("#git-remote-status");
const gitRemoteDetail = document.querySelector("#git-remote-detail");
const gitMergeRemote = document.querySelector("#git-merge-remote");
const gitSyncOpen = document.querySelector("#git-sync-open");
const gitSyncNoteWrap = document.querySelector("#git-sync-note-wrap");
const gitSyncNote = document.querySelector("#git-sync-note");
const gitSyncPanel = document.querySelector("#git-sync-panel");
const gitSyncClose = document.querySelector("#git-sync-close");
const gitSyncResult = document.querySelector("#git-sync-result");
const gitSyncResultTitle = document.querySelector("#git-sync-result-title");
const gitSyncResultHelp = document.querySelector("#git-sync-result-help");
const gitSyncAgentPrompt = document.querySelector("#git-sync-agent-prompt");
const gitSyncCopyPrompt = document.querySelector("#git-sync-copy-prompt");
const desktopUpdatePanel = document.querySelector("#desktop-update-panel");
const desktopUpdateTitle = document.querySelector("#desktop-update-title");
const desktopUpdateDetail = document.querySelector("#desktop-update-detail");
const desktopUpdateAction = document.querySelector("#desktop-update-action");
const appDialog = document.querySelector("#app-dialog");
const appDialogCard = document.querySelector("#app-dialog-card");
const appDialogTitle = document.querySelector("#app-dialog-title");
const appDialogMessage = document.querySelector("#app-dialog-message");
const appDialogContent = document.querySelector("#app-dialog-content");
const appDialogInputWrap = document.querySelector("#app-dialog-input-wrap");
const appDialogInputLabel = document.querySelector("#app-dialog-input-label");
const appDialogInput = document.querySelector("#app-dialog-input");
const appDialogFields = document.querySelector("#app-dialog-fields");
const appDialogClose = document.querySelector("#app-dialog-close");
const appDialogCancel = document.querySelector("#app-dialog-cancel");
const appDialogConfirm = document.querySelector("#app-dialog-confirm");
const appDialogActions = document.querySelector("#app-dialog-actions");
const sidebarResizer = document.querySelector("#sidebar-resizer");
const selectionPopover = document.querySelector("#selection-popover");
const copySelectionPopover = document.querySelector("#copy-selection-popover");
const addSelectionAgentContext = document.querySelector("#add-selection-agent-context");
const agentContextWidget = document.querySelector("#agent-context-widget");
const agentContextPopover = document.querySelector("#agent-context-popover");
const agentContextToggle = document.querySelector("#agent-context-toggle");
const agentContextToggleCount = document.querySelector("#agent-context-toggle-count");
const agentContextClose = document.querySelector("#agent-context-close");
const agentContextList = document.querySelector("#agent-context-list");
const agentContextEmpty = document.querySelector("#agent-context-empty");
const agentContextClear = document.querySelector("#agent-context-clear");
const agentContextCopy = document.querySelector("#agent-context-copy");
const imagePopover = document.querySelector("#image-popover");
const linkPopover = document.querySelector("#link-popover");
const frontmatterFieldPopover = document.querySelector("#frontmatter-field-popover");
const copyToast = document.querySelector("#copy-toast");
const documentSearch = document.querySelector("#document-search");
const documentSearchInput = document.querySelector("#document-search-input");
const documentSearchCount = document.querySelector("#document-search-count");
const documentSearchPrevious = document.querySelector("#document-search-previous");
const documentSearchNext = document.querySelector("#document-search-next");
const documentSearchClose = document.querySelector("#document-search-close");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const modeReadonlyStatus = document.querySelector("#mode-readonly-status");
const themeToggle = document.querySelector("#theme-toggle");
const chartTooltipController = attachChartTooltips(documentContent);
const sourceChartTooltipController = attachChartTooltips(sourceEditorHost);
const datasetViewSelections = new Map();
const datasetViewOptions = {
  selections: datasetViewSelections,
  getContext: () => ({
    repo: state.currentRepo,
    file: state.currentDocument?.path ?? state.currentFile,
    locale: state.locale,
  }),
  onRendered: (root) => enhanceTables(root),
};
const documentDatasetViewController = attachDatasetViews(documentContent, datasetViewOptions);
const sourceDatasetViewController = attachDatasetViews(sourceEditorHost, datasetViewOptions);
const documentMermaidController = attachMermaidDiagrams(documentContent, {
  getTheme: () => state.theme,
});
const sourceMermaidController = attachMermaidDiagrams(sourceEditorHost, {
  getTheme: () => state.theme,
});
const uiTooltipController = createUiTooltip({
  tooltip: uiTooltip,
  eventRoot: appShell,
  boundsElement: appShell,
  isBlocked: (source) => (
    source.name !== "action" &&
    (!gitSyncPanel.hidden || !appDialog.hidden)
  ),
  sources: [
    {
      name: "action",
      container: appShell,
      itemFromTarget: actionTooltipItemFromEventTarget,
      details: actionTooltipDetails,
      key: actionTooltipKey,
      placement: (item) => item.dataset.uiTooltipPlacement || "bottom",
      variant: "action",
      delay: 450,
    },
    {
      name: "document-tab",
      container: documentTabs,
      itemFromTarget: documentTabItemFromEventTarget,
      details: documentTabTooltipDetails,
      key: (item) => item.dataset.documentTabId || item.dataset.documentTabPath,
      describedElement: (item) => item.querySelector(".document-tab-title") || item,
      placement: "bottom-start",
      variant: "content",
      delay: 300,
    },
    createTreeItemTooltipSource({
      container: fileTree,
      nameRangesForItem: (_item, name) => (
        isTreeTextSearchActive()
          ? textFilterMatchRanges(name, state.filter)
          : []
      ),
      detailRangesForItem: (_item, detail) => (
        isTreeTextSearchActive()
          ? textFilterMatchRanges(detail, state.filter)
          : []
      ),
      searchDetailsForItem: (item) => treeItemSearchTooltips.get(item),
    }),
    {
      name: "document-outline",
      container: documentOutline,
      itemFromTarget: outlineItemFromEventTarget,
      details: outlineItemTooltipDetails,
      key: (item) => item.dataset.outlineTarget || "document-start",
      shouldShow: (item) => elementIsOverflowing(outlineItemLabelElement(item)),
      anchorElement: outlineItemLabelElement,
      describedElement: (item) => item,
      placement: "expansion",
      variant: "expansion",
      delay: 250,
    },
  ],
});
attachHorizontalPointerResize({
  resizer: documentOutlineResizer,
  classTarget: documentBody,
  activeClass: "is-outline-resizing",
  onResize: setDocumentOutlineWidthFromPointer,
});

if (!canEditCurrentRepo() && isEditingModeName(state.mode)) {
  state.mode = "preview";
}
applyEditCapability();
applyAppearancePreferences(initialUserPreferences);
applyShortcutTooltips();

sidebarResizer.addEventListener("pointerdown", startSidebarResize);
sidebarResizer.addEventListener("keydown", handleSidebarResizeKeydown);
documentOutlineResizer.addEventListener("keydown", handleDocumentOutlineResizeKeydown);
sidebarToggle.addEventListener("click", () => runAppShortcut("toggle-sidebar"));
historyBackButton.addEventListener("click", () => runAppShortcut("history-back"));
historyForwardButton.addEventListener("click", () => runAppShortcut("history-forward"));
sourceSplitter.addEventListener("pointerdown", startSourceSplitResize);
sourceSplitter.addEventListener("keydown", handleSourceSplitKeydown);
fileTree.addEventListener("keydown", handleFileTreeKeydown);
fileTree.addEventListener("focusin", handleFileTreeFocusIn);
fileTree.addEventListener("scroll", scheduleWorkbenchSessionPersist);
fileTree.addEventListener("pointerdown", handleFileTreePointerDown, true);
fileTree.addEventListener("contextmenu", handleFileTreeContextMenu);
sidebarTreeTabs.addEventListener("click", handleSidebarTabClick);
sidebarTreeTabs.addEventListener("keydown", handleSidebarTabKeydown);
documentTabs.addEventListener("wheel", handleDocumentTabsWheel, { passive: false });
documentTabs.addEventListener("contextmenu", handleDocumentTabContextMenu);
documentNewButton.addEventListener("click", () => promptNewDocument(newDocumentLocationFromCurrent()));
emptyNewDocument.addEventListener("click", () => promptNewDocument({ directoryPath: "" }));
repositoryPanelToggle.addEventListener("click", () => requestRepositoryPanelAction("show"));
repositoryPanelClose.addEventListener("click", () => closeRepositoryPanel());
repositoryPanelOpen.addEventListener("click", openAnotherRepositoryFromPanel);
repositoryPanelSearch.addEventListener("input", renderRepositoryPanel);
repositoryPanel.addEventListener("click", handleRepositoryPanelClick);
repositoryPanel.addEventListener("keydown", handleRepositoryPanelKeydown);
repositoryPanelList.addEventListener("pointerdown", handleRepositoryPanelPointerDown);
repositoryPanelList.addEventListener("pointermove", handleRepositoryPanelPointerMove);
repositoryPanelList.addEventListener("pointerup", handleRepositoryPanelPointerUp);
repositoryPanelList.addEventListener("pointercancel", handleRepositoryPanelPointerCancel);
documentFavoriteToggle.addEventListener("click", toggleCurrentDocumentFavorite);
documentDeletionsToggle.addEventListener("click", toggleDeletedDocumentChanges);
documentActionsMore.addEventListener("click", showCurrentDocumentActionsMenu);
fileActionMenu.addEventListener("click", handleFileActionMenuClick);
fileActionMenu.addEventListener("keydown", handleFileActionMenuKeydown);
worktreeSwitcherToggle.addEventListener("click", toggleWorktreeSwitcher);
worktreeSwitcherMenu.addEventListener("click", handleWorktreeSelection);
documentOutline.addEventListener("click", handleOutlineClick);
copySelectionPopover.addEventListener("click", copyCurrentLineReference);
addSelectionAgentContext.addEventListener("click", addCurrentSelectionToAgentContext);
agentContextToggle.addEventListener("click", toggleAgentContextPopover);
agentContextClose.addEventListener("click", closeAgentContextPopoverAndRestoreFocus);
agentContextList.addEventListener("click", handleAgentContextListClick);
agentContextClear.addEventListener("click", clearAgentContextItems);
agentContextCopy.addEventListener("click", copyAgentContext);
imagePopover.addEventListener("click", handleImagePopoverClick);
linkPopover.addEventListener("click", handleLinkPopoverClick);
frontmatterFieldPopover.addEventListener("click", handleFrontmatterFieldPopoverClick);
frontmatterFieldPopover.addEventListener("change", handleFrontmatterFieldPopoverChange);
frontmatterFilterToggle.addEventListener("click", toggleFrontmatterFilterPopover);
frontmatterActiveFilters.addEventListener("click", handleActiveFrontmatterFilterClick);
frontmatterFilterPopover.addEventListener("click", handleFrontmatterFilterPopoverClick);
gitSyncOpen.addEventListener("click", handlePrimaryGitSyncAction);
gitSyncNote.addEventListener("input", () => {
  state.gitSyncNotes.set(remoteSyncScope(), gitSyncNote.value);
});
gitMergeRemote.addEventListener("click", () => mergeRemoteIntoWorkspace({ automatic: false }));
gitSyncClose.addEventListener("click", closeGitSyncPanel);
gitSyncPanel.addEventListener("click", handleGitSyncPanelBackdropClick);
gitSyncCopyPrompt.addEventListener("click", copyGitSyncAgentPrompt);
desktopUpdateAction.addEventListener("click", requestDesktopUpdateInstall);
themeToggle.addEventListener("click", toggleWebTheme);
documentOutlineToggle.addEventListener("click", toggleDocumentOutline);
appDialog.addEventListener("click", handleAppDialogBackdropClick);
appDialog.addEventListener("keydown", handleAppDialogKeydown);
appDialogClose.addEventListener("click", () => closeAppDialog(false));
appDialogCancel.addEventListener("click", () => closeAppDialog(false));
appDialogConfirm.addEventListener("click", () => closeAppDialog(true));
appDialogInput.addEventListener("keydown", handleAppDialogInputKeydown);
documentSearchInput.addEventListener("input", handleDocumentSearchInput);
documentSearchInput.addEventListener("keydown", handleDocumentSearchKeydown);
documentSearchPrevious.addEventListener("click", () => moveDocumentSearch(-1));
documentSearchNext.addEventListener("click", () => moveDocumentSearch(1));
documentSearchClose.addEventListener("click", () => closeDocumentSearch());
document.addEventListener("click", handleDocumentChromeClick);
document.addEventListener("focusin", handleAgentContextFocusIn);
document.addEventListener("pointerdown", handleToolStatusActivity);
document.addEventListener("wheel", handleOutlineContentNavigationIntent, { capture: true, passive: true });
document.addEventListener("pointerdown", handleOutlineContentNavigationIntent, true);
document.addEventListener("touchstart", handleOutlineContentNavigationIntent, { capture: true, passive: true });
document.addEventListener("keydown", handleAppShortcutKeydown, true);
document.addEventListener("keydown", handleDocumentKeydown, true);
document.addEventListener("keydown", handleOutlineContentNavigationIntent, true);
document.addEventListener("keydown", handleToolStatusActivity);
document.addEventListener("visibilitychange", handleRemoteSyncVisibilityChange);
window.addEventListener("git-leaf-desktop-shortcut", handleDesktopShortcutEvent);
window.addEventListener("git-leaf-desktop-repositories", handleDesktopRepositoriesEvent);
window.addEventListener("git-leaf-desktop-update-status", handleDesktopUpdateStatusEvent);
window.addEventListener("git-leaf-desktop-preferences", handleDesktopPreferencesEvent);
window.addEventListener("focus", handleToolStatusActivity);
window.addEventListener("focus", refreshWorktreesOnWindowFocus);
window.addEventListener("focus", handleRemoteSyncWindowFocus);
window.addEventListener("resize", positionFrontmatterFilterPopover);
window.addEventListener("resize", positionWorktreeSwitcherMenu);
window.addEventListener("resize", scheduleAnchoredSourceLineGutterSync);
window.addEventListener("resize", () => closeFileActionMenu({ restoreFocus: false }));
window.addEventListener("pagehide", flushWorkbenchSessionPreference);
window.addEventListener("pagehide", () => {
  void flushRendererTelemetry();
});
systemColorSchemeQuery?.addEventListener?.("change", handleSystemColorSchemeChange);
if (initialLegacyThemeMigrationPending) {
  persistAppPreference("colorMode", initialUserPreferences.colorMode);
}
document.addEventListener("visibilitychange", handleToolStatusVisibilityChange);
for (const button of modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}
window.openGlancePreparePdfExport = preparePdfExport;
window.openGlanceFinishPdfExport = finishPdfExport;
copyShareLinkButton.addEventListener("click", copyCurrentShareLink);
documentContent.addEventListener("click", handleDocumentClick);
documentContent.addEventListener("keydown", handlePreviewContentKeydown);
documentContent.addEventListener("scroll", () => {
  const previewLine = currentPreviewVisibleLine();
  if (Number.isInteger(previewLine)) {
    state.lastPreviewVisibleLine = previewLine;
  }
  chartTooltipController.hide();
  sourceChartTooltipController.hide();
  scheduleSelectionPopoverPosition();
  positionImagePopover();
  positionLinkPopover();
  positionFrontmatterFieldPopover();
  window.requestAnimationFrame(() => {
    syncSourceScrollFromPreview(previewLine);
    updateActiveOutlineFromContentScroll(activeOutlineIdFromScroll());
  });
});
treeFilter.addEventListener("input", () => {
  const nextFilter = treeFilter.value.trim().toLowerCase();
  if (nextFilter !== state.filter) {
    resetTreeSearchDirectoryState();
  }
  state.filter = nextFilter;
  if (state.filter && !fileSearchTelemetryActive) {
    recordTelemetryFeature("navigation.file_search");
    fileSearchTelemetryActive = true;
  } else if (!state.filter) {
    fileSearchTelemetryActive = false;
  }
  renderTree();
  if (
    state.filter.length > 0 &&
    state.frontmatterAllowedKeys.length > 0 &&
    !state.frontmatterFacets
  ) {
    ensureFrontmatterFacets();
  }
});
treeFilter.addEventListener("keydown", handleTreeFilterKeydown);

restoreSidebarWidth();
restoreSidebarCollapsed();
restoreDocumentOutlineWidth();
restoreDocumentOutlineCollapsed();
restoreSourceSplitRatio();
try {
  await loadRepositories();
  await loadWorktrees();
  await loadSidebarFavorites();
  restoreAgentContextItems();
  renderAgentContext();
  restoreWorkbenchSessionForCurrentRepo({ requestedFile: requestedInitialFile });
  ensureDocumentTabForCurrentFile();
  restoreTreeDirectoryState();
  seedInitialTreeDirectoryExpansion();
  await loadTree();
  await loadGitStatus();
  if (state.currentFile) {
    await loadDocumentLocation(state.currentFile, { applySavedMode: true });
  } else {
    showNoDocumentSelected();
  }
  setMode(state.mode, { persist: false, focus: false });
  resetTreePolling();
  resetRemoteSyncPolling();
  void loadRemoteSyncStatus({ autoApply: true });
} catch (error) {
  showStartupError(error);
} finally {
  completeWorkbenchStartup({
    root: document.documentElement,
    loadingElement: workbenchLoading,
    requestFrame: window.requestAnimationFrame.bind(window),
    scheduleTimeout: window.setTimeout.bind(window),
  });
}

async function loadRepositories() {
  const response = await fetch(apiUrl("/api/repos"));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: t("error.repositoryList") }));
    throw new Error(payload.error || t("error.repositoryList"));
  }

  const payload = await response.json();
  state.repositories = payload.repositories ?? [];
  const current = repositoryById(state.currentRepo) ?? state.repositories[0];
  if (!current) {
    throw new Error(t("error.noRepository"));
  }

  state.currentRepo = current.id;
  renderRepositoryHeader(current);
  applyRepositoryStatus(current);
  if (!initialSearchParams.has("file")) {
    state.currentFile = current.defaultFile || state.currentFile;
  }
  renderBranchStatus();
  applyEditCapability();
}

async function loadWorktrees() {
  const response = await fetch(apiUrl("/api/worktrees"), { cache: "no-store" });
  if (!response.ok) {
    state.worktrees = [];
    renderWorktreeSwitcher();
    return;
  }

  const payload = await response.json();
  state.worktrees = Array.isArray(payload.worktrees) ? payload.worktrees : [];
  state.currentWorktreeId = payload.currentWorktreeId || state.currentWorktreeId;
  restoreAgentContextItemsForScopeChange();
  state.canSwitchWorktrees = payload.canSwitch === true;
  const current = currentWorktree();
  if (current) {
    state.currentRepoBranch = current.branch || "";
    state.currentRepoDetached = current.detached === true;
    state.currentRepoCanEdit = true;
  }
  renderWorktreeSwitcher();
}

async function loadSidebarFavorites() {
  try {
    const response = await fetch(apiUrl("/api/favorites"), { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Favorites are unavailable");
    }
    const payload = await response.json();
    state.sidebarFavoritesAvailable = payload.available === true;
    state.sidebarFavorites = state.sidebarFavoritesAvailable
      ? normalizeSidebarFavorites(payload.favorites)
      : localSidebarFavorites();
  } catch {
    state.sidebarFavoritesAvailable = false;
    state.sidebarFavorites = localSidebarFavorites();
  }
  updateDocumentFavoriteToggle();
}

function localSidebarFavoriteScope() {
  return state.currentWorktreeId || state.currentRepo || "default";
}

function readLocalSidebarFavoriteScopes() {
  try {
    return normalizeSidebarFavoriteScopes(
      JSON.parse(window.localStorage?.getItem(SIDEBAR_FAVORITES_STORAGE_KEY) || "{}"),
    );
  } catch {
    return {};
  }
}

function localSidebarFavorites() {
  return sidebarFavoritesForScope(
    readLocalSidebarFavoriteScopes(),
    localSidebarFavoriteScope(),
  );
}

function writeLocalSidebarFavoriteScopes(scopes) {
  try {
    window.localStorage?.setItem(
      SIDEBAR_FAVORITES_STORAGE_KEY,
      JSON.stringify(normalizeSidebarFavoriteScopes(scopes)),
    );
  } catch {
    // Browser-only favorites remain best-effort when storage is unavailable.
  }
}

function isFavoriteItem(type, path) {
  return isSidebarFavoriteEntry(state.sidebarFavorites, { type, path });
}

async function setSidebarFavorite({ type, path, active }) {
  const action = active ? "add" : "remove";
  try {
    if (state.sidebarFavoritesAvailable) {
      const response = await fetch(apiUrl("/api/favorites"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, type, path }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t("error.favoriteSave"));
      }
      state.sidebarFavorites = normalizeSidebarFavorites(payload.favorites);
    } else {
      const result = applySidebarFavoriteOperation(readLocalSidebarFavoriteScopes(), {
        scope: localSidebarFavoriteScope(),
        action,
        type,
        path,
      });
      state.sidebarFavorites = sidebarFavoritesForScope(
        result.scopes,
        localSidebarFavoriteScope(),
      );
      writeLocalSidebarFavoriteScopes(result.scopes);
    }
    const savedActive = isFavoriteItem(type, path);
    if (savedActive !== active) {
      throw new Error(t("error.favoriteSave"));
    }
    updateDocumentFavoriteToggle();
    if (state.sidebarTab === "favorites") {
      renderTree();
    }
    showCopyToast(savedActive ? t("toast.favoriteAdded") : t("toast.favoriteRemoved"));
    return true;
  } catch (error) {
    showCopyToast(error instanceof Error ? error.message : t("error.favoriteSave"));
    return false;
  }
}

function toggleFavoriteItem({ type, path }) {
  return queueSidebarFavoriteToggle({ type, path });
}

async function toggleCurrentDocumentFavorite() {
  if (!state.currentDocument?.path || !isMarkdownDocument()) {
    return;
  }
  await toggleFavoriteItem({
    type: "document",
    path: state.currentDocument.path,
  });
}

async function replaceFavoriteDocumentPath(fromPath, toPath) {
  if (!isFavoriteItem("document", fromPath)) {
    return;
  }
  try {
    if (state.sidebarFavoritesAvailable) {
      const response = await fetch(apiUrl("/api/favorites"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace",
          type: "document",
          path: fromPath,
          toPath,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t("error.favoriteSave"));
      }
      state.sidebarFavorites = normalizeSidebarFavorites(payload.favorites);
    } else {
      const scope = localSidebarFavoriteScope();
      const scopes = replaceSidebarFavoritePath(readLocalSidebarFavoriteScopes(), {
        scope,
        type: "document",
        fromPath,
        toPath,
      });
      state.sidebarFavorites = sidebarFavoritesForScope(scopes, scope);
      writeLocalSidebarFavoriteScopes(scopes);
    }
  } catch {
    // A document rename remains successful even if its convenience bookmark cannot migrate.
  }
}

async function removeFavoritePath(type, path) {
  if (!isFavoriteItem(type, path)) {
    return;
  }
  try {
    if (state.sidebarFavoritesAvailable) {
      const response = await fetch(apiUrl("/api/favorites"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          type,
          path,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t("error.favoriteSave"));
      }
      state.sidebarFavorites = normalizeSidebarFavorites(payload.favorites);
    } else {
      const scope = localSidebarFavoriteScope();
      const result = applySidebarFavoriteOperation(readLocalSidebarFavoriteScopes(), {
        scope,
        action: "remove",
        type,
        path,
      });
      state.sidebarFavorites = sidebarFavoritesForScope(result.scopes, scope);
      writeLocalSidebarFavoriteScopes(result.scopes);
    }
  } catch {
    // The requested file operation remains successful even if a convenience bookmark cannot be updated.
  }
}

async function pruneMissingSidebarFavorites(tree) {
  const missing = missingSidebarFavoritesFromTree(tree, state.sidebarFavorites);
  if (missing.length === 0) {
    return false;
  }

  try {
    if (state.sidebarFavoritesAvailable) {
      const response = await fetch(apiUrl("/api/favorites"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove-many",
          entries: missing,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t("error.favoriteSave"));
      }
      state.sidebarFavorites = normalizeSidebarFavorites(payload.favorites);
    } else {
      const scope = localSidebarFavoriteScope();
      const result = applySidebarFavoriteOperation(readLocalSidebarFavoriteScopes(), {
        scope,
        action: "remove-many",
        entries: missing,
      });
      state.sidebarFavorites = sidebarFavoritesForScope(result.scopes, scope);
      writeLocalSidebarFavoriteScopes(result.scopes);
    }
    updateDocumentFavoriteToggle();
    return true;
  } catch {
    // Missing favorites remain hidden and are retried after the next complete tree refresh.
    return false;
  }
}

function refreshWorktreesOnWindowFocus() {
  loadWorktrees().catch(() => {});
}

function currentWorktree() {
  return state.worktrees.find((worktree) => worktree.id === state.currentWorktreeId) ||
    state.worktrees.find((worktree) => worktree.current) ||
    null;
}

function renderWorktreeSwitcher() {
  const current = currentWorktree();
  const showWorktreeSelector = repositoryHeaderUsesWorktreeSelector({
    currentWorktree: current,
    worktreeCount: state.worktrees.length,
  });
  repositoryTitle.hidden = showWorktreeSelector;
  if (!showWorktreeSelector) {
    worktreeSwitcher.hidden = true;
    closeWorktreeSwitcher();
    return;
  }

  worktreeSwitcher.hidden = false;
  worktreeCurrentName.textContent = worktreeDisplayLabel(current);
  worktreeCurrentBranch.textContent = worktreeBranchLabel(current);
  worktreeSwitcherToggle.disabled = !state.canSwitchWorktrees || state.worktrees.length < 2;
  worktreeSwitcherMenu.replaceChildren(
    ...state.worktrees.map(worktreeOptionElement),
  );
}

function worktreeOptionElement(worktree) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = "worktree-option";
  option.dataset.worktreeId = worktree.id;
  option.disabled = !state.canSwitchWorktrees || worktree.available === false;
  option.setAttribute("role", "option");
  option.setAttribute("aria-selected", String(worktree.id === state.currentWorktreeId));
  const check = document.createElement("span");
  check.className = "worktree-option-check";
  check.textContent = worktree.id === state.currentWorktreeId ? "✓" : "";

  const copy = document.createElement("span");
  copy.className = "worktree-option-copy";
  const title = document.createElement("span");
  title.className = "worktree-option-title";
  title.textContent = worktreeDisplayLabel(worktree);
  const branch = document.createElement("span");
  branch.className = "worktree-option-branch";
  branch.textContent = worktreeBranchLabel(worktree);
  const worktreePath = document.createElement("span");
  worktreePath.className = "worktree-option-path";
  worktreePath.textContent = worktree.displayRoot || worktree.root;
  copy.append(title, branch, worktreePath);
  option.append(check, copy);
  return option;
}

function worktreeDisplayLabel(worktree) {
  const name = worktree?.name || t("worktree.defaultName");
  return worktree?.primary ? name : t("worktree.linkedName", { name });
}

function worktreeBranchLabel(worktree) {
  if (worktree.branch) {
    return worktree.branch;
  }
  return t("worktree.detached", {
    head: String(worktree.head || "").slice(0, 7) || "unknown",
  });
}

async function toggleWorktreeSwitcher() {
  if (!worktreeSwitcherMenu.hidden) {
    closeWorktreeSwitcher();
    return;
  }
  await loadWorktrees();
  if (worktreeSwitcher.hidden || worktreeSwitcherToggle.disabled) {
    return;
  }
  worktreeSwitcherMenu.hidden = false;
  worktreeSwitcherToggle.setAttribute("aria-expanded", "true");
  positionWorktreeSwitcherMenu();
}

function positionWorktreeSwitcherMenu() {
  if (worktreeSwitcherMenu.hidden) {
    return;
  }
  const margin = 12;
  const toggleRect = worktreeSwitcherToggle.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  worktreeSwitcherMenu.style.setProperty(
    "--worktree-menu-min-width",
    `${Math.round(toggleRect.width)}px`,
  );
  const width = worktreeSwitcherMenu.getBoundingClientRect().width;
  const left = Math.min(
    Math.max(toggleRect.left, margin),
    Math.max(margin, viewportWidth - width - margin),
  );
  const belowTop = toggleRect.bottom + 6;
  const belowHeight = viewportHeight - belowTop - margin;
  let top = belowTop;
  let maxHeight = Math.min(420, Math.max(180, belowHeight));

  if (belowHeight < 180 && toggleRect.top > belowHeight) {
    const aboveHeight = toggleRect.top - margin - 6;
    maxHeight = Math.min(420, Math.max(180, aboveHeight));
    top = Math.max(margin, toggleRect.top - maxHeight - 6);
  }

  worktreeSwitcherMenu.style.setProperty("--worktree-menu-left", `${Math.round(left)}px`);
  worktreeSwitcherMenu.style.setProperty("--worktree-menu-top", `${Math.round(top)}px`);
  worktreeSwitcherMenu.style.setProperty("--worktree-menu-max-height", `${Math.round(maxHeight)}px`);
}

function closeWorktreeSwitcher() {
  worktreeSwitcherMenu.hidden = true;
  worktreeSwitcherToggle.setAttribute("aria-expanded", "false");
}

function handleWorktreeSelection(event) {
  const option = event.target.closest?.("[data-worktree-id]");
  if (!option || option.disabled) {
    return;
  }
  const worktree = state.worktrees.find((candidate) => candidate.id === option.dataset.worktreeId);
  closeWorktreeSwitcher();
  if (!worktree || worktree.id === state.currentWorktreeId) {
    return;
  }

  flushWorkbenchSessionPreference();
  const action = new URL("openglance://open-worktree");
  action.searchParams.set("path", worktree.root);
  window.location.href = action.href;
}

async function loadTree({ force = false } = {}) {
  const response = await fetch(apiUrl("/api/tree"));
  if (!response.ok) {
    throw new Error("Unable to load repository tree");
  }
  const payload = await response.json();
  if (!Array.isArray(payload.tree)) {
    throw new Error("Repository tree response is invalid");
  }
  const frontmatterAllowedKeys = normalizeFrontmatterAllowedKeys(payload.frontmatterAllowedKeys);
  const frontmatterKeysChanged = !sameStringArray(state.frontmatterAllowedKeys, frontmatterAllowedKeys);
  const treeChanged = hasTreeChanged(state.tree, payload.tree);
  const favoritesChanged = await pruneMissingSidebarFavorites(payload.tree);
  if (!force && !treeChanged && !frontmatterKeysChanged) {
    if (favoritesChanged && state.sidebarTab === "favorites") {
      renderTree();
    }
    return;
  }

  state.tree = payload.tree;
  state.frontmatterAllowedKeys = frontmatterAllowedKeys;
  state.frontmatterFilters = normalizeFrontmatterFilters(
    state.frontmatterFilters,
    state.frontmatterAllowedKeys,
  );
  state.frontmatterFacets = null;
  state.frontmatterFiles = {};
  state.frontmatterActiveKey = nextAvailableFrontmatterKey(state.frontmatterActiveKey);
  renderFrontmatterFilterAvailability();
  renderActiveFrontmatterFilters();
  renderTree();
  renderDocumentTabs();
}

function resetTreePolling() {
  if (state.treeTimer) {
    window.clearInterval(state.treeTimer);
  }
  state.treeTimer = window.setInterval(refreshTreeAndGitStatus, TREE_REFRESH_INTERVAL_MS);
}

async function refreshTreeAndGitStatus() {
  await loadWorktrees();
  await loadTree();
  await loadGitStatus();
}

async function loadGitStatus() {
  const previousGitChanges = state.gitChanges;

  if (!state.canEdit) {
    state.gitChanges = [];
  } else {
    try {
      const response = await fetch(apiUrl("/api/git-status"), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load Git status");
      }
      const payload = await response.json();
      applyRepositoryStatus(payload);
      enforceCurrentRepoEditCapability();
      state.gitChanges = payload.changes ?? [];
    } catch {
      state.gitChanges = [];
    }
  }

  const gitChangesChanged = hasGitChangesChanged(previousGitChanges, state.gitChanges);
  renderGitChangeToolbar();
  if (gitChangesChanged) {
    renderTree();
  }
}

function scheduleGitStatusRefresh() {
  window.clearTimeout(state.gitStatusTimer);
  state.gitStatusTimer = window.setTimeout(loadGitStatus, GIT_STATUS_REFRESH_DELAY_MS);
}

function resetRemoteSyncPolling() {
  if (state.remoteSyncTimer) {
    window.clearInterval(state.remoteSyncTimer);
  }
  state.remoteSyncTimer = window.setInterval(() => {
    void loadRemoteSyncStatus({ autoApply: true });
  }, remoteSyncIntervalMs(state.gitRemoteCheckIntervalMinutes));
}

function handleRemoteSyncVisibilityChange() {
  if (
    document.visibilityState === "visible" &&
    remoteSyncCheckDue({
      intervalMinutes: state.gitRemoteCheckIntervalMinutes,
      lastAttemptAt: state.lastRemoteSyncAttemptAt,
      now: Date.now(),
    })
  ) {
    void loadRemoteSyncStatus({ autoApply: true });
  }
}

async function loadRemoteSyncStatus({ autoApply = false } = {}) {
  if (
    !canEditCurrentRepo()
    || state.remoteSyncOperation
    || state.remoteSyncPreparedMerge
  ) {
    return;
  }

  const requestId = ++state.remoteSyncRequestId;
  const scope = remoteSyncScope();
  state.lastRemoteSyncAttemptAt = Date.now();
  state.remoteSyncOperation = "check";
  if (state.remoteSync.ok === null) {
    state.remoteSync = {
      ...state.remoteSync,
      state: "checking",
      error: "",
    };
  }
  renderGitChangeToolbar();

  let payload;
  try {
    const response = await fetch(apiUrl("/api/git-remote-status", {
      refresh: "1",
      locale: state.locale,
    }), { cache: "no-store" });
    payload = await response.json().catch(() => ({
      ok: false,
      state: "unavailable",
      error: t("error.syncInvalidResponse"),
      checkedAt: new Date().toISOString(),
    }));
  } catch (error) {
    payload = {
      ok: false,
      state: "unavailable",
      error: error instanceof Error ? error.message : t("error.sync"),
      checkedAt: new Date().toISOString(),
    };
  }

  if (requestId !== state.remoteSyncRequestId || scope !== remoteSyncScope()) {
    if (requestId === state.remoteSyncRequestId && state.remoteSyncOperation === "check") {
      state.remoteSyncOperation = "";
      renderGitChangeToolbar();
    }
    return;
  }
  state.remoteSync = normalizeRemoteSyncPayload({
    ...state.remoteSync,
    ...payload,
  });
  reconcileRemoteAutoMergeFailure();
  state.remoteSyncOperation = "";
  await loadGitStatus();
  renderGitChangeToolbar();

  const decision = currentRemoteSyncDecision();
  if (autoApply && decision.shouldAutoMerge) {
    await mergeRemoteIntoWorkspace({ automatic: true });
  }
}

async function mergeRemoteIntoWorkspace({ automatic = false } = {}) {
  if (automatic) {
    await prepareAutomaticRemoteMerge();
    return;
  }
  await mergeRemoteIntoWorkspaceManually();
}

async function prepareAutomaticRemoteMerge() {
  if (state.remoteSyncOperation) {
    return;
  }
  const initialDecision = currentRemoteSyncDecision();
  if (!initialDecision.shouldAutoMerge) {
    return;
  }
  const remoteAutoMergeKey = currentRemoteAutoMergeKey();
  if (
    state.remoteSyncPreparedMerge
    && state.remoteSyncPreparedMerge.key === remoteAutoMergeKey
    && state.remoteSyncPreparedMerge.scope === remoteSyncScope()
  ) {
    await applyPreparedAutomaticRemoteMerge();
    return;
  }
  if (state.remoteSyncPreparedMerge) {
    await discardPreparedAutomaticRemoteMerge();
  }
  if (deferAutomaticRemoteMergeUntilEditingPauses()) {
    return;
  }
  clearAutomaticRemoteMergeTimer();

  const scope = remoteSyncScope();
  const incomingFiles = [...state.remoteSync.incomingFiles];
  const expectedHead = state.remoteSync.head;
  const expectedRemoteCommit = state.remoteSync.remoteCommit;
  state.remoteSyncOperation = "prepare";
  renderGitChangeToolbar();
  try {
    await flushPendingSourceSync();
    if (state.sourceWriteInFlight) {
      scheduleAutomaticRemoteMergeRetry();
      return;
    }
    await loadGitStatus();
    if (scope !== remoteSyncScope()) {
      return;
    }
    const sourceRevision = state.sourceRevision;

    const response = await fetch(apiUrl("/api/git-prepare-remote-merge", {
      locale: state.locale,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowLocalChanges: true,
        refresh: false,
        expectedHead,
        expectedRemoteCommit,
      }),
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      step: "prepare remote merge",
      error: t("error.syncInvalidResponse"),
    }));
    if (scope !== remoteSyncScope()) {
      await cancelRemoteMergePreparationToken(payload.preparationToken);
      return;
    }
    await applyBranchProtectionPayload(payload);
    state.remoteSync = normalizeRemoteSyncPayload({
      ...state.remoteSync,
      ...payload,
    });

    if (!response.ok || payload.ok === false) {
      handleAutomaticRemoteMergeFailure(payload, remoteAutoMergeKey);
      await loadGitStatus();
      return;
    }
    if (!payload.prepared || !payload.preparationToken) {
      clearRemoteAutoMergeFailure();
      return;
    }
    if (sourceRevision !== state.sourceRevision) {
      await cancelRemoteMergePreparationToken(payload.preparationToken);
      markAutomaticRemoteMergeDeferred(remoteAutoMergeKey, incomingFiles);
      scheduleAutomaticRemoteMergeRetry();
      return;
    }

    state.remoteSyncPreparedMerge = {
      token: payload.preparationToken,
      key: remoteAutoMergeKey,
      scope,
      incomingFiles,
      sourceRevision,
    };
    state.remoteSyncOperation = "";
    renderGitChangeToolbar();
    await applyPreparedAutomaticRemoteMerge();
    return;
  } catch {
    scheduleAutomaticRemoteMergeRetry();
  } finally {
    if (state.remoteSyncOperation === "prepare") {
      state.remoteSyncOperation = "";
      renderGitChangeToolbar();
    }
  }
}

async function applyPreparedAutomaticRemoteMerge() {
  if (state.remoteSyncOperation || !state.remoteSyncPreparedMerge) {
    return;
  }
  const prepared = state.remoteSyncPreparedMerge;
  if (
    prepared.key !== currentRemoteAutoMergeKey()
    || prepared.scope !== remoteSyncScope()
  ) {
    await discardPreparedAutomaticRemoteMerge();
    return;
  }
  if (prepared.sourceRevision !== state.sourceRevision) {
    await discardPreparedAutomaticRemoteMerge();
    markAutomaticRemoteMergeDeferred(prepared.key, prepared.incomingFiles);
    scheduleAutomaticRemoteMergeRetry();
    return;
  }

  const currentDocumentPath = state.currentDocument?.path || "";
  const currentDocumentAffected = prepared.incomingFiles.includes(currentDocumentPath);
  if (automaticRemoteMergeShouldWaitForEditor({
    editing: isEditorMode(),
    currentDocumentAffected,
    editorFocused: state.sourceEditor?.hasFocus?.() === true,
    applicationFocused: document.hasFocus(),
  })) {
    markAutomaticRemoteMergeDeferred(prepared.key, prepared.incomingFiles);
    return;
  }

  state.remoteSyncPreparedMerge = null;
  state.remoteSyncAutoMergeDeferredKey = "";
  state.remoteSyncOperation = "merge";
  state.remoteSyncApplyingDocumentPath = currentDocumentAffected ? currentDocumentPath : "";
  const protectEditor = isEditorMode() && currentDocumentAffected;
  if (protectEditor) {
    setAutomaticRemoteMergeCriticalSection(true);
  }
  renderGitChangeToolbar();
  try {
    const response = await fetch(apiUrl("/api/git-apply-prepared-remote-merge", {
      locale: state.locale,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preparationToken: prepared.token }),
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      step: "apply prepared remote merge",
      error: t("error.syncInvalidResponse"),
    }));
    if (prepared.scope !== remoteSyncScope()) {
      return;
    }
    await applyBranchProtectionPayload(payload);
    if (payload.code !== "preparation_expired") {
      state.remoteSync = normalizeRemoteSyncPayload({
        ...state.remoteSync,
        ...payload,
      });
    }
    if (!response.ok || payload.ok === false) {
      handleAutomaticRemoteMergeFailure(payload, prepared.key);
      await loadGitStatus();
      return;
    }

    closeGitSyncPanel();
    clearRemoteAutoMergeFailure();
    const visibleDocumentAffected = prepared.incomingFiles.includes(
      state.currentDocument?.path,
    );
    if (visibleDocumentAffected) {
      await refreshCurrentDocument({ remoteMerge: true });
    }
    await loadTree({ force: true });
    await loadGitStatus();
    if (visibleDocumentAffected) {
      showCopyToast(t("toast.remoteAutoMerged"));
    }
  } catch {
    scheduleAutomaticRemoteMergeRetry();
  } finally {
    if (state.remoteSyncOperation === "merge") {
      state.remoteSyncOperation = "";
      state.remoteSyncApplyingDocumentPath = "";
      if (protectEditor) {
        setAutomaticRemoteMergeCriticalSection(false);
      }
      renderGitChangeToolbar();
    }
  }
}

async function mergeRemoteIntoWorkspaceManually() {
  if (state.remoteSyncOperation) {
    return;
  }
  const initialDecision = currentRemoteSyncDecision();
  if (!initialDecision.canMergeRemote) {
    return;
  }
  await discardPreparedAutomaticRemoteMerge();
  clearAutomaticRemoteMergeTimer();

  const scope = remoteSyncScope();
  const incomingFiles = [...state.remoteSync.incomingFiles];
  state.remoteSyncOperation = "merge";
  setRemoteMergeLock(true);
  let editorLocked = true;
  renderGitChangeToolbar();
  try {
    await flushPendingSourceSync();
    if (state.sourceWriteInFlight) {
      showCopyToast(t("error.editorStillSaving"));
      return;
    }
    await loadGitStatus();
    if (scope !== remoteSyncScope()) {
      return;
    }

    const response = await fetch(apiUrl("/api/git-merge-remote", {
      locale: state.locale,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowLocalChanges: true,
        refresh: true,
      }),
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      step: "merge remote",
      error: t("error.syncInvalidResponse"),
    }));
    if (scope !== remoteSyncScope()) {
      return;
    }
    await applyBranchProtectionPayload(payload);
    state.remoteSync = normalizeRemoteSyncPayload({
      ...state.remoteSync,
      ...payload,
    });
    if (!response.ok || payload.ok === false) {
      await loadGitStatus();
      if (payload.agentPrompt) {
        showGitSyncFailure(payload);
      } else if (payload.error) {
        showCopyToast(payload.error);
      }
      return;
    }

    closeGitSyncPanel();
    clearRemoteAutoMergeFailure();
    if (incomingFiles.includes(state.currentDocument?.path)) {
      await refreshCurrentDocument({ remoteMerge: true });
    }
    setRemoteMergeLock(false);
    editorLocked = false;
    await loadTree({ force: true });
    await loadGitStatus();
    showCopyToast(t("toast.remoteMerged"));
  } catch (error) {
    showCopyToast(error instanceof Error ? error.message : t("error.sync"));
  } finally {
    if (state.remoteSyncOperation === "merge") {
      state.remoteSyncOperation = "";
      if (editorLocked) {
        setRemoteMergeLock(false);
      }
      renderGitChangeToolbar();
    }
  }
}

function handlePrimaryGitSyncAction() {
  const decision = currentRemoteSyncDecision();
  if (!decision.canRunPrimary) {
    return;
  }
  if (decision.primaryAction === "publish") {
    void submitGitSync();
    return;
  }
  void loadRemoteSyncStatus({ autoApply: true });
}

function currentRemoteSyncDecision() {
  const currentAutoMergeKey = currentRemoteAutoMergeKey();
  return remoteSyncDecision({
    remote: state.remoteSync,
    localChangeCount: state.gitChanges.length,
    canEdit: canEditCurrentRepo(),
    operation: state.remoteSyncOperation,
    autoMergeFailed: Boolean(
      currentAutoMergeKey && state.remoteSyncAutoMergeFailedKey === currentAutoMergeKey
    ),
    autoMergeBlocked: Boolean(
      currentAutoMergeKey && state.remoteSyncAutoMergeBlockedKey === currentAutoMergeKey
    ),
    autoMergeDeferred: Boolean(
      currentAutoMergeKey && state.remoteSyncAutoMergeDeferredKey === currentAutoMergeKey
    ),
  });
}

function normalizeRemoteSyncPayload(payload = {}) {
  return {
    ok: payload.remoteOk === true
      ? true
      : payload.ok === true
        ? true
        : payload.ok === false
          ? false
          : null,
    state: String(payload.state || (payload.ok === false ? "unavailable" : "checking")),
    checkedAt: String(payload.checkedAt || ""),
    updatedAt: String(payload.updatedAt || ""),
    ahead: Math.max(0, Number(payload.ahead) || 0),
    behind: Math.max(0, Number(payload.behind) || 0),
    incomingCount: Math.max(0, Number(payload.incomingCount) || 0),
    incomingFiles: Array.isArray(payload.incomingFiles) ? payload.incomingFiles : [],
    head: String(payload.head || ""),
    remoteCommit: String(payload.remoteCommit || ""),
    error: String(payload.error || ""),
  };
}

function remoteSyncScope() {
  return `${state.currentRepo || ""}\0${state.currentWorktreeId || ""}`;
}

function currentRemoteAutoMergeKey() {
  return state.remoteSync.remoteCommit
    ? `${remoteSyncScope()}\0${state.remoteSync.remoteCommit}`
    : "";
}

function deferAutomaticRemoteMergeUntilEditingPauses() {
  const remaining = automaticRemoteMergeDelayMs({
    editing: isEditorMode(),
    lastEditAt: state.lastSourceEditAt,
    idleMs: AUTOMATIC_REMOTE_MERGE_IDLE_MS,
  });
  if (remaining <= 0) {
    return false;
  }

  const expectedKey = currentRemoteAutoMergeKey();
  if (state.remoteSyncAutoMergeTimer) {
    window.clearTimeout(state.remoteSyncAutoMergeTimer);
  }
  state.remoteSyncAutoMergeTimer = window.setTimeout(() => {
    state.remoteSyncAutoMergeTimer = null;
    if (expectedKey && expectedKey === currentRemoteAutoMergeKey()) {
      void mergeRemoteIntoWorkspace({ automatic: true });
    }
  }, remaining);
  return true;
}

function scheduleAutomaticRemoteMergeRetry(delayMs = AUTOMATIC_REMOTE_MERGE_IDLE_MS) {
  const expectedKey = currentRemoteAutoMergeKey();
  if (!expectedKey) {
    return;
  }
  clearAutomaticRemoteMergeTimer();
  state.remoteSyncAutoMergeTimer = window.setTimeout(() => {
    state.remoteSyncAutoMergeTimer = null;
    if (expectedKey === currentRemoteAutoMergeKey()) {
      void mergeRemoteIntoWorkspace({ automatic: true });
    }
  }, Math.max(0, Number(delayMs) || 0));
}

function clearAutomaticRemoteMergeTimer() {
  if (!state.remoteSyncAutoMergeTimer) {
    return;
  }
  window.clearTimeout(state.remoteSyncAutoMergeTimer);
  state.remoteSyncAutoMergeTimer = null;
}

function handleAutomaticRemoteMergeFailure(payload, remoteAutoMergeKey) {
  if (automaticRemoteMergeFailureIsBlocking(payload)) {
    state.remoteSyncAutoMergeFailedKey = remoteAutoMergeKey;
    state.remoteSyncAutoMergeBlockedKey = remoteAutoMergeKey;
  } else {
    state.remoteSyncAutoMergeFailedKey = "";
    state.remoteSyncAutoMergeBlockedKey = "";
    scheduleAutomaticRemoteMergeRetry();
  }
  reconcileRemoteAutoMergeFailure();
}

function markAutomaticRemoteMergeDeferred(remoteAutoMergeKey, incomingFiles) {
  if (
    remoteAutoMergeKey
    && isEditorMode()
    && incomingFiles.includes(state.currentDocument?.path)
  ) {
    state.remoteSyncAutoMergeDeferredKey = remoteAutoMergeKey;
  }
  renderGitChangeToolbar();
}

async function discardPreparedAutomaticRemoteMerge() {
  const prepared = state.remoteSyncPreparedMerge;
  state.remoteSyncPreparedMerge = null;
  state.remoteSyncAutoMergeDeferredKey = "";
  if (prepared?.token) {
    await cancelRemoteMergePreparationToken(prepared.token);
  }
  renderGitChangeToolbar();
}

async function cancelRemoteMergePreparationToken(preparationToken) {
  if (!preparationToken) {
    return;
  }
  try {
    await fetch(apiUrl("/api/git-cancel-prepared-remote-merge"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preparationToken }),
    });
  } catch {
    // Prepared results expire server-side; cancellation is opportunistic.
  }
}

function handleSourceEditorFocusChange(focused) {
  if (focused || !state.remoteSyncPreparedMerge) {
    return;
  }
  state.remoteSyncAutoMergeDeferredKey = "";
  renderGitChangeToolbar();
  window.setTimeout(() => {
    void applyPreparedAutomaticRemoteMerge();
  }, 0);
}

function handleRemoteSyncWindowFocus() {
  if (!state.remoteSyncPreparedMerge) {
    return;
  }
  window.setTimeout(() => {
    void applyPreparedAutomaticRemoteMerge();
  }, 0);
}

function reconcileRemoteAutoMergeFailure() {
  const currentKey = currentRemoteAutoMergeKey();
  if (
    state.remoteSync.behind === 0
    || (state.remoteSyncAutoMergeFailedKey && state.remoteSyncAutoMergeFailedKey !== currentKey)
  ) {
    clearRemoteAutoMergeFailure();
  }
}

function clearRemoteAutoMergeFailure() {
  state.remoteSyncAutoMergeFailedKey = "";
  state.remoteSyncAutoMergeBlockedKey = "";
  state.remoteSyncAutoMergeDeferredKey = "";
}

function setRemoteMergeLock(locked) {
  state.sourceEditor?.setEditable?.(!locked);
  setAutomaticRemoteMergeCriticalSection(locked);
}

function setAutomaticRemoteMergeCriticalSection(locked) {
  sourceEditorPane.inert = Boolean(locked);
  sourceEditorPane.setAttribute("aria-disabled", String(locked));
  documentWorkspace.classList.toggle("is-applying-remote-merge", Boolean(locked));
  documentWorkspace.setAttribute("aria-busy", String(locked));
}

async function fetchDocumentData(filePath, { repoId = state.currentRepo } = {}) {
  if (!filePath) {
    return null;
  }

  const hadDocument = Boolean(state.currentDocument);
  const response = await fetch(apiUrl("/api/document", {
    repo: repoId,
    file: filePath,
    locale: state.locale,
  }));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: t("error.load") }));
    const message = payload.error || t("error.load");
    if (hadDocument) {
      showCopyToast(t("error.openTarget", { message }));
    } else {
      showStartupError(new Error(message));
    }
    return null;
  }

  return response.json();
}

function belongsToCurrentDocumentRepository(documentData, repoId = state.currentRepo) {
  const targetRepoId = documentData?.repo || repoId;
  return targetRepoId === repoId && targetRepoId === state.currentRepo;
}

function currentDocumentRequest() {
  if (!state.currentDocument?.path) {
    return null;
  }
  return {
    path: state.currentDocument.path,
    repoId: state.currentRepo,
    navigationRequestId: state.documentNavigationRequestId,
  };
}

function isCurrentDocumentRequest(request, documentData = null) {
  if (
    !request ||
    state.currentDocument?.path !== request.path ||
    state.currentRepo !== request.repoId ||
    state.documentNavigationRequestId !== request.navigationRequestId
  ) {
    return false;
  }
  return !documentData || (
    documentData.path === request.path &&
    belongsToCurrentDocumentRepository(documentData, request.repoId)
  );
}

function applyLoadedDocumentData(
  documentData,
  {
    hash = "",
    preserveScroll = false,
    forceReplace = false,
    applySavedMode = false,
    restoreScrollTop = null,
  } = {},
) {
  const nextRepoId = documentData.repo || state.currentRepo;
  if (nextRepoId !== state.currentRepo) {
    return false;
  }
  const repo = repositoryById(nextRepoId);
  if (repo) {
    renderRepositoryHeader(repo);
    applyRepositoryStatus(repo);
  }
  applyDocumentData(documentData, {
    resetSelectionFromHash: true,
    applySavedMode,
    initialHash: hash,
    preserveScroll,
    forceReplace,
    restoreScrollTop,
  });
  renderTree();
  resetStatusPolling();
  resetDocumentWatch();
  return true;
}

async function loadDocumentLocation(
  filePath,
  {
    repoId = state.currentRepo,
    hash = "",
    preserveScroll = false,
    forceReplace = false,
    applySavedMode = false,
    restoreScrollTop = null,
  } = {},
) {
  if (repoId !== state.currentRepo) {
    return false;
  }
  const requestId = ++state.documentNavigationRequestId;
  const documentData = await fetchDocumentData(filePath, { repoId });
  if (
    !documentData ||
    requestId !== state.documentNavigationRequestId ||
    !belongsToCurrentDocumentRepository(documentData, repoId)
  ) {
    return false;
  }
  return applyLoadedDocumentData(documentData, {
    hash,
    preserveScroll,
    forceReplace,
    applySavedMode,
    restoreScrollTop,
  });
}

async function navigateDocumentLocation(
  location,
  {
    behavior = "current",
    applySavedMode = false,
  } = {},
) {
  const filePath = String(location?.file || location?.path || "");
  const repoId = location?.repo || state.currentRepo;
  const hash = location?.hash || "";
  if (!filePath) {
    return false;
  }
  // A workbench owns one repository. Repository switches are explicit desktop
  // transitions, never a side effect of a document link or tab history.
  if (repoId !== state.currentRepo) {
    return false;
  }

  if (behavior === "background") {
    const nextTabs = navigateDocumentTab({
      tabs: state.documentTabs,
      activeTabId: state.activeTabId,
      location: { path: filePath, hash },
      behavior,
    });
    if (!nextTabs.openedTabId) {
      return false;
    }
    applyDocumentTabState(nextTabs, { render: true, persist: true });
    return true;
  }

  captureActiveDocumentLocation();
  const requestId = ++state.documentNavigationRequestId;
  const documentData = await fetchDocumentData(filePath, { repoId });
  if (!documentData || requestId !== state.documentNavigationRequestId) {
    return false;
  }

  if (!belongsToCurrentDocumentRepository(documentData, repoId)) {
    return false;
  }
  const nextTabs = navigateDocumentTab({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    location: { path: filePath, hash },
    behavior,
  });
  applyDocumentTabState(nextTabs, {
    render: true,
    persist: true,
    revealActive: true,
  });
  applyLoadedDocumentData(documentData, {
    hash,
    applySavedMode,
    restoreScrollTop: nextTabs.location?.scrollTop ?? 0,
  });
  return true;
}

async function moveActiveDocumentTabHistory(direction) {
  captureActiveDocumentLocation();
  const nextTabs = moveDocumentTabHistory({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    direction,
  });
  const location = nextTabs.location;
  if (!location || (location.path === state.currentFile && direction === 0)) {
    updateDocumentHistoryControls();
    return false;
  }

  const current = activeDocumentLocation({ tabs: state.documentTabs, activeTabId: state.activeTabId });
  if (sameDocumentLocation(current, location)) {
    updateDocumentHistoryControls();
    return false;
  }

  const requestId = ++state.documentNavigationRequestId;
  const documentData = await fetchDocumentData(location.path, { repoId: state.currentRepo });
  if (!documentData || requestId !== state.documentNavigationRequestId) {
    return false;
  }
  if (!belongsToCurrentDocumentRepository(documentData)) {
    return false;
  }
  applyDocumentTabState(nextTabs, {
    render: true,
    persist: true,
    revealActive: true,
  });
  applyLoadedDocumentData(documentData, {
    hash: location.hash,
    restoreScrollTop: location.scrollTop,
  });
  return true;
}

function sameDocumentLocation(left, right) {
  return Boolean(left && right) &&
    left.path === right.path &&
    left.hash === right.hash &&
    left.scrollTop === right.scrollTop;
}

async function activateDocumentTabAndLoad(targetTabId) {
  const nextTabs = activateDocumentTab({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    targetTabId,
  });
  const location = nextTabs.location;
  if (!location) {
    return false;
  }
  if (nextTabs.activeTabId === state.activeTabId && location.path === state.currentFile) {
    focusActiveDocumentSurface();
    return true;
  }

  captureActiveDocumentLocation();
  const requestId = ++state.documentNavigationRequestId;
  const documentData = await fetchDocumentData(location.path, { repoId: state.currentRepo });
  if (!documentData || requestId !== state.documentNavigationRequestId) {
    return false;
  }
  if (!belongsToCurrentDocumentRepository(documentData)) {
    return false;
  }
  applyDocumentTabState(nextTabs, {
    render: true,
    persist: true,
    revealActive: true,
  });
  applyLoadedDocumentData(documentData, {
    hash: location.hash,
    restoreScrollTop: location.scrollTop,
  });
  focusActiveDocumentSurface();
  return true;
}

function showNoDocumentSelected({ pushState = false } = {}) {
  state.documentNavigationRequestId += 1;
  closeDocumentSearch({ restoreFocus: false });
  state.currentFile = "";
  state.currentDocument = null;
  state.documentChangeModel = emptyDocumentChangeModel();
  state.showDeletedChanges = false;
  applyDocumentTabState({ tabs: [], activeTabId: "" });
  state.selectedLines = new Set();
  state.selectionAnchor = null;
  clearActiveImage();
  clearActiveLink();
  clearActiveFrontmatterField();
  setMode("preview", { persist: false, focus: false });
  showNoDocumentSurface();
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  state.outlineItems = [];
  outlineActiveViewportState.reset();
  updateDocumentActions(false);
  updateLineSelectionUi();
  renderDocumentTabs();
  resetStatusPolling();
  resetDocumentWatch();
  if (state.sourceEditor) {
    state.sourceEditor.setValue("");
    state.sourceEditor.setMode(state.mode);
  }
  if (pushState) {
    replaceCurrentDocumentUrl();
  }
  persistWorkbenchSession();
}

function showStartupError(error) {
  closeDocumentSearch({ restoreFocus: false });
  const message = error instanceof Error ? error.message : t("error.load");
  state.currentDocument = null;
  state.documentChangeModel = emptyDocumentChangeModel();
  state.selectedLines = new Set();
  state.selectionAnchor = null;
  hideNoDocumentSurface();
  documentContent.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  state.outlineItems = [];
  outlineActiveViewportState.reset();
  updateDocumentActions(false);
  renderDocumentTabs();
  applyEditCapability();
  updateLineSelectionUi();
}

function showNoDocumentSurface() {
  documentWorkspace.classList.add("is-empty");
  documentEmptyState.hidden = false;
  documentBody.classList.remove("has-outline");
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  state.outlineItems = [];
  outlineActiveViewportState.reset();
  documentContent.innerHTML = "";
  documentContent.scrollTop = 0;
  sourceSplitter.hidden = true;
  sourceEditorPane.hidden = true;
}

function hideNoDocumentSurface() {
  documentWorkspace.classList.remove("is-empty");
  documentEmptyState.hidden = true;
}

function applyDocumentData(
  documentData,
  {
    resetSelectionFromHash = false,
    preserveScroll = false,
    forceReplace = false,
    applySavedMode = false,
    initialHash = "",
    restoreScrollTop = null,
    preserveEditorState = false,
    highlightEditorChanges = false,
  } = {},
) {
  const scrollTop = preserveScroll ? documentContent.scrollTop : 0;
  const shouldReplace = forceReplace || shouldReplaceDocumentHtml(state.currentDocument, documentData);
  state.currentDocument = documentData;
  state.documentChangeModel = documentChangeModelForDocument(documentData);
  state.currentFile = documentData.path;
  renderDocumentTabs();
  hideNoDocumentSurface();
  state.lastWrittenHash = documentData.sourceHash ?? state.lastWrittenHash;
  updateDocumentActions(true);
  applyRepositoryStatus(documentData);

  if (!isMarkdownDocument(documentData)) {
    state.selectedLines = new Set();
    state.selectionAnchor = null;
  } else if (resetSelectionFromHash) {
    const currentUrl = new URL(window.location.href);
    const hashBelongsToDocument = initialHash || currentUrl.searchParams.get("file") === documentData.path;
    state.selectedLines = new Set(hashBelongsToDocument ? parseLineHash(initialHash || window.location.hash) : []);
    state.selectionAnchor = state.selectedLines.size > 0 ? [...state.selectedLines].at(-1) : null;
  }

  renderBranchStatus();
  applyEditCapability();
  if (applySavedMode) {
    setMode(readModePreference({ preferences: state.desktopPreferences }), {
      persist: false,
      focus: false,
    });
  } else if (!canEditCurrentDocument() && isEditingModeName(state.mode)) {
    setMode("preview", { persist: false, focus: false });
  }

  if (shouldReplace) {
    clearActiveImage();
    clearActiveLink();
    clearActiveFrontmatterField();
    chartTooltipController.hide();
    sourceChartTooltipController.hide();
    renderDocumentContent(documentData);
    if (preserveScroll) {
      documentContent.scrollTop = Math.min(scrollTop, documentContent.scrollHeight);
    } else if (!state.selectedLines.size && Number.isFinite(restoreScrollTop)) {
      window.requestAnimationFrame(() => {
        documentContent.scrollTop = Math.min(Math.max(0, restoreScrollTop), documentContent.scrollHeight);
      });
    }
  }

  if (state.sourceEditor) {
    state.sourceEditor.setValue(
      canEditDocumentData(documentData) ? documentData.source ?? "" : "",
      {
        preserveSelection: preserveEditorState,
        highlightChanges: highlightEditorChanges,
      },
    );
    applySourceEditorDocumentChangeBaseline();
    state.sourceEditor.setMode(state.mode);
  }

  refreshDocumentChangePresentation();

  updateLineSelectionUi();
  if (resetSelectionFromHash) {
    scrollToHashSelectedLine();
  }
  replaceCurrentDocumentUrl();
  updateDocumentHistoryControls();
  refreshDocumentSearch({ preserveIndex: true, reveal: false });
  persistWorkbenchSession();
}

function setMode(mode, { persist = true, focus = true } = {}) {
  outlineClickViewportGuard.end();
  const previousMode = state.mode;
  const previousSourceLine = currentSourceEditorVisibleLine();
  const previousPreviewLine = currentPreviewVisibleLine();
  let nextMode = modeFromStorageValue(mode);
  if ((!state.currentDocument || !canEditCurrentDocument()) && isEditingModeName(nextMode)) {
    nextMode = "preview";
    persist = false;
  }

  state.mode = nextMode;
  setTelemetryMode(state.mode);
  if (persist && canEditCurrentRepo()) {
    writeModePreference(state.mode);
    persistAppPreference("mode", state.mode);
  }
  const editingMode = isEditorMode();
  previewPane.classList.toggle("is-source-mode", state.mode === "source");
  previewPane.classList.toggle("is-live-mode", state.mode === "live");
  documentBody.hidden = false;
  documentContent.hidden = state.mode === "live";
  sourceSplitter.hidden = state.mode !== "source";
  sourceEditorPane.hidden = !editingMode;
  clearActiveImage();
  clearActiveLink();
  clearActiveFrontmatterField();
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  if (editingMode) {
    ensureSourceEditor();
    state.sourceEditor.setValue(state.currentDocument?.source ?? "");
    applySourceEditorDocumentChangeBaseline();
    state.sourceEditor.setMode(state.mode);
    updateLineSelectionUi();
    updateSourceSyncStatus("idle");
    scrollToHashSelectedLine();
    if (focus) {
      state.sourceEditor.focus();
    }
  } else {
    window.clearTimeout(state.sourceSyncTimer);
    state.sourceEditor?.setMode(state.mode);
    updateLineSelectionUi();
  }
  if (state.mode === "preview" && isEditingModeName(previousMode)) {
    scrollPreviewToSourceLine(previousSourceLine);
  }
  if (isEditingModeName(state.mode) && previousMode === "preview") {
    scrollSourceEditorToSourceLine(previousPreviewLine);
  }
  if (state.mode === "source" && previousMode === "live") {
    scrollPreviewToSourceLine(previousSourceLine);
  }
  refreshDocumentSearch({ preserveIndex: true, reveal: false });
}

function currentSourceEditorVisibleLine() {
  const line = state.sourceEditor?.visibleLine?.();
  return Number.isInteger(line) ? line : state.lastSourceVisibleLine;
}

function currentPreviewVisibleLine() {
  if (documentContent.hidden) {
    return state.lastPreviewVisibleLine;
  }

  const line = sourceLineFromPreviewScroll({
    contentTop: documentContent.getBoundingClientRect().top + 16,
    lineRects: [...documentContent.querySelectorAll("[data-source-line]")].map((button) => ({
      line: Number(button.dataset.sourceLine),
      top: button.getBoundingClientRect().top,
    })),
  });
  return Number.isInteger(line) ? line : state.lastPreviewVisibleLine;
}

function isEditorMode() {
  return isEditingModeName(state.mode) && canEditCurrentDocument();
}

function isEditingModeName(mode) {
  return mode === "source" || mode === "live";
}

function canEditCurrentRepo() {
  return Boolean(state.canEdit && state.currentRepoCanEdit);
}

function canEditCurrentDocument() {
  return canEditDocumentData(state.currentDocument) && canEditCurrentRepo();
}

function canEditDocumentData(documentData) {
  return Boolean(documentData && documentData.editable !== false && isMarkdownDocument(documentData));
}

function isMarkdownDocument(documentData = state.currentDocument) {
  return (documentData?.kind ?? "markdown") === "markdown";
}

function documentChangeModelForDocument(documentData) {
  if (
    !isMarkdownDocument(documentData) ||
    documentData?.changeBaselineAvailable !== true ||
    typeof documentData?.source !== "string"
  ) {
    return emptyDocumentChangeModel();
  }
  return createDocumentChangeModel({
    baselineSource: documentData.changeBaselineSource ?? "",
    currentSource: documentData.source,
  });
}

function applySourceEditorDocumentChangeBaseline() {
  state.sourceEditor?.setDocumentChangeBaseline?.({
    source: state.currentDocument?.changeBaselineSource ?? "",
    available: state.currentDocument?.changeBaselineAvailable === true,
    showDeletions: state.showDeletedChanges,
  });
}

function toggleDeletedDocumentChanges() {
  if (!state.documentChangeModel.hasDeletions) {
    return;
  }
  state.showDeletedChanges = !state.showDeletedChanges;
  state.sourceEditor?.setShowDeletedChanges?.(state.showDeletedChanges);
  refreshDocumentChangePresentation();
}

function refreshDocumentChangePresentation() {
  resetPreviewDocumentChangePresentation();
  updateDocumentDeletionsToggle();

  if (!isMarkdownDocument()) {
    return;
  }

  const model = state.documentChangeModel;
  if (model.changed) {
    markPreviewDocumentChanges(model);
    if (state.showDeletedChanges && model.hasDeletions) {
      renderPreviewDeletedChanges(model);
    }
  }

  renderDocumentOutline();
  scheduleAnchoredSourceLineGutterSync();
}

function updateDocumentDeletionsToggle() {
  const hasDeletions = Boolean(
    state.currentDocument &&
    isMarkdownDocument() &&
    state.documentChangeModel.hasDeletions
  );
  const showing = hasDeletions && state.showDeletedChanges;
  const label = t(showing ? "action.hideDeletedChanges" : "action.showDeletedChanges");
  documentDeletionsToggle.hidden = !hasDeletions;
  documentDeletionsToggle.setAttribute("aria-pressed", String(showing));
  documentDeletionsToggle.setAttribute("aria-label", label);
  setUiTooltip(documentDeletionsToggle, label, {
    detail: t("changes.deletionsHint"),
    placement: "bottom-end",
  });
  const labelElement = documentDeletionsToggle.querySelector("[data-document-deletions-label]");
  if (labelElement) {
    labelElement.textContent = label;
  }
}

function resetPreviewDocumentChangePresentation() {
  for (const element of documentContent.querySelectorAll("[data-document-deleted-preview]")) {
    element.remove();
  }
  for (const element of documentContent.querySelectorAll("[data-document-change-preview]")) {
    element.classList.remove("document-change-content", "is-added", "is-modified");
    delete element.dataset.documentChangePreview;
    delete element.dataset.documentChangeKind;
  }
  for (const button of documentContent.querySelectorAll(".source-line-button")) {
    button.classList.remove("is-document-change", "is-added", "is-modified");
    delete button.dataset.documentChangeKind;
  }
}

function markPreviewDocumentChanges(model) {
  const changedLines = new Set(model.changedLines);
  const lineStates = new Map(model.currentLines.map((line) => [line.line, line]));
  for (const button of documentContent.querySelectorAll(".source-line-button[data-source-line]")) {
    const start = Number(button.dataset.sourceLine);
    const end = Number(button.dataset.sourceEnd ?? start);
    if (!sourceRangeHasChanged(model, start, end)) {
      continue;
    }
    const kind = documentChangeKindForRange(changedLines, lineStates, start, end);
    button.classList.add("is-document-change", `is-${kind}`);
    button.dataset.documentChangeKind = kind;
    for (let line = start; line <= end; line += 1) {
      if (!changedLines.has(line)) {
        continue;
      }
      markPreviewChangeTarget(previewChangeTargetForLine(line, button), kind);
    }
  }
}

function markPreviewChangeTarget(target, kind) {
  if (!target) {
    return;
  }
  const nextKind = target.dataset.documentChangeKind === "modified" || kind === "modified"
    ? "modified"
    : "added";
  target.classList.remove("is-added", "is-modified");
  target.classList.add("document-change-content", `is-${nextKind}`);
  target.dataset.documentChangePreview = "true";
  target.dataset.documentChangeKind = nextKind;
}

function previewChangeTargetForLine(line, button = sourceLineButtonForLine(line)) {
  const block = button?.closest(".source-block");
  if (!block) {
    return null;
  }
  return block.querySelector(`[data-source-code-line="${line}"]`)
    || block.querySelector(`[data-source-list-line="${line}"]`)
    || block.querySelector(`[data-source-table-line="${line}"]`)
    || block;
}

function documentChangeKindForRange(changedLines, lineStates, start, end) {
  let found = false;
  for (let line = start; line <= end; line += 1) {
    if (!changedLines.has(line)) {
      continue;
    }
    found = true;
    if (lineStates.get(line)?.kind !== "added") {
      return "modified";
    }
  }
  return found ? "added" : "modified";
}

function renderPreviewDeletedChanges(model) {
  renderPreviewInlineDeletions(model.inlineDeletions);
  for (const deletion of model.lineDeletions) {
    const block = previewDeletedLinesBlock(deletion);
    const anchorLine = Math.min(deletion.beforeLine, model.currentLines.length);
    const anchorBlock = sourceLineButtonForLine(anchorLine)?.closest(".source-block");
    if (anchorBlock && deletion.beforeLine <= model.currentLines.length) {
      anchorBlock.before(block);
    } else {
      documentContent.append(block);
    }
  }
}

function renderPreviewInlineDeletions(deletions) {
  const hintsByBlock = new Map();
  for (const deletion of deletions) {
    const block = sourceLineButtonForLine(deletion.line)?.closest(".source-block");
    const content = block?.querySelector(".source-block-content");
    if (!block || !content) {
      continue;
    }
    let hint = hintsByBlock.get(block);
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "document-preview-inline-deletions";
      hint.dataset.documentDeletedPreview = "true";
      content.prepend(hint);
      hintsByBlock.set(block, hint);
    }
    const fragment = document.createElement("span");
    fragment.className = "document-preview-deleted-inline";
    fragment.dataset.sourceLine = String(deletion.line);
    fragment.textContent = deletion.text || "\u200b";
    fragment.setAttribute("aria-label", t("changes.deletedText", { text: deletion.text }));
    hint.append(fragment);
  }
}

function previewDeletedLinesBlock(deletion) {
  const block = document.createElement("div");
  block.className = "source-block document-preview-deleted-block";
  block.dataset.documentDeletedPreview = "true";
  const gutter = document.createElement("div");
  gutter.className = "source-line-gutter document-preview-deleted-gutter";
  gutter.setAttribute("aria-label", t("changes.deletionsHint"));
  const content = document.createElement("div");
  content.className = "source-block-content";
  const rows = document.createElement("div");
  rows.className = "document-preview-deleted-lines";

  for (const line of deletion.lines) {
    const marker = document.createElement("span");
    marker.className = "document-preview-deleted-line-marker";
    marker.textContent = "−";
    marker.setAttribute("aria-label", t("changes.deletedLine", { line: line.number }));
    gutter.append(marker);

    const row = document.createElement("div");
    row.className = "document-preview-deleted-line";
    row.textContent = line.text || "\u200b";
    row.setAttribute(
      "aria-label",
      `${t("changes.deletedLine", { line: line.number })}: ${line.text}`,
    );
    rows.append(row);
  }

  content.append(rows);
  block.append(gutter, content);
  return block;
}

function readInitialDesktopPreferences() {
  const preferences = window.OPENGLANCE_DESKTOP_PREFERENCES;
  return preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? { ...preferences }
    : null;
}

function readTreeDirectoryStates({ preferences, storage = window.localStorage } = {}) {
  try {
    const fallbackValue = JSON.parse(storage?.getItem(TREE_DIRECTORY_STORAGE_KEY) || "{}");
    return treeDirectoryStatesFromPreference({ preferences, fallbackValue });
  } catch {
    return treeDirectoryStatesFromPreference({ preferences, fallbackValue: {} });
  }
}

function readWorkbenchSessions({ preferences, storage = window.localStorage } = {}) {
  try {
    const fallbackValue = JSON.parse(storage?.getItem(WORKBENCH_SESSION_STORAGE_KEY) || "{}");
    return workbenchSessionsFromPreference({ preferences, fallbackValue });
  } catch {
    return workbenchSessionsFromPreference({ preferences, fallbackValue: {} });
  }
}

function workbenchSessionsFromPreference({ preferences, fallbackValue } = {}) {
  if (preferences && typeof preferences === "object" && !Array.isArray(preferences)) {
    return normalizeWorkbenchSessions(preferences.workbenchSessions);
  }

  return normalizeWorkbenchSessions(fallbackValue);
}

function restoreWorkbenchSessionForCurrentRepo({ requestedFile = "" } = {}) {
  const session = workbenchSessionForLaunch(
    state.workbenchSessions,
    state.currentWorktreeId,
    requestedFile,
  );
  if (!session) {
    return;
  }

  restoreDocumentTabsForStartup({
    session,
    normalizeTabs: normalizeDocumentTabs,
    resolveActiveTabId: resolveActiveDocumentTabId,
    applyTabState: applyDocumentTabState,
  });
  state.currentFile = state.activeTabPath;
  state.lastTreeFocus = session.treeFocus ?? null;
  state.pendingWorkbenchTreeViewportRestore = true;
}

function ensureDocumentTabForCurrentFile() {
  if (!state.currentFile || state.activeTabId) {
    return;
  }
  const nextTabs = navigateDocumentTab({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    location: { path: state.currentFile },
    behavior: "foreground",
  });
  applyDocumentTabState(nextTabs, { render: true });
}

function currentTreeDirectoryStateScope() {
  return treeDirectoryStateScope({
    repoId: state.currentWorktreeId,
    view: state.sidebarTab,
  });
}

function restoreTreeDirectoryState() {
  resetTreeSearchDirectoryState();
  const storedDirectoryState = normalizeTreeDirectoryStates(state.treeDirectoryStates)[currentTreeDirectoryStateScope()] ?? {
    expanded: [],
    collapsed: [],
  };
  const directoryState = treeDirectoryStateForView({
    view: state.sidebarTab,
    directoryState: storedDirectoryState,
  });
  state.expandedTreeDirectories = new Set(directoryState.expanded);
  state.collapsedTreeDirectories = new Set(directoryState.collapsed);
}

function seedInitialTreeDirectoryExpansion() {
  for (const directoryPath of treeAncestorDirectories(state.currentFile)) {
    if (!state.collapsedTreeDirectories.has(directoryPath)) {
      state.expandedTreeDirectories.add(directoryPath);
    }
  }
}

function persistTreeDirectoryState() {
  const nextDirectoryStates = {
    ...state.treeDirectoryStates,
    [currentTreeDirectoryStateScope()]: serializeTreeDirectoryState({
      expandedDirectories: state.expandedTreeDirectories,
      collapsedDirectories: state.collapsedTreeDirectories,
    }),
  };
  state.treeDirectoryStates = normalizeTreeDirectoryStates(nextDirectoryStates);

  try {
    window.localStorage?.setItem(TREE_DIRECTORY_STORAGE_KEY, JSON.stringify(state.treeDirectoryStates));
  } catch {
    // Directory state is a convenience preference; failure should not interrupt navigation.
  }

  persistAppPreference("treeDirectories", state.treeDirectoryStates);
}

function resetTreeSearchDirectoryState() {
  state.searchAutoExpandedTreeDirectories.clear();
  state.searchExpandedTreeDirectories.clear();
  state.searchCollapsedTreeDirectories.clear();
}

function persistWorkbenchSession({ immediate = false } = {}) {
  if (!state.currentWorktreeId) {
    return;
  }

  const nextSessions = normalizeWorkbenchSessions({
    ...state.workbenchSessions,
    [state.currentWorktreeId]: serializeCurrentWorkbenchSession(),
  });
  state.workbenchSessions = nextSessions;

  try {
    window.localStorage?.setItem(WORKBENCH_SESSION_STORAGE_KEY, JSON.stringify(nextSessions));
  } catch {
    // Workbench restore state is best-effort outside the packaged desktop app.
  }

  persistAppPreference("workbenchSessions", nextSessions, { keepalive: immediate });
}

function scheduleWorkbenchSessionPersist() {
  window.clearTimeout(state.workbenchSessionTimer);
  state.workbenchSessionTimer = window.setTimeout(() => persistWorkbenchSession(), 250);
}

function flushWorkbenchSessionPreference() {
  window.clearTimeout(state.workbenchSessionTimer);
  state.workbenchSessionTimer = null;
  persistWorkbenchSession({ immediate: true });
}

function serializeCurrentWorkbenchSession() {
  return serializeWorkbenchSession({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    activeTabPath: state.activeTabPath,
    treeScrollTop: fileTree.scrollTop,
    treeFocus: state.lastTreeFocus,
  });
}

function applyDocumentTabState(
  result,
  { render = false, persist = false, revealActive = false } = {},
) {
  const tabs = normalizeDocumentTabs(result?.tabs);
  const activeTabId = resolveActiveDocumentTabId({
    tabs,
    activeTabId: result?.activeTabId,
    activePath: result?.activeTabPath,
  });
  state.documentTabs = tabs;
  state.activeTabId = activeTabId;
  state.activeTabPath = activeDocumentPath({ tabs, activeTabId });
  updateDocumentHistoryControls();
  if (render) {
    renderDocumentTabs();
  }
  if (revealActive) {
    revealActiveDocumentTab();
  }
  if (persist) {
    persistWorkbenchSession();
  }
}

function captureActiveDocumentLocation() {
  if (!state.currentDocument || !state.activeTabId) {
    return;
  }
  const nextTabs = updateActiveDocumentTabLocation({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    location: {
      path: state.currentDocument.path,
      hash: hashFromLines(state.selectedLines),
      scrollTop: documentContent.scrollTop,
    },
  });
  applyDocumentTabState(nextTabs);
}

function updateDocumentHistoryControls() {
  const { canGoBack, canGoForward } = documentTabHistoryAvailability({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
  });
  historyBackButton.disabled = !canGoBack;
  historyForwardButton.disabled = !canGoForward;
}

function replaceCurrentDocumentUrl() {
  const nextUrl = new URL("/", window.location.origin);
  nextUrl.searchParams.set("repo", state.currentRepo);
  if (state.currentDocument?.path) {
    nextUrl.searchParams.set("file", state.currentDocument.path);
    nextUrl.hash = hashFromLines(state.selectedLines);
  }
  window.history.replaceState(
    {
      repo: state.currentRepo,
      file: state.currentDocument?.path || "",
    },
    "",
    `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
  );
}

function preferenceValue(preferenceKey, storageKey) {
  if (
    state.desktopPreferencesAvailable &&
    Object.hasOwn(state.desktopPreferences, preferenceKey)
  ) {
    return state.desktopPreferences[preferenceKey];
  }

  try {
    return window.localStorage?.getItem(storageKey);
  } catch {
    return null;
  }
}

function persistAppPreference(preferenceKey, value, { keepalive = false } = {}) {
  state.desktopPreferences = {
    ...state.desktopPreferences,
    [preferenceKey]: value,
  };

  if (!state.desktopPreferencesAvailable) {
    return;
  }

  fetch(apiUrl("/api/preferences"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive,
    body: JSON.stringify({ [preferenceKey]: value }),
  })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (payload?.preferences && typeof payload.preferences === "object") {
        state.desktopPreferences = payload.preferences;
        if ("treeDirectories" in payload.preferences) {
          state.treeDirectoryStates = normalizeTreeDirectoryStates(payload.preferences.treeDirectories);
        }
        if ("workbenchSessions" in payload.preferences) {
          state.workbenchSessions = normalizeWorkbenchSessions(payload.preferences.workbenchSessions);
        }
      }
    })
    .catch(() => {
      // Preference persistence should never interrupt reading or editing.
    });
}

function applyEditCapability() {
  const canEditRepo = canEditCurrentRepo();
  const hasDocument = Boolean(state.currentDocument);
  const canUseEditor = canEditRepo && (!hasDocument || canEditCurrentDocument());
  document.querySelector("#mode-source").hidden = !canUseEditor;
  document.querySelector("#mode-live").hidden = !canUseEditor;
  modeReadonlyStatus.hidden = !shouldShowReadonlyModeStatus({
    hasDocument,
    canUseEditor,
  });
}

function applyRepositoryStatus(payload) {
  if (typeof payload?.branch === "string") {
    state.currentRepoBranch = payload.branch;
  }
  state.currentRepoDetached = payload?.detached === true || !state.currentRepoBranch;
  if (typeof payload?.canEdit === "boolean") {
    state.currentRepoCanEdit = payload.canEdit;
  } else {
    state.currentRepoCanEdit = state.canEdit;
  }
}

async function applyBranchProtectionPayload(payload) {
  if (!payload || typeof payload.branch !== "string") {
    return;
  }
  state.currentRepoBranch = payload.branch;
  state.currentRepoDetached = false;
  if (state.currentDocument) {
    state.currentDocument.branch = payload.branch;
    state.currentDocument.detached = false;
  }
  renderBranchStatus();
  if (payload.branchCreated) {
    showCopyToast(t("branch.created", { branch: payload.branch }));
    await loadWorktrees();
  }
}

function renderRepositoryHeader(repo) {
  const repoName = String(repo?.name || repo?.id || state.currentRepo || "OpenGlance").trim();
  repositoryTitle.textContent = repoName;
  repositoryPanelToggle.hidden = !state.desktopPreferencesAvailable;
}

function handleDesktopRepositoriesEvent(event) {
  event.preventDefault();
  showRepositoryPanel(event.detail);
}

function showRepositoryPanel(payload = {}) {
  const opening = repositoryPanel.hidden;
  uiTooltipController.hide();
  closeWorktreeSwitcher();
  hideFrontmatterFilterPopover();
  setAgentContextPopoverOpen(false);
  closeFileActionMenu({ restoreFocus: false });
  if (state.activeDialog) {
    closeAppDialog(false);
  }
  if (!gitSyncPanel.hidden) {
    closeGitSyncPanel();
  }
  if (opening) {
    state.repositoryPanelReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : repositoryPanelToggle;
    repositoryPanelSearch.value = "";
  }

  state.repositoryPanelItems = normalizeRepositoryPanelItems(payload?.repositories);
  repositoryPanel.hidden = false;
  repositoryPanelToggle.setAttribute("aria-expanded", "true");
  renderRepositoryPanel();
  if (payload?.notice?.kind === "removed" && payload.notice.repository) {
    showCopyToast(t("toast.repositoryRemoved", {
      repository: payload.notice.repository,
    }));
  }
  window.requestAnimationFrame(() => {
    repositoryPanelSearch.focus({ preventScroll: true });
    repositoryPanelSearch.select();
  });
}

function closeRepositoryPanel({ notifyDesktop = true, restoreFocus = true } = {}) {
  if (repositoryPanel.hidden) {
    return;
  }
  closeFileActionMenu({ restoreFocus: false });
  repositoryPanel.hidden = true;
  repositoryPanelToggle.setAttribute("aria-expanded", "false");
  repositoryPanelSearch.removeAttribute("aria-activedescendant");
  state.repositoryPanelItems = [];
  state.repositoryPanelVisibleItems = [];
  state.repositoryPanelSelectedId = "";
  clearRepositoryPanelDrag();
  const returnFocus = state.repositoryPanelReturnFocus;
  state.repositoryPanelReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
  if (notifyDesktop) {
    requestRepositoryPanelAction("close");
  }
}

function renderRepositoryPanel() {
  const visibleItems = visibleRepositoryPanelItems(
    state.repositoryPanelItems,
    repositoryPanelSearch.value,
  );
  state.repositoryPanelVisibleItems = visibleItems;
  if (!visibleItems.some((item) => item.id === state.repositoryPanelSelectedId)) {
    state.repositoryPanelSelectedId = defaultRepositoryPanelSelection(visibleItems);
  }

  repositoryPanelList.replaceChildren(
    ...visibleItems.map(repositoryPanelRowElement),
  );
  repositoryPanelList.hidden = visibleItems.length === 0;
  repositoryPanelEmpty.hidden = visibleItems.length > 0;
  const activeOptionId = repositoryPanelOptionId(state.repositoryPanelSelectedId);
  if (activeOptionId) {
    repositoryPanelSearch.setAttribute("aria-activedescendant", activeOptionId);
  } else {
    repositoryPanelSearch.removeAttribute("aria-activedescendant");
  }
}

function repositoryPanelRowElement(item) {
  const row = document.createElement("div");
  row.className = "repository-panel-row";
  row.classList.toggle("is-selected", item.id === state.repositoryPanelSelectedId);
  row.dataset.repositoryPanelRow = item.id;

  const dragHandle = document.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "repository-panel-row-drag";
  dragHandle.dataset.repositoryPanelDrag = item.id;
  dragHandle.setAttribute("aria-label", t("repository.reorder", { repository: item.name }));
  dragHandle.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
  dragHandle.setAttribute("data-ui-tooltip", t("repository.reorderHint"));
  dragHandle.textContent = "⠿";

  const main = document.createElement("button");
  main.type = "button";
  main.id = repositoryPanelOptionId(item.id);
  main.className = "repository-panel-row-main";
  main.dataset.repositoryPanelId = item.id;
  main.setAttribute("role", "option");
  main.setAttribute("aria-selected", String(item.id === state.repositoryPanelSelectedId));
  if (item.current) {
    main.setAttribute("aria-current", "true");
  }

  const check = document.createElement("span");
  check.className = "repository-panel-row-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = item.current ? "✓" : "";

  const copy = document.createElement("span");
  copy.className = "repository-panel-row-copy";
  const name = document.createElement("span");
  name.className = "repository-panel-row-name";
  name.textContent = item.name;
  copy.append(name);
  if (item.context) {
    const context = document.createElement("span");
    context.className = "repository-panel-row-context";
    context.textContent = item.context;
    copy.append(context);
  }

  const hasShortcut = Number.isInteger(item.shortcut);
  const key = document.createElement(hasShortcut ? "kbd" : "span");
  key.className = item.current
    ? "repository-panel-row-current"
    : hasShortcut
      ? "repository-panel-row-shortcut"
      : "repository-panel-row-key-empty";
  key.textContent = item.current
    ? t("repository.current")
    : hasShortcut
      ? platformShortcutLabel(`Command+${item.shortcut}`)
      : "";
  if (hasShortcut) {
    key.setAttribute("aria-hidden", "true");
  }
  main.append(check, copy, key);

  const actions = document.createElement("button");
  actions.type = "button";
  actions.className = "repository-panel-row-action";
  actions.dataset.repositoryPanelAction = item.id;
  actions.setAttribute("aria-label", t("repository.actions", { repository: item.name }));
  actions.setAttribute("aria-haspopup", "menu");
  actions.setAttribute("aria-expanded", "false");
  actions.textContent = "···";

  row.append(dragHandle, main, actions);
  return row;
}

function handleRepositoryPanelPointerDown(event) {
  const handle = event.target.closest?.("[data-repository-panel-drag]");
  if (!handle || event.button !== 0 || state.repositoryPanelItems.length < 2) {
    return;
  }
  const repositoryId = handle.dataset.repositoryPanelDrag;
  if (!state.repositoryPanelItems.some((item) => item.id === repositoryId)) {
    return;
  }

  event.preventDefault();
  handle.focus({ preventScroll: true });
  handle.setPointerCapture?.(event.pointerId);
  state.repositoryPanelPointerDrag = {
    id: repositoryId,
    pointerId: event.pointerId,
    startY: event.clientY,
    dragging: false,
  };
}

function handleRepositoryPanelPointerMove(event) {
  const pointerDrag = state.repositoryPanelPointerDrag;
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
    return;
  }
  event.preventDefault();
  if (!pointerDrag.dragging) {
    if (Math.abs(event.clientY - pointerDrag.startY) < 4) {
      return;
    }
    pointerDrag.dragging = true;
    state.repositoryPanelDraggingId = pointerDrag.id;
    state.repositoryPanelSelectedId = pointerDrag.id;
    repositoryPanelList
      .querySelector(`[data-repository-panel-row="${cssEscape(pointerDrag.id)}"]`)
      ?.classList.add("is-dragging");
  }
  autoScrollRepositoryPanelDuringDrag(event.clientY);
  showRepositoryPanelDropTarget(repositoryPanelDropTarget(event.clientY));
}

function handleRepositoryPanelPointerUp(event) {
  finishRepositoryPanelPointerDrag(event, { cancelled: false });
}

function handleRepositoryPanelPointerCancel(event) {
  finishRepositoryPanelPointerDrag(event, { cancelled: true });
}

function finishRepositoryPanelPointerDrag(event, { cancelled }) {
  const pointerDrag = state.repositoryPanelPointerDrag;
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
    return;
  }
  if (pointerDrag.dragging) {
    event.preventDefault();
  }
  const handle = repositoryPanelList.querySelector(
    `[data-repository-panel-drag="${cssEscape(pointerDrag.id)}"]`,
  );
  if (handle?.hasPointerCapture?.(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId);
  }
  const dropTarget = pointerDrag.dragging && !cancelled
    ? repositoryPanelDropTarget(event.clientY)
    : null;
  clearRepositoryPanelDrag();
  if (!dropTarget) {
    return;
  }
  applyRepositoryPanelReorder(pointerDrag.id, dropTarget.id, dropTarget.placement);
}

function repositoryPanelDropTarget(clientY) {
  const rows = [...repositoryPanelList.querySelectorAll("[data-repository-panel-row]")]
    .filter((row) => row.dataset.repositoryPanelRow !== state.repositoryPanelDraggingId);
  if (rows.length === 0) {
    return null;
  }
  const targetRow = rows.find((row) => clientY < row.getBoundingClientRect().bottom) ?? rows.at(-1);
  const rect = targetRow.getBoundingClientRect();
  return {
    id: targetRow.dataset.repositoryPanelRow,
    placement: clientY < rect.top + rect.height / 2 ? "before" : "after",
  };
}

function showRepositoryPanelDropTarget(dropTarget) {
  for (const row of repositoryPanelList.querySelectorAll("[data-repository-panel-row]")) {
    row.classList.remove("is-drop-before", "is-drop-after");
  }
  if (!dropTarget) {
    return;
  }
  repositoryPanelList
    .querySelector(`[data-repository-panel-row="${cssEscape(dropTarget.id)}"]`)
    ?.classList.add(dropTarget.placement === "after" ? "is-drop-after" : "is-drop-before");
}

function autoScrollRepositoryPanelDuringDrag(clientY) {
  const rect = repositoryPanelList.getBoundingClientRect();
  const edgeSize = 32;
  if (clientY < rect.top + edgeSize) {
    repositoryPanelList.scrollTop -= 16;
  } else if (clientY > rect.bottom - edgeSize) {
    repositoryPanelList.scrollTop += 16;
  }
}

function clearRepositoryPanelDrag() {
  const pointerDrag = state.repositoryPanelPointerDrag;
  const handle = pointerDrag
    ? repositoryPanelList.querySelector(
        `[data-repository-panel-drag="${cssEscape(pointerDrag.id)}"]`,
      )
    : null;
  if (handle?.hasPointerCapture?.(pointerDrag.pointerId)) {
    handle.releasePointerCapture(pointerDrag.pointerId);
  }
  state.repositoryPanelDraggingId = "";
  state.repositoryPanelPointerDrag = null;
  for (const row of repositoryPanelList.querySelectorAll("[data-repository-panel-row]")) {
    row.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  }
}

function applyRepositoryPanelReorder(
  movedId,
  targetId,
  placement,
  { restoreDragFocus = false } = {},
) {
  const previousIds = state.repositoryPanelItems.map((item) => item.id);
  const reorderedItems = reorderRepositoryPanelItems(
    state.repositoryPanelItems,
    movedId,
    targetId,
    placement,
  );
  const reorderedIds = reorderedItems.map((item) => item.id);
  if (reorderedIds.every((id, index) => id === previousIds[index])) {
    return false;
  }

  state.repositoryPanelItems = reorderedItems;
  state.repositoryPanelSelectedId = movedId;
  renderRepositoryPanel();
  requestRepositoryPanelOrder(reorderedIds);
  if (restoreDragFocus) {
    window.requestAnimationFrame(() => {
      repositoryPanelList
        .querySelector(`[data-repository-panel-drag="${cssEscape(movedId)}"]`)
        ?.focus({ preventScroll: true });
    });
  }
  return true;
}

function repositoryPanelOptionId(repositoryId) {
  const id = String(repositoryId ?? "").trim();
  return id ? `repository-panel-option-${id}` : "";
}

function handleRepositoryPanelClick(event) {
  if (event.target === repositoryPanel) {
    closeRepositoryPanel();
    return;
  }
  const actionButton = event.target.closest?.("[data-repository-panel-action]");
  if (actionButton) {
    event.stopPropagation();
    showRepositoryPanelActions(actionButton.dataset.repositoryPanelAction, actionButton);
    return;
  }
  const option = event.target.closest?.("[data-repository-panel-id]");
  if (!option) {
    return;
  }
  activateRepositoryPanelItem(
    state.repositoryPanelVisibleItems.find((item) => item.id === option.dataset.repositoryPanelId),
  );
}

function handleRepositoryPanelKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeRepositoryPanel();
    return;
  }
  const dragHandle = event.target.closest?.("[data-repository-panel-drag]");
  if (dragHandle && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const movedId = dragHandle.dataset.repositoryPanelDrag;
    const currentIndex = state.repositoryPanelVisibleItems.findIndex((item) => item.id === movedId);
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const target = state.repositoryPanelVisibleItems[currentIndex + direction];
    if (target) {
      applyRepositoryPanelReorder(
        movedId,
        target.id,
        direction < 0 ? "before" : "after",
        { restoreDragFocus: true },
      );
    }
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const visibleItems = state.repositoryPanelVisibleItems;
    if (visibleItems.length === 0) {
      return;
    }
    state.repositoryPanelSelectedId = event.key === "Home"
      ? visibleItems[0].id
      : event.key === "End"
        ? visibleItems.at(-1).id
        : moveRepositoryPanelSelection(
            visibleItems,
            state.repositoryPanelSelectedId,
            event.key === "ArrowUp" ? -1 : 1,
          );
    renderRepositoryPanel();
    focusRepositoryPanelSelection();
    return;
  }
  if (
    event.key === "Enter"
    && !event.isComposing
    && event.target === repositoryPanelSearch
  ) {
    event.preventDefault();
    event.stopPropagation();
    activateRepositoryPanelItem(
      state.repositoryPanelVisibleItems.find(
        (item) => item.id === state.repositoryPanelSelectedId,
      ),
    );
    return;
  }
  if (event.key === "Tab") {
    trapRepositoryPanelFocus(event);
  }
}

function focusRepositoryPanelSelection() {
  repositoryPanel.querySelector(`#${cssEscape(repositoryPanelOptionId(state.repositoryPanelSelectedId))}`)
    ?.scrollIntoView({ block: "nearest" });
  repositoryPanelSearch.focus({ preventScroll: true });
}

function trapRepositoryPanelFocus(event) {
  const focusable = [
    repositoryPanelClose,
    repositoryPanelSearch,
    ...repositoryPanelList.querySelectorAll("button"),
    repositoryPanelOpen,
  ].filter((element) => !element.hidden && !element.disabled);
  if (focusable.length === 0) {
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement);
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
    : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
  if (
    (event.shiftKey && currentIndex <= 0)
    || (!event.shiftKey && (currentIndex < 0 || currentIndex === focusable.length - 1))
  ) {
    event.preventDefault();
    focusable[nextIndex].focus({ preventScroll: true });
  }
}

function activateRepositoryPanelItem(item) {
  if (!item) {
    return;
  }
  if (item.current) {
    closeRepositoryPanel();
    return;
  }
  flushWorkbenchSessionPreference();
  closeRepositoryPanel({ notifyDesktop: false, restoreFocus: false });
  requestRepositoryPanelAction("switch", item.id);
}

function openAnotherRepositoryFromPanel() {
  closeRepositoryPanel({ notifyDesktop: false });
  requestRepositoryPanelAction("open");
}

function showRepositoryPanelActions(repositoryId, returnFocus) {
  const item = state.repositoryPanelItems.find((candidate) => candidate.id === repositoryId);
  if (!item) {
    return;
  }
  const rect = returnFocus.getBoundingClientRect();
  state.fileActionTarget = {
    source: "repository",
    repositoryId: item.id,
    repositoryCurrent: item.current,
  };
  showFileActionMenu([
    {
      id: "remove-repository",
      label: item.current
        ? t("repository.removeCurrent")
        : t("repository.remove"),
    },
  ], {
    x: rect.right,
    y: rect.bottom + 4,
    alignRight: true,
    returnFocus,
  });
  returnFocus.setAttribute("aria-expanded", "true");
}

function requestRepositoryPanelAction(action, repositoryId = "") {
  const url = repositoryPanelActionUrl(action, repositoryId);
  if (url) {
    window.location.href = url;
  }
}

function requestRepositoryPanelOrder(repositoryIds) {
  const url = repositoryPanelReorderUrl(repositoryIds);
  if (url) {
    window.location.href = url;
  }
}

function renderBranchStatus() {
  if (!state.currentRepoDetached) {
    branchStatus.hidden = true;
    branchStatus.textContent = "";
    return;
  }
  branchStatus.textContent = t("branch.detachedHelp");
  branchStatus.hidden = false;
}

function enforceCurrentRepoEditCapability() {
  renderBranchStatus();
  applyEditCapability();
  if (!canEditCurrentDocument() && isEditingModeName(state.mode)) {
    setMode("preview", { persist: false, focus: false });
  }
}

function repositoryById(repoId) {
  return state.repositories.find((repo) => repo.id === repoId);
}

function apiUrl(pathname, params = {}) {
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set("repo", state.currentRepo);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

function updateDocumentActions(hasDocument) {
  const canUseEditor = hasDocument && canEditCurrentDocument();
  floatingDocumentActions.hidden = !hasDocument;
  documentFavoriteToggle.hidden = !hasDocument || !isMarkdownDocument();
  copyShareLinkButton.hidden = !hasDocument || !isMarkdownDocument();
  copyShareLinkButton.disabled = !hasDocument || !isMarkdownDocument();
  documentActionsMore.disabled = !hasDocument;
  documentNewButton.disabled = !canEditCurrentRepo();
  emptyNewDocument.disabled = !canEditCurrentRepo();
  document.querySelector("#mode-source").disabled = !canUseEditor;
  document.querySelector("#mode-live").disabled = !canUseEditor;
  updateDocumentFavoriteToggle();
}

function updateDocumentFavoriteToggle() {
  const path = state.currentDocument?.path || "";
  const active = Boolean(path) && isMarkdownDocument() && isFavoriteItem("document", path);
  const label = active ? t("action.removeFavorite") : t("action.addFavorite");
  documentFavoriteToggle.setAttribute("aria-pressed", String(active));
  documentFavoriteToggle.setAttribute("aria-label", shortcutTooltip(label, "Command+D"));
  setShortcutTooltip(documentFavoriteToggle, label, "Command+D");
}

function ensureSourceEditor() {
  if (state.sourceEditor) {
    return;
  }
  state.sourceEditor = createSourceEditor({
    parent: sourceEditorHost,
    doc: state.currentDocument?.source ?? "",
    locale: state.locale,
    onChange: scheduleSourceSync,
    onFocusChange: handleSourceEditorFocusChange,
    onScroll: handleSourceEditorScroll,
    onLineSelect: selectSourceLine,
    onBlankClick: clearLineSelection,
    onImageClick: selectImageBlock,
    onLinkClick: selectLiveLink,
    onFrontmatterClick: selectLiveFrontmatterField,
    onContextToolbarSelect: clearWorkbenchLiveEditToolbar,
    onPasteImage: pasteImageAsset,
    onPasteText: pasteTextLink,
    onSlashCommand: runSlashCommand,
    theme: state.theme,
    getDocumentPath: () => state.currentDocument?.path ?? "",
    getRenderOptions: () => documentRenderOptions(),
    onBeforeSlashCommand: ensureSlashCommandAllowed,
  });
  applySourceEditorDocumentChangeBaseline();
}

function applyAppearancePreferences(preferences) {
  const normalized = normalizeUserPreferences(preferences, {
    defaults: DEFAULT_USER_PREFERENCES,
  });
  state.colorMode = normalized.colorMode;
  state.documentFont = normalized.documentFont;
  state.documentFontSize = normalized.documentFontSize;
  state.fileTreeMode = normalized.fileTreeMode;
  state.showDocumentTitles = normalized.showDocumentTitles;
  state.theme = effectiveColorScheme(state.colorMode, {
    systemDark: systemColorSchemeQuery?.matches === true,
  });
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.documentFont = state.documentFont;
  document.documentElement.style.colorScheme = state.theme;
  document.documentElement.style.setProperty("--document-font-size", `${state.documentFontSize}px`);
  updateThemeToggle();
  state.sourceEditor?.setTheme(state.theme);
  documentMermaidController.rerender();
  sourceMermaidController.rerender();
  scheduleAnchoredSourceLineGutterSync();
}

function toggleWebTheme() {
  if (state.desktopPreferencesAvailable) {
    return;
  }
  const theme = writeThemePreference(nextTheme(state.theme));
  applyAppearancePreferences({
    colorMode: theme,
    documentFont: state.documentFont,
    documentFontSize: state.documentFontSize,
    fileTreeMode: state.fileTreeMode,
    showDocumentTitles: state.showDocumentTitles,
  });
}

function updateThemeToggle() {
  themeToggle.hidden = state.desktopPreferencesAvailable;
  if (state.desktopPreferencesAvailable) {
    return;
  }
  const isDark = state.theme === "dark";
  const label = isDark ? t("action.switchLight") : t("action.switchDark");
  themeToggle.textContent = isDark ? "☀" : "☾";
  setUiTooltip(themeToggle, label);
  themeToggle.setAttribute("aria-label", label);
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

function handleDesktopPreferencesEvent(event) {
  const preferences = event.detail;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return;
  }
  const nextLocale = resolveLocalePreference(
    preferences.resolvedLanguage ?? preferences.language ?? "system",
    window.navigator.languages ?? [window.navigator.language],
  );
  if (nextLocale !== state.locale) {
    event.preventDefault();
    void reloadWorkbenchForLocaleChange();
    return;
  }
  const shouldRebuildFileTree = shouldRebuildFileTreeForPreferences(
    state.desktopPreferences,
    preferences,
    {
      defaults: DEFAULT_USER_PREFERENCES,
    },
  );
  const normalizedPreferences = normalizeUserPreferences(preferences, {
    defaults: DEFAULT_USER_PREFERENCES,
  });
  const remoteCheckIntervalChanged =
    normalizedPreferences.gitRemoteCheckIntervalMinutes
    !== state.gitRemoteCheckIntervalMinutes;
  const documentOutlineCollapsedChanged =
    typeof preferences.documentOutlineCollapsed === "boolean" &&
    preferences.documentOutlineCollapsed !== state.documentOutlineCollapsed;
  const documentOutlineWidthChanged =
    Number.isFinite(Number(preferences.documentOutlineWidth)) &&
    Number(preferences.documentOutlineWidth) !== currentDocumentOutlineWidth();
  state.desktopPreferences = { ...preferences };
  applyAppearancePreferences(preferences);
  state.gitRemoteCheckIntervalMinutes = normalizedPreferences.gitRemoteCheckIntervalMinutes;
  if (shouldRebuildFileTree) {
    renderTree();
  }
  if (remoteCheckIntervalChanged) {
    resetRemoteSyncPolling();
  }
  if (documentOutlineCollapsedChanged) {
    setDocumentOutlineCollapsed(preferences.documentOutlineCollapsed, { persist: false });
  }
  if (documentOutlineWidthChanged) {
    setDocumentOutlineWidth(preferences.documentOutlineWidth, { persist: false });
  }
  event.preventDefault();
}

async function reloadWorkbenchForLocaleChange() {
  try {
    await flushPendingSourceSync();
    flushWorkbenchSessionPreference();
    window.location.reload();
  } catch {
    showCopyToast(t("error.localeReload"));
  }
}

function handleSystemColorSchemeChange() {
  if (state.colorMode !== "system") {
    return;
  }
  applyAppearancePreferences({
    ...state.desktopPreferences,
    colorMode: state.colorMode,
    documentFont: state.documentFont,
    documentFontSize: state.documentFontSize,
    fileTreeMode: state.fileTreeMode,
    showDocumentTitles: state.showDocumentTitles,
  });
}

function applyShortcutTooltips() {
  setShortcutTooltip(sidebarToggle, t("action.collapseSidebar"), "Command+B");
  setShortcutTooltip(repositoryPanelToggle, t("repository.openPanel"), "Command+O");
  repositoryPanelToggle?.setAttribute("aria-keyshortcuts", "Meta+O Control+O");
  repositoryPanelOpen.querySelector("kbd").textContent = platformShortcutLabel("Command+0");
  for (const [index, sidebarTab] of SIDEBAR_TABS.entries()) {
    const button = sidebarTabButtons.find(
      (candidate) => candidate.dataset.sidebarTab === sidebarTab,
    );
    const shortcut = `Option+${index + 1}`;
    setShortcutTooltip(button, t(`sidebar.${sidebarTab}`), shortcut);
    button?.setAttribute("aria-keyshortcuts", `Alt+${index + 1}`);
  }
  setShortcutTooltip(historyBackButton, t("action.back"), "Command+[");
  setShortcutTooltip(historyForwardButton, t("action.forward"), "Command+]");
  setUiTooltip(documentNewButton, t("action.newDocument"));
  setShortcutButtonLabel(copyShareLinkButton, t("action.copyShareLink"), "Command+Shift+L");
  updateDocumentFavoriteToggle();
  setShortcutButtonLabel(document.querySelector("#mode-preview"), "Preview", "Command+P");
  setShortcutButtonLabel(document.querySelector("#mode-source"), "Source", "Command+S");
  setShortcutButtonLabel(document.querySelector("#mode-live"), "Live", "Command+L");
  setShortcutTooltip(treeFilter, t("search.filesTooltip"), "Command+K");
  setShortcutTooltip(documentSearchPrevious, t("action.previousMatch"), "Shift+Enter");
  setShortcutTooltip(documentSearchNext, t("action.nextMatch"), "Enter");
  setShortcutTooltip(documentSearchClose, t("action.closeSearch"), "Escape");
  treeFilter.placeholder = t("search.short", {
    shortcut: platformShortcutLabel("Command+K"),
  });
}

function setShortcutButtonLabel(element, label, shortcut) {
  if (!element) {
    return;
  }

  const labelText = document.createElement("span");
  labelText.textContent = label;

  const shortcutText = document.createElement("span");
  shortcutText.className = "button-shortcut";
  shortcutText.setAttribute("aria-hidden", "true");
  shortcutText.textContent = platformShortcutLabel(shortcut);

  element.textContent = "";
  element.append(labelText, shortcutText);
  element.setAttribute("aria-label", shortcutTooltip(label, shortcut));
}

function setUiTooltip(element, label, {
  shortcut = "",
  detail = "",
  placement = "",
} = {}) {
  if (!element) {
    return;
  }
  const values = {
    uiTooltip: label,
    uiTooltipShortcut: shortcut,
    uiTooltipDetail: detail,
    uiTooltipPlacement: placement,
  };
  const anchor = element.parentElement?.matches?.("[data-ui-tooltip-anchor]")
    ? element.parentElement
    : null;
  for (const target of [element, anchor].filter(Boolean)) {
    for (const [key, value] of Object.entries(values)) {
      const normalized = String(value || "").trim();
      if (normalized) {
        target.dataset[key] = normalized;
      } else {
        delete target.dataset[key];
      }
    }
    target.removeAttribute("title");
  }
}

function setShortcutTooltip(element, label, shortcut, options = {}) {
  setUiTooltip(element, label, {
    ...options,
    shortcut: platformShortcutLabel(shortcut),
  });
}

function shortcutTooltip(label, shortcut) {
  return `${label} (${platformShortcutLabel(shortcut)})`;
}

function platformShortcutLabel(shortcut) {
  if (!isMacPlatform()) {
    return String(shortcut)
      .replace(/^Command/, "Ctrl")
      .replaceAll("+Command", "+Ctrl")
      .replace(/^Control/, "Ctrl")
      .replaceAll("+Control", "+Ctrl")
      .replace(/^Option/, "Alt")
      .replaceAll("+Option", "+Alt");
  }
  return String(shortcut)
    .split("+")
    .map((part) => {
      if (part === "Command") {
        return "⌘";
      }
      if (part === "Shift") {
        return "⇧";
      }
      if (part === "Control") {
        return "⌃";
      }
      if (part === "Option") {
        return "⌥";
      }
      return part;
    })
    .join("");
}

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
}

function documentRenderOptions() {
  return {
    currentFile: state.currentDocument?.path ?? state.currentFile,
    currentRepo: state.currentRepo,
    locale: state.locale,
  };
}

async function ensureSlashCommandAllowed(command) {
  if (!command?.requiresMdx || !state.currentDocument?.path) {
    recordSlashCommandTelemetry(command);
    return true;
  }
  if (!/\.md$/i.test(state.currentDocument.path)) {
    recordSlashCommandTelemetry(command);
    return true;
  }

  const currentPath = state.currentDocument.path;
  const nextPath = currentPath.replace(/\.md$/i, ".mdx");
  const { confirmed } = await showAppDialog({
    title: t("dialog.renameMdxTitle"),
    message: [
      t("dialog.renameMdxLead"),
      t("dialog.renameMdxQuestion", {
        currentPath,
        nextPath,
        component: command.title || command.label,
      }),
      t("dialog.renameMdxWarning"),
    ].join("\n"),
    confirmText: t("action.renameAndInsert"),
    cancelText: t("action.cancel"),
  });
  if (!confirmed) {
    recordTelemetryFeature("editing.markdown_to_mdx", { result: "cancel" });
    return false;
  }

  try {
    await flushPendingSourceSync();
    const response = await fetch(apiUrl("/api/rename-document", {
      file: currentPath,
      locale: state.locale,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extension: ".mdx" }),
    });
    const payload = await response.json().catch(() => ({ error: t("error.rename") }));
    if (!response.ok) {
      throw new Error(payload.error || t("error.rename"));
    }
    await applyBranchProtectionPayload(payload);
    await replaceFavoriteDocumentPath(currentPath, payload.path);

    replaceOpenDocumentTabPath(currentPath, payload.path);
    state.currentFile = payload.path;
    state.currentRepo = payload.repo || state.currentRepo;
    applyDocumentData(payload, {
      preserveScroll: true,
      forceReplace: true,
    });
    await loadTree({ force: true });
    resetStatusPolling();
    resetDocumentWatch();
    recordTelemetryFeature("editing.markdown_to_mdx", { result: "success" });
    recordSlashCommandTelemetry(command);
    showCopyToast(t("toast.renamedMdx"));
    return true;
  } catch (error) {
    recordTelemetryFeature("editing.markdown_to_mdx", { result: "error" });
    showCopyToast(error instanceof Error ? error.message : t("error.rename"));
    return false;
  }
}

function handleSourceEditorScroll(sourceMetrics) {
  if (Number.isInteger(sourceMetrics.visibleLine)) {
    state.lastSourceVisibleLine = sourceMetrics.visibleLine;
  }
  scheduleSelectionPopoverPosition();
  positionLinkPopover();
  positionFrontmatterFieldPopover();
  if (state.mode === "live") {
    updateActiveOutlineFromContentScroll(
      activeOutlineIdForSourceLine(sourceMetrics.visibleLine, state.outlineItems),
    );
    return;
  }

  syncPreviewScrollFromSource(sourceMetrics);
}

function syncPreviewScrollFromSource(sourceMetrics) {
  if (state.mode !== "source") {
    return;
  }
  if (state.scrollSyncSource === "preview") {
    return;
  }
  scrollPreviewToSourceLine(sourceMetrics.visibleLine);
}

function scrollPreviewToSourceLine(sourceLine) {
  const availableLines = [...documentContent.querySelectorAll("[data-source-line]")]
    .map((button) => Number(button.dataset.sourceLine));
  const targetLine = sourceLineForPreviewSync(sourceLine, availableLines);
  if (!Number.isInteger(targetLine)) {
    return;
  }

  const target = documentContent.querySelector(`[data-source-line="${targetLine}"]`);
  if (!target) {
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const contentRect = documentContent.getBoundingClientRect();
  state.scrollSyncSource = "source";
  documentContent.scrollTop += targetRect.top - contentRect.top - 16;
  window.setTimeout(() => {
    if (state.scrollSyncSource === "source") {
      state.scrollSyncSource = null;
    }
  }, 80);
}

function syncSourceScrollFromPreview(sourceLine = currentPreviewVisibleLine()) {
  if (state.mode !== "source" || !state.sourceEditor) {
    return;
  }
  if (state.scrollSyncSource === "source") {
    return;
  }

  scrollSourceEditorToSourceLine(sourceLine);
}

function scrollSourceEditorToSourceLine(sourceLine) {
  if (!Number.isInteger(sourceLine) || !state.sourceEditor) {
    return;
  }

  state.scrollSyncSource = "preview";
  state.sourceEditor.scrollToLine(sourceLine);
  window.setTimeout(() => {
    if (state.scrollSyncSource === "preview") {
      state.scrollSyncSource = null;
    }
  }, 80);
}

function scheduleSourceSync(source) {
  if (!canEditCurrentDocument() || !isEditorMode() || !state.currentDocument) {
    return;
  }
  state.currentDocument.source = source;
  state.lastSourceEditAt = Date.now();
  state.sourceRevision += 1;
  if (state.remoteSyncPreparedMerge) {
    const prepared = state.remoteSyncPreparedMerge;
    state.remoteSyncPreparedMerge = null;
    void cancelRemoteMergePreparationToken(prepared.token);
    markAutomaticRemoteMergeDeferred(prepared.key, prepared.incomingFiles);
    scheduleAutomaticRemoteMergeRetry();
  }
  refreshDocumentSearch({ preserveIndex: true, reveal: false });
  updateSourceSyncStatus("syncing");
  window.clearTimeout(state.sourceSyncTimer);
  state.sourceSyncTimer = window.setTimeout(syncSourceToDisk, SOURCE_SYNC_DELAY_MS);
}

async function syncSourceToDisk() {
  if (!canEditCurrentDocument() || !state.currentDocument || !state.sourceEditor) {
    return true;
  }

  const request = currentDocumentRequest();
  if (!request) {
    return true;
  }
  window.clearTimeout(state.sourceSyncTimer);
  state.sourceSyncTimer = null;
  state.sourceWriteInFlight = true;
  const source = state.sourceEditor.getValue();
  try {
    const response = await fetch(
      apiUrl("/api/document", { repo: request.repoId, file: request.path }),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      },
    );
    if (!response.ok) {
      throw new Error("Source sync failed");
    }
    const payload = await response.json();
    await applyBranchProtectionPayload(payload);
    if (!isCurrentDocumentRequest(request)) {
      scheduleGitStatusRefresh();
      return true;
    }
    state.currentDocument = {
      ...state.currentDocument,
      source,
      mtimeMs: payload.mtimeMs,
      sourceHash: payload.sourceHash,
    };
    state.lastWrittenHash = payload.sourceHash;
    state.frontmatterFacets = null;
    await refreshCurrentDocument();
    if (
      state.frontmatterFilters.length > 0 ||
      (state.filter.length > 0 && state.frontmatterAllowedKeys.length > 0)
    ) {
      await ensureFrontmatterFacets({ force: true });
    }
    scheduleGitStatusRefresh();
    updateSourceSyncStatus("idle");
    const telemetryNow = Date.now();
    if (telemetryNow - lastEditingTelemetryAt >= EDITING_TELEMETRY_INTERVAL_MS) {
      recordTelemetryFeature("editing.activity", { mode: state.mode });
      lastEditingTelemetryAt = telemetryNow;
    }
    return true;
  } catch (error) {
    if (isCurrentDocumentRequest(request)) {
      updateSourceSyncStatus("error");
    }
    return false;
  } finally {
    state.sourceWriteInFlight = false;
  }
}

function handleToolStatusActivity() {
  void checkToolStatusFromActivity();
}

function handleToolStatusVisibilityChange() {
  if (document.visibilityState === "visible") {
    void checkToolStatusFromActivity({ force: true });
  }
}

async function checkToolStatusFromActivity({ force = false } = {}) {
  if (!state.canEdit || state.toolRestartInFlight) {
    return;
  }

  const now = Date.now();
  if (!force && now - state.lastToolStatusCheckAt < TOOL_STATUS_CHECK_INTERVAL_MS) {
    return;
  }
  state.lastToolStatusCheckAt = now;

  try {
    const response = await fetch("/api/tool-status?force=1", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const status = await response.json();
    if (status.toolFingerprint) {
      state.toolFingerprint = status.toolFingerprint;
    }
    if (status.stale) {
      await restartToolAfterUpdate(status);
    }
  } catch {
    // Tool status checks are opportunistic; document work should continue if they fail.
  }
}

async function restartToolAfterUpdate(status) {
  if (state.toolRestartInFlight) {
    return;
  }

  state.toolRestartInFlight = true;
  const previousFingerprint = status.toolFingerprint || state.toolFingerprint;
  showCopyToast(t("toast.toolUpdating"));
  try {
    await flushPendingSourceSync();
    const response = await fetch("/api/restart", { method: "POST" });
    if (!response.ok) {
      throw new Error("Restart request failed");
    }
    await waitForToolRestart(previousFingerprint);
    window.location.reload();
  } catch {
    state.toolRestartInFlight = false;
    showCopyToast(t("toast.toolUpdateFailed"));
  }
}

async function flushPendingSourceSync() {
  if (!state.canEdit || !isEditorMode() || !state.currentDocument || !state.sourceEditor) {
    return;
  }

  if (state.sourceSyncTimer) {
    window.clearTimeout(state.sourceSyncTimer);
    state.sourceSyncTimer = null;
    const synced = await syncSourceToDisk();
    if (!synced) {
      throw new Error("Source sync failed before restart");
    }
  }

  const startedAt = Date.now();
  while (state.sourceWriteInFlight && Date.now() - startedAt < 3_000) {
    await delay(50);
  }
}

async function waitForToolRestart(previousFingerprint) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TOOL_RESTART_WAIT_TIMEOUT_MS) {
    await delay(TOOL_RESTART_WAIT_INTERVAL_MS);
    const status = await healthPayloadAfterRestart();
    if (
      ["openglance", "git-leaf"].includes(status?.app) &&
      status.toolFingerprint &&
      !status.stale &&
      status.toolFingerprint !== previousFingerprint
    ) {
      return;
    }
  }

  throw new Error("OpenGlance restart did not become ready in time");
}

async function healthPayloadAfterRestart() {
  try {
    const response = await fetch("/api/health?check=1", { cache: "no-store" });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function updateSourceSyncStatus(nextState) {
  const label = syncLabelForState(nextState, state.locale);
  const status = document.querySelector("#source-sync-status");
  if (!label) {
    status.hidden = true;
    status.textContent = "";
    delete status.dataset.state;
    return;
  }
  status.hidden = false;
  status.textContent = label;
  status.dataset.state = nextState;
}

window.addEventListener("popstate", (event) => {
  // Browser history is not document navigation. Keeping the URL as a projection of
  // the active tab prevents stale browser entries from reopening another repository.
  event.preventDefault?.();
  replaceCurrentDocumentUrl();
});

function handleSidebarTabClick(event) {
  const button = event.target.closest?.("[data-sidebar-tab]");
  if (!button || !sidebarTreeTabs.contains(button)) {
    return;
  }
  setSidebarTab(button.dataset.sidebarTab);
}

function handleSidebarTabKeydown(event) {
  const button = event.target.closest?.("[data-sidebar-tab]");
  if (!button || !sidebarTreeTabs.contains(button)) {
    return;
  }
  const nextTab = sidebarTabFromKey(button.dataset.sidebarTab, event.key);
  if (!nextTab) {
    return;
  }
  event.preventDefault();
  setSidebarTab(nextTab);
  sidebarTabButtons.find((candidate) => candidate.dataset.sidebarTab === nextTab)?.focus();
}

function switchSidebarTabFromShortcut(value) {
  const nextTab = normalizeSidebarTab(value);
  if (state.sidebarCollapsed) {
    setSidebarCollapsed(false);
  }
  setSidebarTab(nextTab);
  showSidebarTabShortcutFeedback(
    sidebarTabButtons.find((candidate) => candidate.dataset.sidebarTab === nextTab),
  );
}

function showSidebarTabShortcutFeedback(button) {
  window.clearTimeout(state.sidebarShortcutFeedbackTimer);
  for (const candidate of sidebarTabButtons) {
    candidate.classList.remove("has-shortcut-feedback");
  }
  if (!button) {
    return;
  }
  // Restart the feedback when the same shortcut is pressed repeatedly.
  void button.offsetWidth;
  button.classList.add("has-shortcut-feedback");
  state.sidebarShortcutFeedbackTimer = window.setTimeout(() => {
    button.classList.remove("has-shortcut-feedback");
    state.sidebarShortcutFeedbackTimer = null;
  }, 420);
}

function setSidebarTab(value) {
  const nextTab = normalizeSidebarTab(value);
  if (state.sidebarTab === nextTab) {
    return;
  }
  state.sidebarTab = nextTab;
  fileTree.scrollTop = 0;
  hideFrontmatterFilterPopover();
  closeFileActionMenu({ restoreFocus: false });
  restoreTreeDirectoryState();
  renderFrontmatterFilterAvailability();
  renderActiveFrontmatterFilters();
  renderGitChangeToolbar();
  renderTree();
}

function renderSidebarTabs() {
  for (const button of sidebarTabButtons) {
    const active = button.dataset.sidebarTab === state.sidebarTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  const activeButton = sidebarTabButtons.find(
    (button) => button.dataset.sidebarTab === state.sidebarTab,
  );
  if (activeButton) {
    fileTree.setAttribute("aria-labelledby", activeButton.id);
  }
  fileTree.dataset.sidebarTab = state.sidebarTab;
  renderSidebarControls();
}

function renderSidebarControls() {
  const controls = sidebarControlsForView(state.sidebarTab);
  treeControls.hidden = controls === "none";
  treeSearchRow.hidden = controls !== "search-and-filter";
}

function renderTree() {
  uiTooltipController.hide();
  renderSidebarTabs();
  const previousTreeFocus = treeFocusSnapshot();
  fileTree.innerHTML = "";
  const searchAndFiltersEnabled =
    sidebarControlsForView(state.sidebarTab) === "search-and-filter";
  const searchMatchedPaths = searchAndFiltersEnabled
    ? treeSearchMatchedPaths()
    : [];
  state.searchAutoExpandedTreeDirectories = new Set(
    state.filter
      ? searchMatchedPaths.flatMap((path) => treeAncestorDirectories(path))
      : [],
  );
  const favoriteRevealPaths = state.sidebarTab === "favorites"
    ? state.sidebarFavorites.map((favorite) => favorite.path)
    : [];
  let visibleTree = filterWorkbenchFileTree(state.tree, {
    mode: state.fileTreeMode,
    currentDocument: state.currentDocument,
    currentFile: state.currentFile,
    searchMatchedPaths: [
      ...searchMatchedPaths,
      ...favoriteRevealPaths,
    ],
    gitChangedPaths: state.sidebarTab === "sync" ? gitChangedPaths() : [],
    includePlaceholders: state.sidebarTab === "sync",
  });
  let filteredTree = sidebarTreeForView(visibleTree, {
    view: state.sidebarTab,
    favorites: state.sidebarFavorites,
    changedPaths: gitChangedPaths(),
    gitChanges: state.gitChanges,
  });
  if (searchAndFiltersEnabled) {
    filteredTree = filterNodesByFrontmatter(filteredTree);
    filteredTree = filterTextTree(
      filteredTree,
      state.frontmatterFiles,
      state.filter,
      {
        expandedDirectoryPaths: state.searchExpandedTreeDirectories,
        showDocumentTitles: state.showDocumentTitles,
      },
    );
  }

  if (filteredTree.length === 0) {
    renderSidebarTreeEmpty();
    if (previousTreeFocus) {
      sidebarTabButtons
        .find((button) => button.dataset.sidebarTab === state.sidebarTab)
        ?.focus({ preventScroll: true });
    }
    restoreWorkbenchTreeViewportIfPending();
    return;
  }

  const list = document.createElement("ul");
  list.className = "tree-list";
  for (const node of filteredTree) {
    list.append(renderNode(node, ""));
  }
  fileTree.append(list);
  if (shouldShowSparseFavoritesGuidance({
    view: state.sidebarTab,
    favoriteCount: state.sidebarFavorites.length,
  })) {
    renderSparseFavoritesGuidance();
  }
  restoreTreeFocus(previousTreeFocus);
  restoreWorkbenchTreeViewportIfPending();
}

function renderSparseFavoritesGuidance() {
  const guidance = document.createElement("div");
  guidance.className = "sidebar-favorites-guidance";
  guidance.setAttribute("role", "note");
  const title = document.createElement("strong");
  title.textContent = t("favorites.sparseTitle");
  const detail = document.createElement("span");
  detail.textContent = t("favorites.sparseDetail");
  guidance.append(title, detail);
  fileTree.append(guidance);
}

function renderSidebarTreeEmpty() {
  const empty = document.createElement("div");
  empty.className = "sidebar-tree-empty";
  const title = document.createElement("strong");
  const detail = document.createElement("span");
  const emptyState = sidebarEmptyStateKind({
    view: state.sidebarTab,
    search: state.filter,
    frontmatterFilterCount: state.frontmatterFilters.length,
  });
  if (emptyState === "filtered") {
    title.textContent = t("tree.emptyTitle");
    detail.textContent = t("tree.emptyDetail");
  } else if (emptyState === "favorites") {
    title.textContent = t("favorites.emptyTitle");
    detail.textContent = t("favorites.emptyDetail");
  } else if (emptyState === "sync") {
    title.textContent = t("sync.emptyTitle");
    detail.textContent = t("sync.emptyDetail");
  } else {
    title.textContent = t("tree.emptyTitle");
    detail.textContent = t("tree.emptyDetail");
  }
  empty.append(title, detail);
  fileTree.append(empty);
}

function treeSearchMatchedPaths() {
  if (!state.filter) {
    return [];
  }
  const matched = [];
  collectTreeSearchMatchedPaths(state.tree, "", matched);
  return matched;
}

function collectTreeSearchMatchedPaths(nodes, parentPath, matched) {
  for (const node of nodes) {
    if (node.type === "file") {
      if (fileMatchesTextFilter(
        node,
        state.frontmatterFiles[node.path],
        state.filter,
        { showDocumentTitles: state.showDocumentTitles },
      )) {
        matched.push(node.path);
      }
      continue;
    }
    const directoryPath = treeDirectoryPath(parentPath, node.name);
    if (directoryMatchesTextFilter(node, state.filter)) {
      matched.push(directoryPath);
    }
    collectTreeSearchMatchedPaths(node.children, directoryPath, matched);
  }
}

async function openFileFromTree(filePath, event) {
  await navigateDocumentLocation(
    { path: filePath },
    { behavior: treeDocumentTabBehaviorFromModifiers(event) },
  );
}

function replaceOpenDocumentTabPath(fromPath, toPath) {
  applyDocumentTabState({
    tabs: replaceDocumentTabPath({
      tabs: state.documentTabs,
      fromPath,
      toPath,
    }),
    activeTabId: state.activeTabId,
  }, { render: true, persist: true });
}

function renderDocumentTabs() {
  uiTooltipController.hide();
  documentTabs.innerHTML = "";
  const presentations = documentTabPresentations({
    tabs: state.documentTabs,
    tree: state.tree,
    currentDocument: state.currentDocument,
  });
  for (const { id, path, filename, title: documentTitle } of presentations) {
    const isActive = id === state.activeTabId;
    const tab = document.createElement("div");
    tab.className = isActive ? "document-tab is-active" : "document-tab";
    tab.classList.toggle("has-document-title", Boolean(documentTitle));
    tab.dataset.documentTabId = id;
    tab.dataset.documentTabPath = path;
    tab.dataset.documentTabFilename = filename;
    if (documentTitle) {
      tab.dataset.documentTabTitle = documentTitle;
    }
    tab.addEventListener("pointerdown", (event) => startDocumentTabPointerDrag(event, id));
    tab.addEventListener("pointermove", handleDocumentTabPointerMove);
    tab.addEventListener("pointerup", finishDocumentTabPointerDrag);
    tab.addEventListener("pointercancel", cancelDocumentTabPointerDrag);

    const label = document.createElement("button");
    label.type = "button";
    label.className = "document-tab-title";
    label.setAttribute(
      "aria-label",
      [documentTitle || filename, path].filter(Boolean).join(" — "),
    );
    const filenameLine = document.createElement("span");
    filenameLine.className = "document-tab-filename";
    filenameLine.textContent = filename;
    label.append(filenameLine);
    if (documentTitle) {
      const titleLine = document.createElement("span");
      titleLine.className = "document-tab-document-title";
      titleLine.textContent = documentTitle;
      label.append(titleLine);
    }
    label.addEventListener("click", () => openFileFromTab(id));
    tab.append(label);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "document-tab-close";
    setShortcutTooltip(close, t("action.closeCurrentTab"), "Command+W");
    close.setAttribute("aria-label", t("action.closeNamedTab", {
      name: documentTitle || filename,
    }));
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(id);
    });
    tab.append(close);
    documentTabs.append(tab);
  }
}

function revealActiveDocumentTab() {
  documentTabs
    .querySelector(`[data-document-tab-id="${cssEscape(state.activeTabId)}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
}

function startDocumentTabPointerDrag(event, tabId) {
  if (event.button !== 0 || event.target.closest?.(".document-tab-close")) {
    return;
  }
  state.documentTabPointerDrag = {
    tabId,
    pointerId: event.pointerId,
    startX: event.clientX,
    element: event.currentTarget,
    active: false,
  };
}

function handleDocumentTabPointerMove(event) {
  const drag = state.documentTabPointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  if (!drag.active && Math.abs(event.clientX - drag.startX) < 6) {
    return;
  }
  if (!drag.active) {
    drag.active = true;
    drag.element.setPointerCapture?.(event.pointerId);
    documentTabs.querySelector(`[data-document-tab-id="${cssEscape(drag.tabId)}"]`)?.classList.add("is-dragging");
    uiTooltipController.hide();
    closeFileActionMenu({ restoreFocus: false });
  }
  event.preventDefault();
  updateDocumentTabDropTarget(event.clientX, drag.tabId);
}

function updateDocumentTabDropTarget(clientX, draggedTabId) {
  const tabs = [...documentTabs.querySelectorAll("[data-document-tab-id]")];
  const target = tabs.find((tab) => {
    const rect = tab.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right;
  });
  if (!target || target.dataset.documentTabId === draggedTabId) {
    clearDocumentTabDropMarkers();
  } else {
    const rect = target.getBoundingClientRect();
    const placement = clientX < rect.left + rect.width / 2 ? "before" : "after";
    clearDocumentTabDropMarkers();
    target.classList.add(placement === "before" ? "is-drop-before" : "is-drop-after");
    target.dataset.dropPlacement = placement;
  }
  const edge = 28;
  const tabsRect = documentTabs.getBoundingClientRect();
  if (clientX < tabsRect.left + edge) {
    documentTabs.scrollLeft -= 18;
  } else if (clientX > tabsRect.right - edge) {
    documentTabs.scrollLeft += 18;
  }
}

function finishDocumentTabPointerDrag(event) {
  const drag = state.documentTabPointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  const target = documentTabs.querySelector(".is-drop-before, .is-drop-after");
  if (drag.active) {
    releaseDocumentTabPointerCapture(drag);
    event.preventDefault();
    if (target) {
      state.documentTabs = reorderDocumentTabs({
        tabs: state.documentTabs,
        sourceTabId: drag.tabId,
        targetTabId: target.dataset.documentTabId,
        placement: target.dataset.dropPlacement || "before",
      });
      applyDocumentTabState({
        tabs: state.documentTabs,
        activeTabId: state.activeTabId,
      }, { render: true, persist: true });
    }
  }
  state.documentTabPointerDrag = null;
  clearDocumentTabDropMarkers();
  for (const tab of documentTabs.querySelectorAll(".is-dragging")) {
    tab.classList.remove("is-dragging");
  }
}

function clearDocumentTabDropMarkers() {
  for (const tab of documentTabs.querySelectorAll(".is-drop-before, .is-drop-after")) {
    tab.classList.remove("is-drop-before", "is-drop-after");
    delete tab.dataset.dropPlacement;
  }
}

function cancelDocumentTabPointerDrag(event) {
  const drag = state.documentTabPointerDrag;
  if (drag && (!event || drag.pointerId === event.pointerId)) {
    releaseDocumentTabPointerCapture(drag);
  }
  state.documentTabPointerDrag = null;
  clearDocumentTabDropMarkers();
  for (const tab of documentTabs.querySelectorAll(".is-dragging")) {
    tab.classList.remove("is-dragging");
  }
}

function releaseDocumentTabPointerCapture(drag) {
  if (drag?.element?.hasPointerCapture?.(drag.pointerId)) {
    drag.element.releasePointerCapture(drag.pointerId);
  }
}

function handleDocumentTabsWheel(event) {
  if (documentTabs.scrollWidth <= documentTabs.clientWidth) {
    return;
  }
  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;
  if (!rawDelta) {
    return;
  }
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? rawDelta * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? rawDelta * documentTabs.clientWidth
      : rawDelta;
  event.preventDefault();
  documentTabs.scrollLeft += delta;
  uiTooltipController.hide();
}

async function openFileFromTab(tabId) {
  await activateDocumentTabAndLoad(tabId);
}

function actionTooltipItemFromEventTarget(target) {
  const item = target?.closest?.("[data-ui-tooltip]");
  return item && appShell.contains(item) ? item : null;
}

function actionTooltipDetails(item) {
  return {
    name: item?.dataset.uiTooltip || "",
    path: item?.dataset.uiTooltipDetail || "",
    shortcut: item?.dataset.uiTooltipShortcut || "",
  };
}

function actionTooltipKey(item) {
  return item?.id
    || `${item?.dataset.uiTooltip || ""}:${item?.dataset.uiTooltipShortcut || ""}`;
}

function documentTabItemFromEventTarget(target) {
  const item = target?.closest?.("[data-document-tab-id], [data-document-tab-path]");
  return item && documentTabs.contains(item) ? item : null;
}

function documentTabTooltipDetails(item) {
  const path = item?.dataset.documentTabPath || "";
  return {
    name: item?.dataset.documentTabTitle
      || item?.dataset.documentTabFilename
      || tabTitleFromPath(path),
    path: documentTabDisplayPath(path),
  };
}

function outlineItemFromEventTarget(target) {
  const item = target?.closest?.("[data-outline-target], [data-outline-document-start]");
  return item && documentOutline.contains(item) ? item : null;
}

function outlineItemTooltipDetails(item) {
  return {
    name: item?.textContent?.trim() || "",
    path: "",
  };
}

function outlineItemLabelElement(item) {
  return item?.querySelector?.(".outline-link-label") || item;
}

function documentTabDisplayPath(filePath) {
  return String(filePath || "").replace(/^[/\\]+/, "");
}

async function closeTab(tabId) {
  const previousActiveTabId = state.activeTabId;
  captureActiveDocumentLocation();
  const nextTabs = closeDocumentTab({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    targetTabId: tabId,
  });
  const nextLocation = nextTabs.location;
  applyDocumentTabState(nextTabs, { render: true, persist: true });

  if (!nextLocation) {
    showNoDocumentSelected({ pushState: true });
    return;
  }
  if (nextTabs.activeTabId !== previousActiveTabId || nextLocation.path !== state.currentFile) {
    await loadDocumentLocation(nextLocation.path, {
      hash: nextLocation.hash,
      restoreScrollTop: nextLocation.scrollTop,
    });
  }
}

async function applyDocumentTabClosure(createResult) {
  const previousActiveTabId = state.activeTabId;
  captureActiveDocumentLocation();
  const result = typeof createResult === "function" ? createResult() : createResult;
  applyDocumentTabState(result, { render: true, persist: true });
  if (!result.location) {
    showNoDocumentSelected({ pushState: true });
  } else if (result.activeTabId !== previousActiveTabId || result.location.path !== state.currentFile) {
    await loadDocumentLocation(result.location.path, {
      hash: result.location.hash,
      restoreScrollTop: result.location.scrollTop,
    });
  }
}

function handleDocumentTabContextMenu(event) {
  const tab = event.target.closest?.("[data-document-tab-id]");
  if (!tab) {
    return;
  }
  event.preventDefault();
  const tabId = tab.dataset.documentTabId;
  const path = tab.dataset.documentTabPath;
  const targetIndex = state.documentTabs.findIndex((item) => item.id === tabId);
  state.fileActionTarget = { source: "tab", path, tabId };
  showFileActionMenu([
    { id: "close-tab", label: t("menu.close"), shortcut: "Command+W" },
    { id: "close-others", label: t("menu.closeOthers"), disabled: state.documentTabs.length < 2 },
    { id: "close-right", label: t("menu.closeRight"), disabled: targetIndex < 0 || targetIndex === state.documentTabs.length - 1 },
    { id: "close-all", label: t("menu.closeAll") },
    null,
    ...(isMarkdownPath(path) ? [{ id: "copy-share", label: t("action.copyShareLink"), shortcut: "Command+Shift+L" }] : []),
    { id: "copy-path", label: t("menu.copyPath"), shortcut: "Command+Shift+C" },
    null,
    { id: "reveal-tree", label: t("menu.revealTree") },
    { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
    { id: "open-system", label: t("menu.openSystem"), shortcut: "Command+Shift+O", disabled: !canEditCurrentRepo() },
  ], { x: event.clientX, y: event.clientY, returnFocus: tab });
}

function handleFileTreeContextMenu(event) {
  const item = event.target.closest?.("[data-tree-item]");
  if (!fileTree.contains(event.target)) {
    return;
  }
  if (!item) {
    event.preventDefault();
    state.fileActionTarget = {
      source: "tree-root",
      path: "",
      directoryPath: "",
    };
    showFileActionMenu([
      { id: "new-document", label: t("menu.newDocumentHere"), disabled: !canEditCurrentRepo() },
      { id: "new-folder", label: t("menu.newFolderHere"), disabled: !canEditCurrentRepo() },
    ], {
      x: event.clientX,
      y: event.clientY,
      returnFocus: takeFileTreeContextReturnFocus(fileTree),
    });
    return;
  }
  event.preventDefault();
  const path = item.dataset.treePath || "";
  const isDirectory = item.dataset.treeItem === "directory";
  const isMissing = item.dataset.treeMissing === "true";
  const kind = item.dataset.treeKind || "";
  const isPlaceholderOnly = item.dataset.treePlaceholderOnly === "true";
  const isRegularFile = !isDirectory &&
    !isMissing &&
    !["symlink", "submodule", "placeholder"].includes(kind);
  const favoriteCandidate = isDirectory ? "directory" : isMarkdownPath(path) ? "document" : "";
  const favoriteActive = favoriteCandidate
    ? isFavoriteItem(favoriteCandidate, path)
    : false;
  const favoriteType = !isMissing || favoriteActive ? favoriteCandidate : "";
  const githubUrl = isDirectory
    ? ""
    : githubFileUrl(repositoryById(state.currentRepo)?.githubBlobRoot, path);
  state.fileActionTarget = isDirectory
    ? {
        source: "tree-directory",
        path,
        directoryPath: path,
        favoriteType,
        placeholderOnly: isPlaceholderOnly,
      }
    : {
        source: "tree-file",
        path,
        directoryPath: parentDirectoryPath(path),
        referencePath: path,
        favoriteType,
        kind,
        regularFile: isRegularFile,
        githubUrl,
      };
  const favoriteItem = favoriteType
    ? {
        id: "toggle-favorite",
        label: t(favoriteActive ? "action.removeFavorite" : "action.addFavorite"),
        shortcut: "Command+D",
        checked: favoriteActive,
      }
    : null;
  const items = isDirectory
    ? isMissing
      ? [
          ...(favoriteItem ? [favoriteItem, null] : []),
          { id: "copy-path", label: t("menu.copyDirectoryPath"), shortcut: "Command+Shift+C" },
        ]
      : [
        favoriteItem,
        null,
        { id: "new-document", label: t("menu.newDocumentHere"), disabled: !canEditCurrentRepo() },
        { id: "new-folder", label: t("menu.newFolderHere"), disabled: !canEditCurrentRepo() },
        ...(isPlaceholderOnly
          ? [
              null,
              { id: "delete-path", label: t("menu.deleteFolder"), disabled: !canEditCurrentRepo() },
            ]
          : []),
        null,
        { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
        { id: "copy-path", label: t("menu.copyDirectoryPath"), shortcut: "Command+Shift+C" },
      ]
    : isMissing
      ? [
          ...(favoriteItem ? [favoriteItem, null] : []),
          { id: "copy-path", label: t("menu.copyPath"), shortcut: "Command+Shift+C" },
        ]
      : [
        ...(favoriteItem ? [favoriteItem, null] : []),
        ...(isMarkdownPath(path) ? [{ id: "copy-share", label: t("action.copyShareLink"), shortcut: "Command+Shift+L" }] : []),
        { id: "copy-path", label: t("menu.copyPath"), shortcut: "Command+Shift+C" },
        null,
        {
          id: "open-new-tab",
          label: t("menu.openNewTab"),
          shortcuts: ["Command+Click", "Command+Enter"],
        },
        { id: "open-github", label: t("menu.openGitHub"), shortcut: "Command+Shift+G", disabled: !githubUrl },
        { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
        null,
        { id: "new-document", label: t("menu.newDocumentSameLocation"), disabled: !canEditCurrentRepo() },
        ...(isRegularFile
          ? [
              { id: "rename-file", label: t("menu.renameFile"), shortcut: "F2", disabled: !canEditCurrentRepo() },
              { id: "delete-path", label: t("menu.deleteFile"), disabled: !canEditCurrentRepo() },
            ]
          : []),
      ];
  showFileActionMenu(items, {
    x: event.clientX,
    y: event.clientY,
    returnFocus: takeFileTreeContextReturnFocus(item),
  });
}

function handleFileTreePointerDown(event) {
  state.fileTreePointerReturnFocus =
    event.button === 2 && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
}

function takeFileTreeContextReturnFocus(fallback) {
  const returnFocus = state.fileTreePointerReturnFocus;
  state.fileTreePointerReturnFocus = null;
  return returnFocus?.isConnected ? returnFocus : fallback;
}

function showCurrentDocumentActionsMenu() {
  if (!state.currentDocument) {
    return;
  }
  const rect = documentActionsMore.getBoundingClientRect();
  state.fileActionTarget = {
    source: "current",
    path: state.currentDocument.path,
    githubUrl: state.currentDocument.githubUrl,
  };
  showFileActionMenu([
    { id: "reveal-tree", label: t("menu.revealTree") },
    { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
    null,
    { id: "open-github", label: t("menu.openGitHub"), shortcut: "Command+Shift+G", disabled: !state.currentDocument.githubUrl },
    { id: "copy-path", label: t("menu.copyPath"), shortcut: "Command+Shift+C" },
    { id: "open-system", label: t("menu.openSystem"), shortcut: "Command+Shift+O", disabled: !canEditCurrentRepo() },
  ], {
    x: rect.right,
    y: rect.bottom + 4,
    alignRight: true,
    returnFocus: documentActionsMore,
  });
  documentActionsMore.setAttribute("aria-expanded", "true");
}

function showFileActionMenu(items, {
  x,
  y,
  alignRight = false,
  returnFocus = null,
}) {
  closeFileActionMenu({ restoreFocus: false });
  state.fileActionReturnFocus =
    returnFocus instanceof HTMLElement
      ? returnFocus
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  fileActionMenu.replaceChildren(...items.map((item) => {
    if (!item) {
      const separator = document.createElement("div");
      separator.className = "file-action-menu-separator";
      separator.setAttribute("role", "separator");
      return separator;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.fileAction = item.id;
    button.disabled = item.disabled === true;
    button.setAttribute("role", Object.hasOwn(item, "checked") ? "menuitemcheckbox" : "menuitem");
    if (Object.hasOwn(item, "checked")) {
      button.setAttribute("aria-checked", String(item.checked === true));
    }
    const leading = document.createElement("span");
    leading.className = "file-action-menu-leading";
    if (Object.hasOwn(item, "checked")) {
      const check = document.createElement("span");
      check.className = "file-action-menu-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = item.checked ? "✓" : "";
      leading.append(check);
    }
    const label = document.createElement("span");
    label.className = "file-action-menu-label";
    label.textContent = item.label;
    leading.append(label);
    button.append(leading);
    const shortcuts = Array.isArray(item.shortcuts)
      ? item.shortcuts
      : item.shortcut
        ? [item.shortcut]
        : [];
    if (shortcuts.length > 0) {
      const shortcut = document.createElement("span");
      shortcut.className = "file-action-menu-shortcut";
      shortcut.setAttribute("aria-hidden", "true");
      shortcut.textContent = shortcuts.map(platformShortcutLabel).join(" · ");
      button.append(shortcut);
      button.setAttribute(
        "aria-label",
        `${item.label} (${shortcuts.map(platformShortcutLabel).join(", ")})`,
      );
    }
    return button;
  }));
  fileActionMenu.hidden = false;
  const margin = 8;
  const rect = fileActionMenu.getBoundingClientRect();
  const desiredLeft = alignRight ? x - rect.width : x;
  const left = Math.max(margin, Math.min(desiredLeft, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
  fileActionMenu.style.left = `${Math.round(left)}px`;
  fileActionMenu.style.top = `${Math.round(top)}px`;
  fileActionMenu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}

function closeFileActionMenu({ restoreFocus = true } = {}) {
  if (fileActionMenu.hidden) {
    return;
  }
  const returnFocus = state.fileActionReturnFocus;
  state.fileActionReturnFocus = null;
  fileActionMenu.hidden = true;
  fileActionMenu.replaceChildren();
  documentActionsMore.setAttribute("aria-expanded", "false");
  returnFocus?.setAttribute?.("aria-expanded", "false");
  if (restoreFocus && returnFocus?.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
}

function handleFileActionMenuKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeFileActionMenu();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    return;
  }
  const items = [...fileActionMenu.querySelectorAll("button:not(:disabled)")];
  if (items.length === 0) {
    return;
  }
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
        ? (Math.max(currentIndex, -1) + 1) % items.length
        : (currentIndex <= 0 ? items.length : currentIndex) - 1;
  items[nextIndex].focus({ preventScroll: true });
}

function fileActionMenuShortcutTarget(actionId) {
  if (fileActionMenu.hidden || !state.fileActionTarget) {
    return null;
  }
  const button = fileActionMenu.querySelector(`[data-file-action="${actionId}"]`);
  return button && !button.disabled ? state.fileActionTarget : null;
}

async function handleFileActionMenuClick(event) {
  const button = event.target.closest?.("[data-file-action]");
  if (!button || button.disabled || !state.fileActionTarget) {
    return;
  }
  const action = button.dataset.fileAction;
  const target = state.fileActionTarget;
  closeFileActionMenu();
  if (action === "close-tab") {
    await closeTab(target.tabId);
  } else if (action === "close-others") {
    await applyDocumentTabClosure(() => closeOtherDocumentTabs({
      tabs: state.documentTabs,
      targetTabId: target.tabId,
    }));
  } else if (action === "close-right") {
    await applyDocumentTabClosure(() => closeDocumentTabsToRight({
      tabs: state.documentTabs,
      activeTabId: state.activeTabId,
      targetTabId: target.tabId,
    }));
  } else if (action === "close-all") {
    await applyDocumentTabClosure({ tabs: [], activeTabId: "" });
  } else if (action === "copy-share") {
    await copyShareLinkForPath(target.path);
  } else if (action === "toggle-favorite" && target.favoriteType) {
    await toggleFavoriteItem({
      type: target.favoriteType,
      path: target.path,
    });
  } else if (action === "reveal-tree") {
    revealFileInTree(target.path);
  } else if (action === "new-document") {
    await promptNewDocument(target);
  } else if (action === "new-folder") {
    await promptNewFolder(target);
  } else if (action === "rename-file") {
    await promptRenameFile(target);
  } else if (action === "delete-path") {
    await promptDeletePath(target);
  } else if (action === "open-new-tab") {
    await openFileInForegroundTab(target.path);
  } else if (action === "reveal-finder") {
    await revealPathInFinder(target.path);
  } else if (action === "copy-path") {
    await copyPathValue(target.path);
  } else if (action === "open-github") {
    openGithubUrl(target.githubUrl);
  } else if (action === "open-system") {
    await openPathWithSystem(target.path);
  } else if (action === "remove-repository" && target.repositoryId) {
    requestRepositoryPanelAction("remove", target.repositoryId);
  }
}

async function openFileInForegroundTab(path) {
  await navigateDocumentLocation({ path }, { behavior: "foreground" });
}

function revealFileInTree(path) {
  if (state.sidebarCollapsed) {
    setSidebarCollapsed(false);
  }
  if (state.sidebarTab !== "all") {
    setSidebarTab("all");
  }
  for (const directoryPath of treeAncestorDirectories(path)) {
    state.collapsedTreeDirectories.delete(directoryPath);
    state.expandedTreeDirectories.add(directoryPath);
  }
  persistTreeDirectoryState();
  renderTree();
  window.requestAnimationFrame(() => {
    const item = treeItemByPath(path, "file");
    if (!item) {
      showCopyToast(t("toast.notInTree"));
      return;
    }
    item.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    item.focus({ preventScroll: true });
  });
}

function showTreeOperationFeedback(path, itemType = "") {
  window.clearTimeout(state.treeOperationFeedbackTimer);
  state.treeOperationFeedbackElement?.classList.remove("has-operation-feedback");
  state.treeOperationFeedbackElement = null;
  window.requestAnimationFrame(() => {
    const item = treeItemByPath(path, itemType);
    if (!item) {
      return;
    }
    item.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    item.classList.add("has-operation-feedback");
    state.treeOperationFeedbackElement = item;
    state.treeOperationFeedbackTimer = window.setTimeout(() => {
      item.classList.remove("has-operation-feedback");
      if (state.treeOperationFeedbackElement === item) {
        state.treeOperationFeedbackElement = null;
      }
      state.treeOperationFeedbackTimer = null;
    }, 900);
  });
}

function newDocumentLocationFromCurrent() {
  const path = state.currentDocument?.path || state.currentFile || "";
  return {
    directoryPath: parentDirectoryPath(path),
    referencePath: path,
  };
}

async function promptNewDocument({ directoryPath = "", referencePath = "" } = {}) {
  if (!canEditCurrentRepo()) {
    showCopyToast(t("toast.cannotCreateDocument"));
    return;
  }
  let name = "";
  let format = "md";
  let errorMessage = "";
  while (true) {
    const { confirmed, values } = await showAppDialog({
      title: t("newDocument.title"),
      message: [newDocumentLocationMessage({ directoryPath, referencePath }), errorMessage]
        .filter(Boolean)
        .join("\n"),
      fields: [
        {
          id: "name",
          label: t("newDocument.name"),
          value: name,
          placeholder: t("newDocument.namePlaceholder"),
        },
        {
          id: "format",
          label: t("newDocument.format"),
          value: format,
          options: [
            { value: "md", label: t("newDocument.markdown") },
            { value: "mdx", label: t("newDocument.mdx") },
          ],
        },
      ],
      confirmText: t("action.create"),
      cancelText: t("action.cancel"),
    });
    if (!confirmed) {
      return;
    }
    name = values.name;
    format = values.format;
    const response = await fetch(apiUrl("/api/create-document", { locale: state.locale }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: directoryPath, name, format }),
    });
    const payload = await response.json().catch(() => ({ error: t("error.createDocument") }));
    if (!response.ok) {
      errorMessage = payload.error || t("error.createDocumentRetry");
      continue;
    }
    await applyBranchProtectionPayload(payload);
    await loadTree({ force: true });
    await openFileInForegroundTab(payload.path);
    setMode("live");
    showCopyToast(t("toast.created", { path: payload.path }));
    return;
  }
}

function newDocumentLocationMessage({ directoryPath, referencePath }) {
  if (referencePath) {
    return t("newDocument.alongside", {
      name: documentNameWithoutExtension(referencePath),
    });
  }
  if (directoryPath) {
    return t("newDocument.inDirectory", { name: pathBasename(directoryPath) });
  }
  return t("newDocument.repoHome");
}

async function promptNewFolder({ directoryPath = "" } = {}) {
  if (!canEditCurrentRepo()) {
    showCopyToast(t("toast.cannotCreateDocument"));
    return;
  }
  let name = "";
  let errorMessage = "";
  while (true) {
    const { confirmed, value } = await showAppDialog({
      title: t("newFolder.title"),
      message: [
        directoryPath
          ? t("newFolder.inDirectory", { name: pathBasename(directoryPath) })
          : t("newFolder.repoHome"),
        errorMessage,
      ].filter(Boolean).join("\n"),
      inputLabel: t("newFolder.name"),
      inputValue: name,
      confirmText: t("action.create"),
      cancelText: t("action.cancel"),
    });
    if (!confirmed) {
      return;
    }
    name = value;
    const response = await fetch(apiUrl("/api/create-directory", { locale: state.locale }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPath: directoryPath, name }),
    });
    const payload = await response.json().catch(() => ({
      error: t("error.fileOperation"),
    }));
    if (!response.ok) {
      errorMessage = payload.error || t("error.fileOperation");
      continue;
    }

    await applyBranchProtectionPayload(payload);
    for (const ancestor of treeAncestorDirectories(payload.path)) {
      state.collapsedTreeDirectories.delete(ancestor);
      state.expandedTreeDirectories.add(ancestor);
    }
    persistTreeDirectoryState();
    await loadTree({ force: true });
    await loadGitStatus();
    showTreeOperationFeedback(payload.path, "directory");
    showCopyToast(t("toast.folderCreated", { path: payload.path }));
    return;
  }
}

async function promptRenameFile({ path: filePath = "", regularFile = true } = {}) {
  if (!canEditCurrentRepo() || !filePath || regularFile === false) {
    return;
  }
  let name = pathBasename(filePath);
  let errorMessage = "";
  while (true) {
    const { confirmed, value } = await showAppDialog({
      title: t("renameFile.title"),
      message: errorMessage,
      inputLabel: t("renameFile.name"),
      inputValue: name,
      confirmText: t("action.rename"),
      cancelText: t("action.cancel"),
    });
    if (!confirmed) {
      return;
    }
    name = value;

    try {
      await flushPendingSourceSync();
    } catch {
      showCopyToast(t("error.editorStillSaving"));
      return;
    }

    const previewResponse = await fetch(apiUrl("/api/rename-file", { locale: state.locale }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, name }),
    });
    const preview = await previewResponse.json().catch(() => ({
      error: t("error.fileOperation"),
    }));
    if (!previewResponse.ok) {
      errorMessage = preview.error || t("error.fileOperation");
      continue;
    }

    if (preview.referenceCount > 0) {
      const referenceConfirmation = await showAppDialog({
        title: t("renameFile.title"),
        message: t("renameFile.references", {
          count: preview.referenceCount,
          files: preview.referenceFileCount,
        }),
        confirmText: t("action.rename"),
        cancelText: t("action.cancel"),
      });
      if (!referenceConfirmation.confirmed) {
        return;
      }
    }

    const response = await fetch(apiUrl("/api/rename-file", { locale: state.locale }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: filePath,
        name,
        fingerprint: preview.fingerprint,
      }),
    });
    const payload = await response.json().catch(() => ({
      error: t("error.fileOperation"),
    }));
    if (!response.ok) {
      errorMessage = payload.error || t("error.fileOperation");
      continue;
    }

    const currentPath = state.currentFile;
    const currentWasRenamed = currentPath === filePath;
    const currentReferenceWasUpdated = preview.referenceFiles?.includes(currentPath);
    await applyBranchProtectionPayload(payload);
    releaseTreeFocusForRemovedPath(filePath);
    if (isMarkdownPath(filePath)) {
      if (isMarkdownPath(payload.targetPath)) {
        await replaceFavoriteDocumentPath(filePath, payload.targetPath);
      } else {
        await removeFavoritePath("document", filePath);
      }
    }
    replaceOpenDocumentTabPath(filePath, payload.targetPath);
    if (currentWasRenamed) {
      await loadDocumentLocation(payload.targetPath, {
        preserveScroll: true,
        forceReplace: true,
      });
    } else if (currentReferenceWasUpdated) {
      await loadDocumentLocation(currentPath, {
        preserveScroll: true,
        forceReplace: true,
      });
    }
    await loadTree({ force: true });
    await loadGitStatus();
    showTreeOperationFeedback(payload.targetPath, "file");
    showCopyToast(t("toast.fileRenamed", { path: payload.targetPath }));
    return;
  }
}

async function promptDeletePath({ path: targetPath = "" } = {}) {
  if (!canEditCurrentRepo() || !targetPath) {
    return;
  }
  try {
    await flushPendingSourceSync();
  } catch {
    showCopyToast(t("error.editorStillSaving"));
    return;
  }

  const previewResponse = await fetch(apiUrl("/api/delete-path", { locale: state.locale }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: targetPath }),
  });
  const preview = await previewResponse.json().catch(() => ({
    error: t("error.fileOperation"),
  }));
  if (!previewResponse.ok) {
    showCopyToast(preview.error || t("error.fileOperation"));
    return;
  }

  const messages = [
    t(preview.kind === "directory" ? "deleteFolder.message" : "deleteFile.message", {
      path: targetPath,
    }),
    preview.referenceCount > 0
      ? t("deleteFile.references", { count: preview.referenceCount })
      : "",
    preview.requiresUnrecoverableConfirmation
      ? t("deleteFile.unrecoverable")
      : "",
  ].filter(Boolean);
  const { confirmed } = await showAppDialog({
    title: t(preview.kind === "directory" ? "deleteFolder.title" : "deleteFile.title"),
    message: messages.join("\n\n"),
    confirmText: t(
      preview.requiresUnrecoverableConfirmation
        ? "action.deleteAnyway"
        : "action.delete",
    ),
    cancelText: t("action.cancel"),
    variant: "danger",
  });
  if (!confirmed) {
    return;
  }

  const response = await fetch(apiUrl("/api/delete-path", { locale: state.locale }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: targetPath,
      fingerprint: preview.fingerprint,
      confirmUnrecoverable: preview.requiresUnrecoverableConfirmation === true,
    }),
  });
  const payload = await response.json().catch(() => ({
    error: t("error.fileOperation"),
  }));
  if (!response.ok) {
    showCopyToast(payload.error || t("error.fileOperation"));
    return;
  }

  await applyBranchProtectionPayload(payload);
  releaseTreeFocusForRemovedPath(targetPath);
  if (payload.kind === "directory") {
    await removeFavoritePath("directory", targetPath);
  } else if (isMarkdownPath(targetPath)) {
    await removeFavoritePath("document", targetPath);
  }
  if (payload.kind === "file") {
    const currentWasDeleted = state.currentFile === targetPath;
    const nextTabs = removeDocumentTabPath({
      tabs: state.documentTabs,
      activeTabId: state.activeTabId,
      filePath: targetPath,
    });
    applyDocumentTabState(nextTabs, { render: true, persist: true });
    if (currentWasDeleted) {
      if (nextTabs.location) {
        await loadDocumentLocation(nextTabs.location.path, {
          hash: nextTabs.location.hash,
          restoreScrollTop: nextTabs.location.scrollTop,
        });
      } else {
        showNoDocumentSelected({ pushState: true });
      }
    }
  }
  await loadTree({ force: true });
  await loadGitStatus();
  const parentPath = parentDirectoryPath(targetPath);
  if (parentPath) {
    showTreeOperationFeedback(parentPath, "directory");
  }
  showCopyToast(t("toast.pathDeleted", { path: targetPath }));
}

function releaseTreeFocusForRemovedPath(path) {
  const item = currentTreeItem();
  if (item?.dataset.treePath !== path) {
    return;
  }
  item.blur();
  state.lastTreeFocus = null;
  scheduleWorkbenchSessionPersist();
}

async function revealPathInFinder(path) {
  try {
    const response = await fetch(apiUrl("/api/reveal-path", { path }));
    if (!response.ok) {
      throw new Error("Reveal path failed");
    }
  } catch {
    showCopyToast(t("toast.revealFailed"));
  }
}

function revealInFileManagerLabel() {
  if (isMacPlatform()) {
    return t("action.revealFinder");
  }
  return /Win/.test(navigator.platform || "")
    ? t("action.revealExplorer")
    : t("action.revealFileManager");
}

async function copyPathValue(path) {
  try {
    await writeClipboard(path);
    showCopyToast(t("toast.pathCopied"));
  } catch {
    showCopyToast(t("toast.copyFailed"));
  }
}

async function openPathWithSystem(path) {
  try {
    const response = await fetch(apiUrl("/api/open-source", { file: path }));
    if (!response.ok) {
      throw new Error("Open source file failed");
    }
  } catch {
    showCopyToast(t("toast.openSystemFailed"));
  }
}

function parentDirectoryPath(path) {
  const parts = String(path || "").replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function pathBasename(path) {
  return String(path || "").replaceAll("\\", "/").split("/").filter(Boolean).at(-1)
    || t("repository.home");
}

function documentNameWithoutExtension(path) {
  return pathBasename(path).replace(/\.(?:md|mdx)$/i, "");
}

function isMarkdownPath(path) {
  return /\.(?:md|mdx)$/i.test(String(path || ""));
}

function renderNode(node, parentPath) {
  const item = document.createElement("li");
  if (node.type === "file") {
    const button = document.createElement("button");
    const capability = treeFileCapability(node.kind, {
      missing: node.missing === true,
      translate: t,
    });
    const presentation = treeFilePresentation(node, {
      showDocumentTitles: state.showDocumentTitles,
    });
    const textMatchDetails = isTreeTextSearchActive()
      ? fileTextFilterMatchDetails(
          node,
          state.frontmatterFiles[node.path],
          state.filter,
          { showDocumentTitles: state.showDocumentTitles },
        )
      : null;
    button.type = "button";
    button.className = node.path === state.currentFile ? "tree-file is-active" : "tree-file";
    button.classList.toggle("is-missing", node.missing === true);
    button.classList.toggle(
      "has-search-evidence",
      Boolean(textMatchDetails?.snippetExcerpt),
    );
    button.classList.toggle("has-document-title", Boolean(presentation.title));
    button.dataset.treeItem = "file";
    button.dataset.treePath = node.path;
    button.dataset.treeKind = node.kind || "unknown";
    if (node.missing === true) {
      button.dataset.treeMissing = "true";
      button.setAttribute("aria-disabled", "true");
    }
    button.dataset.fileCapability = capability.name;
    button.setAttribute(
      "aria-label",
      [node.path, presentation.title, capability.label].filter(Boolean).join("，"),
    );
    const copy = document.createElement("span");
    copy.className = "tree-file-copy";
    const label = document.createElement("span");
    label.className = "tree-file-label";
    appendTreeSearchLabel(label, presentation.filename);
    copy.append(label);
    if (presentation.title) {
      const title = document.createElement("span");
      title.className = "tree-file-document-title";
      appendTreeSearchLabel(title, presentation.title);
      copy.append(title);
    }
    if (textMatchDetails?.snippetExcerpt && textMatchDetails.snippetMatch) {
      button.dataset.searchMatchSource = "ai-snippet";
      button.setAttribute(
        "aria-description",
        `AI snippet: ${textMatchDetails.snippetMatch.text}`,
      );
      const evidence = document.createElement("span");
      evidence.className = "tree-file-search-evidence";
      treeItemSearchTooltips.set(button, {
        evidence: {
          label: "AI",
          text: textMatchDetails.snippetMatch.text,
          ranges: textMatchDetails.snippetMatch.ranges,
        },
      });
      const source = document.createElement("span");
      source.className = "tree-file-search-source";
      source.textContent = "AI";
      source.setAttribute("aria-hidden", "true");
      const snippet = document.createElement("span");
      snippet.className = "tree-file-search-snippet";
      appendHighlightedText(
        snippet,
        textMatchDetails.snippetExcerpt.text,
        textMatchDetails.snippetExcerpt.ranges,
      );
      evidence.append(source, snippet);
      copy.append(evidence);
    }
    button.append(copy);
    if (capability.badge) {
      const capabilityBadge = document.createElement("span");
      capabilityBadge.className = `tree-file-capability is-${capability.name}`;
      capabilityBadge.textContent = capability.badge;
      capabilityBadge.setAttribute("aria-hidden", "true");
      button.append(capabilityBadge);
    }
    const change = gitChangeForPath(node.path);
    if (change) {
      const badge = document.createElement("span");
      badge.className = `git-change-badge is-${change.status}`;
      badge.textContent = gitChangeBadgeLabel(change.status);
      setUiTooltip(badge, gitChangeStatusLabel(change.status));
      button.append(badge);
    }
    if (node.missing !== true) {
      button.addEventListener("click", (event) => openFileFromTree(node.path, event));
    }
    item.append(button);
    return item;
  }

  const directoryPath = node.path || treeDirectoryPath(parentPath, node.name);
  const presentation = treeDirectoryPresentation(node, {
    parentPath,
    view: state.sidebarTab,
  });
  const details = document.createElement("details");
  details.open = shouldOpenTreeDirectory({
    directoryPath,
    searchActive: isTreeTextSearchActive(),
    searchAutoExpandedDirectories: state.searchAutoExpandedTreeDirectories,
    searchExpandedDirectories: state.searchExpandedTreeDirectories,
    searchCollapsedDirectories: state.searchCollapsedTreeDirectories,
    hasBroadTreeFilter:
      (
        state.sidebarTab === "all" &&
        state.frontmatterFilters.length > 0
      ) ||
      state.sidebarTab === "sync",
    expandedDirectories: state.expandedTreeDirectories,
    collapsedDirectories: state.collapsedTreeDirectories,
  });
  let lastRenderedOpen = details.open;
  const summary = document.createElement("summary");
  summary.dataset.treeItem = "directory";
  summary.dataset.treePath = directoryPath;
  summary.dataset.treeKind = "directory";
  if (node.placeholderOnly === true) {
    summary.dataset.treePlaceholderOnly = "true";
    details.classList.add("is-placeholder-only");
  }
  summary.tabIndex = 0;
  summary.classList.toggle("is-missing", node.missing === true);
  summary.classList.toggle("has-directory-parent", Boolean(presentation.parentPath));
  if (node.missing === true) {
    summary.dataset.treeMissing = "true";
    summary.setAttribute("aria-disabled", "true");
    summary.setAttribute("aria-label", `${directoryPath}，${t("file.missing")}`);
    summary.addEventListener("click", (event) => event.preventDefault());
  } else if (presentation.parentPath) {
    summary.setAttribute("aria-label", directoryPath);
  }
  summary.setAttribute("aria-expanded", String(details.open));
  const copy = document.createElement("span");
  copy.className = "tree-directory-copy";
  const label = document.createElement("span");
  label.className = "tree-directory-label";
  appendTreeSearchLabel(label, presentation.name);
  copy.append(label);
  if (presentation.parentPath) {
    const parent = document.createElement("span");
    parent.className = "tree-directory-parent";
    appendTreeSearchLabel(parent, presentation.parentPath);
    copy.append(parent);
  }
  summary.append(copy);
  details.append(summary);
  details.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(details.open));
    if (!shouldRecordTreeDirectoryToggle({
      previousOpen: lastRenderedOpen,
      nextOpen: details.open,
      programmatic: details.dataset.programmaticToggle === "true",
    })) {
      delete details.dataset.programmaticToggle;
      lastRenderedOpen = details.open;
      return;
    }

    delete details.dataset.programmaticToggle;
    lastRenderedOpen = details.open;
    recordTreeDirectoryToggle(directoryPath, details.open);
  });

  const children = document.createElement("ul");
  children.className = "tree-list";
  for (const child of node.children) {
    children.append(renderNode(child, directoryPath));
  }
  details.append(children);
  item.append(details);
  return item;
}

function appendTreeSearchLabel(element, text) {
  const filter = sidebarControlsForView(state.sidebarTab) === "search-and-filter"
    ? state.filter
    : "";
  appendHighlightedText(element, text, textFilterMatchRanges(text, filter));
}

function appendHighlightedText(element, text, ranges) {
  if (ranges.length === 0) {
    element.textContent = text;
    return;
  }

  let cursor = 0;
  for (const range of ranges) {
    if (range.from > cursor) {
      element.append(document.createTextNode(text.slice(cursor, range.from)));
    }
    const mark = document.createElement("mark");
    mark.className = "tree-search-match";
    mark.textContent = text.slice(range.from, range.to);
    element.append(mark);
    cursor = range.to;
  }
  if (cursor < text.length) {
    element.append(document.createTextNode(text.slice(cursor)));
  }
}

function recordTreeDirectoryToggle(directoryPath, open) {
  if (isTreeTextSearchActive()) {
    if (open) {
      state.searchExpandedTreeDirectories.add(directoryPath);
      state.searchCollapsedTreeDirectories.delete(directoryPath);
    } else {
      state.searchCollapsedTreeDirectories.add(directoryPath);
      state.searchExpandedTreeDirectories.delete(directoryPath);
    }
    renderTree();
    return;
  }

  if (open) {
    state.expandedTreeDirectories.add(directoryPath);
    state.collapsedTreeDirectories.delete(directoryPath);
  } else {
    state.collapsedTreeDirectories.add(directoryPath);
    state.expandedTreeDirectories.delete(directoryPath);
  }

  persistTreeDirectoryState();
}

function isTreeTextSearchActive() {
  return state.sidebarTab === "all" && state.filter.length > 0;
}

function restoreSidebarWidth() {
  const stored = sidebarWidthFromStorageValue(
    preferenceValue("sidebarWidth", SIDEBAR_WIDTH_STORAGE_KEY),
  );
  setSidebarWidth(stored, { persist: false });
}

function restoreSidebarCollapsed() {
  const collapsed = sidebarCollapsedFromStorageValue(
    preferenceValue("sidebarCollapsed", SIDEBAR_COLLAPSED_STORAGE_KEY),
  );
  setSidebarCollapsed(collapsed, { persist: false });
}

function restoreDocumentOutlineCollapsed() {
  const collapsed = sidebarCollapsedFromStorageValue(
    preferenceValue(
      "documentOutlineCollapsed",
      DOCUMENT_OUTLINE_COLLAPSED_STORAGE_KEY,
    ),
  );
  setDocumentOutlineCollapsed(collapsed, { persist: false });
}

function restoreDocumentOutlineWidth() {
  const stored = documentOutlineWidthFromStorageValue(
    preferenceValue(
      "documentOutlineWidth",
      DOCUMENT_OUTLINE_WIDTH_STORAGE_KEY,
    ),
  );
  setDocumentOutlineWidth(stored, { persist: false });
}

function toggleDocumentOutline() {
  setDocumentOutlineCollapsed(!state.documentOutlineCollapsed);
}

function setDocumentOutlineCollapsed(collapsed, { persist = true } = {}) {
  state.documentOutlineCollapsed = Boolean(collapsed);
  documentBody.classList.toggle(
    "is-outline-collapsed",
    state.documentOutlineCollapsed,
  );
  documentOutlineToggle.setAttribute(
    "aria-expanded",
    String(!state.documentOutlineCollapsed),
  );
  const label = state.documentOutlineCollapsed
    ? t("action.showOutline")
    : t("action.hideOutline");
  setShortcutTooltip(documentOutlineToggle, label, "Command+Shift+B");
  documentOutlineToggle.setAttribute(
    "aria-label",
    shortcutTooltip(label, "Command+Shift+B"),
  );
  documentOutlineResizer.tabIndex = state.documentOutlineCollapsed ? -1 : 0;
  uiTooltipController.hide();

  if (persist) {
    try {
      window.localStorage?.setItem(
        DOCUMENT_OUTLINE_COLLAPSED_STORAGE_KEY,
        String(state.documentOutlineCollapsed),
      );
    } catch {
      // Outline visibility is a convenience preference outside the desktop app.
    }
    persistAppPreference(
      "documentOutlineCollapsed",
      state.documentOutlineCollapsed,
    );
  }
}

function toggleSidebar() {
  setSidebarCollapsed(!state.sidebarCollapsed);
}

function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  state.sidebarCollapsed = Boolean(collapsed);
  appShell.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  const label = state.sidebarCollapsed ? t("action.expandSidebar") : t("action.collapseSidebar");
  setShortcutTooltip(sidebarToggle, label, "Command+B");
  sidebarToggle.setAttribute("aria-label", shortcutTooltip(label, "Command+B"));
  sidebarResizer.tabIndex = state.sidebarCollapsed ? -1 : 0;

  if (state.sidebarCollapsed) {
    setAgentContextPopoverOpen(false);
    closeWorktreeSwitcher();
    uiTooltipController.hide();
    hideFrontmatterFilterPopover();
    const activeElement = document.activeElement;
    if (sidebar.contains(activeElement) || workspaceSidebarHeader.contains(activeElement)) {
      focusActiveDocumentSurface();
    }
  }

  if (persist) {
    try {
      window.localStorage?.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        String(state.sidebarCollapsed),
      );
    } catch {
      // Sidebar visibility is a convenience preference outside the desktop app.
    }
    persistAppPreference("sidebarCollapsed", state.sidebarCollapsed);
  }
}

function startSidebarResize(event) {
  event.preventDefault();
  appShell.classList.add("is-resizing");
  sidebarResizer.setPointerCapture(event.pointerId);
  setSidebarWidth(event.clientX);

  const onPointerMove = (moveEvent) => setSidebarWidth(moveEvent.clientX);
  const onPointerUp = (upEvent) => {
    sidebarResizer.releasePointerCapture(upEvent.pointerId);
    appShell.classList.remove("is-resizing");
    sidebarResizer.removeEventListener("pointermove", onPointerMove);
    sidebarResizer.removeEventListener("pointerup", onPointerUp);
  };

  sidebarResizer.addEventListener("pointermove", onPointerMove);
  sidebarResizer.addEventListener("pointerup", onPointerUp);
}

function handleSidebarResizeKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }

  event.preventDefault();
  const currentWidth = Number.parseInt(
    appShell.style.getPropertyValue("--sidebar-width") || "320",
    10,
  );
  const delta = event.key === "ArrowLeft" ? -SIDEBAR_WIDTH_STEP : SIDEBAR_WIDTH_STEP;
  setSidebarWidth(currentWidth + delta);
}

function setSidebarWidth(width, { persist = true } = {}) {
  const nextWidth = clampSidebarWidth(width, window.innerWidth);
  appShell.style.setProperty("--sidebar-width", `${nextWidth}px`);
  sidebarResizer.setAttribute("aria-valuenow", String(nextWidth));
  uiTooltipController.hide();
  if (persist) {
    window.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
    persistAppPreference("sidebarWidth", nextWidth);
  }
  positionFrontmatterFilterPopover();
}

function handleDocumentOutlineResizeKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const delta = event.key === "ArrowLeft"
    ? -DOCUMENT_OUTLINE_WIDTH_STEP
    : DOCUMENT_OUTLINE_WIDTH_STEP;
  setDocumentOutlineWidth(currentDocumentOutlineWidth() + delta);
}

function setDocumentOutlineWidthFromPointer(clientX) {
  const bodyRect = documentBody.getBoundingClientRect();
  setDocumentOutlineWidth(clientX - bodyRect.left);
}

function currentDocumentOutlineWidth() {
  return Number.parseInt(
    documentBody.style.getPropertyValue("--document-outline-width")
      || String(DOCUMENT_OUTLINE_DEFAULT_WIDTH),
    10,
  );
}

function setDocumentOutlineWidth(width, { persist = true } = {}) {
  const containerWidth = documentBody.getBoundingClientRect().width || window.innerWidth;
  const nextWidth = clampDocumentOutlineWidth(Number(width), containerWidth);
  documentBody.style.setProperty("--document-outline-width", `${nextWidth}px`);
  documentOutlineResizer.setAttribute("aria-valuemin", String(DOCUMENT_OUTLINE_MIN_WIDTH));
  documentOutlineResizer.setAttribute("aria-valuemax", String(DOCUMENT_OUTLINE_MAX_WIDTH));
  documentOutlineResizer.setAttribute("aria-valuenow", String(nextWidth));
  uiTooltipController.hide();
  if (persist) {
    window.localStorage?.setItem(DOCUMENT_OUTLINE_WIDTH_STORAGE_KEY, String(nextWidth));
    persistAppPreference("documentOutlineWidth", nextWidth);
  }
}

function restoreSourceSplitRatio() {
  const stored = sourcePreviewRatioFromStorageValue(
    preferenceValue("sourcePreviewRatio", SOURCE_SPLIT_STORAGE_KEY),
  );
  setSourceSplitRatio(stored, { persist: false });
}

function startSourceSplitResize(event) {
  event.preventDefault();
  documentWorkspace.classList.add("is-resizing");
  sourceSplitter.setPointerCapture(event.pointerId);
  setSourceSplitRatioFromPointer(event.clientY);

  const onPointerMove = (moveEvent) => setSourceSplitRatioFromPointer(moveEvent.clientY);
  const onPointerUp = (upEvent) => {
    sourceSplitter.releasePointerCapture(upEvent.pointerId);
    documentWorkspace.classList.remove("is-resizing");
    sourceSplitter.removeEventListener("pointermove", onPointerMove);
    sourceSplitter.removeEventListener("pointerup", onPointerUp);
  };

  sourceSplitter.addEventListener("pointermove", onPointerMove);
  sourceSplitter.addEventListener("pointerup", onPointerUp);
}

function handleSourceSplitKeydown(event) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
    return;
  }

  event.preventDefault();
  const currentRatio = Number.parseFloat(
    documentWorkspace.style.getPropertyValue("--source-preview-height") || "45",
  );
  const delta = event.key === "ArrowUp" ? -SOURCE_SPLIT_STEP : SOURCE_SPLIT_STEP;
  setSourceSplitRatio(currentRatio + delta);
}

function setSourceSplitRatioFromPointer(clientY) {
  const rect = documentWorkspace.getBoundingClientRect();
  if (rect.height <= 0) {
    return;
  }
  setSourceSplitRatio(((clientY - rect.top) / rect.height) * 100);
}

function setSourceSplitRatio(value, { persist = true } = {}) {
  const ratio = clampSourcePreviewRatio(value);
  documentWorkspace.style.setProperty("--source-preview-height", `${ratio}%`);
  sourceSplitter.setAttribute("aria-valuenow", String(ratio));
  if (persist) {
    window.localStorage?.setItem(SOURCE_SPLIT_STORAGE_KEY, String(ratio));
    persistAppPreference("sourcePreviewRatio", ratio);
  }
}

function renderDocumentContent(documentData) {
  const kind = documentData.kind || "markdown";
  documentContent.dataset.documentKind = kind;
  documentContent.classList.toggle("is-readonly-preview", kind !== "markdown");
  if (kind === "markdown") {
    documentContent.innerHTML = documentData.html
      || `<p class="empty-message">${escapeHtml(t("document.empty"))}</p>`;
    enhanceImageLoadStates(documentContent, { locale: state.locale });
    enhanceTables();
    documentDatasetViewController.hydrate(documentContent);
    documentMermaidController.hydrate(documentContent);
    scheduleAnchoredSourceLineGutterSync();
    return;
  }

  documentContent.replaceChildren(readonlyPreviewElement(documentData));
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  documentBody.classList.remove("has-outline");
  state.outlineItems = [];
  outlineActiveViewportState.reset();
}

function readonlyPreviewElement(documentData) {
  if (documentData.textTruncated) {
    return readonlyMessage(
      t("readonly.tooLargeTitle"),
      t("readonly.tooLargeDetail", {
        size: formatBytes(documentData.textLimitBytes),
      }),
      { actionLabel: t("action.openSystemSource"), onAction: openCurrentSource },
    );
  }

  if (documentData.kind === "image") {
    const frame = document.createElement("figure");
    frame.className = "file-preview file-preview-image";
    const image = document.createElement("img");
    image.src = apiUrl("/raw", { file: documentData.path });
    image.alt = documentData.title || documentData.path;
    frame.append(image);
    attachImageLoadState(image, { locale: state.locale });
    return frame;
  }

  if (["unsupported", "symlink", "submodule"].includes(documentData.kind)) {
    const label = documentData.kind === "symlink"
      ? t("file.symlink")
      : documentData.kind === "submodule"
        ? "Git Submodule"
        : documentData.extension
          ? t("file.extension", {
              extension: documentData.extension.slice(1).toUpperCase(),
            })
          : t("file.unknownType");
    return readonlyMessage(
      t("readonly.unsupportedTitle"),
      t("readonly.unsupportedDetail", {
        label,
        size: formatBytes(documentData.size || 0),
      }),
      { actionLabel: t("action.openSystemSource"), onAction: openCurrentSource },
    );
  }

  if (documentData.kind === "pdf" || documentData.kind === "html") {
    const frame = document.createElement("iframe");
    frame.className = `file-preview-frame is-${documentData.kind}`;
    frame.title = documentData.title || documentData.path;
    frame.src = apiUrl("/raw", { file: documentData.path });
    return frame;
  }

  if (documentData.kind === "csv") {
    return csvPreviewElement(documentData.text ?? "");
  }

  if (documentData.kind === "json") {
    return jsonPreviewElement(documentData);
  }

  if (documentData.kind === "ndjson") {
    return ndjsonPreviewElement(documentData);
  }

  return codePreviewElement({
    text: documentData.text ?? "",
    language: documentData.kind,
    notice: documentData.parseError,
  });
}

function readonlyMessage(title, message, { actionLabel = "", onAction = null } = {}) {
  const container = document.createElement("section");
  container.className = "file-preview-message";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = message;
  container.append(heading, body);
  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "file-preview-message-action";
    action.textContent = actionLabel;
    action.addEventListener("click", () => void onAction());
    container.append(action);
  }
  return container;
}

function codePreviewElement({ text, language, notice = "" }) {
  const container = document.createElement("section");
  container.className = "file-preview-code";
  if (notice) {
    const note = document.createElement("p");
    note.className = "file-preview-notice";
    note.textContent = notice;
    container.append(note);
  }

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = `language-${language || "text"}`;
  code.textContent = text || "";
  pre.append(code);
  container.append(pre);
  return container;
}

function csvPreviewElement(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return readonlyMessage(t("csv.emptyTitle"), t("csv.emptyDetail"));
  }

  const container = document.createElement("section");
  container.className = "file-preview-table";
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  const [header, ...bodyRows] = rows;
  const headRow = document.createElement("tr");
  for (const cell of header) {
    const th = document.createElement("th");
    th.textContent = cell;
    headRow.append(th);
  }
  head.append(headRow);

  for (const row of bodyRows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      const documentLink = csvMarkdownDocumentLink(cell);
      if (documentLink) {
        const anchor = document.createElement("a");
        anchor.href = documentLink.href;
        anchor.textContent = documentLink.text;
        anchor.dataset.csvDocumentLink = "true";
        td.append(anchor);
      } else {
        td.textContent = cell;
      }
      tr.append(td);
    }
    body.append(tr);
  }

  table.append(head, body);
  scroll.append(table);
  container.append(scroll);
  return container;
}

function jsonPreviewElement(documentData) {
  try {
    const value = JSON.parse(documentData.text ?? "");
    const container = document.createElement("section");
    container.className = "file-preview-json";
    container.append(jsonTreeNode(value, { label: "root", depth: 0, root: true }));
    return container;
  } catch {
    return codePreviewElement({
      text: documentData.text ?? "",
      language: "json",
      notice: documentData.parseError || t("json.parseFallback"),
    });
  }
}

function ndjsonPreviewElement(documentData) {
  const { records, invalidCount } = parseNdjsonRecords(documentData.text ?? "");
  if (records.length === 0) {
    return readonlyMessage(t("ndjson.emptyTitle"), t("ndjson.emptyDetail"));
  }

  const container = document.createElement("section");
  container.className = "file-preview-ndjson";

  const overview = document.createElement("header");
  overview.className = "ndjson-overview";
  const total = document.createElement("span");
  total.textContent = t("ndjson.recordsSummary", {
    records: records.length,
    invalid: invalidCount,
  });
  const shown = document.createElement("span");
  shown.className = "ndjson-shown-count";
  overview.append(total, shown);

  const list = document.createElement("div");
  list.className = "ndjson-record-list";

  const footer = document.createElement("footer");
  footer.className = "ndjson-footer";
  const showMore = document.createElement("button");
  showMore.type = "button";
  showMore.className = "ndjson-show-more";
  footer.append(showMore);

  let renderedCount = 0;
  const renderNextBatch = () => {
    const nextCount = Math.min(records.length, renderedCount + NDJSON_RECORD_BATCH_SIZE);
    for (let index = renderedCount; index < nextCount; index += 1) {
      list.append(ndjsonRecordElement(records[index], {
        recordNumber: index + 1,
        initiallyOpen: index === 0,
      }));
    }
    renderedCount = nextCount;
    shown.textContent = t("ndjson.showing", {
      shown: renderedCount,
      records: records.length,
    });
    const remaining = records.length - renderedCount;
    footer.hidden = remaining === 0;
    showMore.textContent = t("ndjson.showMore", {
      count: Math.min(NDJSON_RECORD_BATCH_SIZE, remaining),
    });
  };

  showMore.addEventListener("click", renderNextBatch);
  renderNextBatch();
  container.append(overview, list, footer);
  return container;
}

function ndjsonRecordElement(record, { recordNumber, initiallyOpen = false } = {}) {
  const details = document.createElement("details");
  details.className = "ndjson-record";
  details.open = initiallyOpen;

  const summary = document.createElement("summary");
  summary.className = "ndjson-record-summary";
  const identity = document.createElement("span");
  identity.className = "ndjson-record-identity";
  identity.textContent = t("ndjson.record", { record: recordNumber });
  const line = document.createElement("span");
  line.className = "ndjson-record-line";
  line.textContent = t("ndjson.line", { line: record.line });
  summary.append(identity, line);

  if (!record.valid) {
    const invalid = document.createElement("span");
    invalid.className = "ndjson-record-invalid";
    invalid.textContent = t("ndjson.invalid");
    summary.append(invalid);
  }
  details.append(summary);

  let hydrated = false;
  const hydrate = () => {
    if (hydrated || !details.open) {
      return;
    }
    hydrated = true;
    const body = document.createElement("div");
    body.className = "ndjson-record-body";
    if (record.valid) {
      body.append(jsonTreeNode(record.value, {
        label: "root",
        depth: 0,
        root: true,
      }));
    } else {
      const source = document.createElement("pre");
      source.className = "ndjson-invalid-source";
      source.textContent = record.raw;
      body.append(source);
    }
    details.append(body);
  };

  details.addEventListener("toggle", hydrate);
  hydrate();
  return details;
}

function jsonTreeNode(value, { label, depth = 0, root = false } = {}) {
  const type = jsonValueType(value);
  const isBranch = type === "array" || type === "object";
  const node = document.createElement("div");
  node.className = `json-tree-node is-${type}`;

  if (!isBranch) {
    const row = document.createElement("div");
    row.className = "json-tree-row";
    if (!root) {
      const key = document.createElement("span");
      key.className = "json-tree-key";
      key.textContent = label;
      row.append(key, document.createTextNode(": "));
    }
    const primitive = document.createElement("span");
    primitive.className = `json-tree-value is-${type}`;
    primitive.textContent = jsonPrimitiveLabel(value, type);
    row.append(primitive);
    node.append(row);
    return node;
  }

  const entries = type === "array"
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const details = document.createElement("details");
  details.open = depth < 1;
  const summary = document.createElement("summary");
  summary.className = "json-tree-summary";
  if (!root) {
    const key = document.createElement("span");
    key.className = "json-tree-key";
    key.textContent = label;
    summary.append(key, document.createTextNode(": "));
  }
  const meta = document.createElement("span");
  meta.className = "json-tree-meta";
  meta.textContent = type === "array" ? `Array(${entries.length})` : `Object(${entries.length})`;
  summary.append(meta);
  details.append(summary);

  const children = document.createElement("div");
  children.className = "json-tree-children";
  for (const [childLabel, childValue] of entries) {
    children.append(jsonTreeNode(childValue, {
      label: childLabel,
      depth: depth + 1,
    }));
  }
  details.append(children);
  node.append(details);
  return node;
}

function jsonValueType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value === "object" ? "object" : typeof value;
}

function jsonPrimitiveLabel(value, type) {
  if (type === "string") {
    return JSON.stringify(value);
  }
  if (type === "null") {
    return "null";
  }
  return String(value);
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "0 B";
  }
  if (number < 1024) {
    return `${number} B`;
  }
  if (number < 1024 * 1024) {
    return `${(number / 1024).toFixed(1)} KB`;
  }
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

function renderDocumentOutline() {
  uiTooltipController.hide();
  outlineClickViewportGuard.end();
  const headings = [...documentContent.querySelectorAll("h1, h2, h3, h4, h5")].map((heading) => {
    const sourceLine = Number(heading.closest(".source-block")?.dataset.sourceStart);
    return {
      id: heading.id,
      text: heading.textContent,
      tagName: heading.tagName,
      sourceLine: Number.isInteger(sourceLine) ? sourceLine : undefined,
    };
  });
  state.outlineItems = outlineItemsFromHeadings(headings);
  const changeTargets = changedOutlineTargets(
    state.outlineItems,
    state.documentChangeModel.changedLines,
  );
  const changedTargetIds = new Set(changeTargets.targetIds);
  const hasEntries = state.outlineItems.length > 0 || changeTargets.beforeFirstHeading;
  documentOutline.innerHTML = "";
  documentOutline.hidden = !hasEntries;
  documentOutlineResizer.hidden = !hasEntries;
  documentOutlineResizer.tabIndex =
    !hasEntries || state.documentOutlineCollapsed ? -1 : 0;
  documentOutlineToggle.hidden = !hasEntries;
  documentBody.classList.toggle("has-outline", hasEntries);
  if (!hasEntries) {
    outlineActiveViewportState.reset();
    return;
  }

  const header = document.createElement("div");
  header.className = "document-outline-header";
  const headerLabel = document.createElement("span");
  headerLabel.className = "document-outline-header-label";
  headerLabel.textContent = t("outline.navigation");
  header.append(headerLabel);
  const list = document.createElement("ul");
  list.className = "outline-list";
  if (changeTargets.beforeFirstHeading) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-link depth-1 document-start has-document-change";
    button.dataset.outlineDocumentStart = "true";
    button.setAttribute(
      "aria-label",
      `${t("outline.documentStart")}. ${t("changes.documentStartModified")}`,
    );
    const label = document.createElement("span");
    label.className = "outline-link-label";
    label.textContent = t("outline.documentStart");
    button.append(label);
    listItem.append(button);
    list.append(listItem);
  }
  for (const item of state.outlineItems) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `outline-link depth-${item.depth}`;
    button.dataset.outlineTarget = item.id;
    if (Number.isInteger(item.sourceLine)) {
      button.dataset.sourceLine = String(item.sourceLine);
    }
    if (changedTargetIds.has(item.id)) {
      button.classList.add("has-document-change");
      button.setAttribute(
        "aria-label",
        `${item.title}. ${t("changes.sectionModified")}`,
      );
    }
    const label = document.createElement("span");
    label.className = "outline-link-label";
    label.textContent = item.title;
    button.append(label);
    listItem.append(button);
    list.append(listItem);
  }
  documentOutline.append(header, list);
  updateActiveOutline(activeOutlineIdFromScroll());
}

function handleOutlineClick(event) {
  const button = event.target.closest("[data-outline-target], [data-outline-document-start]");
  if (!button) {
    return;
  }

  if (button.dataset.outlineDocumentStart === "true") {
    outlineClickViewportGuard.begin();
    if (state.mode === "live" && state.sourceEditor) {
      state.sourceEditor.scrollToLine(1);
    } else {
      documentContent.scrollTo({ top: 0, left: 0 });
    }
    updateActiveOutline(undefined, { preserveViewport: true });
    return;
  }

  if (state.mode === "live" && state.sourceEditor) {
    const sourceLine = Number(button.dataset.sourceLine);
    outlineClickViewportGuard.begin();
    state.sourceEditor.scrollToLine(sourceLine);
    updateActiveOutline(button.dataset.outlineTarget, { preserveViewport: true });
    return;
  }

  const heading = document.getElementById(button.dataset.outlineTarget);
  outlineClickViewportGuard.begin();
  heading?.scrollIntoView({ block: "start" });
  updateActiveOutline(button.dataset.outlineTarget, { preserveViewport: true });
}

function handleOutlineContentNavigationIntent(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target?.closest("#document-content, #source-editor-pane")) {
    return;
  }
  if (event.type === "keydown" && !OUTLINE_CONTENT_NAVIGATION_KEYS.has(event.key)) {
    return;
  }
  outlineClickViewportGuard.end();
}

function updateActiveOutlineFromContentScroll(activeId) {
  const preserveViewport = outlineClickViewportGuard.preserveForContentScroll();
  updateActiveOutline(activeId, { preserveViewport });
}

function updateActiveOutline(activeId, { preserveViewport = false } = {}) {
  const viewportAction = outlineActiveViewportState.transition({
    documentPath: state.currentDocument?.path || "",
    activeId,
    preserveViewport,
  });
  let activeButton;
  for (const button of documentOutline.querySelectorAll("[data-outline-target]")) {
    const isActive = button.dataset.outlineTarget === activeId;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      activeButton = button;
    }
  }
  if (viewportAction === "center" && activeButton) {
    centerActiveOutlineButton(activeButton);
  } else if (viewportAction === "top") {
    documentOutline.scrollTo({ top: 0, left: 0 });
  }
}

function centerActiveOutlineButton(activeButton) {
  const outlineRect = documentOutline.getBoundingClientRect();
  const activeRect = activeButton.getBoundingClientRect();
  const centeredTop = Math.max(
    0,
    documentOutline.scrollTop
      + activeRect.top
      - outlineRect.top
      - (outlineRect.height - activeRect.height) / 2,
  );
  documentOutline.scrollTo({ top: centeredTop, left: 0 });
}

function activeOutlineIdFromScroll() {
  const contentTop = documentContent.getBoundingClientRect().top;
  let activeId;
  for (const item of state.outlineItems) {
    const heading = document.getElementById(item.id);
    if (!heading) {
      continue;
    }
    if (heading.getBoundingClientRect().top <= contentTop + 96) {
      activeId = item.id;
    }
  }
  return activeId;
}

function filterNodesByFrontmatter(nodes) {
  if (state.frontmatterFilters.length === 0) {
    return nodes;
  }

  const filtered = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (
        fileMatchesFrontmatterFilters(
          state.frontmatterFiles[node.path],
          state.frontmatterFilters,
          state.frontmatterAllowedKeys,
        )
      ) {
        filtered.push(node);
      }
      continue;
    }

    const children = filterNodesByFrontmatter(node.children);
    if (children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function renderGitChangeToolbar() {
  const hasChanges = state.gitChanges.length > 0;
  const decision = currentRemoteSyncDecision();
  gitSyncNoteWrap.hidden = !hasChanges;
  gitSyncNote.disabled = !decision.canRunPrimary;
  const note = state.gitSyncNotes.get(remoteSyncScope()) || "";
  if (gitSyncNote.value !== note) gitSyncNote.value = note;
  gitChangeToolbar.hidden = state.sidebarTab !== "sync";
  gitChangeLabel.textContent = hasChanges
    ? t(state.gitChanges.length === 1 ? "git.localChangeOne" : "git.localChangeCount", {
        count: state.gitChanges.length,
      })
    : t("git.noLocalChanges");
  gitChangeLabel.title = gitChangeLabel.textContent;
  sidebarSyncCount.textContent = decision.badge;
  sidebarSyncCount.hidden = !decision.badge;

  gitRemoteStatus.textContent = remoteSyncStatusLabel();
  gitRemoteStatus.title = state.remoteSync.error;
  gitRemoteDetail.textContent = remoteSyncDetailLabel();
  gitRemoteDetail.title = state.remoteSync.error;

  gitMergeRemote.hidden = !decision.showMergeRemote;
  gitMergeRemote.disabled = !decision.canMergeRemote;
  gitMergeRemote.textContent = state.remoteSyncOperation === "merge"
    ? t("action.mergingRemote")
    : t("action.mergeRemote");
  gitSyncOpen.disabled = !decision.canRunPrimary;
  if (state.remoteSyncOperation === "publish") {
    gitSyncOpen.textContent = t("action.syncing");
  } else if (state.remoteSyncOperation === "check") {
    gitSyncOpen.textContent = t("action.checkingRemote");
  } else if (state.remoteSyncOperation === "prepare") {
    gitSyncOpen.textContent = t("remote.preparingMerge");
  } else {
    gitSyncOpen.textContent = decision.primaryAction === "publish"
      ? t("action.syncAndPublish")
      : t("action.checkRemote");
  }
  renderDocumentRemoteMergeStatus();
}

function remoteSyncStatusLabel() {
  if (state.remoteSyncOperation === "check") {
    return t("remote.checking");
  }
  if (state.remoteSyncOperation === "prepare") {
    return t("remote.preparingMerge");
  }
  if (state.remoteSyncOperation === "merge") {
    return t("action.mergingRemote");
  }
  if (state.remoteSync.ok !== true) {
    return state.remoteSync.state === "checking"
      ? t("remote.checking")
      : t("remote.unavailable");
  }
  if (state.remoteSync.state === "diverged") {
    return t("remote.diverged");
  }
  if (state.remoteSync.behind > 0) {
    const count = state.remoteSync.incomingCount || state.remoteSync.behind;
    return t(count === 1 ? "remote.incomingOne" : "remote.incoming", {
      count,
    });
  }
  return t("remote.current");
}

function renderDocumentRemoteMergeStatus() {
  const currentPath = state.currentDocument?.path || "";
  const currentAffected = currentPath
    && state.remoteSync.incomingFiles.includes(currentPath)
    && isEditorMode();
  const applying = Boolean(
    currentPath
    && state.remoteSyncOperation === "merge"
    && state.remoteSyncApplyingDocumentPath === currentPath
  );
  const preparing = Boolean(
    currentAffected
    && state.remoteSyncOperation === "prepare"
  );
  const pending = Boolean(
    currentAffected
    && state.remoteSyncAutoMergeDeferredKey
    && state.remoteSyncAutoMergeDeferredKey === currentRemoteAutoMergeKey()
  );
  if (!applying && !preparing && !pending) {
    documentRemoteMergeStatus.hidden = true;
    documentRemoteMergeStatus.textContent = "";
    documentRemoteMergeStatus.title = "";
    delete documentRemoteMergeStatus.dataset.state;
    return;
  }
  documentRemoteMergeStatus.hidden = false;
  if (applying) {
    documentRemoteMergeStatus.dataset.state = "applying";
    documentRemoteMergeStatus.textContent = t("action.mergingRemote");
    documentRemoteMergeStatus.title = documentRemoteMergeStatus.textContent;
    return;
  }
  if (preparing) {
    documentRemoteMergeStatus.dataset.state = "preparing";
    documentRemoteMergeStatus.textContent = t("remote.preparingMerge");
    documentRemoteMergeStatus.title = documentRemoteMergeStatus.textContent;
    return;
  }
  documentRemoteMergeStatus.dataset.state = "pending";
  documentRemoteMergeStatus.textContent = t("remote.mergePendingEditing");
  documentRemoteMergeStatus.title = t("remote.mergePendingEditingTitle");
}

function remoteSyncDetailLabel() {
  if (state.remoteSync.updatedAt) {
    return t("remote.lastUpdated", {
      time: formatRemoteSyncTime(state.remoteSync.updatedAt),
    });
  }
  if (state.remoteSync.checkedAt) {
    return t("remote.lastChecked", {
      time: formatRemoteSyncTime(state.remoteSync.checkedAt),
    });
  }
  return "";
}

function formatRemoteSyncTime(value) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    return "";
  }
  const now = new Date();
  const sameDay = timestamp.getFullYear() === now.getFullYear()
    && timestamp.getMonth() === now.getMonth()
    && timestamp.getDate() === now.getDate();
  return new Intl.DateTimeFormat(state.locale, sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
  ).format(timestamp);
}

function gitChangedPaths() {
  return new Set(state.gitChanges.map((change) => change.path));
}

function gitChangeForPath(filePath) {
  return state.gitChanges.find((change) => change.path === filePath);
}

function gitChangeBadgeLabel(status) {
  if (status === "added") {
    return "+";
  }
  if (status === "untracked") {
    return "?";
  }
  if (status === "deleted") {
    return "D";
  }
  if (status === "renamed") {
    return "R";
  }
  if (status === "copied") {
    return "C";
  }
  return "M";
}

function gitChangeStatusLabel(status) {
  if (status === "added") {
    return t("git.added");
  }
  if (status === "untracked") {
    return t("git.untracked");
  }
  if (status === "deleted") {
    return t("git.deleted");
  }
  if (status === "renamed") {
    return t("git.renamed");
  }
  if (status === "copied") {
    return t("git.copied");
  }
  return t("git.modified");
}

function closeGitSyncPanel() {
  if (!gitSyncPanel || gitSyncPanel.hidden) {
    return;
  }
  gitSyncPanel.hidden = true;
}

function handleGitSyncPanelBackdropClick(event) {
  if (event.target === gitSyncPanel) {
    closeGitSyncPanel();
  }
}

async function submitGitSync() {
  if (!canEditCurrentRepo() || state.gitChanges.length === 0 || gitSyncOpen.disabled) {
    return;
  }

  const noteScope = remoteSyncScope();
  const note = state.gitSyncNotes.get(noteScope) || "";
  await discardPreparedAutomaticRemoteMerge();
  const files = state.gitChanges.map((change) => change.path);
  const startedAt = performance.now();
  state.remoteSyncOperation = "publish";
  renderGitChangeToolbar();
  gitSyncResult.hidden = true;
  try {
    await flushPendingSourceSync();
    const response = await fetch(apiUrl("/api/git-sync", {
      locale: state.locale,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allChanges: true,
        note,
      }),
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      step: "git-sync",
      error: t("error.syncInvalidResponse"),
    }));
    await applyBranchProtectionPayload(payload);

    if (!response.ok || payload.ok === false) {
      recordTelemetryFeature("git.sync", {
        strategy: "guarded_live_v1",
        result: "error",
        file_count_bucket: itemCountBucket(files.length),
        error_code: gitSyncTelemetryErrorCode(payload.step),
        drift_kind: gitSyncDriftKind(payload.driftKind),
        retry_bucket: retryCountBucket(payload.retryCount),
        duration_bucket: durationBucket(performance.now() - startedAt),
      });
      showGitSyncFailure({
        ...payload,
        files,
        agentPrompt: payload.agentPrompt || clientGitSyncAgentPrompt({
          files,
          step: payload.step || "git-sync",
          error: payload.error || t("error.sync"),
        }),
      });
      return;
    }

    if (state.gitSyncNotes.get(noteScope) === note) state.gitSyncNotes.delete(noteScope);
    closeGitSyncPanel();
    recordTelemetryFeature("git.sync", {
      strategy: "guarded_live_v1",
      result: "success",
      file_count_bucket: itemCountBucket(files.length),
      drift_kind: gitSyncDriftKind(payload.driftKind),
      retry_bucket: retryCountBucket(payload.retryCount),
      duration_bucket: durationBucket(performance.now() - startedAt),
    });
    showCopyToast(t("toast.syncComplete"));
    await loadTree({ force: true });
    await loadGitStatus();
    await refreshCurrentDocument();
    state.remoteSync = normalizeRemoteSyncPayload({
      ...state.remoteSync,
      ok: true,
      state: "current",
      ahead: 0,
      behind: 0,
      incomingCount: 0,
      incomingFiles: [],
      error: "",
      checkedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    clearRemoteAutoMergeFailure();
  } catch (error) {
    recordTelemetryFeature("git.sync", {
      strategy: "guarded_live_v1",
      result: "error",
      file_count_bucket: itemCountBucket(files.length),
      error_code: "unknown",
      drift_kind: "none",
      retry_bucket: "0",
      duration_bucket: durationBucket(performance.now() - startedAt),
    });
    showGitSyncFailure({
      files,
      step: "git-sync",
      error: error instanceof Error ? error.message : t("error.sync"),
      agentPrompt: clientGitSyncAgentPrompt({
        files,
        step: "git-sync",
        error: error instanceof Error ? error.message : t("error.sync"),
      }),
    });
  } finally {
    state.remoteSyncOperation = "";
    renderGitChangeToolbar();
  }
}

function showGitSyncFailure(payload) {
  uiTooltipController.hide();
  gitSyncPanel.hidden = false;
  gitSyncResult.hidden = false;
  gitSyncResultTitle.textContent = payload.resultTitle || t("sync.resultTitle");
  gitSyncResultHelp.textContent = payload.resultHelp
    || t("sync.resultHelp");
  gitSyncAgentPrompt.value = payload.agentPrompt || clientGitSyncAgentPrompt(payload);
  gitSyncCopyPrompt.disabled = false;
}

async function copyGitSyncAgentPrompt() {
  try {
    await writeClipboard(gitSyncAgentPrompt.value);
    showCopyToast(t("toast.promptCopied"));
  } catch {
    showCopyToast(t("toast.copyFailed"));
  }
}

function showAppDialog({
  title,
  message = "",
  content = null,
  inputLabel = "",
  inputValue = "",
  fields = [],
  confirmText = t("action.confirm"),
  cancelText = t("action.cancel"),
  showCancel = true,
  showConfirm = true,
  variant = "",
  initialFocus = "confirm",
} = {}) {
  if (state.activeDialog) {
    closeAppDialog(false);
  }

  uiTooltipController.hide();
  appDialogTitle.textContent = title || t("dialog.confirmTitle");
  appDialogMessage.textContent = message;
  appDialogMessage.hidden = !message;
  appDialogContent.replaceChildren();
  if (content) {
    appDialogContent.append(content);
    appDialogContent.hidden = false;
  } else {
    appDialogContent.hidden = true;
  }
  appDialogConfirm.textContent = confirmText;
  appDialogConfirm.hidden = !showConfirm;
  appDialogCancel.textContent = cancelText;
  appDialogCancel.hidden = !showCancel;
  appDialogActions.hidden = !showConfirm && !showCancel;
  appDialog.classList.toggle("is-shortcuts", variant === "shortcuts");
  appDialogCard.dataset.variant = variant;
  const normalizedFields = normalizeDialogFields(fields);
  appDialogInput.value = inputValue;
  appDialogInputLabel.textContent = inputLabel;
  appDialogInputWrap.hidden = normalizedFields.length > 0 || !inputLabel;
  renderAppDialogFields(normalizedFields);
  appDialog.hidden = false;

  const previousFocus = document.activeElement;
  return new Promise((resolve) => {
    state.activeDialog = {
      previousFocus,
      resolve,
      fieldIds: normalizedFields.map((field) => field.id),
    };
    window.requestAnimationFrame(() => {
      const firstFieldInput = appDialogFields.querySelector("input, select");
      if (firstFieldInput) {
        firstFieldInput.focus({ preventScroll: true });
        firstFieldInput.select?.();
      } else if (inputLabel) {
        appDialogInput.focus({ preventScroll: true });
        appDialogInput.select();
      } else if (initialFocus === "close" || !showConfirm) {
        appDialogClose.focus({ preventScroll: true });
      } else {
        appDialogConfirm.focus({ preventScroll: true });
      }
    });
  });
}

function closeAppDialog(confirmed) {
  const activeDialog = state.activeDialog;
  if (!activeDialog) {
    appDialog.hidden = true;
    return;
  }

  state.activeDialog = null;
  appDialog.hidden = true;
  activeDialog.resolve({
    confirmed,
    value: confirmed ? appDialogInput.value : "",
    values: confirmed ? appDialogValues(activeDialog.fieldIds) : {},
  });
  appDialogFields.replaceChildren();
  appDialogContent.replaceChildren();
  appDialogContent.hidden = true;
  appDialogMessage.hidden = false;
  appDialogFields.hidden = true;
  appDialogCancel.hidden = false;
  appDialogConfirm.hidden = false;
  appDialogActions.hidden = false;
  appDialog.classList.remove("is-shortcuts");
  appDialogCard.dataset.variant = "";
  activeDialog.previousFocus?.focus?.({ preventScroll: true });
}

function normalizeDialogFields(fields) {
  return Array.isArray(fields)
    ? fields
      .map((field) => ({
        id: String(field.id ?? "").trim(),
        label: String(field.label ?? field.id ?? "").trim(),
        value: String(field.value ?? ""),
        placeholder: String(field.placeholder ?? ""),
        options: normalizeDialogFieldOptions(field.options),
      }))
      .filter((field) => field.id && field.label)
    : [];
}

function normalizeDialogFieldOptions(options) {
  return Array.isArray(options)
    ? options
      .map((option) => ({
        label: String(option?.label ?? option ?? "").trim(),
        value: String(option?.value ?? option ?? "").trim(),
      }))
      .filter((option) => option.label && option.value)
    : [];
}

function renderAppDialogFields(fields) {
  appDialogFields.replaceChildren();
  appDialogFields.hidden = fields.length === 0;
  for (const field of fields) {
    const label = document.createElement("label");
    label.className = "app-dialog-field";
    const text = document.createElement("span");
    text.textContent = field.label;
    const control = field.options.length > 0
      ? document.createElement("select")
      : document.createElement("input");
    if (control.tagName === "INPUT") {
      control.type = "text";
      control.placeholder = field.placeholder;
    } else {
      for (const option of field.options) {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        control.append(optionElement);
      }
    }
    control.value = field.value;
    control.dataset.dialogField = field.id;
    label.append(text, control);
    appDialogFields.append(label);
  }
}

function appDialogValues(fieldIds = []) {
  const values = {};
  for (const fieldId of fieldIds) {
    values[fieldId] = appDialogFields.querySelector(`[data-dialog-field="${cssEscape(fieldId)}"]`)?.value ?? "";
  }
  return values;
}

function handleAppDialogBackdropClick(event) {
  if (event.target === appDialog) {
    closeAppDialog(false);
  }
}

function handleAppDialogInputKeydown(event) {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    closeAppDialog(true);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeAppDialog(false);
  }
}

function handleAppDialogKeydown(event) {
  if (
    event.key === "Enter" &&
    !event.isComposing &&
    event.target.closest?.("#app-dialog-fields input, #app-dialog-fields select")
  ) {
    event.preventDefault();
    closeAppDialog(true);
    return;
  }
  if (event.key !== "Escape") {
    return;
  }

  event.preventDefault();
  closeAppDialog(false);
}

function handleAppShortcutKeydown(event) {
  if (event.target.closest?.("#app-dialog, #git-sync-panel, #repository-panel")) {
    return;
  }

  const action = shortcutActionFromKeyboardEvent(event);
  if (!action) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void runAppShortcut(action);
}

function shortcutActionFromKeyboardEvent(event) {
  const key = String(event.key || "").toLowerCase();
  if (event.isComposing) {
    return null;
  }

  if (isTreeDocumentNewTabShortcut(event) && treeFileNewTabShortcutTarget(event.target)) {
    return { command: "open-tree-file-new-tab" };
  }

  const sidebarTab = sidebarTabFromShortcut({
    key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  if (sidebarTab) {
    return { command: "switch-sidebar-tab", tab: sidebarTab };
  }

  if (event.altKey) {
    return null;
  }

  if (event.metaKey && event.shiftKey && event.code === "BracketLeft") {
    return { command: "previous-tab" };
  }

  if (event.metaKey && event.shiftKey && event.code === "BracketRight") {
    return { command: "next-tab" };
  }

  if (!event.metaKey && event.ctrlKey && key === "tab") {
    return { command: event.shiftKey ? "previous-tab" : "next-tab" };
  }

  if (!event.shiftKey && isPrimaryShortcut(event) && event.code === "BracketLeft") {
    return { command: "history-back" };
  }

  if (!event.shiftKey && isPrimaryShortcut(event) && event.code === "BracketRight") {
    return { command: "history-forward" };
  }

  if (!isPrimaryShortcut(event)) {
    return null;
  }

  if (isToggleFavoriteShortcut(event)) {
    return { command: "toggle-favorite" };
  }

  if (!event.shiftKey && key === "b") {
    return { command: "toggle-sidebar" };
  }

  if (event.shiftKey && key === "b") {
    return { command: "toggle-document-outline" };
  }

  if (event.shiftKey && key === "c") {
    return { command: "copy-document-path" };
  }

  if (event.shiftKey && key === "l") {
    return { command: "copy-document-share-link" };
  }

  if (event.shiftKey && key === "g") {
    return { command: "open-document-github" };
  }

  if (event.shiftKey && key === "o") {
    return { command: "open-document-source" };
  }

  if (event.shiftKey && key === "r") {
    return { command: "reveal-file-manager" };
  }

  if (event.shiftKey && key === "e") {
    return { command: "focus-file-tree" };
  }

  if (!event.shiftKey && (event.key === "w" || event.key === "W")) {
    return { command: "close-current-tab" };
  }

  if (!event.shiftKey && /^[1-8]$/.test(key)) {
    return { command: "switch-tab-at-index", index: Number(key) - 1 };
  }

  if (!event.shiftKey && key === "9") {
    return { command: "switch-last-tab" };
  }

  if (!event.shiftKey && key === "p") {
    return { command: "set-mode", mode: "preview" };
  }

  if (!event.shiftKey && key === "s") {
    return { command: "set-mode", mode: "source" };
  }

  if (!event.shiftKey && key === "l") {
    return { command: "set-mode", mode: "live" };
  }

  if (!event.shiftKey && key === "k") {
    return { command: "focus-file-search" };
  }

  if (!event.shiftKey && key === "f") {
    return { command: "find-in-document" };
  }

  if (isKeyboardShortcutsHelpShortcut(event)) {
    return { command: "show-keyboard-shortcuts" };
  }

  return null;
}

async function runAppShortcut(action) {
  const command = typeof action === "string" ? action : action?.command;
  switch (command) {
    case "previous-tab":
      await switchToAdjacentDocumentTab(-1);
      return;
    case "next-tab":
      await switchToAdjacentDocumentTab(1);
      return;
    case "history-back":
      await moveActiveDocumentTabHistory(-1);
      return;
    case "history-forward":
      await moveActiveDocumentTabHistory(1);
      return;
    case "toggle-sidebar":
      toggleSidebar();
      return;
    case "switch-sidebar-tab":
      switchSidebarTabFromShortcut(action.tab);
      return;
    case "toggle-document-outline":
      toggleDocumentOutline();
      return;
    case "switch-tab-at-index":
      await switchToDocumentTabAtIndex(Number(action.index));
      return;
    case "switch-last-tab":
      await switchToDocumentTabAtIndex(state.documentTabs.length - 1);
      return;
    case "close-current-tab": {
      const target = fileActionMenuShortcutTarget("close-tab");
      if (target) {
        closeFileActionMenu();
        await closeTab(target.tabId);
        return;
      }
      closeActiveDocumentTab();
      return;
    }
    case "open-tree-file-new-tab": {
      const target = treeFileNewTabShortcutTarget();
      if (!target) {
        return;
      }
      closeFileActionMenu();
      await openFileInForegroundTab(target.path);
      return;
    }
    case "toggle-favorite": {
      const target = fileActionMenuShortcutTarget("toggle-favorite");
      if (target?.favoriteType) {
        closeFileActionMenu();
        await toggleFavoriteItem({
          type: target.favoriteType,
          path: target.path,
        });
        return;
      }
      await toggleCurrentDocumentFavorite();
      return;
    }
    case "set-mode":
      setMode(action.mode);
      return;
    case "focus-file-search":
      focusFileSearch();
      return;
    case "focus-file-tree":
      focusFileTree();
      return;
    case "find-in-document":
      openDocumentSearch();
      return;
    case "copy-document-path": {
      const target = fileActionMenuShortcutTarget("copy-path");
      if (target) {
        closeFileActionMenu();
        await copyPathValue(target.path);
        return;
      }
      await copyCurrentPath();
      return;
    }
    case "copy-document-share-link": {
      const target = fileActionMenuShortcutTarget("copy-share");
      if (target) {
        closeFileActionMenu();
        await copyShareLinkForPath(target.path);
        return;
      }
      await copyCurrentShareLink();
      return;
    }
    case "open-document-github": {
      const target = fileActionMenuShortcutTarget("open-github");
      if (target) {
        closeFileActionMenu();
        openGithubUrl(target.githubUrl);
        return;
      }
      openCurrentGithub();
      return;
    }
    case "open-document-source": {
      const target = fileActionMenuShortcutTarget("open-system");
      if (target) {
        closeFileActionMenu();
        await openPathWithSystem(target.path);
        return;
      }
      await openCurrentSource();
      return;
    }
    case "reveal-file-manager": {
      const target = fileActionMenuShortcutTarget("reveal-finder");
      if (target) {
        closeFileActionMenu();
        await revealPathInFinder(target.path);
        return;
      }
      if (state.currentDocument && canEditCurrentRepo()) {
        await revealPathInFinder(state.currentDocument.path);
      }
      return;
    }
    case "show-keyboard-shortcuts":
      showKeyboardShortcutsDialog();
      return;
    case "show-git-leaf-help":
      showOpenGlanceHelpDialog();
      return;
    default:
      return;
  }
}

function handleDesktopShortcutEvent(event) {
  event.preventDefault();
  if (handleRepositoryPanelDesktopShortcut(event.detail)) {
    return;
  }
  void runAppShortcut(event.detail);
}

function handleRepositoryPanelDesktopShortcut(action) {
  if (repositoryPanel.hidden) {
    return false;
  }
  if (action?.command === "repository-panel-open-another") {
    openAnotherRepositoryFromPanel();
    return true;
  }
  if (action?.command !== "repository-panel-switch-shortcut") {
    return true;
  }
  activateRepositoryPanelItem(repositoryPanelItemForShortcut(
    state.repositoryPanelVisibleItems,
    action.shortcut,
  ));
  return true;
}

function handleDesktopUpdateStatusEvent(event) {
  event.preventDefault();
  renderSidebarUpdateStatus(event.detail);
  const message = desktopUpdateStatusMessage(event.detail);
  if (message && ["checking", "current", "error", "skipped"].includes(event.detail?.state)) {
    showCopyToast(message);
  }
}

function renderSidebarUpdateStatus(status) {
  const view = sidebarUpdateView(status, state.locale);
  if (!desktopUpdatePanel) {
    return;
  }
  desktopUpdatePanel.hidden = view.hidden;
  if (view.hidden) {
    return;
  }
  desktopUpdateTitle.textContent = view.title;
  desktopUpdateDetail.textContent = view.detail;
  desktopUpdateAction.textContent = view.actionLabel;
  desktopUpdateAction.hidden = !view.actionLabel;
  desktopUpdateAction.disabled = view.actionDisabled;
}

function requestDesktopUpdateInstall() {
  window.open("openglance://install-update", "_blank", "noopener");
}

function openDocumentSearch() {
  if (documentSearch.hidden) {
    state.documentSearchReturnFocus = document.activeElement;
    documentSearch.hidden = false;
    if (!state.documentSearchQuery) {
      state.documentSearchQuery = selectedDocumentSearchText();
    }
    documentSearchInput.value = state.documentSearchQuery;
    refreshDocumentSearch({ preserveIndex: false, reveal: Boolean(state.documentSearchQuery) });
    if (state.documentSearchQuery.trim() && !documentSearchTelemetryActive) {
      recordTelemetryFeature("navigation.document_search");
      documentSearchTelemetryActive = true;
    }
  }

  window.requestAnimationFrame(() => {
    documentSearchInput.focus({ preventScroll: true });
    documentSearchInput.select();
  });
}

function closeDocumentSearch({ restoreFocus = true } = {}) {
  if (documentSearch.hidden) {
    return;
  }

  documentSearch.hidden = true;
  clearDocumentSearchPresentation();
  state.documentSearchMatches = [];
  state.documentSearchIndex = -1;
  documentSearchTelemetryActive = false;
  updateDocumentSearchControls();

  if (!restoreFocus) {
    state.documentSearchReturnFocus = null;
    return;
  }

  const returnFocus = state.documentSearchReturnFocus;
  state.documentSearchReturnFocus = null;
  if (
    returnFocus?.isConnected &&
    !documentSearch.contains(returnFocus) &&
    !returnFocus.closest?.("[hidden]")
  ) {
    returnFocus.focus?.({ preventScroll: true });
    return;
  }
  focusActiveDocumentSurface();
}

function handleDocumentSearchInput() {
  state.documentSearchQuery = documentSearchInput.value;
  if (state.documentSearchQuery.trim() && !documentSearchTelemetryActive) {
    recordTelemetryFeature("navigation.document_search");
    documentSearchTelemetryActive = true;
  } else if (!state.documentSearchQuery.trim()) {
    documentSearchTelemetryActive = false;
  }
  state.documentSearchIndex = -1;
  refreshDocumentSearch({ preserveIndex: false, reveal: true });
}

function handleDocumentSearchKeydown(event) {
  if (event.isComposing) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeDocumentSearch();
    return;
  }
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  moveDocumentSearch(event.shiftKey ? -1 : 1);
}

function moveDocumentSearch(direction) {
  if (state.documentSearchMatches.length === 0) {
    return;
  }
  state.documentSearchIndex = nextSearchIndex(
    state.documentSearchIndex,
    state.documentSearchMatches.length,
    direction,
  );
  applyDocumentSearchPresentation({ reveal: true });
}

function refreshDocumentSearch({ preserveIndex = true, reveal = false } = {}) {
  if (documentSearch.hidden) {
    return;
  }

  clearDocumentSearchPresentation();
  const query = state.documentSearchQuery;
  if (!query || !state.currentDocument) {
    state.documentSearchMatches = [];
    state.documentSearchIndex = -1;
    updateDocumentSearchControls();
    return;
  }

  if (isEditorMode() && state.sourceEditor) {
    state.documentSearchMatches = state.sourceEditor.findMatches(query);
  } else {
    state.documentSearchMatches = findTextRanges(documentContent, query);
  }

  if (state.documentSearchMatches.length === 0) {
    state.documentSearchIndex = -1;
  } else if (
    !preserveIndex ||
    state.documentSearchIndex < 0 ||
    state.documentSearchIndex >= state.documentSearchMatches.length
  ) {
    state.documentSearchIndex = 0;
  }
  applyDocumentSearchPresentation({ reveal });
}

function applyDocumentSearchPresentation({ reveal = false } = {}) {
  clearDocumentSearchPresentation();
  if (state.documentSearchMatches.length === 0) {
    updateDocumentSearchControls();
    return;
  }

  if (isEditorMode() && state.sourceEditor) {
    state.sourceEditor.setSearchMatches(
      state.documentSearchMatches,
      state.documentSearchIndex,
      { reveal },
    );
  } else {
    applyPreviewDocumentSearchHighlights();
    if (reveal) {
      revealPreviewDocumentSearchMatch(state.documentSearchMatches[state.documentSearchIndex]);
    }
  }
  updateDocumentSearchControls();
}

function applyPreviewDocumentSearchHighlights() {
  if (!window.CSS?.highlights || typeof window.Highlight !== "function") {
    return;
  }
  const ranges = state.documentSearchMatches.map((match) => match.range).filter(Boolean);
  if (ranges.length > 0) {
    window.CSS.highlights.set(DOCUMENT_SEARCH_MATCH_HIGHLIGHT, new window.Highlight(...ranges));
  }
  const activeRange = state.documentSearchMatches[state.documentSearchIndex]?.range;
  if (activeRange) {
    window.CSS.highlights.set(DOCUMENT_SEARCH_ACTIVE_HIGHLIGHT, new window.Highlight(activeRange));
  }
}

function revealPreviewDocumentSearchMatch(match) {
  const target = match?.range?.startContainer?.parentElement;
  target?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
}

function clearDocumentSearchPresentation() {
  if (window.CSS?.highlights) {
    window.CSS.highlights.delete(DOCUMENT_SEARCH_MATCH_HIGHLIGHT);
    window.CSS.highlights.delete(DOCUMENT_SEARCH_ACTIVE_HIGHLIGHT);
  }
  state.sourceEditor?.clearSearchMatches?.();
}

function updateDocumentSearchControls() {
  const matchCount = state.documentSearchMatches.length;
  const current = state.documentSearchIndex >= 0 ? state.documentSearchIndex + 1 : 0;
  documentSearchCount.textContent = `${current} / ${matchCount}`;
  documentSearchPrevious.disabled = matchCount === 0;
  documentSearchNext.disabled = matchCount === 0;
  documentSearch.classList.toggle(
    "has-no-results",
    Boolean(state.documentSearchQuery) && matchCount === 0,
  );
}

function selectedDocumentSearchText() {
  const selected = isEditorMode()
    ? state.sourceEditor?.selectedText?.()
    : window.getSelection?.()?.toString();
  const value = String(selected ?? "").trim();
  return value && value.length <= 160 && !/[\r\n]/.test(value) ? value : "";
}

function desktopUpdateStatusMessage(status) {
  if (typeof status?.message === "string" && status.message.trim()) {
    return status.message.trim();
  }

  switch (status?.state) {
    case "checking":
      return t("update.checking");
    case "downloading":
      return t("update.downloading");
    case "downloaded":
      return t("update.downloaded");
    case "available":
      return t("update.available");
    case "current":
      return t("update.current");
    case "error":
      return t("update.error");
    default:
      return "";
  }
}

function isPrimaryShortcut(event) {
  return event.metaKey || event.ctrlKey;
}

function closeActiveDocumentTab() {
  if (!state.activeTabId) {
    return;
  }
  void closeTab(state.activeTabId);
}

async function switchToDocumentTabAtIndex(index) {
  const tab = state.documentTabs[index];
  if (!tab) {
    return;
  }
  await activateDocumentTabAndLoad(tab.id);
}

async function switchToAdjacentDocumentTab(direction) {
  if (state.documentTabs.length < 2) {
    return;
  }
  const activeIndex = state.documentTabs.findIndex((tab) => tab.id === state.activeTabId);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = (currentIndex + direction + state.documentTabs.length) % state.documentTabs.length;
  await switchToDocumentTabAtIndex(nextIndex);
}

function focusFileSearch() {
  if (state.sidebarCollapsed) {
    setSidebarCollapsed(false);
  }
  setSidebarTab("all");
  treeFilter.focus({ preventScroll: true });
  treeFilter.select();
}

function focusActiveDocumentSurface() {
  if (!state.currentDocument) {
    return;
  }
  if (isEditorMode() && state.sourceEditor) {
    state.sourceEditor.focus();
    return;
  }
  focusPreviewDocumentContent();
}

function focusPreviewDocumentContent() {
  if (state.mode !== "preview" || !state.currentDocument) {
    return;
  }
  documentContent.focus({ preventScroll: true });
}

function focusFileTree({ preferActive = true } = {}) {
  if (state.sidebarCollapsed) {
    setSidebarCollapsed(false);
  }
  const items = visibleTreeItems();
  if (items.length === 0) {
    return;
  }

  const activeItem = preferActive
    ? items.find((item) => item.dataset.treePath === state.currentFile)
    : null;
  focusTreeItem(activeItem || items[0]);
}

function handleTreeFilterKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    focusFileTree();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    openFirstSearchResult();
  }
}

function openFirstSearchResult() {
  const fileItems = visibleTreeItems().filter((item) => item.dataset.treeItem === "file");
  if (fileItems.length === 0) {
    return;
  }

  const normalizedFilter = treeFilter.value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const target = fileItems.find((item) => item.dataset.treePath === normalizedFilter) || fileItems[0];
  if (target?.dataset.treePath) {
    void openFileFromTree(target.dataset.treePath);
  }
}

function handleFileTreeFocusIn(event) {
  const snapshot = treeFocusSnapshot(event.target);
  if (!snapshot) {
    return;
  }

  state.lastTreeFocus = snapshot;
  scheduleWorkbenchSessionPersist();
}

function handleFileTreeKeydown(event) {
  const item = currentTreeItem(event.target);
  if (!item || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return;
  }

  if (event.key === "F2") {
    const kind = item.dataset.treeKind || "";
    if (
      item.dataset.treeItem === "file" &&
      item.dataset.treeMissing !== "true" &&
      !["symlink", "submodule", "placeholder"].includes(kind) &&
      canEditCurrentRepo()
    ) {
      event.preventDefault();
      void promptRenameFile({
        path: item.dataset.treePath || "",
        kind,
        regularFile: true,
      });
    }
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusAdjacentTreeItem(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusAdjacentTreeItem(-1);
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    expandOrEnterTreeDirectory(item);
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    collapseOrLeaveTreeDirectory(item);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    activateTreeItem(item);
  }
}

function visibleTreeItems() {
  return [...fileTree.querySelectorAll("[data-tree-item]")].filter(isVisibleTreeItem);
}

function treeFocusSnapshot() {
  const item = currentTreeItem();
  if (!item) {
    return null;
  }

  return {
    itemType: item.dataset.treeItem || "",
    path: item.dataset.treePath || "",
  };
}

function restoreTreeFocus(snapshot) {
  if (!snapshot) {
    return;
  }

  const item = treeItemByPath(snapshot.path, snapshot.itemType) ||
    treeItemByPath(state.currentFile) ||
    visibleTreeItems()[0];
  if (item) {
    focusTreeItem(item, { persist: false });
  }
}

function restoreWorkbenchTreeViewportIfPending() {
  if (!state.pendingWorkbenchTreeViewportRestore) {
    return;
  }

  const session = workbenchSessionForRepo(state.workbenchSessions, state.currentWorktreeId);
  state.pendingWorkbenchTreeViewportRestore = false;
  if (!session) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (session.treeFocus) {
      const item = treeItemByPath(session.treeFocus.path, session.treeFocus.itemType);
      if (item) {
        item.focus({ preventScroll: true });
        state.lastTreeFocus = session.treeFocus;
      }
    }
    if (Number.isFinite(session.treeScrollTop)) {
      fileTree.scrollTop = session.treeScrollTop;
    }
  });
}

function treeItemByPath(path, itemType = "") {
  if (!path) {
    return null;
  }
  return visibleTreeItems().find((item) => {
    return item.dataset.treePath === path && (!itemType || item.dataset.treeItem === itemType);
  }) || null;
}

function currentTreeItem(target = document.activeElement) {
  const item = target?.closest?.("[data-tree-item]");
  return item && fileTree.contains(item) ? item : null;
}

function treeFileNewTabShortcutTarget(target = document.activeElement) {
  const menuTarget = fileActionMenuShortcutTarget("open-new-tab");
  if (menuTarget?.path) {
    return menuTarget;
  }

  const item = currentTreeItem(target);
  if (
    !item ||
    item.dataset.treeItem !== "file" ||
    item.getAttribute("aria-disabled") === "true" ||
    !item.dataset.treePath
  ) {
    return null;
  }
  return { source: "tree", path: item.dataset.treePath };
}

function isVisibleTreeItem(item) {
  for (let node = item.parentElement; node && node !== fileTree; node = node.parentElement) {
    if (node.tagName === "DETAILS" && !node.open && treeDirectorySummary(node) !== item) {
      return false;
    }
  }
  return true;
}

function focusAdjacentTreeItem(direction) {
  const items = visibleTreeItems();
  if (items.length === 0) {
    return;
  }

  const activeItem = currentTreeItem();
  const activeIndex = items.indexOf(activeItem);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + direction));
  focusTreeItem(items[nextIndex]);
}

function focusTreeItem(item, { persist = true } = {}) {
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: "nearest" });
  window.requestAnimationFrame(() => {
    if (item.isConnected && document.activeElement === item) {
      uiTooltipController.showFor("file-tree", item);
    }
  });
  const snapshot = treeFocusSnapshot(item);
  if (snapshot) {
    state.lastTreeFocus = snapshot;
    if (persist) {
      scheduleWorkbenchSessionPersist();
    }
  }
}

function activateTreeItem(item) {
  if (item.getAttribute("aria-disabled") === "true") {
    return;
  }
  if (item.dataset.treeItem === "file") {
    void openFileFromTree(item.dataset.treePath);
    return;
  }
  const details = treeDirectoryDetails(item);
  if (details) {
    setTreeDirectoryOpen(details, !details.open);
  }
}

function expandOrEnterTreeDirectory(item) {
  if (item.getAttribute("aria-disabled") === "true") {
    return;
  }
  const details = treeDirectoryDetails(item);
  if (!details) {
    return;
  }

  if (!details.open) {
    setTreeDirectoryOpen(details, true);
    return;
  }

  const childItem = visibleTreeItems().find((candidate) => {
    return candidate !== item && details.contains(candidate);
  });
  if (childItem) {
    focusTreeItem(childItem);
  }
}

function collapseOrLeaveTreeDirectory(item) {
  const details = treeDirectoryDetails(item);
  if (details?.open) {
    setTreeDirectoryOpen(details, false);
    return;
  }

  const parentSummary = parentTreeDirectorySummary(item);
  if (parentSummary) {
    focusTreeItem(parentSummary);
  }
}

function setTreeDirectoryOpen(details, open) {
  details.open = open;
  details.dataset.programmaticToggle = "true";
  const summary = treeDirectorySummary(details);
  summary?.setAttribute("aria-expanded", String(open));
  if (summary?.dataset.treePath) {
    recordTreeDirectoryToggle(summary.dataset.treePath, open);
  }
}

function treeDirectoryDetails(item) {
  if (item?.dataset.treeItem !== "directory") {
    return null;
  }
  return item.closest("details");
}

function treeDirectorySummary(details) {
  return [...details.children].find((child) => child.tagName === "SUMMARY") || null;
}

function parentTreeDirectorySummary(item) {
  const parentDetails = item.closest("ul")?.closest("details");
  return parentDetails ? treeDirectorySummary(parentDetails) : null;
}

function showKeyboardShortcutsDialog() {
  void showAppDialog({
    title: t("shortcuts.title"),
    content: renderKeyboardShortcutsDialog(),
    showCancel: false,
    showConfirm: false,
    variant: "shortcuts",
    initialFocus: "close",
  });
}

function showOpenGlanceHelpDialog() {
  void showAppDialog({
    title: t("help.title"),
    content: renderOpenGlanceHelpDialog(),
    showCancel: false,
    showConfirm: false,
    variant: "help",
    initialFocus: "close",
  });
}

function renderOpenGlanceHelpDialog() {
  const root = document.createElement("div");
  root.className = "git-leaf-help";

  for (const sectionData of getOpenGlanceHelpSections(state.locale)) {
    const section = document.createElement("section");
    section.className = "git-leaf-help-section";

    const title = document.createElement("h3");
    title.textContent = sectionData.title;
    section.append(title);

    for (const paragraph of sectionData.body) {
      const body = document.createElement("p");
      body.textContent = paragraph;
      section.append(body);
    }
    root.append(section);
  }

  const tableSection = document.createElement("section");
  tableSection.className = "git-leaf-help-section";
  const tableTitle = document.createElement("h3");
  tableTitle.textContent = t("help.fileTypes");
  tableSection.append(tableTitle);

  const table = document.createElement("div");
  table.className = "git-leaf-help-table";
  for (const rowData of getFileTypeHelpRows(state.locale)) {
    const row = document.createElement("div");
    row.className = "git-leaf-help-row";
    const files = document.createElement("code");
    files.textContent = rowData.files;
    const behavior = document.createElement("span");
    behavior.textContent = rowData.behavior;
    row.append(files, behavior);
    table.append(row);
  }

  tableSection.append(table);
  root.append(tableSection);
  return root;
}

function renderKeyboardShortcutsDialog() {
  const root = document.createElement("div");
  root.className = "keyboard-shortcuts";

  const intro = document.createElement("p");
  intro.className = "keyboard-shortcuts-note";
  intro.textContent = t("help.shortcutsNote");
  root.append(intro);

  for (const group of getKeyboardShortcutGroups(state.locale)) {
    const section = document.createElement("section");
    section.className = "keyboard-shortcut-group";

    const title = document.createElement("h3");
    title.textContent = group.title;
    section.append(title);

    const list = document.createElement("div");
    list.className = "keyboard-shortcut-list";
    for (const shortcut of group.shortcuts) {
      const row = document.createElement("div");
      row.className = "keyboard-shortcut-row";

      const keys = document.createElement("kbd");
      keys.textContent = shortcut.keys;

      const action = document.createElement("span");
      action.textContent = shortcut.action;

      row.append(keys, action);
      list.append(row);
    }

    section.append(list);
    root.append(section);
  }

  return root;
}

function clientGitSyncAgentPrompt({ files = [], step = "git-sync", error = t("error.sync") }) {
  return [
    t("agentPrompt.title"),
    "",
    t("agentPrompt.repository", { repo: state.currentRepo }),
    t("agentPrompt.branch", { branch: state.currentRepoBranch }),
    t("agentPrompt.files"),
    ...files.map((file) => `- ${file}`),
    "",
    t("agentPrompt.step", { step }),
    t("agentPrompt.error"),
    error,
    "",
    t("agentPrompt.goal"),
    t("agentPrompt.goal1"),
    t("agentPrompt.goal2"),
    t("agentPrompt.goal3"),
  ].join("\n");
}

async function toggleFrontmatterFilterPopover(event) {
  event.stopPropagation();
  if (state.frontmatterAllowedKeys.length === 0) {
    return;
  }
  if (frontmatterFilterPopover.hidden) {
    frontmatterFilterPopover.hidden = false;
    frontmatterFilterToggle.setAttribute("aria-expanded", "true");
    positionFrontmatterFilterPopover();
    renderFrontmatterFilterPopover();
    await ensureFrontmatterFacets();
    return;
  }

  hideFrontmatterFilterPopover();
}

function hideFrontmatterFilterPopover() {
  frontmatterFilterPopover.hidden = true;
  frontmatterFilterToggle.setAttribute("aria-expanded", "false");
}

function positionFrontmatterFilterPopover() {
  if (frontmatterFilterPopover.hidden) {
    return;
  }

  const margin = 12;
  const toggleRect = frontmatterFilterToggle.getBoundingClientRect();
  const controlsRect = frontmatterFilterToggle.closest(".tree-controls")?.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const width = Math.min(520, Math.max(0, viewportWidth - margin * 2));
  const anchorLeft = controlsRect ? controlsRect.left + 16 : toggleRect.left;
  const left = Math.min(
    Math.max(anchorLeft, margin),
    Math.max(margin, viewportWidth - width - margin),
  );
  const belowTop = toggleRect.bottom + 10;
  const belowHeight = viewportHeight - belowTop - margin;
  let top = belowTop;
  let maxHeight = Math.min(320, Math.max(140, belowHeight));

  if (belowHeight < 140 && toggleRect.top > belowHeight) {
    const aboveHeight = toggleRect.top - margin - 10;
    maxHeight = Math.min(320, Math.max(140, aboveHeight));
    top = Math.max(margin, toggleRect.top - maxHeight - 10);
  }

  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-left", `${Math.round(left)}px`);
  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-top", `${Math.round(top)}px`);
  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-width", `${Math.round(width)}px`);
  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-max-height", `${Math.round(maxHeight)}px`);
}

function renderFrontmatterFilterAvailability() {
  const supported = state.frontmatterAllowedKeys.length > 0;
  const visible = supported &&
    sidebarControlsForView(state.sidebarTab) === "search-and-filter";
  frontmatterFilterToggle.hidden = !visible;
  frontmatterFilterToggle.disabled = !visible;
  if (visible) {
    return;
  }

  hideFrontmatterFilterPopover();
  if (supported) {
    return;
  }
  state.frontmatterFilters = [];
  frontmatterActiveFilters.hidden = true;
  frontmatterActiveFilters.innerHTML = "";
}

function normalizeFrontmatterAllowedKeys(allowedKeys) {
  return Array.isArray(allowedKeys)
    ? allowedKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
    : [];
}

function sameStringArray(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function handleDocumentKeydown(event) {
  if (!repositoryPanel.hidden) {
    return;
  }
  if (event.key === "Escape" && !agentContextPopover.hidden) {
    event.preventDefault();
    closeAgentContextPopoverAndRestoreFocus();
    return;
  }
  if (event.key === "Escape" && !fileActionMenu.hidden) {
    event.preventDefault();
    closeFileActionMenu();
    return;
  }
  if (event.key === "Escape" && !worktreeSwitcherMenu.hidden) {
    event.preventDefault();
    closeWorktreeSwitcher();
    worktreeSwitcherToggle.focus();
    return;
  }
  if (event.key === "Escape" && !frontmatterFilterPopover.hidden) {
    event.preventDefault();
    hideFrontmatterFilterPopover();
    frontmatterFilterToggle.focus();
    return;
  }
  if (event.key === "Escape" && closeActiveLiveEditToolbar()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key !== "Escape" || state.selectedLines.size === 0) {
    return;
  }

  if (event.target.closest?.("#app-dialog")) {
    return;
  }

  event.preventDefault();
  clearLineSelection();
}

function closeActiveLiveEditToolbar() {
  const wasActive = !frontmatterFieldPopover.hidden ||
    !linkPopover.hidden ||
    !imagePopover.hidden;
  clearWorkbenchLiveEditToolbar();
  return wasActive;
}

function clearWorkbenchLiveEditToolbar() {
  clearActiveFrontmatterField();
  clearActiveLink();
  clearActiveImage();
}

function handleDocumentChromeClick(event) {
  if (
    !agentContextPopover.hidden &&
    !closestElement(event.target, ".agent-context-widget")
  ) {
    setAgentContextPopoverOpen(false);
  }
  if (
    !fileActionMenu.hidden &&
    !closestElement(event.target, ".file-action-menu") &&
    !closestElement(event.target, "#document-actions-more")
  ) {
    closeFileActionMenu({ restoreFocus: false });
  }
  if (!worktreeSwitcherMenu.hidden && !closestElement(event.target, ".worktree-switcher")) {
    closeWorktreeSwitcher();
  }

  if (
    !imagePopover.hidden &&
    !closestElement(event.target, ".image-popover") &&
    !closestElement(event.target, "[data-git-leaf-image]")
  ) {
    clearActiveImage();
  }

  if (
    !linkPopover.hidden &&
    !closestElement(event.target, ".link-popover") &&
    !closestElement(event.target, ".cm-live-link-text[data-live-link=\"true\"]")
  ) {
    clearActiveLink();
  }

  if (
    !frontmatterFieldPopover.hidden &&
    !closestElement(event.target, ".frontmatter-field-popover") &&
    !closestElement(event.target, ".cm-live-frontmatter-token[data-live-frontmatter=\"true\"]")
  ) {
    clearActiveFrontmatterField();
  }

  if (
    frontmatterFilterPopover.hidden ||
    closestElement(event.target, ".tree-controls")
  ) {
    return;
  }
  hideFrontmatterFilterPopover();
}

function closestElement(target, selector) {
  const element = target?.closest
    ? target
    : target?.parentElement;
  return element?.closest?.(selector) ?? null;
}

async function ensureFrontmatterFacets({ force = false } = {}) {
  if (state.frontmatterAllowedKeys.length === 0) {
    state.frontmatterFacets = {};
    state.frontmatterFiles = {};
    renderFrontmatterFilterAvailability();
    return;
  }
  if (state.frontmatterFacets && !force) {
    renderFrontmatterFilterPopover();
    return;
  }
  if (state.frontmatterFacetsLoading) {
    return;
  }

  state.frontmatterFacetsLoading = true;
  renderFrontmatterFilterPopover();
  try {
    const response = await fetch(apiUrl("/api/frontmatter-facets"));
    if (!response.ok) {
      throw new Error("Unable to load frontmatter facets");
    }
    const payload = await response.json();
    state.frontmatterAllowedKeys = normalizeFrontmatterAllowedKeys(payload.allowedKeys);
    state.frontmatterFilters = normalizeFrontmatterFilters(
      state.frontmatterFilters,
      state.frontmatterAllowedKeys,
    );
    state.frontmatterFacets = payload.facets ?? {};
    state.frontmatterFiles = payload.files ?? {};
    state.frontmatterActiveKey = nextAvailableFrontmatterKey(state.frontmatterActiveKey);
    renderFrontmatterFilterAvailability();
    renderActiveFrontmatterFilters();
    renderTree();
  } finally {
    state.frontmatterFacetsLoading = false;
    renderFrontmatterFilterPopover();
  }
}

function renderFrontmatterFilterPopover() {
  if (frontmatterFilterPopover.hidden) {
    return;
  }
  if (state.frontmatterAllowedKeys.length === 0) {
    hideFrontmatterFilterPopover();
    return;
  }

  if (state.frontmatterFacetsLoading) {
    frontmatterFilterPopover.innerHTML = `<p class="frontmatter-filter-empty">${escapeHtml(t("filter.loading"))}</p>`;
    positionFrontmatterFilterPopover();
    return;
  }

  const activeKey = nextAvailableFrontmatterKey(state.frontmatterActiveKey);
  state.frontmatterActiveKey = activeKey;
  const values = state.frontmatterFacets?.[activeKey] ?? [];
  frontmatterFilterPopover.innerHTML = [
    `<div class="frontmatter-filter-popover-header"><span>${escapeHtml(t("filter.add"))}</span><span>${escapeHtml(t("filter.and"))}</span></div>`,
    "<div class=\"frontmatter-filter-grid\">",
    `<div class="frontmatter-filter-keys">${renderFrontmatterFilterKeys(activeKey)}</div>`,
    `<div class="frontmatter-filter-values">${renderFrontmatterFilterValues(activeKey, values)}</div>`,
    "</div>",
  ].join("");
  positionFrontmatterFilterPopover();
}

function renderFrontmatterFilterKeys(activeKey) {
  return state.frontmatterAllowedKeys.map((key) => {
    const count = state.frontmatterFacets?.[key]?.length ?? 0;
    const active = key === activeKey ? " is-active" : "";
    return [
      `<button class="frontmatter-filter-option${active}" type="button" data-frontmatter-key="${escapeHtml(key)}">`,
      `<span>${escapeHtml(key)}</span>`,
      `<span class="frontmatter-filter-count">${count}</span>`,
      "</button>",
    ].join("");
  }).join("");
}

function renderFrontmatterFilterValues(activeKey, values) {
  if (!activeKey) {
    return `<p class="frontmatter-filter-empty">${escapeHtml(t("filter.allAdded"))}</p>`;
  }
  if (values.length === 0) {
    return `<p class="frontmatter-filter-empty">${escapeHtml(t("filter.noValues"))}</p>`;
  }

  return values.map(({ value, count }) => [
    `<button class="frontmatter-filter-value" type="button" data-frontmatter-value="${escapeHtml(value)}">`,
    `<span>${escapeHtml(value)}</span>`,
    `<span class="frontmatter-filter-count">${count}</span>`,
    "</button>",
  ].join("")).join("");
}

function handleFrontmatterFilterPopoverClick(event) {
  event.stopPropagation();

  const keyButton = event.target.closest?.("[data-frontmatter-key]");
  if (keyButton) {
    state.frontmatterActiveKey = keyButton.dataset.frontmatterKey;
    renderFrontmatterFilterPopover();
    return;
  }

  const valueButton = event.target.closest?.("[data-frontmatter-value]");
  if (!valueButton || !state.frontmatterActiveKey) {
    return;
  }

  state.frontmatterFilters = normalizeFrontmatterFilters([
    ...state.frontmatterFilters.filter((filter) => filter.key !== state.frontmatterActiveKey),
    { key: state.frontmatterActiveKey, value: valueButton.dataset.frontmatterValue },
  ], state.frontmatterAllowedKeys);
  recordTelemetryFeature("navigation.frontmatter_filter", {
    action: "apply",
    filter_count_bucket: frontmatterFilterCountBucket(state.frontmatterFilters.length),
  });
  state.frontmatterActiveKey = nextAvailableFrontmatterKey();
  renderActiveFrontmatterFilters();
  renderFrontmatterFilterPopover();
  renderTree();
  hideFrontmatterFilterPopover();
}

function handleActiveFrontmatterFilterClick(event) {
  const button = event.target.closest?.("[data-remove-frontmatter-key]");
  if (!button) {
    return;
  }

  state.frontmatterFilters = state.frontmatterFilters.filter(
    (filter) => filter.key !== button.dataset.removeFrontmatterKey,
  );
  recordTelemetryFeature("navigation.frontmatter_filter", {
    action: "clear",
    filter_count_bucket: frontmatterFilterCountBucket(Math.max(1, state.frontmatterFilters.length + 1)),
  });
  renderActiveFrontmatterFilters();
  renderFrontmatterFilterPopover();
  renderTree();
}

function renderActiveFrontmatterFilters() {
  frontmatterActiveFilters.hidden =
    sidebarControlsForView(state.sidebarTab) !== "search-and-filter" ||
    state.frontmatterFilters.length === 0;
  if (state.frontmatterFilters.length === 0) {
    frontmatterActiveFilters.innerHTML = "";
    return;
  }

  frontmatterActiveFilters.innerHTML = state.frontmatterFilters.map(({ key, value }) => [
    "<span class=\"frontmatter-filter-chip\">",
    `<span>${escapeHtml(key)}:</span>`,
    `${escapeHtml(value)}`,
    `<button type="button" aria-label="${escapeHtml(t("filter.remove", { key }))}" data-remove-frontmatter-key="${escapeHtml(key)}">×</button>`,
    "</span>",
  ].join("")).join("");
}

function nextAvailableFrontmatterKey(preferredKey = state.frontmatterActiveKey) {
  const allowedKeys = state.frontmatterAllowedKeys;
  const activeKeys = new Set(state.frontmatterFilters.map((filter) => filter.key));
  if (preferredKey && allowedKeys.includes(preferredKey) && !activeKeys.has(preferredKey)) {
    return preferredKey;
  }
  return allowedKeys.find((key) => !activeKeys.has(key)) ?? "";
}

function directoryContainsCurrentFile(node) {
  if (node.type === "file") {
    return node.path === state.currentFile;
  }
  return node.children.some(directoryContainsCurrentFile);
}

function handleDocumentClick(event) {
  const image = event.target.closest?.("[data-git-leaf-image]");
  if (image && canEditCurrentDocument() && state.sourceEditor) {
    event.preventDefault();
    const block = image.closest(".source-block");
    const line = Number(block?.dataset.sourceStart);
    if (Number.isInteger(line)) {
      selectImageBlock({ line, image, event });
      return;
    }
  }

  const button = event.target.closest("[data-source-line]");
  if (button) {
    focusPreviewDocumentContent();
    clearActiveImage();
    clearActiveLink();
    selectSourceRange(
      Number(button.dataset.sourceLine),
      Number(button.dataset.sourceEnd ?? button.dataset.sourceLine),
      event,
    );
    return;
  }

  const openableLink = openGlanceOpenableLinkFromClick(event);
  if (openableLink) {
    event.preventDefault();
    void navigateDocumentLocation(openableLink, {
      behavior: documentTabBehaviorFromModifiers(event),
    });
    return;
  }

  const csvDocumentLink = event.target.closest?.("a[data-csv-document-link]");
  if (csvDocumentLink) {
    event.preventDefault();
    void openCsvDocumentLink(
      csvDocumentLink.getAttribute("href"),
      documentTabBehaviorFromModifiers(event),
    );
    return;
  }

  const isInteractive = isInteractiveClick(event);
  if (isInteractive) {
    return;
  }

  focusPreviewDocumentContent();

  const line = lineFromDocumentGutterPoint(event);
  if (shouldClearLineSelection({
    selectedCount: state.selectedLines.size,
    isInteractive,
    hasLineTarget: Boolean(button),
    gutterLine: line,
  })) {
    clearActiveImage();
    clearActiveLink();
    clearLineSelection();
    return;
  }

  if (!Number.isInteger(line)) {
    return;
  }

  selectSourceLine(line, event);
}

async function openCsvDocumentLink(href, behavior) {
  const target = await liveDocumentTargetFromHref(href);
  if (target) await navigateDocumentLocation(target, { behavior });
}

function handlePreviewContentKeydown(event) {
  if (
    event.target !== documentContent ||
    state.mode !== "preview" ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing
  ) {
    return;
  }

  const lineStep = 56;
  const pageStep = Math.max(120, Math.floor(documentContent.clientHeight * 0.86));
  let top = 0;
  switch (event.key) {
    case "ArrowDown":
      top = lineStep;
      break;
    case "ArrowUp":
      top = -lineStep;
      break;
    case " ":
      top = event.shiftKey ? -pageStep : pageStep;
      break;
    default:
      return;
  }

  event.preventDefault();
  documentContent.scrollBy({ top, left: 0, behavior: "auto" });
}

function openGlanceOpenableLinkFromClick(event) {
  if (event.altKey || event.defaultPrevented) {
    return null;
  }

  const anchor = event.target.closest?.("a[href]");
  if (!anchor || anchor.target && anchor.target !== "_self") {
    return null;
  }

  try {
    const url = new URL(anchor.getAttribute("href"), window.location.origin);
    const file = url.searchParams.get("file") ?? "";
    if (url.origin !== window.location.origin || !["/", "/raw"].includes(url.pathname) || !file) {
      return null;
    }

    return {
      repo: url.searchParams.get("repo") || state.currentRepo,
      file,
      hash: url.hash,
    };
  } catch {
    return null;
  }
}

function selectSourceLine(line, event) {
  selectSourceRange(line, line, event);
}

function selectSourceRange(start, end, event) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return;
  }

  clearActiveImage();
  clearActiveLink();
  const selection = selectionForSourceRange({
    selectedLines: [...state.selectedLines],
    selectionAnchor: state.selectionAnchor,
    start,
    end,
    extend: event.shiftKey,
    toggle: event.metaKey || event.ctrlKey,
  });
  state.selectedLines = new Set(selection.selectedLines);
  state.selectionAnchor = selection.selectionAnchor;

  updateLineSelectionUi();
}

function updateLineSelectionUi() {
  const selected = [...state.selectedLines].sort((left, right) => left - right);
  state.sourceEditor?.setSelectedLines(selected);
  for (const button of documentContent.querySelectorAll("[data-source-line]")) {
    const start = Number(button.dataset.sourceLine);
    const end = Number(button.dataset.sourceEnd ?? start);
    button.classList.toggle(
      "is-selected",
      Number.isInteger(start)
        && Number.isInteger(end)
        && Array.from({ length: Math.max(end - start + 1, 0) }, (_, index) => start + index)
          .every((line) => state.selectedLines.has(line)),
    );
  }

  if (selected.length === 0) {
    selectionPopover.hidden = true;
    replaceLineHash("");
    return;
  }

  replaceLineHash(hashFromLines(selected));
  scheduleSelectionPopoverPosition();
}

function scrollToHashSelectedLine() {
  if (state.selectedLines.size === 0) {
    return;
  }

  const [line] = [...state.selectedLines].sort((left, right) => left - right);
  if (!Number.isInteger(line)) {
    return;
  }

  if (isEditorMode()) {
    state.sourceEditor?.scrollToLine(line);
    scheduleSelectionPopoverPosition();
    return;
  }

  const target = sourceLineButtonForLine(line);
  if (!target) {
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const contentRect = documentContent.getBoundingClientRect();
  documentContent.scrollTop += targetRect.top - contentRect.top - 24;
  scheduleSelectionPopoverPosition();
}

function scheduleSelectionPopoverPosition() {
  if (state.selectionPopoverFrame) {
    return;
  }

  state.selectionPopoverFrame = window.requestAnimationFrame(() => {
    state.selectionPopoverFrame = null;
    positionSelectionPopover();
  });
}

function clearLineSelection() {
  state.selectedLines = new Set();
  state.selectionAnchor = null;
  updateLineSelectionUi();
}

function replaceLineHash(hash) {
  if (!state.currentDocument) {
    return;
  }
  const nextTabs = updateActiveDocumentTabLocation({
    tabs: state.documentTabs,
    activeTabId: state.activeTabId,
    location: { hash },
  });
  applyDocumentTabState(nextTabs);
  replaceCurrentDocumentUrl();
  scheduleWorkbenchSessionPersist();
}

async function copyCurrentLineReference() {
  if (!state.currentDocument || state.selectedLines.size === 0) {
    return;
  }

  const selectedLineCount = state.selectedLines.size;
  const copyPromise = writeClipboard(
    formatLineReference({
      path: state.currentDocument.path,
      selectedLines: [...state.selectedLines],
      sourceLines: state.currentDocument.sourceLines,
    }),
  );
  clearLineSelection();
  showCopyToast(t("toast.locationCopied"));
  try {
    await copyPromise;
    recordTelemetryFeature("line_reference.copy", {
      line_count_bucket: lineCountBucket(selectedLineCount),
    });
  } catch {
    showCopyToast(t("toast.copyFailed"));
  }
}

function restoreAgentContextItems() {
  state.agentContextLoadedScopeKey = currentAgentContextScopeKey();
  state.agentContextItems = readAgentContextItems({
    storage: agentContextSessionStorage(),
    scopeKey: state.agentContextLoadedScopeKey,
  });
  state.activeAgentContextItemId = state.agentContextItems.at(-1)?.id ?? "";
}

function restoreAgentContextItemsForScopeChange() {
  const nextScopeKey = currentAgentContextScopeKey();
  if (nextScopeKey === state.agentContextLoadedScopeKey) {
    return;
  }
  restoreAgentContextItems();
  setAgentContextPopoverOpen(false);
  renderAgentContext();
}

function persistAgentContextItems() {
  writeAgentContextItems({
    storage: agentContextSessionStorage(),
    scopeKey: currentAgentContextScopeKey(),
    items: state.agentContextItems,
  });
}

function currentAgentContextScopeKey() {
  return agentContextScopeKey({
    repoId: state.currentRepo,
    worktreeId: state.currentWorktreeId,
  });
}

function agentContextSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function toggleAgentContextPopover() {
  setAgentContextPopoverOpen(agentContextPopover.hidden, {
    focus: agentContextPopover.hidden,
  });
}

function closeAgentContextPopoverAndRestoreFocus() {
  setAgentContextPopoverOpen(false);
  agentContextToggle.focus();
}

function setAgentContextPopoverOpen(open, { focus = false } = {}) {
  const nextOpen = Boolean(open);
  agentContextPopover.hidden = !nextOpen;
  agentContextToggle.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) {
    renderAgentContext();
    if (focus) {
      agentContextClose.focus();
    }
  }
}

function handleAgentContextFocusIn(event) {
  if (!agentContextPopover.hidden && !agentContextWidget.contains(event.target)) {
    setAgentContextPopoverOpen(false);
  }
}

function addCurrentSelectionToAgentContext(event) {
  event.stopPropagation();
  if (!state.currentDocument || state.selectedLines.size === 0 || !isMarkdownDocument()) {
    return;
  }

  const repository = repositoryById(state.currentRepo);
  const worktree = currentWorktree();
  const sourceLines = isEditorMode() && state.sourceEditor
    ? sourceLinesFromMarkdown(state.sourceEditor.getValue())
    : state.currentDocument.sourceLines;
  const item = createAgentContextItem({
    repoId: state.currentRepo,
    repoName: repository?.name,
    worktreeId: state.currentWorktreeId,
    worktreeName: worktree?.name,
    branch: state.currentRepoBranch || state.currentDocument.branch,
    revision: worktree?.head,
    path: state.currentDocument.path,
    selectedLines: [...state.selectedLines],
    sourceLines,
  });
  if (!item) {
    return;
  }

  const replacing = state.agentContextItems.some((existing) => existing.id === item.id);
  state.agentContextItems = addAgentContextItem(state.agentContextItems, item);
  state.activeAgentContextItemId = item.id;
  persistAgentContextItems();
  clearLineSelection();
  renderAgentContext();
  setAgentContextPopoverOpen(true, { focus: true });
  showCopyToast(replacing ? t("toast.contextUpdated") : t("toast.contextAdded"));
}

function renderAgentContext() {
  const count = state.agentContextItems.length;
  agentContextToggleCount.textContent = String(count);
  const label = t("agentContext.countTitle", { count });
  setUiTooltip(agentContextToggle, label);
  agentContextToggle.setAttribute("aria-label", label);
  agentContextCopy.textContent = count > 0
    ? t("action.copySnippetCount", { count })
    : t("action.copySnippets");
  agentContextList.replaceChildren(
    ...state.agentContextItems.map(agentContextItemElement),
  );
  agentContextList.hidden = count === 0;
  agentContextEmpty.hidden = count !== 0;
  agentContextClear.disabled = count === 0;
  agentContextCopy.disabled = count === 0;
}

function agentContextItemElement(item) {
  const section = document.createElement("section");
  section.className = "agent-context-item";
  section.classList.toggle("is-active", item.id === state.activeAgentContextItemId);
  section.dataset.agentContextId = item.id;

  const locate = document.createElement("button");
  locate.type = "button";
  locate.className = "agent-context-item-open";
  locate.dataset.agentContextAction = "locate";
  locate.dataset.agentContextId = item.id;
  locate.setAttribute("aria-label", t("agentContext.viewSource", {
    reference: agentContextReferenceLabel(item),
  }));

  const preview = document.createElement("span");
  preview.className = "agent-context-item-preview";
  preview.textContent = item.sourceLines.map((line) => line.text).join("\n").trim()
    || t("agentContext.emptyLine");

  const reference = document.createElement("span");
  reference.className = "agent-context-item-reference";
  reference.textContent = agentContextItemLabel(item);
  locate.append(preview, reference);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "agent-context-item-remove";
  remove.dataset.agentContextAction = "remove";
  remove.dataset.agentContextId = item.id;
  remove.textContent = "×";
  remove.setAttribute("aria-label", t("agentContext.remove", {
    label: agentContextItemLabel(item),
  }));
  section.append(locate, remove);
  return section;
}

function agentContextReferenceLabel(item) {
  const ranges = formatLineRange(item.selectedLines)
    .split(",")
    .filter(Boolean)
    .map((range) => range.includes("-") ? `L${range.replace("-", "-L")}` : `L${range}`)
    .join(",");
  return `${item.path}:${ranges}`;
}

async function handleAgentContextListClick(event) {
  const button = event.target.closest?.("[data-agent-context-action]");
  if (!button) {
    return;
  }
  event.stopPropagation();
  const item = state.agentContextItems.find(
    (candidate) => candidate.id === button.dataset.agentContextId,
  );
  if (!item) {
    return;
  }

  if (button.dataset.agentContextAction === "remove") {
    state.agentContextItems = removeAgentContextItem(state.agentContextItems, item.id);
    if (state.activeAgentContextItemId === item.id) {
      state.activeAgentContextItemId = state.agentContextItems.at(-1)?.id ?? "";
    }
    persistAgentContextItems();
    renderAgentContext();
    agentContextClose.focus();
    showCopyToast(t("toast.contextRemoved"));
    return;
  }

  state.activeAgentContextItemId = item.id;
  renderAgentContext();
  const opened = await navigateDocumentLocation({ path: item.path });
  if (!opened) {
    showCopyToast(t("toast.sourceNotFound"));
    return;
  }
  state.selectedLines = new Set(item.selectedLines);
  state.selectionAnchor = item.selectedLines.at(-1) ?? null;
  updateLineSelectionUi();
  scrollToHashSelectedLine();
  renderAgentContext();
  agentContextClose.focus();
  showCopyToast(t("toast.located", { reference: agentContextReferenceLabel(item) }));
}

function clearAgentContextItems() {
  state.agentContextItems = [];
  state.activeAgentContextItemId = "";
  persistAgentContextItems();
  renderAgentContext();
  agentContextClose.focus();
  showCopyToast(t("toast.contextCleared"));
}

async function copyAgentContext() {
  const markdown = formatAgentContextMarkdown(state.agentContextItems);
  if (!markdown) {
    return;
  }
  try {
    await writeClipboard(markdown);
    showCopyToast(t("toast.contextCopied", { count: state.agentContextItems.length }));
  } catch {
    showCopyToast(t("toast.copyFailed"));
  }
}

function resetStatusPolling() {
  if (state.statusTimer) {
    window.clearInterval(state.statusTimer);
    state.statusTimer = null;
  }
  if (!state.currentDocument) {
    return;
  }

  state.statusTimer = window.setInterval(checkDocumentStatus, 2000);
}

function resetDocumentWatch() {
  if (state.watchStream) {
    state.watchStream.close();
    state.watchStream = null;
  }
  const request = currentDocumentRequest();
  if (!request || !window.EventSource) {
    return;
  }

  const stream = new EventSource(
    apiUrl("/api/watch", { repo: request.repoId, file: request.path }),
  );
  stream.addEventListener("change", (event) => {
    void handleWatchedDocumentChange(event, request);
  });
  state.watchStream = stream;
}

async function handleWatchedDocumentChange(event, request = currentDocumentRequest()) {
  if (!isCurrentDocumentRequest(request)) {
    return;
  }

  const payload = JSON.parse(event.data);
  if (!isCurrentDocumentRequest(request)) {
    return;
  }
  applyRepositoryStatus(payload);
  enforceCurrentRepoEditCapability();
  if (state.sourceWriteInFlight || state.remoteSyncOperation === "merge") {
    return;
  }
  const refreshKind = documentStatusRefreshKind(state.currentDocument, payload, {
    currentMode: state.mode,
    lastWrittenHash: state.lastWrittenHash,
  });
  if (refreshKind) {
    await refreshCurrentDocument({ external: true, baselineOnly: refreshKind === "baseline" });
  }
}

async function checkDocumentStatus() {
  const request = currentDocumentRequest();
  if (!request) {
    return;
  }

  let response;
  try {
    response = await fetch(
      apiUrl("/api/document-status", { repo: request.repoId, file: request.path }),
    );
  } catch {
    return;
  }
  if (!response.ok) {
    return;
  }

  const status = await response.json();
  if (!isCurrentDocumentRequest(request)) {
    return;
  }
  applyRepositoryStatus(status);
  enforceCurrentRepoEditCapability();
  if (state.sourceWriteInFlight || state.remoteSyncOperation === "merge") {
    return;
  }
  const refreshKind = documentStatusRefreshKind(state.currentDocument, status, {
    currentMode: state.mode,
    lastWrittenHash: state.lastWrittenHash,
  });
  if (refreshKind) {
    await refreshCurrentDocument({ external: true, baselineOnly: refreshKind === "baseline" });
  }
}

async function refreshCurrentDocument({ external = false, remoteMerge = false, baselineOnly = false } = {}) {
  const request = currentDocumentRequest();
  if (!request) {
    return;
  }

  const response = await fetch(
    apiUrl("/api/document", {
      repo: request.repoId,
      file: request.path,
      locale: state.locale,
    }),
  );
  if (!response.ok) {
    return;
  }

  const documentData = await response.json();
  if (!isCurrentDocumentRequest(request, documentData)) {
    return;
  }
  if (baselineOnly) {
    // A commit changes the comparison baseline, not the editor's current text or pending writes.
    state.currentDocument = withDocumentChangeBaseline(state.currentDocument, documentData);
    state.documentChangeModel = documentChangeModelForDocument(state.currentDocument);
    applySourceEditorDocumentChangeBaseline();
    refreshDocumentChangePresentation();
    return;
  }
  applyDocumentData(documentData, {
    preserveScroll: true,
    preserveEditorState: true,
    highlightEditorChanges: remoteMerge,
  });
  if (external && isEditorMode()) {
    updateSourceSyncStatus("external");
  }
}

async function copyCurrentPath() {
  if (!state.currentDocument) {
    return;
  }
  await copyPathValue(state.currentDocument.path);
}

async function copyCurrentShareLink() {
  if (!state.currentDocument || copyShareLinkButton.disabled) {
    return;
  }
  await copyShareLinkForPath(state.currentDocument.path, { disablePrimary: true });
}

async function copyShareLinkForPath(documentPath, { disablePrimary = false } = {}) {
  if (!isMarkdownPath(documentPath)) {
    return;
  }
  if (disablePrimary) {
    copyShareLinkButton.disabled = true;
  }
  try {
    if (documentPath === state.currentDocument?.path) {
      await flushPendingSourceSync();
    }
    const response = await fetch(apiUrl("/api/share-link", {
      file: documentPath,
      locale: state.locale,
    }));
    const payload = await response.json().catch(() => ({
      error: t("error.shareInvalidResponse"),
      code: "share_unavailable",
    }));
    if (!response.ok || !payload.url) {
      await showShareLinkUnavailable(payload, documentPath);
      return;
    }
    await writeRichLinkClipboard(
      payload.url,
      shareLinkClipboardTitle(payload.url, documentPath),
    );
    showCopyToast(t("toast.shareCopied"));
  } catch (error) {
    await showAppDialog({
      title: t("share.copyFailedTitle"),
      message: error instanceof Error ? error.message : t("share.copyFailed"),
      showCancel: false,
      confirmText: t("action.gotIt"),
    });
  } finally {
    if (disablePrimary) {
      copyShareLinkButton.disabled = !state.currentDocument || !isMarkdownDocument();
    }
  }
}

async function showShareLinkUnavailable(payload, documentPath) {
  const canPublishDocument = payload?.code === "document_not_committed"
    || payload?.code === "document_not_published";
  const needsCommit = payload?.code === "document_not_committed";
  const { confirmed } = await showAppDialog({
    title: canPublishDocument ? t("share.unpublishedTitle") : t("share.unavailableTitle"),
    message: payload?.error || t("share.unavailable"),
    confirmText: canPublishDocument
      ? (needsCommit ? t("share.syncAndCopy") : t("share.publishAndCopy"))
      : t("action.gotIt"),
    showCancel: canPublishDocument,
  });
  if (!confirmed || !canPublishDocument) {
    return;
  }
  await publishShareLinkForPath(documentPath);
}

async function publishShareLinkForPath(documentPath) {
  const noteScope = remoteSyncScope();
  const note = state.gitSyncNotes.get(noteScope) || "";
  for (;;) {
    let response;
    let payload;
    try {
      response = await fetch(apiUrl("/api/share-link", {
        file: documentPath,
        locale: state.locale,
      }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      payload = await response.json().catch(() => ({
        ok: false,
        error: t("error.publishInvalidResponse"),
        code: "share_publish_failed",
        retryable: true,
      }));
    } catch (error) {
      payload = {
        ok: false,
        error: error instanceof Error ? error.message : t("error.publishUnavailable"),
        code: "share_publish_failed",
        step: "network",
        retryable: true,
      };
    }

    if (response?.ok && payload?.ok !== false && payload?.url) {
      if (payload.published && state.gitSyncNotes.get(noteScope) === note) state.gitSyncNotes.delete(noteScope);
      await writeRichLinkClipboard(
        payload.url,
        shareLinkClipboardTitle(payload.url, documentPath),
      );
      showCopyToast(payload.published ? t("toast.publishedAndCopied") : t("toast.shareCopied"));
      await loadGitStatus();
      if (payload.published && documentPath === state.currentDocument?.path) {
        await refreshCurrentDocument();
      }
      return;
    }

    if (payload?.retryable !== true) {
      await showAppDialog({
        title: t("share.publishFailedTitle"),
        message: payload?.error || t("share.publishUnavailable"),
        showCancel: false,
        confirmText: t("action.gotIt"),
      });
      return;
    }

    const { confirmed } = await showAppDialog({
      title: t("share.publishFailed"),
      message: [
        payload?.error || t("share.remoteIncomplete"),
        t("share.localPreserved"),
      ].join("\n\n"),
      confirmText: t("share.retryPublish"),
      cancelText: payload?.agentPrompt ? t("share.handOffAgent") : t("action.close"),
      showCancel: true,
    });
    if (confirmed) {
      await loadGitStatus();
      continue;
    }

    if (payload?.agentPrompt) {
      showGitSyncFailure({
        ...payload,
        resultTitle: t("share.publishFailed"),
        resultHelp: t("share.agentHelp"),
      });
    }
    return;
  }
}

async function openCurrentSource() {
  if (!canEditCurrentRepo() || !state.currentDocument) {
    return;
  }
  await openPathWithSystem(state.currentDocument.path);
}

async function preparePdfExport() {
  if (!state.currentDocument) {
    return null;
  }
  const restoreMode = state.mode;
  if (isEditorMode()) {
    try {
      await flushPendingSourceSync();
    } catch {
      throw new Error("Source sync failed before PDF export.");
    }
  }
  chartTooltipController.hide();
  setMode("preview", { persist: false, focus: false });
  await waitForPdfExportSurface();
  return {
    path: state.currentDocument.path,
    title: state.currentDocument.title || "",
    restoreMode,
  };
}

function finishPdfExport(metadata) {
  const restoreMode = modeFromStorageValue(metadata?.restoreMode);
  if (restoreMode !== state.mode) {
    setMode(restoreMode, { persist: false, focus: false });
  }
}

async function waitForPdfExportSurface() {
  await nextAnimationFrame();
  await document.fonts?.ready?.catch?.(() => {});
  const images = [...documentContent.querySelectorAll("img")];
  await Promise.all(images.map(waitForImageReady));
  await nextAnimationFrame();
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForImageReady(image) {
  if (image.complete) {
    return;
  }
  if (typeof image.decode === "function") {
    await timeoutAfter(image.decode().catch(() => {}), 3000);
    return;
  }
  await timeoutAfter(new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  }), 3000);
}

function timeoutAfter(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);
}

function openCurrentGithub() {
  openGithubUrl(state.currentDocument?.githubUrl);
}

function openGithubUrl(githubUrl) {
  if (!githubUrl) {
    recordTelemetryFeature("github.open", { result: "error" });
    showCopyToast(t("toast.noGitHubLink"));
    return;
  }
  try {
    window.open(githubUrl, "_blank", "noopener");
    recordTelemetryFeature("github.open", { result: "success" });
    showCopyToast(t("toast.openedGitHub"));
  } catch {
    recordTelemetryFeature("github.open", { result: "error" });
    showCopyToast(t("toast.openGitHubFailed"));
  }
}

function enhanceTables(root = documentContent) {
  for (const tableCard of root.querySelectorAll("[data-enhanced-table]")) {
    if (tableCard.dataset.tableEnhanced === "true") {
      continue;
    }
    tableCard.dataset.tableEnhanced = "true";
    const table = tableCard.querySelector("table");
    const search = tableCard.querySelector("[data-table-search]");
    const copy = tableCard.querySelector("[data-table-copy]");
    const freeze = tableCard.querySelector("[data-table-freeze]");

    search?.addEventListener("input", () => {
      const needle = search.value.trim().toLowerCase();
      for (const row of table.querySelectorAll("tbody tr")) {
        row.hidden = needle.length > 0 && !row.textContent.toLowerCase().includes(needle);
      }
    });

    copy?.addEventListener("click", async () => {
      await writeClipboard(tableToCsv(table));
    });

    freeze?.addEventListener("change", () => {
      tableCard.classList.toggle("is-first-column-frozen", freeze.checked);
    });
  }
}

async function pasteImageAsset(file) {
  if (!canEditCurrentDocument() || !state.currentDocument?.path) {
    showCopyToast(t("toast.notEditable"));
    return "";
  }

  showCopyToast(t("toast.savingImage"));
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const response = await fetch(apiUrl("/api/image-assets", {
      file: state.currentDocument.path,
      locale: state.locale,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataUrl,
        name: file.name || "",
      }),
    });
    const payload = await response.json().catch(() => ({ error: t("error.saveImage") }));
    if (!response.ok) {
      throw new Error(payload.error || t("error.saveImage"));
    }
    await applyBranchProtectionPayload(payload);
    recordTelemetryFeature("editing.image_paste", { result: "success" });
    showCopyToast(t("toast.imageInserted"));
    return payload.tag || "";
  } catch (error) {
    recordTelemetryFeature("editing.image_paste", { result: "error" });
    showCopyToast(error instanceof Error ? error.message : t("error.saveImage"));
    return "";
  }
}

async function pasteTextLink(text, { selectedText = "" } = {}) {
  if (!canEditCurrentDocument() || !state.currentDocument?.path) {
    return "";
  }

  const value = String(text ?? "").trim();
  if (isOpenGlanceDocumentUrl(value)) {
    return documentLinkMarkdown(value, selectedText);
  }

  if (/^https?:\/\//i.test(value)) {
    return externalLinkMarkdown(value, selectedText);
  }

  return documentLinkMarkdown(value, selectedText);
}

async function runSlashCommand(command) {
  if (command.custom === "link") {
    return externalLinkMarkdown("https://");
  }

  if (command.custom === "doclink") {
    const result = await showLinkFieldsDialog({
      title: t("link.repositoryTitle"),
      message: t("link.repositoryHelp"),
      titleValue: "",
      linkValue: "",
      linkPlaceholder: "docs/example.md",
      confirmText: t("link.insert"),
    });
    if (!result.confirmed) {
      return null;
    }
    return documentLinkMarkdown(result.values.link, result.values.title);
  }

  return null;
}

async function showLinkFieldsDialog({
  title,
  message,
  titleValue = "",
  linkValue = "",
  linkLabel = t("link.fieldLink"),
  linkPlaceholder = "",
  confirmText = t("link.save"),
} = {}) {
  return showAppDialog({
    title,
    message,
    fields: [
      {
        id: "title",
        label: t("link.fieldTitle"),
        value: titleValue,
        placeholder: t("link.defaultTitlePlaceholder"),
      },
      {
        id: "link",
        label: linkLabel,
        value: linkValue,
        placeholder: linkPlaceholder,
      },
    ],
    confirmText,
    cancelText: t("action.cancel"),
  });
}

async function externalLinkMarkdown(url = "", selectedText = "") {
  const normalizedUrl = String(url ?? "").trim();
  const validInitialUrl = /^https?:\/\/\S+$/i.test(normalizedUrl);
  const fetchedTitle = validInitialUrl && !selectedText.trim()
    ? await externalLinkTitle(normalizedUrl)
    : "";
  const result = await showLinkFieldsDialog({
    title: t("link.externalTitle"),
    message: t("link.externalHelp"),
    titleValue: selectedText.trim() || fetchedTitle,
    linkValue: normalizedUrl || "https://",
    linkPlaceholder: "https://example.com",
    confirmText: t("link.insert"),
  });
  if (!result.confirmed) {
    return "";
  }

  return externalLinkMarkdownFromFields(result.values.title, result.values.link);
}

function externalLinkMarkdownFromFields(title, url) {
  const normalizedUrl = String(url ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(normalizedUrl)) {
    showCopyToast(t("link.invalidUrl"));
    return "";
  }

  const normalizedTitle = String(title ?? "").trim() || normalizedUrl;
  return `[${escapeMarkdownLinkText(normalizedTitle)}](${normalizedUrl})`;
}

async function externalLinkTitle(url) {
  try {
    const response = await fetch(apiUrl("/api/link-title", { url }), { cache: "no-store" });
    const payload = await response.json().catch(() => ({ title: "" }));
    if (!response.ok) {
      return "";
    }
    return String(payload.title ?? "").trim();
  } catch {
    return "";
  }
}

async function documentLinkMarkdown(target, titleOverride = "") {
  const normalizedTarget = String(target ?? "").trim();
  if (!normalizedTarget) {
    return "";
  }

  try {
    const response = await fetch(apiUrl("/api/link-target", {
      file: state.currentDocument.path,
      target: normalizedTarget,
      locale: state.locale,
    }));
    const payload = await response.json().catch(() => ({ error: t("error.readTargetDocument") }));
    if (!response.ok) {
      throw new Error(payload.error || t("error.readTargetDocument"));
    }
    const title = String(titleOverride ?? "").trim() || payload.title || payload.path;
    return `[${escapeMarkdownLinkText(title)}](${payload.href})`;
  } catch (error) {
    showCopyToast(error instanceof Error ? error.message : t("error.insertDocumentLink"));
    return "";
  }
}

function isOpenGlanceDocumentUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const file = url.searchParams.get("file") ?? "";
    if (!/^https?:$/i.test(url.protocol) || !/\.mdx?$/i.test(file)) {
      return false;
    }
    return url.origin === window.location.origin || url.searchParams.has("repo");
  } catch {
    return false;
  }
}

function escapeMarkdownLinkText(value) {
  return String(value ?? "").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error(t("error.readImage"))));
    reader.readAsDataURL(file);
  });
}

function selectImageBlock({ line, image }) {
  if (!canEditCurrentDocument() || !state.sourceEditor || !Number.isInteger(line)) {
    return;
  }

  clearLineSelection();
  clearActiveLink();
  clearActiveFrontmatterField();
  state.sourceEditor.clearLiveContextSelection?.();
  state.activeImage = {
    line,
    element: image,
  };
  markActiveImage();
  positionImagePopover();
}

function clearActiveImage() {
  state.activeImage = null;
  imagePopover.hidden = true;
  for (const frame of document.querySelectorAll(".git-leaf-image-frame.is-selected")) {
    frame.classList.remove("is-selected");
  }
}

function markActiveImage() {
  for (const frame of document.querySelectorAll(".git-leaf-image-frame.is-selected")) {
    frame.classList.remove("is-selected");
  }
  const image = activeImageElement();
  image?.closest(".git-leaf-image-frame")?.classList.add("is-selected");
}

function positionImagePopover() {
  if (!state.activeImage || !state.sourceEditor) {
    imagePopover.hidden = true;
    return;
  }

  const image = activeImageElement();
  if (!image) {
    imagePopover.hidden = true;
    return;
  }

  imagePopover.hidden = false;
  const imageRect = image.getBoundingClientRect();
  positionLiveEditToolbar(imagePopover, imageRect);
}

function activeImageElement() {
  const element = state.activeImage?.element;
  if (element?.isConnected) {
    return element;
  }

  const line = state.activeImage?.line;
  if (!Number.isInteger(line)) {
    return null;
  }
  return state.sourceEditor?.imageElement?.(line) ??
    documentContent.querySelector(`.source-block[data-source-start="${line}"] [data-git-leaf-image]`);
}

function selectLiveLink({ line, from, to, text, href, element }) {
  if (!canEditCurrentDocument() || !state.sourceEditor || !Number.isInteger(line)) {
    return;
  }

  clearLineSelection();
  clearActiveImage();
  clearActiveFrontmatterField();
  state.sourceEditor.clearLiveContextSelection?.();
  state.activeLink = {
    line,
    from,
    to,
    text,
    href,
    element,
  };
  markActiveLink();
  positionLinkPopover();
}

function clearActiveLink() {
  state.activeLink = null;
  linkPopover.hidden = true;
  for (const link of document.querySelectorAll(".cm-live-link-text.is-selected")) {
    link.classList.remove("is-selected");
  }
}

function markActiveLink() {
  for (const link of document.querySelectorAll(".cm-live-link-text.is-selected")) {
    link.classList.remove("is-selected");
  }
  activeLinkElement()?.classList.add("is-selected");
}

function positionLinkPopover() {
  if (!state.activeLink || !state.sourceEditor || state.mode !== "live") {
    linkPopover.hidden = true;
    return;
  }

  const link = activeLinkElement();
  if (!link) {
    linkPopover.hidden = true;
    return;
  }

  linkPopover.hidden = false;
  const linkRect = link.getBoundingClientRect();
  positionLiveEditToolbar(linkPopover, linkRect);
}

function activeLinkElement() {
  const element = state.activeLink?.element;
  if (element?.isConnected) {
    return element;
  }

  const link = state.activeLink;
  if (!link || !Number.isInteger(link.line)) {
    return null;
  }
  return state.sourceEditor?.linkElement?.(link.line, link.from, link.to) ?? null;
}

function selectLiveFrontmatterField({ line, key, value, element }) {
  if (
    !canEditCurrentDocument() ||
    !state.sourceEditor ||
    !Number.isInteger(line) ||
    !state.currentDocument?.frontmatterProfile?.enabled
  ) {
    return;
  }

  clearLineSelection();
  clearActiveImage();
  clearActiveLink();
  state.sourceEditor.clearLiveContextSelection?.();
  state.activeFrontmatterField = {
    line,
    key,
    value,
    element,
  };
  markActiveFrontmatterField();
  renderFrontmatterFieldPopover();
  positionFrontmatterFieldPopover();
}

function clearActiveFrontmatterField() {
  state.activeFrontmatterField = null;
  frontmatterFieldPopover.hidden = true;
  for (const field of document.querySelectorAll(".cm-live-frontmatter-token.is-selected")) {
    field.classList.remove("is-selected");
  }
}

function markActiveFrontmatterField() {
  for (const field of document.querySelectorAll(".cm-live-frontmatter-token.is-selected")) {
    field.classList.remove("is-selected");
  }
  activeFrontmatterFieldElement()?.classList.add("is-selected");
}

function renderFrontmatterFieldPopover() {
  const field = state.activeFrontmatterField;
  if (!field) {
    frontmatterFieldPopover.hidden = true;
    return;
  }

  const profile = frontmatterFieldDefinition(field.key);
  const editor = renderFrontmatterFieldEditor(profile, field.value);
  const actions = [
    `<span class="frontmatter-field-popover-key">${escapeHtml(field.key)}</span>`,
    editor || `<button type="button" data-frontmatter-field-action="edit">${escapeHtml(t("action.edit"))}</button>`,
  ].filter(Boolean);
  if (profile.type === "date" && editor) {
    actions.push(`<button type="button" data-frontmatter-field-action="today">${escapeHtml(t("action.today"))}</button>`);
  }
  actions.push(
    `<button type="button" data-frontmatter-field-action="add">${escapeHtml(t("action.addField"))}</button>`,
    `<button type="button" data-frontmatter-field-action="delete">${escapeHtml(t("action.delete"))}</button>`,
    `<button class="live-edit-toolbar-close" type="button" data-frontmatter-field-action="close" aria-label="${escapeHtml(t("action.close"))}">×</button>`,
  );
  frontmatterFieldPopover.innerHTML = actions.join("");
}

function renderFrontmatterFieldEditor(definition, value) {
  const values = frontmatterFieldOptionValues(definition);
  if (values.length === 0) {
    return definition.type === "date" ? renderFrontmatterDateEditor(definition, value) : "";
  }

  return renderFrontmatterSelectEditor(definition, value, values);
}

function renderFrontmatterSelectEditor(definition, value, values) {
  const currentValue = frontmatterEditorValue(value);
  if (currentValue && !values.includes(currentValue)) {
    values.unshift(currentValue);
  }
  const options = [
    currentValue ? "" : `<option value="">${escapeHtml(t("action.select"))}</option>`,
    ...values.map((item) => (
      `<option value="${escapeHtml(item)}"${item === currentValue ? " selected" : ""}>${escapeHtml(item)}</option>`
    )),
  ];
  return `<select data-frontmatter-field-value="${escapeHtml(definition.key)}" aria-label="${escapeHtml(definition.key)}">${options.join("")}</select>`;
}

function renderFrontmatterDateEditor(definition, value) {
  return `<input type="date" data-frontmatter-field-value="${escapeHtml(definition.key)}" aria-label="${escapeHtml(definition.key)}" value="${escapeHtml(frontmatterEditorValue(value))}">`;
}

function frontmatterFieldOptionValues(definition) {
  const values = Array.isArray(definition.values) ? [...definition.values].map(String).filter(Boolean) : [];
  if (values.length > 0 || definition.type !== "boolean") {
    return values;
  }
  return ["true", "false"];
}

function frontmatterEditorValue(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2) {
    const quote = text[0];
    if ((quote === "\"" || quote === "'") && text.at(-1) === quote) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function positionFrontmatterFieldPopover() {
  if (!state.activeFrontmatterField || !state.sourceEditor || state.mode !== "live") {
    frontmatterFieldPopover.hidden = true;
    return;
  }

  const field = activeFrontmatterFieldElement();
  if (!field) {
    frontmatterFieldPopover.hidden = true;
    return;
  }

  frontmatterFieldPopover.hidden = false;
  const fieldRect = field.getBoundingClientRect();
  positionLiveEditToolbar(frontmatterFieldPopover, fieldRect);
}

function positionLiveEditToolbar(toolbar, anchorRect) {
  const paneRect = previewPane.getBoundingClientRect();
  const maxLeft = Math.max(12, paneRect.width - toolbar.offsetWidth - 12);
  const left = Math.min(
    maxLeft,
    Math.max(12, anchorRect.left - paneRect.left),
  );
  const top = Math.max(
    12,
    anchorRect.top - paneRect.top - toolbar.offsetHeight - 8,
  );
  toolbar.style.left = `${Math.round(left)}px`;
  toolbar.style.top = `${Math.round(top)}px`;
}

function activeFrontmatterFieldElement() {
  const element = state.activeFrontmatterField?.element;
  if (element?.isConnected) {
    return element;
  }

  const field = state.activeFrontmatterField;
  if (!field || !Number.isInteger(field.line)) {
    return null;
  }
  return state.sourceEditor?.frontmatterFieldElement?.(field.line, field.key) ?? null;
}

async function handleFrontmatterFieldPopoverClick(event) {
  event.stopPropagation();
  const button = event.target.closest?.("[data-frontmatter-field-action]");
  if (!button || !state.activeFrontmatterField) {
    return;
  }

  const action = button.dataset.frontmatterFieldAction;
  if (action === "close") {
    clearActiveFrontmatterField();
    return;
  }
  if (action === "edit") {
    await editActiveFrontmatterField();
    return;
  }
  if (action === "toggle") {
    toggleActiveFrontmatterField();
    return;
  }
  if (action === "today") {
    updateActiveFrontmatterFieldValue(todayIsoDate());
    return;
  }
  if (action === "delete") {
    deleteActiveFrontmatterField();
    return;
  }
  if (action === "add") {
    await addFrontmatterField();
  }
}

function handleFrontmatterFieldPopoverChange(event) {
  event.stopPropagation();
  if (!event.target.closest?.("[data-frontmatter-field-value]") || !state.activeFrontmatterField) {
    return;
  }

  updateActiveFrontmatterFieldValue(event.target.value);
}

async function editActiveFrontmatterField() {
  const field = state.activeFrontmatterField;
  if (!field) {
    return;
  }

  const definition = frontmatterFieldDefinition(field.key);
  const { confirmed, values } = await showAppDialog({
    title: t("frontmatter.editTitle", { key: field.key }),
    fields: [dialogFieldForFrontmatterValue(definition, field.value)],
    confirmText: t("action.save"),
    cancelText: t("action.cancel"),
  });
  if (!confirmed) {
    return;
  }

  updateActiveFrontmatterFieldValue(values.value);
}

function toggleActiveFrontmatterField() {
  const field = state.activeFrontmatterField;
  if (!field) {
    return;
  }
  updateActiveFrontmatterFieldValue(normalizeFrontmatterBoolean(field.value) === "true" ? "false" : "true");
}

function updateActiveFrontmatterFieldValue(value) {
  const field = state.activeFrontmatterField;
  if (!field || !state.sourceEditor) {
    return;
  }

  const nextLine = frontmatterLineForValue(field.key, value);
  if (!nextLine) {
    showCopyToast(t("frontmatter.invalidKey"));
    return;
  }
  const updated = state.sourceEditor.replaceLine(field.line, nextLine, { preserveSelection: true });
  if (!updated) {
    return;
  }

  state.activeFrontmatterField = {
    ...field,
    value: String(value ?? "").trim(),
    element: null,
  };
  recordTelemetryFeature("editing.frontmatter", { action: "edit", result: "success" });
  showCopyToast(t("frontmatter.updated"));
  window.requestAnimationFrame(() => {
    markActiveFrontmatterField();
    renderFrontmatterFieldPopover();
    positionFrontmatterFieldPopover();
  });
}

function deleteActiveFrontmatterField() {
  const field = state.activeFrontmatterField;
  if (!field || !state.sourceEditor) {
    return;
  }

  const deleted = state.sourceEditor.deleteLine(field.line);
  if (!deleted) {
    const source = state.sourceEditor.getValue();
    state.sourceEditor.replaceDocument(deleteFrontmatterLineFromSource(source, field.line));
  }
  clearActiveFrontmatterField();
  recordTelemetryFeature("editing.frontmatter", { action: "delete", result: "success" });
  showCopyToast(t("frontmatter.deleted"));
}

async function addFrontmatterField() {
  if (!state.sourceEditor || !state.currentDocument?.frontmatterProfile?.enabled) {
    return;
  }

  const source = state.sourceEditor.getValue();
  const existingKeys = new Set(frontmatterKeysFromSource(source));
  const fields = frontmatterProfileFields().filter((field) => !existingKeys.has(field.key));
  if (fields.length === 0) {
    showCopyToast(t("frontmatter.noneAvailable"));
    return;
  }

  const fieldResult = await showAppDialog({
    title: t("frontmatter.addTitle"),
    fields: [{
      id: "field",
      label: t("frontmatter.field"),
      value: fields[0].key,
      options: fields.map((field) => ({ label: field.key, value: field.key })),
    }],
    confirmText: t("action.next"),
    cancelText: t("action.cancel"),
  });
  if (!fieldResult.confirmed) {
    return;
  }

  const definition = frontmatterFieldDefinition(fieldResult.values.field);
  const valueResult = await showAppDialog({
    title: t("frontmatter.setTitle", { key: definition.key }),
    fields: [dialogFieldForFrontmatterValue(definition, defaultFrontmatterValue(definition))],
    confirmText: t("action.add"),
    cancelText: t("action.cancel"),
  });
  if (!valueResult.confirmed) {
    return;
  }

  const nextSource = addFrontmatterFieldToSource(source, definition.key, valueResult.values.value);
  state.sourceEditor.replaceDocument(nextSource);
  clearActiveFrontmatterField();
  recordTelemetryFeature("editing.frontmatter", { action: "add", result: "success" });
  showCopyToast(t("frontmatter.added"));
}

function frontmatterProfileFields() {
  const profile = state.currentDocument?.frontmatterProfile;
  return profile?.enabled && Array.isArray(profile.fields) ? profile.fields : [];
}

function frontmatterFieldDefinition(key) {
  return frontmatterProfileFields().find((field) => field.key === key) ?? {
    key,
    type: "text",
    values: [],
    inferredValue: "",
  };
}

function dialogFieldForFrontmatterValue(definition, value) {
  const currentValue = frontmatterEditorValue(value);
  const options = frontmatterFieldOptionValues(definition);
  if (currentValue && options.length > 0 && !options.includes(currentValue)) {
    options.unshift(currentValue);
  }
  return {
    id: "value",
    label: definition.key,
    value: currentValue,
    placeholder: definition.type === "date" ? "YYYY-MM-DD" : "",
    options: options.map((item) => ({ label: item, value: item })),
  };
}

function defaultFrontmatterValue(definition) {
  if (definition.inferredValue) {
    return definition.inferredValue;
  }
  if (definition.type === "date") {
    return todayIsoDate();
  }
  const values = frontmatterFieldOptionValues(definition);
  if (values.length > 0) {
    return values[0];
  }
  return "";
}

function normalizeFrontmatterBoolean(value) {
  return String(value ?? "").trim().toLowerCase() === "true" ? "true" : "false";
}

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function handleLinkPopoverClick(event) {
  event.stopPropagation();
  const button = event.target.closest?.("[data-link-action]");
  if (!button || !state.activeLink) {
    return;
  }

  const action = button.dataset.linkAction;
  if (action === "close") {
    clearActiveLink();
    return;
  }
  if (action === "edit") {
    await editActiveLiveLink();
    return;
  }

  if (action === "open" || action === "open-tab") {
    await openActiveLiveLink({ newTab: action === "open-tab" });
  }
}

async function editActiveLiveLink() {
  const link = state.activeLink;
  if (!link || !canEditCurrentDocument()) {
    return;
  }

  const source = state.sourceEditor?.getValue() ?? state.currentDocument?.source ?? "";
  const lines = source.split(/\r?\n/);
  const currentLine = lines[link.line - 1] ?? "";
  const result = await showLinkFieldsDialog({
    title: t("link.editTitle"),
    message: t("link.editHelp"),
    titleValue: link.text,
    linkValue: link.href,
    linkPlaceholder: t("link.placeholder"),
    confirmText: t("link.save"),
  });
  if (!result.confirmed) {
    return;
  }

  const nextMarkdown = await markdownFromLinkFields(result.values);
  const nextLink = parseMarkdownLink(nextMarkdown);
  if (!nextMarkdown || !nextLink) {
    return;
  }

  const nextLine = [
    currentLine.slice(0, link.from),
    nextMarkdown,
    currentLine.slice(link.to),
  ].join("");
  const updated = state.sourceEditor.replaceLine(link.line, nextLine, { preserveSelection: true });
  if (!updated) {
    return;
  }

  state.activeLink = {
    ...link,
    to: link.from + nextMarkdown.length,
    text: nextLink.text,
    href: nextLink.href,
    element: null,
  };
  showCopyToast(t("link.updated"));
  window.requestAnimationFrame(() => {
    markActiveLink();
    positionLinkPopover();
  });
}

async function markdownFromLinkFields(values = {}) {
  const href = String(values.link ?? "").trim();
  if (!href) {
    showCopyToast(t("link.empty"));
    return "";
  }

  if (isOpenGlanceDocumentUrl(href) || looksLikeMarkdownDocumentHref(href)) {
    return documentLinkMarkdown(href, values.title);
  }
  return externalLinkMarkdownFromFields(values.title, href);
}

async function openActiveLiveLink({ newTab = false } = {}) {
  const href = state.activeLink?.href;
  if (!href) {
    return;
  }

  const documentTarget = await liveDocumentTargetFromHref(href);
  if (documentTarget) {
    await navigateDocumentLocation(documentTarget, {
      behavior: newTab ? "foreground" : "current",
    });
    return;
  }

  const url = browserHrefFromLink(href);
  if (newTab) {
    window.open(url, "_blank", "noopener");
    return;
  }
  window.location.href = url;
}

async function liveDocumentTargetFromHref(href) {
  const directTarget = openGlanceDocumentTargetFromHref(href);
  if (directTarget) {
    return directTarget;
  }
  if (!looksLikeMarkdownDocumentHref(href) || !state.currentDocument?.path) {
    return null;
  }

  try {
    const response = await fetch(apiUrl("/api/link-target", {
      file: state.currentDocument.path,
      target: href,
      targetFormat: "markdown",
      locale: state.locale,
    }));
    const payload = await response.json().catch(() => ({ error: t("error.openTargetDocument") }));
    if (!response.ok || !payload.path) {
      throw new Error(payload.error || t("error.openTargetDocument"));
    }
    return {
      repo: payload.repo || state.currentRepo,
      file: payload.path,
      hash: hashFromHref(payload.href || href),
    };
  } catch (error) {
    showCopyToast(error instanceof Error ? error.message : t("error.openTargetDocument"));
    return null;
  }
}

function parseMarkdownLink(value) {
  const markdown = String(value ?? "").trim();
  const match = /^\[([^\]\n]+)\]\(([^)\n]+)\)$/.exec(markdown);
  if (!match) {
    return null;
  }

  return {
    markdown,
    text: match[1],
    href: match[2].trim(),
  };
}

function openGlanceDocumentTargetFromHref(href) {
  try {
    const url = new URL(String(href ?? "").trim(), window.location.origin);
    const file = url.searchParams.get("file") ?? "";
    if (!/^https?:$/i.test(url.protocol) || url.pathname !== "/" || !/\.mdx?$/i.test(file)) {
      return null;
    }
    if (url.origin !== window.location.origin && !url.searchParams.has("repo")) {
      return null;
    }
    return {
      repo: url.searchParams.get("repo") || state.currentRepo,
      file,
      hash: url.hash,
    };
  } catch {
    return null;
  }
}

function looksLikeMarkdownDocumentHref(href) {
  const value = String(href ?? "").trim();
  if (!value) {
    return false;
  }
  if (openGlanceDocumentTargetFromHref(value)) {
    return true;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return false;
  }
  return /\.mdx?(?:[?#].*)?$/i.test(value.split(/[?#]/)[0]);
}

function browserHrefFromLink(href) {
  return new URL(String(href ?? "").trim(), window.location.href).href;
}

function hashFromHref(href) {
  try {
    return new URL(String(href ?? ""), window.location.origin).hash || "";
  } catch {
    const match = /#[^#]*$/.exec(String(href ?? ""));
    return match?.[0] ?? "";
  }
}

async function handleImagePopoverClick(event) {
  event.stopPropagation();
  const button = event.target.closest?.("[data-image-action]");
  if (!button || !state.activeImage) {
    return;
  }

  const line = state.activeImage.line;
  const source = state.sourceEditor?.getValue() ?? state.currentDocument?.source ?? "";
  const lines = source.split(/\r?\n/);
  const currentLine = lines[line - 1] ?? "";
  const action = button.dataset.imageAction;
  if (action === "close") {
    clearActiveImage();
    return;
  }
  const options = {};
  if (action === "caption") {
    const currentCaption = imageLineAttributes(currentLine)?.["data-caption"] ?? "";
    const { confirmed, value } = await showAppDialog({
      title: t("image.captionTitle"),
      message: t("image.captionHelp"),
      inputLabel: t("image.captionLabel"),
      inputValue: currentCaption,
      confirmText: t("image.saveCaption"),
      cancelText: t("action.cancel"),
    });
    if (!confirmed) {
      return;
    }
    options.caption = value;
  }

  const nextLine = imageLineForAction(currentLine, action, options);
  if (!nextLine || nextLine === currentLine) {
    return;
  }

  const updated = state.sourceEditor.replaceLine(line, nextLine, { preserveSelection: true });
  if (!updated) {
    return;
  }

  updateActiveImageElementFromLine(nextLine);
  showCopyToast(t("image.updated"));
  window.requestAnimationFrame(() => {
    markActiveImage();
    positionImagePopover();
  });
}

function updateActiveImageElementFromLine(lineText) {
  const image = activeImageElement();
  if (!image) {
    return;
  }

  const attributes = imageLineAttributes(lineText) ?? {};
  const align = normalizeImageAlign(attributes["data-align"]);
  const width = normalizeImageWidth(attributes.width);
  const caption = normalizeImageCaption(attributes["data-caption"]);
  const frame = image.closest(".git-leaf-image-frame");
  frame?.classList.toggle("is-align-center", align === "center");
  frame?.classList.toggle("is-align-left", align !== "center");
  frame?.setAttribute("data-image-align", align);
  image.dataset.imageAlign = align;
  if (caption) {
    image.dataset.imageCaption = caption;
  } else {
    delete image.dataset.imageCaption;
  }
  if (width) {
    image.setAttribute("width", String(width));
  }
  updateImageCaption(frame, caption);
}

function updateImageCaption(frame, caption) {
  if (!frame) {
    return;
  }

  let captionElement = frame.querySelector(".git-leaf-image-caption");
  if (!caption) {
    captionElement?.remove();
    return;
  }

  if (!captionElement) {
    captionElement = document.createElement(frame.tagName === "FIGURE" ? "figcaption" : "span");
    captionElement.className = "git-leaf-image-caption";
    frame.append(captionElement);
  }
  captionElement.textContent = caption;
}

function positionSelectionPopover() {
  if (!state.currentDocument || state.selectedLines.size === 0) {
    selectionPopover.hidden = true;
    return;
  }

  const selected = [...state.selectedLines].sort((left, right) => left - right);
  const anchorLine = selected.at(-1);
  const sourceAnchorRect = isEditorMode()
    ? state.sourceEditor?.lineRect(anchorLine)
    : null;
  const previewAnchor = sourceAnchorRect
    ? null
    : sourceLineButtonForLine(anchorLine);
  const anchorRect = sourceAnchorRect ?? previewAnchor?.getBoundingClientRect();
  if (!anchorRect) {
    selectionPopover.hidden = true;
    return;
  }

  selectionPopover.hidden = false;
  const paneRect = document.querySelector(".preview-pane").getBoundingClientRect();
  const popoverWidth = selectionPopover.offsetWidth;
  const left = Math.max(anchorRect.left - paneRect.left - 8, popoverWidth + 8);
  selectionPopover.style.left = `${left}px`;
  selectionPopover.style.top = `${anchorRect.top - paneRect.top + anchorRect.height / 2}px`;
}

function scheduleAnchoredSourceLineGutterSync() {
  if (state.anchoredSourceLineGutterFrame) {
    return;
  }

  state.anchoredSourceLineGutterFrame = window.requestAnimationFrame(() => {
    state.anchoredSourceLineGutterFrame = null;
    syncAnchoredSourceLineGutters();
  });
}

function syncAnchoredSourceLineGutters() {
  const gutters = documentContent.querySelectorAll([
    '.source-line-gutter[data-source-line-layout="list"]',
    '.source-line-gutter[data-source-line-layout="table"]',
    '.source-line-gutter[data-source-line-layout="code"]',
  ].join(","));
  for (const gutter of gutters) {
    const block = gutter.closest(".source-block");
    const blockRect = block?.getBoundingClientRect();
    if (!blockRect) {
      continue;
    }

    const layout = gutter.dataset.sourceLineLayout;
    const anchorAttribute = layout === "table"
      ? "data-source-table-line"
      : (layout === "code" ? "data-source-code-line" : "data-source-list-line");
    for (const button of gutter.querySelectorAll("[data-source-line]")) {
      const line = button.dataset.sourceLine;
      const anchor = block.querySelector(`[${anchorAttribute}="${line}"]`);
      const anchorRect = anchor?.getBoundingClientRect();
      if (!anchorRect) {
        continue;
      }

      const buttonRect = button.getBoundingClientRect();
      const centerOffset = layout === "code"
        ? (anchorRect.height - buttonRect.height) / 2
        : 0;
      const top = Math.max(0, anchorRect.top - blockRect.top + centerOffset);
      button.style.setProperty("--source-line-top", `${top}px`);
    }
  }
}

function showCopyToast(message) {
  if (!copyToast) {
    return;
  }

  copyToast.textContent = message;
  copyToast.hidden = false;
  window.clearTimeout(state.copyToastTimer);
  state.copyToastTimer = window.setTimeout(() => {
    copyToast.hidden = true;
  }, 7000);
}

function lineFromDocumentGutterPoint(event) {
  return lineFromGutterPoint({
    x: event.clientX,
    y: event.clientY,
    buttonRects: [...documentContent.querySelectorAll("[data-source-line]")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        line: Number(button.dataset.sourceLine),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  });
}

function isInteractiveClick(event) {
  return Boolean(event.target.closest?.("a, button, input, textarea, select, label, summary"));
}

function sourceLineButtonForLine(line) {
  if (!Number.isInteger(line)) {
    return null;
  }
  for (const button of documentContent.querySelectorAll("[data-source-line]")) {
    const start = Number(button.dataset.sourceLine);
    const end = Number(button.dataset.sourceEnd ?? start);
    if (line >= start && line <= end) {
      return button;
    }
  }
  return null;
}

function frontmatterFilterCountBucket(count) {
  if (count <= 1) return "1";
  if (count <= 3) return "2_3";
  return "4_plus";
}

function itemCountBucket(count) {
  if (count <= 1) return "1";
  if (count <= 5) return "2_5";
  if (count <= 20) return "6_20";
  return "21_plus";
}

function durationBucket(durationMs) {
  if (durationMs < 1000) return "under_1s";
  if (durationMs < 3000) return "1_3s";
  if (durationMs < 10_000) return "3_10s";
  return "over_10s";
}

function retryCountBucket(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value === 1) return "1";
  return "2_plus";
}

function gitSyncDriftKind(value) {
  return ["content_changed", "head_changed", "post_commit_changed"].includes(value)
    ? value
    : "none";
}

function lineCountBucket(count) {
  if (count <= 1) return "1";
  if (count <= 5) return "2_5";
  return "6_plus";
}

function gitSyncTelemetryErrorCode(step) {
  const value = String(step ?? "").toLowerCase();
  if (value.includes("identity")) return "identity_missing";
  if (value.includes("origin")) return "origin_missing";
  if (value.includes("conflict")) return "conflict";
  if (value.includes("commit")) return "commit_failed";
  if (value.includes("workspace changed")) return "workspace_changed";
  if (value.includes("head changed")) return "head_changed";
  if (value.includes("pull")) return "pull_failed";
  if (value.includes("push")) return "push_failed";
  return "unknown";
}

function recordSlashCommandTelemetry(command) {
  recordTelemetryFeature("editing.slash_command", {
    command_category: command?.requiresMdx ? "mdx_component" : "markdown",
  });
}

function tableToCsv(table) {
  const rows = [...table.querySelectorAll("tr")];
  return rows
    .map((row) =>
      [...row.children]
        .map((cell) => `"${cell.textContent.replaceAll('"', '""').trim()}"`)
        .join(","),
    )
    .join("\n");
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Finder- or automation-focused Electron windows can reject the async
      // clipboard API even though the document can still perform a copy.
    }
  }

  if (copyWithTextarea(value)) {
    return;
  }

  throw new Error("Clipboard write failed");
}

async function writeRichLinkClipboard(value, label) {
  const text = String(value ?? "");
  const normalizedLabel = String(label ?? "").trim() || text;
  const html = `<a href="${escapeHtml(text)}">${escapeHtml(normalizedLabel)}</a>`;

  if (navigator.clipboard?.write && typeof ClipboardItem === "function") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some Electron focus states reject the async rich clipboard API. The
      // synchronous copy event below can still provide both representations.
    }
  }

  if (copyRichLinkWithTextarea(text, html)) {
    return;
  }

  // Keep sharing usable in clients that only allow plain-text clipboard writes.
  await writeClipboard(text);
}

function shareLinkClipboardTitle(value, fallbackPath = "") {
  try {
    const title = new URL(String(value ?? "")).searchParams.get("title")?.trim();
    if (title) {
      return title;
    }
  } catch {
    // Fall back to the repository-relative file name for malformed legacy URLs.
  }

  return String(fallbackPath).split("/").at(-1)?.trim() || t("document.fallbackTitle");
}

function copyWithTextarea(value) {
  return copyWithTextareaData(value);
}

function copyRichLinkWithTextarea(value, html) {
  return copyWithTextareaData(value, html);
}

function copyWithTextareaData(value, html = "") {
  const text = String(value ?? "");
  const handleCopy = (event) => {
    event.clipboardData?.setData("text/plain", text);
    if (html) {
      event.clipboardData?.setData("text/html", html);
    }
    event.preventDefault();
  };
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  document.addEventListener("copy", handleCopy);
  textarea.focus({ preventScroll: true });
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", handleCopy);
    textarea.remove();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&");
}
