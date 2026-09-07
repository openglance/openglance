import path from "node:path";

import { LOCALHOST_HOST, previewServerUrl } from "../server/network-address.mjs";
import { resolveOpenablePath, toPosixPath } from "../server/paths.mjs";
import { createRepositoryInfo } from "../server/repositories.mjs";
import { createPreviewServer } from "../server/index.mjs";
import { workbenchSessionForRepo } from "../../public/workbench-session.js";

export const DESKTOP_BIND_HOST = LOCALHOST_HOST;
export const DEFAULT_DESKTOP_PORT = 4317;

export function desktopPreviewServerUrl({
  port,
  relativePath,
  repoId,
}) {
  return previewServerUrl({
    port,
    relativePath,
    repoId,
  });
}

export async function startDesktopOpenGlanceServer({
  repoRoot,
  initialFilePath = "",
  port = DEFAULT_DESKTOP_PORT,
  desktopPreferences = null,
  saveDesktopPreferences = null,
  getRepositoryFavorites = null,
  mutateRepositoryFavorite = null,
  recordTelemetryActions = null,
} = {}) {
  if (!repoRoot) {
    throw new Error("repoRoot is required to start OpenGlance desktop.");
  }

  const repository = await createRepositoryInfo({ repoRoot });
  const initialFile = await resolveDesktopInitialFile({
    repoRoot: repository.root,
    initialFilePath,
  });
  if (initialFile) {
    repository.defaultFile = initialFile.relativePath;
  }
  const initialSession = workbenchSessionForRepo(
    desktopPreferences?.workbenchSessions,
    repository.worktreeId,
  );
  const server = createPreviewServer({
    repoRoot,
    initialFile,
    repository,
    desktopPreferences,
    saveDesktopPreferences,
    getRepositoryFavorites,
    mutateRepositoryFavorite,
    recordTelemetryActions,
  });
  const { port: actualPort } = await listenWithFallback(server, {
    host: DESKTOP_BIND_HOST,
    port,
  });
  const url = desktopRepositoryUrl({
    port: actualPort,
    repo: repository,
    relativePath: desktopInitialRelativePath({
      initialFile,
      repo: repository,
      session: initialSession,
    }),
  });

  return {
    server,
    repoRoot: repository.root,
    host: DESKTOP_BIND_HOST,
    port: actualPort,
    url,
    repoId: repository.id,
    repoName: repository.name,
    worktreeId: repository.worktreeId,
    worktreeName: repository.worktreeName,
    repositoryRoot: repository.repositoryRoot,
    commonDir: repository.commonDir,
    updateDesktopPreferences(preferences) {
      server.updateDesktopPreferences?.(preferences);
    },
    async close() {
      await closeServer(server);
    },
  };
}

function desktopInitialRelativePath({ initialFile, repo, session }) {
  if (initialFile?.relativePath) {
    return initialFile.relativePath;
  }
  if (session) {
    return session.activeTabPath || "";
  }
  return repo.defaultFile;
}

async function resolveDesktopInitialFile({ repoRoot, initialFilePath }) {
  const absoluteInitialFile = initialFilePath
    ? path.isAbsolute(initialFilePath)
      ? initialFilePath
      : path.resolve(repoRoot, initialFilePath)
    : "";
  if (!absoluteInitialFile) return null;
  try {
    return await resolveOpenablePath(repoRoot, absoluteInitialFile);
  } catch (error) {
    if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error?.code)) throw error;
    const relativePath = path.relative(repoRoot, absoluteInitialFile);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw error;
    }
    // The repository is already validated. Let the document API report a file
    // failure inside the workbench, where the tree and repository switch remain
    // usable. Every subsequent read still goes through the normal path boundary.
    return { relativePath: toPosixPath(relativePath) };
  }
}

function desktopRepositoryUrl({ port, repo, relativePath }) {
  return desktopPreviewServerUrl({
    port,
    relativePath,
    repoId: repo.id,
  });
}

async function listenWithFallback(server, { host, port }) {
  if (port === 0) {
    await listen(server, host, 0);
    const address = server.address();
    return { port: typeof address === "object" && address ? address.port : port };
  }

  for (let offset = 0; offset < 20; offset += 1) {
    const candidatePort = port + offset;
    try {
      await listen(server, host, candidatePort);
      return { port: candidatePort };
    } catch (error) {
      if (error?.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  await listen(server, host, 0);
  const address = server.address();
  return { port: typeof address === "object" && address ? address.port : port };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (!error || error.code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(error);
    });
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}
