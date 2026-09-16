import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  shell,
  systemPreferences,
  WebContentsView,
} from "electron";
import { access, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { openGlanceEnvironmentValue } from "../environment.mjs";
import { OPENGLANCE_SUPPORTED_PROTOCOLS } from "../product-identity.mjs";
import { createDesktopUpdateController } from "./updates.mjs";
import { startMacAppNameMigration } from "./mac-app-name-migration.mjs";
import { configureMacUpdateInstallation } from "./mac-update-installation.mjs";
import {
  macShipItJobLabelForBuildInfo,
  prepareMacUpdateAppPath,
} from "./mac-update-cache.mjs";
import {
  launchMacDevelopmentHandoffUpdate,
  macAppBundlePathFromExecutable,
  prepareMacDevelopmentHandoffUpdate,
} from "./mac-development-handoff-update.mjs";
import { createSettingsCenterController } from "./settings-center.mjs";
import {
  createDesktopTranslatorForLanguage,
  desktopPreferencesForRenderer,
  preferredSystemLanguages,
  translatedFileCount,
} from "./localization.mjs";
import {
  createApplicationTranslator,
  localizedAboutPanelCopyright,
  localizeDesktopHomeError,
  windowsStartMenuShortcutOptions,
} from "./main-localization.mjs";
import { saveAndSyncDesktopPreferences } from "./preference-sync.mjs";
import { createUpdateCheckScheduler } from "./update-check-schedule.mjs";
import { completeDesktopShutdown } from "./shutdown.mjs";
import { parseDesktopArgs } from "./args.mjs";
import { desktopSecondInstanceAction } from "./instance-routing.mjs";
import {
  appDisplayName,
  BUILD_INFO,
  buildDistributionLabel,
  releaseDateLabel,
} from "../build-info.mjs";
import {
  closeDesktopRepository,
  mutateDesktopRepositoryFavorites,
  readDesktopConfig,
  reorderDesktopRepositories,
  saveDesktopDevelopmentHandoff,
  saveDesktopPreferences,
  saveDesktopRepository,
  saveDesktopUsageAnalyticsEnabled,
  saveDesktopWindowState,
} from "./config.mjs";
import { desktopUpdatesEnabled } from "./development-handoff.mjs";
import { sidebarFavoritesForScope } from "../../public/sidebar-favorites.js";
import {
  REPOSITORY_PANEL_CLOSE_URL,
  REPOSITORY_PANEL_REMOVE_URL,
  REPOSITORY_PANEL_REORDER_URL,
  REPOSITORY_PANEL_SHOW_URL,
  REPOSITORY_PANEL_SWITCH_URL,
} from "../../public/repository-panel.js";
import {
  desktopHomeHtml,
  desktopPageBackgroundColor,
  desktopProgressHtml,
  DESKTOP_OPEN_REPOSITORY_URL,
  DESKTOP_OPEN_WORKTREE_URL,
} from "./home.mjs";
import { classifyDesktopNavigation, openActiveWorkbenchDocument } from "./navigation.mjs";
import {
  loadWebContentsUrl,
  waitForWebContentsPaint,
} from "./paint.mjs";
import {
  repositorySelectionErrorMessage,
} from "./repository-errors.mjs";
import { startDesktopOpenGlanceServer } from "./server.mjs";
import { registerDesktopProtocols } from "./protocol-registration.mjs";
import {
  confirmOpenGlanceHandoff,
  reportOpenGlanceShareHandoffState,
  writeDesktopDeepLinkLog,
} from "./handoff.mjs";
import { initializeDesktopCommandEnvironment } from "./command-environment.mjs";
import { desktopEnvironmentChecks } from "./git-environment.mjs";
import {
  applyDevelopmentUserDataOverride,
  applyStableUserDataPath,
} from "./user-data.mjs";
import {
  fastForwardSharedMain,
  inspectSharedMain,
  inspectSharedMainWithFetchRecovery,
  sharedFetchFailurePrompt,
  sharedMainWorktree,
} from "../server/git-share-open.mjs";
import { syncSelectedFiles } from "../server/git-sync.mjs";
import { listGitWorktrees } from "../server/git-worktrees.mjs";
import { findRepoRoot } from "../server/paths.mjs";
import { findGithubRepositoryRoot } from "../server/repositories.mjs";
import {
  adjacentRepository,
  repositoryAfterClose,
  repositoryAtIndex,
} from "./repository-navigation.mjs";
import {
  desktopRepositoryPanelItems,
  desktopRepositoryPanelShortcutFromInput,
  desktopRepositoryRootForPanelId,
  desktopRepositoryRootsForPanelOrder,
} from "./repository-panel.mjs";
import {
  bootstrapWindowsApp,
  cleanupLegacyWindowsInstallationAfterRename,
  confirmWindowsAppLaunch,
  windowsAppBootstrapPlan,
  windowsBootstrapNeedsExclusiveLock,
  windowsInstalledAppPaths,
} from "./windows-app-install.mjs";
import {
  cleanupWindowsUpdateCache,
  prepareWindowsAppUpdate,
  windowsPreparedUpdateLaunch,
} from "./windows-app-update.mjs";
import { windowsInstallProgressHtml } from "./windows-install-progress.mjs";
import {
  createTelemetryClient,
  isTelemetryEnabled,
  normalizeTelemetryAction,
} from "./telemetry.mjs";
import { createTelemetryActivityTracker } from "./telemetry-activity.mjs";
import {
  createTelemetryUploadScheduler,
  DEFAULT_TELEMETRY_SHUTDOWN_UPLOAD_TIMEOUT_MS,
} from "./telemetry-upload-scheduler.mjs";
import { initializeUsageAnalyticsSetting } from "./usage-analytics-setting.mjs";
import {
  getFileTypeHelpRows,
  getOpenGlanceHelpSections,
} from "../../public/help-content.js";
import {
  getKeyboardShortcutGroups,
  isKeyboardShortcutsHelpShortcut,
} from "../../public/keyboard-shortcuts.js";
import { isToggleFavoriteShortcut } from "../../public/sidebar-favorites.js";
import { sidebarTabFromShortcut } from "../../public/sidebar-navigation.js";

applyStableUserDataPath({ app });
const developmentUserData = applyDevelopmentUserDataOverride({ app });
configureMacUpdateInstallation({
  platform: process.platform,
  isPackaged: app.isPackaged,
  buildInfo: BUILD_INFO,
  systemPreferences,
});

let mainWindow = null;
let activeServer = null;
let updateController = null;
let updateCheckScheduler = null;
let settingsCenter = null;
let repositoryTransitionView = null;
let desktopUpdateStatus = { state: "idle" };
let isQuitting = false;
let isRepositoryTransitioning = false;
let isRepositoryPanelOpen = false;
let isDesktopReady = false;
let pendingDesktopOpenRequest = null;
let pendingDesktopOpenUrl = "";
let telemetryClient = null;
let telemetryActivityTracker = null;
let telemetryUploadScheduler = null;
let telemetryMode = "preview";
let usageAnalyticsEnabled = false;
let currentHomeErrorState = null;
const settingsShortcutBridges = new WeakSet();
let desktopRepositoryState = {
  openRepoRoots: [],
};
const DESKTOP_OPEN_REPOSITORY_ACTION = new URL(DESKTOP_OPEN_REPOSITORY_URL);
const DESKTOP_OPEN_WORKTREE_ACTION = new URL(DESKTOP_OPEN_WORKTREE_URL);
const DESKTOP_INSTALL_UPDATE_ACTION = new URL("openglance://install-update");
const DESKTOP_SHOW_REPOSITORIES_ACTION = new URL(REPOSITORY_PANEL_SHOW_URL);
const DESKTOP_CLOSE_REPOSITORIES_ACTION = new URL(REPOSITORY_PANEL_CLOSE_URL);
const DESKTOP_SWITCH_REPOSITORY_ACTION = new URL(REPOSITORY_PANEL_SWITCH_URL);
const DESKTOP_REMOVE_REPOSITORY_ACTION = new URL(REPOSITORY_PANEL_REMOVE_URL);
const DESKTOP_REORDER_REPOSITORIES_ACTION = new URL(REPOSITORY_PANEL_REORDER_URL);
const APP_DISPLAY_NAME = appDisplayName(BUILD_INFO);
const DESKTOP_UPDATES_ENABLED = desktopUpdatesEnabled({
  buildInfo: BUILD_INFO,
  isPackaged: app.isPackaged,
  platform: process.platform,
  arch: process.arch,
});
const windowsBootstrap = prepareWindowsAppInstall();
const manualWindowsBootstrapNeedsLock = windowsBootstrapNeedsExclusiveLock(windowsBootstrap);
const hasSingleInstanceLock = windowsBootstrap.status === "current" || manualWindowsBootstrapNeedsLock
  ? app.requestSingleInstanceLock()
  : false;
const manualWindowsBootstrapBlocked = manualWindowsBootstrapNeedsLock && !hasSingleInstanceLock;
let manualWindowsBootstrapLockReleased = false;
const MAC_WINDOW_CHROME_OPTIONS = process.platform === "darwin"
  ? {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 13 },
    }
  : {};
const DEFAULT_WINDOW_BOUNDS = {
  width: 1280,
  height: 860,
};
// Telemetry's stable-release eligibility is independent from the App update feed.
// Internal builds update from internal-stable but remain formal stable builds.
const TELEMETRY_RELEASE_TIER = "stable";
const TELEMETRY_CHANNEL = "stable";

function currentDesktopTranslator() {
  return createApplicationTranslator(desktopRepositoryState.preferences ?? {}, { app });
}

function desktopText(key, values = {}) {
  return currentDesktopTranslator()(key, values);
}

function preferencesForRenderer(preferences = desktopRepositoryState.preferences ?? {}) {
  return desktopPreferencesForRenderer(preferences, { app });
}

if (windowsBootstrap.status === "current") {
  registerDesktopProtocols({ app, isolatedUserData: developmentUserData.applied });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const request = parseDesktopArgs([url]);
    if (!isDesktopReady) {
      pendingDesktopOpenRequest = request;
      pendingDesktopOpenUrl = url;
      return;
    }
    void openDesktopRequest(request);
  });
}

function prepareWindowsAppInstall() {
  try {
    return windowsAppBootstrapPlan({
      isPackaged: app.isPackaged,
      version: app.getVersion(),
    });
  } catch (error) {
    return {
      status: "error",
      error,
    };
  }
}

async function runWindowsAppInstall(plan) {
  const language = currentDesktopTranslator().locale;
  const progressWindow = new BrowserWindow({
    width: 520,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    frame: false,
    show: false,
    center: true,
    backgroundColor: "#f8fafc",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await progressWindow.loadURL(htmlDataUrl(windowsInstallProgressHtml({
    version: plan.version,
    mode: plan.status,
    language,
  })));
  progressWindow.show();
  progressWindow.setProgressBar(0.03);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const updateProgress = async (state) => {
    if (progressWindow.isDestroyed()) {
      return;
    }
    progressWindow.setProgressBar(state.percent / 100);
    await progressWindow.webContents.executeJavaScript(
      `window.updateInstallProgress(${JSON.stringify(state)})`,
    );
  };

  try {
    await bootstrapWindowsApp({
      plan,
      language,
      onProgress: updateProgress,
      beforeRelaunch: releaseManualWindowsBootstrapLock,
    });
    app.exit(0);
  } catch (error) {
    const failure = windowsInstallFailureCopy(plan, error);
    await updateProgress({
      phase: "error",
      percent: 100,
      title: desktopText("windows.updateFailedTitle"),
      message: failure.message,
      detail: failure.detail,
      stage: desktopText("windows.updateFailedStage"),
    });
    progressWindow.setProgressBar(-1);
    await dialog.showMessageBox(progressWindow, {
      type: "error",
      buttons: [desktopText("dialog.close")],
      defaultId: 0,
      message: desktopText("windows.updateFailed"),
      detail: [
        failure.message,
        failure.detail,
        error instanceof Error ? error.message : String(error),
      ].join("\n\n"),
    });
    app.exit(1);
  }
}

function windowsInstallFailureCopy(plan, error) {
  if (error?.code === "WINDOWS_INSTALL_RECOVERY_REQUIRED") {
    return {
      message: desktopText("windows.switchFailed"),
      detail: desktopText("windows.backupPreserved", { path: plan.previousRoot }),
    };
  }
  if (plan.status === "install") {
    return {
      message: desktopText("windows.installIncomplete"),
      detail: desktopText("windows.noPreviousInstall"),
    };
  }
  return {
    message: plan.waitForPid
      ? desktopText("windows.restoredStartMenu")
      : desktopText("windows.restoredPortable"),
    detail: desktopText("windows.previousAvailable"),
  };
}

async function releaseManualWindowsBootstrapLock() {
  if (!manualWindowsBootstrapNeedsLock || manualWindowsBootstrapLockReleased) {
    return;
  }
  app.releaseSingleInstanceLock();
  manualWindowsBootstrapLockReleased = true;
}

function installWindowsStartMenuShortcut() {
  if (process.platform !== "win32" || !app.isPackaged || !process.env.LOCALAPPDATA) {
    return;
  }
  const { shortcut } = windowsInstalledAppPaths({
    localAppData: process.env.LOCALAPPDATA,
    roamingAppData: process.env.APPDATA,
  });
  try {
    shell.writeShortcutLink(
      shortcut,
      windowsStartMenuShortcutOptions(
        process.execPath,
        desktopRepositoryState.preferences ?? {},
        { app },
      ),
    );
  } catch {
    // A missing Start Menu shortcut must not prevent OpenGlance from opening.
  }
}

function scheduleWindowsUpdateCacheCleanup() {
  if (process.platform !== "win32" || !app.isPackaged || !process.env.LOCALAPPDATA) {
    return;
  }
  setTimeout(() => {
    void cleanupWindowsUpdateCache({
      localAppData: process.env.LOCALAPPDATA,
      currentVersion: app.getVersion(),
    });
    void cleanupLegacyWindowsInstallationAfterRename({
      isPackaged: app.isPackaged,
    });
  }, 10_000).unref?.();
}

function userDataDir() {
  return app.getPath("userData");
}

async function initializeDesktopTelemetry() {
  try {
    const setting = await initializeUsageAnalyticsSetting({
      userDataDir: userDataDir(),
      buildInfo: BUILD_INFO,
      currentConfig: desktopRepositoryState,
      saveEnabled: (enabled) => saveDesktopUsageAnalyticsEnabled({
        userDataDir: userDataDir(),
        enabled,
        repoRoot: activeServer?.repoRoot ?? "",
      }),
    });
    usageAnalyticsEnabled = setting.enabled;
    desktopRepositoryState = setting.config;
    const enabled = isTelemetryEnabled({
      isPackaged: app.isPackaged,
      buildInfo: BUILD_INFO,
      usageAnalyticsEnabled,
      releaseTier: TELEMETRY_RELEASE_TIER,
      platform: process.platform,
      arch: process.arch,
    });
    telemetryClient = createTelemetryClient({
      enabled,
      userDataDir: userDataDir(),
      buildInfo: BUILD_INFO,
      channel: TELEMETRY_CHANNEL,
      ...(openGlanceEnvironmentValue(process.env, "TELEMETRY_ENDPOINT")
        ? { endpoint: openGlanceEnvironmentValue(process.env, "TELEMETRY_ENDPOINT") }
        : {}),
      platform: process.platform,
      arch: process.arch,
      osVersion: app.getSystemVersion?.() || os.release(),
      deviceName: os.hostname(),
    });
    const initialization = telemetryClient.initialize();
    telemetryClient.recordLaunch(initialTelemetryEntryKind());
    const initializedClient = telemetryClient;
    void initialization
      .then((initialized) => {
        if (!initialized || !initializedClient.enabled || telemetryClient !== initializedClient || isQuitting) return;
        telemetryUploadScheduler = createTelemetryUploadScheduler({
          telemetry: initializedClient,
          beforeQueueDailySummary: () => telemetryActivityTracker?.flush?.(),
        });
        telemetryUploadScheduler.start();
      })
      .catch(() => {
        // The client also fails closed internally; this is a final startup guard.
      });
  } catch {
    // Usage analytics is strictly best-effort and must never block App startup.
    telemetryClient = null;
    usageAnalyticsEnabled = false;
  }
}

function initialTelemetryEntryKind() {
  if (process.argv.some((argument) => [
    "--openglance-install-confirm=",
    "--git-leaf-install-confirm=",
  ].some((prefix) => String(argument).startsWith(prefix)))) {
    return "windows_bootstrap";
  }
  return process.argv.some((argument) => OPENGLANCE_SUPPORTED_PROTOCOLS.some(
    (protocol) => String(argument).startsWith(`${protocol}://`),
  ))
    ? "deep_link"
    : "manual";
}

function startDesktopTelemetryRuntime() {
  if (!telemetryClient?.enabled || !mainWindow) {
    return;
  }
  telemetryActivityTracker = createTelemetryActivityTracker({
    browserWindow: mainWindow,
    powerMonitor,
    telemetry: telemetryClient,
    getMode: () => telemetryMode,
    isQuitting: () => isQuitting,
    isUpdating: () => isQuitting && Boolean(updateController?.hasPendingUpdateOnQuit?.()),
  });
  telemetryActivityTracker.start();
}

async function recordDesktopTelemetryActions(actions) {
  if (!telemetryClient?.enabled || !Array.isArray(actions)) {
    return 0;
  }
  const normalized = actions.map(normalizeTelemetryAction);
  if (normalized.some((action) => !action)) {
    return 0;
  }
  for (const action of normalized) {
    if (action.kind === "mode") {
      telemetryActivityTracker?.setMode?.(action.mode);
      telemetryMode = action.mode;
    } else {
      telemetryClient.recordFeature(action.featureId, action.dimensions);
    }
  }
  return normalized.length;
}

function recordTelemetryFeature(featureId, dimensions = {}) {
  return telemetryClient?.recordFeature(featureId, dimensions) ?? false;
}

async function recordTelemetryUpdateState(update) {
  try {
    const recorded = telemetryClient?.recordUpdateState(update) ?? false;
    if (recorded) {
      await telemetryClient?.checkpoint();
    }
    return recorded;
  } catch {
    return false;
  }
}

async function saveDesktopPreferenceValues(preferences, { notifyRenderer = true } = {}) {
  const previousLanguage = currentDesktopTranslator().locale;
  const saved = await saveAndSyncDesktopPreferences({
    preferences,
    persistPreferences: (nextPreferences) => saveDesktopPreferences({
      userDataDir: userDataDir(),
      preferences: nextPreferences,
      repoRoot: activeServer?.repoRoot ?? "",
    }),
    updateServerPreferences: (nextPreferences) => {
      activeServer?.updateDesktopPreferences?.(preferencesForRenderer(nextPreferences));
    },
    sendRendererPreferences: (nextPreferences) => sendRendererEvent(
      "git-leaf-desktop-preferences",
      preferencesForRenderer(nextPreferences),
    ),
    notifyRenderer,
  });
  desktopRepositoryState = saved.state;
  const nextLanguage = currentDesktopTranslator().locale;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(desktopPageBackgroundColor(
      desktopRepositoryState.preferences ?? {},
      { systemDark: nativeTheme.shouldUseDarkColors },
    ));
  }
  if (previousLanguage !== nextLanguage) {
    const localizedUpdateMessage = desktopUpdateStatusMessage(
      { ...desktopUpdateStatus, message: "" },
      nextLanguage,
    );
    if (localizedUpdateMessage) {
      desktopUpdateStatus = {
        ...desktopUpdateStatus,
        message: localizedUpdateMessage,
      };
    }
    installAboutPanelOptions();
    installWindowsStartMenuShortcut();
    installMenu();
    if (!activeServer && !isRepositoryTransitioning) {
      await reloadDesktopHomeForLanguage();
    }
  }
  return saved.preferences;
}

async function saveDesktopPreferenceValuesFromRenderer(preferences) {
  return preferencesForRenderer(
    await saveDesktopPreferenceValues(preferences, { notifyRenderer: false }),
  );
}

function repositoryFavoritesForRenderer(repositoryRoot) {
  return sidebarFavoritesForScope(
    desktopRepositoryState.repositoryFavorites,
    repositoryRoot,
  );
}

async function mutateRepositoryFavoriteForRenderer({ repositoryRoot, operation }) {
  desktopRepositoryState = await mutateDesktopRepositoryFavorites({
    userDataDir: userDataDir(),
    repositoryRoot,
    operation,
    repoRoot: activeServer?.repoRoot ?? "",
  });
  return repositoryFavoritesForRenderer(repositoryRoot);
}

async function loadDesktopRepositoryState() {
  desktopRepositoryState = await readDesktopConfig({
    userDataDir: userDataDir(),
  });
}

async function createMainWindow() {
  const windowOptions = windowOptionsFromDesktopState(desktopRepositoryState.windowState);
  mainWindow = new BrowserWindow({
    ...windowOptions,
    minWidth: 980,
    minHeight: 640,
    title: APP_DISPLAY_NAME,
    backgroundColor: desktopPageBackgroundColor(
      desktopRepositoryState.preferences ?? {},
      { systemDark: nativeTheme.shouldUseDarkColors },
    ),
    ...MAC_WINDOW_CHROME_OPTIONS,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  restoreDesktopWindowState(mainWindow, desktopRepositoryState.windowState);
  installDesktopShortcutBridge(mainWindow);
  installSettingsCenterController(mainWindow);
  mainWindow.on("resize", () => {
    resizeRepositoryTransitionView(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isDesktopActionUrl(url)) {
      void handleDesktopAction(url);
      return { action: "deny" };
    }

    handleDesktopNavigation(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isDesktopActionUrl(url)) {
      event.preventDefault();
      void handleDesktopAction(url);
      return;
    }

    const action = classifyDesktopNavigation({
      currentUrl: mainWindow?.webContents.getURL() ?? "",
      targetUrl: url,
    });
    if (action === "internal") {
      return;
    }

    event.preventDefault();
    handleDesktopNavigation(url);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    isRepositoryPanelOpen = false;
    void syncDesktopUpdateStatus();
  });
  mainWindow.on("focus", () => {
    void updateCheckScheduler?.onActivate();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    void quitAfterClosingServer();
  });

  mainWindow.on("closed", () => {
    hideRepositoryTransitionView(mainWindow);
    settingsCenter?.destroy();
    settingsCenter = null;
    mainWindow = null;
  });
}

function installSettingsCenterController(browserWindow) {
  settingsCenter?.destroy();
  settingsCenter = createSettingsCenterController({
    mainWindow: browserWindow,
    WebContentsView,
    ipcMain,
    shell,
    getPreferences: async () => desktopRepositoryState.preferences ?? {},
    savePreferences: saveDesktopPreferenceValues,
    getStatus: settingsCenterStatus,
    getContent: async (resolvedLanguage) => ({
      helpSections: settingsCenterHelpSections(resolvedLanguage),
      shortcutGroups: getKeyboardShortcutGroups(resolvedLanguage),
    }),
    getSystemDark: () => nativeTheme.shouldUseDarkColors,
    getSystemLanguages: () => preferredSystemLanguages(app),
    checkForUpdates: async () => {
      await updateCheckScheduler?.checkManually();
      return desktopUpdateStatus;
    },
  });
  browserWindow.on("resize", () => {
    settingsCenter?.resize();
  });
}

async function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }
  await createMainWindow();
}

function windowOptionsFromDesktopState(windowState) {
  const bounds = windowState?.bounds ?? {};
  return {
    width: bounds.width ?? DEFAULT_WINDOW_BOUNDS.width,
    height: bounds.height ?? DEFAULT_WINDOW_BOUNDS.height,
    ...(Number.isFinite(bounds.x) ? { x: bounds.x } : {}),
    ...(Number.isFinite(bounds.y) ? { y: bounds.y } : {}),
  };
}

function restoreDesktopWindowState(browserWindow, windowState) {
  if (windowState?.isFullScreen) {
    browserWindow.setFullScreen(true);
    return;
  }

  if (windowState?.isMaximized) {
    browserWindow.maximize();
  }
}

async function saveCurrentWindowState({ repoRoot = activeServer?.repoRoot ?? "" } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  try {
    desktopRepositoryState = await saveDesktopWindowState({
      userDataDir: userDataDir(),
      windowState: windowStateFromBrowserWindow(mainWindow),
      repoRoot,
    });
  } catch {
    // Do not block quit when the preference file cannot be updated.
  }
}

function windowStateFromBrowserWindow(browserWindow) {
  const bounds = browserWindow.isMaximized() && typeof browserWindow.getNormalBounds === "function"
    ? browserWindow.getNormalBounds()
    : browserWindow.getBounds();

  return {
    bounds: {
      ...(Number.isFinite(bounds.x) ? { x: bounds.x } : {}),
      ...(Number.isFinite(bounds.y) ? { y: bounds.y } : {}),
      width: bounds.width,
      height: bounds.height,
    },
    isMaximized: browserWindow.isMaximized(),
    ...(browserWindow.isFullScreen?.() ? { isFullScreen: true } : {}),
  };
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function installAboutPanelOptions() {
  if (typeof app.setAboutPanelOptions !== "function") {
    return;
  }

  const aboutCopyright = localizedAboutPanelCopyright(
    BUILD_INFO,
    desktopRepositoryState.preferences ?? {},
    { app },
  );
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: BUILD_INFO.version,
    version: "",
    copyright: aboutCopyright,
  });
}

function installUpdateController() {
  updateController = createDesktopUpdateController({
    app,
    autoUpdater,
    buildInfo: BUILD_INFO,
    dialog,
    shell,
    showUpdateStatus: showDesktopUpdateStatus,
    getUpdatePreferences: () => desktopRepositoryState.preferences ?? {},
    saveUpdatePreferences: saveDesktopPreferenceValues,
    getDevelopmentHandoff: () => (
      desktopRepositoryState.developmentHandoff ?? null
    ),
    saveDevelopmentHandoff: async (handoff) => {
      desktopRepositoryState = await saveDesktopDevelopmentHandoff({
        userDataDir: userDataDir(),
        handoff,
        repoRoot: activeServer?.repoRoot ?? "",
      });
      return desktopRepositoryState.developmentHandoff;
    },
    prepareDevelopmentHandoffUpdate: ({ manifest, handoff }) => (
      prepareMacDevelopmentHandoffUpdate({
        manifest,
        handoff,
        userDataDir: userDataDir(),
        targetAppPath: macAppBundlePathFromExecutable(),
        launchArgs: process.argv.slice(1),
      })
    ),
    launchDevelopmentHandoffUpdate: (prepared) => (
      launchMacDevelopmentHandoffUpdate({
        prepared,
        currentProcessId: process.pid,
      })
    ),
    prepareMacUpdateInstallation: () => prepareMacUpdateAppPath({
      homeDir: app.getPath("home"),
      jobLabel: macShipItJobLabelForBuildInfo(BUILD_INFO),
      targetAppPath: macAppBundlePathFromExecutable(),
    }),
    recordUpdateState: recordTelemetryUpdateState,
    translate: (key, values) => desktopText(key, values),
    prepareWindowsUpdate: (manifest) => prepareWindowsAppUpdate({
      manifest,
      localAppData: process.env.LOCALAPPDATA,
    }),
    launchWindowsUpdate: (prepared) => windowsPreparedUpdateLaunch({
      prepared,
      currentProcessId: process.pid,
      args: process.argv.slice(1),
    }),
    requestQuitForUpdate: quitAfterClosingServer,
  });
  updateCheckScheduler = createUpdateCheckScheduler({
    checkForUpdates: (options) => updateController?.checkForUpdates(options),
  });
}

function checkForUpdatesMenuItem() {
  return {
    label: desktopText("menu.checkUpdates"),
    click: () => {
      void updateCheckScheduler?.checkManually();
    },
  };
}

function installDesktopShortcutBridge(browserWindow) {
  browserWindow.webContents.on("before-input-event", (event, input) => {
    const shellAction = desktopShellShortcutFromInput(input);
    if (shellAction) {
      event.preventDefault();
      void runDesktopShellShortcut(shellAction, browserWindow);
      return;
    }

    const repositoryPanelAction = desktopRepositoryPanelShortcutFromInput(input, {
      open: isRepositoryPanelOpen,
    });
    if (repositoryPanelAction) {
      event.preventDefault();
      void sendShortcutToRenderer(repositoryPanelAction);
      return;
    }

    const repositoryAction = desktopRepositoryShortcutFromInput(input);
    if (repositoryAction) {
      event.preventDefault();
      void runDesktopRepositoryShortcut(repositoryAction);
      return;
    }

    if (!activeServer || isRepositoryTransitioning) {
      return;
    }

    const action = desktopShortcutActionFromInput(input);
    if (!action) {
      return;
    }

    event.preventDefault();
    void sendShortcutToRenderer(action);
  });
}

function installSettingsViewShortcutBridge(webContents) {
  if (!webContents || settingsShortcutBridges.has(webContents)) {
    return;
  }
  settingsShortcutBridges.add(webContents);
  webContents.on("before-input-event", (event, input) => {
    const shellAction = desktopShellShortcutFromInput(input);
    if (shellAction) {
      event.preventDefault();
      void runDesktopShellShortcut(shellAction, mainWindow);
      return;
    }
    const repositoryPanelAction = desktopRepositoryPanelShortcutFromInput(input, {
      open: isRepositoryPanelOpen,
    });
    if (repositoryPanelAction) {
      event.preventDefault();
      void sendShortcutToRenderer(repositoryPanelAction);
      return;
    }
    const repositoryAction = desktopRepositoryShortcutFromInput(input);
    if (repositoryAction) {
      event.preventDefault();
      void runDesktopRepositoryShortcut(repositoryAction);
      return;
    }
    if (desktopShortcutActionFromInput(input)) {
      event.preventDefault();
    }
  });
}

function desktopShellShortcutFromInput(input) {
  if (input.type && input.type !== "keyDown") {
    return null;
  }
  if (isRepositoryPanelOpen) {
    return null;
  }
  const key = String(input.key || "").toLowerCase();
  const code = String(input.code || "");
  const meta = input.meta === true;
  const ctrl = input.control === true;
  const shift = input.shift === true;
  const alt = input.alt === true;
  if (alt) {
    return null;
  }
  if (!shift && settingsCenter?.visible && key === "escape") {
    return { command: "close-settings" };
  }
  if (!shift && (meta || ctrl) && (key === "," || code === "Comma")) {
    return { command: "show-settings", section: "general" };
  }
  if (isKeyboardShortcutsHelpShortcut({
    key,
    code,
    metaKey: meta,
    ctrlKey: ctrl,
    shiftKey: shift,
    altKey: alt,
  })) {
    return { command: "show-settings", section: "shortcuts" };
  }
  if (shift) {
    return null;
  }
  if (process.platform === "darwin" && meta && !ctrl && key === "m") {
    return { command: "minimize-window" };
  }
  if (process.platform === "darwin" && meta && ctrl && key === "f") {
    return { command: "toggle-full-screen" };
  }
  return null;
}

async function runDesktopShellShortcut(action, browserWindow) {
  switch (action?.command) {
    case "close-settings":
      settingsCenter?.hide();
      return;
    case "show-settings":
      await showSettingsAndHelpCenter(action.section);
      return;
    case "minimize-window":
      browserWindow.minimize();
      return;
    case "toggle-full-screen":
      browserWindow.setFullScreen(!browserWindow.isFullScreen());
      return;
    default:
  }
}

function desktopRepositoryShortcutFromInput(input) {
  if (input.type && input.type !== "keyDown") {
    return null;
  }
  const code = String(input.code || "");
  const meta = input.meta === true;
  const ctrl = input.control === true;
  const shift = input.shift === true;
  const alt = input.alt === true;
  const digitMatch = /^Digit([1-9])$/.exec(code);

  if (!alt && !shift && (meta || ctrl) && code === "KeyO") {
    return { command: "show-repository-panel" };
  }
  if (isRepositoryPanelOpen) {
    return null;
  }
  if (alt && !shift && (meta || ctrl) && digitMatch) {
    return {
      command: "switch-repository-at-index",
      index: Number(digitMatch[1]) - 1,
    };
  }
  if (alt && !shift && (meta || ctrl) && code === "ArrowLeft") {
    return { command: "previous-repository" };
  }
  if (alt && !shift && (meta || ctrl) && code === "ArrowRight") {
    return { command: "next-repository" };
  }
  return null;
}

async function runDesktopRepositoryShortcut(action) {
  if (isRepositoryTransitioning) {
    return false;
  }
  if (action?.command === "show-repository-panel") {
    return showRepositoryPanel();
  }
  const repoRoots = desktopRepositoryState.openRepoRoots ?? [];
  const activeRepositoryRoot = activeServer?.repositoryRoot ?? "";
  let targetRoot = "";
  if (action?.command === "switch-repository-at-index") {
    targetRoot = repositoryAtIndex(repoRoots, Number(action.index));
  } else if (action?.command === "previous-repository") {
    targetRoot = adjacentRepository(repoRoots, activeRepositoryRoot, -1);
  } else if (action?.command === "next-repository") {
    targetRoot = adjacentRepository(repoRoots, activeRepositoryRoot, 1);
  }
  if (!targetRoot || targetRoot === activeRepositoryRoot) {
    return false;
  }
  return openKnownRepository(targetRoot);
}

function desktopShortcutActionFromInput(input) {
  if (input.type && input.type !== "keyDown") {
    return null;
  }

  const key = String(input.key || "").toLowerCase();
  const code = String(input.code || "");
  const meta = input.meta === true;
  const ctrl = input.control === true;
  const shift = input.shift === true;
  const alt = input.alt === true;
  const sidebarTab = sidebarTabFromShortcut({
    key,
    code,
    metaKey: meta,
    ctrlKey: ctrl,
    shiftKey: shift,
    altKey: alt,
  });
  if (sidebarTab) {
    return { command: "switch-sidebar-tab", tab: sidebarTab };
  }
  if (alt) {
    return null;
  }

  if (meta && shift && code === "BracketLeft") {
    return { command: "previous-tab" };
  }

  if (meta && shift && code === "BracketRight") {
    return { command: "next-tab" };
  }

  if (!meta && ctrl && key === "tab") {
    return { command: shift ? "previous-tab" : "next-tab" };
  }

  if (!shift && (meta || ctrl) && code === "BracketLeft") {
    return { command: "history-back" };
  }

  if (!shift && (meta || ctrl) && code === "BracketRight") {
    return { command: "history-forward" };
  }

  if (!(meta || ctrl)) {
    return null;
  }

  if (isToggleFavoriteShortcut({
    key,
    code,
    metaKey: meta,
    ctrlKey: ctrl,
    shiftKey: shift,
    altKey: alt,
  })) {
    return { command: "toggle-favorite" };
  }

  if (!shift && key === "b") {
    return { command: "toggle-sidebar" };
  }

  if (shift && key === "b") {
    return { command: "toggle-document-outline" };
  }

  if (shift && key === "c") {
    return { command: "copy-document-path" };
  }

  if (shift && key === "l") {
    return { command: "copy-document-share-link" };
  }

  if (shift && key === "g") {
    return { command: "open-document-github" };
  }

  if (shift && key === "o") {
    return { command: "open-document-source" };
  }

  if (shift && key === "r") {
    return { command: "reveal-file-manager" };
  }

  if (shift && key === "e") {
    return { command: "focus-file-tree" };
  }

  if (!shift && key === "w") {
    return { command: "close-current-tab" };
  }

  if (!shift && /^[1-8]$/.test(key)) {
    return { command: "switch-tab-at-index", index: Number(key) - 1 };
  }

  if (!shift && key === "9") {
    return { command: "switch-last-tab" };
  }

  if (!shift && key === "p") {
    return { command: "set-mode", mode: "preview" };
  }

  if (!shift && key === "s") {
    return { command: "set-mode", mode: "source" };
  }

  if (!shift && key === "l") {
    return { command: "set-mode", mode: "live" };
  }

  if (!shift && key === "k") {
    return { command: "focus-file-search" };
  }

  if (!shift && key === "f") {
    return { command: "find-in-document" };
  }

  return null;
}

async function sendShortcutToRenderer(action) {
  return sendRendererEvent("git-leaf-desktop-shortcut", action);
}

async function showDesktopUpdateStatus(status) {
  desktopUpdateStatus = status && typeof status === "object" ? { ...status } : { state: "idle" };
  if (desktopUpdateStatus.state === "error" && desktopUpdateStatus.manual !== true) {
    updateCheckScheduler?.retrySoon();
  }
  const handled = await sendRendererEvent("git-leaf-desktop-update-status", desktopUpdateStatus);
  await settingsCenter?.refresh();
  if (!handled) {
    await showDesktopUpdateStatusFallback(desktopUpdateStatus);
  }
}

async function syncDesktopUpdateStatus() {
  return sendRendererEvent("git-leaf-desktop-update-status", desktopUpdateStatus);
}

async function sendRendererEvent(eventName, detailObject) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const detail = JSON.stringify(detailObject);
  const safeEventName = JSON.stringify(eventName);
  return mainWindow.webContents.executeJavaScript(
    `(() => {
      const event = new CustomEvent(${safeEventName}, { detail: ${detail}, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })();`,
    true,
  ).then(Boolean).catch(() => false);
}

async function showDesktopUpdateStatusFallback(status) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const statusMessage = desktopUpdateStatusMessage(status);
  if (!statusMessage) {
    return false;
  }
  const message = JSON.stringify(statusMessage);
  return mainWindow.webContents.executeJavaScript(
    `(() => {
      let toast = document.querySelector("#desktop-update-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "desktop-update-toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        Object.assign(toast.style, {
          position: "fixed",
          top: "18px",
          left: "50%",
          zIndex: "1000",
          transform: "translateX(-50%)",
          border: "1px solid rgba(90, 203, 160, 0.55)",
          borderRadius: "8px",
          background: "rgb(52, 168, 128)",
          color: "#ffffff",
          fontSize: "15px",
          fontWeight: "750",
          padding: "10px 16px",
          boxShadow: "0 14px 30px rgba(0, 0, 0, 0.35)",
        });
        document.body.append(toast);
      }
      toast.textContent = ${message};
      toast.hidden = false;
      window.clearTimeout(window.__openGlanceDesktopUpdateToastTimer);
      window.__openGlanceDesktopUpdateToastTimer = window.setTimeout(() => {
        toast.hidden = true;
      }, 7000);
      return true;
    })();`,
    true,
  ).then(Boolean).catch(() => false);
}

function desktopUpdateStatusMessage(status, resolvedLanguage = "") {
  if (typeof status?.message === "string" && status.message.trim()) {
    return status.message.trim();
  }

  const translate = resolvedLanguage
    ? createDesktopTranslatorForLanguage(resolvedLanguage)
    : currentDesktopTranslator();
  switch (status?.state) {
    case "checking":
      return translate("updates.checking");
    case "downloading":
      return translate("updates.downloading");
    case "downloaded":
      return translate("updates.downloaded");
    case "available":
      return translate("updates.available");
    case "current":
      return translate("updates.current");
    case "error":
      return translate("updates.error");
    default:
      return "";
  }
}

async function showSettingsAndHelpCenter(section = "general") {
  if (!settingsCenter || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  await settingsCenter.show(section);
  installSettingsViewShortcutBridge(settingsCenter.webContents);
  installMenu();
  return true;
}

function settingsCenterHelpSections(resolvedLanguage) {
  const translate = createDesktopTranslatorForLanguage(resolvedLanguage);
  return [
    ...getOpenGlanceHelpSections(resolvedLanguage),
    {
      id: "file-types",
      title: translate("settings.fileTypes.title"),
      body: [
        translate("settings.fileTypes.body"),
      ],
      fileTypes: getFileTypeHelpRows(resolvedLanguage),
    },
  ];
}

async function settingsCenterStatus(resolvedLanguage) {
  const translate = createDesktopTranslatorForLanguage(resolvedLanguage);
  const environment = await desktopEnvironmentChecks({ language: resolvedLanguage });
  return {
    updatesEnabled: DESKTOP_UPDATES_ENABLED,
    app: {
      version: { label: translate("settings.version"), value: BUILD_INFO.version },
      build: {
        label: translate("settings.build"),
        value: buildDistributionLabel(BUILD_INFO, { language: resolvedLanguage }),
      },
      release: {
        label: translate("settings.releaseDate"),
        value: releaseDateLabel(BUILD_INFO, { language: resolvedLanguage })
          || translate("common.unknown"),
      },
      update: {
        label: translate("settings.updateStatus"),
        value: desktopUpdateStatusMessage(desktopUpdateStatus, resolvedLanguage)
          || translate("settings.notChecked"),
        status: settingsUpdateStatusTone(desktopUpdateStatus),
      },
      privacy: {
        label: translate("settings.privacy"),
        value: telemetryClient?.enabled
          ? translate("settings.analyticsOn")
          : translate("settings.analyticsOff"),
      },
    },
    environment,
    repository: await settingsCenterRepositoryStatus(resolvedLanguage),
  };
}

async function settingsCenterRepositoryStatus(resolvedLanguage) {
  const translate = createDesktopTranslatorForLanguage(resolvedLanguage);
  const server = activeServer;
  if (!server || isRepositoryTransitioning) {
    return {};
  }

  let treePayload = null;
  try {
    const response = await fetch(new URL("/api/tree", server.url));
    if (response.ok) {
      treePayload = await response.json();
    }
  } catch {
    treePayload = null;
  }
  const counts = settingsTreeFileCounts(treePayload?.tree);
  const hasFrontmatterRules = await access(
    path.join(server.repoRoot, "docs", "frontmatter-rules.json"),
  ).then(() => true, () => false);
  const allowedKeys = Array.isArray(treePayload?.frontmatterAllowedKeys)
    ? treePayload.frontmatterAllowedKeys
    : [];
  return {
    repository: { label: translate("settings.repository"), value: server.repoName },
    path: { label: translate("settings.workingDirectory"), value: server.repoRoot },
    worktree: {
      label: translate("settings.worktree"),
      value: server.repoRoot === server.repositoryRoot
        ? translate("settings.mainWorkingDirectory")
        : server.worktreeName || path.basename(server.repoRoot),
    },
    branch: {
      label: translate("settings.branch"),
      value: treePayload?.detached
        ? "Detached HEAD"
        : treePayload?.branch || translate("common.unknown"),
      status: treePayload?.detached ? "warning" : "ok",
    },
    files: {
      label: translate("settings.repositoryFiles"),
      value: translatedFileCount(translate, counts.total),
    },
    markdown: {
      label: translate("settings.markdownFiles"),
      value: translatedFileCount(translate, counts.markdown),
    },
    frontmatter: {
      label: translate("settings.frontmatterRules"),
      value: hasFrontmatterRules
        ? allowedKeys.length > 0
          ? translate("settings.frontmatterDetected", {
              count: allowedKeys.length,
              fields: allowedKeys.join(resolvedLanguage === "zh-CN" ? "、" : ", "),
            })
          : translate("settings.frontmatterNoFields")
        : translate("settings.frontmatterMissing"),
      status: hasFrontmatterRules ? "ok" : "warning",
    },
  };
}

function settingsTreeFileCounts(nodes) {
  const counts = { total: 0, markdown: 0 };
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.type === "file") {
      counts.total += 1;
      if (node.kind === "markdown") {
        counts.markdown += 1;
      }
      continue;
    }
    const children = settingsTreeFileCounts(node?.children);
    counts.total += children.total;
    counts.markdown += children.markdown;
  }
  return counts;
}

function settingsUpdateStatusTone(status) {
  if (status?.state === "error") {
    return "error";
  }
  if (["current", "downloaded"].includes(status?.state)) {
    return "ok";
  }
  return "warning";
}

async function exportCurrentDocumentPdf() {
  if (!mainWindow || mainWindow.isDestroyed() || !activeServer || isRepositoryTransitioning) {
    return;
  }

  let metadata = null;
  try {
    metadata = await mainWindow.webContents.executeJavaScript(
      "window.openGlancePreparePdfExport ? window.openGlancePreparePdfExport() : null",
      true,
    );
  } catch (error) {
    recordTelemetryFeature("output.pdf_export", { result: "error" });
    await showPdfExportError(error);
    return;
  }

  if (!metadata?.path) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      message: desktopText("dialog.openDocumentForPdf"),
    });
    return;
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: desktopText("dialog.exportPdf"),
    defaultPath: defaultPdfExportPath(metadata),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) {
    recordTelemetryFeature("output.pdf_export", { result: "cancel" });
    await finishCurrentDocumentPdfExport(metadata);
    return;
  }

  try {
    const pdf = await mainWindow.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    await writeFile(result.filePath, pdf);
    recordTelemetryFeature("output.pdf_export", { result: "success" });
  } catch (error) {
    recordTelemetryFeature("output.pdf_export", { result: "error" });
    await showPdfExportError(error);
  } finally {
    await finishCurrentDocumentPdfExport(metadata);
  }
}

async function finishCurrentDocumentPdfExport(metadata) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const detail = JSON.stringify(metadata || {});
  await mainWindow.webContents.executeJavaScript(
    `window.openGlanceFinishPdfExport && window.openGlanceFinishPdfExport(${detail});`,
    true,
  ).catch(() => {});
}

function defaultPdfExportPath(metadata) {
  const baseName = pdfExportBaseName(metadata);
  const fileName = pdfFileName(baseName);
  return path.join(app.getPath("documents"), fileName);
}

function pdfExportBaseName(metadata) {
  const title = String(metadata?.title || "").trim();
  if (title) {
    return title;
  }
  const documentPath = String(metadata?.path || "").trim();
  if (!documentPath) {
    return "OpenGlance Document";
  }
  return path.basename(documentPath, path.extname(documentPath));
}

function pdfFileName(value) {
  const safeName = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .slice(0, 120) || "OpenGlance Document";
  return safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`;
}

async function showPdfExportError(error) {
  const detail = error?.message ? String(error.message) : "Unknown PDF export error.";
  await dialog.showMessageBox(mainWindow, {
    type: "error",
    message: desktopText("dialog.exportPdfFailed"),
    detail,
  });
}

function handleDesktopNavigation(url) {
  if (!mainWindow) {
    return;
  }

  if (isDesktopActionUrl(url)) {
    void handleDesktopAction(url);
    return;
  }

  const action = classifyDesktopNavigation({
    currentUrl: mainWindow.webContents.getURL(),
    targetUrl: url,
  });
  if (action === "internal") {
    void mainWindow.loadURL(url);
    return;
  }
  if (action === "external") {
    void shell.openExternal(url);
  }
}

async function handleDesktopAction(url) {
  if (!isDesktopActionUrl(url)) {
    return;
  }
  const action = new URL(url);
  if (action.hostname === DESKTOP_SHOW_REPOSITORIES_ACTION.hostname) {
    await showRepositoryPanel();
    return;
  }
  if (action.hostname === DESKTOP_CLOSE_REPOSITORIES_ACTION.hostname) {
    isRepositoryPanelOpen = false;
    return;
  }
  if (action.hostname === DESKTOP_SWITCH_REPOSITORY_ACTION.hostname) {
    await switchRepositoryFromPanel(action.searchParams.get("id") ?? "");
    return;
  }
  if (action.hostname === DESKTOP_REMOVE_REPOSITORY_ACTION.hostname) {
    await removeRepositoryFromPanel(action.searchParams.get("id") ?? "");
    return;
  }
  if (action.hostname === DESKTOP_REORDER_REPOSITORIES_ACTION.hostname) {
    await reorderRepositoriesFromPanel(action.searchParams.getAll("id"));
    return;
  }
  if (action.hostname === DESKTOP_OPEN_REPOSITORY_ACTION.hostname) {
    isRepositoryPanelOpen = false;
    await chooseAndOpenRepository();
    return;
  }
  if (action.hostname === DESKTOP_OPEN_WORKTREE_ACTION.hostname) {
    await openWorktreeFromAction(action.searchParams.get("path") ?? "");
    return;
  }
  if (action.hostname === DESKTOP_INSTALL_UPDATE_ACTION.hostname) {
    await updateController?.handleUpdateAction();
  }
}

function isDesktopActionUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === DESKTOP_OPEN_REPOSITORY_ACTION.protocol && [
      DESKTOP_SHOW_REPOSITORIES_ACTION.hostname,
      DESKTOP_CLOSE_REPOSITORIES_ACTION.hostname,
      DESKTOP_SWITCH_REPOSITORY_ACTION.hostname,
      DESKTOP_REMOVE_REPOSITORY_ACTION.hostname,
      DESKTOP_REORDER_REPOSITORIES_ACTION.hostname,
      DESKTOP_OPEN_REPOSITORY_ACTION.hostname,
      DESKTOP_OPEN_WORKTREE_ACTION.hostname,
      DESKTOP_INSTALL_UPDATE_ACTION.hostname,
    ].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function openWorktreeFromAction(requestedRoot) {
  if (!activeServer || !requestedRoot || isRepositoryTransitioning) {
    return;
  }

  try {
    const resolvedRoot = await realpath(await findRepoRoot(requestedRoot));
    const worktrees = await listGitWorktrees(activeServer.repoRoot);
    const selected = worktrees.find((worktree) => worktree.root === resolvedRoot);
    if (!selected || selected.bare || selected.prunable) {
      throw new Error(desktopText("worktree.unavailable"));
    }
    if (selected.root === activeServer.repoRoot) {
      return;
    }
    await openRepository(selected.root, "", { worktreeSwitch: true });
    recordTelemetryFeature("navigation.worktree_switch", { result: "success" });
  } catch (error) {
    recordTelemetryFeature("navigation.worktree_switch", { result: "error" });
    const options = {
      type: "error",
      message: desktopText("worktree.switchFailed"),
      detail: error instanceof Error ? error.message : String(error),
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, options);
    } else {
      await dialog.showMessageBox(options);
    }
  }
}

async function showHomePage({ errorState = null, closeActiveRepository = true } = {}) {
  isRepositoryPanelOpen = false;
  await ensureMainWindow();
  settingsCenter?.hide();
  hideRepositoryTransitionView();

  const previousServer = closeActiveRepository ? activeServer : null;
  currentHomeErrorState = errorState;
  if (closeActiveRepository) {
    activeServer = null;
  }
  await loadDesktopHomePage({ errorState });
  isRepositoryTransitioning = false;
  installMenu();

  if (previousServer) {
    await previousServer.close();
  }
}

async function reloadDesktopHomeForLanguage() {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || activeServer
    || isRepositoryTransitioning
  ) {
    return false;
  }
  await loadDesktopHomePage({ errorState: currentHomeErrorState });
  return true;
}

async function loadDesktopHomePage({ errorState = null } = {}) {
  const resolvedLanguage = currentDesktopTranslator().locale;
  const checks = await desktopEnvironmentChecks({ language: resolvedLanguage });
  const html = desktopHomeHtml({
    checks,
    repositories: desktopRepositoryPanelItems(desktopRepositoryState.openRepoRoots),
    errorMessage: localizeDesktopHomeError(
      errorState,
      desktopRepositoryState.preferences ?? {},
      { app },
    ),
    preferences: desktopRepositoryState.preferences ?? {},
    systemLanguages: preferredSystemLanguages(app),
  });
  await mainWindow.loadURL(htmlDataUrl(html));
  mainWindow.setTitle(APP_DISPLAY_NAME);
}

async function showProgressPage({ title, message }) {
  await ensureMainWindow();
  settingsCenter?.hide();

  isRepositoryTransitioning = true;
  installMenu();
  const backgroundColor = desktopPageBackgroundColor(
    desktopRepositoryState.preferences ?? {},
    { systemDark: nativeTheme.shouldUseDarkColors },
  );
  mainWindow.setBackgroundColor(backgroundColor);
  if (await showRepositoryTransitionView(mainWindow, {
    title,
    message,
  })) {
    mainWindow.setTitle(`${APP_DISPLAY_NAME} - ${title}`);
    return;
  }
  await loadWebContentsUrl(
    mainWindow.webContents,
    htmlDataUrl(desktopProgressHtml({
      title,
      message,
      preferences: desktopRepositoryState.preferences ?? {},
      systemLanguages: preferredSystemLanguages(app),
    })),
  );
  await waitForWebContentsPaint(mainWindow.webContents);
  mainWindow.setTitle(`${APP_DISPLAY_NAME} - ${title}`);
}

async function showRepositoryTransitionView(browserWindow, { title, message }) {
  hideRepositoryTransitionView();
  if (!browserWindow || browserWindow.isDestroyed?.()) {
    return false;
  }
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  repositoryTransitionView = view;
  try {
    const loaded = await loadWebContentsUrl(
      view.webContents,
      htmlDataUrl(desktopProgressHtml({
        title,
        message,
        preferences: desktopRepositoryState.preferences ?? {},
        systemLanguages: preferredSystemLanguages(app),
      })),
    );
    if (!loaded) {
      if (repositoryTransitionView === view) {
        repositoryTransitionView = null;
      }
      closeWebContentsView(view);
      return false;
    }
    if (repositoryTransitionView !== view || browserWindow.isDestroyed?.()) {
      closeWebContentsView(view);
      return false;
    }
    browserWindow.contentView.addChildView(view);
    resizeRepositoryTransitionView(browserWindow);
    await waitForWebContentsPaint(view.webContents);
    return repositoryTransitionView === view;
  } catch {
    if (repositoryTransitionView === view) {
      repositoryTransitionView = null;
    }
    closeWebContentsView(view);
    return false;
  }
}

function resizeRepositoryTransitionView(browserWindow = mainWindow) {
  if (!repositoryTransitionView || !browserWindow || browserWindow.isDestroyed?.()) {
    return false;
  }
  const bounds = browserWindow.getContentBounds();
  repositoryTransitionView.setBounds({
    x: 0,
    y: 0,
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  });
  return true;
}

function hideRepositoryTransitionView(browserWindow = mainWindow) {
  const view = repositoryTransitionView;
  repositoryTransitionView = null;
  if (!view) {
    return false;
  }
  if (browserWindow && !browserWindow.isDestroyed?.()) {
    try {
      browserWindow.contentView.removeChildView(view);
    } catch {
      // The view may already have been detached during window shutdown.
    }
  }
  closeWebContentsView(view);
  return true;
}

function closeWebContentsView(view) {
  if (view && !view.webContents.isDestroyed?.()) {
    view.webContents.close?.({ waitForBeforeUnload: false });
  }
}

async function waitForWorkbenchReady(browserWindow, timeoutMs = 15_000) {
  const executeJavaScript = browserWindow?.webContents?.executeJavaScript;
  if (typeof executeJavaScript !== "function") {
    return false;
  }
  try {
    return await executeJavaScript.call(browserWindow.webContents, `
      new Promise((resolve) => {
        const root = document.documentElement;
        const ready = () => !root.classList.contains("is-workbench-loading");
        if (ready()) {
          resolve(true);
          return;
        }
        const observer = new MutationObserver(() => {
          if (ready()) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(true);
          }
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve(false);
        }, ${Math.max(0, Number(timeoutMs) || 0)});
        observer.observe(root, { attributes: true, attributeFilter: ["class"] });
      })
    `, true) === true;
  } catch {
    return false;
  }
}

function htmlDataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function openRepository(
  repoRoot,
  initialFilePath = "",
  { worktreeSwitch = false, showProgress = true } = {},
) {
  await ensureMainWindow();
  isRepositoryPanelOpen = false;
  if (showProgress) {
    await showProgressPage({
      title: activeServer
        ? desktopText("progress.switchingRepository")
        : desktopText("progress.openingRepository"),
      message: desktopText("progress.preparingWorkspace", {
        repo: path.basename(repoRoot),
      }),
    });
  }

  const previousServer = activeServer;
  const previousRepositoryRoot = previousServer?.repositoryRoot ?? "";
  activeServer = null;
  if (previousServer) {
    await previousServer.close();
  }

  const nextServer = await startDesktopOpenGlanceServer({
    repoRoot,
    initialFilePath,
    desktopPreferences: preferencesForRenderer(),
    saveDesktopPreferences: saveDesktopPreferenceValuesFromRenderer,
    getRepositoryFavorites: repositoryFavoritesForRenderer,
    mutateRepositoryFavorite: mutateRepositoryFavoriteForRenderer,
    recordTelemetryActions: telemetryClient?.enabled ? recordDesktopTelemetryActions : null,
  });
  activeServer = nextServer;
  await mainWindow.loadURL(nextServer.url);
  await waitForWorkbenchReady(mainWindow);
  hideRepositoryTransitionView();
  await waitForWebContentsPaint(mainWindow.webContents);
  mainWindow.setTitle(`${APP_DISPLAY_NAME} - ${nextServer.repoName}`);
  desktopRepositoryState = await saveDesktopRepository({
    userDataDir: userDataDir(),
    repoRoot: nextServer.repoRoot,
    repositoryRoot: nextServer.repositoryRoot,
  });
  telemetryClient?.recordRepositoryOpened(nextServer.commonDir, {
    switched: Boolean(previousRepositoryRoot && previousRepositoryRoot !== nextServer.repositoryRoot),
    worktreeSwitch,
  });
  isRepositoryTransitioning = false;
  installMenu();
}

async function chooseAndOpenRepository() {
  if (isRepositoryTransitioning) {
    return "busy";
  }

  const dialogOptions = {
    title: desktopText("menu.openRepository").replace(/[.…]+$/, ""),
    properties: ["openDirectory"],
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths[0]) {
    return "canceled";
  }

  try {
    await showProgressPage({
      title: desktopText("progress.openingRepository"),
      message: desktopText("progress.checkingRepository"),
    });
    const repoRoot = await findRepoRoot(result.filePaths[0]);
    await openRepository(repoRoot, "", { showProgress: false });
    return "opened";
  } catch (error) {
    await showHomePage({
      errorState: {
        kind: "repository-selection",
        path: result.filePaths[0],
        error,
      },
      closeActiveRepository: false,
    });
    return "invalid";
  }
}

async function showRepositoryPanel({ notice = null } = {}) {
  if (isRepositoryTransitioning) {
    return false;
  }
  if (!activeServer) {
    return chooseAndOpenRepository();
  }

  settingsCenter?.hide();
  mainWindow?.show?.();
  mainWindow?.focus?.();
  isRepositoryPanelOpen = true;
  const handled = await sendRendererEvent("git-leaf-desktop-repositories", {
    repositories: desktopRepositoryPanelItems(
      desktopRepositoryState.openRepoRoots,
      activeServer.repositoryRoot,
    ),
    ...(notice ? { notice } : {}),
  });
  if (!handled) {
    isRepositoryPanelOpen = false;
  }
  return handled;
}

async function switchRepositoryFromPanel(repositoryId) {
  if (isRepositoryTransitioning) {
    return false;
  }
  const targetRoot = desktopRepositoryRootForPanelId(
    desktopRepositoryState.openRepoRoots,
    repositoryId,
  );
  isRepositoryPanelOpen = false;
  if (!targetRoot) {
    return false;
  }
  return openKnownRepository(targetRoot);
}

async function removeRepositoryFromPanel(repositoryId) {
  if (isRepositoryTransitioning) {
    return false;
  }
  const targetRoot = desktopRepositoryRootForPanelId(
    desktopRepositoryState.openRepoRoots,
    repositoryId,
  );
  if (!targetRoot) {
    return false;
  }
  if (targetRoot === activeServer?.repositoryRoot) {
    isRepositoryPanelOpen = false;
    await closeCurrentRepository();
    return true;
  }

  desktopRepositoryState = await closeDesktopRepository({
    userDataDir: userDataDir(),
    repoRoot: targetRoot,
    repositoryRoot: targetRoot,
  });
  installMenu();
  return showRepositoryPanel({
    notice: {
      kind: "removed",
      repository: path.basename(targetRoot),
    },
  });
}

async function reorderRepositoriesFromPanel(repositoryIds) {
  if (isRepositoryTransitioning || !isRepositoryPanelOpen) {
    return false;
  }
  const orderedRoots = desktopRepositoryRootsForPanelOrder(
    desktopRepositoryState.openRepoRoots,
    repositoryIds,
  );
  if (!orderedRoots) {
    return false;
  }

  desktopRepositoryState = await reorderDesktopRepositories({
    userDataDir: userDataDir(),
    openRepoRoots: orderedRoots,
  });
  installMenu();
  return true;
}

async function openKnownRepository(
  repoRoot,
  initialFilePath = "",
  { showProgress = true } = {},
) {
  if (isRepositoryTransitioning && showProgress) {
    return false;
  }

  try {
    const resolvedRepoRoot = await realpath(await findRepoRoot(repoRoot));
    const reused = isRepositoryTransitioning ? null : await openActiveWorkbenchDocument({
      server: activeServer,
      repoRoot: resolvedRepoRoot,
      file: initialFilePath,
      webContents: mainWindow?.webContents,
    });
    if (reused !== null) {
      settingsCenter?.hide();
      isRepositoryPanelOpen = false;
      return reused;
    }
    if (showProgress) {
      const currentRepoName = activeServer ? path.basename(activeServer.repoRoot) : "";
      await showProgressPage({
        title: currentRepoName
          ? desktopText("progress.switchingRepository")
          : desktopText("progress.openingRepository"),
        message: currentRepoName
          ? desktopText("progress.switchingWorkspace", {
              from: currentRepoName,
              to: path.basename(repoRoot),
            })
          : desktopText("progress.preparingWorkspace", {
              repo: path.basename(repoRoot),
            }),
      });
    } else if (!isRepositoryTransitioning) {
      isRepositoryTransitioning = true;
      installMenu();
    }
    await openRepository(resolvedRepoRoot, initialFilePath, { showProgress: false });
    return true;
  } catch (error) {
    await showHomePage({
      errorState: {
        kind: "startup-repository",
        path: repoRoot,
        error,
      },
      closeActiveRepository: false,
    });
    return false;
  }
}

async function closeCurrentRepository() {
  if (isRepositoryTransitioning) {
    return;
  }

  isRepositoryPanelOpen = false;

  if (!activeServer) {
    await showHomePage();
    return;
  }

  const closingServer = activeServer;
  const closingRepoRoot = closingServer.repoRoot;
  const nextRepositoryRoot = repositoryAfterClose(
    desktopRepositoryState.openRepoRoots,
    closingServer.repositoryRoot,
  );
  await showProgressPage({
    title: nextRepositoryRoot
      ? desktopText("progress.switchingRepository")
      : desktopText("progress.closingRepository"),
    message: nextRepositoryRoot
      ? desktopText("progress.switchingWorkspace", {
          from: path.basename(closingRepoRoot),
          to: path.basename(nextRepositoryRoot),
        })
      : desktopText("progress.closingWorkspace", {
          repo: path.basename(closingRepoRoot),
        }),
  });
  activeServer = null;
  desktopRepositoryState = await closeDesktopRepository({
    userDataDir: userDataDir(),
    repoRoot: closingRepoRoot,
    repositoryRoot: closingServer.repositoryRoot,
  });
  await closingServer.close();
  if (nextRepositoryRoot) {
    await openKnownRepository(nextRepositoryRoot, "", { showProgress: false });
    return;
  }
  await showHomePage({ closeActiveRepository: false });
}

function installMenu() {
  const translate = currentDesktopTranslator();
  const isMac = process.platform === "darwin";
  const hasActiveRepository = Boolean(activeServer) && !isRepositoryTransitioning;
  const template = [
    ...(isMac
      ? [{
          label: APP_DISPLAY_NAME,
          submenu: [
            {
              role: "about",
              label: translate("menu.about", { app: APP_DISPLAY_NAME }),
            },
            ...(DESKTOP_UPDATES_ENABLED ? [checkForUpdatesMenuItem()] : []),
            {
              label: translate("menu.settings"),
              accelerator: "CmdOrCtrl+,",
              click: () => {
                void showSettingsAndHelpCenter("general");
              },
            },
            { type: "separator" },
            {
              role: "hide",
              label: translate("menu.hide", { app: APP_DISPLAY_NAME }),
            },
            { role: "hideOthers", label: translate("menu.hideOthers") },
            { role: "unhide", label: translate("menu.showAll") },
            { type: "separator" },
            {
              role: "quit",
              label: translate("menu.quit", { app: APP_DISPLAY_NAME }),
            },
          ],
        }]
      : []),
    {
      label: translate("menu.file"),
      submenu: [
        {
          label: translate("menu.repositories"),
          accelerator: "CmdOrCtrl+O",
          enabled: !isRepositoryTransitioning,
          click: () => {
            void showRepositoryPanel();
          },
        },
        { type: "separator" },
        {
          label: translate("menu.exportPdf"),
          enabled: hasActiveRepository,
          click: () => {
            void exportCurrentDocumentPdf();
          },
        },
        { type: "separator" },
        {
          label: translate("menu.removeRepository"),
          enabled: hasActiveRepository,
          click: () => {
            void closeCurrentRepository();
          },
        },
        ...(!isMac
          ? [
              { type: "separator" },
              {
                label: translate("menu.settings"),
                accelerator: "CmdOrCtrl+,",
                click: () => {
                  void showSettingsAndHelpCenter("general");
                },
              },
              ...(DESKTOP_UPDATES_ENABLED ? [checkForUpdatesMenuItem()] : []),
              { role: "quit", label: translate("menu.quit", { app: APP_DISPLAY_NAME }) },
            ]
          : []),
      ],
    },
    {
      label: translate("menu.edit"),
      submenu: [
        { role: "undo", label: translate("menu.undo") },
        { role: "redo", label: translate("menu.redo") },
        { type: "separator" },
        { role: "cut", label: translate("menu.cut") },
        { role: "copy", label: translate("menu.copy") },
        { role: "paste", label: translate("menu.paste") },
        { type: "separator" },
        { role: "selectAll", label: translate("menu.selectAll") },
        { type: "separator" },
        rendererShortcutMenuItem(translate("menu.findDocument"), "CmdOrCtrl+F", { command: "find-in-document" }, {
          enabled: hasActiveRepository,
        }),
      ],
    },
    {
      label: translate("menu.view"),
      submenu: [
        rendererShortcutMenuItem(translate("menu.toggleSidebar"), "CmdOrCtrl+B", { command: "toggle-sidebar" }, {
          enabled: hasActiveRepository,
        }),
        {
          label: translate("menu.sidebarViews"),
          submenu: [
            rendererShortcutMenuItem(
              translate("menu.sidebarAll"),
              "Alt+1",
              { command: "switch-sidebar-tab", tab: "all" },
              { enabled: hasActiveRepository },
            ),
            rendererShortcutMenuItem(
              translate("menu.sidebarFavorites"),
              "Alt+2",
              { command: "switch-sidebar-tab", tab: "favorites" },
              { enabled: hasActiveRepository },
            ),
            rendererShortcutMenuItem(
              translate("menu.sidebarSync"),
              "Alt+3",
              { command: "switch-sidebar-tab", tab: "sync" },
              { enabled: hasActiveRepository },
            ),
          ],
        },
        rendererShortcutMenuItem(translate("menu.toggleOutline"), "CmdOrCtrl+Shift+B", { command: "toggle-document-outline" }, {
          enabled: hasActiveRepository,
        }),
        { type: "separator" },
        rendererShortcutMenuItem(translate("menu.preview"), "CmdOrCtrl+P", { command: "set-mode", mode: "preview" }, {
          enabled: hasActiveRepository,
        }),
        rendererShortcutMenuItem(translate("menu.source"), "CmdOrCtrl+S", { command: "set-mode", mode: "source" }, {
          enabled: hasActiveRepository,
        }),
        rendererShortcutMenuItem(translate("menu.live"), "CmdOrCtrl+L", { command: "set-mode", mode: "live" }, {
          enabled: hasActiveRepository,
        }),
        { type: "separator" },
        {
          label: translate("menu.tabs"),
          submenu: [
            rendererShortcutMenuItem(translate("menu.previousTab"), previousTabAccelerator(), { command: "previous-tab" }, {
              enabled: hasActiveRepository,
            }),
            rendererShortcutMenuItem(translate("menu.nextTab"), nextTabAccelerator(), { command: "next-tab" }, {
              enabled: hasActiveRepository,
            }),
            { type: "separator" },
            rendererShortcutMenuItem(translate("menu.closeTab"), "CmdOrCtrl+W", { command: "close-current-tab" }, {
              enabled: hasActiveRepository,
            }),
          ],
        },
        { type: "separator" },
        ...(BUILD_INFO.dev === true
          ? [{ role: "reload", label: translate("menu.reload") }, { type: "separator" }]
          : []),
        { role: "resetZoom", label: translate("menu.actualSize") },
        { role: "zoomIn", label: translate("menu.zoomIn") },
        { role: "zoomOut", label: translate("menu.zoomOut") },
      ],
    },
    {
      label: translate("menu.help"),
      submenu: [
        {
          label: translate("menu.openGlanceHelp"),
          click: () => {
            void showSettingsAndHelpCenter("help");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function rendererShortcutMenuItem(label, accelerator, action, { enabled = true } = {}) {
  return {
    label,
    accelerator,
    enabled,
    click: () => {
      void sendShortcutToRenderer(action);
    },
  };
}

function previousTabAccelerator() {
  return process.platform === "darwin" ? "Cmd+Shift+[" : "Ctrl+Shift+Tab";
}

function nextTabAccelerator() {
  return process.platform === "darwin" ? "Cmd+Shift+]" : "Ctrl+Tab";
}

async function openInitialRepository() {
  const options = pendingDesktopOpenRequest ?? parseDesktopArgs(process.argv.slice(1));
  pendingDesktopOpenRequest = null;
  if (options.share || desktopRequestHasRepository(options)) {
    await openDesktopRequest(options);
    return;
  }
  void logDesktopHandoff("received", options);
  let startupErrorState = null;
  const candidates = await initialRepositoryCandidates(options);
  if (options.repository && candidates.length === 0) {
    startupErrorState = options.worktree
      ? {
          kind: "repository-worktree-not-found",
          repository: options.repository,
          worktree: options.worktree,
        }
      : {
          kind: "repository-identity-not-found",
          repository: options.repository,
        };
  }
  for (const candidate of candidates) {
    try {
      await showProgressPage({
        title: desktopText("progress.openingRepository"),
        message: desktopText("progress.restoringWorkspace", {
          repo: path.basename(candidate),
        }),
      });
      const repoRoot = await findRepoRoot(candidate);
      await openRepository(repoRoot, options.file, { showProgress: false });
      void confirmDesktopHandoff(options);
      return;
    } catch (error) {
      startupErrorState = {
        kind: "startup-repository",
        path: candidate,
        error,
      };
    }
  }

  const startupError = localizeDesktopHomeError(
    startupErrorState,
    desktopRepositoryState.preferences ?? {},
    { app },
  );
  await showHomePage({ errorState: startupErrorState });
  if (options.handoff && !desktopRequestHasRepository(options) && !startupErrorState) {
    void confirmDesktopHandoff(options);
  } else if (options.handoff) {
    void logDesktopHandoff("failed", options, startupError || "repository not found");
  }
}

async function initialRepositoryCandidates(options) {
  if (options.repoRoot) {
    return [options.repoRoot];
  }
  if (options.repository) {
    const repoRoot = await findGithubRepositoryRoot(
      options.repository,
      desktopRepositoryCandidates(),
      { worktree: options.worktree, primary: true },
    );
    return repoRoot ? [repoRoot] : [];
  }

  return [desktopRepositoryState.repoRoot].filter(Boolean);
}

async function handleSecondInstance(argv) {
  const options = parseDesktopArgs(argv.slice(1));
  const action = desktopSecondInstanceAction({
    isDesktopReady,
    request: options,
  });
  if (action === "focus") {
    focusMainWindow();
    return;
  }
  if (action === "queue") {
    pendingDesktopOpenRequest = options;
    focusMainWindow();
    return;
  }
  await openDesktopRequest(options);
}

async function openDesktopRequest(options) {
  if (options.share) {
    await openSharedDesktopRequest(options);
    return;
  }
  void logDesktopHandoff("received", options);
  let repoRoot = options.repoRoot || await findGithubRepositoryRoot(
    options.repository,
    desktopRepositoryCandidates(),
    { worktree: options.worktree, primary: true },
  );
  if (!repoRoot && options.repository) {
    const selection = await requestDeepLinkRepository(options);
    if (selection.status === "cancelled") {
      await restoreAfterDeepLinkAbort();
      recordDeepLinkTelemetry(options, "cancel");
      void logDesktopHandoff("cancelled", options, selection.detail);
      return;
    }
    if (selection.status === "error") {
      await restoreAfterDeepLinkAbort();
      recordDeepLinkTelemetry(options, "error", selection.failureReason);
      void logDesktopHandoff("failed", options, selection.detail);
      return;
    }
    repoRoot = selection.repoRoot;
  }
  if (repoRoot) {
    const opened = await openKnownRepository(repoRoot, options.file);
    focusMainWindow();
    if (opened) {
      recordDeepLinkTelemetry(options, "success");
      void confirmDesktopHandoff(options);
    } else {
      recordDeepLinkTelemetry(options, "error", "repository_open_failed");
      void logDesktopHandoff("failed", options, "repository or document did not open");
    }
    return;
  }

  await ensureMainWindow();
  if (activeServer) {
    await mainWindow.loadURL(activeServer.url);
    mainWindow.setTitle(`${APP_DISPLAY_NAME} - ${activeServer.repoName}`);
  } else {
    await showHomePage();
  }
  focusMainWindow();
  void confirmDesktopHandoff(options);
}

async function openSharedDesktopRequest(options) {
  void logDesktopHandoff("received", options);
  let matchedRoot = await findGithubRepositoryRoot(
    options.repository,
    desktopRepositoryCandidates(),
  );
  if (!matchedRoot) {
    const selection = await requestDeepLinkRepository(options);
    if (selection.status === "cancelled") {
      await restoreAfterDeepLinkAbort();
      recordDeepLinkTelemetry(options, "cancel");
      void logDesktopHandoff("cancelled", options, selection.detail);
      return;
    }
    if (selection.status === "error") {
      await restoreAfterDeepLinkAbort();
      recordDeepLinkTelemetry(options, "error", selection.failureReason);
      void logDesktopHandoff("failed", options, selection.detail);
      return;
    }
    matchedRoot = selection.repoRoot;
  }

  let target;
  try {
    target = await sharedMainWorktree(matchedRoot);
  } catch (error) {
    await failSharedDesktopRequest(
      options,
      desktopText("share.inspectMainFailed"),
      error instanceof Error ? error.message : String(error),
      "main_worktree_check_failed",
    );
    return;
  }
  if (!target.ok) {
    const detail = target.state === "primary_not_main"
      ? desktopText("share.mainWrongBranch", { branch: target.branch })
      : desktopText("share.mainMissing");
    await failSharedDesktopRequest(
      options,
      desktopText("share.openFailed"),
      detail,
      target.state === "primary_not_main" ? "primary_not_main" : "main_worktree_unavailable",
    );
    return;
  }

  const primaryRoot = target.primary.root;
  const activeIsLinkedWorktree = activeServer
    && activeServer.repositoryRoot === primaryRoot
    && activeServer.repoRoot !== primaryRoot;
  if (activeIsLinkedWorktree) {
    const current = target.worktrees.find((worktree) => worktree.root === activeServer.repoRoot);
    const confirmed = await confirmSharedDesktopAction({
      message: desktopText("share.switchPrompt"),
      detail: [
        desktopText("share.switchRequired"),
        "",
        desktopText("share.currentWorktree", {
          worktree: current?.branch || current?.name || desktopText("share.otherWorktree"),
        }),
        desktopText("share.targetWorktree"),
      ].join("\n"),
      confirmText: desktopText("share.switchAndOpen"),
    });
    if (!confirmed) {
      recordDeepLinkTelemetry(options, "cancel");
      void logDesktopHandoff("cancelled", options, "workspace switch cancelled");
      focusMainWindow();
      return;
    }
  }

  let state;
  try {
    state = await inspectSharedMainWithFetchRecovery({
      inspect: () => inspectSharedMain({
        repoRoot: primaryRoot,
        file: options.file,
        rev: options.rev,
      }),
      promptFetchRetry: confirmSharedFetchRetry,
    });
  } catch (error) {
    await failSharedDesktopRequest(
      options,
      desktopText("share.inspectLatestMainFailed"),
      error instanceof Error ? error.message : String(error),
      "main_worktree_check_failed",
    );
    return;
  }
  if (state.state === "fetch_failed") {
    recordDeepLinkTelemetry(options, "error", "fetch_failed");
    void logDesktopHandoff("failed", options, state.error || "git fetch failed");
    focusMainWindow();
    return;
  }
  try {
    if (state.state === "behind_clean") {
      await fastForwardSharedMain(primaryRoot);
    } else if (state.state === "behind_dirty_disjoint") {
      const confirmed = await confirmSharedDesktopAction({
        message: desktopText("share.updateMainPrompt"),
        detail: [
          desktopText("share.dirtyNonOverlapping", {
            count: state.dirtyPaths.length,
          }),
          desktopText("share.localChangesPreserved"),
        ].join("\n"),
        confirmText: desktopText("share.preserveAndUpdate"),
      });
      if (!confirmed) {
        recordDeepLinkTelemetry(options, "cancel");
        void logDesktopHandoff("cancelled", options, "fast-forward cancelled");
        focusMainWindow();
        return;
      }
      await fastForwardSharedMain(primaryRoot);
    } else if (state.state === "sync_required") {
      const confirmed = await confirmSharedDesktopAction({
        message: desktopText("share.syncRequiredPrompt"),
        detail: [
          desktopText("share.syncRequiredDetail"),
          ...state.dirtyPaths.map((file) => `• ${file}`),
        ].join("\n"),
        confirmText: desktopText("share.syncAndOpen"),
      });
      if (!confirmed) {
        recordDeepLinkTelemetry(options, "cancel");
        void logDesktopHandoff("cancelled", options, "document sync cancelled");
        focusMainWindow();
        return;
      }
      const sync = await syncSelectedFiles({
        repo: {
          id: path.basename(primaryRoot),
          root: primaryRoot,
          branch: "main",
        },
        files: state.dirtyPaths,
        note: desktopText("share.syncNote"),
        locale: currentDesktopTranslator().locale,
      });
      if (!sync.ok) {
        await showSharedSyncFailure(sync);
        recordDeepLinkTelemetry(options, "error", "sync_failed");
        void logDesktopHandoff("failed", options, sync.error || "git sync failed");
        return;
      }
    } else if (state.state !== "ready") {
      await failSharedDesktopRequest(
        options,
        sharedOpenFailureTitle(state),
        sharedOpenFailureDetail(state),
        sharedOpenFailureReason(state),
      );
      return;
    }
  } catch (error) {
    await failSharedDesktopRequest(
      options,
      desktopText("share.safeUpdateFailed"),
      error instanceof Error ? error.message : String(error),
      "safe_update_failed",
    );
    return;
  }

  if (state.state !== "ready") {
    state = await inspectSharedMain({
      repoRoot: primaryRoot,
      file: options.file,
      rev: options.rev,
      fetchRemote: false,
    });
  }
  if (state.state !== "ready") {
    await failSharedDesktopRequest(
      options,
      sharedOpenFailureTitle(state),
      sharedOpenFailureDetail(state),
      sharedOpenFailureReason(state),
    );
    return;
  }

  const opened = await openKnownRepository(primaryRoot, options.file);
  focusMainWindow();
  if (!opened) {
    recordDeepLinkTelemetry(options, "error", "document_open_failed");
    void logDesktopHandoff("failed", options, "shared document did not open");
    return;
  }
  recordDeepLinkTelemetry(options, "success");
  void confirmDesktopHandoff(options);
}

async function confirmSharedDesktopAction({ message, detail, confirmText }) {
  const options = {
    type: "question",
    message,
    detail,
    buttons: [confirmText, desktopText("dialog.cancel")],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

async function confirmSharedFetchRetry(state) {
  const options = sharedFetchFailurePrompt(state, {
    language: currentDesktopTranslator().locale,
  });
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

async function requestDeepLinkRepository(options) {
  const promptOptions = {
    type: "warning",
    message: options.worktree
      ? desktopText("share.worktreeNotFound")
      : desktopText("share.repositoryNotAdded"),
    detail: options.worktree
      ? repositoryWorktreeNotFoundMessage(options.repository, options.worktree)
      : repositoryIdentityNotFoundMessage(options.repository),
    buttons: [
      desktopText("dialog.chooseLocalRepository"),
      desktopText("dialog.cancel"),
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const prompt = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, promptOptions)
    : await dialog.showMessageBox(promptOptions);
  if (prompt.response !== 0) {
    return { status: "cancelled", detail: "repository selection cancelled" };
  }

  while (!isRepositoryTransitioning) {
    const pickerOptions = {
      title: desktopText("share.chooseRepositoryTitle"),
      properties: ["openDirectory"],
    };
    const picked = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, pickerOptions)
      : await dialog.showOpenDialog(pickerOptions);
    if (picked.canceled || !picked.filePaths[0]) {
      return { status: "cancelled", detail: "repository picker cancelled" };
    }

    let selectedRoot = "";
    let failureReason = "repository_selection_invalid";
    let failureMessage = desktopText("share.invalidRepository");
    let failureDetail = desktopText("share.chooseMatchingRepository");
    try {
      selectedRoot = await findRepoRoot(picked.filePaths[0]);
      const identityRoot = await findGithubRepositoryRoot(options.repository, [selectedRoot]);
      if (!identityRoot) {
        failureReason = "repository_identity_mismatch";
        failureMessage = desktopText("share.repositoryMismatch");
        failureDetail = repositorySelectionMismatchMessage(options.repository);
      } else if (options.worktree) {
        const worktreeRoot = await findGithubRepositoryRoot(
          options.repository,
          [identityRoot],
          { worktree: options.worktree },
        );
        if (worktreeRoot) {
          return { status: "selected", repoRoot: worktreeRoot };
        }
        failureReason = "worktree_not_found";
        failureMessage = desktopText("share.worktreeMissingFromRepository");
        failureDetail = repositoryWorktreeNotFoundMessage(options.repository, options.worktree);
      } else {
        const targetRoot = options.share ? identityRoot : await findGithubRepositoryRoot(
          options.repository,
          [identityRoot],
          { primary: true },
        );
        if (targetRoot) {
          return { status: "selected", repoRoot: targetRoot };
        }
        failureMessage = desktopText("share.mainMissing");
      }
    } catch (error) {
      failureDetail = repositorySelectionErrorMessage(picked.filePaths[0], error, {
        language: currentDesktopTranslator().locale,
      });
    }

    const retryOptions = {
      type: "warning",
      message: failureMessage,
      detail: failureDetail,
      buttons: [
        desktopText("dialog.retrySelection"),
        desktopText("dialog.cancel"),
      ],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const retry = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, retryOptions)
      : await dialog.showMessageBox(retryOptions);
    if (retry.response !== 0) {
      return {
        status: "error",
        failureReason,
        detail: failureDetail,
      };
    }
  }

  return {
    status: "error",
    failureReason: "repository_open_failed",
    detail: "repository transition already in progress",
  };
}

async function restoreAfterDeepLinkAbort() {
  if (!activeServer) {
    await showHomePage();
  }
  focusMainWindow();
}

async function failSharedDesktopRequest(options, message, detail, failureReason = "unknown") {
  const dialogOptions = {
    type: "warning",
    message,
    detail,
    buttons: [desktopText("dialog.acknowledge")],
    defaultId: 0,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, dialogOptions);
  } else {
    await dialog.showMessageBox(dialogOptions);
  }
  focusMainWindow();
  recordDeepLinkTelemetry(options, "error", failureReason);
  void logDesktopHandoff("failed", options, detail);
}

async function showSharedSyncFailure(sync) {
  const options = {
    type: "error",
    message: desktopText("share.syncFailed"),
    detail: sync.error || desktopText("share.syncIncomplete"),
    buttons: sync.agentPrompt
      ? [
          desktopText("dialog.copyAgentPrompt"),
          desktopText("dialog.acknowledge"),
        ]
      : [desktopText("dialog.acknowledge")],
    defaultId: sync.agentPrompt ? 1 : 0,
    cancelId: sync.agentPrompt ? 1 : 0,
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (sync.agentPrompt && result.response === 0) {
    clipboard.writeText(sync.agentPrompt);
  }
}

function sharedOpenFailureTitle(state) {
  if (state.state === "fetch_failed") return desktopText("share.fetchFailedTitle");
  if (state.state === "revision_missing") return desktopText("share.revisionMissingTitle");
  if (state.state === "ahead" || state.state === "diverged") {
    return desktopText("share.unpushedMainTitle");
  }
  return desktopText("share.openFailed");
}

function sharedOpenFailureDetail(state) {
  if (state.state === "fetch_failed") {
    return [
      desktopText("share.fetchFailedDetail"),
      state.error
        ? desktopText("share.technicalDetail", {
            detail: String(state.error).slice(0, 240),
          })
        : "",
    ].filter(Boolean).join("\n");
  }
  if (state.state === "revision_missing") {
    return desktopText("share.revisionMissingDetail");
  }
  if (state.state === "ahead") {
    return desktopText("share.aheadDetail");
  }
  if (state.state === "diverged") {
    return desktopText("share.divergedDetail");
  }
  return desktopText("share.unsafeDetail");
}

function sharedOpenFailureReason(state) {
  if (state.state === "fetch_failed") return "fetch_failed";
  if (state.state === "revision_missing") return "revision_missing";
  if (state.state === "ahead") return "main_ahead";
  if (state.state === "diverged") return "main_diverged";
  return "unknown";
}

function recordDeepLinkTelemetry(options, result, failureReason = "") {
  if (!options?.repository) {
    return false;
  }
  return recordTelemetryFeature("navigation.deep_link", {
    type: options.worktree ? "exact_worktree" : "repository",
    result,
    ...(result === "error" ? { failure_reason: failureReason || "unknown" } : {}),
  });
}

async function confirmDesktopHandoff(options) {
  if (!options?.handoff) {
    return false;
  }
  await logDesktopHandoff("opened", options);
  const confirmed = await confirmOpenGlanceHandoff(options.handoff);
  await logDesktopHandoff(confirmed ? "confirmed" : "confirm-failed", options);
  return confirmed;
}

async function logDesktopHandoff(event, request, detail = "") {
  try {
    const logged = await writeDesktopDeepLinkLog({
      userDataDir: userDataDir(),
      event,
      request,
      detail,
    });
    if (request?.share && ["received", "cancelled", "failed"].includes(event)) {
      void reportOpenGlanceShareHandoffState(request.handoff, event);
    }
    return logged;
  } catch {
    return false;
  }
}

function desktopRequestHasRepository(options) {
  return Boolean(options?.repoRoot || options?.repository);
}

function desktopRepositoryCandidates() {
  return [
    activeServer?.repoRoot,
    activeServer?.repositoryRoot,
    desktopRepositoryState.repoRoot,
    ...(desktopRepositoryState.openRepoRoots ?? []),
  ].filter(Boolean);
}

function repositoryIdentityNotFoundMessage(repository) {
  return desktopText("share.repositoryUnknown", { repository });
}

function repositoryWorktreeNotFoundMessage(repository, worktree) {
  return desktopText("share.worktreeUnknown", { repository, worktree });
}

function repositorySelectionMismatchMessage(repository) {
  return desktopText("share.repositorySelectionMismatch", { repository });
}

if (manualWindowsBootstrapBlocked) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      desktopText("windows.quitRunningTitle"),
      desktopText("windows.quitRunningDetail"),
    );
    app.exit(1);
  });
} else if (windowsBootstrap.status === "error") {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      desktopText("windows.prepareFailedTitle"),
      [
        desktopText("windows.prepareFailedDetail"),
        windowsBootstrap.error instanceof Error
          ? windowsBootstrap.error.message
          : String(windowsBootstrap.error),
      ].join("\n\n"),
    );
    app.exit(1);
  });
} else if (["install", "update", "redirect", "outdated"].includes(windowsBootstrap.status)) {
  app.whenReady().then(() => runWindowsAppInstall(windowsBootstrap));
} else if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    void handleSecondInstance(argv);
  });

  app.whenReady().then(async () => {
    if (await startMacAppNameMigration({
      app,
      launchArgs: () => [
        ...process.argv.slice(1),
        ...(pendingDesktopOpenUrl ? [pendingDesktopOpenUrl] : []),
      ],
    })) {
      // No repositories or persistent configuration have been loaded by this instance.
      // The helper waits for exit and restarts the same Profile at the canonical path.
      isQuitting = true;
      app.exit(0);
      return;
    }
    await initializeDesktopCommandEnvironment();
    await loadDesktopRepositoryState();
    installAboutPanelOptions();
    await initializeDesktopTelemetry();
    installUpdateController();
    installWindowsStartMenuShortcut();
    scheduleWindowsUpdateCacheCleanup();
    await updateController?.restoreKnownUpdate?.();
    installMenu();
    await createMainWindow();
    await confirmWindowsAppLaunch();
    startDesktopTelemetryRuntime();
    await openInitialRepository();
    isDesktopReady = true;
    if (pendingDesktopOpenRequest) {
      const request = pendingDesktopOpenRequest;
      pendingDesktopOpenRequest = null;
      await openDesktopRequest(request);
    }
    updateCheckScheduler.start();
    powerMonitor.on("resume", () => {
      void updateCheckScheduler?.onResume();
    });

    app.on("activate", async () => {
      void updateCheckScheduler?.onActivate();
      if (BrowserWindow.getAllWindows().length === 0) {
        if (activeServer) {
          await ensureMainWindow();
          await mainWindow.loadURL(activeServer.url);
          mainWindow.setTitle(`${APP_DISPLAY_NAME} - ${activeServer.repoName}`);
          return;
        }
        await ensureMainWindow();
        await openInitialRepository();
      }
    });
  }).catch(handleDesktopStartupFailure);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", async (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    void quitAfterClosingServer();
  });
}

function handleDesktopStartupFailure(error) {
  const invalidConfig = error?.code === "DESKTOP_CONFIG_INVALID";
  console.error("OpenGlance desktop startup failed", error);
  dialog.showErrorBox(
    invalidConfig
      ? desktopText("startup.configInvalidTitle")
      : desktopText("startup.failedTitle"),
    invalidConfig
      ? [
          desktopText("startup.configInvalidDetail"),
          error instanceof Error ? error.message : String(error),
        ].join("\n\n")
      : (error instanceof Error ? error.message : String(error)),
  );
  isQuitting = true;
  app.exit(1);
}

async function quitAfterClosingServer() {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  telemetryActivityTracker?.stop();
  telemetryActivityTracker = null;
  telemetryUploadScheduler?.stop();
  updateCheckScheduler?.stop();
  const server = activeServer;
  activeServer = null;
  await completeDesktopShutdown({
    prepareUpdate: () => updateController?.preparePendingUpdateOnQuit?.(),
    shutdownSteps: [
      () => saveCurrentWindowState({ repoRoot: server?.repoRoot ?? "" }),
      () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
      },
      () => server?.close(),
      () => telemetryUploadScheduler
        ? telemetryUploadScheduler.shutdown()
        : telemetryClient?.shutdown({
          upload: true,
          uploadTimeoutMs: DEFAULT_TELEMETRY_SHUTDOWN_UPLOAD_TIMEOUT_MS,
        }),
    ],
    installUpdate: () => updateController?.installPendingUpdateOnQuit?.(),
    exit: (code) => app.exit(code),
  });
  telemetryUploadScheduler = null;
}
