---
last_updated: 2026-10-20
---

# Proposal: Git-backed document comments

Status: proposed; reviewed with revisions. This document does not authorize or describe a shipped
feature. It is for OpenGlance product reviewers, implementers, and agents working on the file format.
The [implementation audit](2026-10-20-document-comments-research.md) records the source revisions,
bounded experiments, and limits behind the recommendation.

## Recommendation

Store comment threads in the original Markdown file as separate HTML comment blocks in a document
footer. OpenGlance presents them beside the document. Agents can read and modify the same plain text
without an App session, account, database, or MCP connection.

The user requirements are that comments travel through Git, OpenGlance can read and write them, and
agents have a direct file interface. In-file storage is a preferred candidate, conditional on preserving
ordinary Markdown. The footer layout, JSON schema, conservative anchor matching, and initial scope
below are recommendations for review, not previously approved product decisions.

Proceed first with a bounded format and write-safety prototype. Do not treat HTML syntax support,
source-line mapping, or another product's README as proof that interoperability and concurrent editing
are solved. Initial support should target `.md`. Ordinary MDX toolchains have different comment syntax;
`.mdx` support needs its own compatibility decision and fixtures.

## Intended workflow and scope

A teammate reads a repository document, comments on a passage, and publishes through the existing
Git workflow. Another teammate or agent receives both content and discussion after synchronization.
An agent can reply and revise the content; the reviewer verifies the result and resolves the thread.

The first version should support creating a thread, replying, resolving, reopening, manually locating
a displaced comment, and explicitly deleting a thread. Resolved discussions remain in the file until
explicitly deleted. Changing the document or receiving an agent reply does not resolve a thread.
Resolution and deletion are explicit actions, not inferred approval or automatic cleanup.

Real-time co-editing, notifications, separate commenter permissions, automated execution of feedback,
replacement suggestions with one-click application, and PR integration are outside the first version.
No new Git synchronization channel or background commit behavior is required.

## File format

Each thread occupies one independent top-level HTML comment at the end of its owning file. There is
no path or local repository identifier in a thread. Renaming or moving the file carries its comments;
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

### Footer recognition and HTML compatibility

The footer is a trailing sequence of candidate comment envelopes separated only by whitespace.
Discover envelopes independently of payload/version validation: an invalid or future-version record
must not cause neighboring valid threads to disappear from the footer. Recognize the opening marker
and a structurally valid closing delimiter in top-level Markdown context, then validate its payload.
An unterminated candidate is a diagnostic, not permission to consume or delete the rest of the file.
Examples in fences, indented code, inline code, and ordinary HTML comments are document content. A
regular expression over the whole file is insufficient. A marker moved into the body is preserved and
reported for repair rather than silently relocated or deleted.

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

Use Markdown source text as the selector's coordinate space, excluding footer envelopes. In this
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

Preview must map a rendered selection to an exact source range. Source-line ranges are useful existing
infrastructure, but do not establish character mapping across emphasis, links, entities, or table cells.
Where exact mapping is unavailable, explicitly offer a source-backed paragraph/line-range comment, or
disable that selection with a clear explanation. Do not silently attach a sentence comment to a
different or larger passage. Code-block text can be selected when its source range is known; rendered
Mermaid, images, and MDX component internals are deferred.

## OpenGlance presentation

| Surface | Proposed behavior |
| --- | --- |
| Preview | Keep the body read-only; a selection action creates a comment, and a restrained range marker opens its thread |
| Comments panel | Show quote, attribution, messages, reply and resolution actions; filter open, resolved, and comments needing location |
| Live | Use the same thread data and panel, coordinating comment writes with the active source buffer |
| Source | Expose the original data as editable source, optionally folding footer records; retain actual file line numbers |
| Narrow window | Present the same panel as a drawer with a way back to its passage |

The panel should share the existing right-side space with Agent Context, with an explicit switch if
needed. Existing copy and Agent Context actions remain available. Selected comments can be copied with
their quotes and IDs for an agent; raw file access remains sufficient. Do not copy every resolved
discussion into ordinary body selections by default.

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

OpenGlance-controlled writes need one coordinated transaction path for Source, Live, comment actions,
and the optional helper: read the current file, check the expected source hash, mutate the intended
record/range, and write under per-path serialization. Preserve an unsaved comment/reply if the check
fails. A stale full-document save must not remove a newly added thread. Flush or reconcile an active
editor buffer before writing through the panel; preserve that buffer on conflict.

Atomic replacement protects against a partial file write. A hash check detects a stale read. Neither
alone makes arbitrary external editor/agent writes race-free. A helper can coordinate cooperating
processes with a shared lock; direct writers that ignore it remain subject to a check-to-write race.
Support external edits between operations and detect conflicts where possible; do not advertise
lossless simultaneous editing with arbitrary writers. Agents handling a live review should avoid
overlapping writes or use the shared helper. Complete cross-process behavior remains a prototype gate.

Every mutation retains the existing local-only editing and detached-worktree protective-branch
boundaries. A comment is an ordinary unpublished file edit. Existing Sync and publish commits and
pushes it; merely creating or replying to a comment never commits or pushes automatically.

Comments follow branch/file copies and Git merges. Conflicts remain normal Git conflicts, including
two people appending to EOF or editing one thread. Do not install a union merge driver or automatically
pick one status/message list. Unknown, duplicate, or conflicted records remain visible for repair.

All repository readers can read comments. Hidden rendering provides no privacy or commenter-only
permission. Publishing a file publishes its stored discussion, including resolved messages. A later
deletion does not erase Git history. Exporting a clean rendered view should omit records; share links
continue to identify the versioned file and do not create a new access boundary.

## Existing architecture and required changes

This proposal does not change the [current architecture](../architecture.md). Before implementation,
the Markdown interoperability contract must explicitly allow this bounded comment-record convention;
it currently rejects private hidden metadata outside existing exceptions.

The audit examined OpenGlance revision `4d7900332bd837c57b3a4dd5926137f6c1cdab2f`:

- `src/content/markdown.mjs` uses `html: false`; a dedicated record parser/rendering projection is needed.
- `public/line-selection.js` and `public/agent-context.js` preserve line-based source context, not a
  general Preview character-to-source mapping.
- `src/client/source-editor.mjs` shares the Markdown renderer with Live; hiding records must cover both
  modes while preserving the full editor source.
- `public/app.js` posts a full source string to `/api/document`; `writeDocumentPayload` in
  `src/server/index.mjs` does not validate an expected source hash. Write coordination must include that
  route, not just a new comments endpoint.

Existing README and user-guide feature lists should change only when behavior is implemented and
accepted. The public demo should then receive a matching stable comment scenario. This proposal adds
no product capability claim, analytics event, production Profile migration, or application release.

## Acceptance and staged delivery

| Stage | Evidence required before advancing |
| --- | --- |
| Format and write-safety prototype | Parse/serialize and local write tests, a raw-file agent round trip, exact preservation of unrelated source, documented compatibility results, and the decision below |
| One-document UI loop | In an isolated macOS smoke, create a comment in Preview, read/reply through an agent, revise the source, inspect in Preview and Live, resolve, and preserve pending input during an external edit |
| Git and documentation delivery | Publish through existing Sync, fetch into a second temporary checkout, verify the same threads and states, exercise a real merge conflict, then update product guides/demo |

The format prototype must cover Unicode and CRLF; repeated text; formatting and entities; tables,
lists and fenced code; false markers in examples; unclosed fences/HTML; dangerous delimiter strings;
unknown versions/fields, malformed JSON and duplicate IDs; rename/copy; missing and ambiguous anchors;
manual location history; and preserving the editor buffer during stale writes. An agent must create,
reply, and change status without an App running, and the App must interpret the resulting bytes.

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
| High: line mapping is not exact selection mapping | A comment may attach to the wrong source | Gate exact mapping; make paragraph fallback explicit |
| High: unique text alone can be the wrong surviving copy | Deleted passages can silently move to another section | Use both contexts, expose ambiguity, preserve original selectors |
| High: EOF may be inside code or HTML | Appending a footer may expose it or alter document content | Validate the insertion context and preserve a failed draft |
| Medium: malformed/unknown records and rendering projections can lose data | Cleanup, reload, or editor saves may remove history | Preserve bytes, diagnose, and test complete editor round trips |
| Medium: hidden comments inherit repository visibility | Private-looking UI could mislead users | Describe publication scope; avoid separate permission claims |
| Medium: one block per thread still permits Git conflicts | Two comments can require manual reconciliation | Keep ordinary conflict handling; make no conflict-free claim |

## Decision before implementation

Should version one adopt this footer format for `.md`, with no separate comment permissions and normal
Git conflicts? The recommendation is yes, conditional on the prototype gates. The materially different
fallback is a document-adjacent comment file: it preserves body bytes more strictly but adds a rename,
copy, and synchronization convention. If required editors drop HTML comments on save, choose that
fallback rather than claiming in-file interoperability. Inline markers remain an alternative when
positional proximity is more valuable than avoiding changes inside Markdown constructs.

The exact file grammar, limits, selection mapping, and write protocol should be finalized from the
prototype evidence in a subsequent implementation specification. No unresolved choice here should be
presented as an accepted format or silently added to current architectural authority.
