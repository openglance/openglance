import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_MESSAGES,
  createDesktopTranslator,
  desktopPreferencesForRenderer,
  preferredSystemLanguages,
  resolveDesktopLanguage,
  translatedFileCount,
} from "../src/desktop/localization.mjs";
import { createApplicationTranslator } from "../src/desktop/main-localization.mjs";

test("desktop language follows the first supported system language", () => {
  assert.equal(resolveDesktopLanguage(
    { language: "system" },
    { systemLanguages: ["fr-FR", "zh-Hans-CN", "en-US"] },
  ), "zh-CN");
  assert.equal(resolveDesktopLanguage(
    { language: "system" },
    { systemLanguages: ["ja-JP", "en-US", "zh-CN"] },
  ), "en");
  assert.equal(resolveDesktopLanguage(
    { language: "system" },
    { systemLanguages: ["ja-JP"] },
  ), "en");
  assert.equal(resolveDesktopLanguage(
    { language: "zh-CN" },
    { systemLanguages: ["en-US"] },
  ), "zh-CN");
});

test("desktop message catalogs expose the same bounded keys", () => {
  assert.deepEqual(
    Object.keys(DESKTOP_MESSAGES.en).sort(),
    Object.keys(DESKTOP_MESSAGES["zh-CN"]).sort(),
  );
});

test("desktop and application translators localize menus, status, and dialogs", () => {
  const english = createDesktopTranslator(
    { language: "en" },
    { systemLanguages: ["zh-CN"] },
  );
  const chinese = createDesktopTranslator(
    { language: "zh-CN" },
    { systemLanguages: ["en-US"] },
  );
  assert.equal(english("menu.settings"), "Settings...");
  assert.equal(chinese("menu.settings"), "设置…");
  assert.equal(english("menu.sidebarViews"), "Sidebar Views");
  assert.equal(chinese("menu.sidebarFavorites"), "收藏");
  assert.equal(english("menu.pageMarginsWide"), "Wide");
  assert.equal(chinese("menu.pageMarginsStandard"), "标准（默认）");
  assert.match(
    english("updates.handoffAvailableVersion", { version: "1.16.0" }),
    /internal OpenGlance 1\.16\.0/,
  );
  assert.match(
    chinese("updates.handoffAvailableVersion", { version: "1.16.0" }),
    /1\.16\.0 内部正式版/,
  );
  assert.equal(translatedFileCount(english, 1), "1 file");
  assert.equal(translatedFileCount(english, 3), "3 files");
  assert.equal(translatedFileCount(chinese, 3), "3 个");

  const application = createApplicationTranslator(
    { language: "zh-CN" },
    { systemLanguages: ["en-US"] },
  );
  assert.equal(application("dialog.exportPdf"), "导出 PDF");
  assert.match(
    application("share.repositoryUnknown", { repository: "acme/docs" }),
    /acme\/docs/,
  );
});

test("preferred desktop system languages use Electron preference order with locale fallback", () => {
  assert.deepEqual(preferredSystemLanguages({
    getPreferredSystemLanguages: () => ["fr-FR", "en-US"],
    getLocale: () => "zh-CN",
  }), ["fr-FR", "en-US"]);
  assert.deepEqual(preferredSystemLanguages({
    getPreferredSystemLanguages: () => [],
    getLocale: () => "zh-CN",
  }), ["zh-CN"]);
  assert.deepEqual(preferredSystemLanguages({}), []);
});

test("renderer preferences carry one desktop-resolved language without changing the stored choice", () => {
  assert.deepEqual(
    desktopPreferencesForRenderer(
      { language: "system", colorMode: "dark" },
      { systemLanguages: ["fr-FR", "zh-Hans", "en-US"] },
    ),
    {
      language: "system",
      colorMode: "dark",
      resolvedLanguage: "zh-CN",
    },
  );
  assert.equal(
    desktopPreferencesForRenderer(
      { language: "en" },
      { systemLanguages: ["zh-CN"] },
    ).resolvedLanguage,
    "en",
  );
});
