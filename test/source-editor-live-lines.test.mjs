import assert from "node:assert/strict";
import test from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

import {
  pastedImageInsertionText,
  imageLineAttributes,
  imageLineForAction,
  pastedTextLinkCandidate,
  closestElement,
  liveClassForLine,
  liveHeadingAnchorAdjustment,
  markdownHeadingFoldSections,
  livePreviewBlocksForSource,
  livePreviewHtmlForBlock,
  liveBlockPreviewIgnoresEvent,
  liveInlineRangesForLine,
  isLiveBlankClick,
  liveMarkdownLinkAtPosition,
  liveMarkdownLinksForLine,
  liveFrontmatterFieldAtPosition,
  liveFrontmatterFieldForLine,
  liveFrontmatterRangesForLine,
  liveReadableReplacementsForLine,
  liveVisualRangesForLine,
  liveMdxComponentForLine,
  liveMdxTargetIsEmbeddedViewControl,
  minimalDocumentChange,
  nextLiveEditingSuppression,
  listItemIndentChange,
  SLASH_COMMANDS,
  isMarkdownDocumentPath,
  slashCommandCompletionSource,
  slashCommandsForLocale,
  slashCommandTemplate,
} from "../src/client/source-editor.mjs";

test("Markdown heading folds stop before the next heading at the same or higher level", () => {
  assert.deepEqual(
    markdownHeadingFoldSections([
      "# Report",
      "intro",
      "## Findings",
      "finding body",
      "### Detail",
      "detail body",
      "## Summary",
      "summary body",
      "# Appendix",
      "appendix body",
    ].join("\n")),
    [
      { lineNumber: 1, level: 1, endLine: 8 },
      { lineNumber: 3, level: 2, endLine: 6 },
      { lineNumber: 5, level: 3, endLine: 6 },
      { lineNumber: 7, level: 2, endLine: 8 },
      { lineNumber: 9, level: 1, endLine: 10 },
    ],
  );
});

test("Markdown heading folds ignore frontmatter, fenced code, and empty sections", () => {
  assert.deepEqual(
    markdownHeadingFoldSections([
      "---",
      "title: '# Metadata'",
      "---",
      "# Visible",
      "```md",
      "## Not a heading",
      "```",
      "body",
      "## Empty",
      "",
      "## Final",
      "final body",
    ].join("\n")),
    [
      { lineNumber: 4, level: 1, endLine: 12 },
      { lineNumber: 11, level: 2, endLine: 12 },
    ],
  );
});

test("Live heading anchor adjustment preserves the title and only keeps needed bottom space", () => {
  assert.deepEqual(
    liveHeadingAnchorAdjustment({
      beforeTop: 440,
      afterTop: 440,
      scrollTop: 316,
      scrollHeight: 1_810,
      clientHeight: 822,
      currentPadding: 854,
    }),
    {
      targetScrollTop: 316,
      requiredPadding: 184,
    },
  );
  assert.deepEqual(
    liveHeadingAnchorAdjustment({
      beforeTop: 440,
      afterTop: -1_010,
      scrollTop: 1_766,
      scrollHeight: 3_443,
      clientHeight: 822,
      currentPadding: 854,
    }),
    {
      targetScrollTop: 316,
      requiredPadding: 0,
    },
  );
});

test("minimalDocumentChange preserves unchanged editor ranges around a remote update", () => {
  const current = "local first\nmiddle\nlast\n";
  const next = "local first\nmiddle\nremote last\n";
  const change = minimalDocumentChange(current, next);
  assert.deepEqual(change, {
    from: 19,
    to: 19,
    insert: "remote ",
  });
  const editor = EditorState.create({
    doc: current,
    selection: {
      anchor: current.indexOf("last") + 2,
    },
  });
  const transaction = editor.update({ changes: change });
  assert.equal(
    transaction.state.selection.main.anchor,
    next.indexOf("last") + 2,
  );
  assert.deepEqual(minimalDocumentChange("before", "after"), {
    from: 0,
    to: 6,
    insert: "after",
  });
});

test("liveClassForLine styles common Markdown source lines", () => {
  assert.equal(
    liveClassForLine({ lineNumber: 1, text: "# Title" }),
    "cm-live-heading cm-live-heading-1",
  );
  assert.equal(
    liveClassForLine({ lineNumber: 3, text: "- Item" }),
    "cm-live-list",
  );
  assert.equal(
    liveClassForLine({ lineNumber: 4, text: "> Note" }),
    "cm-live-blockquote",
  );
  assert.equal(
    liveClassForLine({ lineNumber: 5, text: "body", inCodeBlock: true }),
    "cm-live-code",
  );
});

test("liveClassForLine only treats opening frontmatter as frontmatter", () => {
  assert.equal(
    liveClassForLine({ lineNumber: 1, text: "---" }),
    "cm-live-frontmatter",
  );
  assert.equal(
    liveClassForLine({ lineNumber: 2, text: "---", inFrontmatter: true }),
    "cm-live-frontmatter",
  );
  assert.equal(
    liveClassForLine({ lineNumber: 4, text: "---", frontmatterClosed: false }),
    "cm-live-horizontal-rule",
  );
});

test("liveInlineRangesForLine marks source syntax separately from readable content", () => {
  const ranges = liveInlineRangesForLine("# Revenue **up** with `cash` in [report](docs/report.md)");

  assert.deepEqual(ranges[0], { from: 0, to: 1, className: "cm-live-marker" });
  assert.ok(
    ranges.some((range) => range.className === "cm-live-strong" && range.from === 12 && range.to === 14),
  );
  assert.ok(
    ranges.some((range) => range.className === "cm-live-inline-code" && range.from === 23 && range.to === 27),
  );
  assert.ok(
    ranges.some((range) => range.className === "cm-live-link-text" && range.from === 33 && range.to === 39),
  );
  assert.deepEqual(
    ranges.find((range) => range.className === "cm-live-link-text")?.attributes,
    {
      "data-live-link": "true",
      "data-live-link-from": "32",
      "data-live-link-to": "56",
    },
  );
  assert.ok(
    ranges.some((range) => range.className === "cm-live-marker" && range.from === 0 && range.to === 1),
  );
});

test("Live link toolbars open angle-wrapped destinations without changing their source ranges", () => {
  const source = "See [report](<notes/课程%20详情.md?view=full#L5>) now";
  const link = liveMarkdownLinksForLine(source)[0];
  assert.equal(link.href, "notes/课程%20详情.md?view=full#L5");
  assert.equal(source.slice(link.from, link.to), "[report](<notes/课程%20详情.md?view=full#L5>)");
  assert.equal(source.slice(link.destinationFrom, link.destinationTo), "<notes/课程%20详情.md?view=full#L5>");
});

test("liveMarkdownLinksForLine returns source ranges for Live link toolbars", () => {
  const links = liveMarkdownLinksForLine("See [report](docs/report.md) now");

  assert.deepEqual(links, [
    {
      from: 4,
      to: 28,
      textFrom: 5,
      textTo: 11,
      destinationFrom: 13,
      destinationTo: 27,
      text: "report",
      href: "docs/report.md",
    },
  ]);
  assert.equal(liveMarkdownLinkAtPosition("See [report](docs/report.md) now", 7)?.href, "docs/report.md");
  assert.equal(liveMarkdownLinkAtPosition("See [report](docs/report.md) now", 29), null);
});

test("liveFrontmatterFieldForLine returns source ranges for top-level scalar fields", () => {
  assert.deepEqual(liveFrontmatterFieldForLine("decision_status: accepted"), {
    from: 0,
    to: 25,
    keyFrom: 0,
    keyTo: 15,
    valueFrom: 17,
    valueTo: 25,
    key: "decision_status",
    value: "accepted",
  });
  assert.equal(liveFrontmatterFieldForLine("  summary: nested entry"), null);
  assert.equal(liveFrontmatterFieldForLine("change_log:"), null);
  assert.equal(liveFrontmatterFieldForLine("---"), null);
});

test("liveFrontmatterRangesForLine marks key and value for Live frontmatter popovers", () => {
  assert.deepEqual(liveFrontmatterRangesForLine("domain: product"), [
    {
      from: 0,
      to: 6,
      className: "cm-live-frontmatter-token cm-live-frontmatter-key",
      attributes: {
        "data-live-frontmatter": "true",
        "data-live-frontmatter-key": "domain",
        "data-live-frontmatter-from": "0",
        "data-live-frontmatter-to": "15",
      },
    },
    {
      from: 8,
      to: 15,
      className: "cm-live-frontmatter-token cm-live-frontmatter-value",
      attributes: {
        "data-live-frontmatter": "true",
        "data-live-frontmatter-key": "domain",
        "data-live-frontmatter-from": "0",
        "data-live-frontmatter-to": "15",
      },
    },
  ]);
});

test("liveFrontmatterFieldAtPosition finds fields from key, colon, and value positions", () => {
  assert.equal(liveFrontmatterFieldAtPosition("canonical: true", 0)?.key, "canonical");
  assert.equal(liveFrontmatterFieldAtPosition("canonical: true", 9)?.value, "true");
  assert.equal(liveFrontmatterFieldAtPosition("canonical: true", 14)?.value, "true");
  assert.equal(liveFrontmatterFieldAtPosition("canonical: true", 15), null);
});

test("closestElement resolves Live token clicks from text-node targets", () => {
  const fieldElement = {
    closest(selector) {
      return selector === ".cm-live-frontmatter-token[data-live-frontmatter-key]"
        ? this
        : null;
    },
  };
  const textNodeTarget = {
    nodeType: 3,
    parentElement: fieldElement,
  };

  assert.equal(
    closestElement(textNodeTarget, ".cm-live-frontmatter-token[data-live-frontmatter-key]"),
    fieldElement,
  );
});

test("liveReadableReplacementsForLine only replaces block-level Markdown markers in reading lines", () => {
  assert.deepEqual(liveReadableReplacementsForLine("# Title"), [
    { from: 0, to: 2, widget: "" },
  ]);
  assert.deepEqual(liveReadableReplacementsForLine("- Item"), [
    {
      from: 0,
      to: 2,
      widget: "\u2022",
      className: "cm-live-list-widget",
      indentColumns: 0,
      markerColumns: 2,
    },
  ]);
  assert.deepEqual(liveReadableReplacementsForLine("1. Item"), [
    {
      from: 0,
      to: 3,
      widget: "1.",
      className: "cm-live-list-widget",
      indentColumns: 0,
      markerColumns: 3,
    },
  ]);
  assert.equal(liveReadableReplacementsForLine("Value is **bold** and `cash`").length, 0);
});

test("liveReadableReplacementsForLine hides heading markers inside list items", () => {
  assert.deepEqual(liveReadableReplacementsForLine("- ## Item title"), [
    {
      from: 0,
      to: 2,
      widget: "\u2022",
      className: "cm-live-list-widget",
      indentColumns: 0,
      markerColumns: 2,
    },
    { from: 2, to: 5, widget: "" },
  ]);
});

test("liveReadableReplacementsForLine aligns bullets with source marker columns", () => {
  assert.deepEqual(liveReadableReplacementsForLine("  - Company CEO"), [
    {
      from: 2,
      to: 4,
      widget: "\u2022",
      className: "cm-live-list-widget",
      indentColumns: 0,
      markerColumns: 2,
    },
  ]);
});

test("liveVisualRangesForLine uses replacements instead of marker marks outside the active line", () => {
  assert.deepEqual(liveVisualRangesForLine("# Title", { isActiveLine: false }), [
    { type: "replace", from: 0, to: 2, widget: "" },
  ]);
  assert.ok(
    liveVisualRangesForLine("# Title", { isActiveLine: true }).some(
      (range) => range.type === "mark" && range.className === "cm-live-marker",
    ),
  );
});

test("liveVisualRangesForLine hides inline Markdown markers in reading lines", () => {
  const ranges = liveVisualRangesForLine("Value is **bold** and `cash`", { isActiveLine: false });

  assert.ok(ranges.some((range) => range.type === "replace" && range.from === 9 && range.to === 11));
  assert.ok(ranges.some((range) => range.type === "replace" && range.from === 15 && range.to === 17));
  assert.ok(ranges.some((range) => range.type === "replace" && range.from === 22 && range.to === 23));
  assert.ok(ranges.some((range) => range.type === "replace" && range.from === 27 && range.to === 28));
  assert.ok(ranges.some((range) => range.type === "mark" && range.className === "cm-live-strong"));
  assert.ok(ranges.some((range) => range.type === "mark" && range.className === "cm-live-inline-code"));
  assert.equal(
    ranges.some((range) => range.type === "mark" && String(range.className ?? "").includes("cm-live-marker")),
    false,
  );
});

test("liveVisualRangesForLine keeps inline Markdown markers visible in the active editing line", () => {
  const ranges = liveVisualRangesForLine("Value is **bold** and `cash`", { isActiveLine: true });

  assert.ok(
    ranges.some((range) => (
      range.type === "mark" &&
      range.from === 9 &&
      range.to === 11 &&
      range.className === "cm-live-marker"
    )),
  );
  assert.equal(ranges.some((range) => range.type === "replace"), false);
});

test("Live typing keeps the active list item in source editing state", () => {
  assert.equal(
    nextLiveEditingSuppression(true, { docChanged: true }),
    false,
  );
  assert.deepEqual(liveVisualRangesForLine("- ", { isActiveLine: true }), [
    { type: "mark", from: 0, to: 1, className: "cm-live-marker" },
  ]);
  assert.equal(
    liveVisualRangesForLine("- ", { isActiveLine: true }).some((range) => range.type === "replace"),
    false,
  );
});

test("Live list item indentation uses two source spaces", () => {
  assert.deepEqual(listItemIndentChange("- Item", "indent"), {
    from: 0,
    to: 0,
    insert: "  ",
  });
  assert.deepEqual(listItemIndentChange("  - Item", "outdent"), {
    from: 0,
    to: 2,
    insert: "",
  });
  assert.equal(listItemIndentChange("- Item", "outdent"), null);
  assert.equal(listItemIndentChange("Plain text", "indent"), null);
});

test("liveMdxComponentForLine recognizes MDX-lite component openings", () => {
  assert.deepEqual(
    liveMdxComponentForLine('<Chart title="收入趋势" type="line">'),
    { name: "Chart", title: "收入趋势" },
  );
  assert.deepEqual(
    liveMdxComponentForLine("<DataTable>"),
    { name: "DataTable", title: "DataTable" },
  );
  assert.equal(liveMdxComponentForLine("<Unknown />"), null);
});

test("Slash menu exposes Markdown and MDX-lite commands without AI-generated snippet fields", () => {
  const labels = SLASH_COMMANDS.map((command) => command.label);

  assert.deepEqual(labels, [
    "frontmatter",
    "quote",
    "code",
    "link",
    "doclink",
    "datatable",
    "timeline",
    "chart",
    "decision",
    "metrics",
    "flow",
  ]);
  assert.equal(labels.some((label) => /ai[_-]?snippet/i.test(label)), false);
  assert.equal(labels.some((label) => ["table", "image"].includes(label)), false);
  assert.equal(
    SLASH_COMMANDS.some((command) => /ai[_-]?snippet/i.test(command.template ?? "")),
    false,
  );
});

test("Slash menu localizes user-facing command copy while preserving technical syntax", () => {
  const englishCommands = slashCommandsForLocale();
  const chineseCommands = slashCommandsForLocale({ locale: "zh-CN" });
  const chineseCommandsFromLanguageAlias = slashCommandsForLocale({ language: "zh-Hans" });

  assert.equal(
    englishCommands.find((command) => command.label === "quote")?.title,
    "Quote",
  );
  assert.equal(
    englishCommands.find((command) => command.label === "quote")?.description,
    "Insert a block quote",
  );
  assert.equal(
    chineseCommands.find((command) => command.label === "quote")?.title,
    "引用",
  );
  assert.equal(
    chineseCommands.find((command) => command.label === "quote")?.description,
    "插入引用块",
  );
  assert.equal(
    chineseCommandsFromLanguageAlias.find((command) => command.label === "quote")?.title,
    "引用",
  );
  assert.equal(
    slashCommandsForLocale({ locale: "fr" }).find((command) => command.label === "quote")?.title,
    "Quote",
  );

  const englishCode = slashCommandTemplate(
    englishCommands.find((command) => command.label === "code"),
  );
  const chineseCode = slashCommandTemplate(
    chineseCommands.find((command) => command.label === "code"),
  );
  assert.equal(englishCode.text, chineseCode.text);
  assert.match(englishCode.text, /^```text\n\n```$/);
  assert.equal(
    englishCommands.find((command) => command.label === "code")?.detail,
    "Markdown",
  );
  assert.equal(
    chineseCommands.find((command) => command.label === "code")?.detail,
    "Markdown",
  );
});

test("Slash menu inserts examples in the selected locale", () => {
  const englishCommands = slashCommandsForLocale({ locale: "en" });
  const chineseCommands = slashCommandsForLocale({ locale: "zh-CN" });
  const template = (commands, label) => slashCommandTemplate(
    commands.find((command) => command.label === label),
  ).text;

  assert.match(template(englishCommands, "datatable"), /\nExample,1,active\n/);
  assert.match(template(chineseCommands, "datatable"), /\n示例,1,active\n/);
  assert.match(template(englishCommands, "timeline"), /"title":"Milestone","body":"Add details"/);
  assert.match(template(chineseCommands, "timeline"), /"title":"关键节点","body":"补充说明"/);
  assert.match(template(englishCommands, "decision"), /\nDecision,\nReason,\nTrade-off,\n/);
  assert.match(template(chineseCommands, "decision"), /\n决策,\n理由,\n代价,\n/);
  assert.match(template(englishCommands, "metrics"), /\nCore metric,0,,Definition,neutral\n/);
  assert.match(template(chineseCommands, "metrics"), /\n核心指标,0,,口径说明,neutral\n/);
  assert.match(template(englishCommands, "flow"), /"label": "Start"/);
  assert.match(template(chineseCommands, "flow"), /"label": "开始"/);

  const relocalizedDefaultCommand = slashCommandTemplate(
    SLASH_COMMANDS.find((command) => command.label === "metrics"),
    { locale: "zh-CN" },
  );
  assert.match(relocalizedDefaultCommand.text, /\n核心指标,0,,口径说明,neutral\n/);
});

test("Slash completion presents localized title and description", () => {
  const source = slashCommandCompletionSource({ locale: "zh-CN" });
  const state = EditorState.create({ doc: "/" });
  const result = source(new CompletionContext(state, 1, true));
  const quote = result?.options.find((option) => option.label === "/quote");

  assert.equal(quote?.detail, "Markdown");
  assert.equal(quote?.info, "引用 — 插入引用块");
});

test("pastedTextLinkCandidate only handles URLs and Markdown document paths", () => {
  assert.equal(pastedTextLinkCandidate("https://example.com/report"), "https://example.com/report");
  assert.equal(
    pastedTextLinkCandidate("http://127.0.0.1:4317/?repo=content-repo&file=AGENTS.md"),
    "http://127.0.0.1:4317/?repo=content-repo&file=AGENTS.md",
  );
  assert.equal(pastedTextLinkCandidate("docs/report.md"), "docs/report.md");
  assert.equal(pastedTextLinkCandidate("/Users/demo/repo/docs/report.mdx"), "/Users/demo/repo/docs/report.mdx");
  assert.equal(pastedTextLinkCandidate("ordinary text"), "");
  assert.equal(pastedTextLinkCandidate("https://example.com\nsecond line"), "");
});

test("Slash menu templates keep frontmatter human-entered and format MDX attributes on separate lines", () => {
  const frontmatter = slashCommandTemplate(
    SLASH_COMMANDS.find((command) => command.label === "frontmatter"),
    { today: "2026-07-04" },
  );
  const mdxTemplates = ["datatable", "timeline", "chart", "decision", "metrics", "flow"].map(
    (label) => slashCommandTemplate(SLASH_COMMANDS.find((command) => command.label === label)),
  );
  const chart = mdxTemplates[2];

  assert.match(frontmatter.text, /last_updated: 2026-07-04/);
  assert.doesNotMatch(frontmatter.text, /ai_snippet/);
  assert.match(chart.text, /^<Chart\n  title=""\n  type="line"\n  x="month"\n  series="value"\n  unit=""\n>/);
  for (const template of mdxTemplates) {
    assert.match(template.text, /^<[A-Z][A-Za-z]+\n  title=""\n/);
    assert.doesNotMatch(livePreviewHtmlForBlock(template.text), /mdx-component-error/);
  }
  assert.ok(SLASH_COMMANDS.find((command) => command.label === "chart")?.requiresMdx);
  assert.equal(isMarkdownDocumentPath("docs/report.md"), true);
  assert.equal(isMarkdownDocumentPath("docs/report.mdx"), false);
});

test("livePreviewBlocksForSource keeps Markdown tables rendered on the active line", () => {
  const source = [
    "# Report",
    "",
    "| Month | Revenue | Cost |",
    "| --- | ---: | ---: |",
    "| 2026-05 | 100 | 70 |",
    "| 2026-06 | 120 | 80 |",
    "",
    "After table.",
  ].join("\n");

  assert.deepEqual(
    livePreviewBlocksForSource(source, { activeLineNumber: 1 }).map(
      ({ type, startLine, endLine }) => ({ type, startLine, endLine }),
    ),
    [{ type: "table", startLine: 3, endLine: 6 }],
  );
  assert.deepEqual(
    livePreviewBlocksForSource(source, { activeLineNumber: 4 }).map(
      ({ type, startLine, endLine }) => ({ type, startLine, endLine }),
    ),
    [{ type: "table", startLine: 3, endLine: 6 }],
  );
});

test("livePreviewBlocksForSource treats HTML image lines as Live preview blocks", () => {
  const source = [
    "# Report",
    "",
    '<img src="_assets/report.png" alt="" width="760">',
    "",
    "After image.",
  ].join("\n");

  assert.deepEqual(
    livePreviewBlocksForSource(source, { activeLineNumber: 1 }).map((block) => ({
      type: block.type,
      startLine: block.startLine,
      endLine: block.endLine,
    })),
    [{ type: "image", startLine: 3, endLine: 3 }],
  );
  assert.deepEqual(livePreviewBlocksForSource(source, { activeLineNumber: 3 }), []);
});

test("livePreviewBlocksForSource treats Markdown image lines as interactive Live preview blocks", () => {
  const source = [
    "# Report",
    "",
    "![六月报表](_assets/report.png)",
    "",
    "After image.",
  ].join("\n");

  const [block] = livePreviewBlocksForSource(source, { activeLineNumber: 1 });
  assert.deepEqual(
    { type: block?.type, startLine: block?.startLine, endLine: block?.endLine },
    { type: "image", startLine: 3, endLine: 3 },
  );
  assert.match(livePreviewHtmlForBlock(block.source), /data-git-leaf-image="true"/);
  assert.match(livePreviewHtmlForBlock(block.source), /alt="六月报表"/);
  assert.deepEqual(livePreviewBlocksForSource(source, { activeLineNumber: 3 }), []);
});

test("Live image toolbar converts Markdown images to editable safe HTML image lines", () => {
  const markdownImage = "![六月报表](_assets/report.png)";

  assert.deepEqual(imageLineAttributes(markdownImage), {
    src: "_assets/report.png",
    alt: "六月报表",
  });
  assert.equal(
    imageLineForAction(markdownImage, "align-center"),
    '<img src="_assets/report.png" alt="六月报表" width="760" data-align="center">',
  );
  assert.equal(
    imageLineForAction(
      '<img src="_assets/report.png" alt="六月报表" width="745" height="181">',
      "align-center",
    ),
    '<img src="_assets/report.png" alt="六月报表" width="745" height="181" data-align="center">',
  );
});

test("livePreviewBlocksForSource previews safe HTML image groups in Live mode", () => {
  const source = [
    "# Gallery",
    "",
    '<p><img src="_assets/one.jpg" width="200"> <img src="_assets/two.jpg" width="200"></p>',
  ].join("\n");

  const [block] = livePreviewBlocksForSource(source, { activeLineNumber: 1 });
  assert.deepEqual(
    { type: block?.type, startLine: block?.startLine, endLine: block?.endLine },
    { type: "image", startLine: 3, endLine: 3 },
  );
  assert.match(livePreviewHtmlForBlock(block.source), /git-leaf-image-gallery/);
  assert.equal(livePreviewHtmlForBlock(block.source).match(/data-git-leaf-image="true"/g)?.length, 2);
});

test("pastedImageInsertionText leaves the cursor after the image block", () => {
  const image = '<img src="_assets/report.png" alt="" width="760">';
  const emptyLineState = EditorState.create({
    doc: "Before\n\nAfter",
    selection: { anchor: 7 },
  });
  const inlineState = EditorState.create({
    doc: "Before",
    selection: { anchor: 6 },
  });

  assert.equal(pastedImageInsertionText(emptyLineState, image), `${image}\n`);
  assert.equal(pastedImageInsertionText(inlineState, image), `\n\n${image}\n`);
});

test("livePreviewBlocksForSource ignores fenced code tables", () => {
  const source = [
    "```md",
    "| Month | Revenue |",
    "| --- | ---: |",
    "| 2026-06 | 120 |",
    "```",
  ].join("\n");

  assert.deepEqual(livePreviewBlocksForSource(source), []);
});

test("livePreviewBlocksForSource renders complete Mermaid fences outside the active block", () => {
  const source = [
    "# Architecture",
    "",
    "```mermaid",
    "flowchart LR",
    "  Source --> Observation --> Evidence",
    "```",
    "",
    "After diagram.",
  ].join("\n");

  const [block] = livePreviewBlocksForSource(source, { activeLineNumber: 1 });
  assert.deepEqual(
    {
      type: block?.type,
      startLine: block?.startLine,
      endLine: block?.endLine,
      source: block?.source,
    },
    {
      type: "mermaid",
      startLine: 3,
      endLine: 6,
      source: source.split("\n").slice(2, 6).join("\n"),
    },
  );
  assert.deepEqual(livePreviewBlocksForSource(source, { activeLineNumber: 4 }), []);

  const html = livePreviewHtmlForBlock(block.source);
  assert.match(html, /data-mermaid-diagram="true"/);
  assert.match(html, /data-mermaid-source>flowchart LR/);
  assert.doesNotMatch(html, /source-line-gutter/);
});

test("livePreviewBlocksForSource supports tilde Mermaid fences and ignores incomplete fences", () => {
  const complete = [
    "~~~MERMAID",
    "sequenceDiagram",
    "  Alice->>Bob: Hello",
    "~~~",
  ].join("\n");
  const incomplete = [
    "```mermaid",
    "flowchart LR",
    "  A --> B",
  ].join("\n");

  assert.deepEqual(
    livePreviewBlocksForSource(complete).map(({ type, startLine, endLine }) => ({
      type,
      startLine,
      endLine,
    })),
    [{ type: "mermaid", startLine: 1, endLine: 4 }],
  );
  assert.deepEqual(livePreviewBlocksForSource(incomplete), []);
});

test("livePreviewBlocksForSource detects MDX-lite component blocks outside the active block", () => {
  const source = [
    "# Report",
    "",
    '<Chart title="收入趋势" type="line" x="month" series="revenue,cost">',
    "month,revenue,cost",
    "2026-05,100,70",
    "2026-06,120,80",
    "</Chart>",
    "",
    '<Timeline title="关键事件" />',
  ].join("\n");

  assert.deepEqual(
    livePreviewBlocksForSource(source, { activeLineNumber: 1 }).map(
      ({ type, component, startLine, endLine }) => ({ type, component, startLine, endLine }),
    ),
    [
      { type: "mdx", component: "Chart", startLine: 3, endLine: 7 },
      { type: "mdx", component: "Timeline", startLine: 9, endLine: 9 },
    ],
  );
  assert.deepEqual(
    livePreviewBlocksForSource(source, { activeLineNumber: 5 }).map(
      ({ type, component, startLine, endLine }) => ({ type, component, startLine, endLine }),
    ),
    [{ type: "mdx", component: "Timeline", startLine: 9, endLine: 9 }],
  );
});

test("livePreviewHtmlForBlock renders block preview without source line wrappers", () => {
  const tableHtml = livePreviewHtmlForBlock([
    "| Month | Revenue |",
    "| --- | ---: |",
    "| 2026-06 | 120 |",
  ].join("\n"));
  assert.match(tableHtml, /<table>/);
  assert.match(tableHtml, /Revenue/);
  assert.doesNotMatch(tableHtml, /source-line-gutter/);
  assert.doesNotMatch(tableHtml, /source-block-content/);

  const chartHtml = livePreviewHtmlForBlock([
    '<Chart title="收入趋势" type="line" x="month" series="revenue">',
    "month,revenue",
    "2026-06,120",
    "</Chart>",
  ].join("\n"));
  assert.match(chartHtml, /data-mdx-component="Chart"/);
  assert.match(chartHtml, /mdx-chart/);
  assert.match(chartHtml, /data-chart-tooltip="2026-06\\nrevenue: 120"/);
  assert.match(chartHtml, /class="mdx-chart-value-label"[^>]*>120<\/text>/);
  assert.doesNotMatch(chartHtml, /source-line-gutter/);
});

test("Live routes every MDX preview event through the component interaction", () => {
  const intervalButton = {
    closest: (selector) => selector === "[data-dataset-granularity]" ? intervalButton : null,
  };
  const chartSurface = { closest: () => null };

  assert.equal(liveBlockPreviewIgnoresEvent({ type: "table" }, chartSurface), true);
  assert.equal(liveBlockPreviewIgnoresEvent({ type: "mdx" }, intervalButton), true);
  assert.equal(liveBlockPreviewIgnoresEvent({ type: "mdx" }, chartSurface), true);
  assert.equal(liveBlockPreviewIgnoresEvent({ type: "mermaid" }, chartSurface), true);
  assert.equal(liveBlockPreviewIgnoresEvent({ type: "image" }, chartSurface), false);
  assert.equal(liveMdxTargetIsEmbeddedViewControl(intervalButton), true);
  assert.equal(liveMdxTargetIsEmbeddedViewControl(chartSurface), false);
});

test("Live toolbar clicks are not treated as blank-editor clicks", () => {
  const toolbar = {};
  const target = {
    closest(selector) {
      if (selector === ".live-edit-toolbar") {
        return toolbar;
      }
      if (selector === ".cm-content") {
        return {};
      }
      return null;
    },
  };

  assert.equal(isLiveBlankClick({ target }), false);
  assert.equal(isLiveBlankClick({
    target: {
      closest: (selector) => selector === ".cm-content" ? {} : null,
    },
  }), true);
});

test("livePreviewHtmlForBlock renders an external dataset shell with quarter control", () => {
  const html = livePreviewHtmlForBlock(
    '<Chart dataset="./company.dataset.json" x="period" series="revenue" granularity="quarter" />',
    { locale: "zh-CN" },
  );

  assert.match(html, /data-mdx-dataset-view="true"/);
  assert.match(html, /data-dataset-granularity="quarter"/);
  assert.match(html, />季度<\/button>/);
});

test("Live recognises dataset components whose attributes use separate lines", () => {
  const source = [
    "before",
    "<Chart",
    '  title="收入趋势"',
    '  dataset="./company.dataset.json"',
    '  x="period"',
    '  series="revenue"',
    '  granularity="quarter"',
    "/>",
    "after",
  ].join("\n");
  const blocks = livePreviewBlocksForSource(source);

  assert.deepEqual(blocks, [{
    type: "mdx",
    component: "Chart",
    attributes: {
      title: "收入趋势",
      dataset: "./company.dataset.json",
      x: "period",
      series: "revenue",
      granularity: "quarter",
    },
    openingEndIndex: 6,
    selfClosing: true,
    startLine: 2,
    endLine: 8,
    source: source.split("\n").slice(1, 8).join("\n"),
  }]);
  const html = livePreviewHtmlForBlock(blocks[0].source, { locale: "zh-CN" });
  assert.match(html, /data-mdx-dataset-view="true"/);
  assert.match(html, /data-dataset-granularity="quarter"/);
  assert.doesNotMatch(html, /&lt;Chart/);
});
