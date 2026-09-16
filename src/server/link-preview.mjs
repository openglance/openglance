import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { linkPreviewTarget } from "../../public/link-preview-target.js";
import { markdownLinkPreview } from "../content/markdown.mjs";
import { runExternalCommand } from "./external-command.mjs";
import { resolvePreviewPath } from "./paths.mjs";
import { listGitWorktrees } from "./git-worktrees.mjs";

const MAX_BYTES = 1024 * 1024;

// Private content is never cached or written to disk. Each hover uses current gh credentials.
export function createLinkPreviewProvider({ ghRunner = runExternalCommand } = {}) {
  let active = 0;
  return async ({ href, file, repo, origin }) => {
    const target = linkPreviewTarget(href, { file, repo: repo.id, origin });
    if (!target) return { status: "unsupported" };
    if (target.kind !== "github") return localPreview(target, repo);
    if (active >= 2) return { status: "busy", kind: "github" };
    active++;
    try {
      const deadline = Date.now() + 20000;
      const api = async (endpoint) => {
        const args = ["api", "--hostname", "github.com", "--method", "GET", "-H", "Accept: application/vnd.github+json", endpoint];
        const commands = process.platform === "win32" ? ["gh"] : ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", path.join(homedir(), ".local/bin/gh")];
        for (let index = 0; index < commands.length; index++) {
          if (Date.now() >= deadline) throw new Error("Preview timed out");
          try {
            const { stdout } = await ghRunner(commands[index], args, {
              timeout: Math.max(1, deadline - Date.now()), maxBuffer: MAX_BYTES * 2,
              env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
            });
            return JSON.parse(stdout);
          } catch (error) {
            if (error.code === "ENOENT" && index < commands.length - 1) continue;
            throw error;
          }
        }
      };
      return { kind: "github", ...await githubPreview(target, api) };
    } catch (error) {
      return { kind: "github", status: githubErrorStatus(error) };
    } finally { active--; }
  };
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
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "too_large";
  return "network_error";
}
