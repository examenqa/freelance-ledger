const test = require("node:test");
const assert = require("node:assert/strict");
const calculations = require("../src/shared/calculations");

test("rounds decimal FX and payment deductions consistently", () => {
  assert.equal(calculations.round(1.005), 1.01);
  assert.equal(calculations.calculateWht(123.45, 0.1), 0.12);
  assert.equal(calculations.calculateIncomingNet(100, 10, 0.1), 89.9);
  assert.deepEqual(calculations.calculatePayoutLine(12.5, 4.99, 92.8765), { totalUsd: 62.38, totalInr: 5793.64 });
});

test("handles GST modes and partial received payments in overview totals", () => {
  assert.equal(calculations.calculateGstPayable(10, "RCM", 18), 1.8);
  assert.equal(calculations.calculateGstPayable(10, "COLLECTED", 18), 0);
  const metrics = calculations.calculateOverviewMetrics({
    receivedIncoming: [{ grossUsd: 100, exchangeRate: 90.5, serviceChargeUsd: 10, whtUsd: 0.1, netUsd: 89.9, netInr: 8135.95, gstPayableUsd: 1.8, gstPayableInr: 162.9 }],
    outstandingIncoming: [{ netUsd: 40 }],
    periodPayouts: [{ totalUsd: 20, totalInr: 1810 }],
    periodExpenses: [{ amountUsd: 5, amountInr: 452.5, gstPayableUsd: 0, gstPayableInr: 0 }],
    estimatedRateFor: () => 91,
    referenceRate: 90.5,
  });
  assert.equal(metrics.outstandingIncomingUsd, 40);
  assert.equal(metrics.outstandingIncomingInr, 3640);
  assert.equal(metrics.agencyGainsUsd, 63.1);
});

test("calculates Incoming RCM GST from the shared helper for decimal and zero-value payments", () => {
  assert.equal(calculations.calculateGstPayable(6, "RCM", 18), 1.08);
  assert.equal(calculations.calculateGstPayable(2.7, "RCM", 18), 0.49);
  assert.equal(calculations.calculateGstPayable(2.95, "RCM", 18), 0.53);
  assert.equal(calculations.calculateGstPayable(2.95, "COLLECTED", 18), 0);
  assert.equal(calculations.calculateGstPayable(0, "RCM", 18), 0);
  assert.equal(calculations.round(calculations.calculateGstPayable(2.95, "RCM", 18) * 92.8765), 49.22);
});

test("keeps payment and payout months independent when the caller supplies each selected period", () => {
  const may = calculations.calculateOverviewMetrics({ receivedIncoming: [{ grossUsd: 50, exchangeRate: 90, netUsd: 45, netInr: 4050 }], outstandingIncoming: [], periodPayouts: [], periodExpenses: [], estimatedRateFor: () => 0, referenceRate: 90 });
  const june = calculations.calculateOverviewMetrics({ receivedIncoming: [], outstandingIncoming: [], periodPayouts: [{ totalUsd: 20, totalInr: 1800 }], periodExpenses: [], estimatedRateFor: () => 0, referenceRate: 90 });
  assert.equal(may.payoutsPaidUsd, 0);
  assert.equal(june.grossIncomeUsd, 0);
  assert.equal(june.payoutsPaidUsd, 20);
});

test("keeps outstanding incoming and pending payout totals all-time across Overview periods", () => {
  const outstandingIncoming = [{ netUsd: 40 }, { netUsd: 20 }];
  const pendingPayouts = [
    { weekStart: "2026-05-25", totalUsd: 30, totalInr: 2700, paid: false },
    { weekStart: "2026-06-01", totalUsd: 20, totalInr: 1800, paid: false },
  ];
  const mayRange = { start: new Date("2026-05-01T00:00:00"), end: new Date("2026-05-31T23:59:59") };
  const juneRange = { start: new Date("2026-06-01T00:00:00"), end: new Date("2026-06-30T23:59:59") };

  const may = calculations.calculateOverviewMetrics({
    receivedIncoming: [],
    outstandingIncoming,
    periodPayouts: [],
    pendingPayouts,
    periodPendingPayouts: calculations.pendingPayoutsForPeriod(pendingPayouts, mayRange),
    periodExpenses: [],
    estimatedRateFor: () => 90,
    referenceRate: 90,
  });
  const june = calculations.calculateOverviewMetrics({
    receivedIncoming: [],
    outstandingIncoming,
    periodPayouts: [],
    pendingPayouts,
    periodPendingPayouts: calculations.pendingPayoutsForPeriod(pendingPayouts, juneRange),
    periodExpenses: [],
    estimatedRateFor: () => 90,
    referenceRate: 90,
  });

  assert.equal(may.outstandingIncomingUsd, 60);
  assert.equal(june.outstandingIncomingUsd, 60);
  assert.equal(may.outstandingIncomingInr, 5400);
  assert.equal(june.outstandingIncomingInr, 5400);
  assert.equal(may.pendingPayoutsUsd, 50);
  assert.equal(june.pendingPayoutsUsd, 50);
  assert.equal(may.pendingPayoutsInr, 4500);
  assert.equal(june.pendingPayoutsInr, 4500);
});

test("excludes paid payouts from pending totals and deducts only selected-period work weeks from agency gains", () => {
  const payouts = [
    { weekStart: "2026-05-25", totalUsd: 30, totalInr: 2700, paid: false },
    { weekStart: "2026-06-01", totalUsd: 20, totalInr: 1800, paid: false },
    { weekStart: "2026-05-18", totalUsd: 5, totalInr: 450, paid: true },
  ];
  const pendingPayouts = payouts.filter((item) => item.paid !== true);
  const mayRange = { start: new Date("2026-05-01T00:00:00"), end: new Date("2026-05-31T23:59:59") };
  const mayMetrics = calculations.calculateOverviewMetrics({
    receivedIncoming: [{ grossUsd: 100, exchangeRate: 90, serviceChargeUsd: 10, whtUsd: 0, netUsd: 90, netInr: 8100, gstPayableUsd: 0, gstPayableInr: 0 }],
    outstandingIncoming: [],
    periodPayouts: [{ totalUsd: 5, totalInr: 450 }],
    pendingPayouts,
    periodPendingPayouts: calculations.pendingPayoutsForPeriod(pendingPayouts, mayRange),
    periodExpenses: [{ amountUsd: 5, amountInr: 450, gstPayableUsd: 0, gstPayableInr: 0 }],
    estimatedRateFor: () => 0,
    referenceRate: 90,
  });

  assert.equal(mayMetrics.pendingPayoutsUsd, 50);
  assert.equal(mayMetrics.pendingPayoutsInr, 4500);
  assert.equal(mayMetrics.periodPendingPayoutsUsd, 30);
  assert.equal(mayMetrics.periodPendingPayoutsInr, 2700);
  assert.equal(mayMetrics.payoutsPaidUsd, 5);
  assert.equal(mayMetrics.agencyGainsUsd, 50);
  assert.equal(mayMetrics.agencyGainsInr, 4500);
});

test("assigns pending payouts wholly by Monday weekStart at month and financial-year boundaries", () => {
  const payouts = [
    { weekStart: "2026-03-30", totalUsd: 10, paid: false },
    { weekStart: "2026-04-06", totalUsd: 20, paid: false },
    { weekStart: "2026-06-29", totalUsd: 30, paid: false },
    { weekStart: "2026-07-06", totalUsd: 40, paid: false },
  ];
  const financialYear = { start: new Date("2026-04-01T00:00:00"), end: new Date("2027-03-31T23:59:59") };
  const july = { start: new Date("2026-07-01T00:00:00"), end: new Date("2026-07-31T23:59:59") };

  assert.deepEqual(calculations.pendingPayoutsForPeriod(payouts, financialYear).map((item) => item.totalUsd), [20, 30, 40]);
  assert.deepEqual(calculations.pendingPayoutsForPeriod(payouts, july).map((item) => item.totalUsd), [40]);
});

test("uses Monday-to-Sunday weeks and inclusive month boundaries", () => {
  assert.deepEqual(calculations.weekBounds("2026-07-12T12:00:00"), { weekStart: "2026-07-06", weekEnd: "2026-07-12", weekStartDate: new Date("2026-07-06T00:00:00"), weekEndDate: new Date("2026-07-12T00:00:00") });
  const july = { start: new Date("2026-07-01T00:00:00"), end: new Date("2026-07-31T23:59:59") };
  assert.equal(calculations.isDateInRange("2026-07-01", july), true);
  assert.equal(calculations.isDateInRange("2026-07-31", july), true);
  assert.equal(calculations.isDateInRange("2026-08-01", july), false);
});
