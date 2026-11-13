const test = require("node:test");
const assert = require("node:assert/strict");
const updates = require("../src/shared/incoming-payment-updates");
const { validateData } = require("../src/shared/data-schema");

function payment(key, weekStart, overrides = {}) {
  return {
    key,
    id: key,
    contractId: "contract-1",
    workWeekStart: weekStart,
    workWeekEnd: "2026-07-05",
    grossUsd: 60,
    serviceChargeUsd: 6,
    whtPercent: 0.1,
    gstMode: "RCM",
    gstPercent: 18,
    transactionId: "",
    exchangeRate: 0,
    paymentDate: "",
    received: false,
    ...overrides,
  };
}

test("applies a transaction batch only to selected same-week rows and recalculates each row", () => {
  const first = payment("a", "2026-06-29");
  const second = payment("b", "2026-06-29", { grossUsd: 27, serviceChargeUsd: 2.7 });
  const unselected = payment("c", "2026-07-06", { transactionId: "existing", exchangeRate: 91, received: true });
  const result = updates.applyBulkPaymentDetails([first, second, unselected], ["a", "b"], {
    transactionId: "SYNTHETIC-TRANSACTION-001",
    exchangeRate: 92.87,
    paymentDate: "2026-07-15",
    markReceived: true,
  });

  assert.equal(result[0].transactionId, "SYNTHETIC-TRANSACTION-001");
  assert.equal(result[1].transactionId, "SYNTHETIC-TRANSACTION-001");
  assert.equal(result[0].exchangeRate, 92.87);
  assert.equal(result[1].received, true);
  assert.equal(result[0].gstPayableUsd, 1.08);
  assert.equal(result[1].gstPayableUsd, 0.49);
  assert.equal(result[0].netUsd, 53.94);
  assert.equal(result[0].netInr, 5009.41);
  assert.deepEqual(result[2], unselected);

  const persisted = validateData({ schemaVersion: 2, incomingPayments: JSON.parse(JSON.stringify(result)) });
  assert.equal(persisted.valid, true);
  assert.equal(persisted.data.incomingPayments[1].transactionId, "SYNTHETIC-TRANSACTION-001");
  assert.equal(persisted.data.incomingPayments[1].exchangeRate, 92.87);
  assert.equal(persisted.data.incomingPayments[2].transactionId, "existing");
});

test("refuses a bulk payment batch that spans work weeks", () => {
  assert.throws(
    () => updates.applyBulkPaymentDetails([payment("a", "2026-06-29"), payment("b", "2026-07-06")], ["a", "b"], { transactionId: "batch", exchangeRate: 92.87, paymentDate: "2026-07-15", markReceived: true }),
    /one work week only/,
  );
});

test("derives batch validation from the current selected work weeks", () => {
  const first = payment("a", "2026-06-29");
  const second = payment("b", "2026-07-06", { workWeekEnd: "2026-07-12" });

  assert.deepEqual(updates.batchSelectionState([first]), {
    selectedCount: 1,
    weekCount: 1,
    weekKeys: ["2026-06-29|2026-07-05"],
    isValid: true,
    hasMultipleWeeks: false,
  });
  assert.equal(updates.batchSelectionState([first, second]).hasMultipleWeeks, true);
  assert.equal(updates.batchSelectionState([first, second]).isValid, false);
  assert.equal(updates.batchSelectionState([first]).hasMultipleWeeks, false);
  assert.equal(updates.batchSelectionState([]).selectedCount, 0);
});

test("recalculates a manual service-charge override and preserves its durable flag", () => {
  const overridden = updates.recalculateIncomingPayment(payment("a", "2026-06-29", { serviceChargeUsd: 5.55, serviceChargeOverridden: true, exchangeRate: 92.8765 }));
  assert.equal(overridden.serviceChargeOverridden, true);
  assert.equal(overridden.gstPayableUsd, 1);
  assert.equal(overridden.netUsd, 54.39);
  assert.equal(overridden.netInr, 5051.55);

  const validation = validateData({ schemaVersion: 2, incomingPayments: [overridden] });
  assert.equal(validation.valid, true);
  assert.equal(validation.data.incomingPayments[0].serviceChargeOverridden, true);
});

test("requires overwrite confirmation only when a selected row already has transaction details", () => {
  const untouchedExisting = payment("existing", "2026-06-29", { transactionId: "old", exchangeRate: 92.5, paymentDate: "2026-07-08", received: true });
  const pending = payment("pending", "2026-06-29");

  assert.equal(updates.batchWouldOverwrite([pending, untouchedExisting], ["pending"]), false);
  assert.equal(updates.batchWouldOverwrite([pending, untouchedExisting], ["existing"]), true);
});
