const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MAX_BACKUPS, backupDirectoryFor, createSnapshot, listSnapshots, writeTextAtomically } = require("../src/main/data-store");

test("creates forced snapshots before destructive work and throttles automatic snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "payment-tracker-test-"));
  const dataPath = path.join(directory, "payment-tracker-data.json");
  await writeTextAtomically(dataPath, '{"schemaVersion":2}');
  const first = await createSnapshot(dataPath, { reason: "import", force: true, now: new Date("2026-07-01T00:00:00Z") });
  const skipped = await createSnapshot(dataPath, { reason: "automatic", now: new Date("2026-07-01T01:00:00Z") });
  assert.ok(first.startsWith(backupDirectoryFor(dataPath)));
  assert.equal(skipped, null);
  assert.equal((await listSnapshots(dataPath)).length, 1);
});

test("keeps the newly created snapshot when rotation is at capacity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "payment-tracker-rotation-test-"));
  const dataPath = path.join(directory, "payment-tracker-data.json");
  await writeTextAtomically(dataPath, '{"schemaVersion":2}');

  for (let index = 0; index < MAX_BACKUPS; index += 1) {
    await createSnapshot(dataPath, { reason: "rotation", force: true, now: new Date(`2026-07-01T00:00:${String(index).padStart(2, "0")}Z`) });
  }

  const newest = await createSnapshot(dataPath, { reason: "import", force: true, now: new Date("2026-07-01T00:01:00Z") });
  await fs.access(newest);
  assert.equal((await listSnapshots(dataPath)).length, MAX_BACKUPS);
});
