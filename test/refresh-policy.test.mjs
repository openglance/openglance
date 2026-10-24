import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_STATE_INTERVAL_MS, documentStatusIntervalMs, createRefreshQueue, createResumeRefresh } from "../public/refresh-policy.js";

test("reading checks once a minute while either editor keeps two-second external checks", () => {
  assert.equal(LOCAL_STATE_INTERVAL_MS, 60_000);
  assert.equal(documentStatusIntervalMs("preview"), 60_000);
  assert.equal(documentStatusIntervalMs("source"), 2000);
  assert.equal(documentStatusIntervalMs("live"), 2000);
});

test("a focus burst shares work but an explicit action rechecks after older work", async () => {
  const run = createRefreshQueue();
  let release, calls = 0, state = "old";
  const gate = new Promise(resolve => { release = resolve; });
  const first = run(async () => { calls++; const value = state; await gate; return value; });
  const focus = run(() => { throw Error("Focus must share the request"); });
  const explicit = run(() => { calls++; return state; }, { fresh: true });
  await Promise.resolve();
  state = "new";
  release();
  assert.equal(await first, "old");
  assert.equal(await focus, "old");
  assert.equal(await explicit, "new");
  assert.equal(calls, 2);
});

test("visibility and focus coalesce and hiding or explicit refresh cancels the pending burst", () => {
  const timers = new Map(); let next = 0, calls = 0;
  const resume = createResumeRefresh({ refresh: () => { calls++; }, schedule: fn => { timers.set(++next, fn); return next; }, cancel: id => timers.delete(id) });
  resume(); resume();
  assert.equal(timers.size, 1);
  const fn = [...timers.values()][0];timers.clear();fn();
  assert.equal(calls, 1);
  resume();resume.cancel();
  assert.equal(timers.size, 0);
});
