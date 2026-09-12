# OpenGlance release process

This document defines the public release contract. Mango Future's host names, deployment directories, credentials, and private release profiles are maintained outside this repository.

## Release tracks and build identities

Every newly packaged app contains `openglance-build-info.json` with three independent fields:

```json
{
  "distribution": "source",
  "releaseTrack": "source",
  "usageAnalyticsDefault": false
}
```

Supported identities:

| Identity | Update channel | Analytics default | Purpose |
| --- | --- | --- | --- |
| `source + source` | none | `false` | Community Build or local source build |
| `official + public` | `stable` | `false` | Public Mango Future release |
| `official + internal` | `internal-stable` | `true` | Company-internal Mango Future release |

`distribution` identifies the publisher class. `releaseTrack` identifies which official release lane an installed app follows. The two official tracks use separate manifests and artifacts; a packaged app trusts its embedded track and cannot be moved to another track by an environment variable.

The safe default is always `source + source + false`. Operating-system identities are track-specific:

| Identity | macOS Bundle ID | macOS executable | Windows compatibility executables |
| --- | --- | --- | --- |
| `source + source` | `org.openglance.community` | `OpenGlance` | none |
| `official + public` | `com.mangofuture.openglance` | `OpenGlance` | none |
| `official + internal` | `com.mangofuture.gitleaf` | `Git Leaf` | `Git Leaf.exe` |

On Windows, Community package metadata uses `OpenGlance Community`; both official tracks use the
Mango Future publisher identity.

All newly built Windows packages use `OpenGlance.exe` as the canonical executable. The extra file
exists only in internal packages so the baked-in 1.x updater can launch the migration. Build
metadata is informational and can be changed by anyone compiling the source. Official identity is
established by the Mango Future code signature, official download channel, SHA-256, release tag, and
matching public commit.

Version 3.0 changes the canonical name from Git Leaf to OpenGlance. Runtime readers accept
`git-leaf-build-info.json` / `GIT_LEAF_*` from 1.x after the canonical OpenGlance names. Every newly
prepared package writes only `openglance-build-info.json` and `OPENGLANCE_*`. The internal macOS Bundle
ID, ShipIt identity, `git-leaf` Profile directory, analytics schema, and update-service coordinates
remain stable for installed company users. Its hidden macOS executable also remains `Git Leaf`, because
shipped internal Git Leaf updaters and the source/development handoff clients in OpenPeek 2.0.0 and
OpenGlance 3.0.0-3.0.1 depend on that identity; the product name, bundle root, installer, and interface
remain OpenGlance. Earlier public packages were not
promoted, so future public and Community packages use clean OpenGlance-native Bundle IDs. GitHub
repository names use the canonical OpenGlance identity and preserve earlier URLs as redirects.

The analytics default is normally used only when initializing a new local setting. Once
`usageAnalyticsEnabled` exists in userData, an ordinary update must preserve it. The bounded
source-dev-to-internal handoff clears the development build's initialized value immediately before
installation so the target internal package applies its own embedded default; subsequent internal
updates preserve the resulting value. Release-track selection and telemetry eligibility are separate
contracts: an internal official build remains an official stable build even though its update channel
is `internal-stable`.

Telemetry event fields, version capability boundaries, privacy requirements, storage, and retention rules are defined only by `docs/app-usage-analytics-spec.md`.

## Versioning across tracks

`package.json` is the user-visible app version. Versions and Git tags are global across both official tracks:

- never reuse one version for public and internal builds;
- every new public or internal release must be newer than all previously published releases;
- an internal `1.11.3` release means the next public release must be at least `1.11.4`;
- one tag identifies one track-specific set of signed artifacts.

Use:

- `MAJOR` for incompatible runtime, update, data, or configuration changes;
- `MINOR` for new user-visible capabilities without breaking existing workflows;
- `PATCH` for fixes, small UX improvements, packaging corrections, and release-process fixes.

## Local release profiles

Company release commands require an absolute JSON profile path. The public shape is illustrated by [release-profile.example.json](release-profile.example.json); authoritative public and internal profiles live in the private operations repository.

An official profile must explicitly declare a matching track:

```json
{
  "distribution": "official",
  "releaseTrack": "public",
  "legacyInternalMigrationConfirmed": true,
  "usageAnalyticsDefault": false,
  "updateChannel": "stable"
}
```

or:

```json
{
  "distribution": "official",
  "releaseTrack": "internal",
  "usageAnalyticsDefault": true,
  "updateChannel": "internal-stable"
}
```

A release profile may contain non-secret environment parameters, but it must never contain:

- Apple credentials or private keys;
- SSH private keys or tokens;
- server passwords;
- signing certificates in exportable form.

The public profile's `legacyInternalMigrationConfirmed` flag is a reviewed operations gate, not a build default. It must remain `false` until company devices have completed the `1.11.2` to internal-track migration. Public `prepare` fails unless the frozen profile records `true`, preventing a later public release from replacing the legacy bridge prematurely.

Normal `package:mac`, `package:win`, and `portable:win` commands work without a profile and produce
Community Builds. A formal package, signature, publication, or release tag fails unless the frozen
official profile and track are present.

## Human and automation Profiles

The installed formal app and a development build installed for human use are the same App installation.
A new installation is `OpenGlance.app`; a development install copies the canonical App successfully
before removing an existing `Git Leaf.app`. All use the same real Electron Profile so replacing one build with
another preserves repositories, workbench sessions, favorites, language, and preferences. A packaged
`dev=true, source, source` build may perform only the one-way internal handoff defined below; the build
marker does not make it official, enable telemetry, or select a `git-leaf-dev` directory.

Agent-driven automated UI verification, when run as a separate development task, is the only macOS flow
that selects another Profile. It creates a one-time snapshot of the real Profile, passes its temporary
path explicitly as both `userData` and `sessionData`, verifies the real Profile after the App exits, and
then deletes only the snapshot. Its App bundle lives inside the snapshot's `Applications` directory;
smoke does not replace or quit the installed human App, refresh its Dock icon, or register default
protocol handlers. This automated UI verification remains outside the formal release gates.
It is a routine reversible verification step and does not require a separate maintainer confirmation
merely because the isolated development App is visible. When a harness requires an
`--allow-visible-app` intent flag, the automation supplies it as part of the already-authorized flow.

The historical persistent `git-leaf-dev` Profile can be merged once, with the App closed, using:

```bash
npm run migrate:mac:legacy-human-profile -- --apply
```

The migration validates the legacy manual marker, backs up both Profiles, merges repository and
workbench state with the human development state taking precedence, and preserves the old directory as
an additional recovery source.

## Verification

Before preparing a release:

```bash
npm ci
npm test
npm run docs:check
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

`npm run test:ci:win` is a local preflight check only. It cannot replace the Windows GitHub Actions
release gate described below because the formal gate requires evidence from a real GitHub-hosted Windows
runner for the exact frozen release commit.

If `src/client/source-editor.mjs` changed, also run:

```bash
npm run build:client
```

UI-specific acceptance for UI changes and user-reported UI bugs is governed by `AGENTS.md`. Complete that
acceptance in the development task before freezing the release commit. The formal release operator does
not repeat it.

## Community Builds

The concise contributor entry point is [Build OpenGlance from source](build-from-source.md). The commands
below are the packaging subset of that guide:

```bash
npm run package:mac
npm run package:win
```

Verify that packaged `openglance-build-info.json` contains:

```json
{
  "distribution": "source",
  "releaseTrack": "source",
  "usageAnalyticsDefault": false
}
```

A Community Build must not query or download from Mango Future's update service and must not create
telemetry state or send telemetry requests. It must also retain the Community Build operating-system
identity documented above; official identity is available only through a validated official profile.
This rule applies to distributable source packages with `dev=false`. A human development install has
the same source identity plus `dev=true` and the narrow handoff capability below; it is not a third
release track or Bundle ID.

### Human development handoff to internal

On macOS, a packaged human development install may return to the official internal build without a
manual download. Eligibility is fixed to:

- current build: packaged `dev=true, distribution=source, releaseTrack=source`;
- target: `distribution=official, releaseTrack=internal`, channel `internal-stable`;
- version rule: target version strictly greater than the current development version;
- preparation: automatic after validated discovery;
- installation: user-selected, nonprivileged direct-`Contents` replacement at the same App path.

No environment variable may select another packaged target. Community builds with `dev=false`, public
or candidate channels, Windows source packages, and unpackaged desktop runs remain ineligible.

Discovery validates the manifest track, channel, platform, semantic version, build ID, and commit. The
development App persists that complete target identity before automatically downloading the manifest's
exact internal ZIP. It verifies the ZIP's size and SHA-256, extracts it into a private update cache, and
verifies its official Bundle ID, Developer ID team, version, and embedded build identity. Preparing a
different target first removes the previous private cache, so only one complete handoff package remains.
The target must retain `CFBundleExecutable=Git Leaf`; this is an operating-system compatibility identity,
not a visible legacy product name.
Ordinary Squirrel feeds remain strictly newer-version-only.

When the package is ready and the user chooses installation, normal shutdown launches a detached
nonprivileged helper and exits. The helper waits for the dev main process and its remaining child
processes while excluding its own Electron-as-Node process, revalidates the persisted receipt, and
atomically removes both the receipt and the development build's explicit analytics value before a
transactional direct-`Contents` replacement. It confirms the signed internal App can relaunch before
discarding the rollback copy. A mismatch, write failure, replacement failure, or launch failure
restores the dev App and its previous receipt/analytics state. The newer signed internal package then
initializes from its embedded `usageAnalyticsDefault=true` before telemetry starts. An
internal-to-internal update does not use this exception.

## Formal official release

### Authorization boundary

An explicit maintainer request to perform a formal release is standing authorization to execute the complete standard release workflow in this document without pausing for step-by-step confirmation. That authorization expressly includes:

- building and packaging the macOS and Windows artifacts;
- signing the macOS App and DMG, uploading the unreleased DMG to Apple's notary service, waiting for the result, and stapling the ticket;
- publishing candidate, stable, and documented migration-bridge artifacts to the configured update server;
- downloading and verifying published artifacts, and running any isolated update regression required by the release gate;
- retaining the verified final stable packages, manifests, and checksums in the source checkout's local release archive;
- creating and pushing the release tag, then finishing the release controller state.

**Do not ask the maintainer to confirm any of these standard steps again, including the upload to Apple for notarization.** Pause only when the requested target, version, or release profile is materially ambiguous; when an action falls outside this documented workflow; or when recovery would require destructive credential or user-data changes.

Mango Future maintainers use the frozen release worktree controller. Prepare from a clean `main` synchronized with `origin/main`:

```bash
npm run release:prepare -- \
  --track internal \
  --profile /absolute/path/to/official-internal.json \
  --require-update-regression "first internal track release and legacy migration"
```

`prepare` records the canonical profile path and SHA-256, clears ambient release overrides, freezes the track, commit, version, build ID, and timestamp, creates a detached release worktree, then runs `npm ci` and `test:all`. Every later command revalidates the frozen state.

Inspect status:

```bash
node scripts/release-worktree.mjs status --remote
```

Run the platform build pipelines from the controller:

```bash
node scripts/release-worktree.mjs run mac check-version
node scripts/release-worktree.mjs run mac check-prereqs
node scripts/release-worktree.mjs run mac test
node scripts/release-worktree.mjs run mac package
node scripts/release-worktree.mjs run mac sign
node scripts/release-worktree.mjs run mac dmg
node scripts/release-worktree.mjs run mac notarize
node scripts/release-worktree.mjs run mac staple
node scripts/release-worktree.mjs run mac zip
node scripts/release-worktree.mjs run mac verify
node scripts/release-worktree.mjs run mac stage-updates --channel candidate

node scripts/release-worktree.mjs run windows check-version
node scripts/release-worktree.mjs run windows test
node scripts/release-worktree.mjs run windows package
node scripts/release-worktree.mjs run windows zip
node scripts/release-worktree.mjs run windows verify
node scripts/release-worktree.mjs run windows stage-updates --channel candidate
```

The macOS `check-prereqs` gate resolves the exact Developer ID identity through the active Keychain
search list and signs a disposable local Mach-O probe with its private key. It does not assume that the
certificate and private key live in one fixed keychain, and it never unlocks, repairs, or rewrites
Keychain state. A visible certificate or an unrelated unlocked Keychain is not sufficient evidence that
the release identity can sign.

When identity inspection fails, the identity disappears from the active search list, or the signing
probe returns `errSecInternalComponent` or `errSecAuthFailed`, the first recovery action is to unlock the
approved Keychain that actually holds the release private key. For a release Mac that stores the key in
the standard login Keychain, have the maintainer run this in their own terminal:

```bash
security unlock-keychain ~/Library/Keychains/login.keychain-db
```

If the key is stored in another approved Keychain, unlock that Keychain instead; unlocking an unrelated
login Keychain proves nothing. The command prompts for the password locally. Never pass the password
with `-p`, place it in a release profile, environment variable, log, or chat, or ask the maintainer to
disclose it. Rerun `node scripts/release-worktree.mjs run mac check-prereqs`; only a successful
disposable signature proves recovery. Do not ask the maintainer to log out, restart the Mac, change
private-key access controls, reset the default Keychain, or reimport credentials as the first response.
Those actions require separate diagnosis if the probe still fails after an explicit unlock. The
controller deliberately does not perform the unlock because it must not collect an interactive
credential.

Developer ID signing access and the `notarytool` Keychain profile are independent gates. A successful
notarization history lookup does not prove that `codesign` can use the private key, and a successful
signature does not prove that the notarization credential is valid. Diagnose the sub-gate that actually
failed; do not recreate or modify the other credential when its own probe still passes.

For a public release, logical `candidate` and `stable` map to the physical `candidate` and `stable` channels. For an internal release they map to `internal-candidate` and `internal-stable`. Operators always pass the logical channel to the controller.

Publish both candidate platforms:

```bash
node scripts/release-worktree.mjs run mac publish-updates --channel candidate
node scripts/release-worktree.mjs run windows publish-updates --channel candidate
```

Verify candidate publication end to end before recording candidate verification:

- each online candidate manifest must match its local staged manifest exactly;
- every artifact must be read in full through its official HTTPS URL while streaming all bytes into a
  SHA-256 digest and byte count;
- that streaming check may run on a trusted Gateway C close to the update service and does not require
  copying the large artifact back to the release workstation;
- each resulting SHA-256 and size must match the online manifest, the local build artifact, and the exact
  file stored on Gateway C.

For macOS, verify embedded build identity, `codesign`, `stapler`, and Gatekeeper against the locally
retained immutable ZIP and DMG whose SHA-256 matches the bytes read through the official HTTPS URL.
Hash equality binds those local platform checks to the published artifact without a second large-file
transfer. These worktree-local files remain the source for the final local archive; `finish` must not
download another copy from the network.

Then record candidate verification:

```bash
node scripts/release-worktree.mjs mark-candidate-verified
```

### Windows GitHub Actions release gate

Every formal stable release requires a successful Windows GitHub Actions smoke run. This gate applies to
every macOS and Windows official stable publication; it is not risk-based, optional, or limited to
Windows-only changes.

The frozen `RELEASE_COMMIT` must have a `Windows Release Smoke` workflow run with all of the following
properties:

- the run has reached `completed` status with a `success` conclusion;
- the run belongs to the `openglance/openglance` repository;
- the run uses `.github/workflows/windows-release-smoke.yml`;
- the run's head SHA exactly equals the frozen `RELEASE_COMMIT`;
- the run exposes a non-expired, non-empty smoke artifact whose name ends with that exact frozen commit.

Before publishing either platform to stable, record and verify the workflow evidence through the frozen
release controller:

```bash
node scripts/release-worktree.mjs verify-windows-release-smoke --run-id <RUN_ID>
```

The controller rejects stable publication when this evidence is missing, expired, empty, associated with
the wrong repository or workflow, or built from a different commit. A local `npm run test:ci:win` result
does not satisfy this gate.

### Local macOS update regression

Update-sensitive changes can make a real packaged-App update regression mandatory. This regression is
not a general UI acceptance pass and is not run after every release. `prepare` records the risk
assessment; when it is required, the regression must run after both candidate packages have been
published and verified. It must run on the release Mac because this gate verifies the final signed
package against the local macOS installation and ShipIt behavior.

The assessment is limited to changed update, installation, package-identity, or configuration behavior.
Release-controller bookkeeping and signing-prerequisite changes alone do not require this regression.

```bash
cd "$RELEASE_WORKTREE"
npm run release:verify-update:mac -- \
  --track "$RELEASE_TRACK" \
  --expected-version "$VERSION" \
  --expected-commit "$RELEASE_COMMIT" \
  --output dist/macos-update-regression/release-gate.json
```

The harness refuses to start while an installed OpenGlance or Git Leaf App is running, while a system
ShipIt job exists, or while a user ShipIt job is active, failed, still owns a staged update, or cannot be
classified safely. A same-track user job is a completed dormant registration only when it has run at
least once, exited successfully, is no longer active, belongs to the installed official App, and its
recorded staged-update directory no longer exists. The harness may let Squirrel's normal submission
replace that completed registration; it never manually unloads or boots out a production job. If the
regression fails before Squirrel replaces it, cleanup preserves the original registration unchanged.
The harness uses a temporary App location whose parent is deliberately not writable, plus isolated HOME
and Electron Profile paths when exercising the in-App updater. For a stable version older
than the first nonprivileged-only package, it uses the one-time `Contents` bridge instead of launching
that legacy package's defective privileged Helper path. Its mandatory `finally` cleanup removes only
state owned by that run. It then proves the real Profile and real ShipIt cache fingerprints did not change.
A failure never creates passing evidence.

For a Squirrel baseline, the harness waits until the real packaged update action is ready but does not activate `quitAndInstall`, because ShipIt's automatic relaunch cannot carry the explicit one-time Profile arguments. It instead confirms the isolated ShipIt request has `launchAfterInstallation=false`, stops only the temporary baseline process, lets ShipIt install the exact candidate, and manually relaunches the signed candidate with the same explicit isolated userData and sessionData. During both launches it inspects the real process command lines and fails immediately if any process under the temporary App root names the production Profile. This preserves the installation and ShipIt behavior under test without allowing an automated relaunch to touch real user data.

The first public release after the internal migration bridge is one bounded exception to same-track
baseline validation: physical `stable` still contains the exact `1.11.3 + internal + stable` bridge.
The harness may use only that exact identity as the historical public-stable baseline, must install it
through the nonprivileged `Contents` bridge, and records the baseline track and channel in its evidence.
Every other cross-track baseline fails closed. After the first public stable publication, normal public
releases again require a `public + stable` baseline.

Changes to the development handoff additionally require the strictly newer-version isolated regression:

```bash
npm run verify:dev-handoff:mac -- \
  --output /absolute/temporary/path/development-handoff.json \
  --allow-visible-app
```

It packages a deliberately lower-version source dev App, uses the exact newer signed `internal-stable`
ZIP, drives the real user-visible update action, and proves the Bundle ID transition, target signature,
legacy-compatible target executable, preserved App directory inode, nonprivileged `Contents` bridge,
absence of Squirrel/ShipIt use, target analytics default, telemetry initialization, receipt consumption,
cleanup, and unchanged real Profile/cache fingerprints. The intent flag is mandatory to prevent
accidental direct invocation because the
temporary App opens and restarts on the current desktop, but the Agent supplies it without asking the
maintainer for another confirmation once the development or release workflow is authorized. Each
transition action is clicked at most once;
a failed helper may not create an automated restart loop. The harness refuses to run while the
installed human App or either official/community ShipIt job is active, failed, still owns a staged
update, or cannot be classified safely. It may accept a completed dormant user job only when it exited
successfully, belongs to the installed App, and its staged-update directory no longer exists. Because
the development handoff must not invoke Squirrel, the harness preserves any such preexisting dormant
registration byte-for-byte and fails if it changes or if a new ShipIt job appears.

An update regression that requests system account credentials or starts a privileged Helper is a
failure, not an installation step. Do not authorize it or manually load, unload, or boot out ShipIt jobs
to force the gate to pass.

Record the generated evidence through the release controller:

```bash
cd "$RELEASE_SOURCE_ROOT"
node scripts/release-worktree.mjs verify-macos-update-regression \
  --evidence "$RELEASE_WORKTREE/dist/macos-update-regression/release-gate.json"
```

The controller validates the version, track, frozen commit, exact signed candidate, direct-`Contents`
installation result, non-writable parent, packaged nonprivileged policy, absence of privileged ShipIt,
and cleanup proof. The former manual
`mark-update-regression-verified` command does not exist.

Official packaged macOS builds persist Squirrel's direct-`Contents` default and carry a build-verified
Squirrel policy that never launches a privileged Helper. A user-owned `/Applications/OpenGlance.app`
therefore replaces its signed `Contents` directory without write access to the root-owned
`/Applications` parent; an App bundle that is itself not writable fails closed as an installation repair
case. The regression requires the `.app` directory inode to remain unchanged.

Internal official macOS packages use the canonical `OpenGlance.app` bundle and ZIP root with the hidden
`CFBundleExecutable=Git Leaf`. ShipIt's `useUpdateBundleName` is always set to `false`: Squirrel derives
its proposed name from the executable, so enabling it cannot migrate the legacy internal App and can
revert an already canonical path. The newly installed App instead migrates `Git Leaf.app` to its
`OpenGlance.app` sibling on startup, after its helper confirms readiness and the old instance exits.
It preserves the original App directory inode, signed Contents, Bundle ID, executable, launch arguments,
and Profile. A non-writable parent or occupied destination leaves the App usable at its existing path;
a failed relaunch restores that path and prevents an immediate retry loop. Public official and Community
packages retain their canonical executable and OpenGlance-native Bundle IDs.

This gate validates installation of the final signed package and its cleanup contract. It is not a
feature-by-feature UI test, and it is not repeated after releases whose recorded risk assessment does
not require it.

Publish both stable platforms:

```bash
node scripts/release-worktree.mjs run mac publish-updates --channel stable
node scripts/release-worktree.mjs run windows publish-updates --channel stable
```

After online stable verification and any required migration bridge, create and push the tag and close the release:

```bash
node scripts/release-worktree.mjs tag
node scripts/release-worktree.mjs push-tag
node scripts/release-worktree.mjs finish
```

All artifacts, manifests, checksums, and tags for one release must originate from the same frozen `RELEASE_COMMIT`. Candidate artifacts are inspected before stable publication. A version tag is created only after macOS and Windows stable artifacts have been verified and published.

`finish` is also the local artifact-retention gate. Before removing the frozen worktree or release lock,
it must copy the exact final physical stable set to:

```text
dist/releases/v<version>/
```

The retained set contains the macOS universal DMG and ZIP, the Windows x64 ZIP, the stable
`latest.json` manifests and checksum files, and the macOS `releases.json` plus ARM migration manifests.
For a public release the physical stable channel is `stable`; for an internal release it is
`internal-stable`. Candidate files, the internal `1.11.3` legacy bridge, unpacked applications, and
temporary packaging directories are not part of this archive.

The controller revalidates manifest track, channel, platform, version, build ID, commit, stable artifact
URL coordinates, and the auto-updater ZIP URL, then reads every package in full and compares its SHA-256
and size with the stable manifest and checksum file. It verifies the copied bytes again and records
repository-relative paths, sizes, SHA-256 values, and official URLs in the release receipt. A missing or
mismatched file makes `finish` fail without deleting the release worktree or lock. A complete existing
archive may be reused only when every archived byte still matches; conflicting files are never
overwritten.

`dist/` remains Git-ignored and local-only. The archive is an operational handoff and recovery copy, not
source material to commit.

## Internal 1.11.3 migration bridge

The installed official `1.11.2` build predates release tracks and reads only the legacy public `stable` channel. The first internal-track release therefore uses a one-time bridge:

1. Publish and verify both platforms on `internal-candidate`.
2. Complete the real packaged-App update regression.
3. Publish and verify both platforms on `internal-stable`.
4. Deploy and verify the update server version that excludes internal manifests from the public download
   surface, then record the live isolation check:

```bash
node scripts/release-worktree.mjs mark-public-download-isolation-verified
```

5. Publish the exact same signed internal artifacts to legacy `stable`:

```bash
node scripts/release-worktree.mjs run mac publish-updates --channel legacy-stable
node scripts/release-worktree.mjs run windows publish-updates --channel legacy-stable
```

The controller permits `legacy-stable` only for the internal `1.11.3` migration release, only for `publish-updates`, and only after both internal stable platforms, candidate gates, and the public-download isolation check have completed. It also refuses to tag or finish `1.11.3` until both legacy platform publishes are recorded.

The public `/download` page must require an explicit public release track and ignore internal or legacy
manifests even while the bridge occupies `stable`. The `/open` and `/share` pages remain deep-link transit
pages and must not expose distribution artifacts. Do not publish a newer public build to legacy `stable`
until the company migration is confirmed; lagging `1.11.2` installations would otherwise miss the bridge.
After upgrading, the embedded `internal` track reads only `internal-stable`.

## Platform status

- macOS official releases use Mango Future's Developer ID signature and notarization.
- Windows is currently distributed as an unsigned Preview ZIP. Documentation and download surfaces must state this plainly until Authenticode signing is implemented.
- Public and internal official builds share the stable `git-leaf` userData location but use separate
  macOS Bundle IDs. Internal builds retain the old identity for upgrades; future public builds start
  with the clean OpenGlance identity.
- Human-installed development builds share that userData location too; only explicit Agent smoke uses a temporary Profile.
- Community Builds never join an official update channel.

## Package inspection

Before publication:

1. Run a secret scanner over all tracked candidate files.
2. Search for private repository names, personal paths, private email addresses, internal IPs, host aliases, server directories, and release credentials.
3. Build macOS and Windows candidates.
4. Inspect the DMG, ZIP, and `app.asar` file lists and text content.
5. Confirm an official macOS DMG and update ZIP use the visible `OpenGlance.app` identity and ZIP root;
   public and Community Apps use `CFBundleExecutable=OpenGlance`, while internal Apps retain the hidden
   `CFBundleExecutable=Git Leaf` required by shipped updaters.
6. Confirm packages exclude `.agents/`, `docs/`, `test/`, `dist/`, `.git/`, release profiles, signing material, and internal operations documents.
7. Verify source, official public, and official internal behavior independently.
8. Confirm track, channel, manifest, SHA-256, tag, and public commit correspondence.

The formal release controller is the only supported path for publishing Mango Future official artifacts.
