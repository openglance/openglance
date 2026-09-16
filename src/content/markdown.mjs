import MarkdownIt from "markdown-it";

import { createTranslator } from "../../public/i18n.js";
import { decodeMarkdownLinkPath } from "./link-path.mjs";
import { controlledTableStyleSpanAt } from "./markdown-table.mjs";
import { mdxLiteBlockRule, renderMdxLiteComponent } from "./mdx-lite.mjs";
import {
  renderTableToolbar,
  tableCardAttributeString,
  tableComplexityAttributes,
} from "./table-complexity.mjs";
import {
  renderTableColgroup,
  tableLayoutAttributes,
  tableScrollAttributeString,
} from "./table-layout.mjs";

const FRONT_MATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;
const MARKDOWN_MESSAGES = Object.freeze({
  en: Object.freeze({
    "sourceLine.select": "Select line {line}",
    "sourceLine.selectRange": "Select lines {start}-{end}",
    "sourceLine.gutter": "Source line numbers",
    "mermaid.label": "Mermaid diagram",
    "mermaid.ariaLabel": "Rendered Mermaid diagram",
    "mermaid.smartLayout": "Smart view",
    "mermaid.fit": "Fit width",
    "mermaid.zoomOut": "Zoom out",
    "mermaid.zoomIn": "Zoom in",
    "mermaid.showSource": "Show Mermaid source",
    "mermaid.showDiagram": "Show diagram",
    "mermaid.sourceLabel": "Mermaid source",
    "mermaid.loading": "Rendering diagram…",
    "mermaid.error": "Diagram could not be rendered. Open the source to inspect it.",
  }),
  "zh-CN": Object.freeze({
    "sourceLine.select": "选择第 {line} 行",
    "sourceLine.selectRange": "选择第 {start}-{end} 行",
    "sourceLine.gutter": "源文件行号",
    "mermaid.label": "Mermaid 图",
    "mermaid.ariaLabel": "已渲染的 Mermaid 图",
    "mermaid.smartLayout": "智能阅读",
    "mermaid.fit": "适应宽度",
    "mermaid.zoomOut": "缩小",
    "mermaid.zoomIn": "放大",
    "mermaid.showSource": "查看 Mermaid 源码",
    "mermaid.showDiagram": "返回图形",
    "mermaid.sourceLabel": "Mermaid 源码",
    "mermaid.loading": "正在渲染 Mermaid 图……",
    "mermaid.error": "Mermaid 图无法渲染，请打开源码检查。",
  }),
});

export function renderMarkdown(markdown, options = {}) {
  const { source, lineOffset } = stripFrontmatter(markdown);
  const translate = createTranslator(MARKDOWN_MESSAGES, options.locale);
  const renderer = createRenderer({
    ...options,
    locale: translate.locale,
  });
  return renderer.render(source, { lineOffset, translate });
}

export function extractTitle(markdown, fallbackPath) {
  return extractDocumentTitle(markdown) || posixBasename(fallbackPath);
}

// Uses the same parser, heading IDs and frontmatter offset as document rendering.
export function markdownLinkPreview(markdown, { file = "", hash = "" } = {}) {
  const title = extractTitle(markdown, file);
  const { source, lineOffset } = stripFrontmatter(markdown);
  const tokens = createRenderer({}).parse(source, {});
  const headings = [];
  const env = {};
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const text = plainText(tokens[index + 1]?.content || "");
    headings.push({ id: uniqueHeadingId(text, env), title: text, level: Number(token.tag.slice(1)), line: token.map[0] + lineOffset });
  }
  let anchor;
  try { anchor = decodeURIComponent(hash.replace(/^#/, "")); }
  catch { return { title, status: "location_missing" }; }
  const lines = markdown.split(/\r?\n/);
  const range = /^L(\d+)(?:-L?(\d+))?$/.exec(anchor);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2] || range[1]);
    if (start < 1 || end < start || start > lines.length) return { title, status: "location_missing" };
    const detail = lines.slice(start - 1, Math.min(end, start + 119)).join("\n").slice(0, 10000);
    return { status: "ok", title, source: "lines", location: `L${start}${end === start ? "" : `–L${end}`}`, excerpt: detail.slice(0, 700), detail, code: true };
  }
  let body = source;
  let heading;
  if (anchor) {
    heading = headings.find((item) => item.id === anchor);
    if (!heading) return { title, status: "location_missing" };
    const next = headings.find((item) => item.line > heading.line && item.level <= heading.level);
    body = lines.slice(heading.line, next?.line ?? lines.length).join("\n");
  }
  const bodyTokens = createRenderer({}).parse(body, {});
  const blocks = [];
  for (let index = 0; index < bodyTokens.length; index++) {
    const token = bodyTokens[index];
    if (token.type === "inline") {
      if (blocks.length === 0 && bodyTokens[index - 1]?.type === "heading_open") continue;
      const text = (token.children ?? []).map((child) => ["text", "code_inline"].includes(child.type)
        ? child.content : ["softbreak", "hardbreak"].includes(child.type) ? "\n" : "").join("").trim();
      if (text) blocks.push(text);
    } else if (["fence", "code_block"].includes(token.type)) {
      blocks.push(token.content.trim());
    }
  }
  const detail = blocks.join("\n\n").slice(0, 10000);
  const summary = !anchor && ["description", "summary", "ai_snippet"]
    .map((key) => previewSummaryField(markdown, key)).find(Boolean);
  return { status: "ok", title, source: heading ? "section" : summary ? "summary" : "excerpt",
    location: heading?.title || "", excerpt: (summary || detail).slice(0, 700), detail };
}

function previewSummaryField(markdown, key) {
  const scalar = extractFrontmatterScalar(markdown, key);
  if (scalar) return scalar;
  const frontmatter = markdown.match(FRONT_MATTER_RE)?.[0] || "";
  const match = new RegExp(`^${key}:\\s*([|>])[+-]?\\s*\\r?\\n((?:[ \\t]+[^\\n]*(?:\\n|$))+)`, "m").exec(frontmatter);
  return match ? match[2].split(/\r?\n/).map((line) => line.trim()).join(match[1] === ">" ? " " : "\n").trim() : "";
}

export function extractDocumentTitle(markdown) {
  const frontmatterTitle = extractFrontmatterScalar(markdown, "title");
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = markdown.replace(FRONT_MATTER_RE, "").match(/^#\s+(.+?)\s*$/m);
  if (heading) {
    return plainText(heading[1]);
  }

  return "";
}

export function extractFrontmatterScalar(markdown, key) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(String(key ?? ""))) {
    return "";
  }
  const frontmatter = String(markdown ?? "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)?.[1];
  if (!frontmatter) {
    return "";
  }

  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!match || match[1] !== key || !match[2] || /^[|>][+-]?\d?$/.test(match[2])) {
      continue;
    }

    return stripYamlScalarQuotes(match[2].trim());
  }

  return "";
}

function stripYamlScalarQuotes(value) {
  const text = String(value ?? "").trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function createRenderer(options) {
  const renderer = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  const originalLinkOpen =
    renderer.renderer.rules.link_open ?? renderToken(renderer, "link_open");
  const originalImage =
    renderer.renderer.rules.image ?? renderToken(renderer, "image");
  const originalFence =
    renderer.renderer.rules.fence ?? renderToken(renderer, "fence");
  const originalCodeBlock =
    renderer.renderer.rules.code_block ?? renderToken(renderer, "code_block");
  const originalBulletListOpen =
    renderer.renderer.rules.bullet_list_open ?? renderToken(renderer, "bullet_list_open");
  const originalBulletListClose =
    renderer.renderer.rules.bullet_list_close ?? renderToken(renderer, "bullet_list_close");
  const originalOrderedListOpen =
    renderer.renderer.rules.ordered_list_open ?? renderToken(renderer, "ordered_list_open");
  const originalOrderedListClose =
    renderer.renderer.rules.ordered_list_close ?? renderToken(renderer, "ordered_list_close");
  const originalListItemOpen =
    renderer.renderer.rules.list_item_open ?? renderToken(renderer, "list_item_open");
  const originalTableRowOpen =
    renderer.renderer.rules.tr_open ?? renderToken(renderer, "tr_open");
  const originalBlockquoteOpen =
    renderer.renderer.rules.blockquote_open ?? renderToken(renderer, "blockquote_open");
  const originalBlockquoteClose =
    renderer.renderer.rules.blockquote_close ?? renderToken(renderer, "blockquote_close");

  renderer.block.ruler.before("paragraph", "mdx_lite_component", mdxLiteBlockRule, {
    alt: ["paragraph", "reference", "blockquote"],
  });
  renderer.block.ruler.before("paragraph", "safe_image_html", safeImageHtmlBlockRule, {
    alt: ["paragraph"],
  });
  renderer.block.ruler.before("paragraph", "safe_image_gallery_html", safeImageGalleryHtmlBlockRule, {
    alt: ["paragraph"],
  });
  renderer.inline.ruler.before("html_inline", "safe_image_html_inline", safeImageHtmlInlineRule);
  renderer.inline.ruler.before("html_inline", "safe_html_break_inline", safeHtmlBreakInlineRule);
  renderer.inline.ruler.before(
    "html_inline",
    "safe_text_color_span_inline",
    safeTextColorSpanInlineRule,
  );

  renderer.renderer.rules.mdx_lite_component = (tokens, index, rendererOptions, env) =>
    sourceBlockOpen(tokens[index], env) +
    renderMdxLiteComponent(tokens[index], { locale: options.locale }) +
    sourceBlockClose();

  renderer.renderer.rules.safe_image_html = (tokens, index, rendererOptions, env) =>
    sourceBlockOpen(tokens[index], env) +
    renderSafeImageHtml(tokens[index].content, options) +
    sourceBlockClose();

  renderer.renderer.rules.safe_image_gallery_html = (tokens, index, rendererOptions, env) =>
    sourceBlockOpen(tokens[index], env) +
    renderSafeImageGalleryHtml(tokens[index].content, options) +
    sourceBlockClose();

  renderer.renderer.rules.safe_image_html_inline = (tokens, index) =>
    renderSafeImageHtml(tokens[index].content, options, { inline: true });

  renderer.renderer.rules.safe_html_break_inline = () => "<br>";
  renderer.renderer.rules.safe_table_style_span = (
    tokens,
    index,
    rendererOptions,
    env,
    self,
  ) => {
    const { color, backgroundColor } = tokens[index].meta;
    const classes = [
      color ? "git-leaf-text-color" : "",
      backgroundColor ? "git-leaf-text-highlight" : "",
    ].filter(Boolean);
    const declarations = [
      color ? `color:${color}` : "",
      backgroundColor ? `background-color:${backgroundColor}` : "",
    ].filter(Boolean);
    return [
      `<span class="${classes.join(" ")}" style="${declarations.join(";")}">`,
      self.renderInline(tokens[index].children ?? [], rendererOptions, env),
      "</span>",
    ].join("");
  };

  renderer.renderer.rules.heading_open = (tokens, index, rendererOptions, env, self) => {
    const nextToken = tokens[index + 1];
    const text = nextToken?.type === "inline" ? nextToken.content : "section";
    tokens[index].attrSet("id", uniqueHeadingId(plainText(text), env));
    return sourceBlockOpen(tokens[index], env) + self.renderToken(tokens, index, rendererOptions);
  };

  renderer.renderer.rules.heading_close = (tokens, index, rendererOptions, env, self) =>
    self.renderToken(tokens, index, rendererOptions) + sourceBlockClose();

  renderer.renderer.rules.paragraph_open = (tokens, index, rendererOptions, env, self) => {
    if (tokens[index].hidden || env.listDepth > 0) {
      return self.renderToken(tokens, index, rendererOptions);
    }
    return sourceBlockOpen(tokens[index], env, {
      ranges: [tokenSourceRange(tokens[index], env)],
    }) + self.renderToken(tokens, index, rendererOptions);
  };

  renderer.renderer.rules.paragraph_close = (tokens, index, rendererOptions, env, self) => {
    if (tokens[index].hidden || env.listDepth > 0) {
      return self.renderToken(tokens, index, rendererOptions);
    }
    return self.renderToken(tokens, index, rendererOptions) + sourceBlockClose();
  };

  renderer.renderer.rules.link_open = (tokens, index, rendererOptions, env, self) => {
    const href = tokens[index].attrGet("href");
    if (href) {
      tokens[index].attrSet("href", transformDestination(href, options, "link"));
    }
    return originalLinkOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.image = (tokens, index, rendererOptions, env, self) => {
    const src = tokens[index].attrGet("src");
    if (src) {
      tokens[index].attrSet("src", transformDestination(src, options, "asset"));
    }
    tokens[index].attrJoin("class", "git-leaf-image");
    tokens[index].attrSet("data-git-leaf-image", "true");
    tokens[index].attrSet("data-image-align", "left");
    return [
      '<span class="git-leaf-image-frame is-align-left" data-image-align="left">',
      originalImage(tokens, index, rendererOptions, env, self),
      "</span>",
    ].join("");
  };

  renderer.renderer.rules.fence = (tokens, index, rendererOptions, env, self) => {
    const token = tokens[index];
    const sourceLines = renderedCodeSourceLines(token, env, { fenced: true });
    if (fenceLanguage(token) === "mermaid") {
      const range = sourceLines.length > 0
        ? [{ start: sourceLines[0], end: sourceLines.at(-1) }]
        : null;
      return sourceBlockOpen(token, env, {
        lineLayout: "diagram",
        ranges: range,
      }) +
        renderMermaidShell(token.content, env.translate) +
        sourceBlockClose();
    }
    return sourceBlockOpen(token, env, {
      lineLayout: "code",
      lines: sourceLines,
    }) +
      annotateRenderedCodeLines(
        originalFence(tokens, index, rendererOptions, env, self),
        sourceLines,
      ) +
      sourceBlockClose();
  };

  renderer.renderer.rules.code_block = (tokens, index, rendererOptions, env, self) => {
    const token = tokens[index];
    const sourceLines = renderedCodeSourceLines(token, env);
    return sourceBlockOpen(token, env, {
      lineLayout: "code",
      lines: sourceLines,
    }) +
      annotateRenderedCodeLines(
        originalCodeBlock(tokens, index, rendererOptions, env, self),
        sourceLines,
      ) +
      sourceBlockClose();
  };

  renderer.renderer.rules.bullet_list_open = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = beginList(env, tokens[index]);
    return (shouldWrapList ? sourceBlockOpen(tokens[index], env, {
      lineLayout: "list",
      lines: listItemSourceLines(tokens, index, env),
    }) : "") +
      originalBulletListOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.bullet_list_close = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = endList(env);
    return originalBulletListClose(tokens, index, rendererOptions, env, self) +
      (shouldWrapList ? sourceBlockClose() : "");
  };

  renderer.renderer.rules.ordered_list_open = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = beginList(env, tokens[index]);
    return (shouldWrapList ? sourceBlockOpen(tokens[index], env, {
      lineLayout: "list",
      lines: listItemSourceLines(tokens, index, env),
    }) : "") +
      originalOrderedListOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.ordered_list_close = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = endList(env);
    return originalOrderedListClose(tokens, index, rendererOptions, env, self) +
      (shouldWrapList ? sourceBlockClose() : "");
  };

  renderer.renderer.rules.list_item_open = (tokens, index, rendererOptions, env, self) => {
    const sourceLine = listItemSourceLine(tokens[index], env);
    if (Number.isInteger(sourceLine)) {
      tokens[index].attrSet("data-source-list-line", String(sourceLine));
    }
    return originalListItemOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.blockquote_open = (tokens, index, rendererOptions, env, self) => {
    return originalBlockquoteOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.blockquote_close = (tokens, index, rendererOptions, env, self) => {
    return originalBlockquoteClose(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.tr_open = (tokens, index, rendererOptions, env, self) => {
    const range = tableRowSourceRange(tokens, index, env);
    if (range) {
      tokens[index].attrSet("data-source-table-line", String(range.start));
      if (range.end > range.start) {
        tokens[index].attrSet("data-source-table-end", String(range.end));
      }
    }
    return originalTableRowOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.table_open = (tokens, index, rendererOptions, env) => {
    const shape = tableShapeFromTokens(tokens, index);
    const attributes = tableComplexityAttributes(shape);
    const layout = tableLayoutAttributes(shape);
    return [
      sourceBlockOpen(tokens[index], env, {
        lineLayout: "table",
        ranges: tableRowSourceRanges(tokens, index, env),
      }),
      `<div ${tableCardAttributeString(attributes, layout)}>`,
      renderTableToolbar(attributes, { locale: options.locale }),
      `<div ${tableScrollAttributeString(layout)}><table>`,
      renderTableColgroup(layout),
    ].join("");
  };

  renderer.renderer.rules.table_close = () => "</table></div></div>" + sourceBlockClose();

  return renderer;
}

function fenceLanguage(token) {
  return String(token?.info ?? "").trim().split(/\s+/, 1)[0].toLowerCase();
}

function renderMermaidShell(source, translate) {
  const t = typeof translate === "function"
    ? translate
    : createTranslator(MARKDOWN_MESSAGES, "en");
  const loading = t("mermaid.loading");
  const error = t("mermaid.error");
  const showSource = t("mermaid.showSource");
  const showDiagram = t("mermaid.showDiagram");

  return [
    '<figure class="mermaid-diagram" data-mermaid-diagram="true"',
    ` data-mermaid-loading-message="${escapeAttribute(loading)}"`,
    ` data-mermaid-error-message="${escapeAttribute(error)}">`,
    '<figcaption class="mermaid-diagram-toolbar">',
    `<span class="mermaid-diagram-label">${escapeHtml(t("mermaid.label"))}</span>`,
    '<span class="mermaid-diagram-actions">',
    `<button type="button" data-mermaid-action="smart-layout" aria-pressed="true" hidden>${escapeHtml(t("mermaid.smartLayout"))}</button>`,
    `<button type="button" data-mermaid-action="fit">${escapeHtml(t("mermaid.fit"))}</button>`,
    `<button type="button" data-mermaid-action="zoom-out" aria-label="${escapeAttribute(t("mermaid.zoomOut"))}" data-ui-tooltip="${escapeAttribute(t("mermaid.zoomOut"))}">−</button>`,
    '<span class="mermaid-diagram-zoom" data-mermaid-zoom-value>100%</span>',
    `<button type="button" data-mermaid-action="zoom-in" aria-label="${escapeAttribute(t("mermaid.zoomIn"))}" data-ui-tooltip="${escapeAttribute(t("mermaid.zoomIn"))}">+</button>`,
    `<button type="button" class="mermaid-diagram-source-button" data-mermaid-action="source" aria-label="${escapeAttribute(showSource)}" aria-pressed="false" data-ui-tooltip="${escapeAttribute(showSource)}" data-mermaid-source-label="${escapeAttribute(showSource)}" data-mermaid-diagram-label="${escapeAttribute(showDiagram)}">&lt;/&gt;</button>`,
    "</span></figcaption>",
    '<div class="mermaid-diagram-viewport" data-mermaid-viewport>',
    `<div class="mermaid-diagram-canvas" data-mermaid-canvas aria-label="${escapeAttribute(t("mermaid.ariaLabel"))}" aria-busy="true"></div>`,
    `<p class="mermaid-diagram-status" data-mermaid-status role="status">${escapeHtml(loading)}</p>`,
    "</div>",
    `<pre class="mermaid-diagram-source" data-mermaid-source-view aria-label="${escapeAttribute(t("mermaid.sourceLabel"))}" hidden><code data-mermaid-source>${escapeHtml(source)}</code></pre>`,
    "</figure>",
  ].join("");
}

function stripFrontmatter(markdown) {
  const match = markdown.match(FRONT_MATTER_RE);
  if (!match) {
    return { source: markdown, lineOffset: 0 };
  }

  return {
    source: markdown.slice(match[0].length),
    lineOffset: match[0].match(/\n/g)?.length ?? 0,
  };
}

function safeImageHtmlBlockRule(state, startLine, _endLine, silent) {
  const line = blockSourceLine(state, startLine).trim();
  if (!/^<img\b[^>]*>\s*$/i.test(line)) {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push("safe_image_html", "", 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  token.content = line;
  state.line = startLine + 1;
  return true;
}

function safeImageGalleryHtmlBlockRule(state, startLine, _endLine, silent) {
  const line = blockSourceLine(state, startLine).trim();
  const match = /^<p>\s*((?:<img\b[^<>]*>\s*)+)<\/p>\s*$/i.exec(line);
  if (!match) {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push("safe_image_gallery_html", "", 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  token.content = match[1];
  state.line = startLine + 1;
  return true;
}

function safeImageHtmlInlineRule(state, silent) {
  const match = /^<img\b[^<>]*>/i.exec(state.src.slice(state.pos));
  if (!match) {
    return false;
  }

  if (!silent) {
    const token = state.push("safe_image_html_inline", "", 0);
    token.content = match[0];
  }
  state.pos += match[0].length;
  return true;
}

function safeHtmlBreakInlineRule(state, silent) {
  const match = /^<br\s*\/?\s*>/i.exec(state.src.slice(state.pos));
  if (!match) {
    return false;
  }

  if (!silent) {
    state.push("safe_html_break_inline", "br", 0);
  }
  state.pos += match[0].length;
  return true;
}

function safeTextColorSpanInlineRule(state, silent) {
  const span = controlledTableStyleSpanAt(state.src.slice(state.pos));
  if (!span) {
    return false;
  }

  if (!silent) {
    const token = state.push("safe_table_style_span", "span", 0);
    token.meta = {
      color: span.color,
      backgroundColor: span.backgroundColor,
    };
    token.children = [];
    state.md.inline.parse(span.content, state.md, state.env, token.children);
  }
  state.pos += span.length;
  return true;
}

function blockSourceLine(state, line) {
  const start = state.bMarks[line] + state.tShift[line];
  const end = state.eMarks[line];
  return state.src.slice(start, end);
}

function renderSafeImageHtml(rawTag, options, { inline = false } = {}) {
  const attributes = parseHtmlAttributes(rawTag);
  const src = attributes.src?.trim();
  if (!src) {
    return escapeHtml(rawTag);
  }

  const alt = attributes.alt ?? "";
  const align = normalizeImageAlign(attributes["data-align"]);
  const width = normalizeImageWidth(attributes.width);
  const height = normalizeImageHeight(attributes.height);
  const caption = normalizeImageCaption(attributes["data-caption"]);
  const transformedSrc = transformDestination(src, options, "asset");
  const imageAttributes = [
    'class="git-leaf-image"',
    'data-git-leaf-image="true"',
    `data-image-align="${align}"`,
    caption ? `data-image-caption="${escapeAttribute(caption)}"` : "",
    `src="${escapeAttribute(transformedSrc)}"`,
    `alt="${escapeAttribute(alt)}"`,
    width ? `width="${escapeAttribute(width)}"` : "",
    height ? `height="${escapeAttribute(height)}"` : "",
  ].filter(Boolean);

  const frameTag = inline ? "span" : "figure";
  const captionTag = inline ? "span" : "figcaption";
  return [
    `<${frameTag} class="git-leaf-image-frame is-align-${align}" data-image-align="${align}">`,
    `<img ${imageAttributes.join(" ")}>`,
    caption ? `<${captionTag} class="git-leaf-image-caption">${escapeHtml(caption)}</${captionTag}>` : "",
    `</${frameTag}>`,
  ].join("");
}

function renderSafeImageGalleryHtml(rawImages, options) {
  const images = [...rawImages.matchAll(/<img\b[^<>]*>/gi)]
    .map((match) => renderSafeImageHtml(match[0], options, { inline: true }));
  return `<div class="git-leaf-image-gallery">${images.join("")}</div>`;
}

function parseHtmlAttributes(rawTag) {
  const attributes = {};
  const attributeRe = /([A-Za-z_:][A-Za-z0-9_:.:-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
  for (const match of rawTag.matchAll(attributeRe)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function normalizeImageAlign(value) {
  const align = String(value ?? "").trim().toLowerCase();
  return align === "center" ? "center" : "left";
}

function normalizeImageWidth(value) {
  const width = String(value ?? "").trim();
  if (/^\d{2,4}$/.test(width)) {
    return String(Math.min(Math.max(Number(width), 80), 2000));
  }
  return "";
}

function normalizeImageHeight(value) {
  const height = String(value ?? "").trim();
  if (/^\d{2,4}$/.test(height)) {
    return String(Math.min(Math.max(Number(height), 40), 2000));
  }
  return "";
}

function normalizeImageCaption(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function sourceBlockOpen(token, env, {
  lineLayout = "",
  lines = null,
  ranges = null,
} = {}) {
  if (!token.map) {
    return "";
  }

  const fallbackStart = token.map[0] + (env.lineOffset ?? 0) + 1;
  const fallbackEnd = token.map[1] + (env.lineOffset ?? 0);
  const lineNumbers = Array.isArray(lines)
    ? [...new Set(lines)].filter(Number.isInteger).sort((left, right) => left - right)
    : Array.from({ length: fallbackEnd - fallbackStart + 1 }, (_, index) => fallbackStart + index);
  const lineRanges = Array.isArray(ranges) && ranges.length > 0
    ? ranges
      .filter((range) => Number.isInteger(range?.start) && Number.isInteger(range?.end))
      .map((range) => ({
        start: Math.min(range.start, range.end),
        end: Math.max(range.start, range.end),
      }))
      .sort((left, right) => left.start - right.start)
    : lineNumbers.map((line) => ({ start: line, end: line }));
  const start = lineRanges[0]?.start ?? fallbackStart;
  const end = lineRanges.at(-1)?.end ?? fallbackEnd;
  const buttons = [];
  const translate = typeof env.translate === "function"
    ? env.translate
    : createTranslator(MARKDOWN_MESSAGES, "en");
  for (const range of lineRanges) {
    const isRange = range.end > range.start;
    const lineLabel = escapeAttribute(isRange
      ? translate("sourceLine.selectRange", range)
      : translate("sourceLine.select", { line: range.start }));
    const endAttribute = isRange ? ` data-source-end="${range.end}"` : "";
    const displayLabel = isRange ? `${range.start}–${range.end}` : String(range.start);
    buttons.push(
      `<button type="button" class="source-line-button" data-source-line="${range.start}"${endAttribute} title="${lineLabel}" aria-label="${lineLabel}">${displayLabel}</button>`,
    );
  }

  const lineLayoutAttribute = lineLayout ? ` data-source-line-layout="${escapeAttribute(lineLayout)}"` : "";

  return [
    `<div class="source-block" data-source-start="${start}" data-source-end="${end}">`,
    `<div class="source-line-gutter"${lineLayoutAttribute} aria-label="${escapeAttribute(translate("sourceLine.gutter"))}">`,
    buttons.join(""),
    "</div>",
    '<div class="source-block-content">',
  ].join("");
}

function sourceBlockClose() {
  return "</div></div>";
}

function renderedCodeSourceLines(token, env, { fenced = false } = {}) {
  if (!token?.map) {
    return [];
  }

  const content = String(token.content ?? "");
  if (!content) {
    return [];
  }

  const renderedLineCount = content.endsWith("\n")
    ? content.slice(0, -1).split("\n").length
    : content.split("\n").length;
  const firstLine = token.map[0] + (env.lineOffset ?? 0) + (fenced ? 2 : 1);
  return Array.from({ length: renderedLineCount }, (_, index) => firstLine + index);
}

function annotateRenderedCodeLines(renderedHtml, sourceLines) {
  if (!Array.isArray(sourceLines) || sourceLines.length === 0) {
    return renderedHtml;
  }

  const codeStart = renderedHtml.indexOf("<code");
  const contentStart = codeStart >= 0 ? renderedHtml.indexOf(">", codeStart) + 1 : -1;
  const contentEnd = renderedHtml.lastIndexOf("</code>");
  if (contentStart <= 0 || contentEnd < contentStart) {
    return renderedHtml;
  }

  const renderedContent = renderedHtml.slice(contentStart, contentEnd);
  const hasTrailingNewline = renderedContent.endsWith("\n");
  const contentWithoutTrailingNewline = hasTrailingNewline
    ? renderedContent.slice(0, -1)
    : renderedContent;
  const renderedLines = contentWithoutTrailingNewline.split("\n");
  if (renderedLines.length !== sourceLines.length) {
    return renderedHtml;
  }

  const annotatedContent = renderedLines
    .map((line, index) => (
      `<span class="source-code-line" data-source-code-line="${sourceLines[index]}">${line}</span>`
    ))
    .join("\n");
  return renderedHtml.slice(0, contentStart) +
    annotatedContent +
    (hasTrailingNewline ? "\n" : "") +
    renderedHtml.slice(contentEnd);
}

function listItemSourceLines(tokens, startIndex, env) {
  const lines = [];
  let nestedListDepth = 0;
  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      nestedListDepth += 1;
      continue;
    }

    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      if (nestedListDepth === 0) {
        break;
      }
      nestedListDepth -= 1;
      continue;
    }

    const line = listItemSourceLine(token, env);
    if (Number.isInteger(line)) {
      lines.push(line);
    }
  }
  return lines;
}

function listItemSourceLine(token, env) {
  return token.type === "list_item_open" && token.map
    ? token.map[0] + (env.lineOffset ?? 0) + 1
    : null;
}

function tokenSourceRange(token, env) {
  if (!token?.map) {
    return null;
  }
  return {
    start: token.map[0] + (env.lineOffset ?? 0) + 1,
    end: token.map[1] + (env.lineOffset ?? 0),
  };
}

function tableRowSourceRanges(tokens, startIndex, env) {
  const ranges = [];
  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].type === "table_close") {
      break;
    }
    if (tokens[index].type !== "tr_open") {
      continue;
    }
    const range = tokenSourceRange(tokens[index], env);
    if (range) {
      ranges.push({ ...range, tokenIndex: index });
    }
  }
  if (ranges.length > 1 && ranges[1].start > ranges[0].end) {
    ranges[0].end = ranges[1].start - 1;
  }
  return ranges;
}

function tableRowSourceRange(tokens, rowIndex, env) {
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    if (tokens[index].type !== "table_open") {
      continue;
    }
    return tableRowSourceRanges(tokens, index, env)
      .find((range) => range.tokenIndex === rowIndex) ?? null;
  }
  return tokenSourceRange(tokens[rowIndex], env);
}

function tableShapeFromTokens(tokens, startIndex) {
  let rowCount = 0;
  let columnCount = 0;
  let currentRowColumns = 0;
  let inBody = false;
  let inHeader = false;
  let activeColumn = -1;
  const cells = [];
  const columns = [];
  const cellsByColumn = [];

  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "table_close") {
      break;
    }
    if (token.type === "thead_open") {
      inHeader = true;
      continue;
    }
    if (token.type === "thead_close") {
      inHeader = false;
      continue;
    }
    if (token.type === "tbody_open") {
      inBody = true;
      continue;
    }
    if (token.type === "tbody_close") {
      inBody = false;
      continue;
    }
    if (token.type === "tr_open") {
      currentRowColumns = 0;
      activeColumn = -1;
      continue;
    }
    if (token.type === "th_open" || token.type === "td_open") {
      activeColumn = currentRowColumns;
      currentRowColumns += 1;
      continue;
    }
    if (token.type === "th_close" || token.type === "td_close") {
      activeColumn = -1;
      continue;
    }
    if (token.type === "inline") {
      const measurementText = tableCellMeasurementText(token);
      cells.push(measurementText);
      if (activeColumn >= 0) {
        cellsByColumn[activeColumn] ??= [];
        cellsByColumn[activeColumn].push(measurementText);
        if (inHeader && !columns[activeColumn]) {
          columns[activeColumn] = measurementText;
        }
      }
      continue;
    }
    if (token.type === "tr_close") {
      if (inHeader) {
        columnCount = Math.max(columnCount, currentRowColumns);
      }
      if (inBody) {
        rowCount += 1;
      }
      columnCount = Math.max(columnCount, currentRowColumns);
    }
  }

  return {
    rows: rowCount,
    columns: columnCount,
    columnNames: Array.from({ length: columnCount }, (_, index) => columns[index] || `Column ${index + 1}`),
    cellsByColumn: Array.from({ length: columnCount }, (_, index) => cellsByColumn[index] ?? []),
    cells,
  };
}

function tableCellMeasurementText(inlineToken) {
  if (!Array.isArray(inlineToken?.children) || inlineToken.children.length === 0) {
    return String(inlineToken?.content ?? "");
  }

  return inlineToken.children
    .map(inlineTokenMeasurementText)
    .join("");
}

function inlineTokenMeasurementText(token) {
  if (token.nesting !== 0) {
    return "";
  }
  if (token.type === "softbreak" || token.type === "hardbreak") {
    return " ";
  }
  if (token.type === "safe_image_html_inline") {
    return parseHtmlAttributes(token.content).alt ?? "";
  }
  if (Array.isArray(token.children)) {
    return token.children.map(inlineTokenMeasurementText).join("");
  }
  return String(token.content ?? "");
}

function beginList(env, token) {
  const depth = env.listDepth ?? 0;
  const shouldWrapList = depth === 0 && Boolean(token.map);
  env.listDepth = depth + 1;
  env.listWrapStack ??= [];
  env.listWrapStack.push(shouldWrapList);
  return shouldWrapList;
}

function endList(env) {
  env.listDepth = Math.max((env.listDepth ?? 1) - 1, 0);
  return env.listWrapStack?.pop() ?? false;
}

function renderToken(renderer, tokenName) {
  return (tokens, index, options, env, self) =>
    self.renderToken(tokens, index, options);
}

function transformDestination(rawDestination, options, kind) {
  const destination = rawDestination.trim();
  if (kind === "link" && isOpenGlanceDocumentDestination(destination)) {
    return sanitizeOpenGlanceDocumentDestination(destination);
  }
  if (!options.currentFile || isExternalDestination(destination) || destination.startsWith("#")) {
    return destination;
  }

  const { file: pathPart, suffix } = resolveRelativeRepoLink(options.currentFile, destination);

  if (kind === "link" && isMarkdownPath(pathPart)) {
    return withRepositoryQuery("/", {
      repo: options.currentRepo,
      file: pathPart,
      suffix,
    });
  }

  return withRepositoryQuery("/raw", {
    repo: options.currentRepo,
    file: pathPart,
    suffix,
  });
}

function withRepositoryQuery(pathname, { repo, file, suffix = "" }) {
  const query = new URLSearchParams();
  if (repo) {
    query.set("repo", repo);
  }
  query.set("file", file);
  const hashIndex = suffix.indexOf("#");
  const hash = hashIndex < 0 ? "" : suffix.slice(hashIndex);
  const destinationQuery = hashIndex < 0 ? suffix : suffix.slice(0, hashIndex);
  for (const [key, value] of new URLSearchParams(destinationQuery)) {
    if (key !== "repo" && key !== "file") query.append(key, value);
  }
  return `${pathname}?${query.toString()}${hash}`;
}

function isOpenGlanceDocumentDestination(destination) {
  try {
    if (!destination.startsWith("/") && !destination.startsWith("?")) {
      return false;
    }

    const url = new URL(destination, "http://git-leaf.local");
    const file = url.searchParams.get("file") ?? "";
    return url.pathname === "/" && /\.mdx?$/i.test(file);
  } catch {
    return false;
  }
}

function sanitizeOpenGlanceDocumentDestination(destination) {
  const url = new URL(destination, "http://git-leaf.local");
  const query = new URLSearchParams();
  for (const key of ["repo", "file"]) {
    const value = url.searchParams.get(key);
    if (value) {
      query.set(key, value);
    }
  }
  url.search = query.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

function resolveRelativeRepoLink(sourceRelativePath, destination) {
  const [pathPart, suffix = ""] = splitDestinationSuffix(destination);
  if (!pathPart) {
    return { file: sourceRelativePath, suffix };
  }

  const decodedPath = decodeMarkdownLinkPath(pathPart);
  const sourceDir = posixDirname(sourceRelativePath);
  const resolved = decodedPath.startsWith("/")
    ? posixNormalize(decodedPath.slice(1))
    : posixNormalize(`${sourceDir}/${decodedPath}`);

  // Keep the path separate from its suffix and unencoded until URLSearchParams
  // writes it. The service still enforces repository containment for every read.
  return { file: resolved, suffix };
}

function isMarkdownPath(value) {
  const extension = posixExtname(value).toLowerCase();
  return extension === ".md" || extension === ".mdx";
}

function isExternalDestination(destination) {
  const normalized = destination.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("//")
  );
}

function splitDestinationSuffix(destination) {
  const hashIndex = destination.indexOf("#");
  const queryIndex = destination.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return [destination, ""];
  }

  const splitIndex = Math.min(...indexes);
  return [destination.slice(0, splitIndex), destination.slice(splitIndex)];
}

function posixBasename(value) {
  const normalized = String(value ?? "").replace(/\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function posixDirname(value) {
  const normalized = String(value ?? "").replace(/\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : ".";
}

function posixExtname(value) {
  const pathPart = String(value ?? "");
  const slashIndex = pathPart.lastIndexOf("/");
  const dotIndex = pathPart.lastIndexOf(".");
  return dotIndex > slashIndex ? pathPart.slice(dotIndex) : "";
}

function posixNormalize(value) {
  const segments = [];
  for (const part of String(value ?? "").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else {
        segments.push(part);
      }
      continue;
    }
    segments.push(part);
  }

  return segments.join("/") || ".";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function plainText(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function uniqueHeadingId(value, env) {
  const baseId = slugify(value);
  const usedIds = env.headingIds ??= new Set();
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}
