import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openGlanceEnvironmentValue } from "../src/environment.mjs";
import {
  BUILD_INFO_FILENAME,
  DEFAULT_DISTRIBUTION,
} from "../src/build-info.mjs";

export const RELEASE_PACKAGE_IGNORE_PATTERNS = [
  "^/test($|/)",
  "^/dist($|/)",
  "^/\\.git($|/)",
  "^/\\.github($|/)",
  "^/\\.agents($|/)",
  "^/\\.superpowers($|/)",
  "^/scripts($|/)",
  "^/tools($|/)",
  "^/assets($|/)",
  "^/docs($|/)",
  "^/marketing($|/)",
  "^/Makefile$",
  "^/AGENTS\\.md$",
  "^/CLAUDE\\.md$",
  "^/CHANGELOG\\.md$",
  "^/CONTRIBUTING\\.md$",
  "^/README(?:\\.zh-CN)?\\.md$",
  "^/SECURITY\\.md$",
  "^/package-lock\\.json$",
  "^/\\.gitignore$",
  "^/\\.gitleaks\\.toml$",
  "^/node_modules/\\.package-lock\\.json$",
  "^/node_modules/.cache($|/)",
  "^/node_modules/@electron($|/)",
  "^/node_modules/@electron-internal($|/)",
  "^/node_modules/@esbuild($|/)",
  "^/node_modules/@malept($|/)",
  "^/node_modules/@types($|/)",
  "^/node_modules/@xmldom($|/)",
  "^/node_modules/electron($|/)",
  "^/node_modules/esbuild($|/)",
  "^/node_modules/mermaid($|/)",
  "^/node_modules/.+/(test|tests|__tests__)($|/)",
  "^/node_modules/.+/[^/]+\\.(test|spec)\\.(js|mjs|cjs|ts|tsx|jsx)$",
  "^/node_modules/.+/(test[-_][^/]+|[^/]+[-_.]test)\\.(js|mjs|cjs|ts|tsx|jsx)$",
  "^/\\.DS_Store$",
];

const RELEASE_TRACKS = new Set(["source", "public", "internal"]);
const OFFICIAL_RELEASE_TRACKS = new Set(["public", "internal"]);
const RELEASE_SSH_OPTIONS = [
  "-o",
  "ConnectTimeout=20",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=4",
];
const RELEASE_RSYNC_SHELL =
  "ssh -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4";

export const COMMUNITY_PACKAGE_IDENTITY = Object.freeze({
  macBundleId: "org.openglance.community",
  macExecutableName: "OpenGlance",
  windowsCompanyName: "OpenGlance Community",
  windowsProductName: "OpenGlance Community Build",
});

export const OFFICIAL_PUBLIC_PACKAGE_IDENTITY = Object.freeze({
  macBundleId: "com.mangofuture.openglance",
  macExecutableName: "OpenGlance",
  windowsCompanyName: "Shenzhen Mango Future Technology Co., Ltd.",
  windowsProductName: "OpenGlance",
});

export const OFFICIAL_INTERNAL_PACKAGE_IDENTITY = Object.freeze({
  macBundleId: "com.mangofuture.gitleaf",
  macExecutableName: "OpenGlance",
  windowsCompanyName: "Shenzhen Mango Future Technology Co., Ltd.",
  windowsProductName: "OpenGlance",
});

// Kept as a source-level compatibility alias for release integrations written
// before public and internal packages received distinct operating-system identities.
export const OFFICIAL_PACKAGE_IDENTITY = OFFICIAL_INTERNAL_PACKAGE_IDENTITY;

export function releasePackageIdentity(buildInfo = {}) {
  if (buildInfo.distribution !== "official") {
    return COMMUNITY_PACKAGE_IDENTITY;
  }
  return buildInfo.releaseTrack === "internal"
    ? OFFICIAL_INTERNAL_PACKAGE_IDENTITY
    : OFFICIAL_PUBLIC_PACKAGE_IDENTITY;
}

export function releaseBuildInfoFromEnv({
  rootDir,
  env = process.env,
  now = () => new Date(),
  fallbackVersion = "0.0.0",
} = {}) {
  const profile = releaseProfileFromEnv({ env });
  const releaseProfileConfigured = Boolean(String(
    openGlanceEnvironmentValue(env, "RELEASE_PROFILE") || "",
  ).trim());
  const releaseProfileDistribution = profile.distribution
    ? distributionValue(profile.distribution)
    : undefined;
  const releaseProfileReleaseTrack = releaseProfileDistribution === "official"
    ? officialReleaseTrackValue(profile.releaseTrack)
    : releaseTrackValue(profile.releaseTrack || "source");
  const releaseTrack = releaseProfileDistribution === "official"
    ? releaseProfileReleaseTrack
    : "source";
  const legacyInternalMigrationConfirmed =
    profile.legacyInternalMigrationConfirmed === true;
  const builtAt = env.BUILT_AT || now().toISOString();
  const commit = env.GIT_COMMIT || currentGitCommit({ cwd: rootDir });
  const buildId = releaseBuildId({
    buildId: env.BUILD_ID || `${commit}.${compactTimestamp(builtAt)}`,
    releaseTrack,
  });
  const usageAnalyticsDefault = booleanValue(
    openGlanceEnvironmentValue(env, "USAGE_ANALYTICS_DEFAULT"),
    profile.usageAnalyticsDefault,
    releaseTrack === "internal",
  );

  if (
    releaseProfileDistribution === "official"
    && usageAnalyticsDefault !== (releaseTrack === "internal")
  ) {
    throw new Error(
      `Official ${releaseTrack} release profile requires usageAnalyticsDefault=${
        releaseTrack === "internal"
      }.`,
    );
  }

  return {
    version: env.VERSION || packageVersion({ rootDir, fallbackVersion }),
    commit,
    builtAt,
    buildId,
    releaseTrack,
    releaseProfileConfigured,
    releaseProfileDistribution,
    releaseProfileReleaseTrack,
    legacyInternalMigrationConfirmed,
    distribution: distributionValue(
      openGlanceEnvironmentValue(env, "DISTRIBUTION")
      || profile.distribution
      || DEFAULT_DISTRIBUTION,
    ),
    usageAnalyticsDefault,
  };
}

export function releaseProfileFromEnv({ env = process.env } = {}) {
  const profilePath = String(openGlanceEnvironmentValue(env, "RELEASE_PROFILE") || "").trim();
  if (!profilePath) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path.resolve(profilePath), "utf8"));
  } catch (error) {
    throw new Error(`Could not read OPENGLANCE_RELEASE_PROFILE: ${profilePath}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OPENGLANCE_RELEASE_PROFILE must contain one JSON object.");
  }
  return parsed;
}

export function assertOfficialReleaseProfile(options) {
  const releaseTrack = options?.releaseTrack;
  if (
    options?.releaseProfileConfigured !== true
    || options?.releaseProfileDistribution !== "official"
    || options?.distribution !== "official"
    || options?.releaseProfileReleaseTrack !== releaseTrack
    || !OFFICIAL_RELEASE_TRACKS.has(releaseTrack)
    || options?.usageAnalyticsDefault !== (releaseTrack === "internal")
    || (
      releaseTrack === "public"
      && options?.legacyInternalMigrationConfirmed !== true
    )
  ) {
    throw new Error(
      "Official release commands require OPENGLANCE_RELEASE_PROFILE with distribution=official, " +
        "an explicit public/internal releaseTrack, the track's required analytics default, " +
        "and legacyInternalMigrationConfirmed=true for public releases.",
    );
  }
}

export function releaseArtifactFileName({
  version,
  releaseTrack = "source",
  platformKey,
  extension,
} = {}) {
  const cleanVersion = String(version || "").trim();
  const cleanReleaseTrack = releaseTrackValue(releaseTrack);
  const cleanPlatformKey = String(platformKey || "").trim();
  const cleanExtension = String(extension || "").trim().replace(/^\./, "");
  if (!cleanVersion || !cleanPlatformKey || !cleanExtension) {
    throw new Error("Release artifact file name requires version, platformKey, and extension");
  }
  return `OpenGlance-${cleanVersion}-${cleanReleaseTrack}-${cleanPlatformKey}.${cleanExtension}`;
}

export function releaseBuildId({ buildId, releaseTrack = "source" } = {}) {
  const cleanBuildId = String(buildId || "").trim();
  const cleanReleaseTrack = releaseTrackValue(releaseTrack);
  if (!cleanBuildId) {
    throw new Error("Release build ID is required");
  }
  const suffix = `.${cleanReleaseTrack}`;
  return cleanBuildId.endsWith(suffix) ? cleanBuildId : `${cleanBuildId}${suffix}`;
}

export function releaseTrackUpdateChannel(releaseTrack = "source") {
  switch (releaseTrackValue(releaseTrack)) {
    case "internal":
      return "internal-stable";
    case "public":
      return "stable";
    case "source":
      return "";
    default:
      throw new Error(`Unsupported OpenGlance release track: ${releaseTrack}`);
  }
}

export function releaseUpdateChannel({ releaseTrack = "source", override } = {}) {
  const explicitChannel = String(override || "").trim();
  return explicitChannel || releaseTrackUpdateChannel(releaseTrack);
}

export function publishUpdateDirectory({
  localDir,
  remoteHost,
  remotePath,
  runCommand,
} = {}) {
  if (
    !String(localDir || "").trim()
    || !String(remoteHost || "").trim()
    || !String(remotePath || "").trim()
    || typeof runCommand !== "function"
  ) {
    throw new TypeError(
      "Update publication requires localDir, remoteHost, remotePath, and runCommand",
    );
  }
  const manifestBytes = readFileSync(path.join(localDir, "latest.json"));
  const uploadKey = createHash("sha256").update(manifestBytes).digest("hex");
  const incomingPath = `${remotePath}.incoming-${uploadKey}`;
  const previousPath = `${remotePath}.previous`;

  runCommand("ssh", [
    ...RELEASE_SSH_OPTIONS,
    remoteHost,
    `mkdir -p ${shellQuote(incomingPath)} ${shellQuote(path.posix.dirname(remotePath))}`,
  ]);
  runCommand("rsync", [
    "-az",
    "--delete",
    "--partial",
    "--timeout=60",
    "-e",
    RELEASE_RSYNC_SHELL,
    `${localDir}/`,
    `${remoteHost}:${incomingPath}/`,
  ]);
  runCommand("ssh", [
    ...RELEASE_SSH_OPTIONS,
    remoteHost,
    [
      `rm -rf ${shellQuote(previousPath)}`,
      `if [ -d ${shellQuote(remotePath)} ]; then mv ${shellQuote(remotePath)} ${shellQuote(previousPath)}; fi`,
      `mv ${shellQuote(incomingPath)} ${shellQuote(remotePath)}`,
      `rm -rf ${shellQuote(previousPath)}`,
    ].join(" && "),
  ]);
  return { incomingPath, uploadKey };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function releaseTagName({ version } = {}) {
  const cleanVersion = String(version || "").trim();
  if (!cleanVersion) {
    throw new Error("Release version is required before creating a git tag");
  }
  return cleanVersion.startsWith("v") ? cleanVersion : `v${cleanVersion}`;
}

export function assertReleaseVersionIsNew({
  rootDir,
  version,
  runCommand = spawnSync,
} = {}) {
  const tagName = releaseTagName({ version });
  const tagResult = runCommand("git", ["rev-parse", "--verify", `refs/tags/${tagName}^{}`], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (tagResult.status === 0) {
    throw new Error(
      `Release version ${version} has already been published as tag ${tagName}. ` +
        "Bump package.json before creating another distributable build.",
    );
  }
}

export function electronPackagerCommand({ rootDir = process.cwd() } = {}) {
  return {
    command: process.execPath,
    args: [
      path.join(rootDir, "node_modules", "@electron", "packager", "bin", "electron-packager.mjs"),
    ],
  };
}

export function ensureReleaseGitTag({
  rootDir,
  version,
  runCommand = spawnSync,
} = {}) {
  const tagName = releaseTagName({ version });
  const headCommit = gitOutput(["rev-parse", "HEAD"], { cwd: rootDir, runCommand }).trim();
  const tagResult = runCommand("git", ["rev-parse", "--verify", `refs/tags/${tagName}^{}`], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (tagResult.status === 0) {
    const taggedCommit = String(tagResult.stdout || "").trim();
    if (taggedCommit !== headCommit) {
      throw new Error(
        `Release tag ${tagName} already points to ${taggedCommit}, not current HEAD ${headCommit}`,
      );
    }
    return { tagName, commit: headCommit, created: false };
  }

  gitRun(["tag", "-a", tagName, "-m", `OpenGlance ${version}`], {
    cwd: rootDir,
    runCommand,
  });
  return { tagName, commit: headCommit, created: true };
}

export function packageVersion({ rootDir, fallbackVersion = "0.0.0" } = {}) {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
    return String(packageJson.version || fallbackVersion);
  } catch {
    return fallbackVersion;
  }
}

export function compactTimestamp(value) {
  return String(value)
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace(/\.\d+/, "");
}

export function withReleaseBuildInfoFile({ rootDir, buildInfo }, callback) {
  const filePath = path.join(rootDir, BUILD_INFO_FILENAME);
  writeFileSync(filePath, `${JSON.stringify(buildInfoPayload(buildInfo), null, 2)}\n`, "utf8");
  try {
    return callback();
  } finally {
    rmSync(filePath, { force: true });
  }
}

function buildInfoPayload(buildInfo) {
  const releaseTrack = releaseTrackValue(buildInfo.releaseTrack || "source");
  return {
    version: String(buildInfo.version || ""),
    commit: String(buildInfo.commit || ""),
    builtAt: String(buildInfo.builtAt || ""),
    buildId: releaseBuildId({ buildId: buildInfo.buildId, releaseTrack }),
    ...(buildInfo.dev === true ? { dev: true } : {}),
    distribution: distributionValue(buildInfo.distribution || DEFAULT_DISTRIBUTION),
    releaseTrack,
    ...(String(buildInfo.updateChannel || "").trim()
      ? { updateChannel: String(buildInfo.updateChannel).trim() }
      : {}),
    usageAnalyticsDefault: buildInfo.usageAnalyticsDefault === true,
  };
}

function distributionValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "source" || normalized === "official") {
    return normalized;
  }
  throw new Error(`Unsupported OpenGlance distribution: ${value}`);
}

function releaseTrackValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (RELEASE_TRACKS.has(normalized)) {
    return normalized;
  }
  throw new Error(`Unsupported OpenGlance release track: ${value}`);
}

function officialReleaseTrackValue(value) {
  if (!String(value || "").trim()) {
    throw new Error(
      "Official release profiles require an explicit releaseTrack of public or internal.",
    );
  }
  const releaseTrack = releaseTrackValue(value);
  if (!OFFICIAL_RELEASE_TRACKS.has(releaseTrack)) {
    throw new Error(
      "Official release profiles require an explicit releaseTrack of public or internal.",
    );
  }
  return releaseTrack;
}

function booleanValue(environmentValue, profileValue, fallback) {
  if (environmentValue !== undefined && environmentValue !== "") {
    const normalized = String(environmentValue).trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalized)) return true;
    if (["0", "false", "no"].includes(normalized)) return false;
    throw new Error(`Invalid boolean build setting: ${environmentValue}`);
  }
  if (typeof profileValue === "boolean") {
    return profileValue;
  }
  return fallback === true;
}

function currentGitCommit({ cwd } = {}) {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function gitOutput(args, { cwd, runCommand }) {
  const result = runCommand("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: git ${args.join(" ")}`);
  }
  return String(result.stdout || "");
}

function gitRun(args, { cwd, runCommand }) {
  const result = runCommand("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: git ${args.join(" ")}`);
  }
}
