export const LOCAL_STATE_INTERVAL_MS = 60_000;
export const PREVIEW_STATUS_INTERVAL_MS = 60_000;
export const EDITOR_STATUS_INTERVAL_MS = 2000;

export function documentStatusIntervalMs(mode) {
  return mode === "source" || mode === "live"
    ? EDITOR_STATUS_INTERVAL_MS
    : PREVIEW_STATUS_INTERVAL_MS;
}

// The same coordinator handles polling, focus and explicit refresh requests.
// A forced request queued behind older work must recheck after that work completes.
export function createRefreshQueue() {
  let pending = null;
  return async (refresh, { fresh = false } = {}) => {
    while (pending) {
      const previous = pending;
      await previous;
      if (!fresh) return previous;
    }
    pending = Promise.resolve().then(refresh);
    try { return await pending; }
    finally { pending = null; }
  };
}

// Native visibility and focus events belong to the same resume burst. Delay only
// their start by one short turn; explicit actions cancel it and request fresh work.
export function createResumeRefresh({ refresh, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null;
  const resume = () => {
    if (timer !== null) cancel(timer);
    timer = schedule(() => { timer = null; void refresh(); }, 50);
  };
  resume.cancel = () => { if (timer !== null) cancel(timer); timer = null; };
  return resume;
}
