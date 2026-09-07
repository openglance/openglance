#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPENGLANCE_SUPPORTED_PROTOCOLS,
} from "../src/product-identity.mjs";
import {
  openGlanceEnvironmentFlag,
  openGlanceEnvironmentValue,
} from "../src/environment.mjs";
import {
  assertPathIdentitiesDoNotOverlap,
  DEVELOPMENT_USER_DATA_ARG,
  pathIdentity,
  pathsOverlap,
} from "../src/desktop/user-data.mjs";
import { buildUpdateManifest, updateArtifactRemotePath, updateMetadataRelativeDir } from "./update-publish.mjs";
import {
  assertOfficialReleaseProfile,
  assertReleaseVersionIsNew,
  electronPackagerCommand,
  ensureReleaseGitTag,
  packageVersion,
  releaseArtifactFileName,
  releaseBuildId,
  releaseBuildInfoFromEnv,
  releasePackageIdentity,
  releaseProfileFromEnv,
  releaseUpdateChannel,
  RELEASE_PACKAGE_IGNORE_PATTERNS,
  withReleaseBuildInfoFile,
} from "./release-shared.mjs";
import {
  patchSquirrelMacPolicy,
  verifySquirrelMacPolicy,
} from "./squirrel-mac-policy.mjs";
import { OFFICIAL_INTERNAL_MAC_EXECUTABLE_NAME } from "../src/desktop/mac-app-contents.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));

export const DEFAULT_RELEASE_OPTIONS = {
  appName: "OpenGlance",
  arch: "universal",
  bundleId: "org.openglance.community",
  identity:
    "Developer ID Application: Shenzhen Mango Future Technology Co., Ltd. (HN6X79BUSR)",
  notaryProfile: "",
  version: packageVersion({ rootDir: REPO_ROOT, fallbackVersion: "0.1.1" }),
  outDir: "dist",
  applicationsDir: "/Applications",
  iconPath: "assets/icons/openglance",
  entitlementsPath: "assets/entitlements.mac.plist",
  updateBaseUrl: "https://updates.mangofuture.com/git-leaf",
  updateChannel: "stable",
  updateRemoteHost: "",
  updateRemoteRoot: "",
  dmgLocale: "en",
  releaseTrack: "source",
};

const APPLICATIONS_SHORTCUT_NAME = "Applications";
const GIT_LEAF_MAC_APP_NAME = "Git Leaf";

export function macExecutableName({
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  distribution = "source",
  releaseTrack = DEFAULT_RELEASE_OPTIONS.releaseTrack,
} = {}) {
  return distribution === "official" && releaseTrack === "internal"
    ? OFFICIAL_INTERNAL_MAC_EXECUTABLE_NAME
    : appName;
}

export const releaseSteps = [
  "check-version",
  "check-prereqs",
  "test",
  "package",
  "sign",
  "dmg",
  "notarize",
  "staple",
  "zip",
  "verify",
  "tag",
];

export const devInstallSteps = [
  "package",
  "quit-dev-app",
  "install-dev-app",
  "cleanup-dev-package",
  "refresh-dev-app-icon",
  "launch-dev-app",
];

export const devSmokeSteps = [
  "validate-smoke-user-data",
  "package",
  "prepare-dev-user-data",
  "install-dev-app",
  "cleanup-dev-package",
  "launch-dev-app-and-wait",
  "verify-production-profile",
  "cleanup-smoke-user-data",
];

const macCommandsRequiringNewReleaseVersion = new Set([
  "sign",
  "dmg",
  "notarize",
  "staple",
  "zip",
  "stage-updates",
  "publish-updates",
]);
const macCommandsRequiringOfficialProfile = new Set([
  "check-prereqs",
  "sign",
  "dmg",
  "notarize",
  "staple",
  "zip",
  "stage-updates",
  "publish-updates",
  "tag",
  "release",
]);

const LSREGISTER_PATH = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const DEV_APP_QUIT_TIMEOUT_MS = 5_000;
const DEV_APP_QUIT_POLL_MS = 150;
const DEFAULT_SMOKE_USER_DATA_DIR = path.join(
  tmpdir(),
  `git-leaf-dev-smoke-${process.pid}-${Date.now()}`,
);
const DEVELOPMENT_PROFILE_COPY_ENTRIES = [
  "desktop-config.json",
  "desktop-config.backup.json",
  "Local Storage",
  "Session Storage",
];
const DEVELOPMENT_PROFILE_MARKER = ".git-leaf-dev-smoke-profile.json";
const DEVELOPMENT_PROFILE_MARKER_KIND = "git-leaf-development-profile";
const DEVELOPMENT_PROFILE_MARKER_SCHEMA_VERSION = 2;

export function electronPackagerArgs({
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  distribution = "source",
  releaseTrack = DEFAULT_RELEASE_OPTIONS.releaseTrack,
  version = DEFAULT_RELEASE_OPTIONS.version,
  arch = DEFAULT_RELEASE_OPTIONS.arch,
  bundleId = DEFAULT_RELEASE_OPTIONS.bundleId,
  outDir = DEFAULT_RELEASE_OPTIONS.outDir,
  iconPath = DEFAULT_RELEASE_OPTIONS.iconPath,
  electronZipDir,
} = {}) {
  return [
    ".",
    appName,
    "--platform=darwin",
    `--arch=${arch}`,
    `--out=${outDir}`,
    "--overwrite",
    `--executable-name=${macExecutableName({ appName, distribution, releaseTrack })}`,
    `--app-version=${version}`,
    `--app-bundle-id=${bundleId}`,
    ...OPENGLANCE_SUPPORTED_PROTOCOLS.flatMap((protocol) => [
      `--protocol=${protocol}`,
      "--protocol-name=OpenGlance Document",
    ]),
    ...(iconPath ? [`--icon=${iconPath}`] : []),
    ...(electronZipDir ? [`--electron-zip-dir=${electronZipDir}`] : []),
    ...RELEASE_PACKAGE_IGNORE_PATTERNS.map((pattern) => `--ignore=${pattern}`),
  ];
}

function installedElectronVersion({ rootDir = REPO_ROOT } = {}) {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(rootDir, "node_modules", "electron", "package.json"), "utf8"),
    );
    return packageJson.version;
  } catch {
    return undefined;
  }
}

export function electronCacheZipDir({
  homeDir = homedir(),
  version = installedElectronVersion(),
  platform = "darwin",
  arch = "arm64",
  exists = existsSync,
  listDir = readdirSync,
} = {}) {
  if (!version) {
    return undefined;
  }

  const cacheRoot = path.join(homeDir, "Library", "Caches", "electron");
  let cacheEntries;
  try {
    cacheEntries = listDir(cacheRoot);
  } catch {
    return undefined;
  }

  for (const entry of cacheEntries) {
    const entryName = typeof entry === "string" ? entry : entry.name;
    const zipDir = path.join(cacheRoot, entryName);
    const zipPath = path.join(zipDir, `electron-v${version}-${platform}-${arch}.zip`);
    if (exists(zipPath)) {
      return zipDir;
    }
  }

  return undefined;
}

export function macReleasePaths({
  rootDir = REPO_ROOT,
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  arch = DEFAULT_RELEASE_OPTIONS.arch,
  version = DEFAULT_RELEASE_OPTIONS.version,
  releaseTrack = DEFAULT_RELEASE_OPTIONS.releaseTrack,
  buildId = DEFAULT_RELEASE_OPTIONS.buildId,
} = {}) {
  const distDir = path.join(rootDir, "dist");
  const platformKey = `darwin-${arch}`;
  const appRoot = path.join(distDir, `${appName}-${platformKey}`);
  return {
    distDir,
    appRoot,
    appDir: path.join(appRoot, `${appName}.app`),
    dmgPath: path.join(
      distDir,
      releaseArtifactFileName({ version, releaseTrack, platformKey, extension: "dmg" }),
    ),
    zipPath: path.join(
      distDir,
      releaseArtifactFileName({ version, releaseTrack, platformKey, extension: "zip" }),
    ),
  };
}

export function macDevelopmentInstallPaths({
  rootDir = REPO_ROOT,
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  arch = DEFAULT_RELEASE_OPTIONS.arch,
  version = DEFAULT_RELEASE_OPTIONS.version,
  releaseTrack = DEFAULT_RELEASE_OPTIONS.releaseTrack,
  buildId = DEFAULT_RELEASE_OPTIONS.buildId,
  applicationsDir = DEFAULT_RELEASE_OPTIONS.applicationsDir,
  exists = existsSync,
} = {}) {
  const canonicalInstalledAppDir = path.join(applicationsDir, `${appName}.app`);
  const gitLeafInstalledAppDir = path.join(applicationsDir, `${GIT_LEAF_MAC_APP_NAME}.app`);
  const installedAppDir = canonicalInstalledAppDir;
  return {
    ...macReleasePaths({ rootDir, appName, arch, version, releaseTrack, buildId }),
    applicationsDir,
    canonicalInstalledAppDir,
    gitLeafInstalledAppDir,
    legacyInstalledAppDirs: [gitLeafInstalledAppDir],
    // Compatibility alias for integrations that still mean the Git Leaf 1.x path.
    legacyInstalledAppDir: gitLeafInstalledAppDir,
    installedAppDir,
  };
}

export function macDevelopmentInstallOptions(options = {}) {
  return {
    ...options,
    ...(options.smoke ? {
      applicationsDir: path.join(options.devUserDataDir || DEFAULT_SMOKE_USER_DATA_DIR, "Applications"),
    } : {}),
    dev: true,
  };
}

export function macDevelopmentUserDataPaths({
  homeDir = homedir(),
  productionUserDataDir = path.join(homeDir, "Library", "Application Support", "git-leaf"),
  devUserDataDir = path.join(homeDir, "Library", "Application Support", "git-leaf-dev"),
} = {}) {
  return {
    productionUserDataDir: path.resolve(productionUserDataDir),
    devUserDataDir: path.resolve(devUserDataDir),
  };
}

export function assertDevelopmentUserDataIsolation({ productionUserDataDir, devUserDataDir }) {
  const productionIdentity = pathIdentity(productionUserDataDir);
  const devIdentity = pathIdentity(devUserDataDir, { rejectSymlink: true });
  try {
    assertPathIdentitiesDoNotOverlap({
      requestedIdentity: devIdentity,
      protectedIdentity: productionIdentity,
    });
  } catch {
    throw new Error(
      `Development user data must be isolated from the production profile: ${devIdentity.logicalPath}`,
    );
  }
  return {
    productionUserDataDir: productionIdentity.logicalPath,
    devUserDataDir: devIdentity.logicalPath,
    productionPhysicalUserDataDir: productionIdentity.physicalPath,
    devPhysicalUserDataDir: devIdentity.physicalPath,
  };
}

export function developmentProfileFingerprint({
  productionUserDataDir,
  entries = DEVELOPMENT_PROFILE_COPY_ENTRIES,
} = {}) {
  const hash = createHash("sha256");
  let fileCount = 0;
  for (const entry of entries) {
    const entryPath = path.join(productionUserDataDir, entry);
    for (const filePath of developmentProfileFiles(entryPath)) {
      const relativePath = path.relative(productionUserDataDir, filePath);
      hash.update(relativePath);
      hash.update("\0");
      hash.update(readFileSync(filePath));
      hash.update("\0");
      fileCount += 1;
    }
  }
  return {
    sha256: hash.digest("hex"),
    fileCount,
  };
}

function developmentProfileFiles(entryPath) {
  let entryStat;
  try {
    entryStat = lstatSync(entryPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
  if (entryStat.isSymbolicLink()) {
    throw new Error(`Development profile snapshots cannot contain symbolic links: ${entryPath}`);
  }
  if (!entryStat.isDirectory()) {
    return [entryPath];
  }
  return readdirSync(entryPath)
    .sort()
    .flatMap((entry) => developmentProfileFiles(path.join(entryPath, entry)));
}

function assertDevelopmentSnapshotSource(isolatedPaths, sourceUserDataDir) {
  const sourceIdentity = pathIdentity(sourceUserDataDir, { rejectSymlink: true });
  const devIdentity = pathIdentity(isolatedPaths.devUserDataDir, { rejectSymlink: true });
  try {
    assertPathIdentitiesDoNotOverlap({
      requestedIdentity: devIdentity,
      protectedIdentity: sourceIdentity,
    });
  } catch {
    throw new Error(
      `Development snapshot source must be isolated from its target: ${sourceIdentity.logicalPath}`,
    );
  }
  return sourceIdentity;
}

function readDevelopmentProfileMarker(isolatedPaths) {
  const markerPath = path.join(isolatedPaths.devUserDataDir, DEVELOPMENT_PROFILE_MARKER);
  if (!existsSync(markerPath)) {
    throw new Error(`Missing development profile marker: ${markerPath}`);
  }
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid development profile marker: ${markerPath}`, { cause: error });
  }
  const schemaVersion = marker?.schemaVersion;
  if (
    marker?.kind !== DEVELOPMENT_PROFILE_MARKER_KIND
    || (schemaVersion !== 1 && schemaVersion !== DEVELOPMENT_PROFILE_MARKER_SCHEMA_VERSION)
    || path.resolve(marker?.devUserDataDir || "") !== isolatedPaths.devUserDataDir
    || marker?.devPhysicalUserDataDir !== isolatedPaths.devPhysicalUserDataDir
  ) {
    throw new Error(`Development profile marker does not match its target: ${markerPath}`);
  }

  if (schemaVersion === 1) {
    if (
      path.resolve(marker?.sourceUserDataDir || "") !== isolatedPaths.productionUserDataDir
      || marker?.sourcePhysicalUserDataDir !== isolatedPaths.productionPhysicalUserDataDir
    ) {
      throw new Error(`Development profile marker does not match its source: ${markerPath}`);
    }
    return {
      ...marker,
      productionUserDataDir: isolatedPaths.productionUserDataDir,
      productionPhysicalUserDataDir: isolatedPaths.productionPhysicalUserDataDir,
      productionFingerprint: marker.sourceFingerprint,
    };
  }

  if (
    path.resolve(marker?.productionUserDataDir || "") !== isolatedPaths.productionUserDataDir
    || marker?.productionPhysicalUserDataDir !== isolatedPaths.productionPhysicalUserDataDir
  ) {
    throw new Error(`Development profile marker does not match its production profile: ${markerPath}`);
  }
  const sourceIdentity = assertDevelopmentSnapshotSource(
    isolatedPaths,
    marker?.sourceUserDataDir || "",
  );
  if (marker?.sourcePhysicalUserDataDir !== sourceIdentity.physicalPath) {
    throw new Error(`Development profile marker does not match its snapshot source: ${markerPath}`);
  }
  return marker;
}

function developmentProfileMarker({
  isolatedPaths,
  sourceIdentity,
  profileMode,
  sourceFingerprint,
  productionFingerprint,
  copiedFingerprint,
  copiedEntries,
}) {
  return {
    kind: DEVELOPMENT_PROFILE_MARKER_KIND,
    schemaVersion: DEVELOPMENT_PROFILE_MARKER_SCHEMA_VERSION,
    profileMode,
    sourceUserDataDir: sourceIdentity.logicalPath,
    devUserDataDir: isolatedPaths.devUserDataDir,
    productionUserDataDir: isolatedPaths.productionUserDataDir,
    sourcePhysicalUserDataDir: sourceIdentity.physicalPath,
    devPhysicalUserDataDir: isolatedPaths.devPhysicalUserDataDir,
    productionPhysicalUserDataDir: isolatedPaths.productionPhysicalUserDataDir,
    sourceFingerprint,
    productionFingerprint,
    copiedFingerprint,
    copiedEntries,
  };
}

function writeDevelopmentProfileMarker(userDataDir, marker) {
  const markerPath = path.join(userDataDir, DEVELOPMENT_PROFILE_MARKER);
  const pendingPath = `${markerPath}.pending-${process.pid}-${Date.now()}`;
  try {
    writeJson(pendingPath, marker);
    renameSync(pendingPath, markerPath);
  } finally {
    rmSync(pendingPath, { force: true });
  }
}

function strictDescendant(parentPath, childPath) {
  return parentPath !== childPath && pathsOverlap(parentPath, childPath);
}

export function prepareDevelopmentUserData(paths, {
  profileMode = "smoke",
  copyEntry = (sourcePath, destinationPath) => cpSync(
    sourcePath,
    destinationPath,
    { recursive: true, force: true },
  ),
  rename = renameSync,
} = {}) {
  if (profileMode !== "smoke") {
    throw new Error(`Only one-time Agent smoke profiles may be prepared: ${profileMode}`);
  }

  const isolatedPaths = assertDevelopmentUserDataIsolation(paths);
  const devParentDir = path.dirname(isolatedPaths.devUserDataDir);
  const devBaseName = path.basename(isolatedPaths.devUserDataDir);
  mkdirSync(devParentDir, { recursive: true });
  assertDevelopmentUserDataIsolation(isolatedPaths);

  const sourceIdentity = assertDevelopmentSnapshotSource(
    isolatedPaths,
    isolatedPaths.productionUserDataDir,
  );
  const sourceFingerprint = developmentProfileFingerprint({
    productionUserDataDir: sourceIdentity.logicalPath,
  });
  const productionFingerprint = developmentProfileFingerprint(isolatedPaths);
  const stagingDir = mkdtempSync(path.join(devParentDir, `.${devBaseName}.staging-`));
  let pendingStagingDir = stagingDir;
  let backupDir = null;
  let existingProfileMoved = false;
  const copiedEntries = [];

  try {
    assertDevelopmentUserDataIsolation({
      productionUserDataDir: isolatedPaths.productionUserDataDir,
      devUserDataDir: stagingDir,
    });
    for (const entry of DEVELOPMENT_PROFILE_COPY_ENTRIES) {
      const sourcePath = path.join(sourceIdentity.logicalPath, entry);
      const destinationPath = path.join(stagingDir, entry);
      if (!existsSync(sourcePath)) {
        continue;
      }
      copyEntry(sourcePath, destinationPath);
      copiedEntries.push(entry);
    }

    const copiedFingerprint = developmentProfileFingerprint({
      productionUserDataDir: stagingDir,
    });
    const sourceFingerprintAfterCopy = developmentProfileFingerprint({
      productionUserDataDir: sourceIdentity.logicalPath,
    });
    const productionFingerprintAfterCopy = developmentProfileFingerprint(isolatedPaths);
    if (
      copiedFingerprint.sha256 !== sourceFingerprint.sha256
      || sourceFingerprintAfterCopy.sha256 !== sourceFingerprint.sha256
    ) {
      throw new Error("Development profile snapshot does not match its read-only source.");
    }
    if (productionFingerprintAfterCopy.sha256 !== productionFingerprint.sha256) {
      throw new Error("Production profile changed while preparing development user data.");
    }

    writeDevelopmentProfileMarker(stagingDir, developmentProfileMarker({
      isolatedPaths,
      sourceIdentity,
      profileMode,
      sourceFingerprint,
      productionFingerprint,
      copiedFingerprint,
      copiedEntries,
    }));

    assertDevelopmentUserDataIsolation(isolatedPaths);
    if (existsSync(isolatedPaths.devUserDataDir)) {
      backupDir = mkdtempSync(path.join(devParentDir, `.${devBaseName}.previous-`));
      rmSync(backupDir, { recursive: true, force: true });
      rename(isolatedPaths.devUserDataDir, backupDir);
      existingProfileMoved = true;
    }

    try {
      rename(stagingDir, isolatedPaths.devUserDataDir);
      pendingStagingDir = null;
    } catch (error) {
      if (existingProfileMoved) {
        try {
          rename(backupDir, isolatedPaths.devUserDataDir);
          existingProfileMoved = false;
          backupDir = null;
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Development profile swap failed and the previous profile could not be restored.",
          );
        }
      }
      throw error;
    }

    if (existingProfileMoved && backupDir) {
      try {
        rmSync(backupDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Could not remove previous development profile backup: ${error.message}`);
      }
    }

    console.log(`Agent smoke profile: ${isolatedPaths.devUserDataDir}`);
    console.log(`Real profile snapshot source is read-only: ${sourceIdentity.logicalPath}`);
    return {
      ...isolatedPaths,
      sourceUserDataDir: sourceIdentity.logicalPath,
      copiedEntries,
      sourceFingerprint,
      productionFingerprint,
      profileMode,
      reused: false,
    };
  } finally {
    if (pendingStagingDir) {
      rmSync(pendingStagingDir, { recursive: true, force: true });
    }
  }
}

export function cleanupDevelopmentSmokeUserData(paths, {
  temporaryRoot = tmpdir(),
  verifiedProductionFingerprint,
  remove = rmSync,
} = {}) {
  const isolatedPaths = assertDevelopmentSmokeUserDataPath(paths, { temporaryRoot });
  let devStat;
  try {
    devStat = lstatSync(isolatedPaths.devUserDataDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { cleaned: false, reason: "missing" };
    }
    throw error;
  }
  if (!devStat.isDirectory()) {
    throw new Error(`Development smoke profile is not a directory: ${isolatedPaths.devUserDataDir}`);
  }

  const devIdentity = pathIdentity(isolatedPaths.devUserDataDir, { rejectSymlink: true });
  const marker = readDevelopmentProfileMarker(isolatedPaths);
  if (marker.profileMode !== "smoke") {
    throw new Error(`Refusing to clean a non-smoke development profile: ${devIdentity.logicalPath}`);
  }
  const verifiedProduction = verifiedProductionFingerprint?.productionFingerprint
    || verifiedProductionFingerprint;
  const verifiedSource = verifiedProductionFingerprint?.sourceFingerprint
    || verifiedProductionFingerprint;
  if (
    !verifiedProduction?.sha256
    || verifiedProduction.sha256 !== marker.productionFingerprint?.sha256
    || !verifiedSource?.sha256
    || verifiedSource.sha256 !== marker.sourceFingerprint?.sha256
  ) {
    throw new Error("Smoke profile cleanup requires successful source-profile verification.");
  }
  const currentProductionFingerprint = developmentProfileFingerprint(isolatedPaths);
  if (currentProductionFingerprint.sha256 !== verifiedProduction.sha256) {
    throw new Error(
      `Production profile changed after verification; preserving smoke profile: ${devIdentity.logicalPath}`,
    );
  }
  const currentSourceFingerprint = developmentProfileFingerprint({
    productionUserDataDir: marker.sourceUserDataDir,
  });
  if (currentSourceFingerprint.sha256 !== verifiedSource.sha256) {
    throw new Error(
      `Development snapshot source changed after verification; preserving smoke profile: ${devIdentity.logicalPath}`,
    );
  }

  remove(devIdentity.logicalPath, { recursive: true, force: false });
  console.log(`Removed one-time development smoke profile: ${devIdentity.logicalPath}`);
  return { cleaned: true, userDataDir: devIdentity.logicalPath };
}

export function assertDevelopmentSmokeUserDataPath(paths, {
  temporaryRoot = tmpdir(),
} = {}) {
  const isolatedPaths = assertDevelopmentUserDataIsolation(paths);
  const temporaryIdentity = pathIdentity(temporaryRoot);
  const devIdentity = pathIdentity(isolatedPaths.devUserDataDir, { rejectSymlink: true });
  if (
    !strictDescendant(temporaryIdentity.logicalPath, devIdentity.logicalPath)
    || !strictDescendant(temporaryIdentity.physicalPath, devIdentity.physicalPath)
  ) {
    throw new Error(
      `Development smoke user data must be a strict child of the temporary directory: ${devIdentity.logicalPath}`,
    );
  }
  return isolatedPaths;
}

export function verifyProductionProfileUnchanged(paths) {
  const isolatedPaths = assertDevelopmentUserDataIsolation(paths);
  const marker = readDevelopmentProfileMarker(isolatedPaths);
  const productionFingerprint = developmentProfileFingerprint(isolatedPaths);
  if (productionFingerprint.sha256 !== marker.productionFingerprint?.sha256) {
    throw new Error(
      `Production profile changed during development smoke: ${isolatedPaths.productionUserDataDir}`,
    );
  }
  const sourceFingerprint = developmentProfileFingerprint({
    productionUserDataDir: marker.sourceUserDataDir,
  });
  if (sourceFingerprint.sha256 !== marker.sourceFingerprint?.sha256) {
    throw new Error(
      `Development snapshot source changed during smoke: ${marker.sourceUserDataDir}`,
    );
  }
  console.log(
    `Verified production profile unchanged (${productionFingerprint.fileCount} files, ${productionFingerprint.sha256}).`,
  );
  if (marker.sourceUserDataDir !== isolatedPaths.productionUserDataDir) {
    console.log(
      `Verified development snapshot source unchanged (${sourceFingerprint.fileCount} files, ${sourceFingerprint.sha256}).`,
    );
  }
  return { productionFingerprint, sourceFingerprint };
}

export function macUpdateMetadataPaths({
  rootDir = REPO_ROOT,
  channel = DEFAULT_RELEASE_OPTIONS.updateChannel,
  platformKey = "darwin-universal",
} = {}) {
  const updateDir = path.join(
    rootDir,
    "dist",
    "updates",
    ...updateMetadataRelativeDir({ channel, platformKey }).split("/"),
  );
  return {
    updateDir,
    latestJsonPath: path.join(updateDir, "latest.json"),
    releasesJsonPath: path.join(updateDir, "releases.json"),
    sha256Path: path.join(updateDir, "sha256sums.txt"),
  };
}

export function macDmgLayoutPaths(paths, {
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  locale = DEFAULT_RELEASE_OPTIONS.dmgLocale,
} = {}) {
  const baseName = `${appName}-dmg`;
  return {
    stageDir: path.join(paths.distDir, `${baseName}-stage`),
    readWriteDmgPath: path.join(paths.distDir, `${baseName}.rw.dmg`),
    mountPoint: path.join(paths.distDir, `${baseName}-mount`),
    stagedAppPath: path.join(paths.distDir, `${baseName}-stage`, `${appName}.app`),
    backgroundSvgPath: path.join(paths.distDir, `${baseName}-stage`, ".background", "background.svg"),
    backgroundPngPath: path.join(paths.distDir, `${baseName}-stage`, ".background", "background.png"),
  };
}

export function dmgStagingVolumeName({
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  processId = process.pid,
} = {}) {
  return `${appName} Installer ${processId}`;
}

export function dmgLocaleFromValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/^(zh|zh_|zh-|chinese)(_|-|$)/.test(normalized) || normalized.includes("zh-hans")) {
    return "zh-Hans";
  }
  return "en";
}

export function dmgTextForLocale({
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  locale = DEFAULT_RELEASE_OPTIONS.dmgLocale,
} = {}) {
  if (dmgLocaleFromValue(locale) === "zh-Hans") {
    return {
      title: `安装 ${appName}`,
      instruction: `将 ${appName}.app 拖到“应用程序”`,
      applicationsLabel: "应用程序",
    };
  }
  return {
    title: `Install ${appName}`,
    instruction: `Drag ${appName}.app to Applications`,
    applicationsLabel: "Applications",
  };
}

export function dmgBackgroundSvg({
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  locale = DEFAULT_RELEASE_OPTIONS.dmgLocale,
} = {}) {
  const text = dmgTextForLocale({ appName, locale });
  const title = escapeXml(text.title);
  const instruction = escapeXml(text.instruction);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="360" viewBox="0 0 560 360">
  <rect width="560" height="360" fill="#f7f7f7"/>
  <text x="280" y="54" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif" font-size="25" font-weight="700" fill="#1f2328">${title}</text>
  <line x1="224" y1="176" x2="336" y2="176" stroke="#88929f" stroke-width="4" stroke-linecap="round"/>
  <path d="M336 176 L318 164 L318 188 Z" fill="#88929f"/>
  <text x="280" y="286" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif" font-size="18" font-weight="600" fill="#3f4752">${instruction}</text>
</svg>
`;
}

export function dmgFinderLayoutScript({
  appName = DEFAULT_RELEASE_OPTIONS.appName,
  locale = DEFAULT_RELEASE_OPTIONS.dmgLocale,
  mountPoint,
  backgroundPngPath,
} = {}) {
  const backgroundPictureLine = backgroundPngPath
    ? `set background picture of viewOptions to (POSIX file ${appleScriptString(backgroundPngPath)} as alias)`
    : 'set background picture of viewOptions to (file ".background:background.png" as alias)';
  return [
    'tell application "Finder"',
    `set applicationsFolder to folder ${appleScriptString(APPLICATIONS_SHORTCUT_NAME)} of startup disk`,
    `set targetFolder to POSIX file ${appleScriptString(mountPoint)} as alias`,
    "open targetFolder",
    `if not (exists item ${appleScriptString(APPLICATIONS_SHORTCUT_NAME)} of targetFolder) then`,
    `make new alias file at targetFolder to applicationsFolder with properties {name:${appleScriptString(APPLICATIONS_SHORTCUT_NAME)}}`,
    "end if",
    "set targetWindow to container window of targetFolder",
    "set current view of targetWindow to icon view",
    "set toolbar visible of targetWindow to false",
    "set statusbar visible of targetWindow to false",
    "set the bounds of targetWindow to {100, 100, 660, 460}",
    "set viewOptions to the icon view options of targetWindow",
    "set arrangement of viewOptions to not arranged",
    "set icon size of viewOptions to 96",
    "set text size of viewOptions to 13",
    backgroundPictureLine,
    "repeat with attempt from 1 to 20",
    `if (exists item ${appleScriptString(`${appName}.app`)} of targetFolder) and (exists item ${appleScriptString(APPLICATIONS_SHORTCUT_NAME)} of targetFolder) then exit repeat`,
    "delay 0.25",
    "end repeat",
    `set position of item ${appleScriptString(`${appName}.app`)} of targetFolder to {150, 190}`,
    `set position of item ${appleScriptString(APPLICATIONS_SHORTCUT_NAME)} of targetFolder to {410, 190}`,
    "update targetFolder without registering applications",
    "delay 1",
    "close targetWindow",
    "end tell",
  ];
}

export function macBundleIconPaths({
  rootDir = REPO_ROOT,
  appDir,
  iconPath = DEFAULT_RELEASE_OPTIONS.iconPath,
} = {}) {
  const iconExtension = path.extname(iconPath);
  const sourceIconPath = path.resolve(
    rootDir,
    iconExtension === ".icns" ? iconPath : `${iconPath}.icns`,
  );
  const bundleIconFile = path.basename(sourceIconPath);
  return {
    sourceIconPath,
    bundleIconFile,
    bundleIconPath: path.join(appDir, "Contents", "Resources", bundleIconFile),
    infoPlistPath: path.join(appDir, "Contents", "Info.plist"),
  };
}

export function macEntitlementsPath({
  rootDir = REPO_ROOT,
  entitlementsPath = DEFAULT_RELEASE_OPTIONS.entitlementsPath,
} = {}) {
  return path.resolve(rootDir, entitlementsPath);
}

export function macCommandRequiresNewReleaseVersion(command, { dev = false } = {}) {
  return dev !== true && macCommandsRequiringNewReleaseVersion.has(command);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function detectedDmgLocale() {
  if (process.env.DMG_LOCALE) {
    return process.env.DMG_LOCALE;
  }
  try {
    const appleLocale = output("defaults", ["read", "-g", "AppleLocale"]).trim();
    if (appleLocale) {
      return appleLocale;
    }
  } catch {
    // Fall back to POSIX locale variables when macOS user defaults are unavailable.
  }
  return process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || DEFAULT_RELEASE_OPTIONS.dmgLocale;
}

export function nestedMachOSigningTargets(appDir) {
  return [
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib",
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib",
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libGLESv2.dylib",
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib",
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler",
    "Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt",
  ].map((target) => path.join(appDir, target));
}

function frameworkSigningTargets(appDir) {
  return [
    "Contents/Frameworks/Electron Framework.framework",
    "Contents/Frameworks/ReactiveObjC.framework",
    "Contents/Frameworks/Squirrel.framework",
    "Contents/Frameworks/Mantle.framework",
  ].map((target) => path.join(appDir, target));
}

function helperAppSigningTargets(appDir) {
  return [
    "Contents/Frameworks/OpenGlance Helper.app",
    "Contents/Frameworks/OpenGlance Helper (Plugin).app",
    "Contents/Frameworks/OpenGlance Helper (Renderer).app",
    "Contents/Frameworks/OpenGlance Helper (GPU).app",
  ].map((target) => path.join(appDir, target));
}

function releaseOptionsFromEnv() {
  const profile = releaseProfileFromEnv();
  const buildInfo = releaseBuildInfoFromEnv({
    rootDir: REPO_ROOT,
    fallbackVersion: DEFAULT_RELEASE_OPTIONS.version,
  });
  const packageIdentity = releasePackageIdentity(buildInfo);
  return {
    ...DEFAULT_RELEASE_OPTIONS,
    ...buildInfo,
    bundleId: packageIdentity.macBundleId,
    identity:
      process.env.DEVELOPER_ID_APPLICATION
      || profile.developerIdApplication
      || DEFAULT_RELEASE_OPTIONS.identity,
    notaryProfile:
      process.env.NOTARY_PROFILE
      || profile.notaryProfile
      || DEFAULT_RELEASE_OPTIONS.notaryProfile,
    applicationsDir: process.env.APPLICATIONS_DIR || DEFAULT_RELEASE_OPTIONS.applicationsDir,
    iconPath: process.env.ICON_PATH || DEFAULT_RELEASE_OPTIONS.iconPath,
    entitlementsPath: process.env.ENTITLEMENTS_PATH || DEFAULT_RELEASE_OPTIONS.entitlementsPath,
    updateBaseUrl:
      process.env.UPDATE_BASE_URL
      || profile.updateBaseUrl
      || DEFAULT_RELEASE_OPTIONS.updateBaseUrl,
    updateChannel:
      releaseUpdateChannel({
        releaseTrack: buildInfo.releaseTrack,
        override: process.env.UPDATE_CHANNEL,
      }),
    updateRemoteHost:
      process.env.UPDATE_REMOTE_HOST
      || profile.updateRemoteHost
      || DEFAULT_RELEASE_OPTIONS.updateRemoteHost,
    updateRemoteRoot:
      process.env.UPDATE_REMOTE_ROOT
      || profile.updateRemoteRoot
      || DEFAULT_RELEASE_OPTIONS.updateRemoteRoot,
    dmgLocale: detectedDmgLocale(),
    electronZipDir: process.env.ELECTRON_ZIP_DIR || undefined,
    devUserDataDir: openGlanceEnvironmentValue(process.env, "DEV_USER_DATA_DIR") || undefined,
    smokeUserDataDir:
      openGlanceEnvironmentValue(process.env, "SMOKE_USER_DATA_DIR")
      || DEFAULT_SMOKE_USER_DATA_DIR,
    smokeRepoRoot: openGlanceEnvironmentValue(process.env, "SMOKE_REPO_ROOT") || "",
    smokeFile: openGlanceEnvironmentValue(process.env, "SMOKE_FILE") || "",
    smokeRemoteDebuggingPort:
      openGlanceEnvironmentValue(process.env, "SMOKE_REMOTE_DEBUGGING_PORT") || "",
    formalRelease: openGlanceEnvironmentFlag(process.env, "FORMAL_RELEASE"),
  };
}

function run(command, args, { cwd = REPO_ROOT } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runOptional(command, args, { cwd = REPO_ROOT } = {}) {
  spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

function output(command, args, { cwd = REPO_ROOT } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: ${command} ${args.join(" ")}`);
  }
  return result.stdout;
}

function requirePath(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected release path is missing: ${filePath}`);
  }
}

function signingKeychainRecoveryGuidance() {
  return "Unlock the approved Keychain that actually holds the release private key, then rerun "
    + "`run mac check-prereqs`. If this machine uses the standard login Keychain, run "
    + "`security unlock-keychain ~/Library/Keychains/login.keychain-db` in the maintainer's own "
    + "terminal and enter the password only at the local prompt; if it uses another approved "
    + "Keychain, unlock that Keychain instead. Never pass the password with `-p`, place it in a "
    + "release profile, log, or chat, or reset the default Keychain. The release controller will "
    + "not collect credentials, unlock, or rewrite Keychain state.";
}

export function ensureReleaseSigningIdentityAccess({
  identity,
  probeSource = "/usr/bin/true",
  temporaryRoot = tmpdir(),
  runCommand = spawnSync,
} = {}) {
  if (!String(identity || "").trim()) {
    throw new Error("A Developer ID signing identity is required.");
  }

  const commandOptions = {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  };
  const identities = runCommand(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    commandOptions,
  );
  if (identities.status !== 0) {
    const details = String(
      identities.stderr || identities.stdout || identities.error?.message || "unknown security error",
    ).trim();
    throw new Error(
      `Unable to inspect Developer ID signing identities: ${details}. `
      + signingKeychainRecoveryGuidance(),
    );
  }
  if (!String(identities.stdout || "").includes(`"${identity}"`)) {
    throw new Error(
      `Developer ID identity not found in the active Keychain search list: ${identity}. `
      + signingKeychainRecoveryGuidance(),
    );
  }

  const probeDir = mkdtempSync(path.join(temporaryRoot, "openglance-release-signing-"));
  const probePath = path.join(probeDir, "codesign-probe");
  try {
    copyFileSync(probeSource, probePath);
    const sign = runCommand(
      "codesign",
      ["--force", "--sign", identity, probePath],
      commandOptions,
    );
    if (sign.status !== 0) {
      const details = String(
        sign.stderr || sign.stdout || sign.error?.message || "unknown codesign error",
      ).trim();
      throw new Error(
        `The Developer ID identity exists, but its private key could not sign a temporary probe: ${details}. `
        + signingKeychainRecoveryGuidance(),
      );
    }

    const verify = runCommand(
      "codesign",
      ["--verify", "--strict", "--verbose=2", probePath],
      commandOptions,
    );
    if (verify.status !== 0) {
      const details = String(
        verify.stderr || verify.stdout || verify.error?.message || "unknown codesign verification error",
      ).trim();
      throw new Error(`The temporary Developer ID signature could not be verified: ${details}`);
    }
    return { identity, probeVerified: true };
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function checkPrereqs(options) {
  requireReleaseSetting(options.identity, "developerIdApplication");
  requireReleaseSetting(options.notaryProfile, "notaryProfile");
  ensureReleaseSigningIdentityAccess({ identity: options.identity });

  run("xcrun", [
    "notarytool",
    "history",
    "--keychain-profile",
    options.notaryProfile,
  ]);
}

function checkReleaseVersion(options) {
  assertReleaseVersionIsNew({
    rootDir: REPO_ROOT,
    version: options.version,
  });
}

function packageMac(options) {
  const packager = electronPackagerCommand({ rootDir: REPO_ROOT });
  requirePath(packager.args[0]);
  withReleaseBuildInfoFile({ rootDir: REPO_ROOT, buildInfo: options }, () => {
    run(packager.command, [...packager.args, ...electronPackagerArgs(options)]);
  });
  patchSquirrelMacPolicy({
    appDir: macReleasePaths(options).appDir,
    rootDir: REPO_ROOT,
  });
  applyMacBundleIcon(options, macDevelopmentInstallPaths(options));
  applyMacBundleProductName(options, macDevelopmentInstallPaths(options));
  applyMacBundleProtocols(macDevelopmentInstallPaths(options));
  if (options.distribution === "source") {
    signMacAppAdHoc({ appDir: macReleasePaths(options).appDir });
  }
  verifySquirrelMacPolicy({
    appDir: macReleasePaths(options).appDir,
  });
}

export function signMacAppAdHoc({ appDir } = {}) {
  requirePath(appDir);
  run("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--timestamp=none",
    appDir,
  ]);
  run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appDir,
  ]);
  return true;
}

export function applyMacBundleIcon(options, paths) {
  const icon = macBundleIconPaths({
    appDir: paths.appDir,
    iconPath: options.iconPath,
  });
  requirePath(icon.sourceIconPath);
  requirePath(icon.infoPlistPath);
  copyFileSync(icon.sourceIconPath, icon.bundleIconPath);
  run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleIconFile ${icon.bundleIconFile}`,
    icon.infoPlistPath,
  ]);
  touchMacAppBundle(paths.appDir);
}

export function applyMacBundleProductName(options, paths) {
  const appName = String(options?.appName || "").trim();
  const infoPlistPath = path.join(paths.appDir, "Contents", "Info.plist");
  if (!appName) {
    throw new Error("A macOS product name is required.");
  }
  requirePath(infoPlistPath);
  for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
    run("/usr/bin/plutil", [
      "-replace",
      key,
      "-string",
      appName,
      infoPlistPath,
    ]);
  }
  touchMacAppBundle(paths.appDir);
  return appName;
}

export function applyMacBundleProtocols(paths) {
  const infoPlistPath = path.join(paths.appDir, "Contents", "Info.plist");
  requirePath(infoPlistPath);
  const protocolRegistration = [{
    CFBundleURLName: "OpenGlance Document",
    CFBundleURLSchemes: [...OPENGLANCE_SUPPORTED_PROTOCOLS],
  }];
  run("/usr/bin/plutil", [
    "-replace",
    "CFBundleURLTypes",
    "-json",
    JSON.stringify(protocolRegistration),
    infoPlistPath,
  ]);
  touchMacAppBundle(paths.appDir);
  return protocolRegistration;
}

export function touchMacAppBundle(appDir, { now = new Date() } = {}) {
  requirePath(appDir);
  utimesSync(appDir, now, now);
}

export function developmentAppQuitCommands(appName, paths) {
  return uniqueCommands([
    ["osascript", ["-e", `tell application "${appName}" to quit`]],
    ["osascript", ["-e", `tell application "${GIT_LEAF_MAC_APP_NAME}" to quit`]],
    ["pkill", ["-x", appName]],
    ["pkill", ["-x", GIT_LEAF_MAC_APP_NAME]],
    ["pkill", ["-f", paths.installedAppDir]],
    ...legacyMacInstalledAppDirs(paths).map((appDir) => ["pkill", ["-f", appDir]]),
    ["pkill", ["-f", paths.appDir]],
  ]);
}

export function developmentAppForceQuitCommands(appName, paths) {
  return uniqueCommands([
    ["pkill", ["-9", "-x", appName]],
    ["pkill", ["-9", "-x", GIT_LEAF_MAC_APP_NAME]],
    ["pkill", ["-9", "-f", paths.installedAppDir]],
    ...legacyMacInstalledAppDirs(paths).map((appDir) => ["pkill", ["-9", "-f", appDir]]),
    ["pkill", ["-9", "-f", paths.appDir]],
  ]);
}

function quitDevelopmentApp(options, paths) {
  for (const [command, args] of developmentAppQuitCommands(options.appName, paths)) {
    runOptional(command, args);
  }
  if (waitForDevelopmentAppExit(options.appName, paths)) {
    return;
  }

  for (const [command, args] of developmentAppForceQuitCommands(options.appName, paths)) {
    runOptional(command, args);
  }
  if (!waitForDevelopmentAppExit(options.appName, paths)) {
    throw new Error(`Could not quit ${options.appName}; aborting install to avoid leaving a stale app running.`);
  }
}

function installDevelopmentApp(paths) {
  requirePath(paths.appDir);
  mkdirSync(path.dirname(paths.installedAppDir), { recursive: true });
  rmSync(paths.installedAppDir, { recursive: true, force: true });
  run("ditto", [paths.appDir, paths.installedAppDir]);
  for (const legacyAppDir of legacyMacInstalledAppDirs(paths)) {
    rmSync(legacyAppDir, { recursive: true, force: true });
  }
}

function waitForDevelopmentAppExit(appName, paths, {
  timeoutMs = DEV_APP_QUIT_TIMEOUT_MS,
  pollMs = DEV_APP_QUIT_POLL_MS,
} = {}) {
  const startedAt = Date.now();
  let quietPolls = 0;
  do {
    if (!developmentAppIsRunning(appName, paths)) {
      quietPolls += 1;
      if (quietPolls >= 2) {
        return true;
      }
    } else {
      quietPolls = 0;
    }
    sleepSync(pollMs);
  } while (Date.now() - startedAt < timeoutMs);
  return !developmentAppIsRunning(appName, paths);
}

export function developmentAppProcessQueries(appName, paths) {
  return uniqueValues([
    ["-x", appName],
    ["-x", GIT_LEAF_MAC_APP_NAME],
    ["-f", paths.installedAppDir],
    ...legacyMacInstalledAppDirs(paths).map((appDir) => ["-f", appDir]),
    ["-f", paths.appDir],
  ]);
}

function legacyMacInstalledAppDirs(paths) {
  return paths.legacyInstalledAppDirs
    || [paths.gitLeafInstalledAppDir, paths.legacyInstalledAppDir]
      .filter(Boolean);
}

function developmentAppIsRunning(appName, paths) {
  return developmentAppProcessQueries(appName, paths).some((args) => {
    const result = spawnSync("pgrep", args, {
      encoding: "utf8",
    });
    return result.status === 0;
  });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function developmentPackageCleanupPlan(
  paths,
  { lsregisterPath = LSREGISTER_PATH, lsregisterExists = existsSync } = {},
) {
  return {
    unregisterCommand: lsregisterExists(lsregisterPath)
      ? [lsregisterPath, ["-u", paths.appDir]]
      : undefined,
    removeDir: paths.appRoot,
  };
}

function cleanupDevelopmentPackage(paths) {
  const cleanup = developmentPackageCleanupPlan(paths);
  if (cleanup.unregisterCommand) {
    const [command, args] = cleanup.unregisterCommand;
    runOptional(command, args);
  }
  rmSync(cleanup.removeDir, { recursive: true, force: true });
}

function refreshDevelopmentAppIcon(paths) {
  requirePath(paths.installedAppDir);
  run("touch", [paths.installedAppDir]);
  if (existsSync(LSREGISTER_PATH)) {
    run(LSREGISTER_PATH, ["-f", paths.installedAppDir]);
  }
  runOptional("killall", ["Dock"]);
}

function launchDevelopmentApp(options, paths, { wait = false } = {}) {
  const [command, args] = launchDevelopmentAppCommand(paths, {
    userDataDir: options.smoke
      ? macDevelopmentUserDataPaths(options).devUserDataDir
      : "",
    wait,
    repoRoot: options.smoke ? options.smokeRepoRoot : "",
    file: options.smoke ? options.smokeFile : "",
    remoteDebuggingPort: options.smoke ? options.smokeRemoteDebuggingPort : "",
  });
  run(command, args);
}

export function launchDevelopmentAppCommand(paths, {
  userDataDir,
  wait = false,
  repoRoot = "",
  file = "",
  remoteDebuggingPort = "",
} = {}) {
  if (userDataDir && !path.isAbsolute(userDataDir)) {
    throw new Error("An isolated user-data path must be absolute.");
  }
  if (repoRoot && !path.isAbsolute(repoRoot)) {
    throw new Error("A smoke repository must use an absolute path.");
  }
  const hasRemoteDebuggingPort = String(remoteDebuggingPort ?? "").trim() !== "";
  const normalizedRemoteDebuggingPort = !hasRemoteDebuggingPort
    ? 0
    : Number(remoteDebuggingPort);
  if (
    hasRemoteDebuggingPort
    && (
      !userDataDir
      || !Number.isInteger(normalizedRemoteDebuggingPort)
      || normalizedRemoteDebuggingPort < 1024
      || normalizedRemoteDebuggingPort > 65_535
    )
  ) {
    throw new Error(
      "A smoke remote-debugging port requires isolated user data and an integer from 1024 to 65535.",
    );
  }
  const normalizedFile = String(file || "").replaceAll("\\", "/");
  if (
    normalizedFile
    && (
      !repoRoot
      || path.posix.isAbsolute(normalizedFile)
      || normalizedFile === ".."
      || normalizedFile.startsWith("../")
      || normalizedFile.includes("/../")
    )
  ) {
    throw new Error("A smoke document must be a safe repository-relative path.");
  }
  return [
    "open",
    [
      ...(wait ? ["-W"] : []),
      "-n",
      paths.installedAppDir,
      ...(userDataDir ? [
        "--args",
        `${DEVELOPMENT_USER_DATA_ARG}=${path.resolve(userDataDir)}`,
      ] : []),
      ...(normalizedRemoteDebuggingPort ? [
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${normalizedRemoteDebuggingPort}`,
      ] : []),
      ...(repoRoot ? [`--repo=${path.resolve(repoRoot)}`] : []),
      ...(normalizedFile ? [`--file=${normalizedFile}`] : []),
    ],
  ];
}

function uniqueCommands(commands) {
  return commands.filter((command, index) => (
    commands.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(command)) === index
  ));
}

function uniqueValues(values) {
  return uniqueCommands(values);
}

export function codesignArgs(
  filePath,
  identity,
  { hardenedRuntime = true, entitlementsPath } = {},
) {
  const args = ["--force", "--timestamp"];
  if (hardenedRuntime) {
    args.push("--options", "runtime");
  }
  if (hardenedRuntime && entitlementsPath) {
    args.push("--entitlements", entitlementsPath);
  }
  args.push("--sign", identity, filePath);
  return args;
}

function signTarget(filePath, identity, { hardenedRuntime = true, entitlementsPath } = {}) {
  requirePath(filePath);
  const args = codesignArgs(filePath, identity, { hardenedRuntime, entitlementsPath });
  run("codesign", args);
}

function signMac(options, paths) {
  const entitlementsPath = macEntitlementsPath(options);
  requirePath(entitlementsPath);

  for (const target of nestedMachOSigningTargets(paths.appDir)) {
    signTarget(target, options.identity);
  }
  for (const target of frameworkSigningTargets(paths.appDir)) {
    signTarget(target, options.identity);
  }
  for (const target of helperAppSigningTargets(paths.appDir)) {
    signTarget(target, options.identity, { entitlementsPath });
  }

  signTarget(paths.appDir, options.identity, { entitlementsPath });
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", paths.appDir]);
}

function prepareDmgStage(options, paths, layoutPaths) {
  rmSync(layoutPaths.stageDir, { recursive: true, force: true });
  mkdirSync(path.dirname(layoutPaths.backgroundPngPath), { recursive: true });
  run("ditto", [paths.appDir, layoutPaths.stagedAppPath]);
  writeFileSync(layoutPaths.backgroundSvgPath, dmgBackgroundSvg({
    appName: options.appName,
    locale: options.dmgLocale,
  }));
  run("sips", [
    "-s",
    "format",
    "png",
    layoutPaths.backgroundSvgPath,
    "--out",
    layoutPaths.backgroundPngPath,
  ]);
  rmSync(layoutPaths.backgroundSvgPath, { force: true });
}

function configureDmgFinderWindow(options, layoutPaths) {
  const args = dmgFinderLayoutScript({
    appName: options.appName,
    locale: options.dmgLocale,
    mountPoint: layoutPaths.mountPoint,
    backgroundPngPath: path.join(layoutPaths.mountPoint, ".background", "background.png"),
  }).flatMap((line) => ["-e", line]);
  run("osascript", args);
}

function createSignedDmg(options, paths) {
  const layoutPaths = macDmgLayoutPaths(paths, {
    appName: options.appName,
    locale: options.dmgLocale,
  });
  const stagingVolumeName = dmgStagingVolumeName({ appName: options.appName });
  rmSync(paths.dmgPath, { force: true });
  rmSync(layoutPaths.readWriteDmgPath, { force: true });
  rmSync(layoutPaths.mountPoint, { recursive: true, force: true });
  prepareDmgStage(options, paths, layoutPaths);
  run("hdiutil", [
    "create",
    "-volname",
    stagingVolumeName,
    "-srcfolder",
    layoutPaths.stageDir,
    "-ov",
    "-format",
    "UDRW",
    "-fs",
    "HFS+",
    layoutPaths.readWriteDmgPath,
  ]);
  mkdirSync(layoutPaths.mountPoint, { recursive: true });
  let mounted = false;
  try {
    run("hdiutil", [
      "attach",
      layoutPaths.readWriteDmgPath,
      "-mountpoint",
      layoutPaths.mountPoint,
      "-nobrowse",
      "-readwrite",
    ]);
    mounted = true;
    configureDmgFinderWindow(options, layoutPaths);
    run("diskutil", ["renameVolume", layoutPaths.mountPoint, options.appName]);
  } finally {
    if (mounted) {
      runOptional("hdiutil", ["detach", layoutPaths.mountPoint]);
    }
    rmSync(layoutPaths.mountPoint, { recursive: true, force: true });
  }
  run("hdiutil", [
    "convert",
    layoutPaths.readWriteDmgPath,
    "-format",
    "UDZO",
    "-o",
    paths.dmgPath,
  ]);
  rmSync(layoutPaths.readWriteDmgPath, { force: true });
  rmSync(layoutPaths.stageDir, { recursive: true, force: true });
  signTarget(paths.dmgPath, options.identity, { hardenedRuntime: false });
  run("codesign", ["--verify", "--verbose=2", paths.dmgPath]);
}

function notarizeDmg(options, paths) {
  run("xcrun", [
    "notarytool",
    "submit",
    paths.dmgPath,
    "--keychain-profile",
    options.notaryProfile,
    "--wait",
  ]);
}

function stapleRelease(paths) {
  run("xcrun", ["stapler", "staple", paths.dmgPath]);
  run("xcrun", ["stapler", "validate", paths.dmgPath]);
  run("xcrun", ["stapler", "staple", paths.appDir]);
  touchMacAppBundle(paths.appDir);
  run("xcrun", ["stapler", "validate", paths.appDir]);
}

function createZip(paths) {
  rmSync(paths.zipPath, { force: true });
  run("ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    paths.appDir,
    paths.zipPath,
  ]);
}

export function assertMacUpdateArchiveEntries(entries, options = {}) {
  const expectedAppName = `${options.appName || DEFAULT_RELEASE_OPTIONS.appName}.app`;
  const expectedRoot = `${expectedAppName}/`;
  const archiveEntries = entries
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (
    archiveEntries.length === 0
    || archiveEntries.some((entry) => !entry.startsWith(expectedRoot))
  ) {
    throw new Error(`macOS update ZIP must contain only ${expectedAppName}`);
  }
  return expectedRoot;
}

export function stageMacUpdateMetadata(options, paths, { rootDir = REPO_ROOT } = {}) {
  requirePath(paths.dmgPath);
  requirePath(paths.zipPath);

  const universalPaths = macUpdateMetadataPaths({
    rootDir,
    channel: options.updateChannel,
    platformKey: "darwin-universal",
  });
  rmSync(universalPaths.updateDir, { recursive: true, force: true });
  mkdirSync(universalPaths.updateDir, { recursive: true });

  const stagedDmgPath = path.join(universalPaths.updateDir, path.basename(paths.dmgPath));
  const stagedZipPath = path.join(universalPaths.updateDir, path.basename(paths.zipPath));
  copyFileSync(paths.dmgPath, stagedDmgPath);
  copyFileSync(paths.zipPath, stagedZipPath);

  const artifacts = [
    artifactDescriptor("zip", stagedZipPath),
    artifactDescriptor("dmg", stagedDmgPath),
  ];
  const releaseTrack = options.releaseTrack || "source";
  const buildId = releaseBuildId({ buildId: options.buildId, releaseTrack });
  const universalManifest = buildUpdateManifest({
    appName: options.appName,
    baseUrl: options.updateBaseUrl,
    channel: options.updateChannel,
    releaseTrack,
    platformKey: "darwin-universal",
    version: options.version,
    buildId,
    commit: options.commit,
    builtAt: options.builtAt,
    notes: `OpenGlance ${options.version}`,
    artifacts,
  });

  writeUpdateManifests(universalPaths, universalManifest);
  writeFileSync(
    universalPaths.sha256Path,
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.fileName}`).join("\n")}\n`,
    "utf8",
  );

  const arm64MigrationPaths = macUpdateMetadataPaths({
    rootDir,
    channel: options.updateChannel,
    platformKey: "darwin-arm64",
  });
  rmSync(arm64MigrationPaths.updateDir, { recursive: true, force: true });
  mkdirSync(arm64MigrationPaths.updateDir, { recursive: true });
  const arm64MigrationManifest = buildUpdateManifest({
    appName: options.appName,
    baseUrl: options.updateBaseUrl,
    channel: options.updateChannel,
    releaseTrack,
    platformKey: "darwin-arm64",
    artifactPlatformKey: "darwin-universal",
    version: options.version,
    buildId,
    commit: options.commit,
    builtAt: options.builtAt,
    notes: `OpenGlance ${options.version}`,
    artifacts,
  });
  writeUpdateManifests(arm64MigrationPaths, arm64MigrationManifest);

  return { universalPaths, arm64MigrationPaths };
}

function publishMacUpdates(options, paths) {
  requireReleaseSetting(options.updateRemoteHost, "updateRemoteHost");
  requireReleaseSetting(options.updateRemoteRoot, "updateRemoteRoot");
  const { universalPaths, arm64MigrationPaths } = stageMacUpdateMetadata(options, paths);
  publishUpdateDirectory({
    localDir: universalPaths.updateDir,
    remoteHost: options.updateRemoteHost,
    remotePath: updateArtifactRemotePath({
      remoteRoot: options.updateRemoteRoot,
      channel: options.updateChannel,
      platformKey: "darwin-universal",
    }),
  });
  publishUpdateDirectory({
    localDir: arm64MigrationPaths.updateDir,
    remoteHost: options.updateRemoteHost,
    remotePath: updateArtifactRemotePath({
      remoteRoot: options.updateRemoteRoot,
      channel: options.updateChannel,
      platformKey: "darwin-arm64",
    }),
  });
}

function verifyRelease(options, paths) {
  const [architectureCommand, architectureArgs] = universalMachOVerificationCommand(paths.appDir);
  run(architectureCommand, architectureArgs);
  verifySquirrelMacPolicy({ appDir: paths.appDir });
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", paths.appDir]);
  run("codesign", ["--verify", "--verbose=2", paths.dmgPath]);
  run("xcrun", ["stapler", "validate", paths.dmgPath]);
  run("xcrun", ["stapler", "validate", paths.appDir]);
  run("spctl", [
    "-a",
    "-vvv",
    "-t",
    "open",
    "--context",
    "context:primary-signature",
    paths.dmgPath,
  ]);
  run("spctl", ["-a", "-vvv", "-t", "execute", paths.appDir]);
  assertMacUpdateArchiveEntries(
    output("unzip", ["-Z1", paths.zipPath]).split("\n"),
    options,
  );
  run("shasum", ["-a", "256", paths.dmgPath, paths.zipPath]);
}

export function universalMachOVerificationCommand(appDir) {
  return ["bash", [
    "-c",
    `set -euo pipefail
while IFS= read -r -d '' target; do
  if file -b "$target" | grep -q 'Mach-O'; then
    lipo "$target" -verify_arch arm64 x86_64
  fi
done < <(find "$1" -type f -print0)`,
    "verify-git-leaf-universal",
    appDir,
  ]];
}

function artifactDescriptor(kind, filePath) {
  return {
    kind,
    fileName: path.basename(filePath),
    sha256: sha256File(filePath),
    size: statSync(filePath).size,
  };
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeUpdateManifests(paths, manifest) {
  writeJson(paths.latestJsonPath, manifest);
  writeJson(paths.releasesJsonPath, {
    current: manifest.version,
    releases: [manifest],
  });
}

function publishUpdateDirectory({ localDir, remoteHost, remotePath }) {
  const incomingPath = `${remotePath}.incoming-${Date.now()}`;
  const previousPath = `${remotePath}.previous`;
  run("ssh", [
    remoteHost,
    [
      `rm -rf ${shellQuote(incomingPath)}`,
      `mkdir -p ${shellQuote(incomingPath)} ${shellQuote(path.posix.dirname(remotePath))}`,
    ].join(" && "),
  ]);
  run("rsync", ["-az", "--delete", `${localDir}/`, `${remoteHost}:${incomingPath}/`]);
  run("ssh", [
    remoteHost,
    [
      `rm -rf ${shellQuote(previousPath)}`,
      `if [ -d ${shellQuote(remotePath)} ]; then mv ${shellQuote(remotePath)} ${shellQuote(previousPath)}; fi`,
      `mv ${shellQuote(incomingPath)} ${shellQuote(remotePath)}`,
      `rm -rf ${shellQuote(previousPath)}`,
    ].join(" && "),
  ]);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function runTests() {
  run("npm", ["run", "test:ci:mac"]);
}

function ensureReleaseTag(options) {
  const result = ensureReleaseGitTag({
    rootDir: REPO_ROOT,
    version: options.version,
  });
  console.log(`${result.created ? "Created" : "Verified"} release tag ${result.tagName} at ${result.commit}`);
}

function printHelp() {
  console.log(`Usage: node scripts/release-mac.mjs <command>

Commands:
  check-version  Fail if this package version already has a release tag
  check-prereqs  Verify Developer ID identity and notarytool profile
  test           Run shared core tests plus macOS release tests
  package        Build the macOS universal .app with release ignores
  sign           Sign the Electron app for Developer ID distribution
  dmg            Create and sign the distribution DMG
  notarize       Submit the signed DMG to Apple notarization
  staple         Staple notarization tickets to the DMG and loose app
  zip            Create a ZIP from the signed/stapled loose app
  verify         Verify codesign, stapler, Gatekeeper, and checksums
  stage-updates  Stage update metadata and artifacts under dist/updates/
  publish-updates
                 Stage and upload update metadata/artifacts to the configured release host
  tag            Create or verify the git version tag for this release
  release        Run the full release sequence
  quit-dev-app   Quit the local installed development app if it is running
  prepare-dev-user-data
                 Prepare a one-time Agent smoke snapshot from the real profile
  install-dev-app
                 Copy the packaged app into /Applications for local development
  cleanup-dev-package
                 Remove the temporary dist app so macOS only indexes /Applications
  refresh-dev-app-icon
                 Refresh LaunchServices and Dock icon cache for the dev app
  launch-dev-app Launch the local installed app with the real human profile
  dev-install    Install for manual checking with the real human profile
  dev-smoke      Run Agent smoke with an isolated one-time profile

Environment overrides:
  DEVELOPER_ID_APPLICATION
  NOTARY_PROFILE
  VERSION
  GIT_COMMIT
  BUILT_AT
  BUILD_ID
  APPLICATIONS_DIR
  ICON_PATH
  ENTITLEMENTS_PATH
  ELECTRON_VERSION
  ELECTRON_ZIP_DIR
  OPENGLANCE_DEV_USER_DATA_DIR
  OPENGLANCE_SMOKE_USER_DATA_DIR
  OPENGLANCE_SMOKE_REPO_ROOT
  OPENGLANCE_SMOKE_FILE
  OPENGLANCE_SMOKE_REMOTE_DEBUGGING_PORT
  UPDATE_BASE_URL
  UPDATE_CHANNEL
  UPDATE_REMOTE_HOST
  UPDATE_REMOTE_ROOT
`);
}

export function runDevelopmentSmokeWorkflow({
  runStep,
  steps = devSmokeSteps,
  onVerificationFailure = () => {},
} = {}) {
  if (typeof runStep !== "function") {
    throw new Error("Development smoke workflow requires a step runner.");
  }
  const verificationStep = "verify-production-profile";
  const cleanupStep = "cleanup-smoke-user-data";
  const verificationIndex = steps.indexOf(verificationStep);
  const cleanupIndex = steps.indexOf(cleanupStep);
  if (
    steps[0] !== "validate-smoke-user-data"
    || steps.indexOf("package") <= 0
    || verificationIndex < 0
    || cleanupIndex !== verificationIndex + 1
    || cleanupIndex !== steps.length - 1
  ) {
    throw new Error("Development smoke must verify production before cleaning its profile.");
  }

  runStep(steps[0]);

  const errors = [];
  try {
    for (const step of steps.slice(1, verificationIndex)) {
      runStep(step);
    }
  } catch (error) {
    errors.push(error);
  }

  let verifiedProductionFingerprint;
  try {
    verifiedProductionFingerprint = runStep(verificationStep);
  } catch (error) {
    errors.push(error);
    onVerificationFailure(error);
  }

  if (verifiedProductionFingerprint) {
    try {
      runStep(cleanupStep, { verifiedProductionFingerprint });
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `Development smoke failed: ${errors.map((error) => error?.message || String(error)).join("; ")}`,
    );
  }
}

export function runReleaseCommand(command, options = releaseOptionsFromEnv()) {
  const paths = macDevelopmentInstallPaths(options);
  if (
    macCommandsRequiringOfficialProfile.has(command)
    || (
      command === "package"
      && (options.formalRelease === true || options.distribution === "official")
    )
  ) {
    assertOfficialReleaseProfile(options);
  }
  if (macCommandRequiresNewReleaseVersion(command, options)) {
    checkReleaseVersion(options);
  }

  switch (command) {
    case "check-version":
      return checkReleaseVersion(options);
    case "check-prereqs":
      return checkPrereqs(options);
    case "test":
      return runTests();
    case "package":
      return packageMac(options);
    case "sign":
      return signMac(options, paths);
    case "dmg":
      return createSignedDmg(options, paths);
    case "notarize":
      return notarizeDmg(options, paths);
    case "staple":
      return stapleRelease(paths);
    case "zip":
      return createZip(paths);
    case "verify":
      return verifyRelease(options, paths);
    case "stage-updates":
      return stageMacUpdateMetadata(options, paths);
    case "publish-updates":
      return publishMacUpdates(options, paths);
    case "tag":
      return ensureReleaseTag(options);
    case "quit-dev-app":
      return quitDevelopmentApp(options, paths);
    case "validate-smoke-user-data":
      return assertDevelopmentSmokeUserDataPath(macDevelopmentUserDataPaths(options));
    case "prepare-dev-user-data": {
      const userDataPaths = macDevelopmentUserDataPaths(options);
      if (!options.smoke) {
        throw new Error("Profile snapshots are reserved for one-time Agent smoke.");
      }
      return prepareDevelopmentUserData(userDataPaths);
    }
    case "install-dev-app":
      return installDevelopmentApp(paths);
    case "cleanup-dev-package":
      return cleanupDevelopmentPackage(paths);
    case "refresh-dev-app-icon":
      return refreshDevelopmentAppIcon(paths);
    case "launch-dev-app":
      return launchDevelopmentApp(options, paths);
    case "launch-dev-app-and-wait":
      return launchDevelopmentApp(options, paths, { wait: true });
    case "verify-production-profile":
      return verifyProductionProfileUnchanged(macDevelopmentUserDataPaths(options));
    case "cleanup-smoke-user-data":
      return cleanupDevelopmentSmokeUserData(macDevelopmentUserDataPaths(options), {
        verifiedProductionFingerprint: options.verifiedProductionFingerprint,
      });
    case "dev-install":
      for (const step of devInstallSteps) {
        console.log(`\n== ${step} ==`);
        runReleaseCommand(step, macDevelopmentInstallOptions(options));
      }
      return;
    case "dev-smoke": {
      const smokeOptions = macDevelopmentInstallOptions({
        ...options,
        devUserDataDir: options.smokeUserDataDir || DEFAULT_SMOKE_USER_DATA_DIR,
        smoke: true,
      });
      return runDevelopmentSmokeWorkflow({
        runStep: (step, context = {}) => {
          console.log(`\n== ${step} ==`);
          return runReleaseCommand(step, { ...smokeOptions, ...context });
        },
        onVerificationFailure: () => {
          console.error(
            `Smoke profile was not cleaned; diagnostic path: ${macDevelopmentUserDataPaths(smokeOptions).devUserDataDir}`,
          );
        },
      });
    }
    case "release":
      for (const step of releaseSteps) {
        console.log(`\n== ${step} ==`);
        runReleaseCommand(step, options);
      }
      return;
    case "help":
    case "--help":
    case "-h":
      return printHelp();
    default:
      printHelp();
      throw new Error(`Unknown release command: ${command}`);
  }
}

function requireReleaseSetting(value, name) {
  if (!String(value || "").trim()) {
    throw new Error(`Official macOS release profile is missing ${name}.`);
  }
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    runReleaseCommand(process.argv[2] || "help");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
