---
last_updated: 2026-08-27
---

# OpenGlance user guide

English | [简体中文](user-guide.zh-CN.md)

OpenGlance is the people-facing desktop interface for a Git repository used as shared context by a team
and its AI agents. It opens the repository that already exists on your computer. It does not upload or
copy that repository into a separate knowledge service.

This guide is for people who need to understand and maintain the repository without making Git,
Markdown, or a developer tool part of their daily workflow. The screenshots and hands-on examples use
the public
[OpenGlance User Guide Demo repository](https://github.com/openglance/openglance-example-knowledge-base).

## Start here

1. Install OpenGlance from the [public download page](https://gitleaf.mangofuture.com/download), or use a
   [Community Build](build-from-source.md).
2. Make sure the shared Git repository is already available as a local folder. A repository maintainer
   can prepare it for you, or you can clone the public example:

   ```bash
   git clone https://github.com/openglance/openglance-example-knowledge-base.git
   ```

3. Open OpenGlance and choose the repository folder.
4. Use the directory tree or search to find a document. OpenGlance opens Markdown and MDX in Preview by
   default.
5. Switch to Live or Source only when you need to edit. OpenGlance writes those edits directly to the
   original file and saves automatically.

There is no separate Save button. An auto-saved edit is still only a local, unpublished Git change
until someone publishes it.

## Know the app window

![OpenGlance showing a repository tree, document outline, and readable Preview](assets/user-guide/browse-and-read.jpg)

The app window has four main areas:

| Area | What it is for |
| --- | --- |
| Top bar | Open document tabs, Preview / Source / Live modes, sharing, and document actions |
| Left sidebar | Repository folders, search, All / Favorites / Sync views, and Agent Context |
| Document navigation | H1–H5 headings from the current document, with skipped levels compacted; it can be hidden when more space is needed |
| Main area | The current document, editor, or read-only file preview |

OpenGlance restores open repositories and the working state of each repository on later launches,
including tabs, expanded folders, and reading position.

For a Markdown or MDX document whose non-Chinese source filename has a distinct frontmatter `title` or
first level-one heading, its compact tab keeps the filename on a muted first line and uses the document
title as the primary second line. Other files remain on one line. Hover a tab to see the full human title
and repository-relative path. This tab label remains readable even when the directory tree is configured
to show filenames only; the stored tab identity and navigation history still use the real path.

## Find and read context

### Start with the directory tree

The folder structure is the primary way to understand where a document belongs. Expand folders and
select a file just as you would in a familiar file browser.

For a Markdown or MDX filename written without Chinese characters, OpenGlance keeps the source filename
on the first line and shows a distinct document title underneath when frontmatter `title` or the first
level-one heading provides one. Chinese filenames and documents without a distinct title stay on one
line. The title remains the primary visual cue while the filename is slightly muted but still readable.
This second line is enabled by default; choose **Settings & Help → Files & Folders → Show filenames
only** for a compact tree. The title is display-only: sorting, links, file operations, and Git continue
to use the source filename and path.

The sidebar offers three views:

- **All** shows the normal repository tree.
- **Favorites** collects folders and Markdown or MDX documents you return to frequently. Add an item
  from its context menu, use the star beside the open document, or press `Command+D` on macOS /
  `Ctrl+D` on Windows. A nested favorite folder keeps its folder name on the first line and shows the
  parent repository-relative path underneath, so two folders with the same name stay distinguishable.
  Top-level folders and folders inside an expanded favorite stay on one line. After the complete
  repository tree refreshes successfully, OpenGlance automatically removes favorites whose saved paths
  no longer exist; externally renamed files can be favorited again at their new location.
- **Sync** shows remote status and every local file that has not been published.

Files use the same tab behavior in **All**, filtered search results, **Favorites**, and **Sync**. Click a
file to open it in the current active tab. Command-click on macOS or Ctrl-click on Windows opens it in
a new tab and makes that tab active. Keyboard users can focus a file and press `Command+Enter` on
macOS or `Ctrl+Enter` on Windows for the same new-tab action. Shift-click has no special selection
behavior.

The file context menu can also copy the selected repository-relative path or open that exact source
file on GitHub when the repository has a recognizable GitHub `origin`.

Settings can show either **Content files** or **All repository files**. Content mode keeps Markdown,
MDX, HTML, images, and PDFs visible by default, while other files appear when they are open, changed, or
matched by search. This preference changes only the tree display; it never changes what OpenGlance
detects, syncs, commits, or pushes.

### Search without reorganizing the repository

Use the search box above the tree, or press `Command+K` on macOS / `Ctrl+K` on Windows. Space-separated
terms are combined, so `spring plan` keeps items that match both terms. Search temporarily reveals the
folders needed to reach a result and does not permanently replace your manual folder choices. It
matches folder names, file names, displayed document titles, and repository-provided search summaries;
it is not full-text document search. When document-title display is turned off, hidden titles are also
excluded from tree search rather than becoming invisible search fields. When a search summary needs an
expansion, the floating window keeps the filename and title above the complete highlighted summary
instead of replacing them.

### Read with source references

Preview renders the document and keeps its original source line numbers. The outline follows H1–H5
headings in the document. A sole leading H1 acts as the document title and stays out of the outline.
Skipped heading levels do not create empty indentation: for example, a document that uses H3 followed
by H5 shows those headings at two consecutive navigation depths. H6 remains available in the document
but stays out of the outline. Internal document links stay inside OpenGlance; use Command-click on macOS
or Ctrl-click on Windows to open a link in another tab.

Source-backed line numbers are also useful when you need to show an AI agent exactly where a question
or correction came from.

### Return to unpublished edits

When the current Markdown or MDX file differs from its last committed version, OpenGlance presents a
lightweight editing trace in Preview, Source, and Live:

- current additions and replacements use a restrained warm highlight in the document and line-number
  gutter;
- every affected section uses that color across the full width of its document-navigation row, while
  keeping the normal click target and section jump;
- a change before the first visible navigation heading appears as **Document start**, which returns to
  the top of the document;
- opening another document and returning reconstructs the same cues from the repository, so there is
  no separate draft marker to maintain.

The compact top-right **Show deletions** control is available only when text has been removed and starts
off. A small solid status dot appears on the icon while the control is on, so its state remains clear
without turning it into a primary action. Turn it on to show deleted fragments and complete lines as
read-only text with a strikethrough and no separate text or background color. The ordinary single
current-document line numbers stay exactly as they were; a removed whole line uses a non-numbered `−`
marker. These cues do not write deleted text back into the file.

The committed version means `HEAD`, while the current side is the file now on disk. This includes both
staged and unstaged local work. A new, untracked document has no committed version to compare and opens
as an ordinary document instead of highlighting its entire contents; Sync still shows it as unpublished.
After the document has been committed, later edits receive the normal cues. The feature is intentionally
not a full Git diff viewer: it does not expose hunks, stage or discard changes, or resolve conflicts. Sync
remains the place to see all unpublished files, while this document view is for quickly locating and
continuing an edit.

## Choose the right editing view

OpenGlance always edits the original Markdown or MDX file. The three modes are different views of the
same source:

| Mode | Use it when |
| --- | --- |
| **Preview** | You are reading, following links, or selecting source-backed context |
| **Live** | You want a focused everyday editor where headings, lists, links, and other structure remain easy to read |
| **Source** | You need exact control of Markdown, MDX, frontmatter, or structured data while keeping Preview visible |

![Live keeps the document readable while editing the original source](assets/user-guide/live-editor.jpg)

Live is the normal choice for a small correction. It is not a second rich-text document: the text still
belongs to the repository and remains readable to agents and other tools.

Live uses one contextual editing pattern for controlled images, links, frontmatter fields, native
tables, and MDX-lite components. Only one object is active at a time, its compact toolbar stays above
the object, and the toolbar closes with its close button, Escape, or selection of another object.
Clicking an MDX-lite component keeps it rendered; `</>` is its single source entry for both inline and
external data. Preview does not show the MDX-lite editing toolbar.

In a native Markdown table, click a cell to edit only that cell's source. You can start a drag while that
cell is still being edited; crossing into neighboring cells selects the rectangle between the start and
end cells in any direction. The formatting toolbar stays above the table and applies bold, italic,
strikethrough, foreground color, or text-only highlight to every selected cell. Its alignment controls
align every column touched by the selection; clearing text formatting leaves alignment unchanged. The
two fixed color palettes open only when needed, and the toolbar closes with its close button or Escape.
Selecting two or more cells vertically in one column reveals the small column handle; drag it to move
the whole column. These controls are available in Live, while Preview remains read-only. The saved
document stays a native pipe table using standard Markdown, separator-row alignment, and narrowly
controlled Obsidian-compatible inline styles rather than an OpenGlance-only table format.

![Source exposes the exact Markdown beside the rendered document](assets/user-guide/source-editor.jpg)

Source is useful when an agent has written syntax that you want to inspect precisely, or when you need
to adjust frontmatter and structured blocks. Both Source and Live auto-save to the local working
directory.

Only Markdown and MDX are editable inside OpenGlance. Other repository files are read-only previews or
open in a system application. Ordinary read-only files use the full file-tree row for their filename;
after you open one, the mode control shows **Read-only** beside Preview. The tree keeps badges only for
states that change or defer opening, such as detection, unsupported preview, or a missing file.

### Read Mermaid diagrams without leaving the document

A standard fenced `mermaid` block stays ordinary Markdown source and renders locally in Preview. In
Live it renders whenever the cursor is outside that complete block; move the cursor into the block to
edit the original syntax.

Use **Fit width** to return to the current complete view, `+` and `−` to zoom, and drag the canvas after
zooming in. The `</>` button switches the card to the exact Mermaid source and back. These controls are
temporary reading state and never rewrite the file. Dark and light appearance rerender the diagram for
the active theme. If the syntax is invalid or too large, the card reports the error and keeps `</>`
available for inspection.

For a dense `flowchart`, **Smart view** treats top-to-bottom as the document-reading direction. A
horizontal source is presented vertically only after OpenGlance confirms that its node, relationship, and
cluster counts still match and no nodes overlap. An already vertical graph is never rotated horizontal
automatically. The complete vertical graph stays visible. OpenGlance does not replace it with a node list
or a synthetic one-hop diagram; turn off **Smart view** whenever the author's original rendering is the
better reference.

This decision uses only graph structure and measured geometry, not labels or domain-specific rules.
An author-selected Mermaid layout is never overridden. Use an automatic `flowchart` for a directional
process; use an explicit layout or `block-beta` when intentional placement matters. Keep overview labels
short and use explicit subgraphs or follow-up diagrams when the concepts themselves remain too
numerous.

## Keep data readable to agents and visual for people

An `.mdx` document can keep chart series, table rows, metrics, timelines, decisions, and flows as
ordinary CSV, TSV, JSON, or Markdown text. AI agents can read and update that source directly. OpenGlance
turns the same source into visual blocks for people.

For a long-running report, the complete CSV, TSV, or JSON may live beside the document with a
`.dataset.json` description. A report author can give a `Chart` or `DataTable` a fixed date range; readers
then use the buttons above it to select only views supported by the declared source granularity. Daily
sources offer day, week, month, and quarter. Weekly sources offer week, month, and quarter by assigning
each whole week to the natural period containing its fourth day; they do not invent daily values. The
buttons change only the view and never rewrite the report or source data. OpenGlance calls out missing
source periods, incomplete display periods, and omitted incomplete boundary periods. These interval
controls belong to the rendered component; they are not Live editing toolbars and do not select the
component.
When a spreadsheet or BI export has presentation-only, duplicate, or multiline headers, its sidecar can
select the intended physical columns explicitly; the source file stays unchanged.

![OpenGlance rendering a chart from structured data stored directly in an MDX document](assets/user-guide/mdx-visuals.png)

This avoids a screenshot or separate dashboard becoming the only place where important data exists.
Preview renders the result; Source and Live continue to edit the original file. OpenGlance accepts only a
controlled set of components and never runs arbitrary JSX, JavaScript, imports, or document scripts.

Repository maintainers who create these components can use the technical
[MDX-lite reference](mdx-lite-guide.md). Most readers only need to open the document and use the
rendered result.

## Give exact context to an AI agent

There are two ways to copy source-backed context, depending on whether the answer is in one document or
spread across several documents.

### One document: copy selected lines

For a quick question about the document in front of you:

1. Select the relevant source lines in Preview, Source, or Live.
2. Choose **Copy content**.
3. Paste the result directly into Codex, Claude, or another agent tool.

For example, selecting lines 16–17 in `demos/agent-context-and-sync.md` produces:

````markdown
> 16 | OpenGlance opens a local Git repository and presents it as a readable workspace. The repository remains
> 17 | the shared source of truth. OpenGlance does not upload the content or create a separate hosted copy.

Source: demos/agent-context-and-sync.md:16-17
````

The copy includes the repository-relative path, selected line range, original line numbers, and original
Markdown. The selected lines are a quote, while the trailing source attribution stays outside that quote.
The copy ends with an empty paragraph, so after pasting it the user can type the prompt immediately. It is
ready to paste without first adding anything to the Agent Context basket.

### Several passages: build an Agent Context collection

When one task depends on several passages from one or more files:

1. Select source-backed lines in Preview, Source, or Live.
2. Choose **Add to context**.
3. Repeat for every relevant passage, opening another document when needed.
4. Open **Agent Context** at the bottom of the sidebar to inspect or remove what you selected.
5. Copy the collection and paste it into Codex, Claude, or another agent tool.

![Source-backed passages collected in Agent Context](assets/user-guide/agent-context.jpg)

A two-passage collection is copied in this form:

````markdown
# Agent Context

Repository: openglance-example-knowledge-base
Worktree: main checkout
Branch: main
Revision: 0123456789abcdef

> 16 | OpenGlance opens a local Git repository and presents it as a readable workspace. The repository remains
> 17 | the shared source of truth. OpenGlance does not upload the content or create a separate hosted copy.

Source: demos/agent-context-and-sync.md:L16-L17

> 24 | People use Preview, Live, and Source to read, inspect, and make focused edits. Agents and developers
> 25 | work directly with the same repository through Git and their normal tools.

Source: demos/agent-context-and-sync.md:L24-L25
````

The repository, worktree, branch, and revision appear once at the top; every selected passage then has
its own quoted lines and trailing source attribution. The values above are illustrative—OpenGlance copies
the actual metadata from the current working directory. After the final source attribution, the copied
collection ends with the same empty paragraph ready for the user's prompt.

Agent Context is temporary session state and is isolated by repository and worktree. It can collect
several files from the current working directory, but it is not a cross-repository or long-term
database and is not sent automatically to any AI provider.

## Inspect local and remote changes

OpenGlance checks the configured Git remote when a repository opens and then on the interval selected
under **Settings → General**. The default is 10 minutes; the available intervals are 1, 2, 5,
10, 30, 60, and 120 minutes:

- If the local working directory is clean and only behind, OpenGlance safely fast-forwards it.
- If local edits also exist, OpenGlance automatically applies a conflict-free remote update while leaving
  every local edit uncommitted.
- If that update affects the focused Source or Live document, OpenGlance prepares it in the background,
  shows **Remote update pending**, and applies it automatically after focus leaves the editor while Git
  Leaf remains active. Switching to another app leaves it pending. Continued typing invalidates the
  prepared result instead of losing input.
- If the protected automatic merge cannot finish safely, **Merge remote changes** appears as an explicit
  retry. A real conflict leaves the working directory unchanged.
- **Sync and publish** integrates any required remote update, then commits and pushes **all local
  changes in the repository**.

Changing the interval reschedules the next check immediately. It never turns commit or push into a
background action.

![Sync showing one unpublished file and the explicit Sync and publish action](assets/user-guide/sync-and-publish.jpg)

Sync is deliberately repository-wide. Before publishing, make sure every file shown in Sync belongs
in the next shared revision. **Change summary (optional)** accepts a short description; the first line
becomes the commit title and subsequent lines become its body. The draft stays available after a failed
publication and clears after success.
**Sync and copy** when sharing an unpublished document uses the same summary.

Leave the field blank to generate a local description using change types and document titles. For
existing Markdown or MDX documents, OpenGlance compares the committed and staged versions and includes
only newly added or edited `change_log.summary` values. Unchanged or reordered history is not reused;
the newest date alone does not identify this edit. New documents use their title because any embedded
history may have been copied from elsewhere. This does not require an AI service or upload document
contents. Long descriptions are shortened and large change sets show a bounded set of details; Git
retains the complete file list.

When an external AI agent edits the same local working directory, its files appear in Sync like any
other local changes. Open the affected documents to read the current result. OpenGlance currently shows
changed files and their current contents; it is not a full line-by-line diff reviewer and does not
attribute a change to a particular agent.

If local and remote history have diverged, a conflict appears, or another Git operation is in progress,
OpenGlance stops instead of rewriting history or leaving an unresolved merge in the real working
directory. The failure screen can provide a prompt to hand to an AI agent when developer-level Git
repair is required.

## Open the right local document from a URL

Online document tools make collaboration feel simple partly because one URL opens the right document.
OpenGlance provides the same click-to-open convenience while the files and source of truth remain in a
local-first Git repository.

The normal Agent-to-person flow is:

1. A repository instruction tells the Agent to run a trusted link generator for the Markdown or MDX
   file it wants the user to inspect.
2. The Agent returns an HTTPS **Open in OpenGlance** link instead of only a local path.
3. The browser opens Mango Future's `/open` handoff page and, on the first use, may ask permission to
   launch OpenGlance.
4. OpenGlance matches the GitHub repository identity, asks the user to choose a local repository when
   necessary, and opens the document in its primary checkout. A linked-worktree URL selects that exact
   worktree on the same machine and reports an error if it is missing.

After installing OpenGlance and making the public example available locally, try the complete handoff:

Open in OpenGlance:
[OpenGlance user guide demo](https://gitleaf.mangofuture.com/open?repo=openglance%2Fopenglance-example-knowledge-base&path=guide%2Fuser-guide.md)

### Teach an Agent to return the link

This repository includes a
[ready-to-copy standalone generator](../tools/generate-openglance-open-link.mjs). It depends only on
Node.js and Git. A content repository can keep the file at the same path and add a repository
instruction like the following:

```markdown
## OpenGlance document previews

When the final response should let the user preview a Markdown or MDX file, run the repository-owned
OpenGlance link generator:

node "$(git rev-parse --show-toplevel)/tools/generate-openglance-open-link.mjs" \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --file "<repository-relative.md-or-mdx>"

Use the returned HTTPS URL exactly in a Markdown link:
`Open in OpenGlance: [<document title>](<returned HTTPS URL>)`

Do not return only a local absolute path, and do not handcraft `/open`, `/share`, or `openglance://`
URLs. `/open` is for local navigation and preview; it does not prove the file is published. For a link
sent to another person, first publish the document to `main`, then use OpenGlance's Copy share link.
```

Keep these boundaries in mind:

- The repository needs a recognizable GitHub `origin`. The URL identifies the repository and the
  repository-relative `.md` or `.mdx` path; it does not contain the document body or Git credentials.
- A primary-worktree `/open` link is portable to another authorized local checkout. A link generated
  from a linked worktree includes a local worktree ID and works only on the machine that created it.
- The link does not clone the repository or grant access. The recipient must already be authorized to
  use a local checkout.
- Opening an `/open` link does not sync, publish, or verify a revision. Use the in-app sharing workflow
  for a published result intended for another person.

| Link | Best used for | What it guarantees |
| --- | --- | --- |
| `/open` | An Agent returning a local preview or navigation target | Opens the matching local file; no publication or revision guarantee |
| `/share` | Sending a published document to another person | Carries a revision verified on `origin/main` before the link is copied |

## Share a published document

**Copy share link** creates a versioned link for a Markdown or MDX document on `main` in the primary
working directory. If the document has unpublished changes, OpenGlance asks before **Sync and copy**
commits and pushes the repository, verifies the revision on `origin/main`, and copies the link.

Keep these boundaries in mind:

- The link does not contain the document body, Git credentials, or an absolute local path.
- It does expose the GitHub repository identity, repository-relative path, revision, and optional title.
- It does not grant the recipient access to a private repository.
- The recipient needs a local checkout they are already authorized to use.

The HTTPS handoff is hosted by Mango Future. Read
[Hosted link metadata and privacy](hosted-links.md) before using a sensitive repository path or title.

## Work with repositories and worktrees

OpenGlance can keep several repositories open. Their saved order remains stable until you rearrange it, and
each one restores its own tabs and navigation state.

Choose the repository button beside the current repository name, or press `Command+O` on macOS and
`Ctrl+O` on Windows, to open the centered repository panel. Type to filter the stable repository list,
use the arrow keys and `Enter`, or choose a visible row directly. While the panel is open, `Command+1`
through `Command+9` on macOS (`Ctrl+1` through `Ctrl+9` on Windows) select the numbered visible
repositories; `Command+0` or `Ctrl+0` opens another local Git repository. These number keys keep their
normal document-tab and zoom behavior after the panel closes.

Drag the grip at the left of a repository row up or down to change the saved order. You can also focus
the grip and use the Up or Down arrow key. The visible number shortcuts update immediately to follow the
new order.

The row action can remove a repository from OpenGlance. This removes it only from the open repository
list: OpenGlance does not delete the local directory, Git files, branches, or unpublished changes. Opening
the same repository again restores its saved workspace state and Favorites.

If a requested document is missing or unreadable, its error appears in the workbench. Choose another
file from the tree or switch repositories as usual. If the repository or worktree itself is unavailable,
Home shows the error alongside **Opened repositories**, where you can choose another saved repository
without locating its folder again.

When a repository has multiple Git worktrees, the worktree selector replaces the repeated repository
name in the sidebar header while the repository-panel button remains separate. Each worktree keeps
separate tabs, folder state, reading position, and local changes. Favorites are shared across the
repository. Most people should remain in the primary working directory unless a repository maintainer
or AI agent has asked them to use another worktree.

If a worktree has no branch, OpenGlance creates a protective local branch before the first real write.
It never leaves an edit on a detached Git commit.

## Open other repository files

OpenGlance keeps the document workflow focused while still making surrounding evidence available:

| Files | What OpenGlance does |
| --- | --- |
| Images and PDFs | Read-only visual preview |
| HTML | Read-only rendered preview |
| CSV | Read-only table preview; a cell containing only a repository-local Markdown link opens that document |
| JSON | Formatted tree, with text fallback when parsing fails |
| JSON Lines (`.ndjson`, `.jsonl`) | One collapsible, wrapping JSON tree per line; invalid lines keep their original text |
| YAML, text, code, and configuration | Read-only text or code preview |
| Unsupported attachments | Opens them in an appropriate system application when possible |

Use **All repository files** when you need to browse beyond the normal content view.

## Settings, help, and shortcuts

Open Settings and Help with `Command+,` on macOS or `Ctrl+,` on Windows. From there you can change:

- interface language: system default, English, or Simplified Chinese;
- light or dark appearance;
- document font and text size;
- Content files or All repository files;
- build, update, and usage-analytics settings available for the installed distribution.

Official builds download a valid newer version automatically. The lower-left update card shows
preparation without a download button, then offers **Restart now** when the package is ready; quitting
normally installs it too. If a still newer version appears first, it replaces the waiting package, and
the update cache keeps at most one complete downloaded-but-uninstalled package.

The same screen contains OpenGlance Help, supported file types, environment and repository status, and
the complete keyboard-shortcut list. Open shortcuts directly with `Command+?` on macOS or `Ctrl+?` on
Windows.

## When to use another tool

OpenGlance is the appropriate interface when a team and its agents share a Git repository, but some of
the people responsible for the content do not want a developer workflow.

Use an IDE or Git client for detailed diffs, selective staging, branch creation, rebasing, conflict
resolution, code refactoring, or repository administration. Use an external AI agent for broad edits
and developer-level repair. OpenGlance stays focused on helping people read, inspect, provide exact
context, and make bounded corrections to the same files.

For product scope, download options, and build identity, return to the [OpenGlance README](../README.md).
