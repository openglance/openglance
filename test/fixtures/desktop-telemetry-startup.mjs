import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTelemetryClient } from "../../src/desktop/telemetry.mjs";
import { summarizeTelemetryFiles } from "../../scripts/summarize-telemetry.mjs";
import { desktopTelemetryHarness } from "../helpers/desktop-telemetry-harness.mjs";

for (const [argument, entryKind] of [
  [null, "manual"],
  ["openglance://open", "deep_link"],
  ["git-leaf://open", "deep_link"],
  ["--openglance-install-confirm=test", "windows_bootstrap"],
  ["--git-leaf-install-confirm=test", "windows_bootstrap"],
]) {
  test(`official desktop ${argument ?? "manual"} launch produces durable daily summaries`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openglance-telemetry-startup-"));
    const userDataDir = path.join(root, "profile");
    const sent = [];
    let harness;
    try {
      // An existing eligible installation upgrades, matching the production
      // symptom where version metadata advances but subsequent daily state stops.
      const previous = createTelemetryClient({
        enabled: true, userDataDir, platform: "darwin", arch: "arm64",
        buildInfo: { version: "3.2.3", buildId: "previous-release" },
        now: () => new Date("2026-09-11T08:00:00Z"),
        fetchFn: async () => ({ ok: true }),
      });
      await previous.initialize();
      previous.recordLaunch("manual");
      await previous.queueDailySummary();
      await previous.flush();
      await previous.shutdown();

      harness = await desktopTelemetryHarness({
        userDataDir, argv: ["OpenGlance", ...(argument ? [argument] : [])],
        fetchFn: async (_url, options) => {
          sent.push(...JSON.parse(options.body).events);
          return { ok: true, status: 202 };
        },
      });
      await harness.start();
      assert.equal(harness.available, true, "desktop startup must retain the client and start its uploader");
      harness.advance(2_000);
      await harness.initialUpload();
      assert.equal(sent.filter((event) => event.event_name === "git_leaf.daily.summary").length, 1);
      await harness.updateCheck();
      harness.advance(60_000);
      await harness.periodicUpload();

      const durable = JSON.parse(await readFile(path.join(userDataDir, "telemetry-state.json"), "utf8"));
      const firstDay = durable.days["2026-09-12"];
      assert.equal(firstDay.launchCount, 1);
      assert.equal(firstDay.launchCountsByEntryKind[entryKind], 1);
      assert.ok(firstDay.interactiveActiveMs > 0);
      assert.equal(firstDay.lastUploadedRevision, firstDay.revision);
      assert.equal(durable.lastSeenVersion, "3.2.4");

      // Keep the same process across the business-day boundary, then use it
      // again without relaunching. Interaction must form the next day's summary.
      harness.setFocused(false);
      harness.advance(86_400_000);
      harness.setFocused(true);
      harness.advance(60_000);
      await harness.updateCheck();
      await harness.periodicUpload();
      const secondDay = harness.snapshot().state.days["2026-09-13"];
      assert.equal(secondDay.launchCount, 0);
      assert.ok(secondDay.interactiveActiveMs > 0);
      assert.equal(secondDay.lastUploadedRevision, secondDay.revision);
      assert.equal(sent.filter((event) => event.properties.reason === "first_observed").length, 0);

      // Exercise the real receiver validator and received-date JSONL writer,
      // then the unmodified strict aggregation pipeline. No HTTP request is sent.
      const receiver = fileURLToPath(new URL("../../scripts/openglance-update-server.py", import.meta.url));
      const result = spawnSync("python3", ["-B", "-c", `
import datetime, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("receiver", sys.argv[1])
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)
events = json.load(sys.stdin)
assert all(receiver.valid_telemetry_event(event) for event in events)
received = "2026-09-14T08:00:00Z"
stored = [dict(event, received_at=received) for event in events]
receiver.TelemetryLogStore(sys.argv[2]).append(stored + stored[:1], datetime.datetime.fromisoformat(received.replace("Z", "+00:00")))
`, receiver, path.join(root, "receiver")], { input: JSON.stringify(sent), encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const report = await summarizeTelemetryFiles({
        root: path.join(root, "receiver", "events"), from: "2026-09-12", to: "2026-09-13",
        now: () => new Date("2026-09-15T08:00:00Z"),
      });
      for (const date of ["2026-09-12", "2026-09-13"]) {
        assert.equal(report.activity.by_date[date].active_installations, 1);
        assert.ok(report.activity.by_date[date].interactive_active_ms > 0);
      }
      assert.equal(report.data_quality.invalid_lines, 0);
      assert.equal(report.data_quality.excluded_inconsistent_daily_summaries, 0);
    } finally {
      await harness?.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
}
