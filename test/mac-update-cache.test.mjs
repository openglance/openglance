import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  COMMUNITY_MAC_SHIPIT_JOB_LABEL,
  macShipItJobLabelForBuildInfo,
  OFFICIAL_INTERNAL_MAC_SHIPIT_JOB_LABEL,
  OFFICIAL_PUBLIC_MAC_SHIPIT_JOB_LABEL,
  macUpdateCachePaths,
  prepareMacUpdateAppPath,
  pruneObsoleteMacUpdatePackages,
} from "../src/desktop/mac-update-cache.mjs";

test("macOS ShipIt cache identity follows public, internal, and Community Bundle IDs", () => {
  assert.equal(macShipItJobLabelForBuildInfo({
    distribution: "official",
    releaseTrack: "public",
  }), OFFICIAL_PUBLIC_MAC_SHIPIT_JOB_LABEL);
  assert.equal(macShipItJobLabelForBuildInfo({
    distribution: "official",
    releaseTrack: "internal",
  }), OFFICIAL_INTERNAL_MAC_SHIPIT_JOB_LABEL);
  assert.equal(macShipItJobLabelForBuildInfo({
    distribution: "source",
    releaseTrack: "source",
  }), COMMUNITY_MAC_SHIPIT_JOB_LABEL);
});

test("macOS update installation preserves the canonical App directory name", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "openglance-mac-update-path-"));
  const paths = macUpdateCachePaths({ homeDir });
  const stagedDirectory = path.join(paths.updateRoot, "update.NEW5678");
  const stagedApp = path.join(stagedDirectory, "OpenGlance.app");
  const targetApp = path.join(homeDir, "Applications", "OpenGlance.app");
  await Promise.all([
    mkdir(stagedApp, { recursive: true }),
    mkdir(targetApp, { recursive: true }),
  ]);
  const request = {
    launchAfterInstallation: true,
    updateBundleURL: pathToFileURL(stagedApp).href,
    targetBundleURL: pathToFileURL(targetApp).href,
    bundleIdentifier: "com.mangofuture.gitleaf",
    useUpdateBundleName: true,
  };
  await writeFile(paths.stateFile, JSON.stringify(request));

  const result = await prepareMacUpdateAppPath({
    homeDir,
    targetAppPath: targetApp,
    now: () => 123,
    processId: 456,
  });
  const persisted = JSON.parse(await readFile(paths.stateFile, "utf8"));

  assert.equal(result.targetAppPath, targetApp);
  assert.equal(result.stagedDirectory, stagedDirectory);
  assert.equal(result.useUpdateBundleName, false);
  assert.deepEqual(persisted, {
    ...request,
    useUpdateBundleName: false,
  });
  assert.deepEqual(
    (await readdir(paths.updateRoot)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("macOS update installs Contents at the legacy path before the new App migrates its name", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "openglance-mac-update-rename-"));
  const paths = macUpdateCachePaths({ homeDir });
  const stagedDirectory = path.join(paths.updateRoot, "update.NEW5678");
  const stagedApp = path.join(stagedDirectory, "OpenGlance.app");
  const targetApp = path.join(homeDir, "Applications", "Git Leaf.app");
  await Promise.all([
    mkdir(stagedApp, { recursive: true }),
    mkdir(targetApp, { recursive: true }),
  ]);
  await writeFile(paths.stateFile, JSON.stringify({
    updateBundleURL: pathToFileURL(stagedApp).href,
    targetBundleURL: pathToFileURL(targetApp).href,
    useUpdateBundleName: false,
  }));

  const result = await prepareMacUpdateAppPath({
    homeDir,
    targetAppPath: targetApp,
  });

  assert.equal(result.useUpdateBundleName, false);
  assert.equal(
    JSON.parse(await readFile(paths.stateFile, "utf8")).useUpdateBundleName,
    false,
  );
});

test("macOS update overrides an earlier executable-name rename request for the legacy App", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "openglance-mac-update-no-rename-"));
  const paths = macUpdateCachePaths({ homeDir });
  const stagedDirectory = path.join(paths.updateRoot, "update.NEW5678");
  const stagedApp = path.join(stagedDirectory, "OpenGlance.app");
  const targetApp = path.join(homeDir, "Applications", "Git Leaf.app");
  await Promise.all([
    mkdir(stagedApp, { recursive: true }),
    mkdir(targetApp, { recursive: true }),
  ]);
  await writeFile(paths.stateFile, JSON.stringify({
    updateBundleURL: pathToFileURL(stagedApp).href,
    targetBundleURL: pathToFileURL(targetApp).href,
    useUpdateBundleName: true,
  }));

  const result = await prepareMacUpdateAppPath({
    homeDir,
    targetAppPath: targetApp,
  });

  assert.equal(result.useUpdateBundleName, false);
  assert.equal(
    JSON.parse(await readFile(paths.stateFile, "utf8")).useUpdateBundleName,
    false,
  );
});

test("macOS update installation refuses to rewrite state for another App path", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "openglance-mac-update-path-"));
  const paths = macUpdateCachePaths({ homeDir });
  const stagedApp = path.join(paths.updateRoot, "update.NEW5678", "Git Leaf.app");
  const targetApp = path.join(homeDir, "Applications", "Git Leaf.app");
  await mkdir(stagedApp, { recursive: true });
  await writeFile(paths.stateFile, JSON.stringify({
    updateBundleURL: pathToFileURL(stagedApp).href,
    targetBundleURL: pathToFileURL(targetApp).href,
    useUpdateBundleName: true,
  }));

  await assert.rejects(
    prepareMacUpdateAppPath({
      homeDir,
      targetAppPath: path.join(homeDir, "Applications", "OpenGlance.app"),
    }),
    /targets another App path/,
  );
  assert.equal(
    JSON.parse(await readFile(paths.stateFile, "utf8")).useUpdateBundleName,
    true,
  );
});

test("macOS update installation requires a direct App bundle in the ShipIt package", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "openglance-mac-update-path-"));
  const paths = macUpdateCachePaths({ homeDir });
  const stagedBundle = path.join(paths.updateRoot, "update.NEW5678", "payload");
  const targetApp = path.join(homeDir, "Applications", "Git Leaf.app");
  await Promise.all([
    mkdir(stagedBundle, { recursive: true }),
    mkdir(targetApp, { recursive: true }),
  ]);
  await writeFile(paths.stateFile, JSON.stringify({
    updateBundleURL: pathToFileURL(stagedBundle).href,
    targetBundleURL: pathToFileURL(targetApp).href,
    useUpdateBundleName: true,
  }));

  await assert.rejects(
    prepareMacUpdateAppPath({ homeDir, targetAppPath: targetApp }),
    /outside the official ShipIt cache/,
  );
});

test("macOS update cache keeps only the package staged by ShipIt", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "git-leaf-mac-update-cache-"));
  const paths = macUpdateCachePaths({ homeDir });
  const stale = path.join(paths.updateRoot, "update.OLD1234");
  const current = path.join(paths.updateRoot, "update.NEW5678");
  const unrelated = path.join(paths.updateRoot, "logs");
  await Promise.all([
    mkdir(path.join(stale, "OpenGlance.app"), { recursive: true }),
    mkdir(path.join(current, "OpenGlance.app"), { recursive: true }),
    mkdir(unrelated, { recursive: true }),
  ]);
  await writeFile(paths.stateFile, JSON.stringify({
    updateBundleURL: pathToFileURL(path.join(current, "OpenGlance.app")).href,
  }));

  const result = await pruneObsoleteMacUpdatePackages({ homeDir });

  assert.equal(result.preserved, current);
  assert.deepEqual(result.removed, [stale]);
  assert.equal(result.complete, true);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(current), true);
  assert.equal(existsSync(unrelated), true);
});

test("macOS update cache rechecks ShipIt state before removing each package", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "git-leaf-mac-update-cache-race-"));
  const paths = macUpdateCachePaths({ homeDir });
  const oldPackage = path.join(paths.updateRoot, "update.A-OLD");
  const newPackage = path.join(paths.updateRoot, "update.B-NEW");
  await Promise.all([
    mkdir(path.join(oldPackage, "OpenGlance.app"), { recursive: true }),
    mkdir(path.join(newPackage, "OpenGlance.app"), { recursive: true }),
  ]);
  let reads = 0;
  const readFileFn = async () => JSON.stringify({
    updateBundleURL: pathToFileURL(path.join(
      reads++ === 0 ? oldPackage : newPackage,
      "OpenGlance.app",
    )).href,
  });
  const readdirFn = async () => [
    { name: "update.A-OLD", isDirectory: () => true },
    { name: "update.B-NEW", isDirectory: () => true },
  ];

  const result = await pruneObsoleteMacUpdatePackages({
    homeDir,
    readFileFn,
    readdirFn,
  });

  assert.equal(result.preserved, newPackage);
  assert.deepEqual(result.removed, [oldPackage]);
  assert.equal(result.complete, true);
  assert.equal(existsSync(oldPackage), false);
  assert.equal(existsSync(newPackage), true);
});

test("macOS update cache reports incomplete pruning without removing the staged package", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "git-leaf-mac-update-cache-busy-"));
  const paths = macUpdateCachePaths({ homeDir });
  const stale = path.join(paths.updateRoot, "update.OLD1234");
  const current = path.join(paths.updateRoot, "update.NEW5678");
  await Promise.all([
    mkdir(stale, { recursive: true }),
    mkdir(path.join(current, "OpenGlance.app"), { recursive: true }),
  ]);
  await writeFile(paths.stateFile, JSON.stringify({
    updateBundleURL: pathToFileURL(path.join(current, "OpenGlance.app")).href,
  }));

  const result = await pruneObsoleteMacUpdatePackages({
    homeDir,
    removeFn: async () => {
      throw new Error("cache busy");
    },
  });

  assert.equal(result.complete, false);
  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(stale), true);
  assert.equal(existsSync(current), true);
});

test("macOS update cache fails closed when ShipIt state points outside its cache", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "git-leaf-mac-update-cache-"));
  const paths = macUpdateCachePaths({ homeDir });
  const staged = path.join(paths.updateRoot, "update.KEEP123");
  await mkdir(staged, { recursive: true });
  await writeFile(paths.stateFile, JSON.stringify({
    updateBundleURL: pathToFileURL(path.join(homeDir, "elsewhere", "OpenGlance.app")).href,
  }));

  assert.deepEqual(await pruneObsoleteMacUpdatePackages({ homeDir }), {
    preserved: "",
    removed: [],
    complete: false,
  });
  assert.equal(existsSync(staged), true);
});
