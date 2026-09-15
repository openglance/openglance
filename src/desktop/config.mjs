import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_USER_PREFERENCES,
  LEGACY_USER_PREFERENCES,
  normalizeUserPreferences,
} from "../../public/settings-preferences.js";
import {
  applySidebarFavoriteOperation,
  normalizeSidebarFavoriteScopes,
} from "../../public/sidebar-favorites.js";
import { normalizeWorkbenchSessions } from "../../public/workbench-session.js";
import {
  normalizeDevelopmentHandoffReceipt,
  sameDevelopmentHandoffReceipt,
} from "./development-handoff.mjs";

const CONFIG_FILENAME = "desktop-config.json";
const CONFIG_BACKUP_FILENAME = "desktop-config.backup.json";
const configMutationQueues = new Map();

export function desktopConfigPath(userDataDir) {
  return path.join(userDataDir, CONFIG_FILENAME);
}

export function desktopConfigBackupPath(userDataDir) {
  return path.join(userDataDir, CONFIG_BACKUP_FILENAME);
}

export async function readDesktopConfig({ userDataDir }) {
  const configPath = desktopConfigPath(userDataDir);
  const primary = await inspectDesktopConfigFile(configPath);
  if (primary.status === "valid") {
    return normalizeDesktopConfig(primary.payload, { newInstall: false });
  }

  const backupPath = desktopConfigBackupPath(userDataDir);
  const backup = await inspectDesktopConfigFile(backupPath);
  if (backup.status === "valid") {
    return normalizeDesktopConfig(backup.payload, { newInstall: false });
  }

  if (primary.status === "missing" && backup.status === "missing") {
    return normalizeDesktopConfig({}, { newInstall: true });
  }

  throw invalidDesktopConfigError({ configPath, primary, backupPath, backup });
}

export async function saveDesktopRepository({ userDataDir, repoRoot, repositoryRoot = repoRoot }) {
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const next = normalizeDesktopConfig({
        ...current,
        repoRoot,
        openRepoRoots: [...current.openRepoRoots, repositoryRoot],
      });

      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export async function reorderDesktopRepositories({ userDataDir, openRepoRoots }) {
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const requestedValues = arrayOfStrings(openRepoRoots);
      const requestedRoots = uniqueRepoRoots(requestedValues);
      if (
        !Array.isArray(openRepoRoots)
        || requestedValues.length !== openRepoRoots.length
        || requestedRoots.length !== requestedValues.length
        || !sameStringSet(current.openRepoRoots, requestedRoots)
      ) {
        return current;
      }
      if (current.openRepoRoots.every((repoRoot, index) => repoRoot === requestedRoots[index])) {
        return current;
      }

      const next = normalizeDesktopConfig({
        ...current,
        openRepoRoots: requestedRoots,
      });
      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export async function saveDesktopWindowState({ userDataDir, windowState, repoRoot = "" }) {
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const next = normalizeDesktopConfig({
        ...withRuntimeRepository(current, repoRoot),
        windowState,
      });

      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export async function saveDesktopPreferences({ userDataDir, preferences, repoRoot = "" }) {
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const nextPreferences = {
        ...current.preferences,
        ...preferences,
      };
      if (preferences && Object.hasOwn(preferences, "colorMode")) {
        delete nextPreferences.legacyThemeMigrationPending;
      }
      const next = normalizeDesktopConfig({
        ...withRuntimeRepository(current, repoRoot),
        preferences: nextPreferences,
      });

      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export async function mutateDesktopRepositoryFavorites({
  userDataDir,
  repositoryRoot,
  operation,
  repoRoot = "",
}) {
  if (typeof repositoryRoot !== "string" || !repositoryRoot.trim()) {
    throw new TypeError("repositoryRoot is required to update favorites");
  }
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const result = applySidebarFavoriteOperation(current.repositoryFavorites, {
        ...operation,
        scope: repositoryRoot,
      });
      const next = normalizeDesktopConfig({
        ...withRuntimeRepository(current, repoRoot),
        repositoryFavorites: result.scopes,
      });

      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export async function saveDesktopUsageAnalyticsEnabled({
  userDataDir,
  enabled,
  repoRoot = "",
}) {
  if (typeof enabled !== "boolean") {
    throw new TypeError("usageAnalyticsEnabled must be a boolean");
  }
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const next = normalizeDesktopConfig({
        ...withRuntimeRepository(current, repoRoot),
        usageAnalyticsEnabled: enabled,
      });

      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export async function saveDesktopDevelopmentHandoff({
  userDataDir,
  handoff,
  repoRoot = "",
}) {
  const normalizedHandoff = normalizeDevelopmentHandoffReceipt(handoff);
  if (!normalizedHandoff) {
    throw new TypeError("developmentHandoff must contain a valid target identity");
  }
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const next = normalizeDesktopConfig({
        ...withRuntimeRepository(current, repoRoot),
        developmentHandoff: normalizedHandoff,
      });

      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export async function prepareDesktopDevelopmentHandoffInstallation({
  userDataDir,
  handoff,
  repoRoot = "",
}) {
  const normalizedHandoff = normalizeDevelopmentHandoffReceipt(handoff);
  if (!normalizedHandoff) {
    throw new TypeError("developmentHandoff must contain a valid target identity");
  }
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const hadUsageAnalyticsSetting = Object.hasOwn(
        current,
        "usageAnalyticsEnabled",
      );
      const previousUsageAnalyticsEnabled = current.usageAnalyticsEnabled;
      if (!sameDevelopmentHandoffReceipt(
        current.developmentHandoff,
        normalizedHandoff,
      )) {
        return {
          prepared: false,
          config: current,
          hadUsageAnalyticsSetting,
          previousUsageAnalyticsEnabled,
        };
      }

      const nextPayload = {
        ...withRuntimeRepository(current, repoRoot),
      };
      delete nextPayload.developmentHandoff;
      delete nextPayload.usageAnalyticsEnabled;
      const next = normalizeDesktopConfig(nextPayload);
      await writeDesktopConfig({ userDataDir, config: next });
      return {
        prepared: true,
        config: next,
        hadUsageAnalyticsSetting,
        previousUsageAnalyticsEnabled,
      };
    },
  });
}

export async function restoreDesktopDevelopmentHandoffInstallation({
  userDataDir,
  handoff,
  hadUsageAnalyticsSetting = false,
  previousUsageAnalyticsEnabled = false,
  repoRoot = "",
}) {
  const normalizedHandoff = normalizeDevelopmentHandoffReceipt(handoff);
  if (!normalizedHandoff) {
    throw new TypeError("developmentHandoff must contain a valid target identity");
  }
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const nextPayload = {
        ...withRuntimeRepository(current, repoRoot),
        developmentHandoff: normalizedHandoff,
      };
      if (hadUsageAnalyticsSetting) {
        nextPayload.usageAnalyticsEnabled =
          previousUsageAnalyticsEnabled === true;
      } else {
        delete nextPayload.usageAnalyticsEnabled;
      }
      const next = normalizeDesktopConfig(nextPayload);
      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

function withRuntimeRepository(config, repoRoot) {
  if (!repoRoot) {
    return config;
  }

  return {
    ...config,
    repoRoot,
  };
}

export async function closeDesktopRepository({
  userDataDir,
  repoRoot,
  repositoryRoot = repoRoot,
}) {
  return queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      const current = await readDesktopConfig({ userDataDir });
      const openRepoRoots = current.openRepoRoots.filter(
        (candidate) => candidate !== repositoryRoot,
      );
      const nextPayload = {
        ...current,
        openRepoRoots,
      };
      if (current.repoRoot === repoRoot) {
        delete nextPayload.repoRoot;
      }
      const next = normalizeDesktopConfig(nextPayload);

      await writeDesktopConfig({ userDataDir, config: next });
      return next;
    },
  });
}

export function queueDesktopConfigMutation({ userDataDir, mutation }) {
  const queueKey = path.resolve(userDataDir);
  const previous = configMutationQueues.get(queueKey) ?? Promise.resolve();
  const operation = previous.then(mutation);
  const queueTail = operation.catch(() => undefined);

  configMutationQueues.set(queueKey, queueTail);
  void queueTail.then(() => {
    if (configMutationQueues.get(queueKey) === queueTail) {
      configMutationQueues.delete(queueKey);
    }
  });

  return operation;
}

async function writeDesktopConfig({ userDataDir, config }) {
  await mkdir(userDataDir, { recursive: true });
  const configPath = desktopConfigPath(userDataDir);
  const backupPath = desktopConfigBackupPath(userDataDir);
  const serializedConfig = `${JSON.stringify(configPayload(config), null, 2)}\n`;
  const primary = await inspectDesktopConfigFile(configPath);
  const backup = await inspectDesktopConfigFile(backupPath);

  if (primary.status === "invalid" && backup.status !== "valid") {
    throw invalidDesktopConfigError({ configPath, primary, backupPath, backup });
  }
  if (primary.status === "missing" && backup.status === "invalid") {
    throw invalidDesktopConfigError({ configPath, primary, backupPath, backup });
  }

  if (primary.status === "valid") {
    await atomicWriteFile(backupPath, primary.source);
  } else if (primary.status === "missing" && backup.status === "missing") {
    await atomicWriteFile(backupPath, serializedConfig);
  }
  await atomicWriteFile(configPath, serializedConfig);
}

async function inspectDesktopConfigFile(filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }

  try {
    const payload = JSON.parse(source);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("Desktop config root must be a JSON object");
    }
    return { status: "valid", payload, source };
  } catch (error) {
    return { status: "invalid", error };
  }
}

async function atomicWriteFile(filePath, content) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

function invalidDesktopConfigError({ configPath, primary, backupPath, backup }) {
  const error = new Error(
    `Desktop config is invalid and no valid backup is available: ${configPath} (backup: ${backupPath})`,
    { cause: primary.error ?? backup.error },
  );
  error.code = "DESKTOP_CONFIG_INVALID";
  return error;
}

export function normalizeDesktopConfig(payload, { newInstall = false } = {}) {
  const source = objectRecord(payload);
  const unknownFields = { ...source };
  for (const key of [
    "repoRoot",
    "recentRepoRoots",
    "openRepoRoots",
    "windowState",
    "preferences",
    "repositoryFavorites",
    "usageAnalyticsEnabled",
    "developmentHandoff",
  ]) {
    delete unknownFields[key];
  }

  const repoRoot = typeof source.repoRoot === "string" && source.repoRoot
    ? source.repoRoot
    : "";
  const openRepoRoots = uniqueRepoRoots(arrayOfStrings(source.openRepoRoots));
  const windowState = normalizeDesktopWindowState(source.windowState);
  const preferences = normalizeDesktopPreferences(source.preferences, { newInstall });
  const repositoryFavorites = normalizeSidebarFavoriteScopes(source.repositoryFavorites);
  const usageAnalyticsEnabled = typeof source.usageAnalyticsEnabled === "boolean"
    ? source.usageAnalyticsEnabled
    : null;
  const developmentHandoff = normalizeDevelopmentHandoffReceipt(
    source.developmentHandoff,
  );

  return {
    ...unknownFields,
    ...(repoRoot ? { repoRoot } : {}),
    openRepoRoots,
    ...(windowState ? { windowState } : {}),
    ...(Object.keys(preferences).length > 0 ? { preferences } : {}),
    ...(Object.keys(repositoryFavorites).length > 0 ? { repositoryFavorites } : {}),
    ...(usageAnalyticsEnabled === null ? {} : { usageAnalyticsEnabled }),
    ...(developmentHandoff ? { developmentHandoff } : {}),
  };
}

function configPayload(config) {
  return {
    ...config,
    ...(config.preferences ? { preferences: { ...config.preferences } } : {}),
  };
}

function normalizeDesktopWindowState(value) {
  const bounds = normalizeWindowBounds(value?.bounds);
  if (!bounds) {
    return null;
  }

  return {
    bounds,
    isMaximized: value?.isMaximized === true,
    ...(value?.isFullScreen === true ? { isFullScreen: true } : {}),
  };
}

function normalizeWindowBounds(value) {
  const width = positiveInteger(value?.width);
  const height = positiveInteger(value?.height);
  if (!width || !height) {
    return null;
  }

  const x = integer(value?.x);
  const y = integer(value?.y);
  return {
    ...(x === null ? {} : { x }),
    ...(y === null ? {} : { y }),
    width,
    height,
  };
}

function normalizeDesktopPreferences(value, { newInstall = false } = {}) {
  const source = objectRecord(value);
  const preferences = { ...source };
  for (const key of [
    "theme",
    "language",
    "colorMode",
    "documentFont",
    "documentFontSize",
    "documentMargins",
    "fileTreeMode",
    "showDocumentTitles",
    "gitRemoteCheckIntervalMinutes",
    "legacyThemeMigrationPending",
    "mode",
    "treeDirectories",
    "workbenchSessions",
    "sidebarWidth",
    "sidebarCollapsed",
    "documentOutlineWidth",
    "documentOutlineCollapsed",
    "sourcePreviewRatio",
    "updateAvailableVersion",
    "updateRequestedVersion",
    "skippedUpdateVersion",
    "promptedUpdateVersion",
  ]) {
    delete preferences[key];
  }
  Object.assign(preferences, normalizeUserPreferences(source, {
    defaults: newInstall ? DEFAULT_USER_PREFERENCES : LEGACY_USER_PREFERENCES,
  }));
  const legacyThemeMigrationPending = source.legacyThemeMigrationPending === true || (
    !newInstall &&
    !Object.hasOwn(source, "colorMode") &&
    !Object.hasOwn(source, "theme")
  );
  const mode = normalizeMode(source.mode);
  const treeDirectories = normalizeTreeDirectories(source.treeDirectories);
  const workbenchSessions = normalizeWorkbenchSessions(source.workbenchSessions);
  const sidebarWidth = positiveInteger(source.sidebarWidth);
  const documentOutlineWidth = positiveInteger(source.documentOutlineWidth);
  const sidebarCollapsed = typeof source.sidebarCollapsed === "boolean"
    ? source.sidebarCollapsed
    : null;
  const documentOutlineCollapsed = typeof source.documentOutlineCollapsed === "boolean"
    ? source.documentOutlineCollapsed
    : null;
  const sourcePreviewRatio = boundedNumber(source.sourcePreviewRatio, 25, 75);
  const updateAvailableVersion = nonEmptyString(source.updateAvailableVersion);
  const updateRequestedVersion = nonEmptyString(source.updateRequestedVersion);
  const skippedUpdateVersion = nonEmptyString(source.skippedUpdateVersion);
  const promptedUpdateVersion = nonEmptyString(source.promptedUpdateVersion);

  if (legacyThemeMigrationPending) {
    preferences.legacyThemeMigrationPending = true;
  }

  if (mode) {
    preferences.mode = mode;
  }
  if (Object.keys(treeDirectories).length > 0) {
    preferences.treeDirectories = treeDirectories;
  }
  if (Object.keys(workbenchSessions).length > 0) {
    preferences.workbenchSessions = workbenchSessions;
  }
  if (sidebarWidth) {
    preferences.sidebarWidth = sidebarWidth;
  }
  if (documentOutlineWidth) {
    preferences.documentOutlineWidth = documentOutlineWidth;
  }
  if (sidebarCollapsed !== null) {
    preferences.sidebarCollapsed = sidebarCollapsed;
  }
  if (documentOutlineCollapsed !== null) {
    preferences.documentOutlineCollapsed = documentOutlineCollapsed;
  }
  if (sourcePreviewRatio !== null) {
    preferences.sourcePreviewRatio = sourcePreviewRatio;
  }
  if (updateAvailableVersion) {
    preferences.updateAvailableVersion = updateAvailableVersion;
  }
  if (updateRequestedVersion) {
    preferences.updateRequestedVersion = updateRequestedVersion;
  }
  if (skippedUpdateVersion) {
    preferences.skippedUpdateVersion = skippedUpdateVersion;
  }
  if (promptedUpdateVersion) {
    preferences.promptedUpdateVersion = promptedUpdateVersion;
  }
  return preferences;
}

function normalizeMode(value) {
  return value === "preview" || value === "source" || value === "live" ? value : "";
}

function normalizeTreeDirectories(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const directories = {};
  for (const [scope, directoryState] of Object.entries(value).slice(0, 50)) {
    if (typeof scope !== "string" || !scope) {
      continue;
    }

    const expanded = uniqueRepoRoots(arrayOfStrings(directoryState?.expanded)).slice(0, 500);
    const collapsed = uniqueRepoRoots(arrayOfStrings(directoryState?.collapsed)).slice(0, 500);
    if (expanded.length > 0 || collapsed.length > 0) {
      directories[scope] = {
        ...(expanded.length > 0 ? { expanded } : {}),
        ...(collapsed.length > 0 ? { collapsed } : {}),
      };
    }
  }
  return directories;
}

function boundedNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    return null;
  }
  return number;
}

function positiveInteger(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function integer(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item)
    : [];
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function uniqueRepoRoots(values) {
  return [...new Set(values)];
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
