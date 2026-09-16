import { linkPreviewTarget } from "./link-preview-target.js";
import { createTranslator } from "./i18n.js";

const MESSAGES = {
  en: {
    preview: "Link preview", loading: "Loading preview…", open: "Open", expand: "Read more", collapse: "Show less", close: "Close preview",
    empty: "No excerpt available.", document: "Local document", github: "GitHub · via gh", summary: "Summary", section: "Section", lines: "Source lines", excerpt: "Excerpt",
    repository: "Repository", issue: "Issue", pull: "Pull request", file: "File", commit: "Commit", release: "Release",
    milestone: "Milestone", milestoneOpen: "Open", milestoneClosed: "Closed", milestoneDue: "Due {date}", milestoneNoDue: "No due date",
    milestoneProgress: "Closed {closed}/{total} ({percent}%) · {open} open", milestoneEmpty: "No issues or pull requests",
    unavailable: "Not found or your current account does not have access.", location_missing: "This section or line range was not found.",
    repository_unavailable: "Preview is available for the current repository only. Open this link to switch repositories.",
    gh_missing: "Install GitHub CLI (gh) to preview GitHub links.", authentication_required: "Sign in using gh auth login, then hover again.",
    forbidden: "GitHub denied access. Check your gh account and organization authorization.", rate_limited: "GitHub rate limit reached. Try again later.",
    network_error: "Could not load the preview. Check your connection and try again.", busy: "Other previews are still loading. Hover again shortly.",
    unsupported: "This link cannot be previewed.", too_large: "This file is too large or cannot be previewed as text.",
    local_copy: "Local copy · the shared revision has not been verified.", resource_excerpt: "Showing the issue or pull request body; the linked comment or diff is not included.",
    saved_copy: "Saved file · unsaved editor changes are not included.", keyboard: "Alt + ↓ to enter preview · Esc to close",
    file_excerpt: "Showing a file excerpt; this GitHub anchor is not resolved in the preview.",
  },
  "zh-CN": {
    preview: "链接预览", loading: "正在加载预览……", open: "打开", expand: "展开原文", collapse: "收起", close: "关闭预览",
    empty: "暂无可预览的正文。", document: "本地文档", github: "GitHub · 通过 gh", summary: "摘要", section: "章节", lines: "源文件行号", excerpt: "原文摘录",
    repository: "仓库", issue: "Issue", pull: "Pull Request", file: "文件", commit: "提交", release: "Release",
    milestone: "里程碑", milestoneOpen: "进行中", milestoneClosed: "已关闭", milestoneDue: "截止 {date}", milestoneNoDue: "未设置截止日期",
    milestoneProgress: "已关闭 {closed}/{total}（{percent}%） · {open} 未关闭", milestoneEmpty: "暂无 Issue 或 PR",
    unavailable: "内容不存在，或当前账号没有访问权限。", location_missing: "未找到链接指向的章节或行号。",
    repository_unavailable: "目前仅预览当前仓库的文档；打开链接可切换仓库。",
    gh_missing: "安装 GitHub CLI（gh）后可预览 GitHub 链接。", authentication_required: "请先运行 gh auth login 登录，然后重新悬停。",
    forbidden: "GitHub 拒绝访问，请检查 gh 账号及组织授权。", rate_limited: "已达到 GitHub 请求限额，请稍后重试。",
    network_error: "预览加载失败，请检查网络后重试。", busy: "其他预览仍在加载，请稍后重新悬停。",
    unsupported: "此链接暂不支持预览。", too_large: "文件过大，或无法作为文本预览。",
    local_copy: "本地副本 · 尚未校验分享链接的版本。", resource_excerpt: "当前显示 Issue 或 PR 正文，不包含链接指向的评论或差异。",
    saved_copy: "已保存文件 · 不包含编辑器中尚未保存的修改。", keyboard: "Alt + ↓ 进入预览 · Esc 关闭",
    file_excerpt: "当前显示文件摘录，尚未定位到此 GitHub 锚点。",
  },
};

export function milestonePreviewMetadata(milestone, locale) {
  if (!milestone) return [];
  const t = createTranslator(MESSAGES, locale);
  const details = [];
  if (milestone.state === "open" || milestone.state === "closed") details.push(t(milestone.state === "closed" ? "milestoneClosed" : "milestoneOpen"));
  details.push(milestone.dueDate ? t("milestoneDue", { date: milestone.dueDate }) : t("milestoneNoDue"));
  const { openIssues: open, closedIssues: closed } = milestone;
  if (Number.isSafeInteger(open) && Number.isSafeInteger(closed) && open >= 0 && closed >= 0) {
    const total = open + closed;
    details.push(total ? t("milestoneProgress", { open, closed, total, percent: Math.round(closed / total * 100) }) : t("milestoneEmpty"));
  }
  return details;
}

export function attachLinkPreviews({ containers, getContext, isBlocked = () => false, load, onOpen }) {
  const card = document.createElement("section");
  card.className = "link-preview";
  card.id = "link-preview";
  card.hidden = true;
  card.setAttribute("role", "region");
  document.body.append(card);
  let item = null, href = "", contextKey = "", openTimer, closeTimer, abort, generation = 0;
  let payload, expanded = false, suppressed = null;
  const context = () => ({ ...getContext(), origin: window.location.origin });
  const key = (value) => JSON.stringify([value.repo, value.file, value.mode, value.version, value.locale]);
  const translate = () => createTranslator(MESSAGES, context().locale);
  const owns = (node) => node instanceof Element && containers.some((container) => container.contains(node));
  const candidate = (node) => {
    const link = node instanceof Element ? node.closest("a[href], [data-link-preview-href]") : null;
    return link && owns(link) ? link : null;
  };
  const inside = (node) => node instanceof Node && (card.contains(node) || item?.contains(node));
  function hide() {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    abort?.abort(); generation++;
    item?.removeAttribute("aria-details");
    item = null; payload = null; card.hidden = true; card.replaceChildren();
  }
  function position() {
    if (!item?.isConnected) { hide(); return; }
    const bounds = item.getBoundingClientRect();
    const height = card.offsetHeight;
    const below = bounds.bottom + 8;
    const top = below + height <= innerHeight - 10 ? below : Math.max(10, bounds.top - height - 8);
    card.style.left = `${Math.max(10, Math.min(bounds.left, innerWidth - card.offsetWidth - 10))}px`;
    card.style.top = `${top}px`;
  }
  function element(tag, className, value) {
    const node = document.createElement(tag); node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }
  function render() {
    const t = translate();
    const focusedClass = card.contains(document.activeElement) ? document.activeElement.className : "";
    card.setAttribute("aria-label", t("preview"));
    card.replaceChildren();
    const header = element("div", "link-preview-header");
    const target = linkPreviewTarget(href, context());
    header.append(element("span", "link-preview-source", `${t(target?.kind === "github" ? "github" : "document")}${payload?.source ? ` · ${t(payload.source)}` : ""}`));
    const close = element("button", "link-preview-close", "×");
    close.type = "button"; close.setAttribute("aria-label", t("close"));
    close.onclick = () => { const previous = item; suppressed = previous; hide(); previous?.focus({ preventScroll: true }); };
    header.append(close); card.append(header);
    if (payload?.title) card.append(element("div", "link-preview-title", payload.title));
    if (payload?.path) card.append(element("div", "link-preview-path", payload.path));
    const metadata = [payload?.location, ...(payload?.metadata || []), ...milestonePreviewMetadata(payload?.milestone, context().locale)].filter(Boolean).join(" · ");
    if (metadata) card.append(element("div", "link-preview-meta", metadata));
    const body = element("div", "link-preview-body");
    body.setAttribute("aria-live", "polite");
    body.classList.toggle("is-expanded", expanded);
    body.classList.toggle("is-code", Boolean(payload?.code));
    body.textContent = !payload ? t("loading") : payload.status !== "ok" ? t(payload.status)
      : (expanded ? payload.detail || payload.excerpt : payload.excerpt) || t("empty");
    card.append(body);
    if (payload?.notice) card.append(element("div", "link-preview-notice", t(payload.notice)));
    if (payload?.kind === "document" && context().dirty && payload.path === context().file) {
      card.append(element("div", "link-preview-notice", t("saved_copy")));
    }
    const footer = element("div", "link-preview-footer");
    if (payload?.status === "ok" && payload.detail && (payload.detail !== payload.excerpt || payload.excerpt.length > 250)) {
      const more = element("button", "link-preview-expand", t(expanded ? "collapse" : "expand"));
      more.type = "button"; more.setAttribute("aria-expanded", String(expanded));
      more.onclick = () => { expanded = !expanded; render(); position(); card.querySelector(".link-preview-expand")?.focus({ preventScroll: true }); };
      footer.append(more);
    }
    const open = element("a", "link-preview-open", t("open"));
    open.href = href;
    open.onclick = (event) => { event.preventDefault(); const currentHref = href; const currentItem = item; hide(); onOpen(currentHref, currentItem, event); };
    footer.append(open); card.append(footer);
    card.append(element("div", "link-preview-keyboard", t("keyboard")));
    card.hidden = false;
    item?.setAttribute("aria-details", card.id);
    position();
    if (focusedClass) [...card.querySelectorAll("button, a")].find((node) => node.className === focusedClass)?.focus({ preventScroll: true });
  }
  function schedule(next) {
    if (!next || next === suppressed || isBlocked() || next.closest("[hidden]")) return;
    const nextHref = next.dataset.linkPreviewHref || next.getAttribute("href");
    const current = context();
    if (!linkPreviewTarget(nextHref, current)) return;
    clearTimeout(closeTimer);
    if (next === item && key(current) === contextKey) return;
    hide(); item = next; href = nextHref; contextKey = key(current); expanded = false;
    openTimer = setTimeout(async () => {
      if (!item?.isConnected || key(context()) !== contextKey || isBlocked()) { hide(); return; }
      abort = new AbortController();
      const request = ++generation;
      render();
      try {
        const data = await load(href, current, abort.signal);
        if (generation !== request) return;
        if (!item?.isConnected || key(context()) !== contextKey || isBlocked()) { hide(); return; }
        payload = data; render();
      } catch (error) {
        if (generation === request && error.name !== "AbortError") { payload = { status: "network_error" }; render(); }
      }
    }, 450);
  }
  function leave() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (card.matches(":hover") || item?.matches(":hover") || inside(document.activeElement)) return;
      hide();
    }, 220);
  }
  for (const container of containers) {
    container.addEventListener("pointerover", (event) => {
      const next = candidate(event.target);
      if (next === suppressed && !next?.contains(event.relatedTarget) && !card.contains(event.relatedTarget)) suppressed = null;
      schedule(next);
    });
    container.addEventListener("pointerout", (event) => {
      const source = candidate(event.target);
      if (source === suppressed && !source?.contains(event.relatedTarget)) suppressed = null;
      if (item && !inside(event.relatedTarget)) leave();
    });
    container.addEventListener("focusin", (event) => schedule(candidate(event.target)));
    container.addEventListener("focusout", (event) => { if (!inside(event.relatedTarget)) { suppressed = null; leave(); } });
  }
  card.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  card.addEventListener("pointerleave", leave);
  card.addEventListener("focusin", () => clearTimeout(closeTimer));
  card.addEventListener("focusout", (event) => { if (!inside(event.relatedTarget)) leave(); });
  document.addEventListener("pointerdown", (event) => { if (!card.contains(event.target)) hide(); }, true);
  document.addEventListener("keydown", (event) => {
    if (card.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      const previous = item; const restore = card.contains(document.activeElement);
      suppressed = previous; hide(); if (restore) previous?.focus({ preventScroll: true });
    } else if (event.altKey && event.key === "ArrowDown" && inside(event.target)) {
      event.preventDefault(); card.querySelector("button")?.focus();
    }
  }, true);
  window.addEventListener("scroll", (event) => { if (!card.contains(event.target)) hide(); }, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  return { hide };
}
