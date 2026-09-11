import { shouldIgnoreWatchedChange } from "./source-sync.js";

export function documentStatusRefreshKind(currentDocument, status, { currentMode, lastWrittenHash } = {}) {
  if (!currentDocument || !status) {
    return null;
  }
  if (
    status.dependencyHash !== currentDocument.dependencyHash ||
    (status.sourceHash !== currentDocument.sourceHash && !shouldIgnoreWatchedChange({
      currentMode,
      watchedHash: status.sourceHash,
      lastWrittenHash,
    }))
  ) {
    return "content";
  }
  return status.changeBaselineRevision !== currentDocument.changeBaselineRevision ? "baseline" : null;
}

export function withDocumentChangeBaseline(currentDocument, nextDocument) {
  return {
    ...currentDocument,
    changeBaselineAvailable: nextDocument.changeBaselineAvailable,
    changeBaselineRevision: nextDocument.changeBaselineRevision,
    changeBaselineSource: nextDocument.changeBaselineSource,
  };
}

export function shouldReplaceDocumentHtml(currentDocument, nextDocument) {
  if (!currentDocument || !nextDocument) {
    return true;
  }
  return (
    currentDocument.path !== nextDocument.path ||
    currentDocument.kind !== nextDocument.kind ||
    currentDocument.sourceHash !== nextDocument.sourceHash ||
    currentDocument.dependencyHash !== nextDocument.dependencyHash ||
    currentDocument.source !== nextDocument.source ||
    currentDocument.html !== nextDocument.html
  );
}
