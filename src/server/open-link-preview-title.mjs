import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { extractDocumentTitle } from "../content/markdown.mjs";

// Metadata is optional. Never follow a document symlink outside the selected repository,
// and read only a bounded prefix rather than loading arbitrary files into a shared URL.
export async function readOpenLinkPreviewTitle(repoRoot, file) {
  let handle;
  try {
    const root = await realpath(repoRoot);
    const target = await realpath(path.resolve(root, file));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return "";
    handle = await open(target, "r");
    if (!(await handle.stat()).isFile()) return "";
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return extractDocumentTitle(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return "";
  } finally {
    await handle?.close();
  }
}
