import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";

import {
  ExternalCommandOutputError,
  externalCommandOutput,
  externalCommandState,
  isExternalCommandExit,
  runExternalCommand,
} from "./external-command.mjs";
import { createTranslator } from "../../public/i18n.js";
import { createSyncCommitMessage } from "./git-commit-message.mjs";

const IN_PROGRESS_GIT_REFS = new Map([
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
]);

const REBASE_STATE_PATHS = ["rebase-merge", "rebase-apply"];

const GIT_SYNC_MESSAGES = {
  en: {
    "result.title": "Sync encountered a problem",
    "result.help": "Copy the prompt and paste it into the AI Agent of your choice.",
    "error.selectFiles": "Select at least one file to sync.",
    "error.noLocalChanges": "There are no local file changes to sync.",
    "error.selectedFilesUnchanged": "The selected files have no local changes: {files}",
    "error.divergedSync": "The current branch has diverged from its remote. To avoid rewriting local commits automatically, hand it off to an AI Agent before syncing again.",
    "error.remoteChangedWithUnselected": "The remote branch has new commits, but some local changes are not selected.",
    "error.selectAllChanges": "To avoid affecting those files during the update, select all changes and try again, or handle these unselected files first:",
    "error.workspaceStillChanging": "The workspace kept changing while OpenGlance prepared the sync. OpenGlance did not commit the current changes. Try syncing again later.",
    "error.noStagedChanges": "The selected files have no staged changes to commit.",
    "error.postCommitChanged": "New workspace changes appeared after the commit. OpenGlance preserved the local commit and new changes, but did not rebase or push. Hand it off to an AI Agent to continue.",
    "error.rebaseAbortSucceeded": "OpenGlance exited the failed rebase automatically and restored the local commit and files.",
    "error.rebaseAbortFailed": "OpenGlance could not exit the rebase automatically. Do not continue syncing; hand it off to an AI Agent.",
    "error.headChanged": "New commits appeared on the current branch during sync. OpenGlance did not continue pushing. Hand it off to an AI Agent to inspect the branch.",
    "error.uncommittedBeforePublish": "There are still uncommitted local changes. Finish syncing them before publishing.",
    "error.divergedPublish": "The current branch has diverged from its remote. To avoid rewriting local commits automatically, hand it off to an AI Agent before publishing.",
    "error.unresolvedConflicts": "The repository has unresolved conflicts. Hand it off to an AI Agent first.",
    "error.operationInProgress": "A {operations} operation is in progress in the repository. Finish or cancel it first.",
    "error.remoteMissingCommit": "The remote origin/{branch} does not contain this commit yet. OpenGlance preserved the local commit. Check the network or remote permissions, then try again.",
    "error.unknownGit": "Unknown Git error",
    "error.gitNameMissing": "Git user.name is not configured. Run `git config --global user.name \"Your Name\"` before syncing.",
    "error.gitEmailMissing": "Git user.email is not configured. Run `git config --global user.email \"you@example.com\"` before syncing.",
    "error.originMissing": "Git remote `origin` is not configured. Clone the repository from GitHub or add an origin remote before syncing.",
    "state.unavailable": "Git was not found. Sync has stopped.",
    "state.permissionDenied": "Access to Git or the repository was denied. Sync has stopped.",
    "state.unsupported": "The installed Git does not support a command required for sync.",
    "state.invalidContext": "The current directory is no longer a usable Git worktree.",
    "state.authenticationRequired": "Git authentication failed. Sync has stopped.",
    "state.networkUnavailable": "The network or Git remote is temporarily unavailable. Sync has stopped.",
    "state.interrupted": "The Git command was interrupted before it completed. Sync has stopped.",
    "state.invalidOutput": "Git returned a result that OpenGlance could not recognize. Sync has stopped.",
    "prompt.title": "Please resolve this OpenGlance sync failure:",
    "prompt.repository": "Repository: {repo}",
    "prompt.repositoryPath": "Repository path: {path}",
    "prompt.branch": "Current branch: {branch}",
    "prompt.files": "Selected files:",
    "prompt.step": "Failed step: {step}",
    "prompt.error": "Error output:",
    "prompt.noError": "No error output",
    "prompt.goals": "Goals:",
    "prompt.goal1": "1. Preserve the OpenGlance user's changes to the files above.",
    "prompt.goal2": "2. Resolve the current Git state, failed checks, or conflicts.",
    "prompt.goal3": "3. After the necessary checks pass, commit and push the current branch {branch}.",
  },
  "zh-CN": {
    "result.title": "同步遇到异常",
    "result.help": "点击复制提示词，然后粘贴到你选择的 AI Agent 中继续处理。",
    "error.selectFiles": "请选择需要同步的文件。",
    "error.noLocalChanges": "当前没有需要同步的本地文件改动。",
    "error.selectedFilesUnchanged": "选中文件没有本地改动：{files}",
    "error.divergedSync": "当前分支与远端已经分叉。为避免自动改写本地提交，请交给 AI Agent 处理后再同步。",
    "error.remoteChangedWithUnselected": "远端分支已有新提交，但当前仍有未勾选的本地改动。",
    "error.selectAllChanges": "为避免自动更新时影响这些文件，请勾选全部改动后重试，或先处理未勾选文件：",
    "error.workspaceStillChanging": "同步准备期间内容仍在变化。OpenGlance 没有提交当前改动，请稍后重新同步。",
    "error.noStagedChanges": "选中文件没有可提交的 staged 改动。",
    "error.postCommitChanged": "提交后工作区出现了新的修改。OpenGlance 已保留本地提交和新修改，但没有执行 rebase 或 push，请交给 AI Agent 继续处理。",
    "error.rebaseAbortSucceeded": "OpenGlance 已自动退出失败的 rebase，本地提交和文件已恢复。",
    "error.rebaseAbortFailed": "OpenGlance 无法自动退出 rebase；请不要继续同步，直接交给 AI Agent 处理。",
    "error.headChanged": "同步期间当前分支出现了新的提交。OpenGlance 没有继续推送，请交给 AI Agent 检查分支状态。",
    "error.uncommittedBeforePublish": "当前仍有未提交的本地改动，请先完成同步后再发布。",
    "error.divergedPublish": "当前分支与远端已经分叉。为避免自动改写本地提交，请交给 AI Agent 处理后再发布。",
    "error.unresolvedConflicts": "仓库存在尚未解决的冲突，请先交给 AI Agent 处理。",
    "error.operationInProgress": "仓库正在进行 {operations}，请先完成或取消该操作。",
    "error.remoteMissingCommit": "远端 origin/{branch} 尚未包含本次提交。OpenGlance 已保留本地提交，请检查网络或远端权限后重试。",
    "error.unknownGit": "未知 Git 错误",
    "error.gitNameMissing": "尚未配置 Git user.name。请先运行 `git config --global user.name \"你的名字\"`。",
    "error.gitEmailMissing": "尚未配置 Git user.email。请先运行 `git config --global user.email \"you@example.com\"`。",
    "error.originMissing": "尚未配置 Git 远端 `origin`。请从 GitHub 克隆仓库，或先添加 origin 远端。",
    "state.unavailable": "未检测到 Git 命令，当前同步已停止。",
    "state.permissionDenied": "Git 命令或仓库访问被拒绝，当前同步已停止。",
    "state.unsupported": "本机 Git 不支持当前同步所需的命令能力。",
    "state.invalidContext": "当前目录已经不是可用的 Git 工作区。",
    "state.authenticationRequired": "Git 身份验证未通过，当前同步已停止。",
    "state.networkUnavailable": "网络或 Git 远端暂时不可用，当前同步已停止。",
    "state.interrupted": "Git 命令在完成前被中断，当前同步已停止。",
    "state.invalidOutput": "Git 返回了 OpenGlance 无法识别的结果，当前同步已停止。",
    "prompt.title": "请处理 OpenGlance 同步失败：",
    "prompt.repository": "仓库：{repo}",
    "prompt.repositoryPath": "仓库路径：{path}",
    "prompt.branch": "当前分支：{branch}",
    "prompt.files": "选中文件：",
    "prompt.step": "失败步骤：{step}",
    "prompt.error": "错误输出：",
    "prompt.noError": "无错误输出",
    "prompt.goals": "目标：",
    "prompt.goal1": "1. 保留 OpenGlance 用户对上述文件的修改。",
    "prompt.goal2": "2. 处理当前 Git 状态、检查失败或冲突。",
    "prompt.goal3": "3. 完成必要检查后，提交并推送当前分支 {branch}。",
  },
};

export function repositoryChangesFromPorcelain(output) {
  const records = String(output ?? "").split("\0");
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }
    const rawStatus = record.slice(0, 2);
    const filePath = normalizeGitPath(record.slice(3));
    if (!filePath) {
      continue;
    }
    const renamed = rawStatus.includes("R") || rawStatus.includes("C");
    const oldPath = renamed ? normalizeGitPath(records[index += 1]) : "";
    changes.push({
      path: filePath,
      ...(oldPath ? { oldPath } : {}),
      status: statusLabel(rawStatus),
      rawStatus,
    });
  }
  return changes;
}

export async function gitStatusPayload({ repo, gitRunner = runGitCommand }) {
  const result = await gitRunner(repo.root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return {
    repo: repo.id,
    branch: repo.branch,
    changes: repositoryChangesFromPorcelain(result.stdout),
  };
}

export async function syncSelectedFiles({
  repo,
  files,
  note = "",
  allChanges = false,
  locale,
  language,
  gitRunner = runGitCommand,
  syncGuard: providedSyncGuard = null,
  operationPathExists = gitOperationPathExists,
}) {
  const translate = gitSyncTranslator({ locale, language });
  let selectedFiles = normalizeSelectedFiles(files);
  if (!allChanges && selectedFiles.length === 0) {
    return failurePayload({
      repo,
      files: selectedFiles,
      step: "validate",
      error: translate("error.selectFiles"),
      locale: translate.locale,
      includeAgentPrompt: false,
    });
  }

  const context = {
    repo,
    files: selectedFiles,
    note: String(note ?? "").trim(),
    locale: translate.locale,
  };
  const syncGuard = providedSyncGuard ?? createGitSyncGuard({ repo, gitRunner });
  let retryCount = 0;
  let driftKind = "none";

  try {
    await preflightGitSync(context, gitRunner, operationPathExists);
    const hasUpstream = await hasUpstreamBranch(context, gitRunner);
    let changes = [];
    let changesByPath = new Map();
    let remoteBehind = 0;

    for (;;) {
      const status = await runStep(context, "status", gitRunner, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      changes = repositoryChangesFromPorcelain(status.stdout);
      if (allChanges) {
        selectedFiles = changes.map((change) => change.path);
        context.files = selectedFiles;
      }
      if (selectedFiles.length === 0) {
        return failurePayload({
          ...context,
          step: "validate",
          error: translate("error.noLocalChanges"),
          retryCount,
          driftKind,
        });
      }

      changesByPath = new Map(changes.map((change) => [change.path, change]));
      const changedFiles = new Set(changes.map((change) => change.path));
      const unchangedFiles = selectedFiles.filter((file) => !changedFiles.has(file));
      if (unchangedFiles.length > 0) {
        return failurePayload({
          ...context,
          step: "validate",
          error: translate("error.selectedFilesUnchanged", {
            files: unchangedFiles.join(", "),
          }),
          retryCount,
          driftKind,
        });
      }

      const baseline = await syncGuard.capture({ changes, files: selectedFiles });
      remoteBehind = 0;
      if (hasUpstream) {
        await runStep(context, "fetch", gitRunner, ["fetch", "origin", repo.branch]);
        const comparison = await runStep(context, "compare remote", gitRunner, [
          "rev-list",
          "--left-right",
          "--count",
          `HEAD...refs/remotes/origin/${repo.branch}`,
        ]);
        const remoteCounts = remoteCommitCounts(comparison.stdout);
        remoteBehind = remoteCounts.behind;
        if (remoteCounts.ahead > 0 && remoteCounts.behind > 0) {
          return failurePayload({
            ...context,
            step: "compare remote",
            error: translate("error.divergedSync"),
            retryCount,
            driftKind,
          });
        }
        const unselectedChanges = changes.filter((change) => !selectedFiles.includes(change.path));
        if (remoteBehind > 0 && unselectedChanges.length > 0) {
          return failurePayload({
            ...context,
            step: "validate",
            error: [
              translate("error.remoteChangedWithUnselected"),
              translate("error.selectAllChanges"),
              ...unselectedChanges.map((change) => `- ${change.path}`),
            ].join("\n"),
            retryCount,
            driftKind,
          });
        }
      }

      const current = await syncGuard.capture({ changes, files: selectedFiles });
      const detectedDrift = syncStateDriftKind(baseline, current);
      if (detectedDrift === "none") {
        break;
      }
      driftKind = detectedDrift;
      if (retryCount >= 1) {
        return failurePayload({
          ...context,
          step: "workspace changed",
          error: translate("error.workspaceStillChanging"),
          retryCount,
          driftKind,
        });
      }
      retryCount += 1;
    }

    const stagePaths = selectedFiles.flatMap((file) => {
      const change = changesByPath.get(file);
      return change?.oldPath ? [file, change.oldPath] : [file];
    });
    await runStep(context, "add", gitRunner, ["add", "-A", "--", ...stagePaths]);
    const staged = await runStep(context, "diff staged", gitRunner, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--",
      ...stagePaths,
    ]);
    if (!staged.stdout.trim()) {
      return failurePayload({
        ...context,
        step: "diff staged",
        error: translate("error.noStagedChanges"),
        retryCount,
        driftKind,
      });
    }

    const commitMessage = await createSyncCommitMessage({
      ...context,
      files: stagePaths,
      changes,
      gitRunner,
    });
    const commitArgs = [
      "commit",
      "-m",
      commitMessage.subject,
      ...(commitMessage.body ? ["-m", commitMessage.body] : []),
      ...(allChanges ? [] : ["--", ...stagePaths]),
    ];
    await runStep(context, "commit", gitRunner, commitArgs);
    let publishHead = await syncGuard.currentHead();
    const worktreeClean = await syncGuard.isWorktreeClean();
    if (!worktreeClean) {
      driftKind = "post_commit_changed";
      if (hasUpstream && remoteBehind > 0) {
        return failurePayload({
          ...context,
          step: "workspace changed",
          error: translate("error.postCommitChanged"),
          retryCount,
          driftKind,
        });
      }
    }
    if (hasUpstream && remoteBehind > 0) {
      try {
        await runStep(context, "rebase remote", gitRunner, [
          "rebase",
          `refs/remotes/origin/${repo.branch}`,
        ]);
      } catch (error) {
        try {
          await gitRunner(repo.root, ["rebase", "--abort"]);
          error.openGlanceRecovery = translate("error.rebaseAbortSucceeded");
        } catch {
          error.openGlanceRecovery = translate("error.rebaseAbortFailed");
        }
        throw error;
      }
      publishHead = await syncGuard.currentHead();
    }
    if (await syncGuard.currentHead() !== publishHead) {
      return failurePayload({
        ...context,
        step: "head changed",
        error: translate("error.headChanged"),
        retryCount,
        driftKind: "head_changed",
      });
    }
    const pushRefspec = `${publishHead}:refs/heads/${repo.branch}`;
    await runStep(context, "push", gitRunner, ["push", "origin", pushRefspec]);
    await verifyRemotePublication(context, publishHead, gitRunner);
    if (!hasUpstream) {
      await runStep(context, "set upstream", gitRunner, [
        "branch",
        `--set-upstream-to=origin/${repo.branch}`,
        "--",
        repo.branch,
      ]);
    }

    return {
      ok: true,
      repo: repo.id,
      branch: repo.branch,
      files: selectedFiles,
      retryCount,
      driftKind,
      remainingChanges: !worktreeClean,
      publishedHead: publishHead,
    };
  } catch (error) {
    return failurePayload({
      ...context,
      step: error.step ?? "git",
      error: commandErrorText(error, { locale: translate.locale }),
      retryCount,
      driftKind,
    });
  }
}

export async function publishCurrentBranch({
  repo,
  files = [],
  locale,
  language,
  gitRunner = runGitCommand,
  operationPathExists = gitOperationPathExists,
}) {
  const translate = gitSyncTranslator({ locale, language });
  const context = {
    repo,
    files: normalizeSelectedFiles(files),
    note: "",
    locale: translate.locale,
  };

  try {
    await preflightGitSync(context, gitRunner, operationPathExists);
    const status = await runStep(context, "status", gitRunner, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    if (String(status.stdout ?? "")) {
      return failurePayload({
        ...context,
        step: "validate",
        error: translate("error.uncommittedBeforePublish"),
      });
    }

    const hasUpstream = await hasUpstreamBranch(context, gitRunner);
    const publishHead = await readCurrentHead(repo, gitRunner);
    let shouldPush = true;
    if (hasUpstream) {
      await runStep(context, "fetch", gitRunner, ["fetch", "origin", repo.branch]);
      const comparison = await runStep(context, "compare remote", gitRunner, [
        "rev-list",
        "--left-right",
        "--count",
        `HEAD...refs/remotes/origin/${repo.branch}`,
      ]);
      const remoteCounts = remoteCommitCounts(comparison.stdout);
      if (remoteCounts.ahead > 0 && remoteCounts.behind > 0) {
        return failurePayload({
          ...context,
          step: "compare remote",
          error: translate("error.divergedPublish"),
        });
      }
      shouldPush = remoteCounts.ahead > 0;
    }

    if (shouldPush) {
      await runStep(context, "push", gitRunner, [
        "push",
        "origin",
        `${publishHead}:refs/heads/${repo.branch}`,
      ]);
    }
    await verifyRemotePublication(context, publishHead, gitRunner);
    if (!hasUpstream) {
      await runStep(context, "set upstream", gitRunner, [
        "branch",
        `--set-upstream-to=origin/${repo.branch}`,
        "--",
        repo.branch,
      ]);
    }

    return {
      ok: true,
      repo: repo.id,
      branch: repo.branch,
      files: context.files,
      publishedHead: publishHead,
    };
  } catch (error) {
    return failurePayload({
      ...context,
      step: error.step ?? "git",
      error: commandErrorText(error, { locale: translate.locale }),
    });
  }
}

export function createGitSyncGuard({ repo, gitRunner = runGitCommand }) {
  return {
    async capture({ changes = [], files = [] } = {}) {
      const normalizedFiles = normalizeSelectedFiles(files);
      const paths = normalizedFiles.flatMap((file) => {
        const change = changes.find((candidate) => candidate.path === file);
        return change?.oldPath ? [file, change.oldPath] : [file];
      });
      const head = await readCurrentHead(repo, gitRunner);
      const status = await gitRunner(repo.root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ...paths,
      ]);
      const diff = await gitRunner(repo.root, [
        "diff",
        "--binary",
        "--no-ext-diff",
        "HEAD",
        "--",
        ...paths,
      ]);
      const untracked = repositoryChangesFromPorcelain(status.stdout)
        .filter((change) => change.status === "untracked")
        .map((change) => change.path)
        .sort();
      const untrackedHashes = [];
      for (const file of untracked) {
        const result = await gitRunner(repo.root, ["hash-object", "--no-filters", "--", file]);
        untrackedHashes.push(`${file}\0${String(result.stdout ?? "").trim()}`);
      }
      const fingerprint = createHash("sha256")
        .update(String(status.stdout ?? ""))
        .update("\0")
        .update(String(diff.stdout ?? ""))
        .update("\0")
        .update(untrackedHashes.join("\0"))
        .digest("hex");
      return { head, fingerprint };
    },
    async currentHead() {
      return readCurrentHead(repo, gitRunner);
    },
    async isWorktreeClean() {
      const result = await gitRunner(repo.root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      return String(result.stdout ?? "") === "";
    },
  };
}

export function syncStateDriftKind(baseline, current) {
  if (baseline?.head !== current?.head) {
    return "head_changed";
  }
  if (baseline?.fingerprint !== current?.fingerprint) {
    return "content_changed";
  }
  return "none";
}

export async function readCurrentHead(repo, gitRunner) {
  const result = await gitRunner(repo.root, ["rev-parse", "--verify", "HEAD"]);
  const head = String(result.stdout ?? "").trim();
  if (!/^[0-9a-f]{40,64}$/i.test(head)) {
    const error = new ExternalCommandOutputError("git", ["rev-parse", "--verify", "HEAD"], "an invalid commit id");
    error.step = "sync guard";
    throw error;
  }
  return head;
}

async function preflightGitSync(context, gitRunner, operationPathExists) {
  const translate = gitSyncTranslator(context);
  const name = await requiredGitValue(
    context,
    gitRunner,
    ["config", "--get", "user.name"],
    translate("error.gitNameMissing"),
  );
  const email = await requiredGitValue(
    context,
    gitRunner,
    ["config", "--get", "user.email"],
    translate("error.gitEmailMissing"),
  );
  const origin = await requiredGitValue(
    context,
    gitRunner,
    ["remote", "get-url", "origin"],
    translate("error.originMissing"),
  );

  await assertNoGitOperationInProgress(context, gitRunner, operationPathExists);

  return { name, email, origin };
}

export async function assertNoGitOperationInProgress(context, gitRunner, operationPathExists) {
  const translate = gitSyncTranslator(context);
  const conflicts = await runStep(context, "preflight", gitRunner, [
    "ls-files",
    "--unmerged",
    "-z",
  ]);
  if (String(conflicts.stdout ?? "").split("\0").some(Boolean)) {
    const error = new Error(translate("error.unresolvedConflicts"));
    error.step = "preflight";
    throw error;
  }

  const activeOperations = [];
  for (const [gitRef, label] of IN_PROGRESS_GIT_REFS) {
    try {
      const result = await gitRunner(context.repo.root, ["rev-parse", "-q", "--verify", gitRef]);
      if (String(result.stdout ?? "").trim()) {
        activeOperations.push(label);
      }
    } catch (error) {
      if (!isExternalCommandExit(error, 1)) {
        error.step = "preflight";
        throw error;
      }
      // Exit 1 means the operation ref does not exist, which is the normal state.
    }
  }
  for (const stateName of REBASE_STATE_PATHS) {
    let result;
    try {
      result = await gitRunner(context.repo.root, ["rev-parse", "--git-path", stateName]);
    } catch (error) {
      error.step = "preflight";
      throw error;
    }
    const statePath = String(result.stdout ?? "").trim();
    const resolvedStatePath = path.isAbsolute(statePath)
      ? statePath
      : path.resolve(context.repo.root, statePath);
    if (statePath) {
      try {
        if (await operationPathExists(resolvedStatePath)) {
          activeOperations.push("rebase");
          break;
        }
      } catch (error) {
        error.step = "preflight";
        throw error;
      }
    }
  }
  if (activeOperations.length > 0) {
    const error = new Error(translate("error.operationInProgress", {
      operations: activeOperations.join(" / "),
    }));
    error.step = "preflight";
    throw error;
  }
}

export async function gitOperationPathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function hasUpstreamBranch(context, gitRunner) {
  try {
    const result = await gitRunner(context.repo.root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    return Boolean(String(result.stdout ?? "").trim());
  } catch (error) {
    if (gitCommandReportsMissingUpstream(error)) {
      return false;
    }
    error.step = "preflight";
    throw error;
  }
}

export function remoteCommitCounts(output) {
  const value = String(output ?? "").trim();
  if (!/^\d+\s+\d+$/.test(value)) {
    const error = new ExternalCommandOutputError(
      "git",
      ["rev-list", "--left-right", "--count"],
      "invalid ahead and behind counts",
    );
    error.step = "compare remote";
    throw error;
  }
  const [ahead, behind] = value.split(/\s+/);
  return {
    ahead: Number.parseInt(ahead, 10),
    behind: Number.parseInt(behind, 10),
  };
}

async function requiredGitValue(context, gitRunner, args, message) {
  let result;
  try {
    result = await gitRunner(context.repo.root, args);
  } catch (error) {
    if (!gitCommandReportsMissingRequiredValue(error, args)) {
      error.step = "preflight";
      throw error;
    }
    const missingValue = new Error(message, { cause: error });
    missingValue.step = "preflight";
    missingValue.stderr = message;
    throw missingValue;
  }

  const value = String(result.stdout ?? "").trim();
  if (!value) {
    const error = new Error(message);
    error.step = "preflight";
    error.stderr = message;
    throw error;
  }
  return value;
}

async function runStep(context, step, gitRunner, args) {
  try {
    return await gitRunner(context.repo.root, args);
  } catch (error) {
    error.step = step;
    throw error;
  }
}

async function verifyRemotePublication(context, revision, gitRunner) {
  const translate = gitSyncTranslator(context);
  await runStep(context, "verify publication", gitRunner, [
    "fetch",
    "origin",
    context.repo.branch,
  ]);
  try {
    await runStep(context, "verify publication", gitRunner, [
      "merge-base",
      "--is-ancestor",
      revision,
      `refs/remotes/origin/${context.repo.branch}`,
    ]);
  } catch (error) {
    if (!isExternalCommandExit(error, 1)) {
      throw error;
    }
    const publicationError = new Error(
      translate("error.remoteMissingCommit", {
        branch: context.repo.branch,
      }),
    );
    publicationError.step = "verify publication";
    throw publicationError;
  }
}

function failurePayload({
  repo,
  files,
  step,
  error,
  locale,
  language,
  retryCount = 0,
  driftKind = "none",
  includeAgentPrompt = true,
}) {
  const translate = gitSyncTranslator({ locale, language });
  const errorText = String(error || translate("error.unknownGit")).trim();
  return {
    ok: false,
    repo: repo.id,
    branch: repo.branch,
    files,
    step,
    error: errorText,
    retryCount,
    driftKind,
    resultTitle: translate("result.title"),
    resultHelp: translate("result.help"),
    agentPrompt: includeAgentPrompt
      ? buildGitSyncAgentPrompt({
          repo,
          files,
          step,
          error: errorText,
          locale: translate.locale,
        })
      : "",
  };
}

export function buildGitSyncAgentPrompt({
  repo,
  files = [],
  step = "git",
  error = "",
  locale,
  language,
}) {
  const translate = gitSyncTranslator({ locale, language });
  return [
    translate("prompt.title"),
    "",
    translate("prompt.repository", { repo: repo.id }),
    translate("prompt.repositoryPath", { path: repo.root }),
    translate("prompt.branch", { branch: repo.branch }),
    translate("prompt.files"),
    ...files.map((file) => `- ${file}`),
    "",
    translate("prompt.step", { step }),
    translate("prompt.error"),
    error || translate("prompt.noError"),
    "",
    translate("prompt.goals"),
    translate("prompt.goal1"),
    translate("prompt.goal2"),
    translate("prompt.goal3", { branch: repo.branch }),
  ].join("\n");
}

function normalizeSelectedFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }
  const seen = new Set();
  const selected = [];
  for (const file of files) {
    const normalized = normalizeGitPath(String(file ?? ""));
    if (
      normalized &&
      !normalized.startsWith("../") &&
      !normalized.startsWith("/") &&
      !normalized.split("/").includes("..") &&
      !normalized.startsWith(".git/") &&
      !seen.has(normalized)
    ) {
      seen.add(normalized);
      selected.push(normalized);
    }
  }
  return selected;
}

function normalizeGitPath(filePath) {
  return String(filePath ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "");
}

function statusLabel(rawStatus) {
  if (rawStatus === "??") {
    return "untracked";
  }
  if (rawStatus.includes("D")) {
    return "deleted";
  }
  if (rawStatus.includes("A")) {
    return "added";
  }
  if (rawStatus.includes("R")) {
    return "renamed";
  }
  if (rawStatus.includes("C")) {
    return "copied";
  }
  return "modified";
}

function gitSyncTranslator({ locale, language } = {}) {
  return createTranslator(GIT_SYNC_MESSAGES, locale ?? language);
}

export function commandErrorText(error, { locale, language } = {}) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const recovery = typeof error?.openGlanceRecovery === "string" ? error.openGlanceRecovery.trim() : "";
  const state = externalCommandState(error);
  const stateMessage = commandStateMessage(state, { locale, language });
  return [stateMessage, stderr, stdout, message, recovery].filter(Boolean).join("\n");
}

function gitCommandReportsMissingUpstream(error) {
  return isExternalCommandExit(error, 128)
    && /no upstream configured|no upstream branch/i.test(externalCommandOutput(error));
}

function gitCommandReportsMissingRequiredValue(error, args) {
  if (args[0] === "config" && args[1] === "--get") {
    return isExternalCommandExit(error, 1);
  }
  if (args[0] === "remote" && args[1] === "get-url") {
    return isExternalCommandExit(error, 2, 128)
      && /no such remote/i.test(externalCommandOutput(error));
  }
  return false;
}

function commandStateMessage(state, { locale, language } = {}) {
  const translate = gitSyncTranslator({ locale, language });
  if (state === "unavailable") return translate("state.unavailable");
  if (state === "permission_denied") return translate("state.permissionDenied");
  if (state === "unsupported") return translate("state.unsupported");
  if (state === "invalid_context") return translate("state.invalidContext");
  if (state === "authentication_required") return translate("state.authenticationRequired");
  if (state === "network_unavailable") return translate("state.networkUnavailable");
  if (state === "interrupted") return translate("state.interrupted");
  if (state === "invalid_output") return translate("state.invalidOutput");
  return "";
}

export function runGitCommand(cwd, args) {
  return runExternalCommand("git", args, { cwd });
}
