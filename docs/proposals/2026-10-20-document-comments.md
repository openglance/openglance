---
last_updated: 2026-10-28
---

# Proposal: Git-backed document comments

Status: proposed; reviewed with revisions. This document does not authorize or describe a shipped
feature. It is for OpenGlance product reviewers, implementers, and agents working on the file format.
The [implementation audit](2026-10-20-document-comments-research.md) records the source revisions,
bounded experiments, and limits behind the recommendation.

The format and write-safety prototype was authorized on 2026-10-28. Its
[results and reproducible commands](2026-10-28-document-comments-prototype.md) cover raw-file agent
writes, source preservation, editor-state history, and cooperating Git transactions. It remains
separate from the App; editor save compatibility and production integration gates are still open.

## Recommendation

Store comment threads in the original Markdown file as separate HTML comment blocks, placing new
threads at the end by default. OpenGlance recognizes standalone records throughout the document and
presents them beside it. Agents can read and modify the same plain text without an App session,
account, database, or MCP connection.

The user requirements are that comments travel through Git, OpenGlance can read and write them, and
agents have a direct file interface. In-file storage is a preferred candidate, conditional on preserving
ordinary Markdown. The record layout, JSON schema, conservative anchor matching, and initial scope
below are recommendations for review, not previously approved product decisions.

Proceed first with a bounded format and write-safety prototype. Do not treat HTML syntax support,
source-line mapping, or another product's README as proof that interoperability and concurrent editing
are solved. Initial support should target `.md`. Ordinary MDX toolchains have different comment syntax;
`.mdx` support needs its own compatibility decision and fixtures.

## Intended workflow and scope

A teammate reads a repository document, comments on a passage, and publishes through the existing
Git workflow. Another teammate or agent receives both content and discussion after synchronization.
An agent can reply, revise the content, and attach a proposed location for the result. The reviewer
can navigate to that result, verify it, and resolve the thread without losing the original quotation.

The first version should support creating a thread, replying, resolving, reopening, manually locating
a displaced comment, and explicitly deleting a thread. Resolved discussions remain in the file until
explicitly deleted. Changing the document or receiving an agent reply does not resolve a thread.
Resolution and deletion are explicit actions, not inferred approval or automatic cleanup.

Real-time co-editing, notifications, separate commenter permissions, automated execution of feedback,
replacement suggestions with one-click application, and PR integration are outside the first version.
No new Git synchronization channel or background commit behavior is required.

## File format

Each thread occupies one independent top-level HTML comment in its owning file. New threads are
appended at a safe EOF by default; an existing thread is edited in place. There is no path or local
repository identifier in a thread. Renaming or moving the file carries its comments;
copying it also copies them. Thread IDs are scoped to the owning document, not globally deduplicated
across copied files.

An illustrative document is:

```markdown
# Launch plan

We plan to launch next month.

<!-- openglance-comment:v1
{
  "id": "b35f3051-d226-48ed-9a92-f2a6687dd21b",
  "status": "open",
  "anchor": {
    "exact": "next month",
    "prefix": "We plan to launch ",
    "suffix": "."
  },
  "messages": [
    {
      "id": "285069c9-28c0-41a5-ae20-33b866b91443",
      "author": { "name": "Javen", "kind": "human" },
      "created_at": "2026-10-20T04:00:00Z",
      "body": "Please name the date and the conditions required for launch."
    }
  ]
}
-->
```

The marker versions the format. The payload is UTF-8 JSON; messages contain Markdown strings rather
than serialized HTML. Required data consists of a UUID thread ID, `open` or `resolved` status, a source
selector, and a nonempty message array. Every message has a UUID, an author name and `human` or `agent`
kind, an ISO 8601 UTC timestamp, and a body. Message order follows the array; clocks do not establish
authority or a reliable global ordering. Author fields are editable attribution, not authenticated
identity. Git commit attribution remains separate.

The implementation specification must fix finite size limits for threads, messages, and selectors,
with visible failure rather than truncation. Store no credentials, absolute local paths, model session
IDs, or derived DOM coordinates. Unknown fields must survive a supported edit. Unknown format versions,
duplicate IDs, invalid fields, and malformed JSON produce diagnostics with the original bytes retained;
they must never be rewritten into an empty/default comment collection.

Use stable field order and formatting for a changed thread. Preserve every untouched thread and all
ordinary document bytes, including line endings. Adding one message must not reserialize all threads.
Independent blocks reduce the extent of a diff; simultaneous appends or replies can still conflict.

### Record recognition and HTML compatibility

Default placement and recognition are separate rules. Recognize a standalone comment envelope in
top-level Markdown context anywhere in the file, even when ordinary body content follows it. An agent
appending a new section after a thread must not make that thread disappear or require repair. Rendering
or saving must not move existing records back to EOF or otherwise normalize their positions.

Discover envelopes independently of payload/version validation: an invalid or future-version record
must not cause neighboring valid threads to disappear. Recognize the opening marker and a structurally
valid closing delimiter, then validate its payload. An unterminated candidate is a diagnostic, not
permission to consume or delete the rest of the file. Examples in fences, indented code, inline code,
ordinary HTML comments, and HTML containers are document content. A regular expression over the whole
file is insufficient. A record must occupy complete source lines, with its opener and closer on their
own lines. Its projection range includes the closing line's terminator when present. The implementation
grammar must cover adjacent valid and invalid records, including records followed by headings, lists,
or paragraphs.

Before appending, verify that EOF is outside an unclosed code fence or HTML container. If there is no
safe top-level insertion point, keep the draft comment in the UI and explain which document structure
must be repaired. Do not close or otherwise rewrite the author's Markdown automatically.

Serialize JSON with literal `<` and `>` escaped as `\u003c` and `\u003e`. This prevents payload text such
as `-->`, `--!>`, or a nested comment opener from breaking the HTML envelope while preserving normal
JSON decoding. Never use executable markup or Base64 as the comment storage format.

The HTML envelope follows [CommonMark HTML comment syntax](https://spec.commonmark.org/0.31.2/#raw-html).
This is an OpenGlance data convention carried by standard syntax, not a standard cross-editor comment
protocol. It does not guarantee that every Markdown editor hides or preserves the payload. A renderer
with HTML disabled may display it; an editor that reconstructs Markdown may discard it. The acceptance
matrix below must test concrete readers and save paths before claiming interoperability.

## Locating comments

Use Markdown source text as the selector's coordinate space, excluding recognized record line ranges
wherever they occur, including unsupported or malformed payloads with valid envelopes. In this
matching projection only, convert CRLF/CR line endings to LF; retain a mapping to physical source
positions and never rewrite the file's line endings. Apply no other whitespace or Unicode normalization.
`exact` is the selected source substring in that projection; `prefix` and `suffix` are bounded source
context on either side. The prototype should start with up to 64 Unicode code points per side and test
repeated passages before fixing that bound. Do not store byte/DOM offsets as durable identity.

At creation, capture the actual selected range, then derive its text and context. Searching for the
first occurrence of selected text to construct the selector would anchor repeated phrases incorrectly.
Line numbers and offsets may help navigation within the current file revision but cannot establish
identity after edits. No prior commit is required: untracked and modified documents are valid inputs.

Resolution derives a presentation state separately from the saved discussion status:

| Derived state | Meaning and presentation |
| --- | --- |
| Located | An exact source match is uniquely established, using both context sides to disambiguate repeated text; show the corresponding range |
| Needs location | Multiple candidates remain, or surviving text has contradictory/insufficient context; retain the quote and request manual location |
| Missing | The original passage cannot be found; retain the quote, messages, and saved open/resolved status |

If `exact` occurs only once but both nonempty context sides contradict it, require manual location;
the original passage may have been deleted while a different copy survived. When one side changed,
the matching side can support a unique candidate. Empty context is not positive matching evidence.
The implementation specification must turn these rules into deterministic cases before shipping.
Version one should not automatically match rewritten prose by similarity.

Manual location changes append the previous selector and change attribution/time to `anchor_history`
before updating `anchor`. They preserve the original quote. A render refresh never rewrites selectors.
This borrows the quotation-and-context idea from
[W3C TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector), but uses explicit
source semantics; it does not claim full W3C protocol or normalization compliance.

### Connecting an agent revision to its result

An agent changing `next month` to `on November 1` removes the original `exact` match. Its reply should
be able to point to the revised passage without overwriting the original anchor or forcing the reviewer
to search for the change. Recommend an optional `revision_target` on an agent reply message:

| Field | Proposed meaning |
| --- | --- |
| `revision_target.body_hash` | `sha256:` followed by 64 lowercase hexadecimal digits, identifying the revised body projection |
| `revision_target.anchor` | An `exact`, `prefix`, and `suffix` selector for the result, captured from the actual revised range |

Keep the target on its reply so subsequent replies can propose newer results without erasing earlier
ones. Recommend the following deterministic body-hash projection:

1. Remove the complete source-line ranges of every recognized record, independently of payload
   validity, using the same ranges excluded from source selectors.
2. Normalize CRLF/CR to LF, then remove terminal LF characters. This ignores blank EOF separators
   needed when appending a new record, including when the body originally had no final newline.
3. Hash the remaining UTF-8 text with SHA-256. Preserve spaces, internal blank lines, and Unicode
   exactly; do not hash the rendered HTML or normalize the body through a Markdown serializer.

Hashing the complete file would include the hash itself and make unrelated replies invalidate the
reference. Comment mutations must preserve ordinary body bytes and internal separators; under these
rules, appending at EOF, replying, or deleting only a record leaves the digest unchanged. A change to
projected body text, apart from the specified line-ending/terminal-LF normalization, invalidates it.
The format prototype must publish shared reference vectors and validate this projection against the
actual record parser. Projection never rewrites the file, and terminal-LF removal is for hashing only;
source selectors retain their original projected context.

For the example document with the body changed to `We plan to launch on November 1.`, an agent reply
can include this fragment alongside its required message fields:

```json
{
  "revision_target": {
    "body_hash": "sha256:d2779a1274a295da96ef68e3d3549561bfd348bdcf1f9743f0ad254a76c59690",
    "anchor": {
      "exact": "on November 1",
      "prefix": "We plan to launch ",
      "suffix": "."
    }
  }
}
```

Show a link labeled as an agent-proposed location only when the body hash matches and the result
selector establishes a unique location under the same conservative matching rules. Otherwise retain
the proposal with an explicit stale, ambiguous, or missing indication. A newer body revision must not
silently reuse a previously verified target. The hash establishes a version relationship, not proof
that the feedback was correctly addressed.

The original thread anchor and open/resolved status remain unchanged when the reply is read. The
reviewer can inspect a valid target even when the original passage is Missing, and can explicitly
adopt it through the existing manual-location action. That action records the previous selector,
actor/time, and originating reply ID in `anchor_history`. Resolving the discussion remains a separate
explicit action. Agents can write the optional target directly or through the shared helper; a reply
without one remains valid and leaves the original anchor's derived state visible.

### Mapping Preview selections

Preview must map a rendered selection to an exact source range. Source-line ranges are useful existing
infrastructure, but do not establish character mapping across emphasis, links, entities, or table cells.
Where exact mapping is unavailable, explicitly offer a source-backed paragraph/line-range comment, or
disable that selection with a clear explanation. Do not silently attach a sentence comment to a
different or larger passage. Code-block text can be selected when its source range is known; rendered
Mermaid, images, and MDX component internals are deferred.

## OpenGlance presentation

| Surface | Proposed behavior |
| --- | --- |
| Preview | Keep the body read-only; a selection action creates a comment, and a restrained range marker opens an unresolved thread; resolving removes that thread's body decorations completely |
| Comments panel | Show quote, attribution, messages, reply and resolution actions, and proposed revision locations; filter open, resolved, and comments needing location |
| Live | Use the same thread data and panel, coordinating comment writes with the active source buffer |
| Source | Expose the original data as editable source, optionally folding record blocks wherever they occur; retain actual file line numbers |
| Narrow window | Present the same panel as a drawer with a way back to its passage |

The selected UI direction is a persistent right-side Comments panel, while Agent Context retains its
existing left-sidebar position. Existing copy and Agent Context actions remain available. Selected
comments can be copied with their quotes and IDs for an agent; raw file access remains sufficient. Do not copy every resolved
discussion into ordinary body selections by default.

Resolving a thread restores its passage to normal reading: remove the associated comment highlights,
range markers, pins, anchored bubbles, and any open quote-comparison overlay from the body. Do not leave
a faded marker behind. The original quotation and messages remain accessible through resolved comments
in the panel. Inspecting that history does not restore body decorations; explicitly reopening the
thread can restore its unresolved marker when its anchor is located. Other unresolved threads retain
their own presentation.

Render messages as inert, sanitized Markdown using bounded local document-link behavior. A comment
must not execute HTML, JSX, scripts, event handlers, shell commands, or automatic agent actions. Reading
untrusted repository text must not cause an agent to treat comment content as higher-level instructions.

Only the view hides recognized records. Source and Live retain one complete source model. Body titles,
outline, link previews, and MDX/dataset discovery must not interpret stored comment text as document
structure or executable references. Preserve source line mapping through any rendering projection.
Comment-only changes should appear in Sync and in the comments panel without painting the entire
document body as changed. These are implementation requirements, not current behavior.

## Agent writes, editor writes, and Git

Agents can inspect the format and use ordinary file patches. They must preserve unknown fields,
unrelated threads, and existing IDs; replies append messages rather than replacing history. A packaged
format reference and a small optional file helper should provide the same parse, validate, serialize,
and ID-based mutation functions used by the App. A helper is recommended for safe writes and escaping,
but an App process or MCP server cannot be a prerequisite for reading the file.

### File transactions and editor history

OpenGlance-controlled writes need one coordinated transaction path for Source, Live, comment actions,
and the optional helper: read the current file, check the expected source hash, mutate the intended
record/range, and write under per-path serialization. Preserve an unsaved comment/reply if the check
fails. A stale full-document save must not remove a newly added thread. Flush or reconcile an active
editor buffer before writing through the panel; preserve that buffer on conflict.

Incoming file changes and persisted panel actions must be distinct from local Source/Live typing in
the undo history. Recommend that saved panel actions use explicit Delete/Reopen controls rather than
the text editor's Undo; an unsent comment textbox retains its own normal undo behavior. Direct edits
to record text in Source remain ordinary, explicit source edits.

Synchronize incoming comments and panel writes into the full editor model using non-history
transactions that map existing local undo/redo ranges through the changes. Do not replay a stale
full-document snapshot on Undo or Redo. Marking an update as programmatic or suppressing its change
callback does not establish these semantics. If history cannot be reconciled safely across overlapping
edits, preserve pending input and report the conflict before an undo operation can remove received
messages. Source/Live edits followed by an external reply, Undo, Redo, and save must preserve the reply.
The prototype must also cover an explicit source edit of a record followed by a conflicting external
change; disabling all undo or clearing history on every comment is not an acceptable default.

Atomic replacement protects against a partial file write. A hash check detects a stale read. Neither
alone makes arbitrary external editor/agent writes race-free. A helper can coordinate cooperating
processes with a shared lock; direct writers that ignore it remain subject to a check-to-write race.
Support external edits between operations and detect conflicts where possible; do not advertise
lossless simultaneous editing with arbitrary writers. Agents handling a live review should avoid
overlapping writes or use the shared helper. Complete cross-process behavior remains a prototype gate.

### Coordination with App Git operations

Per-file serialization must participate in the App's worktree mutation boundary. Comment writes,
Source/Live saves, cooperating helper writes, and Git operations that modify the workspace or index
must serialize the critical phases of snapshot capture, apply, and rollback. Edits between preparation
and apply are allowed and invalidate the preparation. Reuse the existing preparation,
drift-check, and recovery boundaries, adding a server-side coordination seam rather than relying only
on disabled controls. A Preview comment action has to participate even when no source editor is active.

Every accepted comment change must advance the same local mutation revision used to invalidate a
prepared remote merge. Recheck versions after acquiring the relevant guard. Before a Git mutation,
flush or reconcile pending editor writes; while its critical phase is active, defer comment writes
and retain drafts. After completion or recovery, reload and revalidate before retrying them. An
unsent draft can remain in the panel without being submitted against the old snapshot.

Limit the critical section to local snapshot/index/workspace mutations. Fetching or pushing over the
network must not hold an editing lock for the duration of the request. Once a publication commit is
frozen, newer comments remain unpublished local edits under the existing Sync contract. App/helper
coordination does not make arbitrary external Git commands or file writers cooperative; retain the
existing drift/conflict handling for them.

### Publication and visibility

Every mutation retains the existing local-only editing and detached-worktree protective-branch
boundaries. A comment is an ordinary unpublished file edit. Existing Sync and publish commits and
pushes it; merely creating or replying to a comment never commits or pushes automatically.

Resolving and reopening also only save local file changes. These actions do not trigger Sync, a
commit, a push, or publication. Sharing the updated status requires a separate user-initiated
Sync and publish action.

Comments follow branch/file copies and Git merges. Conflicts remain normal Git conflicts, including
two people appending to EOF or editing one thread. Do not install a union merge driver or automatically
pick one status/message list. Unknown, duplicate, or conflicted records remain visible for repair.

All repository readers can read comments. Hidden rendering provides no privacy or commenter-only
permission. Publishing a file publishes its stored discussion, including resolved messages. A later
deletion does not erase Git history. Exporting a clean rendered view should omit records; share links
continue to identify the versioned file and do not create a new access boundary.

## Existing architecture and required changes

This proposal does not change the [current architecture](../architecture.md). Before App integration,
the Markdown interoperability contract must explicitly allow this bounded comment-record convention;
it currently rejects private hidden metadata outside existing exceptions.

The audit examined OpenGlance revision `4d7900332bd837c57b3a4dd5926137f6c1cdab2f`:

- `src/content/markdown.mjs` uses `html: false`; a dedicated record parser/rendering projection is needed.
- `public/line-selection.js` and `public/agent-context.js` preserve line-based source context, not a
  general Preview character-to-source mapping.
- `src/client/source-editor.mjs` shares the Markdown renderer with Live; hiding records must cover both
  modes while preserving the full editor source. Its current `setValue` dispatch does not distinguish
  synchronization from undoable local editing; a comment implementation needs explicit history mapping.
- `public/app.js` posts a full source string to `/api/document`; `writeDocumentPayload` in
  `src/server/index.mjs` does not validate an expected source hash. Write coordination must include that
  route, not just a new comments endpoint.
- `public/app.js` invalidates prepared remote merges when the source-edit revision changes, while
  `src/server/git-remote-sync.mjs` checks workspace drift and verifies the applied tree. Extend these
  protections to comment mutations and their server-side transaction path, including apply/rollback.

Existing README and user-guide feature lists should change only when behavior is implemented and
accepted. The public demo should then receive a matching stable comment scenario. This proposal adds
no product capability claim, analytics event, production Profile migration, or application release.

## Acceptance and staged delivery

| Stage | Evidence required before advancing |
| --- | --- |
| Format and write-safety prototype | Parse/serialize and coordinated write/history tests, a raw-file agent round trip including a revision target, exact preservation of unrelated source, documented compatibility results, and the decision below |
| One-document UI loop | In an isolated macOS smoke, create a comment in Preview, receive an agent revision, inspect its proposed location in Preview and Live, explicitly resolve, and retain received messages and pending input across Undo/Redo and external edits |
| Git and documentation delivery | Verify comment writes around merge preparation, apply, rollback, and a frozen publication commit; publish through Sync, fetch into a second temporary checkout, verify the same threads/states, exercise a real merge conflict, then update product guides/demo |

The format prototype must cover Unicode and CRLF; repeated text; formatting and entities; tables,
lists and fenced code; false markers in examples; unclosed fences/HTML; dangerous delimiter strings;
unknown versions/fields, malformed JSON and duplicate IDs; rename/copy; missing and ambiguous anchors;
manual location history; and preserving the editor buffer during stale writes. An agent must create,
reply, and change status without an App running, and the App must interpret the resulting bytes.

The following end-to-end regressions are mandatory prototype/implementation gates:

- Append an ordinary section after a stored thread, then read and reply to that thread in place;
  preserve the new section, record order, and all untouched bytes. Code/HTML examples remain content.
- Replace a commented passage and append an agent reply with a result selector and body hash. Navigate
  to the proposal while retaining the old quote/status; reject stale or ambiguous results. Verify hash
  stability for comment-only changes and sensitivity to body edits using shared reference vectors.
- Type a body edit in Source and Live, receive an external comment/reply, then Undo, Redo, and save.
  Retain the incoming discussion and map local edits correctly. Repeat with a panel action and with
  overlapping raw-record edits, preserving input when a conflict prevents safe reconciliation.
- Resolve a thread and verify that its passage has no remaining comment decoration, including an
  already open comparison or anchored bubble. Retain its history in the panel, keep the status change
  unpublished, and verify that reopening restores the appropriate unresolved marker without publishing.
- Accept a comment after remote-merge preparation and verify invalidation/repreparation. Attempt
  comment writes during apply and rollback through both the UI and server/helper seam; defer them
  without losing drafts or corrupting the verified workspace. After a frozen publication commit,
  verify that a newer comment stays unpublished while the earlier commit is pushed.

Compatibility must record named versions and results separately for parsing, visible-body rendering,
and save round trips. Test a CommonMark renderer, GitHub/GFM rendering, and an actual Obsidian edit/save
path before claiming those integrations. For `.mdx`, include a conventional MDX compiler as well as
OpenGlance's MDX-lite renderer before extending support. The audit's small Markdown experiments are
preliminary evidence only. UI work must use `make smoke-dev-mac` and the repository's normal Node and
generated-client gates; acceptance must not use the production Profile.

## Design review disposition

The review supports a bounded prototype, not immediate product implementation. The following findings
have been incorporated into this proposal; their implementation gates remain open.

| Finding | Consequence | Disposition |
| --- | --- | --- |
| High: HTML syntax is not an editor preservation guarantee; MDX differs | Comments can display, disappear on save, or fail compilation | Limit initial scope to `.md`; require a named rendering/save matrix |
| High: current full-source saves can overwrite newly added records | A new comments endpoint alone cannot prevent lost replies | Coordinate Source/Live/comment writers and test stale saves before UI delivery |
| High: a synchronized update can enter the text undo stack | Undo/Redo can remove a received reply despite a current file hash | Use non-history synchronization with mapped local history; test real undo/save sequences |
| High: comment transactions can bypass App Git mutation coordination | A prepared snapshot can become stale or a write can collide with apply/rollback | Share mutation revisions and server-side worktree guards; preserve deferred drafts |
| High: line mapping is not exact selection mapping | A comment may attach to the wrong source | Gate exact mapping; make paragraph fallback explicit |
| High: unique text alone can be the wrong surviving copy | Deleted passages can silently move to another section | Use both contexts, expose ambiguity, preserve original selectors |
| High: EOF may be inside code or HTML | Appending a record may expose it or alter document content | Validate the insertion context and preserve a failed draft |
| Medium: ordinary appends can move a thread away from EOF | Footer-only recognition breaks normal agent document edits | Recognize standalone records anywhere and edit them in place |
| Medium: an agent revision can remove the original quote | Reviewers lose navigation to the proposed result | Store an optional versioned result selector on the reply; retain the original anchor and explicit resolution |
| Medium: malformed/unknown records and rendering projections can lose data | Cleanup, reload, or editor saves may remove history | Preserve bytes, diagnose, and test complete editor round trips |
| Medium: hidden comments inherit repository visibility | Private-looking UI could mislead users | Describe publication scope; avoid separate permission claims |
| Medium: one block per thread still permits Git conflicts | Two comments can require manual reconciliation | Keep ordinary conflict handling; make no conflict-free claim |

## Decision before App integration

Should version one adopt this in-file record format for `.md`, with default EOF placement, no separate
comment permissions, and normal Git conflicts? The recommendation is yes, conditional on the prototype
gates. The materially different fallback is a document-adjacent comment file: it preserves body bytes
more strictly but adds a rename, copy, and synchronization convention. If required editors drop HTML
comments on save, choose that
fallback rather than claiming in-file interoperability. Inline markers remain an alternative when
positional proximity is more valuable than avoiding changes inside Markdown constructs.

The exact file grammar, limits, selection mapping, and write protocol should be finalized from the
prototype evidence in a subsequent implementation specification. No unresolved choice here should be
presented as an accepted format or silently added to current architectural authority.
