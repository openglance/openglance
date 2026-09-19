#!/usr/bin/env node

import { createOpenGlanceOpenLink } from "../src/server/openglance-open-link.mjs";
import { findRepoRoot } from "../src/server/paths.mjs";

function parseArguments(args) {
  const options = { repoRoot: process.cwd(), file: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo-root") {
      options.repoRoot = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--repo-root=")) {
      options.repoRoot = arg.slice("--repo-root=".length);
    } else if (arg === "--file") {
      options.file = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg === "--no-preview-title") {
      options.previewTitle = false;
    } else if (["--help", "-h"].includes(arg)) {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-open-link.mjs --file <repo-relative.md> [--repo-root <path>]

Creates a portable repository link from the primary worktree, or a local-exact link containing
the worktree id when the selected repository root is a linked worktree.
Includes the document title for external previews. Use --no-preview-title to omit it.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.file) {
    throw new Error("--file is required.");
  }
  const repoRoot = await findRepoRoot(options.repoRoot);
  console.log(await createOpenGlanceOpenLink({ ...options, repoRoot }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
