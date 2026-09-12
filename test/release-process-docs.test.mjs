import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release documentation exposes the dual-track build and publication boundaries", async () => {
  const releaseDoc = await readFile("docs/release.md", "utf8");
  const exampleProfile = JSON.parse(
    await readFile("docs/release-profile.example.json", "utf8"),
  );

  assert.match(releaseDoc, /safe default is always `source \+ source \+ false`/);
  assert.match(releaseDoc, /Community Build must not query or download from Mango Future's update service/);
  assert.match(releaseDoc, /`org\.openglance\.community`/);
  assert.match(releaseDoc, /`OpenGlance Community`/);
  assert.match(releaseDoc, /`official \+ public` \| `stable` \| `false`/);
  assert.match(releaseDoc, /`official \+ internal` \| `internal-stable` \| `true`/);
  assert.match(releaseDoc, /Versions and Git tags are global across both official tracks/);
  assert.match(releaseDoc, /never reuse one version for public and internal builds/);
  assert.match(
    releaseDoc,
    /a packaged app trusts its embedded track and cannot be moved to another track by an environment variable/,
  );
  assert.match(releaseDoc, /must preserve it/);
  assert.match(releaseDoc, /frozen release worktree controller/);
  assert.match(releaseDoc, /same frozen `RELEASE_COMMIT`/);
  assert.match(releaseDoc, /--track internal/);
  assert.match(releaseDoc, /internal-candidate/);
  assert.match(releaseDoc, /internal-stable/);
  assert.match(releaseDoc, /Internal 1\.11\.3 migration bridge/);
  assert.match(releaseDoc, /mark-public-download-isolation-verified/);
  assert.match(releaseDoc, /exact same signed internal artifacts to legacy `stable`/);
  assert.match(
    releaseDoc,
    /public `\/download` page must require an explicit public release track and ignore internal or legacy/,
  );
  assert.match(releaseDoc, /`\/open` and `\/share` pages remain deep-link transit/);
  assert.match(releaseDoc, /legacyInternalMigrationConfirmed/);
  assert.match(releaseDoc, /Windows is currently distributed as an unsigned Preview ZIP/);
  assert.match(releaseDoc, /secret scanner/);
  assert.match(releaseDoc, /packages exclude `\.agents\/`, `docs\/`, `test\/`, `dist\/`, `\.git\/`/);
  assert.match(releaseDoc, /must never contain:[\s\S]*Apple credentials or private keys/);
  assert.match(
    releaseDoc,
    /security unlock-keychain ~\/Library\/Keychains\/login\.keychain-db/,
  );
  assert.match(releaseDoc, /approved Keychain that actually holds the release private key/);
  assert.match(releaseDoc, /If the key is stored in another approved Keychain, unlock that Keychain instead/);
  assert.match(releaseDoc, /only a successful[\s\S]*disposable signature proves recovery/);
  assert.match(releaseDoc, /Developer ID signing access and the `notarytool` Keychain profile are independent gates/);
  assert.doesNotMatch(
    releaseDoc,
    /unlock-keychain -p|UPDATE_REMOTE_HOST="/,
  );

  assert.equal(exampleProfile.distribution, "official");
  assert.equal(exampleProfile.releaseTrack, "public");
  assert.equal(exampleProfile.legacyInternalMigrationConfirmed, true);
  assert.equal(exampleProfile.usageAnalyticsDefault, false);
  assert.equal(exampleProfile.updateChannel, "stable");
  assert.match(exampleProfile.updateRemoteRoot, /^\/srv\//);
});

test("repository release skill remains a thin public router", async () => {
  const releaseSkill = (await readFile(".agents/skills/openglance-release/SKILL.md", "utf8")).replace(
    /\r\n?/g,
    "\n",
  );
  const body = releaseSkill.replace(/^---\n[\s\S]*?\n---\n/, "");
  const bodyWordCount = body.trim().split(/\s+/).length;

  assert.match(releaseSkill, /^---\nname: openglance-release\n/m);
  assert.match(releaseSkill, /`docs\/release\.md` as the sole release policy/);
  assert.match(releaseSkill, /`scripts\/release-worktree\.mjs` as the formal state machine/);
  assert.ok(bodyWordCount <= 300, `release skill should remain a thin router, got ${bodyWordCount} words`);
  assert.doesNotMatch(releaseSkill, /\/Users\/|\/home\/|infra-ops|official-(?:public|internal)\.json/);
});

test("release documentation requires GitHub-hosted Windows smoke evidence before every stable release", async () => {
  const releaseDoc = await readFile("docs/release.md", "utf8");

  assert.match(releaseDoc, /`npm run test:ci:win` is a local preflight check only/);
  assert.match(releaseDoc, /cannot replace the Windows GitHub Actions/);
  assert.match(releaseDoc, /Every formal stable release requires a successful Windows GitHub Actions smoke run/);
  assert.match(releaseDoc, /every macOS and Windows official stable publication/);
  assert.match(releaseDoc, /`Windows Release Smoke` workflow run/);
  assert.match(releaseDoc, /`completed` status with a `success` conclusion/);
  assert.match(releaseDoc, /`openglance\/openglance` repository/);
  assert.match(releaseDoc, /uses `\.github\/workflows\/windows-release-smoke\.yml`/);
  assert.match(releaseDoc, /head SHA exactly equals the frozen `RELEASE_COMMIT`/);
  assert.match(
    releaseDoc,
    /non-expired, non-empty smoke artifact whose name ends with that exact frozen commit/,
  );
  assert.match(
    releaseDoc,
    /node scripts\/release-worktree\.mjs verify-windows-release-smoke --run-id <RUN_ID>/,
  );
  assert.match(releaseDoc, /controller rejects stable publication when this evidence is missing/);
  assert.match(releaseDoc, /built from a different commit/);
  assert.match(releaseDoc, /not risk-based, optional, or limited to/);
  assert.match(releaseDoc, /Windows-only changes/);
});

test("release documentation delegates UI acceptance and keeps update regression separate", async () => {
  const releaseDoc = await readFile("docs/release.md", "utf8");

  assert.match(releaseDoc, /UI-specific acceptance for UI changes and user-reported UI bugs is governed by `AGENTS\.md`/);
  assert.match(releaseDoc, /before freezing the release commit/);
  assert.match(releaseDoc, /formal release operator does[\s\S]*not repeat it/);
  assert.doesNotMatch(releaseDoc, /make smoke-dev-mac|Computer Use/);
  assert.match(releaseDoc, /Update-sensitive changes can make a real packaged-App update regression mandatory/);
  assert.match(releaseDoc, /must run on the release Mac/);
  assert.match(releaseDoc, /npm run release:verify-update:mac/);
  assert.match(releaseDoc, /refuses to start while an installed OpenGlance or Git Leaf App is running/);
  assert.match(releaseDoc, /completed dormant registration/);
  assert.match(releaseDoc, /never manually unloads or boots out a production job/);
  assert.match(releaseDoc, /cleanup preserves the original registration unchanged/);
  assert.match(releaseDoc, /real Profile and real ShipIt cache fingerprints did not change/);
  assert.match(releaseDoc, /verify-macos-update-regression[\s\S]*--evidence/);
  assert.doesNotMatch(releaseDoc, /mark-update-regression-verified\s*$/m);
});

test("release documentation verifies published artifacts end to end without duplicate workstation downloads", async () => {
  const releaseDoc = await readFile("docs/release.md", "utf8");

  assert.match(releaseDoc, /online candidate manifest must match its local staged manifest exactly/);
  assert.match(releaseDoc, /every artifact must be read in full through its official HTTPS URL/);
  assert.match(releaseDoc, /streaming all bytes into a[\s\S]*SHA-256 digest and byte count/);
  assert.match(releaseDoc, /streaming check may run on a trusted Gateway C/);
  assert.match(releaseDoc, /does not require[\s\S]*copying the large artifact back to the release workstation/);
  assert.match(
    releaseDoc,
    /SHA-256 and size must match the online manifest, the local build artifact, and the exact[\s\S]*file stored on Gateway C/,
  );
  assert.match(releaseDoc, /embedded build identity, `codesign`, `stapler`, and Gatekeeper/);
  assert.match(releaseDoc, /locally[\s\S]*retained immutable ZIP and DMG whose SHA-256 matches/);
  assert.match(releaseDoc, /without a second large-file[\s\S]*transfer/);
});

test("release documentation requires verified local artifact retention before finish cleanup", async () => {
  const releaseDoc = await readFile("docs/release.md", "utf8");

  assert.match(releaseDoc, /`finish` is also the local artifact-retention gate/);
  assert.match(releaseDoc, /dist\/releases\/v<version>\//);
  assert.match(releaseDoc, /macOS universal DMG and ZIP, the Windows x64 ZIP/);
  assert.match(releaseDoc, /macOS `releases\.json` plus ARM migration manifests/);
  assert.match(releaseDoc, /public release the physical stable channel is `stable`/);
  assert.match(releaseDoc, /internal release it is\s+`internal-stable`/);
  assert.match(releaseDoc, /stable artifact\s+URL coordinates, and the auto-updater ZIP URL/);
  assert.match(
    releaseDoc,
    /compares its SHA-256\s+and size with the stable manifest and checksum file/,
  );
  assert.match(releaseDoc, /missing or\s+mismatched file makes `finish` fail without deleting/);
  assert.match(releaseDoc, /conflicting files are never\s+overwritten/);
  assert.match(releaseDoc, /`dist\/` remains Git-ignored and local-only/);
});
