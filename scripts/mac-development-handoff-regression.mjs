#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractFile, listPackage, uncache } from "@electron/asar";

import {
  BUILD_INFO_FILENAME,
  LEGACY_BUILD_INFO_FILENAMES,
} from "../src/build-info.mjs";
import {
  normalizeDevelopmentHandoffReceipt,
  sameDevelopmentHandoffReceipt,
} from "../src/desktop/development-handoff.mjs";
import { DEVELOPMENT_USER_DATA_ARG } from "../src/desktop/user-data.mjs";
import { compareAppVersions } from "../src/desktop/app-updates.mjs";
import {
  OFFICIAL_INTERNAL_MAC_EXECUTABLE_NAME,
} from "../src/desktop/mac-app-contents.mjs";
import { macDevelopmentHandoffCachePaths } from "../src/desktop/mac-development-handoff-update.mjs";
import {
  OPENGLANCE_PROTOCOL,
  OPENGLANCE_SUPPORTED_PROTOCOLS,
} from "../src/product-identity.mjs";
import {
  applyMacBundleIcon,
  DEFAULT_RELEASE_OPTIONS,
  developmentProfileFingerprint,
  electronPackagerArgs,
  signMacAppAdHoc,
} from "./release-mac.mjs";
import {
  COMMUNITY_PACKAGE_IDENTITY,
  compactTimestamp,
  electronPackagerCommand,
  OFFICIAL_PACKAGE_IDENTITY,
  releaseBuildInfoFromEnv,
  withReleaseBuildInfoFile,
} from "./release-shared.mjs";
import {
  SHIPIT_JOB_LABEL,
  assertCurrentHostSafe,
  bootoutUserShipItJob,
  delay,
  downloadUpdateRegressionArtifact,
  evaluateInRenderer,
  extractSingleApp,
  fileContract,
  isUnchangedPreexistingShipItJob,
  launchctlJobDetails,
  launchctlJobExists,
  readAppVersion,
  rewriteCandidateForLocalStable,
  runChecked,
  startUpdateServer,
  terminateProcessesInside,
  updateRegressionInstallExpression,
  validateUpdateRegressionManifest,
  verifyAppSignature,
  waitFor,
} from "./mac-update-regression.mjs";
import {
  patchSquirrelMacPolicy,
  verifySquirrelMacPolicy,
} from "./squirrel-mac-policy.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const PLATFORM_KEY = "darwin-universal";
const INTERNAL_CHANNEL = "internal-stable";
const DEFAULT_BASE_URL = "https://updates.mangofuture.com/git-leaf";
const SEMANTIC_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const STABLE_SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const SOURCE_SHIPIT_JOB_LABEL =
  `${COMMUNITY_PACKAGE_IDENTITY.macBundleId}.ShipIt`;
const LEGACY_SOURCE_SHIPIT_JOB_LABEL = "org.gitleaf.community.ShipIt";
const HANDOFF_SHIPIT_JOB_LABELS = [
  SHIPIT_JOB_LABEL,
  SOURCE_SHIPIT_JOB_LABEL,
  LEGACY_SOURCE_SHIPIT_JOB_LABEL,
];
export const OFFICIAL_MAC_TEAM_IDENTIFIER = "HN6X79BUSR";

export function validateDevelopmentHandoffBuildPair({
  sourceBuildInfo,
  sourceBundleId,
  targetBuildInfo,
  targetBundleId,
  targetExecutable,
  receipt,
} = {}) {
  const normalizedReceipt = normalizeDevelopmentHandoffReceipt(receipt);
  const targetReceipt = normalizeDevelopmentHandoffReceipt({
    kind: "dev-to-internal",
    version: targetBuildInfo?.version,
    buildId: targetBuildInfo?.buildId,
    commit: targetBuildInfo?.commit,
    releaseTrack: targetBuildInfo?.releaseTrack,
    channel: "internal-stable",
    platform: "darwin-universal",
  });
  if (
    sourceBuildInfo?.dev !== true
    || sourceBuildInfo?.distribution !== "source"
    || sourceBuildInfo?.releaseTrack !== "source"
    || sourceBuildInfo?.usageAnalyticsDefault !== false
    || sourceBundleId !== COMMUNITY_PACKAGE_IDENTITY.macBundleId
    || targetBuildInfo?.dev === true
    || targetBuildInfo?.distribution !== "official"
    || targetBuildInfo?.releaseTrack !== "internal"
    || targetBuildInfo?.usageAnalyticsDefault !== true
    || targetBundleId !== OFFICIAL_PACKAGE_IDENTITY.macBundleId
    || targetExecutable !== OFFICIAL_INTERNAL_MAC_EXECUTABLE_NAME
    || !SEMANTIC_VERSION.test(String(sourceBuildInfo?.version || ""))
    || !SEMANTIC_VERSION.test(String(targetBuildInfo?.version || ""))
    || compareAppVersions(
      targetBuildInfo?.version,
      sourceBuildInfo?.version,
    ) <= 0
    || !normalizedReceipt
    || !targetReceipt
    || !sameDevelopmentHandoffReceipt(normalizedReceipt, targetReceipt)
  ) {
    throw new Error(
      "The packaged Apps do not satisfy the strictly newer development handoff contract.",
    );
  }
  return {
    sourceVersion: sourceBuildInfo.version,
    targetVersion: targetBuildInfo.version,
    sourceBuildId: sourceBuildInfo.buildId,
    targetBuildId: targetBuildInfo.buildId,
  };
}

export function validateDevelopmentHandoffRegressionEvidence(evidence) {
  const requiredCleanup = [
    "processesTerminated",
    "userShipItJobsUnchangedOrAbsent",
    "systemShipItJobsAbsent",
    "preexistingDormantUserShipItJobsPreserved",
    "isolatedCacheRemovedWithTemporaryRoot",
    "realProfileUnchanged",
    "realShipItCacheUnchanged",
  ];
  const preexistingDormantLabels =
    evidence?.preexistingDormantUserShipItJobLabels;
  if (
    evidence?.schemaVersion !== 2
    || evidence?.source !== "git-leaf-macos-development-handoff-regression"
    || evidence?.status !== "passed"
    || evidence?.platform !== "darwin-universal"
    || !SEMANTIC_VERSION.test(String(evidence?.sourceVersion || ""))
    || !SEMANTIC_VERSION.test(String(evidence?.version || ""))
    || compareAppVersions(evidence?.version, evidence?.sourceVersion) <= 0
    || evidence?.sourceBundleId !== COMMUNITY_PACKAGE_IDENTITY.macBundleId
    || evidence?.targetBundleId !== OFFICIAL_PACKAGE_IDENTITY.macBundleId
    || evidence?.targetTeamIdentifier !== OFFICIAL_MAC_TEAM_IDENTIFIER
    || evidence?.targetExecutable !== OFFICIAL_INTERNAL_MAC_EXECUTABLE_NAME
    || evidence?.protocolScheme !== OPENGLANCE_PROTOCOL
    || !Array.isArray(evidence?.protocolSchemes)
    || OPENGLANCE_SUPPORTED_PROTOCOLS.some(
      (scheme) => !evidence.protocolSchemes.includes(scheme),
    )
    || evidence?.targetUsageAnalyticsDefault !== true
    || evidence?.analyticsDefaultAdopted !== true
    || evidence?.handoffReceiptConsumed !== true
    || evidence?.telemetryInitialized !== true
    || evidence?.nonprivilegedContentsBridge !== true
    || evidence?.squirrelInvoked !== false
    || evidence?.preparedUpdateRemoved !== true
    || evidence?.appDirectoryInodePreserved !== true
    || evidence?.installParentWritable !== false
    || evidence?.privilegedShipItJobObserved !== false
    || !Array.isArray(preexistingDormantLabels)
    || new Set(preexistingDormantLabels).size !== preexistingDormantLabels.length
    || preexistingDormantLabels.some(
      (label) => !HANDOFF_SHIPIT_JOB_LABELS.includes(label),
    )
    || !sameFingerprint(evidence?.realProfileBefore, evidence?.realProfileAfter)
    || !sameFingerprint(
      evidence?.realShipItCacheBefore,
      evidence?.realShipItCacheAfter,
    )
    || requiredCleanup.some((key) => evidence?.cleanup?.[key] !== true)
  ) {
    throw new Error(
      "Mandatory development handoff evidence is missing or inconsistent.",
    );
  }
  return evidence;
}

function sameFingerprint(left, right) {
  return Boolean(
    left
    && right
    && typeof left.sha256 === "string"
    && left.sha256 === right.sha256
    && left.fileCount === right.fileCount
  );
}

export function developmentHandoffRegressionSourceVersion(targetVersion) {
  const match = String(targetVersion || "").trim().match(
    STABLE_SEMANTIC_VERSION,
  );
  if (!match) {
    throw new Error(
      `Cannot derive a lower source version from ${targetVersion || "missing"}.`,
    );
  }
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(
      `Cannot derive a lower source version from ${targetVersion}.`,
    );
  }
  const [major, minor, patch] = parts;
  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.0`;
  if (major > 0) return `${major - 1}.0.0`;
  throw new Error(`Cannot derive a lower source version from ${targetVersion}.`);
}

export async function runDevelopmentHandoffRegression({
  outputPath,
  logPath,
  baseUrl = DEFAULT_BASE_URL,
  allowVisibleApp = false,
} = {}) {
  if (!outputPath || !logPath) {
    throw new TypeError("outputPath and logPath are required");
  }
  if (!allowVisibleApp) {
    throw new Error(
      "This regression launches and restarts a visible temporary App. "
      + "Run it only when desktop interruption is acceptable and pass --allow-visible-app.",
    );
  }
  const host = assertDevelopmentHandoffHostSafe();
  const preexistingDormantUserShipItJobs = new Map(
    host.preexistingDormantUserShipItJobs.map((job) => [job.label, job]),
  );
  const realShipItCacheBefore = host.realShipItFingerprint;
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "git-leaf-mac-development-handoff."),
  );
  const isolatedHome = path.join(temporaryRoot, "home");
  const isolatedTmp = path.join(temporaryRoot, "tmp");
  const userDataDir = path.join(temporaryRoot, "user-data");
  const packageOutputDir = path.join(temporaryRoot, "package");
  const candidateExtractDir = path.join(temporaryRoot, "candidate-app");
  const downloadsDir = path.join(temporaryRoot, "downloads");
  const serverRoot = path.join(temporaryRoot, "update-root");
  const telemetryRoot = path.join(temporaryRoot, "telemetry");
  let server;
  let appProcess;
  let appParentLocked = false;
  let passedEvidence;
  let primaryError;
  const cleanupErrors = [];

  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(isolatedTmp, { recursive: true });
  mkdirSync(downloadsDir, { recursive: true });
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, "", { flag: "w" });

  try {
    const manifestUrl =
      `${baseUrl.replace(/\/+$/, "")}/${INTERNAL_CHANNEL}/${PLATFORM_KEY}/latest.json`;
    const targetManifest = validateUpdateRegressionManifest(
      await fetchJson(manifestUrl),
      {
        channel: INTERNAL_CHANNEL,
        track: "internal",
      },
    );
    const sourceVersion = developmentHandoffRegressionSourceVersion(
      targetManifest.version,
    );
    const sourceAppPath = packageSourceDevelopmentApp({
      outputDir: packageOutputDir,
      version: sourceVersion,
    });
    const sourceBuildInfo = readPackagedBuildInfo(sourceAppPath);
    const sourceBundleId = readAppPlistValue(
      sourceAppPath,
      "CFBundleIdentifier",
    );
    if (readAppVersion(sourceAppPath) !== sourceBuildInfo.version) {
      throw new Error("The development App version does not match its build identity");
    }
    const sourceSquirrelPolicy = verifySquirrelMacPolicy({
      appDir: sourceAppPath,
    });

    const targetZipPath = path.join(downloadsDir, targetManifest.files.zip.name);
    const localArchivedZip = path.join(
      REPO_ROOT,
      "dist",
      "releases",
      `v${targetManifest.version}`,
      targetManifest.files.zip.name,
    );
    let targetContract;
    if (existsSync(localArchivedZip)) {
      targetContract = await fileContract(localArchivedZip);
      if (
        targetContract.sha256 !== targetManifest.files.zip.sha256
        || targetContract.size !== targetManifest.files.zip.size
      ) {
        throw new Error(
          "The local archived internal ZIP does not match the stable manifest",
        );
      }
      runChecked("ditto", [localArchivedZip, targetZipPath]);
    } else {
      targetContract = await downloadUpdateRegressionArtifact(
        targetManifest.files.zip,
        targetZipPath,
      );
    }

    const targetAppPath = extractSingleApp(
      targetZipPath,
      candidateExtractDir,
    );
    verifyAppSignature(targetAppPath);
    const targetTeamIdentifier = readAppTeamIdentifier(targetAppPath);
    const targetBuildInfo = readPackagedBuildInfo(targetAppPath);
    const targetBundleId = readAppPlistValue(
      targetAppPath,
      "CFBundleIdentifier",
    );
    const targetExecutable = readAppPlistValue(
      targetAppPath,
      "CFBundleExecutable",
    );
    const targetSquirrelPolicy = verifySquirrelMacPolicy({
      appDir: targetAppPath,
    });
    const receipt = normalizeDevelopmentHandoffReceipt({
      kind: "dev-to-internal",
      version: targetManifest.version,
      buildId: targetManifest.buildId,
      commit: targetManifest.commit,
      releaseTrack: targetManifest.releaseTrack,
      channel: targetManifest.channel,
      platform: targetManifest.platform,
    });
    const pair = validateDevelopmentHandoffBuildPair({
      sourceBuildInfo,
      sourceBundleId,
      targetBuildInfo,
      targetBundleId,
      targetExecutable,
      receipt,
    });
    if (targetTeamIdentifier !== OFFICIAL_MAC_TEAM_IDENTIFIER) {
      throw new Error(
        `The internal App is signed by unexpected team ${targetTeamIdentifier || "missing"}`,
      );
    }
    const protocolSchemes = OPENGLANCE_SUPPORTED_PROTOCOLS.map((_scheme, index) => readAppPlistValue(
      targetAppPath,
      `CFBundleURLTypes:0:CFBundleURLSchemes:${index}`,
    ));
    if (OPENGLANCE_SUPPORTED_PROTOCOLS.some(
      (scheme) => !protocolSchemes.includes(scheme),
    )) {
      throw new Error(
        "The internal App does not own the canonical and legacy OpenGlance URL schemes",
      );
    }

    server = await startUpdateServer({ serverRoot, telemetryRoot, logPath });
    rewriteCandidateForLocalStable({
      manifest: targetManifest,
      channel: INTERNAL_CHANNEL,
      serverRoot,
      port: server.port,
      candidateZipPath: targetZipPath,
    });
    writeIsolatedDesktopConfig(userDataDir);

    const appDirectoryInode = statSync(sourceAppPath).ino;
    const appParent = path.dirname(sourceAppPath);
    chmodSync(appParent, 0o555);
    appParentLocked = true;
    const appEnv = {
      ...process.env,
      HOME: isolatedHome,
      CFFIXED_USER_HOME: isolatedHome,
      TMPDIR: `${isolatedTmp}${path.sep}`,
      OPENGLANCE_UPDATE_BASE_URL:
        `http://127.0.0.1:${server.port}/git-leaf`,
      OPENGLANCE_TELEMETRY_ENDPOINT:
        `http://127.0.0.1:${server.port}/telemetry/v1/events`,
      OPENGLANCE_DEV_USER_DATA_DIR: userDataDir,
    };
    const logDescriptor = openSync(logPath, "a");
    appProcess = spawn(
      path.join(sourceAppPath, "Contents", "MacOS", "OpenGlance"),
      [
        `${DEVELOPMENT_USER_DATA_ARG}=${userDataDir}`,
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

    await waitFor(() => (
      existsSync(path.join(userDataDir, "DevToolsActivePort"))
    ), {
      timeoutMs: 120_000,
      label: "the isolated development renderer",
    });
    const preparedPaths = macDevelopmentHandoffCachePaths({
      userDataDir,
      handoff: receipt,
    });
    await waitFor(async () => {
      const action = await evaluateInRenderer({
        userDataDir,
        expression: updateRegressionInstallExpression(),
      });
      return action?.clicked === true;
    }, {
      timeoutMs: 120_000,
      intervalMs: 500,
      label: "the development handoff action",
    });
    await waitFor(() => (
      sameDevelopmentHandoffReceipt(
        readJsonIfPresent(path.join(userDataDir, "desktop-config.json"))
          ?.developmentHandoff,
        receipt,
      )
      && existsSync(preparedPaths.readyFile)
    ), {
      timeoutMs: 240_000,
      intervalMs: 500,
      label: "the user-selected signed internal handoff preparation",
    });

    await waitFor(async () => {
      const action = await evaluateInRenderer({
        userDataDir,
        expression: updateRegressionInstallExpression(),
      });
      return action?.clicked === true;
    }, {
      timeoutMs: 120_000,
      intervalMs: 500,
      label: "the prepared development handoff install action",
    });

    const isolatedShipItCaches = HANDOFF_SHIPIT_JOB_LABELS.map((label) => (
      path.join(isolatedHome, "Library", "Caches", label)
    ));
    if (isolatedShipItCaches.some((cachePath) => (
      existsSync(path.join(cachePath, "ShipItState.plist"))
    ))) {
      throw new Error("The development handoff invoked Squirrel.Mac");
    }
    if (
      launchctlJobExists({ domain: "system", label: SHIPIT_JOB_LABEL })
      || launchctlJobExists({
        domain: "system",
        label: SOURCE_SHIPIT_JOB_LABEL,
      })
      || launchctlJobExists({
        domain: "system",
        label: LEGACY_SOURCE_SHIPIT_JOB_LABEL,
      })
    ) {
      throw new Error("The development handoff attempted to register a privileged ShipIt job");
    }

    await waitFor(() => (
      readAppPlistValue(sourceAppPath, "CFBundleIdentifier")
      === OFFICIAL_PACKAGE_IDENTITY.macBundleId
    ), {
      timeoutMs: 240_000,
      intervalMs: 500,
      label: "the internal App to replace the development App",
    });

    await waitFor(() => {
      const config = readJsonIfPresent(
        path.join(userDataDir, "desktop-config.json"),
      );
      const telemetryState = readJsonIfPresent(
        path.join(userDataDir, "telemetry-state.json"),
      );
      return config?.usageAnalyticsEnabled === true
        && !Object.hasOwn(config, "developmentHandoff")
        && telemetryState?.schemaVersion === 1;
    }, {
      timeoutMs: 120_000,
      label: "the internal package analytics default before telemetry startup",
    });

    if (statSync(sourceAppPath).ino !== appDirectoryInode) {
      throw new Error(
        "The development handoff replaced the App directory instead of Contents",
      );
    }
    verifyAppSignature(sourceAppPath);
    const installedBuildInfo = readPackagedBuildInfo(sourceAppPath);
    if (
      installedBuildInfo.buildId !== targetBuildInfo.buildId
      || installedBuildInfo.commit !== targetBuildInfo.commit
      || readAppVersion(sourceAppPath) !== targetBuildInfo.version
      || readAppPlistValue(
        sourceAppPath,
        "CFBundleExecutable",
      ) !== targetExecutable
    ) {
      throw new Error("The installed App does not match the requested internal target");
    }
    const installedSquirrelPolicy = verifySquirrelMacPolicy({
      appDir: sourceAppPath,
    });
    const finalConfig = readJsonIfPresent(
      path.join(userDataDir, "desktop-config.json"),
    );
    passedEvidence = {
      schemaVersion: 2,
      source: "git-leaf-macos-development-handoff-regression",
      status: "passed",
      platform: PLATFORM_KEY,
      version: pair.targetVersion,
      sourceVersion: pair.sourceVersion,
      sourceBuildId: pair.sourceBuildId,
      targetBuildId: pair.targetBuildId,
      sourceBundleId,
      targetBundleId,
      targetTeamIdentifier,
      targetExecutable,
      targetUsageAnalyticsDefault: targetBuildInfo.usageAnalyticsDefault,
      analyticsDefaultAdopted: finalConfig?.usageAnalyticsEnabled === true,
      handoffReceiptConsumed:
        !Object.hasOwn(finalConfig || {}, "developmentHandoff"),
      telemetryInitialized: existsSync(
        path.join(userDataDir, "telemetry-state.json"),
      ),
      protocolScheme: OPENGLANCE_PROTOCOL,
      protocolSchemes,
      nonprivilegedContentsBridge: true,
      squirrelInvoked: false,
      preparedUpdateRemoved: !existsSync(preparedPaths.versionRoot),
      appDirectoryInodePreserved: true,
      installParentWritable: false,
      privilegedShipItJobObserved: false,
      preexistingDormantUserShipItJobLabels: [
        ...preexistingDormantUserShipItJobs.keys(),
      ],
      sourceSquirrelPolicy,
      targetSquirrelPolicy,
      installedSquirrelPolicy,
      target: targetContract,
      realProfileBefore: host.productionFingerprint,
      realShipItCacheBefore,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (appParentLocked) {
        const sourceAppPath = path.join(
          packageOutputDir,
          "OpenGlance-darwin-universal",
          "OpenGlance.app",
        );
        chmodSync(path.dirname(sourceAppPath), 0o755);
        appParentLocked = false;
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
          `Processes remained inside the handoff root: ${remaining.join(", ")}`,
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
    for (const label of HANDOFF_SHIPIT_JOB_LABELS) {
      try {
        const currentJob = launchctlJobDetails({ domain: "user", label });
        if (isUnchangedPreexistingShipItJob({
          currentJob,
          preexistingJob: preexistingDormantUserShipItJobs.get(label),
        })) {
          continue;
        }
        bootoutUserShipItJob(temporaryRoot, { label });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      const remainingUserShipItJobs = HANDOFF_SHIPIT_JOB_LABELS
        .map((label) => ({
          label,
          details: launchctlJobDetails({ domain: "user", label }),
        }))
        .filter(({ details }) => details.exists);
      const onlyPreservedDormantJobs = remainingUserShipItJobs.every(
        ({ label, details }) => isUnchangedPreexistingShipItJob({
          currentJob: details,
          preexistingJob: preexistingDormantUserShipItJobs.get(label),
        }),
      );
      if (!onlyPreservedDormantJobs) {
        throw new Error("An unexpected per-user ShipIt job remained after cleanup");
      }
      for (const label of HANDOFF_SHIPIT_JOB_LABELS) {
        if (launchctlJobExists({ domain: "system", label })) {
          throw new Error(`A system ShipIt job remained: ${label}`);
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const realProfileAfter = developmentProfileFingerprint({
        productionUserDataDir: host.productionProfilePath,
      });
      const realShipItCacheAfter = realShipItCacheFingerprint();
      if (!sameFingerprint(host.productionFingerprint, realProfileAfter)) {
        throw new Error("The real OpenGlance Profile changed during handoff regression");
      }
      if (!sameFingerprint(realShipItCacheBefore, realShipItCacheAfter)) {
        throw new Error("The real ShipIt caches changed during handoff regression");
      }
      if (passedEvidence) {
        passedEvidence.realProfileAfter = realProfileAfter;
        passedEvidence.realShipItCacheAfter = realShipItCacheAfter;
        passedEvidence.cleanup = {
          processesTerminated: true,
          userShipItJobsUnchangedOrAbsent: true,
          systemShipItJobsAbsent: true,
          preexistingDormantUserShipItJobsPreserved: true,
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
      : new AggregateError(
        errors,
        "development handoff regression and cleanup failed",
      );
  }
  validateDevelopmentHandoffRegressionEvidence(passedEvidence);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(passedEvidence, null, 2)}\n`, {
    flag: "wx",
  });
  return passedEvidence;
}

function packageSourceDevelopmentApp({ outputDir, version } = {}) {
  const buildInfo = {
    ...releaseBuildInfoFromEnv({
      rootDir: REPO_ROOT,
      env: {
        ...process.env,
        VERSION: version,
        OPENGLANCE_RELEASE_PROFILE: "",
        OPENGLANCE_DISTRIBUTION: "source",
        OPENGLANCE_USAGE_ANALYTICS_DEFAULT: "false",
      },
    }),
    dev: true,
  };
  buildInfo.buildId = `${buildInfo.commit}.${compactTimestamp(buildInfo.builtAt)}.source`;
  const options = {
    ...DEFAULT_RELEASE_OPTIONS,
    ...buildInfo,
    bundleId: COMMUNITY_PACKAGE_IDENTITY.macBundleId,
    outDir: outputDir,
  };
  const packager = electronPackagerCommand({ rootDir: REPO_ROOT });
  withReleaseBuildInfoFile({ rootDir: REPO_ROOT, buildInfo: options }, () => {
    runChecked(
      packager.command,
      [...packager.args, ...electronPackagerArgs(options)],
      { cwd: REPO_ROOT },
    );
  });
  const appPath = path.join(
    outputDir,
    "OpenGlance-darwin-universal",
    "OpenGlance.app",
  );
  patchSquirrelMacPolicy({ appDir: appPath, rootDir: REPO_ROOT });
  applyMacBundleIcon(options, { appDir: appPath });
  signMacAppAdHoc({ appDir: appPath });
  verifySquirrelMacPolicy({ appDir: appPath });
  return appPath;
}

function assertDevelopmentHandoffHostSafe() {
  return assertCurrentHostSafe({
    shipItJobLabels: HANDOFF_SHIPIT_JOB_LABELS,
    allowedDormantUserShipItLabels: HANDOFF_SHIPIT_JOB_LABELS,
  });
}

function realShipItCacheFingerprint() {
  const cacheRoot = path.join(homedir(), "Library", "Caches");
  return developmentFingerprint(cacheRoot, [
    SHIPIT_JOB_LABEL,
    SOURCE_SHIPIT_JOB_LABEL,
    LEGACY_SOURCE_SHIPIT_JOB_LABEL,
  ]);
}

function developmentFingerprint(rootDir, entries) {
  return developmentProfileFingerprint({
    productionUserDataDir: rootDir,
    entries,
  });
}

export function readPackagedBuildInfo(appPath) {
  const asarPath = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar",
  );
  uncache(asarPath);
  const packagedFiles = new Set(
    listPackage(asarPath, { isPack: false })
      .map((filename) => filename.replace(/^[/\\]+/, "")),
  );
  const filename = [BUILD_INFO_FILENAME, ...LEGACY_BUILD_INFO_FILENAMES]
    .find((candidate) => packagedFiles.has(candidate));
  if (!filename) {
    throw new Error(
      `The packaged App is missing ${BUILD_INFO_FILENAME}`,
    );
  }
  return JSON.parse(
    extractFile(asarPath, filename).toString("utf8"),
  );
}

function readAppPlistValue(appPath, key) {
  return runChecked("/usr/libexec/PlistBuddy", [
    "-c",
    `Print:${key}`,
    path.join(appPath, "Contents", "Info.plist"),
  ]);
}

function readAppTeamIdentifier(appPath) {
  const result = spawnSync("codesign", ["-d", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "Could not inspect App signature");
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`
    .match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() || "";
}

function writeIsolatedDesktopConfig(userDataDir) {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(
    path.join(userDataDir, "desktop-config.json"),
    `${JSON.stringify({
      repoRoot: REPO_ROOT,
      openRepoRoots: [REPO_ROOT],
      usageAnalyticsEnabled: false,
      preferences: {
        language: "en",
        mode: "preview",
      },
    }, null, 2)}\n`,
    { flag: "wx" },
  );
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function optionValue(args, name, { required = false } = {}) {
  const index = args.indexOf(name);
  const value = index >= 0 ? String(args[index + 1] || "").trim() : "";
  if (required && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mac-development-handoff-regression.mjs
    --output FILE
    [--log FILE]
    [--base-url URL]
    --allow-visible-app

This harness packages a lower-version source dev build, switches it to the
newer signed internal-stable App, and keeps all automated state isolated. It
still opens and restarts a visible temporary App, so the acknowledgement flag
is mandatory.`);
}

async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const outputPath = path.resolve(
    optionValue(args, "--output", { required: true }),
  );
  const logPath = path.resolve(
    optionValue(args, "--log")
    || `${outputPath.slice(0, -path.extname(outputPath).length)}.log`,
  );
  await runDevelopmentHandoffRegression({
    outputPath,
    logPath,
    baseUrl: optionValue(args, "--base-url") || DEFAULT_BASE_URL,
    allowVisibleApp: args.includes("--allow-visible-app"),
  });
  console.log(`macOS development handoff regression passed: ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
