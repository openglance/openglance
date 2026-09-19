import path from "node:path";

export const OPENGLANCE_HTTPS_OPEN_URL = "https://gitleaf.mangofuture.com/open";
export const OPENGLANCE_HTTPS_SHARE_URL = "https://gitleaf.mangofuture.com/share";
export const OPENGLANCE_SHARE_VERSION = "1";
export const OPENGLANCE_SHARE_TITLE_MAX_LENGTH = 100;

export function openGlanceHttpsOpenUrl({ repository, file = "", worktree = "", title = "" } = {}) {
  const normalized = normalizeOpenGlanceLinkTarget({ repository, file, worktree });
  if (!normalized?.repository) {
    throw new Error("OpenGlance HTTPS links require a GitHub repository identity.");
  }

  const url = new URL(OPENGLANCE_HTTPS_OPEN_URL);
  url.searchParams.set("repo", normalized.repository);
  if (normalized.file) {
    url.searchParams.set("path", normalized.file);
  }
  if (normalized.worktree) {
    url.searchParams.set("worktree", normalized.worktree);
  }
  const previewTitle = normalizeSharePreviewText(title, OPENGLANCE_SHARE_TITLE_MAX_LENGTH);
  if (normalized.file && previewTitle) url.searchParams.set("title", previewTitle);
  return url.toString();
}

export function openGlanceShareUrl({ repository, file, rev, title = "" } = {}) {
  const target = normalizeOpenGlanceLinkTarget({ repository, file });
  const revision = normalizeGitRevision(rev);
  if (!target?.repository || !target.file || !revision) {
    throw new Error("OpenGlance share links require a repository, document, and full revision.");
  }

  const url = new URL(OPENGLANCE_HTTPS_SHARE_URL);
  url.searchParams.set("v", OPENGLANCE_SHARE_VERSION);
  url.searchParams.set("repo", target.repository);
  url.searchParams.set("path", target.file);
  url.searchParams.set("rev", revision);
  const previewTitle = normalizeSharePreviewText(title, OPENGLANCE_SHARE_TITLE_MAX_LENGTH);
  if (previewTitle) {
    url.searchParams.set("title", previewTitle);
  }
  return url.toString();
}

export function normalizeOpenGlanceLinkTarget({
  repoRoot,
  repository,
  file,
  worktree,
  platform,
} = {}) {
  const cleanRepoRoot = typeof repoRoot === "string" ? repoRoot.trim() : "";
  const cleanRepository = normalizeRepositoryIdentity(repository);
  const cleanFile = typeof file === "string" ? file.trim().replaceAll("\\", "/") : "";
  const requestedWorktree = typeof worktree === "string" ? worktree.trim() : "";
  const cleanWorktree = normalizeOpenGlanceWorktreeId(requestedWorktree);
  const platformPath = platform === "win32" ? path.win32 : path.posix;

  const hasLocalRepository = cleanRepoRoot
    && platformPath.isAbsolute(cleanRepoRoot)
    && !cleanRepoRoot.includes("\0");
  if (!hasLocalRepository && !cleanRepository) {
    return null;
  }
  if ((requestedWorktree && !cleanWorktree) || (hasLocalRepository && cleanWorktree)) {
    return null;
  }
  if (!cleanFile) {
    return hasLocalRepository
      ? { repoRoot: cleanRepoRoot, file: "" }
      : {
          repository: cleanRepository,
          file: "",
          ...(cleanWorktree ? { worktree: cleanWorktree } : {}),
        };
  }
  if (
    path.posix.isAbsolute(cleanFile) ||
    path.win32.isAbsolute(cleanFile) ||
    cleanFile.includes("\0")
  ) {
    return null;
  }

  const normalizedFile = path.posix.normalize(cleanFile);
  if (
    normalizedFile === ".." ||
    normalizedFile.startsWith("../") ||
    !/\.mdx?$/i.test(normalizedFile)
  ) {
    return null;
  }

  return {
    ...(hasLocalRepository
      ? { repoRoot: cleanRepoRoot }
      : { repository: cleanRepository }),
    file: normalizedFile,
    ...(cleanWorktree ? { worktree: cleanWorktree } : {}),
  };
}

export function normalizeOpenGlanceWorktreeId(value) {
  const cleanValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-f0-9]{16}$/.test(cleanValue) ? cleanValue : "";
}

export function normalizeGitRevision(value) {
  const cleanValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(cleanValue) ? cleanValue : "";
}

function normalizeRepositoryIdentity(value) {
  const cleanValue = typeof value === "string"
    ? value.trim().replace(/\.git$/i, "").toLowerCase()
    : "";
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(cleanValue) ? cleanValue : "";
}

function normalizeSharePreviewText(value, maxLength) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
