import { createReadStream, watch } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_INFO } from "../build-info.mjs";
import { decodeMarkdownLinkPath } from "../content/link-path.mjs";
import { extractTitle, renderMarkdown } from "../content/markdown.mjs";
import {
  datasetReferencesFromMarkdown,
  renderMdxLiteRows,
} from "../content/mdx-lite.mjs";
import { queryDataset } from "../content/dataset-query.mjs";
import {
  datasetDependencyFingerprint,
  loadDataset,
} from "./dataset-loader.mjs";
import { isLocalRequestAddress } from "./network-address.mjs";
import {
  resolveExistingRepoPath,
  resolveNewDocumentPath,
  resolveOpenablePath,
  resolvePreviewPath,
  resolveRawAssetPath,
} from "./paths.mjs";
import {
  canEditRepository,
  createRepository,
  currentHead,
  currentBranchOrFallback,
  githubBlobRoot,
} from "./repositories.mjs";
import {
  ensureWorktreeBranch,
  listGitWorktrees,
  worktreeDisplayPath,
} from "./git-worktrees.mjs";
import { buildFileTree } from "./tree.mjs";
import {
  frontmatterDocumentProfile,
  frontmatterFacetsPayload,
  frontmatterFilterProfile,
} from "./frontmatter-facets.mjs";
import {
  gitStatusPayload,
  runGitCommand,
  syncSelectedFiles,
} from "./git-sync.mjs";
import {
  applyPreparedRemoteChanges,
  cancelPreparedRemoteChanges,
  createRemoteMergePreparationStore,
  inspectRemoteSync,
  mergeRemoteChanges,
  prepareRemoteChanges,
} from "./git-remote-sync.mjs";
import {
  cleanupManagedDirectoryPlaceholder,
  createRepositoryDirectory,
  deleteRepositoryPath,
  previewRepositoryDelete,
  previewRepositoryDirectoryCreation,
  previewRepositoryFileRename,
  renameRepositoryFile,
} from "./repository-file-operations.mjs";
import { createOpenGlanceShareLink } from "./openglance-open-link.mjs";
import { publishOpenGlanceShareLink } from "./git-share-publish.mjs";
import { githubFileUrl } from "../../public/file-actions.js";
import { sourceLinesFromMarkdown } from "../../public/line-selection.js";
import { normalizeSidebarFavorites } from "../../public/sidebar-favorites.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const CONTENT_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".ndjson", "application/x-ndjson; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".yml", "text/yaml; charset=utf-8"],
]);
const IMAGE_ASSET_EXTENSIONS = new Map([
  ["image/avif", ".avif"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export function createPreviewServer({
  repoRoot,
  initialFile,
  toolVersionMonitor = null,
  restartSelf = null,
  gitRunner = runGitCommand,
  repository = createRepository({ repoRoot, initialFile }),
  desktopPreferences = null,
  saveDesktopPreferences = null,
  getRepositoryFavorites = null,
  mutateRepositoryFavorite = null,
  recordTelemetryActions = null,
}) {
  const assetVersion = String(Date.now());
  const serverContext = {
    repoRoot,
    initialFile,
    assetVersion,
    toolVersionMonitor,
    restartSelf,
    gitRunner,
    repository,
    desktopPreferences,
    saveDesktopPreferences,
    getRepositoryFavorites,
    mutateRepositoryFavorite,
    recordTelemetryActions,
    managedPlaceholders: new Set(),
    remoteMergePreparations: createRemoteMergePreparationStore(),
  };
  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, serverContext);
    } catch (error) {
      sendJson(response, error.statusCode ?? 500, {
        error: error instanceof Error ? error.message : "Unknown preview error",
        ...(typeof error?.code === "string" ? { code: error.code } : {}),
      });
    }
  });
  server.updateDesktopPreferences = (preferences) => {
    serverContext.desktopPreferences = preferences && typeof preferences === "object"
      ? { ...preferences }
      : null;
  };
  server.on("close", () => {
    void serverContext.remoteMergePreparations.dispose();
  });
  return server;
}

async function handleRequest(request, response, context) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method !== "GET" && request.method !== "POST") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  if (requestUrl.pathname === "/") {
    const repo = await requestRepository(requestUrl, context);
    const html = await readFile(path.join(PUBLIC_ROOT, "index.html"), "utf8");
    sendHtml(
      response,
      html
        .replace(
          "__OPENGLANCE_INITIAL_FILE__",
          JSON.stringify(context.initialFile?.relativePath ?? ""),
        )
        .replace(
          "__OPENGLANCE_INITIAL_REPO__",
          JSON.stringify(repo.id),
        )
        .replace(
          "__OPENGLANCE_WORKTREE_ID__",
          JSON.stringify(repo.worktreeId ?? repo.id),
        )
        .replaceAll(
          "__OPENGLANCE_ASSET_VERSION__",
          encodeURIComponent(context.assetVersion),
        )
        .replace(
          "__OPENGLANCE_CAN_EDIT__",
          JSON.stringify(canEditRequest(request, context)),
        )
        .replace(
          "__OPENGLANCE_DESKTOP_PREFERENCES__",
          JSON.stringify(context.desktopPreferences ?? null),
        )
        .replace(
          "__OPENGLANCE_TELEMETRY_ENABLED__",
          JSON.stringify(typeof context.recordTelemetryActions === "function"),
        ),
    );
    return;
  }

  if (requestUrl.pathname === "/api/health") {
    const toolStatus = await toolStatusPayload(context, {
      force: requestUrl.searchParams.get("check") === "1",
    });
    sendJson(response, 200, {
      app: "openglance",
      repoRoot: context.repoRoot,
      initialFile: context.initialFile?.relativePath ?? "",
      toolFingerprint: toolStatus.toolFingerprint,
      stale: toolStatus.stale,
      buildInfo: BUILD_INFO,
    });
    return;
  }

  if (
    requestUrl.pathname === "/app.js" ||
    requestUrl.pathname === "/styles.css" ||
    requestUrl.pathname === "/image-preview.js" ||
    requestUrl.pathname === "/line-selection.js" ||
    requestUrl.pathname === "/agent-context.js" ||
    requestUrl.pathname === "/layout.js" ||
    requestUrl.pathname === "/ui-tooltip.js" ||
    requestUrl.pathname === "/tree-item-tooltip.js" ||
    requestUrl.pathname === "/tree-file-title.js" ||
    requestUrl.pathname === "/file-capability.js" ||
    requestUrl.pathname === "/ndjson.js" ||
    requestUrl.pathname === "/csv-preview.js" ||
    requestUrl.pathname === "/file-actions.js" ||
    requestUrl.pathname === "/pointer-resize.js" ||
    requestUrl.pathname === "/outline.js" ||
    requestUrl.pathname === "/tree-refresh.js" ||
    requestUrl.pathname === "/document-refresh.js" ||
    requestUrl.pathname === "/chart-tooltip.js" ||
    requestUrl.pathname === "/dataset-view.js" ||
    requestUrl.pathname === "/mermaid-layout.js" ||
    requestUrl.pathname === "/mermaid-view.js" ||
    requestUrl.pathname === "/mermaid-renderer.bundle.js" ||
    requestUrl.pathname === "/source-sync.js" ||
    requestUrl.pathname === "/source-split.js" ||
    requestUrl.pathname === "/mode-preference.js" ||
    requestUrl.pathname === "/theme-preference.js" ||
    requestUrl.pathname === "/settings-preferences.js" ||
    requestUrl.pathname === "/sidebar-favorites.js" ||
    requestUrl.pathname === "/sidebar-navigation.js" ||
    requestUrl.pathname === "/i18n.js" ||
    requestUrl.pathname === "/workbench-locales.js" ||
    requestUrl.pathname === "/file-tree-visibility.js" ||
    requestUrl.pathname === "/document-tabs.js" ||
    requestUrl.pathname === "/document-search.js" ||
    requestUrl.pathname === "/document-changes.js" ||
    requestUrl.pathname === "/keyboard-shortcuts.js" ||
    requestUrl.pathname === "/repository-panel.js" ||
    requestUrl.pathname === "/help-content.js" ||
    requestUrl.pathname === "/frontmatter-filters.js" ||
    requestUrl.pathname === "/frontmatter-edit.js" ||
    requestUrl.pathname === "/git-sync-ui.js" ||
    requestUrl.pathname === "/update-ui.js" ||
    requestUrl.pathname === "/tree-state.js" ||
    requestUrl.pathname === "/workbench-session.js" ||
    requestUrl.pathname === "/workbench-startup.js" ||
    requestUrl.pathname === "/telemetry.js" ||
    requestUrl.pathname === "/source-editor.bundle.js"
  ) {
    await sendPublicFile(response, requestUrl.pathname.slice(1));
    return;
  }

  if (requestUrl.pathname === "/api/repos") {
    const isLocalRequest = canEditRequest(request, context);
    requireLocalRequest(request, context);
    const requestedRepo = await requestRepository(requestUrl, context);
    const repositories = [{
      ...publicRepository(requestedRepo),
      canEdit: canEditRepository({ repo: requestedRepo, isLocalRequest }),
    }];
    sendJson(response, 200, {
      currentRepo: requestedRepo.id,
      repositories,
      branch: requestedRepo.branch,
      canEdit: canEditRepository({ repo: requestedRepo, isLocalRequest }),
    });
    return;
  }

  if (requestUrl.pathname === "/api/worktrees") {
    requireLocalRequest(request, context);
    const repo = await requestRepository(requestUrl, context);
    const worktrees = await listGitWorktrees(repo.root);
    sendJson(response, 200, {
      repository: repo.name,
      currentWorktreeId: repo.worktreeId,
      canSwitch: context.desktopPreferences !== null,
      worktrees: worktrees.filter((worktree) => worktree.available).map(publicWorktree),
    });
    return;
  }

  if (requestUrl.pathname === "/api/tree") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const tree = await buildFileTree(repo.root);
    const frontmatterProfile = await frontmatterFilterProfile(repo.root);
    sendJson(response, 200, {
      repo: repo.id,
      branch: repo.branch,
      detached: repo.detached,
      canEdit: canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) }),
      frontmatterAllowedKeys: frontmatterProfile.allowedKeys,
      tree,
    });
    return;
  }

  if (requestUrl.pathname === "/api/frontmatter-facets") {
    const repo = await localRequestRepository(request, requestUrl, context);
    sendJson(response, 200, {
      repo: repo.id,
      branch: repo.branch,
      detached: repo.detached,
      canEdit: canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) }),
      ...(await frontmatterFacetsPayload(repo.root)),
    });
    return;
  }

  if (requestUrl.pathname === "/api/git-status") {
    requireLocalRequest(request, context);
    const repo = await requestRepository(requestUrl, context);
    sendJson(response, 200, {
      ...(await gitStatusPayload({ repo, gitRunner: context.gitRunner })),
      canEdit: canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) }),
    });
    return;
  }

  if (requestUrl.pathname === "/api/git-remote-status") {
    requireLocalRequest(request, context);
    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const repo = await requestRepository(requestUrl, context);
    const payload = await inspectRemoteSync({
      repo,
      refresh: requestUrl.searchParams.get("refresh") !== "0",
      locale: previewLocaleFromRequest(requestUrl),
      gitRunner: context.gitRunner,
    });
    sendJson(response, 200, {
      ...payload,
      canEdit: canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) }),
    });
    return;
  }

  if (requestUrl.pathname === "/api/share-link") {
    requireLocalRequest(request, context);
    const repo = await requestRepository(requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    const locale = previewLocaleFromRequest(requestUrl);
    try {
      if (request.method === "POST") {
        requireEditableRequest(request, context, repo);
        const body = isJsonRequest(request) ? await readJsonRequest(request) : {};
        const payload = await publishOpenGlanceShareLink({
          repo,
          file,
          note: body.note,
          locale,
          gitRunner: context.gitRunner,
        });
        sendJson(response, payload.ok ? 200 : 409, payload);
        return;
      }
      sendJson(response, 200, {
        url: await createOpenGlanceShareLink({
          repoRoot: repo.root,
          file,
          locale,
          gitRunner: context.gitRunner,
        }),
      });
    } catch (error) {
      sendJson(response, 409, {
        error: error instanceof Error
          ? error.message
          : localizedServerMessage(locale, "shareUnavailable"),
        code: typeof error?.code === "string" ? error.code : "share_unavailable",
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/git-sync") {
    let repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const body = await readJsonRequest(request);
    const payload = await syncSelectedFiles({
      repo,
      files: body.files,
      note: body.note,
      allChanges: body.allChanges === true,
      locale: previewLocaleFromRequest(requestUrl),
      gitRunner: context.gitRunner,
    });
    sendJson(response, payload.ok ? 200 : 409, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/git-merge-remote") {
    let repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const body = await readJsonRequest(request);
    const payload = await mergeRemoteChanges({
      repo,
      allowLocalChanges: body.allowLocalChanges === true,
      refresh: body.refresh !== false,
      expectedHead: typeof body.expectedHead === "string" ? body.expectedHead : "",
      expectedRemoteCommit: typeof body.expectedRemoteCommit === "string"
        ? body.expectedRemoteCommit
        : "",
      locale: previewLocaleFromRequest(requestUrl),
      gitRunner: context.gitRunner,
    });
    sendJson(response, payload.ok ? 200 : 409, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/git-prepare-remote-merge") {
    let repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const body = await readJsonRequest(request);
    const payload = await prepareRemoteChanges({
      repo,
      preparationStore: context.remoteMergePreparations,
      allowLocalChanges: body.allowLocalChanges === true,
      refresh: body.refresh !== false,
      expectedHead: typeof body.expectedHead === "string" ? body.expectedHead : "",
      expectedRemoteCommit: typeof body.expectedRemoteCommit === "string"
        ? body.expectedRemoteCommit
        : "",
      locale: previewLocaleFromRequest(requestUrl),
      gitRunner: context.gitRunner,
    });
    sendJson(response, payload.ok ? 200 : 409, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/git-apply-prepared-remote-merge") {
    let repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const body = await readJsonRequest(request);
    const payload = await applyPreparedRemoteChanges({
      repo,
      preparationToken: typeof body.preparationToken === "string"
        ? body.preparationToken
        : "",
      preparationStore: context.remoteMergePreparations,
      locale: previewLocaleFromRequest(requestUrl),
      gitRunner: context.gitRunner,
    });
    sendJson(response, payload.ok ? 200 : 409, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/git-cancel-prepared-remote-merge") {
    const repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const body = await readJsonRequest(request);
    const cancelled = await cancelPreparedRemoteChanges({
      preparationToken: typeof body.preparationToken === "string"
        ? body.preparationToken
        : "",
      preparationStore: context.remoteMergePreparations,
    });
    sendJson(response, 200, { ok: true, cancelled });
    return;
  }

  if (requestUrl.pathname === "/api/tool-status") {
    requireLocalRequest(request, context);
    sendJson(
      response,
      200,
      await toolStatusPayload(context, {
        force: requestUrl.searchParams.get("force") === "1",
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/preferences") {
    requireLocalRequest(request, context);
    if (request.method === "GET") {
      sendJson(response, 200, {
        available: typeof context.saveDesktopPreferences === "function",
        preferences: context.desktopPreferences ?? {},
      });
      return;
    }
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    if (typeof context.saveDesktopPreferences !== "function") {
      sendJson(response, 503, { available: false, preferences: {} });
      return;
    }
    const preferences = await context.saveDesktopPreferences(await readJsonRequest(request));
    context.desktopPreferences = preferences;
    sendJson(response, 200, {
      available: true,
      preferences,
    });
    return;
  }

  if (requestUrl.pathname === "/api/favorites") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const available =
      typeof context.getRepositoryFavorites === "function" &&
      typeof context.mutateRepositoryFavorite === "function";
    if (request.method === "GET") {
      const favorites = available
        ? await context.getRepositoryFavorites(repo.repositoryRoot)
        : [];
      sendJson(response, 200, {
        available,
        favorites: normalizeSidebarFavorites(favorites),
      });
      return;
    }
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    if (!available) {
      sendJson(response, 503, { available: false, favorites: [] });
      return;
    }
    const operation = repositoryFavoriteOperation(await readJsonRequest(request));
    if (!operation) {
      sendJson(response, 400, { error: "Invalid favorite operation" });
      return;
    }
    const favorites = await context.mutateRepositoryFavorite({
      repositoryRoot: repo.repositoryRoot,
      operation,
    });
    sendJson(response, 200, {
      available: true,
      favorites: normalizeSidebarFavorites(favorites),
    });
    return;
  }

  if (requestUrl.pathname === "/api/telemetry") {
    requireLocalRequest(request, context);
    if (request.method !== "POST" || typeof context.recordTelemetryActions !== "function") {
      sendText(response, 404, "Not Found");
      return;
    }
    const body = await readJsonRequest(request);
    if (!exactObjectKeys(body, ["actions"]) || !Array.isArray(body.actions) || body.actions.length < 1 || body.actions.length > 50) {
      sendJson(response, 400, { accepted: 0 });
      return;
    }
    const accepted = await context.recordTelemetryActions(body.actions);
    if (!Number.isInteger(accepted) || accepted !== body.actions.length) {
      sendJson(response, 400, { accepted: 0 });
      return;
    }
    sendJson(response, 202, { accepted });
    return;
  }

  if (requestUrl.pathname === "/api/restart") {
    requireLocalRequest(request, context);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    if (!context.restartSelf) {
      sendJson(response, 503, { restarting: false });
      return;
    }
    await context.restartSelf();
    sendJson(response, 200, { restarting: true });
    return;
  }

  if (requestUrl.pathname === "/api/document") {
    let repo = await localRequestRepository(request, requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    const locale = previewLocaleFromRequest(requestUrl);
    if (request.method === "POST") {
      requireEditableRequest(request, context, repo);
      let branchState = { repo, created: false };
      sendJson(response, 200, {
        ...(await writeDocumentPayload(repo, file, request, {
          beforeWrite: async () => {
            branchState = await ensureRepositoryWriteBranch(repo, context);
            repo = branchState.repo;
            return repo;
          },
        })),
        ...branchStatePayload(branchState),
      });
      return;
    }
    const isLocalRequest = canEditRequest(request, context);
    sendJson(
      response,
      200,
      await documentPayload(repo, file, {
        includeSource: canEditRepository({ repo, isLocalRequest }),
        canEdit: canEditRepository({ repo, isLocalRequest }),
        locale,
        gitRunner: context.gitRunner,
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/dataset-query") {
    const repo = await localRequestRepository(request, requestUrl, context);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const file = documentFileFromRequest(requestUrl, repo);
    const locale = previewLocaleFromRequest(requestUrl);
    const body = await readJsonRequest(request);
    sendJson(response, 200, await datasetQueryPayload(repo, file, body, { locale }));
    return;
  }

  if (requestUrl.pathname === "/api/create-document") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const body = await readJsonRequest(request);
    const locale = previewLocaleFromRequest(requestUrl);
    const documentPath = await resolveNewDocumentPath(repo.root, {
      ...body,
      locale,
    });
    try {
      await stat(documentPath.absolutePath);
      throw newDocumentConflictError(locale);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const payload = await createDocumentPayload(repo, documentPath, {
      locale,
    });
    await cleanupManagedDirectoryPlaceholder({
      repoRoot: repo.root,
      createdPath: documentPath.relativePath,
      gitRunner: context.gitRunner,
      managedPlaceholders: context.managedPlaceholders,
    });
    sendJson(response, 201, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/create-directory") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const body = await readJsonRequest(request);
    const locale = previewLocaleFromRequest(requestUrl);
    await previewRepositoryDirectoryCreation({
      repoRoot: repo.root,
      parentPath: body.parentPath,
      name: body.name,
      locale,
      gitRunner: context.gitRunner,
    });
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const payload = await createRepositoryDirectory({
      repoRoot: repo.root,
      parentPath: body.parentPath,
      name: body.name,
      locale,
      gitRunner: context.gitRunner,
      managedPlaceholders: context.managedPlaceholders,
    });
    sendJson(response, 201, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/rename-file") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const body = await readJsonRequest(request);
    const locale = previewLocaleFromRequest(requestUrl);
    if (!body.fingerprint) {
      sendJson(
        response,
        200,
        await previewRepositoryFileRename({
          repoRoot: repo.root,
          filePath: body.path,
          name: body.name,
          locale,
        }),
      );
      return;
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const payload = await renameRepositoryFile({
      repoRoot: repo.root,
      filePath: body.path,
      name: body.name,
      fingerprint: body.fingerprint,
      locale,
    });
    sendJson(response, 200, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/delete-path") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const body = await readJsonRequest(request);
    const locale = previewLocaleFromRequest(requestUrl);
    if (!body.fingerprint) {
      sendJson(
        response,
        200,
        await previewRepositoryDelete({
          repoRoot: repo.root,
          targetPath: body.path,
          locale,
          gitRunner: context.gitRunner,
        }),
      );
      return;
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const payload = await deleteRepositoryPath({
      repoRoot: repo.root,
      targetPath: body.path,
      fingerprint: body.fingerprint,
      confirmUnrecoverable: body.confirmUnrecoverable === true,
      locale,
      gitRunner: context.gitRunner,
      managedPlaceholders: context.managedPlaceholders,
    });
    sendJson(response, 200, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/rename-document") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const file = documentFileFromRequest(requestUrl, repo);
    let branchState = { repo, created: false };
    sendJson(response, 200, {
      ...(await renameDocumentPayload(repo, file, request, {
        locale: previewLocaleFromRequest(requestUrl),
        beforeWrite: async () => {
          branchState = await ensureRepositoryWriteBranch(repo, context);
          repo = branchState.repo;
          return repo;
        },
      })),
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/link-target") {
    const repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const file = documentFileFromRequest(requestUrl, repo);
    const locale = previewLocaleFromRequest(requestUrl);
    sendJson(
      response,
      200,
      await linkTargetPayload({
        currentRepo: repo,
        file,
        rawTarget: requestUrl.searchParams.get("target") ?? "",
        markdownTarget: requestUrl.searchParams.get("targetFormat") === "markdown",
        locale,
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/link-title") {
    const repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    sendJson(response, 200, await externalLinkTitlePayload(requestUrl.searchParams.get("url") ?? ""));
    return;
  }

  if (requestUrl.pathname === "/api/image-assets") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const file = documentFileFromRequest(requestUrl, repo);
    const locale = previewLocaleFromRequest(requestUrl);
    let branchState = { repo, created: false };
    sendJson(response, 200, {
      ...(await writeImageAssetPayload(repo, file, request, {
        locale,
        beforeWrite: async () => {
          branchState = await ensureRepositoryWriteBranch(repo, context);
          repo = branchState.repo;
          return repo;
        },
      })),
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/watch") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    await streamDocumentWatch(request, response, repo, file, context);
    return;
  }

  if (requestUrl.pathname === "/api/document-status") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    sendJson(
      response,
      200,
      await documentStatusPayload(repo, file, {
        gitRunner: context.gitRunner,
        canEdit: canEditRepository({
          repo,
          isLocalRequest: canEditRequest(request, context),
        }),
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/open-source") {
    const repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    const file = documentFileFromRequest(requestUrl, repo);
    const documentPath = await resolveOpenablePath(repo.root, file);
    openSourceFile(documentPath.absolutePath);
    sendJson(response, 200, {
      path: documentPath.relativePath,
      opened: true,
    });
    return;
  }

  if (requestUrl.pathname === "/api/reveal-path") {
    const repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    const targetPath = requestUrl.searchParams.get("path") ?? "";
    const target = await resolveExistingRepoPath(repo.root, targetPath);
    revealPathInFileManager(target.absolutePath, target.fileStat.isDirectory());
    sendJson(response, 200, {
      path: target.relativePath,
      revealed: true,
    });
    return;
  }

  if (requestUrl.pathname === "/raw") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const file = requestUrl.searchParams.get("file");
    if (!file) {
      sendText(response, 400, "Missing file query parameter");
      return;
    }
    const asset = await resolveRawAssetPath(repo.root, file);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES.get(asset.extension) ?? "application/octet-stream",
    });
    createReadStream(asset.absolutePath).pipe(response);
    return;
  }

  sendText(response, 404, "Not Found");
}

async function toolStatusPayload(context, options = {}) {
  if (!context.toolVersionMonitor) {
    return {
      toolFingerprint: "",
      startupFingerprint: "",
      stale: false,
    };
  }

  const status = await context.toolVersionMonitor.checkForUpdate(options);
  return {
    toolFingerprint: status.fingerprint,
    startupFingerprint: status.startupFingerprint,
    stale: status.stale,
  };
}

function canEditRequest(request, context) {
  return isLocalRequestAddress(request.socket.remoteAddress);
}

function documentFileFromRequest(requestUrl, repo) {
  const file = requestUrl.searchParams.get("file") || repo.defaultFile || "";
  if (file) {
    return file;
  }

  const error = new Error("No document selected.");
  error.statusCode = 400;
  throw error;
}

export function previewLocaleFromRequest(requestUrl) {
  return requestUrl?.searchParams?.get("locale") === "zh-CN" ? "zh-CN" : "en";
}

async function requestRepository(requestUrl, context) {
  const repoId = requestUrl.searchParams.get("repo") || context.repository.id;
  if (repoId !== context.repository.id) {
    const notFound = new Error(`Repository is not available: ${repoId}`);
    notFound.statusCode = 404;
    throw notFound;
  }
  return withRuntimeBranch(context.repository);
}

async function localRequestRepository(request, requestUrl, context) {
  requireLocalRequest(request, context);
  const repo = await requestRepository(requestUrl, context);
  return repo;
}

function publicRepository(repo) {
  return {
    id: repo.id,
    name: repo.name,
    defaultFile: repo.defaultFile,
    branch: repo.branch,
    detached: repo.detached,
    worktreeId: repo.worktreeId,
    worktreeName: repo.worktreeName,
    githubBlobRoot: repo.githubBlobRoot || null,
    canEdit: true,
  };
}

function publicWorktree(worktree) {
  return {
    id: worktree.id,
    name: worktree.name,
    primary: worktree.primary,
    root: worktree.root,
    displayRoot: worktreeDisplayPath(worktree.root),
    head: worktree.head,
    branch: worktree.branch,
    detached: worktree.detached,
    current: worktree.current,
    locked: worktree.locked,
    prunable: worktree.prunable,
    available: worktree.available,
  };
}

async function withRuntimeBranch(repo) {
  const branch = await currentBranchOrFallback(repo);
  const head = await currentHead(repo.root).catch(() => repo.head ?? "");
  return {
    ...repo,
    branch,
    detached: !branch,
    head,
    githubBlobRoot: await githubBlobRoot(repo.root, branch || head) ?? repo.githubBlobRoot,
  };
}

async function ensureRepositoryWriteBranch(repo, context) {
  if (repo.branch && !repo.detached) {
    return { repo, created: false };
  }
  const result = await ensureWorktreeBranch(repo.root);
  if (!result.created) {
    return { repo: { ...repo, branch: result.branch, detached: false }, created: false };
  }

  const nextRepo = {
    ...repo,
    branch: result.branch,
    detached: false,
    githubBlobRoot: await githubBlobRoot(repo.root, result.branch) ?? repo.githubBlobRoot,
  };
  context.repository = { ...context.repository, ...nextRepo };
  return { repo: nextRepo, branch: result.branch, created: true };
}

function branchStatePayload(branchState) {
  return {
    branch: branchState.repo.branch,
    branchCreated: branchState.created,
  };
}

function requireEditableRequest(request, context, repo) {
  if (canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) })) {
    requireTrustedLocalBrowserRequest(request);
    return;
  }

  const error = new Error("Editing is only available from the local OpenGlance app.");
  error.statusCode = 403;
  throw error;
}

function requireLocalRequest(request, context) {
  if (canEditRequest(request, context)) {
    requireTrustedLocalBrowserRequest(request);
    return;
  }

  const error = new Error("This OpenGlance action is only available from the local machine.");
  error.statusCode = 403;
  throw error;
}

function requireTrustedLocalBrowserRequest(request) {
  const fetchSite = String(request.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    const error = new Error("This local session action cannot be requested from another site.");
    error.statusCode = 403;
    throw error;
  }

  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  let requestOrigin = "";
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    const error = new Error("Invalid request origin for this local session.");
    error.statusCode = 403;
    throw error;
  }

  if (requestOrigin !== localRequestOrigin(request)) {
    const error = new Error("This local session action cannot be requested from another origin.");
    error.statusCode = 403;
    throw error;
  }
}

function localRequestOrigin(request) {
  return `http://${request.headers.host ?? "127.0.0.1"}`;
}

export async function documentPayload(
  repo,
  file,
  {
    includeSource = true,
    canEdit = true,
    locale = "en",
    gitRunner = null,
  } = {},
) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  const fileStat = documentPath.fileStat;
  const basePayload = {
    repo: repo.id,
    branch: repo.branch,
    detached: repo.detached,
    worktreeId: repo.worktreeId,
    canEdit: canEdit && documentPath.editable,
    editable: documentPath.editable,
    kind: documentPath.kind,
    extension: documentPath.extension,
    path: documentPath.relativePath,
    title: path.posix.basename(documentPath.relativePath),
    sourceHash: fileFingerprint(fileStat),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    githubUrl: githubFileUrl(repo.githubBlobRoot, documentPath.relativePath) || null,
  };

  if (documentPath.kind !== "markdown") {
    const payload = {
      ...basePayload,
      title: path.posix.basename(documentPath.relativePath),
      sourceLines: [],
      frontmatterProfile: { enabled: false, fields: [] },
    };
    if (documentPath.text) {
      Object.assign(payload, await textPreviewPayload(documentPath, fileStat, { locale }));
    }
    if (documentPath.kind === "html" && fileStat.size <= TEXT_PREVIEW_MAX_BYTES) {
      payload.dependencySource = await readFile(documentPath.absolutePath, "utf8");
    }
    return payload;
  }

  const source = await readFile(documentPath.absolutePath, "utf8");
  const dependencyHash = await datasetDependencyFingerprint({
    repoRoot: repo.root,
    documentPath: documentPath.relativePath,
    datasetPaths: datasetReferencesFromMarkdown(source),
  });
  const html = renderMarkdown(source, {
    currentFile: documentPath.relativePath,
    currentRepo: repo.id,
    locale,
  });

  const payload = {
    ...basePayload,
    canEdit,
    path: documentPath.relativePath,
    title: extractTitle(source, documentPath.relativePath),
    html,
    sourceHash: hashSource(source),
    dependencyHash,
    sourceLines: sourceLinesFromMarkdown(source),
    mtimeMs: fileStat.mtimeMs,
    frontmatterProfile: await frontmatterDocumentProfile(repo.root, documentPath.relativePath, source),
  };

  if (includeSource) {
    payload.source = source;
    payload.repoRoot = repo.root;
    payload.absolutePath = documentPath.absolutePath;
    Object.assign(
      payload,
      await documentChangeBaselinePayload(repo, documentPath.relativePath, gitRunner),
    );
  }

  return payload;
}

async function documentChangeBaselineRevision(repo, relativePath, gitRunner) {
  if (typeof gitRunner !== "function") {
    return null;
  }
  try {
    const result = await gitRunner(repo.root, ["rev-parse", "--verify", `HEAD:${relativePath}`]);
    const revision = String(result.stdout ?? "").trim();
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision) ? revision : null;
  } catch {
    return null;
  }
}

async function documentChangeBaselinePayload(repo, relativePath, gitRunner) {
  const revision = await documentChangeBaselineRevision(repo, relativePath, gitRunner);
  const unavailable = { changeBaselineAvailable: false, changeBaselineRevision: null };
  if (!revision) {
    return unavailable;
  }
  try {
    // Read the inspected blob so a concurrent commit cannot mismatch its revision and source.
    const result = await gitRunner(repo.root, ["show", revision]);
    return {
      changeBaselineAvailable: true,
      changeBaselineRevision: revision,
      changeBaselineSource: String(result.stdout ?? ""),
    };
  } catch {
    return unavailable;
  }
}

async function documentStatusPayload(repo, file, { canEdit = true, gitRunner = null } = {}) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  const fileStat = documentPath.fileStat;
  const source = documentPath.kind === "markdown"
    ? await readFile(documentPath.absolutePath, "utf8")
    : "";
  const sourceHash = documentPath.editable ? hashSource(source) : fileFingerprint(fileStat);
  const dependencyHash = documentPath.kind === "markdown"
    ? await datasetDependencyFingerprint({
        repoRoot: repo.root,
        documentPath: documentPath.relativePath,
        datasetPaths: datasetReferencesFromMarkdown(source),
      })
    : "";
  return {
    repo: repo.id,
    branch: repo.branch,
    canEdit: canEdit && documentPath.editable,
    editable: documentPath.editable,
    kind: documentPath.kind,
    path: documentPath.relativePath,
    mtimeMs: fileStat.mtimeMs,
    sourceHash,
    dependencyHash,
    ...(canEdit && documentPath.kind === "markdown" ? {
      changeBaselineRevision: await documentChangeBaselineRevision(repo, documentPath.relativePath, gitRunner),
    } : {}),
  };
}

async function datasetQueryPayload(repo, documentFile, body, { locale = "en" } = {}) {
  validateDatasetQueryRequest(body);
  const documentPath = await resolvePreviewPath(repo.root, documentFile);
  const dataset = await loadDataset({
    repoRoot: repo.root,
    documentPath: documentPath.relativePath,
    datasetPath: body.dataset,
  });
  const result = queryDataset({
    manifest: dataset.manifest,
    rows: dataset.rows,
    component: body.component,
    attributes: body.attributes,
    query: body.query,
    granularity: body.granularity,
    granularityOptions: body.granularityOptions,
  });
  return {
    component: body.component,
    html: renderMdxLiteRows(body.component, result.rows, result.attributes, { locale }),
    meta: {
      ...result.meta,
      manifestPath: dataset.manifestPath,
      sourcePath: dataset.sourcePath,
    },
  };
}

function validateDatasetQueryRequest(body) {
  if (!exactObjectKeys(body, [
    "component",
    "dataset",
    "attributes",
    "query",
    "granularity",
    "granularityOptions",
  ])) {
    throw invalidDatasetRequest("Dataset query request has an invalid shape.");
  }
  if (body.component !== "Chart" && body.component !== "DataTable") {
    throw invalidDatasetRequest("External datasets support Chart and DataTable.");
  }
  if (typeof body.dataset !== "string" || !body.dataset.trim() || body.dataset.length > 512) {
    throw invalidDatasetRequest("Dataset query requires a manifest path.");
  }
  if (!["auto", "day", "week", "month", "quarter"].includes(body.granularity)) {
    throw invalidDatasetRequest("Dataset granularity must be auto, day, week, month, or quarter.");
  }
  if (
    !Array.isArray(body.granularityOptions)
    || body.granularityOptions.length < 1
    || body.granularityOptions.length > 4
    || new Set(body.granularityOptions).size !== body.granularityOptions.length
    || body.granularityOptions.some((value) => (
      !["day", "week", "month", "quarter"].includes(value)
    ))
  ) {
    throw invalidDatasetRequest(
      "Dataset granularityOptions must contain unique day, week, month, or quarter values.",
    );
  }
  if (!body.attributes || typeof body.attributes !== "object" || Array.isArray(body.attributes)) {
    throw invalidDatasetRequest("Dataset component attributes must be an object.");
  }
  const attributeEntries = Object.entries(body.attributes);
  if (
    attributeEntries.length > 40 ||
    attributeEntries.some(([key, value]) => (
      !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key) ||
      typeof value !== "string" ||
      value.length > 2_000
    ))
  ) {
    throw invalidDatasetRequest("Dataset component attributes exceed the supported limits.");
  }
  if (!body.query || typeof body.query !== "object" || Array.isArray(body.query)) {
    throw invalidDatasetRequest("Dataset query must be an object.");
  }
  if (JSON.stringify(body.query).length > 16_384) {
    throw invalidDatasetRequest("Dataset query exceeds the supported size.");
  }
}

function invalidDatasetRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "dataset_request_invalid";
  return error;
}

async function textPreviewPayload(documentPath, fileStat, { locale = "en" } = {}) {
  if (fileStat.size > TEXT_PREVIEW_MAX_BYTES) {
    return {
      text: "",
      textTruncated: true,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  }

  const rawText = await readFile(documentPath.absolutePath, "utf8");
  if (documentPath.kind !== "json") {
    return {
      text: rawText,
      textTruncated: false,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  }

  try {
    return {
      text: `${JSON.stringify(JSON.parse(rawText), null, 2)}\n`,
      textTruncated: false,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  } catch {
    return {
      text: rawText,
      parseError: localizedServerMessage(locale, "jsonParseError"),
      textTruncated: false,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  }
}

async function writeDocumentPayload(repo, file, request, { beforeWrite = async () => repo } = {}) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  if (!documentPath.editable) {
    const error = new Error("Only Markdown and MDX documents can be edited.");
    error.statusCode = 400;
    throw error;
  }
  const body = await readJsonRequest(request);
  if (typeof body.source !== "string") {
    const error = new Error("source must be a string");
    error.statusCode = 400;
    throw error;
  }

  repo = await beforeWrite();
  await writeFile(documentPath.absolutePath, body.source, "utf8");
  const fileStat = await stat(documentPath.absolutePath);
  return {
    path: documentPath.relativePath,
    mtimeMs: fileStat.mtimeMs,
    sourceHash: hashSource(body.source),
  };
}

async function createDocumentPayload(repo, documentPath, { locale = "en" } = {}) {
  try {
    await writeFile(documentPath.absolutePath, `# ${documentPath.title}\n\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw newDocumentConflictError(locale);
    }
    throw error;
  }
  return documentPayload(repo, documentPath.relativePath, { locale });
}

function newDocumentConflictError(locale = "en") {
  const conflict = new Error(localizedServerMessage(locale, "documentConflict"));
  conflict.statusCode = 409;
  return conflict;
}

function localizedServerMessage(locale, key, values = {}) {
  const messages = {
    en: {
      documentConflict: "A document with this name already exists. Choose another name.",
      documentRenameConflict: "Target document already exists: {path}",
      imageTypeUnsupported: "Unsupported image type: {type}",
      jsonParseError: "JSON parsing failed. The original text is shown.",
      linkRepositoryUnavailable: "Repository is not available: {repository}",
      linkTargetRequired: "Enter a target document.",
      linkTargetUnavailable: "The target document is not available.",
      shareUnavailable: "Could not create a share link.",
    },
    "zh-CN": {
      documentConflict: "同名文档已经存在，请换一个名称。",
      documentRenameConflict: "目标文档已存在：{path}",
      imageTypeUnsupported: "不支持的图片类型：{type}",
      jsonParseError: "JSON 解析失败，已按原始文本显示。",
      linkRepositoryUnavailable: "仓库不可用：{repository}",
      linkTargetRequired: "请输入目标文档。",
      linkTargetUnavailable: "目标文档不可用。",
      shareUnavailable: "无法生成分享链接。",
    },
  };
  const template = messages[locale === "zh-CN" ? "zh-CN" : "en"][key]
    ?? messages.en[key]
    ?? key;
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => (
    values[name] == null ? "" : String(values[name])
  ));
}

async function renameDocumentPayload(
  repo,
  file,
  request,
  {
    beforeWrite = async () => repo,
    locale = "en",
  } = {},
) {
  const documentPath = await resolvePreviewPath(repo.root, file);
  const body = await readJsonRequest(request);
  if (body.extension !== ".mdx") {
    const error = new Error("Only .mdx rename is supported.");
    error.statusCode = 400;
    throw error;
  }

  if (!/\.md$/i.test(documentPath.relativePath)) {
    const error = new Error("Only .md files can be renamed to .mdx.");
    error.statusCode = 400;
    throw error;
  }

  const targetRelativePath = documentPath.relativePath.replace(/\.md$/i, ".mdx");
  const targetAbsolutePath = path.join(repo.root, ...targetRelativePath.split("/"));
  try {
    await stat(targetAbsolutePath);
    const error = new Error(localizedServerMessage(locale, "documentRenameConflict", {
      path: targetRelativePath,
    }));
    error.statusCode = 409;
    throw error;
  } catch (error) {
    if (error?.statusCode) {
      throw error;
    }
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  repo = await beforeWrite();
  await rename(documentPath.absolutePath, targetAbsolutePath);
  return documentPayload(repo, targetRelativePath, { locale });
}

async function writeImageAssetPayload(
  repo,
  file,
  request,
  {
    beforeWrite = async () => repo,
    locale = "en",
  } = {},
) {
  const documentPath = await resolvePreviewPath(repo.root, file);
  const body = await readJsonRequest(request);
  const image = imageBufferFromDataUrl(body.dataUrl);
  const extension = IMAGE_ASSET_EXTENSIONS.get(image.mimeType);
  if (!extension) {
    const error = new Error(localizedServerMessage(locale, "imageTypeUnsupported", {
      type: image.mimeType,
    }));
    error.statusCode = 400;
    throw error;
  }

  repo = await beforeWrite();
  const assetDir = path.join(path.dirname(documentPath.absolutePath), "_assets");
  await mkdir(assetDir, { recursive: true });
  const filename = imageAssetFilename(documentPath.relativePath, image.buffer, extension);
  const absolutePath = path.join(assetDir, filename);
  await writeFile(absolutePath, image.buffer);

  return {
    path: posixJoin(posixDirname(documentPath.relativePath), "_assets", filename),
    src: `_assets/${filename}`,
    tag: `<img src="_assets/${filename}" alt="" width="760">`,
    mimeType: image.mimeType,
    bytes: image.buffer.byteLength,
  };
}

async function linkTargetPayload({
  currentRepo,
  file,
  rawTarget,
  markdownTarget = false,
  locale = "en",
}) {
  const currentFile = await resolveOpenablePath(currentRepo.root, file);
  const openGlanceTarget = openGlanceDocumentUrlTarget(rawTarget);
  if (openGlanceTarget?.repo && openGlanceTarget.repo !== currentRepo.id) {
    const error = new Error(localizedServerMessage(locale, "linkRepositoryUnavailable", {
      repository: openGlanceTarget.repo,
    }));
    error.statusCode = 404;
    throw error;
  }
  const targetRepo = currentRepo;
  const targetDocument = await resolveFirstPreviewPath(
    targetRepo.root,
    openGlanceTarget
      ? [repoRootDocumentInput(openGlanceTarget.file, locale)]
      : documentLinkTargetInputs(currentRepo.root, currentFile.relativePath, rawTarget, locale, { markdownTarget }),
    { locale },
  );
  const source = await readFile(targetDocument.absolutePath, "utf8");
  const suffix = openGlanceTarget?.suffix ?? (markdownTarget ? splitTargetSuffix(rawTarget)[1] : "");
  const href = documentLinkHref(currentFile.relativePath, targetDocument.relativePath, suffix);
  const title = extractTitle(source, targetDocument.relativePath);
  return {
    repo: targetRepo.id,
    path: targetDocument.relativePath,
    title,
    href,
    markdown: `[${escapeMarkdownLinkText(title)}](${href})`,
  };
}

async function resolveFirstPreviewPath(repoRoot, candidates, { locale = "en" } = {}) {
  for (const candidate of candidates) {
    try {
      return await resolvePreviewPath(repoRoot, candidate);
    } catch {}
  }

  const error = new Error(localizedServerMessage(locale, "linkTargetUnavailable"));
  error.statusCode = 404;
  throw error;
}

function documentLinkTargetInputs(repoRoot, currentRelativePath, rawTarget, locale = "en", { markdownTarget = false } = {}) {
  const target = String(rawTarget ?? "").trim();
  if (!target) {
    const error = new Error(localizedServerMessage(locale, "linkTargetRequired"));
    error.statusCode = 400;
    throw error;
  }

  const [rawPath] = splitTargetSuffix(target);
  const pathPart = markdownTarget ? decodeMarkdownLinkPath(rawPath) : rawPath;
  const normalized = pathPart.replaceAll("\\", "/");
  if (path.isAbsolute(pathPart)) {
    const relative = path.relative(repoRoot, pathPart);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return [relative];
    }
    const rootRelativeCandidate = normalized.replace(/^\/+/, "");
    if (rootRelativeCandidate) {
      return [rootRelativeCandidate];
    }
  }

  if (normalized.startsWith("/")) {
    return [normalized.replace(/^\/+/, "")];
  }

  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    return [path.posix.normalize(path.posix.join(path.posix.dirname(currentRelativePath), normalized))];
  }

  return [
    path.posix.normalize(path.posix.join(path.posix.dirname(currentRelativePath), normalized)),
    normalized,
  ];
}

function openGlanceDocumentUrlTarget(rawTarget) {
  try {
    const url = new URL(String(rawTarget ?? "").trim());
    const file = url.searchParams.get("file") ?? "";
    if (!/^https?:$/i.test(url.protocol) || url.pathname !== "/" || !/\.mdx?$/i.test(file)) {
      return null;
    }

    return {
      repo: url.searchParams.get("repo") ?? "",
      file,
      suffix: url.hash || "",
    };
  } catch {
    return null;
  }
}

function repoRootDocumentInput(rawFile, locale = "en") {
  const file = String(rawFile ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!file) {
    const error = new Error(localizedServerMessage(locale, "linkTargetRequired"));
    error.statusCode = 400;
    throw error;
  }
  return file;
}

function documentLinkHref(currentRelativePath, targetRelativePath, suffix = "") {
  const currentDir = path.posix.dirname(currentRelativePath);
  const relative = path.posix.relative(currentDir, targetRelativePath) || path.posix.basename(targetRelativePath);
  const normalizedRelative = relative.startsWith(".") ? relative : `./${relative}`;
  const parts = normalizedRelative
    .split("/")
    .filter((part) => part && part !== ".");
  const upLevels = parts.filter((part) => part === "..").length;
  const downLevels = parts.length - upLevels;
  const isNearby = upLevels === 0
    ? downLevels <= 2
    : upLevels <= 1 && downLevels <= 2;
  const linkPath = isNearby ? normalizedRelative : `/${targetRelativePath}`;
  return linkPath.split("/").map(encodeURIComponent).join("/") + suffix;
}

function splitTargetSuffix(target) {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return [target, ""];
  }
  const splitIndex = Math.min(...indexes);
  return [target.slice(0, splitIndex), target.slice(splitIndex)];
}

function escapeMarkdownLinkText(value) {
  return String(value ?? "").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

async function externalLinkTitlePayload(rawUrl) {
  const url = String(rawUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    const error = new Error("url must be an http(s) URL");
    error.statusCode = 400;
    throw error;
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(3500),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.3,*/*;q=0.1",
        "User-Agent": "OpenGlance/0.1 link-title",
      },
    });
    if (!response.ok) {
      return { url, title: "" };
    }
    const text = await responseTextLimited(response, 256_000);
    return {
      url: response.url || url,
      title: titleFromHtml(text),
    };
  } catch {
    return { url, title: "" };
  }
}

async function responseTextLimited(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    return (await response.text()).slice(0, limit);
  }

  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    const chunk = value.slice(0, Math.max(0, limit - size));
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  reader.releaseLock();
  return new TextDecoder("utf8").decode(Buffer.concat(chunks));
}

function titleFromHtml(html) {
  const source = String(html ?? "");
  const ogTitle = source.match(/<meta\s+[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    source.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:title["'][^>]*>/i);
  const title = ogTitle?.[1] ?? source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return decodeHtmlEntities(title).replace(/\s+/g, " ").trim().slice(0, 180);
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function streamDocumentWatch(request, response, repo, file, context) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.flushHeaders?.();

  let changeTimer = null;
  let closed = false;
  const sendChange = async () => {
    if (closed) {
      return;
    }
    try {
      const currentRepo = await withRuntimeBranch(repo);
      const payload = await documentStatusPayload(currentRepo, documentPath.relativePath, {
        gitRunner: context.gitRunner,
        canEdit: canEditRepository({
          repo: currentRepo,
          isLocalRequest: canEditRequest(request, context),
        }),
      });
      response.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      response.write(
        `event: error\ndata: ${JSON.stringify({
          error: error instanceof Error ? error.message : "Unable to read changed document",
        })}\n\n`,
      );
    }
  };
  const watcher = watch(documentPath.absolutePath, { persistent: false }, () => {
    if (changeTimer) {
      clearTimeout(changeTimer);
    }
    changeTimer = setTimeout(sendChange, 40);
  });

  request.on("close", () => {
    closed = true;
    if (changeTimer) {
      clearTimeout(changeTimer);
    }
    watcher.close();
  });
}

function readJsonRequest(request) {
  if (!isJsonRequest(request)) {
    const error = new Error("JSON request body must use application/json.");
    error.statusCode = 415;
    throw error;
  }

  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function isJsonRequest(request) {
  return String(request.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase() === "application/json";
}

function exactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const expected = new Set(expectedKeys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function repositoryFavoriteOperation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const action = value.action;
  if (action === "remove-many") {
    if (
      !exactObjectKeys(value, ["action", "entries"]) ||
      !Array.isArray(value.entries) ||
      value.entries.length === 0 ||
      value.entries.some((entry) => !exactObjectKeys(entry, ["type", "path"]))
    ) {
      return null;
    }
    const entries = normalizeSidebarFavorites(value.entries);
    return entries.length === value.entries.length
      ? { action, entries }
      : null;
  }
  const expectedKeys = action === "replace"
    ? ["action", "type", "path", "toPath"]
    : ["action", "type", "path"];
  if (
    !["add", "remove", "replace"].includes(action) ||
    !exactObjectKeys(value, expectedKeys)
  ) {
    return null;
  }
  const [favorite] = normalizeSidebarFavorites([{
    type: value.type,
    path: value.path,
  }]);
  if (!favorite) {
    return null;
  }
  if (action !== "replace") {
    return { action, ...favorite };
  }
  const [replacement] = normalizeSidebarFavorites([{
    type: value.type,
    path: value.toPath,
  }]);
  return replacement
    ? { action, ...favorite, toPath: replacement.path }
    : null;
}

function hashSource(source) {
  return createHash("sha256").update(source).digest("hex");
}

function fileFingerprint(fileStat) {
  return createHash("sha256")
    .update(`${fileStat.size}:${fileStat.mtimeMs}`)
    .digest("hex");
}

function imageBufferFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    const error = new Error("dataUrl must be a string");
    error.statusCode = 400;
    throw error;
  }

  const match = dataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error("Image payload must be a base64 data URL.");
    error.statusCode = 400;
    throw error;
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

function imageAssetFilename(documentRelativePath, buffer, extension) {
  const basename = path.posix.basename(
    documentRelativePath,
    path.posix.extname(documentRelativePath),
  );
  const stem = sanitizeAssetStem(basename) || "image";
  const timestamp = new Date()
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace("Z", "");
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  return `${stem}-${timestamp}-${digest}${extension}`;
}

function sanitizeAssetStem(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function posixDirname(value) {
  const dirname = path.posix.dirname(value);
  return dirname === "." ? "" : dirname;
}

function posixJoin(...parts) {
  return parts.filter(Boolean).join("/");
}

function openSourceFile(absolutePath) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", absolutePath] : [absolutePath];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function revealPathInFileManager(absolutePath, isDirectory) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  const args = process.platform === "darwin"
    ? isDirectory ? [absolutePath] : ["-R", absolutePath]
    : process.platform === "win32"
      ? isDirectory ? [absolutePath] : ["/select,", absolutePath]
      : [isDirectory ? absolutePath : path.dirname(absolutePath)];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function sendPublicFile(response, relativePath) {
  const absolutePath = path.join(PUBLIC_ROOT, relativePath);
  const extension = path.extname(absolutePath);
  const body = await readFile(absolutePath);
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES.get(extension) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendHtml(response, body) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}
