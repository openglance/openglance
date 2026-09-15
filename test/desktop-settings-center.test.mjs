import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  SETTINGS_CENTER_CHANNELS,
  SETTINGS_CENTER_DEFAULT_PREFERENCES,
  createSettingsCenterController,
  normalizeExternalUrl,
  normalizeSettingsAction,
  normalizeSettingsPreferencePatch,
  normalizeSettingsPreferences,
  normalizeSettingsSection,
} from "../src/desktop/settings-center.mjs";
import { DEFAULT_USER_PREFERENCES } from "../public/settings-preferences.js";

const ROOT = path.join(import.meta.dirname, "..");
const SETTINGS_PAGE_PATH = path.join(ROOT, "src", "desktop", "settings", "index.html");
const SETTINGS_PRELOAD_PATH = path.join(ROOT, "src", "desktop", "settings", "preload.cjs");

test("settings center normalizes sections and reuses the shared fresh preference defaults", () => {
  assert.equal(normalizeSettingsSection("general"), "general");
  assert.equal(normalizeSettingsSection("appearance"), "appearance");
  assert.equal(normalizeSettingsSection(" SHORTCUTS "), "shortcuts");
  assert.equal(normalizeSettingsSection("unknown"), "general");
  assert.equal(normalizeSettingsSection("unknown", "status"), "status");

  assert.strictEqual(SETTINGS_CENTER_DEFAULT_PREFERENCES, DEFAULT_USER_PREFERENCES);
  assert.deepEqual(normalizeSettingsPreferences({}), DEFAULT_USER_PREFERENCES);
  assert.deepEqual(
    normalizeSettingsPreferences({
      preferences: {
        language: "zh-CN",
        colorMode: "dark",
        documentFont: "reading-serif",
        documentFontSize: 20,
        documentMargins: "wide",
        fileTreeMode: "all",
        showDocumentTitles: false,
        gitRemoteCheckIntervalMinutes: 30,
      },
    }),
    {
      language: "zh-CN",
      colorMode: "dark",
      documentFont: "reading-serif",
      documentFontSize: 20,
      documentMargins: "wide",
      fileTreeMode: "all",
      showDocumentTitles: false,
      gitRemoteCheckIntervalMinutes: 30,
    },
  );
});

test("settings preference patches and actions expose only approved values", () => {
  assert.deepEqual(
    normalizeSettingsPreferencePatch({
      colorMode: "dark",
      language: "en",
      documentFont: "reading-serif",
      documentFontSize: 22,
      documentMargins: "wide",
      fileTreeMode: "all",
      showDocumentTitles: false,
      gitRemoteCheckIntervalMinutes: 60,
      documentTextSize: 18,
      fileVisibility: "content",
      arbitrary: "value",
    }),
    {
      colorMode: "dark",
      language: "en",
      documentFont: "reading-serif",
      documentFontSize: 22,
      documentMargins: "wide",
      fileTreeMode: "all",
      showDocumentTitles: false,
      gitRemoteCheckIntervalMinutes: 60,
    },
  );
  assert.deepEqual(normalizeSettingsPreferencePatch({ documentFontSize: 99 }), {
    documentFontSize: DEFAULT_USER_PREFERENCES.documentFontSize,
  });
  assert.deepEqual(normalizeSettingsPreferencePatch({
    gitRemoteCheckIntervalMinutes: 15,
  }), {
    gitRemoteCheckIntervalMinutes: DEFAULT_USER_PREFERENCES.gitRemoteCheckIntervalMinutes,
  });
  assert.deepEqual(normalizeSettingsPreferencePatch(null), {});

  assert.deepEqual(normalizeSettingsAction("close"), { type: "close" });
  assert.deepEqual(normalizeSettingsAction("check-for-updates"), { type: "check-for-updates" });
  assert.deepEqual(normalizeSettingsAction({ type: "open-external", url: "https://example.com/help" }), {
    type: "open-external",
    url: "https://example.com/help",
  });
  assert.equal(normalizeSettingsAction({ type: "open-external", url: "file:///tmp/private" }), null);
  assert.equal(normalizeSettingsAction({ type: "execute", code: "danger" }), null);
  assert.equal(normalizeExternalUrl("javascript:alert(1)"), "");
  assert.equal(normalizeExternalUrl("mailto:help@example.com"), "mailto:help@example.com");
});

test("settings controller lazily creates, shows, resizes, hides, reuses, and destroys its view", async () => {
  const harness = createHarness();
  const controller = harness.createController();

  assert.equal(harness.views.length, 0);
  assert.equal(controller.visible, false);

  const firstShow = await controller.show("shortcuts");
  assert.equal(firstShow.shown, true);
  assert.equal(firstShow.section, "shortcuts");
  assert.equal(controller.visible, true);
  assert.equal(controller.section, "shortcuts");
  assert.equal(harness.views.length, 1);
  assert.equal(harness.mainWindow.contentView.children.length, 1);
  assert.deepEqual(harness.views[0].options.webPreferences, {
    preload: SETTINGS_PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
  });
  assert.deepEqual(harness.views[0].bounds, { x: 0, y: 0, width: 1280, height: 860 });
  assert.deepEqual(harness.views[0].webContents.loadedFiles, [SETTINGS_PAGE_PATH]);
  const initialMessage = harness.views[0].webContents.messages.find(
    (message) => message.payload.model,
  );
  assert.equal(initialMessage.channel, SETTINGS_CENTER_CHANNELS.show);
  assert.equal(initialMessage.payload.section, "shortcuts");
  assert.equal(initialMessage.payload.model.resolvedLanguage, "en");
  assert.equal(harness.views[0].webContents.focusCount, 1);
  assert.match(harness.views[0].webContents.executedScripts[0], /dataset\.theme = "light"/);

  await new Promise((resolve) => setImmediate(resolve));
  const statusMessage = harness.views[0].webContents.messages.find(
    (message) => message.payload.status && !message.payload.model,
  );
  assert.equal(Object.hasOwn(statusMessage.payload, "section"), false);

  await controller.show("status");
  assert.equal(harness.views.length, 1, "the settings view should be reused");
  assert.equal(harness.mainWindow.contentView.children.length, 1);
  assert.equal(controller.section, "status");

  harness.mainWindow.bounds = { width: 1024, height: 700 };
  assert.equal(controller.resize(), true);
  assert.deepEqual(harness.views[0].bounds, { x: 0, y: 0, width: 1024, height: 700 });

  assert.equal(controller.hide(), true);
  assert.equal(controller.visible, false);
  assert.equal(harness.mainWindow.contentView.children.length, 0);
  assert.equal(harness.mainWindow.webContents.focusCount, 1);

  await controller.show("invalid-section");
  assert.equal(controller.section, "general");
  assert.equal(harness.views.length, 1);

  controller.destroy();
  assert.equal(controller.visible, false);
  assert.equal(harness.views[0].webContents.closed, true);
  assert.deepEqual([...harness.ipcMain.handlers.keys()], []);
  await assert.rejects(() => controller.show("appearance"), /destroyed/);
});

test("settings controller blocks arbitrary navigation and sends external URLs through shell", async () => {
  const harness = createHarness();
  const controller = harness.createController();
  await controller.show("appearance");
  const webContents = harness.views[0].webContents;

  assert.deepEqual(webContents.windowOpenHandler({ url: "https://example.com/docs" }), { action: "deny" });
  assert.deepEqual(webContents.windowOpenHandler({ url: "file:///tmp/secret" }), { action: "deny" });
  assert.deepEqual(harness.openedUrls, ["https://example.com/docs"]);

  const externalEvent = preventableEvent();
  webContents.emit("will-navigate", externalEvent, "mailto:help@example.com");
  assert.equal(externalEvent.prevented, true);
  assert.deepEqual(harness.openedUrls, ["https://example.com/docs", "mailto:help@example.com"]);

  const internalEvent = preventableEvent();
  webContents.emit("will-navigate", internalEvent, pathToFileURL(SETTINGS_PAGE_PATH).href);
  assert.equal(internalEvent.prevented, false);

  const scriptEvent = preventableEvent();
  webContents.emit("will-redirect", scriptEvent, "javascript:alert(1)");
  assert.equal(scriptEvent.prevented, true);
  assert.deepEqual(harness.openedUrls, ["https://example.com/docs", "mailto:help@example.com"]);

  const webviewEvent = preventableEvent();
  webContents.emit("will-attach-webview", webviewEvent);
  assert.equal(webviewEvent.prevented, true);
  controller.destroy();
});

test("settings controller can be destroyed after its parent window has closed", async () => {
  const harness = createHarness();
  const controller = harness.createController();
  await controller.show("appearance");

  harness.mainWindow.destroyed = true;
  harness.mainWindow.contentView.removeChildView = () => {
    assert.fail("a destroyed BrowserWindow must not be asked to detach child views");
  };

  assert.doesNotThrow(() => controller.destroy());
  assert.equal(controller.visible, false);
  assert.equal(harness.views[0].webContents.closed, true);
  assert.deepEqual([...harness.ipcMain.handlers.keys()], []);
});

test("settings controller does not attach or steal focus when hidden during initial loading", async () => {
  let releasePreferences;
  const preferences = new Promise((resolve) => {
    releasePreferences = resolve;
  });
  const harness = createHarness({ getPreferences: async () => preferences });
  const controller = harness.createController();

  const showPromise = controller.show("appearance");
  controller.hide();
  releasePreferences(DEFAULT_USER_PREFERENCES);

  assert.deepEqual(await showPromise, { shown: false, section: "appearance" });
  assert.equal(harness.mainWindow.contentView.children.length, 0);
  assert.equal(harness.views[0].webContents.focusCount, 0);
});

test("settings status hydration cannot update or focus a view after it is hidden", async () => {
  let releaseStatus;
  const status = new Promise((resolve) => {
    releaseStatus = resolve;
  });
  const harness = createHarness({ getStatus: async () => status });
  const controller = harness.createController();

  await controller.show("status");
  const messagesBeforeHide = harness.views[0].webContents.messages.length;
  controller.hide();
  releaseStatus({ app: { version: { label: "版本", value: "1.0.0" } } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.views[0].webContents.messages.length, messagesBeforeHide);
  assert.equal(harness.views[0].webContents.focusCount, 1);
});

test("settings status hydration cannot overwrite a newly selected language", async () => {
  let currentPreferences = {
    ...DEFAULT_USER_PREFERENCES,
    language: "zh-CN",
  };
  let releaseChineseStatus;
  const chineseStatus = new Promise((resolve) => {
    releaseChineseStatus = resolve;
  });
  const harness = createHarness({
    getPreferences: async () => currentPreferences,
    savePreferences: async (patch) => {
      currentPreferences = { ...currentPreferences, ...patch };
      return currentPreferences;
    },
    getStatus: async (resolvedLanguage) => (
      resolvedLanguage === "zh-CN"
        ? chineseStatus
        : { app: { version: { label: "Version", value: "1.0.0" } } }
    ),
  });
  const controller = harness.createController();
  await controller.show("status");

  const result = await harness.ipcMain.invoke(
    SETTINGS_CENTER_CHANNELS.updatePreferences,
    controller.webContents,
    { language: "en" },
  );
  assert.equal(result.model.resolvedLanguage, "en");

  releaseChineseStatus({
    app: { version: { label: "版本", value: "1.0.0" } },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const statusOnlyMessages = harness.views[0].webContents.messages.filter(
    (message) => message.payload.status && !message.payload.model,
  );
  assert.deepEqual(statusOnlyMessages, []);
  controller.destroy();
});

test("settings IPC authorizes its own view and whitelists model, preference, and action calls", async () => {
  const savedPatches = [];
  const contentLanguages = [];
  const statusLanguages = [];
  let currentPreferences = {
    ...DEFAULT_USER_PREFERENCES,
    language: "system",
    documentFontSize: 17,
  };
  let updateChecks = 0;
  const harness = createHarness({
    getPreferences: async () => currentPreferences,
    savePreferences: async (patch) => {
      savedPatches.push(patch);
      currentPreferences = { ...currentPreferences, ...patch };
      return { preferences: currentPreferences };
    },
    getSystemLanguages: () => ["zh-Hans-CN", "en-US"],
    getStatus: async (resolvedLanguage) => {
      statusLanguages.push(resolvedLanguage);
      return { repository: { name: "git-leaf", branch: "main" } };
    },
    getContent: async (resolvedLanguage) => {
      contentLanguages.push(resolvedLanguage);
      return {
        helpSections: [{
          title: resolvedLanguage === "zh-CN" ? "仓库文件" : "Repository files",
          body: ["帮助内容"],
        }],
        shortcutGroups: [{ title: "Help", shortcuts: [{ keys: "Command+?", action: "Help" }] }],
      };
    },
    checkForUpdates: async () => {
      updateChecks += 1;
      return { state: "current", message: "OpenGlance 已经是最新版本。" };
    },
  });
  const controller = harness.createController();
  await controller.show("help");
  const sender = controller.webContents;

  const model = await harness.ipcMain.invoke(SETTINGS_CENTER_CHANNELS.getModel, sender);
  assert.equal(model.preferences.documentFontSize, 17);
  assert.equal(model.resolvedLanguage, "zh-CN");
  assert.equal(model.status.repository.name, "git-leaf");
  assert.equal(model.helpSections[0].title, "仓库文件");
  assert.equal(model.shortcutGroups[0].shortcuts[0].keys, "Command+?");
  assert.deepEqual(contentLanguages, ["zh-CN", "zh-CN"]);
  assert.deepEqual(statusLanguages, ["zh-CN", "zh-CN"]);

  await assert.rejects(
    () => harness.ipcMain.invoke(SETTINGS_CENTER_CHANNELS.getModel, {}),
    /not authorized/,
  );

  const saveResult = await harness.ipcMain.invoke(
    SETTINGS_CENTER_CHANNELS.updatePreferences,
    sender,
    {
      colorMode: "dark",
      documentFontSize: 20,
      fileTreeMode: "all",
      gitRemoteCheckIntervalMinutes: 30,
      ignored: "value",
    },
  );
  assert.deepEqual(savedPatches, [{
    colorMode: "dark",
    documentFontSize: 20,
    fileTreeMode: "all",
    gitRemoteCheckIntervalMinutes: 30,
  }]);
  assert.equal(saveResult.ok, true);
  assert.equal(saveResult.preferences.colorMode, "dark");

  const languageResult = await harness.ipcMain.invoke(
    SETTINGS_CENTER_CHANNELS.updatePreferences,
    sender,
    { language: "en" },
  );
  assert.deepEqual(savedPatches.at(-1), { language: "en" });
  assert.equal(languageResult.ok, true);
  assert.equal(languageResult.preferences.language, "en");
  assert.equal(languageResult.model.resolvedLanguage, "en");
  assert.equal(languageResult.model.helpSections[0].title, "Repository files");
  assert.deepEqual(contentLanguages.at(-1), "en");
  assert.deepEqual(statusLanguages.at(-1), "en");

  await harness.ipcMain.invoke(
    SETTINGS_CENTER_CHANNELS.action,
    sender,
    { type: "open-external", url: "https://example.com/status" },
  );
  assert.equal(harness.openedUrls.at(-1), "https://example.com/status");

  const updateResult = await harness.ipcMain.invoke(
    SETTINGS_CENTER_CHANNELS.action,
    sender,
    { type: "check-for-updates" },
  );
  assert.equal(updateChecks, 1);
  assert.deepEqual(updateResult, {
    ok: true,
    result: { state: "current", message: "OpenGlance 已经是最新版本。" },
  });
  await assert.rejects(
    () => harness.ipcMain.invoke(
      SETTINGS_CENTER_CHANNELS.action,
      sender,
      { type: "open-external", url: "file:///tmp/secret" },
    ),
    /Unsupported settings center action/,
  );

  assert.equal(controller.visible, true);
  await harness.ipcMain.invoke(SETTINGS_CENTER_CHANNELS.action, sender, { type: "close" });
  assert.equal(controller.visible, false);
  controller.destroy();
});

test("settings page and preload keep a bounded renderer security surface", async () => {
  const [html, preload] = await Promise.all([
    readFile(SETTINGS_PAGE_PATH, "utf8"),
    readFile(SETTINGS_PRELOAD_PATH, "utf8"),
  ]);

  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("openGlanceSettings"/);
  assert.match(preload, /getModel\(\)/);
  assert.match(preload, /updatePreferences\(patch\)/);
  assert.match(preload, /close\(\)/);
  assert.match(preload, /checkForUpdates\(\)/);
  assert.match(preload, /openExternal\(url\)/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^\n]*ipcRenderer/);
});

test("settings help is one continuous document with chapter navigation and a file-type table", async () => {
  const [html, styles, renderer] = await Promise.all([
    readFile(SETTINGS_PAGE_PATH, "utf8"),
    readFile(path.join(ROOT, "src", "desktop", "settings", "styles.css"), "utf8"),
    readFile(path.join(ROOT, "src", "desktop", "settings", "renderer.js"), "utf8"),
  ]);

  assert.match(html, /id="help-navigation"[^>]*class="help-navigation"/);
  assert.match(html, /id="help-sections"[^>]*class="help-document"/);
  assert.match(styles, /\.help-navigation\s*\{/);
  assert.match(styles, /\.help-document-section\s*\{/);
  assert.match(styles, /\.help-file-table\s*\{/);
  assert.doesNotMatch(styles, /\.help-card(?:\s*[,\{])/);
  assert.match(renderer, /function renderHelpNavigation\(/);
  assert.match(renderer, /function handleHelpNavigationClick\(/);
  assert.match(renderer, /function updateActiveHelpNavigation\(/);
  assert.match(renderer, /remainingScroll <= 2/);
  assert.match(renderer, /section\?\.fileTypes/);
});

function createHarness(overrides = {}) {
  const views = [];
  const openedUrls = [];
  const ipcMain = new FakeIpcMain();
  const mainWindow = {
    bounds: { width: 1280, height: 860 },
    destroyed: false,
    contentView: {
      children: [],
      addChildView(view) {
        if (!this.children.includes(view)) {
          this.children.push(view);
        }
      },
      removeChildView(view) {
        this.children = this.children.filter((candidate) => candidate !== view);
      },
    },
    webContents: {
      focusCount: 0,
      focus() {
        this.focusCount += 1;
      },
    },
    getContentBounds() {
      return { ...this.bounds, x: 100, y: 80 };
    },
    isDestroyed() {
      return this.destroyed;
    },
  };

  class FakeWebContentsView {
    constructor(options) {
      this.options = options;
      this.bounds = null;
      this.webContents = new FakeWebContents();
      views.push(this);
    }

    setBounds(bounds) {
      this.bounds = { ...bounds };
    }
  }

  return {
    views,
    openedUrls,
    ipcMain,
    mainWindow,
    createController() {
      return createSettingsCenterController({
        mainWindow,
        WebContentsView: FakeWebContentsView,
        ipcMain,
        shell: {
          async openExternal(url) {
            openedUrls.push(url);
          },
        },
        pagePath: SETTINGS_PAGE_PATH,
        preloadPath: SETTINGS_PRELOAD_PATH,
        getPreferences: overrides.getPreferences ?? (async () => DEFAULT_USER_PREFERENCES),
        savePreferences: overrides.savePreferences ?? (async (patch) => ({
          ...DEFAULT_USER_PREFERENCES,
          ...patch,
        })),
        getStatus: overrides.getStatus ?? (async () => ({})),
        getContent: overrides.getContent ?? (async () => ({})),
        checkForUpdates: overrides.checkForUpdates ?? (async () => ({})),
        getSystemLanguages: overrides.getSystemLanguages ?? (() => []),
      });
    },
  };
}

class FakeIpcMain {
  handlers = new Map();

  handle(channel, handler) {
    assert.equal(this.handlers.has(channel), false, `duplicate IPC handler: ${channel}`);
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  async invoke(channel, sender, ...args) {
    const handler = this.handlers.get(channel);
    assert.equal(typeof handler, "function", `missing IPC handler: ${channel}`);
    return handler({ sender }, ...args);
  }
}

class FakeWebContents extends EventEmitter {
  loadedFiles = [];
  messages = [];
  focusCount = 0;
  closed = false;
  executedScripts = [];
  windowOpenHandler = null;

  async loadFile(filePath) {
    this.loadedFiles.push(filePath);
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  send(channel, payload) {
    this.messages.push({ channel, payload });
  }

  async executeJavaScript(script) {
    this.executedScripts.push(script);
  }

  focus() {
    this.focusCount += 1;
  }

  isDestroyed() {
    return this.closed;
  }

  close() {
    this.closed = true;
  }
}

function preventableEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}
