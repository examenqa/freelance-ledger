const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAnalytics, strictNumber } = require("../src/shared/analytics");
const { createDefaultData } = require("../src/shared/data-schema");
const now = new Date(2026, 10, 13, 12);

function fixture() {
  return { ...createDefaultData(),
    sources: [{ id: "s", name: "Local" }],
    clients: [{ id: "ca", name: "Client A", archived: true }, { id: "cb", name: "Client B" }],
    contracts: [{ id: "a", name: "A", clientId: "ca", sourceId: "s", priceType: "HOURLY", priceUsd: 25, archived: true }, { id: "b", name: "B", clientId: "cb", sourceId: "s", priceType: "HOURLY", priceUsd: 30 }],
    employees: [{ id: "e", name: "Employee", archived: true }], expenseTypes: [{ id: "type", name: "Tools" }],
    incomingPayments: [{ id: "r", contractId: "a", paymentDate: "2026-11-03", workWeekStart: "2026-10-26", workWeekEnd: "2026-11-01", netUsd: 90, netInr: 7200, received: true }],
    timeEntries: [{ id: "w", contractId: "a", employeeId: "e", weekStart: "2026-10-26", weekEnd: "2026-11-01", hours: 4, rateUsd: 10, totalUsd: 40 }],
    expenses: [{ id: "x", expenseTypeId: "type", label: "License", expenseDate: "2026-11-05", amountUsd: 10, amountInr: 830, gstPayableUsd: 1.8, gstPayableInr: 149.4 }],
    payouts: [{ id: "p", employeeId: "e", weekStart: "2026-10-26", weekEnd: "2026-11-01", payoutDate: "2026-11-12", paidDate: "2026-11-13", paid: true, totalUsd: 70, totalInr: 5800,
      contracts: [{ contractId: "a", hours: 3, rateUsd: 20, totalUsd: 50, exchangeRate: 80, totalInr: 4000 }, { contractId: "b", hours: 4, rateUsd: 5, totalUsd: 20, exchangeRate: 90, totalInr: 1800 }] }],
  };
}

function frozen(value) { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(frozen); } return value; }
const view = (data, filters = {}) => buildAnalytics(data, { month: "2026-11", ...filters }, now);

test("strict numeric validation distinguishes zero from missing, malformed and coercible nonnumeric types", () => {
  for (const value of [undefined, null, "", " ", false, true, [], [1], {}, "no", Infinity, NaN, "Infinity", "0x10"]) assert.equal(strictNumber(value), null);
  for (const value of [0, "0", " 0 ", "1.25", "-2", "1e2"]) assert.equal(strictNumber(value), Number(value));
});

test("saved amounts stay independent of current rates, GST and FX and immutable input", () => {
  const data = frozen(fixture()), before = JSON.stringify(data), result = view(data);
  assert.equal(result.metrics.receipts.summary.usd.value, 90);
  assert.equal(result.metrics.receipts.summary.inr.value, 7200);
  assert.equal(result.metrics.expenses.summary.usd.value, 10, "GST must not be added to expense base");
  assert.equal(result.metrics.payouts.summary.usd.value, 70);
  assert.equal(result.metrics.payouts.summary.inr.value, 5800);
  assert.equal(JSON.stringify(data), before);
});

test("work belongs entirely to start month and trailing-twelve trend ends at the selected anchor month", () => {
  const result = view(fixture());
  assert.equal(result.metrics.hours.summary.hours.value, 0);
  assert.equal(view(fixture(), { month: "2026-10" }).metrics.hours.summary.hours.value, 4);
  assert.equal(result.metrics.hours.monthly.find(row => row.month === "2026-10").summary.hours.value, 4);
  assert.deepEqual(result.trendMonths, ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.equal(view(fixture(), { month: "2024-01" }).metrics.receipts.monthly.at(-1).month, "2024-01");
});

test("undated saved money is counted All-time, visible separately and never assigned to a monthly date", () => {
  const data = fixture(); data.incomingPayments[0].paymentDate = "2026-02-30";
  const monthly = view(data).metrics.receipts, all = view(data, { period: "all-time" }).metrics.receipts;
  assert.equal(monthly.summary.usd.value, null);
  assert.equal(monthly.summary.usd.knownSubtotal, 0);
  assert.equal(monthly.rows[0].included, false);
  assert.equal(monthly.undated.summary.usd.value, 90);
  assert.equal(all.summary.usd.value, 90);
  assert.equal(all.undated.rows.length, 1);
  assert.ok(all.monthly.every(bucket => bucket.summary.usd.value === null));
});

test("legacy absent received follows app convention while malformed statuses remain unresolved", () => {
  const data = fixture(); delete data.incomingPayments[0].received;
  assert.equal(view(data).metrics.receipts.summary.usd.value, 90);
  assert.ok(view(data).metrics.receipts.rows[0].issues.some(issue => issue.code === "legacy-received"));
  data.incomingPayments[0].received = "true";
  assert.equal(view(data).metrics.receipts.summary.usd.value, null);
  assert.equal(view(data).metrics.receipts.summary.usd.knownSubtotal, 0);
});

test("duplicate IDs are quarantined and exact occurrence references survive", () => {
  const data = fixture(); data.incomingPayments.push({ ...data.incomingPayments[0] });
  const result = view(data);
  assert.equal(result.metrics.receipts.summary.usd.value, null);
  assert.equal(result.metrics.receipts.summary.usd.knownSubtotal, 0);
  assert.deepEqual(result.warnings.find(row => row.code === "duplicate-id").refs.map(ref => ref.index), [0, 1]);
});

test("same-work receipt IDs retain saved known subtotal and qualify ambiguous completeness", () => {
  const data = fixture(); data.incomingPayments.push({ ...data.incomingPayments[0], id: "r2", netUsd: 5, netInr: 400 });
  const metric = view(data).metrics.receipts;
  assert.equal(metric.summary.usd.knownSubtotal, 95);
  assert.equal(metric.summary.usd.value, null);
  assert.equal(metric.summary.usd.exceptionCount, 2);
  assert.equal(metric.rows.length, 2);
});

test("invalid and overlapping hours are excluded without repairing legacy periods", () => {
  const data = fixture(); data.timeEntries.push({ ...data.timeEntries[0], id: "overlap", weekStart: "2026-11-01", weekEnd: "2026-11-02", hours: 2 });
  const result = view(data, { period: "all-time" });
  assert.equal(result.metrics.hours.summary.hours.value, null);
  assert.equal(result.metrics.hours.summary.hours.knownSubtotal, 0);
  assert.equal(result.metrics.hours.rows.filter(row => row.quarantined).length, 2);
  data.timeEntries = [{ ...data.timeEntries[0], weekEnd: "2026-02-30" }];
  assert.equal(view(data, { period: "all-time" }).metrics.hours.summary.hours.value, null);
});

test("USD and INR completeness never substitute missing values or genuine zero", () => {
  const data = fixture(); data.expenses[0].amountUsd = 0; delete data.expenses[0].amountInr;
  const result = view(data).metrics.expenses;
  assert.equal(result.summary.usd.value, 0);
  assert.equal(result.summary.inr.value, null);
  assert.equal(result.summary.inr.missingCount, 1);
  data.expenses[0].amountInr = 0;
  assert.equal(view(data).metrics.expenses.summary.inr.value, 0);
});

test("saved payout parents control overall and matching reconciled lines control contract/client filters", () => {
  const data = fixture();
  const all = view(data).metrics.payouts, a = view(data, { contractId: "a" }).metrics.payouts, b = view(data, { clientId: "cb" }).metrics.payouts;
  assert.equal(all.summary.usd.value, 70);
  assert.equal(a.summary.usd.value, 50); assert.equal(a.summary.inr.value, 4000);
  assert.equal(b.summary.usd.value, 20); assert.equal(b.summary.inr.value, 1800);
  assert.equal(a.rows[0].saved.usd, 70);
  assert.equal(a.rows[0].sourceRefs[0].path, "contracts[0]");
  assert.equal(all.breakdowns.contract.find(group => group.id === "a").summary.usd.value, 50);
  assert.equal(all.breakdowns.contract.find(group => group.id === "a").rows[0].usd, 50);
  assert.equal(a.breakdowns.contract[0].summary.usd.value, 50);
});

test("payout allocation fails independently by currency without inventing a balancing residual", () => {
  const data = fixture(); data.payouts[0].totalInr = 5799;
  const all = view(data).metrics.payouts, selected = view(data, { contractId: "a" }).metrics.payouts;
  assert.equal(all.summary.usd.value, 70); assert.equal(all.summary.inr.value, 5799);
  assert.equal(selected.summary.usd.value, 50); assert.equal(selected.summary.inr.value, null);
  const unresolved = all.breakdowns.contract.find(group => group.id === "__unallocated__");
  assert.equal(unresolved.summary.inr.value, 5799, "Retain whole parent unresolved, never difference -1");
  assert.equal(all.breakdowns.contract.find(group => group.id === "a").summary.inr.value, null);
  delete data.payouts[0].totalUsd;
  assert.equal(view(data).metrics.payouts.summary.usd.value, null);
});

test("missing payout lines keep parent totals but cannot be attributed under filters", () => {
  const data = fixture(); data.payouts[0].contracts = [];
  assert.equal(view(data).metrics.payouts.summary.usd.value, 70);
  assert.equal(view(data, { clientId: "ca" }).metrics.payouts.summary.usd.value, null);
  assert.equal(view(data).metrics.payouts.breakdowns.contract[0].id, "__unallocated__");
});

test("actual payout month never falls back to scheduled date and status conflicts are qualified", () => {
  const data = fixture(); delete data.payouts[0].paidDate;
  assert.equal(view(data).metrics.payouts.summary.usd.value, null);
  assert.equal(view(data, { period: "all-time" }).metrics.payouts.summary.usd.value, 70);
  data.payoutPaymentStatus.p = { paid: false };
  assert.equal(view(data, { period: "all-time" }).metrics.payouts.summary.usd.knownSubtotal, 0);
  assert.ok(view(data).metrics.payouts.rows[0].issues.some(issue => issue.code === "payout-status-conflict"));
});

test("status-only paid snapshot produces an exact metadata exception without regeneration", () => {
  const data = fixture(); data.payouts = []; data.payoutPaymentStatus["e|2026-11-02|2026-11-08"] = { paid: true, paidDate: "2026-11-12" };
  const result = view(data);
  assert.equal(result.metrics.payouts.summary.usd.value, null);
  assert.equal(result.metrics.payouts.rows[0].source.collection, "payoutPaymentStatus");
  assert.equal(result.warnings.find(warning => warning.code === "missing-payout-snapshot").refs[0].collection, "payoutPaymentStatus");
});

test("archived identities remain available and orphan clients are never invented", () => {
  const data = fixture();
  assert.match(view(data).options.contracts.find(row => row.id === "a").label, /archived/);
  assert.equal(view(data, { clientId: "ca" }).metrics.receipts.summary.usd.value, 90);
  data.contracts[0].clientId = "cb";
  assert.equal(view(data, { clientId: "cb" }).metrics.receipts.summary.usd.value, 90, "Explicit current mapping");
  data.contracts = [];
  assert.equal(view(data).metrics.receipts.summary.usd.value, 90);
  assert.equal(view(data, { clientId: "ca" }).metrics.receipts.summary.usd.value, null);
});

test("unsupported filters disable panels instead of fabricating allocations", () => {
  const result = view(fixture(), { employeeId: "e" });
  assert.match(result.metrics.receipts.disabledReason, /no saved employee/);
  assert.match(result.metrics.expenses.disabledReason, /no saved employee/);
  assert.equal(result.metrics.receipts.summary.usd.value, null);
  assert.equal(view(fixture(), { clientId: "ca" }).metrics.expenses.summary.usd.value, null);
});

test("all-period pending commitments use saved payouts and validated queue projections without mutation", () => {
  const data = fixture(); data.incomingPayments = []; data.payouts[0].paid = false; delete data.payouts[0].paidDate;
  const incomingRows = [{ key: "a|2026-10-26|2026-11-01", contractId: "a", workWeekStart: "2026-10-26", workWeekEnd: "2026-11-01", hours: 4, netUsd: 95, netInr: 7600, exchangeRate: 80, received: false }];
  const before = JSON.stringify(data), result = view(frozen(data), { month: "2024-01", incomingRows: frozen(incomingRows) });
  assert.equal(result.commitments.incoming.summary.usd.value, 95);
  assert.equal(result.commitments.payouts.summary.usd.value, 70);
  assert.equal(result.commitments.payouts.rows[0].scheduledDate, "2026-11-12");
  assert.equal(JSON.stringify(data), before);
  assert.equal(view(data).commitments.incoming.summary.usd.value, null);
});

test("ambiguous/fixed-price work estimates are unavailable while saved pending-only amounts remain snapshots", () => {
  const data = fixture(); data.incomingPayments = []; data.contracts[0].priceType = "FIXED";
  const candidate = { key: "pending", contractId: "a", workWeekStart: "2026-10-26", workWeekEnd: "2026-11-01", netUsd: 100, netInr: 8000, exchangeRate: 80, received: false };
  assert.equal(view(data, { incomingRows: [candidate] }).commitments.incoming.summary.usd.value, null);
  data.timeEntries = []; data.incomingPayments = [{ ...fixture().incomingPayments[0], received: false }];
  assert.equal(view(data, { incomingRows: [candidate] }).commitments.incoming.summary.usd.value, 90);
  assert.equal(view(data, { incomingRows: [candidate, candidate] }).commitments.incoming.summary.usd.value, null);
});

test("normal pending payouts need no actual paid date and retain schedule/week context", () => {
  const data = fixture(); data.payouts[0].paid = false; delete data.payouts[0].paidDate;
  const row = view(data).commitments.payouts.rows[0];
  assert.equal(row.date, "2026-11-12"); assert.equal(row.weekStart, "2026-10-26"); assert.equal(row.weekEnd, "2026-11-01");
  assert.ok(!row.issues.some(issue => issue.code === "undated"));
});

test("duplicate setup identities qualify client grouping and selected allocations without losing overall saved money", () => {
  const data = fixture(); data.clients.push({ ...data.clients[0], name: "Competing client" });
  const result = view(data);
  assert.equal(result.metrics.receipts.summary.usd.value, 90);
  assert.equal(result.metrics.receipts.breakdowns.client[0].summary.usd.value, null);
  assert.equal(result.metrics.receipts.breakdowns.client[0].summary.usd.knownSubtotal, 90);
  assert.equal(view(data, { clientId: "ca" }).metrics.receipts.summary.usd.value, null);
  assert.equal(view(data, { clientId: "ca", month: "2026-10" }).metrics.hours.summary.hours.value, null);
  assert.equal(view(data, { clientId: "ca" }).metrics.payouts.summary.usd.value, null);
  assert.equal(view(data, { clientId: "ca" }).metrics.payouts.breakdowns.contract[0].summary.usd.value, null);
  assert.ok(result.warnings.some(row => row.code === "unknown-current-client"));
});

test("queue omission never makes raw pending receipts or unrepresented work look like zero commitments", () => {
  const data = fixture(); data.incomingPayments[0].received = false;
  let result = view(data, { incomingRows: [] });
  assert.equal(result.commitments.incoming.summary.usd.value, null);
  assert.ok(result.commitments.incoming.rows.some(row => row.issues.some(issue => issue.code === "unrepresented-pending-receipt")));
  data.incomingPayments = []; delete data.timeEntries[0].contractId;
  result = view(data, { incomingRows: [] });
  assert.equal(result.commitments.incoming.summary.usd.value, null);
  assert.ok(result.commitments.incoming.rows.some(row => row.issues.some(issue => issue.code === "unrepresented-pending-work")));
});

test("a received projection cannot hide older pending same-work occurrences", () => {
  const data = fixture(); data.incomingPayments.push({ ...data.incomingPayments[0], id: "pending-old", received: false });
  const result = view(data, { incomingRows: [{ key: "received", contractId: "a", workWeekStart: "2026-10-26", workWeekEnd: "2026-11-01", received: true }] });
  assert.equal(result.commitments.incoming.summary.usd.value, null);
  assert.equal(result.commitments.incoming.rows.filter(row => row.source.collection === "incomingPayments").length, 1);
});

test("numeric-string work hours remain valid hours but concatenated queue projections are untrusted", () => {
  const data = fixture(); data.incomingPayments = []; data.timeEntries[0].hours = "4";
  const result = view(data, { period: "all-time", incomingRows: [{ key: "pending", contractId: "a", workWeekStart: "2026-10-26", workWeekEnd: "2026-11-01", hours: 44, netUsd: 95, netInr: 7600, exchangeRate: 80, received: false }] });
  assert.equal(result.metrics.hours.summary.hours.value, 4);
  assert.equal(result.commitments.incoming.summary.usd.value, null);
  assert.ok(result.commitments.incoming.rows[0].issues.some(row => row.code === "invalid-estimate-hours"));
});

test("nonfinite aggregate sums are unavailable with exact source warnings", () => {
  const data = fixture(); data.incomingPayments[0].netUsd = 1e308;
  data.incomingPayments.push({ ...data.incomingPayments[0], id: "huge2", workWeekStart: "2026-11-02", workWeekEnd: "2026-11-08", netUsd: 1e308 });
  const result = view(data);
  assert.equal(result.metrics.receipts.summary.usd.value, null);
  assert.equal(result.metrics.receipts.summary.usd.knownSubtotal, null);
  assert.equal(result.metrics.receipts.summary.inr.value, 14400);
  assert.ok(result.warnings.some(warning => warning.code === "nonfinite-aggregate-usd" && warning.refs.length === 2));
  data.payouts[0].totalUsd = 1e308; data.payouts[0].contracts.forEach(line => { line.totalUsd = 1e308; });
  assert.equal(view(data, { contractId: "a" }).metrics.payouts.summary.usd.value, null);
});

test("duplicate employee and expense-type setup identities qualify only affected groupings and employee filters", () => {
  const data = fixture();
  data.employees.push({ id: "e", name: "Competing employee" });
  data.expenseTypes.push({ id: "type", name: "Competing expense type" });
  const result = view(data, { period: "all-time" });
  assert.equal(result.metrics.hours.summary.hours.value, 4);
  assert.equal(result.metrics.payouts.summary.usd.value, 70);
  assert.equal(result.metrics.expenses.summary.usd.value, 10);
  const employee = result.metrics.payouts.breakdowns.employee.find(group => group.id === "e");
  assert.equal(employee.summary.usd.value, null);
  assert.equal(employee.summary.usd.knownSubtotal, 70);
  assert.equal(result.metrics.hours.breakdowns.employee[0].summary.hours.value, null);
  assert.equal(result.metrics.hours.breakdowns.employee[0].summary.hours.knownSubtotal, 4);
  const type = result.metrics.expenses.breakdowns.expenseType.find(group => group.id === "type");
  assert.equal(type.summary.usd.value, null);
  assert.equal(type.summary.usd.knownSubtotal, 10);
  const selected = view(data, { period: "all-time", employeeId: "e" });
  assert.equal(selected.metrics.hours.summary.hours.value, null);
  assert.equal(selected.metrics.payouts.summary.usd.value, null);
  assert.ok(selected.warnings.some(warning => warning.code === "ambiguous-employee-filter"));
  assert.equal(view(data, { employeeId: "e", contractId: "a" }).metrics.payouts.summary.usd.value, null, "Contract allocation must not restore an ambiguous employee portion");
  assert.ok(result.warnings.some(warning => warning.code === "ambiguous-expenseTypes"));
  data.employees = []; data.expenseTypes = [];
  const orphan = view(data, { period: "all-time", employeeId: "e" });
  assert.equal(orphan.metrics.payouts.summary.usd.value, 70, "Stable orphan employee ID remains its own unknown category");
  assert.equal(orphan.metrics.payouts.breakdowns.employee[0].summary.usd.value, 70);
});
