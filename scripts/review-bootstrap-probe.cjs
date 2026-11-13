// Run directly with Node to exercise the real shared fs objects, without Electron
// or subprocess spawning by node:test. The supplied root must be disposable.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { configureReviewMode } = require("../src/main/review-mode");
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error("Supply an absolute new disposable review root.");
const paths = {}, handlers = {};
const app = {
  setPath: (name, value) => paths[name] = value,
  getPath: name => paths[name],
  commandLine: { appendSwitch() {} },
  on: (event, handler) => handlers[event] = handler,
  whenReady: () => new Promise(() => {}),
};
const bundle = path.resolve(__dirname, "..");
const review = configureReviewMode({ app, session: {}, args: ["--review-root=" + root], bundleReadRoot: bundle });
review.prepareData({ schemaVersion: 2 });
const outside = path.join(root, "..", "probe-outside-must-not-exist.json");
assert.throws(() => fs.writeFileSync(outside, "must not write"), /blocked/);
assert.throws(() => fsp.writeFile(outside, "must not write"), /blocked/);
assert.equal(fs.existsSync(outside), false);
fs.writeFileSync(path.join(root, "allowed.json"), "synthetic");
fs.appendFileSync(path.join(root, "allowed.json"), " appended");
assert.equal(fs.readFileSync(path.join(root, "allowed.json"), "utf8"), "synthetic appended");
const lines = fs.readFileSync(path.join(root, "review-runtime.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
assert.ok(lines.some(line => line.type === "guard-self-test" && line.outsideWriteRejected));
assert.ok(lines.some(line => line.type === "bootstrap"));
assert.equal(paths.userData, path.join(root, "profile"));
fsp.readFile(path.join(bundle, "preload.js"), "utf8").then(text => {
  assert.match(text, /contextBridge/);
  assert.throws(() => fsp.readFile(path.join(bundle, "test-payment-tracker-data.json")), /only read/);
  handlers["will-quit"]();
  console.log(JSON.stringify({ realFsBootstrap: "passed", logRecords: lines.length, outsideWriteBlocked: true, profileIsolated: true, bundlePreloadReadable: true }));
}).catch(error => { console.error(error); process.exitCode = 1; });
