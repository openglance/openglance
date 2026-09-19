import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";

test("OpenGlance update server serves universal and ARM migration Squirrel.Mac feeds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-updates-"));
  const artifactUrl = "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/Git%20Leaf.zip";
  for (const platformKey of ["darwin-universal", "darwin-arm64"]) {
    const platformDir = path.join(root, "git-leaf", "stable", platformKey);
    await mkdir(platformDir, { recursive: true });
    await writeFile(path.join(platformDir, "latest.json"), JSON.stringify({
      version: "0.1.2",
      autoUpdater: {
        url: artifactUrl,
        name: "OpenGlance 0.1.2",
        notes: "Release update",
        pub_date: "2026-07-06T07:00:00.000Z",
      },
    }));
  }

  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);

    for (const platformKey of ["darwin-universal", "darwin-arm64"]) {
      const newer = await fetch(`http://127.0.0.1:${port}/git-leaf/stable/${platformKey}/releases/0.1.1`);
      assert.equal(newer.status, 200);
      assert.deepEqual(await newer.json(), {
        url: artifactUrl,
        name: "OpenGlance 0.1.2",
        notes: "Release update",
        pub_date: "2026-07-06T07:00:00.000Z",
      });

      const current = await fetch(`http://127.0.0.1:${port}/git-leaf/stable/${platformKey}/releases/0.1.2`);
      assert.equal(current.status, 204);
    }
    const nonexistentIntelLegacyFeed = await fetch(
      `http://127.0.0.1:${port}/git-leaf/stable/darwin-x64/releases/0.1.1`,
    );
    assert.equal(nonexistentIntelLegacyFeed.status, 404);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server appends validated telemetry batches as JSONL", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-telemetry-server-"));
  const telemetryRoot = path.join(root, "telemetry");
  const archiveDate = shiftedUtcDate(-8);
  const expiredDate = shiftedUtcDate(-366);
  const archivePath = telemetryLogPath(telemetryRoot, archiveDate);
  const expiredPath = telemetryLogPath(telemetryRoot, expiredDate);
  const downloadArchivePath = telemetryLogPath(telemetryRoot, archiveDate, "downloads");
  const downloadExpiredPath = telemetryLogPath(telemetryRoot, expiredDate, "downloads");
  await mkdir(path.dirname(archivePath), { recursive: true });
  await mkdir(path.dirname(expiredPath), { recursive: true });
  await mkdir(path.dirname(downloadArchivePath), { recursive: true });
  await mkdir(path.dirname(downloadExpiredPath), { recursive: true });
  await writeFile(archivePath, "{\"old\":true}\n");
  await writeFile(expiredPath, "{\"expired\":true}\n");
  await writeFile(downloadArchivePath, "{\"old_download\":true}\n");
  await writeFile(downloadExpiredPath, "{\"expired_download\":true}\n");
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--telemetry-root",
    telemetryRoot,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const event = telemetryDailyEvent();
    event.properties.feature_counts = [{
      feature_id: "navigation.deep_link",
      dimensions: {
        type: "repository",
        result: "error",
        failure_reason: "repository_not_known",
      },
      count: 1,
    }];
    const response = await fetch(`http://127.0.0.1:${port}/telemetry/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [event] }),
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: 1 });
    const files = await jsonlFiles(telemetryRoot);
    assert.equal(files.length, 1);
    const stored = JSON.parse((await readFile(files[0], "utf8")).trim());
    assert.deepEqual({ ...stored, received_at: undefined }, { ...event, received_at: undefined });
    assert.match(stored.received_at, /^\d{4}-\d{2}-\d{2}T/);
    const maintainedFiles = await allTelemetryFiles(telemetryRoot);
    assert.ok(maintainedFiles.includes(`${archivePath}.gz`));
    assert.ok(!maintainedFiles.includes(archivePath));
    assert.ok(!maintainedFiles.includes(expiredPath));
    assert.ok(maintainedFiles.includes(`${downloadArchivePath}.gz`));
    assert.ok(!maintainedFiles.includes(downloadArchivePath));
    assert.ok(!maintainedFiles.includes(downloadExpiredPath));
    await assertPosixMode(files[0], 0o640);
    await assertPosixMode(path.dirname(files[0]), 0o750);
    await assertPosixMode(`${downloadArchivePath}.gz`, 0o640);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server rejects telemetry with private or unknown fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-telemetry-invalid-"));
  const telemetryRoot = path.join(root, "telemetry");
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--telemetry-root",
    telemetryRoot,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const privateField = telemetryDailyEvent();
    privateField.properties.path = "/private/repo/README.md";
    const controlBuildId = telemetryDailyEvent();
    controlBuildId.event_id = telemetryEventId(60);
    controlBuildId.app.build_id = "release-1.5.0\nprivate";
    const controlOsVersion = telemetryDailyEvent();
    controlOsVersion.event_id = telemetryEventId(61);
    controlOsVersion.app.os_version_major = "15\tprivate";
    const emptyDeviceName = telemetryInstallationEvent(62, "");
    const controlDeviceName = telemetryInstallationEvent(63, "Private\tDevice");
    const unknownDeepLinkReason = telemetryDailyEvent();
    unknownDeepLinkReason.event_id = telemetryEventId(64);
    unknownDeepLinkReason.properties.feature_counts = [{
      feature_id: "navigation.deep_link",
      dimensions: { type: "repository", result: "error", failure_reason: "private_repo_name" },
      count: 1,
    }];
    const successWithFailureReason = telemetryDailyEvent();
    successWithFailureReason.event_id = telemetryEventId(65);
    successWithFailureReason.properties.feature_counts = [{
      feature_id: "navigation.deep_link",
      dimensions: { type: "repository", result: "success", failure_reason: "repository_not_known" },
      count: 1,
    }];

    for (const event of [
      privateField,
      controlBuildId,
      controlOsVersion,
      emptyDeviceName,
      controlDeviceName,
      unknownDeepLinkReason,
      successWithFailureReason,
    ]) {
      const response = await postTelemetry(port, [event]);
      assert.equal(response.status, 400, JSON.stringify(event));
      assert.deepEqual(await response.json(), { accepted: 0, error: "invalid_event" });
    }
    assert.deepEqual(await jsonlFiles(telemetryRoot), []);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server enforces versioned update-state contracts without rejecting queued legacy events", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-telemetry-update-contract-"));
  const telemetryRoot = path.join(root, "telemetry");
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--telemetry-root",
    telemetryRoot,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const accepted = [
      telemetryUpdateEvent(1, "1.10.0", {
        state: "check_started", trigger: "manual", from_version: "1.10.0",
      }),
      telemetryUpdateEvent(2, "1.10.0", {
        state: "current", trigger: "automatic", from_version: "1.10.0", to_version: "1.10.0",
      }),
      telemetryUpdateEvent(3, "1.10.0", {
        state: "available", trigger: "manual", from_version: "1.10.0", to_version: "1.11.0",
      }),
      telemetryUpdateEvent(4, "1.10.0", {
        state: "completed", trigger: "automatic", from_version: "1.9.0", to_version: "1.10.0",
      }),
      telemetryUpdateEvent(5, "1.10.0", {
        state: "failed", trigger: "automatic", from_version: "1.10.0", error_code: "network", stage: "check",
      }),
      telemetryUpdateEvent(6, "1.10.0", {
        state: "failed", trigger: "manual", from_version: "1.10.0", to_version: "1.11.0", error_code: "network", stage: "download",
      }),
      telemetryUpdateEvent(7, "1.9.0", {
        state: "failed", trigger: "automatic", from_version: "1.9.0",
      }),
      telemetryUpdateEvent(8, "1.9.0", {
        state: "available", trigger: "automatic", from_version: "1.9.0",
      }),
      telemetryUpdateEvent(9, "1.10.1-rc.1+build.7", {
        state: "check_started", trigger: "automatic", from_version: "1.10.1-rc.1+local.2",
      }),
      telemetryUpdateEvent(10, "1.9.0", {
        state: "failed", trigger: "automatic", from_version: "1.9.0", error_code: "network",
      }),
      telemetryUpdateEvent(11, "1.9.0", {
        state: "failed", trigger: "automatic", from_version: "1.9.0", stage: "download",
      }),
    ];
    for (const event of accepted) {
      const response = await postTelemetry(port, [event]);
      assert.equal(response.status, 202, JSON.stringify(event.properties));
      assert.deepEqual(await response.json(), { accepted: 1 });
    }

    const rejected = [
      telemetryUpdateEvent(20, "1.10", {
        state: "check_started", trigger: "manual", from_version: "1.10.0",
      }),
      telemetryUpdateEvent(21, "1.10.0", {
        state: "check_started", trigger: "manual", from_version: "next",
      }),
      telemetryUpdateEvent(22, "1.10.0", {
        state: "available", trigger: "manual", from_version: "1.10.0", to_version: "01.11.0",
      }),
      telemetryUpdateEvent(23, "1.10.0", {
        state: "failed", trigger: "automatic", from_version: "1.10.0", error_code: "network",
      }),
      telemetryUpdateEvent(24, "1.10.0", {
        state: "failed", trigger: "automatic", from_version: "1.10.0", error_code: null, stage: null,
      }),
      telemetryUpdateEvent(25, "1.10.0", {
        state: "failed", trigger: "manual", from_version: "1.10.0", error_code: "network", stage: "download",
      }),
      telemetryUpdateEvent(26, "1.10.0", {
        state: "available", trigger: "manual", from_version: "1.10.0",
      }),
      telemetryUpdateEvent(27, "1.10.0", {
        state: "current", trigger: "automatic", from_version: "1.10.0", to_version: "1.11.0",
      }),
      telemetryUpdateEvent(28, "1.10.0", {
        state: "downloaded", trigger: "manual", from_version: "1.10.0", to_version: "1.10.0",
      }),
      telemetryUpdateEvent(29, "1.10.0", {
        state: "completed", trigger: "automatic", from_version: "1.10.0", to_version: "1.10.0",
      }),
      telemetryUpdateEvent(30, "1.10.0", {
        state: "available", trigger: "manual", from_version: "1.10.0", to_version: "1.11.0", error_code: "network",
      }),
      telemetryUpdateEvent(31, "1.10.0-01", {
        state: "check_started", trigger: "manual", from_version: "1.10.0",
      }),
      telemetryUpdateEvent(32, "1.9.0", {
        state: "failed", trigger: "automatic",
      }),
      telemetryUpdateEvent(33, "1.9.0", {
        state: "available", trigger: "automatic", from_version: "1.9.0", error_code: "network",
      }),
      telemetryUpdateEvent(34, "1.9.0", {
        state: "available", trigger: "automatic", from_version: "1.9.0", stage: "check",
      }),
      telemetryUpdateEvent(35, "1.9.0", {
        state: "failed", trigger: "automatic", from_version: "1.9.0", error_code: "private",
      }),
      telemetryUpdateEvent(36, "1.9.0", {
        state: "failed", trigger: "automatic", from_version: "1.9.0", stage: "private",
      }),
      telemetryUpdateEvent(37, "1.9.0", {
        state: "failed", trigger: "automatic", from_version: "1.9.0", to_version: "next",
      }),
    ];
    for (const event of rejected) {
      const response = await postTelemetry(port, [event]);
      assert.equal(response.status, 400, JSON.stringify(event));
      assert.deepEqual(await response.json(), { accepted: 0, error: "invalid_event" });
    }
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server validates real zoned timestamps and their local dates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-telemetry-date-contract-"));
  const telemetryRoot = path.join(root, "telemetry");
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--telemetry-root",
    telemetryRoot,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const valid = telemetryDailyEvent();
    valid.event_id = telemetryEventId(40);
    valid.occurred_at = "2026-07-12T20:00:00.000Z";
    valid.local_date = "2026-07-13";
    assert.equal((await postTelemetry(port, [valid])).status, 202);

    const invalidEvents = [
      { occurred_at: "2026-02-30T08:00:00.000Z" },
      { occurred_at: "2026-07-12T08:00:00.000" },
      { local_date: "2026-02-30" },
      { local_date: "2026-07-13" },
    ].map((changes, index) => ({
      ...telemetryDailyEvent(),
      event_id: telemetryEventId(41 + index),
      ...changes,
    }));
    for (const event of invalidEvents) {
      const response = await postTelemetry(port, [event]);
      assert.equal(response.status, 400, JSON.stringify(event));
    }
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server accepts legacy daily summaries and binds explicit summary dates to install ids", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-telemetry-summary-date-"));
  const telemetryRoot = path.join(root, "telemetry");
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--telemetry-root",
    telemetryRoot,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const legacy = telemetryDailyEvent();
    legacy.event_id = telemetryEventId(50);
    assert.equal((await postTelemetry(port, [legacy])).status, 202);

    const explicit = telemetryDailyEvent();
    explicit.event_id = telemetryEventId(51);
    explicit.properties = {
      ...explicit.properties,
      summary_date: "2026-07-11",
      summary_id: summaryIdFor(explicit.install_id, "2026-07-11"),
    };
    assert.equal((await postTelemetry(port, [explicit])).status, 202);

    const capable = telemetryDailyEvent();
    capable.event_id = telemetryEventId(56);
    capable.properties = {
      ...capable.properties,
      activity_duration_contract: "foreground_interactive_v1",
      foreground_exposure_ms: 600_000,
      interactive_active_ms: 300_000,
      mode_foreground_exposure_ms: { preview: 600_000, source: 0, live: 0 },
      mode_interactive_ms: { preview: 300_000, source: 0, live: 0 },
    };
    assert.equal((await postTelemetry(port, [capable])).status, 202);

    const imbalancedCapable = structuredClone(capable);
    imbalancedCapable.event_id = telemetryEventId(57);
    imbalancedCapable.properties.mode_foreground_exposure_ms.preview = 599_999;
    assert.equal(
      (await postTelemetry(port, [imbalancedCapable])).status,
      202,
      "shape-valid imbalances must reach summary quality isolation",
    );

    const partialCapability = structuredClone(capable);
    partialCapability.event_id = telemetryEventId(58);
    delete partialCapability.properties.mode_interactive_ms;
    assert.equal((await postTelemetry(port, [partialCapability])).status, 400);

    const invalidDate = structuredClone(explicit);
    invalidDate.event_id = telemetryEventId(52);
    invalidDate.properties.summary_date = "2026-02-30";
    invalidDate.properties.summary_id = summaryIdFor(invalidDate.install_id, "2026-02-30");
    const mismatchedHash = structuredClone(explicit);
    mismatchedHash.event_id = telemetryEventId(53);
    mismatchedHash.properties.summary_id = summaryIdFor(mismatchedHash.install_id, "2026-07-10");
    const unknownField = structuredClone(explicit);
    unknownField.event_id = telemetryEventId(54);
    unknownField.properties.unknown = true;
    const futureSummary = structuredClone(explicit);
    futureSummary.event_id = telemetryEventId(55);
    futureSummary.properties.summary_date = "2026-07-13";
    futureSummary.properties.summary_id = summaryIdFor(futureSummary.install_id, "2026-07-13");
    for (const event of [invalidDate, mismatchedHash, unknownField, futureSummary]) {
      const response = await postTelemetry(port, [event]);
      assert.equal(response.status, 400, JSON.stringify(event.properties));
      assert.deepEqual(await response.json(), { accepted: 0, error: "invalid_event" });
    }
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server launches the app without binding to a repository", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-open-app-"));
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const response = await fetch(`http://127.0.0.1:${port}/open`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /git-leaf:\/\/open/);
    assert.doesNotMatch(html, /repo=/);
    assert.match(html, /handoff=[A-Za-z0-9_-]+/);
    assert.match(html, /只启动或聚焦应用，不会切换当前仓库或文档/);
    assert.match(html, /window\.close\(\)/);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance download page renders validated public macOS and Windows releases in both languages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-public-downloads-"));
  const macDir = path.join(root, "git-leaf", "stable", "darwin-universal");
  const windowsDir = path.join(root, "git-leaf", "stable", "win32-x64");
  await mkdir(macDir, { recursive: true });
  await mkdir(windowsDir, { recursive: true });
  const macArtifact = "mac package";
  const windowsArtifact = "windows package";
  await writeFile(path.join(macDir, "OpenGlance-1.4.0.dmg"), macArtifact);
  await writeFile(path.join(windowsDir, "OpenGlance-1.4.0.zip"), windowsArtifact);
  await writeFile(path.join(macDir, "latest.json"), JSON.stringify({
    version: "1.4.0",
    releaseTrack: "public",
    channel: "stable",
    platform: "darwin-universal",
    files: {
      dmg: {
        url: "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/OpenGlance-1.4.0.dmg",
        sha256: "a".repeat(64),
        size: Buffer.byteLength(macArtifact),
      },
      zip: {
        url: "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/OpenGlance-1.4.0.zip",
        sha256: "b".repeat(64),
        size: 10485760,
      },
    },
  }));
  await writeFile(path.join(windowsDir, "latest.json"), JSON.stringify({
    version: "1.4.0",
    releaseTrack: "public",
    channel: "stable",
    platform: "win32-x64",
    files: {
      zip: {
        url: "https://updates.mangofuture.com/git-leaf/stable/win32-x64/OpenGlance-1.4.0.zip",
        sha256: "c".repeat(64),
        size: Buffer.byteLength(windowsArtifact),
      },
    },
  }));

  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const response = await fetch(`http://127.0.0.1:${port}/download`, {
      headers: { "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8" },
    });
    const english = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-language"), "en");
    assert.equal(response.headers.get("vary"), "Accept-Language");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src/);
    assert.match(english, /A desktop interface for Git repositories used as shared context by teams and AI agents\./);
    assert.match(english, /One repository for agents\. A familiar interface for people\./);
    assert.match(english, /AI agents work directly in Git\. People use OpenGlance to read, inspect, and make focused edits\./);
    assert.match(english, /Developer ID signed and Apple notarized/);
    assert.match(english, /Unsigned Preview/);
    assert.match(
      english,
      /href="https:\/\/updates\.mangofuture\.com\/git-leaf\/stable\/darwin-universal\/OpenGlance-1\.4\.0\.dmg\?source=download-page"[^>]*>Download for macOS 1\.4\.0</,
    );
    assert.match(
      english,
      /href="https:\/\/updates\.mangofuture\.com\/git-leaf\/stable\/win32-x64\/OpenGlance-1\.4\.0\.zip\?source=download-page"[^>]*>Download Windows Preview 1\.4\.0</,
    );
    assert.match(english, new RegExp("a{64}"));
    assert.match(english, new RegExp("c{64}"));
    assert.doesNotMatch(english, /(?:openglance|git-leaf):\/\//);
    assert.doesNotMatch(english, /<script/i);

    const chineseResponse = await fetch(`http://127.0.0.1:${port}/download?lang=zh-CN`, {
      headers: { "Accept-Language": "en-US" },
    });
    const chinese = await chineseResponse.text();
    assert.equal(chineseResponse.headers.get("content-language"), "zh-CN");
    assert.match(chinese, /面向团队与 AI Agent 共享上下文仓库的桌面应用。/);
    assert.match(chinese, /一个供 Agent 直接工作的仓库，一个供人使用的熟悉界面。/);
    assert.match(chinese, /AI Agent 直接使用 Git 仓库；人通过 OpenGlance 阅读、检查并做范围明确的小修改。/);
    assert.match(chinese, /Windows 会显示未知发布者警告/);

    const head = await fetch(`http://127.0.0.1:${port}/download`, {
      method: "HEAD",
      headers: { "Accept-Language": "zh-CN" },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-language"), "zh-CN");
    assert.equal(await head.text(), "");

    const openPage = await (await fetch(`http://127.0.0.1:${port}/open`)).text();
    assert.match(openPage, /git-leaf:\/\/open/);
    assert.doesNotMatch(openPage, /source=download-page|Download for macOS|下载 macOS/);

    const sharePage = await (await fetch(
      `http://127.0.0.1:${port}/share?v=1&repo=ExampleOrg%2Fknowledge&path=README.md&rev=${"1".repeat(40)}`,
    )).text();
    assert.match(sharePage, /git-leaf:\/\/open-shared/);
    assert.doesNotMatch(sharePage, /source=download-page|Download for macOS|下载 macOS/);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance download page rejects legacy, internal, and malformed public manifests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-download-internal-hidden-"));
  for (const [platform, releaseTrack, artifact, extension] of [
    ["darwin-universal", "internal", "dmg", "dmg"],
    ["darwin-arm64", "public", "dmg", "dmg"],
    ["win32-x64", undefined, "zip", "zip"],
  ]) {
    const platformDir = path.join(root, "git-leaf", "stable", platform);
    await mkdir(platformDir, { recursive: true });
    await writeFile(path.join(platformDir, "latest.json"), JSON.stringify({
      version: "1.11.3",
      releaseTrack,
      channel: "stable",
      platform,
      files: {
        [artifact]: {
          url: `https://updates.mangofuture.com/git-leaf/stable/${platform}/OpenGlance-1.11.3-internal-${platform}.${extension}`,
          sha256: releaseTrack === "public" ? "not-a-sha256" : "d".repeat(64),
          size: 1024,
        },
      },
    }));
  }

  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const response = await fetch(`http://127.0.0.1:${port}/download`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Public builds are not available yet/);
    assert.match(html, /internal distributions are never shown here/);
    assert.match(html, /View source and run instructions/);
    assert.doesNotMatch(html, /OpenGlance-1\.11\.3-internal/);
    assert.doesNotMatch(html, /Download for macOS 1\.11\.3/);
    assert.doesNotMatch(html, /Download Windows Preview 1\.11\.3/);
    assert.doesNotMatch(html, /internal-stable/);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server logs completed public download-page artifacts without request identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-download-log-"));
  const telemetryRoot = path.join(root, "telemetry");
  const platformDir = path.join(root, "git-leaf", "stable", "darwin-universal");
  const artifactName = "OpenGlance-1.4.0-darwin-universal.dmg";
  const artifactPath = path.join(platformDir, artifactName);
  const manifestPath = path.join(platformDir, "latest.json");
  const manifest = {
    version: "1.4.0",
    releaseTrack: "public",
    channel: "stable",
    platform: "darwin-universal",
    files: {
      dmg: {
        url: `https://updates.mangofuture.com/git-leaf/stable/darwin-universal/${artifactName}`,
        sha256: "e".repeat(64),
        size: 20,
      },
    },
  };
  await mkdir(platformDir, { recursive: true });
  await writeFile(artifactPath, "distribution package");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--telemetry-root",
    telemetryRoot,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const artifactUrl = `http://127.0.0.1:${port}/git-leaf/stable/darwin-universal/${artifactName}`;
    const untracked = await fetch(artifactUrl);
    assert.equal(untracked.status, 200);
    await untracked.arrayBuffer();
    assert.equal((await fetch(`${artifactUrl}?source=download-page`, { method: "HEAD" })).status, 200);
    const tracked = await fetch(`${artifactUrl}?source=download-page`);
    assert.equal(tracked.status, 200);
    await tracked.arrayBuffer();
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: "1.4.0\n" }));
    const invalidManifestVersion = await fetch(`${artifactUrl}?source=download-page`);
    assert.equal(invalidManifestVersion.status, 200);
    await invalidManifestVersion.arrayBuffer();

    const { files, records } = await waitForValue(async () => {
      const files = (await jsonlFiles(telemetryRoot))
        .filter((file) => file.includes(`${path.sep}downloads${path.sep}`));
      if (files.length !== 1) return null;
      const body = (await readFile(files[0], "utf8")).trim();
      if (!body) return null;
      return { files, records: body.split("\n").map(JSON.parse) };
    }, { label: "the completed download record" });
    assert.equal(files.length, 1);
    assert.equal(records.length, 1);
    assert.deepEqual({ ...records[0], download_id: undefined, occurred_at: undefined }, {
      schema_version: 1,
      download_id: undefined,
      event_name: "git_leaf.distribution.downloaded",
      occurred_at: undefined,
      channel: "stable",
      platform: "darwin-universal",
      version: "1.4.0",
      artifact: "dmg",
      source: "download_page",
      bytes: 20,
    });
    assert.match(records[0].download_id, /^[A-Za-z0-9_-]{20,64}$/);
    assert.match(records[0].occurred_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(JSON.stringify(records[0]), /127\.0\.0\.1|user-agent|referer/i);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance download page falls back to the last ARM release before the first universal release", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-download-arm-fallback-"));
  const macDir = path.join(root, "git-leaf", "stable", "darwin-arm64");
  await mkdir(macDir, { recursive: true });
  const armArtifact = "arm package";
  await writeFile(path.join(macDir, "OpenGlance-1.8.1.dmg"), armArtifact);
  await writeFile(path.join(macDir, "latest.json"), JSON.stringify({
    version: "1.8.1",
    releaseTrack: "public",
    channel: "stable",
    platform: "darwin-arm64",
    files: {
      dmg: {
        url: "https://updates.mangofuture.com/git-leaf/stable/darwin-arm64/OpenGlance-1.8.1.dmg",
        sha256: "f".repeat(64),
        size: Buffer.byteLength(armArtifact),
      },
    },
  }));

  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const response = await fetch(`http://127.0.0.1:${port}/download`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /OpenGlance-1\.8\.1\.dmg/);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server renders a safe optional document deep link", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-open-"));
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const response = await fetch(
      `http://127.0.0.1:${port}/open?repo=ExampleOrg%2Fcompany-docs&path=company%2Fstrategy.md&worktree=0123456789abcdef&lk_jump_to_browser=true`,
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
    assert.match(
      html,
      /git-leaf:\/\/open-worktree\?repo=exampleorg%2Fcompany-docs&amp;path=company%2Fstrategy\.md&amp;worktree=0123456789abcdef&amp;handoff=[A-Za-z0-9_-]+/,
    );
    assert.match(html, /<title>strategy.md<\/title>/);
    assert.match(html, /exampleorg\/company-docs · company\/strategy\.md/);
    assert.match(html, /在 OpenGlance 中打开/);
    assert.match(html, /window\.close\(\)/);
    assert.match(html, /\/open\/status\?id=/);
    assert.doesNotMatch(html, /window\.addEventListener\('blur',completeHandoff\)/);
    assert.doesNotMatch(html, /window\.setTimeout\(attemptClose/);
    assert.doesNotMatch(html, /scheduleClose\(\);window\.location\.href/);
    assert.doesNotMatch(html, /lk_jump_to_browser/);
    assert.match(html, /<meta property="og:title" content="strategy.md">/);
    assert.match(html, /<meta property="og:description" content="exampleorg\/company-docs · company\/strategy.md · 在本机指定工作目录打开">/);

    const base = `http://127.0.0.1:${port}/open?repo=owner%2Frepo&path=docs%2Fplan.md`;
    const titled = await fetch(`${base}&title=${encodeURIComponent('团队 <Plan> & "Review"')}&snippet=PRIVATE_BODY`);
    const titledHtml = await titled.text();
    assert.equal(titled.status, 200);
    assert.match(titledHtml, /<title>团队 &lt;Plan&gt; &amp; &quot;Review&quot;<\/title>/);
    assert.match(titledHtml, /<meta property="og:title" content="团队 &lt;Plan&gt; &amp; &quot;Review&quot;">/);
    assert.doesNotMatch(titledHtml, /PRIVATE_BODY/);
    const titledPage = runOpenPageScript(titledHtml);
    titledPage.dispatchWindow("DOMContentLoaded");
    const titledTarget = new URL(titledPage.location.href);
    assert.equal(titledTarget.searchParams.get("path"), "docs/plan.md");
    assert.equal(titledTarget.searchParams.has("title"), false);
    for (const suffix of ["&title=one&title=two", "&title=", `&title=${"x".repeat(101)}`, "&title=bad%00title"]) {
      assert.equal((await fetch(base + suffix)).status, 400);
    }
    const head = await fetch(`${base}&title=Plan`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const icon = await fetch(`http://127.0.0.1:${port}/open/icon.png`);
    assert.equal(icon.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await icon.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const page = runOpenPageScript(html);
    page.dispatchWindow("DOMContentLoaded");
    const deepLink = new URL(page.location.href);
    const handoff = deepLink.searchParams.get("handoff");
    assert.equal(deepLink.searchParams.get("repo"), "exampleorg/company-docs");
    assert.equal(deepLink.searchParams.get("path"), "company/strategy.md");
    assert.equal(deepLink.searchParams.get("worktree"), "0123456789abcdef");
    assert.match(handoff, /^[A-Za-z0-9_-]{20,64}$/);
    assert.equal(page.closeCalls, 0, "the page must stay open without app confirmation");

    page.dispatchWindow("blur");
    page.setHidden(true);
    await page.pollHandoff();
    assert.equal(page.closeCalls, 0, "browser focus guesses must not close an unconfirmed handoff");

    const pending = await fetch(`http://127.0.0.1:${port}/open/status?id=${handoff}`);
    assert.deepEqual(await pending.json(), { opened: false });
    const confirmed = await fetch(`http://127.0.0.1:${port}/open/confirm?id=${handoff}`, {
      method: "POST",
    });
    assert.equal(confirmed.status, 204);
    const opened = await fetch(`http://127.0.0.1:${port}/open/status?id=${handoff}`);
    assert.deepEqual(await opened.json(), { opened: true });

    page.confirmHandoff();
    await page.pollHandoff();
    assert.equal(page.closeCalls, 1, "the page closes only after the app confirms the handoff");
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance update server renders versioned share links and reports handoff states", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-share-"));
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const rev = "a".repeat(40);
    const sharePageUrl = new URL(`http://127.0.0.1:${port}/share`);
    sharePageUrl.searchParams.set("v", "1");
    sharePageUrl.searchParams.set("repo", "ExampleOrg/company-docs");
    sharePageUrl.searchParams.set("path", "company/strategy.md");
    sharePageUrl.searchParams.set("rev", rev);
    sharePageUrl.searchParams.set("title", "Company & Strategy");
    sharePageUrl.searchParams.set("snippet", "Goals, owners & milestones for coworkers.");
    sharePageUrl.searchParams.set("lk_jump_to_browser", "true");
    const response = await fetch(sharePageUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(
      html,
      new RegExp(`git-leaf:\\/\\/open-shared\\?v=1&amp;repo=exampleorg%2Fcompany-docs&amp;path=company%2Fstrategy\\.md&amp;rev=${rev}&amp;handoff=[A-Za-z0-9_-]+`),
    );
    assert.match(html, /\/share\/status\?id=/);
    assert.match(html, /已在 OpenGlance 中取消打开/);
    assert.match(html, /OpenGlance 无法完成打开/);
    assert.match(html, /<title>Company &amp; Strategy<\/title>/);
    assert.match(html, /<meta name="description" content="Goals, owners &amp; milestones for coworkers\.">/);
    assert.match(html, /<meta property="og:title" content="Company &amp; Strategy">/);
    assert.match(html, /<meta property="og:description" content="Goals, owners &amp; milestones for coworkers\.">/);
    assert.match(html, /<meta property="og:site_name" content="OpenGlance">/);
    assert.match(html, /<meta property="og:type" content="article">/);

    const deepLinkMatch = html.match(/href="(git-leaf:[^"]+)"/);
    assert.ok(deepLinkMatch);
    const deepLink = new URL(decodeHtml(deepLinkMatch[1]));
    assert.equal(deepLink.searchParams.has("title"), false);
    assert.equal(deepLink.searchParams.has("snippet"), false);
    const handoff = deepLink.searchParams.get("handoff");
    assert.match(handoff, /^[A-Za-z0-9_-]{20,64}$/);

    const received = await fetch(
      `http://127.0.0.1:${port}/share/state?id=${handoff}&state=received`,
      { method: "POST" },
    );
    assert.equal(received.status, 204);
    const receivedStatus = await fetch(`http://127.0.0.1:${port}/share/status?id=${handoff}`);
    assert.deepEqual(await receivedStatus.json(), { opened: false, state: "received" });

    const cancelled = await fetch(
      `http://127.0.0.1:${port}/share/state?id=${handoff}&state=cancelled`,
      { method: "POST" },
    );
    assert.equal(cancelled.status, 204);
    const cancelledStatus = await fetch(`http://127.0.0.1:${port}/share/status?id=${handoff}`);
    assert.deepEqual(await cancelledStatus.json(), { opened: false, state: "cancelled" });

    const confirmed = await fetch(`http://127.0.0.1:${port}/open/confirm?id=${handoff}`, {
      method: "POST",
    });
    assert.equal(confirmed.status, 204);
    const openedStatus = await fetch(`http://127.0.0.1:${port}/share/status?id=${handoff}`);
    assert.deepEqual(await openedStatus.json(), { opened: true, state: "opened" });

    const invalid = await fetch(
      `http://127.0.0.1:${port}/share?v=1&repo=owner%2Frepo&path=README.md&rev=short`,
    );
    assert.equal(invalid.status, 400);
    const oversized = await fetch(
      `http://127.0.0.1:${port}/share?v=1&repo=owner%2Frepo&path=README.md&rev=${rev}&title=${"x".repeat(101)}`,
    );
    assert.equal(oversized.status, 400);

    const legacyResponse = await fetch(
      `http://127.0.0.1:${port}/share?v=1&repo=owner%2Frepo&path=README.md&rev=${rev}`,
    );
    const legacyHtml = await legacyResponse.text();
    assert.equal(legacyResponse.status, 200);
    assert.match(legacyHtml, /<meta property="og:title" content="README.md">/);
    assert.match(legacyHtml, /<meta property="og:description" content="owner\/repo · README\.md">/);
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance open page also closes synchronously after a successful manual handoff", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-open-manual-"));
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    const response = await fetch(
      `http://127.0.0.1:${port}/open?repo=owner%2Frepo&path=README.md`,
    );
    const page = runOpenPageScript(await response.text());

    page.dispatchWindow("DOMContentLoaded");
    assert.equal(page.closeCalls, 0, "a failed automatic handoff must leave the page open");

    page.clickLaunchLink();
    await page.pollHandoff();
    assert.equal(page.closeCalls, 0, "clicking alone must not close an unconfirmed handoff");

    page.confirmHandoff();
    await page.pollHandoff();
    assert.equal(
      page.closeCalls,
      1,
      "a successful button-triggered handoff closes after app confirmation",
    );
  } finally {
    server.kill("SIGTERM");
  }
});

test("OpenGlance open page rejects unsafe repository and document parameters", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-open-invalid-"));
  const server = spawn("python3", [
    "scripts/openglance-update-server.py",
    "--root",
    root,
    "--bind",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: path.dirname(import.meta.dirname),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(server);
    for (const query of [
      "path=README.md",
      "repo=relative&path=README.md",
      "repo=owner%2Frepo&path=..%2Fsecret.md",
      "repo=owner%2Frepo&path=%2Fetc%2Fpasswd.md",
      "repo=owner%2Frepo&path=docs%2Freport.html",
      "repo=owner%2Frepo&path=README.md&worktree=main",
      "repo=%2Ftmp%2Frepo&path=README.md&worktree=0123456789abcdef",
      "worktree=0123456789abcdef",
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}/open?${query}`);
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  } finally {
    server.kill("SIGTERM");
  }
});

test("telemetry maintenance uses calendar-month retention without waiting for a collection write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-calendar-retention-"));
  const retainedPath = telemetryLogPath(root, "2023-03-01");
  const expiredPath = telemetryLogPath(root, "2023-02-28");
  await mkdir(path.dirname(retainedPath), { recursive: true });
  await mkdir(path.dirname(expiredPath), { recursive: true });
  await writeFile(retainedPath, "{\"retain\":true}\n");
  await writeFile(expiredPath, "{\"expire\":true}\n");

  await runPython(`
import importlib.util
from datetime import date
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("openglance_update_server", "scripts/openglance-update-server.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
store = module.TelemetryLogStore(Path(sys.argv[1]))
store.maintain(date(2024, 2, 29), force=True)
`, [root]);

  const files = await allTelemetryFiles(root);
  assert.ok(files.includes(`${retainedPath}.gz`), "365 days old is still inside twelve calendar months on leap day");
  assert.ok(!files.includes(retainedPath));
  assert.ok(!files.includes(expiredPath), "the calendar-month expiry boundary is removed");
  await assertPosixMode(`${retainedPath}.gz`, 0o640);
  await assertPosixMode(path.dirname(retainedPath), 0o750);
});

test("telemetry batch append rolls back a partial write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitleaf-atomic-append-"));
  const target = telemetryLogPath(root, "2026-07-12");
  const existingPayload = "{\"event\":\"existing\"}\n";
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, existingPayload);
  await runPython(`
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import os
import sys

spec = importlib.util.spec_from_file_location("openglance_update_server", "scripts/openglance-update-server.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
store = module.TelemetryLogStore(Path(sys.argv[1]))
received_at = datetime(2026, 7, 12, 8, 0, tzinfo=timezone.utc)
original_write = os.write
write_calls = 0

def partial_then_fail(descriptor, payload):
    global write_calls
    write_calls += 1
    if write_calls == 1:
        return original_write(descriptor, payload[:10])
    raise OSError("simulated write failure")

store.write_function = partial_then_fail
try:
    store.append([{"event": "new-one"}, {"event": "new-two"}], received_at)
except OSError:
    pass
else:
    raise AssertionError("simulated partial write must fail")
`, [root]);

  assert.equal(await readFile(target, "utf8"), existingPayload);
  await assertPosixMode(target, 0o640);
});

test("update service installer applies private telemetry permissions and a restrictive service umask", async () => {
  const installer = await readFile("scripts/install-openglance-update-server.sh", "utf8");

  assert.match(installer, /install -d -m 0750 '\$TELEMETRY_ROOT'/);
  assert.match(installer, /find '\$TELEMETRY_ROOT' -type d -exec chmod 0750/);
  assert.match(installer, /-type f -exec chmod 0640/);
  assert.match(installer, /install -m 0750 \/tmp\/openglance-update-server\.py/);
  assert.match(installer, /UMask=0027/);
});

test("Python cache generated by update server tests stays ignored", () => {
  const repoRoot = path.dirname(import.meta.dirname);
  const ignoredBy = execFileSync(
    "git",
    [
      "check-ignore",
      "--no-index",
      "-v",
      "scripts/__pycache__/openglance-update-server.cpython-311.pyc",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.match(ignoredBy, /^\.gitignore:/);
});

function telemetryDailyEvent() {
  return {
    schema_version: 1,
    event_id: "00000000-0000-4000-8000-000000000001",
    install_id: "00000000-0000-4000-8000-000000000002",
    event_name: "git_leaf.daily.summary",
    occurred_at: "2026-07-12T08:00:00.000Z",
    local_date: "2026-07-12",
    timezone_offset_minutes: 480,
    app: {
      version: "1.5.0",
      build_id: "release-1.5.0",
      channel: "stable",
      platform: "darwin",
      arch: "arm64",
      os_version_major: "15",
    },
    properties: {
      summary_id: "abcdef0123456789abcdef0123456789",
      revision: 1,
      launch_count: 2,
      launch_counts_by_entry_kind: { manual: 2 },
      active_minutes: 9,
      repository_open_count: 1,
      repository_switch_count: 0,
      distinct_repository_count: 1,
      rolling_30d_distinct_repository_count: 1,
      worktree_switch_count: 0,
      mode_minutes: { preview: 9, source: 0, live: 0 },
      feature_counts: [{ feature_id: "navigation.file_search", count: 3 }],
    },
  };
}

async function jsonlFiles(root) {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function allTelemetryFiles(root) {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function shiftedUtcDate(days) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function telemetryLogPath(root, date, collection = "events") {
  const [year, month, day] = date.split("-");
  return path.join(root, collection, year, month, `${day}.jsonl`);
}

function telemetryEventId(sequence) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function summaryIdFor(installId, summaryDate, length = 32) {
  return createHash("sha256")
    .update(`${installId}:${summaryDate}`)
    .digest("hex")
    .slice(0, length);
}

function telemetryUpdateEvent(sequence, appVersion, properties) {
  const event = telemetryDailyEvent();
  return {
    ...event,
    event_id: telemetryEventId(sequence),
    event_name: "git_leaf.update.state_changed",
    app: {
      ...event.app,
      version: appVersion,
      build_id: `release-${appVersion}`,
    },
    properties,
  };
}

function telemetryInstallationEvent(sequence, deviceName) {
  const event = telemetryDailyEvent();
  return {
    ...event,
    event_id: telemetryEventId(sequence),
    event_name: "git_leaf.installation.observed",
    properties: { reason: "first_observed", device_name: deviceName },
  };
}

function postTelemetry(port, events) {
  return fetch(`http://127.0.0.1:${port}/telemetry/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });
}

function runPython(source, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-B", "-c", source, ...args], {
      cwd: path.dirname(import.meta.dirname),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`python exited with ${code}: ${stderr}`));
    });
  });
}

async function assertPosixMode(target, expectedMode) {
  if (process.platform === "win32") return;
  assert.equal((await stat(target)).mode & 0o777, expectedMode);
}

function waitForServerPort(server) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    server.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    server.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/PORT=(\d+)/);
      if (match) {
        resolve(Number(match[1]));
      }
    });
    server.on("exit", (code) => {
      reject(new Error(`server exited with ${code}: ${stderr}`));
    });
  });
}

async function waitForValue(check, {
  timeoutMs = 2_000,
  intervalMs = 10,
  label = "the expected value",
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

function decodeHtml(value) {
  return String(value).replaceAll("&amp;", "&");
}

function runOpenPageScript(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "open page launch script is present");

  const windowListeners = new Map();
  const documentListeners = new Map();
  const launchLinkListeners = new Map();
  const location = { href: "" };
  const intervalCallbacks = new Set();
  const status = { textContent: "" };
  let handoffOpened = false;
  let closeCalls = 0;

  const window = {
    location,
    close() {
      closeCalls += 1;
    },
    setTimeout() {
      // A hidden browser page may freeze before delayed callbacks run.
    },
    setInterval(callback) {
      intervalCallbacks.add(callback);
      return callback;
    },
    clearInterval(callback) {
      intervalCallbacks.delete(callback);
    },
    async fetch() {
      return {
        ok: true,
        async json() {
          return { opened: handoffOpened };
        },
      };
    },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  const document = {
    hidden: false,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    querySelector(selector) {
      if (selector === "#launch-link") {
        return {
          addEventListener(type, listener) {
            launchLinkListeners.set(type, listener);
          },
        };
      }
      if (selector === "#handoff-status") {
        return status;
      }
      return null;
    },
  };

  vm.runInNewContext(script, { Date, document, window });

  return {
    location,
    get closeCalls() {
      return closeCalls;
    },
    dispatchWindow(type) {
      windowListeners.get(type)?.();
    },
    clickLaunchLink() {
      launchLinkListeners.get("click")?.();
    },
    confirmHandoff() {
      handoffOpened = true;
    },
    async pollHandoff() {
      await Promise.all([...intervalCallbacks].map((callback) => callback()));
    },
    setHidden(hidden) {
      document.hidden = hidden;
      documentListeners.get("visibilitychange")?.();
    },
  };
}
