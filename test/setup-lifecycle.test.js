const test = require("node:test");
const assert = require("node:assert/strict");
const { dependencyCounts } = require("../src/shared/setup-lifecycle");
const { createDefaultData, validateData } = require("../src/shared/data-schema");

test("linked setup dependencies include historical data without mutating records", () => {
  const data = { ...createDefaultData(),
    sources: [{ id: "s" }], clients: [{ id: "c", sourceId: "s" }],
    contracts: [{ id: "ct", clientId: "c", sourceId: "s" }],
    employeeRates: [{ id: "r", employeeId: "e", contractId: "ct" }],
    timeEntries: [{ id: "t", employeeId: "e", contractId: "ct", hours: 8, rateUsd: 10 }],
    incomingPayments: [{ id: "i", contractId: "ct", grossUsd: 80 }],
    payouts: [{ id: "p", employeeId: "e", contractId: "ct", paid: true }],
    expenses: [{ id: "x", expenseTypeId: "et", amountUsd: 10 }],
    weeklyFxRates: [{ sourceId: "s", weekStart: "2026-11-02", exchangeRate: 83 }],
    weeklyProgress: { "e|ct|2026-11-02|2026-11-08": { status: "complete" } },
  };
  const original = structuredClone(data);
  assert.deepEqual(dependencyCounts(data, "sources", "s"), { clients: 1, weeklyFxRates: 1, contracts: 1, employeeRates: 1, timeEntries: 1, incomingPayments: 1, payouts: 1, weeklyProgress: 1 });
  assert.deepEqual(dependencyCounts(data, "employees", "e"), { employeeRates: 1, timeEntries: 1, payouts: 1, weeklyProgress: 1 });
  assert.deepEqual(dependencyCounts(data, "expenseTypes", "et"), { expenses: 1 });
  assert.deepEqual(dependencyCounts(data, "employeeRates", "r"), { timeEntries: 1, payouts: 1 });
  assert.deepEqual(dependencyCounts(data, "contracts", "unused"), {});
  assert.deepEqual(data, original);
});

test("historical generated payout lines prevent linked setup deletion even without work rows", () => {
  const data = { ...createDefaultData(),
    sources: [{ id: "s" }], clients: [{ id: "c", sourceId: "s" }], contracts: [{ id: "ct", sourceId: "s", clientId: "c" }],
    employeeRates: [{ id: "r", employeeId: "e", contractId: "ct" }],
    payouts: [{ id: "e|2026-11-02|2026-11-08", employeeId: "e", paid: true, totalUsd: 120,
      contracts: [{ contractId: "ct", totalUsd: 100 }, { contractId: "ct", totalUsd: 20 }] }],
  };
  assert.deepEqual(dependencyCounts(data, "contracts", "ct"), { employeeRates: 1, payouts: 1 });
  assert.equal(dependencyCounts(data, "sources", "s").payouts, 1);
  assert.equal(dependencyCounts(data, "clients", "c").payouts, 1);
  assert.deepEqual(dependencyCounts(data, "employeeRates", "r"), { payouts: 1 });
});

test("agency-rate dependencies distinguish explicit agency lines from absent legacy contract fields", () => {
  const data = { ...createDefaultData(), employeeRates: [{ id: "agency-rate", employeeId: "e", contractId: "" }],
    payouts: [{ id: "other-contract-period", employeeId: "e", paid: true, contracts: [{ contractId: "ct", totalUsd: 100 }] }],
  };
  assert.deepEqual(dependencyCounts(data, "employeeRates", "agency-rate"), {}, "A missing top-level contractId does not make a generated payout an agency payout");
  data.payouts.push({ id: "agency-period", employeeId: "e", contracts: [{ contractId: "", totalUsd: 50 }, { contractId: "ct", totalUsd: 30 }] });
  assert.deepEqual(dependencyCounts(data, "employeeRates", "agency-rate"), { payouts: 1 });
  data.payouts.push({ id: "legacy-agency", employeeId: "e", contractId: "", totalUsd: 20 });
  assert.deepEqual(dependencyCounts(data, "employeeRates", "agency-rate"), { payouts: 2 }, "An explicitly stored flat agency contract field remains supported");
});

test("archived metadata and optional progress preserve identity and financial values", () => {
  const value = { ...createDefaultData(), employees: [{ id: "e", archived: true }], timeEntries: [{ id: "t", employeeId: "e", hours: 8, totalUsd: 80 }], weeklyProgress: { "e||2026-11-02|2026-11-08": { status: "no-work" } } };
  const validated = validateData(value);
  assert.equal(validated.valid, true);
  assert.equal(validated.migrated, false);
  assert.deepEqual(validated.data, value);
  assert.equal(validateData({ ...value, weeklyProgress: { bad: { status: "inferred" } } }).valid, false);
});
