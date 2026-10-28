#!/usr/bin/env node
// Optional network probe. Sends only the synthetic fixture below, never repository documents.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { captureAnchor, mutateComments } from "./document-comments/format.mjs";

const apiVersion = "2026-03-10";
const base = "# Prototype fixture\n\nA **bold** [link](./plan.md).\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n```md\n<literal>\n```\n";
const sentinel = "COMMENT_PAYLOAD_SENTINEL";
const from = base.indexOf("bold");
const commented = mutateComments(base, { type: "create", thread: {
  id: randomUUID(), status: "open", anchor: captureAnchor(base, from, from + 4),
  messages: [{ id: randomUUID(), author: { name: "Synthetic probe", kind: "human" },
    created_at: "2026-10-28T04:00:00Z", body: `${sentinel} --> --!> <!-- **example**` }],
} });
const later = "\n## Rollback\n\nReturn to the previous release.\n";
const visible = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").trim();
const cases = [
  { name: "EOF record", control: base, source: commented },
  { name: "record before appended section", control: base + later, source: commented + later },
];
async function render(text) {
  const response = await fetch("https://api.github.com/markdown", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/html", "X-GitHub-Api-Version": apiVersion },
    body: JSON.stringify({ text, mode: "gfm" }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub Markdown API returned HTTP ${response.status}; compatibility is unverified.`);
  return response.text();
}
const results = [];
for (const fixture of cases) {
  const [control, html] = await Promise.all([render(fixture.control), render(fixture.source)]);
  assert.equal(visible(html), visible(control), fixture.name);
  assert(!visible(html).includes(sentinel), fixture.name);
  results.push({ name: fixture.name, visible_body_unchanged: true, payload_in_response_html: html.includes(sentinel) });
}
console.log(JSON.stringify({ api_version: apiVersion, mode: "gfm", cases: results,
  limit: "Synthetic rendering only; no GitHub UI or editor save round trip. GitHub does not expose the server renderer version." }, null, 2));
