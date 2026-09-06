import {
  gitStatusPayload,
  publishCurrentBranch,
  syncSelectedFiles,
} from "./git-sync.mjs";
import { createOpenGlanceShareLink } from "./openglance-open-link.mjs";

const PUBLISHABLE_SHARE_ERRORS = new Set([
  "document_not_committed",
  "document_not_published",
]);
const GIT_SHARE_PUBLISH_MESSAGES = Object.freeze({
  en: Object.freeze({
    "error.publishFailed": "Could not complete the remote publication.",
    "error.verifyFailed": "A share link still could not be created after the remote publication.",
    "prompt.title": "Please resolve this OpenGlance share publication failure:",
    "prompt.repository": "Repository: {repository}",
    "prompt.repositoryPath": "Repository path: {path}",
    "prompt.branch": "Current branch: {branch}",
    "prompt.files": "Selected files:",
    "prompt.failedStep": "Failed step: {step}",
    "prompt.errorOutput": "Error output:",
    "prompt.noErrorOutput": "No error output",
    "prompt.goal": "Goal:",
    "prompt.goalPreserve": "1. Preserve the OpenGlance user's changes to the files above.",
    "prompt.goalResolve": "2. Resolve the current Git state, failed checks, or conflicts.",
    "prompt.goalPublish": "3. After the necessary checks, commit and push the current branch {branch}.",
    "prompt.goalVerify": "4. Verify that the selected document is available on origin/main and its share link can be generated.",
  }),
  "zh-CN": Object.freeze({
    "error.publishFailed": "无法完成远端发布。",
    "error.verifyFailed": "远端发布后仍无法生成分享链接。",
    "prompt.title": "请处理 OpenGlance 分享链接发布失败：",
    "prompt.repository": "仓库：{repository}",
    "prompt.repositoryPath": "仓库路径：{path}",
    "prompt.branch": "当前分支：{branch}",
    "prompt.files": "选中文件：",
    "prompt.failedStep": "失败步骤：{step}",
    "prompt.errorOutput": "错误输出：",
    "prompt.noErrorOutput": "无错误输出",
    "prompt.goal": "目标：",
    "prompt.goalPreserve": "1. 保留 OpenGlance 用户对上述文件的修改。",
    "prompt.goalResolve": "2. 处理当前 Git 状态、检查失败或冲突。",
    "prompt.goalPublish": "3. 完成必要检查后，提交并推送当前分支 {branch}。",
    "prompt.goalVerify": "4. 确认选中文档已经发布到 origin/main，并且可以生成分享链接。",
  }),
});

export async function publishOpenGlanceShareLink({
  repo,
  file,
  note = "",
  language = "en",
  locale,
  gitRunner,
  createShareLink = createOpenGlanceShareLink,
  readStatus = gitStatusPayload,
  syncChanges = syncSelectedFiles,
  publishBranch = publishCurrentBranch,
} = {}) {
  const resolvedLocale = resolveGitSharePublishLocale(locale ?? language);
  const translate = createGitSharePublishTranslator(resolvedLocale);
  const localizationOptions = {
    language: resolvedLocale,
    ...(locale == null ? {} : { locale }),
  };
  const shareLinkOptions = {
    repoRoot: repo.root,
    file,
    gitRunner,
    ...localizationOptions,
  };

  try {
    return {
      ok: true,
      url: await createShareLink(shareLinkOptions),
      published: false,
    };
  } catch (error) {
    if (!PUBLISHABLE_SHARE_ERRORS.has(error?.code)) {
      throw error;
    }
  }

  let publication;
  try {
    const status = await readStatus({ repo, gitRunner });
    const changes = Array.isArray(status.changes) ? status.changes : [];
    publication = changes.length > 0
      ? await syncChanges({
        repo,
        note,
        allChanges: true,
        gitRunner,
        ...localizationOptions,
      })
      : await publishBranch({
        repo,
        files: [file],
        gitRunner,
        ...localizationOptions,
      });
  } catch (error) {
    const errorText = error instanceof Error
      ? error.message
      : translate("error.publishFailed");
    const failure = {
      ok: false,
      code: "share_publish_failed",
      step: typeof error?.step === "string" ? error.step : "publish",
      error: errorText,
      retryable: true,
    };
    return {
      ...failure,
      agentPrompt: buildSharePublishAgentPrompt({
        repo,
        file,
        publication: failure,
        translate,
      }),
    };
  }

  if (!publication.ok) {
    const failure = {
      ...publication,
      error: String(publication.error || translate("error.publishFailed")),
      code: "share_publish_failed",
      retryable: true,
    };
    return {
      ...failure,
      agentPrompt: buildSharePublishAgentPrompt({
        repo,
        file,
        publication: failure,
        translate,
      }),
    };
  }

  try {
    return {
      ...publication,
      ok: true,
      url: await createShareLink(shareLinkOptions),
      published: true,
    };
  } catch (error) {
    const errorText = error instanceof Error
      ? error.message
      : translate("error.verifyFailed");
    const failure = {
      ...publication,
      ok: false,
      code: typeof error?.code === "string" ? error.code : "share_publish_failed",
      step: error?.code === "document_not_committed"
        ? "workspace changed"
        : "verify publication",
      error: errorText,
      retryable: true,
    };
    return {
      ...failure,
      agentPrompt: buildSharePublishAgentPrompt({
        repo,
        file,
        publication: failure,
        translate,
      }),
    };
  }
}

function buildSharePublishAgentPrompt({
  repo,
  file,
  publication,
  translate,
}) {
  const files = Array.isArray(publication.files) && publication.files.length > 0
    ? publication.files
    : [file].filter(Boolean);
  return [
    translate("prompt.title"),
    "",
    translate("prompt.repository", { repository: repo.id }),
    translate("prompt.repositoryPath", { path: repo.root }),
    translate("prompt.branch", { branch: repo.branch }),
    translate("prompt.files"),
    ...files.map((selectedFile) => `- ${selectedFile}`),
    "",
    translate("prompt.failedStep", { step: publication.step || "publish" }),
    translate("prompt.errorOutput"),
    publication.error || translate("prompt.noErrorOutput"),
    "",
    translate("prompt.goal"),
    translate("prompt.goalPreserve"),
    translate("prompt.goalResolve"),
    translate("prompt.goalPublish", { branch: repo.branch }),
    translate("prompt.goalVerify"),
  ].join("\n");
}

function createGitSharePublishTranslator(locale) {
  const messages = GIT_SHARE_PUBLISH_MESSAGES[locale];
  return (key, replacements = {}) => {
    const template = messages[key] ?? GIT_SHARE_PUBLISH_MESSAGES.en[key] ?? key;
    return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => (
      replacements[name] == null ? "" : String(replacements[name])
    ));
  };
}

function resolveGitSharePublishLocale(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
