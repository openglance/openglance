#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OPENGLANCE_SUPPORTED_PROTOCOLS } from "../src/product-identity.mjs";
import { openGlanceEnvironmentFlag } from "../src/environment.mjs";
import { buildUpdateManifest, updateArtifactRemotePath, updateMetadataRelativeDir } from "./update-publish.mjs";
import {
  assertOfficialReleaseProfile,
  assertReleaseVersionIsNew,
  electronPackagerCommand,
  ensureReleaseGitTag,
  packageVersion,
  publishUpdateDirectory,
  releaseArtifactFileName,
  releaseBuildId,
  releaseBuildInfoFromEnv,
  releasePackageIdentity,
  releaseProfileFromEnv,
  releaseUpdateChannel,
  RELEASE_PACKAGE_IGNORE_PATTERNS,
  withReleaseBuildInfoFile,
} from "./release-shared.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
export const DEFAULT_ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";

export const DEFAULT_WINDOWS_RELEASE_OPTIONS = {
  appName: "OpenGlance",
  companyName: "OpenGlance Community",
  productName: "OpenGlance Community Build",
  iconPath: "assets/icons/openglance.ico",
  version: packageVersion({ rootDir: REPO_ROOT, fallbackVersion: "0.1.1" }),
  outDir: "dist",
  updateBaseUrl: "https://updates.mangofuture.com/git-leaf",
  updateChannel: "stable",
  updateRemoteHost: "",
  updateRemoteRoot: "",
  releaseTrack: "source",
};

export const windowsReleaseSteps = [
  "check-version",
  "test",
  "package",
  "zip",
  "verify",
  "tag",
];

export const windowsPortableSteps = [
  "package",
  "zip",
  "verify",
];

const windowsCommandsRequiringNewReleaseVersion = new Set([
  "stage-updates",
  "publish-updates",
]);
const windowsCommandsRequiringOfficialProfile = new Set([
  "stage-updates",
  "publish-updates",
  "tag",
  "release",
]);

export function windowsElectronPackagerArgs({
  appName = DEFAULT_WINDOWS_RELEASE_OPTIONS.appName,
  version = DEFAULT_WINDOWS_RELEASE_OPTIONS.version,
  companyName = DEFAULT_WINDOWS_RELEASE_OPTIONS.companyName,
  productName = DEFAULT_WINDOWS_RELEASE_OPTIONS.productName,
  iconPath = DEFAULT_WINDOWS_RELEASE_OPTIONS.iconPath,
  outDir = DEFAULT_WINDOWS_RELEASE_OPTIONS.outDir,
} = {}) {
  return [
    ".",
    appName,
    "--platform=win32",
    "--arch=x64",
    `--out=${outDir}`,
    "--overwrite",
    `--app-version=${version}`,
    `--executable-name=${appName}`,
    `--icon=${iconPath}`,
    ...OPENGLANCE_SUPPORTED_PROTOCOLS.flatMap((protocol) => [
      `--protocol=${protocol}`,
      "--protocol-name=OpenGlance Document",
    ]),
    `--win32metadata.CompanyName=${companyName}`,
    `--win32metadata.FileDescription=${productName}`,
    `--win32metadata.ProductName=${productName}`,
    `--win32metadata.InternalName=${productName}`,
    `--win32metadata.OriginalFilename=${appName}.exe`,
    ...RELEASE_PACKAGE_IGNORE_PATTERNS.map((pattern) => `--ignore=${pattern}`),
  ];
}

export function windowsReleasePaths({
  rootDir = REPO_ROOT,
  appName = DEFAULT_WINDOWS_RELEASE_OPTIONS.appName,
  version = DEFAULT_WINDOWS_RELEASE_OPTIONS.version,
  releaseTrack = DEFAULT_WINDOWS_RELEASE_OPTIONS.releaseTrack,
  buildId = DEFAULT_WINDOWS_RELEASE_OPTIONS.buildId,
} = {}) {
  const distDir = path.join(rootDir, "dist");
  const appRoot = path.join(distDir, `${appName}-win32-x64`);
  return {
    distDir,
    appRoot,
    exePath: path.join(appRoot, `${appName}.exe`),
    gitLeafExePath: path.join(appRoot, "Git Leaf.exe"),
    // Compatibility alias for integrations that mean the Git Leaf 1.x bridge.
    legacyExePath: path.join(appRoot, "Git Leaf.exe"),
    zipPath: path.join(
      distDir,
      releaseArtifactFileName({
        version,
        releaseTrack,
        platformKey: "win32-x64",
        extension: "zip",
      }),
    ),
  };
}

export function windowsCompatibilityExecutablePaths(options = {}, paths = windowsReleasePaths(options)) {
  return options.distribution === "official" && options.releaseTrack === "internal"
    ? [paths.gitLeafExePath]
    : [];
}

export function windowsUpdateMetadataPaths({
  rootDir = REPO_ROOT,
  channel = DEFAULT_WINDOWS_RELEASE_OPTIONS.updateChannel,
  platformKey = "win32-x64",
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
    sha256Path: path.join(updateDir, "sha256sums.txt"),
  };
}

export function windowsCommandRequiresNewReleaseVersion(command) {
  return windowsCommandsRequiringNewReleaseVersion.has(command);
}

function windowsReleaseOptionsFromEnv() {
  const profile = releaseProfileFromEnv();
  const buildInfo = releaseBuildInfoFromEnv({
    rootDir: REPO_ROOT,
    fallbackVersion: DEFAULT_WINDOWS_RELEASE_OPTIONS.version,
  });
  const packageIdentity = releasePackageIdentity(buildInfo);
  return {
    ...DEFAULT_WINDOWS_RELEASE_OPTIONS,
    ...buildInfo,
    companyName: packageIdentity.windowsCompanyName,
    productName: packageIdentity.windowsProductName,
    updateBaseUrl:
      process.env.UPDATE_BASE_URL
      || profile.updateBaseUrl
      || DEFAULT_WINDOWS_RELEASE_OPTIONS.updateBaseUrl,
    updateChannel:
      releaseUpdateChannel({
        releaseTrack: buildInfo.releaseTrack,
        override: process.env.UPDATE_CHANNEL,
      }),
    updateRemoteHost:
      process.env.UPDATE_REMOTE_HOST
      || profile.updateRemoteHost
      || DEFAULT_WINDOWS_RELEASE_OPTIONS.updateRemoteHost,
    updateRemoteRoot:
      process.env.UPDATE_REMOTE_ROOT
      || profile.updateRemoteRoot
      || DEFAULT_WINDOWS_RELEASE_OPTIONS.updateRemoteRoot,
    formalRelease: openGlanceEnvironmentFlag(process.env, "FORMAL_RELEASE"),
  };
}

function run(command, args, { cwd = REPO_ROOT } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ELECTRON_MIRROR: DEFAULT_ELECTRON_MIRROR,
      ...process.env,
    },
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function requirePath(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected Windows release path is missing: ${filePath}`);
  }
}

function packageWindows(options) {
  const packager = electronPackagerCommand({ rootDir: REPO_ROOT });
  requirePath(packager.args[0]);
  withReleaseBuildInfoFile({ rootDir: REPO_ROOT, buildInfo: options }, () => {
    run(packager.command, [...packager.args, ...windowsElectronPackagerArgs(options)]);
  });
  const paths = windowsReleasePaths(options);
  requirePath(paths.exePath);
  for (const compatibilityPath of windowsCompatibilityExecutablePaths(options, paths)) {
    copyFileSync(paths.exePath, compatibilityPath);
  }
}

function createWindowsZip(options) {
  const paths = windowsReleasePaths(options);
  requirePath(paths.appRoot);
  rmSync(paths.zipPath, { force: true });
  const command = windowsZipCommand({
    appRoot: paths.appRoot,
    zipPath: paths.zipPath,
    platform: process.platform,
  });
  run(command.command, command.args, { cwd: command.cwd ?? REPO_ROOT });
}

export function windowsZipCommand({ appRoot, zipPath, platform = process.platform } = {}) {
  if (platform === "win32") {
    const commandText = [
      "$ErrorActionPreference = 'Stop'",
      [
        "Compress-Archive",
        "-LiteralPath",
        powerShellSingleQuoted(appRoot),
        "-DestinationPath",
        powerShellSingleQuoted(zipPath),
        "-Force",
      ].join(" "),
    ].join("; ");

    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        commandText,
      ],
    };
  }

  return {
    command: "zip",
    args: ["-qry", zipPath, path.basename(appRoot)],
    cwd: path.dirname(appRoot),
  };
}

function powerShellSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function verifyWindowsPackage(options) {
  const paths = windowsReleasePaths(options);
  requirePath(paths.appRoot);
  requirePath(paths.exePath);
  for (const compatibilityPath of windowsCompatibilityExecutablePaths(options, paths)) {
    requirePath(compatibilityPath);
  }
  requirePath(paths.zipPath);
}

export function stageWindowsUpdateMetadata(options, { rootDir = REPO_ROOT } = {}) {
  const paths = windowsReleasePaths({ ...options, rootDir });
  requirePath(paths.zipPath);

  const metadataPaths = windowsUpdateMetadataPaths({
    rootDir,
    channel: options.updateChannel,
    platformKey: "win32-x64",
  });
  rmSync(metadataPaths.updateDir, { recursive: true, force: true });
  mkdirSync(metadataPaths.updateDir, { recursive: true });

  const stagedZipPath = path.join(metadataPaths.updateDir, path.basename(paths.zipPath));
  copyFileSync(paths.zipPath, stagedZipPath);

  const artifact = artifactDescriptor("zip", stagedZipPath);
  const releaseTrack = options.releaseTrack || "source";
  const manifest = buildUpdateManifest({
    appName: options.appName,
    baseUrl: options.updateBaseUrl,
    channel: options.updateChannel,
    releaseTrack,
    platformKey: "win32-x64",
    version: options.version,
    buildId: releaseBuildId({ buildId: options.buildId, releaseTrack }),
    commit: options.commit,
    builtAt: options.builtAt,
    notes: "Windows 当前通过 unsigned ZIP 分发；运行新版后会自动更新当前用户的固定安装位置。",
    artifacts: [artifact],
  });

  writeJson(metadataPaths.latestJsonPath, manifest);
  writeFileSync(metadataPaths.sha256Path, `${artifact.sha256}  ${artifact.fileName}\n`, "utf8");
  return metadataPaths;
}

function publishWindowsUpdates(options) {
  requireReleaseSetting(options.updateRemoteHost, "updateRemoteHost");
  requireReleaseSetting(options.updateRemoteRoot, "updateRemoteRoot");
  const metadataPaths = stageWindowsUpdateMetadata(options);
  publishUpdateDirectory({
    localDir: metadataPaths.updateDir,
    remoteHost: options.updateRemoteHost,
    remotePath: updateArtifactRemotePath({
      remoteRoot: options.updateRemoteRoot,
      channel: options.updateChannel,
      platformKey: "win32-x64",
    }),
    runCommand: run,
  });
}

function requireReleaseSetting(value, name) {
  if (!String(value || "").trim()) {
    throw new Error(`Official Windows release profile is missing ${name}.`);
  }
  return value;
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

function runTests() {
  run("npm", ["run", "test:ci:win"]);
}

function checkReleaseVersion(options) {
  assertReleaseVersionIsNew({
    rootDir: REPO_ROOT,
    version: options.version,
  });
}

function ensureReleaseTag(options) {
  const result = ensureReleaseGitTag({
    rootDir: REPO_ROOT,
    version: options.version,
  });
  console.log(`${result.created ? "Created" : "Verified"} release tag ${result.tagName} at ${result.commit}`);
}

function printHelp() {
  console.log(`Usage: node scripts/release-windows.mjs <command>

Commands:
  check-version
           Fail if this package version already has a release tag
  test     Run shared core tests plus Windows release tests
  package  Build the Windows x64 app directory with release ignores and metadata
  zip      Create an unsigned self-installing Windows ZIP
  verify   Verify the packaged app directory and executable exist
  stage-updates
           Stage update metadata and artifacts under dist/updates/
  publish-updates
           Stage and upload update metadata/artifacts to the configured release host
  tag      Create or verify the git version tag for this release
  portable Build and verify the unsigned self-installing Windows ZIP without tagging
  release  Run the full Windows release sequence

Environment overrides:
  ELECTRON_MIRROR
  VERSION
  GIT_COMMIT
  BUILT_AT
  BUILD_ID
  UPDATE_BASE_URL
  UPDATE_CHANNEL
  UPDATE_REMOTE_HOST
  UPDATE_REMOTE_ROOT
`);
}

export function runWindowsReleaseCommand(
  command,
  options = windowsReleaseOptionsFromEnv(),
) {
  if (
    windowsCommandsRequiringOfficialProfile.has(command)
    || (
      command === "package"
      && (options.formalRelease === true || options.distribution === "official")
    )
  ) {
    assertOfficialReleaseProfile(options);
  }
  if (windowsCommandRequiresNewReleaseVersion(command)) {
    checkReleaseVersion(options);
  }

  switch (command) {
    case "check-version":
      return checkReleaseVersion(options);
    case "test":
      return runTests();
    case "package":
      return packageWindows(options);
    case "zip":
      return createWindowsZip(options);
    case "verify":
      return verifyWindowsPackage(options);
    case "stage-updates":
      return stageWindowsUpdateMetadata(options);
    case "publish-updates":
      return publishWindowsUpdates(options);
    case "tag":
      return ensureReleaseTag(options);
    case "portable":
      for (const step of windowsPortableSteps) {
        console.log(`\n== ${step} ==`);
        runWindowsReleaseCommand(step, options);
      }
      return;
    case "release":
      for (const step of windowsReleaseSteps) {
        console.log(`\n== ${step} ==`);
        runWindowsReleaseCommand(step, options);
      }
      return;
    case "help":
    case "--help":
    case "-h":
      return printHelp();
    default:
      printHelp();
      throw new Error(`Unknown Windows release command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    runWindowsReleaseCommand(process.argv[2] || "help");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
