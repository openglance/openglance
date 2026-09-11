import assert from "node:assert/strict";
import test from "node:test";

import {
  documentStatusRefreshKind,
  shouldReplaceDocumentHtml,
  withDocumentChangeBaseline,
} from "../public/document-refresh.js";

test("external commits refresh edit cues in every mode even when file contents and timestamps stay unchanged", () => {
  const current = { path: "a.md", sourceHash: "saved", dependencyHash: "", mtimeMs: 100, changeBaselineRevision: "before" };
  const committed = { ...current, changeBaselineRevision: "after" };
  for (const currentMode of ["preview", "source", "live"]) {
    const options = { currentMode, lastWrittenHash: "saved" };
    assert.equal(documentStatusRefreshKind(current, current, options), null);
    assert.equal(documentStatusRefreshKind(current, committed, options), "baseline");
    assert.equal(documentStatusRefreshKind(committed, current, options), "baseline");
    assert.equal(documentStatusRefreshKind({ ...current, changeBaselineRevision: null }, committed, options), "baseline");
  }
});

test("document status distinguishes external text and dataset updates from our own editor writes", () => {
  const current = { sourceHash: "old", dependencyHash: "data", changeBaselineRevision: "base" };
  const ownWrite = { ...current, sourceHash: "saved" };
  const options = { currentMode: "live", lastWrittenHash: "saved" };
  assert.equal(documentStatusRefreshKind(current, ownWrite, options), null);
  assert.equal(documentStatusRefreshKind(current, { ...ownWrite, changeBaselineRevision: "commit" }, options), "baseline");
  assert.equal(documentStatusRefreshKind(current, { ...current, sourceHash: "external" }, options), "content");
  assert.equal(documentStatusRefreshKind(current, { ...ownWrite, dependencyHash: "new data" }, options), "content");
});

test("updating a committed baseline preserves pending editor text and the existing preview", () => {
  const current = {
    path: "a.md", source: "Saved text plus pending input", sourceHash: "saved",
    html: "<p>Saved text</p>", mtimeMs: 100, changeBaselineAvailable: true,
    changeBaselineRevision: "before", changeBaselineSource: "Old text",
  };
  const next = {
    ...current, source: "Saved text", changeBaselineAvailable: true,
    changeBaselineRevision: "after", changeBaselineSource: "Saved text",
  };
  const updated = withDocumentChangeBaseline(current, next);
  assert.equal(updated.source, current.source);
  assert.equal(updated.sourceHash, current.sourceHash);
  assert.equal(updated.changeBaselineSource, next.changeBaselineSource);
  assert.equal(updated.changeBaselineRevision, next.changeBaselineRevision);
  assert.equal(shouldReplaceDocumentHtml(current, updated), false);
  assert.equal(withDocumentChangeBaseline(updated, {
    changeBaselineAvailable: false, changeBaselineRevision: null,
  }).changeBaselineSource, undefined);
});

test("shouldReplaceDocumentHtml only replaces the rendered document when content changes", () => {
  assert.equal(
    shouldReplaceDocumentHtml({ source: "# Same\n", path: "a.md" }, { source: "# Same\n", path: "a.md" }),
    false,
  );
  assert.equal(
    shouldReplaceDocumentHtml({ source: "# Old\n", path: "a.md" }, { source: "# New\n", path: "a.md" }),
    true,
  );
  assert.equal(
    shouldReplaceDocumentHtml({ source: "# Same\n", path: "a.md" }, { source: "# Same\n", path: "b.md" }),
    true,
  );
});

test("shouldReplaceDocumentHtml replaces stale preview html after source sync writes", () => {
  assert.equal(
    shouldReplaceDocumentHtml(
      { path: "a.md", source: "# New\n", html: "<h1>Old</h1>" },
      { path: "a.md", source: "# New\n", html: "<h1>New</h1>" },
    ),
    true,
  );
});

test("shouldReplaceDocumentHtml replaces a report when only its dataset changes", () => {
  assert.equal(
    shouldReplaceDocumentHtml(
      { path: "report.mdx", source: "<Chart />", html: "same", dependencyHash: "old" },
      { path: "report.mdx", source: "<Chart />", html: "same", dependencyHash: "new" },
    ),
    true,
  );
});
