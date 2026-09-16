---
title: OpenGlance system architecture
domain: ai
type: architecture
owner: maintainer
last_updated: 2026-08-27
source: openglance
canonical: true
ai_snippet: "[Architecture] OpenGlance | human desktop interface for shared context repositories | local HTTP service | Git worktrees | Preview Source Live | CodeMirror 6 | guarded Git sync"
---

# OpenGlance system architecture

[Documentation index](README.md)

This document defines OpenGlance's system boundaries and long-lived behavioral contracts. It is not a
user guide or an MDX-lite syntax reference.

- Product capabilities and user entry points: [README](../README.md).
- MDX-lite syntax and rendering contracts: [MDX-lite reference](mdx-lite-guide.md).
- Community builds: [Build from source](build-from-source.md).
- Official publication: [Release process](release.md).
- Hosted link metadata: [Hosted link handoff](hosted-links.md).
- Usage analytics: [Usage analytics specification](app-usage-analytics-spec.md).

## Product and data model

OpenGlance is a local desktop interface for Git repositories used as durable shared context by teams and
AI agents. These repositories are primarily made of Markdown and MDX documents.

The Git repository selected by the user is the shared context system of record. It may contain a
knowledge base, but it can also contain agent instructions, decisions, plans, playbooks, and operational
context. OpenGlance does not import documents into a separate database, CMS, context engine, or cloud
store. Images, attachments, code, and other repository files remain ordinary files. OpenGlance provides
the human interface over that repository; AI agents, developers, and automation work with the same files
directly.

OpenGlance is optimized for three jobs:

- give people who do not work in Git or Markdown a familiar way to read, search, inspect, and make
  focused edits;
- preserve source paths, line ranges, revisions, branches, and worktrees for agents and automation;
- let people return to the app to inspect and continue changes made by external agents and tools.

OpenGlance is not an agent runtime, model host, account service, public documentation site, or general
code editor.

## Product identity and compatibility

OpenGlance is the canonical product identity beginning with version 3.0; Git Leaf was the 1.x identity.
New visible desktop bundle names, package
artifacts, CLI output, generated deep links, environment variables, and embedded build metadata use
`OpenGlance`, `openglance`, `openglance://`, `OPENGLANCE_*`, and `openglance-build-info.json`.

The rename must not create another application state or strand existing Git Leaf users. These
identifiers remain compatibility contracts:

- Electron `userData` and `sessionData` stay under the `git-leaf` Profile directory on every platform;
- `git-leaf` remains a CLI alias, and the app parses and registers `git-leaf://` alongside the canonical
  protocol while generating only `openglance://` links;
- `GIT_LEAF_*` environment inputs and `git-leaf-build-info.json` remain read-only fallbacks;
- official internal macOS packages retain `com.mangofuture.gitleaf` and
  `com.mangofuture.gitleaf.ShipIt` because installed internal Apps actively depend on those
  operating-system identities; they also retain the hidden `CFBundleExecutable=Git Leaf` required by
  shipped internal Git Leaf updaters and the source/development handoff clients in OpenPeek 2.0.0 and
  OpenGlance 3.0.0-3.0.1, while the visible product and `.app` names are OpenGlance;
- future official public macOS packages use `com.mangofuture.openglance`, and Community packages use
  `org.openglance.community`; both use the canonical `OpenGlance` executable and their corresponding
  ShipIt cache identity;
- the `git_leaf.*` analytics event namespace remains unchanged because it is a data-schema identity;
- the former GitHub repository names redirect to `openglance/openglance` and
  `openglance/openglance-example-knowledge-base`;
- `gitleaf.mangofuture.com` and update-service `/git-leaf` roots remain unchanged until their separately
  coordinated domain migration.

On macOS, a new installation uses `OpenGlance.app`. A human development install writes the canonical App
first and then removes an existing `Git Leaf.app`. An updated App still installed as `Git Leaf.app`
migrates its outer name on startup, before loading repositories or persistent configuration. A detached
helper must confirm readiness before the current instance exits; it then moves the same bundle to a
reserved, previously absent `OpenGlance.app` sibling and launches it with the original arguments and
Profile. A failed launch restores the legacy path and suppresses migration for that recovery launch.
An older development-handoff helper's direct child also defers migration until a normal launch, so
exiting for the rename cannot invalidate that helper's startup confirmation.
A non-writable parent or an existing destination (including a symlink) defers migration while the App
continues to work; another normal launch can retry. Bundle ID, hidden executable, signed Contents,
App directory inode, and Profile remain unchanged.

Squirrel's `useUpdateBundleName` derives a name from `CFBundleExecutable`, not the staged `.app` basename.
OpenGlance always disables that option before installation so every update replaces signed `Contents`
at the current path. This also prevents subsequent internal updates from reverting the canonical outer
name to the compatibility executable's `Git Leaf` name. Name migration is independent of the updater,
so a legacy client can install the first fixed version before the new startup code performs migration.

On Windows, internal packages contain one bounded `Git Leaf.exe` copy so the baked-in 1.x updater can
launch the new code. The new process migrates the old fixed installation into
`%LOCALAPPDATA%\OpenGlance\app`, removes the compatibility executable from the canonical installation,
and deletes the old install tree and shortcut only after `OpenGlance.exe` confirms startup. Public and
Community packages contain only the canonical executable.

## Runtime model

OpenGlance consists of:

- a Node.js HTTP service bound to localhost;
- a browser-based workbench served by that process;
- an Electron desktop shell that owns repository selection, application state, deep links, settings,
  updates, and operating-system integration.

The desktop app is the normal user entry point. It stores the selected repositories and workbench state
in Electron `userData`, restores the previous repository on later launches, and asks the user to choose
again if a repository is missing or invalid.

The CLI and browser entry points are development surfaces:

```bash
npm start -- /path/to/repository/README.md
npm start -- /path/to/repository/README.md --no-open
```

The service binds to `127.0.0.1:4317` by default. If that port is occupied it may choose a later local
port. It must never expose repository reads, edits, local paths, or Git actions to the LAN. The browser
does not access the filesystem directly; all reads, writes, Git operations, and attachment creation go
through the local service.

One local service process serves one current worktree. A later CLI invocation reuses a compatible
existing process for the same repository. Long-running processes detect tool-source changes, flush
pending Source or Live writes when possible, and restart without treating a stale process as current.

## Repository and worktree model

OpenGlance can open any local Git repository. The OpenGlance source checkout does not need to be inside the
content repository.

A repository can be selected through the desktop UI, supplied with `--repo`, or discovered upward from
the CLI working directory. When no saved session or explicit document exists, the initial document
priority is `AGENTS.md`, `README.md`, then `CONTEXT.md`; if none exists, OpenGlance opens an empty
workbench.

Desktop startup validates the repository independently of the requested document. A missing or
unreadable initial file is reported through the document API inside the workbench, preserving access
to the tree and repository switcher. When repository startup itself fails, Home renders the saved
repository display records and reuses opaque-ID switching, including reopening a retained server's
repository. File errors must not be classified as a missing Git executable.

Repository identity and worktree state follow these rules:

- the repository is the stable top-level identity;
- worktrees are working directories within that repository;
- the desktop repository list preserves the explicit user order, appends newly opened repositories, and
  does not reorder merely because a repository is used;
- the worktree selector is hidden when only the primary worktree exists;
- available worktrees come from `git worktree list --porcelain -z`, with the tested line-oriented
  fallback used only when the installed Git explicitly rejects `-z`;
- a stable 16-character worktree ID is derived from the canonical local worktree path;
- the ID is local-machine metadata, not a branch name and not a portable repository identifier;
- each worktree restores its own tabs, navigation history, scroll, focus, and separate All/Favorites tree
  expansion state; entering Sync starts with every changed-file directory ancestry expanded;
- favorites are scoped to the canonical primary repository and shared by that repository's worktrees.

The desktop shell owns the searchable repository panel. `Command+O` / `Ctrl+O` asks the active renderer
to display a centered panel containing stable-order display records with opaque, path-derived IDs; the
renderer does not receive the complete local repository roots. While that modal panel is open, number
shortcuts select only the visibly numbered results and zero opens the existing directory chooser. Switch
and removal requests return only the opaque ID to the desktop shell, which resolves it against the current
`openRepoRoots` list and reuses the normal repository transition or configuration mutation boundary.
Drag reordering sends an exact permutation of those opaque IDs; the desktop shell rejects missing,
duplicate, or unknown IDs before persisting the new `openRepoRoots` order, so local paths remain outside
the renderer contract. Visible number shortcuts are recalculated from the reordered and filtered list.
Removing a repository from the panel never deletes its local directory or clears its saved session and
Favorites. Worktree selection remains a separate, repository-scoped control; when a repository has
multiple worktrees, that selector replaces the repeated standalone repository name while the repository
panel button remains independent.

Normal branches are editable. A detached worktree can be read and can enter an editing mode, but the
first actual write must create a protective local branch named like
`openglance/detached-<commit>-<timestamp>`. If branch creation fails, the write fails without modifying the
document. No write path may bypass this boundary.

### External command contract

Git is required to open and operate on a repository. GitHub CLI is an optional environment-readiness
check: remote operations use Git's configured credentials and remain available when `gh` is absent.
Operating-system launch helpers are action-specific dependencies rather than prerequisites for opening a
repository. Every external-command caller classifies both process execution and output:

Before macOS desktop environment checks or repository services start, OpenGlance augments the inherited
GUI `PATH` with entries missing from the user's login shell. Existing entry precedence is retained, and
only `PATH` is imported. A missing shell, timeout, or malformed output leaves the inherited environment
unchanged rather than blocking startup.

| State | Meaning | Required response |
| --- | --- | --- |
| `ok` | The command succeeded and its output satisfies the caller's contract | Continue |
| `unavailable` | The executable is missing or absent from the desktop PATH | Stop the dependent action and explain the environment requirement |
| `permission_denied` | Execution or repository access was denied | Stop without modifying repository state |
| `unsupported` | The installed command explicitly rejects a required capability | Use a tested compatibility path or stop |
| `invalid_context` | The working directory is not a usable Git worktree | Report the repository-selection problem |
| `authentication_required` | Remote credentials are missing or rejected | Keep local features available and stop the remote action |
| `network_unavailable` | DNS, proxy, connection, or TLS failed | Preserve local state and allow retry |
| `interrupted` | The process was signalled, cancelled, or timed out | Do not treat partial output as success |
| `invalid_output` | Exit status was successful but required output was absent or malformed | Stop before parsing or mutating state |
| `failed` | Any other command or repository failure | Preserve concise technical context and hand off recovery |

Nonzero exit codes are normal only when a specific command contract declares them so, such as
`merge-base --is-ancestor` returning 1 for “not an ancestor.” Optional information may degrade only at
an explicit call site; for example, a failed share-title preview can fall back to the filename.

## Workbench state and navigation

After repository identity and worktree resolution, ordinary desktop document links targeting the active
worktree reuse its server and renderer. They flush pending editor writes, activate an existing document
tab or open a new one, and acknowledge navigation only after it completes. A failed save or document
read preserves the current workbench. A different worktree or a Home page still uses the full repository
transition; matching the repository alone is not sufficient for reuse.

The front end has four stable areas:

- a top bar with repository identity, document tabs, modes, and document actions;
- a left sidebar with worktree selection, All/Favorites/Sync views, search, frontmatter filtering, and
  the Agent Context entry;
- an optional document outline synchronized with the content scroll position; it includes H1–H5,
  omits a sole leading H1 used as the document title, and derives indentation from the relative heading
  stack so skipped Markdown levels do not create empty navigation depths; unpublished changes color the
  full affected navigation row without changing its click target, and changes before the first visible
  heading use a synthetic document-start target;
- the main content area for Preview, Source, Live, and read-only file viewers.

Sidebar, outline, and content have independent scrolling. Rebuilding the current document's outline to
refresh headings or unpublished-change cues preserves the outline viewport; only a real active-section
transition applies the ordinary outline-following scroll. Transient feedback uses a fixed toast below
the title bar. Opening a tab must not expand or scroll the file tree or steal its focus. “Reveal in
Sidebar” is the explicit action that expands ancestors and performs the smallest necessary scroll.

Each tab has a stable identity, a current document location, and an independent Back/Forward history.
Every file-tree projection—All, filtered search results, Favorites, and Sync—uses the same navigation
contract: a normal click replaces the current active tab, while Command/Ctrl-click creates and activates
a new tab. Internal-document links keep a separate contract: a normal click replaces the current tab,
Command/Ctrl-click creates a background tab, and adding Shift activates the new tab. Browser URL state
is a projection of the active location, not the application's navigation history.

Tab labels are a display projection over that path identity. A Markdown or MDX document whose source
filename contains no Han characters and whose frontmatter `title` or first level-one heading supplies a
distinct title uses a compact two-line tab: the filename remains on the first, muted line and the human
title is the primary second line. Other files remain single-line. When open tabs would otherwise have
the same filename and title, their filename lines expand to the shortest unique repository-relative path
suffix. The hover tooltip retains the human title and complete path. This tab treatment is independent of
the file tree's `showDocumentTitles` density preference and never changes persisted tab state.

File-tree context actions bind to the right-clicked repository-relative path rather than the active
document. GitHub source actions derive the target URL from the current repository's validated GitHub
blob root; repositories without one keep that action disabled.

Favorites are user preferences, not repository content. Desktop builds persist them in `userData`; the
browser development entry uses repository-scoped `localStorage` as a best-effort fallback. Missing
favorite paths are removed only after a complete repository tree loads successfully. Search, filtering,
or a failed or invalid tree response must never prune favorites. Renames performed inside OpenGlance update
document favorites directly; external renames, deletions, and worktree changes may remove a favorite
whose saved path is no longer present.

Agent Context is session-scoped and isolated by repository and worktree. It stores repository-relative
paths, source line ranges, captured Markdown, branch, and revision for the current window session. It
does not create a long-term content database. Copied context is generic Markdown and is not tied to one
agent provider.

## File capabilities

The server discovers Git-tracked files and unignored local files. File-tree preferences change only
presentation:

- Content Files shows Markdown, MDX, HTML, images, and PDF by default;
- All Repository Files shows the complete discovered tree;
- when the default-on `showDocumentTitles` preference is enabled, Markdown and MDX files whose source
  filename contains no Han characters keep that filename on the first row and show a distinct
  frontmatter `title` or first level-one heading as the primary second row while slightly muting the
  filename; disabling the preference, filenames containing Han characters, and documents without a
  distinct title remain single-row;
- in Favorites, a nested folder keeps its directory name on the first row and shows its parent
  repository-relative path as a second row so same-named folders stay distinguishable; a top-level
  folder and folders nested inside an expanded favorite remain single-row; this path line is
  display-only and does not change favorite identity, sorting, or Git scope;
- truncated navigation text expands in a content-aligned tooltip that stays visually stable while the
  pointer crosses it but remains hit-test transparent, so the underlying file or navigation target keeps
  click ownership;
- search, the current document, favorites, and Sync may reveal otherwise hidden paths;
- OpenGlance-created empty folders contain a zero-byte `.gitkeep`; All and Content Files preserve the
  folder while hiding the placeholder, and Sync exposes the placeholder whenever Git reports its change;
- text search combines whitespace-separated terms with AND, matches each folder or file on its own
  searchable fields, including document titles only while they are displayed, and initially keeps only
  matches plus the ancestor folders needed to reach them;
  every automatically revealed result provides visible matching evidence, including files matched only
  through `ai_snippet` and matches truncated by the available row width;
  search has transient directory expansion state independent from the saved file tree, so explicitly
  expanding a matching folder may reveal its descendants without changing the tree restored afterward;
- frontmatter filtering narrows Markdown and MDX documents only.

All, Favorites, Sync, and file-tree preferences must never alter Git discovery, status, staging, commit,
or sync scope. Displayed document titles never replace the repository-relative path used for sorting,
opening, favorites, sessions, file operations, Git status, or synchronization.

| File class | Capability |
| --- | --- |
| Markdown and MDX | Preview, Source, and Live; editable |
| Images, PDF, CSV, JSON, JSON Lines, YAML, HTML, and plain text | Read-only preview where supported; full-cell repository Markdown links in CSV navigate through the document workflow |
| Recognized UTF-8 code and configuration | Read-only code preview |
| Unknown text | Detected on open and shown read-only |
| Other binary files, symlinks, and submodules | Visible with an unsupported-preview state and an Open in System App action |

Ordinary read-only previews do not repeat a capability badge on every file-tree row. Once opened, the
top mode control keeps `Preview` visible and adds a localized read-only status. Tree-row badges are
reserved for states that change or defer the opening result: unknown capability detection, unsupported
preview, and a path missing from the current worktree. The accessible row label still includes the
resolved capability.

Ordinary deep links, shared links, and source-line locations remain limited to Markdown and MDX even
though the file tree can display other types.

`git ls-files` is authoritative. Filesystem fallback is allowed only when a path is genuinely outside a
Git repository. A missing Git executable, corrupt index, or repository error must fail visibly instead
of exposing a second file set that includes ignored content.

## Document modes

OpenGlance has exactly three document modes; their UI names remain `Preview`, `Source`, and `Live`.

### Preview

Preview renders Markdown and allowlisted MDX-lite, refreshes external changes, preserves source line
numbers, supports source-based selection, and understands GitHub-style `#L34-L42` locations. It is the
most stable reading contract and must not regress as editing features evolve.

### Source

Source edits the Markdown or MDX text with CodeMirror 6. It shares the same read, write, line, and
location model as Preview and writes through to disk after a short debounce. There is no separate Save
button or durable draft store.

### Live

Live is a reading-oriented visual layer over the same CodeMirror text model. The active line or block
remains source-editable; inactive Markdown syntax and allowlisted blocks may show previews or small
editing controls. Every change still writes the original Markdown or MDX file. Live must never introduce
a second rich-text data model.

Within Live, contextual editing controls form one interaction family across native tables, controlled images,
links, frontmatter fields, and MDX-lite components. Only one editing target is active at a time. Its
toolbar is anchored above the target, uses the same control sizing and selected-state treatment, and
closes from its close button, Escape, or a different target. The MDX-lite editing toolbar is Live-only.
The controls remain object-specific: a table exposes formatting, an image exposes image actions, and an
MDX-lite component exposes only a few safe component settings plus one explicit whole-source action.
Inline and external component data use that same source entry because both are part of the current
document; there are no additional body-data or view-source shortcuts. Clicking a rendered MDX-lite
surface selects it without moving CodeMirror into the component source.

Controls rendered inside a component for reading are not contextual editing toolbars. In particular,
external-dataset interval buttons remain part of `Chart` or `DataTable`, change only transient view state,
and neither select the component nor write MDX.

Native Markdown tables remain rendered in Live while the user works with them. Clicking a cell edits
that cell's source without replacing the whole table with raw pipe syntax. Pointer dragging, including
a gesture that starts in the active cell editor and crosses into another cell, selects the contiguous
rectangular range bounded by the first and last cell. Horizontal, vertical, and diagonal gestures share
this behavior. The transient formatting toolbar stays anchored above the table and closes through its
close button or Escape. It applies bold, italic, strikethrough, a fixed foreground-color palette, a
fixed text-highlight palette, or clear formatting to every complete cell in the selected rectangle.
Left, center, and right alignment apply to every column intersecting the selection. A column may be
reordered from the explicit handle shown after at least two cells are selected vertically within that
column; the whole column moves even when the selection covers only part of it. Each action is one
CodeMirror transaction and rewrites only the current table block. Preview remains read-only.

Source and Live reload external changes made by Git, editors, or AI agents. Git conflict markers remain
ordinary source text; OpenGlance does not own conflict resolution.

### Working-tree edit cues

For an editable local Markdown or MDX response, the service may return the committed `HEAD:<path>` text
alongside the current source only when that path exists in `HEAD`. A new untracked document has no
committed baseline and therefore reads as an ordinary document without whole-document edit cues; Sync
still reports it as unpublished. A committed empty document does have an empty baseline, so content
added afterward receives the normal edit cues. The index is not a separate presentation authority: the
current file is compared with `HEAD`, so both staged and unstaged edits remain visible. Hosted and other
non-editable responses never receive this baseline or any other local source expansion.

The browser derives transient line and text mappings from those two sources. Current additions and
replacements receive restrained document and gutter highlights in Preview, Source, and Live. Each
changed current line maps to its nearest preceding visible outline heading; lines before that heading
map to a synthetic document-start row. A whole-line deletion maps to its current insertion anchor. The
full navigation row is colored, but its ordinary heading or document-start navigation remains the only
click behavior.

Deleted source is hidden by default. When the user explicitly reveals it, deleted fragments and complete
lines appear only as read-only, struck-through widgets without a separate text or background color. The
existing single current-document line-number gutter does not widen or change numbering; deleted whole-line
widgets use a non-numbered removal marker. Toggling this presentation must not mutate source, selection
ranges, Git state, or line-reference semantics. Publishing or otherwise committing the current file
removes the cues when the document refreshes against the new `HEAD`.

This layer is an editing locator, not a standard Git diff or review surface. It does not expose hunks,
index operations, staging, discard, patch application, conflict resolution, or history rewriting. Text
selection is a separate interaction and must retain a clearly visible theme-specific background in
Preview and CodeMirror, including while a changed or active line is highlighted in dark mode.

### Markdown interoperability

Except for explicitly allowlisted MDX-lite components, OpenGlance must prefer source syntax that remains
readable and editable in Obsidian and other CommonMark or GitHub-Flavored Markdown tools. A visual Live
control is an interface over portable source, not permission to introduce an OpenGlance-only table schema,
hidden metadata, or a second document representation. Exact rendering and editor affordances may still
differ between applications.

In particular, table rows and alignment remain native pipe-table syntax. Bold, italic, and
strikethrough use standard Markdown delimiters. Foreground color and text-only highlight use one
narrowly controlled inline HTML span whose `style` may contain only fixed-palette `color` and
`background-color` values. Highlight never fills the table cell. No class, event handler, font size,
arbitrary style declaration, hidden metadata, or OpenGlance data attribute is stored in the document.
OpenGlance renders only the fixed palettes and escapes unsupported HTML. Alignment changes only the
colons in the native separator row; clearing text formatting does not change alignment. Column
movement reorders the header cell, its separator/alignment cell, and every body cell together. These
sources remain editable in Obsidian even though its toolbar and exact rendering affordances may differ.

MDX-lite is the explicit interoperability exception. It is an OpenGlance-controlled extension and is not
expected to open as an interactive component in Obsidian.

## Rendering, Mermaid, and MDX-lite

MDX-lite keeps structured facts explicit in repository text for agents while presenting the same source
as human-readable tables, timelines, metrics, decisions, flows, and charts. Small component data remains
in the `.mdx` file as readable CSV, TSV, JSON, or Markdown. A long-lived report may instead reference a
repository-local `.dataset.json` contract whose CSV, TSV, or JSON source remains the complete data
authority. Rendering never creates a second authoritative data model. Preview renders the visual result,
and Source and Live continue to edit the original MDX view definition.

Markdown uses `markdown-it`. MDX-lite is parsed by OpenGlance before rendering and produces static HTML or
SVG. It is not a general MDX runtime and cannot execute imports, exports, arbitrary JSX, scripts,
expressions, or event handlers.

A fenced code block whose language is exactly `mermaid` is a portable Markdown diagram, not an
MDX-lite component. The synchronous Markdown renderer emits only an inert shell, escaped source, and
its source-line range. Preview and inactive Live blocks hydrate that shell with the checked-in browser
bundle built from `src/client/mermaid-renderer.mjs`; no CDN or remote rendering endpoint is involved.
The active Live block remains source-editable. Fit, zoom, pan, source visibility, and Smart view are
transient view state and never write the document. Appearance changes rerender the SVG for the active
light or dark theme.

Smart view is a generic presentation decision for bounded flowcharts, not a semantic summarizer. An
explicit author layout disables exploration. Otherwise top-to-bottom is the document-reading priority:
the client may render a horizontal source as a vertical candidate, but never rotates a vertical source
horizontal automatically. It measures fitted text size, aspect ratio, and node geometry, and accepts
the vertical candidate only when all of these invariants hold:

- node, edge, and cluster counts exactly match the source rendering;
- no measured node rectangles overlap.

The complete topology remains the only graph rendered by Smart view. The client does not derive node
lists, semantic groups, or one-hop subgraphs from labels or graph degree: those transformations remove
context without having enough domain information to replace it. When one complete overview still
carries too many concepts, grouping and follow-up diagrams remain author-owned Mermaid source. The
stored fence and the original rendering remain authoritative and accessible, including through the
`</>` source control.

Mermaid runs with strict security, disabled automatic startup, and a 100,000-character source limit.
The client accepts only an SVG result without executable elements, event-handler attributes, or
JavaScript links, and rendered links are non-interactive. Invalid, unsafe, or oversized input leaves a
localized error in the shell while the escaped source remains available through the explicit `</>`
control. The source fence remains authoritative; OpenGlance does not persist SVG or diagram layout state.

An external dataset component remains the existing allowlisted `Chart` or `DataTable`. The synchronous
browser-safe renderer emits an inert view shell containing a finite JSON request, not data or executable
code. Preview and inactive Live widgets hydrate that shell through the localhost-only dataset endpoint.
The server resolves the manifest relative to the current document, follows the manifest source relative
to the manifest, verifies both real paths remain inside the current repository, validates schema and
typed rows, and runs the shared bounded query engine. The engine supports inclusive date ranges, finite
equality filters, ascending natural periods, and manifest-declared day, week, month, or quarter rollups.
The browser receives ordinary component HTML plus provenance and completeness metadata.

The interval controls are transient UI state shared by the Preview and Live views for the current document
session. Switching an interval never writes source. No dataset request executes user code, imports,
network access, SQL, joins, or arbitrary formulas. Missing dates remain absent and are reported; partial
periods are labelled rather than silently treated as complete. A dependency fingerprint covers each
referenced manifest and source file so normal document polling replaces and rehydrates a report when its
external data changes even if the MDX file does not.

Rendered blocks preserve source line ranges. Preview, Source, and Live use the same source-based
selection and Agent Context semantics. Copying a reference includes the repository-relative path, line
range, and original Markdown. Each source line is emitted as a Markdown blockquote, followed by a
plain source attribution outside that quote and one trailing empty paragraph. Direct references and
Agent Context collections both leave the insertion point ready for a user's prompt without entering
the quoted content.

The component allowlist, attributes, input data formats, and rendering contracts live only in
[MDX-lite reference](mdx-lite-guide.md).

## Editing and write boundaries

Document status tracks the current file's committed Git blob independently of its working-file content
and dataset dependencies. A commit or soft reset can therefore refresh edit cues without a file write;
commits affecting only other files do not invalidate this baseline. A baseline-only refresh updates
Preview, Source, Live, and outline cues while retaining the current document surface, editor selection,
and pending local input.

Source and Live write the current file after a short debounce. Watcher events caused by OpenGlance's own
write are ignored by content state to avoid reload loops. External changes reload from disk. A narrow
race may lose not-yet-flushed keystrokes rather than creating an independent hidden draft model.

Document creation is limited to Markdown and MDX. The service adds a safe extension when needed,
rejects paths outside the repository, refuses overwrite, and opens the new document in a foreground tab.

File-tree mutations are deliberately narrower than a general file manager:

- a context menu creates one folder with a zero-byte `.gitkeep`; creation is refused when Git ignores
  that marker;
- when a document is then created in that folder during the same server session, OpenGlance removes only
  the marker it created, and only while it is still zero-byte and untracked;
- F2 or the context menu renames one regular file within its existing directory and refuses overwrite,
  symlinks, and submodules;
- renaming a Markdown, MDX, or image target updates recognized incoming Markdown destinations and
  quoted HTML `href` or `src` attributes, but never treats code examples as references;
- deletion requires an explicit dialog, reports incoming references without rewriting them, and warns
  more strongly when the exact current file contents are not recoverable from Git;
- directory deletion accepts only an empty directory or one containing only an unchanged zero-byte
  `.gitkeep`; recursive deletion and moving are not provided.

Mutation previews include a content and reference fingerprint. The service recomputes the plan after
confirmation and fails on drift instead of applying stale link rewrites or deletion assumptions. Every
mutation still passes through detached-worktree branch protection. The resulting tree row receives
transient feedback without taking focus from the current editing surface.

Editor assistance must remain explainable from source:

- slash commands insert readable Markdown or allowlisted MDX-lite templates;
- inserting MDX-lite into `.md` requires explicit confirmation before renaming to `.mdx`;
- pasted PNG, JPEG, GIF, WebP, or AVIF files go into a nearby `_assets/` directory;
- controlled image markup preserves only safe attributes;
- dialogs use application UI instead of native browser `prompt` or `confirm`.

## Git synchronization

Sync is a repository-level helper, not a fourth document mode. The Sync view presents two independent
facts: the last checked remote state and the unpublished local changes. It processes every Git status
change, including attachments, code, renames, and deletions. Each time the user enters Sync, every
directory chain leading to a changed file starts expanded; a manual collapse affects only that visit.

Remote checking starts after the repository opens and repeats at the persisted user interval. The
bounded choices are 1, 2, 5, 10, 30, 60, and 120 minutes, with 10 minutes as the default. Changing the
preference clears the existing timer and schedules the next check from that moment. Returning to a
visible window after a missed selected interval also triggers a check. Fetching only updates the
remote-tracking ref:

- when the current branch is behind and the worktree is clean, OpenGlance applies a safe fast-forward
  automatically and refreshes the open document without changing its tab or mode;
- when the worktree has local changes, OpenGlance attempts the same protected object-layer merge used by
  the explicit action. A conflict-free result advances the local branch automatically while preserving
  the user's complete local workspace as uncommitted changes;
- if that protected merge finds a conflict, repository drift, diverged history, or another unsafe
  condition, it leaves the real branch, index, and files unchanged and exposes **Merge remote changes**
  as an explicit retry and escalation path. Neither automatic nor explicit down-only merging commits or
  pushes;
- **Sync and publish** remains the explicit up action. It includes any required remote integration, then
  commits and pushes all local changes.

Sync accepts an optional multiline change summary. Its first line becomes the commit subject and the
remaining text becomes the body; a successful publication clears the in-memory draft for that worktree,
while a failed publication retains it. Without a note, `git-commit-message.mjs` generates a localized
description from the staged change types and document titles. It reads bounded Markdown/MDX blobs by
object ID from the staged diff, never from newer working-tree content. Only `change_log.summary` values
added or changed relative to the previous blob may supplement the description. Sorting history or
changing its date does not make an unchanged summary current. New files have no comparison baseline,
so embedded history is not used. Unsupported metadata, binary content, symlinks, and oversized blobs
fall back to file descriptions. This local helper has no model or network dependency and also serves
publication through share links.

For a dirty down-only merge, OpenGlance freezes the complete click-time workspace with an alternate Git
index and an immutable snapshot commit. It merges that snapshot with the fetched remote commit in Git's
object layer. Only a conflict-free result may be applied to the real files, and a final tree comparison
must match the verified object-layer result. The branch ref advances with a compare-and-swap update, the
real index resets to the remote commit, and the combined workspace therefore remains uncommitted. A
short-lived recovery ref protects the frozen snapshot during application. Workspace drift stops before
mutation; an object-layer conflict leaves the real branch, index, and files unchanged.

Automatic application uses the remote-tracking ref that the background check just fetched, so network
latency stays outside the apply phase. Automatic merging then has separate preparation and application
phases. Preparation creates the immutable snapshot, validates the object-layer merge, and retains a
short-lived result without changing the real branch, index, or files. It is bound to the inspected local
HEAD, remote commit, complete workspace fingerprint, and current editor revision; new input or other
workspace drift discards that result and prepares again after the next editing pause.

If an incoming path is the focused Source or Live document, the verified result remains visibly pending
and **Merge remote changes** stays available. OpenGlance applies it automatically after focus leaves the
editor while the application remains in the foreground; moving to another application leaves the result
pending. Only the short, revalidated application phase makes that editor surface inert, so preparation
never drops keystrokes or blocks continued typing. A minimal text update preserves the mapped cursor and
selection and briefly highlights the changed lines. An unrelated open document is not reloaded or made
inert. Automatic failures do not open an interrupting dialog: transient workspace drift or an expired
preparation retries, while a conflict or other stable failure exposes the explicit action for the user.

The guarded publish strategy:

1. Fetch and compare local and upstream history when an upstream exists.
2. Stop before staging if local and remote both have unique commits.
3. Record the initial HEAD and content fingerprint for all changes.
4. Recheck before staging; prepare once again if the worktree changed, then stop if it keeps changing.
5. Stage all changes and create the commit from the index.
6. If the remote is not ahead, push the frozen commit even if new post-commit changes appear.
7. Never automatically rebase a dirty worktree; rebase only a frozen commit when the worktree remains
   safe and the local branch is merely behind.
8. Push the verified commit OID, fetch again, and prove the remote branch contains it before reporting
   success.

Neither action starts during merge, rebase, cherry-pick, revert, or an existing conflict. A failed
publish rebase attempts `rebase --abort`. Divergence, conflicts, repeated workspace drift, and
unexpected Git state stop safely. A copyable prompt for the user's chosen AI agent is the final fallback,
and the down-only prompt explicitly requires an uncommitted, unpushed result.

## Deep links and hosted handoff

The desktop app registers `openglance://`:

```text
openglance://open
openglance://open?repo=<absolute-local-path>&path=<repository-relative.md>
openglance://open?repo=<github-owner/repository>&path=<repository-relative.md>
openglance://open-worktree?repo=<github-owner/repository>&path=<relative.md>&worktree=<local-id>
```

The app also registers and parses equivalent `git-leaf://` links created by 1.x, but never emits that
legacy scheme for a new link.

An empty link only launches or focuses the app. Shareable links use a lowercase GitHub
`owner/repository` identity and do not expose the sender's absolute path. OpenGlance matches that identity
against repositories already opened locally; if no match exists, it asks the user to select a local
repository and verifies its origin before continuing.

An ordinary identity-based `/open` request resolves the matched repository's primary checkout from
Git worktree metadata, regardless of the active or remembered linked worktree. This also applies when
the user selects a linked worktree in the directory chooser. It reads the primary checkout as it is;
it does not switch branches, synchronize Git, or search other worktrees for a missing document.
Explicit local paths and ordinary session restoration continue to use their requested working directory.

`path` must be a safe repository-relative Markdown or MDX path. Traversal, absolute paths, and other file
types are rejected. A worktree-specific link uses `open-worktree`, fails if the exact local ID is
missing, and never silently falls back to another worktree.

The HTTPS `/open` and `/share` endpoints are Mango Future hosted handoff services. They convert safe URL
metadata into a local protocol launch and maintain a random, in-memory handoff state for up to ten
minutes. They do not fetch a Git repository or document body. The exact transmitted metadata and normal
HTTP exposure are documented in [Hosted link handoff](hosted-links.md).

During the installed-client migration, the hosted service emits the equivalent `git-leaf://` handoff
because that compatibility scheme is registered by both Git Leaf 1.x and OpenGlance.
OpenGlance-generated links remain canonical `openglance://` links.

The separate `/download` page never launches a desktop protocol. It shows only manifests explicitly marked
`releaseTrack=public` whose channel, platform, HTTPS URL, SHA-256, size, and on-disk artifact agree.
Internal, legacy, or missing-track manifests must never appear there.

### Shared documents

Shared document links are versioned:

```text
https://gitleaf.mangofuture.com/share?v=1&repo=<owner/repo>&path=<relative.md>&rev=<full-commit>&title=<title>
git-leaf://open-shared?v=1&repo=<owner/repo>&path=<relative.md>&rev=<full-commit>&handoff=<id>
```

Version 1 shares only a document from the primary checkout's `main`. `rev` is the full commit that last
changed the document and must already be reachable from `origin/main`. The receiving app opens a newer
main that contains the revision; it does not detach at that commit.

The HTTPS URL can include a document title of at most 100 characters for link previews. New links do not
include `ai_snippet` or document body content. The hosted page accepts the legacy bounded `snippet`
parameter for compatibility but OpenGlance no longer generates it.

Before copying a link, the sender publishes local changes if the user confirms, fetches the remote, and
proves the revision is on `origin/main`. A local commit or successful push process exit is not enough.
The receiver always resolves the primary checkout, fetches `origin/main`, retries one transient network
failure, and applies only a safe fast-forward or the same guarded sync flow. Ahead, diverged, conflicting,
missing-revision, or continuously changing states stop without silent Git mutation.

A shared URL grants no GitHub permission. The receiving OpenGlance installation uses that repository's
existing local Git credentials.

## Desktop Profile and preferences

Human use of installed official, development, and locally run builds shares the same real Electron
Profile so replacing an app preserves repositories, sessions, appearance, language, favorites, and
sidebar state. Build identity controls labeling, updater eligibility, and analytics eligibility; it
must not select another `userData` directory by itself. The stable Profile directory remains named
`git-leaf`; renaming that persistent path is not part of the product rename.

The single identity-changing exception is a packaged macOS source development handoff to the official
internal build. Its requested target is stored as a bounded receipt in the same Profile. Immediately
before installation, an exact match atomically removes the receipt and the dev build's explicit
analytics initialization; the installed internal package then applies its own embedded default. This
does not create another Profile or move ordinary Community builds onto an official channel.

Agent automation is a separate launch intent. `make smoke-dev-mac` creates a one-time read-only-derived
snapshot, passes explicit isolated `userData` and `sessionData`, verifies the production Profile
fingerprint after the run, and deletes only the temporary snapshot. Failure to create or verify the
snapshot must stop automation; it may not fall back to the real Profile.
The smoke App is installed inside that temporary directory and removed with it. Smoke does not replace
or quit the human App, refresh its Dock icon, or claim the user's default protocol handlers.

Seven preferences are user configurable: `language`, `colorMode`, `documentFont`, `documentFontSize`,
`fileTreeMode`, `showDocumentTitles`, and `gitRemoteCheckIntervalMinutes`. Tabs, tree expansion, scroll,
focus, sidebar state, outline state, and split ratios are restored workbench state, not settings.
Frontmatter rules are repository-owned data. Version and environment information are read-only status.

Preference propagation is directional:

- a workbench renderer that saves a preference updates persistent state and the server snapshot but
  does not receive an echo;
- Settings or Desktop Home may broadcast a persisted normalized result to the workbench;
- color, font, and size changes must not rebuild the file tree;
- a real `fileTreeMode` or `showDocumentTitles` change may rebuild it once;
- a language change flushes editing and workbench state before a safe reload;
- restoring focus or viewport after rendering must not save unchanged state again.

No path may form a render → save session → save preference → broadcast → render feedback loop.

## Build identity and updates

Every packaged app embeds build metadata in `openglance-build-info.json`; readers also accept the 1.x
`git-leaf-build-info.json` filename. Community builds use the technical
`distribution=source, releaseTrack=source` identity, display `Community build`, use the macOS bundle ID
`org.openglance.community`, and use `OpenGlance Community` publisher metadata on Windows. They do not check
Mango Future update feeds or send usage analytics.

Official builds require a reviewed release profile, use `distribution=official`, and select either the
public or internal release track. Public macOS builds use `com.mangofuture.openglance`; internal macOS
builds retain `com.mangofuture.gitleaf`. Both use Mango Future's Windows CompanyName, code signature,
and track-specific update services. See [Release process](release.md).

A human-installed macOS build with `dev=true, distribution=source, releaseTrack=source` keeps the
Community Bundle ID and remains telemetry-ineligible. It has one additional routing capability: it
resolves only `official + internal` on `internal-stable`, accepts only a strictly newer version, and
persists the full target version/build ID/commit/track/channel/platform before download. `dev=false`
Community packages, unpackaged runs, and other platforms remain disconnected from official feeds.

The development handoff uses the same strict version ordering as ordinary official updates. It does not
use Squirrel because the Bundle ID changes: after validating `latest.json`, it downloads the exact ZIP
URL and SHA-256 already named by the internal manifest. Equal or older targets remain current and never
enter the handoff path.

Official update checks read metadata only on launch, hourly, after reactivation, and after sleep. A
valid newer package starts downloading and preparing automatically; the sidebar becomes actionable only
after the package is ready. Choosing **Restart now** or quitting normally installs that ready package.
Checks continue while a package is waiting, and a newer target supersedes it. Windows and development
handoff preparation replace their whole private update cache before writing the new target; after
Squirrel stages a newer official macOS target, OpenGlance removes every orphaned `update.*` directory while
preserving the one referenced by `ShipItState.plist`. The steady state therefore contains at most one
complete downloaded-but-uninstalled package. Failed preparation remains retryable and must not
masquerade as an active download.

Immediately before a normal macOS installation, OpenGlance revalidates that `ShipItState.plist` is a
regular file under the official per-user ShipIt cache, that its update bundle remains inside the staged
`update.*` directory, and that its target is the currently running App. It atomically disables ShipIt's
executable-based bundle rename and replaces signed `Contents` in place. Startup owns the independent
outer-name migration described above. A mismatch fails closed before `quitAndInstall`.

Windows coordinates preparation and cleanup per update-cache root. A valid cached package is reusable
only after its sibling entries are removed, and startup cleanup removes current, older, invalid, and
loose cache entries while preserving at most the newest version that is still newer than the running App.

For a development handoff, the client verifies the extracted App's complete embedded build identity,
official Bundle ID, Developer ID team, and legacy-compatible internal executable before offering
installation. Shutdown starts a detached,
nonprivileged Node helper from the current App. After the dev process exits, the helper revalidates the
persisted receipt, waits for the old App's remaining child processes while excluding its own
Electron-as-Node process, atomically removes the dev-initialized analytics value, transactionally
replaces only the existing App's `Contents`, and confirms the official App can relaunch before
discarding the rollback copy. A failure restores both the old `Contents` and the previous
receipt/analytics state.
This lets already-published internal packages initialize from their embedded analytics default without
target-side receipt code; ordinary official upgrades keep the existing analytics value and Squirrel
path.

## Module boundaries

Source directories follow runtime ownership. Imports within one layer are implicit; cross-layer imports
follow this table:

| Layer | Runtime and responsibility | May import |
| --- | --- | --- |
| `public/` | Browser workbench assets and renderer modules; selected cross-runtime-safe modules also define shared state, localization, and validation contracts | `public/` only |
| `src/content/` | Browser-safe Markdown and MDX rendering used by both the editor bundle and local service | `src/content/`, browser-safe `public/` modules |
| `src/client/` | CodeMirror Source and Live editor implementation | `src/client/`, `src/content/`, browser-safe `public/` modules |
| `src/server/` | Local Node service and repository layer used by the CLI and Electron host | `src/server/`, `src/content/`, Node-safe `public/` modules, root `src/` primitives |
| `src/desktop/` | Electron-only lifecycle, Profile, platform, update, and analytics behavior | `src/desktop/`, `src/server/`, Node-safe `public/` modules, root `src/` primitives |
| root `src/` | CLI entry point plus small build and process primitives | the CLI may depend on `src/server/`; shared primitives remain independent of feature layers |

`public/`, `src/content/`, and `src/client/` must not import Node or Electron runtime APIs.
`src/server/` must not depend on client or desktop code, and no non-desktop layer may import
`src/desktop/`. A `public/` module imported by Node or Electron must remain safe to import without a
browser DOM; browser-only behavior must stay behind an explicit call or runtime guard.

Repository-level `scripts/` contains development and release automation, while `tools/` contains
standalone utilities intended to be copied into other repositories. Neither directory is part of the
packaged desktop runtime.

The following files are key seams, not an exhaustive module inventory:

| Module | Responsibility |
| --- | --- |
| `public/app.js` | Browser workbench orchestration and local-service API client |
| `public/settings-preferences.js`, `public/workbench-session.js` | DOM-free preference and session contracts shared with Electron |
| `src/desktop/main.mjs` | Electron lifecycle, windows, menus, repository selection, settings, deep links |
| `src/desktop/settings-center.mjs`, `src/desktop/settings/` | Full-screen settings/help and restricted IPC |
| `src/desktop/preference-sync.mjs` | Persistence, server snapshots, and renderer preference propagation |
| `src/desktop/config.mjs` | Atomic desktop configuration with last-known-good backup |
| `src/desktop/user-data.mjs` | Shared human Profile and explicit smoke isolation |
| `src/desktop/server.mjs` | Local service launch and port fallback |
| `src/cli.mjs` | CLI discovery, service reuse, and launch |
| `src/server/index.mjs` | Local HTTP API, document IO, rendering, Git actions |
| `src/server/repositories.mjs`, `src/server/git-worktrees.mjs` | Repository identity, worktree discovery, stable IDs |
| `src/server/external-command.mjs` | Command execution and failure classification |
| `src/server/hosted-links.mjs`, `src/server/openglance-open-link.mjs` | Hosted HTTPS link validation and generation |
| `src/desktop/deep-link.mjs` | Local desktop protocol generation and parsing |
| `src/server/git-share-publish.mjs`, `src/server/git-share-open.mjs` | Sender publication and receiver safety |
| `src/content/markdown.mjs`, `src/content/mdx-lite.mjs` | Markdown shells, allowlisted MDX-lite rendering, and inert dataset view declarations |
| `src/content/dataset-query.mjs`, `src/server/dataset-loader.mjs` | Bounded period aggregation and repository-contained typed dataset loading |
| `public/dataset-view.js` | Preview and Live dataset hydration plus transient interval controls |
| `src/client/mermaid-renderer.mjs`, `public/mermaid-layout.js`, `public/mermaid-view.js` | Bundled Mermaid rendering, topology-safe layout decisions, and shared Preview/Live diagram interaction state |
| `src/client/source-editor.mjs` | Shared CodeMirror Source/Live editing model |
| `src/server/git-sync.mjs` | Guarded repository-wide sync |
| `src/server/git-remote-sync.mjs` | Periodic remote status and down-only merge transaction |
| `src/server/git-immutable-snapshot.mjs` | Alternate-index workspace snapshots and object-layer merge |
| `src/desktop/telemetry.mjs` | Official-build analytics state and event contract |

Rendering, editing, repository safety, the desktop shell, and Git synchronization must not absorb one
another's responsibilities.

## Non-goals

OpenGlance does not currently provide:

- real-time multi-user editing;
- cloud accounts, SSO, permissions, or a hosted repository or context service;
- arbitrary MDX, JSX, document scripts, or event handlers;
- a full BI, mapping, graph, linked-filter, or dashboard system; dataset views are deliberately bounded;
- the Obsidian plugin ecosystem;
- an embedded AI chat or agent runtime;
- a context retrieval engine, semantic index, vector database, or MCP service;
- attribution or a formal diff-approval workflow for agent changes;
- a replacement for Git branching, code review, or conflict resolution.

## Architecture invariants

- The selected Git repository remains the shared context source of truth.
- The local editing service remains bound to localhost.
- Live never introduces a second rich-text storage model.
- MDX-lite remains allowlisted and non-executable.
- External datasets remain inside the selected real repository and use explicit typed and rollup
  contracts; the browser never reads them directly.
- Display preferences never change Git scope.
- No write bypasses detached-worktree branch protection.
- Shared links never grant permissions or carry local absolute paths.
- Community builds never impersonate Mango Future official identity or use official update/analytics
  services.
- Runtime dependency edges remain one-way; browser-safe and server layers never import Electron-only
  code.
- Development automation and standalone repository tools remain outside the packaged desktop runtime.
- Tables, images, links, and MDX-lite controls remain explainable from source text.

Repository reading order, test commands, Profile safety, and delivery workflow live only in
[AGENTS.md](../AGENTS.md).
