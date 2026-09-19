import { openGlanceHttpsOpenUrl, openGlanceShareUrl } from "./hosted-links.mjs";
import { isExternalCommandExit, runExternalCommand } from "./external-command.mjs";
import { listGitWorktrees } from "./git-worktrees.mjs";
import { extractTitle } from "../content/markdown.mjs";
import { githubRepositoryIdentityFromRemote } from "./repositories.mjs";
import { readOpenLinkPreviewTitle } from "./open-link-preview-title.mjs";

const OPENGLANCE_OPEN_LINK_MESSAGES = Object.freeze({
  en: Object.freeze({
    "open.repositoryRequired": "A Git repository root is required.",
    "open.githubOriginRequired": "The repository must have a GitHub origin before creating a shareable link.",
    "open.currentWorktreeRequired": "Could not identify the current Git worktree.",
    "share.repositoryRequired": "Open a Git repository before creating a share link.",
    "share.primaryRequired": "Share links are available only from the primary worktree.",
    "share.mainRequired": "Share links are available only from the main branch of the primary worktree.",
    "share.githubOriginRequired": "This repository does not have a recognizable GitHub origin.",
    "share.documentModified": "This document has uncommitted changes. Sync it before sharing.",
    "share.documentUncommitted": "This document has not been committed yet. Sync it before sharing.",
    "share.documentUnpublished": "This document is committed but has not been published to origin/main.",
  }),
  "zh-CN": Object.freeze({
    "open.repositoryRequired": "需要提供 Git 仓库根目录。",
    "open.githubOriginRequired": "创建可分享链接前，仓库必须配置 GitHub origin。",
    "open.currentWorktreeRequired": "无法识别当前 Git 工作区。",
    "share.repositoryRequired": "需要先打开一个 Git 仓库。",
    "share.primaryRequired": "分享链接只支持主工作区。",
    "share.mainRequired": "分享链接只支持主工作区的 main 分支。",
    "share.githubOriginRequired": "当前仓库没有可识别的 GitHub origin。",
    "share.documentModified": "当前文档还有未提交修改，请先同步当前文档。",
    "share.documentUncommitted": "当前文档还没有提交记录，请先同步当前文档。",
    "share.documentUnpublished": "当前文档已经提交，但尚未发布到 origin/main。",
  }),
});

export async function createOpenGlanceOpenLink({
  repoRoot,
  file,
  language = "en",
  locale,
  readOrigin = defaultReadOrigin,
  listWorktrees = listGitWorktrees,
  previewTitle = true,
} = {}) {
  const translate = createOpenLinkTranslator(locale ?? language);
  if (!repoRoot) {
    throw new Error(translate("open.repositoryRequired"));
  }

  const repository = githubRepositoryIdentityFromRemote(await readOrigin(repoRoot));
  if (!repository) {
    throw new Error(translate("open.githubOriginRequired"));
  }

  const worktrees = await listWorktrees(repoRoot);
  const currentWorktree = worktrees.find((worktree) => worktree.current);
  if (!currentWorktree) {
    throw new Error(translate("open.currentWorktreeRequired"));
  }

  const link = openGlanceHttpsOpenUrl({
    repository,
    file,
    ...(currentWorktree.primary ? {} : { worktree: currentWorktree.id }),
  });
  const url = new URL(link);
  if (!previewTitle || !url.searchParams.has("path")) return link;
  return openGlanceHttpsOpenUrl({
    repository,
    file: url.searchParams.get("path"),
    worktree: url.searchParams.get("worktree") || "",
    title: await readOpenLinkPreviewTitle(repoRoot, url.searchParams.get("path")),
  });
}

export async function createOpenGlanceShareLink({
  repoRoot,
  file,
  language = "en",
  locale,
  readOrigin,
  listWorktrees: readWorktrees = listGitWorktrees,
  gitRunner = defaultGitRunner,
} = {}) {
  const translate = createOpenLinkTranslator(locale ?? language);
  if (!repoRoot) {
    throw shareLinkError("repository_required", translate("share.repositoryRequired"));
  }

  const worktrees = await readWorktrees(repoRoot);
  const currentWorktree = worktrees.find((worktree) => worktree.current);
  if (!currentWorktree?.primary) {
    throw shareLinkError("primary_required", translate("share.primaryRequired"));
  }
  if (currentWorktree.branch !== "main") {
    throw shareLinkError("main_required", translate("share.mainRequired"));
  }

  const origin = readOrigin
    ? await readOrigin(repoRoot)
    : (await gitRunner(repoRoot, ["remote", "get-url", "origin"])).stdout.trim();
  const repository = githubRepositoryIdentityFromRemote(origin);
  if (!repository) {
    throw shareLinkError("github_origin_required", translate("share.githubOriginRequired"));
  }

  const status = await gitRunner(repoRoot, [
    "-c",
    "core.quotePath=false",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    file,
  ]);
  if (status.stdout.trim()) {
    throw shareLinkError("document_not_committed", translate("share.documentModified"));
  }

  const revisionResult = await gitRunner(repoRoot, ["log", "-1", "--format=%H", "--", file]);
  const rev = revisionResult.stdout.trim().toLowerCase();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(rev)) {
    throw shareLinkError("document_not_committed", translate("share.documentUncommitted"));
  }

  try {
    await gitRunner(repoRoot, ["merge-base", "--is-ancestor", rev, "refs/remotes/origin/main"]);
  } catch (error) {
    if (isExternalCommandExit(error, 1)) {
      throw shareLinkError("document_not_published", translate("share.documentUnpublished"));
    }
    throw error;
  }

  let publishedSource = "";
  try {
    publishedSource = (await gitRunner(repoRoot, ["show", `${rev}:${file}`])).stdout;
  } catch {
    // Preview metadata is optional and must not block an otherwise valid share link.
  }
  return openGlanceShareUrl({
    repository,
    file,
    rev,
    title: extractTitle(publishedSource, file),
  });
}

function shareLinkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createOpenLinkTranslator(locale) {
  const messages = OPENGLANCE_OPEN_LINK_MESSAGES[resolveOpenLinkLocale(locale)];
  return (key) => messages[key] ?? OPENGLANCE_OPEN_LINK_MESSAGES.en[key] ?? key;
}

function resolveOpenLinkLocale(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

async function defaultReadOrigin(repoRoot) {
  const { stdout } = await runExternalCommand("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
  });
  return stdout.trim();
}

async function defaultGitRunner(cwd, args) {
  return runExternalCommand("git", args, { cwd });
}
