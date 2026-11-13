const test = require("node:test");
const assert = require("node:assert/strict");
const { CURRENT_SCHEMA_VERSION, migrateData, validateData } = require("../src/shared/data-schema");

test("migrates legacy data through sequential schema versions and seeds unambiguous Upwork weekly FX", () => {
  const legacy = { sources: [{ id: "up", name: "Upwork" }], contracts: [{ id: "c1", sourceId: "up" }], incomingPayments: [{ contractId: "c1", workWeekStart: "2026-07-06", exchangeRate: 92.8765 }] };
  const result = migrateData(legacy);
  assert.equal(result.data.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(result.data.weeklyFxRates, [{ sourceId: "up", weekStart: "2026-07-06", exchangeRate: 92.8765 }]);
});

test("preserves conflicting legacy rates without silently selecting an override", () => {
  const result = migrateData({ sources: [{ id: "up", name: "Upwork" }], contracts: [{ id: "a", sourceId: "up" }, { id: "b", sourceId: "up" }], incomingPayments: [{ contractId: "a", workWeekStart: "2026-07-06", exchangeRate: 90 }, { contractId: "b", workWeekStart: "2026-07-06", exchangeRate: 91 }] });
  assert.equal(result.data.weeklyFxRates.length, 0);
  assert.equal(result.warnings.length, 1);
});

test("rejects malformed collections, invalid dates, and non-finite financial values", () => {
  assert.equal(validateData({ expenses: {} }).valid, false);
  assert.equal(validateData({ incomingPayments: [{ paymentDate: "2026/07/01", grossUsd: "nope" }] }).valid, false);
});

test("schema-2 historical work problems are warned about without rejection, repair or merging", () => {
  const timeEntries = [
    { id: "zero", employeeId: "e", contractId: "ct", hours: 0, weekStart: "2026-11-02", weekEnd: "2026-11-08", totalUsd: 123 },
    { id: "negative", employeeId: "e", contractId: "ct", hours: -2, weekStart: "2026-11-02", weekEnd: "2026-11-08", totalUsd: -10 },
    { id: "reversed", employeeId: "e", contractId: "ct", hours: 4, weekStart: "2026-11-09", weekEnd: "2026-11-02" },
    { id: "impossible", employeeId: "e", contractId: "ct", hours: 4, weekStart: "2026-02-30", weekEnd: "2026-03-01" },
    { id: "other-scope", employeeId: "other", contractId: "ct", hours: 4, weekStart: "2026-11-02", weekEnd: "2026-11-08" },
  ];
  const before = structuredClone(timeEntries);
  const result = validateData({ schemaVersion: 2, timeEntries });
  assert.equal(result.valid, true);
  assert.equal(result.migrated, false);
  assert.ok(result.warnings.some(warning => warning.includes("zero") && warning.includes("non-positive")));
  assert.ok(result.warnings.some(warning => warning.includes("negative") && warning.includes("non-positive")));
  assert.ok(result.warnings.some(warning => warning.includes("reversed") && warning.includes("before it starts")));
  assert.ok(result.warnings.some(warning => warning.includes("impossible") && warning.includes("calendar date")));
  const overlaps = result.warnings.filter(warning => warning.includes("overlap"));
  assert.equal(overlaps.length, 1);
  assert.match(overlaps[0], /zero|negative/);
  assert.doesNotMatch(overlaps[0], /other-scope/);
  assert.deepEqual(result.data.timeEntries, before);
  assert.deepEqual(timeEntries, before);
});
