import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { registerDesktopProtocols } from "../src/desktop/protocol-registration.mjs";
import { OPENGLANCE_SUPPORTED_PROTOCOLS } from "../src/desktop/deep-link.mjs";

test("isolated desktop verification leaves the user's protocol handlers alone", () => {
  const calls = [];
  registerDesktopProtocols({ app: { setAsDefaultProtocolClient: (...args) => calls.push(args) }, isolatedUserData: true });
  assert.deepEqual(calls, []);
});

test("human packaged and source launches register every supported protocol", () => {
  for (const defaultApp of [false, true]) {
    const calls = [];
    assert.equal(registerDesktopProtocols({
      app: { setAsDefaultProtocolClient: (...args) => { calls.push(args); return true; } },
      defaultApp,
      argv: ["electron", "src/desktop/main.mjs"],
      execPath: "/electron",
    }), true);
    assert.deepEqual(calls, OPENGLANCE_SUPPORTED_PROTOCOLS.map((protocol) => defaultApp
      ? [protocol, "/electron", [path.resolve("src/desktop/main.mjs")]]
      : [protocol]));
  }
});
