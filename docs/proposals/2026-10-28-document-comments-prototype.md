---
last_updated: 2026-10-28
---

# Document comments: format and write-safety prototype

The first experimental implementation of the [comments proposal](2026-10-20-document-comments.md)
is reproducible through a local CLI and Node tests. It validates the raw-file agent interface and
cooperating write path without enabling comments in the App. The App still renders these envelopes
literally; its document endpoint, editor history, and Git endpoints do not yet use the prototype.

The prototype was authorized on 2026-10-28. These results support continuing the design, not declaring
the format stable or enabling it in existing knowledge bases. The
[prior implementation audit](2026-10-20-document-comments-research.md) remains the evidence for other
products; this report records executable OpenGlance experiments.

## Result and reproduction

The prototype suite has 38 passing tests. The repository core suite has 1,256 passing tests, one
Windows-only test skipped on macOS, and no failures. Checks ran on macOS arm64 with Node `24.16.0`, Apple Git `2.50.1`,
`markdown-it` `14.3.0`, `@codemirror/state` `6.7.0`, and `@codemirror/commands` `6.10.4`.
Windows execution and desktop UI acceptance were not performed.

```bash
npm run test:document-comments-prototype
npm run prototype:document-comments -- --help
npm test
npm run docs:check
```

All write tests create and clean temporary Git repositories. They include separate Node CLI processes,
local bare remotes, the real remote-merge prepare/apply functions, and an injected failure after patch
application to exercise rollback. They do not launch a desktop App, access the production Profile,
publish a comment in this repository, or alter the App's existing write behavior.

| Contract exercised | Result and evidence |
| --- | --- |
| Read/write without an App | Independent CLI processes inspect a file, append replies, detect a stale version, and retry successfully |
| Preserve source | Replies retain ordinary bytes, CRLF, unknown fields, unrelated records, and content appended after a record |
| Invalid and future records | Preserve complete envelopes byte for byte; diagnose invalid JSON, duplicate JSON keys/IDs, unknown versions, and invalid fields; refuse ambiguous target edits |
| Safe insertion | Reject unclosed code/HTML/frontmatter and verify that the appended record is independently discoverable before returning a new source |
| Agent revision | Change a passage and append its versioned result selector in one file transaction, retaining the old quote and status |
| Stale writes | Reject an old full-source save and an external change observed during a transaction; retain the current disk file |
| Replacement failure | Leave original bytes intact, remove the temporary file, and release the cooperating lock |
| Editor history | Non-history synchronization retains incoming comments across body Undo/Redo and subsequent disk saves; overlapping protected edits stop synchronization |
| Git preparation | A comment added after real remote-merge preparation makes apply return `workspace_changed`, retaining both HEAD and the comment |
| Git critical sections | With the prototype guard wrapping real apply/rollback, comment writes return `worktree_busy`; the unchanged operation succeeds after release |
| Frozen publication snapshot | The real immutable Git snapshot omits a later comment, which remains an unpublished workspace change |
| Repository boundaries | Distinct linked-worktree guards; protective branches before detached writes; refuse real merge conflicts, active merge/index locks, path escapes, links, invalid UTF-8, and absent expected hashes |

The executable seams are [format tests](../../test/document-comments-format.test.mjs),
[file/Git tests](../../test/document-comments-store.test.mjs), and
[editor-state tests](../../test/document-comments-history.test.mjs). Tests assert resulting document,
history, and Git behavior, rather than implementation text.

## Experimental format contract

[format.mjs](../../scripts/document-comments/format.mjs) implements the proposed `v1` envelopes using
the installed CommonMark-mode Markdown parser. A recognized record occupies complete source lines,
with `<!-- openglance-comment:v1` on its own opening line and `-->` on its own closing line. New records
default to a safe EOF; existing records remain in place even when paragraphs, headings, or other
ordinary content follow them.

Code fences, indented code, inline code, quoted/list examples, frontmatter, ordinary HTML comments,
and HTML containers are not records. HTML balancing is deliberately conservative: it tracks explicit
tags instead of guessing browser implicit closing rules. Some valid but implicitly balanced HTML can
therefore block an append. The final append is reparsed and must produce the intended independent
record; an incomplete declaration cannot silently swallow a newly written comment.

Recognition is independent of supported payloads. Complete unsupported/malformed envelopes are
excluded from the body projection and retained on disk. An incomplete envelope produces a diagnostic
and is left in the body projection; it never authorizes deleting the remaining file. Supported edits
replace only the chosen record. Unknown fields survive, including nested values. Duplicate object
keys are diagnosed because `JSON.parse` would otherwise silently discard values.

Changed records use stable pretty JSON and their existing line endings. Literal angle brackets are
written as JSON Unicode escapes, so message text cannot terminate or nest an HTML envelope. Thread
and message IDs are UUIDs, timestamps are validated UTC values, and attribution remains editable data.

| Prototype bound | Limit |
| --- | --- |
| Document | 4 MiB of UTF-8 text; bounded reads reject larger files |
| One record | 256 KiB |
| One message body | 64 KiB |
| Selected quotation | 16 KiB |
| Prefix / suffix | 64 Unicode code points each |
| Records per file | 512 |
| Messages / anchor-history entries per thread | 256 each |
| CLI operation input | 512 KiB |
| Cooperating lock wait | At most five seconds, followed by an explicit busy result |

These are experimental implementation limits, not a product capacity commitment. Failure is visible;
there is no silent truncation or replacement with an empty collection. The helper supports existing
`.md` files, including untracked documents in an unborn repository. MDX is rejected.

## Agent interface and revision references

[The CLI](../../scripts/document-comments-prototype.mjs) has two commands:

```bash
node scripts/document-comments-prototype.mjs inspect --repo "<disposable-worktree>" --file plan.md
node scripts/document-comments-prototype.mjs apply --repo "<disposable-worktree>" --file plan.md --expected-hash "<source_hash>" < operation.json
```

`inspect` returns the full-source hash, body hash, projected body, valid threads, derived locations,
and diagnostics. Persisted `threads` and derived `locations` are separate arrays, preserving unknown
thread fields without mixing navigation data into stored objects. `apply` reads one JSON operation
from stdin. Its expected hash must be the exact
`source_hash`, which includes comments and physical line endings; `body_hash` is for revision references
and must not be substituted as a write precondition. A failed call does not mutate its operation:
the caller keeps that request or draft, rereads, reconciles, and explicitly retries. There is no UI
draft store or automatic retry in this CLI.

| Operation | Required data beyond `type` |
| --- | --- |
| `create` | `thread`, following the proposal's complete schema |
| `reply` | `thread_id`, a new `message` with a fresh UUID |
| `revise` | `thread_id`, `from`, `to`, `expected_text`, nonempty `insert`, and an agent `message` |
| `locate` | `thread_id`, `from`, `to`, `author`, `created_at`; optional existing `reply_id` |
| `set-status` | `thread_id`, `status` (`open` or `resolved`) |
| `delete` | `thread_id` |

`from`/`to` are a half-open UTF-16 range in the current `inspect.body`, not durable offsets. Context is
captured from that actual range. A revision must match `expected_text` and cannot cross a stored record.
The helper maps the range to physical source, changes the text, then computes the reply's
`revision_target` from the resulting body. The body edit and reply are committed to the file together;
there is no intermediate on-disk body without its reply.

The original anchor and open/resolved state remain intact. A valid target is navigable only when its
body hash matches and its selector is uniquely established. A changed body makes it stale; repeated or
missing text has an explicit derived state. Explicit `locate` retains the previous selector,
attribution/time, and optional reply association in `anchor_history`; it does not resolve the thread.

The body-hash algorithm removes complete record-line ranges, normalizes CRLF/CR to LF, removes only
terminal LF characters, and hashes the remaining UTF-8 text with SHA-256. Internal blank lines,
spaces, and Unicode remain significant. Eight portable
[reference vectors](../../scripts/document-comments/body-hash-vectors.json) cover the proposal's
example, CRLF/CR, EOF separators, a mid-document record, future/malformed payloads, fenced examples,
and Unicode. The actual parser is checked against these vectors. Comment-only supported mutations
leave the digest stable; hashing never rewrites source bytes.

## Write coordination and editor history

[store.mjs](../../scripts/document-comments/store.mjs) requires an exact worktree root and a regular,
repository-local `.md` file. It rejects symbolic/hard-link aliases, validates UTF-8, and checks active
Git operations/index locks. Cooperating file and Git transactions acquire one exclusive lock in that
worktree's own Git directory, including for linked worktrees. Under the guard, a file transaction:

1. Reads the current source and checks its required expected hash.
2. Produces and validates the proposed source without changing the document.
3. Passes through the existing detached-worktree branch protection.
4. Writes and syncs an exclusive temporary file beside the target, retaining file permissions.
5. Rechecks Git safety, file identity/permissions, and the source hash before atomic replacement.
6. Removes temporary files and releases the guard on success or ordinary failure.

The lock serializes whole worktree transactions rather than attempting parallel file writes in this
prototype. It is cooperative: the current App and arbitrary external editors/Git commands do not
acquire it. The last hash check still has a check-to-replace window for noncooperating processes.
These tests do not establish lossless simultaneous editing by arbitrary writers. A killed process can
leave a lock/temp file; the prototype does not guess when a lock is stale or automatically remove it.
Replacement tests cover process-level failures, not power-loss durability of a directory rename.

[history.mjs](../../scripts/document-comments/history.mjs) creates non-history CodeMirror transactions
and lets CodeMirror map existing undo/redo changes through them. Pending local ranges supplied by a
caller are protected: overlapping incoming changes produce a conflict before the current state is
changed. These ranges use the complete editor source's UTF-16 coordinates. The current implementation
uses a conservative minimal contiguous update; disjoint changes may require explicit reconciliation.
Automatic dirty-range tracking, Source/Live adapters, UI conflict presentation, and text selection
mapping are not implemented. No editor history is cleared as a shortcut.

Real remote-merge functions are wrapped by the prototype guard in the test harness; production Git
endpoints are unchanged. This verifies that a common boundary can protect apply and recovery, not
that the App already coordinates with the helper. Future integration must include Preview actions,
the full-source document endpoint, local mutation revisions, and every relevant snapshot/index/workspace
critical phase. Fetch and push must remain outside a long editing lock.

## Compatibility evidence

| Reader / path | Version or observation point | Result | Save preservation |
| --- | --- | --- | --- |
| `markdown-it` CommonMark mode, HTML enabled | `14.3.0` | Escaped envelope hides payload from rendered body; body fixture is unchanged | Not an editor; untested |
| GitHub Markdown REST API, `mode: gfm` | API `2026-03-10`, exercised 2026-10-28; server renderer version undisclosed | Both EOF and pre-section cases render the same body as controls; payload absent from response HTML | GitHub UI save untested |
| Current OpenGlance `renderMarkdown` | Runtime baseline `fb122c2` | Escapes and displays record text; a dedicated projection is still required | App comment round trip unimplemented |
| Actual Obsidian editor | Not exercised | Unverified | Unverified; remains a decision gate |
| Conventional MDX compiler / MDX-lite | Not exercised | Outside prototype scope | Rejected by the file helper |

The GitHub probe calls the official [Markdown rendering endpoint](https://docs.github.com/en/rest/markdown/markdown)
with synthetic text only. It does not create an issue, comment, discussion, repository file, or commit.
It is an optional network check, excluded from the offline regression suite:

```bash
node scripts/document-comments-gfm-probe.mjs
```

These are bounded fixtures, not a CommonMark/GFM conformance suite or a cross-editor preservation
guarantee. The format can remain an in-file candidate, with the adjacent-file fallback retained until
the required editor save paths have evidence. Before App integration, finalize the implementation
specification and architecture exception, complete the save matrix, connect the shared write/history
boundaries, and then perform the proposal's isolated Preview/Live acceptance loop.
