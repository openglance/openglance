import path from "node:path";
import { extractDocumentTitle } from "../content/markdown.mjs";

const MAX_DOCUMENTS = 40;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const MAX_DETAILS = 8;

// Read object IDs from the staged diff, never from the moving working directory.
export async function createSyncCommitMessage({ repo, files, changes = [], note = "", locale, gitRunner }) {
  const text = String(note).trim();
  if (text) {
    const [firstLine, ...rest] = text.split(/\r?\n/);
    const subject = shorten(firstLine, 72);
    return {
      subject,
      body: [subject === firstLine ? "" : firstLine, rest.join("\n").trim()].filter(Boolean).join("\n\n"),
    };
  }

  let entries = files.map((file) => ({
    path: file,
    status: changes.find((change) => change.path === file)?.status || "modified",
  }));
  try {
    const diff = await gitRunner(repo.root, [
      "diff", "--cached", "--raw", "--no-abbrev", "--find-renames", "-z", "--",
      ...files.map((file) => `:(literal)${file}`),
    ]);
    const staged = stagedEntries(diff.stdout);
    if (staged.length) entries = staged;
  } catch {
    // Descriptive metadata must not make an otherwise valid publication fail.
  }

  let documentsRead = 0;
  for (const entry of entries) {
    entry.title = path.posix.basename(entry.path);
    entry.summaries = [];
    if (!/\.mdx?$/i.test(entry.path) || documentsRead >= MAX_DOCUMENTS) continue;
    documentsRead += 1;
    const before = await readDocumentBlob(entry.oldOid, entry.oldMode);
    const after = await readDocumentBlob(entry.newOid, entry.newMode);
    entry.title = extractDocumentTitle(after || before || "") || entry.title;
    // New files can carry years of copied history. Without a prior document,
    // no changelog entry can be established as belonging to this edit.
    if (before != null && after != null) {
      const oldSummaries = new Set(changeLogSummaries(before));
      entry.summaries = [...new Set(changeLogSummaries(after))]
        .filter((summary) => !oldSummaries.has(summary));
    }
  }
  return automaticMessage(entries, locale);

  async function readDocumentBlob(oid, mode) {
    if (!/^[a-f0-9]{40,64}$/.test(oid || "") || /^0+$/.test(oid) || !/^100(644|755)$/.test(mode || "")) return null;
    try {
      const size = Number((await gitRunner(repo.root, ["cat-file", "-s", oid])).stdout.trim());
      if (!Number.isFinite(size) || size > MAX_DOCUMENT_BYTES || size < 0) return null;
      const source = (await gitRunner(repo.root, ["cat-file", "blob", oid])).stdout;
      return source.includes("\0") ? null : source;
    } catch {
      return null;
    }
  }
}

function stagedEntries(raw) {
  const parts = String(raw).split("\0");
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    const match = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/.exec(parts[index]);
    if (!match) continue;
    const [, oldMode, newMode, oldOid, newOid, code] = match;
    const firstPath = parts[++index];
    const file = code === "R" || code === "C" ? parts[++index] : firstPath;
    if (!file) continue;
    entries.push({
      path: file, oldMode, newMode, oldOid, newOid,
      status: ({ A: "added", D: "deleted", R: "renamed", C: "added" })[code] || "modified",
    });
  }
  return entries;
}

function changeLogSummaries(source) {
  const frontmatter = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)?.[1];
  if (!frontmatter) return [];
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^change_log:\s*(?:#.*)?$/.test(line));
  if (start < 0) return [];
  const summaries = [];
  let entryIndent = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#-]/.test(line)) break;
    const entry = /^( *)-\s+/.exec(line);
    if (entry && entryIndent == null) entryIndent = entry[1].length;
    if (entryIndent == null) continue;
    const field = /^( *)(-\s+)?summary:\s*(.*?)\s*$/.exec(line);
    if (!field || field[1].length !== entryIndent + (field[2] ? 0 : 2)) continue;
    let value = field[3];
    if (/^[|>][+-]?$/.test(value)) {
      const continuation = [];
      const fieldIndent = entryIndent + 2;
      while (index + 1 < lines.length && (/^\s*$/.test(lines[index + 1]) || lines[index + 1].search(/\S/) > fieldIndent)) {
        continuation.push(lines[++index].trim());
      }
      value = continuation.join(" ");
    } else if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { continue; }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replaceAll("''", "'");
    } else {
      value = value.replace(/\s+#.*$/, "");
      if (/^[&*!{\[]/.test(value)) continue;
    }
    const summary = singleLine(value);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

function automaticMessage(entries, locale) {
  const zh = locale === "zh-CN";
  const verbs = zh
    ? { added: "新增", modified: "更新", deleted: "删除", renamed: "重命名" }
    : { added: "Add", modified: "Update", deleted: "Delete", renamed: "Rename" };
  const counts = new Map();
  for (const entry of entries) {
    const status = entry.status === "untracked" || entry.status === "copied" ? "added" : entry.status;
    entry.verb = verbs[status] || verbs.modified;
    counts.set(entry.verb, (counts.get(entry.verb) || 0) + 1);
  }
  const totals = [...counts].map(([verb, count]) => zh
    ? `${verb} ${count} 个文件`
    : `${verb} ${count} ${count === 1 ? "file" : "files"}`).join(zh ? "，" : "; ");
  const first = entries[0];
  const directories = entries.map((entry) => path.posix.dirname(entry.path).split("/"));
  const shared = [...(directories[0] || [])];
  for (const directory of directories.slice(1)) {
    while (shared.length && !shared.every((part, index) => part === directory[index])) shared.pop();
  }
  const scope = shared.length && shared[0] !== "." ? singleLine(shared.at(-1)) : "";
  const subject = entries.length === 1
    ? first.summaries[0] || `${first.verb} ${singleLine(first.title)}`
    : `${scope ? `${scope}: ` : ""}${totals}`;
  const details = entries.slice(0, MAX_DETAILS).map((entry) => {
    const label = shorten(singleLine(entry.title), 100);
    return entry.summaries.length
      ? `- ${label}: ${entry.summaries.slice(0, 3).map((summary) => shorten(summary, 240)).join(zh ? "；" : "; ")}`
      : `- ${entry.verb} ${label}`;
  });
  if (entries.length > MAX_DETAILS) details.push(zh
    ? `- 另有 ${entries.length - MAX_DETAILS} 个文件`
    : `- ${entries.length - MAX_DETAILS} more files`);
  return { subject: shorten(subject || (zh ? "更新文件" : "Update files"), 72), body: details.join("\n") };
}

function singleLine(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

function shorten(text, length) {
  const characters = [...text];
  return characters.length <= length ? text : `${characters.slice(0, length - 1).join("")}…`;
}
