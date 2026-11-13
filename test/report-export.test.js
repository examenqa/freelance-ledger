const test = require("node:test");
const assert = require("node:assert/strict");
const { reportHtml, xlsxBuffer } = require("../src/main/report-export");

const sampleReport = {
  applicationTitle: "ExamenQA Payment Tracker",
  title: "Incoming Payments",
  period: "July 2026",
  generatedAt: "24/07/2026, 10:30",
  sheetName: "Incoming Payments",
  columns: [
    { label: "Payment Date", kind: "date", width: 14 },
    { label: "Gross USD", kind: "usd", width: 14 },
    { label: "Net INR", kind: "inr", width: 15 },
    { label: "Status", width: 12 },
  ],
  rows: [["2026-07-24", 123.45, 11110.5, "Received"]],
  displayRows: [["2026-07-24", "$123.45", "₹11,110.50", "Received"]],
  summary: [{ label: "Records", value: "1" }, { label: "Net received", value: "$123.45", detail: "₹11,110.50 reference" }],
  xlsxSummary: [{ label: "Records", value: 1, valueKind: "number" }, { label: "Net received", usd: 123.45, inr: 11110.5 }],
};

test("builds a clean multi-page-safe HTML report from structured records", () => {
  const html = reportHtml(sampleReport);
  assert.match(html, /ExamenQA Payment Tracker/);
  assert.match(html, /Incoming Payments/);
  assert.match(html, /Period: July 2026/);
  assert.match(html, /thead \{ display: table-header-group; \}/);
  assert.match(html, /\$123\.45/);
  assert.doesNotMatch(html, /data-delete|secondary-button|scrollbar/);
});

test("builds an XLSX package with typed dates and numeric USD and INR cells", () => {
  const workbook = xlsxBuffer(sampleReport);
  assert.deepEqual([...workbook.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const contents = workbook.toString("utf8");
  assert.match(contents, /xl\/worksheets\/sheet1\.xml/);
  assert.match(contents, /sheet name="Incoming Payments"/);
  assert.match(contents, /r="A12" s="1"><v>46227<\/v>/);
  assert.match(contents, /r="B12" s="2"><v>123.45<\/v>/);
  assert.match(contents, /r="C12" s="3"><v>11110.5<\/v>/);
  assert.match(contents, /<autoFilter ref="A11:D12"\/>/);
});

test("creates a valid empty XLSX report instead of a partial file", () => {
  const workbook = xlsxBuffer({ ...sampleReport, rows: [], displayRows: [], xlsxSummary: [] });
  const contents = workbook.toString("utf8");
  assert.match(contents, /<sheetData>/);
  assert.match(contents, /Payment Date/);
  assert.match(contents, /<autoFilter ref="A9:D9"\/>/);
});
