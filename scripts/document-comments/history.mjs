// EditorState-only prototype. This does not change Source/Live setValue behavior.
import { Transaction } from "@codemirror/state";
import { CommentError } from "./format.mjs";

export function synchronizeCommentChanges(state, nextSource, { protectedRanges = [] } = {}) {
  const current = state.doc.toString();
  let from = 0;
  while (from < current.length && from < nextSource.length && current[from] === nextSource[from]) from += 1;
  let to = current.length;
  let nextTo = nextSource.length;
  while (to > from && nextTo > from && current[to - 1] === nextSource[nextTo - 1]) { to -= 1; nextTo -= 1; }
  if (from === to && from === nextTo) return state.update({});
  if (protectedRanges.some((range) => from < range.to && to > range.from
    || from === to && from > range.from && from < range.to)) {
    throw new CommentError("history_conflict", "Incoming changes overlap pending source edits; retain both versions before synchronization.");
  }
  return state.update({
    changes: { from, to, insert: nextSource.slice(from, nextTo) },
    annotations: Transaction.addToHistory.of(false),
  });
}
