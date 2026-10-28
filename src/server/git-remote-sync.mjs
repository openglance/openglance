import { withWorktreeMutation } from "./worktree-mutation.mjs";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createTranslator } from "../../public/i18n.js";
import {
  assertNoGitOperationInProgress,
  commandErrorText,
  createGitSyncGuard,
  gitOperationPathExists,
  readCurrentHead,
  remoteCommitCounts,
  repositoryChangesFromPorcelain,
  runGitCommand,
  syncStateDriftKind,
} from "./git-sync.mjs";
import {
  createImmutableGitSnapshot,
  createImmutableGitTree,
  parseGitOid,
  rebaseImmutableGitSnapshot,
  runGitSnapshotCommand,
} from "./git-immutable-snapshot.mjs";

const REMOTE_SYNC_MESSAGES = {
  en: {
    "result.title": "Remote merge needs attention",
    "result.help": "OpenGlance left your local files uncommitted. Copy the prompt only if you want an AI Agent to continue.",
    "error.noBranch": "The current worktree is not on a branch, so OpenGlance cannot check its remote branch.",
    "error.noOrigin": "Git remote `origin` is not configured.",
    "error.remoteBranchMissing": "Remote branch origin/{branch} does not exist yet.",
    "error.diverged": "The current branch and origin/{branch} have diverged. OpenGlance did not rewrite either history.",
    "error.remoteChanged": "The fetched remote version changed before OpenGlance could apply it. Nothing was changed; OpenGlance will check the newer version.",
    "error.preparationExpired": "The prepared remote update expired before it could be applied. Nothing was changed; OpenGlance will prepare it again.",
    "error.confirmLocalChanges": "Local files changed while OpenGlance checked the remote. Review the changes and choose “Merge remote changes” if you want to continue.",
    "error.workspaceChanged": "The workspace changed while OpenGlance prepared the remote merge. Nothing was applied. Try again after the current edit is saved.",
    "error.conflict": "The remote update conflicts with local edits. OpenGlance did not apply the merge to the real workspace.",
    "error.rollback": "OpenGlance could not fully roll back an interrupted remote merge. Preserve the recovery ref and hand the repository to an AI Agent.",
    "prompt.title": "Please finish this OpenGlance remote merge:",
    "prompt.repository": "Repository: {repo}",
    "prompt.repositoryPath": "Repository path: {path}",
    "prompt.branch": "Current branch: {branch}",
    "prompt.step": "Failed step: {step}",
    "prompt.error": "Error output:",
    "prompt.recovery": "Recovery ref: {ref}",
    "prompt.files": "Affected files:",
    "prompt.goals": "Goals:",
    "prompt.goal1": "1. Preserve every uncommitted local change.",
    "prompt.goal2": "2. Merge origin/{branch} into the local workspace and resolve conflicts.",
    "prompt.goal3": "3. Leave the result uncommitted and do not push it.",
  },
  "zh-CN": {
    "result.title": "合并远端修改需要处理",
    "result.help": "OpenGlance 会保留本地文件为未提交状态。只有需要 AI Agent 继续处理时，才复制下面的提示词。",
    "error.noBranch": "当前工作树不在分支上，OpenGlance 无法检查对应的远端分支。",
    "error.noOrigin": "尚未配置 Git 远端 `origin`。",
    "error.remoteBranchMissing": "远端分支 origin/{branch} 尚不存在。",
    "error.diverged": "当前分支与 origin/{branch} 已经分叉。OpenGlance 没有改写任何一侧的历史。",
    "error.remoteChanged": "准备应用期间，已获取的远端版本发生了变化。OpenGlance 没有修改工作区，并会按较新的版本重新检查。",
    "error.preparationExpired": "远端更新的准备结果在应用前已经失效。OpenGlance 没有修改工作区，并会重新准备。",
    "error.confirmLocalChanges": "检查远端期间本地文件发生了变化。请查看改动，并在愿意继续时点击“合并远端修改”。",
    "error.workspaceChanged": "准备合并期间工作区仍在变化。OpenGlance 没有应用任何修改；请等待当前编辑保存后重试。",
    "error.conflict": "远端更新与本地编辑发生冲突。OpenGlance 没有把冲突应用到真实工作区。",
    "error.rollback": "OpenGlance 未能完整回退一次中断的远端合并。请保留恢复引用，并交给 AI Agent 处理。",
    "prompt.title": "请继续处理 OpenGlance 的远端合并：",
    "prompt.repository": "仓库：{repo}",
    "prompt.repositoryPath": "仓库路径：{path}",
    "prompt.branch": "当前分支：{branch}",
    "prompt.step": "失败步骤：{step}",
    "prompt.error": "错误输出：",
    "prompt.recovery": "恢复引用：{ref}",
    "prompt.files": "涉及文件：",
    "prompt.goals": "目标：",
    "prompt.goal1": "1. 保留全部尚未提交的本地修改。",
    "prompt.goal2": "2. 把 origin/{branch} 合入本地工作区并处理冲突。",
    "prompt.goal3": "3. 最终结果保持未提交，不要推送。",
  },
};

export async function inspectRemoteSync({
  repo,
  refresh = true,
  locale,
  language,
  gitRunner = runGitCommand,
  now = () => new Date(),
}) {
  const translate = remoteSyncTranslator({ locale, language });
  const checkedAt = now().toISOString();
  if (!repo.branch || repo.detached) {
    return remoteStatusFailure({
      repo,
      checkedAt,
      code: "no_branch",
      error: translate("error.noBranch"),
    });
  }

  const remoteRef = remoteTrackingRef(repo.branch);
  try {
    await requireOrigin(repo, gitRunner, translate);
    if (refresh) {
      await runRemoteStep(repo, "fetch", gitRunner, [
        "fetch",
        "--no-tags",
        "origin",
        `+refs/heads/${repo.branch}:${remoteRef}`,
      ]);
    }
    const head = await readCurrentHead(repo, gitRunner);
    const remoteCommit = parseGitOid(
      (await runRemoteStep(repo, "read remote", gitRunner, [
        "rev-parse",
        "--verify",
        remoteRef,
      ])).stdout,
      "remote commit",
    );
    const counts = remoteCommitCounts(
      (await runRemoteStep(repo, "compare remote", gitRunner, [
        "rev-list",
        "--left-right",
        "--count",
        `HEAD...${remoteRef}`,
      ])).stdout,
    );
    const status = await runRemoteStep(repo, "status", gitRunner, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const changes = repositoryChangesFromPorcelain(status.stdout);
    const incoming = counts.behind > 0
      ? (await runRemoteStep(repo, "list remote changes", gitRunner, [
          "diff",
          "--name-only",
          "-z",
          "HEAD",
          remoteRef,
          "--",
        ])).stdout.split("\0").filter(Boolean)
      : [];

    return {
      ok: true,
      repo: repo.id,
      branch: repo.branch,
      checkedAt,
      head,
      remoteCommit,
      remoteRef,
      ahead: counts.ahead,
      behind: counts.behind,
      state: remoteStateFromCounts(counts),
      localChangeCount: changes.length,
      incomingFiles: incoming,
      incomingCount: incoming.length,
    };
  } catch (error) {
    const missingRemoteBranch = remoteBranchIsMissing(error);
    return remoteStatusFailure({
      repo,
      checkedAt,
      code: missingRemoteBranch ? "no_remote_branch" : "check_failed",
      error: missingRemoteBranch
        ? translate("error.remoteBranchMissing", { branch: repo.branch })
        : commandErrorText(error, { locale: translate.locale }),
    });
  }
}

const DEFAULT_REMOTE_MERGE_PREPARATION_TTL_MS = 60_000;

export function createRemoteMergePreparationStore({
  ttlMs = DEFAULT_REMOTE_MERGE_PREPARATION_TTL_MS,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
} = {}) {
  const entries = new Map();

  async function cancel(preparationToken) {
    const entry = entries.get(preparationToken);
    if (!entry) {
      return false;
    }
    entries.delete(preparationToken);
    cancelSchedule(entry.timer);
    await entry.preparation.cleanup();
    return true;
  }

  return {
    put(preparation) {
      const preparationToken = randomBytes(24).toString("hex");
      const timer = schedule(() => {
        void cancel(preparationToken);
      }, Math.max(1, Number(ttlMs) || DEFAULT_REMOTE_MERGE_PREPARATION_TTL_MS));
      timer?.unref?.();
      entries.set(preparationToken, { preparation, timer });
      return preparationToken;
    },
    take(preparationToken, repo) {
      const entry = entries.get(preparationToken);
      if (!entry || !preparedMergeMatchesRepository(entry.preparation, repo)) {
        return null;
      }
      entries.delete(preparationToken);
      cancelSchedule(entry.timer);
      return entry.preparation;
    },
    cancel,
    async dispose() {
      await Promise.all([...entries.keys()].map((preparationToken) => cancel(preparationToken)));
    },
  };
}

export async function prepareRemoteChanges({
  repo,
  preparationStore,
  allowLocalChanges = false,
  refresh = true,
  expectedHead = "",
  expectedRemoteCommit = "",
  locale,
  language,
  gitRunner = runGitCommand,
  snapshotCommandRunner = runGitSnapshotCommand,
  operationPathExists = gitOperationPathExists,
  now = () => new Date(),
}) {
  if (!preparationStore?.put) {
    throw new TypeError("A remote merge preparation store is required.");
  }
  const translate = remoteSyncTranslator({ locale, language });
  const remote = await inspectRemoteSync({
    repo,
    refresh,
    locale: translate.locale,
    gitRunner,
    now,
  });
  const preflightFailure = remoteMergePreflightFailure({
    repo,
    remote,
    expectedHead,
    expectedRemoteCommit,
    translate,
  });
  if (preflightFailure) {
    return preflightFailure;
  }
  if (remote.behind === 0) {
    return {
      ...remote,
      prepared: false,
      applied: false,
      mode: "none",
    };
  }

  const context = { repo, locale: translate.locale };
  try {
    return await withWorktreeMutation(repo.root, async () => {
      await assertNoGitOperationInProgress(context, gitRunner, operationPathExists);
      const status = await runRemoteStep(repo, "status", gitRunner, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      const changes = repositoryChangesFromPorcelain(status.stdout);
      if (changes.length === 0) {
        return await prepareCleanRemoteMerge({
          repo,
          remote,
          preparationStore,
          translate,
          gitRunner,
        });
      }
      if (!allowLocalChanges) {
        return remoteMergeFailure({
          repo,
          translate,
          step: "confirm local changes",
          error: translate("error.confirmLocalChanges"),
          code: "local_changes_require_confirmation",
          files: changes.map((change) => change.path),
          includeAgentPrompt: false,
          checkedAt: remote.checkedAt,
          remote,
        });
      }
      return await prepareDirtyRemoteMerge({
        repo,
        remote,
        changes,
        preparationStore,
        translate,
        gitRunner,
        snapshotCommandRunner,
      });
    });
  } catch (error) {
    return remoteMergeFailure({
      repo,
      translate,
      step: error.step ?? "prepare remote merge",
      error: commandErrorText(error, { locale: translate.locale }),
      code: "merge_failed",
      files: remote.incomingFiles,
      checkedAt: remote.checkedAt,
      remote,
    });
  }
}

export async function applyPreparedRemoteChanges({
  repo,
  preparationToken,
  preparationStore,
  locale,
  language,
  gitRunner = runGitCommand,
  snapshotCommandRunner = runGitSnapshotCommand,
  operationPathExists = gitOperationPathExists,
  now = () => new Date(),
}) {
  if (!preparationStore?.take) {
    throw new TypeError("A remote merge preparation store is required.");
  }
  const translate = remoteSyncTranslator({ locale, language });
  const preparation = preparationStore.take(String(preparationToken || ""), repo);
  if (!preparation) {
    return remoteMergeFailure({
      repo,
      translate,
      step: "load prepared remote merge",
      error: translate("error.preparationExpired"),
      code: "preparation_expired",
      includeAgentPrompt: false,
      checkedAt: now().toISOString(),
    });
  }

  try {
    return await withWorktreeMutation(repo.root, async () => {
      await assertNoGitOperationInProgress(
        { repo, locale: translate.locale },
        gitRunner,
        operationPathExists,
      );
      const currentRemoteCommit = parseGitOid(
        (await runRemoteStep(repo, "confirm remote version", gitRunner, [
          "rev-parse",
          "--verify",
          preparation.remote.remoteRef,
        ])).stdout,
        "remote commit",
      );
      if (currentRemoteCommit !== preparation.remote.remoteCommit) {
        return preparedRemoteMergeDriftFailure({
          repo,
          preparation,
          translate,
          code: "remote_changed",
        });
      }
      const guard = createGitSyncGuard({ repo, gitRunner });
      const current = await guard.capture();
      if (syncStateDriftKind(preparation.baseline, current) !== "none") {
        return preparedRemoteMergeDriftFailure({
          repo,
          preparation,
          translate,
          code: "workspace_changed",
        });
      }
      if (preparation.kind === "clean") {
        await runRemoteStep(repo, "fast-forward", gitRunner, [
          "merge",
          "--ff-only",
          preparation.remote.remoteCommit,
        ]);
        return successfulRemoteMerge({
          remote: preparation.remote,
          changes: [],
          mode: "fast_forward",
        });
      }
      return await applyPreparedDirtyRemoteMerge({
        repo,
        preparation,
        translate,
        gitRunner,
        snapshotCommandRunner,
        guard,
      });
    });
  } catch (error) {
    return remoteMergeFailure({
      repo,
      translate,
      step: error.step ?? "apply prepared remote merge",
      error: commandErrorText(error, { locale: translate.locale }),
      code: "merge_failed",
      files: preparation.remote.incomingFiles,
      checkedAt: preparation.remote.checkedAt,
      remote: preparation.remote,
    });
  } finally {
    await preparation.cleanup();
  }
}

export async function cancelPreparedRemoteChanges({
  preparationToken,
  preparationStore,
}) {
  if (!preparationStore?.cancel) {
    return false;
  }
  return preparationStore.cancel(String(preparationToken || ""));
}

export async function mergeRemoteChanges(options) {
  const preparationStore = createRemoteMergePreparationStore();
  try {
    const prepared = await prepareRemoteChanges({
      ...options,
      preparationStore,
    });
    if (!prepared.ok || !prepared.prepared) {
      return prepared;
    }
    return await applyPreparedRemoteChanges({
      repo: options.repo,
      preparationToken: prepared.preparationToken,
      preparationStore,
      locale: options.locale,
      language: options.language,
      gitRunner: options.gitRunner,
      snapshotCommandRunner: options.snapshotCommandRunner,
      operationPathExists: options.operationPathExists,
      now: options.now,
    });
  } finally {
    await preparationStore.dispose();
  }
}

async function prepareCleanRemoteMerge({
  repo,
  remote,
  preparationStore,
  translate,
  gitRunner,
}) {
  const guard = createGitSyncGuard({ repo, gitRunner });
  const baseline = await guard.capture();
  const clean = await guard.isWorktreeClean();
  const afterCheck = await guard.capture();
  if (
    !clean
    || baseline.head !== remote.head
    || syncStateDriftKind(baseline, afterCheck) !== "none"
  ) {
    return preparedRemoteMergeDriftFailure({
      repo,
      preparation: { remote, changedFiles: [] },
      translate,
      code: "workspace_changed",
    });
  }
  const preparationToken = preparationStore.put({
    kind: "clean",
    repoId: repo.id,
    repoRoot: repo.root,
    branch: repo.branch,
    remote,
    baseline,
    changedFiles: [],
    cleanup: async () => {},
  });
  return preparedRemoteMergePayload({
    remote,
    preparationToken,
    changes: [],
    mode: "fast_forward",
  });
}

async function prepareDirtyRemoteMerge({
  repo,
  remote,
  changes,
  preparationStore,
  translate,
  gitRunner,
  snapshotCommandRunner,
}) {
  let temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-remote-merge-"));
  const indexPath = path.join(temporaryRoot, "snapshot.index");
  const verificationIndexPath = path.join(temporaryRoot, "verification.index");
  const patchPath = path.join(temporaryRoot, "remote.patch");
  const guard = createGitSyncGuard({ repo, gitRunner });
  const changedFiles = changes.map((change) => change.path);
  try {
    const baseline = await guard.capture();
    const snapshot = await createImmutableGitSnapshot({
      repoRoot: repo.root,
      indexPath,
      commandRunner: snapshotCommandRunner,
    });
    const afterSnapshot = await guard.capture();
    if (
      snapshot.baseCommit !== remote.head
      || syncStateDriftKind(baseline, afterSnapshot) !== "none"
    ) {
      return preparedRemoteMergeDriftFailure({
        repo,
        preparation: { remote, changedFiles },
        translate,
        code: "workspace_changed",
      });
    }

    const rebased = await rebaseImmutableGitSnapshot({
      repoRoot: repo.root,
      snapshotCommit: snapshot.snapshotCommit,
      remoteCommit: remote.remoteCommit,
      commandRunner: snapshotCommandRunner,
    });
    if (!rebased.ok) {
      return remoteMergeFailure({
        repo,
        translate,
        step: "merge snapshots",
        error: translate("error.conflict"),
        code: "conflict",
        files: [...new Set([...changedFiles, ...remote.incomingFiles])],
        checkedAt: remote.checkedAt,
        remote,
      });
    }

    await snapshotCommandRunner(repo.root, [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      `--output=${patchPath}`,
      snapshot.snapshotCommit,
      rebased.rebasedCommit,
      "--",
    ]);
    const beforePatchCheck = await guard.capture();
    if (syncStateDriftKind(baseline, beforePatchCheck) !== "none") {
      return preparedRemoteMergeDriftFailure({
        repo,
        preparation: { remote, changedFiles },
        translate,
        code: "workspace_changed",
      });
    }
    const hasPatch = (await stat(patchPath)).size > 0;
    if (hasPatch) {
      await snapshotCommandRunner(repo.root, [
        "apply",
        "--check",
        "--binary",
        "--whitespace=nowarn",
        patchPath,
      ]);
    }
    const afterPatchCheck = await guard.capture();
    if (syncStateDriftKind(baseline, afterPatchCheck) !== "none") {
      return preparedRemoteMergeDriftFailure({
        repo,
        preparation: { remote, changedFiles },
        translate,
        code: "workspace_changed",
      });
    }

    const retainedTemporaryRoot = temporaryRoot;
    const preparationToken = preparationStore.put({
      kind: "dirty",
      repoId: repo.id,
      repoRoot: repo.root,
      branch: repo.branch,
      remote,
      changes,
      changedFiles,
      baseline,
      snapshot,
      rebased,
      patchPath,
      verificationIndexPath,
      hasPatch,
      cleanup: async () => {
        await rm(retainedTemporaryRoot, { recursive: true, force: true });
      },
    });
    temporaryRoot = "";
    return preparedRemoteMergePayload({
      remote,
      preparationToken,
      changes,
      mode: "preserve_local_changes",
    });
  } finally {
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

async function applyPreparedDirtyRemoteMerge({
  repo,
  preparation,
  translate,
  gitRunner,
  snapshotCommandRunner,
  guard,
}) {
  const {
    remote,
    snapshot,
    rebased,
    patchPath,
    verificationIndexPath,
    hasPatch,
    changedFiles,
  } = preparation;
  let recoveryRef = "";
  let patchApplied = false;
  let refMoved = false;

  try {
    if (hasPatch) {
      await snapshotCommandRunner(repo.root, [
        "apply",
        "--check",
        "--binary",
        "--whitespace=nowarn",
        patchPath,
      ]);
    }
    const beforeApply = await guard.capture();
    if (syncStateDriftKind(preparation.baseline, beforeApply) !== "none") {
      return preparedRemoteMergeDriftFailure({
        repo,
        preparation,
        translate,
        code: "workspace_changed",
      });
    }

    recoveryRef = recoveryReference();
    await runRemoteStep(repo, "create recovery ref", gitRunner, [
      "update-ref",
      "-m",
      "OpenGlance remote merge recovery",
      recoveryRef,
      snapshot.snapshotCommit,
    ]);
    if (hasPatch) {
      await snapshotCommandRunner(repo.root, [
        "apply",
        "--binary",
        "--whitespace=nowarn",
        patchPath,
      ]);
      patchApplied = true;
    }
    await runRemoteStep(repo, "advance branch", gitRunner, [
      "update-ref",
      "-m",
      "OpenGlance merged remote changes",
      `refs/heads/${repo.branch}`,
      remote.remoteCommit,
      snapshot.baseCommit,
    ]);
    refMoved = true;
    await runRemoteStep(repo, "reset index", gitRunner, [
      "read-tree",
      remote.remoteCommit,
    ]);

    const finalHead = await readCurrentHead(repo, gitRunner);
    const finalTree = await createImmutableGitTree({
      repoRoot: repo.root,
      indexPath: verificationIndexPath,
      commandRunner: snapshotCommandRunner,
    });
    if (finalHead !== remote.remoteCommit || finalTree !== rebased.tree) {
      const error = new Error("The merged workspace did not match the verified snapshot.");
      error.step = "verify merged workspace";
      throw error;
    }
    await deleteRecoveryReference(repo, recoveryRef, snapshot.snapshotCommit, gitRunner);
    recoveryRef = "";

    const finalStatus = await runRemoteStep(repo, "status", gitRunner, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    return successfulRemoteMerge({
      remote,
      changes: repositoryChangesFromPorcelain(finalStatus.stdout),
      mode: "preserve_local_changes",
    });
  } catch (error) {
    const rollback = await rollbackInterruptedMerge({
      repo,
      remote,
      baseline: preparation.baseline,
      patchPath,
      recoveryRef,
      patchApplied,
      refMoved,
      gitRunner,
      snapshotCommandRunner,
    });
    return remoteMergeFailure({
      repo,
      translate,
      step: error.step ?? "merge remote",
      error: [
        commandErrorText(error, { locale: translate.locale }),
        ...(rollback.ok ? [] : [translate("error.rollback")]),
      ].filter(Boolean).join("\n"),
      code: rollback.ok ? "merge_failed" : "recovery_required",
      files: [...new Set([...changedFiles, ...remote.incomingFiles])],
      checkedAt: remote.checkedAt,
      recoveryRef: rollback.ok ? "" : recoveryRef,
      remote,
    });
  }
}

function remoteMergePreflightFailure({
  repo,
  remote,
  expectedHead,
  expectedRemoteCommit,
  translate,
}) {
  if (!remote.ok) {
    return remoteMergeFailure({
      repo,
      translate,
      step: "check remote",
      error: remote.error,
      code: remote.code,
      includeAgentPrompt: false,
      checkedAt: remote.checkedAt,
    });
  }
  if (expectedRemoteCommit && remote.remoteCommit !== expectedRemoteCommit) {
    return remoteMergeFailure({
      repo,
      translate,
      step: "confirm remote version",
      error: translate("error.remoteChanged"),
      code: "remote_changed",
      files: remote.incomingFiles,
      includeAgentPrompt: false,
      checkedAt: remote.checkedAt,
      remote,
    });
  }
  if (expectedHead && remote.head !== expectedHead) {
    return remoteMergeFailure({
      repo,
      translate,
      step: "confirm workspace version",
      error: translate("error.workspaceChanged"),
      code: "workspace_changed",
      files: remote.incomingFiles,
      includeAgentPrompt: false,
      checkedAt: remote.checkedAt,
      remote,
    });
  }
  if (remote.ahead > 0 && remote.behind > 0) {
    return remoteMergeFailure({
      repo,
      translate,
      step: "compare remote",
      error: translate("error.diverged", { branch: repo.branch }),
      code: "diverged",
      files: remote.incomingFiles,
      checkedAt: remote.checkedAt,
      remote,
    });
  }
  return null;
}

function preparedRemoteMergePayload({
  remote,
  preparationToken,
  changes,
  mode,
}) {
  return {
    ...remote,
    prepared: true,
    applied: false,
    preparationToken,
    mode,
    localChangeCount: changes.length,
    changes,
  };
}

function preparedRemoteMergeDriftFailure({
  repo,
  preparation,
  translate,
  code,
}) {
  return remoteMergeFailure({
    repo,
    translate,
    step: code === "remote_changed" ? "confirm remote version" : "verify workspace",
    error: translate(code === "remote_changed" ? "error.remoteChanged" : "error.workspaceChanged"),
    code,
    files: preparation.changedFiles ?? preparation.remote.incomingFiles,
    includeAgentPrompt: false,
    checkedAt: preparation.remote.checkedAt,
    remote: preparation.remote,
  });
}

function preparedMergeMatchesRepository(preparation, repo) {
  return preparation.repoId === repo.id
    && preparation.repoRoot === repo.root
    && preparation.branch === repo.branch;
}

async function rollbackInterruptedMerge({
  repo,
  remote,
  baseline,
  patchPath,
  recoveryRef,
  patchApplied,
  refMoved,
  gitRunner,
  snapshotCommandRunner,
}) {
  try {
    if (refMoved) {
      await gitRunner(repo.root, [
        "update-ref",
        "-m",
        "OpenGlance rolled back remote merge",
        `refs/heads/${repo.branch}`,
        baseline.head,
        remote.remoteCommit,
      ]);
      await gitRunner(repo.root, ["read-tree", baseline.head]);
    }
    if (patchApplied) {
      await snapshotCommandRunner(repo.root, [
        "apply",
        "--reverse",
        "--binary",
        "--whitespace=nowarn",
        patchPath,
      ]);
    }
    if (recoveryRef) {
      await deleteRecoveryReference(repo, recoveryRef, null, gitRunner);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function successfulRemoteMerge({ remote, changes, mode }) {
  return {
    ...remote,
    ok: true,
    state: remote.ahead > 0 ? "local_ahead" : "current",
    behind: 0,
    incomingFiles: [],
    incomingCount: 0,
    localChangeCount: changes.length,
    changes,
    applied: true,
    mode,
    updatedAt: new Date().toISOString(),
  };
}

function remoteMergeFailure({
  repo,
  translate,
  step,
  error,
  code,
  files = [],
  includeAgentPrompt = true,
  checkedAt,
  recoveryRef = "",
  remote = null,
}) {
  const errorText = String(error || "").trim();
  return {
    ok: false,
    repo: repo.id,
    branch: repo.branch,
    checkedAt,
    code,
    step,
    error: errorText,
    files,
    resultTitle: translate("result.title"),
    resultHelp: translate("result.help"),
    agentPrompt: includeAgentPrompt
      ? buildRemoteMergeAgentPrompt({
          repo,
          files,
          step,
          error: errorText,
          recoveryRef,
          locale: translate.locale,
        })
      : "",
    ...(remote
      ? {
          remoteOk: true,
          head: remote.head,
          remoteCommit: remote.remoteCommit,
          ahead: remote.ahead,
          behind: remote.behind,
          incomingCount: remote.incomingCount,
          incomingFiles: remote.incomingFiles,
          state: remote.state,
        }
      : {}),
  };
}

export function buildRemoteMergeAgentPrompt({
  repo,
  files = [],
  step = "merge remote",
  error = "",
  recoveryRef = "",
  locale,
  language,
}) {
  const translate = remoteSyncTranslator({ locale, language });
  return [
    translate("prompt.title"),
    "",
    translate("prompt.repository", { repo: repo.id }),
    translate("prompt.repositoryPath", { path: repo.root }),
    translate("prompt.branch", { branch: repo.branch }),
    ...(recoveryRef ? [translate("prompt.recovery", { ref: recoveryRef })] : []),
    translate("prompt.files"),
    ...files.map((file) => `- ${file}`),
    "",
    translate("prompt.step", { step }),
    translate("prompt.error"),
    error,
    "",
    translate("prompt.goals"),
    translate("prompt.goal1"),
    translate("prompt.goal2", { branch: repo.branch }),
    translate("prompt.goal3"),
  ].join("\n");
}

async function requireOrigin(repo, gitRunner, translate) {
  try {
    const result = await gitRunner(repo.root, ["remote", "get-url", "origin"]);
    if (String(result.stdout ?? "").trim()) {
      return;
    }
  } catch (error) {
    if (!/no such remote/i.test(String(error?.stderr ?? error?.message ?? ""))) {
      error.step = "check origin";
      throw error;
    }
  }
  const error = new Error(translate("error.noOrigin"));
  error.step = "check origin";
  throw error;
}

async function deleteRecoveryReference(repo, recoveryRef, oldValue, gitRunner) {
  if (!recoveryRef) {
    return;
  }
  await gitRunner(repo.root, [
    "update-ref",
    "-d",
    recoveryRef,
    ...(oldValue ? [oldValue] : []),
  ]);
}

function recoveryReference() {
  return `refs/openglance/recovery/remote-merge-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function remoteTrackingRef(branch) {
  return `refs/remotes/origin/${branch}`;
}

function remoteStateFromCounts({ ahead, behind }) {
  if (ahead > 0 && behind > 0) return "diverged";
  if (behind > 0) return "remote_ahead";
  if (ahead > 0) return "local_ahead";
  return "current";
}

function remoteStatusFailure({ repo, checkedAt, code, error }) {
  return {
    ok: false,
    repo: repo.id,
    branch: repo.branch,
    checkedAt,
    code,
    state: "unavailable",
    error: String(error || "").trim(),
    ahead: 0,
    behind: 0,
    incomingFiles: [],
    incomingCount: 0,
  };
}

function remoteBranchIsMissing(error) {
  return /couldn't find remote ref|remote ref does not exist|unknown revision/i.test(
    [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n"),
  );
}

async function runRemoteStep(repo, step, gitRunner, args) {
  try {
    return await gitRunner(repo.root, args);
  } catch (error) {
    error.step = step;
    throw error;
  }
}

function remoteSyncTranslator({ locale, language } = {}) {
  return createTranslator(REMOTE_SYNC_MESSAGES, locale ?? language);
}
