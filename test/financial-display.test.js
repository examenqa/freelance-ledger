const test = require("node:test");
const assert = require("node:assert/strict");
const { optionalNumber, gstRecords, gstTotals } = require("../src/shared/financial-display");
const { reportHtml, xlsxBuffer } = require("../src/main/report-export");

test("GST totals use the same incoming and expense scope in both currencies", () => {
  const payments = [{ paymentDate: "2026-11-10", grossUsd: 200, exchangeRate: 83, serviceChargeUsd: 20, gstPayableUsd: 3.6, gstPayableInr: 298.8 }];
  const expenses = [{ expenseDate: "2026-11-10", amountUsd: 100, amountInr: 8300, exchangeRate: 83, gstPayableUsd: 18, gstPayableInr: 1494 }];
  const original = JSON.stringify({ payments, expenses });
  const totals = gstTotals(gstRecords(payments, expenses));
  assert.equal(totals.grossUsd, 300);
  assert.equal(totals.grossInr, 24900);
  assert.equal(totals.gstInr, 1792.8);
  assert.equal(totals.expenseGstInr, 1494);
  assert.equal(JSON.stringify({ payments, expenses }), original);
});

test("missing INR stays unavailable; genuine zero stays zero; no backfill occurs", () => {
  const expense = { expenseDate: "2026-11-10", amountUsd: 100, exchangeRate: 83, gstPayableUsd: 18 };
  const original = JSON.stringify(expense);
  const totals = gstTotals(gstRecords([], [expense]));
  assert.equal(totals.gstInr, null);
  assert.equal(totals.grossInr, null);
  assert.equal(totals.gstUsd, 18);
  assert.equal(JSON.stringify(expense), original);
  assert.equal(optionalNumber(0), 0);
  for (const value of [undefined, null, "", NaN, Infinity]) assert.equal(optionalNumber(value), null);
  assert.equal(gstTotals(gstRecords([], [{ ...expense, amountInr: 0, gstPayableInr: 0 }])).gstInr, 0);
});

test("a missing INR makes the paired aggregate unavailable instead of a partial sum", () => {
  const rows = gstRecords([], [
    { amountUsd: 100, amountInr: 8300, gstPayableUsd: 18, gstPayableInr: 1494 },
    { amountUsd: 10, amountInr: 830, gstPayableUsd: 1.8 },
  ]);
  assert.equal(gstTotals(rows).gstInr, null);
  assert.equal(gstTotals(rows).grossInr, 9130);
});

test("PDF pairs reference text below USD while XLSX keeps separate numeric or blank cells", () => {
  const report = { title: "GST RCM", columns: [
    { label: "GST USD", kind: "usd" }, { label: "GST INR", kind: "inr", pdfHidden: true },
  ], rows: [[18, 1494], [1.8, null]], displayRows: [
    [{ kind: "currency-reference", value: "$18.00", reference: "₹1,494.00 reference" }, "₹1,494.00"],
    [{ kind: "currency-reference", value: "$1.80", reference: "INR unavailable" }, "INR unavailable"],
  ] };
  const html = reportHtml(report);
  assert.match(html, /money-primary">\$18\.00<\/span><small class="money-reference">₹1,494\.00 reference/);
  assert.match(html, /INR unavailable/);
  assert.doesNotMatch(html, /<th>GST INR<\/th>|\[object Object\]/);
  const xml = xlsxBuffer(report).toString("utf8");
  assert.match(xml, /<v>1494<\/v>/);
  assert.match(xml, /<c r="B11"\/>/);
  assert.doesNotMatch(xml, /NaN|Infinity/);
});
