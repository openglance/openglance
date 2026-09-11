import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { completeMacAppNameMigration, macAppNameMigrationPlan, SKIP_MAC_APP_NAME_MIGRATION, startMacAppNameMigration } from "../src/desktop/mac-app-name-migration.mjs";
import { macUpdateCachePaths, prepareMacUpdateAppPath } from "../src/desktop/mac-update-cache.mjs";

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "openglance-app-name-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, "Applications", "Git Leaf.app");
  const target = path.join(home, "Applications", "OpenGlance.app");
  const executable = path.join(source, "Contents", "MacOS", "Git Leaf");
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, "same executable");
  const options = {
    platform: "darwin", isPackaged: true, executable, args: [],
    buildInfo: { distribution: "official", releaseTrack: "internal" },
    readBundleId: () => "com.mangofuture.gitleaf",
    readExecutableName: () => "Git Leaf",
    findAppProcesses: () => [],
  };
  return { home, source, target, executable, options, plan: macAppNameMigrationPlan(options) };
}

test("a legacy internal App moves once without changing its inode, executable, Profile, or launch request", async t => {
  const f = fixture(t);
  const profile = path.join(f.home, "Profile");
  mkdirSync(profile);
  writeFileSync(path.join(profile, "desktop-config.json"), '{"repositories":["my-repo"],"theme":"dark"}');
  const launches = [];
  const args = [`--openglance-dev-user-data-dir=${profile}`, "openglance://open?repo=owner/repo", "--file=README.md"];
  let parentExited = false;
  const result = await completeMacAppNameMigration({
    plan: f.plan, launchArgs: args,
    waitForExit: async () => { assert.equal(existsSync(f.source), true); parentExited = true; },
    launchApp: async request => { assert.equal(parentExited, true); launches.push(request); },
  });
  assert.equal(result.status, "migrated");
  assert.equal(existsSync(f.source), false);
  assert.equal(lstatSync(f.target).ino, f.plan.ino);
  assert.equal(readFileSync(path.join(f.target, "Contents", "MacOS", "Git Leaf"), "utf8"), "same executable");
  assert.deepEqual(launches, [{ appPath: f.target, args }]);
  assert.equal(readFileSync(path.join(profile, "desktop-config.json"), "utf8"), '{"repositories":["my-repo"],"theme":"dark"}');
  assert.equal(macAppNameMigrationPlan({ ...f.options, executable: path.join(f.target, "Contents", "MacOS", "Git Leaf") }), null);
});

for (const [name, override] of [
  ["Windows", { platform: "win32" }],
  ["unpackaged development", { isPackaged: false }],
  ["a failed migration's recovery launch", { args: [SKIP_MAC_APP_NAME_MIGRATION] }],
  ["a different Bundle ID", { readBundleId: () => "other.application" }],
  ["an executable mismatch", { readExecutableName: () => "OpenGlance" }],
  ["a non-writable parent", { checkAccess: () => { throw new Error("EACCES"); } }],
  ["an update helper's launch confirmation", { parentProcessId: 123, findAppProcesses: () => [123] }],
]) {
  test(`${name} continues at the existing App path`, t => {
    const f = fixture(t);
    assert.equal(macAppNameMigrationPlan({ ...f.options, ...override }), null);
    assert.equal(existsSync(f.source), true);
    assert.equal(existsSync(f.target), false);
  });
}

for (const type of ["directory", "file", "dangling symlink"]) {
  test(`an existing ${type} at OpenGlance.app is preserved`, t => {
    const f = fixture(t);
    if (type === "directory") mkdirSync(f.target);
    else if (type === "file") writeFileSync(f.target, "existing");
    else symlinkSync(path.join(f.home, "missing"), f.target);
    const identity = lstatSync(f.target);
    assert.equal(macAppNameMigrationPlan(f.options), null);
    assert.equal(lstatSync(f.target).ino, identity.ino);
  });
}

test("a symlinked legacy App is left alone", t => {
  const f = fixture(t);
  const actual = path.join(f.home, "actual.app");
  renameSync(f.source, actual);
  symlinkSync(actual, f.source);
  assert.equal(macAppNameMigrationPlan(f.options), null);
});

test("a target created while the old process exits is not overwritten, including an empty directory", async t => {
  const f = fixture(t);
  const launches = [];
  const result = await completeMacAppNameMigration({
    plan: f.plan,
    waitForExit: async () => mkdirSync(f.target),
    launchApp: async request => launches.push(request),
  });
  assert.equal(result.status, "deferred");
  assert.equal(existsSync(f.source), true);
  assert.deepEqual(launches, [{ appPath: f.source, args: [SKIP_MAC_APP_NAME_MIGRATION] }]);
  assert.notEqual(lstatSync(f.target).ino, f.plan.ino);
});

test("a failed canonical launch restores the same App and retries startup once at its legacy path", async t => {
  const f = fixture(t);
  const launches = [];
  const result = await completeMacAppNameMigration({
    plan: f.plan, launchArgs: ["--repo=example"],
    launchApp: async request => {
      launches.push(request);
      if (request.appPath === f.target) throw new Error("Launch failed");
    },
  });
  assert.equal(result.status, "deferred");
  assert.equal(lstatSync(f.source).ino, f.plan.ino);
  assert.equal(existsSync(f.target), false);
  assert.deepEqual(launches[1], { appPath: f.source, args: ["--repo=example", SKIP_MAC_APP_NAME_MIGRATION] });
});

test("subsequent ShipIt updates target the migrated App and preserve its canonical outer name", async t => {
  const f = fixture(t);
  await completeMacAppNameMigration({ plan: f.plan, launchApp: async () => {} });
  const cache = macUpdateCachePaths({ homeDir: f.home });
  const updateApp = path.join(cache.updateRoot, "update.NEXT", "OpenGlance.app");
  mkdirSync(updateApp, { recursive: true });
  writeFileSync(cache.stateFile, JSON.stringify({
    targetBundleURL: pathToFileURL(f.target).href,
    updateBundleURL: pathToFileURL(updateApp).href,
    useUpdateBundleName: true,
  }));
  await prepareMacUpdateAppPath({ homeDir: f.home, targetAppPath: f.target });
  const request = JSON.parse(readFileSync(cache.stateFile));
  assert.equal(request.targetBundleURL, pathToFileURL(f.target).href);
  assert.equal(request.useUpdateBundleName, false);
  assert.equal(existsSync(f.source), false);
});

test("a legacy path replaced during shutdown is neither moved nor launched", async t => {
  const f = fixture(t);
  await assert.rejects(completeMacAppNameMigration({
    plan: f.plan,
    waitForExit: async () => { renameSync(f.source, path.join(f.home, "original.app")); mkdirSync(f.source); },
    launchApp: async () => assert.fail("A replacement App must not be launched"),
  }), /App changed/);
  assert.equal(existsSync(f.target), false);
});

test("startup waits for helper readiness and forwards the latest launch request before exiting", async t => {
  const f = fixture(t);
  const child = new EventEmitter();
  const calls = [];
  child.send = (message, done) => { calls.push(message); done(); };
  child.disconnect = () => calls.push("disconnect");
  child.unref = () => calls.push("unref");
  child.kill = () => assert.fail("Ready helper must continue");
  let args = ["--repo=first"];
  const starting = startMacAppNameMigration({
    app: { isPackaged: true }, planMigration: () => f.plan,
    launchArgs: () => args,
    spawnProcess: (_executable, _args, options) => {
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(options.stdio[3], "ipc");
      return child;
    },
  });
  assert.deepEqual(calls, []);
  args = ["--repo=first", "openglance://open?repo=latest"];
  child.emit("message", { status: "ready", ino: f.plan.ino, dev: f.plan.dev });
  assert.equal(await starting, true);
  assert.deepEqual(calls, [{ launchArgs: args }, "disconnect", "unref"]);
});

for (const failure of ["error", "exit", "timeout", "identity"]) {
  test(`helper ${failure} keeps the current App usable instead of quitting`, async t => {
    const f = fixture(t);
    const child = new EventEmitter();
    let killed = false;
    child.kill = () => { killed = true; };
    const starting = startMacAppNameMigration({
      app: { isPackaged: true }, planMigration: () => f.plan,
      spawnProcess: () => child, timeoutMs: 10, logger: { warn() {} },
    });
    if (failure === "error") child.emit("error", new Error("spawn failed"));
    if (failure === "exit") child.emit("exit", 1);
    if (failure === "identity") child.emit("message", { status: "ready", ino: -1 });
    assert.equal(await starting, false);
    assert.equal(killed, true);
    assert.equal(existsSync(f.source), true);
    assert.equal(existsSync(f.target), false);
  });
}
