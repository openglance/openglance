// Shared by the renderer and service. Classification never performs navigation or I/O.
export function linkPreviewTarget(href, { origin = "http://127.0.0.1", repo = "", file = "" } = {}) {
  const value = String(href ?? "").trim();
  if (!value || value.length > 4096 || /[\u0000-\u001f\\]/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    if (url.username || url.password) return null;
    if (url.protocol === "https:" && url.hostname === "github.com" && !url.port) {
      return githubPreviewTarget(url);
    }
    if (url.origin === "https://gitleaf.mangofuture.com" && ["/open", "/share"].includes(url.pathname)) {
      const repository = url.searchParams.get("repo") || "";
      const targetFile = safeDocumentPath(url.searchParams.get("path") || "");
      const worktree = url.searchParams.get("worktree") || "";
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !targetFile || (worktree && !/^[a-f0-9]{16}$/.test(worktree))) return null;
      if (url.pathname === "/share" && (url.searchParams.get("v") !== "1" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(url.searchParams.get("rev") || ""))) return null;
      return { kind: "hosted", repository: repository.toLowerCase(), file: targetFile, hash: url.hash, worktree, shared: url.pathname === "/share" };
    }
    if (url.origin === origin && url.pathname === "/" && url.searchParams.has("file")) {
      if (url.searchParams.has("repo") && url.searchParams.get("repo") !== repo) return null;
      const targetFile = safeDocumentPath(url.searchParams.get("file"));
      return targetFile ? { kind: "document", file: targetFile, hash: url.hash } : null;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//")) return null;
    const pathPart = value.split(/[?#]/, 1)[0];
    const decoded = decodeURIComponent(pathPart);
    const parts = decoded.startsWith("/") ? [] : file.split("/").slice(0, -1);
    if (!decoded) return file && url.hash ? { kind: "document", file, hash: url.hash } : null;
    for (const part of decoded.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else parts.push(part);
    }
    const targetFile = safeDocumentPath(parts.join("/"));
    return targetFile ? { kind: "document", file: targetFile, hash: url.hash } : null;
  } catch { return null; }
}

function safeDocumentPath(value) {
  const file = String(value ?? "");
  return file && !file.startsWith("/") && !/[\\\u0000-\u001f:]/.test(file)
    && !file.split("/").some((part) => !part || part === "." || part === "..")
    && /\.mdx?$/i.test(file) ? file : "";
}

function githubPreviewTarget(url) {
  const parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
  const [owner, repo, type, ...tail] = parts;
  if (![owner, repo].every((part) => /^[\w.-]+$/.test(part || "") && ![".", ".."].includes(part))) return null;
  if (parts.some((part) => !part || /[\u0000-\u001f\\]/.test(part) || part.split("/").some((segment) => segment === "." || segment === ".."))) return null;
  const base = { kind: "github", owner, repo, hash: url.hash, url: `${url.origin}${url.pathname}${url.hash}` };
  if (!type) return { ...base, type: "repository" };
  if (type === "milestone" && /^[1-9]\d*$/.test(tail[0] || "") && tail.length === 1) {
    return { ...base, type: "milestone", number: tail[0] };
  }
  if (["issues", "pull"].includes(type) && /^\d+$/.test(tail[0] || "") && tail.length === 1) {
    return { ...base, type: type === "pull" ? "pull" : "issue", number: tail[0] };
  }
  if (type === "blob" && tail.length >= 2) return { ...base, type: "file", tail };
  if (type === "commit" && /^[a-f\d]{7,64}$/i.test(tail[0] || "") && tail.length === 1) return { ...base, type: "commit", ref: tail[0] };
  if (type === "releases" && tail[0] === "tag" && tail.length >= 2) return { ...base, type: "release", tag: tail.slice(1).join("/") };
  if (type === "releases" && tail.length === 1 && tail[0] === "latest") return { ...base, type: "release", tag: "" };
  return null;
}
