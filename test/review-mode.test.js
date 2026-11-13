const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { reviewRootFromArgs } = require("../src/main/review-mode");

test("review mode is opt-in and rejects relative/profile/system roots", () => {
  assert.equal(reviewRootFromArgs([]), "");
  assert.throws(() => reviewRootFromArgs(["--review-root=relative"]), /absolute/);
  assert.throws(() => reviewRootFromArgs(["--review-root", os.homedir()]), /separate disposable/);
  assert.throws(() => reviewRootFromArgs(["--review-root", path.parse(process.cwd()).root]), /separate disposable/);
});

function isolatedModule() {
  // Separate fs facades let the production guard execute without changing the
  // test runner's shared filesystem methods or requiring child-process access.
  const localFs = { ...fs };
  // Model Node/Electron's public-method delegation. The previous logger bound
  // appendFileSync, which called this now-guarded writeFileSync recursively.
  localFs.appendFileSync = (file, data, options = {}) => localFs.writeFileSync(file, data, { ...options, flag: "a" });
  const localPromises = { ...require("node:fs/promises") };
  const module = { exports: {} };
  const localRequire = id => id === "node:fs" ? localFs : id === "node:fs/promises" ? localPromises : require(id);
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/main/review-mode"), "utf8"), { require: localRequire, module, process, URL });
  return { api: module.exports, fs: localFs, fsp: localPromises };
}

test("isolated bootstrap sets all paths, permits read-only bundle assets and confines data/network access", async t => {
  const parent = fs.mkdtempSync(path.join(process.cwd(), ".review-mode-test-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "review");
  const outside = path.join(parent, "outside.json");
  fs.writeFileSync(outside, "unchanged sentinel");
  const bundle = path.join(parent, "bundle");
  fs.mkdirSync(path.join(bundle, "src"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "preload.js"), "// synthetic preload");
  fs.writeFileSync(path.join(bundle, "package.json"), '{"version":"synthetic"}');
  fs.writeFileSync(path.join(bundle, "src", "runtime.js"), "// synthetic runtime");
  fs.writeFileSync(path.join(bundle, "src", "financial-fixture.json"), "must not read");
  const sandbox = isolatedModule();
  const paths = {}, events = {};
  const app = { setPath: (name, value) => paths[name] = value, getPath: name => paths[name], commandLine: { appendSwitch() {} }, on: (name, fn) => events[name] = fn, whenReady: () => new Promise(() => {}) };
  const review = sandbox.api.configureReviewMode({ app, session: {}, args: ["--review-root=" + root, "--data-file=" + outside], bundleReadRoot: bundle });
  review.prepareData({ schemaVersion: 2 });
  assert.equal(paths.userData, path.join(root, "profile"));
  assert.equal(paths.sessionData, paths.userData);
  for (const name of ["appData", "temp", "logs", "crashDumps", "downloads"]) assert.ok(paths[name].startsWith(root + path.sep));
  assert.equal(review.dataFilePath, path.join(root, "payment-tracker-data.json"));
  assert.throws(() => sandbox.fs.writeFileSync(outside, "bad"), /blocked/);
  assert.throws(() => sandbox.fsp.writeFile(outside, "bad"), /blocked/);
  assert.throws(() => sandbox.fs.openSync(outside, fs.constants.O_WRONLY), /blocked/);
  assert.throws(() => sandbox.fs.createWriteStream(outside), /blocked/);
  assert.throws(() => sandbox.fsp.readFile(outside), /only read/);
  assert.equal(await sandbox.fsp.readFile(path.join(bundle, "preload.js"), "utf8"), "// synthetic preload");
  assert.equal(await sandbox.fsp.readFile(path.join(bundle, "src", "runtime.js"), "utf8"), "// synthetic runtime");
  assert.throws(() => sandbox.fsp.readFile(path.join(bundle, "src", "financial-fixture.json")), /only read/);
  assert.throws(() => sandbox.fs.writeFileSync(path.join(bundle, "preload.js"), "bad"), /blocked/);
  assert.throws(() => sandbox.fs.renameSync(review.dataFilePath, outside), /blocked/);
  sandbox.fs.writeFileSync(path.join(root, "allowed.json"), "synthetic");
  let request, permission;
  events["session-created"]({ webRequest: { onBeforeRequest: fn => request = fn }, setPermissionRequestHandler: fn => permission = fn });
  let response;
  request({ url: "https://example.invalid" }, value => response = value);
  assert.equal(response.cancel, true);
  request({ url: "file:///synthetic" }, value => response = value);
  assert.equal(response.cancel, false);
  permission(null, "geolocation", value => response = value);
  assert.equal(response, false);
  assert.equal(fs.readFileSync(outside, "utf8"), "unchanged sentinel");
  assert.equal(fs.existsSync(path.join(parent, "review-guard-probe-must-not-exist.txt")), false);
  const log = fs.readFileSync(path.join(root, "review-runtime.jsonl"), "utf8");
  assert.match(log, /"outsideWriteRejected":true/);
  assert.match(log, /"stage":"guard-installed"/);
});

test("a pre-existing ordinary folder is not accepted as a disposable review profile", t => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".review-mode-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sandbox = isolatedModule();
  assert.throws(() => sandbox.api.configureReviewMode({ app: {}, session: {}, args: ["--review-root=" + root] }));
  assert.equal(fs.existsSync(path.join(root, "payment-tracker-data.json")), false);
});
