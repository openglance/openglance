import assert from "node:assert/strict";
import test from "node:test";

import {
  addFrontmatterFieldToSource,
  deleteFrontmatterLineFromSource,
  frontmatterKeysFromSource,
  frontmatterLineForValue,
} from "../public/frontmatter-edit.js";

test("frontmatterLineForValue writes simple scalar field lines", () => {
  assert.equal(frontmatterLineForValue("canonical", "true"), "canonical: true");
  assert.equal(frontmatterLineForValue("title", "Mango Mate"), "title: Mango Mate");
  assert.equal(frontmatterLineForValue("owner", " maintainer "), "owner: maintainer");
});

test("frontmatterKeysFromSource returns top-level keys from the opening block only", () => {
  assert.deepEqual(
    frontmatterKeysFromSource([
      "---",
      "title: Standard",
      "change_log:",
      "  - summary: nested entry",
      "---",
      "summary: body text",
      "",
    ].join("\n")),
    ["title", "change_log"],
  );
});

test("addFrontmatterFieldToSource inserts before an existing frontmatter closing fence", () => {
  assert.equal(
    addFrontmatterFieldToSource("---\ntitle: Standard\n---\n# Body\n", "domain", "company"),
    "---\ntitle: Standard\ndomain: company\n---\n# Body\n",
  );
});

test("addFrontmatterFieldToSource creates a frontmatter block when the document has none", () => {
  assert.equal(
    addFrontmatterFieldToSource("# Body\n", "title", "Standard"),
    "---\ntitle: Standard\n---\n\n# Body\n",
  );
});

test("deleteFrontmatterLineFromSource removes one source line by 1-based line number", () => {
  assert.equal(
    deleteFrontmatterLineFromSource("---\ntitle: Standard\ndomain: company\n---\n# Body\n", 3),
    "---\ntitle: Standard\n---\n# Body\n",
  );
});


test("body edits keep the saved metadata signature while frontmatter edits invalidate it", async () => {
  const { frontmatterSourceSignature } = await import("../public/frontmatter-edit.js");
  const before = "---\nai_snippet: before\n---\n# Title\nBody";
  assert.equal(frontmatterSourceSignature(before), frontmatterSourceSignature(before + " more body"));
  assert.notEqual(frontmatterSourceSignature(before), frontmatterSourceSignature(before.replace("before", "after")));
  assert.notEqual(frontmatterSourceSignature(before), frontmatterSourceSignature("# No metadata"));
});
