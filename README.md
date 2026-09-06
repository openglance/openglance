---
last_updated: 2026-08-15
---

# OpenGlance

English | [简体中文](README.zh-CN.md)

OpenGlance is a desktop app that gives non-technical teammates a simple way to review and maintain
Markdown knowledge bases stored in Git and shared with AI agents.

If your team keeps a Markdown knowledge base in Git so people and agents can work with the same context
and maintain it together, OpenGlance is a preview-first alternative that is simpler and more practical
than Obsidian.

> **Name transition:** OpenGlance replaces the original Git Leaf 1.x name. Existing repositories,
> sessions, and preferences keep using the same local Profile. The `git-leaf` CLI command and URL scheme
> remain accepted as compatibility aliases, while newly generated commands and links use `openglance`
> and `openglance://`.
> GitHub redirects the earlier repository addresses to `openglance/openglance`; the download host
> and update roots keep their existing addresses until a separate domain migration.

## Why OpenGlance?

- Keeping a Markdown knowledge base in Git lets agents, developers, and automation work directly with
  the files, but understanding and managing Git synchronization is often too complex for marketing,
  operations, and other non-technical teammates.
- Non-technical teammates spend more time reading existing documents, locating specific content, and
  reviewing agent changes than writing notes from scratch, yet the available tools are often centered
  on editing or development.
- Teams should not have to choose between files that agents can use directly and a familiar document
  experience, nor maintain a second copy of the same knowledge for people.

## Why not Obsidian?

- Obsidian is editing-first: [Live Preview](https://help.obsidian.md/Live%2Bpreview%2Bupdate) keeps notes
  editable while showing a near-rendered result. OpenGlance is preview-first: documents open in a fully
  rendered Preview designed for reading and review.
- Teams that only need document previews, precise references, small edits, and agent collaboration do
  not need many of Obsidian's broader note-taking and knowledge-management features.
- Obsidian may be the better fit when the knowledge base does not live in Git; OpenGlance is the more
  focused choice when Git carries shared context for people and agents but non-technical teammates
  should not operate Git.

## Core features

- **Preview first, edit when needed.** Markdown and MDX documents open in a fully rendered Preview with
  source-backed line numbers and text selection; Live and Source remain available for focused edits to
  the original files.
- **Unpublished edits stay easy to find.** In a previously committed document, OpenGlance highlights
  current additions and replacements, colors the full affected row in document navigation, and offers
  an off-by-default control for struck-through deletions while the existing current-document line numbers
  stay unchanged. A new untracked document remains an ordinary readable document while Sync identifies it
  as unpublished. This is a lightweight editing trace, not a developer-oriented Git diff.
- **Precise context for agents.** Users can select source-backed lines from one file or combine content
  from multiple files, then copy portable Markdown context for an agent.
- **Quiet updates, controlled publishing.** OpenGlance applies remote updates automatically when safe;
  when a user chooses to publish, one action commits and pushes all local changes in the current
  repository.
- **Links that share like online documents.** Teammates and agents can send OpenGlance HTTPS links in chat,
  letting recipients open the matching document in their local knowledge base. OpenGlance creates a
  versioned share link only after verifying the published revision.
- **Agent-readable data, human-readable visuals.** Standard Mermaid fences and controlled MDX keep
  diagrams, charts, tables, and metrics as readable repository text that agents can edit and OpenGlance
  can render for people.

[**Download for macOS**](https://gitleaf.mangofuture.com/download#macos) ·
[Windows Preview](https://gitleaf.mangofuture.com/download#windows) ·
[Build from source](docs/build-from-source.md)

![OpenGlance showing a shared context repository, local changes, and Agent Context](docs/assets/user-guide/workspace-overview.png)

[![CI](https://github.com/openglance/openglance/actions/workflows/ci.yml/badge.svg)](https://github.com/openglance/openglance/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

[Open the public User Guide Demo repository](https://gitleaf.mangofuture.com/open?repo=openglance%2Fopenglance-example-knowledge-base&path=README.md)
after installing OpenGlance, or clone it for a completely local first run.
For a fuller visual tour and day-to-day workflows, read the [OpenGlance user guide](docs/user-guide.md).

## One repository, two interfaces

The Git repository is the durable shared context source: knowledge, instructions, decisions, plans,
playbooks, and other files that help the team and its agents act consistently. A knowledge base may be
part of that repository, but the repository's operational role is broader than human reference.

- **AI agents, developers, and automation work directly in Git.** They keep their existing tools and use
  the original paths, files, branches, revisions, and instructions.
- **People use OpenGlance.** They get a familiar file tree, search, readable Preview, and focused editing
  without moving the content into another system.
- **Git remains the shared source of truth.** OpenGlance does not import, index, or copy the repository
  into a separate knowledge service.

## The human loop

1. **Find and read the relevant context.** Browse the repository in its existing folder structure or
   search directly, or follow a link returned by an Agent. Preview is the default reading surface.
2. **Inspect what changed.** Sync shows unpublished local files and remote status. Open the affected
   document to see current edits highlighted in the body and affected sections colored across their
   full navigation row. Changes before the first section appear under **Document start**; an optional
   compact top-right control reveals struck-through deletions without changing the existing line numbers.
3. **Hand exact context back to an agent.** Select source-backed lines in Preview, Source, or Live and
   collect them as portable Agent Context for an external agent.
4. **Make a focused edit when that is faster.** Live keeps headings, lists, links, and other content
   close to their reading appearance while writing the original Markdown or MDX file. Source remains
   available when precise text control is needed. Images, links, frontmatter fields, native tables, and
   MDX-lite components use one compact contextual-toolbar pattern, with only the common actions for the
   selected object. Native Markdown tables support cell-local source editing, rectangular range
   formatting, fixed text and highlight colors, column alignment, and basic
   column reordering without introducing a private table format.
5. **Keep the shared repository current.** OpenGlance can bring in remote changes while preserving
   unfinished local edits. **Sync and publish** commits and pushes intentionally; **Copy share link**
   returns a versioned link only after verifying the published revision.
   Add an optional change summary in Sync, or leave it blank for a local summary of changed files and
   newly added or edited document changelog summaries.

## Local-first files, links that open like online documents

Online document tools are convenient partly because a URL takes someone straight to the right page.
OpenGlance brings that interaction to a local-first, Git-backed file library. Collaboration and
publication happen through Git instead of a hosted editing database.

An AI agent can return an HTTPS **Open in OpenGlance** link for a Markdown or MDX file. The browser hands
it to the installed app, which opens the matching local repository, worktree, and document. For a
published result sent to a teammate, **Copy share link** syncs and verifies `origin/main` before
creating a versioned URL. A link grants no repository access; each person still uses an authorized
local checkout.

The [user guide](docs/user-guide.md#open-the-right-local-document-from-a-url) shows the complete flow
and a repository instruction that teaches an Agent to return these links.

## Data for agents, visuals for people

Standard fenced `mermaid` blocks in Markdown or MDX render locally in Preview and in inactive Live
blocks. The diagram toolbar can fit, zoom, and pan a graph, while `</>` exposes the exact portable
source. OpenGlance does not load a remote diagram service, and an invalid diagram remains available as
source instead of replacing the document with a second visual model.

For a dense `flowchart` without an author-selected layout, **Smart view** uses top-to-bottom as the
document-reading default instead of relying on document-specific vocabulary. A horizontal source may
be presented vertically only when every node, relationship, and cluster remains present and no nodes
overlap; an already vertical source is never turned horizontal automatically. The complete graph always
remains visible: OpenGlance does not derive isolated node lists or one-hop subgraphs that discard context.
These reading views never rewrite the Mermaid source.

Use an automatic `flowchart` for a directional process. For an architecture overview whose intentional
placement matters, select a Mermaid layout explicitly or use `block-beta` with explicit columns, rows,
and `space` blocks; OpenGlance respects that author decision. Keep stage labels short and use smaller
follow-up diagrams or explicit Mermaid subgraphs when one overview still carries too many concepts.

OpenGlance supports Markdown and a controlled subset of MDX so structured data can stay directly in the
document instead of being trapped in a screenshot or a separate dashboard. Chart series, table rows,
timelines, headline metrics, decisions, and flows can be written as readable CSV, TSV, JSON, or
Markdown inside the `.mdx` file. AI agents can read and update those values as ordinary repository
text; OpenGlance renders the same source as charts and other visual blocks for people.

Long-running company reports can keep their complete history in a standard repository-local CSV, TSV,
or JSON file with a typed `.dataset.json` sidecar. Existing `Chart` and `DataTable` blocks can show a
bounded range and offer only the time views supported by the declared source granularity. Daily sources
can switch among day, week, month, and natural-quarter views. Weekly sources can also show natural month
and quarter by assigning each whole week to the bucket containing its fourth day; they never invent daily
values. Aggregation is explicit per field, missing source periods are not converted to zero, and documents
still cannot run scripts or query another repository.
For common spreadsheet or BI exports, the sidecar can explicitly select physical columns and grouped-number
formatting while leaving the original data file intact.

Preview renders the document, while Source and Live edit the original file. There is no second visual
data model to keep in sync. Only allowlisted components are rendered; documents cannot run arbitrary
JSX, JavaScript, imports, or scripts.

![OpenGlance rendering a bar-and-line chart from an agent-readable context document](docs/assets/user-guide/mdx-visuals.png)

## Built for readable context

- All, Favorites, and Sync views, with a content-focused tree or the complete repository tree. Markdown
  and MDX files with non-Chinese source names show their document title below the unchanged filename by
  default. The filename is slightly muted so the title is easier to scan; this second line can be turned
  off for a compact tree.
- Compact document tabs use that same filename-and-title hierarchy whenever a distinct human title is
  available, while keeping the full repository-relative path in the hover tooltip.
- A searchable, drag-reorderable repository panel for opening, switching, and removing repositories from
  OpenGlance without deleting local files, plus worktree switching with restored tabs, navigation history,
  scroll positions, and focus.
- Read-only previews for images, PDFs, CSV, JSON, JSON Lines (`.ndjson` / `.jsonl`), YAML, HTML, code,
  and other repository attachments. A CSV cell containing only a repository-local Markdown link opens
  that document directly.
- Source line references that paste as quoted context, preserve where selected text came from, and leave
  a blank paragraph ready for the user's prompt.
- Conservative file operations that avoid turning OpenGlance into a general file manager or IDE.

## One repository does not require one app

Each participant can use the interface suited to their work while the files remain shared:

| Participant | Primary interface | Relationship to the repository |
| --- | --- | --- |
| AI agents | Codex, Claude, Copilot, or another agent client | Read and modify the files directly |
| Team members reading or making focused edits | **OpenGlance** | Use the repository through a document-oriented desktop interface |
| Developers and repository maintainers | An IDE, terminal, and Git tools | Keep full control of branches, diffs, conflicts, code, and automation |

## Download

Use the installed OpenGlance desktop app for normal work. On first launch, choose a local Git repository;
later launches restore your repositories, worktrees, and workspace state.

Official public builds are available from the
[OpenGlance download page](https://gitleaf.mangofuture.com/download). Company-internal builds use a separate
distribution channel and are not published there.

Official Mango Future macOS builds are signed with Developer ID and notarized. Windows is currently an
explicitly labeled unsigned Preview; verify the published SHA-256 checksum before running it. See the
[Windows Preview guide](docs/windows-portable-guide.md).

### Run from source

Running from source requires Node.js 22 or newer and Git:

```bash
npm ci
npm run desktop -- --repo /path/to/docs-repo
```

The complete [build-from-source guide](docs/build-from-source.md) explains source packaging, Community
Build identity, and the difference from an official Mango Future distribution. The
[public User Guide Demo repository](https://github.com/openglance/openglance-example-knowledge-base)
provides a ready-to-open repository with Markdown and MDX content.

The CLI and browser workspace are primarily for local development:

```bash
npm start -- /path/to/docs-repo/README.md
npm start -- /path/to/docs-repo/README.md --no-open
```

The desktop app and CLI/browser service listen on localhost only. A human-installed `OpenGlance dev`
replaces the same installed app bundle and shares the real Profile so normal work survives replacement.
New installations use `OpenGlance.app`; a maintainer development install migrates an existing
`Git Leaf.app` to the canonical path so macOS does not keep duplicate Apps.
Automated smoke tests alone use isolated application data; see [AGENTS.md](AGENTS.md) for the
repository's development and safety requirements.

## Build identity and privacy

| Build | Update channel | Usage analytics default |
| --- | --- | --- |
| Community or local source build | Disabled | Disabled |
| Human-installed `OpenGlance dev` | One-way handoff to `internal-stable` | Disabled while dev |
| Official Mango Future public build | `stable` | Disabled |
| Official Mango Future internal build | `internal-stable` | Enabled |

Settings identifies source, official public, official internal, and development builds and shows the
effective usage-analytics state. There are still only two official release tracks—public and
internal—and two macOS Bundle IDs. An installed source development build is not a third release: it may
only switch to the latest official internal package after that package's version becomes strictly newer
than the development version. The verified package downloads automatically, while installation still
waits for a normal quit or **Restart now**. An equal or older official version is treated as current. A
Community package without the development marker remains disconnected from official feeds.

Official builds automatically download and prepare a newly discovered version. Until it is ready, the
sidebar shows progress without a download button; afterward it offers **Restart now**, and a normal quit
also installs it. If another version appears first, it replaces the waiting package. OpenGlance keeps at
most one complete downloaded-but-uninstalled package in its update cache.

A build default is normally used only for first-time initialization, and ordinary updates preserve an
existing `usageAnalyticsEnabled` value. The source-dev-to-internal identity handoff is the bounded
exception: immediately before installation it clears the dev build's initialized value so the target
internal package applies its embedded enabled default. Later internal updates again preserve the
resulting setting.

Usage analytics run only in company-managed official builds when enabled locally. They do not send
repository names, paths, file names, search terms, document content, or Git identity. The current
normative contract is the [usage analytics specification](docs/app-usage-analytics-spec.md).

## Product boundaries

- OpenGlance is a local tool. It does not provide accounts, SSO, collaborative editing, or a public document site.
- Only Markdown and MDX contents are editable in OpenGlance; other repository files remain read-only or
  open in a system application. Ordinary files can still be renamed or deleted from the file tree.
- File-tree display preferences never change Git discovery, status, commit, or sync scope.
- Normal branches are editable; the first write in a detached worktree creates a protective branch.
- Localhost binding, source-backed Live editing, the MDX-lite whitelist, share-revision checks, and Git
  history safety are not user-configurable.
- The public `/open` and `/share` pages are Mango Future-hosted handoff services. They receive repository
  identifiers and document metadata, but never Git credentials or document content. See
  [Hosted link metadata and privacy](docs/hosted-links.md).

## Development

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

After changing `src/client/source-editor.mjs` or `src/client/mermaid-renderer.mjs`, also run
`npm run build:client` and commit the changed generated outputs in `public/`, including the matching
editor or Mermaid bundle. See [Contributing](CONTRIBUTING.md) for the contribution workflow, the
[documentation index](docs/README.md) for technical references, and [AGENTS.md](AGENTS.md) for
UI-specific validation and userData isolation requirements.

## License

OpenGlance is licensed under the [Apache License 2.0](LICENSE). The license does not grant permission to
represent a community build as an official Mango Future distribution. Official identity depends on the
company code signature, official download channel, checksum, release tag, and corresponding public commit.
