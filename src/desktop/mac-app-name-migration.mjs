import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync, mkdirSync, renameSync, rmdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_INFO } from "../build-info.mjs";
import {
  macAppBundlePathFromExecutable,
  launchAndConfirmMacApp,
  waitForMacProcessExit,
} from "./mac-development-handoff-update.mjs";
import { readMacAppBundleId, readMacAppExecutableName, runningMacAppProcessIds } from "./mac-app-contents.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const SKIP_MAC_APP_NAME_MIGRATION = "--openglance-skip-app-name-migration";

function statIfPresent(file) {
  try { return lstatSync(file); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function sameDirectory(file, identity) {
  const stat = statIfPresent(file);
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink()
    && stat.dev === identity.dev && stat.ino === identity.ino);
}

export function macAppNameMigrationPlan({
  platform = process.platform,
  isPackaged = true,
  executable = process.execPath,
  buildInfo = BUILD_INFO,
  args = process.argv.slice(1),
  readBundleId = readMacAppBundleId,
  readExecutableName = readMacAppExecutableName,
  checkAccess = accessSync,
  parentProcessId = process.ppid,
  findAppProcesses = runningMacAppProcessIds,
} = {}) {
  if (platform !== "darwin" || !isPackaged || args.includes(SKIP_MAC_APP_NAME_MIGRATION)) return null;
  const source = macAppBundlePathFromExecutable(executable);
  if (!source || path.basename(source) !== "Git Leaf.app") return null;
  const identity = statIfPresent(source);
  if (!identity?.isDirectory() || identity.isSymbolicLink()) return null;
  const target = path.join(path.dirname(source), "OpenGlance.app");
  // Includes dangling symlinks and empty folders. Never replace another installation.
  if (statIfPresent(target)) return null;
  const expectedBundleId = buildInfo.distribution === "official"
    ? (buildInfo.releaseTrack === "internal" ? "com.mangofuture.gitleaf" : "com.mangofuture.openglance")
    : "org.openglance.community";
  if (readBundleId(source) !== expectedBundleId || readExecutableName(source) !== path.basename(executable)) return null;
  // Older development-handoff helpers confirm startup by watching their direct child.
  // Do not exit that child underneath its install transaction; a later normal launch
  // can migrate the name after that helper has committed the new signed Contents.
  if (parentProcessId > 0 && findAppProcesses(source).includes(parentProcessId)) return null;
  try { checkAccess(path.dirname(source), constants.W_OK); } catch { return null; }
  return { source, target, dev: identity.dev, ino: identity.ino };
}

// Reserve the destination exclusively, then replace only that empty reservation. Node's
// rename alone would silently replace an existing empty directory or follow a collision.
function moveAppWithoutOverwrite(source, target, identity) {
  if (!sameDirectory(source, identity)) throw new Error("The App changed before its name migration.");
  mkdirSync(target, { mode: 0o700 });
  const reservation = lstatSync(target);
  try {
    renameSync(source, target);
  } finally {
    if (sameDirectory(target, reservation)) rmdirSync(target);
  }
}

export async function completeMacAppNameMigration({
  plan,
  launchArgs = [],
  waitForExit = async () => {},
  launchApp = launchAndConfirmMacApp,
  moveApp = moveAppWithoutOverwrite,
} = {}) {
  await waitForExit();
  let moved = false;
  try {
    moveApp(plan.source, plan.target, plan);
    moved = true;
    await launchApp({ appPath: plan.target, args: launchArgs });
    return { status: "migrated", appPath: plan.target };
  } catch (error) {
    if (moved) {
      // Restore only this same App. An intervening installation must never be overwritten.
      moveApp(plan.target, plan.source, plan);
    }
    if (!sameDirectory(plan.source, plan)) throw error;
    await launchApp({
      appPath: plan.source,
      args: [...launchArgs, SKIP_MAC_APP_NAME_MIGRATION],
    });
    return { status: "deferred", appPath: plan.source, reason: error.message };
  }
}

export async function startMacAppNameMigration({
  app,
  buildInfo = BUILD_INFO,
  launchArgs = () => process.argv.slice(1),
  spawnProcess = spawn,
  planMigration = macAppNameMigrationPlan,
  timeoutMs = 10000,
  logger = console,
} = {}) {
  try {
    const plan = planMigration({ isPackaged: app.isPackaged, buildInfo });
    if (!plan) return false;
    // Load the entire helper while the old bundle still exists. The handshake prevents
    // quitting a usable App when Electron's Node mode or the helper failed to start.
    const child = spawnProcess(process.execPath, [SCRIPT_PATH, String(process.pid)], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error("App name migration helper did not start.")), timeoutMs);
      function fail(error) { clearTimeout(timer); child.kill(); reject(error); }
      child.once("error", fail);
      child.once("exit", () => fail(new Error("App name migration helper exited before readiness.")));
      child.once("message", message => {
        if (message?.status !== "ready" || message?.ino !== plan.ino || message?.dev !== plan.dev) {
          fail(new Error("App name migration helper identity mismatch."));
          return;
        }
        try {
          child.send({ launchArgs: launchArgs() }, error => {
            if (error) { fail(error); return; }
            clearTimeout(timer);
            child.removeAllListeners("exit");
            child.disconnect();
            child.unref();
            resolve();
          });
        } catch (error) { fail(error); }
      });
    });
    return true;
  } catch (error) {
    logger.warn("OpenGlance App name migration deferred:", error.message);
    return false;
  }
}

async function runHelper() {
  const parentPid = Number(process.argv[2]);
  if (!process.send || !Number.isInteger(parentPid) || parentPid !== process.ppid) {
    throw new Error("App name migration requires its launching App.");
  }
  const plan = macAppNameMigrationPlan({ args: [], parentProcessId: 0 });
  if (!plan) throw new Error("App name migration is no longer available.");
  const request = await new Promise((resolve, reject) => {
    process.once("message", resolve);
    process.once("disconnect", () => reject(new Error("Launching App disconnected before migration.")));
    process.send({ status: "ready", ino: plan.ino, dev: plan.dev });
  });
  if (!Array.isArray(request.launchArgs) || request.launchArgs.some(arg => typeof arg !== "string")) {
    throw new Error("Invalid App launch arguments.");
  }
  await completeMacAppNameMigration({
    plan,
    launchArgs: request.launchArgs,
    waitForExit: () => waitForMacProcessExit(parentPid),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  runHelper().catch(error => { console.error(error); process.exitCode = 1; });
}
