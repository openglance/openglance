import assert from "node:assert/strict";
import test from "node:test";
import { MockAgent } from "undici";
import { createGithubPreviewTransport } from "../src/server/github-preview-transport.mjs";

function fixture(t) {
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  const api = dispatcher.get("https://api.github.com");
  const transport = createGithubPreviewTransport({ dispatcher });
  t.after(() => dispatcher.close());
  const read = (endpoint = "repos/example/private") => transport.api(endpoint, { token: "test-secret", deadline: Date.now() + 1000 });
  return { api, transport, read };
}

test("credentials come from the current gh login without a network auth check or token argument", async () => {
  const calls = [];
  let token = "first-token";
  const transport = createGithubPreviewTransport({ ghRunner: async (command, args, options) => {
    calls.push({ command, args, options }); return { stdout: token + "\n" };
  } });
  assert.equal(await transport.readToken(), "first-token");
  token = "second-token";
  assert.equal(await transport.readToken(), "second-token");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["auth", "token", "--hostname", "github.com"]);
  assert.equal(calls[0].options.timeout, 5000);
  assert.equal(calls[0].options.env.GH_PROMPT_DISABLED, "1");
});

test("credential failures discard raw output and missing gh retains its actionable state", async () => {
  for (const code of [1, "ENOENT"]) {
    const transport = createGithubPreviewTransport({ ghRunner: async () => {
      throw Object.assign(new Error("private-path secret-token"), { code, stdout: "secret-token", stderr: "private output" });
    } });
    await assert.rejects(transport.readToken(), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stdout, undefined); assert.equal(error.stderr, undefined);
      assert.doesNotMatch(error.message, /private|secret/);
      return true;
    });
  }
});

test("API GETs authenticate only to GitHub, including same-origin repository redirects", async (t) => {
  const { api, read } = fixture(t);
  const headers = { authorization: "Bearer test-secret", "user-agent": "OpenGlance-Link-Preview", accept: "application/vnd.github+json" };
  api.intercept({ path: "/repos/example/private", method: "GET", headers }).reply(301, "", { headers: { location: "https://api.github.com/repositories/123" } });
  api.intercept({ path: "/repositories/123", method: "GET", headers }).reply(200, { full_name: "example/renamed" });
  assert.deepEqual(await read(), { full_name: "example/renamed" });
  api.intercept({ path: "/repos/example/private" }).reply(302, "", { headers: { location: "https://evil.example/steal" } });
  await assert.rejects(read(), /Unsupported API redirect/);
  for (const endpoint of ["https://evil.example/repos/example/private", "//evil.example/repos/example/private", "user", "repos/../../user", "repos/example/private#fragment"]) {
    await assert.rejects(read(endpoint), /Unsupported API route/);
  }
});

test("API failures keep response bodies private and expose only bounded HTTP states", async (t) => {
  const { api, read } = fixture(t);
  for (const code of [401, 403, 404, 429, 500]) {
    api.intercept({ path: "/repos/example/private" }).reply(code, "secret response");
    await assert.rejects(read(), (error) => {
      assert.equal(error.statusCode, code); assert.doesNotMatch(error.message, /secret/); return true;
    });
  }
  api.intercept({ path: "/repos/example/private" }).reply(403, "private body", { headers: { "x-ratelimit-remaining": "0" } });
  await assert.rejects(read(), /rate limit/);
  api.intercept({ path: "/repos/example/private" }).reply(401, "x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(read(), { statusCode: 401 });
});

test("API reads enforce response size and an overall deadline", async (t) => {
  const { api, transport, read } = fixture(t);
  api.intercept({ path: "/repos/example/private" }).reply(200, "x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(read(), { code: "PREVIEW_TOO_LARGE" });
  api.intercept({ path: "/repos/example/private" }).reply(200, {}).delay(100);
  await assert.rejects(transport.api("repos/example/private", { token: "secret", deadline: Date.now() + 10 }));
});
