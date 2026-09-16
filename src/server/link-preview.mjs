import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { linkPreviewTarget } from "../../public/link-preview-target.js";
import { markdownLinkPreview } from "../content/markdown.mjs";
import { createGithubPreviewTransport } from "./github-preview-transport.mjs";
import { resolvePreviewPath } from "./paths.mjs";
import { listGitWorktrees } from "./git-worktrees.mjs";

const MAX_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 60000;
const CACHE_LIMIT = 128;

// Only successful previews are retained, in memory, for 60 seconds from completion.
export function createLinkPreviewProvider({ ghRunner, githubTransport = createGithubPreviewTransport({ ghRunner }), now = Date.now } = {}) {
  let state = null, credentials = null, disposed = false;
  function invalidate() {
    if (!state) return;
    for (const entry of state.cache.values()) clearTimeout(entry.timer);
    for (const entry of state.pending.values()) entry.controller.abort();
    state.cache.clear(); state.pending.clear(); state = null;
  }
  function currentToken() {
    // Coalesce simultaneous local keychain reads, but never reuse a completed credential read.
    credentials ||= Promise.resolve().then(() => githubTransport.readToken()).finally(() => { credentials = null; });
    return credentials;
  }
  const preview = async ({ href, file, repo, origin }) => {
    const target = linkPreviewTarget(href, { file, repo: repo.id, origin });
    if (!target) return { status: "unsupported" };
    if (target.kind !== "github") return localPreview(target, repo);
    if (disposed) return { status: "unavailable", kind: "github" };
    let token;
    try {
      token = await currentToken();
    } catch (error) {
      invalidate();
      return { kind: "github", status: githubErrorStatus(error) };
    }
    if (disposed) return { status: "unavailable", kind: "github" };
    const fingerprint = createHash("sha256").update(token).digest("hex");
    if (state?.fingerprint !== fingerprint) {
      invalidate();
      state = { fingerprint, cache: new Map(), pending: new Map() };
    }
    const account = state;
    const key = target.url;
    const cached = account.cache.get(key);
    if (cached) {
      account.cache.delete(key);
      if (cached.expires > now()) { account.cache.set(key, cached); return cached.value; }
      clearTimeout(cached.timer);
    }
    if (account.pending.has(key)) return account.pending.get(key).promise;
    if (account.pending.size >= 2) return { status: "busy", kind: "github" };
    const controller = new AbortController();
    const deadline = Date.now() + 20000;
    const promise = (async () => {
      try {
        const value = { kind: "github", ...await githubPreview(target, (endpoint) => githubTransport.api(endpoint, { token, signal: controller.signal, deadline })) };
        if (state !== account) return { kind: "github", status: "authentication_required" };
        if (value.status === "ok") {
          if (account.cache.size >= CACHE_LIMIT) {
            const oldest = account.cache.keys().next().value;
            clearTimeout(account.cache.get(oldest).timer); account.cache.delete(oldest);
          }
          const timer = setTimeout(() => account.cache.delete(key), CACHE_TTL_MS);
          timer.unref();
          account.cache.set(key, { value, expires: now() + CACHE_TTL_MS, timer });
        }
        return value;
      } catch (error) {
        if (state !== account) return { kind: "github", status: "authentication_required" };
        const status = githubErrorStatus(error);
        if (["authentication_required", "forbidden", "unavailable"].includes(status) || [401, 403, 404].includes(error.statusCode)) invalidate();
        return { kind: "github", status };
      } finally { account.pending.delete(key); }
    })();
    account.pending.set(key, { promise, controller });
    return promise;
  };
  preview.dispose = async () => { disposed = true; invalidate(); await githubTransport.dispose?.(); };
  return preview;
}

async function localPreview(target, repo) {
  try {
    let root = repo.root;
    if (target.kind === "hosted") {
      const identity = new URL(repo.githubBlobRoot || "https://github.com/").pathname.split("/").slice(1, 3).join("/").toLowerCase();
      if (identity !== target.repository) return { status: "repository_unavailable" };
      const worktrees = await listGitWorktrees(root);
      const worktree = worktrees.find((item) => target.worktree ? item.id === target.worktree : item.primary);
      if (!worktree?.available) return { status: "repository_unavailable" };
      root = worktree.root;
    }
    const resolved = await resolvePreviewPath(root, target.file);
    if ((await stat(resolved.absolutePath)).size > MAX_BYTES) return { status: "too_large" };
    const markdown = await readFile(resolved.absolutePath, "utf8");
    return { kind: "document", path: target.file, ...markdownLinkPreview(markdown, target),
      ...(target.shared ? { notice: "local_copy" } : {}) };
  } catch { return { status: "unavailable", kind: "document" }; }
}

async function githubPreview(target, api) {
  const base = `repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const pathLabel = `${target.owner}/${target.repo}`;
  const common = { path: pathLabel, source: target.type };
  if (target.type === "repository") {
    const data = await api(base);
    return { ...common, status: "ok", title: text(data.full_name), excerpt: text(data.description), detail: text(data.description),
      metadata: [data.private ? "Private" : "Public", data.language, data.default_branch].filter(Boolean).map((value) => text(value)) };
  }
  if (target.type === "milestone") {
    const data = await api(`${base}/milestones/${target.number}`);
    return { ...common, ...markdownLinkPreview(text(data.description, 80000)), source: "milestone",
      title: text(data.title), milestone: {
        state: ["open", "closed"].includes(data.state) ? data.state : null,
        dueDate: /^\d{4}-\d{2}-\d{2}T/.test(data.due_on || "") && Number.isFinite(Date.parse(data.due_on)) ? data.due_on.slice(0, 10) : null,
        openIssues: Number.isSafeInteger(data.open_issues) && data.open_issues >= 0 ? data.open_issues : null,
        closedIssues: Number.isSafeInteger(data.closed_issues) && data.closed_issues >= 0 ? data.closed_issues : null,
      } };
  }
  if (["issue", "pull"].includes(target.type)) {
    const data = await api(`${base}/${target.type === "pull" ? "pulls" : "issues"}/${target.number}`);
    const content = markdownLinkPreview(text(data.body, 80000));
    return { ...common, ...content, source: target.type, title: `#${target.number} ${text(data.title)}`,
      metadata: [data.merged_at ? "Merged" : data.draft ? "Draft" : data.state, data.user?.login,
        ...(data.labels || []).slice(0, 3).map((label) => label.name)].filter(Boolean).map((value) => text(value)),
      ...(target.hash ? { notice: "resource_excerpt" } : {}) };
  }
  if (target.type === "commit") {
    const data = await api(`${base}/commits/${encodeURIComponent(target.ref)}`);
    const detail = text(data.commit?.message, 10000);
    return { ...common, status: "ok", title: detail.split("\n")[0], excerpt: detail.slice(0, 700), detail,
      metadata: [text(data.sha).slice(0, 7), data.commit?.author?.name].filter(Boolean).map((value) => text(value)) };
  }
  if (target.type === "release") {
    const data = await api(`${base}/releases/${target.tag ? `tags/${encodeURIComponent(target.tag)}` : "latest"}`);
    return { ...common, ...markdownLinkPreview(text(data.body, 80000)), source: "release", title: text(data.name || data.tag_name),
      metadata: [data.tag_name, data.prerelease ? "Pre-release" : "Release"].filter(Boolean).map((value) => text(value)) };
  }
  const { ref, file } = await resolveGithubFile(target.tail, base, api);
  const data = await api(`${base}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
  if (data.type !== "file" || data.encoding !== "base64" || data.size > MAX_BYTES || typeof data.content !== "string") return { status: "too_large" };
  const bytes = Buffer.from(data.content, "base64");
  if (bytes.length > MAX_BYTES) return { status: "too_large" };
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { status: "unsupported" }; }
  if (source.includes("\0")) return { status: "unsupported" };
  const isMarkdown = /\.mdx?$/i.test(file);
  const lineHash = /^#L\d+(?:-L?\d+)?$/.test(target.hash) ? target.hash : "";
  const preview = isMarkdown || lineHash
    ? markdownLinkPreview(source, { file, hash: lineHash })
    : { status: "ok", title: file.split("/").at(-1), excerpt: source.slice(0, 700), detail: source.slice(0, 10000), code: true };
  return { ...common, ...preview, path: `${pathLabel}/${file}`, metadata: [ref.slice(0, 7)],
    ...(target.hash && !lineHash ? { notice: "file_excerpt" } : {}) };
}

async function resolveGithubFile(tail, base, api) {
  if (tail.length === 2 || /^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(tail[0])) return { ref: tail[0], file: tail.slice(1).join("/") };
  // A branch name may itself contain slashes. Resolve the longest exact ref before requesting content.
  const prefix = encodeURIComponent(tail[0]);
  const results = await Promise.allSettled(["heads", "tags"].map((namespace) => api(`${base}/git/matching-refs/${namespace}/${prefix}`)));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  const refs = results.map((result) => result.value).filter(Array.isArray).flat();
  const joined = tail.join("/");
  const matches = refs.map((item) => ({ name: String(item.ref || "").replace(/^refs\/(?:heads|tags)\//, ""), sha: item.object?.sha }))
    .filter((item) => item.name && /^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(item.sha || "") && joined.startsWith(`${item.name}/`))
    .sort((a, b) => b.name.length - a.name.length);
  if (!matches.length) throw new Error("HTTP 404");
  return { ref: matches[0].sha, file: joined.slice(matches[0].name.length + 1) };
}

function text(value, limit = 1000) { return String(value ?? "").slice(0, typeof limit === "number" ? limit : 1000); }

function githubErrorStatus(error) {
  const output = `${error.stderr || ""} ${error.message || ""}`;
  if (error.code === "ENOENT") return "gh_missing";
  if (/HTTP 401|gh auth login|not logged|not authenticated|authentication failed/i.test(output)) return "authentication_required";
  if (/rate limit|HTTP 429/i.test(output)) return "rate_limited";
  if (/HTTP 403/i.test(output)) return "forbidden";
  if (/HTTP 404/i.test(output)) return "unavailable";
  if (["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "PREVIEW_TOO_LARGE", "UND_ERR_RES_EXCEEDED_MAX_SIZE"].includes(error.code)) return "too_large";
  return "network_error";
}
