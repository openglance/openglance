import { Transaction } from "@codemirror/state";
import { CommentError } from "../content/document-comments.mjs";

export function minimalDocumentChange(currentValue, nextValue) {
  const current = String(currentValue ?? "");
  const next = String(nextValue ?? "");
  let from = 0;
  const sharedLength = Math.min(current.length, next.length);
  while (from < sharedLength && current.charCodeAt(from) === next.charCodeAt(from)) {
    from += 1;
  }

  let currentTo = current.length;
  let nextTo = next.length;
  while (
    currentTo > from
    && nextTo > from
    && current.charCodeAt(currentTo - 1) === next.charCodeAt(nextTo - 1)
  ) {
    currentTo -= 1;
    nextTo -= 1;
  }

  return {
    from,
    to: currentTo,
    insert: next.slice(from, nextTo),
  };
}

export function sourceSynchronizationSpec(state, nextSource, { protectedRanges = [], preserveSelection = true, effects = [] } = {}) {
  const next = nextSource.replace(/\r\n?/g, "\n");
  const changes = preserveSelection ? minimalDocumentChange(state.doc.toString(), next) : { from: 0, to: state.doc.length, insert: next };
  const { from, to } = changes;
  if (protectedRanges.some((range) => from < range.to && to > range.from || from === to && from > range.from && from < range.to)) {
    throw new CommentError("history_conflict", "Incoming changes overlap pending source edits; retain both versions before synchronization.");
  }
  return { changes, effects, annotations: Transaction.addToHistory.of(false) };
}

export function synchronizeCommentChanges(state, nextSource, options) {
  return state.update(sourceSynchronizationSpec(state, nextSource, options));
}
