import { isGitRepositoryNotFoundError } from "../server/git-errors.mjs";
import { externalCommandState } from "../server/external-command.mjs";
import { createTranslator } from "../../public/i18n.js";

const REPOSITORY_ERROR_MESSAGES = Object.freeze({
  en: Object.freeze({
    "selection.title": "Could not open this folder: {path}",
    "selection.notRepository": "This folder is not inside a Git repository.",
    "selection.chooseRepository":
      "Choose a Git repository folder or any folder inside one.",
    "startup.missingTitle": "The previously opened repository is unavailable: {path}",
    "startup.notRepository":
      "This folder is no longer inside a Git repository. Choose another local Git repository.",
    "startup.unavailableTitle": "The saved repository is temporarily unavailable: {path}",
    "failure.unavailable.summary": "OpenGlance cannot find the local Git command.",
    "failure.unavailable.action":
      "Make sure Git is installed and the desktop app can run the git command, then try again.",
    "failure.permission.summary":
      "OpenGlance does not have permission to run Git or read this folder.",
    "failure.permission.action":
      "Check access permissions for the Git command and repository folder, then try again.",
    "failure.unsupported.summary":
      "The installed Git version does not support the command capability required for this operation.",
    "failure.unsupported.action":
      "OpenGlance stopped the operation; repository content was not modified.",
    "failure.authentication.summary": "Git authentication failed.",
    "failure.authentication.action":
      "Check the Git credentials used by this repository, then try again.",
    "failure.network.summary": "The network or Git remote is temporarily unavailable.",
    "failure.network.action": "Check the network and remote URL, then try again.",
    "failure.interrupted.summary": "The Git command was interrupted before it completed.",
    "failure.interrupted.action":
      "Make sure no system task is terminating Git, then try again.",
    "failure.invalidOutput.summary":
      "Git returned a result that OpenGlance could not recognize.",
    "failure.invalidOutput.action":
      "OpenGlance stopped the operation; repository content was not modified.",
    "failure.default.summary": "OpenGlance encountered a problem while reading this repository.",
    "failure.default.action":
      "Make sure the folder still exists and the current user can access it, then try again.",
    "failure.missingPath.summary": "The requested file or folder no longer exists.",
    "failure.missingPath.action": "Open another document or choose an available repository.",
    "technicalInfo": "Technical information: {detail}",
  }),
  "zh-CN": Object.freeze({
    "selection.title": "无法打开这个目录：{path}",
    "selection.notRepository": "这个目录不在 Git 仓库中。",
    "selection.chooseRepository": "请选择 Git 仓库目录，或仓库中的任意子目录。",
    "startup.missingTitle": "上次打开的仓库已不可用：{path}",
    "startup.notRepository": "这个目录已经不在 Git 仓库中，请重新选择一个本地 Git 仓库。",
    "startup.unavailableTitle": "上次记录的仓库暂时不可用：{path}",
    "failure.unavailable.summary": "OpenGlance 找不到本机 Git 命令。",
    "failure.unavailable.action":
      "请确认 Git 已安装，并且桌面应用可以运行 git 命令，然后重试。",
    "failure.permission.summary": "OpenGlance 没有权限运行 Git 或读取这个目录。",
    "failure.permission.action": "请检查 Git 命令与仓库目录的访问权限，然后重试。",
    "failure.unsupported.summary": "本机 Git 不支持当前操作所需的命令能力。",
    "failure.unsupported.action": "OpenGlance 已停止当前操作；仓库内容没有被修改。",
    "failure.authentication.summary": "Git 身份验证未通过。",
    "failure.authentication.action": "请检查当前仓库使用的 Git 凭据，然后重试。",
    "failure.network.summary": "网络或 Git 远端暂时不可用。",
    "failure.network.action": "请检查网络与远端地址，然后重试。",
    "failure.interrupted.summary": "Git 命令在完成前被中断。",
    "failure.interrupted.action": "请确认没有系统任务终止 Git，然后重试。",
    "failure.invalidOutput.summary": "Git 返回了 OpenGlance 无法识别的结果。",
    "failure.invalidOutput.action": "OpenGlance 已停止当前操作；仓库内容没有被修改。",
    "failure.default.summary": "OpenGlance 读取这个仓库时遇到问题。",
    "failure.default.action": "请确认目录仍然存在，并且当前用户可以访问，然后重试。",
    "failure.missingPath.summary": "请求的文件或目录已不存在。",
    "failure.missingPath.action": "请打开其他文档，或选择一个可用的仓库。",
    "technicalInfo": "技术信息：{detail}",
  }),
});

export function repositorySelectionErrorMessage(selectedPath, error, options = {}) {
  const translate = repositoryErrorTranslator(options);
  const state = commandStateForRepositoryError(error);
  if (state === "invalid_context") {
    return [
      translate("selection.title", { path: selectedPath }),
      translate("selection.notRepository"),
      translate("selection.chooseRepository"),
    ].join("\n");
  }

  const guidance = repositoryFailureGuidance(state, translate);
  return [
    translate("selection.title", { path: selectedPath }),
    guidance.summary,
    guidance.action,
    technicalErrorMessage(error, translate),
  ].filter(Boolean).join("\n");
}

export function startupRepositoryErrorMessage(candidate, error, options = {}) {
  const translate = repositoryErrorTranslator(options);
  const state = commandStateForRepositoryError(error);
  if (state === "invalid_context") {
    return [
      translate("startup.missingTitle", { path: candidate }),
      translate("startup.notRepository"),
    ].join("\n");
  }

  const guidance = repositoryFailureGuidance(state, translate);
  return [
    translate("startup.unavailableTitle", { path: candidate }),
    guidance.summary,
    guidance.action,
    technicalErrorMessage(error, translate),
  ].filter(Boolean).join("\n");
}

function repositoryErrorTranslator(options) {
  const source = options && typeof options === "object" && !Array.isArray(options)
    ? options
    : {};
  return createTranslator(
    REPOSITORY_ERROR_MESSAGES,
    source.language ?? source.locale,
  );
}

function commandStateForRepositoryError(error) {
  if (error?.code === "ENOENT" && error.syscall && !/^spawn\b/.test(error.syscall) && !error.externalCommandState) {
    return "missing_path";
  }
  return isGitRepositoryNotFoundError(error) ? "invalid_context" : externalCommandState(error);
}

function repositoryFailureGuidance(state, translate) {
  if (state === "missing_path") {
    return {
      summary: translate("failure.missingPath.summary"),
      action: translate("failure.missingPath.action"),
    };
  }
  if (state === "unavailable") {
    return {
      summary: translate("failure.unavailable.summary"),
      action: translate("failure.unavailable.action"),
    };
  }
  if (state === "permission_denied") {
    return {
      summary: translate("failure.permission.summary"),
      action: translate("failure.permission.action"),
    };
  }
  if (state === "unsupported") {
    return {
      summary: translate("failure.unsupported.summary"),
      action: translate("failure.unsupported.action"),
    };
  }
  if (state === "authentication_required") {
    return {
      summary: translate("failure.authentication.summary"),
      action: translate("failure.authentication.action"),
    };
  }
  if (state === "network_unavailable") {
    return {
      summary: translate("failure.network.summary"),
      action: translate("failure.network.action"),
    };
  }
  if (state === "interrupted") {
    return {
      summary: translate("failure.interrupted.summary"),
      action: translate("failure.interrupted.action"),
    };
  }
  if (state === "invalid_output") {
    return {
      summary: translate("failure.invalidOutput.summary"),
      action: translate("failure.invalidOutput.action"),
    };
  }
  return {
    summary: translate("failure.default.summary"),
    action: translate("failure.default.action"),
  };
}

function technicalErrorMessage(error, translate) {
  const lines = [error?.stderr, error?.stdout, error instanceof Error ? error.message : error]
    .filter(Boolean)
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = lines.find((line) => /^(?:fatal|error):/i.test(line))
    ?? lines.find((line) => !/^Command failed:/i.test(line) && !/^usage:/i.test(line))
    ?? lines[0]
    ?? "";
  return detail ? translate("technicalInfo", { detail: detail.slice(0, 240) }) : "";
}
