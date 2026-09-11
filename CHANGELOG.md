# Changelog

OpenGlance follows Semantic Versioning for its shared app version. Git tags identify source revisions;
official public artifacts, signatures, checksums, and platform availability are authoritative only on
the [OpenGlance download page](https://gitleaf.mangofuture.com/download).

## 3.2.2 — 2026-09-11 (internal release)

### Fixed

- Refreshed document edit cues when Git's committed baseline changes, clearing stale highlights after
  an external commit without replacing the editor or discarding pending input.
- Migrated legacy macOS `Git Leaf.app` installations to `OpenGlance.app` on startup while preserving
  the internal executable, application identity, existing Profile, and subsequent update path.
- Kept legacy installations usable when the new name is occupied or the parent directory is not
  writable, restored the original path after a failed relaunch, and preserved older development
  updaters' startup confirmation.

## 3.2.1 — 2026-09-07 (internal release)

### Fixed

- Kept healthy repositories and the workbench reachable when a requested document or worktree is
  missing, and reported filesystem `ENOENT` failures as missing content instead of a missing Git
  executable.
- Resolved ordinary `/open` document links through Git's primary-worktree metadata while preserving
  exact explicit worktree and local-path targets plus the existing `/share` publication safeguards.
- Kept Agent smoke Apps inside their disposable Profile without quitting or replacing the installed
  human App, refreshing the Dock, or registering default protocol handlers.

## 3.2.0 — 2026-09-06 (internal release)

### Added

- Added an optional editable change summary to Sync and unpublished-document sharing. Its first line
  becomes the commit subject, its remaining lines become the body, and the draft is preserved when
  publication fails.
- Added bounded local commit-summary generation when the field is empty, using staged change types,
  document titles, and newly added or edited `change_log.summary` values without an AI service or
  document-content upload.

## 3.1.1 — 2026-09-06 (internal release)

### Fixed

- Restored local document links, images, and assets whose paths contain Chinese characters, spaces,
  or literal percent signs, while preserving encoded destinations, query parameters, and fragments.
- Corrected Live link opening for encoded and angle-wrapped Markdown destinations without changing
  their source text or selecting a different worktree.
- Rejected document paths that escape the repository through a parent-directory symbolic link.

## 3.1.0 — 2026-09-04 (internal release)

### Added

- Made relative Markdown and MDX links in CSV preview cells open the referenced repository document,
  including the existing modifier-key behavior for choosing the current tab or a new tab.
- Added readable document titles to open-document tabs while preserving filenames and repository paths
  as the stable navigation and session identity.

## 3.0.6 — 2026-08-30 (internal release)

### Fixed

- Kept a new untracked Markdown or MDX document in its ordinary readable form instead of presenting
  its entire contents as an edit. Working-tree edit cues now locate changes only within a document that
  already has a committed baseline, while Sync continues to identify the new document as unpublished.

## 3.0.5 — 2026-08-16 (internal release)

### Fixed

- Restored the hidden `Git Leaf` executable identity in internal macOS packages so existing internal
  Git Leaf 1.x Apps and source/development OpenPeek 2.0.0 and OpenGlance 3.0.0-3.0.1 installations can
  upgrade to a newer OpenGlance build. The visible product, installer, and `.app` bundle remain
  OpenGlance.
- Extended the development-handoff and ordinary macOS update gates to reject an internal artifact that
  would strand those installed clients, while continuing to require the exact Bundle ID, Developer ID
  signature, build identity, version, and checksum.

## 3.0.4 — 2026-08-16 (internal release)

### Changed

- Completed the OpenGlance identity transition across runtime aliases, package metadata, updater
  bridges, documentation, and release tooling.
- Internal macOS packages now use `OpenGlance` as both the visible product name and executable while
  retaining `com.mangofuture.gitleaf`, the stable Profile, ShipIt identity, and update coordinates.
- Once this updater is installed, a later signed update can rename a writable `Git Leaf.app` installation
  to `OpenGlance.app`; when its parent directory is not writable, updates still succeed in place without
  creating a duplicate.
- Internal Windows packages retain only the bounded `Git Leaf.exe` bridge needed to migrate 1.x fixed
  installations into `%LOCALAPPDATA%\OpenGlance\app`.
- The short-lived intermediate naming aliases, URL scheme, environment inputs, build-info file, package
  launchers, and repository mappings are no longer accepted.
- The packaged macOS update regression now applies the same pre-install App-path policy as a normal
  shutdown before stopping its isolated baseline, so the non-writable legacy-path fallback is exercised
  instead of bypassed.
- The real filesystem-permission assertion in that regression now runs only on macOS, where POSIX
  directory write permissions model the production updater behavior accurately.

## 3.0.1 — 2026-08-15 (public release)

### Changed

- Prepared the first public OpenGlance release at the globally unique `3.0.1` version after the
  internal `3.0.0` migration release.
- Public packages use the OpenGlance-native application identity while retaining the stable Profile,
  Git Leaf 1.x input aliases, and hosted handoff compatibility needed by existing repositories and links.

## 3.0.0 — 2026-08-15 (internal release)

### Changed

- Renamed the product identity to OpenGlance across the desktop app, packages, artifacts, CLI,
  documentation, repository references, and generated links.
- Raised the shared app version to `3.0.0` because this changes the canonical application and
  operating-system identity surface again.
- New packages use `OpenGlance.app`, `OpenGlance.exe`, the `openglance` command, `openglance://`,
  `OPENGLANCE_*`, and `openglance-build-info.json` as their canonical names.
- Future official public macOS builds use `com.mangofuture.openglance`; Community Builds use
  `org.openglance.community`. Both use `OpenGlance` as the executable name.

### Compatibility

- The Electron Profile remains `git-leaf`, preserving repositories, sessions, preferences, favorites,
  browser state, and analytics consent through the rename.
- The app accepts the `git-leaf` CLI alias, `git-leaf://` links, `GIT_LEAF_*` environment inputs, and
  the earlier Git Leaf build-info filename. New output always uses OpenGlance.
- Official internal macOS builds retain `com.mangofuture.gitleaf`,
  the existing ShipIt identity, and the `internal-stable` update coordinates so installed internal Apps
  continue upgrading in place.
- A macOS development install migrates an existing `Git Leaf.app`. Windows packages on the internal
  track carry a bounded `Git Leaf.exe` launch bridge, migrate the old fixed installation into
  `%LOCALAPPDATA%\OpenGlance\app`, and remove the old tree only after the new
  executable confirms startup.
- The `git_leaf.*` analytics schema, hosted domain, update-service `/git-leaf` roots, and stable Profile
  directory remain unchanged. Domain migration is intentionally separate.

OpenGlance 3.0.0 was published on the internal track for the installed-user migration. It was not
published on the public track.

## 1.14.0 — 2026-07-27

### Added

- Periodic remote checks, automatic clean-worktree fast-forwarding, and an explicit guarded merge that
  incorporates remote changes while preserving every local edit as uncommitted work.

### Fixed

- Duplicate line numbers on block quotes and incorrect source anchors for selected Preview lines.
- Sync status text wrapping in narrow sidebars.

## 1.13.0 — 2026-07-27

### Added

- English architecture, MDX-lite, analytics, and marketing documentation as the single maintainer-facing
  source.
- A concise build-from-source guide for Community Builds.
- Bilingual disclosure for the metadata sent through Mango Future hosted `/open` and `/share` handoff
  services.
- A bilingual Windows Preview installation and security guide.
- A public example knowledge repository for first-run evaluation.

### Changed

- Community packages now use `org.gitleaf.community` on macOS and `Git Leaf Community` publisher metadata
  on Windows instead of Mango Future's official package identity.
- Non-official packages are labeled `Community build` in the app.
- The Windows release smoke now uses a bounded non-forced health probe and failure-safe cleanup.

### Security

- Updated the development dependency lock to resolve the high-severity `brace-expansion` denial-of-
  service advisory. Production dependencies were not affected.

## 1.12.3 — 2026-07-26

- Removed the privileged macOS update-helper path and enforced direct application-content replacement.
- Added release verification for the signed package, nonprivileged policy, and Profile/ShipIt cleanup.
- Improved sidebar views, Favorites, Sync guidance, keyboard shortcuts, per-tab navigation, tooltips, and
  English/Simplified Chinese UI.
- Compatibility: preserves the existing Git Leaf Profile and repository/workbench state. Official
  public availability remains separate from the source tag.

## 1.11.4 — 2026-07-24

- Strengthened document sharing, remote revision verification, fetch recovery, and navigation behavior.
- Added stronger Windows GitHub Actions evidence and retained-artifact gates to the formal release flow.
- Compatibility: an official internal-track release; no GitHub binary release is attached to the tag.

## 1.11.3 — 2026-07-24

- Introduced the explicit internal release track and the one-time compatibility bridge for earlier
  official installations.
- Compatibility: migration release for official `1.11.2` installations; not a public Community Build.

## Verification and compatibility

- macOS official packages are Developer ID signed and notarized; verify the status and SHA-256 on the
  download page.
- Windows is an unsigned Preview; verify SHA-256 before running it.
- Community Builds are unsigned, do not use official update feeds, and must not be presented as Mango
  Future releases.
- App updates preserve repository configuration and workbench state unless a release note explicitly
  states a migration boundary.
