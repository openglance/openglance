import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { connect } from "node:net";
import path from "node:path";

// GitHub API TLS traffic stays on loopback and uses fixture credentials. Packaging downloads pass through.
export async function createGithubSmokeFixture(root) {
  const cert = path.join(root, "github-fixture.pem"), key = path.join(root, "github-fixture.key");
  const config = path.join(root, "github-fixture.cnf"), tokenFile = path.join(root, "gh-token");
  writeFileSync(config, "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=api.github.com\n[ext]\nsubjectAltName=DNS:api.github.com\nbasicConstraints=critical,CA:TRUE\n");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-config", config], { stdio: "pipe" });
  writeFileSync(tokenFile, "smoke-preview");
  const requests = [], sockets = new Set();
  let connections = 0;
  const api = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (request, response) => {
    const endpoint = request.url, token = request.headers.authorization;
    requests.push({ endpoint, token });
    if (!token?.startsWith("Bearer smoke-")) { response.writeHead(401).end(); return; }
    if (endpoint.endsWith("/404")) { response.writeHead(404).end("Not Found"); return; }
    const slow = /\/(43|44)$/.test(endpoint);
    await new Promise((resolve) => setTimeout(resolve, slow ? 2200 : endpoint.endsWith("/42") ? 1300 : 80));
    const data = endpoint.includes("/milestones/")
      ? { title: "Next release", description: "Ship link previews for local documents and GitHub.", state: "open", due_on: "2026-09-30T23:59:59Z", open_issues: 2, closed_issues: 8 }
      : { title: slow ? "Slow response" : "Review link preview behavior", body: "Private GitHub issue content returned by the local TLS fixture.\n\nCheck the hover card in both Preview and Live.", state: "open", user: { login: "preview-tester" }, labels: [{ name: "enhancement" }] };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
  });
  api.on("secureConnection", () => { connections++; });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const proxy = createHttpServer((_request, response) => response.writeHead(403).end());
  proxy.on("connect", (request, socket, head) => {
    const target = new URL(`https://${request.url}`);
    const fixtureApi = target.hostname === "api.github.com";
    const downloadHost = ["github.com", "releases.electronjs.org", "artifacts.electronjs.org", "registry.npmjs.org"].includes(target.hostname) || target.hostname.endsWith(".githubusercontent.com");
    if (target.port || (!fixtureApi && !downloadHost)) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const upstream = connect(fixtureApi ? api.address().port : 443, fixtureApi ? "127.0.0.1" : target.hostname, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    for (const stream of [socket, upstream]) {
      sockets.add(stream);
      stream.on("close", () => { sockets.delete(stream); socket.destroy(); upstream.destroy(); });
      stream.on("error", () => { socket.destroy(); upstream.destroy(); });
    }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  return {
    tokenFile, requests,
    count: (suffix, token) => requests.filter((item) => item.endpoint.endsWith(suffix) && item.token === `Bearer ${token}`).length,
    connectionCount: () => connections,
    env: { HTTPS_PROXY: proxyUrl, https_proxy: proxyUrl, HTTP_PROXY: proxyUrl, http_proxy: proxyUrl,
      NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", NODE_EXTRA_CA_CERTS: cert },
    async dispose() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise((resolve) => proxy.close(resolve)), new Promise((resolve) => api.close(resolve))]);
      assert.ok(requests.every((item) => item.token?.startsWith("Bearer smoke-")), "Only fixture credentials may be used");
    },
  };
}
