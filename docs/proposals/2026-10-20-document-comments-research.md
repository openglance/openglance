---
last_updated: 2026-10-28
---

# Document comments: implementation audit and design review evidence

This is supporting evidence for the [document comments proposal](2026-10-20-document-comments.md).
It separates inspected implementations from product claims. The audit was performed on 2026-10-20;
Git references below are pinned to the exact downloaded revisions. This is a targeted source review
and a small set of function/parser experiments, not an installation, security audit, or full product
acceptance test of any third-party tool.

The subsequent OpenGlance [format and write-safety prototype](2026-10-28-document-comments-prototype.md)
records executable results from 2026-10-28 separately from this pinned source audit.

## Evidence summary

| Tool | Evidence inspected | What it establishes for OpenGlance |
| --- | --- | --- |
| md-redline | Parser, serializer, insertion, types, server write path; isolated real serializer execution | In-file JSON/HTML comments work as a direct agent interface; inline placement and preservation need substantial handling |
| Redline | Sidecar types/storage/locking, comment endpoint, client highlighting | Quotation/context plus threaded human/agent messages can live in a sidecar; current source has cross-process sidecar locks |
| markdown-review | Sidecar storage, block reconciliation, schemas | Block records, revision hashes, and orphan retention are explicit implementation choices; matching still needs scrutiny |
| Graft | Comment storage API, anchor capture/resolution; direct execution of anchor module | A separate comment branch is implemented; the inspected resolver does not provide the fuzzy prefix/suffix behavior described in its README |
| Notula | Official product/FAQ page | Public claims support sidecar logs and quoted anchors; private source prevents implementation verification |
| Hypothesis client | HTML anchoring, selector types, REST client | DOM ranges, text positions, and quote selectors are combined; this is not a Markdown-source anchoring implementation |
| giscus | GitHub discussion creation/comment service | Discussion data is written through GitHub GraphQL, outside Git content |
| utterances | Issue creation and comment client | Page discussions are GitHub Issues/comments, outside Git content |
| GitHub/GitLab, GitBook/HackMD | Official interfaces/documentation as described below | Platform collaboration features are references; server implementations were not inspected |

## In-file and repository-file implementations

### md-redline

Revision: `32768f51afb5a110a57bad4caef144fdfe25a714`.

- [Parser and serializer](https://github.com/dejuknow/md-redline/blob/32768f51afb5a110a57bad4caef144fdfe25a714/src/lib/comment-parser.ts): `serializeComment` writes a compact `@comment` JSON marker; it escapes `-->` and `--!>` using JSON Unicode escapes and omits derived location fields.
- The same file's `insertComment` places a marker near the selected passage, relocating it out of
  frontmatter, code containers, and existing HTML comments. Detection combines marker scanning with
  container checks. This is an inline design, not verification of OpenGlance's proposed record grammar
  or default EOF placement.
- [Types](https://github.com/dejuknow/md-redline/blob/32768f51afb5a110a57bad4caef144fdfe25a714/src/types.ts) distinguish persisted messages/status from computed stale/recovered anchors.
- [Server](https://github.com/dejuknow/md-redline/blob/32768f51afb5a110a57bad4caef144fdfe25a714/server/index.ts) uses per-file in-process write serialization; `/api/file` optionally checks expected modification time before an atomic write. These controls do not prove safe concurrent writes by arbitrary external processes.

An isolated execution of the actual `serializeComment` function, after erasing only its TypeScript
annotations, confirmed both delimiter escapes, text round trip, and omission of derived fields. The
complete parser, browser UI, MCP, and test suite were not executed.

Some malformed marker paths are treated as removable/anonymous by the inspected parser. OpenGlance's
proposal deliberately requires preserving malformed or unsupported records and reporting them.

### Redline

Revision: `afe02ac2f2a5059295b48a50a3e89fafd483302f`.

- [Sidecar implementation](https://github.com/alevi/redline/blob/afe02ac2f2a5059295b48a50a3e89fafd483302f/src/sidecar.ts) stores `.review/<basename>.json`. It defines review rounds, quotation/context, human/agent thread entries, and resolved state. The load/mutate/save helper combines a per-process queue with `proper-lockfile` for cross-process sidecar transactions.
- [Comment endpoint](https://github.com/alevi/redline/blob/afe02ac2f2a5059295b48a50a3e89fafd483302f/src/server.ts) adds a UUID thread through that helper.
- [Client highlighting](https://github.com/alevi/redline/blob/afe02ac2f2a5059295b48a50a3e89fafd483302f/src/client/lib.ts) searches a flattened rendered-text view using the preceding context, then falls back to the first matching quote. Capturing both context sides in storage does not establish that both are used by every display path.

The downloaded README warns about concurrent instances, while the inspected storage code has explicit
cross-process locking. The implementation therefore supports a narrower conclusion than that warning:
cooperating sidecar transactions are serialized, while a general multi-reviewer workflow is not
established by this source review. No Redline runtime was launched.

### markdown-review

Revision: `9284fc6cf52f62e01ab9e37c83d8c5c28bd2de88`.

- [Storage and reconciliation](https://github.com/onesvat/markdown-review/blob/9284fc6cf52f62e01ab9e37c83d8c5c28bd2de88/markdown_review/server/storage.py) writes `<stem>.annotations.json` with temporary-file replacement. Sidecar transactions use an advisory `flock` where available; the non-POSIX fallback lacks that cross-process lock.
- Reconciliation assigns stable UUID records, stores source hashes and ranges, and retains unmatched
  reviewed records as orphans. Its candidate selection first considers source start line and block
  type, then legacy/content identity; that order is not proof of correct identity after arbitrary edits.
- [Schemas](https://github.com/onesvat/markdown-review/blob/9284fc6cf52f62e01ab9e37c83d8c5c28bd2de88/markdown_review/server/schemas.py) describe revision, suggestion, block, and orphan records. Source writes and sidecar writes are separate operations in the server.

OpenGlance can borrow explicit orphan retention without adopting a second file or assuming that a
stable record ID automatically gives stable passage identity. No Python application/test suite ran.

### Graft

Revision: `4dfcb1e044e83acff7e821d0c82ad932aa60c551`.

- [GitHub storage API](https://github.com/tkjaer/graft/blob/4dfcb1e044e83acff7e821d0c82ad932aa60c551/src/shared/api.ts) reads/writes `<document-branch>/<document-path>.comments.json` in `graft-comments`, using GitHub file SHAs when updating.
- [Anchor module](https://github.com/tkjaer/graft/blob/4dfcb1e044e83acff7e821d0c82ad932aa60c551/src/shared/anchoring.ts) captures context using the first `indexOf` occurrence. Resolution enumerates exact quote matches, scores matching prefix characters, and picks the first best candidate. It stores a suffix but does not use it in this resolver; it does not fuzzily locate rewritten quotation text or reject tied candidates.
- [Types](https://github.com/tkjaer/graft/blob/4dfcb1e044e83acff7e821d0c82ad932aa60c551/src/types.ts) contain comments, suggestions, replies, author/timestamp, resolution, and text/context anchors.

The actual module was imported using Node's TypeScript support and exercised without launching the
editor or contacting GitHub APIs:

| Input | Actual result | Design implication |
| --- | --- | --- |
| Document `A same X` followed by `B same Y`; quote `same`, empty prefix, suffix ` Y` | Returns offset 2; the suffix-selected second occurrence begins at offset 11 | Stored suffix is unused in this function |
| Document `same / same`; quote `same`, no context | Returns offset 0 | Ties silently choose the first occurrence |
| Capture `same` in a document containing it twice | Captures the first occurrence's context | Capture must receive the chosen range, not text alone |

These are results for the inspected exported functions, not a claim that every Graft UI path fails.
The proposal requires explicit ambiguity handling rather than copying this fallback behavior.

### Notula

The [official product page](https://notula.org/) states that comments are adjacent append-only logs,
anchors use quoted passages/context, and a union merge driver combines comments. It also states that
source is private and a plain file move can orphan its path-based comment log.

No implementation source or installed App was examined. Its claims about conflict prevention,
notifications, and editor preservation remain vendor statements. In particular, a union merge driver
does not by itself establish deterministic resolution of contradictory status changes. Notula is useful
product evidence, not a verified implementation of the proposed in-file records or a conflict-free
guarantee.

## Other previously referenced tools

### Hypothesis

Client revision: `a7b7400d0d706d4357ec37c2a3610b25dcca89d5`.

[HTML anchoring](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/src/annotator/anchoring/html.ts)
tries range, position, then quote selectors. Range/position results are checked against the stored
quotation. [Selector types](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/src/annotator/anchoring/types.ts)
bridge DOM/rendered text and selectors. The
[REST client](https://github.com/hypothesis/client/blob/a7b7400d0d706d4357ec37c2a3610b25dcca89d5/src/sidebar/services/api.ts)
creates/updates annotations through a service. This is useful anchoring prior art, but copying its DOM
selectors would not create a raw-Markdown interface for agents. No browser or annotation service ran.

### giscus and utterances

giscus revision: `3d6430237108ca4ee3eb6a1a20595201c09c72d5`.
[Discussion creation](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/github/createDiscussion.ts)
and [comment creation](https://github.com/giscus/giscus/blob/3d6430237108ca4ee3eb6a1a20595201c09c72d5/services/github/addDiscussionComment.ts)
call GitHub GraphQL mutations. Comments therefore live in Discussions, not Markdown blobs.

utterances revision: `9e79bdaaa48c0b83d224c58f132db317785103cd`.
Its [GitHub client](https://github.com/utterance/utterances/blob/9e79bdaaa48c0b83d224c58f132db317785103cd/src/github.ts)
creates a page's issue and posts issue comments. The
[UI submit path](https://github.com/utterance/utterances/blob/9e79bdaaa48c0b83d224c58f132db317785103cd/src/utterances.ts)
uses those functions. Neither inspected path provides in-file storage; neither was executed against a
live GitHub repository.

### GitHub, GitLab, GitBook, and HackMD

[GitHub review-comment API](https://docs.github.com/en/rest/pulls/comments) exposes path, commit IDs,
diff/line positions, and reply relations. [GitLab Discussions API](https://docs.gitlab.com/api/discussions/)
exposes threaded notes, positions, and resolution. These are platform records; a normal content clone
is not an export of their discussion databases. Server implementations were not inspected; these
statements rest on the public API contracts.

[GitBook comments](https://gitbook.com/docs/collaborate/comments) describes page/block threads and
resolution. Its [Git Sync documentation](https://gitbook.com/docs/docs-as-code/git-sync) describes
bidirectional content synchronization. Those documents do not establish export of comment threads
into Markdown. [HackMD's official update](https://homepage.hackmd.io/blog/2023/12/11/next-chapter-transparency-commenting-hackmd-update)
documents comments and GitHub-related editing history. It does not establish an in-file comment
protocol. No private source, authenticated workspace, or comment-export round trip was inspected for
either service; this audit does not infer a current export limitation from an unanswered community issue.

[CriticMarkup's toolkit](https://github.com/CriticMarkup/CriticMarkup-toolkit) documents plain-text
editorial additions, deletions, replacements, comments, and highlights. That syntax is a useful direct
file interface, but supplies no shared account or thread lifecycle contract on its own. Only its public
format documentation was reviewed; no editor plugin was installed.

## OpenGlance baseline and bounded Markdown experiments

Baseline revision: `4d7900332bd837c57b3a4dd5926137f6c1cdab2f`. The primary and task checkouts matched
that revision during source inspection. Existing primary-checkout dependencies were used for the
following read-only experiments; no desktop App or real Profile was opened.

| Experiment | Observed result | Limit |
| --- | --- | --- |
| Append an escaped JSON comment footer after a complete paragraph; render with installed markdown-it, HTML enabled | Removing only the HTML comment from the HTML output leaves the same rendered body; JSON text round trips | One basic fixture, not a CommonMark/GFM conformance or editor save suite |
| Render the same input with the real `renderMarkdown` export | Comment opener is escaped and displayed | Confirms current `html: false` behavior, not the proposed rendering |
| Append a footer after an unclosed fenced-code example | Parser returns one fence token and displays the marker as code | EOF placement needs structural validation |
| Put a marker inside an inline-code example | Marker remains visible code text | Format examples cannot be treated as stored records |

The baseline's `syncSourceToDisk` sends only `{ source }` to `/api/document` and
`writeDocumentPayload` writes it without an expected-version precondition. The returned source hash is
not a compare-before-write guard. Existing line selection and Agent Context store line ranges; they do
not supply a general rendered-character mapping. Those observations motivate prototype gates in the
proposal and are not fixes delivered by this documentation task.

### Editor history, placement, and revision probes

Follow-up checks used OpenGlance revision `838745b84fa28b099d430c2740b6c36ec1956603`, which adds the
proposal and audit without changing runtime code from the baseline above. The read-only experiments
ran with Node `24.16.0` and installed `@codemirror/commands` `6.10.4`, using real CodeMirror history and
OpenGlance's exported `minimalDocumentChange`. A fixture envelope is just text in these experiments;
the proposed record parser and comments UI do not yet exist.

| Experiment | Observed result | Limit and consequence |
| --- | --- | --- |
| Make a local body edit, append an incoming comment through an ordinary isolated history transaction, then Undo/Redo | Undo removes the incoming comment while retaining the local body edit; Redo restores the comment | Demonstrates that current-style programmatic dispatch can put synchronization into history; no desktop interaction was exercised |
| Repeat with `Transaction.addToHistory.of(false)` on the incoming append | Undo reverts the local body edit and retains the comment; Redo restores the body edit and retains the comment | Supports explicit non-history synchronization for this nonoverlapping append; overlapping edits, panel actions, and saves still require acceptance tests |
| Append a normal `## Rollback` section after the proposal's complete example record | The valid envelope now has non-whitespace body content after it | EOF-only recognition would fail a routine document append; no proposed parser was executed |
| Change the example body from `launch next month.` to `launch on November 1.` | Original `exact` text disappears from the body; the stored thread is unchanged | Motivates an explicit result selector on the agent reply; does not demonstrate an implemented relocation feature |
| Calculate the proposed body projection over known complete record-line ranges | Digest stays equal after EOF appends, record edits/deletion, and CRLF conversion; body text and internal blank-line edits change it | Tests projection rules using fixture ranges, not Markdown-aware discovery or a shared production helper |

The revised example's projected body is exactly `# Launch plan\n\nWe plan to launch on November 1.`
with no final newline. Its SHA-256 is
`d2779a1274a295da96ef68e3d3549561bfd348bdcf1f9743f0ad254a76c59690`, matching the proposal's
reply fragment. This is a reference example; shared parser-based vectors remain a prototype gate.

Source inspection confirms that `src/client/source-editor.mjs` currently calls `view.dispatch` from
`setValue` without a history annotation; suppressing its callback is a separate mechanism. The first
two probes isolate the relevant history behavior rather than claiming that an OpenGlance comment was
actually lost in the current App.

In `public/app.js`, `scheduleSourceSync` advances `sourceRevision` and invalidates a prepared remote
merge; apply checks that revision again. Its critical-section control makes the source editor inert.
The server's `applyPreparedDirtyRemoteMerge` in `src/server/git-remote-sync.mjs` checks workspace drift,
applies a patch, updates the branch/index, verifies the resulting tree, and can enter rollback. These
existing guards must include future Preview comment writes and cooperating helper writes through a
server-side mutation boundary. Inspection identifies an integration requirement, not demonstrated
silent data loss or a reason to replace the existing merge/recovery model. No Git fault-injection or
concurrent mutation experiment was run for this audit.

## Review conclusion

The reviewed direction is suitable for a bounded prototype. The source audit supports direct agent
access, explicit state, retained displaced comments, and careful local write coordination. It does not
establish that this record format already exists as a cross-tool standard or that the proposed UI/storage
has been accepted in OpenGlance.

The proposal incorporates the identified correctness issues: format/save compatibility, `.md` versus
MDX, unsafe EOF placement, ambiguous passage identity, incomplete selection mapping, stale full-source
saves, undo/redo preservation, coordination with App Git mutations, recognition after ordinary body
appends, an explicit link from agent revisions to proposed results, malformed-record preservation,
repository visibility, and normal Git conflict handling. The remaining evidence needed is the
prototype and acceptance matrix, including a shared body-hash specification and history/concurrency
cases, followed by a decision on the file format. No third-party source was copied into OpenGlance
runtime code.
