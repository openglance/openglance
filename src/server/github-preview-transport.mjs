import { homedir } from "node:os";
import path from "node:path";
import { EnvHttpProxyAgent, request } from "undici";
import { runExternalCommand } from "./external-command.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const API_ORIGIN = "https://api.github.com";

// A service-owned connection pool. Credentials never enter a URL, child-process argument, or renderer.
export function createGithubPreviewTransport({ ghRunner = runExternalCommand, dispatcher } = {}) {
  let pool = dispatcher;
  return {
    async readToken() {
      const commands = process.platform === "win32" ? ["gh"] : ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", path.join(homedir(), ".local/bin/gh")];
      for (let index = 0; index < commands.length; index++) {
        try {
          const { stdout } = await ghRunner(commands[index], ["auth", "token", "--hostname", "github.com"], {
            timeout: 5000, maxBuffer: 16384,
            env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
          });
          const token = stdout.trim();
          if (!token || !/^[\x21-\x7e]+$/.test(token)) throw new Error("gh auth login required");
          return token;
        } catch (error) {
          if (error.code === "ENOENT" && index < commands.length - 1) continue;
          // Discard command output, including stdout: auth failures must not retain credentials.
          throw Object.assign(new Error(error.code === "ENOENT" ? "gh missing" : "gh auth login required"), { code: error.code });
        }
      }
    },
    async api(endpoint, { token, signal, deadline }) {
      let url = new URL(endpoint, `${API_ORIGIN}/`);
      if (!endpoint.startsWith("repos/") || !url.pathname.startsWith("/repos/") || url.origin !== API_ORIGIN || url.hash || url.username || url.password) throw new Error("Unsupported API route");
      // Two file previews can each resolve heads and tags. Let these GETs share concurrent H2 streams.
      // H1 fallback retains ordered responses and the default blocking-until-headers behavior.
      pool ||= new EnvHttpProxyAgent({ connections: 1, allowH2: true, pipelining: 4, keepAliveTimeout: 60000, keepAliveMaxTimeout: 60000,
        connect: { timeout: 10000 }, requestTls: { allowH2: true, timeout: 10000 }, maxResponseSize: MAX_BYTES });
      const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const { statusCode, headers, body } = await request(url, {
          dispatcher: pool, method: "GET", signal: requestSignal, maxRedirections: 0,
          headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "OpenGlance-Link-Preview" },
        });
        const redirect = [301, 302, 307, 308].includes(statusCode) && headers.location && redirects < 3;
        if (statusCode !== 200 && !redirect) {
          // Report access failures even if the error body is oversized or stalls indefinitely.
          body.destroy();
          const rateLimited = statusCode === 429 || (statusCode === 403 && (headers["retry-after"] || headers["x-ratelimit-remaining"] === "0"));
          throw Object.assign(new Error(rateLimited ? "GitHub rate limit" : `HTTP ${statusCode}`), { statusCode });
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of body) {
          size += chunk.length;
          if (size > MAX_BYTES) { body.destroy(); throw Object.assign(new Error("Response too large"), { code: "PREVIEW_TOO_LARGE" }); }
          chunks.push(chunk);
        }
        // Renamed repositories can redirect within the API. Never forward credentials to another host.
        if (redirect) {
          const next = new URL(headers.location, url);
          if (next.origin !== API_ORIGIN || next.username || next.password || next.hash || !/^\/(?:repos\/|repositories\/\d+(?:\/|$))/.test(next.pathname)) throw new Error("Unsupported API redirect");
          url = next;
          continue;
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
    },
    async dispose() { await pool?.destroy(); },
  };
}
