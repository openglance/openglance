import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_USER_PREFERENCES,
  effectiveColorScheme,
  normalizeUserPreferences,
  preferencePatch,
  resolveLanguagePreference,
} from "../../public/settings-preferences.js";

export const SETTINGS_CENTER_SECTIONS = Object.freeze([
  "general",
  "appearance",
  "files",
  "help",
  "shortcuts",
  "status",
]);

export const SETTINGS_CENTER_CHANNELS = Object.freeze({
  getModel: "git-leaf-settings:get-model",
  updatePreferences: "git-leaf-settings:update-preferences",
  action: "git-leaf-settings:action",
  show: "git-leaf-settings:show",
});

export const SETTINGS_CENTER_DEFAULT_PREFERENCES = DEFAULT_USER_PREFERENCES;

const USER_PREFERENCE_KEYS = new Set([
  "language",
  "colorMode",
  "documentFont",
  "documentFontSize",
  "documentMargins",
  "fileTreeMode",
  "showDocumentTitles",
  "gitRemoteCheckIntervalMinutes",
]);
const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const DEFAULT_PAGE_PATH = path.join(import.meta.dirname, "settings", "index.html");
const DEFAULT_PRELOAD_PATH = path.join(import.meta.dirname, "settings", "preload.cjs");

export function normalizeSettingsSection(value, fallback = "general") {
  const section = String(value ?? "").trim().toLowerCase();
  return SETTINGS_CENTER_SECTIONS.includes(section) ? section : fallback;
}

export function normalizeSettingsPreferences(value) {
  return normalizeUserPreferences(settingsPreferenceSource(value));
}

export function normalizeSettingsPreferencePatch(value) {
  if (!isRecord(value)) {
    return {};
  }

  const patch = {};
  for (const [key, preferenceValue] of Object.entries(value)) {
    if (!USER_PREFERENCE_KEYS.has(key)) {
      continue;
    }
    Object.assign(patch, preferencePatch(key, preferenceValue));
  }
  return patch;
}

export function normalizeSettingsAction(value) {
  const action = typeof value === "string" ? { type: value } : value;
  if (!isRecord(action)) {
    return null;
  }
  if (action.type === "close") {
    return { type: "close" };
  }
  if (action.type === "check-for-updates") {
    return { type: "check-for-updates" };
  }
  if (action.type === "open-external") {
    const url = normalizeExternalUrl(action.url);
    return url ? { type: "open-external", url } : null;
  }
  return null;
}

export function normalizeExternalUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function createSettingsCenterController({
  mainWindow,
  WebContentsView,
  ipcMain,
  shell,
  pagePath = DEFAULT_PAGE_PATH,
  preloadPath = DEFAULT_PRELOAD_PATH,
  getPreferences = async () => ({}),
  savePreferences = async (patch) => patch,
  getStatus = async () => ({}),
  getContent = async () => ({}),
  getSystemDark = () => false,
  getSystemLanguages = () => [],
  checkForUpdates = async () => ({}),
} = {}) {
  requireControllerDependency(mainWindow, "mainWindow");
  requireControllerDependency(WebContentsView, "WebContentsView");
  requireControllerDependency(ipcMain, "ipcMain");
  requireControllerDependency(shell, "shell");

  const settingsPagePath = path.resolve(pagePath);
  const settingsPageUrl = pathToFileURL(settingsPagePath).href;
  let view = null;
  let loadPromise = null;
  let attached = false;
  let visible = false;
  let destroyed = false;
  let activeSection = "general";
  let showGeneration = 0;
  let statusHydrationGeneration = 0;

  installIpcHandlers();

  async function show(section = "general") {
    assertActive();
    const generation = ++showGeneration;
    activeSection = normalizeSettingsSection(section);
    const currentView = ensureView();
    visible = true;
    const [, model] = await Promise.all([loadPromise, buildInitialModel()]);
    if (destroyed || !visible || generation !== showGeneration) {
      return { shown: false, section: activeSection };
    }

    await applyInitialTheme(currentView, model.preferences);
    if (destroyed || !visible || generation !== showGeneration) {
      return { shown: false, section: activeSection };
    }

    currentView.webContents.send(SETTINGS_CENTER_CHANNELS.show, {
      section: activeSection,
      model,
    });
    if (!attached) {
      mainWindow.contentView.addChildView(currentView);
      attached = true;
    }
    resize();
    currentView.webContents.focus();
    const hydrationGeneration = ++statusHydrationGeneration;
    void sendStatusWhenReady(generation, hydrationGeneration, model.resolvedLanguage);
    return { shown: true, section: activeSection, model };
  }

  function hide() {
    if (destroyed) {
      return false;
    }
    showGeneration += 1;
    statusHydrationGeneration += 1;
    visible = false;
    if (view && attached) {
      try {
        if (!mainWindow.isDestroyed?.()) {
          mainWindow.contentView.removeChildView(view);
        }
      } finally {
        attached = false;
      }
    }
    if (!mainWindow.isDestroyed?.()) {
      mainWindow.webContents?.focus?.();
    }
    return true;
  }

  function resize() {
    if (!view || destroyed || mainWindow.isDestroyed?.()) {
      return false;
    }
    const bounds = mainWindow.getContentBounds();
    view.setBounds({
      x: 0,
      y: 0,
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
    return true;
  }

  async function refresh() {
    if (!view || !visible || destroyed) {
      return false;
    }
    const generation = showGeneration;
    const hydrationGeneration = ++statusHydrationGeneration;
    await loadPromise;
    const { resolvedLanguage } = await buildLanguageContext();
    const status = await getStatus(resolvedLanguage);
    if (
      !view
      || !visible
      || destroyed
      || generation !== showGeneration
      || hydrationGeneration !== statusHydrationGeneration
    ) {
      return false;
    }
    view.webContents.send(SETTINGS_CENTER_CHANNELS.show, {
      status: isRecord(status) ? status : {},
    });
    return true;
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    hide();
    destroyed = true;
    removeIpcHandlers();
    if (view && !view.webContents.isDestroyed?.()) {
      view.webContents.close?.({ waitForBeforeUnload: false });
    }
    view = null;
    loadPromise = null;
  }

  function ensureView() {
    if (view) {
      return view;
    }

    view = new WebContentsView({
      webPreferences: {
        preload: path.resolve(preloadPath),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });
    protectSettingsNavigation(view.webContents, {
      settingsPageUrl,
      openExternal: (url) => shell.openExternal(url),
    });
    loadPromise = Promise.resolve(view.webContents.loadFile(settingsPagePath)).catch((error) => {
      loadPromise = null;
      throw error;
    });
    return view;
  }

  async function buildModel({ preferences: preferencesOverride } = {}) {
    const initialModel = await buildInitialModel({ preferences: preferencesOverride });
    const status = await getStatus(initialModel.resolvedLanguage);
    return {
      ...initialModel,
      status: isRecord(status) ? status : {},
    };
  }

  async function buildInitialModel({ preferences: preferencesOverride } = {}) {
    const languageContext = await buildLanguageContext({
      preferences: preferencesOverride,
    });
    const content = await getContent(languageContext.resolvedLanguage);
    return {
      preferences: languageContext.preferences,
      resolvedLanguage: languageContext.resolvedLanguage,
      status: {},
      helpSections: Array.isArray(content?.helpSections) ? content.helpSections : [],
      shortcutGroups: Array.isArray(content?.shortcutGroups) ? content.shortcutGroups : [],
    };
  }

  async function buildLanguageContext({ preferences: preferencesOverride } = {}) {
    const [preferencesValue, systemLanguages] = await Promise.all([
      preferencesOverride ?? getPreferences(),
      getSystemLanguages(),
    ]);
    const preferences = normalizeSettingsPreferences(preferencesValue);
    return {
      preferences,
      resolvedLanguage: resolveLanguagePreference(preferences.language, {
        systemLanguages,
      }),
    };
  }

  async function applyInitialTheme(currentView, preferences) {
    const normalized = normalizeSettingsPreferences(preferences);
    const theme = effectiveColorScheme(normalized.colorMode, {
      systemDark: getSystemDark() === true,
    });
    const script = [
      `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`,
      `document.documentElement.dataset.colorMode = ${JSON.stringify(normalized.colorMode)}`,
    ].join("; ");
    await Promise.resolve(currentView.webContents.executeJavaScript?.(script)).catch(() => {});
  }

  async function sendStatusWhenReady(generation, hydrationGeneration, resolvedLanguage) {
    try {
      const status = await getStatus(resolvedLanguage);
      if (
        !view
        || !visible
        || destroyed
        || generation !== showGeneration
        || hydrationGeneration !== statusHydrationGeneration
      ) {
        return false;
      }
      view.webContents.send(SETTINGS_CENTER_CHANNELS.show, {
        status: isRecord(status) ? status : {},
      });
      return true;
    } catch {
      return false;
    }
  }

  function installIpcHandlers() {
    ipcMain.handle(SETTINGS_CENTER_CHANNELS.getModel, async (event) => {
      requireSettingsSender(event);
      return buildModel();
    });
    ipcMain.handle(SETTINGS_CENTER_CHANNELS.updatePreferences, async (event, value) => {
      requireSettingsSender(event);
      const patch = normalizeSettingsPreferencePatch(value);
      if (Object.keys(patch).length === 0) {
        return {
          ok: false,
          preferences: normalizeSettingsPreferences(await getPreferences()),
        };
      }

      if (Object.hasOwn(patch, "language")) {
        statusHydrationGeneration += 1;
      }
      const saved = await savePreferences(patch);
      const preferences = normalizeSettingsPreferences(
        saved ?? { ...await getPreferences(), ...patch },
      );
      if (Object.hasOwn(patch, "language")) {
        const model = await buildModel({ preferences });
        return {
          ok: true,
          preferences: model.preferences,
          model,
        };
      }
      return { ok: true, preferences };
    });
    ipcMain.handle(SETTINGS_CENTER_CHANNELS.action, async (event, value) => {
      requireSettingsSender(event);
      const action = normalizeSettingsAction(value);
      if (!action) {
        throw new Error("Unsupported settings center action.");
      }
      if (action.type === "close") {
        hide();
        return { ok: true };
      }
      if (action.type === "check-for-updates") {
        return {
          ok: true,
          result: await checkForUpdates(),
        };
      }
      await shell.openExternal(action.url);
      return { ok: true };
    });
  }

  function removeIpcHandlers() {
    for (const channel of [
      SETTINGS_CENTER_CHANNELS.getModel,
      SETTINGS_CENTER_CHANNELS.updatePreferences,
      SETTINGS_CENTER_CHANNELS.action,
    ]) {
      ipcMain.removeHandler?.(channel);
    }
  }

  function requireSettingsSender(event) {
    if (!view || event?.sender !== view.webContents || view.webContents.isDestroyed?.()) {
      throw new Error("Settings center IPC sender is not authorized.");
    }
  }

  function assertActive() {
    if (destroyed) {
      throw new Error("Settings center has been destroyed.");
    }
    if (mainWindow.isDestroyed?.()) {
      throw new Error("Settings center window is no longer available.");
    }
  }

  return {
    show,
    hide,
    resize,
    refresh,
    destroy,
    get visible() {
      return visible;
    },
    get section() {
      return activeSection;
    },
    get webContents() {
      return view?.webContents ?? null;
    },
  };
}

export const createDesktopSettingsCenter = createSettingsCenterController;

function protectSettingsNavigation(webContents, { settingsPageUrl, openExternal }) {
  const routeExternal = (value) => {
    const url = normalizeExternalUrl(value);
    if (url) {
      void Promise.resolve(openExternal(url)).catch(() => {});
    }
  };

  webContents.setWindowOpenHandler(({ url }) => {
    routeExternal(url);
    return { action: "deny" };
  });

  const blockUnexpectedNavigation = (event, url) => {
    if (sameSettingsDocument(url, settingsPageUrl)) {
      return;
    }
    event.preventDefault();
    routeExternal(url);
  };
  webContents.on("will-navigate", blockUnexpectedNavigation);
  webContents.on("will-redirect", blockUnexpectedNavigation);
  webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function sameSettingsDocument(value, settingsPageUrl) {
  try {
    const candidate = new URL(String(value ?? ""));
    candidate.hash = "";
    const expected = new URL(settingsPageUrl);
    expected.hash = "";
    return candidate.href === expected.href;
  } catch {
    return false;
  }
}

function settingsPreferenceSource(value) {
  if (!isRecord(value)) {
    return {};
  }
  return isRecord(value.preferences) ? value.preferences : value;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireControllerDependency(value, name) {
  if (!value) {
    throw new Error(`${name} is required to create the settings center.`);
  }
}
