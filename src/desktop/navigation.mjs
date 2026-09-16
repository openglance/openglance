import path from "node:path";
import { DESKTOP_OPEN_DOCUMENT_EVENT } from "../../public/desktop-document-navigation.js";

// null means there is no reusable workbench. false means it handled the
// request but could not navigate; callers must preserve that workbench.
export async function openActiveWorkbenchDocument({ server, repoRoot, file = "", webContents }) {
  if (!server || server.repoRoot !== repoRoot || !webContents || webContents.isDestroyed?.()) return null;
  const current = parsedUrl(webContents.getURL());
  const served = parsedUrl(server.url);
  if (!current || !served || current.origin !== served.origin || current.pathname !== "/") return null;

  const relativePath = file ? path.relative(repoRoot, path.resolve(repoRoot, file)) : "";
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return false;
  const request = JSON.stringify({ file: relativePath.split(path.sep).join("/"), worktreeId: server.worktreeId });
  try {
    return await webContents.executeJavaScript(`(async () => {
      const event = new CustomEvent(${JSON.stringify(DESKTOP_OPEN_DOCUMENT_EVENT)}, {
        detail: ${request}, cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented ? await event.detail.result === true : null;
    })()`, true);
  } catch {
    // An interrupted renderer request is not permission to discard its edits.
    return false;
  }
}

export function classifyDesktopNavigation({ currentUrl, targetUrl }) {
  const target = parsedUrl(targetUrl);
  if (!target) {
    return "blocked";
  }

  const current = parsedUrl(currentUrl);
  if (current && target.origin === current.origin && /^https?:$/.test(target.protocol)) {
    return "internal";
  }

  if (target.protocol === "http:" || target.protocol === "https:" || target.protocol === "mailto:") {
    return "external";
  }

  return "blocked";
}

function parsedUrl(value) {
  try {
    return new URL(String(value ?? ""));
  } catch {
    return null;
  }
}
