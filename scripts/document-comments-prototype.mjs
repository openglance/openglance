#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locateAnchor, locateRevision } from "./document-comments/format.mjs";
import { applyCommentOperation, inspectDocument } from "./document-comments/store.mjs";

export function inspectionResult(parsed) {
  return {
    source_hash: parsed.sourceHash, body_hash: parsed.bodyHash, safe_append: parsed.safeAppend,
    body: parsed.body, diagnostics: parsed.diagnostics,
    threads: parsed.records.filter((record) => record.valid).map((record) => record.data),
    locations: parsed.records.filter((record) => record.valid).map((record) => ({
      thread_id: record.data.id, anchor: locateAnchor(parsed.body, record.data.anchor),
      revisions: record.data.messages.map((message) => ({ id: message.id, ...locateRevision(parsed, message) })),
    })),
  };
}

export async function runPrototype(args, { stdin = process.stdin } = {}) {
  const [command, ...flags] = args;
  if (command === "--help" || command === "help") return {
    usage: "node scripts/document-comments-prototype.mjs inspect|apply --repo <worktree-root> --file <relative.md> [--expected-hash sha256:...]",
    apply: "Read one JSON operation from stdin: create, reply, revise, locate, set-status, or delete.",
    boundary: "Shares the App comment format and guarded writer. Inspect before every write. No commits or pushes.",
  };
  const options = {};
  for (let index = 0; index < flags.length; index += 2) {
    if (!["--repo", "--file", "--expected-hash"].includes(flags[index]) || !flags[index + 1]) throw new Error("Invalid arguments; use --help.");
    options[flags[index]] = flags[index + 1];
  }
  if (!options["--repo"] || !options["--file"]) throw new Error("--repo and --file are required.");
  const target = { repoRoot: options["--repo"], file: options["--file"] };
  if (command === "inspect") return inspectionResult(await inspectDocument(target));
  if (command !== "apply") throw new Error("Unknown command; use --help.");
  // Bound stdin as well as parsed fields; malformed input cannot allocate an unbounded operation.
  let input = "";
  for await (const chunk of stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 512 * 1024) throw new Error("Operation input exceeds 512 KiB.");
  }
  const result = await applyCommentOperation({ ...target, expectedHash: options["--expected-hash"], operation: JSON.parse(input) });
  return inspectionResult(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runPrototype(process.argv.slice(2)), null, 2)); }
  catch (error) {
    console.error(JSON.stringify({ error: error.code ?? "invalid_request", message: error.message }));
    process.exitCode = 1;
  }
}
