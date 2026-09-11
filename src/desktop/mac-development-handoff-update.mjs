import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  BUILD_INFO_FILENAME,
  LEGACY_BUILD_INFO_FILENAMES,
} from "../build-info.mjs";
import {
  developmentHandoffReceiptForManifest,
  developmentHandoffReceiptMatchesBuild,
  normalizeDevelopmentHandoffReceipt,
  sameDevelopmentHandoffReceipt,
} from "./development-handoff.mjs";
import {
  prepareDesktopDevelopmentHandoffInstallation,
  restoreDesktopDevelopmentHandoffInstallation,
} from "./config.mjs";
import {
  OFFICIAL_MAC_BUNDLE_ID,
  OFFICIAL_MAC_EXECUTABLE_NAME,
  OFFICIAL_MAC_TEAM_IDENTIFIER,
  beginMacAppContentsReplacement,
  readMacAppBundleId,
  readMacAppExecutableName,
  readMacAppVersion,
  verifySignedMacApp,
  waitForMacAppProcessesExit,
} from "./mac-app-contents.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const READY_SCHEMA_VERSION = 1;
const READY_FILENAME = "ready.json";
const MAC_APP_NAMES = new Set(["OpenGlance.app", "Git Leaf.app"]);
const MAC_EXECUTABLE_NAMES = new Set([
  "OpenGlance",
  "Git Leaf",
  OFFICIAL_MAC_EXECUTABLE_NAME,
]);
const HELPER_READY_ARGUMENT = "--install-ready";
const HELPER_PID_ARGUMENT = "--wait-pid";
const activePreparations = new Map();

export function macDevelopmentHandoffCachePaths({
  userDataDir,
  handoff,
} = {}) {
  const receipt = requiredReceipt(handoff);
  const updateRoot = path.join(
    path.resolve(requiredPath(userDataDir, "userDataDir")),
    "updates",
    "development-handoff",
  );
  const versionRoot = path.join(updateRoot, receipt.buildId);
  return {
    updateRoot,
    versionRoot,
    archivePartialPath: path.join(versionRoot, "update.zip.partial"),
    archivePath: path.join(versionRoot, "update.zip"),
    extractRoot: path.join(versionRoot, "extracted"),
    readyFile: path.join(versionRoot, READY_FILENAME),
  };
}

export function macAppBundlePathFromExecutable(execPath = process.execPath) {
  const executable = path.resolve(requiredPath(execPath, "execPath"));
  if (
    !MAC_EXECUTABLE_NAMES.has(path.basename(executable))
    || path.basename(path.dirname(executable)) !== "MacOS"
    || path.basename(path.dirname(path.dirname(executable))) !== "Contents"
  ) {
    throw new Error(`OpenGlance is not running from a macOS App bundle: ${executable}`);
  }
  return path.dirname(path.dirname(path.dirname(executable)));
}

export async function extractMacDevelopmentHandoffArchive(
  archivePath,
  {
    dir,
    spawnProcess = spawn,
  } = {},
) {
  const archive = path.resolve(requiredPath(archivePath, "archivePath"));
  const destination = path.resolve(requiredPath(dir, "dir"));
  await new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const child = spawnProcess(
      "ditto",
      ["-x", "-k", archive, destination],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      if (stderr.length < 16_384) {
        stderr += String(chunk).slice(0, 16_384 - stderr.length);
      }
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, signal) => {
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(
        reject,
        new Error(
          `macOS development handoff extraction failed: ${
            signal ? `signal ${signal}` : `exit ${code}`
          }${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

export function prepareMacDevelopmentHandoffUpdate(options = {}) {
  const receipt = requiredReceipt(options.handoff);
  const targetAppPath = validatedExistingAppPath(
    options.targetAppPath,
    "installed",
  );
  const artifact = macDevelopmentHandoffArtifact(options.manifest);
  const paths = macDevelopmentHandoffCachePaths({
    userDataDir: options.userDataDir,
    handoff: receipt,
  });
  const identity = JSON.stringify({
    receipt,
    artifact,
    targetAppPath,
    launchArgs: Array.isArray(options.launchArgs)
      ? options.launchArgs.map((argument) => String(argument))
      : process.argv.slice(1),
  });
  const active = activePreparations.get(paths.updateRoot);
  if (active) {
    if (active.identity === identity) {
      return active.promise;
    }
    return active.promise
      .catch(() => {})
      .then(() => prepareMacDevelopmentHandoffUpdate(options));
  }

  let tracked;
  tracked = prepareMacDevelopmentHandoffUpdateOnce(options).finally(() => {
    if (activePreparations.get(paths.updateRoot)?.promise === tracked) {
      activePreparations.delete(paths.updateRoot);
    }
  });
  activePreparations.set(paths.updateRoot, { identity, promise: tracked });
  return tracked;
}

async function prepareMacDevelopmentHandoffUpdateOnce({
  manifest,
  handoff,
  userDataDir,
  targetAppPath,
  launchArgs = process.argv.slice(1),
  fetchFn = globalThis.fetch,
  extractArchive = extractMacDevelopmentHandoffArchive,
  inspectApp = inspectOfficialMacApp,
} = {}) {
  const receipt = requiredReceipt(handoff);
  if (!sameDevelopmentHandoffReceipt(
    receipt,
    developmentHandoffReceiptForManifest({ manifest }),
  )) {
    throw new Error("The macOS development handoff manifest identity changed.");
  }
  const target = validatedExistingAppPath(targetAppPath, "installed");
  const artifact = macDevelopmentHandoffArtifact(manifest);
  const paths = macDevelopmentHandoffCachePaths({ userDataDir, handoff: receipt });
  const cached = await readCachedPreparedUpdate({
    paths,
    receipt,
    targetAppPath: target,
    inspectApp,
  });
  if (cached) {
    return cached;
  }

  await removePreparedTree(paths.updateRoot);
  await mkdir(paths.versionRoot, { recursive: true, mode: 0o700 });
  try {
    const downloaded = await downloadArchive({
      url: artifact.url,
      destination: paths.archivePartialPath,
      fetchFn,
    });
    if (downloaded.sha256 !== artifact.sha256) {
      throw new Error("macOS development handoff SHA-256 verification failed.");
    }
    if (artifact.size > 0 && downloaded.size !== artifact.size) {
      throw new Error("macOS development handoff file size verification failed.");
    }
    await rename(paths.archivePartialPath, paths.archivePath);
    await mkdir(paths.extractRoot, { recursive: true, mode: 0o700 });
    await extractArchive(paths.archivePath, { dir: paths.extractRoot });
    const sourceAppPath = await findExtractedMacApp(paths.extractRoot);
    assertOfficialTargetIdentity({
      inspected: inspectApp(sourceAppPath),
      receipt,
    });
    const ready = normalizedReadyPayload({
      schemaVersion: READY_SCHEMA_VERSION,
      handoff: receipt,
      sourceAppPath,
      targetAppPath: target,
      userDataDir: path.resolve(userDataDir),
      launchArgs,
    }, { readyFile: paths.readyFile });
    await writeFile(
      paths.readyFile,
      `${JSON.stringify(ready, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    return preparedUpdate({ ready, readyFile: paths.readyFile });
  } catch (error) {
    try {
      await removePreparedTree(paths.versionRoot);
    } catch {
      // Keep the preparation failure as the actionable error. A later retry
      // removes this identity-bound cache before writing anything new.
    }
    throw error;
  }
}

export function launchMacDevelopmentHandoffUpdate({
  prepared,
  currentProcessId = process.pid,
  executable = process.execPath,
  helperPath = SCRIPT_PATH,
  spawnProcess = spawn,
  environment = process.env,
} = {}) {
  const readyFile = requiredPath(prepared?.readyFile, "prepared.readyFile");
  if (!Number.isInteger(currentProcessId) || currentProcessId <= 0) {
    throw new Error("Invalid macOS development handoff process.");
  }
  const child = spawnProcess(
    executable,
    [
      helperPath,
      HELPER_READY_ARGUMENT,
      readyFile,
      HELPER_PID_ARGUMENT,
      String(currentProcessId),
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...environment,
        ELECTRON_RUN_AS_NODE: "1",
      },
    },
  );
  child.unref?.();
  return {
    status: "launched",
    readyFile,
  };
}

export async function installPreparedMacDevelopmentHandoff({
  ready,
  waitForProcessId,
  waitForProcessExit = waitForMacProcessExit,
  waitForAppProcessesExit = waitForMacAppProcessesExit,
  prepareInstallation = prepareDesktopDevelopmentHandoffInstallation,
  restoreInstallation = restoreDesktopDevelopmentHandoffInstallation,
  beginContentsReplacement = beginMacAppContentsReplacement,
  launchApp = launchAndConfirmMacApp,
  cleanupPreparedUpdate = cleanupReadyUpdate,
  relaunchRestoredApp = async () => {},
  normalizeReady = normalizedReadyPayload,
} = {}) {
  const normalized = normalizeReady(ready);
  let preparation = null;
  let transaction = null;
  let installationCommitted = false;
  try {
    await waitForProcessExit(waitForProcessId);
    await waitForAppProcessesExit(normalized.targetAppPath, {
      excludedProcessIds: [process.pid],
    });
    preparation = await prepareInstallation({
      userDataDir: normalized.userDataDir,
      handoff: normalized.handoff,
    });
    if (preparation?.prepared !== true) {
      throw new Error("Development handoff installation was not prepared.");
    }
    transaction = beginContentsReplacement({
      sourceAppPath: normalized.sourceAppPath,
      targetAppPath: normalized.targetAppPath,
      expectedVersion: normalized.handoff.version,
    });
    await launchApp({
      appPath: normalized.targetAppPath,
      args: normalized.launchArgs,
    });
    transaction.commit();
    installationCommitted = true;
    try {
      await cleanupPreparedUpdate(normalized);
    } catch {
      // The signed target is already confirmed. Stale cache cleanup can wait.
    }
    return {
      status: "installed",
      version: normalized.handoff.version,
    };
  } catch (error) {
    if (installationCommitted) {
      throw error;
    }
    try {
      transaction?.rollback();
    } catch {
      // Preserve the original installation error.
    }
    if (preparation?.prepared === true) {
      try {
        await restoreInstallation({
          userDataDir: normalized.userDataDir,
          handoff: normalized.handoff,
          hadUsageAnalyticsSetting: preparation.hadUsageAnalyticsSetting,
          previousUsageAnalyticsEnabled:
            preparation.previousUsageAnalyticsEnabled,
        });
      } catch {
        // Preserve the original installation error.
      }
    }
    try {
      await relaunchRestoredApp({
        appPath: normalized.targetAppPath,
        args: normalized.launchArgs,
      });
    } catch {
      // Preserve the original installation error.
    }
    throw error;
  }
}

export async function waitForMacProcessExit(processId, {
  timeoutMs = 120_000,
  pollMs = 150,
  processExists = runningProcessExists,
  wait = delay,
  now = Date.now,
} = {}) {
  if (!Number.isInteger(processId) || processId <= 0 || processId === process.pid) {
    throw new Error("Invalid macOS development handoff process.");
  }
  const startedAt = now();
  while (processExists(processId)) {
    if (now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for the current OpenGlance process to exit.");
    }
    await wait(pollMs);
  }
}

export function inspectOfficialMacApp(appPath) {
  verifySignedMacApp(appPath);
  const appResourcesPath = path.join(appPath, "Contents", "Resources", "app.asar");
  const buildInfoPath = [BUILD_INFO_FILENAME, ...LEGACY_BUILD_INFO_FILENAMES]
    .map((filename) => path.join(appResourcesPath, filename))
    .find((candidate) => existsSync(candidate));
  if (!buildInfoPath) {
    throw new Error("The official OpenGlance App does not contain build identity metadata.");
  }
  return {
    bundleId: readMacAppBundleId(appPath),
    executableName: readMacAppExecutableName(appPath),
    teamIdentifier: OFFICIAL_MAC_TEAM_IDENTIFIER,
    version: readMacAppVersion(appPath),
    buildInfo: JSON.parse(readFileSync(buildInfoPath, "utf8")),
  };
}

async function readCachedPreparedUpdate({
  paths,
  receipt,
  targetAppPath,
  inspectApp,
}) {
  try {
    const ready = normalizedReadyPayload(
      JSON.parse(await readFile(paths.readyFile, "utf8")),
      { readyFile: paths.readyFile },
    );
    if (
      ready.targetAppPath !== targetAppPath
      || !sameDevelopmentHandoffReceipt(ready.handoff, receipt)
    ) {
      return null;
    }
    assertOfficialTargetIdentity({
      inspected: inspectApp(ready.sourceAppPath),
      receipt,
    });
    return preparedUpdate({ ready, readyFile: paths.readyFile });
  } catch {
    return null;
  }
}

function preparedUpdate({ ready, readyFile }) {
  return {
    version: ready.handoff.version,
    handoff: ready.handoff,
    readyFile,
  };
}

function normalizedReadyPayload(value, { readyFile = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid macOS development handoff ready payload.");
  }
  const handoff = requiredReceipt(value.handoff);
  const userDataDir = path.resolve(requiredPath(value.userDataDir, "userDataDir"));
  const paths = macDevelopmentHandoffCachePaths({ userDataDir, handoff });
  if (readyFile && path.resolve(readyFile) !== paths.readyFile) {
    throw new Error("Invalid macOS development handoff ready path.");
  }
  const sourceAppPath = validatedExistingAppPath(value.sourceAppPath, "source");
  const targetAppPath = validatedExistingAppPath(value.targetAppPath, "target");
  if (
    !MAC_APP_NAMES.has(path.basename(sourceAppPath))
    || path.dirname(sourceAppPath) !== paths.extractRoot
    || targetAppPath.startsWith(`${paths.updateRoot}${path.sep}`)
  ) {
    throw new Error("Invalid macOS development handoff App path.");
  }
  const launchArgs = Array.isArray(value.launchArgs)
    ? value.launchArgs.map((argument) => String(argument))
    : [];
  if (
    launchArgs.length > 64
    || launchArgs.some((argument) => argument.length > 4096)
  ) {
    throw new Error("Invalid macOS development handoff launch arguments.");
  }
  return {
    schemaVersion: READY_SCHEMA_VERSION,
    handoff,
    sourceAppPath,
    targetAppPath,
    userDataDir,
    launchArgs,
  };
}

function assertOfficialTargetIdentity({ inspected, receipt }) {
  if (
    inspected?.bundleId !== OFFICIAL_MAC_BUNDLE_ID
    || inspected?.executableName !== OFFICIAL_MAC_EXECUTABLE_NAME
    || inspected?.teamIdentifier !== OFFICIAL_MAC_TEAM_IDENTIFIER
    || inspected?.version !== receipt.version
    || inspected?.buildInfo?.dev === true
    || inspected?.buildInfo?.usageAnalyticsDefault !== true
    || !developmentHandoffReceiptMatchesBuild({
      receipt,
      buildInfo: inspected?.buildInfo,
      platformKey: receipt.platform,
    })
  ) {
    throw new Error("The signed internal App does not match the handoff target identity.");
  }
}

function macDevelopmentHandoffArtifact(manifest) {
  const file = manifest?.files?.zip;
  const url = String(file?.url || "").trim();
  const sha256 = String(file?.sha256 || "").trim().toLowerCase();
  const size = Number(file?.size || 0);
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  if (
    !parsedUrl
    || !["https:", "http:"].includes(parsedUrl.protocol)
    || !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isSafeInteger(size)
    || size <= 0
  ) {
    throw new Error("The internal manifest is missing a valid macOS ZIP artifact.");
  }
  return { url, sha256, size };
}

async function downloadArchive({ url, destination, fetchFn }) {
  const response = await fetchFn(url);
  if (!response?.ok) {
    throw new Error(
      `macOS development handoff download failed: HTTP ${response?.status ?? "unknown"}`,
    );
  }
  if (!response.body) {
    throw new Error("macOS development handoff download returned an empty response.");
  }
  const hash = createHash("sha256");
  let size = 0;
  const digest = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  const readable = typeof response.body.getReader === "function"
    ? Readable.fromWeb(response.body)
    : response.body;
  await pipeline(readable, digest, createWriteStream(destination, { mode: 0o600 }));
  return {
    sha256: hash.digest("hex"),
    size,
  };
}

async function findExtractedMacApp(extractRoot) {
  const entries = await readdir(extractRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(extractRoot, entry.name));
  if (
    candidates.length !== 1
    || !MAC_APP_NAMES.has(path.basename(candidates[0]))
  ) {
    throw new Error("The internal archive does not contain one complete macOS App.");
  }
  return validatedExistingAppPath(candidates[0], "extracted");
}

async function cleanupReadyUpdate(ready) {
  const paths = macDevelopmentHandoffCachePaths({
    userDataDir: ready.userDataDir,
    handoff: ready.handoff,
  });
  await removePreparedTree(paths.versionRoot);
}

async function removePreparedTree(targetPath) {
  const target = validatedPreparedTreePath(targetPath);
  await new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const child = spawn(
      "/bin/rm",
      ["-rf", target],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      if (stderr.length < 16_384) {
        stderr += String(chunk).slice(0, 16_384 - stderr.length);
      }
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, signal) => {
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(
        reject,
        new Error(
          `macOS development handoff cache cleanup failed: ${
            signal ? `signal ${signal}` : `exit ${code}`
          }${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

function validatedPreparedTreePath(value) {
  const target = path.resolve(requiredPath(value, "preparedTreePath"));
  const segments = target.split(path.sep);
  const markerIndex = segments.lastIndexOf("development-handoff");
  const isCacheRoot = markerIndex === segments.length - 1;
  const isBuildRoot = (
    markerIndex === segments.length - 2
    && /^[0-9A-Za-z._-]{1,256}$/.test(segments.at(-1) || "")
  );
  if (
    markerIndex < 2
    || segments[markerIndex - 1] !== "updates"
    || (!isCacheRoot && !isBuildRoot)
  ) {
    throw new Error(`Refusing to remove an unexpected update path: ${target}`);
  }
  return target;
}

export async function launchAndConfirmMacApp({
  appPath,
  args = [],
  spawnProcess = spawn,
  environment = process.env,
  confirmationDelayMs = 2_000,
  wait = delay,
} = {}) {
  const executableName = readMacAppExecutableName(appPath);
  if (!MAC_EXECUTABLE_NAMES.has(executableName)) {
    throw new Error("The macOS App has an unsupported executable identity.");
  }
  const executable = path.join(
    appPath,
    "Contents",
    "MacOS",
    executableName,
  );
  const childEnvironment = { ...environment };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const child = spawnProcess(executable, args, {
    detached: true,
    stdio: "ignore",
    env: childEnvironment,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await wait(confirmationDelayMs);
  if (child.exitCode != null || child.signalCode != null) {
    throw new Error("The OpenGlance App exited before startup confirmation.");
  }
  child.unref?.();
  return true;
}

function runningProcessExists(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function validatedExistingAppPath(value, label) {
  const appPath = path.resolve(requiredPath(value, `${label}AppPath`));
  if (
    path.extname(appPath) !== ".app"
    || !existsSync(appPath)
    || lstatSync(appPath).isSymbolicLink()
    || !lstatSync(appPath).isDirectory()
  ) {
    throw new Error(`Expected a non-symlink ${label} App directory: ${appPath}`);
  }
  return appPath;
}

function requiredReceipt(value) {
  const receipt = normalizeDevelopmentHandoffReceipt(value);
  if (!receipt) {
    throw new Error("Invalid macOS development handoff receipt.");
  }
  return receipt;
}

function requiredPath(value, label) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    throw new Error(`${label} is required.`);
  }
  return result;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? String(args[index + 1] || "").trim() : "";
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function positiveProcessId(value) {
  const processId = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error("Invalid macOS development handoff process.");
  }
  return processId;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runHelper(args) {
  const readyFile = optionValue(args, HELPER_READY_ARGUMENT);
  const waitForProcessId = positiveProcessId(
    optionValue(args, HELPER_PID_ARGUMENT),
  );
  const ready = normalizedReadyPayload(
    JSON.parse(await readFile(readyFile, "utf8")),
    { readyFile },
  );
  await installPreparedMacDevelopmentHandoff({
    ready,
    waitForProcessId,
    relaunchRestoredApp: launchAndConfirmMacApp,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  runHelper(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
