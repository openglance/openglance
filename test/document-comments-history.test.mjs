import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { history, undo, redo, isolateHistory } from "@codemirror/commands";
import { captureAnchor, mutateComments, parseComments } from "../scripts/document-comments/format.mjs";
import { synchronizeCommentChanges } from "../scripts/document-comments/history.mjs";

const base = "# Plan\n\nLaunch soon.\n";
function create(source = base) {
  const from = source.indexOf("Launch");
  return mutateComments(source, { type: "create", thread: { id: randomUUID(), status: "open",
    anchor: captureAnchor(source, from, from + 6), messages: [{ id: randomUUID(), author: { name: "Agent", kind: "agent" },
      created_at: "2026-10-28T04:00:00Z", body: "Name the date." }] } });
}

test("incoming comments survive local body Undo, Redo, and the resulting full-source save value", () => {
  let state = EditorState.create({ doc: base, extensions: [history()] });
  const from = base.indexOf("soon");
  state = state.update({ changes: { from, to: from + 4, insert: "on November 1" }, annotations: isolateHistory.of("full") }).state;
  const local = state.doc.toString();
  state = synchronizeCommentChanges(state, create(local), { protectedRanges: [{ from, to: from + 13 }] }).state;
  const dispatch = (transaction) => { state = transaction.state; };
  assert.equal(undo({ state, dispatch }), true);
  assert(state.doc.toString().startsWith(base));
  assert.equal(parseComments(state.doc.toString()).records.length, 1);
  assert.equal(redo({ state, dispatch }), true);
  assert(state.doc.toString().startsWith(local));
  assert.equal(parseComments(state.doc.toString()).records.length, 1);
});

test("persisted panel changes do not become text-editor undo actions", () => {
  let state = EditorState.create({ doc: base, extensions: [history()] });
  state = synchronizeCommentChanges(state, create()).state;
  assert.equal(undo({ state, dispatch: (transaction) => { state = transaction.state; } }), false);
  assert.equal(parseComments(state.doc.toString()).records.length, 1);
});

test("overlapping raw-record edits stop synchronization and retain the current buffer and received version", () => {
  const original = create();
  const from = original.indexOf("Name the date.");
  let state = EditorState.create({ doc: original, extensions: [history()] });
  state = state.update({ changes: { from, to: from + 14, insert: "My unfinished comment." } }).state;
  const received = original.replace("Name the date.", "Remote replacement.");
  const current = state.doc.toString();
  assert.throws(() => synchronizeCommentChanges(state, received, { protectedRanges: [{ from, to: from + 22 }] }), { code: "history_conflict" });
  assert.equal(state.doc.toString(), current);
  assert(received.includes("Remote replacement."));
});
