APP_NAME := OpenGlance
VERSION := $(shell node -p "require('./package.json').version")
OPENGLANCE_RELEASE_PROFILE ?= $(GIT_LEAF_RELEASE_PROFILE)
RELEASE_DMG := dist/OpenGlance-$(VERSION)-darwin-universal.dmg

release-env = OPENGLANCE_RELEASE_PROFILE="$(OPENGLANCE_RELEASE_PROFILE)" GIT_LEAF_RELEASE_PROFILE="$(OPENGLANCE_RELEASE_PROFILE)" VERSION="$(VERSION)"
win-release-env = OPENGLANCE_RELEASE_PROFILE="$(OPENGLANCE_RELEASE_PROFILE)" GIT_LEAF_RELEASE_PROFILE="$(OPENGLANCE_RELEASE_PROFILE)" VERSION="$(VERSION)"

package-mac:
	npm ci
	npm run package:mac

install-dev-mac:
	npm run install:mac:dev

smoke-dev-mac:
	node scripts/release-mac.mjs dev-smoke

smoke-app-name-mac:
	OPENGLANCE_SMOKE_SCENARIO=mac-app-name $(MAKE) smoke-dev-mac

smoke-tree-tooltip-mac:
	node scripts/smoke-tree-tooltip-mac.mjs

smoke-remote-sync-mac:
	node scripts/smoke-remote-sync-mac.mjs

smoke-live-table-mac:
	node scripts/smoke-live-table-mac.mjs

smoke-document-changes-mac:
	node scripts/smoke-document-changes-mac.mjs

smoke-document-baseline-mac:
	node scripts/smoke-document-baseline-mac.mjs

smoke-commit-summary-mac:
	node scripts/smoke-commit-summary-mac.mjs

smoke-repository-recovery-mac:
	node scripts/smoke-repository-recovery-mac.mjs

smoke-document-links-mac:
	node scripts/smoke-document-links-mac.mjs

smoke-link-previews-mac:
	node scripts/smoke-link-previews-mac.mjs

verify-dev-handoff-mac:
	npm run verify:dev-handoff:mac

check-release-prereqs:
	$(release-env) node scripts/release-mac.mjs check-prereqs

sign-mac:
	$(release-env) node scripts/release-mac.mjs sign

dmg-mac:
	$(release-env) node scripts/release-mac.mjs dmg

notarize-mac:
	$(release-env) node scripts/release-mac.mjs notarize

staple-mac:
	$(release-env) node scripts/release-mac.mjs staple

zip-mac:
	$(release-env) node scripts/release-mac.mjs zip

verify-release-mac:
	$(release-env) node scripts/release-mac.mjs verify

release-mac:
	npm ci
	$(release-env) node scripts/release-mac.mjs release

stage-updates-mac:
	$(release-env) node scripts/release-mac.mjs stage-updates

publish-updates-mac:
	$(release-env) node scripts/release-mac.mjs publish-updates

package-win:
	npm ci
	npm run package:win

release-win:
	npm ci
	$(win-release-env) node scripts/release-windows.mjs release

stage-updates-win:
	$(win-release-env) node scripts/release-windows.mjs stage-updates

publish-updates-win:
	$(win-release-env) node scripts/release-windows.mjs publish-updates

.PHONY: package-mac install-dev-mac smoke-dev-mac smoke-app-name-mac smoke-tree-tooltip-mac smoke-remote-sync-mac smoke-live-table-mac smoke-document-changes-mac smoke-document-baseline-mac smoke-commit-summary-mac smoke-repository-recovery-mac smoke-document-links-mac smoke-link-previews-mac verify-dev-handoff-mac check-release-prereqs sign-mac dmg-mac notarize-mac staple-mac zip-mac verify-release-mac release-mac stage-updates-mac publish-updates-mac package-win release-win stage-updates-win publish-updates-win
