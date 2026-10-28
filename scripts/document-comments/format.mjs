// Experimental format. Not loaded by the App or its Markdown renderer.
import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import { HTML_TAG_RE } from "markdown-it/lib/common/html_re.mjs";
import fenceRule from "markdown-it/lib/rules_block/fence.mjs";

export const LIMITS = Object.freeze({
  documentBytes: 4 * 1024 * 1024,
  recordBytes: 256 * 1024,
  messageBytes: 64 * 1024,
  selectorBytes: 16 * 1024,
  records: 512,
  messages: 256,
  contextCodePoints: 64,
});
const MARKER = "<!-- openglance-comment:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const VOID_TAGS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW_TAGS = new Set(["script", "style", "textarea", "pre"]);
const markdown = new MarkdownIt("commonmark", { html: true });
markdown.block.ruler.at("fence", (state, startLine, endLine, silent) => {
  const accepted = fenceRule(state, startLine, endLine, silent);
  if (accepted && !silent) {
    const token = state.tokens.at(-1);
    const lastLine = token.map[1] - 1;
    // Read while the parser's list/blockquote offsets are still active.
    const last = state.src.slice(state.bMarks[lastLine] + state.tShift[lastLine], state.eMarks[lastLine]);
    const close = new RegExp(`^${token.markup[0]}{${token.markup.length},}[ \\t]*$`);
    token.meta = { closed: lastLine > startLine && close.test(last) };
  }
  return accepted;
});

export class CommentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireValue(condition, code, message) {
  if (!condition) throw new CommentError(code, message);
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function boundedText(value, max, { empty = false } = {}) {
  return typeof value === "string" && value.isWellFormed()
    && (empty || value.length > 0) && Buffer.byteLength(value) <= max;
}
function utcTime(value) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function author(value) {
  return object(value) && boundedText(value.name, 256) && ["human", "agent"].includes(value.kind);
}
function selector(value) {
  return object(value) && boundedText(value.exact, LIMITS.selectorBytes)
    && [value.prefix, value.suffix].every((text) => boundedText(text, LIMITS.selectorBytes, { empty: true })
      && Array.from(text).length <= LIMITS.contextCodePoints);
}
export function validateMessage(message) {
  requireValue(object(message) && UUID.test(message.id) && author(message.author)
    && utcTime(message.created_at) && boundedText(message.body, LIMITS.messageBytes),
  "invalid_message", "A message needs a UUID, author, UTC timestamp, and bounded Markdown body.");
  if (message.revision_target !== undefined) {
    requireValue(message.author.kind === "agent" && object(message.revision_target)
      && HASH.test(message.revision_target.body_hash) && selector(message.revision_target.anchor),
    "invalid_revision_target", "An agent revision target needs a body hash and source selector.");
  }
}
export function validateThread(thread) {
  requireValue(object(thread) && UUID.test(thread.id) && ["open", "resolved"].includes(thread.status)
    && selector(thread.anchor) && Array.isArray(thread.messages) && thread.messages.length > 0
    && thread.messages.length <= LIMITS.messages,
  "invalid_thread", "A thread needs a UUID, status, selector, and bounded nonempty messages.");
  const ids = new Set();
  for (const message of thread.messages) {
    validateMessage(message);
    requireValue(!ids.has(message.id), "duplicate_message", "Message IDs must be unique within a thread.");
    ids.add(message.id);
  }
  if (thread.anchor_history !== undefined) {
    requireValue(Array.isArray(thread.anchor_history) && thread.anchor_history.length <= LIMITS.messages,
      "invalid_history", "Anchor history must be a bounded array.");
    for (const item of thread.anchor_history) {
      requireValue(object(item) && selector(item.anchor) && author(item.author) && utcTime(item.created_at)
        && (item.reply_id === undefined || thread.messages.some((message) => message.id === item.reply_id)),
      "invalid_history", "An anchor history entry needs the previous selector and change attribution.");
    }
  }
}

export function physicalLines(source) {
  const lines = [];
  let offset = 0;
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (match[0] === "") break;
    lines.push({ text: match[1], eol: match[2], from: offset, to: offset + match[0].length });
    offset += match[0].length;
  }
  return lines;
}

function trackHtml(content, stack) {
  const tags = new RegExp(HTML_TAG_RE.source.slice(1), "g");
  for (const match of content.matchAll(tags)) {
    const tag = /^<(\/)?([a-z][\w-]*)\b/i.exec(match[0]);
    if (!tag) continue;
    const name = tag[2].toLowerCase();
    if (RAW_TAGS.has(stack.at(-1))) {
      if (tag[1] && name === stack.at(-1)) stack.pop();
    } else if (tag[1]) {
      // Conservative XML-style balancing; do not guess HTML's implicit closing rules.
      if (name === stack.at(-1)) stack.pop();
    } else if (!VOID_TAGS.has(name) && !/\/>$/.test(match[0])) {
      stack.push(name);
    }
  }
}

function parsePayload(payload) {
  let data;
  try { data = JSON.parse(payload); }
  catch { throw new CommentError("invalid_json", "Record payload is not JSON."); }
  // JSON.parse silently accepts duplicate keys. Such a record must remain opaque to edits.
  const stack = [];
  for (const match of payload.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g)) {
    const token = match[0];
    if (token === "{") stack.push({ keys: new Set(), nextKey: true });
    else if (token === "[") stack.push({});
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && stack.at(-1)?.keys) stack.at(-1).nextKey = true;
    else if (token.startsWith('"') && stack.at(-1)?.nextKey) {
      const frame = stack.at(-1);
      const key = JSON.parse(token);
      requireValue(!frame.keys.has(key), "duplicate_key", "Duplicate JSON object keys require repair.");
      frame.keys.add(key);
      frame.nextKey = false;
    }
  }
  return data;
}

export function parseComments(source) {
  requireValue(boundedText(source, LIMITS.documentBytes, { empty: true }),
    "document_limit", "Expected well-formed UTF-8 text within the prototype document limit.");
  const lines = physicalLines(source);
  const diagnostics = [];
  const records = [];
  const htmlStack = [];
  let unsafe = false;
  let frontmatterEnd = 0;
  if (lines[0]?.text.replace(/^\uFEFF/, "") === "---") {
    const closing = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line.text));
    frontmatterEnd = closing < 0 ? lines.length : closing + 1;
    if (closing < 0) unsafe = true;
  }
  const parseSource = lines.map((line, index) => `${index < frontmatterEnd ? "" : line.text}\n`).join("");
  const tokens = markdown.parse(parseSource, {});
  for (const token of tokens) {
    if (token.type === "fence" && token.map[1] === lines.length && !token.meta.closed) unsafe = true;
    if (token.type === "inline" && token.level === 1) {
      for (const child of token.children ?? []) {
        if (child.type === "html_inline") trackHtml(child.content, htmlStack);
      }
    }
    if (token.type !== "html_block" || token.level !== 0) continue;
    const [startLine, endLine] = token.map;
    const first = lines[startLine]?.text ?? "";
    if (htmlStack.length === 0 && first.startsWith(MARKER)) {
      const from = lines[startLine].from;
      const to = lines[endLine - 1].to;
      const last = lines[endLine - 1].text;
      const complete = endLine - startLine >= 2 && last === "-->";
      if (!complete) {
        diagnostics.push({ code: "invalid_envelope", line: startLine + 1 });
        if (!/-->|--!>/.test(token.content)) unsafe = true;
        continue;
      }
      const record = { from, to, line: startLine + 1, raw: source.slice(from, to), version: first.slice(MARKER.length) };
      records.push(record);
      try {
        requireValue(Buffer.byteLength(record.raw) <= LIMITS.recordBytes, "record_limit", "Record exceeds size limit.");
        const payload = source.slice(lines[startLine].to, lines[endLine - 1].from);
        requireValue(!/[<>]/.test(payload), "unsafe_payload", "Literal angle brackets must be JSON Unicode escapes.");
        record.data = parsePayload(payload);
        requireValue(record.version === "v1", "unknown_version", "Unsupported record version.");
        validateThread(record.data);
        record.valid = true;
      } catch (error) {
        record.valid = false;
        diagnostics.push({ code: error.code ?? "invalid_thread", line: record.line });
      }
      continue;
    }
    if (/^\s*<!--/.test(token.content) && !/-->|--!>/.test(token.content)) unsafe = true;
    if (/^\s*<\?/.test(token.content) && !token.content.includes("?>")) unsafe = true;
    if (/^\s*<!\[CDATA\[/.test(token.content) && !token.content.includes("]]>")) unsafe = true;
    trackHtml(token.content, htmlStack);
  }
  requireValue(records.length <= LIMITS.records, "record_count", "Too many records in this document.");
  const threadIds = new Map();
  for (const record of records) {
    if (!UUID.test(record.data?.id)) continue;
    const same = threadIds.get(record.data.id) ?? [];
    same.push(record);
    threadIds.set(record.data.id, same);
  }
  for (const same of threadIds.values()) {
    if (same.length < 2) continue;
    for (const record of same) {
      record.valid = false;
      diagnostics.push({ code: "duplicate_thread", line: record.line });
    }
  }
  const sourceStarts = [];
  const sourceEnds = [];
  let body = "";
  let recordIndex = 0;
  for (let offset = 0; offset < source.length;) {
    if (records[recordIndex]?.from === offset) {
      offset = records[recordIndex++].to;
      continue;
    }
    const start = offset;
    let character = source[offset++];
    if (character === "\r") {
      if (source[offset] === "\n") offset += 1;
      character = "\n";
    }
    body += character;
    sourceStarts.push(start);
    sourceEnds.push(offset);
  }
  return {
    source, records, diagnostics, body, sourceStarts, sourceEnds,
    safeAppend: !unsafe && htmlStack.length === 0,
    sourceHash: hashText(source),
    bodyHash: hashText(body.replace(/\n+$/, "")),
  };
}

export function hashText(source) {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

export function captureAnchor(body, from, to) {
  requireValue(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from && to <= body.length,
    "invalid_range", "Selection must be an actual nonempty range in the projected source.");
  const anchor = {
    exact: body.slice(from, to),
    prefix: Array.from(body.slice(0, from)).slice(-LIMITS.contextCodePoints).join(""),
    suffix: Array.from(body.slice(to)).slice(0, LIMITS.contextCodePoints).join(""),
  };
  requireValue(selector(anchor), "invalid_selector", "Selection exceeds limits or splits a Unicode character.");
  return anchor;
}

export function locateAnchor(body, anchor) {
  requireValue(selector(anchor), "invalid_selector", "Invalid selector.");
  const candidates = [];
  for (let from = body.indexOf(anchor.exact); from !== -1; from = body.indexOf(anchor.exact, from + 1)) {
    const to = from + anchor.exact.length;
    const prefix = anchor.prefix !== "" && body.slice(0, from).endsWith(anchor.prefix);
    const suffix = anchor.suffix !== "" && body.slice(to).startsWith(anchor.suffix);
    candidates.push({ from, to, prefix, suffix });
  }
  if (!candidates.length) return { state: "missing" };
  const both = candidates.filter((candidate) => candidate.prefix && candidate.suffix);
  const supported = candidates.filter((candidate) => candidate.prefix || candidate.suffix);
  const chosen = both.length ? both : supported;
  if (chosen.length === 1) return { state: "located", from: chosen[0].from, to: chosen[0].to };
  if (!chosen.length && candidates.length === 1 && !anchor.prefix && !anchor.suffix) {
    return { state: "located", from: candidates[0].from, to: candidates[0].to };
  }
  return { state: "needs_location" };
}

export function locateRevision(parsed, message) {
  if (!message.revision_target) return { state: "absent" };
  if (message.revision_target.body_hash !== parsed.bodyHash) return { state: "stale" };
  return locateAnchor(parsed.body, message.revision_target.anchor);
}

export function serializeThread(thread, eol = "\n") {
  validateThread(thread);
  const json = JSON.stringify(thread, null, 2).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  const record = `<!-- openglance-comment:v1\n${json}\n-->\n`.replaceAll("\n", eol);
  requireValue(Buffer.byteLength(record) <= LIMITS.recordBytes, "record_limit", "Record exceeds size limit.");
  return record;
}

function targetRecord(parsed, id) {
  const matches = parsed.records.filter((record) => record.data?.id === id);
  requireValue(matches.length === 1 && matches[0].valid, "invalid_target", "Thread is missing, invalid, or duplicated.");
  return matches[0];
}
function replaceRecord(parsed, record, data) {
  const eol = physicalLines(record.raw)[0].eol || "\n";
  let replacement = serializeThread(data, eol);
  if (!/[\r\n]$/.test(record.raw)) replacement = replacement.slice(0, -eol.length);
  return parsed.source.slice(0, record.from) + replacement + parsed.source.slice(record.to);
}

export function mutateComments(source, operation) {
  const parsed = parseComments(source);
  requireValue(object(operation), "invalid_operation", "Expected an operation object.");
  if (operation.type === "create") {
    validateThread(operation.thread);
    requireValue(!parsed.records.some((record) => record.data?.id === operation.thread.id),
      "duplicate_thread", "Thread ID already exists.");
    requireValue(parsed.safeAppend, "unsafe_eof", "EOF is inside an unclosed Markdown or HTML container; keep the draft.");
    const eol = physicalLines(source).find((line) => line.eol)?.eol || "\n";
    const separator = !source || /(?:\r\n|\r|\n){2}$/.test(source) ? ""
      : /[\r\n]$/.test(source) ? eol : eol + eol;
    const result = source + separator + serializeThread(operation.thread, eol);
    const inserted = parseComments(result).records.find((record) => record.data?.id === operation.thread.id);
    requireValue(inserted?.valid && inserted.from === source.length + separator.length,
      "unsafe_eof", "The appended record is not structurally independent; retain the draft.");
    return result;
  }
  const record = targetRecord(parsed, operation.thread_id);
  if (operation.type === "delete") return source.slice(0, record.from) + source.slice(record.to);
  const data = structuredClone(record.data);
  if (operation.type === "reply") {
    validateMessage(operation.message);
    data.messages.push(operation.message);
  } else if (operation.type === "set-status") {
    requireValue(["open", "resolved"].includes(operation.status), "invalid_status", "Expected open or resolved.");
    data.status = operation.status;
  } else if (operation.type === "locate") {
    requireValue(author(operation.author) && utcTime(operation.created_at), "invalid_history", "Location changes need attribution.");
    const anchor = captureAnchor(parsed.body, operation.from, operation.to);
    data.anchor_history ??= [];
    data.anchor_history.push({ anchor: data.anchor, author: operation.author, created_at: operation.created_at,
      ...(operation.reply_id ? { reply_id: operation.reply_id } : {}) });
    data.anchor = anchor;
  } else if (operation.type === "revise") {
    captureAnchor(parsed.body, operation.from, operation.to);
    requireValue(parsed.body.slice(operation.from, operation.to) === operation.expected_text,
      "stale_selection", "Selected text has changed.");
    requireValue(boundedText(operation.insert, LIMITS.messageBytes), "invalid_replacement", "Expected bounded replacement text.");
    for (let index = operation.from + 1; index < operation.to; index += 1) {
      requireValue(parsed.sourceStarts[index] === parsed.sourceEnds[index - 1], "cross_record_selection", "Selection crosses a stored record.");
    }
    const edited = source.slice(0, parsed.sourceStarts[operation.from]) + operation.insert
      + source.slice(parsed.sourceEnds[operation.to - 1]);
    const revised = parseComments(edited);
    const message = structuredClone(operation.message);
    requireValue(object(message), "invalid_message", "Expected an agent reply.");
    message.revision_target = { body_hash: revised.bodyHash,
      anchor: captureAnchor(revised.body, operation.from, operation.from + operation.insert.replace(/\r\n?/g, "\n").length) };
    return mutateComments(edited, { type: "reply", thread_id: operation.thread_id, message });
  } else {
    throw new CommentError("invalid_operation", "Unsupported comment operation.");
  }
  return replaceRecord(parsed, record, data);
}
