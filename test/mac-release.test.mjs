import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_RELEASE_OPTIONS,
  applyMacBundleIcon,
  applyMacBundleProductName,
  applyMacBundleProtocols,
  assertMacUpdateArchiveEntries,
  assertDevelopmentSmokeUserDataPath,
  assertDevelopmentUserDataIsolation,
  cleanupDevelopmentSmokeUserData,
  codesignArgs,
  dmgLocaleFromValue,
  dmgTextForLocale,
  devInstallSteps,
  devSmokeSteps,
  developmentProfileFingerprint,
  developmentPackageCleanupPlan,
  developmentAppQuitCommands,
  developmentAppForceQuitCommands,
  developmentAppProcessQueries,
  electronCacheZipDir,
  electronPackagerArgs,
  ensureReleaseSigningIdentityAccess,
  launchDevelopmentAppCommand,
  macCommandRequiresNewReleaseVersion,
  macDevelopmentInstallOptions,
  macDevelopmentUserDataPaths,
  macBundleIconPaths,
  macDevelopmentInstallPaths,
  macDmgLayoutPaths,
  macEntitlementsPath,
  macExecutableName,
  macUpdateMetadataPaths,
  macReleasePaths,
  dmgBackgroundSvg,
  dmgFinderLayoutScript,
  dmgStagingVolumeName,
  nestedMachOSigningTargets,
  prepareDevelopmentUserData,
  releaseSteps,
  runReleaseCommand,
  runDevelopmentSmokeWorkflow,
  stageMacUpdateMetadata,
  universalMachOVerificationCommand,
  verifyProductionProfileUnchanged,
} from "../scripts/release-mac.mjs";

test("internal macOS packages preserve the Git Leaf executable accepted by shipped updaters", () => {
  assert.equal(macExecutableName({
    appName: "OpenGlance",
    distribution: "official",
    releaseTrack: "internal",
  }), "Git Leaf");
  assert.equal(macExecutableName({
    appName: "OpenGlance",
    distribution: "official",
    releaseTrack: "public",
  }), "OpenGlance");
  assert.equal(macExecutableName({
    appName: "OpenGlance",
    distribution: "source",
  }), "OpenGlance");
  assert.equal(assertMacUpdateArchiveEntries([
    "OpenGlance.app/",
    "OpenGlance.app/Contents/",
    "OpenGlance.app/Contents/MacOS/Git Leaf",
  ], {
    appName: "OpenGlance",
    distribution: "official",
    releaseTrack: "internal",
  }), "OpenGlance.app/");
  assert.throws(() => assertMacUpdateArchiveEntries([
    "Git Leaf.app/Contents/MacOS/OpenGlance",
  ], {
    appName: "OpenGlance",
    distribution: "official",
    releaseTrack: "internal",
  }), /must contain only OpenGlance\.app/);
});

function assertSafeSigningKeychainRecovery(error) {
  assert.match(error.message, /approved Keychain that actually holds the release private key/);
  assert.match(
    error.message,
    /security unlock-keychain ~\/Library\/Keychains\/login\.keychain-db/,
  );
  assert.match(error.message, /if it uses another approved Keychain, unlock that Keychain instead/);
  assert.match(error.message, /rerun `run mac check-prereqs`/);
  assert.doesNotMatch(error.message, /unlock-keychain -p/);
  return true;
}

test("mac release prerequisites prove the exact identity can sign without unlocking keychains", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-signing-prereq-test-"));
  const probeSource = path.join(temporaryRoot, "probe-source");
  await writeFile(probeSource, "probe");
  const calls = [];
  const identity = "Developer ID Application: Example Corp (EXAMPLE123)";
  const result = ensureReleaseSigningIdentityAccess({
    identity,
    probeSource,
    temporaryRoot,
    runCommand(command, args) {
      calls.push([command, args]);
      if (command === "security") {
        return { status: 0, stdout: `1) HASH "${identity}"\n`, stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(result.identity, identity);
  assert.equal(result.probeVerified, true);
  assert.deepEqual(calls[0], [
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
  ]);
  assert.deepEqual(calls[1].slice(0, 1), ["codesign"]);
  assert.deepEqual(calls[1][1].slice(0, -1), ["--force", "--sign", identity]);
  assert.match(calls[1][1].at(-1), /openglance-release-signing-.*\/codesign-probe$/);
  assert.deepEqual(calls[2].slice(0, 1), ["codesign"]);
  assert.deepEqual(
    calls[2][1].slice(0, -1),
    ["--verify", "--strict", "--verbose=2"],
  );
  assert.equal(calls[2][1].at(-1), calls[1][1].at(-1));
  assert.deepEqual(await readdir(temporaryRoot), ["probe-source"]);
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("mac release prerequisites route an identity inspection failure through safe Keychain recovery", () => {
  assert.throws(
    () => ensureReleaseSigningIdentityAccess({
      identity: "Developer ID Application: Example Corp (EXAMPLE123)",
      runCommand: () => ({
        status: 51,
        stdout: "",
        stderr: "The user name or passphrase you entered is not correct.",
      }),
    }),
    (error) => {
      assert.match(error.message, /Unable to inspect Developer ID signing identities/);
      return assertSafeSigningKeychainRecovery(error);
    },
  );
});

test("mac release prerequisites route a missing signing identity through safe Keychain recovery", () => {
  assert.throws(
    () => ensureReleaseSigningIdentityAccess({
      identity: "Developer ID Application: Missing",
      runCommand: () => ({ status: 0, stdout: "0 valid identities found\n", stderr: "" }),
    }),
    (error) => {
      assert.match(error.message, /identity not found/);
      return assertSafeSigningKeychainRecovery(error);
    },
  );
});

test("mac release prerequisites report private-key denial and remove the temporary probe", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-signing-prereq-test-"));
  const probeSource = path.join(temporaryRoot, "probe-source");
  await writeFile(probeSource, "probe");
  const identity = "Developer ID Application: Example Corp (EXAMPLE123)";

  assert.throws(
    () => ensureReleaseSigningIdentityAccess({
      identity,
      probeSource,
      temporaryRoot,
      runCommand(command) {
        if (command === "security") {
          return { status: 0, stdout: `1) HASH "${identity}"\n`, stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "errSecInternalComponent" };
      },
    }),
    (error) => {
      assert.match(error.message, /private key could not sign.*errSecInternalComponent/);
      return assertSafeSigningKeychainRecovery(error);
    },
  );
  assert.deepEqual(await readdir(temporaryRoot), ["probe-source"]);
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("mac release package args exclude tests and generated outputs", () => {
  const args = electronPackagerArgs({
    appName: "OpenGlance",
    version: "1.9.1",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
  });

  assert.ok(args.includes("--protocol=openglance"));
  assert.ok(args.includes("--protocol-name=OpenGlance Document"));
  assert.ok(args.includes("--arch=universal"));
  assert.ok(args.includes("--executable-name=OpenGlance"));
  assert.ok(args.includes("--app-version=1.9.1"));

  const ignoreValues = args
    .filter((arg) => arg.startsWith("--ignore="))
    .map((arg) => arg.slice("--ignore=".length));

  assert.ok(
    ignoreValues.includes("^/test($|/)"),
    "release packaging must exclude test files from app.asar",
  );
  assert.ok(ignoreValues.includes("^/dist($|/)"));
  assert.ok(ignoreValues.includes("^/\\.git($|/)"));
});

test("internal mac release package args retain the Git Leaf compatibility executable", () => {
  const args = electronPackagerArgs({
    appName: "OpenGlance",
    distribution: "official",
    releaseTrack: "internal",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
  });

  assert.ok(args.includes("--executable-name=Git Leaf"));
});

test("mac release package args exclude internal docs, repository tools, and dev-only dependencies", () => {
  const args = electronPackagerArgs({
    appName: "OpenGlance",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
  });
  const ignorePatterns = args
    .filter((arg) => arg.startsWith("--ignore="))
    .map((arg) => new RegExp(arg.slice("--ignore=".length)));
  const isIgnored = (filePath) => ignorePatterns.some((pattern) => pattern.test(filePath));

  for (const filePath of [
    "/scripts/release-mac.mjs",
    "/tools/generate-openglance-open-link.mjs",
    "/Makefile",
    "/AGENTS.md",
    "/CLAUDE.md",
    "/CHANGELOG.md",
    "/CONTRIBUTING.md",
    "/README.zh-CN.md",
    "/SECURITY.md",
    "/docs/architecture.md",
    "/docs/release.md",
    "/docs/mdx-lite-guide.md",
    "/docs/mdx-lite-components-demo.mdx",
    "/docs/windows-portable-guide.md",
    "/docs/app-usage-analytics-spec.md",
    "/.superpowers/brainstorm/demo/content/index.html",
    "/.gitignore",
    "/.gitleaks.toml",
    "/.github/workflows/windows-release-smoke.yml",
    "/.agents/skills/openglance-release/SKILL.md",
    "/assets/icons/openglance.png",
    "/node_modules/@electron/get/package.json",
    "/node_modules/@electron-internal/extract-zip/package.json",
    "/node_modules/@esbuild/darwin-arm64/bin/esbuild",
    "/node_modules/@types/node/index.d.ts",
    "/node_modules/mermaid/package.json",
    "/node_modules/@lezer/css/test/test-css.js",
    "/node_modules/@lezer/markdown/test-markdown.js",
  ]) {
    assert.equal(isIgnored(filePath), true, `${filePath} should not be copied into app.asar`);
  }
});

test("mac release package args can reuse a local Electron zip cache", () => {
  const args = electronPackagerArgs({
    appName: "OpenGlance",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
    electronZipDir: "/Users/example/Library/Caches/electron/cache-id",
  });

  assert.ok(args.includes("--electron-zip-dir=/Users/example/Library/Caches/electron/cache-id"));
});

test("mac release package args include the OpenGlance app icon", () => {
  const args = electronPackagerArgs({
    appName: "OpenGlance",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
    iconPath: "assets/icons/openglance",
  });

  assert.ok(args.includes("--icon=assets/icons/openglance"));
});

test("mac release signing targets include Electron nested binaries notarization checks reject", () => {
  const targets = nestedMachOSigningTargets("Example.app");

  assert.deepEqual(targets.map(slashPath), [
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libGLESv2.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler",
    "Example.app/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt",
  ]);
});

test("mac release verification accepts universal Mach-O and rejects either missing architecture", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "openglance-arch-verification-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "Example App.app");
  await mkdir(path.join(app, "nested"), { recursive: true });
  await writeFile(path.join(app, "readme.txt"), "Not a Mach-O file\n");
  const source = path.join(root, "probe.c");
  await writeFile(source, "int probe(void) { return 0; }\n");
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  for (const arch of ["arm64", "x86_64"]) {
    run("xcrun", ["clang", "-arch", arch, "-c", source, "-o", path.join(root, `${arch}.o`)]);
  }
  const target = path.join(app, "nested", "probe binary");
  run("lipo", ["-create", path.join(root, "arm64.o"), path.join(root, "x86_64.o"), "-output", target]);
  const [command, args] = universalMachOVerificationCommand(app);
  run(command, args);
  for (const arch of ["arm64", "x86_64"]) {
    await writeFile(target, await readFile(path.join(root, `${arch}.o`)));
    assert.notEqual(spawnSync(command, args, { encoding: "utf8" }).status, 0,
      `A ${arch}-only binary must fail the universal package gate`);
  }
});

test("mac release paths use friendly versioned artifact filenames", () => {
  const paths = macReleasePaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    version: "0.1.1",
  });

  assert.equal(slashPath(paths.appDir), "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app");
  assert.equal(
    slashPath(paths.dmgPath),
    "/repo/dist/OpenGlance-0.1.1-source-darwin-universal.dmg",
  );
  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/OpenGlance-0.1.1-source-darwin-universal.zip",
  );
});

test("mac internal release filenames cannot collide with the same public semver", () => {
  const paths = macReleasePaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    version: "0.1.1",
    releaseTrack: "internal",
    buildId: "93458e1.20260705T114700Z",
  });

  assert.equal(
    slashPath(paths.dmgPath),
    "/repo/dist/OpenGlance-0.1.1-internal-darwin-universal.dmg",
  );
  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/OpenGlance-0.1.1-internal-darwin-universal.zip",
  );
});

test("mac development install paths reuse friendly release artifact filenames", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    version: "0.1.2",
    buildId: "71560e5557a8.20260706T031909Z",
  });

  assert.equal(
    slashPath(paths.dmgPath),
    "/repo/dist/OpenGlance-0.1.2-source-darwin-universal.dmg",
  );
  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/OpenGlance-0.1.2-source-darwin-universal.zip",
  );
});

test("mac update metadata paths mirror the update service update directory shape", () => {
  const paths = macUpdateMetadataPaths({
    rootDir: "/repo",
    channel: "stable",
    platformKey: "darwin-arm64",
  });

  assert.equal(paths.updateDir, "/repo/dist/updates/git-leaf/stable/darwin-arm64");
  assert.equal(paths.latestJsonPath, "/repo/dist/updates/git-leaf/stable/darwin-arm64/latest.json");
  assert.equal(paths.releasesJsonPath, "/repo/dist/updates/git-leaf/stable/darwin-arm64/releases.json");
  assert.equal(paths.sha256Path, "/repo/dist/updates/git-leaf/stable/darwin-arm64/sha256sums.txt");
});

test("mac update staging keeps artifacts universal and publishes only an ARM migration manifest", async () => {
  const rootDir = await mkdtempPath("git-leaf-universal-update-");
  try {
    const dmgPath = path.join(rootDir, "OpenGlance-1.9.0-internal-darwin-universal.dmg");
    const zipPath = path.join(rootDir, "OpenGlance-1.9.0-internal-darwin-universal.zip");
    await writeFile(dmgPath, "universal dmg");
    await writeFile(zipPath, "universal zip");

    const { universalPaths, arm64MigrationPaths } = stageMacUpdateMetadata({
      appName: "OpenGlance",
      updateBaseUrl: "https://updates.mangofuture.com/git-leaf",
      updateChannel: "internal-stable",
      releaseTrack: "internal",
      version: "1.9.0",
      buildId: "build-1",
      commit: "abc123",
      builtAt: "2026-07-14T00:00:00.000Z",
    }, { dmgPath, zipPath }, { rootDir });

    assert.deepEqual((await readdir(universalPaths.updateDir)).sort(), [
      "OpenGlance-1.9.0-internal-darwin-universal.dmg",
      "OpenGlance-1.9.0-internal-darwin-universal.zip",
      "latest.json",
      "releases.json",
      "sha256sums.txt",
    ]);
    assert.deepEqual((await readdir(arm64MigrationPaths.updateDir)).sort(), [
      "latest.json",
      "releases.json",
    ]);

    const universalManifest = JSON.parse(await readFile(universalPaths.latestJsonPath, "utf8"));
    const migrationManifest = JSON.parse(await readFile(arm64MigrationPaths.latestJsonPath, "utf8"));
    assert.equal(universalManifest.platform, "darwin-universal");
    assert.equal(universalManifest.channel, "internal-stable");
    assert.equal(universalManifest.releaseTrack, "internal");
    assert.equal(universalManifest.buildId, "build-1.internal");
    assert.equal(migrationManifest.platform, "darwin-arm64");
    assert.equal(migrationManifest.releaseTrack, "internal");
    assert.equal(migrationManifest.files.zip.url, universalManifest.files.zip.url);
    assert.match(
      migrationManifest.files.zip.url,
      /\/internal-stable\/darwin-universal\/OpenGlance-1\.9\.0-internal-darwin-universal\.zip$/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("formal mac package fails closed before packaging when its release profile is absent", () => {
  assert.throws(
    () => runReleaseCommand("package", {
      formalRelease: true,
      distribution: "source",
      releaseTrack: "source",
      usageAnalyticsDefault: false,
    }),
    /Official release commands require OPENGLANCE_RELEASE_PROFILE/,
  );
});

test("mac bundle icon uses an OpenGlance resource name instead of the Electron default", () => {
  const paths = macBundleIconPaths({
    rootDir: "/repo",
    appDir: "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app",
    iconPath: "assets/icons/openglance",
  });

  assert.equal(slashPath(paths.sourceIconPath), "/repo/assets/icons/openglance.icns");
  assert.equal(paths.bundleIconFile, "openglance.icns");
  assert.equal(
    slashPath(paths.bundleIconPath),
    "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app/Contents/Resources/openglance.icns",
  );
});

test("mac bundle icon application refreshes the app bundle mtime for LaunchServices", async () => {
  const tempDir = await mkdtempPath("git-leaf-mac-icon-");
  try {
    const appDir = path.join(tempDir, "OpenGlance.app");
    const resourcesDir = path.join(appDir, "Contents", "Resources");
    await mkdir(resourcesDir, { recursive: true });
    await writeFile(
      path.join(appDir, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIconFile</key>
  <string>electron.icns</string>
</dict>
</plist>
`,
      "utf8",
    );
    const oldDate = new Date("2000-01-01T00:00:00.000Z");
    await utimes(appDir, oldDate, oldDate);

    applyMacBundleIcon({ iconPath: DEFAULT_RELEASE_OPTIONS.iconPath }, { appDir });

    const appStat = await stat(appDir);
    const infoPlist = await readFile(path.join(appDir, "Contents", "Info.plist"), "utf8");
    assert.match(infoPlist, /<string>openglance\.icns<\/string>/);
    assert.ok(
      appStat.mtimeMs > oldDate.getTime(),
      "the .app root mtime must change so macOS refreshes cached app icons",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("official internal mac bundle uses OpenGlance visibly without rewriting its executable", async () => {
  const tempDir = await mkdtempPath("openglance-mac-product-name-");
  try {
    const appDir = path.join(tempDir, "OpenGlance.app");
    const contentsDir = path.join(appDir, "Contents");
    await mkdir(contentsDir, { recursive: true });
    await writeFile(
      path.join(contentsDir, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Git Leaf</string>
  <key>CFBundleName</key><string>Git Leaf</string>
  <key>CFBundleExecutable</key><string>Git Leaf</string>
</dict></plist>
`,
      "utf8",
    );

    assert.equal(applyMacBundleProductName({ appName: "OpenGlance" }, { appDir }), "OpenGlance");
    const infoPlistPath = path.join(contentsDir, "Info.plist");
    const plistValue = (key) => spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print:${key}`, infoPlistPath],
      { encoding: "utf8" },
    ).stdout.trim();
    assert.equal(plistValue("CFBundleDisplayName"), "OpenGlance");
    assert.equal(plistValue("CFBundleName"), "OpenGlance");
    assert.equal(plistValue("CFBundleExecutable"), "Git Leaf");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mac bundle registers OpenGlance plus the Git Leaf 1.x URL scheme", async () => {
  const tempDir = await mkdtempPath("openglance-mac-protocols-");
  try {
    const appDir = path.join(tempDir, "OpenGlance.app");
    const contentsDir = path.join(appDir, "Contents");
    await mkdir(contentsDir, { recursive: true });
    await writeFile(
      path.join(contentsDir, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict></dict></plist>
`,
      "utf8",
    );

    assert.deepEqual(applyMacBundleProtocols({ appDir }), [{
      CFBundleURLName: "OpenGlance Document",
      CFBundleURLSchemes: ["openglance", "git-leaf"],
    }]);
    const infoPlist = await readFile(path.join(contentsDir, "Info.plist"), "utf8");
    assert.match(infoPlist, /<string>openglance<\/string>/);
    assert.match(infoPlist, /<string>git-leaf<\/string>/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mac release signing uses Electron hardened runtime entitlements", () => {
  const entitlementsPath = macEntitlementsPath({
    rootDir: "/repo",
    entitlementsPath: "assets/entitlements.mac.plist",
  });
  const args = codesignArgs("/repo/dist/OpenGlance.app", "Developer ID Application: Example", {
    entitlementsPath,
  });

  assert.deepEqual(args, [
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    "--entitlements",
    "/repo/assets/entitlements.mac.plist",
    "--sign",
    "Developer ID Application: Example",
    "/repo/dist/OpenGlance.app",
  ]);
});

test("mac release DMG signing does not use app entitlements", () => {
  const args = codesignArgs("/repo/dist/OpenGlance.dmg", "Developer ID Application: Example", {
    hardenedRuntime: false,
    entitlementsPath: "/repo/assets/entitlements.mac.plist",
  });

  assert.deepEqual(args, [
    "--force",
    "--timestamp",
    "--sign",
    "Developer ID Application: Example",
    "/repo/dist/OpenGlance.dmg",
  ]);
});

test("mac DMG layout stages the app and Finder background", () => {
  const paths = macReleasePaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    version: "1.2.3",
  });
  const layout = macDmgLayoutPaths(paths, { appName: "OpenGlance" });

  assert.equal(slashPath(layout.stageDir), "/repo/dist/OpenGlance-dmg-stage");
  assert.equal(slashPath(layout.stagedAppPath), "/repo/dist/OpenGlance-dmg-stage/OpenGlance.app");
  assert.equal(slashPath(layout.backgroundPngPath), "/repo/dist/OpenGlance-dmg-stage/.background/background.png");
  assert.equal(slashPath(layout.readWriteDmgPath), "/repo/dist/OpenGlance-dmg.rw.dmg");
});

test("mac DMG uses a unique staging volume name", () => {
  assert.equal(
    dmgStagingVolumeName({ appName: "OpenGlance", processId: 4242 }),
    "OpenGlance Installer 4242",
  );
});

test("mac DMG locale detection maps Chinese and English locale values", () => {
  assert.equal(dmgLocaleFromValue("zh-Hans_US"), "zh-Hans");
  assert.equal(dmgLocaleFromValue("zh_CN.UTF-8"), "zh-Hans");
  assert.equal(dmgLocaleFromValue("en_US.UTF-8"), "en");
});

test("mac DMG text is localized for Chinese builds", () => {
  assert.deepEqual(dmgTextForLocale({ appName: "OpenGlance", locale: "zh-Hans_US" }), {
    title: "安装 OpenGlance",
    instruction: "将 OpenGlance.app 拖到“应用程序”",
    applicationsLabel: "应用程序",
  });
});

test("mac DMG background gives users the drag-to-Applications instruction", () => {
  const svg = dmgBackgroundSvg({ appName: "OpenGlance" });

  assert.match(svg, /Install OpenGlance/);
  assert.match(svg, /Drag OpenGlance\.app to Applications/);
  assert.match(svg, /<path d="M336 176 L318 164 L318 188 Z"/);
});

test("mac DMG background uses Chinese copy for Chinese builds", () => {
  const svg = dmgBackgroundSvg({ appName: "OpenGlance", locale: "zh-Hans_US" });

  assert.match(svg, /安装 OpenGlance/);
  assert.match(svg, /将 OpenGlance\.app 拖到“应用程序”/);
});

test("mac DMG Finder layout positions app and Applications icons", () => {
  const script = dmgFinderLayoutScript({
    appName: "OpenGlance",
    mountPoint: "/repo/dist/OpenGlance-dmg-mount",
    backgroundPngPath: "/Volumes/OpenGlance/.background/background.png",
  }).join("\n");

  assert.match(script, /set applicationsFolder to folder "Applications" of startup disk/);
  assert.match(
    script,
    /set targetFolder to POSIX file "\/repo\/dist\/OpenGlance-dmg-mount" as alias/,
  );
  assert.match(script, /set targetWindow to container window of targetFolder/);
  assert.doesNotMatch(script, /tell disk/);
  assert.match(
    script,
    /make new alias file at targetFolder to applicationsFolder with properties \{name:"Applications"\}/,
  );
  assert.match(
    script,
    /set background picture of viewOptions to \(POSIX file "\/Volumes\/OpenGlance\/\.background\/background\.png" as alias\)/,
  );
  assert.match(script, /repeat with attempt from 1 to 20/);
  assert.match(
    script,
    /if \(exists item "OpenGlance\.app" of targetFolder\) and \(exists item "Applications" of targetFolder\) then exit repeat/,
  );
  assert.match(script, /delay 0\.25/);
  assert.match(script, /set position of item "OpenGlance\.app" of targetFolder to \{150, 190\}/);
  assert.match(script, /set position of item "Applications" of targetFolder to \{410, 190\}/);
  assert.match(script, /set icon size of viewOptions to 96/);
});

test("mac DMG Finder layout uses the localized Applications item name", () => {
  const script = dmgFinderLayoutScript({
    appName: "OpenGlance",
    locale: "zh-Hans_US",
    mountPoint: "/repo/dist/OpenGlance-dmg-mount",
  }).join("\n");

  assert.match(script, /set position of item "Applications" of targetFolder to \{410, 190\}/);
});

test("electron cache zip dir locates the matching cached Electron zip", () => {
  assert.equal(
    slashPath(electronCacheZipDir({
      homeDir: "/Users/example",
      version: "43.0.0",
      platform: "darwin",
      arch: "arm64",
      exists: (filePath) =>
        slashPath(filePath) ===
        "/Users/example/Library/Caches/electron/cache-id/electron-v43.0.0-darwin-arm64.zip",
      listDir: (dirPath) => {
        assert.equal(slashPath(dirPath), "/Users/example/Library/Caches/electron");
        return ["cache-id"];
      },
    })),
    "/Users/example/Library/Caches/electron/cache-id",
  );
});

test("release runs the full distribution sequence", () => {
  assert.deepEqual(releaseSteps, [
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
  ]);
});

test("mac formal distribution commands require an unpublished version", () => {
  for (const command of [
    "sign",
    "dmg",
    "notarize",
    "staple",
    "zip",
    "stage-updates",
    "publish-updates",
  ]) {
    assert.equal(macCommandRequiresNewReleaseVersion(command), true, command);
  }

  for (const command of [
    "check-version",
    "check-prereqs",
    "test",
    "package",
    "verify",
    "tag",
    "dev-install",
    "dev-smoke",
    "help",
  ]) {
    assert.equal(macCommandRequiresNewReleaseVersion(command), false, command);
  }

  assert.equal(macCommandRequiresNewReleaseVersion("sign", { dev: true }), false);
});

test("dev install updates the local Applications app and launches it", () => {
  assert.deepEqual(devInstallSteps, [
    "package",
    "quit-dev-app",
    "install-dev-app",
    "cleanup-dev-package",
    "refresh-dev-app-icon",
    "launch-dev-app",
  ]);
  assert.deepEqual(devSmokeSteps, [
    "validate-smoke-user-data",
    "package",
    "prepare-dev-user-data",
    "install-dev-app",
    "cleanup-dev-package",
    "launch-dev-app-and-wait",
    "verify-production-profile",
    "cleanup-smoke-user-data",
  ]);

  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    applicationsDir: "/Applications",
    exists: () => false,
  });

  assert.equal(slashPath(paths.appDir), "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app");
  assert.equal(slashPath(paths.installedAppDir), "/Applications/OpenGlance.app");
});

test("human dev launch shares the real profile while Agent smoke is explicitly isolated", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    applicationsDir: "/Applications",
    exists: () => false,
  });
  assert.deepEqual(launchDevelopmentAppCommand(paths), [
    "open",
    ["-n", "/Applications/OpenGlance.app"],
  ]);
  assert.deepEqual(macDevelopmentUserDataPaths({
    homeDir: "/Users/test",
    devUserDataDir: "/tmp/git-leaf-agent-smoke",
  }), {
    productionUserDataDir: "/Users/test/Library/Application Support/git-leaf",
    devUserDataDir: "/tmp/git-leaf-agent-smoke",
  });
});

test("development install migrates an existing Git Leaf app to the canonical path", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    applicationsDir: "/Applications",
    exists: (value) => value === "/Applications/Git Leaf.app",
  });

  assert.equal(paths.canonicalInstalledAppDir, "/Applications/OpenGlance.app");
  assert.equal(paths.legacyInstalledAppDir, "/Applications/Git Leaf.app");
  assert.equal(paths.installedAppDir, "/Applications/OpenGlance.app");
});

test("development profile snapshot copies durable state and detects production mutation", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-dev-profile-");
  const paths = macDevelopmentUserDataPaths({ homeDir });
  await mkdir(path.join(paths.productionUserDataDir, "Local Storage", "leveldb"), { recursive: true });
  await mkdir(path.join(paths.productionUserDataDir, "Session Storage"), { recursive: true });
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.json"),
    JSON.stringify({ openRepoRoots: ["/repo/company-docs"], preferences: { colorMode: "dark" } }),
  );
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.backup.json"),
    JSON.stringify({ openRepoRoots: ["/repo/company-docs"] }),
  );
  await writeFile(
    path.join(paths.productionUserDataDir, "Local Storage", "leveldb", "000001.log"),
    "theme=dark",
  );
  await writeFile(
    path.join(paths.productionUserDataDir, "Session Storage", "000001.log"),
    "active-document=README.md",
  );
  await writeFile(path.join(paths.productionUserDataDir, "telemetry-queue.json"), "not copied");

  const before = developmentProfileFingerprint(paths);
  const snapshot = prepareDevelopmentUserData(paths);
  assert.deepEqual(snapshot.copiedEntries, [
    "desktop-config.json",
    "desktop-config.backup.json",
    "Local Storage",
    "Session Storage",
  ]);
  assert.equal(snapshot.sourceFingerprint.sha256, before.sha256);
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "desktop-config.json"), "utf8"),
    await readFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "utf8"),
  );
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "desktop-config.backup.json"), "utf8"),
    await readFile(path.join(paths.productionUserDataDir, "desktop-config.backup.json"), "utf8"),
  );
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "Local Storage", "leveldb", "000001.log"), "utf8"),
    "theme=dark",
  );
  await assert.rejects(
    readFile(path.join(paths.devUserDataDir, "telemetry-queue.json"), "utf8"),
    /ENOENT/,
  );
  const verification = verifyProductionProfileUnchanged(paths);
  assert.deepEqual(verification.productionFingerprint, before);
  assert.deepEqual(verification.sourceFingerprint, before);

  await writeFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "changed");
  assert.throws(
    () => verifyProductionProfileUnchanged(paths),
    /Production profile changed during development smoke/,
  );
});

test("Agent smoke snapshots the real profile and ignores a legacy manual dev profile", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-real-profile-smoke-");
  const productionUserDataDir = path.join(
    homeDir,
    "Library",
    "Application Support",
    "git-leaf",
  );
  const legacyDevUserDataDir = path.join(
    homeDir,
    "Library",
    "Application Support",
    "git-leaf-dev",
  );
  const smokePaths = macDevelopmentUserDataPaths({
    homeDir,
    devUserDataDir: path.join(homeDir, "smoke-profile"),
  });
  const productionConfig = {
    openRepoRoots: ["/repo/company-docs"],
    preferences: { colorMode: "light" },
  };
  const legacyDevelopmentConfig = {
    openRepoRoots: ["/repo/company-docs", "/repo/git-leaf", "/repo/content-repo"],
    preferences: { colorMode: "system" },
  };
  await mkdir(productionUserDataDir, { recursive: true });
  await mkdir(legacyDevUserDataDir, { recursive: true });
  await writeFile(
    path.join(productionUserDataDir, "desktop-config.json"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );
  await writeFile(
    path.join(legacyDevUserDataDir, "desktop-config.json"),
    `${JSON.stringify(legacyDevelopmentConfig, null, 2)}\n`,
  );

  const productionBefore = developmentProfileFingerprint(smokePaths);
  prepareDevelopmentUserData(smokePaths);

  assert.equal(
    await readFile(path.join(smokePaths.devUserDataDir, "desktop-config.json"), "utf8"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );
  assert.deepEqual(developmentProfileFingerprint(smokePaths), productionBefore);
  const verification = verifyProductionProfileUnchanged(smokePaths);
  assert.deepEqual(verification.productionFingerprint, productionBefore);
  assert.deepEqual(verification.sourceFingerprint, productionBefore);
});

test("development profile isolation rejects symlink aliases into production", {
  skip: process.platform === "win32" && "directory symlinks require elevated Windows privileges",
}, async () => {
  const rootDir = await mkdtempPath("git-leaf-mac-dev-symlink-");
  const productionUserDataDir = path.join(rootDir, "production");
  const productionAlias = path.join(rootDir, "production-alias");
  const devTarget = path.join(rootDir, "dev-target");
  const devSymlink = path.join(rootDir, "dev-link");
  await mkdir(productionUserDataDir);
  await mkdir(devTarget);
  const { symlink } = await import("node:fs/promises");
  await symlink(productionUserDataDir, productionAlias, "dir");
  await symlink(devTarget, devSymlink, "dir");

  assert.throws(
    () => assertDevelopmentUserDataIsolation({
      productionUserDataDir,
      devUserDataDir: path.join(productionAlias, "smoke"),
    }),
    /must be isolated/,
  );
  assert.throws(
    () => assertDevelopmentUserDataIsolation({ productionUserDataDir, devUserDataDir: devSymlink }),
    /symbolic-link user-data path/,
  );
});

test("development smoke path must be a logical and physical child of tmp before packaging", {
  skip: process.platform === "win32" && "directory symlinks require elevated Windows privileges",
}, async () => {
  const temporaryRoot = await mkdtempPath("git-leaf-mac-smoke-preflight-");
  const outsideRoot = await mkdtempPath("git-leaf-mac-smoke-outside-");
  const productionUserDataDir = path.join(outsideRoot, "production");
  const escapeAlias = path.join(temporaryRoot, "escape");
  await mkdir(productionUserDataDir);
  const { symlink } = await import("node:fs/promises");
  await symlink(outsideRoot, escapeAlias, "dir");

  assert.doesNotThrow(() => assertDevelopmentSmokeUserDataPath({
    productionUserDataDir,
    devUserDataDir: path.join(temporaryRoot, "smoke-profile"),
  }, { temporaryRoot }));
  assert.throws(
    () => assertDevelopmentSmokeUserDataPath({
      productionUserDataDir,
      devUserDataDir: path.join(escapeAlias, "smoke-profile"),
    }, { temporaryRoot }),
    /strict child of the temporary directory/,
  );
  assert.throws(
    () => assertDevelopmentSmokeUserDataPath({
      productionUserDataDir,
      devUserDataDir: temporaryRoot,
    }, { temporaryRoot }),
    /strict child of the temporary directory/,
  );
});

test("development profile staging failure preserves the previous dev snapshot", async () => {
  const rootDir = await mkdtempPath("git-leaf-mac-dev-swap-");
  const paths = {
    productionUserDataDir: path.join(rootDir, "production"),
    devUserDataDir: path.join(rootDir, "development"),
  };
  await mkdir(paths.productionUserDataDir);
  await mkdir(paths.devUserDataDir);
  await writeFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "new snapshot");
  await writeFile(path.join(paths.devUserDataDir, "old-snapshot.txt"), "keep me");

  let renameCount = 0;
  assert.throws(
    () => prepareDevelopmentUserData(paths, {
      rename: (sourcePath, destinationPath) => {
        renameCount += 1;
        if (renameCount === 2) {
          throw new Error("injected staging rename failure");
        }
        renameSync(sourcePath, destinationPath);
      },
    }),
    /injected staging rename failure/,
  );
  assert.equal(await readFile(path.join(paths.devUserDataDir, "old-snapshot.txt"), "utf8"), "keep me");
  assert.deepEqual(
    (await readdir(rootDir)).filter((entry) => entry.includes(".staging-") || entry.includes(".previous-")),
    [],
  );
});

test("one-time smoke cleanup requires a matching marker under the temporary root", async () => {
  const temporaryRoot = await mkdtempPath("git-leaf-mac-smoke-cleanup-");
  const paths = {
    productionUserDataDir: path.join(temporaryRoot, "production"),
    devUserDataDir: path.join(temporaryRoot, "smoke-profile"),
  };
  await mkdir(paths.productionUserDataDir);
  await writeFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "snapshot");
  prepareDevelopmentUserData(paths, { profileMode: "smoke" });

  const verifiedProductionFingerprint = verifyProductionProfileUnchanged(paths);
  assert.equal(cleanupDevelopmentSmokeUserData(paths, {
    temporaryRoot,
    verifiedProductionFingerprint,
  }).cleaned, true);
  await assert.rejects(stat(paths.devUserDataDir), /ENOENT/);

  await mkdir(paths.devUserDataDir);
  await writeFile(path.join(paths.devUserDataDir, "keep.txt"), "no marker");
  assert.throws(
    () => cleanupDevelopmentSmokeUserData(paths, { temporaryRoot }),
    /Missing development profile marker/,
  );
  assert.equal(await readFile(path.join(paths.devUserDataDir, "keep.txt"), "utf8"), "no marker");
});

test("smoke cleanup preserves diagnostics if the real profile changes after verification", async () => {
  const temporaryRoot = await mkdtempPath("git-leaf-mac-source-cleanup-");
  const productionUserDataDir = path.join(temporaryRoot, "production");
  await mkdir(productionUserDataDir);
  await writeFile(
    path.join(productionUserDataDir, "desktop-config.json"),
    JSON.stringify({ preferences: { colorMode: "light" } }),
  );
  const firstSmokePaths = {
    productionUserDataDir,
    devUserDataDir: path.join(temporaryRoot, "smoke-success"),
  };
  prepareDevelopmentUserData(firstSmokePaths);
  const firstVerification = verifyProductionProfileUnchanged(firstSmokePaths);
  assert.equal(cleanupDevelopmentSmokeUserData(firstSmokePaths, {
    temporaryRoot,
    verifiedProductionFingerprint: firstVerification,
  }).cleaned, true);
  await assert.rejects(stat(firstSmokePaths.devUserDataDir), /ENOENT/);

  const secondSmokePaths = {
    productionUserDataDir,
    devUserDataDir: path.join(temporaryRoot, "smoke-preserved"),
  };
  prepareDevelopmentUserData(secondSmokePaths);
  const secondVerification = verifyProductionProfileUnchanged(secondSmokePaths);
  await writeFile(
    path.join(productionUserDataDir, "desktop-config.json"),
    JSON.stringify({ preferences: { colorMode: "dark" } }),
  );

  assert.throws(
    () => cleanupDevelopmentSmokeUserData(secondSmokePaths, {
      temporaryRoot,
      verifiedProductionFingerprint: secondVerification,
    }),
    /Production profile changed after verification/i,
  );
  assert.equal((await stat(secondSmokePaths.devUserDataDir)).isDirectory(), true);
});

test("development smoke verifies before cleanup even when an earlier step fails", () => {
  const calls = [];
  assert.throws(
    () => runDevelopmentSmokeWorkflow({
      runStep: (step) => {
        calls.push(step);
        if (step === "launch-dev-app-and-wait") {
          throw new Error("injected launch failure");
        }
        if (step === "verify-production-profile") {
          return { sha256: "verified" };
        }
      },
    }),
    /injected launch failure/,
  );
  assert.deepEqual(calls, devSmokeSteps);
  assert.ok(
    calls.indexOf("verify-production-profile") < calls.indexOf("cleanup-smoke-user-data"),
  );
});

test("development smoke preflight stops before package", () => {
  const calls = [];
  assert.throws(
    () => runDevelopmentSmokeWorkflow({
      runStep: (step) => {
        calls.push(step);
        throw new Error("unsafe smoke path");
      },
    }),
    /unsafe smoke path/,
  );
  assert.deepEqual(calls, ["validate-smoke-user-data"]);
});

test("development smoke preserves its profile when production verification fails", () => {
  const calls = [];
  const verificationFailures = [];
  assert.throws(
    () => runDevelopmentSmokeWorkflow({
      runStep: (step) => {
        calls.push(step);
        if (step === "verify-production-profile") {
          throw new Error("production fingerprint changed");
        }
      },
      onVerificationFailure: (error) => verificationFailures.push(error.message),
    }),
    /production fingerprint changed/,
  );
  assert.deepEqual(calls, devSmokeSteps.slice(0, -1));
  assert.deepEqual(verificationFailures, ["production fingerprint changed"]);
  assert.equal(calls.includes("cleanup-smoke-user-data"), false);
});

test("dev install quits stale dist app and launches the installed Applications app", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    applicationsDir: "/Applications",
    exists: (value) => value === "/Applications/OpenGlance.app",
  });

  assert.deepEqual(developmentAppQuitCommands("OpenGlance", paths), [
    ["osascript", ["-e", "tell application \"OpenGlance\" to quit"]],
    ["osascript", ["-e", "tell application \"Git Leaf\" to quit"]],
    ["pkill", ["-x", "OpenGlance"]],
    ["pkill", ["-x", "Git Leaf"]],
    ["pkill", ["-f", "/Applications/OpenGlance.app"]],
    ["pkill", ["-f", "/Applications/Git Leaf.app"]],
    ["pkill", ["-f", "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app"]],
  ]);
  assert.deepEqual(developmentAppForceQuitCommands("OpenGlance", paths), [
    ["pkill", ["-9", "-x", "OpenGlance"]],
    ["pkill", ["-9", "-x", "Git Leaf"]],
    ["pkill", ["-9", "-f", "/Applications/OpenGlance.app"]],
    ["pkill", ["-9", "-f", "/Applications/Git Leaf.app"]],
    ["pkill", ["-9", "-f", "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app"]],
  ]);
  assert.deepEqual(developmentAppProcessQueries("OpenGlance", paths), [
    ["-x", "OpenGlance"],
    ["-x", "Git Leaf"],
    ["-f", "/Applications/OpenGlance.app"],
    ["-f", "/Applications/Git Leaf.app"],
    ["-f", "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app"],
  ]);
  assert.deepEqual(launchDevelopmentAppCommand(paths, {
    userDataDir: "/tmp/git-leaf-dev-smoke",
  }), [
    "open",
    [
      "-n",
      "/Applications/OpenGlance.app",
      "--args",
      "--openglance-dev-user-data-dir=/tmp/git-leaf-dev-smoke",
    ],
  ]);
  assert.deepEqual(launchDevelopmentAppCommand(paths, {
    userDataDir: "/tmp/git-leaf-agent-smoke",
    wait: true,
  }), [
    "open",
    [
      "-W",
      "-n",
      "/Applications/OpenGlance.app",
      "--args",
      "--openglance-dev-user-data-dir=/tmp/git-leaf-agent-smoke",
    ],
  ]);
  assert.deepEqual(launchDevelopmentAppCommand(paths, {
    userDataDir: "/tmp/git-leaf-agent-smoke",
    wait: true,
    repoRoot: "/tmp/git-leaf-tree-tooltip-smoke-123",
    file: "research/projects/long-document-name.md",
    remoteDebuggingPort: 9333,
  }), [
    "open",
    [
      "-W",
      "-n",
      "/Applications/OpenGlance.app",
      "--args",
      "--openglance-dev-user-data-dir=/tmp/git-leaf-agent-smoke",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9333",
      "--repo=/tmp/git-leaf-tree-tooltip-smoke-123",
      "--file=research/projects/long-document-name.md",
    ],
  ]);
  assert.throws(
    () => launchDevelopmentAppCommand(paths, {
      remoteDebuggingPort: 9333,
    }),
    /requires isolated user data/,
  );
  assert.throws(
    () => launchDevelopmentAppCommand(paths, {
      userDataDir: "/tmp/git-leaf-agent-smoke",
      remoteDebuggingPort: "not-a-port",
    }),
    /integer from 1024 to 65535/,
  );
  assert.throws(
    () => launchDevelopmentAppCommand(paths, {
      userDataDir: "/tmp/git-leaf-agent-smoke",
      repoRoot: "relative/repo",
    }),
    /absolute path/,
  );
  assert.throws(
    () => launchDevelopmentAppCommand(paths, {
      userDataDir: "/tmp/git-leaf-agent-smoke",
      repoRoot: "/tmp/repo",
      file: "../outside.md",
    }),
    /safe repository-relative path/,
  );
});

test("dev install removes the temporary packaged app after copying into Applications", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "OpenGlance",
    applicationsDir: "/Applications",
  });

  assert.deepEqual(
    developmentPackageCleanupPlan(paths, {
      lsregisterPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      lsregisterExists: () => true,
    }),
    {
      unregisterCommand: [
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        ["-u", "/repo/dist/OpenGlance-darwin-universal/OpenGlance.app"],
      ],
      removeDir: "/repo/dist/OpenGlance-darwin-universal",
    },
  );
});

test("dev install marks the same app identity as a development build", () => {
  const options = macDevelopmentInstallOptions({
    appName: "OpenGlance",
    bundleId: "org.openglance.community",
  });

  assert.deepEqual(options, {
    appName: "OpenGlance",
    bundleId: "org.openglance.community",
    dev: true,
  });
  assert.equal(
    macDevelopmentInstallPaths({
      rootDir: "/repo",
      applicationsDir: "/Applications",
      exists: () => false,
      ...options,
    }).installedAppDir,
    "/Applications/OpenGlance.app",
  );
});

test("Agent smoke installs inside its disposable Profile and never quits or registers the human app", () => {
  const profile = path.join(tmpdir(), "openglance-smoke-test", "profile");
  const options = macDevelopmentInstallOptions({
    smoke: true,
    devUserDataDir: profile,
    applicationsDir: "/Applications",
  });
  const paths = macDevelopmentInstallPaths(options);
  assert.equal(paths.installedAppDir, path.join(profile, "Applications", "OpenGlance.app"));
  assert.equal(devSmokeSteps.includes("quit-dev-app"), false);
  assert.equal(devSmokeSteps.includes("refresh-dev-app-icon"), false);
});

test("default release options use the Mango Future Developer ID profile", () => {
  assert.equal(
    DEFAULT_RELEASE_OPTIONS.identity,
    "Developer ID Application: Shenzhen Mango Future Technology Co., Ltd. (HN6X79BUSR)",
  );
  assert.equal(DEFAULT_RELEASE_OPTIONS.notaryProfile, "");
  assert.equal(DEFAULT_RELEASE_OPTIONS.iconPath, "assets/icons/openglance");
  assert.equal(DEFAULT_RELEASE_OPTIONS.entitlementsPath, "assets/entitlements.mac.plist");
  assert.equal(DEFAULT_RELEASE_OPTIONS.arch, "universal");
  assert.equal(DEFAULT_RELEASE_OPTIONS.bundleId, "org.openglance.community");
});

test("mac release version follows package.json", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(DEFAULT_RELEASE_OPTIONS.version, packageJson.version);
});

test("npm mac package script uses the release packager wrapper", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.scripts["package:mac"], "node scripts/release-mac.mjs package");
  assert.equal(packageJson.scripts["release:mac"], "node scripts/release-mac.mjs release");
  assert.equal(
    packageJson.scripts["publish:updates:mac"],
    "node scripts/release-mac.mjs publish-updates",
  );
  assert.equal(
    packageJson.scripts["install:mac:dev"],
    "node scripts/release-mac.mjs dev-install",
  );
  assert.equal(packageJson.scripts["test:ci:mac"], "node scripts/test-suite.mjs ci:mac");
});

test("Makefile exposes the local dev install app target", async () => {
  const makefile = await readFile("Makefile", "utf8");

  assert.match(makefile, /^install-dev-mac:/m);
  assert.match(makefile, /^\tnpm run install:mac:dev$/m);
  assert.match(makefile, /^smoke-dev-mac:/m);
  assert.match(makefile, /^\tnode scripts\/release-mac\.mjs dev-smoke$/m);
  assert.match(makefile, /^smoke-tree-tooltip-mac:/m);
  assert.match(makefile, /^\tnode scripts\/smoke-tree-tooltip-mac\.mjs$/m);
  assert.match(makefile, /^publish-updates-mac:/m);
  assert.match(
    makefile,
    /^OPENGLANCE_RELEASE_PROFILE \?= \$\(GIT_LEAF_RELEASE_PROFILE\)$/m,
  );
  assert.doesNotMatch(makefile, /^(?:UPDATE_REMOTE_HOST|UPDATE_REMOTE_ROOT|NOTARY_PROFILE) \?=/m);
});

function slashPath(value) {
  return value.replace(/\\/g, "/").replace(/^[A-Za-z]:(?=\/)/, "");
}

async function mkdtempPath(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}
