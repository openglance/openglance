import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPackage } from "@electron/asar";

import {
  developmentHandoffRegressionSourceVersion,
  readPackagedBuildInfo,
  runDevelopmentHandoffRegression,
  validateDevelopmentHandoffBuildPair,
  validateDevelopmentHandoffRegressionEvidence,
} from "../scripts/mac-development-handoff-regression.mjs";

test("packaged build identity refreshes after in-place App Contents replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-handoff-asar-cache-"));
  const resources = path.join(root, "OpenGlance.app", "Contents", "Resources");
  const sourceFiles = path.join(root, "source-files");
  const targetFiles = path.join(root, "target-files");
  const asarPath = path.join(resources, "app.asar");
  const replacementAsar = path.join(root, "replacement.asar");
  const sourceBuild = {
    version: "1.16.0",
    buildId: "a".repeat(180),
    dev: true,
  };
  const targetBuild = {
    version: "1.17.0",
    buildId: "target-internal",
  };

  try {
    await mkdir(resources, { recursive: true });
    await mkdir(sourceFiles, { recursive: true });
    await mkdir(targetFiles, { recursive: true });
    await writeFile(
      path.join(sourceFiles, "openglance-build-info.json"),
      `${JSON.stringify(sourceBuild, null, 2)}\n`,
    );
    // A 1.x package remains a valid handoff source during the 3.0 transition.
    await writeFile(
      path.join(targetFiles, "git-leaf-build-info.json"),
      `${JSON.stringify(targetBuild, null, 2)}\n`,
    );
    await createPackage(sourceFiles, asarPath);
    assert.deepEqual(readPackagedBuildInfo(path.join(root, "OpenGlance.app")), sourceBuild);

    await createPackage(targetFiles, replacementAsar);
    await rename(replacementAsar, asarPath);

    assert.deepEqual(readPackagedBuildInfo(path.join(root, "OpenGlance.app")), targetBuild);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const RECEIPT = {
  kind: "dev-to-internal",
  version: "1.16.0",
  buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
  commit: "2c3e9d8cfcfb",
  releaseTrack: "internal",
  channel: "internal-stable",
  platform: "darwin-universal",
};

const SOURCE_BUILD = {
  version: "1.15.0",
  buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
  commit: "aaaaaaaaaaaa",
  dev: true,
  distribution: "source",
  releaseTrack: "source",
  usageAnalyticsDefault: false,
};

const TARGET_BUILD = {
  version: RECEIPT.version,
  buildId: RECEIPT.buildId,
  commit: RECEIPT.commit,
  distribution: "official",
  releaseTrack: "internal",
  usageAnalyticsDefault: true,
};

test("development handoff regression requires an explicit visible-App acknowledgement", async () => {
  await assert.rejects(
    runDevelopmentHandoffRegression({
      outputPath: "/tmp/development-handoff-evidence.json",
      logPath: "/tmp/development-handoff.log",
    }),
    /allow-visible-app/i,
  );
});

test("development handoff regression binds a lower source version to a newer internal target", () => {
  assert.deepEqual(validateDevelopmentHandoffBuildPair({
    sourceBuildInfo: SOURCE_BUILD,
    sourceBundleId: "org.openglance.community",
    targetBuildInfo: TARGET_BUILD,
    targetBundleId: "com.mangofuture.gitleaf",
    targetExecutable: "Git Leaf",
    receipt: RECEIPT,
  }), {
    sourceVersion: "1.15.0",
    targetVersion: "1.16.0",
    sourceBuildId: SOURCE_BUILD.buildId,
    targetBuildId: TARGET_BUILD.buildId,
  });

  for (const mismatch of [
    { sourceBuildInfo: { ...SOURCE_BUILD, dev: false } },
    { sourceBuildInfo: { ...SOURCE_BUILD, version: "1.16.0" } },
    { targetBuildInfo: { ...TARGET_BUILD, distribution: "source" } },
    { targetBuildInfo: { ...TARGET_BUILD, usageAnalyticsDefault: false } },
    { targetBuildInfo: { ...TARGET_BUILD, version: "1.16.1" } },
    { sourceBundleId: "com.mangofuture.gitleaf" },
    { targetBundleId: "org.openglance.community" },
    { targetExecutable: "OpenGlance" },
    { receipt: { ...RECEIPT, buildId: "bbbbbbbbbbbb.20260730T010000Z.internal" } },
  ]) {
    assert.throws(
      () => validateDevelopmentHandoffBuildPair({
        sourceBuildInfo: SOURCE_BUILD,
        sourceBundleId: "org.openglance.community",
        targetBuildInfo: TARGET_BUILD,
        targetBundleId: "com.mangofuture.gitleaf",
        targetExecutable: "Git Leaf",
        receipt: RECEIPT,
        ...mismatch,
      }),
      /development handoff/i,
    );
  }
});

test("development handoff regression derives a strictly lower stable source version", () => {
  assert.equal(developmentHandoffRegressionSourceVersion("1.16.2"), "1.16.1");
  assert.equal(developmentHandoffRegressionSourceVersion("1.16.0"), "1.15.0");
  assert.equal(developmentHandoffRegressionSourceVersion("2.0.0"), "1.0.0");
  assert.throws(
    () => developmentHandoffRegressionSourceVersion("0.0.0"),
    /lower source version/i,
  );
});

test("development handoff evidence requires the real installation and isolation outcomes", () => {
  const fingerprint = { sha256: "a".repeat(64), fileCount: 3 };
  const evidence = {
    schemaVersion: 2,
    source: "git-leaf-macos-development-handoff-regression",
    status: "passed",
    platform: "darwin-universal",
    version: "1.16.0",
    sourceVersion: "1.15.0",
    sourceBuildId: SOURCE_BUILD.buildId,
    targetBuildId: TARGET_BUILD.buildId,
    sourceBundleId: "org.openglance.community",
    targetBundleId: "com.mangofuture.gitleaf",
    targetExecutable: "Git Leaf",
    targetTeamIdentifier: "HN6X79BUSR",
    protocolScheme: "openglance",
    protocolSchemes: ["openglance", "git-leaf"],
    targetUsageAnalyticsDefault: true,
    analyticsDefaultAdopted: true,
    handoffReceiptConsumed: true,
    telemetryInitialized: true,
    nonprivilegedContentsBridge: true,
    squirrelInvoked: false,
    preparedUpdateRemoved: true,
    appDirectoryInodePreserved: true,
    installParentWritable: false,
    privilegedShipItJobObserved: false,
    preexistingDormantUserShipItJobLabels: [
      "com.mangofuture.gitleaf.ShipIt",
    ],
    realProfileBefore: fingerprint,
    realProfileAfter: fingerprint,
    realShipItCacheBefore: fingerprint,
    realShipItCacheAfter: fingerprint,
    cleanup: {
      processesTerminated: true,
      userShipItJobsUnchangedOrAbsent: true,
      systemShipItJobsAbsent: true,
      preexistingDormantUserShipItJobsPreserved: true,
      isolatedCacheRemovedWithTemporaryRoot: true,
      realProfileUnchanged: true,
      realShipItCacheUnchanged: true,
    },
  };

  assert.equal(
    validateDevelopmentHandoffRegressionEvidence(evidence),
    evidence,
  );
  for (const invalid of [
    { sourceVersion: undefined },
    { sourceVersion: "1.16.0" },
    { analyticsDefaultAdopted: false },
    { handoffReceiptConsumed: false },
    { appDirectoryInodePreserved: false },
    { privilegedShipItJobObserved: true },
    { preexistingDormantUserShipItJobLabels: ["unexpected.ShipIt"] },
    {
      cleanup: {
        ...evidence.cleanup,
        preexistingDormantUserShipItJobsPreserved: false,
      },
    },
    { targetTeamIdentifier: "UNKNOWN" },
    { targetExecutable: "OpenGlance" },
    { realProfileAfter: { sha256: "b".repeat(64), fileCount: 3 } },
  ]) {
    assert.throws(
      () => validateDevelopmentHandoffRegressionEvidence({
        ...evidence,
        ...invalid,
      }),
      /mandatory development handoff evidence/i,
    );
  }
});
