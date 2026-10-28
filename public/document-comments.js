// The panel owns transient drafts; persisted threads always come from the document file.
export function createDocumentComments({ getDocument, getLocale, getSelection, getTextSelection, mutate, getEditor, revealLine }) {
  const panel = document.querySelector('#document-comments');
  const toggle = document.querySelector('#document-comments-toggle');
  const textPopover = document.querySelector('#comment-text-selection');
  const textButton = document.querySelector('#comment-text-selection-button');
  const lineButton = document.querySelector('#add-selection-comment');
  const drafts = new Map();
  let textSelection = null;
  let textSelectionScope = '';
  let textSelectionSource = '';
  let selectionFrame = null;
  let newThreadButton = null;
  let visible = false;
  let filter = 'open';
  let draftSelection = null;
  let busy = false;
  let error = '';
  let renderedKey = '';
  let focusedDraft = null;
  const zh = () => getLocale().startsWith('zh');
  const label = (cn, en) => zh() ? cn : en;
  const key = () => `${getDocument()?.repo}:${getDocument()?.path}`;
  const button = (text, action, className = '') => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
    node.className = className; node.disabled = busy; node.addEventListener('click', action); return node;
  };
  function clearMarks() {
    document.querySelectorAll('.comment-pin').forEach((node) => node.remove());
    document.querySelectorAll('.has-open-comment').forEach((node) => node.classList.remove('has-open-comment'));
    getEditor()?.setCommentRanges([]);
  }
  function marks() {
    clearMarks();
    const doc = getDocument();
    const threads = doc?.comments?.threads ?? [];
    const open = threads.filter((thread) => thread.status === 'open' && thread.location.state === 'located');
    getEditor()?.setCommentRanges(open.map((thread) => thread.location));
    const blocks = [...document.querySelectorAll('#document-content .source-block')];
    for (const thread of open) {
      const block = blocks.find((node) => Number(node.dataset.sourceStart) <= thread.location.startLine && Number(node.dataset.sourceEnd) >= thread.location.startLine);
      if (!block) continue;
      block.classList.add('has-open-comment');
      const pin = button('◉', () => { visible = true; filter = 'open'; render(); panel.querySelector(`[data-comment-id="${thread.id}"]`)?.scrollIntoView({ block: 'nearest' }); }, 'comment-pin');
      pin.setAttribute('aria-label', label('打开评论', 'Open comment')); block.append(pin);
    }
  }
  async function submit(input, draftKey) {
    busy = true; error = ''; render();
    try {
      await mutate({ ...input, authorName: panel.querySelector('[name="comment-author"]')?.value || readAuthor() });
      if (draftKey) drafts.delete(draftKey);
      if (input.type === 'create') draftSelection = null;
    } catch (failure) { error = failure.message; }
    finally { busy = false; render(); }
  }
  function readAuthor() { try { return localStorage.getItem('openglance-comment-author') || ''; } catch { return ''; } }
  function composer(parent, draftKey, onSubmit) {
    const form = document.createElement('form'); form.className = 'comment-composer';
    const text = document.createElement('textarea'); text.name = 'comment-body'; text.rows = 3; text.dataset.draftKey = draftKey;
    text.placeholder = label('写下评论…', 'Write a comment…'); text.setAttribute('aria-label', text.placeholder);
    text.value = drafts.get(draftKey) || ''; text.disabled = busy; text.maxLength = 32000;
    text.addEventListener('input', () => { drafts.set(draftKey, text.value); send.disabled = busy || !text.value.trim(); });
    const send = button(label('保存到本地', 'Save locally'), () => {}); send.type = 'submit'; send.disabled = busy || !text.value.trim();
    form.append(text, send); form.addEventListener('submit', (event) => { event.preventDefault(); if (text.value.trim()) void onSubmit(text.value, draftKey); });
    parent.append(form);
  }
  function start(selection = getSelection()) {
    textPopover.hidden = true;
    visible = true; filter = 'open';
    if (selection) { draftSelection = { ...selection, key: key(), hash: getDocument().sourceHash, source: getDocument().source.replace(/\r\n?/g, '\n') }; error = ''; }
    else error = label('请先选择正文文字或行号，再添加评论。', 'Select document text or line numbers before adding a comment.');
    render(); panel.querySelector('textarea')?.focus();
  }
  function render() {
    const active = document.activeElement;
    if (panel.contains(active) && active.dataset.draftKey) focusedDraft = { key: active.dataset.draftKey, from: active.selectionStart, to: active.selectionEnd };
    else if (panel.contains(active) && !busy) focusedDraft = null;
    const doc = getDocument();
    const supported = doc?.comments?.supported === true && doc.canEdit;
    if (renderedKey !== key()) { draftSelection = null; error = ''; renderedKey = key(); }
    toggle.hidden = !supported; lineButton.hidden = !supported;
    textButton.textContent = label('添加评论', 'Add comment');
    scheduleTextSelection();
    panel.hidden = !supported || !visible;
    document.querySelector('#document-body').classList.toggle('has-comments', !panel.hidden);
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    const threads = doc?.comments?.threads ?? [];
    const openCount = threads.filter((thread) => thread.status === 'open').length;
    const toggleLabel = openCount ? label(`评论（${openCount} 条未解决）`, `Comments (${openCount} open)`) : label('评论', 'Comments');
    toggle.setAttribute('aria-label', toggleLabel);
    toggle.setAttribute('data-ui-tooltip', toggleLabel);
    marks(); newThreadButton = null; panel.replaceChildren();
    if (panel.hidden) return;
    const header = document.createElement('header');
    const title = document.createElement('strong'); title.textContent = label('评论', 'Comments');
    header.append(title, button('×', () => { visible = false; render(); })); panel.append(header);
    const hint = document.createElement('p'); hint.className = 'comment-hint';
    hint.textContent = label('评论保存在本地 Markdown 中。发布请手动同步。', 'Saved in local Markdown. Sync manually to publish.'); panel.append(hint);
    const actions = document.createElement('div'); actions.className = 'comment-filters';
    for (const status of ['open', 'resolved']) {
      const text = status === 'open' ? label('未解决', 'Open') : label('已解决', 'Resolved');
      const tab = button(`${text} (${threads.filter((thread) => thread.status === status).length})`, () => { filter = status; render(); });
      tab.dataset.commentFilter = status;
      tab.setAttribute('aria-pressed', String(filter === status)); actions.append(tab);
    }
    newThreadButton = button(label('新评论', 'New comment'), () => start());
    newThreadButton.dataset.commentAction = 'create';
    newThreadButton.disabled = busy || !getSelection();
    newThreadButton.title = label('先选中正文文字或行号', 'Select document text or line numbers first');
    newThreadButton.addEventListener('mousedown', (event) => event.preventDefault());
    actions.append(newThreadButton); panel.append(actions);
    const author = document.createElement('input'); author.name = 'comment-author'; author.value = readAuthor(); author.maxLength = 128;
    author.placeholder = label('署名（默认 Local author）', 'Author (default: Local author)'); author.setAttribute('aria-label', label('评论署名', 'Comment author'));
    author.addEventListener('change', () => { try { localStorage.setItem('openglance-comment-author', author.value); } catch {} }); panel.append(author);
    if (doc.comments.diagnostics.length) { const notice = document.createElement('p'); notice.className = 'comment-hint'; notice.textContent = label('部分记录无法解析，原始内容已保留。请在 Source 中检查。', 'Some records need repair in Source. Their original bytes are preserved.'); panel.append(notice); }
    if (error) { const notice = document.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = error; panel.append(notice); }
    const list = document.createElement('div'); list.className = 'comment-list'; panel.append(list);
    if (draftSelection?.key === key()) {
      const card = document.createElement('section'); card.className = 'comment-card comment-new';
      const quote = document.createElement('blockquote'); quote.textContent = draftSelection.text; card.append(quote);
      const mode = document.createElement('small'); mode.textContent = draftSelection.fallback ? label('按段落 / 行范围评论', 'Comment on paragraph / line range') : label('评论所选文字', 'Comment on selected text'); card.append(mode);
      composer(card, `${key()}:new`, (body, draftKey) => submit({ type: 'create', from: draftSelection.from, to: draftSelection.to, body, expectedSourceHash: draftSelection.hash, selectionSource: draftSelection.source }, draftKey));
      card.append(button(label('取消', 'Cancel'), () => { draftSelection = null; render(); })); list.append(card);
    }
    for (const thread of threads.filter((item) => item.status === filter)) {
      const card = document.createElement('section'); card.className = 'comment-card'; card.dataset.commentId = thread.id;
      const quote = document.createElement('blockquote'); quote.textContent = thread.anchor.exact; card.append(quote);
      if (thread.location.state === 'located') { const locate = button(`${label('定位', 'Locate')} · L${thread.location.startLine}`, () => revealLine(thread.location.startLine)); locate.dataset.commentAction = 'locate'; card.append(locate); }
      else { const status = document.createElement('small'); status.textContent = label('原文已变化，需要重新定位', 'Original text changed; location needs review'); card.append(status); }
      for (const message of thread.messages) {
        const item = document.createElement('div'); item.className = 'comment-message';
        const meta = document.createElement('small'); meta.textContent = `${message.author.name} · ${new Date(message.created_at).toLocaleString(getLocale())}`;
        const body = document.createElement('div'); body.className = 'comment-message-body'; body.textContent = message.body;
        item.append(meta, body); card.append(item);
      }
      const statusAction = button(thread.status === 'open' ? label('标记已解决', 'Resolve') : label('重新打开', 'Reopen'), () => submit({ type: 'set-status', threadId: thread.id, status: thread.status === 'open' ? 'resolved' : 'open' }));
      statusAction.dataset.commentAction = thread.status === 'open' ? 'resolve' : 'reopen'; card.append(statusAction);
      if (thread.status === 'open') composer(card, `${key()}:${thread.id}`, (body, draftKey) => submit({ type: 'reply', threadId: thread.id, body }, draftKey));
      list.append(card);
    }
    if (!busy && focusedDraft) {
      const textarea = [...panel.querySelectorAll('textarea')].find((node) => node.dataset.draftKey === focusedDraft.key);
      if (textarea) { textarea.focus({ preventScroll: true }); textarea.setSelectionRange(Math.min(focusedDraft.from, textarea.value.length), Math.min(focusedDraft.to, textarea.value.length)); }
      focusedDraft = null;
    }
    if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'comment-hint'; empty.textContent = label('这里还没有评论。', 'No comments here yet.'); list.append(empty); }
  }
  toggle.addEventListener('click', () => { visible = !visible; render(); });
  lineButton.addEventListener('mousedown', (event) => event.preventDefault());
  lineButton.addEventListener('click', () => start());
  textButton.addEventListener('pointerdown', (event) => event.preventDefault());
  textButton.addEventListener('mousedown', (event) => event.preventDefault());
  textButton.addEventListener('click', () => {
    if (textSelection && textSelectionScope === `${key()}:${getDocument()?.sourceHash}` && textSelectionSource === getDocument()?.source) start(textSelection.selection);
    else start();
  });
  function updateTextSelection() {
    selectionFrame = null;
    const doc = getDocument();
    const scope = `${key()}:${doc?.sourceHash}`;
    if (newThreadButton) newThreadButton.disabled = busy || !doc?.comments?.supported || !getSelection();
    if (busy || !doc?.comments?.supported || !doc.canEdit) textSelection = null;
    else if (document.activeElement !== textButton) { textSelection = getTextSelection(); textSelectionScope = scope; textSelectionSource = doc.source; }
    else if (textSelectionScope !== scope || textSelectionSource !== doc.source) textSelection = null;
    const rect = textSelection?.rect;
    if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) { textPopover.hidden = true; return; }
    textButton.textContent = label('添加评论', 'Add comment');
    textPopover.hidden = false;
    const width = textPopover.offsetWidth;
    const height = textPopover.offsetHeight;
    const position = commentPopoverPosition(rect, { width, height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
    textPopover.style.left = `${position.left}px`;
    textPopover.style.top = `${position.top}px`;
  }
  function scheduleTextSelection() {
    if (selectionFrame === null) selectionFrame = window.requestAnimationFrame(updateTextSelection);
  }
  document.addEventListener('selectionchange', scheduleTextSelection);
  document.addEventListener('pointerup', scheduleTextSelection);
  document.addEventListener('keyup', scheduleTextSelection);
  document.addEventListener('scroll', scheduleTextSelection, true);
  window.addEventListener('resize', scheduleTextSelection);
  return { render, selectionChanged: scheduleTextSelection, clear: () => { visible = false; draftSelection = null; clearMarks(); render(); } };
}

export function selectedCommentRange({ source, mode, editor, lines, root, selection = globalThis.getSelection?.() }) {
  source = source.replace(/\r\n?/g, '\n');
  if (mode !== 'preview') {
    const range = editor?.selectedRange();
    if (range && range.to > range.from) return { ...range, text: source.slice(range.from, range.to), fallback: false };
  }
  const offsets = [0]; for (let i = 0; i < source.length; i++) if (source[i] === '\n') offsets.push(i + 1);
  let selectedLines = [...lines].sort((a, b) => a - b);
  if (mode === 'preview' && selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const startBlock = range.startContainer.parentElement?.closest('.source-block');
    const endBlock = range.endContainer.parentElement?.closest('.source-block');
    if (root.contains(startBlock) && root.contains(endBlock)) {
      selectedLines = [Number(startBlock.dataset.sourceStart), Number(endBlock.dataset.sourceEnd)];
      const content = startBlock.querySelector('.source-block-content');
      const from = offsets[Number(startBlock.dataset.sourceStart) - 1];
      const to = offsets[Number(startBlock.dataset.sourceEnd)] ?? source.length;
      if (startBlock === endBlock && content.contains(range.startContainer) && content.contains(range.endContainer)
          && source.slice(from, to).trimEnd() === content.textContent.trimEnd()) {
        const prefix = range.cloneRange(); prefix.selectNodeContents(content); prefix.setEnd(range.startContainer, range.startOffset);
        const start = from + prefix.toString().length;
        if (source.slice(start, start + range.toString().length) === range.toString()) return { from: start, to: start + range.toString().length, text: range.toString(), fallback: false };
      }
    }
  }
  if (!selectedLines.length) return null;
  const from = offsets[selectedLines[0] - 1];
  let to = offsets[selectedLines.at(-1)] ?? source.length;
  if (source[to - 1] === '\n') to--;
  return Number.isInteger(from) && to > from ? { from, to, text: source.slice(from, to), fallback: true } : null;
}

export function commentPopoverPosition(rect, { width, height, viewportWidth, viewportHeight }) {
  const padding = 8;
  const left = Math.max(padding, Math.min(rect.right - width, viewportWidth - width - padding));
  const preferred = rect.top - height - padding;
  const top = Math.max(padding, Math.min(preferred >= 46 ? preferred : rect.bottom + padding, viewportHeight - height - padding));
  return { left, top };
}
