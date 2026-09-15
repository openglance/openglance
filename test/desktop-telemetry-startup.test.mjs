import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

test("desktop startup preserves telemetry through launch classification, daily upload, and reporting", async () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--experimental-vm-modules", "--test", "--test-reporter=tap",
    fileURLToPath(new URL("fixtures/desktop-telemetry-startup.mjs", import.meta.url)),
  ], { timeout: 30_000, env });
  assert.match(stdout, /# fail 0/);
});
