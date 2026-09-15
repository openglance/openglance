import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  closeDesktopRepository,
  desktopConfigBackupPath,
  desktopConfigPath,
  mutateDesktopRepositoryFavorites,
  queueDesktopConfigMutation,
  readDesktopConfig,
  prepareDesktopDevelopmentHandoffInstallation,
  reorderDesktopRepositories,
  restoreDesktopDevelopmentHandoffInstallation,
  saveDesktopDevelopmentHandoff,
  saveDesktopPreferences,
  saveDesktopRepository,
  saveDesktopUsageAnalyticsEnabled,
  saveDesktopWindowState,
} from "../src/desktop/config.mjs";

const INTERNAL_HANDOFF = {
  kind: "dev-to-internal",
  version: "1.16.0",
  buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
  commit: "2c3e9d8cfcfb",
  releaseTrack: "internal",
  channel: "internal-stable",
  platform: "darwin-universal",
};

const NEW_INSTALL_PREFERENCES = {
  language: "system",
  colorMode: "system",
  documentFont: "system-sans",
  documentFontSize: 16,
  documentMargins: "standard",
  fileTreeMode: "content",
  showDocumentTitles: true,
  gitRemoteCheckIntervalMinutes: 10,
};

const LEGACY_PREFERENCES = {
  language: "system",
  colorMode: "light",
  documentFont: "system-sans",
  documentFontSize: 16,
  documentMargins: "standard",
  fileTreeMode: "all",
  showDocumentTitles: true,
  gitRemoteCheckIntervalMinutes: 10,
};

const LEGACY_PENDING_PREFERENCES = {
  ...LEGACY_PREFERENCES,
  legacyThemeMigrationPending: true,
};

test("readDesktopConfig uses new-install preferences when no config exists", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [],
    preferences: NEW_INSTALL_PREFERENCES,
  });
});

test("usage analytics setting is explicit and survives unrelated config writes", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));

  await saveDesktopUsageAnalyticsEnabled({ userDataDir, enabled: false });
  await saveDesktopPreferences({
    userDataDir,
    preferences: { colorMode: "dark" },
  });

  const config = await readDesktopConfig({ userDataDir });
  assert.equal(config.usageAnalyticsEnabled, false);
  assert.equal(config.preferences.colorMode, "dark");
});

test("development handoff persistence preserves the shared human profile", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");
  await writeFile(desktopConfigPath(userDataDir), JSON.stringify({
    repoRoot,
    openRepoRoots: [repoRoot],
    usageAnalyticsEnabled: false,
    preferences: {
      colorMode: "dark",
      language: "zh-CN",
      workbenchSessions: {
        docs: {
          tabs: [{ path: "README.md" }],
          activeTabPath: "README.md",
        },
      },
    },
  }), "utf8");

  const saved = await saveDesktopDevelopmentHandoff({
    userDataDir,
    handoff: INTERNAL_HANDOFF,
    repoRoot,
  });

  assert.equal(saved.repoRoot, repoRoot);
  assert.deepEqual(saved.openRepoRoots, [repoRoot]);
  assert.equal(saved.preferences.colorMode, "dark");
  assert.equal(saved.preferences.language, "zh-CN");
  assert.equal(saved.usageAnalyticsEnabled, false);
  assert.deepEqual(saved.developmentHandoff, INTERNAL_HANDOFF);
});

test("install preparation atomically clears the dev analytics value and consumes the handoff", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await saveDesktopUsageAnalyticsEnabled({ userDataDir, enabled: false });
  await saveDesktopDevelopmentHandoff({
    userDataDir,
    handoff: INTERNAL_HANDOFF,
  });

  const result = await prepareDesktopDevelopmentHandoffInstallation({
    userDataDir,
    handoff: INTERNAL_HANDOFF,
  });

  assert.equal(result.prepared, true);
  assert.equal(result.hadUsageAnalyticsSetting, true);
  assert.equal(result.previousUsageAnalyticsEnabled, false);
  assert.equal(Object.hasOwn(result.config, "usageAnalyticsEnabled"), false);
  assert.equal(Object.hasOwn(result.config, "developmentHandoff"), false);
  const persisted = JSON.parse(await readFile(desktopConfigPath(userDataDir), "utf8"));
  assert.equal(Object.hasOwn(persisted, "usageAnalyticsEnabled"), false);
  assert.equal(Object.hasOwn(persisted, "developmentHandoff"), false);
});

test("failed handoff installation restores its receipt and prior analytics value", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await saveDesktopUsageAnalyticsEnabled({ userDataDir, enabled: false });
  await saveDesktopDevelopmentHandoff({
    userDataDir,
    handoff: INTERNAL_HANDOFF,
  });
  const preparation = await prepareDesktopDevelopmentHandoffInstallation({
    userDataDir,
    handoff: INTERNAL_HANDOFF,
  });

  const restored = await restoreDesktopDevelopmentHandoffInstallation({
    userDataDir,
    handoff: INTERNAL_HANDOFF,
    hadUsageAnalyticsSetting: preparation.hadUsageAnalyticsSetting,
    previousUsageAnalyticsEnabled:
      preparation.previousUsageAnalyticsEnabled,
  });

  assert.equal(restored.usageAnalyticsEnabled, false);
  assert.deepEqual(restored.developmentHandoff, INTERNAL_HANDOFF);
});

test("mismatched or absent install preparation never changes analytics", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await saveDesktopUsageAnalyticsEnabled({ userDataDir, enabled: false });
  await saveDesktopDevelopmentHandoff({
    userDataDir,
    handoff: INTERNAL_HANDOFF,
  });

  const mismatch = await prepareDesktopDevelopmentHandoffInstallation({
    userDataDir,
    handoff: {
      ...INTERNAL_HANDOFF,
      buildId: "aaaaaaaaaaaa.20260730T010000Z.internal",
    },
  });
  assert.equal(mismatch.prepared, false);
  assert.equal(mismatch.config.usageAnalyticsEnabled, false);
  assert.deepEqual(mismatch.config.developmentHandoff, INTERNAL_HANDOFF);

  const withoutReceiptDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await saveDesktopUsageAnalyticsEnabled({
    userDataDir: withoutReceiptDir,
    enabled: false,
  });
  const ordinaryUpgrade = await prepareDesktopDevelopmentHandoffInstallation({
    userDataDir: withoutReceiptDir,
    handoff: INTERNAL_HANDOFF,
  });
  assert.equal(ordinaryUpgrade.prepared, false);
  assert.equal(ordinaryUpgrade.config.usageAnalyticsEnabled, false);
});

test("readDesktopConfig uses legacy-safe preferences for an existing config without new fields", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await writeFile(desktopConfigPath(userDataDir), JSON.stringify({
    openRepoRoots: [],
    preferences: { mode: "preview" },
  }), "utf8");

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [],
    preferences: {
      ...LEGACY_PENDING_PREFERENCES,
      mode: "preview",
    },
  });
});

test("readDesktopConfig migrates legacy theme without returning or persisting theme", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await writeFile(desktopConfigPath(userDataDir), JSON.stringify({
    openRepoRoots: [],
    preferences: { theme: "dark" },
  }), "utf8");

  const migrated = await readDesktopConfig({ userDataDir });
  assert.deepEqual(migrated, {
    openRepoRoots: [],
    preferences: {
      ...LEGACY_PREFERENCES,
      colorMode: "dark",
    },
  });
  assert.equal(Object.hasOwn(migrated.preferences, "theme"), false);

  await saveDesktopPreferences({ userDataDir, preferences: {} });
  const persisted = JSON.parse(await readFile(desktopConfigPath(userDataDir), "utf8"));
  assert.equal(Object.hasOwn(persisted.preferences, "theme"), false);
  assert.equal(persisted.preferences.colorMode, "dark");
});

test("desktop config mutations preserve fields owned by newer app versions", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const originalRepo = path.join(tmpdir(), "original-repo");
  const nextRepo = path.join(tmpdir(), "next-repo");
  const futureTopLevel = {
    version: 3,
    enabledFeatures: ["future-navigation"],
  };
  const futurePreference = {
    palette: "forest",
    contrast: 0.85,
  };
  await writeFile(desktopConfigPath(userDataDir), JSON.stringify({
    schemaVersion: 7,
    futureTopLevel,
    repoRoot: originalRepo,
    recentRepoRoots: [originalRepo],
    openRepoRoots: [originalRepo],
    preferences: {
      theme: "dark",
      mode: "preview",
      futurePreference,
      futureFlag: false,
    },
  }), "utf8");

  const assertForwardCompatibleFields = async () => {
    const config = await readDesktopConfig({ userDataDir });
    assert.equal(config.schemaVersion, 7);
    assert.deepEqual(config.futureTopLevel, futureTopLevel);
    assert.deepEqual(config.preferences.futurePreference, futurePreference);
    assert.equal(config.preferences.futureFlag, false);
    assert.equal(config.preferences.colorMode, "dark");
    assert.equal(Object.hasOwn(config, "recentRepoRoots"), false);
    assert.equal(Object.hasOwn(config.preferences, "theme"), false);

    const persisted = JSON.parse(await readFile(desktopConfigPath(userDataDir), "utf8"));
    assert.equal(persisted.schemaVersion, 7);
    assert.deepEqual(persisted.futureTopLevel, futureTopLevel);
    assert.deepEqual(persisted.preferences.futurePreference, futurePreference);
    assert.equal(persisted.preferences.futureFlag, false);
    assert.equal(Object.hasOwn(persisted, "recentRepoRoots"), false);
    assert.equal(Object.hasOwn(persisted.preferences, "theme"), false);
  };

  await saveDesktopPreferences({
    userDataDir,
    preferences: { mode: "live" },
  });
  await assertForwardCompatibleFields();

  await saveDesktopWindowState({
    userDataDir,
    windowState: {
      bounds: { width: 1360, height: 900 },
      isMaximized: false,
    },
  });
  await assertForwardCompatibleFields();

  await saveDesktopRepository({ userDataDir, repoRoot: nextRepo });
  await assertForwardCompatibleFields();
});

test("saving an explicit color mode completes pending local theme migration", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await writeFile(desktopConfigPath(userDataDir), JSON.stringify({
    openRepoRoots: [],
    preferences: { mode: "preview" },
  }), "utf8");

  const pending = await readDesktopConfig({ userDataDir });
  assert.equal(pending.preferences.legacyThemeMigrationPending, true);

  const saved = await saveDesktopPreferences({
    userDataDir,
    preferences: { colorMode: "dark" },
  });
  assert.equal(saved.preferences.colorMode, "dark");
  assert.equal(Object.hasOwn(saved.preferences, "legacyThemeMigrationPending"), false);
});

test("readDesktopConfig normalizes an invalid document font size", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await writeFile(desktopConfigPath(userDataDir), JSON.stringify({
    openRepoRoots: [],
    preferences: {
      colorMode: "system",
      documentFont: "reading-serif",
      documentFontSize: 99,
      fileTreeMode: "content",
      gitRemoteCheckIntervalMinutes: 15,
    },
  }), "utf8");

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [],
    preferences: {
      language: "system",
      colorMode: "system",
      documentFont: "reading-serif",
      documentFontSize: 16,
      documentMargins: "standard",
      fileTreeMode: "content",
      showDocumentTitles: true,
      gitRemoteCheckIntervalMinutes: 10,
    },
  });
});

test("desktop config persists wide margins, migrates the old name, and rejects unknown values", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));

  const wide = await saveDesktopPreferences({
    userDataDir,
    preferences: { documentMargins: "wide" },
  });
  assert.equal(wide.preferences.documentMargins, "wide");

  const migrated = await saveDesktopPreferences({
    userDataDir,
    preferences: { documentMargins: "feishu" },
  });
  assert.equal(migrated.preferences.documentMargins, "wide");

  const normalized = await saveDesktopPreferences({
    userDataDir,
    preferences: { documentMargins: "extra-wide" },
  });
  assert.equal(normalized.preferences.documentMargins, "standard");
});

test("saveDesktopRepository persists the active and open repository paths", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");

  await saveDesktopRepository({ userDataDir, repoRoot });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot,
    openRepoRoots: [repoRoot],
    preferences: NEW_INSTALL_PREFERENCES,
  });
  assert.equal(
    JSON.parse(await readFile(desktopConfigPath(userDataDir), "utf8")).repoRoot,
    repoRoot,
  );
});

test("saveDesktopRepository keeps first-opened repository order stable", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const mangoOs = path.join(tmpdir(), "docs-repo");
  const mangoContent = path.join(tmpdir(), "content-repo");

  await saveDesktopRepository({ userDataDir, repoRoot: mangoOs });
  await saveDesktopRepository({ userDataDir, repoRoot: mangoContent });
  assert.deepEqual((await readDesktopConfig({ userDataDir })).openRepoRoots, [
    mangoOs,
    mangoContent,
  ]);
  await saveDesktopRepository({ userDataDir, repoRoot: mangoOs });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot: mangoOs,
    openRepoRoots: [mangoOs, mangoContent],
    preferences: NEW_INSTALL_PREFERENCES,
  });
});

test("reorderDesktopRepositories persists only an exact permutation of open repositories", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const mangoOs = path.join(tmpdir(), "mango-os");
  const openGlance = path.join(tmpdir(), "git-leaf");
  const mangoContent = path.join(tmpdir(), "mango-content");

  await saveDesktopRepository({ userDataDir, repoRoot: mangoOs });
  await saveDesktopRepository({ userDataDir, repoRoot: openGlance });
  await saveDesktopRepository({ userDataDir, repoRoot: mangoContent });
  await reorderDesktopRepositories({
    userDataDir,
    openRepoRoots: [openGlance, mangoContent, mangoOs],
  });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot: mangoContent,
    openRepoRoots: [openGlance, mangoContent, mangoOs],
    preferences: NEW_INSTALL_PREFERENCES,
  });

  await reorderDesktopRepositories({
    userDataDir,
    openRepoRoots: [mangoOs, openGlance],
  });
  await reorderDesktopRepositories({
    userDataDir,
    openRepoRoots: [mangoOs, openGlance, mangoContent, mangoOs],
  });
  assert.deepEqual((await readDesktopConfig({ userDataDir })).openRepoRoots, [
    openGlance,
    mangoContent,
    mangoOs,
  ]);
});

test("saveDesktopWindowState persists normal bounds and maximized state", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");
  const windowState = {
    bounds: {
      x: 120,
      y: 80,
      width: 1440,
      height: 920,
    },
    isMaximized: true,
  };

  await saveDesktopRepository({ userDataDir, repoRoot });
  await saveDesktopWindowState({ userDataDir, windowState });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot,
    openRepoRoots: [repoRoot],
    windowState,
    preferences: NEW_INSTALL_PREFERENCES,
  });
});

test("desktop state writes preserve the active runtime repository", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");
  const windowState = {
    bounds: {
      width: 1280,
      height: 860,
    },
    isMaximized: false,
  };

  await saveDesktopRepository({ userDataDir, repoRoot });

  await saveDesktopPreferences({
    userDataDir,
    repoRoot,
    preferences: {
      workbenchSessions: {
        "docs-repo": {
          tabs: [{ path: "AGENTS.md" }],
          activeTabPath: "AGENTS.md",
        },
      },
    },
  });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot,
    openRepoRoots: [repoRoot],
    preferences: {
      ...NEW_INSTALL_PREFERENCES,
      workbenchSessions: {
        "docs-repo": {
          tabs: [{ path: "AGENTS.md" }],
          activeTabPath: "AGENTS.md",
        },
      },
    },
  });

  await saveDesktopWindowState({ userDataDir, repoRoot, windowState });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot,
    openRepoRoots: [repoRoot],
    windowState,
    preferences: {
      ...NEW_INSTALL_PREFERENCES,
      workbenchSessions: {
        "docs-repo": {
          tabs: [{ path: "AGENTS.md" }],
          activeTabPath: "AGENTS.md",
        },
      },
    },
  });
});

test("worktree switches persist the active path without duplicating the open repository", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repositoryRoot = path.join(tmpdir(), "docs-repo");
  const linkedWorktree = path.join(tmpdir(), "docs-repo-feature");

  await saveDesktopRepository({
    userDataDir,
    repoRoot: linkedWorktree,
    repositoryRoot,
  });
  await saveDesktopWindowState({
    userDataDir,
    repoRoot: linkedWorktree,
    windowState: {
      bounds: { width: 1280, height: 860 },
      isMaximized: false,
    },
  });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot: linkedWorktree,
    openRepoRoots: [repositoryRoot],
    windowState: {
      bounds: { width: 1280, height: 860 },
      isMaximized: false,
    },
    preferences: NEW_INSTALL_PREFERENCES,
  });

  await closeDesktopRepository({
    userDataDir,
    repoRoot: linkedWorktree,
    repositoryRoot,
  });
  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [],
    windowState: {
      bounds: { width: 1280, height: 860 },
      isMaximized: false,
    },
    preferences: NEW_INSTALL_PREFERENCES,
  });
});

test("saveDesktopPreferences persists normalized app preferences across repository changes", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const mangoOs = path.join(tmpdir(), "docs-repo");
  const mangoContent = path.join(tmpdir(), "content-repo");

  await saveDesktopRepository({ userDataDir, repoRoot: mangoOs });
  await saveDesktopPreferences({
    userDataDir,
    preferences: {
      mode: "live",
      language: "zh-CN",
      colorMode: "dark",
      documentFont: "reading-serif",
      documentFontSize: 18,
      documentMargins: "wide",
      fileTreeMode: "content",
      showDocumentTitles: false,
      gitRemoteCheckIntervalMinutes: 60,
      treeDirectories: {
        "docs-repo:all": {
          expanded: ["docs", "growth"],
          collapsed: ["growth/mango-da"],
        },
        "docs-repo:git-changes": {
          expanded: ["learning-platform"],
          collapsed: ["engineering"],
        },
        empty: {
          expanded: [],
          collapsed: [],
        },
      },
      workbenchSessions: {
        "docs-repo": {
          tabs: [
            { path: "AGENTS.md" },
            { path: "docs/repo-structure.md" },
          ],
          activeTabPath: "docs/repo-structure.md",
          treeScrollTop: 180,
          treeFocus: {
            itemType: "file",
            path: "docs/repo-structure.md",
          },
        },
        "content-repo": {
          tabs: [],
        },
      },
      sidebarWidth: 360,
      sidebarCollapsed: true,
      documentOutlineWidth: 304,
      sourcePreviewRatio: 55,
      autoInstallUpdates: true,
      updateAvailableVersion: "1.2.3",
      updateRequestedVersion: "1.2.3",
      skippedUpdateVersion: "1.2.3",
      promptedUpdateVersion: "1.2.3",
      ignored: "value",
    },
  });
  await saveDesktopRepository({ userDataDir, repoRoot: mangoContent });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot: mangoContent,
    openRepoRoots: [mangoOs, mangoContent],
    preferences: {
      language: "zh-CN",
      colorMode: "dark",
      documentFont: "reading-serif",
      documentFontSize: 18,
      documentMargins: "wide",
      fileTreeMode: "content",
      showDocumentTitles: false,
      gitRemoteCheckIntervalMinutes: 60,
      mode: "live",
      treeDirectories: {
        "docs-repo:all": {
          expanded: ["docs", "growth"],
          collapsed: ["growth/mango-da"],
        },
        "docs-repo:git-changes": {
          expanded: ["learning-platform"],
          collapsed: ["engineering"],
        },
      },
      workbenchSessions: {
        "docs-repo": {
          tabs: [
            { path: "AGENTS.md" },
            { path: "docs/repo-structure.md" },
          ],
          activeTabPath: "docs/repo-structure.md",
          treeScrollTop: 180,
          treeFocus: {
            itemType: "file",
            path: "docs/repo-structure.md",
          },
        },
        "content-repo": {
          tabs: [],
          activeTabPath: "",
        },
      },
      sidebarWidth: 360,
      sidebarCollapsed: true,
      documentOutlineWidth: 304,
      sourcePreviewRatio: 55,
      updateAvailableVersion: "1.2.3",
      updateRequestedVersion: "1.2.3",
      skippedUpdateVersion: "1.2.3",
      promptedUpdateVersion: "1.2.3",
      autoInstallUpdates: true,
      ignored: "value",
    },
  });
});

test("desktop update discovery and request preferences can be cleared after installation", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));

  await saveDesktopPreferences({
    userDataDir,
    preferences: {
      updateAvailableVersion: "1.9.1",
      updateRequestedVersion: "1.9.1",
    },
  });
  await saveDesktopPreferences({
    userDataDir,
    preferences: {
      updateAvailableVersion: "",
      updateRequestedVersion: "",
    },
  });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [],
    preferences: NEW_INSTALL_PREFERENCES,
  });
});

test("concurrent desktop mutations preserve repository, window, and preference changes", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const firstRepo = path.join(tmpdir(), "first-repo");
  const secondRepo = path.join(tmpdir(), "second-repo");
  const windowState = {
    bounds: { x: 40, y: 60, width: 1280, height: 860 },
    isMaximized: false,
  };

  await Promise.all([
    saveDesktopRepository({ userDataDir, repoRoot: firstRepo }),
    saveDesktopWindowState({ userDataDir, repoRoot: firstRepo, windowState }),
    saveDesktopPreferences({
      userDataDir,
      repoRoot: firstRepo,
      preferences: { mode: "live" },
    }),
    saveDesktopRepository({ userDataDir, repoRoot: secondRepo }),
    closeDesktopRepository({ userDataDir, repoRoot: firstRepo }),
  ]);

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot: secondRepo,
    openRepoRoots: [secondRepo],
    windowState,
    preferences: {
      ...NEW_INSTALL_PREFERENCES,
      mode: "live",
    },
  });
});

test("concurrent preference patches merge without dropping independent fields", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));

  await Promise.all([
    saveDesktopPreferences({ userDataDir, preferences: { colorMode: "dark" } }),
    saveDesktopPreferences({ userDataDir, preferences: { documentFont: "reading-serif" } }),
    saveDesktopPreferences({ userDataDir, preferences: { documentFontSize: 20 } }),
    saveDesktopPreferences({ userDataDir, preferences: { documentMargins: "wide" } }),
    saveDesktopPreferences({ userDataDir, preferences: { fileTreeMode: "all" } }),
    saveDesktopPreferences({
      userDataDir,
      preferences: { gitRemoteCheckIntervalMinutes: 30 },
    }),
    saveDesktopPreferences({ userDataDir, preferences: { mode: "live" } }),
    saveDesktopPreferences({ userDataDir, preferences: { sidebarWidth: 344 } }),
    saveDesktopPreferences({ userDataDir, preferences: { sidebarCollapsed: true } }),
    saveDesktopPreferences({ userDataDir, preferences: { documentOutlineWidth: 296 } }),
    saveDesktopPreferences({ userDataDir, preferences: { sourcePreviewRatio: 58 } }),
  ]);

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [],
    preferences: {
      language: "system",
      colorMode: "dark",
      documentFont: "reading-serif",
      documentFontSize: 20,
      documentMargins: "wide",
      fileTreeMode: "all",
      showDocumentTitles: true,
      gitRemoteCheckIntervalMinutes: 30,
      mode: "live",
      sidebarWidth: 344,
      sidebarCollapsed: true,
      documentOutlineWidth: 296,
      sourcePreviewRatio: 58,
    },
  });
});

test("a failed config mutation does not prevent the next mutation in its queue", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const events = [];

  const failed = queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      events.push("failed");
      throw new Error("intentional config mutation failure");
    },
  });
  const recovered = queueDesktopConfigMutation({
    userDataDir,
    mutation: async () => {
      events.push("recovered");
      return "saved";
    },
  });

  const [failedResult, recoveredResult] = await Promise.allSettled([failed, recovered]);
  assert.equal(failedResult.status, "rejected");
  assert.deepEqual(recoveredResult, { status: "fulfilled", value: "saved" });
  assert.deepEqual(events, ["failed", "recovered"]);
});

test("config mutations for different user data directories do not block each other", async () => {
  const firstDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-first-"));
  const secondDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-second-"));
  const events = [];

  const first = queueDesktopConfigMutation({
    userDataDir: firstDir,
    mutation: async () => {
      events.push("first:start");
      await new Promise((resolve) => setImmediate(resolve));
      events.push("first:end");
    },
  });
  const second = queueDesktopConfigMutation({
    userDataDir: secondDir,
    mutation: async () => {
      events.push("second");
    },
  });

  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "second", "first:end"]);
});

test("closeDesktopRepository clears the active repository without selecting another one", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const mangoOs = path.join(tmpdir(), "docs-repo");
  const mangoContent = path.join(tmpdir(), "content-repo");

  await saveDesktopRepository({ userDataDir, repoRoot: mangoOs });
  await saveDesktopPreferences({
    userDataDir,
    preferences: {
      mode: "source",
      workbenchSessions: {
        "content-repo": {
          tabs: [{ path: "README.md" }],
          activeTabPath: "README.md",
        },
      },
    },
  });
  await saveDesktopRepository({ userDataDir, repoRoot: mangoContent });
  await mutateDesktopRepositoryFavorites({
    userDataDir,
    repositoryRoot: mangoContent,
    repoRoot: mangoContent,
    operation: { action: "add", type: "document", path: "README.md" },
  });
  await closeDesktopRepository({ userDataDir, repoRoot: mangoContent });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [mangoOs],
    preferences: {
      ...NEW_INSTALL_PREFERENCES,
      mode: "source",
      workbenchSessions: {
        "content-repo": {
          tabs: [{ path: "README.md" }],
          activeTabPath: "README.md",
        },
      },
    },
    repositoryFavorites: {
      [mangoContent]: [{ type: "document", path: "README.md" }],
    },
  });

  await closeDesktopRepository({ userDataDir, repoRoot: mangoOs });

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    openRepoRoots: [],
    preferences: {
      ...NEW_INSTALL_PREFERENCES,
      mode: "source",
      workbenchSessions: {
        "content-repo": {
          tabs: [{ path: "README.md" }],
          activeTabPath: "README.md",
        },
      },
    },
    repositoryFavorites: {
      [mangoContent]: [{ type: "document", path: "README.md" }],
    },
  });
});

test("readDesktopConfig rejects malformed config files without a valid backup", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  await writeFile(desktopConfigPath(userDataDir), "{not json", "utf8");

  await assert.rejects(
    readDesktopConfig({ userDataDir }),
    (error) => error?.code === "DESKTOP_CONFIG_INVALID",
  );
});

test("desktop config mutations do not overwrite malformed config without a valid backup", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const configPath = desktopConfigPath(userDataDir);
  const malformedConfig = "{not json";
  await writeFile(configPath, malformedConfig, "utf8");

  await assert.rejects(
    saveDesktopPreferences({
      userDataDir,
      preferences: { colorMode: "dark" },
    }),
    (error) => error?.code === "DESKTOP_CONFIG_INVALID",
  );
  assert.equal(await readFile(configPath, "utf8"), malformedConfig);
});

test("repository favorites persist safely beside unrelated desktop preferences", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");

  await saveDesktopRepository({ userDataDir, repoRoot });
  await Promise.all([
    mutateDesktopRepositoryFavorites({
      userDataDir,
      repositoryRoot: repoRoot,
      repoRoot,
      operation: { action: "add", type: "directory", path: "docs" },
    }),
    mutateDesktopRepositoryFavorites({
      userDataDir,
      repositoryRoot: repoRoot,
      repoRoot,
      operation: { action: "add", type: "document", path: "README.md" },
    }),
    saveDesktopPreferences({
      userDataDir,
      repoRoot,
      preferences: { colorMode: "dark" },
    }),
  ]);

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot,
    openRepoRoots: [repoRoot],
    preferences: {
      ...NEW_INSTALL_PREFERENCES,
      colorMode: "dark",
    },
    repositoryFavorites: {
      [repoRoot]: [
        { type: "directory", path: "docs" },
        { type: "document", path: "README.md" },
      ],
    },
  });

  await mutateDesktopRepositoryFavorites({
    userDataDir,
    repositoryRoot: repoRoot,
    repoRoot,
    operation: {
      action: "remove-many",
      entries: [{ type: "directory", path: "docs" }],
    },
  });
  const pruned = await readDesktopConfig({ userDataDir });
  assert.deepEqual(pruned.repositoryFavorites, {
    [repoRoot]: [{ type: "document", path: "README.md" }],
  });
  assert.equal(pruned.preferences.colorMode, "dark");
});

test("repository favorite normalization drops unsafe entries without losing valid ones", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");
  await writeFile(desktopConfigPath(userDataDir), JSON.stringify({
    openRepoRoots: [repoRoot],
    repositoryFavorites: {
      [repoRoot]: [
        { type: "document", path: "README.md" },
        { type: "document", path: "../outside.md" },
        { type: "directory", path: "/absolute" },
      ],
    },
  }), "utf8");

  assert.deepEqual((await readDesktopConfig({ userDataDir })).repositoryFavorites, {
    [repoRoot]: [{ type: "document", path: "README.md" }],
  });
});

test("desktop config keeps the previous valid version as a recoverable backup", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");

  await saveDesktopRepository({ userDataDir, repoRoot });
  const previousConfig = await readFile(desktopConfigPath(userDataDir), "utf8");
  await saveDesktopPreferences({
    userDataDir,
    preferences: { colorMode: "dark" },
  });

  assert.equal(
    await readFile(desktopConfigBackupPath(userDataDir), "utf8"),
    previousConfig,
  );
  assert.equal(
    JSON.parse(await readFile(desktopConfigPath(userDataDir), "utf8")).preferences.colorMode,
    "dark",
  );
});

test("readDesktopConfig recovers from the latest valid backup and the next mutation repairs primary config", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-"));
  const repoRoot = path.join(tmpdir(), "docs-repo");

  await saveDesktopRepository({ userDataDir, repoRoot });
  await saveDesktopPreferences({
    userDataDir,
    preferences: { colorMode: "dark" },
  });
  await writeFile(desktopConfigPath(userDataDir), "{partially written", "utf8");

  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot,
    openRepoRoots: [repoRoot],
    preferences: NEW_INSTALL_PREFERENCES,
  });

  await saveDesktopPreferences({
    userDataDir,
    preferences: { documentFont: "reading-serif" },
  });
  assert.deepEqual(await readDesktopConfig({ userDataDir }), {
    repoRoot,
    openRepoRoots: [repoRoot],
    preferences: {
      ...NEW_INSTALL_PREFERENCES,
      documentFont: "reading-serif",
    },
  });
  const repairedConfig = await readFile(desktopConfigPath(userDataDir), "utf8");
  assert.doesNotThrow(() => JSON.parse(repairedConfig));
});
