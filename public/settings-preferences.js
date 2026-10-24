export const DEFAULT_USER_PREFERENCES = Object.freeze({
  language: "system",
  colorMode: "system",
  documentFont: "system-sans",
  documentFontSize: 16,
  documentMargins: "standard",
  fileTreeMode: "content",
  showDocumentTitles: true,
  gitRemoteCheckIntervalMinutes: 10,
});

export const LEGACY_USER_PREFERENCES = Object.freeze({
  ...DEFAULT_USER_PREFERENCES,
  colorMode: "light",
  fileTreeMode: "all",
});

export const GIT_REMOTE_CHECK_INTERVAL_MINUTES = Object.freeze([1, 2, 5, 10, 30, 60, 120]);

const COLOR_MODES = new Set(["system", "light", "dark"]);
const DOCUMENT_FONTS = new Set(["system-sans", "reading-serif"]);
const DOCUMENT_MARGINS = new Set(["standard", "wide"]);
const FILE_TREE_MODES = new Set(["content", "all"]);
const GIT_REMOTE_CHECK_INTERVALS = new Set(GIT_REMOTE_CHECK_INTERVAL_MINUTES);
const LANGUAGE_PREFERENCES = new Map([
  ["system", "system"],
  ["en", "en"],
  ["zh-cn", "zh-CN"],
]);

export function normalizeLanguagePreference(
  value,
  fallback = DEFAULT_USER_PREFERENCES.language,
) {
  const normalized = LANGUAGE_PREFERENCES.get(String(value ?? "").trim().toLowerCase());
  return normalized ?? normalizeLanguagePreferenceFallback(fallback);
}

export function resolveLanguagePreference(
  value,
  { systemLanguages = [] } = {},
) {
  const preference = normalizeLanguagePreference(value);
  if (preference !== "system") {
    return preference;
  }

  for (const candidate of Array.isArray(systemLanguages) ? systemLanguages : []) {
    const language = systemLanguageFamily(candidate);
    if (language === "zh") {
      return "zh-CN";
    }
    if (language === "en") {
      return "en";
    }
  }
  return "en";
}

export function normalizeColorMode(value, fallback = DEFAULT_USER_PREFERENCES.colorMode) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return COLOR_MODES.has(normalized) ? normalized : normalizeColorModeFallback(fallback);
}

export function effectiveColorScheme(colorMode, { systemDark = false } = {}) {
  const normalized = normalizeColorMode(colorMode);
  if (normalized === "system") {
    return systemDark ? "dark" : "light";
  }
  return normalized;
}

export function normalizeDocumentFont(value, fallback = DEFAULT_USER_PREFERENCES.documentFont) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return DOCUMENT_FONTS.has(normalized) ? normalized : normalizeDocumentFontFallback(fallback);
}

export function normalizeDocumentFontSize(value, fallback = DEFAULT_USER_PREFERENCES.documentFontSize) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 14 && number <= 22) {
    return number;
  }
  return normalizeDocumentFontSizeFallback(fallback);
}

export function normalizeDocumentMargins(value, fallback = DEFAULT_USER_PREFERENCES.documentMargins) {
  const normalized = normalizeDocumentMarginsValue(value);
  return DOCUMENT_MARGINS.has(normalized) ? normalized : normalizeDocumentMarginsFallback(fallback);
}

export function normalizeFileTreeMode(value, fallback = DEFAULT_USER_PREFERENCES.fileTreeMode) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return FILE_TREE_MODES.has(normalized) ? normalized : normalizeFileTreeModeFallback(fallback);
}

export function normalizeShowDocumentTitles(
  value,
  fallback = DEFAULT_USER_PREFERENCES.showDocumentTitles,
) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return normalizeShowDocumentTitlesFallback(fallback);
}

export function normalizeGitRemoteCheckIntervalMinutes(
  value,
  fallback = DEFAULT_USER_PREFERENCES.gitRemoteCheckIntervalMinutes,
) {
  const number = Number(value);
  return Number.isInteger(number) && GIT_REMOTE_CHECK_INTERVALS.has(number)
    ? number
    : normalizeGitRemoteCheckIntervalMinutesFallback(fallback);
}

export function normalizeUserPreferences(value, {
  defaults = DEFAULT_USER_PREFERENCES,
} = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyTheme = source.theme === "light" || source.theme === "dark" ? source.theme : "";
  return {
    language: normalizeLanguagePreference(source.language, defaults.language),
    colorMode: normalizeColorMode(source.colorMode || legacyTheme, defaults.colorMode),
    documentFont: normalizeDocumentFont(source.documentFont, defaults.documentFont),
    documentFontSize: normalizeDocumentFontSize(source.documentFontSize, defaults.documentFontSize),
    documentMargins: normalizeDocumentMargins(source.documentMargins, defaults.documentMargins),
    fileTreeMode: normalizeFileTreeMode(source.fileTreeMode, defaults.fileTreeMode),
    showDocumentTitles: normalizeShowDocumentTitles(
      source.showDocumentTitles,
      defaults.showDocumentTitles,
    ),
    gitRemoteCheckIntervalMinutes: normalizeGitRemoteCheckIntervalMinutes(
      source.gitRemoteCheckIntervalMinutes,
      defaults.gitRemoteCheckIntervalMinutes,
    ),
  };
}

export function shouldRebuildFileTreeForPreferences(
  previousValue,
  nextValue,
  { defaults = DEFAULT_USER_PREFERENCES } = {},
) {
  const previous = normalizeUserPreferences(previousValue, { defaults });
  const next = normalizeUserPreferences(nextValue, { defaults });
  return previous.fileTreeMode !== next.fileTreeMode
    || previous.showDocumentTitles !== next.showDocumentTitles;
}

export function preferencePatch(key, value) {
  switch (key) {
    case "language":
      return { language: normalizeLanguagePreference(value) };
    case "colorMode":
      return { colorMode: normalizeColorMode(value) };
    case "documentFont":
      return { documentFont: normalizeDocumentFont(value) };
    case "documentFontSize":
      return { documentFontSize: normalizeDocumentFontSize(value) };
    case "documentMargins":
      return { documentMargins: normalizeDocumentMargins(value) };
    case "fileTreeMode":
      return { fileTreeMode: normalizeFileTreeMode(value) };
    case "showDocumentTitles":
      return { showDocumentTitles: normalizeShowDocumentTitles(value) };
    case "gitRemoteCheckIntervalMinutes":
      return {
        gitRemoteCheckIntervalMinutes: normalizeGitRemoteCheckIntervalMinutes(value),
      };
    default:
      return null;
  }
}

function normalizeLanguagePreferenceFallback(value) {
  const normalized = LANGUAGE_PREFERENCES.get(String(value ?? "").trim().toLowerCase());
  return normalized ?? DEFAULT_USER_PREFERENCES.language;
}

function systemLanguageFamily(value) {
  const normalized = String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
  const [language] = normalized.split("-");
  return language === "zh" || language === "en" ? language : "";
}

function normalizeColorModeFallback(value) {
  return COLOR_MODES.has(value) ? value : DEFAULT_USER_PREFERENCES.colorMode;
}

function normalizeDocumentFontFallback(value) {
  return DOCUMENT_FONTS.has(value) ? value : DEFAULT_USER_PREFERENCES.documentFont;
}

function normalizeDocumentFontSizeFallback(value) {
  return Number.isInteger(value) && value >= 14 && value <= 22
    ? value
    : DEFAULT_USER_PREFERENCES.documentFontSize;
}

function normalizeDocumentMarginsFallback(value) {
  const normalized = normalizeDocumentMarginsValue(value);
  return DOCUMENT_MARGINS.has(normalized) ? normalized : DEFAULT_USER_PREFERENCES.documentMargins;
}

function normalizeDocumentMarginsValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "feishu" ? "wide" : normalized;
}

function normalizeFileTreeModeFallback(value) {
  return FILE_TREE_MODES.has(value) ? value : DEFAULT_USER_PREFERENCES.fileTreeMode;
}

function normalizeShowDocumentTitlesFallback(value) {
  return typeof value === "boolean" ? value : DEFAULT_USER_PREFERENCES.showDocumentTitles;
}

function normalizeGitRemoteCheckIntervalMinutesFallback(value) {
  return Number.isInteger(value) && GIT_REMOTE_CHECK_INTERVALS.has(value)
    ? value
    : DEFAULT_USER_PREFERENCES.gitRemoteCheckIntervalMinutes;
}
