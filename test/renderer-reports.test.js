const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDefaultData } = require("../src/shared/data-schema");
const { reportHtml, xlsxBuffer } = require("../src/main/report-export");

function expense(id = "expense", extra = {}) {
  return { id, expenseTypeId: "type", expenseDate: "2026-11-10", label: "Synthetic invoice", amountUsd: 100,
    exchangeRate: 83, amountInr: 8300, gstMode: "RCM", gstPercent: 18, gstPayableUsd: 18, gstPayableInr: 1494, ...extra };
}

function incoming(extra = {}) {
  return { id: "incoming", contractId: "contract", paymentDate: "2026-11-11", received: true, transactionId: "Synthetic transaction",
    workWeekStart: "2026-11-02", workWeekEnd: "2026-11-08", grossUsd: 200, exchangeRate: 84, serviceChargeUsd: 20,
    gstMode: "RCM", gstPayableUsd: 3.6, gstPayableInr: 302.4, ...extra };
}

function fixture(extra = {}) {
  return { ...createDefaultData(), sources: [{ id: "source", name: "Synthetic source" }], clients: [{ id: "client", name: "Synthetic client" }],
    contracts: [{ id: "contract", name: "Synthetic contract", shortName: "Synthetic contract", sourceId: "source", clientId: "client" }],
    expenseTypes: [{ id: "type", name: "Synthetic software" }], expenses: [expense()], ...extra };
}

function harness(initialData = fixture(), month = "2026-11") {
  const nodes = new Map([
    ["#record-filter-month", { value: month }], ["#record-filter-employee", { value: "" }], ["#record-filter-week", { value: "" }],
    ["#gst-rcm-summary", { innerHTML: "" }], ["#gst-rcm-table", { innerHTML: "" }],
  ]);
  const context = vm.createContext({ console, Intl, Date, structuredClone, crypto: { randomUUID: () => "synthetic" },
    document: { querySelector: selector => nodes.get(selector) || null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, initialData: structuredClone(initialData) });
  context.window = context;
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  // Load the production browser helpers in the production order, without booting Electron or accessing any dataset.
  for (const [, filename] of index.matchAll(/<script src="\.\/(shared\/[^"<>]+\.js)"><\/script>/g)) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", filename), "utf8"), context, { filename });
  }
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
  const boot = source.lastIndexOf("\nboot(");
  assert.ok(boot > 0, "Isolated report tests require the explicit renderer boot boundary");
  vm.runInContext(source.slice(0, boot), context);
  vm.runInContext("data = initialData;", context);
  const before = vm.runInContext("JSON.stringify(data)", context);
  return {
    context, nodes,
    report: () => vm.runInContext("buildRecordsReport('records-gst-rcm')", context),
    render: () => vm.runInContext("renderGstRcm(selectedRecordRows(currentRecordFilters()))", context),
    unchanged: () => assert.equal(vm.runInContext("JSON.stringify(data)", context), before, "Report generation must not repair/backfill/change stored input"),
  };
}

function sheetXml(buffer) {
  // The production XLSX writer uses stored ZIP entries. Read the actual worksheet rather than matching unrelated ZIP/style bytes.
  let cursor = 0;
  while (cursor + 30 <= buffer.length && buffer.readUInt32LE(cursor) === 0x04034b50) {
    const method = buffer.readUInt16LE(cursor + 8), length = buffer.readUInt32LE(cursor + 18);
    const nameLength = buffer.readUInt16LE(cursor + 26), extraLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 30, cursor + 30 + nameLength).toString("utf8");
    assert.equal(method, 0, "Expected uncompressed production XLSX ZIP entries");
    const start = cursor + 30 + nameLength + extraLength;
    if (name === "xl/worksheets/sheet1.xml") return buffer.subarray(start, start + length).toString("utf8");
    cursor = start + length;
  }
  throw new Error("Worksheet missing from XLSX");
}

const summary = (report, name) => report.xlsxSummary.find(item => item.label === name);

test("actual GST screen and report agree on an expense-only USD/INR scope and retain typed XLSX values", () => {
  const h = harness();
  const report = h.report();
  h.render();
  assert.equal(report.period, "November 2026");
  assert.equal(report.pdfFilename, "Payment-Tracker-GST-RCM-2026-11.pdf");
  assert.equal(report.rows.length, 1);
  assert.equal(summary(report, "Gross total").value, 100);
  assert.equal(summary(report, "Gross total").inr, 8300);
  assert.equal(summary(report, "GST payable").value, 18);
  assert.equal(summary(report, "GST payable").inr, 1494);
  assert.match(h.nodes.get("#gst-rcm-summary").innerHTML, /\$100\.00<\/strong><small>₹8,300\.00 reference/);
  assert.match(h.nodes.get("#gst-rcm-table").innerHTML, /\$18\.00<br><small class="inr-reference">₹1,494\.00 reference/);
  const html = reportHtml(report);
  assert.match(html, /<strong>\$18\.00<\/strong><small>₹1,494\.00 reference<\/small>/);
  assert.match(html, /<span class="money-primary">\$18\.00<\/span><small class="money-reference">₹1,494\.00 reference<\/small>/);
  assert.doesNotMatch(html, /<th>GST Payable INR<\/th>/, "PDF INR is paired below USD rather than duplicated as a column");
  const sheet = sheetXml(xlsxBuffer(report));
  assert.match(sheet, /r="D9" s="3"><v>8300<\/v>/, "Gross summary INR is a numeric cell");
  assert.match(sheet, /r="D11" s="3"><v>1494<\/v>/, "GST summary INR is a numeric cell");
  assert.match(sheet, /r="E14" s="2"><v>100<\/v>/);
  assert.match(sheet, /r="F14" s="3"><v>8300<\/v>/);
  assert.match(sheet, /r="K14" s="3"><v>1494<\/v>/);
  assert.match(sheet, /<autoFilter ref="A13:L14"\/>/);
  h.unchanged();
});

test("only GST Type and ISO Date request PDF no-wrap presentation without changing XLSX cells", () => {
  const h = harness();
  const report = h.report();
  assert.deepEqual(Array.from(report.columns, column => column.pdfNoWrap === true), [true, true, false, false, false, false, false, false, false, false, false, false]);
  const html = reportHtml(report);
  assert.match(html, /<th class="pdf-nowrap">Type<\/th><th class="pdf-nowrap">Date<\/th>/);
  assert.match(html, /<td class="pdf-nowrap">Expense<\/td><td class="pdf-nowrap">2026-11-10<\/td>/);
  assert.match(html, /\.pdf-nowrap \{ white-space: nowrap; overflow-wrap: normal; \}/);
  assert.equal((html.match(/class="pdf-nowrap"/g) || []).length, 4, "Only two headers and the two corresponding row cells are affected");
  const withoutPresentation = { ...report, columns: Array.from(report.columns, column => { const copy = { ...column }; delete copy.pdfNoWrap; return copy; }) };
  assert.equal(sheetXml(xlsxBuffer(report)), sheetXml(xlsxBuffer(withoutPresentation)), "PDF-only properties must not change worksheet content or types");
  const expenseReport = vm.runInContext("buildRecordsReport('records-expenses')", h.context);
  assert.equal(expenseReport.columns.some(column => column.pdfNoWrap), false, "Other report columns retain established wrapping");
  assert.doesNotMatch(reportHtml(expenseReport), /class="pdf-nowrap"/);
  h.unchanged();
});

test("mixed incoming and expense actual report totals use identical record scope and respect month/receipt filters", () => {
  const h = harness(fixture({ expenses: [expense(), expense("outside", { expenseDate: "2026-10-10", amountUsd: 900, amountInr: 74700 })],
    incomingPayments: [incoming(), incoming({ id: "pending", received: false, grossUsd: 999 }), incoming({ id: "outside", paymentDate: "2026-10-10", grossUsd: 800 })] }));
  const report = h.report(); h.render();
  assert.equal(report.rows.length, 2);
  assert.equal(summary(report, "Gross total").value, 300);
  assert.equal(summary(report, "Gross total").inr, 25100);
  assert.equal(summary(report, "Service charge").value, 20);
  assert.equal(summary(report, "Service charge").inr, 1680);
  assert.equal(summary(report, "GST payable").value, 21.6);
  assert.equal(summary(report, "GST payable").inr, 1796.4);
  assert.match(h.nodes.get("#gst-rcm-summary").innerHTML, /₹25,100\.00 reference/);
  assert.equal(report.rows[0][0], "Service Charge", "Report uses descending payment/expense dates");
  assert.equal(report.rows[0][2], "Synthetic transaction");
  h.nodes.get("#record-filter-month").value = "2026-10";
  const october = h.report();
  assert.equal(october.period, "October 2026");
  assert.equal(october.rows.length, 2);
  assert.equal(summary(october, "Gross total").value, 1700);
  h.nodes.get("#record-filter-month").value = "";
  const all = h.report();
  assert.equal(all.period, "All records");
  assert.equal(all.rows.length, 4, "Pending incoming remains excluded even for all records");
  assert.equal(all.pdfFilename, "Payment-Tracker-GST-RCM-All-Records.pdf");
  h.unchanged();
});

test("missing historical GST INR is preserved, consistently unavailable, and blank in actual XLSX cells", () => {
  const missing = expense("missing"); delete missing.gstPayableInr;
  const h = harness(fixture({ expenses: [missing, expense("known", { expenseDate: "2026-11-09" })] }));
  const report = h.report(); h.render();
  assert.equal(summary(report, "GST payable").value, 36);
  assert.equal(summary(report, "GST payable").inr, null, "A partially known aggregate must not pretend to be complete");
  assert.equal(summary(report, "Service charge").value, 0);
  assert.equal(summary(report, "Service charge").inr, 0, "Known zero remains a genuine zero");
  assert.equal(report.rows[0][10], null);
  assert.match(h.nodes.get("#gst-rcm-summary").innerHTML, /<strong>\$36\.00<\/strong><small>INR unavailable<\/small>/);
  assert.match(h.nodes.get("#gst-rcm-table").innerHTML, /\$18\.00<br><small class="inr-reference">INR unavailable/);
  const html = reportHtml(report);
  assert.match(html, /<strong>\$36\.00<\/strong><small>INR unavailable<\/small>/);
  assert.match(html, /<span class="money-primary">\$18\.00<\/span><small class="money-reference">INR unavailable<\/small>/);
  assert.doesNotMatch(html, /NaN|undefined/);
  const sheet = sheetXml(xlsxBuffer(report));
  assert.match(sheet, /<c r="D11"\/>/, "Unavailable summary INR is blank, not zero");
  assert.match(sheet, /<c r="K14"\/>/, "Unavailable record INR is blank, not zero");
  assert.match(sheet, /r="K15" s="3"><v>1494<\/v>/);
  assert.match(sheet, /r="G14" s="2"><v>0<\/v>/);
  assert.match(sheet, /r="H14" s="3"><v>0<\/v>/);
  assert.equal(vm.runInContext("Object.hasOwn(data.expenses[0], 'gstPayableInr')", h.context), false);
  h.unchanged();
});

test("present zero INR is not replaced by an inferred value in screen, PDF or XLSX", () => {
  const h = harness(fixture({ expenses: [expense("zero", { amountInr: 0, gstPayableInr: 0 })] }));
  const report = h.report(); h.render();
  assert.equal(summary(report, "Gross total").inr, 0);
  assert.equal(summary(report, "GST payable").inr, 0);
  assert.match(reportHtml(report), /<strong>\$18\.00<\/strong><small>₹0\.00 reference<\/small>/);
  assert.match(sheetXml(xlsxBuffer(report)), /r="K14" s="3"><v>0<\/v>/);
  assert.doesNotMatch(h.nodes.get("#gst-rcm-summary").innerHTML, /INR unavailable/);
  h.unchanged();
});

test("actual exports escape long labels and keep all rows with repeated-header and smaller-reference markup", () => {
  const label = 'Synthetic <script>alert("review")</script> & a long label '.repeat(4);
  const h = harness(fixture({ expenseTypes: [{ id: "type", name: label }], expenses: Array.from({ length: 140 }, (_, index) => expense(`many-${index}`, { label })) }));
  const report = h.report(); h.render();
  const reportBefore = JSON.stringify(report);
  const html = reportHtml(report), sheet = sheetXml(xlsxBuffer(report));
  assert.equal(report.rows.length, 140);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  assert.equal((body.match(/<tr>/g) || []).length, 140);
  assert.equal((body.match(/class="money-reference"/g) || []).length, 420);
  assert.match(html, /thead \{ display: table-header-group; \}/);
  assert.match(html, /\.money-reference \{[^}]*font-size: 8px/);
  assert.match(html, /tr \{[^}]*break-inside: avoid/);
  assert.doesNotMatch(html, /<script>|<button|class="table-wrap"/);
  assert.doesNotMatch(h.nodes.get("#gst-rcm-table").innerHTML, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(sheet, /&lt;script&gt;/);
  assert.match(sheet, /<autoFilter ref="A13:L153"\/>/);
  assert.equal(JSON.stringify(report), reportBefore, "Exporting must not mutate the report model");
  h.unchanged();
});
