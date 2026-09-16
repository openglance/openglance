export const DESKTOP_OPEN_DOCUMENT_EVENT = "git-leaf-desktop-open-document";

// The desktop waits for the navigation result, not merely event delivery. Once
// accepted, a failed save or missing document must never trigger a page reload.
export function createDesktopDocumentNavigationHandler({
  isReady,
  getWorktreeId,
  prepareNavigation,
  navigate,
  onError,
}) {
  let pending = Promise.resolve();
  return (event) => {
    const request = event.detail;
    if (!isReady() || !request || request.worktreeId !== getWorktreeId()) return;
    event.preventDefault();
    pending = pending.then(async () => {
      if (!isReady() || request.worktreeId !== getWorktreeId()) return false;
      try {
        if (!request.file) return true;
        await prepareNavigation();
        return await navigate(request.file) === true;
      } catch (error) {
        onError(error);
        return false;
      }
    });
    request.result = pending;
  };
}
