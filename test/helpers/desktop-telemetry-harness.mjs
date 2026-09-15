import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Evaluate the actual desktop entry module, including its import bindings, with
// an isolated host, build, clock, timers, and transport. No installed App is opened.
export async function desktopTelemetryHarness({ userDataDir, argv, fetchFn, version = "3.2.4" }) {
  let now = new Date("2026-09-12T08:00:00Z");
  let monotonicMs = 0;
  let initialization;
  let client;
  let initialUpload;
  let periodicUpload;
  let focused = true;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getPath: () => userDataDir,
    getVersion: () => version,
    getSystemVersion: () => "15.0",
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: () => true,
    whenReady: () => new Promise(() => {}),
  });
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isVisible: () => true,
    isFocused: () => focused,
  });
  const powerMonitor = Object.assign(new EventEmitter(), {
    getSystemIdleState: () => "active",
    getSystemIdleTime: () => 0,
  });
  const mainUrl = new URL("../../src/desktop/main.mjs", import.meta.url);
  const source = await readFile(mainUrl, "utf8");
  const entry = new vm.SourceTextModule(`${source}
    export { initializeDesktopTelemetry, startDesktopTelemetryRuntime, recordTelemetryUpdateState };
    export function connectTelemetryWindow(window) {
      mainWindow = window;
      desktopRepositoryState = { usageAnalyticsEnabled: true };
    }
    export function telemetryRuntimeAvailable() { return Boolean(telemetryClient && telemetryUploadScheduler); }
  `, { identifier: mainUrl.href });
  await entry.link(async (specifier) => {
    const url = specifier.startsWith(".") ? new URL(specifier, mainUrl).href : specifier;
    let bindings;
    if (specifier === "electron") {
      bindings = Object.fromEntries([
        "autoUpdater", "BrowserWindow", "clipboard", "dialog", "ipcMain", "Menu", "nativeTheme",
        "shell", "systemPreferences", "WebContentsView",
      ].map((name) => [name, {}]));
      Object.assign(bindings, { app, powerMonitor });
    } else {
      bindings = { ...await import(url) };
    }
    if (specifier === "node:process") {
      bindings.default = { ...process, argv, platform: "darwin", arch: "arm64", env: {} };
    } else if (specifier === "./user-data.mjs") {
      bindings.applyStableUserDataPath = () => userDataDir;
      bindings.applyDevelopmentUserDataOverride = () => ({ applied: true });
    } else if (specifier === "./mac-update-installation.mjs") {
      bindings.configureMacUpdateInstallation = () => {};
    } else if (specifier === "./windows-app-install.mjs") {
      bindings.windowsAppBootstrapPlan = () => ({ status: "current" });
    } else if (specifier === "../build-info.mjs") {
      bindings.BUILD_INFO = {
        version, buildId: "test-release", distribution: "official", releaseTrack: "internal", dev: false,
      };
    } else if (specifier === "./telemetry.mjs") {
      const create = bindings.createTelemetryClient;
      const eligible = bindings.isTelemetryEnabled;
      bindings.isTelemetryEnabled = (options) => eligible({ ...options, environment: {} });
      bindings.createTelemetryClient = (options) => {
        client = create({ ...options, now: () => now, deviceName: "", fetchFn });
        const initialize = client.initialize;
        client.initialize = () => (initialization = initialize());
        return client;
      };
    } else if (specifier === "./telemetry-upload-scheduler.mjs") {
      const create = bindings.createTelemetryUploadScheduler;
      bindings.createTelemetryUploadScheduler = (options) => create({
        ...options,
        setTimeoutFn: (callback) => { initialUpload = callback; return 1; },
        setIntervalFn: (callback) => { periodicUpload = callback; return 2; },
        clearTimeoutFn: () => {}, clearIntervalFn: () => {},
      });
    } else if (specifier === "./telemetry-activity.mjs") {
      const create = bindings.createTelemetryActivityTracker;
      bindings.createTelemetryActivityTracker = (options) => create({
        ...options, clock: () => monotonicMs, getLocalDate: () => now.toISOString().slice(0, 10),
        setIntervalFn: () => 3, clearIntervalFn: () => {},
      });
    }
    return new vm.SyntheticModule(Object.keys(bindings), function () {
      for (const [key, value] of Object.entries(bindings)) this.setExport(key, value);
    });
  });
  await entry.evaluate();
  entry.namespace.connectTelemetryWindow(window);
  return {
    async start() {
      await entry.namespace.initializeDesktopTelemetry();
      await initialization;
      await Promise.resolve();
      entry.namespace.startDesktopTelemetryRuntime();
    },
    get available() { return entry.namespace.telemetryRuntimeAvailable(); },
    snapshot: () => client?.snapshot(),
    advance(milliseconds) { now = new Date(now.getTime() + milliseconds); monotonicMs += milliseconds; },
    setFocused(value) { focused = value; window.emit(value ? "focus" : "blur"); },
    initialUpload: () => initialUpload?.(),
    periodicUpload: () => periodicUpload?.(),
    async updateCheck() {
      await entry.namespace.recordTelemetryUpdateState({
        state: "check_started", trigger: "automatic", from_version: version,
      });
    },
    shutdown: () => client?.shutdown(),
  };
}
