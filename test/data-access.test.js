const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDataAccess } = require("../src/main/data-access");
const { createDefaultData, validateData } = require("../src/shared/data-schema");
const { listSnapshots } = require("../src/main/data-store");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "payment-tracker-recovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, dataFile: path.join(root, "payment-tracker-data.json"), settingsFile: path.join(root, "payment-tracker-settings.json") };
}

test("corrupt data loads and blocked saves leave original bytes and settings unchanged", async t => {
  const f = await fixture(t);
  const malformed = '{"schemaVersion":2,';
  await fs.writeFile(f.dataFile, malformed);
  await fs.writeFile(f.settingsFile, "not valid settings");
  const store = createDataAccess({ userDataPath: f.root, dataFileOverride: f.dataFile });
  await assert.rejects(store.readData(), /Data could not load/);
  await assert.rejects(store.writeData(createDefaultData()), /before saving/);
  assert.equal(await fs.readFile(f.dataFile, "utf8"), malformed);
  assert.equal(await fs.readFile(f.settingsFile, "utf8"), "not valid settings");
  assert.deepEqual(await listSnapshots(f.dataFile), []);
});

test("unavailable configured storage is not silently replaced by an empty dataset", async t => {
  const f = await fixture(t);
  const missing = path.join(f.root, "unavailable", "data.json");
  const settings = JSON.stringify({ dataFilePath: missing });
  await fs.writeFile(f.settingsFile, settings);
  const store = createDataAccess({ userDataPath: f.root });
  await assert.rejects(store.readData(), /Data could not load/);
  await assert.rejects(store.writeData(createDefaultData()), /before saving/);
  assert.equal(await fs.readFile(f.settingsFile, "utf8"), settings);
  await assert.rejects(fs.access(missing));
});

test("a valid file can be adopted after settings failure without changing the chosen file", async t => {
  const f = await fixture(t);
  const invalidSettings = "broken settings";
  await fs.writeFile(f.settingsFile, invalidSettings);
  const backup = path.join(f.root, "valid-backup.json");
  const bytes = JSON.stringify({ ...createDefaultData(), employees: [{ id: "synthetic", name: "Synthetic" }] });
  await fs.writeFile(backup, bytes);
  const store = createDataAccess({ userDataPath: f.root });
  await assert.rejects(store.readData(), /Settings could not load/);
  assert.equal(store.recoveryState().canImport, false);
  await store.useDataFile(backup);
  assert.equal(store.recoveryState().canImport, true);
  assert.equal((await store.readData()).employees[0].id, "synthetic");
  assert.equal(await fs.readFile(backup, "utf8"), bytes);
  assert.equal(JSON.parse(await fs.readFile(f.settingsFile, "utf8")).dataFilePath, backup);
  const snapshots = await listSnapshots(f.settingsFile);
  assert.equal(snapshots.length, 1);
  assert.equal(await fs.readFile(snapshots[0].filePath, "utf8"), invalidSettings);
});

test("import loses permission when previously valid settings become unreadable", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.settingsFile, JSON.stringify({ dataFilePath: f.dataFile }));
  const original = JSON.stringify(createDefaultData());
  await fs.writeFile(f.dataFile, original);
  const store = createDataAccess({ userDataPath: f.root });
  await store.readData();
  assert.equal(store.recoveryState().canImport, true);
  await fs.writeFile(f.settingsFile, "malformed settings");
  await assert.rejects(store.readData(), /Settings could not load/);
  assert.equal(store.recoveryState().canImport, false);
  assert.match(store.recoveryState().reason, /Choose a valid data file or backup first/);
  await assert.rejects(store.writeData(createDefaultData(), { recoveryImport: true }), /Settings could not load/);
  assert.equal(await fs.readFile(f.dataFile, "utf8"), original);
});

test("invalid recovery choices do not change the selected path or settings", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.dataFile, JSON.stringify(createDefaultData()));
  const settings = JSON.stringify({ dataFilePath: f.dataFile });
  await fs.writeFile(f.settingsFile, settings);
  const bad = path.join(f.root, "invalid-choice.json");
  await fs.writeFile(bad, '{"schemaVersion":99}');
  const store = createDataAccess({ userDataPath: f.root });
  await store.readData();
  await assert.rejects(store.useDataFile(bad), /newer than/);
  assert.equal(store.dataPath(), f.dataFile);
  assert.equal(await fs.readFile(f.settingsFile, "utf8"), settings);
  assert.deepEqual(await listSnapshots(f.settingsFile), []);
});

test("retry can read corrected data and changed settings without restarting", async t => {
  const f = await fixture(t);
  const other = path.join(f.root, "recovered.json");
  await fs.writeFile(f.settingsFile, JSON.stringify({ dataFilePath: f.dataFile }));
  await fs.writeFile(f.dataFile, "broken");
  const store = createDataAccess({ userDataPath: f.root });
  await assert.rejects(store.readData());
  await fs.writeFile(other, JSON.stringify(createDefaultData()));
  await fs.writeFile(f.settingsFile, JSON.stringify({ dataFilePath: other }));
  assert.equal((await store.readData()).schemaVersion, 2);
  assert.equal(store.dataPath(), other);
  assert.equal(await fs.readFile(f.dataFile, "utf8"), "broken");
});

test("explicit recovery import backs up malformed original before replacing it", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.dataFile, "broken original");
  const store = createDataAccess({ userDataPath: f.root, dataFileOverride: f.dataFile });
  await assert.rejects(store.readData());
  await store.writeData(createDefaultData(), { backupReason: "import", recoveryImport: true });
  const snapshots = await listSnapshots(f.dataFile);
  assert.equal(snapshots.length, 1);
  assert.equal(await fs.readFile(snapshots[0].filePath, "utf8"), "broken original");
  assert.equal((await store.readData()).schemaVersion, 2);
});

test("legacy load/import/save are blocked without invoking historical migration", async t => {
  const f = await fixture(t);
  const original = JSON.stringify({ ...createDefaultData(), schemaVersion: 1 });
  await fs.writeFile(f.dataFile, original);
  const store = createDataAccess({ userDataPath: f.root, dataFileOverride: f.dataFile });
  await assert.rejects(store.readData(), /Migration requires separate authorization/);
  assert.equal(await fs.readFile(f.dataFile, "utf8"), original);
  assert.deepEqual(await listSnapshots(f.dataFile), []);
  await assert.rejects(store.validateFile(f.dataFile), /Migration requires separate authorization/);
  await assert.rejects(store.writeData(JSON.parse(original), { recoveryImport: true, backupReason: "import" }), /Migration requires separate authorization/);
  assert.equal(await fs.readFile(f.dataFile, "utf8"), original);
  assert.deepEqual(await listSnapshots(f.dataFile), []);
});

test("missing INR is warned about without filling values or rejecting the file", () => {
  const value = { ...createDefaultData(), expenses: [{ id: "synthetic", gstMode: "RCM", amountUsd: 100, exchangeRate: 83, gstPayableUsd: 18 }] };
  const validation = validateData(value);
  assert.equal(validation.valid, true);
  assert.equal(validation.warnings.length, 2);
  assert.equal(Object.hasOwn(validation.data.expenses[0], "gstPayableInr"), false);
  assert.equal(Object.hasOwn(validation.data.expenses[0], "amountInr"), false);
  assert.equal(validation.data.expenses[0].exchangeRate, 83);
  const zero = validateData({ ...value, expenses: [{ ...value.expenses[0], amountInr: 0, gstPayableInr: 0 }] });
  assert.deepEqual(zero.warnings, []);
});
