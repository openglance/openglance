import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import MarkdownIt from "markdown-it";
import { renderMarkdown } from "../src/content/markdown.mjs";
import {
  LIMITS, captureAnchor, hashText, locateAnchor, locateRevision, mutateComments, parseComments, serializeThread,
} from "../scripts/document-comments/format.mjs";

const body = "# Launch plan\n\nWe plan to launch next month.\n";
const human = { name: "Reviewer", kind: "human" };
const agent = { name: "Agent", kind: "agent" };
const timestamp = "2026-10-28T04:00:00Z";
function message(text = "Please name the date.", author = human) {
  return { id: randomUUID(), author, created_at: timestamp, body: text };
}
function thread(text = body, exact = "next month") {
  const from = text.indexOf(exact);
  return { id: randomUUID(), status: "open", anchor: captureAnchor(text, from, from + exact.length), messages: [message()] };
}
function create(source = body, data = thread()) {
  return mutateComments(source, { type: "create", thread: data });
}

test("agent replies preserve ordinary bytes, CRLF, unknown fields, and unrelated record bytes", () => {
  const source = body.replaceAll("\n", "\r\n");
  const first = thread();
  first.extension = { nested: ["未知", 42] };
  first.messages[0].extension = "keep";
  const second = thread();
  let document = create(source, first);
  document = create(document, second) + "\r\n## Later\r\n正文 😀\r\n";
  const before = parseComments(document);
  const after = parseComments(mutateComments(document, { type: "reply", thread_id: first.id, message: message("Done.", agent) }));
  assert.deepEqual(after.records[0].data.extension, first.extension);
  assert.equal(after.records[0].data.messages[0].extension, "keep");
  assert.equal(after.records[1].raw, before.records[1].raw);
  assert.equal(after.source.slice(0, after.records[0].from), document.slice(0, before.records[0].from));
  assert.equal(after.source.slice(after.records[0].to), document.slice(before.records[0].to));
  assert(!/(?<!\r)\n/.test(after.source));
  assert.equal(after.bodyHash, before.bodyHash);
});

test("a thread remains readable and editable before an appended ordinary section", () => {
  const data = thread();
  const document = create(body, data) + "\n## Rollback\n\nReturn to the previous release.\n";
  const result = mutateComments(document, { type: "set-status", thread_id: data.id, status: "resolved" });
  assert.equal(parseComments(result).records[0].data.status, "resolved");
  assert(result.endsWith("\n## Rollback\n\nReturn to the previous release.\n"));
});

test("future and malformed records remain byte-exact while a neighboring supported thread changes", () => {
  const data = thread();
  const future = "<!-- openglance-comment:v99\n{\"unknown\":true}\n-->\n";
  const malformed = "<!-- openglance-comment:v1\n{not json}\n-->\n";
  const document = body + "\n" + future + malformed + serializeThread(data);
  const before = parseComments(document);
  assert.deepEqual(before.diagnostics.map((item) => item.code), ["unknown_version", "invalid_json"]);
  const after = parseComments(mutateComments(document, { type: "reply", thread_id: data.id, message: message() }));
  assert.equal(after.records[0].raw, future);
  assert.equal(after.records[1].raw, malformed);
  assert.equal(after.bodyHash, before.bodyHash);
  assert.equal(after.records[2].data.messages.length, 2);
});

test("duplicate thread or message identity produces diagnostics and refuses ambiguous mutation", () => {
  const data = thread();
  const duplicate = body + serializeThread(data) + serializeThread(data);
  assert.equal(parseComments(duplicate).records.filter((record) => record.valid).length, 0);
  assert.throws(() => mutateComments(duplicate, { type: "delete", thread_id: data.id }), { code: "invalid_target" });
  const one = create(body, data);
  assert.throws(() => mutateComments(one, { type: "reply", thread_id: data.id, message: data.messages[0] }), { code: "duplicate_message" });
});

test("duplicate JSON keys remain opaque instead of being silently collapsed during a reply", () => {
  const data = thread();
  const raw = serializeThread(data).replace('"status": "open"', '"status": "open", "status": "resolved"');
  const parsed = parseComments(raw);
  assert.equal(parsed.records[0].raw, raw);
  assert.deepEqual(parsed.diagnostics.map((item) => item.code), ["duplicate_key"]);
  assert.throws(() => mutateComments(raw, { type: "reply", thread_id: data.id, message: message() }), { code: "invalid_target" });
});

test("markers in code, quoted/list examples, frontmatter, ordinary comments, and HTML containers remain content", () => {
  const marker = serializeThread(thread());
  const examples = [
    `\`\`\`markdown\n${marker}\`\`\`\n`,
    marker.split("\n").map((line) => `    ${line}`).join("\n"),
    `\`${marker.trim()}\`\n`,
    marker.split("\n").map((line) => `> ${line}`).join("\n"),
    "- Example\n\n" + marker.split("\n").map((line) => `  ${line}`).join("\n"),
    `---\nexample: |\n${marker.split("\n").map((line) => `  ${line}`).join("\n")}\n---\n`,
    `\uFEFF---\n${marker}---\n`,
    `<!-- ordinary example\n${marker}-->\n`,
    `<div>\n\n${marker}\n</div>\n`,
    `<div title=\"a > b\">\n\n${marker}\n</div>\n`,
    `<pre>\n${marker}</pre>\n`,
  ];
  for (const example of examples) {
    const parsed = parseComments(example);
    assert.equal(parsed.records.length, 0, example);
    assert.equal(parsed.body, example.replace(/\r\n?/g, "\n"));
  }
});

test("unsafe EOF rejects a new comment while leaving the complete draft and source untouched", () => {
  for (const source of ["```md\nunclosed\n", "~~~\nunclosed", "<div>\n\nbody\n", "<!-- ordinary\n", "---\nunclosed: true\n", "body <span>\n"]) {
    const draft = thread();
    const copy = structuredClone(draft);
    assert.equal(parseComments(source).safeAppend, false, source);
    assert.throws(() => create(source, draft), { code: "unsafe_eof" });
    assert.deepEqual(draft, copy);
  }
  for (const source of ["```md\nclosed\n```\n", "> ```\n> example\n> ```\n", "- ```\n  example\n  ```\n", "<div>closed</div>\n", "<img src=\"x\">\n", "<br/>\n"]) {
    assert.equal(parseComments(source).safeAppend, true, source);
    assert.equal(parseComments(create(source)).records.length, 1);
  }
});

test("the parser agrees with portable body projection and digest reference vectors", () => {
  const vectors = JSON.parse(readFileSync(new URL("../scripts/document-comments/body-hash-vectors.json", import.meta.url), "utf8"));
  for (const vector of vectors) {
    const parsed = parseComments(vector.source);
    assert.equal(parsed.body, vector.body, vector.name);
    assert.equal(parsed.bodyHash, vector.body_hash, vector.name);
  }
});

test("unterminated records diagnose without consuming the body projection or permitting an append", () => {
  const source = body + "\n<!-- openglance-comment:v1\n{\"id\":\"unfinished\"}\n## Important body\n";
  const parsed = parseComments(source);
  assert.deepEqual(parsed.diagnostics.map((item) => item.code), ["invalid_envelope"]);
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.body, source);
  assert.equal(parsed.safeAppend, false);
});

test("an appended comment is refused if an incomplete HTML declaration would swallow its envelope", () => {
  const source = "<!DOCTYPE html [\n";
  assert.throws(() => create(source), { code: "unsafe_eof" });
});

test("HTML delimiters and arbitrary Markdown message text round-trip without breaking the envelope", () => {
  const data = thread();
  data.messages[0].body = "--> --!> <!-- <script> & **中文 😀**\n`code`";
  const raw = serializeThread(data);
  assert(!raw.slice(raw.indexOf("\n"), raw.lastIndexOf("\n-->" )).includes("<"));
  const parsed = parseComments(raw);
  assert.equal(parsed.records[0].data.messages[0].body, data.messages[0].body);
  const renderer = new MarkdownIt("commonmark", { html: true });
  assert.equal(renderer.render(create(body, data)).replace(/<!--[\s\S]*?-->/g, "").trim(), renderer.render(body).trim());
});

test("body digest reference vector is stable for supported record changes and CRLF but detects body edits", () => {
  const revised = "# Launch plan\n\nWe plan to launch on November 1.";
  const expected = "sha256:d2779a1274a295da96ef68e3d3549561bfd348bdcf1f9743f0ad254a76c59690";
  const data = thread(revised, "on November 1");
  const document = create(revised, data);
  const reply = mutateComments(document, { type: "reply", thread_id: data.id, message: message() });
  const deleted = mutateComments(reply, { type: "delete", thread_id: data.id });
  for (const source of [revised, document, reply, deleted, document.replaceAll("\n", "\r\n"), document.replaceAll("\n", "\r")]) {
    assert.equal(parseComments(source).bodyHash, expected);
  }
  assert.notEqual(parseComments(document.replace("November 1", "November 2")).bodyHash, expected);
  assert.notEqual(parseComments(revised.replace("\n\n", "\n\n\n")).bodyHash, expected);
  assert.equal(parseComments(revised).sourceHash, hashText(revised));
});

test("projection maps normalized CRLF ranges back to physical source without changing bytes", () => {
  const parsed = parseComments("甲😀\r\n乙\r丙\n");
  assert.equal(parsed.body, "甲😀\n乙\n丙\n");
  const from = parsed.body.indexOf("乙");
  const to = parsed.body.indexOf("丙") + 1;
  assert.equal(parsed.source.slice(parsed.sourceStarts[from], parsed.sourceEnds[to - 1]), "乙\r丙");
  assert.throws(() => captureAnchor(parsed.body, 2, 3), { code: "invalid_selector" });
});

test("capturing a repeated selection uses the actual range and retains Unicode context boundaries", () => {
  const source = "A same X\nB same Y";
  const from = source.lastIndexOf("same");
  const anchor = captureAnchor(source, from, from + 4);
  assert.equal(locateAnchor(source, anchor).from, from);
  assert.equal(locateAnchor("same / same", { exact: "same", prefix: "", suffix: "" }).state, "needs_location");
  assert.equal(locateAnchor("B same Y", { exact: "same", prefix: "A ", suffix: " X" }).state, "needs_location");
  assert.equal(locateAnchor("changed", anchor).state, "missing");
  const unicode = "😀".repeat(100) + "target";
  assert.equal(Array.from(captureAnchor(unicode, unicode.length - 6, unicode.length).prefix).length, 64);
});

test("agent revision atomically retains the original quote/status and points to the new result", () => {
  const data = thread();
  const document = create(body, data);
  const before = parseComments(document);
  const from = before.body.indexOf("next month");
  const result = mutateComments(document, { type: "revise", thread_id: data.id, from, to: from + 10,
    expected_text: "next month", insert: "on November 1", message: message("Named the date; verify launch conditions.", agent) });
  const parsed = parseComments(result);
  const updated = parsed.records[0].data;
  assert.equal(updated.anchor.exact, "next month");
  assert.equal(updated.status, "open");
  assert.equal(locateAnchor(parsed.body, updated.anchor).state, "missing");
  assert.equal(locateRevision(parsed, updated.messages[1]).state, "located");
  const nextReply = parseComments(mutateComments(result, { type: "reply", thread_id: data.id, message: message() }));
  assert.equal(locateRevision(nextReply, nextReply.records[0].data.messages[1]).state, "located");
  assert.equal(locateRevision(parseComments(result.replace("November 1.", "November 2.")), updated.messages[1]).state, "stale");
  assert.throws(() => mutateComments(document, { type: "revise", thread_id: data.id, from, to: from + 10,
    expected_text: "different", insert: "new", message: message("done", agent) }), { code: "stale_selection" });
});

test("explicit location preserves prior selectors, attribution, and reply association without resolving", () => {
  const data = thread();
  const source = create(body, data);
  const from = parseComments(source).body.indexOf("Launch plan");
  const result = parseComments(mutateComments(source, { type: "locate", thread_id: data.id, from, to: from + 11,
    author: human, created_at: timestamp, reply_id: data.messages[0].id }));
  assert.equal(result.records[0].data.status, "open");
  assert.deepEqual(result.records[0].data.anchor_history[0].anchor, data.anchor);
  assert.equal(result.records[0].data.anchor_history[0].reply_id, data.messages[0].id);
});

test("oversized and invalid records fail visibly without truncating or mutating the draft", () => {
  const data = thread();
  data.messages[0].body = "x".repeat(LIMITS.messageBytes + 1);
  assert.throws(() => create(body, data), { code: "invalid_message" });
  assert.equal(data.messages[0].body.length, LIMITS.messageBytes + 1);
  assert.throws(() => parseComments("x".repeat(LIMITS.documentBytes + 1)), { code: "document_limit" });
  const invalid = thread();
  invalid.messages[0].created_at = "2026-02-30T04:00:00Z";
  assert.throws(() => create(body, invalid), { code: "invalid_message" });
});

test("compatibility probe distinguishes CommonMark hiding from current OpenGlance literal rendering", () => {
  const document = create();
  assert(new MarkdownIt("commonmark", { html: true }).render(document).includes("<!-- openglance-comment:v1"));
  assert(renderMarkdown(document).includes("&lt;!-- openglance-comment:v1"));
});
