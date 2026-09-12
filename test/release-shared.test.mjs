import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertOfficialReleaseProfile,
  COMMUNITY_PACKAGE_IDENTITY,
  electronPackagerCommand,
  assertReleaseVersionIsNew,
  ensureReleaseGitTag,
  OFFICIAL_INTERNAL_PACKAGE_IDENTITY,
  OFFICIAL_PACKAGE_IDENTITY,
  OFFICIAL_PUBLIC_PACKAGE_IDENTITY,
  publishUpdateDirectory,
  RELEASE_PACKAGE_IGNORE_PATTERNS,
  releaseArtifactFileName,
  releaseBuildId,
  releaseBuildInfoFromEnv,
  releasePackageIdentity,
  releaseTrackUpdateChannel,
  releaseUpdateChannel,
  withReleaseBuildInfoFile,
  releaseTagName,
} from "../scripts/release-shared.mjs";
import { BUILD_INFO_FILENAME } from "../src/build-info.mjs";

test("electronPackagerCommand invokes the package JS entry through node", () => {
  const command = electronPackagerCommand({ rootDir: "/repo" });

  assert.equal(command.command, process.execPath);
  assert.equal(
    slashPath(command.args[0]),
    "/repo/node_modules/@electron/packager/bin/electron-packager.mjs",
  );
});

test("releaseTagName derives a stable git tag from the shared app version", () => {
  assert.equal(releaseTagName({ version: "0.1.1" }), "v0.1.1");
});

test("update publication resumes one manifest-bound incoming directory", async (t) => {
  const localDir = await mkdtemp(path.join(tmpdir(), "openglance-publish-resume-"));
  t.after(() => rm(localDir, { recursive: true, force: true }));
  await writeFile(path.join(localDir, "latest.json"), "{\"version\":\"3.2.4\"}\n");
  const calls = [];
  const runCommand = (command, args) => calls.push({ command, args });
  const options = {
    localDir,
    remoteHost: "release-host",
    remotePath: "/srv/updates/internal-candidate/darwin-universal",
    runCommand,
  };

  const first = publishUpdateDirectory(options);
  const second = publishUpdateDirectory(options);
  assert.equal(first.incomingPath, second.incomingPath);
  assert.match(first.incomingPath, /\.incoming-[a-f0-9]{64}$/);

  const prepare = calls[0];
  assert.equal(prepare.command, "ssh");
  assert.match(prepare.args.at(-1), /mkdir -p/);
  assert.doesNotMatch(prepare.args.at(-1), /rm -rf .*incoming/);

  const upload = calls[1];
  assert.equal(upload.command, "rsync");
  assert.ok(upload.args.includes("--partial"));
  assert.ok(upload.args.includes("--timeout=60"));
  assert.match(upload.args.at(-1), new RegExp(`${first.uploadKey}/$`));
  assert.match(upload.args[upload.args.indexOf("-e") + 1], /ServerAliveInterval=15/);

  await writeFile(path.join(localDir, "latest.json"), "{\"version\":\"3.2.5\"}\n");
  const changed = publishUpdateDirectory(options);
  assert.notEqual(changed.incomingPath, first.incomingPath);
});

test("releaseArtifactFileName keeps downloadable artifact names short and shell friendly", () => {
  assert.equal(
    releaseArtifactFileName({
      version: "0.1.4",
      releaseTrack: "internal",
      platformKey: "darwin-arm64",
      extension: ".dmg",
    }),
    "OpenGlance-0.1.4-internal-darwin-arm64.dmg",
  );
  assert.doesNotMatch(
    releaseArtifactFileName({
      version: "0.1.4",
      releaseTrack: "public",
      platformKey: "win32-x64",
      extension: "zip",
    }),
    /[\s+]|\bsigned\b|\bunsigned\b/,
  );
});

test("release package excludes repository tooling and third-party tests from app.asar", () => {
  const ignorePatterns = RELEASE_PACKAGE_IGNORE_PATTERNS.map((pattern) => new RegExp(pattern));
  const isIgnored = (filePath) => ignorePatterns.some((pattern) => pattern.test(filePath));

  for (const filePath of [
    "/.gitleaks.toml",
    "/CHANGELOG.md",
    "/README.zh-CN.md",
    "/docs/assets/user-guide/workspace-overview.png",
    "/tools/generate-openglance-open-link.mjs",
    "/node_modules/mermaid/package.json",
    "/node_modules/@lezer/css/test/test-css.js",
    "/node_modules/@lezer/html/tests/fixture.txt",
    "/node_modules/example/__tests__/fixture.js",
    "/node_modules/example/dist/parser.spec.mjs",
    "/node_modules/example/dist/parser.test.ts",
  ]) {
    assert.equal(isIgnored(filePath), true, `${filePath} should not be copied into app.asar`);
  }
});

test("release build identity defaults to source with analytics disabled", () => {
  const buildInfo = releaseBuildInfoFromEnv({
    rootDir: "/repo",
    env: {
      VERSION: "1.12.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-07-23T00:00:00.000Z",
      BUILD_ID: "abc123.20260723T000000Z",
    },
  });

  assert.equal(buildInfo.distribution, "source");
  assert.equal(buildInfo.releaseTrack, "source");
  assert.equal(buildInfo.buildId, "abc123.20260723T000000Z.source");
  assert.equal(buildInfo.usageAnalyticsDefault, false);
  assert.throws(
    () => assertOfficialReleaseProfile(buildInfo),
    /OPENGLANCE_RELEASE_PROFILE/,
  );
});

test("package metadata separates community builds from Mango Future official builds", () => {
  assert.deepEqual(
    releasePackageIdentity({ distribution: "source" }),
    COMMUNITY_PACKAGE_IDENTITY,
  );
  assert.deepEqual(COMMUNITY_PACKAGE_IDENTITY, {
    macBundleId: "org.openglance.community",
    macExecutableName: "OpenGlance",
    windowsCompanyName: "OpenGlance Community",
    windowsProductName: "OpenGlance Community Build",
  });

  assert.deepEqual(
    releasePackageIdentity({ distribution: "official" }),
    OFFICIAL_PUBLIC_PACKAGE_IDENTITY,
  );
  assert.deepEqual(OFFICIAL_PUBLIC_PACKAGE_IDENTITY, {
    macBundleId: "com.mangofuture.openglance",
    macExecutableName: "OpenGlance",
    windowsCompanyName: "Shenzhen Mango Future Technology Co., Ltd.",
    windowsProductName: "OpenGlance",
  });

  assert.deepEqual(
    releasePackageIdentity({ distribution: "official", releaseTrack: "internal" }),
    OFFICIAL_INTERNAL_PACKAGE_IDENTITY,
  );
  assert.equal(OFFICIAL_PACKAGE_IDENTITY, OFFICIAL_INTERNAL_PACKAGE_IDENTITY);
  assert.deepEqual(OFFICIAL_INTERNAL_PACKAGE_IDENTITY, {
    macBundleId: "com.mangofuture.gitleaf",
    macExecutableName: "OpenGlance",
    windowsCompanyName: "Shenzhen Mango Future Technology Co., Ltd.",
    windowsProductName: "OpenGlance",
  });
});

test("release profile selects official public or internal track defaults", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "openglance-release-profile-"));
  const publicProfile = path.join(rootDir, "official-public.json");
  await writeFile(publicProfile, JSON.stringify({
    distribution: "official",
    releaseTrack: "public",
    legacyInternalMigrationConfirmed: true,
    usageAnalyticsDefault: false,
  }), "utf8");

  const buildInfo = releaseBuildInfoFromEnv({
    rootDir,
    env: {
      OPENGLANCE_RELEASE_PROFILE: publicProfile,
      VERSION: "1.12.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-07-23T00:00:00.000Z",
      BUILD_ID: "abc123.20260723T000000Z",
    },
  });

  assert.equal(buildInfo.distribution, "official");
  assert.equal(buildInfo.releaseTrack, "public");
  assert.equal(buildInfo.buildId, "abc123.20260723T000000Z.public");
  assert.equal(buildInfo.usageAnalyticsDefault, false);
  assert.equal(buildInfo.releaseProfileConfigured, true);
  assert.equal(buildInfo.releaseProfileDistribution, "official");
  assert.equal(buildInfo.releaseProfileReleaseTrack, "public");
  assert.equal(buildInfo.legacyInternalMigrationConfirmed, true);
  assert.equal(assertOfficialReleaseProfile(buildInfo), undefined);

  const internalProfile = path.join(rootDir, "official-internal.json");
  await writeFile(internalProfile, JSON.stringify({
    distribution: "official",
    releaseTrack: "internal",
    usageAnalyticsDefault: true,
  }), "utf8");
  const internalBuildInfo = releaseBuildInfoFromEnv({
    rootDir,
    env: {
      OPENGLANCE_RELEASE_PROFILE: internalProfile,
      VERSION: "1.12.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-07-23T00:00:00.000Z",
      BUILD_ID: "abc123.20260723T000000Z",
    },
  });

  assert.equal(internalBuildInfo.distribution, "official");
  assert.equal(internalBuildInfo.releaseTrack, "internal");
  assert.equal(internalBuildInfo.buildId, "abc123.20260723T000000Z.internal");
  assert.equal(internalBuildInfo.usageAnalyticsDefault, true);
  assert.equal(assertOfficialReleaseProfile(internalBuildInfo), undefined);
});

test("release configuration accepts Git Leaf 1.x environment names as fallbacks", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "openglance-legacy-release-profile-"));
  const profilePath = path.join(rootDir, "official-public.json");
  await writeFile(profilePath, JSON.stringify({
    distribution: "official",
    releaseTrack: "public",
    legacyInternalMigrationConfirmed: true,
    usageAnalyticsDefault: false,
  }), "utf8");

  const legacy = releaseBuildInfoFromEnv({
    rootDir,
    env: {
      GIT_LEAF_RELEASE_PROFILE: profilePath,
      VERSION: "2.0.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-08-12T00:00:00.000Z",
      BUILD_ID: "abc123.20260812T000000Z",
    },
  });
  assert.equal(legacy.releaseProfileConfigured, true);
  assert.equal(legacy.distribution, "official");
  assert.equal(legacy.releaseTrack, "public");

  const canonical = releaseBuildInfoFromEnv({
    rootDir,
    env: {
      OPENGLANCE_RELEASE_PROFILE: profilePath,
      GIT_LEAF_RELEASE_PROFILE: "/missing/legacy-profile.json",
      VERSION: "2.0.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-08-12T00:00:00.000Z",
      BUILD_ID: "abc123.20260812T000000Z",
    },
  });
  assert.equal(canonical.releaseProfileConfigured, true);
  assert.equal(canonical.distribution, "official");
});

test("official release profiles fail closed on missing track or conflicting analytics", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "openglance-release-profile-invalid-"));
  const missingTrackProfile = path.join(rootDir, "missing-track.json");
  const conflictingInternalProfile = path.join(rootDir, "conflicting-internal.json");
  await writeFile(missingTrackProfile, JSON.stringify({
    distribution: "official",
    usageAnalyticsDefault: false,
  }), "utf8");
  await writeFile(conflictingInternalProfile, JSON.stringify({
    distribution: "official",
    releaseTrack: "internal",
    usageAnalyticsDefault: false,
  }), "utf8");

  assert.throws(
    () => releaseBuildInfoFromEnv({
      rootDir,
      env: { OPENGLANCE_RELEASE_PROFILE: missingTrackProfile },
    }),
    /explicit releaseTrack of public or internal/,
  );
  assert.throws(
    () => releaseBuildInfoFromEnv({
      rootDir,
      env: { OPENGLANCE_RELEASE_PROFILE: conflictingInternalProfile },
    }),
    /requires usageAnalyticsDefault=true/,
  );
});

test("official public release commands require the reviewed legacy migration confirmation", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-public-migration-gate-"));
  const profilePath = path.join(rootDir, "official-public.json");
  await writeFile(profilePath, JSON.stringify({
    distribution: "official",
    releaseTrack: "public",
    legacyInternalMigrationConfirmed: false,
    usageAnalyticsDefault: false,
  }), "utf8");

  const buildInfo = releaseBuildInfoFromEnv({
    rootDir,
    env: { OPENGLANCE_RELEASE_PROFILE: profilePath },
  });
  assert.equal(buildInfo.legacyInternalMigrationConfirmed, false);
  assert.throws(
    () => assertOfficialReleaseProfile(buildInfo),
    /legacyInternalMigrationConfirmed=true/,
  );
});

test("release tracks map to separate stable channels while build IDs remain idempotent", () => {
  assert.equal(releaseTrackUpdateChannel("public"), "stable");
  assert.equal(releaseTrackUpdateChannel("internal"), "internal-stable");
  assert.equal(releaseTrackUpdateChannel("source"), "");
  assert.equal(
    releaseUpdateChannel({ releaseTrack: "public", override: "candidate" }),
    "candidate",
  );
  assert.equal(
    releaseUpdateChannel({ releaseTrack: "internal", override: "stable" }),
    "stable",
  );
  assert.equal(
    releaseBuildId({ buildId: "abc123.20260723T000000Z", releaseTrack: "internal" }),
    "abc123.20260723T000000Z.internal",
  );
  assert.equal(
    releaseBuildId({
      buildId: "abc123.20260723T000000Z.internal",
      releaseTrack: "internal",
    }),
    "abc123.20260723T000000Z.internal",
  );
});

test("environment overrides cannot impersonate a configured official release profile", () => {
  const buildInfo = releaseBuildInfoFromEnv({
    rootDir: "/repo",
    env: {
      OPENGLANCE_DISTRIBUTION: "official",
      VERSION: "1.12.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-07-23T00:00:00.000Z",
      BUILD_ID: "abc123.20260723T000000Z",
    },
  });

  assert.equal(buildInfo.distribution, "official");
  assert.equal(buildInfo.releaseProfileConfigured, false);
  assert.throws(
    () => assertOfficialReleaseProfile(buildInfo),
    /OPENGLANCE_RELEASE_PROFILE/,
  );
});

test("assertReleaseVersionIsNew rejects a previously released version even on the same commit", () => {
  const runCommand = (_command, args) => {
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.1^{}") {
      return { status: 0, stdout: "abc123\n", stderr: "" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.throws(
    () => assertReleaseVersionIsNew({
      rootDir: "/repo",
      version: "0.1.1",
      runCommand,
    }),
    /Release version 0\.1\.1 has already been published as tag v0\.1\.1/,
  );
});

test("assertReleaseVersionIsNew accepts a version without an existing release tag", () => {
  const runCommand = (_command, args) => {
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.2^{}") {
      return { status: 1, stdout: "", stderr: "not found" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.equal(
    assertReleaseVersionIsNew({
      rootDir: "/repo",
      version: "0.1.2",
      runCommand,
    }),
    undefined,
  );
});

test("withReleaseBuildInfoFile writes development build marker", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "openglance-release-shared-"));
  let payload;

  withReleaseBuildInfoFile({
    rootDir,
    buildInfo: {
      version: "0.1.1",
      commit: "93458e1",
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
      dev: true,
    },
  }, () => {
    payload = JSON.parse(readFileSync(path.join(rootDir, BUILD_INFO_FILENAME), "utf8"));
  });

  assert.equal(payload.dev, true);
  assert.equal(payload.distribution, "source");
  assert.equal(payload.releaseTrack, "source");
  assert.equal(payload.buildId, "93458e1.20260705T114700Z.source");
  assert.equal(payload.usageAnalyticsDefault, false);
});

test("ensureReleaseGitTag creates an annotated version tag when it is missing", () => {
  const calls = [];
  const runCommand = (command, args) => {
    calls.push([command, args]);
    if (args.join(" ") === "rev-parse HEAD") {
      return { status: 0, stdout: "abc123\n", stderr: "" };
    }
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.1^{}") {
      return { status: 1, stdout: "", stderr: "not found" };
    }
    if (args.join(" ") === "tag -a v0.1.1 -m OpenGlance 0.1.1") {
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.deepEqual(
    ensureReleaseGitTag({
      rootDir: "/repo",
      version: "0.1.1",
      runCommand,
    }),
    {
      tagName: "v0.1.1",
      commit: "abc123",
      created: true,
    },
  );
  assert.deepEqual(calls.at(-1), [
    "git",
    ["tag", "-a", "v0.1.1", "-m", "OpenGlance 0.1.1"],
  ]);
});

test("ensureReleaseGitTag rejects an existing version tag on another commit", () => {
  const runCommand = (_command, args) => {
    if (args.join(" ") === "rev-parse HEAD") {
      return { status: 0, stdout: "current\n", stderr: "" };
    }
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.1^{}") {
      return { status: 0, stdout: "old\n", stderr: "" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.throws(
    () => ensureReleaseGitTag({
      rootDir: "/repo",
      version: "0.1.1",
      runCommand,
    }),
    /v0\.1\.1 already points to old, not current HEAD current/,
  );
});

function slashPath(value) {
  return value.replace(/\\/g, "/").replace(/^[A-Za-z]:(?=\/)/, "");
}
