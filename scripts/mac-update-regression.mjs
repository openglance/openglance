#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { compareAppVersions } from "../src/desktop/app-updates.mjs";
import {
  OFFICIAL_INTERNAL_MAC_BUNDLE_ID,
  OFFICIAL_PUBLIC_MAC_BUNDLE_ID,
} from "../src/desktop/mac-app-contents.mjs";
import {
  prepareMacUpdateAppPath,
  OFFICIAL_INTERNAL_MAC_SHIPIT_JOB_LABEL,
  OFFICIAL_PUBLIC_MAC_SHIPIT_JOB_LABEL,
} from "../src/desktop/mac-update-cache.mjs";
import {
  DEVELOPMENT_USER_DATA_ARG,
  LEGACY_DEVELOPMENT_USER_DATA_ARG,
} from "../src/desktop/user-data.mjs";
import { replaceMacAppContents } from "./mac-update-bridge.mjs";
import { developmentProfileFingerprint } from "./release-mac.mjs";
import { verifySquirrelMacPolicy } from "./squirrel-mac-policy.mjs";
export {
  validateMacUpdateRegressionEvidence,
} from "./mac-update-regression-evidence.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
export const MAC_UPDATE_REGRESSION_ARTIFACT_PREFIX =
  "openglance-macos-update-regression-";
export const SHIPIT_JOB_LABEL = OFFICIAL_INTERNAL_MAC_SHIPIT_JOB_LABEL;
export const PUBLIC_SHIPIT_JOB_LABEL = OFFICIAL_PUBLIC_MAC_SHIPIT_JOB_LABEL;
const OFFICIAL_SHIPIT_JOB_LABELS = [SHIPIT_JOB_LABEL, PUBLIC_SHIPIT_JOB_LABEL];
export const SQUIRREL_DIRECT_CONTENTS_WRITE_KEY =
  "SquirrelMacEnableDirectContentsWrite";
const PLATFORM_KEY = "darwin-universal";
const DEFAULT_BASE_URL = "https://updates.mangofuture.com/git-leaf";
const FIRST_NONPRIVILEGED_ONLY_VERSION = "1.12.3";
const LEGACY_INTERNAL_STABLE_BRIDGE_VERSION = "1.11.3";
const MAX_HTTP_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export function updateRegressionChannels(track) {
  if (track === "public") {
    return { stable: "stable", candidate: "candidate" };
  }
  if (track === "internal") {
    return { stable: "internal-stable", candidate: "internal-candidate" };
  }
  throw new Error(`Unsupported release track: ${track || "missing"}`);
}

export function assertSafeMacUpdateRegressionHost({
  platform = process.platform,
  productionAppRunning,
  userShipItJobExists,
  systemShipItJobExists,
} = {}) {
  if (platform !== "darwin") {
    throw new Error("The macOS update regression harness requires macOS");
  }
  const conflicts = [
    [productionAppRunning, "an installed OpenGlance or Git Leaf App is running"],
    [userShipItJobExists, "the per-user ShipIt launchd job exists"],
    [systemShipItJobExists, "the system ShipIt launchd job exists"],
  ].filter(([present]) => present).map(([, message]) => message);
  if (conflicts.length > 0) {
    throw new Error(
      [
        "Refusing to start the macOS update regression with conflicting local state.",
        ...conflicts.map((conflict) => `- ${conflict}`),
        "Quit the installed App and resolve the ShipIt conflict before retrying.",
      ].join("\n"),
    );
  }
}

export function validateUpdateRegressionManifest(manifest, {
  channel,
  track,
  expectedVersion,
  expectedCommit,
  allowLegacyPublicStableBridge = false,
} = {}) {
  const matchesRequestedIdentity = manifest?.releaseTrack === track
    && manifest?.channel === channel;
  const matchesLegacyPublicStableBridge = allowLegacyPublicStableBridge
    && track === "public"
    && channel === "stable"
    && manifest?.releaseTrack === "internal"
    && manifest?.channel === "stable"
    && manifest?.version === LEGACY_INTERNAL_STABLE_BRIDGE_VERSION;
  if (
    !manifest
    || (!matchesRequestedIdentity && !matchesLegacyPublicStableBridge)
    || manifest.platform !== PLATFORM_KEY
  ) {
    throw new Error(
      `Update manifest identity does not match ${track}/${channel}/${PLATFORM_KEY}`,
    );
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `Candidate manifest version ${manifest.version || "missing"} does not match ${expectedVersion}`,
    );
  }
  if (
    expectedCommit
    && !String(expectedCommit).startsWith(String(manifest.commit || "missing"))
  ) {
    throw new Error(
      `Candidate manifest commit ${manifest.commit || "missing"} does not match ${expectedCommit}`,
    );
  }
  const zip = manifest.files?.zip;
  if (
    !zip?.name
    || !/^https?:\/\//.test(String(zip.url || ""))
    || !/^[a-f0-9]{64}$/.test(String(zip.sha256 || ""))
    || !Number.isSafeInteger(zip.size)
    || zip.size <= 0
  ) {
    throw new Error("Update manifest is missing a complete macOS ZIP contract");
  }
  return manifest;
}

export function launchctlJobExists({
  domain,
  label = SHIPIT_JOB_LABEL,
  uid = typeof process.getuid === "function" ? process.getuid() : 0,
} = {}) {
  const target = domain === "system"
    ? `system/${label}`
    : `gui/${uid}/${label}`;
  return spawnSync("launchctl", ["print", target], {
    encoding: "utf8",
  }).status === 0;
}

export function launchctlJobDetails({
  domain,
  label = SHIPIT_JOB_LABEL,
  uid = typeof process.getuid === "function" ? process.getuid() : 0,
} = {}) {
  const target = domain === "system"
    ? `system/${label}`
    : `gui/${uid}/${label}`;
  const result = spawnSync("launchctl", ["print", target], {
    encoding: "utf8",
  });
  return {
    exists: result.status === 0,
    target,
    output: String(result.stdout || ""),
    error: String(result.stderr || ""),
  };
}

function launchctlTopLevelValue(output, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(output || "")
    .match(new RegExp(`^\\t${escapedKey} = (.+)$`, "m"))?.[1]
    ?.trim() || "";
}

function shipItProgramBelongsToApp(program, appPath) {
  const relative = path.relative(path.resolve(appPath), path.resolve(program));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return /^Contents\/Frameworks\/Squirrel\.framework\/(?:Versions\/(?:A|Current)\/)?Resources\/ShipIt$/
    .test(relative.split(path.sep).join("/"));
}

function localFilePathFromUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "file:") return "";
    return fileURLToPath(parsed);
  } catch {
    return "";
  }
}

export function isCompletedDormantShipItJob({
  details,
  homeDir = homedir(),
  label = SHIPIT_JOB_LABEL,
  productionAppPaths = hostPaths({ homeDir }).productionAppPaths,
  exists = existsSync,
  lstat = lstatSync,
  readFile = readFileSync,
} = {}) {
  if (!details?.exists) return false;
  const output = String(details.output || "");
  if (
    launchctlTopLevelValue(output, "active count") !== "0"
    || launchctlTopLevelValue(output, "state") !== "not running"
    || launchctlTopLevelValue(output, "job state") !== "exited"
    || launchctlTopLevelValue(output, "last exit code") !== "0"
  ) {
    return false;
  }
  const runs = Number(launchctlTopLevelValue(output, "runs"));
  if (!Number.isSafeInteger(runs) || runs < 1) return false;

  const program = launchctlTopLevelValue(output, "program");
  if (!productionAppPaths.some(
    (appPath) => shipItProgramBelongsToApp(program, appPath),
  )) {
    return false;
  }

  const updateRoot = path.join(homeDir, "Library", "Caches", label);
  const stateFile = path.join(updateRoot, "ShipItState.plist");
  if (!output.split("\n").some((line) => line.trim() === stateFile)) {
    return false;
  }
  try {
    const stateStat = lstat(stateFile);
    if (!stateStat.isFile() || stateStat.isSymbolicLink()) return false;
  } catch {
    return false;
  }

  let request;
  try {
    request = JSON.parse(readFile(stateFile, "utf8"));
  } catch {
    return false;
  }
  const targetAppPath = localFilePathFromUrl(request?.targetBundleURL);
  if (!productionAppPaths.some(
    (appPath) => path.resolve(appPath) === path.resolve(targetAppPath || ""),
  )) {
    return false;
  }
  const stagedAppPath = localFilePathFromUrl(request?.updateBundleURL);
  const stagedDirectory = path.dirname(stagedAppPath || "");
  if (
    path.extname(stagedAppPath).toLowerCase() !== ".app"
    || path.dirname(stagedDirectory) !== path.resolve(updateRoot)
    || !path.basename(stagedDirectory).startsWith("update.")
    || exists(stagedDirectory)
  ) {
    return false;
  }
  return true;
}

export function isUnchangedPreexistingShipItJob({
  currentJob,
  preexistingJob,
} = {}) {
  return Boolean(
    currentJob?.exists
    && preexistingJob?.output
    && currentJob.output === preexistingJob.output,
  );
}

function hostPaths({ homeDir = homedir() } = {}) {
  return {
    productionAppPaths: [
      "/Applications/OpenGlance.app",
      "/Applications/Git Leaf.app",
    ],
    productionProfilePath: path.join(
      homeDir,
      "Library",
      "Application Support",
      "git-leaf",
    ),
    realShipItCacheRoot: path.join(homeDir, "Library", "Caches"),
  };
}

export function assertCurrentHostSafe({
  allowedDormantUserShipItLabels = [],
} = {}) {
  const homeDir = homedir();
  const paths = hostPaths({ homeDir });
  const processes = spawnSync("ps", ["-axo", "command="], {
    encoding: "utf8",
  });
  const productionExecutables = paths.productionAppPaths.flatMap((appPath) => [
    path.join(appPath, "Contents", "MacOS", "OpenGlance"),
    path.join(appPath, "Contents", "MacOS", "Git Leaf"),
  ]);
  const allowedDormantLabels = new Set(allowedDormantUserShipItLabels);
  const preexistingDormantUserShipItJobs = [];
  const userShipItJobExists = OFFICIAL_SHIPIT_JOB_LABELS.some((label) => {
    const details = launchctlJobDetails({ domain: "user", label });
    if (!details.exists) return false;
    if (
      allowedDormantLabels.has(label)
      && isCompletedDormantShipItJob({
        details,
        homeDir,
        label,
        productionAppPaths: paths.productionAppPaths,
      })
    ) {
      preexistingDormantUserShipItJobs.push({ label, output: details.output });
      return false;
    }
    return true;
  });
  assertSafeMacUpdateRegressionHost({
    productionAppRunning: String(processes.stdout || "")
      .split("\n")
      .some((command) => productionExecutables.some(
        (executable) => command.trim().startsWith(executable),
      )),
    userShipItJobExists,
    systemShipItJobExists: OFFICIAL_SHIPIT_JOB_LABELS.some((label) => (
      launchctlJobExists({ domain: "system", label })
    )),
  });
  return {
    ...paths,
    productionFingerprint: developmentProfileFingerprint({
      productionUserDataDir: paths.productionProfilePath,
    }),
    realShipItFingerprint: developmentProfileFingerprint({
      productionUserDataDir: paths.realShipItCacheRoot,
      entries: OFFICIAL_SHIPIT_JOB_LABELS,
    }),
    preexistingDormantUserShipItJobs,
  };
}

function openHttpResponse(url, { redirectsRemaining = MAX_HTTP_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(new Error(`Could not download ${url}: ${error.message}`, {
        cause: error,
      }));
      return;
    }

    const get = parsedUrl.protocol === "https:"
      ? httpsGet
      : parsedUrl.protocol === "http:"
        ? httpGet
        : null;
    if (!get) {
      reject(new Error(
        `Could not download ${url}: unsupported protocol ${parsedUrl.protocol}`,
      ));
      return;
    }

    const request = get(parsedUrl, {
      headers: {
        "accept-encoding": "identity",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": "Git-Leaf-Release-Update-Regression/1",
      },
    }, (response) => {
      const status = response.statusCode || 0;
      if (
        [301, 302, 303, 307, 308].includes(status)
        && response.headers.location
      ) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error(
            `Could not download ${url}: too many HTTP redirects`,
          ));
          return;
        }
        let redirectedUrl;
        try {
          redirectedUrl = new URL(response.headers.location, parsedUrl);
        } catch (error) {
          reject(new Error(
            `Could not download ${url}: invalid redirect URL`,
            { cause: error },
          ));
          return;
        }
        if (
          parsedUrl.protocol === "https:"
          && redirectedUrl.protocol !== "https:"
        ) {
          reject(new Error(
            `Could not download ${url}: refused an insecure redirect`,
          ));
          return;
        }
        openHttpResponse(redirectedUrl.href, {
          redirectsRemaining: redirectsRemaining - 1,
        }).then(resolve, reject);
        return;
      }
      resolve({ response, status });
    });
    request.once("error", (error) => {
      reject(new Error(`Could not download ${url}: ${error.message}`, {
        cause: error,
      }));
    });
  });
}

async function fetchJson(url) {
  const { response, status } = await openHttpResponse(url);
  if (status < 200 || status >= 300) {
    response.resume();
    throw new Error(`Could not download ${url}: HTTP ${status}`);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > MAX_MANIFEST_BYTES) {
      response.destroy();
      throw new Error(
        `Could not download ${url}: manifest exceeds ${MAX_MANIFEST_BYTES} bytes`,
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${url}: ${error.message}`, {
      cause: error,
    });
  }
}

export async function downloadUpdateRegressionArtifact(
  artifact,
  destinationPath,
) {
  const { response, status } = await openHttpResponse(artifact.url);
  if (status < 200 || status >= 300) {
    response.resume();
    throw new Error(
      `Could not download ${artifact.url}: HTTP ${status}`,
    );
  }
  try {
    await pipeline(
      response,
      createWriteStream(destinationPath, { flags: "wx" }),
    );
  } catch (error) {
    throw new Error(
      `Could not download ${artifact.url}: ${error.message}`,
      { cause: error },
    );
  }
  const actual = await fileContract(destinationPath);
  if (
    actual.sha256 !== artifact.sha256
    || actual.size !== artifact.size
  ) {
    throw new Error(
      `Downloaded ${artifact.name} does not match its manifest SHA-256 and size`,
    );
  }
  return actual;
}

export async function fileContract(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return {
    sha256: hash.digest("hex"),
    size: statSync(filePath).size,
  };
}

export function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim()
      || result.stdout?.trim()
      || `Command failed: ${command} ${args.join(" ")}`,
    );
  }
  return result.stdout.trim();
}

export function readAppVersion(appPath) {
  return runChecked(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print:CFBundleShortVersionString", path.join(appPath, "Contents", "Info.plist")],
  );
}

export function readMacAppIdentity(appPath) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  return {
    bundleName: path.basename(appPath),
    bundleIdentifier: runChecked(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print:CFBundleIdentifier", plistPath],
    ),
    productName: runChecked(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print:CFBundleDisplayName", plistPath],
    ),
    executable: runChecked(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print:CFBundleExecutable", plistPath],
    ),
  };
}

export function macAppExecutablePath(appPath) {
  return path.join(
    appPath,
    "Contents",
    "MacOS",
    readMacAppIdentity(appPath).executable,
  );
}

export function extractSingleApp(zipPath, destinationDir) {
  mkdirSync(destinationDir, { recursive: true });
  runChecked("ditto", ["-x", "-k", zipPath, destinationDir]);
  const apps = readdirSync(destinationDir)
    .filter((name) => name.endsWith(".app"))
    .map((name) => path.join(destinationDir, name));
  if (apps.length !== 1 || lstatSync(apps[0]).isSymbolicLink()) {
    throw new Error("ZIP must contain exactly one non-symlink App bundle");
  }
  const probePath = path.join(apps[0], ".git-leaf-update-write-probe");
  writeFileSync(probePath, "write probe\n", { flag: "wx" });
  rmSync(probePath);
  return apps[0];
}

export function prepareInstalledBaselineAppPath(appPath, {
  track,
  renamePath = renameSync,
} = {}) {
  const source = path.resolve(appPath);
  if (track !== "internal" || path.basename(source) === "Git Leaf.app") {
    return source;
  }
  const target = path.join(path.dirname(source), "Git Leaf.app");
  renamePath(source, target);
  return target;
}

export function verifyAppSignature(appPath) {
  runChecked("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
}

function renameMigrationDesktopConfig({ repoRoot, targetVersion }) {
  return {
    renameMigrationSentinel: "git-leaf-1.x-to-openglance-3.x",
    repoRoot,
    openRepoRoots: [repoRoot],
    usageAnalyticsEnabled: false,
    preferences: {
      language: "zh-CN",
      colorMode: "dark",
      documentFont: "reading-serif",
      documentFontSize: 18,
      fileTreeMode: "all",
      showDocumentTitles: false,
      mode: "live",
      sidebarCollapsed: true,
      sourcePreviewRatio: 61,
      workbenchSessions: {
        openglance: {
          tabs: [{ path: "README.md" }],
          activeTabPath: "README.md",
        },
      },
      updateRequestedVersion: targetVersion,
    },
  };
}

function writeDesktopConfig(userDataDir, { repoRoot, targetVersion }) {
  mkdirSync(userDataDir, { recursive: true });
  const config = renameMigrationDesktopConfig({ repoRoot, targetVersion });
  writeFileSync(
    path.join(userDataDir, "desktop-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { flag: "wx" },
  );
  return config;
}

export function assertRenameMigrationUserState(actual, expected) {
  const stablePreferenceKeys = [
    "language",
    "colorMode",
    "documentFont",
    "documentFontSize",
    "fileTreeMode",
    "showDocumentTitles",
    "mode",
    "sidebarCollapsed",
    "sourcePreviewRatio",
  ];
  const expectedWorkbenchSessions = expected?.preferences?.workbenchSessions ?? {};
  const actualWorkbenchSessions = actual?.preferences?.workbenchSessions ?? {};
  const mismatches = [];
  for (const key of [
    "renameMigrationSentinel",
    "repoRoot",
    "usageAnalyticsEnabled",
  ]) {
    if (JSON.stringify(actual?.[key]) !== JSON.stringify(expected[key])) {
      mismatches.push(key);
    }
  }
  const expectedOpenRepoRoots = expected?.openRepoRoots ?? [];
  const actualOpenRepoRoots = actual?.openRepoRoots;
  let expectedOpenRepoRootIndex = 0;
  if (Array.isArray(actualOpenRepoRoots)) {
    for (const repoRoot of actualOpenRepoRoots) {
      if (repoRoot === expectedOpenRepoRoots[expectedOpenRepoRootIndex]) {
        expectedOpenRepoRootIndex += 1;
      }
    }
  }
  if (
    !Array.isArray(expectedOpenRepoRoots)
    || !Array.isArray(actualOpenRepoRoots)
    || expectedOpenRepoRootIndex !== expectedOpenRepoRoots.length
  ) {
    mismatches.push("openRepoRoots");
  }
  for (const key of stablePreferenceKeys) {
    if (
      JSON.stringify(actual?.preferences?.[key])
      !== JSON.stringify(expected.preferences[key])
    ) {
      mismatches.push(`preferences.${key}`);
    }
  }
  for (const [worktreeId, session] of Object.entries(expectedWorkbenchSessions)) {
    if (JSON.stringify(actualWorkbenchSessions[worktreeId]) !== JSON.stringify(session)) {
      mismatches.push(`preferences.workbenchSessions.${worktreeId}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      "OpenGlance did not preserve the Git Leaf repository list, workspace session, and preferences"
      + `: ${mismatches.join(", ")}`,
    );
  }
  return true;
}

export function startUpdateServer({ serverRoot, telemetryRoot, logPath }) {
  const child = spawn(
    "python3",
    [
      "-u",
      path.join(REPO_ROOT, "scripts", "openglance-update-server.py"),
      "--root",
      serverRoot,
      "--telemetry-root",
      telemetryRoot,
      "--bind",
      "127.0.0.1",
      "--port",
      "0",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.on("data", (chunk) => appendFileSync(logPath, chunk));
  child.stdout.on("data", (chunk) => appendFileSync(logPath, chunk));

  return new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for the local update server"));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      buffered += chunk.toString();
      const match = buffered.match(/(?:^|\n)PORT=(\d+)(?:\n|$)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve({ child, port: Number(match[1]) });
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local update server exited before startup (${code})`));
    });
  });
}

export function rewriteCandidateForLocalStable({
  manifest,
  channel,
  serverRoot,
  port,
  candidateZipPath,
}) {
  const updateDir = path.join(
    serverRoot,
    "git-leaf",
    channel,
    PLATFORM_KEY,
  );
  mkdirSync(updateDir, { recursive: true });
  const zip = manifest.files.zip;
  cpSync(candidateZipPath, path.join(updateDir, zip.name), {
    errorOnExist: true,
    force: false,
  });
  const zipUrl = `http://127.0.0.1:${port}/git-leaf/${channel}/${PLATFORM_KEY}/${encodeURIComponent(zip.name)}`;
  const localManifest = {
    ...manifest,
    channel,
    files: {
      ...manifest.files,
      zip: { ...zip, url: zipUrl },
    },
    autoUpdater: {
      ...manifest.autoUpdater,
      url: zipUrl,
    },
  };
  writeFileSync(
    path.join(updateDir, "latest.json"),
    `${JSON.stringify(localManifest, null, 2)}\n`,
    { flag: "wx" },
  );
}

function writeIsolatedSquirrelDefault(env, bundleIdentifier) {
  runChecked(
    "defaults",
    ["write", bundleIdentifier, SQUIRREL_DIRECT_CONTENTS_WRITE_KEY, "-bool", "true"],
    { env },
  );
  const stored = runChecked(
    "defaults",
    ["read", bundleIdentifier, SQUIRREL_DIRECT_CONTENTS_WRITE_KEY],
    { env },
  );
  if (stored !== "1") {
    throw new Error(`Could not store ${SQUIRREL_DIRECT_CONTENTS_WRITE_KEY}`);
  }
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitFor(check, {
  timeoutMs,
  label,
  intervalMs = 500,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

export function updateRegressionInstallExpression({ activate = true } = {}) {
  return `(() => {
    const action = document.querySelector("#desktop-update-action");
    if (!action) {
      return { clicked: false, reason: "missing" };
    }
    if (action.hidden || action.disabled) {
      return {
        clicked: false,
        reason: action.hidden ? "hidden" : "disabled",
        label: action.textContent || "",
      };
    }
    if (${activate ? "true" : "false"}) {
      action.click();
    }
    return {
      clicked: ${activate ? "true" : "false"},
      reason: ${activate ? '"action-clicked"' : '"action-ready"'},
      label: action.textContent || "",
    };
  })()`;
}

export async function evaluateInRenderer({ userDataDir, expression }) {
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const port = Number(readFileSync(portFile, "utf8").split(/\r?\n/, 1)[0]);
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const target = targets.find((candidate) => (
    candidate.type === "page" && candidate.webSocketDebuggerUrl
  ));
  if (!target) {
    throw new Error("No renderer target is available through the isolated DevTools port");
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out evaluating the update action"));
    }, 5_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error("The renderer rejected the update action"));
      } else {
        resolve(message.result?.result?.value);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not connect to the isolated renderer"));
    });
  });
}

export function assertTemporaryProcessIsolation({
  commandOutput,
  temporaryRoot,
  protectedProfilePath,
} = {}) {
  const temporary = requiredRegressionPath(temporaryRoot, "temporaryRoot");
  const protectedProfile = requiredRegressionPath(
    protectedProfilePath,
    "protectedProfilePath",
  );
  const relevant = String(commandOutput || "")
    .split("\n")
    .map((command) => command.trim())
    .filter((command) => command.includes(temporary));
  if (relevant.some((command) => command.includes(protectedProfile))) {
    throw new Error(
      "An isolated macOS update process attempted to use the real OpenGlance Profile",
    );
  }
  return relevant;
}

export function assertIsolatedShipItRequest({ stateFile, temporaryRoot } = {}) {
  const statePath = requiredRegressionPath(stateFile, "stateFile");
  const temporary = requiredRegressionPath(temporaryRoot, "temporaryRoot");
  const stateStat = lstatSync(statePath);
  if (!stateStat.isFile() || stateStat.isSymbolicLink()) {
    throw new Error("The isolated ShipIt state must be a regular file");
  }
  const request = JSON.parse(readFileSync(statePath, "utf8"));
  const requestPaths = [request.updateBundleURL, request.targetBundleURL]
    .map((value) => {
      const url = new URL(String(value || ""));
      if (url.protocol !== "file:") {
        throw new Error("The isolated ShipIt request must use local App paths");
      }
      return path.resolve(fileURLToPath(url));
    });
  if (
    request.launchAfterInstallation !== false
    || requestPaths.some((requestPath) => {
      const relative = path.relative(temporary, requestPath);
      return relative.startsWith("..") || path.isAbsolute(relative);
    })
  ) {
    throw new Error("The ShipIt request is not isolated to the update regression root");
  }
  return request;
}

export async function prepareIsolatedShipItRequestForInstallation({
  homeDir,
  jobLabel,
  targetAppPath,
  temporaryRoot,
  prepareUpdateAppPath = prepareMacUpdateAppPath,
} = {}) {
  const prepared = await prepareUpdateAppPath({
    homeDir,
    jobLabel,
    targetAppPath,
  });
  const request = assertIsolatedShipItRequest({
    stateFile: prepared.stateFile,
    temporaryRoot,
  });
  if (
    prepared.useUpdateBundleName !== false
    || request.useUpdateBundleName !== false
  ) {
    throw new Error(
      "The non-writable update regression must preserve the installed App directory",
    );
  }
  return request;
}

function requiredRegressionPath(value, label) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    throw new Error(`${label} is required for the macOS update regression`);
  }
  return path.resolve(candidate);
}

function assertRunningTemporaryProcessesIsolated({
  temporaryRoot,
  protectedProfilePath,
} = {}) {
  const processes = spawnSync("ps", ["-axo", "command="], { encoding: "utf8" });
  if (processes.status !== 0) {
    throw new Error("Could not inspect isolated macOS update processes");
  }
  return assertTemporaryProcessIsolation({
    commandOutput: processes.stdout,
    temporaryRoot,
    protectedProfilePath,
  });
}

function runningExecutableProcessIds(executablePath) {
  const executable = path.resolve(executablePath);
  const processes = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  });
  if (processes.status !== 0) {
    throw new Error("Could not inspect the installed candidate process");
  }
  return String(processes.stdout || "")
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter((match) => (
      match
      && (
        match[2] === executable
        || match[2].startsWith(`${executable} `)
      )
    ))
    .map((match) => Number(match[1]));
}

export function terminateProcessesInside(temporaryRoot, signal = "SIGTERM") {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  const pids = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter((match) => match && match[2].includes(temporaryRoot))
    .map((match) => Number(match[1]))
    .filter((pid) => pid !== process.pid);
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
  return pids;
}

export function bootoutUserShipItJob(
  temporaryRoot,
  { label = SHIPIT_JOB_LABEL } = {},
) {
  const job = launchctlJobDetails({ domain: "user", label });
  if (!job.exists) return false;
  if (!job.output.includes(temporaryRoot)) {
    throw new Error(
      `Refusing to remove a ShipIt job that does not belong to this harness: ${job.target}`,
    );
  }
  const result = spawnSync(
    "launchctl",
    ["bootout", `gui/${process.getuid()}/${label}`],
    { encoding: "utf8" },
  );
  if (
    result.status !== 0
    && launchctlJobExists({ domain: "user", label })
  ) {
    throw new Error(
      result.stderr?.trim() || "Could not remove the per-user ShipIt launchd job",
    );
  }
  return true;
}

function optionValue(args, name, { required = false } = {}) {
  const index = args.indexOf(name);
  const value = index >= 0 ? String(args[index + 1] || "").trim() : "";
  if (required && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function runHarness({
  track,
  expectedVersion,
  expectedCommit,
  outputPath,
  logPath,
  baseUrl = DEFAULT_BASE_URL,
} = {}) {
  const channels = updateRegressionChannels(track);
  const releaseShipItJobLabel = track === "internal"
    ? SHIPIT_JOB_LABEL
    : PUBLIC_SHIPIT_JOB_LABEL;
  const host = assertCurrentHostSafe({
    allowedDormantUserShipItLabels: [releaseShipItJobLabel],
  });
  const preexistingDormantUserShipItJobs = new Map(
    host.preexistingDormantUserShipItJobs.map((job) => [job.label, job]),
  );
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "git-leaf-mac-update-regression."),
  );
  const isolatedHome = path.join(temporaryRoot, "home");
  const isolatedTmp = path.join(temporaryRoot, "tmp");
  const userDataDir = path.join(temporaryRoot, "user-data");
  const installDir = path.join(temporaryRoot, "install");
  const candidateExtractDir = path.join(temporaryRoot, "candidate-app");
  const downloadsDir = path.join(temporaryRoot, "downloads");
  const serverRoot = path.join(temporaryRoot, "update-root");
  const telemetryRoot = path.join(temporaryRoot, "telemetry");
  let server;
  let appProcess;
  let passedEvidence;
  let primaryError;
  let installDirectoryLocked = false;
  const cleanupErrors = [];

  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(isolatedTmp, { recursive: true });
  mkdirSync(downloadsDir, { recursive: true });
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, "", { flag: "w" });

  try {
    const stableManifestUrl =
      `${baseUrl.replace(/\/+$/, "")}/${channels.stable}/${PLATFORM_KEY}/latest.json`;
    const candidateManifestUrl =
      `${baseUrl.replace(/\/+$/, "")}/${channels.candidate}/${PLATFORM_KEY}/latest.json`;
    const stableManifest = validateUpdateRegressionManifest(
      await fetchJson(stableManifestUrl),
      {
        channel: channels.stable,
        track,
        allowLegacyPublicStableBridge: true,
      },
    );
    const candidateManifest = validateUpdateRegressionManifest(
      await fetchJson(candidateManifestUrl),
      {
        channel: channels.candidate,
        track,
        expectedVersion,
        expectedCommit,
      },
    );
    if (
      compareAppVersions(candidateManifest.version, stableManifest.version) <= 0
    ) {
      throw new Error(
        `Candidate ${candidateManifest.version} is not newer than stable ${stableManifest.version}`,
      );
    }

    const baselineZipPath = path.join(downloadsDir, stableManifest.files.zip.name);
    const candidateZipPath = path.join(downloadsDir, candidateManifest.files.zip.name);
    const baselineContract = await downloadUpdateRegressionArtifact(
      stableManifest.files.zip,
      baselineZipPath,
    );
    const candidateContract = await downloadUpdateRegressionArtifact(
      candidateManifest.files.zip,
      candidateZipPath,
    );
    const appPath = prepareInstalledBaselineAppPath(
      extractSingleApp(baselineZipPath, installDir),
      { track },
    );
    const candidateAppPath = extractSingleApp(
      candidateZipPath,
      candidateExtractDir,
    );
    const baselineAppIdentity = readMacAppIdentity(appPath);
    const candidateAppIdentity = readMacAppIdentity(candidateAppPath);
    const expectedCandidateBundleId = track === "internal"
      ? OFFICIAL_INTERNAL_MAC_BUNDLE_ID
      : OFFICIAL_PUBLIC_MAC_BUNDLE_ID;
    if (candidateAppIdentity.bundleIdentifier !== expectedCandidateBundleId) {
      throw new Error(
        `Candidate Bundle ID ${candidateAppIdentity.bundleIdentifier || "missing"} does not match ${track}`,
      );
    }
    if (
      stableManifest.releaseTrack === track
      && baselineAppIdentity.bundleIdentifier !== expectedCandidateBundleId
    ) {
      throw new Error(
        `Baseline Bundle ID ${baselineAppIdentity.bundleIdentifier || "missing"} does not match ${track}`,
      );
    }
    const shipItJobLabel = `${baselineAppIdentity.bundleIdentifier}.ShipIt`;
    verifyAppSignature(appPath);
    verifyAppSignature(candidateAppPath);
    const squirrelPolicy = verifySquirrelMacPolicy({
      appDir: candidateAppPath,
    });
    const baselineVersion = readAppVersion(appPath);
    if (baselineVersion !== stableManifest.version) {
      throw new Error(
        `Baseline App version ${baselineVersion} does not match stable ${stableManifest.version}`,
      );
    }
    const appDirectoryInode = statSync(appPath).ino;
    chmodSync(installDir, 0o555);
    installDirectoryLocked = true;

    let installMode;
    let inAppUpdateIsolation = null;
    if (
      compareAppVersions(
        stableManifest.version,
        FIRST_NONPRIVILEGED_ONLY_VERSION,
      ) < 0
    ) {
      installMode = replaceMacAppContents({
        sourceAppPath: candidateAppPath,
        targetAppPath: appPath,
        expectedVersion: candidateManifest.version,
      }).installMode;
    } else {
      installMode = "in-app-update";
      server = await startUpdateServer({ serverRoot, telemetryRoot, logPath });
      rewriteCandidateForLocalStable({
        manifest: candidateManifest,
        channel: channels.stable,
        serverRoot,
        port: server.port,
        candidateZipPath,
      });

      const expectedUserState = writeDesktopConfig(userDataDir, {
        repoRoot: REPO_ROOT,
        targetVersion: candidateManifest.version,
      });
      const appEnv = {
        ...process.env,
        HOME: isolatedHome,
        CFFIXED_USER_HOME: isolatedHome,
        TMPDIR: `${isolatedTmp}${path.sep}`,
        OPENGLANCE_UPDATE_BASE_URL: `http://127.0.0.1:${server.port}/git-leaf`,
        GIT_LEAF_UPDATE_BASE_URL: `http://127.0.0.1:${server.port}/git-leaf`,
        OPENGLANCE_DEV_USER_DATA_DIR: userDataDir,
        GIT_LEAF_DEV_USER_DATA_DIR: userDataDir,
      };
      writeIsolatedSquirrelDefault(appEnv, baselineAppIdentity.bundleIdentifier);
      const logDescriptor = openSync(logPath, "a");
      appProcess = spawn(
        macAppExecutablePath(appPath),
        [
          `${DEVELOPMENT_USER_DATA_ARG}=${userDataDir}`,
          `${LEGACY_DEVELOPMENT_USER_DATA_ARG}=${userDataDir}`,
          "--remote-debugging-port=0",
          "--repo",
          REPO_ROOT,
        ],
        {
          env: appEnv,
          detached: false,
          stdio: ["ignore", logDescriptor, logDescriptor],
        },
      );
      closeSync(logDescriptor);

      const isolatedShipItCache = path.join(
        isolatedHome,
        "Library",
        "Caches",
        shipItJobLabel,
      );
      const isolatedShipItState = path.join(
        isolatedShipItCache,
        "ShipItState.plist",
      );
      await waitFor(() => (
        existsSync(path.join(userDataDir, "DevToolsActivePort"))
        && existsSync(isolatedShipItState)
      ), {
        timeoutMs: 240_000,
        label: "the signed candidate to download and prepare",
      });
      if (launchctlJobExists({ domain: "system", label: shipItJobLabel })) {
        throw new Error("The update attempted to register a privileged ShipIt job");
      }
      let shipItRequest = assertIsolatedShipItRequest({
        stateFile: isolatedShipItState,
        temporaryRoot,
      });
      assertRunningTemporaryProcessesIsolated({
        temporaryRoot,
        protectedProfilePath: host.productionProfilePath,
      });
      const updateAction = await evaluateInRenderer({
        userDataDir,
        expression: updateRegressionInstallExpression({ activate: false }),
      });
      if (updateAction?.reason !== "action-ready") {
        throw new Error("The packaged update action was not ready before installation");
      }
      shipItRequest = await prepareIsolatedShipItRequestForInstallation({
        homeDir: isolatedHome,
        jobLabel: shipItJobLabel,
        targetAppPath: appPath,
        temporaryRoot,
      });
      if (!appProcess.kill("SIGTERM")) {
        throw new Error("Could not stop the isolated baseline App for installation");
      }
      await waitFor(() => (
        appProcess.exitCode !== null || appProcess.signalCode !== null
      ), {
        timeoutMs: 30_000,
        intervalMs: 100,
        label: "the isolated baseline App to exit",
      });

      await waitFor(() => {
        assertRunningTemporaryProcessesIsolated({
          temporaryRoot,
          protectedProfilePath: host.productionProfilePath,
        });
        return readAppVersion(appPath) === candidateManifest.version;
      }, {
        timeoutMs: 180_000,
        intervalMs: 500,
        label: `OpenGlance ${candidateManifest.version} to replace the baseline`,
      });
      const candidateExecutable = macAppExecutablePath(appPath);
      if (runningExecutableProcessIds(candidateExecutable).length > 0) {
        throw new Error("ShipIt relaunched the candidate outside the isolated harness");
      }
      rmSync(path.join(userDataDir, "DevToolsActivePort"), { force: true });
      const candidateLogDescriptor = openSync(logPath, "a");
      appProcess = spawn(
        candidateExecutable,
        [
          `${DEVELOPMENT_USER_DATA_ARG}=${userDataDir}`,
          `${LEGACY_DEVELOPMENT_USER_DATA_ARG}=${userDataDir}`,
          "--remote-debugging-port=0",
          "--repo",
          REPO_ROOT,
        ],
        {
          env: appEnv,
          detached: false,
          stdio: ["ignore", candidateLogDescriptor, candidateLogDescriptor],
        },
      );
      closeSync(candidateLogDescriptor);
      await waitFor(() => {
        assertRunningTemporaryProcessesIsolated({
          temporaryRoot,
          protectedProfilePath: host.productionProfilePath,
        });
        return existsSync(path.join(userDataDir, "DevToolsActivePort"));
      }, {
        timeoutMs: 60_000,
        intervalMs: 250,
        label: "the installed candidate to relaunch with its isolated Profile",
      });
      const preservedConfig = JSON.parse(readFileSync(
        path.join(userDataDir, "desktop-config.json"),
        "utf8",
      ));
      assertRenameMigrationUserState(preservedConfig, expectedUserState);
      inAppUpdateIsolation = {
        updateActionReady: true,
        shipItLaunchAfterInstallation: shipItRequest.launchAfterInstallation,
        installTrigger: "isolated-process-termination",
        candidateRelaunchedWithIsolatedProfile: true,
      };
    }

    if (statSync(appPath).ino !== appDirectoryInode) {
      throw new Error(
        "The update replaced the App directory instead of its Contents directory",
      );
    }
    verifyAppSignature(appPath);
    if (readAppVersion(appPath) !== candidateManifest.version) {
      throw new Error("The installed App version does not match the candidate");
    }
    verifySquirrelMacPolicy({ appDir: appPath });
    const installedAppIdentity = readMacAppIdentity(appPath);
    if (launchctlJobExists({ domain: "system", label: shipItJobLabel })) {
      throw new Error("The update registered a privileged ShipIt job");
    }

    passedEvidence = {
      schemaVersion: 5,
      source: "openglance-macos-update-regression",
      status: "passed",
      track,
      platform: PLATFORM_KEY,
      fromVersion: stableManifest.version,
      fromTrack: stableManifest.releaseTrack,
      fromChannel: stableManifest.channel,
      toVersion: candidateManifest.version,
      commit: expectedCommit,
      buildId: candidateManifest.buildId,
      baseline: baselineContract,
      candidate: candidateContract,
      installMode,
      ...(inAppUpdateIsolation || {}),
      directContentsWrite: true,
      appDirectoryInodePreserved: true,
      baselineAppIdentity,
      candidateAppIdentity,
      installedAppIdentity,
      profileStatePreserved: true,
      installParentWritable: false,
      privilegedShipItJobObserved: false,
      squirrelPolicy,
      realProfileBefore: host.productionFingerprint,
      realShipItCacheBefore: host.realShipItFingerprint,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (installDirectoryLocked) {
        chmodSync(installDir, 0o755);
        installDirectoryLocked = false;
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      terminateProcessesInside(temporaryRoot);
      await delay(2_000);
      terminateProcessesInside(temporaryRoot, "SIGKILL");
      await delay(500);
      const remaining = terminateProcessesInside(temporaryRoot, "SIGKILL");
      if (remaining.length > 0) {
        throw new Error(
          `Processes remained inside the update regression root: ${remaining.join(", ")}`,
        );
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      server?.child?.kill("SIGTERM");
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      for (const label of OFFICIAL_SHIPIT_JOB_LABELS) {
        const currentJob = launchctlJobDetails({ domain: "user", label });
        const preexistingJob = preexistingDormantUserShipItJobs.get(label);
        if (
          !passedEvidence
          && isUnchangedPreexistingShipItJob({ currentJob, preexistingJob })
        ) {
          continue;
        }
        bootoutUserShipItJob(temporaryRoot, { label });
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const remainingUserShipItJobs = OFFICIAL_SHIPIT_JOB_LABELS
        .map((label) => ({
          label,
          details: launchctlJobDetails({ domain: "user", label }),
        }))
        .filter(({ details }) => details.exists);
      const onlyPreservedAfterFailure = !passedEvidence
        && remainingUserShipItJobs.every(({ label, details }) => (
          isUnchangedPreexistingShipItJob({
            currentJob: details,
            preexistingJob: preexistingDormantUserShipItJobs.get(label),
          })
        ));
      if (
        remainingUserShipItJobs.length > 0
        && !onlyPreservedAfterFailure
      ) {
        throw new Error("The per-user ShipIt launchd job remained after cleanup");
      }
      if (OFFICIAL_SHIPIT_JOB_LABELS.some((label) => (
        launchctlJobExists({ domain: "system", label })
      ))) {
        throw new Error("A system ShipIt launchd job remained after cleanup");
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const after = developmentProfileFingerprint({
        productionUserDataDir: host.productionProfilePath,
      });
      if (after.sha256 !== host.productionFingerprint.sha256) {
        throw new Error("The real OpenGlance Profile changed during update regression");
      }
      const realShipItCacheAfter = developmentProfileFingerprint({
        productionUserDataDir: host.realShipItCacheRoot,
        entries: OFFICIAL_SHIPIT_JOB_LABELS,
      });
      if (
        realShipItCacheAfter.sha256 !== host.realShipItFingerprint.sha256
      ) {
        throw new Error(
          "The real ShipIt cache changed during update regression",
        );
      }
      if (passedEvidence) {
        passedEvidence.realProfileAfter = after;
        passedEvidence.realShipItCacheAfter = realShipItCacheAfter;
        passedEvidence.cleanup = {
          processesTerminated: true,
          userShipItJobAbsent: true,
          systemShipItJobAbsent: true,
          isolatedCacheRemovedWithTemporaryRoot: true,
          realProfileUnchanged: true,
          realShipItCacheUnchanged: true,
        };
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      rmSync(temporaryRoot, { recursive: true, force: false });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError || cleanupErrors.length > 0) {
    const errors = [primaryError, ...cleanupErrors].filter(Boolean);
    throw errors.length === 1
      ? errors[0]
      : new AggregateError(errors, "macOS update regression and cleanup failed");
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(passedEvidence, null, 2)}\n`, {
    flag: "wx",
  });
  return passedEvidence;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mac-update-regression.mjs
    --track <public|internal>
    --expected-version VERSION
    --expected-commit SHA
    --output FILE
    [--log FILE]
    [--base-url URL]

This harness runs on the release Mac with an isolated HOME and Electron Profile.
It refuses to start while an installed OpenGlance or Git Leaf App is running or while
ShipIt state is active, failed, pending, cross-track, or otherwise unsafe. A completed
dormant same-track user job may be replaced by Squirrel's normal update submission.`);
}

async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const outputPath = path.resolve(optionValue(args, "--output", { required: true }));
  await runHarness({
    track: optionValue(args, "--track", { required: true }),
    expectedVersion: optionValue(args, "--expected-version", { required: true }),
    expectedCommit: optionValue(args, "--expected-commit", { required: true }),
    outputPath,
    logPath: path.resolve(
      optionValue(args, "--log")
      || `${outputPath.slice(0, -path.extname(outputPath).length)}.log`,
    ),
    baseUrl: optionValue(args, "--base-url") || DEFAULT_BASE_URL,
  });
  console.log(`macOS update regression passed: ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
