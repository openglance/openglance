#!/usr/bin/env node
// Read-only HTTP workload, run in a fresh Node process for each source revision.
// Counts include the local service and client harness, but exclude Git child CPU.
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  repo: { type: "string" },
  file: { type: "string", default: "README.md" },
  "source-root": { type: "string", default: path.dirname(path.dirname(fileURLToPath(import.meta.url))) },
  "duration-ms": { type: "string", default: "16000" },
} });
if (!values.repo) throw new Error("Usage: node scripts/benchmark-idle-refresh.mjs --repo <local-repo> [--file README.md] [--source-root <revision-checkout>]");
const duration = Number(values["duration-ms"]);
if (!Number.isFinite(duration) || duration < 1000 || duration > 60_000) throw new Error("duration-ms must be 1000–60000");
const counts = { lstat: 0, stat: 0, readFile: 0, git: 0, discoveries: 0 };
for (const method of ["lstat", "stat", "readFile"]) {
  const original = fs.promises[method];
  fs.promises[method] = function (...args) { counts[method]++; return original.apply(this, args); };
}
const originalExec = childProcess.execFile;
childProcess.execFile = function (command, args, ...rest) {
  if (command === "git") {
    counts.git++;
    if (args[0] === "ls-files" && args.includes("--cached")) counts.discoveries++;
  }
  return originalExec.call(this, command, args, ...rest);
};
syncBuiltinESMExports();
const source = (file) => pathToFileURL(path.join(values["source-root"], file)).href;
const { createPreviewServer } = await import(source("src/server/index.mjs"));
const { createRepositoryInfo } = await import(source("src/server/repositories.mjs"));
const repoRoot = path.resolve(values.repo);
const repository = await createRepositoryInfo({ repoRoot });
const server = createPreviewServer({ repoRoot, repository });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let requests = {};
async function get(endpoint) {
  const pathname = new URL(endpoint, baseUrl).pathname;
  requests[pathname] = (requests[pathname] ?? 0) + 1;
  const response = await fetch(baseUrl + endpoint);
  if (!response.ok) throw new Error(`${pathname}: ${response.status}`);
  return response.json();
}
function start() {
  requests = {};
  return { counts: { ...counts }, cpu: process.cpuUsage(), wall: performance.now() };
}
function end(phase, before) {
  const cpu = process.cpuUsage(before.cpu);
  console.log(JSON.stringify({ phase, wallMs: performance.now() - before.wall,
    cpuMs: (cpu.user + cpu.system) / 1000,
    counts: Object.fromEntries(Object.keys(counts).map(k => [k, counts[k] - before.counts[k]])), requests }));
}
try {
  let before = start();
  await get("/api/tree");
  end("cold-tree", before);
  before = start();
  for (let i = 0; i < 3; i++) await get("/api/tree");
  end("three-warm-tree-requests", before);
  before = start();
  const pending = [];
  const enqueue = (task) => pending.push(task.catch(error => ({ error })));
  const treeTimer = setInterval(() => enqueue((async () => {
    await get("/api/worktrees");
    await get("/api/tree");
    await get("/api/git-status");
  })()), 5000);
  const statusTimer = setInterval(() => enqueue(get(`/api/document-status?file=${encodeURIComponent(values.file)}`)), 2000);
  await delay(duration);
  clearInterval(treeTimer);
  clearInterval(statusTimer);
  for (const result of await Promise.all(pending)) if (result?.error) throw result.error;
  end(`${duration}ms-visible-cadence`, before);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
