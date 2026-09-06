import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
} from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  EditorSelection,
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  dropCursor,
  GutterMarker,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumberWidgetMarker,
  lineNumbers,
  rectangularSelection,
  WidgetType,
} from "@codemirror/view";
import { EditorView, minimalSetup } from "codemirror";

import { renderMarkdown } from "../content/markdown.mjs";
import {
  MARKDOWN_TABLE_HIGHLIGHT_COLORS,
  MARKDOWN_TABLE_TEXT_COLORS,
  alignMarkdownTableColumns,
  applyMarkdownTableHighlightColor,
  applyMarkdownTableTextStyle,
  applyMarkdownTableTextColor,
  clearMarkdownTableTextFormatting,
  markdownTableBlockAtLines,
  markdownTableSelectionFormatState,
  normalizeMarkdownTableSelection,
  parseMarkdownTable,
  reorderMarkdownTableColumn,
  replaceMarkdownTableCell,
} from "../content/markdown-table.mjs";
import {
  mdxLiteComponentBlockAtLines,
  mdxLiteComponentOpeningAtLines,
} from "../content/mdx-lite-syntax.mjs";
import { findTextMatches } from "../../public/document-search.js";
import {
  createDocumentChangeModel,
  emptyDocumentChangeModel,
} from "../../public/document-changes.js";
import { enhanceImageLoadStates } from "../../public/image-preview.js";
import { createTranslator } from "../../public/i18n.js";

const livePreviewEnterEffect = StateEffect.define();
const livePreviewExitEffect = StateEffect.define();
const sourceEditorSetup = [
  minimalSetup,
  lineNumbers(),
  highlightActiveLineGutter(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...completionKeymap,
  ]),
];
const liveRenderOptionsFacet = Facet.define({
  combine(values) {
    return values[0] ?? {};
  },
});
const liveTableInteractionFacet = Facet.define({
  combine(values) {
    return values[0] ?? null;
  },
});
const liveMdxComponentInteractionFacet = Facet.define({
  combine(values) {
    return values[0] ?? null;
  },
});
const cursorPlaceholder = "{{cursor}}";
const imageWidthSteps = [320, 480, 640, 760, 960, 1200];
const SOURCE_EDITOR_CHANGE_MESSAGES = {
  en: {
    deletedText: "Deleted text: {text}",
    deletedLine: "Deleted line {line}",
  },
  "zh-CN": {
    deletedText: "已删除文本：{text}",
    deletedLine: "已删除第 {line} 行",
  },
};

const SOURCE_EDITOR_SLASH_MESSAGES = {
  en: {
    "frontmatter.title": "Document frontmatter",
    "frontmatter.description": "Insert document metadata",
    "quote.title": "Quote",
    "quote.description": "Insert a block quote",
    "code.title": "Code block",
    "code.description": "Insert a fenced code block",
    "link.title": "External link",
    "link.description": "Insert an external Markdown link",
    "doclink.title": "Repository document link",
    "doclink.description": "Link to another document in this repository",
    "datatable.title": "DataTable",
    "datatable.description": "Insert a CSV-backed data table",
    "datatable.example": "Example",
    "timeline.title": "Timeline",
    "timeline.description": "Insert a JSON-backed timeline",
    "timeline.exampleTitle": "Milestone",
    "timeline.exampleBody": "Add details",
    "chart.title": "Chart",
    "chart.description": "Insert a CSV-backed chart",
    "decision.title": "DecisionBox",
    "decision.description": "Insert a structured decision summary",
    "decision.rowDecision": "Decision",
    "decision.rowReason": "Reason",
    "decision.rowTradeoff": "Trade-off",
    "metrics.title": "MetricGrid",
    "metrics.description": "Insert a metric card grid",
    "metrics.exampleLabel": "Core metric",
    "metrics.exampleNote": "Definition",
    "flow.title": "FlowDiagram",
    "flow.description": "Insert a JSON-backed flow diagram",
    "flow.start": "Start",
    "flow.done": "Done",
  },
  "zh-CN": {
    "frontmatter.title": "文档 frontmatter",
    "frontmatter.description": "插入文档元数据",
    "quote.title": "引用",
    "quote.description": "插入引用块",
    "code.title": "代码块",
    "code.description": "插入围栏代码块",
    "link.title": "外部链接",
    "link.description": "插入外部 Markdown 链接",
    "doclink.title": "仓库文档链接",
    "doclink.description": "链接到当前仓库中的其他文档",
    "datatable.title": "DataTable 数据表",
    "datatable.description": "插入由 CSV 数据驱动的数据表",
    "datatable.example": "示例",
    "timeline.title": "Timeline 时间线",
    "timeline.description": "插入由 JSON 数据驱动的时间线",
    "timeline.exampleTitle": "关键节点",
    "timeline.exampleBody": "补充说明",
    "chart.title": "Chart 统计图表",
    "chart.description": "插入由 CSV 数据驱动的统计图表",
    "decision.title": "DecisionBox 决策摘要",
    "decision.description": "插入结构化决策摘要",
    "decision.rowDecision": "决策",
    "decision.rowReason": "理由",
    "decision.rowTradeoff": "代价",
    "metrics.title": "MetricGrid 指标卡",
    "metrics.description": "插入指标卡网格",
    "metrics.exampleLabel": "核心指标",
    "metrics.exampleNote": "口径说明",
    "flow.title": "FlowDiagram 流程图",
    "flow.description": "插入由 JSON 数据驱动的流程图",
    "flow.start": "开始",
    "flow.done": "完成",
  },
};

const SOURCE_EDITOR_TABLE_MESSAGES = {
  en: {
    "toolbar.label": "Table formatting",
    "toolbar.close": "Close table tools",
    "format.bold": "Bold",
    "format.italic": "Italic",
    "format.strikethrough": "Strikethrough",
    "format.clear": "Clear text formatting",
    "palette.textColor": "Text color",
    "palette.highlight": "Text highlight",
    "color.green": "Positive green",
    "color.red": "Risk red",
    "color.orange": "Warning orange",
    "color.blue": "Information blue",
    "color.gray": "Neutral gray",
    "color.clear": "Clear text color",
    "highlight.green": "Green highlight",
    "highlight.red": "Red highlight",
    "highlight.orange": "Orange highlight",
    "highlight.blue": "Blue highlight",
    "highlight.gray": "Gray highlight",
    "highlight.clear": "Clear text highlight",
    "align.group": "Column alignment",
    "align.left": "Align selected columns left",
    "align.center": "Align selected columns center",
    "align.right": "Align selected columns right",
    "cell.edit": "Edit table cell source",
    "column.drag": "Drag to reorder the selected column",
  },
  "zh-CN": {
    "toolbar.label": "表格格式",
    "toolbar.close": "关闭表格工具栏",
    "format.bold": "粗体",
    "format.italic": "斜体",
    "format.strikethrough": "删除线",
    "format.clear": "清除文字格式",
    "palette.textColor": "文字颜色",
    "palette.highlight": "文字高亮",
    "color.green": "正向绿色",
    "color.red": "风险红色",
    "color.orange": "提醒橙色",
    "color.blue": "信息蓝色",
    "color.gray": "中性灰色",
    "color.clear": "清除文字颜色",
    "highlight.green": "绿色高亮",
    "highlight.red": "红色高亮",
    "highlight.orange": "橙色高亮",
    "highlight.blue": "蓝色高亮",
    "highlight.gray": "灰色高亮",
    "highlight.clear": "清除文字高亮",
    "align.group": "列对齐",
    "align.left": "选中列左对齐",
    "align.center": "选中列居中对齐",
    "align.right": "选中列右对齐",
    "cell.edit": "编辑表格单元格源码",
    "column.drag": "拖动调整选中列的顺序",
  },
};

const SOURCE_EDITOR_COMPONENT_MESSAGES = {
  en: {
    "toolbar.label": "Component tools",
    "toolbar.source": "Edit component source",
    "toolbar.close": "Close component tools",
    "datatable.search": "Search",
    "datatable.freeze": "Freeze first column",
    "datatable.sticky": "Sticky header",
    "datatable.copy": "Copy CSV",
    "chart.type": "Chart type",
    "chart.type.auto": "Auto type",
    "chart.type.line": "Line",
    "chart.type.bar": "Bar",
    "chart.type.grouped-bar": "Grouped bar",
    "chart.type.stacked-bar": "Stacked bar",
    "chart.type.combo": "Combo",
    "chart.type.combo-dual-axis": "Dual axis",
    "chart.labels": "Value labels",
    "decision.status": "Decision status",
    "decision.status.none": "No status",
    "decision.status.accepted": "Accepted",
    "decision.status.proposed": "Proposed",
    "decision.status.rejected": "Rejected",
    "decision.status.superseded": "Superseded",
  },
  "zh-CN": {
    "toolbar.label": "组件工具栏",
    "toolbar.source": "编辑组件源码",
    "toolbar.close": "关闭组件工具栏",
    "datatable.search": "搜索",
    "datatable.freeze": "冻结首列",
    "datatable.sticky": "固定表头",
    "datatable.copy": "复制 CSV",
    "chart.type": "图表类型",
    "chart.type.auto": "自动类型",
    "chart.type.line": "折线图",
    "chart.type.bar": "柱状图",
    "chart.type.grouped-bar": "分组柱状图",
    "chart.type.stacked-bar": "堆叠柱状图",
    "chart.type.combo": "组合图",
    "chart.type.combo-dual-axis": "双轴组合图",
    "chart.labels": "数值标签",
    "decision.status": "决策状态",
    "decision.status.none": "无状态",
    "decision.status.accepted": "已采纳",
    "decision.status.proposed": "提议中",
    "decision.status.rejected": "已拒绝",
    "decision.status.superseded": "已取代",
  },
};

const LIVE_MDX_CHART_TYPES = [
  "line",
  "bar",
  "grouped-bar",
  "stacked-bar",
  "combo",
  "combo-dual-axis",
];

const LIVE_MDX_DECISION_STATUSES = [
  "accepted",
  "proposed",
  "rejected",
  "superseded",
];

const slashCommandDefinitions = [
  {
    label: "frontmatter",
    detail: "Markdown",
    template: ({ today }) => [
      "---",
      "title: {{cursor}}",
      "domain: ",
      "type: ",
      "owner: ",
      `last_updated: ${today}`,
      "canonical: false",
      "---",
      "",
    ].join("\n"),
  },
  {
    label: "quote",
    detail: "Markdown",
    template: "> {{cursor}}",
  },
  {
    label: "code",
    detail: "Markdown",
    template: "```text\n{{cursor}}\n```",
  },
  {
    label: "link",
    detail: "Markdown",
    custom: "link",
  },
  {
    label: "doclink",
    detail: "Markdown",
    custom: "doclink",
  },
  {
    label: "datatable",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      "<DataTable",
      '  title="{{cursor}}"',
      ">",
      "```csv",
      "name,value,status",
      `${translate("datatable.example")},1,active`,
      "```",
      "</DataTable>",
    ].join("\n"),
  },
  {
    label: "timeline",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      "<Timeline",
      '  title="{{cursor}}"',
      ">",
      "```json",
      "[",
      `  {"date":"2026-07-04","title":"${translate("timeline.exampleTitle")}","body":"${translate("timeline.exampleBody")}","status":"active"}`,
      "]",
      "```",
      "</Timeline>",
    ].join("\n"),
  },
  {
    label: "chart",
    detail: "MDX-lite",
    requiresMdx: true,
    template: [
      "<Chart",
      '  title="{{cursor}}"',
      '  type="line"',
      '  x="month"',
      '  series="value"',
      '  unit=""',
      ">",
      "```csv",
      "month,value",
      "2026-06,100",
      "2026-07,120",
      "```",
      "</Chart>",
    ].join("\n"),
  },
  {
    label: "decision",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      "<DecisionBox",
      '  title="{{cursor}}"',
      '  status="proposed"',
      '  owner=""',
      ">",
      "```csv",
      "label,value",
      `${translate("decision.rowDecision")},`,
      `${translate("decision.rowReason")},`,
      `${translate("decision.rowTradeoff")},`,
      "```",
      "</DecisionBox>",
    ].join("\n"),
  },
  {
    label: "metrics",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      "<MetricGrid",
      '  title="{{cursor}}"',
      ">",
      "```csv",
      "label,value,delta,note,status",
      `${translate("metrics.exampleLabel")},0,,${translate("metrics.exampleNote")},neutral`,
      "```",
      "</MetricGrid>",
    ].join("\n"),
  },
  {
    label: "flow",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      "<FlowDiagram",
      '  title="{{cursor}}"',
      ">",
      "```json",
      "{",
      '  "nodes": [',
      `    {"id": "start", "label": "${translate("flow.start")}", "type": "start"},`,
      `    {"id": "done", "label": "${translate("flow.done")}", "type": "end"}`,
      "  ],",
      '  "edges": [',
      '    {"from": "start", "to": "done"}',
      "  ]",
      "}",
      "```",
      "</FlowDiagram>",
    ].join("\n"),
  },
];

export function slashCommandsForLocale({ locale, language } = {}) {
  const translate = createTranslator(SOURCE_EDITOR_SLASH_MESSAGES, locale ?? language);
  return slashCommandDefinitions.map((definition) => {
    const command = {
      ...definition,
      locale: translate.locale,
      title: translate(`${definition.label}.title`),
      description: translate(`${definition.label}.description`),
    };
    if (typeof definition.template === "function") {
      command.template = ({ today }) => definition.template({ today, translate });
    }
    return command;
  });
}

export const SLASH_COMMANDS = slashCommandsForLocale();

const liveEditingSuppression = StateField.define({
  create() {
    return false;
  },
  update(isSuppressed, transaction) {
    let enterEditing = false;
    let exitEditing = false;
    for (const effect of transaction.effects) {
      if (effect.is(livePreviewExitEffect)) {
        exitEditing = true;
      }
      if (effect.is(livePreviewEnterEffect)) {
        enterEditing = true;
      }
    }

    return nextLiveEditingSuppression(isSuppressed, {
      docChanged: transaction.docChanged,
      enterEditing,
      exitEditing,
    });
  },
});

const liveMarkdownDecorations = StateField.define({
  create(state) {
    return buildLiveMarkdownDecorations(state);
  },
  update(decorations, transaction) {
    const selectionChanged = !transaction.startState.selection.eq(transaction.state.selection);
    const activeLineSuppressed = transaction.state.field(liveEditingSuppression, false);
    const activeLineSuppressionChanged =
      transaction.startState.field(liveEditingSuppression, false) !== activeLineSuppressed;
    if (transaction.docChanged || selectionChanged || activeLineSuppressionChanged) {
      return buildLiveMarkdownDecorations(transaction.state, {
        suppressActiveLine: activeLineSuppressed,
      });
    }

    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const selectedLinesEffect = StateEffect.define();
const documentSearchEffect = StateEffect.define();
const remoteMergeHighlightEffect = StateEffect.define();
const documentChangesEffect = StateEffect.define();

const documentSearchDecorations = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(documentSearchEffect)) {
        return buildDocumentSearchDecorations(transaction.state, effect.value);
      }
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const remoteMergeHighlightDecorations = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(remoteMergeHighlightEffect)) {
        return buildRemoteMergeHighlightDecorations(transaction.state, effect.value);
      }
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const documentChangesState = StateField.define({
  create(state) {
    return buildDocumentChangesState(state, {
      available: false,
      baselineSource: "",
      showDeletions: false,
      locale: "en",
    });
  },
  update(value, transaction) {
    let config = value.config;
    let changed = transaction.docChanged;
    for (const effect of transaction.effects) {
      if (effect.is(documentChangesEffect)) {
        config = {
          ...config,
          ...effect.value,
        };
        changed = true;
      }
    }
    return changed ? buildDocumentChangesState(transaction.state, config) : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
  ],
});

const deletedLinesLineNumberMarker = lineNumberWidgetMarker.of((_view, widget) => (
  widget instanceof DeletedLinesWidget
    ? new DeletedLinesNumberMarker(widget.lines, widget.locale)
    : null
));

const selectedLineGutterClasses = StateField.define({
  create() {
    return Decoration.none;
  },
  update(gutterClasses, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(selectedLinesEffect)) {
        return buildSelectedLineGutterClasses(transaction.state, effect.value);
      }
    }

    return gutterClasses.map(transaction.changes);
  },
  provide: (field) => gutterLineClass.from(field),
});

const selectedLineGutterMarker = new class extends GutterMarker {
  elementClass = "cm-source-line-selected";

  eq(other) {
    return other === this;
  }
}();

class DeletedLinesNumberMarker extends GutterMarker {
  elementClass = "cm-deleted-lines-number-gutter";

  constructor(lines, locale) {
    super();
    this.lines = lines;
    this.locale = locale;
  }

  eq(other) {
    return other instanceof DeletedLinesNumberMarker &&
      other.locale === this.locale &&
      JSON.stringify(other.lines) === JSON.stringify(this.lines);
  }

  toDOM() {
    const container = document.createElement("span");
    container.className = "cm-deleted-lines-numbers";
    for (const line of this.lines) {
      const row = document.createElement("span");
      row.className = "cm-deleted-line-number-row";
      row.textContent = "−";
      row.setAttribute(
        "aria-label",
        changeMessage(this.locale, "deletedLine", { line: line.number }),
      );
      container.append(row);
    }
    return container;
  }
}

class DeletedInlineTextWidget extends WidgetType {
  constructor(text, locale) {
    super();
    this.text = text;
    this.locale = locale;
  }

  eq(other) {
    return other instanceof DeletedInlineTextWidget &&
      other.text === this.text &&
      other.locale === this.locale;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-document-deleted-inline";
    element.textContent = this.text || "\u200b";
    element.setAttribute(
      "aria-label",
      changeMessage(this.locale, "deletedText", { text: this.text }),
    );
    return element;
  }
}

class DeletedLinesWidget extends WidgetType {
  constructor(lines, locale) {
    super();
    this.lines = lines;
    this.locale = locale;
  }

  eq(other) {
    return other instanceof DeletedLinesWidget &&
      other.locale === this.locale &&
      JSON.stringify(other.lines) === JSON.stringify(this.lines);
  }

  toDOM() {
    const container = document.createElement("div");
    container.className = "cm-document-deleted-lines";
    for (const line of this.lines) {
      const row = document.createElement("div");
      row.className = "cm-document-deleted-line";
      row.textContent = line.text || "\u200b";
      row.setAttribute(
        "aria-label",
        `${changeMessage(this.locale, "deletedLine", { line: line.number })}: ${line.text}`,
      );
      container.append(row);
    }
    return container;
  }
}

function buildDocumentChangesState(state, config) {
  const model = config.available
    ? createDocumentChangeModel({
        baselineSource: config.baselineSource,
        currentSource: state.doc.toString(),
      })
    : emptyDocumentChangeModel();
  const showDeletions = config.showDeletions === true && model.hasDeletions;
  return {
    config,
    model,
    showDeletions,
    decorations: buildDocumentChangeDecorations(state, model, {
      showDeletions,
      locale: config.locale,
    }),
  };
}

function buildDocumentChangeDecorations(state, model, { showDeletions, locale }) {
  if (!model.changed) {
    return Decoration.none;
  }
  const ranges = [];
  const lineStateByNumber = new Map(model.currentLines.map((line) => [line.line, line]));
  for (const lineNumber of model.changedLines) {
    if (lineNumber < 1 || lineNumber > state.doc.lines) {
      continue;
    }
    const line = state.doc.line(lineNumber);
    const kind = lineStateByNumber.get(lineNumber)?.kind ?? "modified";
    ranges.push(Decoration.line({
      attributes: {
        class: `cm-document-change-line is-${kind}`,
      },
    }).range(line.from));
  }
  for (const range of model.textRanges) {
    const from = Math.max(0, Math.min(state.doc.length, range.from));
    const to = Math.max(from, Math.min(state.doc.length, range.to));
    if (to > from) {
      ranges.push(Decoration.mark({
        class: `cm-document-change-text is-${range.kind}`,
      }).range(from, to));
    }
  }
  if (showDeletions) {
    for (const deletion of model.inlineDeletions) {
      const at = Math.max(0, Math.min(state.doc.length, deletion.at));
      ranges.push(Decoration.widget({
        widget: new DeletedInlineTextWidget(deletion.text, locale),
        side: -1,
      }).range(at));
    }
    for (const deletion of model.lineDeletions) {
      const at = Math.max(0, Math.min(state.doc.length, deletion.at));
      ranges.push(Decoration.widget({
        widget: new DeletedLinesWidget(deletion.lines, locale),
        block: true,
        side: deletion.beforeLine > model.currentLines.length ? 1 : -1,
      }).range(at));
    }
  }
  return Decoration.set(ranges, true);
}

function changeMessage(locale, key, values = {}) {
  const messages = String(locale ?? "").toLowerCase().startsWith("zh")
    ? SOURCE_EDITOR_CHANGE_MESSAGES["zh-CN"]
    : SOURCE_EDITOR_CHANGE_MESSAGES.en;
  return String(messages[key] ?? key).replace(/\{(\w+)\}/g, (_match, name) => (
    Object.hasOwn(values, name) ? String(values[name]) : ""
  ));
}

function themeFromInput(theme) {
  return String(theme ?? "").trim().toLowerCase() === "dark" ? "dark" : "light";
}

function isDarkTheme(theme) {
  return themeFromInput(theme) === "dark";
}

function editorThemeExtensions(theme) {
  return [
    sourceEditorThemeForTheme(theme),
    sourceSelectionThemeForTheme(theme),
  ];
}

function sourceEditorThemeForTheme(theme) {
  return EditorView.theme({
    "&.cm-editor": {
      backgroundColor: "var(--panel)",
      color: "var(--text)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      backgroundColor: "var(--panel)",
      paddingLeft: "var(--source-line-gutter-inset)",
    },
    ".cm-content": {
      caretColor: "var(--text)",
      paddingLeft: "var(--source-line-gutter-gap)",
    },
    ".cm-gutters": {
      minWidth: "var(--source-line-gutter-width)",
      backgroundColor: "transparent",
      borderRightColor: "transparent",
      boxSizing: "border-box",
      color: "var(--source-line-number-color)",
    },
    ".cm-lineNumbers": {
      boxSizing: "border-box",
      minWidth: "var(--source-line-gutter-width)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      boxSizing: "border-box",
      fontSize: "var(--source-line-number-font-size)",
      lineHeight: "var(--source-line-number-line-height)",
      minHeight: "var(--source-line-number-height)",
      minWidth: "var(--source-line-gutter-width)",
      padding: "0 var(--source-line-number-padding)",
      textAlign: "right",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--panel-weak)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--panel-weak)",
    },
    "& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "var(--text-selection-bg)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--text)",
    },
  }, { dark: isDarkTheme(theme) });
}

function sourceSelectionThemeForTheme(theme) {
  return EditorView.theme({
    ".cm-lineNumbers .cm-gutterElement.cm-source-line-selected": {
      backgroundColor: "var(--selection-bg)",
      borderRadius: "4px",
      boxShadow: "0 0 0 2px var(--selection-ring)",
      color: "var(--selection-text)",
      fontWeight: "750",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      boxSizing: "border-box",
      cursor: "pointer",
      fontSize: "var(--source-line-number-font-size)",
      lineHeight: "var(--source-line-number-line-height)",
      minHeight: "var(--source-line-number-height)",
      minWidth: "var(--source-line-gutter-width)",
      padding: "0 var(--source-line-number-padding)",
      textAlign: "right",
    },
  }, { dark: isDarkTheme(theme) });
}

function liveMarkdownThemeForTheme(theme) {
  return EditorView.theme({
    "&.cm-editor": {
      backgroundColor: "var(--panel)",
      color: "var(--text)",
    },
    ".cm-content": {
      color: "var(--text)",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "var(--document-font-size)",
      lineHeight: "var(--document-line-height)",
      paddingLeft: "var(--source-line-gutter-gap)",
      paddingTop: "var(--document-top-padding)",
    },
    ".cm-scroller": {
      paddingLeft: "var(--source-line-gutter-inset)",
    },
    ".cm-lineNumbers": {
      transform: "translateY(calc(var(--source-line-number-height) * -1))",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      fontSize: "var(--source-line-number-font-size)",
      lineHeight: "var(--source-line-number-line-height)",
      minHeight: "var(--source-line-number-height)",
      minWidth: "var(--source-line-gutter-width)",
      padding: "0 var(--source-line-number-padding)",
      textAlign: "right",
    },
    ".cm-line": {
      fontSize: "var(--document-font-size)",
      lineHeight: "var(--document-line-height)",
      padding: "0 var(--document-inline-padding) 0 0",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    "&.cm-focused .cm-activeLine": {
      backgroundColor: "var(--panel-weak)",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRightColor: "transparent",
      boxSizing: "border-box",
      color: "var(--source-line-number-color)",
      minWidth: "var(--source-line-gutter-width)",
    },
    ".cm-line.cm-live-heading": {
      paddingTop: "0.45em",
      paddingBottom: "0.16em",
    },
    ".cm-live-frontmatter": {
      color: "var(--text-secondary)",
      backgroundColor: "var(--panel-weak)",
      boxShadow: "inset 1px 0 0 var(--panel-border)",
    },
    ".cm-live-frontmatter, .cm-live-frontmatter *": {
      color: "var(--text-secondary)",
    },
    ".cm-live-frontmatter-key": {
      color: "var(--accent-text)",
      fontWeight: "720",
    },
    ".cm-live-frontmatter-value": {
      color: "var(--text)",
    },
    ".cm-live-heading": {
      color: "var(--text-strong)",
      fontWeight: "700",
    },
    ".cm-live-heading-1": {
      fontSize: "var(--document-heading-1-size)",
      lineHeight: "var(--document-heading-line-height)",
    },
    ".cm-live-heading-2": {
      borderBottom: "var(--document-heading-border)",
      fontSize: "var(--document-heading-2-size)",
      lineHeight: "var(--document-heading-line-height)",
      paddingBottom: "var(--document-heading-2-padding-bottom)",
    },
    ".cm-live-heading-3": {
      fontSize: "var(--document-heading-3-size)",
      lineHeight: "var(--document-heading-line-height)",
    },
    ".cm-live-blockquote": {
      color: "var(--text-secondary)",
      borderLeft: "4px solid var(--accent)",
      backgroundColor: "var(--panel-weak)",
      paddingLeft: "16px",
    },
    ".cm-live-code": {
      color: "var(--text)",
      border: "1px solid var(--panel-border)",
      borderRadius: "8px",
      backgroundColor: "var(--code-bg)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    },
    ".cm-live-marker": {
      color: "var(--text-secondary)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      opacity: "0.9",
    },
    ".cm-live-marker *": {
      color: "inherit",
    },
    ".cm-activeLine .cm-live-marker": {
      opacity: "1",
    },
    ".cm-live-replacement-widget": {
      color: "var(--text)",
    },
    ".cm-live-list-widget": {
      display: "inline-flex",
      alignItems: "center",
      boxSizing: "border-box",
      color: "var(--text)",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "var(--document-list-ordered-marker-font-size)",
      fontWeight: "720",
      lineHeight: "inherit",
      marginRight: "var(--document-list-marker-gap)",
    },
    ".cm-live-list-widget.is-unordered": {
      fontSize: "var(--document-font-size)",
    },
    ".cm-live-list-widget.is-unordered::before": {
      content: "\"•\"",
      display: "inline-block",
      width: "1em",
      fontSize: "var(--document-list-unordered-marker-font-size)",
      lineHeight: "1",
      textAlign: "center",
    },
    ".cm-live-strong": {
      color: "var(--text-strong)",
      fontWeight: "700",
    },
    ".cm-live-strong *": {
      color: "inherit",
    },
    ".cm-live-emphasis": {
      fontStyle: "italic",
    },
    ".cm-live-inline-code": {
      borderRadius: "4px",
      backgroundColor: "var(--code-bg)",
      color: "var(--text-strong)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: "0.92em",
      padding: "2px 5px",
    },
    ".cm-live-inline-code *": {
      color: "inherit",
    },
    ".cm-live-link-text": {
      color: "var(--accent-text)",
      cursor: "pointer",
      textDecoration: "underline",
      textUnderlineOffset: "3px",
    },
    ".cm-live-link-destination": {
      opacity: "0.78",
    },
    ".cm-line.cm-live-horizontal-rule": {
      color: "var(--accent-text)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontWeight: "800",
    },
    ".cm-line.cm-live-horizontal-rule, .cm-line.cm-live-horizontal-rule *": {
      color: "var(--accent-text)",
    },
    ".cm-line.cm-live-horizontal-rule::after": {
      content: "\"\"",
      display: "inline-block",
      width: "160px",
      marginLeft: "12px",
      borderTop: "2px solid var(--accent-hover)",
      boxShadow: "0 0 0 1px var(--accent-tint)",
      verticalAlign: "middle",
    },
    ".cm-line.cm-live-mdx-component": {
      backgroundColor: "var(--panel-weak)",
      color: "var(--text-secondary)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: "14px",
      boxShadow: "inset 4px 0 0 var(--accent-hover)",
    },
    ".cm-line.cm-live-mdx-component-start::before": {
      content: "attr(data-live-component)",
      display: "block",
      margin: "10px 0 6px",
      border: "1px solid var(--accent)",
      borderRadius: "6px",
      backgroundColor: "var(--accent-soft)",
      color: "var(--accent-text)",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "14px",
      fontWeight: "760",
      lineHeight: "1.35",
      padding: "9px 11px",
    },
    ".cm-live-block-preview": {
      boxSizing: "border-box",
      width: "100%",
      padding: "10px var(--document-inline-padding) 16px 0",
    },
    ".cm-live-block-preview-card": {
      boxSizing: "border-box",
      width: "100%",
      color: "var(--text)",
    },
    ".cm-live-block-preview .source-line-gutter": {
      display: "none",
    },
    ".cm-live-block-preview .source-block": {
      display: "block",
      padding: "0",
    },
    ".cm-live-block-preview .source-block-content": {
      display: "block",
      margin: "0",
    },
    ".cm-live-block-preview .table-toolbar": {
      display: "none",
    },
    ".cm-live-block-preview .table-card": {
      margin: "0",
    },
    ".cm-live-block-preview .mdx-component": {
      margin: "0",
    },
    ".cm-live-block-preview .mermaid-diagram": {
      margin: "0",
    },
    ".cm-live-block-preview .mdx-component-title,\n.cm-live-block-preview .mdx-chart figcaption,\n.cm-live-block-preview .mdx-flow-diagram figcaption": {
      color: "var(--text-strong)",
    },
    ".cm-live-block-preview .mdx-chart svg": {
      maxWidth: "100%",
      height: "auto",
    },
    ".cm-live-block-preview .git-leaf-image-frame": {
      margin: "0",
    },
    ".cm-live-block-preview .git-leaf-image-frame img": {
      maxWidth: "100%",
      height: "auto",
    },
  }, { dark: isDarkTheme(theme) });
}

export function createSourceEditor({
  parent,
  doc = "",
  locale,
  language,
  onChange,
  onFocusChange,
  onScroll,
  onLineSelect,
  onBlankClick,
  onImageClick,
  onLinkClick,
  onFrontmatterClick,
  onContextToolbarSelect = () => {},
  onPasteImage,
  onPasteText,
  onSlashCommand,
  theme = "light",
  getDocumentPath = () => "",
  getRenderOptions = () => ({}),
  onBeforeSlashCommand = async () => true,
}) {
  let suppressChange = false;
  let currentMode = "source";
  let currentTheme = themeFromInput(theme);
  let currentEditable = true;
  let remoteMergeHighlightTimer = null;
  let view = null;
  const editorDocument = parent?.ownerDocument ?? globalThis.document;
  const themeCompartment = new Compartment();
  const liveModeCompartment = new Compartment();
  const editableCompartment = new Compartment();
  let componentInteraction = null;
  const tableInteraction = createLiveTableInteraction({
    getView: () => view,
    getMode: () => currentMode,
    isEditable: () => currentEditable,
    locale: locale ?? language,
    documentRoot: editorDocument,
    onSelect: () => {
      componentInteraction?.clearSelection();
      onContextToolbarSelect();
    },
  });
  componentInteraction = createLiveMdxComponentInteraction({
    getView: () => view,
    getMode: () => currentMode,
    isEditable: () => currentEditable,
    locale: locale ?? language,
    documentRoot: editorDocument,
    onSelect: () => {
      tableInteraction.clearSelection();
      onContextToolbarSelect();
    },
  });
  function liveModeExtensions() {
    return currentMode === "live"
      ? [
          liveRenderOptionsFacet.of(getRenderOptions()),
          liveTableInteractionFacet.of(tableInteraction),
          liveMdxComponentInteractionFacet.of(componentInteraction),
          liveEditingSuppression,
          liveMarkdownDecorations,
          liveMarkdownThemeForTheme(currentTheme),
        ]
      : [];
  }

  view = new EditorView({
    doc,
    extensions: [
      sourceEditorSetup,
      markdown(),
      EditorView.lineWrapping,
      selectedLineGutterClasses,
      documentSearchDecorations,
      remoteMergeHighlightDecorations,
      documentChangesState,
      deletedLinesLineNumberMarker,
      themeCompartment.of(editorThemeExtensions(currentTheme)),
      liveModeCompartment.of([]),
      editableCompartment.of([
        EditorState.readOnly.of(false),
        EditorView.editable.of(true),
      ]),
      autocompletion({
        override: [
          slashCommandCompletionSource({
            locale,
            language,
            getDocumentPath,
            onBeforeSlashCommand,
            onSlashCommand,
          }),
        ],
        icons: false,
      }),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged) {
          onFocusChange?.(update.view.hasFocus);
        }
        if (!update.docChanged || suppressChange) {
          return;
        }
        onChange?.(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        keydown(event, eventView) {
          if (
            (currentMode === "source" || currentMode === "live") &&
            event.key === "/" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            setTimeout(() => startCompletion(eventView), 0);
            return false;
          }

          if (currentMode === "live" && event.key === "Tab") {
            if (adjustCurrentListItemIndent(eventView, event.shiftKey ? "outdent" : "indent")) {
              event.preventDefault();
              return true;
            }
            return false;
          }

          if (currentMode !== "live" || event.key !== "Escape") {
            return false;
          }

          if (tableInteraction.hasSelection()) {
            event.preventDefault();
            tableInteraction.clearSelection();
            return true;
          }

          if (componentInteraction.hasSelection()) {
            event.preventDefault();
            componentInteraction.clearSelection();
            return true;
          }

          event.preventDefault();
          eventView.dispatch({
            effects: livePreviewExitEffect.of(true),
          });
          eventView.contentDOM.blur();
          return true;
        },
        focusin(_event, eventView) {
          if (currentMode !== "live") {
            return false;
          }

          eventView.dispatch({
            effects: livePreviewEnterEffect.of(true),
          });
          return false;
        },
        paste(event, eventView) {
          const imageFile = clipboardImageFile(event.clipboardData);
          if (!imageFile || typeof onPasteImage !== "function") {
            const text = pastedTextLinkCandidate(event.clipboardData?.getData("text/plain"));
            if (!text || typeof onPasteText !== "function") {
              return false;
            }

            event.preventDefault();
            void pasteTextAsLinkIntoEditor(eventView, text, onPasteText);
            return true;
          }

          event.preventDefault();
          void pasteImageIntoEditor(eventView, imageFile, onPasteImage);
          return true;
        },
      }),
    ],
    parent,
  });
  const handleMouseDown = (event) => {
    const sourceLine = lineNumberFromGutterEvent(event, view);
    if (Number.isInteger(sourceLine)) {
      event.preventDefault();
      onLineSelect?.(sourceLine, event);
      return;
    }

    if (currentMode !== "live") {
      return;
    }

    const liveTable = closestElement(event.target, ".cm-live-block-preview-table");
    if (liveTable) {
      if (!closestElement(event.target, ".cm-live-table-cell-editor")) {
        event.preventDefault();
      }
      return;
    }

    const link = liveMarkdownLinkFromMouseEvent(event, view);
    if (link) {
      event.preventDefault();
      event.stopPropagation();
      onLinkClick?.({ ...link, event });
      return;
    }

    const field = liveFrontmatterFieldFromMouseEvent(event, view);
    if (field) {
      event.preventDefault();
      event.stopPropagation();
      onFrontmatterClick?.({ ...field, event });
      return;
    }

    const image = closestElement(event.target, "[data-git-leaf-image]");
    if (image) {
      const block = image.closest(".cm-live-block-preview");
      const line = Number(block?.dataset.liveBlockStart);
      if (!Number.isInteger(line)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onImageClick?.({ line, image, event });
      return;
    }

    if (isLiveBlankClick(event)) {
      tableInteraction.clearSelection();
      componentInteraction.clearSelection();
      onBlankClick?.(event);
    }
  };
  const visibleLine = () => {
    const scrollRect = view.scrollDOM.getBoundingClientRect();
    const pos = view.posAtCoords({
      x: scrollRect.left + 64,
      y: scrollRect.top + 8,
    });
    return Number.isInteger(pos) ? view.state.doc.lineAt(pos).number : null;
  };
  const handleScroll = () => {
    tableInteraction.refreshPositions();
    componentInteraction.refreshPositions();
    const line = visibleLine();
    onScroll?.({
      scrollTop: view.scrollDOM.scrollTop,
      scrollHeight: view.scrollDOM.scrollHeight,
      clientHeight: view.scrollDOM.clientHeight,
      visibleLine: line,
    });
  };
  view.dom.addEventListener("pointerdown", componentInteraction.handlePointerDown, true);
  view.dom.addEventListener("pointerdown", tableInteraction.handlePointerDown, true);
  view.dom.addEventListener("pointermove", tableInteraction.handlePointerMove, true);
  view.dom.addEventListener("pointerup", tableInteraction.handlePointerUp, true);
  view.dom.addEventListener("pointercancel", tableInteraction.handlePointerCancel, true);
  editorDocument?.addEventListener?.(
    "pointerup",
    tableInteraction.handleDocumentPointerUp,
    true,
  );
  editorDocument?.addEventListener?.(
    "pointercancel",
    tableInteraction.handleDocumentPointerCancel,
    true,
  );
  editorDocument?.addEventListener?.(
    "pointerdown",
    componentInteraction.handleDocumentPointerDown,
    true,
  );
  editorDocument?.addEventListener?.(
    "keydown",
    componentInteraction.handleKeyDown,
    true,
  );
  view.dom.addEventListener("keydown", tableInteraction.handleKeyDown, true);
  view.dom.addEventListener("mousedown", handleMouseDown, true);
  view.scrollDOM.addEventListener("scroll", handleScroll);
  globalThis.addEventListener?.("resize", tableInteraction.refreshPositions);
  globalThis.addEventListener?.("resize", componentInteraction.refreshPositions);

  return {
    getValue() {
      return view.state.doc.toString();
    },
    setDocumentChangeBaseline({
      source = "",
      available = false,
      showDeletions = false,
    } = {}) {
      view.dispatch({
        effects: documentChangesEffect.of({
          available: available === true,
          baselineSource: String(source ?? ""),
          showDeletions: showDeletions === true,
          locale: locale ?? language ?? "en",
        }),
      });
    },
    setShowDeletedChanges(showDeletions) {
      view.dispatch({
        effects: documentChangesEffect.of({
          showDeletions: showDeletions === true,
        }),
      });
    },
    setValue(value, { preserveSelection = false, highlightChanges = false } = {}) {
      const nextValue = String(value ?? "");
      const currentValue = view.state.doc.toString();
      if (currentValue === nextValue) {
        return;
      }
      tableInteraction.cancelEditor();
      tableInteraction.clearSelection({ commit: false });
      componentInteraction.clearSelection();
      const changes = preserveSelection
        ? minimalDocumentChange(currentValue, nextValue)
        : {
            from: 0,
            to: view.state.doc.length,
            insert: nextValue,
          };
      suppressChange = true;
      try {
        view.dispatch({
          changes,
          effects: remoteMergeHighlightEffect.of(
            highlightChanges
              ? {
                  from: changes.from,
                  to: changes.from + String(changes.insert ?? "").length,
                }
              : null,
          ),
        });
      } finally {
        suppressChange = false;
      }
      if (highlightChanges) {
        globalThis.clearTimeout(remoteMergeHighlightTimer);
        remoteMergeHighlightTimer = globalThis.setTimeout(() => {
          remoteMergeHighlightTimer = null;
          view.dispatch({
            effects: remoteMergeHighlightEffect.of(null),
          });
        }, 2_400);
      } else {
        globalThis.clearTimeout(remoteMergeHighlightTimer);
        remoteMergeHighlightTimer = null;
      }
    },
    focus() {
      view.focus();
    },
    hasFocus() {
      return view.hasFocus;
    },
    selectedText() {
      const range = view.state.selection.main;
      return range.empty ? "" : view.state.sliceDoc(range.from, range.to);
    },
    findMatches(query) {
      return findTextMatches(view.state.doc.toString(), query);
    },
    setSearchMatches(matches, activeIndex, { reveal = false } = {}) {
      const effects = [documentSearchEffect.of({ matches, activeIndex })];
      const activeMatch = matches?.[activeIndex];
      if (reveal && activeMatch) {
        effects.push(EditorView.scrollIntoView(activeMatch.from, { y: "center" }));
      }
      view.dispatch({ effects });
    },
    clearSearchMatches() {
      view.dispatch({
        effects: documentSearchEffect.of({ matches: [], activeIndex: -1 }),
      });
    },
    setMode(mode) {
      if (currentMode === "live" && mode !== "live") {
        tableInteraction.commitEditor();
        tableInteraction.clearSelection({ commit: false });
        componentInteraction.clearSelection();
      }
      currentMode = mode;
      view.dispatch({
        effects: liveModeCompartment.reconfigure(liveModeExtensions()),
      });
    },
    setEditable(editable) {
      const nextEditable = editable !== false;
      if (nextEditable === currentEditable) {
        return;
      }
      if (!nextEditable) {
        tableInteraction.commitEditor();
        componentInteraction.clearSelection();
      }
      currentEditable = nextEditable;
      view.dispatch({
        effects: editableCompartment.reconfigure([
          EditorState.readOnly.of(!currentEditable),
          EditorView.editable.of(currentEditable),
        ]),
      });
    },
    setTheme(theme) {
      const nextTheme = themeFromInput(theme);
      if (nextTheme === currentTheme) {
        return;
      }
      currentTheme = nextTheme;
      view.dispatch({
        effects: [
          themeCompartment.reconfigure(editorThemeExtensions(currentTheme)),
          liveModeCompartment.reconfigure(liveModeExtensions()),
        ],
      });
    },
    scrollToLine(lineNumber) {
      if (!Number.isInteger(lineNumber)) {
        return;
      }
      const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, lineNumber)));
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      });
    },
    visibleLine() {
      return visibleLine();
    },
    setSelectedLines(lines) {
      view.dispatch({
        effects: selectedLinesEffect.of([...new Set(lines)].filter(Number.isInteger)),
      });
    },
    clearLiveContextSelection() {
      tableInteraction.clearSelection();
      componentInteraction.clearSelection();
    },
    replaceLine(lineNumber, text, { preserveSelection = false } = {}) {
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) {
        return false;
      }

      const line = view.state.doc.line(lineNumber);
      const transaction = {
        changes: {
          from: line.from,
          to: line.to,
          insert: String(text ?? ""),
        },
        scrollIntoView: true,
      };
      if (!preserveSelection) {
        transaction.selection = {
          anchor: line.from + String(text ?? "").length,
        };
      }
      view.dispatch(transaction);
      return true;
    },
    lineRect(lineNumber) {
      if (!Number.isInteger(lineNumber)) {
        return null;
      }

      const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, lineNumber)));
      const coords = view.coordsAtPos(line.from);
      if (!coords) {
        return null;
      }

      const gutterRect = view.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
      return {
        left: gutterRect?.left ?? coords.left,
        top: coords.top,
        height: Math.max(coords.bottom - coords.top, 1),
      };
    },
    imageElement(lineNumber) {
      if (!Number.isInteger(lineNumber)) {
        return null;
      }

      return view.dom.querySelector(
        `.cm-live-block-preview[data-live-block-start="${lineNumber}"] [data-git-leaf-image]`,
      );
    },
    linkElement(lineNumber, from, to) {
      if (!Number.isInteger(lineNumber) || !Number.isInteger(from) || !Number.isInteger(to)) {
        return null;
      }

      return view.dom.querySelector(
        [
          ".cm-live-link-text",
          "[data-live-link=\"true\"]",
          `[data-live-line="${lineNumber}"]`,
          `[data-live-link-from="${from}"]`,
          `[data-live-link-to="${to}"]`,
        ].join(""),
      );
    },
    frontmatterFieldElement(lineNumber, key) {
      if (!Number.isInteger(lineNumber) || !key) {
        return null;
      }

      return view.dom.querySelector(
        [
          ".cm-live-frontmatter-token",
          `[data-live-line="${lineNumber}"]`,
          `[data-live-frontmatter-key="${cssEscape(String(key))}"]`,
        ].join(""),
      );
    },
    replaceDocument(value) {
      const nextValue = String(value ?? "");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: nextValue,
        },
        scrollIntoView: true,
      });
      return true;
    },
    deleteLine(lineNumber) {
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) {
        return false;
      }

      const line = view.state.doc.line(lineNumber);
      const to = lineNumber < view.state.doc.lines
        ? view.state.doc.line(lineNumber + 1).from
        : line.to;
      view.dispatch({
        changes: { from: line.from, to },
        scrollIntoView: true,
      });
      return true;
    },
    destroy() {
      globalThis.clearTimeout(remoteMergeHighlightTimer);
      tableInteraction.commitEditor();
      tableInteraction.destroy();
      componentInteraction.destroy();
      view.dom.removeEventListener("pointerdown", componentInteraction.handlePointerDown, true);
      view.dom.removeEventListener("pointerdown", tableInteraction.handlePointerDown, true);
      view.dom.removeEventListener("pointermove", tableInteraction.handlePointerMove, true);
      view.dom.removeEventListener("pointerup", tableInteraction.handlePointerUp, true);
      view.dom.removeEventListener("pointercancel", tableInteraction.handlePointerCancel, true);
      editorDocument?.removeEventListener?.(
        "pointerup",
        tableInteraction.handleDocumentPointerUp,
        true,
      );
      editorDocument?.removeEventListener?.(
        "pointercancel",
        tableInteraction.handleDocumentPointerCancel,
        true,
      );
      editorDocument?.removeEventListener?.(
        "pointerdown",
        componentInteraction.handleDocumentPointerDown,
        true,
      );
      editorDocument?.removeEventListener?.(
        "keydown",
        componentInteraction.handleKeyDown,
        true,
      );
      view.dom.removeEventListener("keydown", tableInteraction.handleKeyDown, true);
      view.dom.removeEventListener("mousedown", handleMouseDown, true);
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      globalThis.removeEventListener?.("resize", tableInteraction.refreshPositions);
      globalThis.removeEventListener?.("resize", componentInteraction.refreshPositions);
      view.destroy();
    },
  };
}

export function isVerticalTableColumnSelection(selection) {
  return Boolean(
    selection &&
    selection.minColumn === selection.maxColumn &&
    selection.minRow < selection.maxRow
  );
}

export function liveMdxToolbarControlDefinitions(component, attributes = {}) {
  if (component === "DataTable") {
    return [
      liveMdxToggleControl("search", "search", "datatable.search", attributes.search),
      liveMdxToggleControl(
        "freeze",
        "freezeFirstColumn",
        "datatable.freeze",
        attributes.freezeFirstColumn ?? attributes.freeze,
      ),
      liveMdxToggleControl(
        "sticky",
        "stickyHeader",
        "datatable.sticky",
        attributes.stickyHeader ?? attributes.sticky,
      ),
      liveMdxToggleControl(
        "copy",
        "copyCsv",
        "datatable.copy",
        attributes.copyCsv ?? attributes.copy,
      ),
    ];
  }

  if (component === "Chart") {
    const configuredType = String(attributes.type ?? "").trim().toLowerCase();
    return [
      {
        kind: "select",
        id: "type",
        attribute: "type",
        labelKey: "chart.type",
        value: LIVE_MDX_CHART_TYPES.includes(configuredType) ? configuredType : "",
        options: ["", ...LIVE_MDX_CHART_TYPES].map((value) => ({
          value,
          labelKey: `chart.type.${value || "auto"}`,
        })),
      },
      {
        kind: "toggle",
        id: "labels",
        attribute: "labels",
        labelKey: "chart.labels",
        pressed: String(attributes.labels ?? "").trim().toLowerCase() !== "none",
        enabledValue: null,
        disabledValue: "none",
      },
    ];
  }

  if (component === "DecisionBox") {
    const configuredStatus = String(
      attributes.status ?? attributes.decisionStatus ?? "",
    ).trim().toLowerCase();
    return [
      {
        kind: "select",
        id: "status",
        attribute: "status",
        aliases: ["decisionStatus"],
        labelKey: "decision.status",
        value: LIVE_MDX_DECISION_STATUSES.includes(configuredStatus)
          ? configuredStatus
          : "",
        options: ["", ...LIVE_MDX_DECISION_STATUSES].map((value) => ({
          value,
          labelKey: `decision.status.${value || "none"}`,
        })),
      },
    ];
  }

  return [];
}

function liveMdxToggleControl(id, attribute, labelKey, currentValue) {
  return {
    kind: "toggle",
    id,
    attribute,
    labelKey,
    pressed: liveMdxBooleanValue(currentValue),
    enabledValue: "true",
    disabledValue: "false",
  };
}

function liveMdxBooleanValue(value) {
  return ["true", "1", "yes", "on"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

export function updateMdxLiteComponentAttributes(source, updates = {}) {
  let nextSource = String(source ?? "");
  for (const [name, value] of Object.entries(updates)) {
    nextSource = updateMdxLiteComponentAttribute(nextSource, name, value);
  }
  return nextSource;
}

function updateMdxLiteComponentAttribute(source, name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
    return source;
  }
  if (value !== null && (String(value).includes('"') || /[\r\n]/.test(String(value)))) {
    return source;
  }

  const lines = String(source ?? "").split(/\r?\n/);
  const opening = mdxLiteComponentOpeningAtLines(lines, 0);
  if (!opening) {
    return source;
  }

  const openingLines = lines.slice(0, opening.endIndex + 1);
  const attributePattern = new RegExp(
    `(^|\\s+)(${escapeRegularExpression(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))`,
  );
  for (let index = 0; index < openingLines.length; index += 1) {
    const line = openingLines[index];
    const match = attributePattern.exec(line);
    if (!match) {
      continue;
    }

    const replacement = value === null
      ? ""
      : `${match[1]}${name}="${String(value)}"`;
    const updatedLine = [
      line.slice(0, match.index),
      replacement,
      line.slice(match.index + match[0].length),
    ].join("");
    if (!updatedLine.trim()) {
      openingLines.splice(index, 1);
    } else {
      openingLines[index] = updatedLine;
    }
    return [...openingLines, ...lines.slice(opening.endIndex + 1)].join("\n");
  }

  if (value === null) {
    return source;
  }

  const serialized = `${name}="${String(value)}"`;
  const closingIndex = openingLines.length - 1;
  const closingLine = openingLines[closingIndex];
  if (/^\s*\/?>\s*$/.test(closingLine)) {
    const attributeIndent = openingLines
      .slice(1, -1)
      .map((line) => line.match(/^(\s+)\S/)?.[1])
      .find(Boolean) ?? closingLine.match(/^(\s+)/)?.[1] ?? "  ";
    openingLines.splice(closingIndex, 0, `${attributeIndent}${serialized}`);
  } else {
    openingLines[closingIndex] = closingLine.replace(
      /(\s*\/?>\s*)$/,
      ` ${serialized}$1`,
    );
  }
  return [...openingLines, ...lines.slice(opening.endIndex + 1)].join("\n");
}

function escapeRegularExpression(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createLiveMdxComponentInteraction({
  getView,
  getMode,
  isEditable,
  locale,
  documentRoot = globalThis.document,
  onSelect = () => {},
}) {
  const translate = createTranslator(SOURCE_EDITOR_COMPONENT_MESSAGES, locale);
  let selection = null;
  let refreshHandle = null;

  const selectionContainer = () => {
    const view = getView();
    if (!view || !selection) {
      return null;
    }
    return view.dom.querySelector(
      `.cm-live-block-preview-mdx[data-live-block-start="${selection.startLine}"]`,
    );
  };

  const refreshNow = () => {
    const view = getView();
    if (!view) {
      return;
    }
    for (const container of view.dom.querySelectorAll(".cm-live-block-preview-mdx")) {
      const selected = Boolean(
        selection &&
        Number(container.dataset.liveBlockStart) === selection.startLine,
      );
      container.classList.toggle("is-selected", selected);
      const toolbar = container.querySelector(".cm-live-component-toolbar");
      if (toolbar) {
        toolbar.hidden = !selected || !isEditable();
      }
    }

    const container = selectionContainer();
    const toolbar = container?.querySelector(".cm-live-component-toolbar");
    if (!container || !toolbar || toolbar.hidden) {
      return;
    }
    const card = container.querySelector(".cm-live-block-preview-card");
    positionFloatingControl(toolbar, card?.getBoundingClientRect(), {
      placement: "table-top",
      offset: 10,
      documentRoot,
    });
  };

  const scheduleRefresh = () => {
    if (refreshHandle !== null) {
      return;
    }
    const schedule = globalThis.requestAnimationFrame ??
      ((callback) => globalThis.setTimeout(callback, 0));
    refreshHandle = schedule(() => {
      refreshHandle = null;
      refreshNow();
    });
  };

  const clearSelection = () => {
    if (!selection) {
      return;
    }
    selection = null;
    refreshNow();
  };

  const editSource = (container = selectionContainer()) => {
    const view = getView();
    const startLine = Number(container?.dataset.liveBlockStart);
    const endLine = Number(container?.dataset.liveBlockEnd);
    if (
      !view ||
      getMode() !== "live" ||
      !isEditable() ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine > view.state.doc.lines
    ) {
      return false;
    }

    const start = view.state.doc.line(startLine);
    selection = null;
    refreshNow();
    view.dispatch({
      selection: { anchor: start.to },
      effects: livePreviewEnterEffect.of(true),
      scrollIntoView: true,
    });
    view.focus();
    return true;
  };

  const applyAttributes = (container, updates) => {
    const view = getView();
    const startLine = Number(container?.dataset.liveBlockStart);
    const endLine = Number(container?.dataset.liveBlockEnd);
    if (
      !view ||
      getMode() !== "live" ||
      !isEditable() ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine > view.state.doc.lines
    ) {
      return false;
    }

    const start = view.state.doc.line(startLine);
    const end = view.state.doc.line(endLine);
    const source = view.state.sliceDoc(start.from, end.to);
    const nextSource = updateMdxLiteComponentAttributes(source, updates);
    if (nextSource === source) {
      return false;
    }
    view.dispatch({
      changes: { from: start.from, to: end.to, insert: nextSource },
    });
    scheduleRefresh();
    return true;
  };

  const handlePointerDown = (event) => {
    if (getMode() !== "live") {
      return false;
    }

    const container = closestElement(event.target, ".cm-live-block-preview-mdx");
    if (!container) {
      clearSelection();
      return false;
    }
    const startLine = Number(container.dataset.liveBlockStart);
    if (liveMdxTargetIsEmbeddedViewControl(event.target)) {
      if (selection && selection.startLine !== startLine) {
        clearSelection();
      }
      return true;
    }
    if (closestElement(event.target, ".cm-live-component-toolbar")) {
      return true;
    }

    if (!Number.isInteger(startLine) || !isEditable()) {
      return false;
    }
    const changed = !selection || selection.startLine !== startLine;
    selection = {
      startLine,
      component: container.dataset.liveMdxComponent || "",
    };
    if (changed) {
      onSelect(selection);
    }
    if (!isLiveMdxNativeControl(event.target)) {
      event.preventDefault();
    }
    refreshNow();
    return true;
  };

  const handleKeyDown = (event) => {
    if (getMode() !== "live" || event.key !== "Escape" || !selection) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    clearSelection();
    return true;
  };

  const handleDocumentPointerDown = (event) => {
    if (!selection) {
      return false;
    }
    const view = getView();
    if (view?.dom?.contains?.(event.target)) {
      return false;
    }
    clearSelection();
    return true;
  };

  const mount = (container, block) => {
    if (block.type !== "mdx") {
      return;
    }
    container.dataset.liveMdxComponent = block.component || "";
    prepareLiveMdxComponentToolbar({
      container,
      block,
      translate,
      documentRoot,
      applyAttributes,
      editSource,
      clearSelection,
    });
    scheduleRefresh();
  };

  const destroy = () => {
    if (refreshHandle !== null) {
      const cancel = globalThis.cancelAnimationFrame ?? globalThis.clearTimeout;
      cancel?.(refreshHandle);
      refreshHandle = null;
    }
    selection = null;
  };

  return {
    mount,
    handlePointerDown,
    handleDocumentPointerDown,
    handleKeyDown,
    refreshPositions: scheduleRefresh,
    hasSelection: () => Boolean(selection),
    clearSelection,
    editSource,
    applyAttributes,
    destroy,
  };
}

function prepareLiveMdxComponentToolbar({
  container,
  block,
  translate,
  documentRoot,
  applyAttributes,
  editSource,
  clearSelection,
}) {
  if (container.querySelector(".cm-live-component-toolbar")) {
    return;
  }

  const toolbar = documentRoot.createElement("div");
  toolbar.className = "live-edit-toolbar cm-live-component-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", translate("toolbar.label"));
  toolbar.hidden = true;
  toolbar.addEventListener("pointerdown", (event) => event.stopPropagation());

  const label = documentRoot.createElement("span");
  label.className = "live-edit-toolbar-label cm-live-component-toolbar-label";
  label.textContent = block.component || "MDX";
  toolbar.append(label, createLiveMdxToolbarSeparator(documentRoot));

  for (const control of liveMdxToolbarControlDefinitions(
    block.component,
    block.attributes,
  )) {
    if (control.kind === "toggle") {
      const button = createLiveMdxToolbarButton(
        documentRoot,
        translate(control.labelKey),
        translate(control.labelKey),
      );
      button.dataset.liveComponentControl = control.id;
      button.setAttribute("aria-pressed", String(control.pressed));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyAttributes(container, {
          [control.attribute]: control.pressed
            ? control.disabledValue
            : control.enabledValue,
        });
      });
      toolbar.append(button);
      continue;
    }

    if (control.kind === "select") {
      const select = documentRoot.createElement("select");
      select.className = "live-edit-toolbar-control cm-live-component-toolbar-select";
      select.dataset.liveComponentControl = control.id;
      select.setAttribute("aria-label", translate(control.labelKey));
      select.title = translate(control.labelKey);
      for (const optionDefinition of control.options) {
        const option = documentRoot.createElement("option");
        option.value = optionDefinition.value;
        option.textContent = translate(optionDefinition.labelKey);
        select.append(option);
      }
      select.value = control.value;
      select.addEventListener("change", (event) => {
        event.stopPropagation();
        const updates = {
          [control.attribute]: select.value || null,
        };
        for (const alias of control.aliases ?? []) {
          updates[alias] = null;
        }
        applyAttributes(container, updates);
      });
      toolbar.append(select);
      continue;
    }
  }

  toolbar.append(createLiveMdxToolbarSeparator(documentRoot));
  const sourceButton = createLiveMdxToolbarButton(
    documentRoot,
    translate("toolbar.source"),
    "</>",
  );
  sourceButton.dataset.liveComponentAction = "edit-source";
  sourceButton.classList.add("is-source");
  sourceButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    editSource(container);
  });
  toolbar.append(sourceButton);

  const closeButton = createLiveMdxToolbarButton(
    documentRoot,
    translate("toolbar.close"),
    "×",
  );
  closeButton.dataset.liveComponentAction = "close";
  closeButton.classList.add("live-edit-toolbar-close", "is-close");
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearSelection();
  });
  toolbar.append(closeButton);
  container.append(toolbar);
}

function createLiveMdxToolbarButton(documentRoot, label, text) {
  const button = documentRoot.createElement("button");
  button.type = "button";
  button.className = "live-edit-toolbar-button cm-live-component-toolbar-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = text;
  return button;
}

function createLiveMdxToolbarSeparator(documentRoot) {
  const separator = documentRoot.createElement("span");
  separator.className = "live-edit-toolbar-separator cm-live-component-toolbar-separator";
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

function isLiveMdxNativeControl(target) {
  return ["button", "a", "input", "select", "textarea", '[role="button"]']
    .some((selector) => Boolean(closestElement(target, selector)));
}

export function liveMdxTargetIsEmbeddedViewControl(target) {
  return [
    "[data-dataset-granularity]",
    "[data-table-search]",
    "[data-table-freeze]",
    "[data-table-copy]",
  ].some((selector) => Boolean(closestElement(target, selector)));
}

export function createLiveTableInteraction({
  getView,
  getMode,
  isEditable,
  locale,
  documentRoot = globalThis.document,
  onSelect = () => {},
}) {
  const translate = createTranslator(SOURCE_EDITOR_TABLE_MESSAGES, locale);
  let selection = null;
  let pointerSelection = null;
  let activeEditor = null;
  let columnDrag = null;
  let refreshHandle = null;

  const scheduleRefresh = () => {
    if (refreshHandle !== null) {
      return;
    }
    const schedule = globalThis.requestAnimationFrame ??
      ((callback) => globalThis.setTimeout(callback, 0));
    refreshHandle = schedule(() => {
      refreshHandle = null;
      refreshNow();
    });
  };

  const refreshPositions = () => {
    scheduleRefresh();
  };

  const currentTableBlock = (startLine) => {
    const view = getView();
    if (
      !view ||
      !Number.isInteger(startLine) ||
      startLine < 1 ||
      startLine > view.state.doc.lines
    ) {
      return null;
    }

    const lines = view.state.doc.toString().split("\n");
    const block = markdownTableBlockAtLines(lines, startLine - 1);
    if (!block) {
      return null;
    }

    const endLine = block.endIndex + 1;
    return {
      ...block,
      startLine,
      endLine,
      from: view.state.doc.line(startLine).from,
      to: view.state.doc.line(endLine).to,
    };
  };

  const dispatchTableSource = (block, source) => {
    const view = getView();
    const nextSource = String(source ?? "");
    if (!view || !block || nextSource === block.source) {
      scheduleRefresh();
      return false;
    }
    view.dispatch({
      changes: {
        from: block.from,
        to: block.to,
        insert: nextSource,
      },
    });
    scheduleRefresh();
    return true;
  };

  const normalizedSelection = (block = currentTableBlock(selection?.startLine)) => {
    if (!selection || !block) {
      return null;
    }
    return normalizeMarkdownTableSelection(selection, block.table);
  };

  const selectionContainer = () => {
    const view = getView();
    if (!view || !selection) {
      return null;
    }
    return view.dom.querySelector(
      `.cm-live-block-preview-table[data-live-block-start="${selection.startLine}"]`,
    );
  };

  const cellElement = (startLine, row, column) => {
    const view = getView();
    if (!view) {
      return null;
    }
    return view.dom.querySelector(
      [
        `.cm-live-block-preview-table[data-live-block-start="${startLine}"] `,
        '[data-live-table-cell="true"]',
        `[data-live-table-row="${row}"]`,
        `[data-live-table-column="${column}"]`,
      ].join(""),
    );
  };

  const cellInfo = (target) => {
    const cell = closestElement(target, '[data-live-table-cell="true"]');
    const container = cell?.closest(".cm-live-block-preview-table");
    const startLine = Number(container?.dataset.liveBlockStart);
    const row = Number(cell?.dataset.liveTableRow);
    const column = Number(cell?.dataset.liveTableColumn);
    if (
      !cell ||
      !container ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(row) ||
      !Number.isInteger(column)
    ) {
      return null;
    }
    return { cell, container, startLine, row, column };
  };

  const isInsideEditorView = (target) => {
    const root = getView()?.dom;
    return Boolean(
      root &&
      target &&
      (target === root || root.contains?.(target))
    );
  };

  const focusEditorView = () => {
    const view = getView();
    if (view?.contentDOM?.focus) {
      view.contentDOM.focus({ preventScroll: true });
      return;
    }
    view?.focus?.();
  };

  const restoreEditorCell = (editor) => {
    if (editor?.cell?.isConnected) {
      editor.cell.innerHTML = editor.renderedHtml;
      editor.cell.classList.remove("is-editing");
    }
  };

  const cancelEditor = () => {
    if (!activeEditor) {
      return false;
    }
    const editor = activeEditor;
    activeEditor = null;
    restoreEditorCell(editor);
    scheduleRefresh();
    return true;
  };

  const adjacentCell = (block, row, column, direction) => {
    const currentIndex = row * block.table.columnCount + column;
    const nextIndex = currentIndex + direction;
    const cellCount = block.table.rowCount * block.table.columnCount;
    if (nextIndex < 0 || nextIndex >= cellCount) {
      return null;
    }
    return {
      row: Math.floor(nextIndex / block.table.columnCount),
      column: nextIndex % block.table.columnCount,
    };
  };

  const beginCellEditor = () => {
    if (!isEditable() || getMode() !== "live" || !selection) {
      return false;
    }
    const block = currentTableBlock(selection.startLine);
    const normalized = normalizedSelection(block);
    if (
      !block ||
      !normalized ||
      normalized.minRow !== normalized.maxRow ||
      normalized.minColumn !== normalized.maxColumn
    ) {
      return false;
    }

    cancelEditor();
    const row = normalized.minRow;
    const column = normalized.minColumn;
    const cell = cellElement(selection.startLine, row, column);
    const sourceCell = block.table.visualRows[row]?.cells[column];
    if (!cell || !sourceCell) {
      return false;
    }

    const input = documentRoot.createElement("input");
    input.type = "text";
    input.className = "cm-live-table-cell-editor";
    input.value = sourceCell.content;
    input.setAttribute("aria-label", translate("cell.edit"));
    input.autocomplete = "off";
    input.spellcheck = false;
    const editor = {
      startLine: selection.startLine,
      row,
      column,
      cell,
      input,
      renderedHtml: cell.innerHTML,
    };
    activeEditor = editor;
    cell.classList.add("is-editing");
    cell.replaceChildren(input);

    const stopPointerPropagation = (event) => {
      event.stopPropagation();
    };
    input.addEventListener("pointerdown", stopPointerPropagation);
    input.addEventListener("mousedown", stopPointerPropagation);
    input.addEventListener("click", stopPointerPropagation);
    input.addEventListener("keydown", (event) => {
      if (!["Escape", "Enter", "Tab"].includes(event.key)) {
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        clearSelection({ commit: false });
        return;
      }

      const move = event.key === "Tab"
        ? (event.shiftKey ? -1 : 1)
        : 0;
      commitEditor({ move });
    });
    input.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (activeEditor?.input === input) {
          commitEditor();
        }
      });
    });
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    scheduleRefresh();
    return true;
  };

  const commitEditor = ({ move = 0 } = {}) => {
    if (!activeEditor) {
      return false;
    }

    const editor = activeEditor;
    activeEditor = null;
    const block = currentTableBlock(editor.startLine);
    if (!block) {
      restoreEditorCell(editor);
      scheduleRefresh();
      return false;
    }

    const nextCell = move
      ? adjacentCell(block, editor.row, editor.column, move)
      : null;
    const replacement = replaceMarkdownTableCell(
      block.source,
      editor.row,
      editor.column,
      editor.input.value,
    );
    if (!replacement) {
      restoreEditorCell(editor);
      scheduleRefresh();
      return false;
    }

    if (nextCell) {
      selection = {
        startLine: editor.startLine,
        anchorRow: nextCell.row,
        anchorColumn: nextCell.column,
        focusRow: nextCell.row,
        focusColumn: nextCell.column,
      };
    }

    if (replacement.changed) {
      dispatchTableSource(block, replacement.source);
    } else {
      restoreEditorCell(editor);
      scheduleRefresh();
    }

    if (nextCell) {
      const schedule = globalThis.requestAnimationFrame ??
        ((callback) => globalThis.setTimeout(callback, 0));
      schedule(() => beginCellEditor());
    }
    return true;
  };

  const clearSelection = ({ commit = true } = {}) => {
    if (commit) {
      commitEditor();
    } else {
      cancelEditor();
    }
    closeLiveTableToolbarMenus(getView()?.dom);
    pointerSelection = null;
    columnDrag = null;
    selection = null;
    scheduleRefresh();
  };

  const applySelectionTransform = (transform) => {
    if (!selection || !isEditable()) {
      return false;
    }
    commitEditor();
    const block = currentTableBlock(selection.startLine);
    const result = block ? transform(block) : null;
    if (!block || !result) {
      return false;
    }
    closeLiveTableToolbarMenus(getView()?.dom);
    if (result.changed) {
      dispatchTableSource(block, result.source);
    } else {
      scheduleRefresh();
    }
    return true;
  };

  const applyTextColor = (color) =>
    applySelectionTransform((block) =>
      applyMarkdownTableTextColor(block.source, selection, color));

  const applyHighlightColor = (color) =>
    applySelectionTransform((block) =>
      applyMarkdownTableHighlightColor(block.source, selection, color));

  const applyTextStyle = (style) =>
    applySelectionTransform((block) => {
      const state = markdownTableSelectionFormatState(
        block.source,
        selection,
      );
      return applyMarkdownTableTextStyle(
        block.source,
        selection,
        style,
        state?.[style] !== true,
      );
    });

  const clearTextFormatting = () =>
    applySelectionTransform((block) =>
      clearMarkdownTableTextFormatting(block.source, selection));

  const applyAlignment = (alignment) =>
    applySelectionTransform((block) =>
      alignMarkdownTableColumns(block.source, selection, alignment));

  const toggleToolbarMenu = (button) => {
    const toolbar = button.closest(".cm-live-table-format-toolbar");
    const menuName = button.dataset.liveTableMenuToggle;
    const menu = toolbar?.querySelector(
      `[data-live-table-palette="${menuName}"]`,
    );
    if (!toolbar || !menu) {
      return false;
    }

    const shouldOpen = menu.hidden;
    closeLiveTableToolbarMenus(toolbar);
    if (shouldOpen) {
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      positionLiveTablePalette(menu);
    }
    return true;
  };

  const nearestHeaderColumn = (startLine, clientX) => {
    const container = getView()?.dom.querySelector(
      `.cm-live-block-preview-table[data-live-block-start="${startLine}"]`,
    );
    const headerCells = [
      ...(container?.querySelectorAll(
        '[data-live-table-cell="true"][data-live-table-row="0"]',
      ) ?? []),
    ];
    let nearest = null;
    for (const cell of headerCells) {
      const rect = cell.getBoundingClientRect();
      const distance = Math.abs(clientX - (rect.left + rect.width / 2));
      const column = Number(cell.dataset.liveTableColumn);
      if (
        Number.isInteger(column) &&
        (!nearest || distance < nearest.distance)
      ) {
        nearest = { column, distance };
      }
    }
    return nearest?.column ?? null;
  };

  const beginColumnDrag = (event, handle) => {
    const block = currentTableBlock(selection?.startLine);
    const normalized = normalizedSelection(block);
    if (!block || !isVerticalTableColumnSelection(normalized)) {
      return false;
    }

    columnDrag = {
      pointerId: event.pointerId,
      startLine: selection.startLine,
      fromColumn: normalized.minColumn,
      targetColumn: normalized.minColumn,
      handle,
      selection: { ...selection },
    };
    handle.classList.add("is-dragging");
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // The handle may be replaced only after a successful drop.
    }
    refreshNow();
    return true;
  };

  const finishColumnDrag = (apply) => {
    if (!columnDrag) {
      return false;
    }
    const drag = columnDrag;
    columnDrag = null;
    drag.handle?.classList.remove("is-dragging");
    if (!apply || drag.fromColumn === drag.targetColumn) {
      scheduleRefresh();
      return true;
    }

    const block = currentTableBlock(drag.startLine);
    const result = reorderMarkdownTableColumn(
      block?.source,
      drag.fromColumn,
      drag.targetColumn,
    );
    if (!block || !result) {
      scheduleRefresh();
      return false;
    }

    selection = {
      ...drag.selection,
      startLine: drag.startLine,
      anchorColumn: drag.targetColumn,
      focusColumn: drag.targetColumn,
    };
    if (result.changed) {
      dispatchTableSource(block, result.source);
    } else {
      scheduleRefresh();
    }
    return true;
  };

  const handlePointerDown = (event) => {
    if (getMode() !== "live") {
      return;
    }

    const toolbarClose = closestElement(
      event.target,
      "[data-live-table-toolbar-close]",
    );
    if (toolbarClose) {
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
      return;
    }

    const editorInput = closestElement(
      event.target,
      ".cm-live-table-cell-editor",
    );
    if (editorInput) {
      const info = cellInfo(editorInput);
      if (!info || event.button !== 0) {
        return;
      }
      pointerSelection = {
        pointerId: event.pointerId,
        startLine: info.startLine,
        anchorRow: info.row,
        anchorColumn: info.column,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        startedInEditor: true,
      };
      return;
    }

    const menuButton = closestElement(
      event.target,
      "[data-live-table-menu-toggle]",
    );
    if (menuButton) {
      event.preventDefault();
      event.stopPropagation();
      toggleToolbarMenu(menuButton);
      return;
    }

    const formatButton = closestElement(
      event.target,
      "[data-live-table-format-action]",
    );
    if (formatButton) {
      event.preventDefault();
      event.stopPropagation();
      const action = formatButton.dataset.liveTableFormatAction;
      if (action === "clear") {
        clearTextFormatting();
      } else {
        applyTextStyle(action);
      }
      return;
    }

    const colorButton = closestElement(
      event.target,
      "[data-live-table-color-action]",
    );
    if (colorButton) {
      event.preventDefault();
      event.stopPropagation();
      const action = colorButton.dataset.liveTableColorAction;
      applyTextColor(action === "clear" ? null : action);
      return;
    }

    const highlightButton = closestElement(
      event.target,
      "[data-live-table-highlight-action]",
    );
    if (highlightButton) {
      event.preventDefault();
      event.stopPropagation();
      const action = highlightButton.dataset.liveTableHighlightAction;
      applyHighlightColor(action === "clear" ? null : action);
      return;
    }

    const alignmentButton = closestElement(
      event.target,
      "[data-live-table-align-action]",
    );
    if (alignmentButton) {
      event.preventDefault();
      event.stopPropagation();
      applyAlignment(alignmentButton.dataset.liveTableAlignAction);
      return;
    }

    const columnHandle = closestElement(
      event.target,
      "[data-live-table-column-handle]",
    );
    if (columnHandle) {
      event.preventDefault();
      event.stopPropagation();
      if (isEditable()) {
        beginColumnDrag(event, columnHandle);
      }
      return;
    }

    const info = cellInfo(event.target);
    if (!info || event.button !== 0) {
      if (!info && event.button === 0 && selection) {
        clearSelection();
      }
      return;
    }

    closeLiveTableToolbarMenus(getView()?.dom);
    event.preventDefault();
    event.stopPropagation();
    if (
      activeEditor &&
      (
        activeEditor.startLine !== info.startLine ||
        activeEditor.row !== info.row ||
        activeEditor.column !== info.column
      )
    ) {
      commitEditor();
    }

    selection = {
      startLine: info.startLine,
      anchorRow: info.row,
      anchorColumn: info.column,
      focusRow: info.row,
      focusColumn: info.column,
    };
    onSelect(selection);
    pointerSelection = {
      pointerId: event.pointerId,
      startLine: info.startLine,
      anchorRow: info.row,
      anchorColumn: info.column,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try {
      info.cell.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a convenience; elementFromPoint still tracks the drag.
    }
    refreshNow();
  };

  const handlePointerMove = (event) => {
    if (columnDrag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const column = nearestHeaderColumn(columnDrag.startLine, event.clientX);
      if (
        Number.isInteger(column) &&
        column !== columnDrag.targetColumn
      ) {
        columnDrag.targetColumn = column;
        refreshNow();
      }
      return;
    }

    if (pointerSelection?.pointerId !== event.pointerId) {
      return;
    }
    const target = documentRoot.elementFromPoint(event.clientX, event.clientY);
    const info = cellInfo(target);
    if (pointerSelection.startedInEditor && !pointerSelection.moved) {
      const crossedIntoAnotherCell =
        info?.startLine === pointerSelection.startLine &&
        (
          info.row !== pointerSelection.anchorRow ||
          info.column !== pointerSelection.anchorColumn
        );
      if (!crossedIntoAnotherCell) {
        return;
      }
      pointerSelection.moved = true;
      try {
        getView()?.dom.setPointerCapture?.(event.pointerId);
      } catch {
        // Keep following the drag when supported; elementFromPoint remains the fallback.
      }
      commitEditor();
    }

    event.preventDefault();
    event.stopPropagation();
    const distance = Math.hypot(
      event.clientX - pointerSelection.startX,
      event.clientY - pointerSelection.startY,
    );
    if (distance >= 4) {
      pointerSelection.moved = true;
    }
    if (!info || info.startLine !== pointerSelection.startLine) {
      return;
    }

    if (
      info.row !== selection?.focusRow ||
      info.column !== selection?.focusColumn
    ) {
      pointerSelection.moved = true;
      selection = {
        ...selection,
        focusRow: info.row,
        focusColumn: info.column,
      };
      refreshNow();
    }
  };

  const handlePointerUp = (event) => {
    if (columnDrag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      finishColumnDrag(true);
      return;
    }

    if (pointerSelection?.pointerId !== event.pointerId) {
      return;
    }
    if (pointerSelection.startedInEditor && !pointerSelection.moved) {
      pointerSelection = null;
      scheduleRefresh();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const shouldEdit = !pointerSelection.moved && isEditable();
    const shouldFocusEditor = pointerSelection.moved;
    pointerSelection = null;
    refreshNow();
    if (shouldEdit) {
      beginCellEditor();
    } else if (shouldFocusEditor) {
      focusEditorView();
    }
  };

  const handlePointerCancel = (event) => {
    if (columnDrag?.pointerId === event.pointerId) {
      finishColumnDrag(false);
      return;
    }
    if (pointerSelection?.pointerId === event.pointerId) {
      pointerSelection = null;
      scheduleRefresh();
    }
  };

  const handleDocumentPointerUp = (event) => {
    if (isInsideEditorView(event.target)) {
      return;
    }
    handlePointerUp(event);
  };

  const handleDocumentPointerCancel = (event) => {
    if (isInsideEditorView(event.target)) {
      return;
    }
    handlePointerCancel(event);
  };

  const handleKeyDown = (event) => {
    if (
      getMode() !== "live" ||
      event.key !== "Escape" ||
      !selection ||
      (
        !isInsideEditorView(event.target) &&
        !isInsideEditorView(documentRoot?.activeElement)
      )
    ) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    clearSelection({ commit: false });
    return true;
  };

  const refreshNow = () => {
    const view = getView();
    if (!view) {
      return;
    }
    const containers = [
      ...view.dom.querySelectorAll(".cm-live-block-preview-table"),
    ];
    for (const container of containers) {
      const cells = [
        ...container.querySelectorAll('[data-live-table-cell="true"]'),
      ];
      for (const cell of cells) {
        cell.classList.remove("is-selected", "is-column-drop-target");
        cell.setAttribute("aria-selected", "false");
        const row = Number(cell.dataset.liveTableRow);
        const column = Number(cell.dataset.liveTableColumn);
        cell.classList.toggle(
          "is-editing",
          activeEditor?.startLine === Number(container.dataset.liveBlockStart) &&
            activeEditor?.row === row &&
            activeEditor?.column === column,
        );
      }

      const toolbar = container.querySelector(".cm-live-table-color-toolbar");
      const handle = container.querySelector(".cm-live-table-column-handle");
      if (toolbar) {
        toolbar.hidden = true;
      }
      if (handle) {
        handle.hidden = true;
        handle.classList.remove("is-dragging");
      }
    }

    if (!selection) {
      return;
    }
    const block = currentTableBlock(selection.startLine);
    const normalized = normalizedSelection(block);
    const container = selectionContainer();
    if (!block || !normalized || !container) {
      return;
    }

    const selectedCells = [];
    for (const cell of container.querySelectorAll('[data-live-table-cell="true"]')) {
      const row = Number(cell.dataset.liveTableRow);
      const column = Number(cell.dataset.liveTableColumn);
      const selected =
        row >= normalized.minRow &&
        row <= normalized.maxRow &&
        column >= normalized.minColumn &&
        column <= normalized.maxColumn;
      if (selected) {
        cell.classList.add("is-selected");
        cell.setAttribute("aria-selected", "true");
        selectedCells.push(cell);
      }
      if (
        columnDrag?.startLine === selection.startLine &&
        column === columnDrag.targetColumn
      ) {
        cell.classList.add("is-column-drop-target");
      }
    }

    const toolbar = container.querySelector(".cm-live-table-color-toolbar");
    if (toolbar && selectedCells.length > 0 && isEditable()) {
      updateLiveTableToolbar(
        toolbar,
        markdownTableSelectionFormatState(block.source, selection),
      );
      toolbar.hidden = false;
      const table = container.querySelector(".cm-live-table");
      positionFloatingControl(toolbar, table?.getBoundingClientRect(), {
        placement: "table-top",
        offset: 14,
        documentRoot,
      });
    }

    const handle = container.querySelector(".cm-live-table-column-handle");
    const headerCell = cellElement(
      selection.startLine,
      0,
      normalized.minColumn,
    );
    if (
      handle &&
      headerCell &&
      isVerticalTableColumnSelection(normalized) &&
      isEditable()
    ) {
      handle.hidden = false;
      handle.dataset.liveTableColumn = String(normalized.minColumn);
      handle.classList.toggle("is-dragging", Boolean(columnDrag));
      positionFloatingControl(handle, headerCell.getBoundingClientRect(), {
        placement: "edge",
        offset: 0,
        documentRoot,
      });
    }
  };

  const mount = (container, block) => {
    if (block.type !== "table") {
      return;
    }
    prepareLiveTablePreview(container, block, translate);
    container.querySelector(".table-scroll")?.addEventListener(
      "scroll",
      refreshPositions,
      { passive: true },
    );
    scheduleRefresh();
  };

  const destroy = () => {
    if (refreshHandle !== null) {
      const cancel = globalThis.cancelAnimationFrame ?? globalThis.clearTimeout;
      cancel?.(refreshHandle);
      refreshHandle = null;
    }
    cancelEditor();
    selection = null;
    pointerSelection = null;
    columnDrag = null;
  };

  return {
    mount,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleDocumentPointerUp,
    handleDocumentPointerCancel,
    handleKeyDown,
    refreshPositions,
    hasSelection: () => Boolean(selection),
    clearSelection,
    commitEditor,
    cancelEditor,
    destroy,
  };
}

function prepareLiveTablePreview(container, block, translate) {
  const parsed = parseMarkdownTable(block.source);
  const table = container.querySelector(".table-card table");
  if (!parsed || !table) {
    return false;
  }

  const domRows = [
    ...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr"),
  ];
  if (domRows.length !== parsed.rowCount) {
    return false;
  }

  container.classList.add("cm-live-block-preview-table");
  table.classList.add("cm-live-table");
  for (const [rowIndex, row] of domRows.entries()) {
    const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
    if (cells.length !== parsed.columnCount) {
      container.classList.remove("cm-live-block-preview-table");
      return false;
    }
    for (const [columnIndex, cell] of cells.entries()) {
      cell.dataset.liveTableCell = "true";
      cell.dataset.liveTableRow = String(rowIndex);
      cell.dataset.liveTableColumn = String(columnIndex);
      cell.setAttribute("aria-selected", "false");
    }
  }

  const toolbar = document.createElement("div");
  toolbar.className =
    "live-edit-toolbar cm-live-table-format-toolbar cm-live-table-color-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", translate("toolbar.label"));
  toolbar.hidden = true;

  for (const style of ["bold", "italic", "strikethrough"]) {
    const button = createLiveTableToolbarButton(
      translate(`format.${style}`),
      style === "bold" ? "B" : (style === "italic" ? "I" : "S"),
      `is-${style}`,
    );
    button.dataset.liveTableFormatAction = style;
    button.setAttribute("aria-pressed", "false");
    toolbar.append(button);
  }

  toolbar.append(createLiveTableToolbarSeparator());
  toolbar.append(
    createLiveTablePaletteControl({
      kind: "text-color",
      label: translate("palette.textColor"),
      clearLabel: translate("color.clear"),
      palette: MARKDOWN_TABLE_TEXT_COLORS,
      translateColor: (name) => translate(`color.${name}`),
    }),
    createLiveTablePaletteControl({
      kind: "highlight",
      label: translate("palette.highlight"),
      clearLabel: translate("highlight.clear"),
      palette: MARKDOWN_TABLE_HIGHLIGHT_COLORS,
      translateColor: (name) => translate(`highlight.${name}`),
    }),
  );

  toolbar.append(createLiveTableToolbarSeparator());
  for (const alignment of ["left", "center", "right"]) {
    const button = createLiveTableToolbarButton(
      translate(`align.${alignment}`),
    );
    button.classList.add("cm-live-table-align-button");
    button.dataset.liveTableAlignAction = alignment;
    button.setAttribute("aria-pressed", "false");
    button.append(createLiveTableAlignmentIcon(alignment));
    toolbar.append(button);
  }

  toolbar.append(createLiveTableToolbarSeparator());
  const clearButton = createLiveTableToolbarButton(
    translate("format.clear"),
    "Tx",
    "is-clear-format",
  );
  clearButton.dataset.liveTableFormatAction = "clear";
  toolbar.append(clearButton);

  const closeButton = createLiveTableToolbarButton(
    translate("toolbar.close"),
    "×",
    "cm-live-table-toolbar-close",
  );
  closeButton.dataset.liveTableToolbarClose = "true";
  closeButton.classList.add("live-edit-toolbar-close");
  toolbar.append(closeButton);

  const columnHandle = document.createElement("button");
  columnHandle.type = "button";
  columnHandle.className = "cm-live-table-column-handle";
  columnHandle.dataset.liveTableColumnHandle = "true";
  columnHandle.setAttribute("aria-label", translate("column.drag"));
  columnHandle.title = translate("column.drag");
  columnHandle.textContent = "⠿";
  columnHandle.hidden = true;

  container.append(toolbar, columnHandle);
  return true;
}

function createLiveTableToolbarButton(label, text = "", modifier = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "live-edit-toolbar-button cm-live-table-format-button";
  if (modifier) {
    button.classList.add(modifier);
  }
  button.setAttribute("aria-label", label);
  button.title = label;
  if (text) {
    const symbol = document.createElement("span");
    symbol.className = "cm-live-table-format-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = text;
    button.append(symbol);
  }
  return button;
}

function createLiveTableToolbarSeparator() {
  const separator = document.createElement("span");
  separator.className = "live-edit-toolbar-separator cm-live-table-format-separator";
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

function createLiveTablePaletteControl({
  kind,
  label,
  clearLabel,
  palette,
  translateColor,
}) {
  const wrapper = document.createElement("span");
  wrapper.className = "cm-live-table-palette-control";

  const trigger = createLiveTableToolbarButton(label);
  trigger.classList.add("cm-live-table-palette-trigger", `is-${kind}`);
  trigger.dataset.liveTableMenuToggle = kind;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const symbol = document.createElement("span");
  symbol.className = "cm-live-table-palette-symbol";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = "A";
  const chevron = document.createElement("span");
  chevron.className = "cm-live-table-palette-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  trigger.append(symbol, chevron);

  const menu = document.createElement("span");
  menu.className = `cm-live-table-palette is-${kind}`;
  menu.dataset.liveTablePalette = kind;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.hidden = true;

  for (const color of palette) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-live-table-swatch-button";
    if (kind === "text-color") {
      button.dataset.liveTableColorAction = color.value;
    } else {
      button.dataset.liveTableHighlightAction = color.value;
    }
    button.style.setProperty("--live-table-swatch", color.value);
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", "false");
    button.setAttribute("aria-label", translateColor(color.name));
    button.title = translateColor(color.name);
    menu.append(button);
  }

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className =
    "cm-live-table-swatch-button cm-live-table-swatch-clear";
  if (kind === "text-color") {
    clearButton.dataset.liveTableColorAction = "clear";
  } else {
    clearButton.dataset.liveTableHighlightAction = "clear";
  }
  clearButton.setAttribute("role", "menuitemradio");
  clearButton.setAttribute("aria-checked", "true");
  clearButton.setAttribute("aria-label", clearLabel);
  clearButton.title = clearLabel;
  clearButton.textContent = "×";
  menu.append(clearButton);

  wrapper.append(trigger, menu);
  return wrapper;
}

function createLiveTableAlignmentIcon(alignment) {
  const icon = document.createElement("span");
  icon.className = `cm-live-table-align-icon is-${alignment}`;
  icon.setAttribute("aria-hidden", "true");
  for (const width of [14, 9, 14, 11]) {
    const line = document.createElement("span");
    line.style.width = `${width}px`;
    icon.append(line);
  }
  return icon;
}

function closeLiveTableToolbarMenus(root) {
  for (const menu of root?.querySelectorAll?.(
    "[data-live-table-palette]",
  ) ?? []) {
    menu.hidden = true;
  }
  for (const trigger of root?.querySelectorAll?.(
    "[data-live-table-menu-toggle]",
  ) ?? []) {
    trigger.setAttribute("aria-expanded", "false");
  }
}

function positionLiveTablePalette(menu) {
  menu.classList.remove("opens-below");
  if (menu.getBoundingClientRect().top < 8) {
    menu.classList.add("opens-below");
  }
}

function updateLiveTableToolbar(toolbar, state) {
  if (!toolbar || !state) {
    return;
  }

  for (const button of toolbar.querySelectorAll(
    "[data-live-table-format-action]",
  )) {
    const action = button.dataset.liveTableFormatAction;
    if (action !== "clear") {
      updateLiveTablePressedState(button, state[action]);
    }
  }
  for (const button of toolbar.querySelectorAll(
    "[data-live-table-align-action]",
  )) {
    const alignment = button.dataset.liveTableAlignAction;
    updateLiveTablePressedState(
      button,
      state.alignment === alignment
        ? true
        : (
            state.alignment === "mixed" &&
            state.alignments?.includes(alignment)
              ? "mixed"
              : false
          ),
    );
  }

  updateLiveTablePaletteState(toolbar, "text-color", state.color);
  updateLiveTablePaletteState(
    toolbar,
    "highlight",
    state.backgroundColor,
  );
}

function updateLiveTablePressedState(button, value) {
  const pressed = value === "mixed" ? "mixed" : String(value === true);
  button.setAttribute("aria-pressed", pressed);
  button.classList.toggle("is-mixed", value === "mixed");
}

function updateLiveTablePaletteState(toolbar, kind, value) {
  const trigger = toolbar.querySelector(
    `[data-live-table-menu-toggle="${kind}"]`,
  );
  const menu = toolbar.querySelector(`[data-live-table-palette="${kind}"]`);
  if (!trigger || !menu) {
    return;
  }

  const attribute = kind === "text-color"
    ? "liveTableColorAction"
    : "liveTableHighlightAction";
  const activeValue = typeof value === "string" && value !== "mixed"
    ? value
    : null;
  trigger.classList.toggle("has-value", Boolean(activeValue));
  trigger.classList.toggle("is-mixed", value === "mixed");
  if (activeValue) {
    trigger.style.setProperty("--live-table-active-swatch", activeValue);
  } else {
    trigger.style.removeProperty("--live-table-active-swatch");
  }

  for (const button of menu.querySelectorAll(".cm-live-table-swatch-button")) {
    const action = button.dataset[attribute];
    const checked = action === "clear"
      ? value === null
      : action === activeValue;
    button.setAttribute("aria-checked", String(checked));
  }
}

function positionFloatingControl(
  element,
  anchorRect,
  {
    placement = "above",
    offset = 8,
    documentRoot = globalThis.document,
  } = {},
) {
  if (!element || !anchorRect) {
    return;
  }

  element.style.visibility = "hidden";
  element.hidden = false;
  const controlRect = element.getBoundingClientRect();
  const viewportWidth =
    globalThis.innerWidth ??
    documentRoot?.documentElement?.clientWidth ??
    controlRect.width;
  const viewportHeight =
    globalThis.innerHeight ??
    documentRoot?.documentElement?.clientHeight ??
    controlRect.height;
  let left = anchorRect.left + (anchorRect.width - controlRect.width) / 2;
  let top;

  if (placement === "edge") {
    top = anchorRect.top - controlRect.height / 2;
  } else if (placement === "table-top") {
    top = Math.max(8, anchorRect.top - controlRect.height - offset);
  } else {
    top = anchorRect.top - controlRect.height - offset;
    if (top < 8) {
      top = anchorRect.bottom + offset;
    }
  }

  left = Math.max(8, Math.min(left, viewportWidth - controlRect.width - 8));
  top = Math.max(8, Math.min(top, viewportHeight - controlRect.height - 8));
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  element.style.visibility = "";
}

export function minimalDocumentChange(currentValue, nextValue) {
  const current = String(currentValue ?? "");
  const next = String(nextValue ?? "");
  let from = 0;
  const sharedLength = Math.min(current.length, next.length);
  while (from < sharedLength && current.charCodeAt(from) === next.charCodeAt(from)) {
    from += 1;
  }

  let currentTo = current.length;
  let nextTo = next.length;
  while (
    currentTo > from
    && nextTo > from
    && current.charCodeAt(currentTo - 1) === next.charCodeAt(nextTo - 1)
  ) {
    currentTo -= 1;
    nextTo -= 1;
  }

  return {
    from,
    to: currentTo,
    insert: next.slice(from, nextTo),
  };
}

function buildRemoteMergeHighlightDecorations(state, range) {
  if (!range) {
    return Decoration.none;
  }
  const documentLength = state.doc.length;
  const from = Math.min(documentLength, Math.max(0, Number(range.from) || 0));
  const to = Math.min(documentLength, Math.max(from, Number(range.to) || from));
  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);
  const decorations = [];
  for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
    decorations.push(
      Decoration.line({ class: "cm-remote-merge-highlight" })
        .range(state.doc.line(lineNumber).from),
    );
  }
  return Decoration.set(decorations);
}

function buildDocumentSearchDecorations(state, { matches = [], activeIndex = -1 } = {}) {
  const builder = new RangeSetBuilder();
  for (const [index, match] of matches.entries()) {
    if (
      !Number.isInteger(match?.from) ||
      !Number.isInteger(match?.to) ||
      match.from < 0 ||
      match.to <= match.from ||
      match.to > state.doc.length
    ) {
      continue;
    }
    builder.add(
      match.from,
      match.to,
      Decoration.mark({
        class: index === activeIndex
          ? "cm-document-search-match is-active"
          : "cm-document-search-match",
      }),
    );
  }
  return builder.finish();
}

export function clipboardImageFile(clipboardData) {
  if (!clipboardData) {
    return null;
  }

  for (const item of clipboardData.items ?? []) {
    if (item.kind === "file" && /^image\//i.test(item.type)) {
      return item.getAsFile?.() ?? null;
    }
  }

  for (const file of clipboardData.files ?? []) {
    if (/^image\//i.test(file.type)) {
      return file;
    }
  }

  return null;
}

async function pasteImageIntoEditor(view, imageFile, onPasteImage) {
  try {
    const tag = await onPasteImage(imageFile);
    if (!tag) {
      view.focus();
      return;
    }

    insertTextAtSelection(view, pastedImageInsertionText(view.state, String(tag)));
    view.focus();
  } catch {
    view.focus();
  }
}

async function pasteTextAsLinkIntoEditor(view, text, onPasteText) {
  try {
    const replacement = await onPasteText(text, {
      selectedText: view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    });
    if (!replacement) {
      view.focus();
      return;
    }

    insertTextAtSelection(view, String(replacement));
    view.focus();
  } catch {
    view.focus();
  }
}

function insertTextAtSelection(view, text) {
  const changes = view.state.changeByRange((range) => ({
    changes: {
      from: range.from,
      to: range.to,
      insert: text,
    },
    range: EditorSelection.cursor(range.from + text.length),
  }));
  view.dispatch({
    ...changes,
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}

export function pastedImageInsertionText(state, tag) {
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.from);
  const before = line.text.slice(0, selection.from - line.from).trim();
  const after = line.text.slice(selection.to - line.from).trim();
  const prefix = before ? "\n\n" : "";
  const suffix = after ? "\n\n" : "\n";
  return `${prefix}${tag}${suffix}`;
}

export function imageLineAttributes(lineText) {
  const line = String(lineText ?? "").trim();
  if (/^<img\b[^>]*>\s*$/i.test(line)) {
    const attributes = {};
    const attributeRe = /([A-Za-z_:][A-Za-z0-9_:.:-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
    for (const match of line.matchAll(attributeRe)) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
    }
    return attributes.src ? attributes : null;
  }

  const markdown = /^!\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\)\n]*\)))?\s*\)\s*$/.exec(line);
  if (!markdown) {
    return null;
  }
  const rawSource = markdown[2];
  return {
    src: unescapeMarkdownImageValue(
      rawSource.startsWith("<") && rawSource.endsWith(">")
        ? rawSource.slice(1, -1)
        : rawSource,
    ),
    alt: unescapeMarkdownImageValue(markdown[1]),
  };
}

export function imageLineForAction(lineText, action, options = {}) {
  const attributes = imageLineAttributes(lineText);
  if (!attributes?.src) {
    return "";
  }

  if (action === "align-left") {
    attributes["data-align"] = "left";
  } else if (action === "align-center") {
    attributes["data-align"] = "center";
  } else if (action === "shrink" || action === "grow") {
    attributes.width = String(nextImageWidth(attributes.width, action));
  } else if (action === "caption") {
    attributes["data-caption"] = normalizeImageCaption(options.caption);
  }

  return formatImageTag(attributes);
}

export function normalizeImageWidth(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }
  const width = Number(text);
  return Number.isFinite(width) ? Math.min(Math.max(Math.round(width), 80), 2000) : 0;
}

export function normalizeImageAlign(value) {
  return String(value ?? "").trim().toLowerCase() === "center" ? "center" : "left";
}

export function normalizeImageCaption(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function nextImageWidth(value, action) {
  const current = normalizeImageWidth(value) || 760;
  if (action === "shrink") {
    return [...imageWidthSteps].reverse().find((width) => width < current) ?? imageWidthSteps[0];
  }
  return imageWidthSteps.find((width) => width > current) ?? imageWidthSteps.at(-1);
}

function formatImageTag(attributes) {
  const align = normalizeImageAlign(attributes["data-align"]);
  const width = normalizeImageWidth(attributes.width) || 760;
  const height = normalizeImageHeight(attributes.height);
  const caption = normalizeImageCaption(attributes["data-caption"]);
  const parts = [
    `src="${escapeHtmlAttribute(attributes.src)}"`,
    `alt="${escapeHtmlAttribute(attributes.alt ?? "")}"`,
    `width="${width}"`,
    height ? `height="${height}"` : "",
    `data-align="${align}"`,
    caption ? `data-caption="${escapeHtmlAttribute(caption)}"` : "",
  ];
  return `<img ${parts.filter(Boolean).join(" ")}>`;
}

function normalizeImageHeight(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }
  const height = Number(text);
  return Number.isFinite(height) ? Math.min(Math.max(Math.round(height), 40), 2000) : 0;
}

function unescapeMarkdownImageValue(value) {
  return String(value ?? "").replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function pastedTextLinkCandidate(value) {
  const text = String(value ?? "").trim();
  if (!text || /\r|\n/.test(text)) {
    return "";
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    return text;
  }
  if (/(^|\/|\\)[^/\\]+\.mdx?(?:[?#].*)?$/i.test(text)) {
    return text;
  }
  return "";
}

export function isMarkdownDocumentPath(value) {
  return /\.md$/i.test(String(value ?? ""));
}

export function slashCommandTemplate(
  command,
  {
    today = localIsoDate(),
    locale,
    language,
  } = {},
) {
  const localizedCommand = slashCommandForRequestedLocale(command, { locale, language });
  const rawTemplate = typeof localizedCommand?.template === "function"
    ? localizedCommand.template({ today })
    : String(localizedCommand?.template ?? "");
  const cursorOffset = rawTemplate.indexOf(cursorPlaceholder);
  if (cursorOffset < 0) {
    return {
      text: rawTemplate,
      cursorOffset: rawTemplate.length,
    };
  }

  return {
    text: rawTemplate.replace(cursorPlaceholder, ""),
    cursorOffset,
  };
}

export function slashCommandCompletionSource({
  locale,
  language,
  getDocumentPath = () => "",
  onBeforeSlashCommand = async () => true,
  onSlashCommand = async () => null,
} = {}) {
  const commands = slashCommandsForLocale({ locale, language });
  return (context) => {
    const token = context.matchBefore(/\/[a-z0-9-]*/i);
    if (!token) {
      return null;
    }

    const line = context.state.doc.lineAt(token.from);
    const prefix = line.text.slice(0, token.from - line.from);
    if (prefix.trim().length > 0) {
      return null;
    }

    const query = token.text.slice(1).toLowerCase();
    const options = commands
      .filter((command) => slashCommandMatches(command, query))
      .map((command) => ({
        label: `/${command.label}`,
        detail: command.detail,
        info: command.description
          ? `${command.title} — ${command.description}`
          : command.title,
        type: command.requiresMdx ? "class" : "keyword",
        apply(view, _completion, from, to) {
          void applySlashCommand(view, command, from, to, {
            getDocumentPath,
            onBeforeSlashCommand,
            onSlashCommand,
          });
        },
      }));

    return {
      from: token.from,
      to: context.pos,
      options,
      filter: false,
    };
  };
}

function slashCommandMatches(command, query) {
  if (!query) {
    return true;
  }
  return [command.label, command.title, command.description, command.detail]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function slashCommandForRequestedLocale(command, { locale, language } = {}) {
  if (locale == null && language == null) {
    return command;
  }
  return slashCommandsForLocale({ locale, language })
    .find((candidate) => candidate.label === command?.label) ?? command;
}

async function applySlashCommand(
  view,
  command,
  from,
  to,
  {
    getDocumentPath = () => "",
    onBeforeSlashCommand = async () => true,
    onSlashCommand = async () => null,
  } = {},
) {
  const allowed = await onBeforeSlashCommand(command, {
    documentPath: getDocumentPath(),
  });
  if (allowed === false) {
    view.focus();
    return;
  }

  const template = command.custom
    ? await slashCommandCustomTemplate(command, {
        documentPath: getDocumentPath(),
        onSlashCommand,
      })
    : slashCommandTemplate(command);
  if (!template) {
    view.focus();
    return;
  }
  view.dispatch({
    changes: {
      from,
      to,
      insert: template.text,
    },
    selection: {
      anchor: from + template.cursorOffset,
    },
    scrollIntoView: true,
  });
  view.focus();
}

async function slashCommandCustomTemplate(command, { documentPath, onSlashCommand }) {
  const result = await onSlashCommand(command, { documentPath });
  if (!result) {
    return null;
  }
  if (typeof result === "string") {
    return {
      text: result,
      cursorOffset: result.length,
    };
  }
  const text = String(result.text ?? "");
  return {
    text,
    cursorOffset: Number.isInteger(result.cursorOffset) ? result.cursorOffset : text.length,
  };
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildSelectedLineGutterClasses(state, lines) {
  const selected = [...new Set(lines)]
    .filter((line) => Number.isInteger(line) && line >= 1 && line <= state.doc.lines)
    .sort((left, right) => left - right);
  const builder = new RangeSetBuilder();

  for (const lineNumber of selected) {
    const line = state.doc.line(lineNumber);
    builder.add(line.from, line.from, selectedLineGutterMarker);
  }

  return builder.finish();
}

function lineNumberFromGutterEvent(event, view) {
  const target = event.target instanceof Element ? event.target : null;
  const gutter = target?.closest(".cm-gutters");
  if (!gutter) {
    return null;
  }

  const lineNumberElement = target.closest(".cm-lineNumbers .cm-gutterElement");
  const directLine = Number(lineNumberElement?.textContent);
  if (Number.isInteger(directLine)) {
    return directLine;
  }

  const contentRect = view.contentDOM.getBoundingClientRect();
  const pos = view.posAtCoords({
    x: contentRect.left + 4,
    y: event.clientY,
  });
  return Number.isInteger(pos) ? view.state.doc.lineAt(pos).number : null;
}

export function isLiveBlankClick(event) {
  const target = event.target?.closest ? event.target : event.target?.parentElement;
  if (!target) {
    return false;
  }

  if (target.closest?.(".live-edit-toolbar")) {
    return false;
  }

  const line = target.closest?.(".cm-line");
  if (line) {
    return target === line;
  }

  return Boolean(target.closest?.(".cm-content") || target.closest?.(".cm-scroller"));
}

function adjustCurrentListItemIndent(view, direction) {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.head);
  const change = listItemIndentChange(line.text, direction);
  if (!change) {
    return false;
  }

  view.dispatch({
    changes: {
      from: line.from + change.from,
      to: line.from + change.to,
      insert: change.insert,
    },
    scrollIntoView: true,
  });
  return true;
}

export function nextLiveEditingSuppression(
  isSuppressed,
  {
    docChanged = false,
    enterEditing = false,
    exitEditing = false,
  } = {},
) {
  if (exitEditing) {
    return true;
  }
  if (enterEditing || docChanged) {
    return false;
  }
  return isSuppressed;
}

export function listItemIndentChange(text, direction, { step = 2 } = {}) {
  const match = /^(\s*)([-*+]|\d+\.)(?:\s+|$)/.exec(text);
  if (!match) {
    return null;
  }

  const spaces = " ".repeat(step);
  if (direction === "indent") {
    return {
      from: 0,
      to: 0,
      insert: spaces,
    };
  }

  if (direction === "outdent") {
    const removeCount = Math.min(step, match[1].length);
    if (removeCount <= 0) {
      return null;
    }
    return {
      from: 0,
      to: removeCount,
      insert: "",
    };
  }

  return null;
}

function buildLiveMarkdownDecorations(state, { suppressActiveLine = false } = {}) {
  const builder = new RangeSetBuilder();
  const renderOptions = state.facet(liveRenderOptionsFacet);
  const tableInteraction = state.facet(liveTableInteractionFacet);
  const componentInteraction = state.facet(liveMdxComponentInteractionFacet);
  let inFrontmatter = false;
  let inCodeBlock = false;
  let mdxComponentName = null;
  const activeLineNumber = suppressActiveLine
    ? null
    : state.doc.lineAt(state.selection.main.head).number;
  const previewBlocks = livePreviewBlocksForSource(state.doc.toString(), {
    activeLineNumber,
  });
  let previewBlockIndex = 0;

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const previewBlock = previewBlocks[previewBlockIndex];
    if (previewBlock?.startLine === lineNumber) {
      const startLine = state.doc.line(previewBlock.startLine);
      const endLine = state.doc.line(previewBlock.endLine);
      builder.add(
        startLine.from,
        endLine.to,
        Decoration.replace({
          block: true,
          widget: new LiveBlockPreviewWidget(
            previewBlock,
            renderOptions,
            tableInteraction,
            componentInteraction,
          ),
        }),
      );
      lineNumber = previewBlock.endLine;
      previewBlockIndex += 1;
      continue;
    }

    const line = state.doc.line(lineNumber);
    const mdxComponent = liveMdxComponentForLine(line.text);
    const inMdxComponent = Boolean(mdxComponentName);
    const className = liveClassForLine({
      lineNumber,
      text: line.text,
      inFrontmatter,
      inCodeBlock,
      inMdxComponent,
    });

    if (className) {
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: className,
          attributes: mdxComponent
            ? { "data-live-component": `${mdxComponent.name} · ${mdxComponent.title}` }
            : {},
        }),
      );
    }

    if (inFrontmatter) {
      for (const range of liveFrontmatterRangesForLine(line.text)) {
        builder.add(
          line.from + range.from,
          line.from + range.to,
          Decoration.mark({
            class: range.className,
            attributes: liveRangeAttributes(range, lineNumber),
          }),
        );
      }
    } else if (!inCodeBlock) {
      for (const range of liveVisualRangesForLine(line.text, {
        isActiveLine: lineNumber === activeLineNumber,
      })) {
        if (range.type === "replace") {
          const widget = range.className === "cm-live-list-widget" &&
              Number.isInteger(range.indentColumns) &&
              Number.isInteger(range.markerColumns)
            ? new LiveListMarkerWidget(
              range.widget,
              range.indentColumns,
              range.markerColumns,
            )
            : new LiveReplacementWidget(range.widget, range.className);
          builder.add(
            line.from + range.from,
            line.from + range.to,
            Decoration.replace({
              widget,
            }),
          );
          continue;
        }

        builder.add(
          line.from + range.from,
          line.from + range.to,
          Decoration.mark({
            class: range.className,
            attributes: liveRangeAttributes(range, lineNumber),
          }),
        );
      }
    }

    const trimmed = line.text.trim();
    if (lineNumber === 1 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && trimmed === "---") {
      inFrontmatter = false;
      continue;
    }
    if (!inFrontmatter && /^(?:`{3,}|~{3,})/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inFrontmatter && !inCodeBlock && mdxComponent && !trimmed.endsWith("/>")) {
      mdxComponentName = mdxComponent.name;
      continue;
    }
    if (mdxComponentName && trimmed === `</${mdxComponentName}>`) {
      mdxComponentName = null;
    }
  }

  return builder.finish();
}

function liveRangeAttributes(range, lineNumber) {
  if (!range.attributes) {
    return undefined;
  }

  const attributes = { ...range.attributes };
  if (attributes["data-live-link"]) {
    attributes["data-live-line"] = String(lineNumber);
  }
  if (attributes["data-live-frontmatter"]) {
    attributes["data-live-line"] = String(lineNumber);
  }
  return attributes;
}

export function closestElement(target, selector) {
  const element = target?.closest
    ? target
    : target?.parentElement;
  return element?.closest?.(selector) ?? null;
}

function liveMarkdownLinkFromMouseEvent(event, view) {
  const element = closestElement(event.target, ".cm-live-link-text[data-live-link=\"true\"]");
  if (!element) {
    return null;
  }

  const pos = view.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  });
  const elementLine = lineFromLiveElement(view, element);
  const posLine = Number.isInteger(pos) ? view.state.doc.lineAt(pos) : null;
  const line = elementLine ?? posLine;
  if (!line) {
    return null;
  }

  const position = posLine?.number === line.number ? pos - line.from : null;
  const dataFrom = Number(element.dataset.liveLinkFrom);
  const dataTo = Number(element.dataset.liveLinkTo);
  const link = (Number.isInteger(position) ? liveMarkdownLinkAtPosition(line.text, position) : null) ??
    liveMarkdownLinksForLine(line.text).find((candidate) => (
      candidate.from === dataFrom && candidate.to === dataTo
    ));
  if (!link) {
    return null;
  }

  return {
    line: line.number,
    element,
    ...link,
  };
}

function liveFrontmatterFieldFromMouseEvent(event, view) {
  const element = closestElement(event.target, ".cm-live-frontmatter-token[data-live-frontmatter-key]");
  if (!element) {
    return null;
  }

  const pos = view.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  });
  const elementLine = lineFromLiveElement(view, element);
  const posLine = Number.isInteger(pos) ? view.state.doc.lineAt(pos) : null;
  const line = elementLine ?? posLine;
  if (!line) {
    return null;
  }

  const position = posLine?.number === line.number ? pos - line.from : null;
  const field = (Number.isInteger(position) ? liveFrontmatterFieldAtPosition(line.text, position) : null) ??
    liveFrontmatterFieldForLine(line.text);
  if (!field || field.key !== element.dataset.liveFrontmatterKey) {
    return null;
  }

  return {
    line: line.number,
    element,
    ...field,
  };
}

function lineFromLiveElement(view, element) {
  const lineNumber = Number(element.dataset.liveLine);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) {
    return null;
  }
  return view.state.doc.line(lineNumber);
}

export function liveClassForLine({
  lineNumber,
  text,
  inFrontmatter = false,
  inCodeBlock = false,
  inMdxComponent = false,
}) {
  const trimmed = text.trim();
  if ((lineNumber === 1 && trimmed === "---") || inFrontmatter) {
    return "cm-live-frontmatter";
  }
  const mdxComponent = liveMdxComponentForLine(text);
  if (mdxComponent) {
    return "cm-live-mdx-component cm-live-mdx-component-start";
  }
  if (inMdxComponent) {
    return "cm-live-mdx-component";
  }
  if (/^(?:`{3,}|~{3,})/.test(trimmed)) {
    return "cm-live-code cm-live-code-fence";
  }
  if (inCodeBlock) {
    return "cm-live-code";
  }

  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
    return "cm-live-horizontal-rule";
  }

  const heading = /^(#{1,6})\s+/.exec(text);
  if (heading) {
    const level = Math.min(heading[1].length, 3);
    return `cm-live-heading cm-live-heading-${level}`;
  }
  if (/^\s*>/.test(text)) {
    return "cm-live-blockquote";
  }
  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(text)) {
    return "cm-live-list";
  }
  return "";
}

export function liveInlineRangesForLine(text) {
  const ranges = [];
  const push = (from, to, className, attributes = undefined) => {
    if (Number.isInteger(from) && Number.isInteger(to) && to > from) {
      ranges.push({ from, to, className, ...(attributes ? { attributes } : {}) });
    }
  };

  const heading = /^(#{1,6})(\s+)/.exec(text);
  if (heading) {
    push(0, heading[1].length, "cm-live-marker");
  }

  const blockquote = /^(\s*>+\s?)/.exec(text);
  if (blockquote) {
    push(0, blockquote[1].length, "cm-live-marker");
  }

  const list = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(text);
  if (list) {
    push(list[1].length, list[1].length + list[2].length, "cm-live-marker");
  }

  addDelimitedRanges({
    text,
    regex: /\*\*([^*]+)\*\*/g,
    delimiterLength: 2,
    contentClassName: "cm-live-strong",
    ranges,
  });
  addDelimitedRanges({
    text,
    regex: /__([^_]+)__/g,
    delimiterLength: 2,
    contentClassName: "cm-live-strong",
    ranges,
  });
  addDelimitedRanges({
    text,
    regex: /`([^`]+)`/g,
    delimiterLength: 1,
    contentClassName: "cm-live-inline-code",
    ranges,
  });

  for (const link of liveMarkdownLinksForLine(text)) {
    push(link.from, link.textFrom, "cm-live-marker");
    push(link.textFrom, link.textTo, "cm-live-link-text", {
      "data-live-link": "true",
      "data-live-link-from": String(link.from),
      "data-live-link-to": String(link.to),
    });
    push(link.textTo, link.destinationFrom, "cm-live-marker");
    push(link.destinationFrom, link.destinationTo, "cm-live-marker cm-live-link-destination");
    push(link.destinationTo, link.to, "cm-live-marker");
  }

  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

export function liveFrontmatterFieldForLine(text) {
  const source = String(text ?? "");
  const match = /^([A-Za-z0-9_-]+):(\s*)(.*)$/.exec(source);
  if (!match) {
    return null;
  }

  const value = match[3].trim();
  if (!value) {
    return null;
  }

  const keyFrom = 0;
  const keyTo = match[1].length;
  const valueFrom = keyTo + 1 + match[2].length;
  const valueTo = source.length;
  return {
    from: 0,
    to: source.length,
    keyFrom,
    keyTo,
    valueFrom,
    valueTo,
    key: match[1],
    value,
  };
}

export function liveFrontmatterRangesForLine(text) {
  const field = liveFrontmatterFieldForLine(text);
  if (!field) {
    return [];
  }

  const attributes = {
    "data-live-frontmatter": "true",
    "data-live-frontmatter-key": field.key,
    "data-live-frontmatter-from": String(field.from),
    "data-live-frontmatter-to": String(field.to),
  };
  const ranges = [
    {
      from: field.keyFrom,
      to: field.keyTo,
      className: "cm-live-frontmatter-token cm-live-frontmatter-key",
      attributes,
    },
  ];
  if (field.valueTo > field.valueFrom) {
    ranges.push({
      from: field.valueFrom,
      to: field.valueTo,
      className: "cm-live-frontmatter-token cm-live-frontmatter-value",
      attributes,
    });
  }
  return ranges;
}

export function liveFrontmatterFieldAtPosition(text, position) {
  if (!Number.isInteger(position)) {
    return null;
  }

  const field = liveFrontmatterFieldForLine(text);
  if (!field || position < field.from || position >= field.to) {
    return null;
  }
  return field;
}

export function liveMarkdownLinksForLine(text) {
  return [...String(text ?? "").matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => {
    const from = match.index;
    const textFrom = from + 1;
    const textTo = textFrom + match[1].length;
    const destinationFrom = textTo + 2;
    const destinationTo = destinationFrom + match[2].length;
    const destination = match[2].trim();
    return {
      from,
      to: destinationTo + 1,
      textFrom,
      textTo,
      destinationFrom,
      destinationTo,
      text: match[1],
      href: destination.startsWith("<") && destination.endsWith(">")
        ? destination.slice(1, -1)
        : destination,
    };
  });
}

export function liveMarkdownLinkAtPosition(text, position) {
  if (!Number.isInteger(position)) {
    return null;
  }

  return liveMarkdownLinksForLine(text).find((link) => (
    position >= link.from && position <= link.to
  )) ?? null;
}

export function liveMdxComponentForLine(text) {
  const opening = mdxLiteComponentOpeningAtLines([text]);
  if (!opening) {
    return null;
  }

  return {
    name: opening.name,
    title: opening.attributes.title || opening.name,
  };
}

function cssEscape(value) {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : String(value).replace(/["\\]/g, "\\$&");
}

export function livePreviewBlocksForSource(source, { activeLineNumber = null } = {}) {
  const lines = String(source ?? "").split(/\r?\n/);
  const blocks = [];
  let inFrontmatter = false;
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();

    if (index === 0 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") {
        inFrontmatter = false;
      }
      continue;
    }
    if (!inCodeBlock) {
      const mermaidBlock = liveMermaidPreviewBlockAt(lines, index);
      if (mermaidBlock) {
        const startLine = lineNumber;
        const endLine = mermaidBlock.endIndex + 1;
        if (!lineNumberInRange(activeLineNumber, startLine, endLine)) {
          blocks.push({
            type: "mermaid",
            startLine,
            endLine,
            source: lines.slice(index, mermaidBlock.endIndex + 1).join("\n"),
          });
        }
        index = mermaidBlock.endIndex;
        continue;
      }
    }
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }

    const imageBlock = liveImagePreviewBlockAt(lines, index);
    if (imageBlock) {
      const startLine = lineNumber;
      const endLine = lineNumber;
      if (!lineNumberInRange(activeLineNumber, startLine, endLine)) {
        blocks.push({
          type: "image",
          startLine,
          endLine,
          source: lines[index],
        });
      }
      continue;
    }

    const mdxBlock = liveMdxPreviewBlockAt(lines, index);
    if (mdxBlock) {
      const startLine = lineNumber;
      const endLine = mdxBlock.endIndex + 1;
      if (!lineNumberInRange(activeLineNumber, startLine, endLine)) {
        blocks.push({
          type: "mdx",
          component: mdxBlock.component,
          attributes: mdxBlock.attributes,
          openingEndIndex: mdxBlock.openingEndIndex - index,
          selfClosing: mdxBlock.selfClosing,
          startLine,
          endLine,
          source: lines.slice(index, mdxBlock.endIndex + 1).join("\n"),
        });
      }
      index = mdxBlock.endIndex;
      continue;
    }

    const tableBlock = liveMarkdownTableBlockAt(lines, index);
    if (tableBlock) {
      const startLine = lineNumber;
      const endLine = tableBlock.endIndex + 1;
      blocks.push({
        type: "table",
        startLine,
        endLine,
        source: lines.slice(index, tableBlock.endIndex + 1).join("\n"),
      });
      index = tableBlock.endIndex;
    }
  }

  return blocks;
}

export function livePreviewHtmlForBlock(source, renderOptions = {}) {
  return removeSourceBlockChrome(renderMarkdown(source, renderOptions)).trim();
}

export function liveBlockPreviewIgnoresEvent(block, eventTarget) {
  return block?.type === "table" || block?.type === "mdx" || block?.type === "mermaid";
}

function liveImagePreviewBlockAt(lines, index) {
  const line = String(lines[index] ?? "").trim();
  return (
    isSafeHtmlImageLine(line) ||
    Boolean(imageLineAttributes(line))
  )
    ? { endIndex: index }
    : null;
}

function isSafeHtmlImageLine(line) {
  return (
    /^(?:<img\b[^<>]*>\s*)+$/i.test(line) ||
    /^<p>\s*(?:<img\b[^<>]*>\s*)+<\/p>\s*$/i.test(line)
  );
}

function liveMdxPreviewBlockAt(lines, index) {
  const block = mdxLiteComponentBlockAtLines(lines, index);
  return block;
}

function liveMermaidPreviewBlockAt(lines, index) {
  const opening = fencedCodeOpening(lines[index]);
  if (!opening || opening.language !== "mermaid") {
    return null;
  }

  for (let endIndex = index + 1; endIndex < lines.length; endIndex += 1) {
    if (fencedCodeClosing(lines[endIndex], opening)) {
      return { endIndex };
    }
  }
  return null;
}

function fencedCodeOpening(line) {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`~]*)/.exec(String(line ?? ""));
  if (!match) {
    return null;
  }
  return {
    character: match[1][0],
    length: match[1].length,
    language: String(match[2] ?? "").toLowerCase(),
  };
}

function fencedCodeClosing(line, opening) {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(String(line ?? ""));
  return Boolean(
    match
    && match[1][0] === opening.character
    && match[1].length >= opening.length,
  );
}

function liveMarkdownTableBlockAt(lines, index) {
  return markdownTableBlockAtLines(lines, index);
}

function lineNumberInRange(lineNumber, startLine, endLine) {
  return Number.isInteger(lineNumber) && lineNumber >= startLine && lineNumber <= endLine;
}

function removeSourceBlockChrome(html) {
  const withoutGutters = String(html ?? "").replace(
    /<div class="source-line-gutter"[^>]*>[\s\S]*?<\/div>/g,
    "",
  );
  return withoutGutters
    .replace(/^<div class="source-block"[^>]*>\s*<div class="source-block-content">/, "")
    .replace(/<\/div>\s*<\/div>\s*$/, "");
}

export function liveVisualRangesForLine(text, { isActiveLine = false } = {}) {
  if (isActiveLine) {
    return liveInlineRangesForLine(text).map((range) => ({
      type: "mark",
      ...range,
    }));
  }

  const readableReplacements = liveReadableReplacementsForLine(text).map((range) => ({
    type: "replace",
    ...range,
  }));
  const inlineMarkerReplacements = liveReadableInlineReplacementsForLine(text)
    .filter((range) => !readableReplacements.some((replacement) => rangesOverlap(range, replacement)))
    .map((range) => ({
      type: "replace",
      ...range,
    }));
  const allReplacements = [...readableReplacements, ...inlineMarkerReplacements];
  const visibleInlineRanges = liveInlineRangesForLine(text)
    .filter((range) => !allReplacements.some((replacement) => rangesOverlap(range, replacement)))
    .map((range) => ({
      type: "mark",
      ...range,
    }));

  return [...allReplacements, ...visibleInlineRanges]
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function rangesOverlap(left, right) {
  return left.from < right.to && right.from < left.to;
}

export function liveReadableReplacementsForLine(text) {
  const ranges = [];
  const push = (from, to, widget = "", className = "", extra = {}) => {
    if (Number.isInteger(from) && Number.isInteger(to) && to > from) {
      ranges.push({
        from,
        to,
        widget,
        ...(className ? { className } : {}),
        ...extra,
      });
    }
  };

  const heading = /^(#{1,6})(\s+)/.exec(text);
  if (heading) {
    push(0, heading[1].length + heading[2].length, "");
  }

  const blockquote = /^(\s*>+\s?)/.exec(text);
  if (blockquote) {
    push(0, blockquote[1].length, "");
  }

  const list = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(text);
  if (list) {
    const markerStart = list[1].length;
    const markerEnd = markerStart + list[2].length + list[3].length;
    const markerColumns = list[2].length + list[3].length;
    const widget = /^\d+\.$/.test(list[2]) ? list[2] : "\u2022";
    push(markerStart, markerEnd, widget, "cm-live-list-widget", {
      indentColumns: 0,
      markerColumns,
    });
    const nestedHeading = /^(#{1,6})(\s+)/.exec(text.slice(markerEnd));
    if (nestedHeading) {
      push(markerEnd, markerEnd + nestedHeading[1].length + nestedHeading[2].length, "");
    }
  }

  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function liveReadableInlineReplacementsForLine(text) {
  return liveInlineRangesForLine(text)
    .filter((range) => hasCssClass(range.className, "cm-live-marker"))
    .map((range) => ({
      from: range.from,
      to: range.to,
      widget: "",
    }));
}

function hasCssClass(className, expectedClassName) {
  return String(className ?? "").split(/\s+/).includes(expectedClassName);
}

function addDelimitedRanges({
  text,
  regex,
  delimiterLength,
  contentClassName,
  ranges,
}) {
  for (const match of text.matchAll(regex)) {
    const start = match.index;
    const contentStart = start + delimiterLength;
    const contentEnd = contentStart + match[1].length;
    ranges.push({ from: start, to: contentStart, className: "cm-live-marker" });
    ranges.push({ from: contentStart, to: contentEnd, className: contentClassName });
    ranges.push({
      from: contentEnd,
      to: contentEnd + delimiterLength,
      className: "cm-live-marker",
    });
  }
}

class LiveBlockPreviewWidget extends WidgetType {
  constructor(
    block,
    renderOptions = {},
    tableInteraction = null,
    componentInteraction = null,
  ) {
    super();
    this.block = block;
    this.renderOptions = renderOptions;
    this.tableInteraction = tableInteraction;
    this.componentInteraction = componentInteraction;
  }

  eq(other) {
    return other.block?.type === this.block.type &&
      other.block?.component === this.block.component &&
      other.block?.startLine === this.block.startLine &&
      other.block?.endLine === this.block.endLine &&
      other.block?.source === this.block.source &&
      JSON.stringify(other.renderOptions ?? {}) === JSON.stringify(this.renderOptions ?? {});
  }

  toDOM() {
    const container = document.createElement("div");
    const classNames = [
      "cm-live-block-preview",
      `cm-live-block-preview-${this.block.type}`,
      this.block.component ? `cm-live-block-preview-${this.block.component.toLowerCase()}` : "",
    ].filter(Boolean);
    container.className = classNames.join(" ");
    container.dataset.liveBlockStart = String(this.block.startLine);
    container.dataset.liveBlockEnd = String(this.block.endLine);
    const card = document.createElement("div");
    card.className = "cm-live-block-preview-card";
    card.innerHTML = livePreviewHtmlForBlock(this.block.source, this.renderOptions);
    enhanceImageLoadStates(card);
    container.append(card);
    this.tableInteraction?.mount?.(container, this.block);
    this.componentInteraction?.mount?.(container, this.block);
    return container;
  }

  ignoreEvent(event) {
    return liveBlockPreviewIgnoresEvent(this.block, event?.target);
  }
}

class LiveListMarkerWidget extends WidgetType {
  constructor(text, indentColumns, markerColumns) {
    super();
    this.text = text;
    this.indentColumns = indentColumns;
    this.markerColumns = markerColumns;
  }

  eq(other) {
    return other.text === this.text &&
      other.indentColumns === this.indentColumns &&
      other.markerColumns === this.markerColumns;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-list-widget";
    if (this.isUnordered()) {
      span.classList.add("is-unordered");
    }
    if (this.indentColumns > 0) {
      span.style.paddingLeft = `${this.indentColumns}ch`;
    }
    span.textContent = this.isUnordered() ? "" : this.text;
    return span;
  }

  ignoreEvent() {
    return false;
  }

  isUnordered() {
    return this.text === "\u2022";
  }
}

class LiveReplacementWidget extends WidgetType {
  constructor(text, className = "") {
    super();
    this.text = text;
    this.className = className;
  }

  eq(other) {
    return other.text === this.text && other.className === this.className;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = ["cm-live-replacement-widget", this.className].filter(Boolean).join(" ");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() {
    return false;
  }
}
