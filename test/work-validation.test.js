const test = require("node:test");
const assert = require("node:assert/strict");
const { isCalendarDate, validateWorkEntry } = require("../src/shared/work-validation");

const entry = { id: "existing", employeeId: "employee", contractId: "contract", weekStart: "2026-11-02", weekEnd: "2026-11-08", hours: 6, rateUsd: 11, totalUsd: 66 };
const values = { employeeId: "employee", contractId: "contract", weekStart: "2026-11-09", weekEnd: "2026-11-15", hours: "6" };

test("requires real ISO calendar dates without imposing Monday or seven-day periods", () => {
  assert.equal(isCalendarDate("2024-02-29"), true);
  for (const invalid of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-11-31", "2026/11/02", "2026-1-02", ""]) assert.equal(isCalendarDate(invalid), false, invalid);
  assert.equal(validateWorkEntry({ ...values, weekStart: "2026-11-10", weekEnd: "2026-11-20" }).valid, true);
  assert.equal(validateWorkEntry({ ...values, weekEnd: values.weekStart }).valid, true);
  assert.equal(validateWorkEntry({ ...values, weekEnd: "2026-11-01" }).errors[0].field, "weekEnd");
});

test("financial work requires finite positive hours and points zero work toward progress metadata", () => {
  for (const hours of ["0", "", "-5", "NaN", "Infinity"]) {
    const result = validateWorkEntry({ ...values, hours });
    assert.equal(result.valid, false, hours);
    assert.equal(result.errors[0].field, "hours");
    assert.match(result.errors[0].message, /No work/);
  }
  assert.equal(validateWorkEntry({ ...values, hours: "0.25" }).valid, true);
});

test("blocks inclusive overlaps for the same employee/contract, not adjacent or other work", () => {
  const original = structuredClone(entry);
  for (const [start, end] of [["2026-11-02", "2026-11-08"], ["2026-11-08", "2026-11-14"], ["2026-10-30", "2026-11-03"]]) {
    const result = validateWorkEntry({ ...values, weekStart: start, weekEnd: end }, [entry]);
    assert.equal(result.valid, false);
    assert.equal(result.overlaps[0].id, "existing");
  }
  assert.equal(validateWorkEntry(values, [entry]).valid, true);
  assert.equal(validateWorkEntry({ ...values, weekStart: entry.weekStart, weekEnd: entry.weekEnd, employeeId: "another" }, [entry]).valid, true);
  assert.equal(validateWorkEntry({ ...values, weekStart: entry.weekStart, weekEnd: entry.weekEnd, contractId: "another" }, [entry]).valid, true);
  assert.deepEqual(entry, original, "Validation must not mutate historical work");
});

test("an edit excludes itself; unchanged financial fields may preserve a legacy overlap", () => {
  const overlapping = { ...entry, id: "legacy-overlap", weekStart: "2026-11-05", weekEnd: "2026-11-11" };
  const edit = { ...entry, hours: "6", notes: "notes only" };
  assert.equal(validateWorkEntry(edit, [entry], { editId: entry.id }).valid, true);
  const preserved = validateWorkEntry(edit, [entry, overlapping], { editId: entry.id });
  assert.equal(preserved.valid, true);
  assert.equal(preserved.unchangedFinancialEdit, true);
  assert.equal(preserved.preservesLegacyOverlap, true);
  assert.equal(validateWorkEntry({ ...edit, hours: "7" }, [entry, overlapping], { editId: entry.id }).valid, false);
  assert.equal(validateWorkEntry({ ...edit, weekEnd: "2026-11-09" }, [entry, overlapping], { editId: entry.id }).valid, false);
});

test("agency payroll aliases and year-boundary overlaps are compared consistently", () => {
  const agency = { ...entry, contractId: "", weekStart: "2026-12-28", weekEnd: "2027-01-03" };
  const result = validateWorkEntry({ ...values, contractId: "__agency__", weekStart: "2027-01-01", weekEnd: "2027-01-07" }, [agency]);
  assert.equal(result.valid, false);
  assert.equal(result.overlaps[0], agency);
});
