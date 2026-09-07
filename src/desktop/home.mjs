import { appDisplayName, BUILD_INFO } from "../build-info.mjs";
import { normalizeColorMode } from "../../public/settings-preferences.js";
import { repositoryPanelActionUrl } from "../../public/repository-panel.js";
import {
  createDesktopTranslator,
  resolveDesktopLanguage,
} from "./localization.mjs";

export const DESKTOP_OPEN_REPOSITORY_URL = "openglance://open-repository";
export const DESKTOP_OPEN_WORKTREE_URL = "openglance://open-worktree";

export function desktopPageBackgroundColor(
  preferences = {},
  { systemDark = false } = {},
) {
  const colorMode = normalizeColorMode(preferences?.colorMode);
  const isDark = colorMode === "dark" || (colorMode === "system" && systemDark);
  return isDark ? "#111214" : "#f6f7f9";
}

export function desktopHomeHtml({
  checks = [],
  errorMessage = "",
  repositories = [],
  buildInfo = BUILD_INFO,
  preferences = {},
  systemLanguages = [],
} = {}) {
  const resolvedLanguage = resolveDesktopLanguage(preferences, { systemLanguages });
  const translate = createDesktopTranslator({
    ...preferences,
    language: resolvedLanguage,
  });
  const readiness = desktopReadiness(checks, translate);
  const displayName = appDisplayName(buildInfo);
  const colorMode = normalizeColorMode(preferences?.colorMode);
  return `<!doctype html>
<html lang="${resolvedLanguage}" data-color-mode="${colorMode}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(displayName)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --text: #1f2937;
      --muted: #5b6472;
      --border: #d8dee8;
      --surface: #ffffff;
      --primary: #176b57;
      --primary-hover: #125846;
      --error-bg: #fff1f2;
      --error-border: #fecdd3;
      --error-text: #9f1239;
      --ok: #166534;
      --warn: #92400e;
      --error: #991b1b;
    }

    :root[data-color-mode="light"] { color-scheme: light; }
    :root[data-color-mode="dark"] { color-scheme: dark; }

    :root[data-color-mode="dark"] {
      --bg: #111214;
      --text: #f3f4f6;
      --muted: #aab2c0;
      --border: #343b46;
      --surface: #20242b;
      --primary: #38a987;
      --primary-hover: #49bc99;
      --error-bg: #3b1720;
      --error-border: #7f1d1d;
      --error-text: #fecdd3;
      --ok: #86efac;
      --warn: #fbbf24;
      --error: #fca5a5;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-color-mode="light"]) {
        --bg: #111214;
        --text: #f3f4f6;
        --muted: #aab2c0;
        --border: #343b46;
        --surface: #20242b;
        --primary: #38a987;
        --primary-hover: #49bc99;
        --error-bg: #3b1720;
        --error-border: #7f1d1d;
        --error-text: #fecdd3;
        --ok: #86efac;
        --warn: #fbbf24;
        --error: #fca5a5;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    main {
      width: min(860px, calc(100vw - 48px));
      margin: 0 auto;
      padding: 72px 0 48px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 32px;
      line-height: 1.2;
      font-weight: 680;
    }

    .subtitle {
      margin: 0 0 26px;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.35;
      font-weight: 600;
    }

    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.65;
      font-size: 15px;
    }

    .actions {
      margin-top: 22px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .primary-action {
      display: inline-flex;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      border-radius: 6px;
      background: var(--primary);
      color: #ffffff;
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
    }

    .primary-action:hover {
      background: var(--primary-hover);
    }

    .primary-action.is-disabled {
      cursor: not-allowed;
      background: var(--border);
      color: var(--muted);
    }

    .readiness-panel {
      margin-top: 26px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }

    .readiness-status {
      margin: 0 0 4px;
      font-weight: 650;
      line-height: 1.4;
    }

    .readiness-status.ok {
      color: var(--ok);
    }

    .readiness-status.error {
      color: var(--error);
    }

    .next-action-help {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .error-message {
      margin-top: 24px;
      padding: 14px 16px;
      border: 1px solid var(--error-border);
      border-radius: 8px;
      background: var(--error-bg);
      color: var(--error-text);
      white-space: pre-wrap;
      line-height: 1.55;
      font-size: 14px;
    }

    section {
      margin-top: 42px;
    }

    h2 {
      margin: 0 0 14px;
      font-size: 18px;
      line-height: 1.3;
      font-weight: 650;
    }

    .check-list {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      overflow: hidden;
    }

    .check-row {
      display: grid;
      grid-template-columns: minmax(140px, 190px) minmax(88px, 104px) 1fr;
      gap: 14px;
      align-items: start;
      padding: 14px 16px;
      border-top: 1px solid var(--border);
    }

    .check-row:first-child {
      border-top: 0;
    }

    .check-label {
      font-weight: 600;
    }

    .check-status {
      font-weight: 650;
    }

    .check-status.ok {
      color: var(--ok);
    }

    .check-status.warn {
      color: var(--warn);
    }

    .check-status.error {
      color: var(--error);
    }

    .check-message {
      color: var(--muted);
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .build-info {
      margin-top: 22px;
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .saved-repositories {
      display: grid;
      gap: 8px;
    }

    .saved-repository {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      text-decoration: none;
      overflow-wrap: anywhere;
    }

    a.saved-repository:hover, a.saved-repository:focus-visible {
      border-color: var(--primary);
    }

    .saved-repository-context { color: var(--muted); font-size: 13px; }

    @media (max-width: 640px) {
      main {
        width: min(100vw - 32px, 860px);
        padding-top: 44px;
      }

      .check-row {
        grid-template-columns: 1fr;
        gap: 6px;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(displayName)}</h1>
    <p class="subtitle">${escapeHtml(translate("home.subtitle"))}</p>
    <p>${escapeHtml(translate("home.introduction"))}</p>
    <div class="readiness-panel" data-next-action="${readiness.canOpenRepository ? "allowed" : "blocked"}">
      <p class="readiness-status ${readiness.canOpenRepository ? "ok" : "error"}">${escapeHtml(readiness.title)}</p>
      <p>${escapeHtml(readiness.message)}</p>
      ${readiness.canOpenRepository ? "" : `<p class="next-action-help">${escapeHtml(readiness.nextAction)}</p>`}
    </div>
    <div class="actions">
      ${repositoryActionHtml(readiness, translate)}
    </div>
    ${errorMessage ? `<div class="error-message">${escapeHtml(errorMessage)}</div>` : ""}
    ${savedRepositoriesHtml(repositories, readiness, translate)}
    <section aria-labelledby="environment-heading">
      <h2 id="environment-heading">${escapeHtml(translate("home.environment"))}</h2>
      <div class="check-list">
        ${checks.map((check) => checkRowHtml(check, translate)).join("") || emptyCheckRowHtml(translate)}
      </div>
    </section>
    ${buildInfoHtml(buildInfo, translate)}
  </main>
  ${desktopPreferenceBridgeScript()}
</body>
</html>`;
}

function savedRepositoriesHtml(repositories, readiness, translate) {
  if (!repositories.length) return "";
  return `<section aria-labelledby="repositories-heading">
    <h2 id="repositories-heading">${escapeHtml(translate("home.repositories"))}</h2>
    <div class="saved-repositories">${repositories.map((repository) => {
      const label = `<span>${escapeHtml(repository.name)}</span>${repository.context ? `<span class="saved-repository-context">${escapeHtml(repository.context)}</span>` : ""}`;
      return readiness.canOpenRepository
        ? `<a class="saved-repository" href="${escapeHtml(repositoryPanelActionUrl("switch", repository.id))}">${label}</a>`
        : `<span class="saved-repository" aria-disabled="true">${label}</span>`;
    }).join("")}</div>
  </section>`;
}

function desktopReadiness(checks, translate) {
  const gitCommand = checks.find((check) => check.id === "git-command");
  if (gitCommand?.status === "ok") {
    return {
      canOpenRepository: true,
      title: translate("home.readyTitle"),
      message: translate("home.readyMessage"),
      nextAction: "",
    };
  }

  return {
    canOpenRepository: false,
    title: translate("home.blockedTitle"),
    message: translate("home.blockedMessage"),
    nextAction: translate("home.blockedAction"),
  };
}

function repositoryActionHtml(readiness, translate) {
  const label = escapeHtml(translate("home.chooseRepository"));
  if (readiness.canOpenRepository) {
    return `<a class="primary-action" href="${DESKTOP_OPEN_REPOSITORY_URL}">${label}</a>`;
  }

  return `<span class="primary-action is-disabled" role="button" aria-disabled="true">${label}</span>`;
}

export function desktopProgressHtml({
  title,
  message,
  preferences = {},
  systemLanguages = [],
} = {}) {
  const resolvedLanguage = resolveDesktopLanguage(preferences, { systemLanguages });
  const translate = createDesktopTranslator({
    ...preferences,
    language: resolvedLanguage,
  });
  const renderedTitle = title ?? translate("home.progressTitle");
  const renderedMessage = message ?? translate("home.progressMessage");
  const colorMode = normalizeColorMode(preferences?.colorMode);
  return `<!doctype html>
<html lang="${resolvedLanguage}" data-color-mode="${colorMode}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(renderedTitle)} - OpenGlance</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --text: #1f2937;
      --muted: #5b6472;
      --primary: #176b57;
    }

    :root[data-color-mode="light"] { color-scheme: light; }
    :root[data-color-mode="dark"] { color-scheme: dark; }

    :root[data-color-mode="dark"] {
      --bg: #111214;
      --text: #f3f4f6;
      --muted: #aab2c0;
      --primary: #38a987;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-color-mode="light"]) {
        --bg: #111214;
        --text: #f3f4f6;
        --muted: #aab2c0;
        --primary: #38a987;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    main {
      width: min(720px, calc(100vw - 48px));
      min-height: 100vh;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 48px 0;
    }

    .progress-indicator {
      width: 28px;
      height: 28px;
      margin-bottom: 22px;
      border: 3px solid color-mix(in srgb, var(--primary) 24%, transparent);
      border-top-color: var(--primary);
      border-radius: 999px;
      animation: spin 0.8s linear infinite;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 30px;
      line-height: 1.2;
      font-weight: 680;
    }

    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.65;
      font-size: 15px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>
<body>
  <main aria-busy="true">
    <div class="progress-indicator" aria-hidden="true"></div>
    <h1>${escapeHtml(renderedTitle)}</h1>
    <p>${escapeHtml(renderedMessage)}</p>
  </main>
  ${desktopPreferenceBridgeScript()}
</body>
</html>`;
}

function desktopPreferenceBridgeScript() {
  return `<script>
    window.addEventListener("git-leaf-desktop-preferences", (event) => {
      const colorMode = event.detail?.colorMode;
      if (["system", "light", "dark"].includes(colorMode)) {
        document.documentElement.dataset.colorMode = colorMode;
      }
      event.preventDefault();
    });
  </script>`;
}

function buildInfoHtml(buildInfo, translate) {
  const version = String(buildInfo?.version ?? "").trim();
  const releaseDate = buildReleaseDate(buildInfo);
  if (!version && !releaseDate) {
    return "";
  }

  return `<p class="build-info">${[
    version ? escapeHtml(translate("home.version", { version })) : "",
    releaseDate ? escapeHtml(translate("home.released", { date: releaseDate })) : "",
  ].filter(Boolean).join(" · ")}</p>`;
}

function buildReleaseDate(buildInfo) {
  const builtAt = String(buildInfo?.builtAt ?? "").trim();
  if (!builtAt) {
    return "";
  }
  const date = new Date(builtAt);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function checkRowHtml(check, translate) {
  const status = normalizeStatus(check.status);
  return `<div class="check-row">
    <div class="check-label">${escapeHtml(check.label)}</div>
    <div class="check-status ${status}">${escapeHtml(statusLabel(status, translate))}</div>
    <div class="check-message">${escapeHtml(check.message)}</div>
  </div>`;
}

function emptyCheckRowHtml(translate) {
  return `<div class="check-row">
    <div class="check-label">${escapeHtml(translate("home.environment"))}</div>
    <div class="check-status warn">${escapeHtml(translate("home.pending"))}</div>
    <div class="check-message">${escapeHtml(translate("home.preparingChecks"))}</div>
  </div>`;
}

function normalizeStatus(status) {
  return new Set(["ok", "warn", "error"]).has(status) ? status : "warn";
}

function statusLabel(status, translate) {
  return translate(`home.status.${status}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
