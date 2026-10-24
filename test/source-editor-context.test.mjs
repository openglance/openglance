import assert from "node:assert/strict";
import test from "node:test";

import {
  EditorState,
  StateEffect,
  Transaction,
} from "@codemirror/state";

import {
  dispatchEditorTransactions,
  editorTransactionsPreserveContext,
  preserveEditorContext,
} from "../src/client/source-editor.mjs";

const scrollAnchorEffect = StateEffect.define({
  map(position, changes) {
    return changes.mapPos(position);
  },
});

for (const userEvent of ["undo", "redo"]) {
  test(`${userEvent} keeps the visible document anchor while applying its source change`, () => {
    const state = EditorState.create({ doc: "alpha\nbeta\ngamma" });
    const transaction = state.update({
      changes: { from: 0, insert: "prefix\n" },
      annotations: Transaction.userEvent.of(userEvent),
    });
    const view = editorViewFixture(state, 8);

    dispatchEditorTransactions([transaction], view);

    assert.equal(view.updatedTransactions.length, 2);
    assert.equal(
      view.updatedTransactions.at(-1).effects[0].value,
      15,
    );
  });
}

test("programmatic Live formatting preserves the viewport and existing selection mapping", () => {
  const state = EditorState.create({
    doc: "before\n| A | B |\n| --- | --- |\n| 1 | 2 |\nafter",
    selection: { anchor: 7, head: 14 },
  });
  const transaction = state.update(preserveEditorContext({
    changes: { from: 31, to: 32, insert: "**1**" },
  }));
  const view = editorViewFixture(state, 40);

  assert.equal(editorTransactionsPreserveContext([transaction]), true);
  dispatchEditorTransactions([transaction], view);

  assert.equal(view.updatedTransactions.length, 2);
  assert.deepEqual(transaction.state.selection.main.toJSON(), {
    anchor: 7,
    head: 14,
  });
  assert.equal(view.updatedTransactions.at(-1).effects[0].value, 44);
});

test("ordinary typing keeps CodeMirror's native cursor scrolling behavior", () => {
  const state = EditorState.create({ doc: "alpha\nbeta" });
  const transaction = state.update({
    changes: { from: state.doc.length, insert: "!" },
    userEvent: "input.type",
  });
  const view = editorViewFixture(state, 4);

  assert.equal(editorTransactionsPreserveContext([transaction]), false);
  dispatchEditorTransactions([transaction], view);

  assert.deepEqual(view.updatedTransactions, [transaction]);
  assert.equal(view.snapshotCalls, 0);
});

function editorViewFixture(state, scrollAnchor) {
  return {
    state,
    snapshotCalls: 0,
    updatedTransactions: [],
    scrollSnapshot() {
      this.snapshotCalls += 1;
      return scrollAnchorEffect.of(scrollAnchor);
    },
    update(transactions) {
      this.updatedTransactions = transactions;
      this.state = transactions.at(-1)?.state ?? this.state;
    },
  };
}
