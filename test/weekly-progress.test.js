const test = require("node:test");
const assert = require("node:assert/strict");
const progress = require("../src/shared/weekly-progress");
const { createDefaultData, validateData } = require("../src/shared/data-schema");

const scope = progress.scopeForDate("employee", "contract", "2026-11-04");
const work = { id: "work", employeeId: "employee", contractId: "contract", weekStart: "2026-11-02", weekEnd: "2026-11-08", hours: 6, rateUsd: 11, totalUsd: 66 };
const fixture = () => ({ ...createDefaultData(), timeEntries: [structuredClone(work)] });

test("canonical progress weeks use Monday/Sunday through month/year and leap-day boundaries", () => {
  assert.deepEqual(progress.weekForDate("2027-01-01"), { weekStart: "2026-12-28", weekEnd: "2027-01-03" });
  assert.deepEqual(progress.weekForDate("2024-02-29"), { weekStart: "2024-02-26", weekEnd: "2024-03-03" });
  assert.deepEqual(progress.scopeFromKey(progress.key(scope)), scope);
  assert.equal(progress.scopeFromKey("employee|contract|2026-11-03|2026-11-09"), null);
  assert.throws(() => progress.weekForDate("2026-02-30"), /valid work date/);
});

test("recorded work stays completion-unconfirmed until an explicit metadata action", () => {
  const data = fixture();
  assert.equal(progress.stateForWeek(data, scope).status, "recorded");
  data.weeklyProgress = progress.markWeek(data, scope, "complete");
  assert.equal(progress.stateForWeek(data, scope).status, "complete");
  data.weeklyProgress = progress.markWeek(data, scope, "clear");
  assert.equal(progress.stateForWeek(data, scope).status, "recorded");
  assert.deepEqual(data.timeEntries, [work]);
});

test("No work is metadata only and cannot contradict any overlapping financial entry", () => {
  const data = fixture();
  const before = structuredClone(data);
  const emptyWeek = progress.scopeForDate("employee", "contract", "2026-11-09");
  const metadata = progress.markWeek(data, emptyWeek, "no-work");
  assert.deepEqual(data, before, "Pure marker helper must not mutate its input");
  const stored = { ...data, weeklyProgress: metadata };
  assert.equal(progress.stateForWeek(stored, emptyWeek).status, "no-work");
  assert.equal(stored.timeEntries.length, 1);
  assert.equal(stored.payouts.length, 0);
  assert.throws(() => progress.markWeek(data, scope, "no-work"), /overlapping work/);
  assert.throws(() => progress.markWeek(data, emptyWeek, "complete"), /Record work/);
  const persisted = validateData(JSON.parse(JSON.stringify(stored)));
  assert.equal(persisted.valid, true);
  assert.deepEqual(persisted.data.timeEntries, before.timeEntries);
  assert.deepEqual(persisted.data.weeklyProgress, metadata);
});

test("twelve-week history shows gaps and partial records independently per employee/contract", () => {
  const data = fixture();
  data.timeEntries.push({ ...work, id: "earlier", weekStart: "2026-09-07", weekEnd: "2026-09-13", hours: 2 });
  data.timeEntries.push({ ...work, id: "other-person", employeeId: "another" });
  const rows = progress.history(data, progress.scopeForDate("employee", "contract", "2026-11-09"));
  assert.equal(rows.length, 12);
  assert.equal(rows[0].status, "no-entry");
  assert.equal(rows[1].status, "recorded");
  assert.equal(rows[2].status, "no-entry", "Latest recorded work must not imply an earlier week complete");
  assert.equal(rows[1].entryCount, 1);
  assert.deepEqual(progress.recordedBounds(data, "employee", "contract"), { count: 2, first: "2026-09-07", latest: "2026-11-02" });
  assert.equal(progress.history(data, progress.scopeForDate("employee", "other-contract", "2026-11-09"))[1].status, "no-entry");
});

test("new/financially changed work invalidates affected markers while notes-only edits preserve them", () => {
  const data = fixture();
  const nextWeek = progress.scopeForDate("employee", "contract", "2026-11-09");
  const unrelated = progress.scopeForDate("another", "contract", "2026-11-09");
  data.weeklyProgress = { [progress.key(scope)]: { ...scope, status: "complete" }, [progress.key(nextWeek)]: { ...nextWeek, status: "no-work" }, [progress.key(unrelated)]: { ...unrelated, status: "no-work" } };
  const moved = { ...work, weekStart: "2026-11-09", weekEnd: "2026-11-15" };
  const invalidated = progress.invalidateForWorkChange(data, work, moved);
  assert.deepEqual(Object.keys(invalidated), [progress.key(unrelated)]);
  assert.deepEqual(progress.invalidateForWorkChange(data, work, { ...work, notes: "changed only" }), data.weeklyProgress);
  const newlyAdded = progress.invalidateForWorkChange(data, null, moved);
  assert.equal(newlyAdded[progress.key(nextWeek)], undefined);
  assert.ok(newlyAdded[progress.key(scope)]);
  assert.ok(data.weeklyProgress[progress.key(nextWeek)], "Invalidation must not mutate input metadata");
});

test("stale imported markers do not imply complete work or No work against records", () => {
  const data = fixture();
  const emptyWeek = progress.scopeForDate("employee", "contract", "2026-11-09");
  data.weeklyProgress = { [progress.key(scope)]: { status: "no-work" }, [progress.key(emptyWeek)]: { status: "complete" } };
  assert.equal(progress.stateForWeek(data, scope).status, "recorded");
  assert.equal(progress.stateForWeek(data, emptyWeek).status, "no-entry");
});
