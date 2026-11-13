const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const queue = require("../src/shared/queue-view");
const calculations = require("../src/shared/calculations");
const incoming = require("../src/shared/incoming-payment-updates");

function harness() {
  const wrap = { scrollTop: 277, scrollLeft: 88 }, panel = { scrollTop: 16, scrollLeft: 0 };
  const message = { textContent: "", dataset: {} };
  const header = { dataset: { incomingControl: "matching-checkbox" }, setAttribute(name, value) { this[name] = value; } };
  const matchingButton = { dataset: { incomingControl: "select-matching" } }, status = { textContent: "" };
  const rows = ["a", "b"].map((key, index) => ({ key, contractId: key, contractLabel: `Synthetic ${key}`, workWeekStart: index ? "2026-11-09" : "2026-11-02", workWeekEnd: index ? "2026-11-15" : "2026-11-08", received: false, serviceChargeUsd: 1, automaticServiceChargeUsd: 1, serviceEditable: true, exchangeRate: 83.123456, transactionId: "old", hours: 2, grossUsd: 10, netUsd: 9, netInr: 748.11, whtUsd: 0, whtPercent: 0, gstMode: "RCM", gstPayableUsd: .18 }));
  const domRows = rows.map(row => ({ dataset: { incomingKey: row.key } }));
  const fields = rows.map((row, index) => ({ dataset: { field: "transactionId" }, value: "old", readOnly: false, closest() { return domRows[index]; } }));
  const fxFields = rows.map((row, index) => ({ dataset: { field: "exchangeRate" }, value: String(row.exchangeRate), readOnly: false, closest() { return domRows[index]; } }));
  const serviceFields = rows.map((row, index) => ({ dataset: { field: "serviceChargeUsd" }, value: "1.00", readOnly: false, closest() { return domRows[index]; } }));
  const netDisplays = rows.map(() => ({ innerHTML: "" }));
  domRows.forEach((row, index) => Object.assign(row, { classList: { add() {}, remove() {} }, querySelector(selector) {
    return selector === "[data-field='exchangeRate']" ? fxFields[index] : selector === "[data-field='serviceChargeUsd']" ? serviceFields[index] : selector === "[data-field='transactionId']" ? fields[index] : selector === "[data-display='net']" ? netDisplays[index] : null;
  } }));
  const boxes = rows.map((row, index) => ({ dataset: { incomingSelect: row.key }, checked: false,
    closest() { return domRows[index]; }, focus() { document.activeElement = this; } }));
  fields.forEach(field => { field.focus = () => { document.activeElement = field; }; });
  let replacements = 0, html = "", writes = 0;
  const container = {
    get innerHTML() { return html; }, set innerHTML(value) { replacements++; html = value; },
    closest() { return panel; }, contains(element) { return [...fields, ...boxes, header, matchingButton].includes(element); },
    querySelector(selector) { return selector === ".table-wrap" ? wrap : selector === "[data-incoming-select-all]" ? header : selector === "[data-incoming-control='select-matching']" ? matchingButton : selector === "#incoming-matching-summary" ? status : null; },
    querySelectorAll(selector) { return selector === "[data-field]" ? [...fields, ...fxFields, ...serviceFields] : selector === "[data-incoming-key]" ? domRows : selector === "[data-incoming-select]" ? boxes : selector === "input, select, button" ? [...fields, ...fxFields, ...serviceFields, ...boxes, header, matchingButton] : []; },
  };
  const bulkControls = new Map([["#incoming-bulk-transaction", { value: "Synthetic batch" }], ["#incoming-bulk-exchange-rate", { value: "83.123456" }], ["#incoming-bulk-received-date", { value: "2026-11-11" }]]);
  const document = { activeElement: boxes[0], querySelector(selector) { return selector === "#incoming-queue" ? container : selector === "#incoming-queue-summary" ? { innerHTML: "" } : selector === "#incoming-queue-message" ? message : bulkControls.get(selector) || null; } };
  const window = { PaymentTrackerQueue: queue, PaymentTrackerCalculations: calculations, PaymentTrackerIncomingPayments: incoming,
    scrollX: 0, scrollY: 0, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, requestAnimationFrame(fn) { fn(); }, tracker: { saveData() { writes++; } } };
  const context = vm.createContext({ document, window, Intl, Date, Set, Map, Number, String, structuredClone, console, confirm: () => true, crypto: { randomUUID: () => "synthetic-id" }, localStorage: { getItem: () => null, setItem() {} } });
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8").replace(/\nboot\(\);\s*$/, "\n");
  vm.runInContext(source, context);
  context.syntheticRows = rows;
  vm.runInContext("const actualBuildIncomingQueueRows = buildIncomingQueueRows; const actualQueuePreview = syncIncomingQueueRowPreview; buildIncomingQueueRows = () => syntheticRows; updateIncomingBulkToolbar = () => {}; syncIncomingQueueRowPreview = () => {};", context);
  rows.forEach(row => vm.runInContext(`incomingQueueRenderedValues.set(${JSON.stringify(row.key)}, {transactionId:'old', exchangeRate:'83.123456', serviceChargeUsd:'1.00'});`, context));
  return { context, run: code => vm.runInContext(code, context), rows, domRows, fields, fxFields, serviceFields, netDisplays, bulkControls, boxes, wrap, panel, document, message, header, matchingButton, status,
    replacements: () => replacements, html: () => html, writes: () => writes };
}

test("selection and deselection keep the existing table, draft, scroll and acted-on checkbox focus", () => {
  const h = harness();
  h.fields[0].value = "DRAFT-UNSAVED";
  h.run("selectIncomingRow('a', true)");
  assert.equal(h.replacements(), 0, "selection must not replace the table subtree");
  assert.equal(h.fields[0].value, "DRAFT-UNSAVED");
  assert.equal(h.wrap.scrollTop, 277);
  assert.equal(h.wrap.scrollLeft, 88);
  assert.equal(h.document.activeElement, h.boxes[0]);
  assert.equal(h.boxes[0].checked, true);
  h.run("selectIncomingRow('a', false)");
  assert.equal(h.boxes[0].checked, false);
  assert.equal(h.replacements(), 0);
  assert.equal(h.writes(), 0, "selection is not a financial save");
});

test("cross-week selection is refused, and filters retain hidden selected keys with explicit counts", () => {
  const h = harness();
  h.run("selectIncomingRow('a', true)");
  h.boxes[1].checked = true;
  h.run("selectIncomingRow('b', true)");
  assert.equal(h.boxes[0].checked, true);
  assert.equal(h.boxes[1].checked, false);
  assert.match(h.message.textContent, /other work week/);
  h.run("incomingQueueState.filters.week = '2026-11-09|2026-11-15'; updateIncomingSelectionUi(syntheticRows)");
  assert.match(h.status.textContent, /1 selected \(1 hidden by filters\)/);
  assert.equal(h.matchingButton.disabled, true);
  assert.equal(h.run("selectedIncomingRows.has('a')"), true);
  assert.equal(h.writes(), 0);
});

test("sort/filter rerender escapes and preserves drafts, then a committed row rebases from saved values", () => {
  const h = harness();
  h.fields[0].value = 'DRAFT-"<tag>';
  h.run("incomingQueueState.sortKey = 'contractLabel'; renderIncomingQueue()");
  assert.match(h.html(), /value="DRAFT-&quot;&lt;tag&gt;"/);
  assert.match(h.html(), /value="83\.123456"/, "full stored FX precision survives rendering");
  assert.equal(h.wrap.scrollTop, 277);
  h.rows[0].transactionId = "SAVED-NEW";
  h.run("discardIncomingDrafts(['a']); renderIncomingQueue()");
  assert.match(h.html(), /value="SAVED-NEW"/);
  assert.doesNotMatch(h.html(), /value="DRAFT-&quot;&lt;tag&gt;"/);
  assert.equal(h.run("incomingQueueDrafts.has('a')"), false);
  assert.equal(h.writes(), 0);
});

test("switching datasets discards old mounted queue fields even when the new dataset reuses row keys", () => {
  const h = harness();
  h.fields[0].value = "OLD-DATASET-DRAFT";
  h.run("selectIncomingRow('a', true); incomingQueueState.filters.contractId = 'a'; resetIncomingQueueState()");
  h.rows[0].transactionId = "NEW-DATASET-SAVED";
  h.run("renderIncomingQueue()");
  assert.match(h.html(), /value="NEW-DATASET-SAVED"/);
  assert.doesNotMatch(h.html(), /OLD-DATASET-DRAFT/);
  assert.equal(h.run("incomingQueueDrafts.size"), 0);
  assert.equal(h.run("selectedIncomingRows.size"), 0);
  assert.equal(h.run("incomingQueueState.filters.contractId"), "");
  assert.equal(h.writes(), 0);
});

test("single-row saves request payout FX refresh only for newly received or changed received FX", async () => {
  for (const [received, markReceived, fx, expected] of [
    [true, false, "83.123456", []],
    [true, false, "84", ["a"]],
    [false, true, "83.123456", ["a"]],
    [false, false, "84", []],
  ]) {
    const h = harness();
    h.rows[0].paymentId = "payment-a";
    h.rows[0].received = received;
    h.fxFields[0].value = fx;
    h.fields[0].value = "Only transaction metadata changed";
    h.context.received = received;
    h.run("data.incomingPayments = [{id:'payment-a', contractId:'a', received, exchangeRate:83.123456}]; const capturedSaveOptions = []; save = async (_value, options) => capturedSaveOptions.push(options);");
    assert.equal(await h.run(`persistIncomingQueueRow('a', {markReceived:${markReceived}, receivedDateOverride:'2026-11-11'})`), true);
    assert.deepEqual(JSON.parse(h.run("JSON.stringify(capturedSaveOptions[0].payoutFxContracts)")), expected);
  }
});

test("bulk saves request payout FX refresh only for qualifying selected received contracts", async () => {
  for (const [received, markReceived, fx, expected] of [
    [true, false, "83.123456", []],
    [true, false, "84", ["a", "b"]],
    [false, true, "83.123456", ["a", "b"]],
    [false, false, "84", []],
  ]) {
    const h = harness();
    h.rows.forEach((row, index) => Object.assign(row, { paymentId: `payment-${row.key}`, received, workWeekStart: "2026-11-02", workWeekEnd: "2026-11-08" }));
    h.bulkControls.get("#incoming-bulk-exchange-rate").value = fx;
    h.context.received = received;
    h.run("data.incomingPayments = ['a','b'].map(contractId => ({id:'payment-'+contractId, contractId, received, exchangeRate:83.123456})); selectedIncomingRows.add('a'); selectedIncomingRows.add('b'); const capturedSaveOptions = []; save = async (_value, options) => capturedSaveOptions.push(options);");
    await h.run(`applyIncomingBulkUpdate(${markReceived})`);
    assert.deepEqual(JSON.parse(h.run("JSON.stringify(capturedSaveOptions[0].payoutFxContracts)")), expected);
  }
});

function storedHistoricalPayment(extra = {}) {
  return { id: "payment-a", contractId: "a", workWeekStart: "2026-11-02", workWeekEnd: "2026-11-08", paymentDate: "2026-11-10", received: false,
    transactionId: "Original transaction", grossUsd: 8, exchangeRate: 83.123456, serviceChargeUsd: .5, serviceChargeOverridden: false,
    whtPercent: 7, whtUsd: .9, netUsd: 6.6, gstMode: "RCM", gstPercent: 18, gstPayableUsd: .09, notes: "Keep historical amounts", extra: "Preserve", ...extra };
}

test("single transaction-only commits preserve historical financial overrides and absent INR/FX despite newer queue references", async () => {
  for (const [missingFx, received] of [[false, false], [true, false], [false, true], [true, true]]) {
    const h = harness();
    const original = storedHistoricalPayment({ received });
    if (missingFx) delete original.exchangeRate;
    h.context.original = original;
    Object.assign(h.rows[0], { paymentId: original.id, paymentDate: original.paymentDate, received });
    h.fields[0].value = "Changed transaction only";
    h.run("data.incomingPayments = [structuredClone(original)]; const capturedSaveOptions = []; save = async (_value, options) => capturedSaveOptions.push(options);");
    const helper = JSON.parse(h.run("JSON.stringify(incomingPaymentFromQueueRow(syntheticRows[0], {transactionId:'Changed transaction only'}))"));
    assert.deepEqual(helper, { ...original, key: "a", transactionId: "Changed transaction only" }, "The production queue helper must preserve financial snapshots by default");
    assert.equal(await h.run("persistIncomingQueueRow('a')"), true);
    const stored = JSON.parse(h.run("JSON.stringify(data.incomingPayments[0])"));
    assert.deepEqual(stored, { ...original, transactionId: "Changed transaction only" });
    assert.equal(Object.hasOwn(stored, "netInr"), false);
    assert.equal(Object.hasOwn(stored, "gstPayableInr"), false);
    assert.equal(Object.hasOwn(stored, "exchangeRate"), !missingFx, "Displayed reference FX must not be adopted by a transaction edit");
    assert.deepEqual(JSON.parse(h.run("JSON.stringify(capturedSaveOptions[0].payoutFxContracts)")), []);
  }
});

test("bulk transaction/date-only commits preserve historical financial overrides and absent INR", async () => {
  const h = harness();
  const original = storedHistoricalPayment();
  h.context.original = original;
  Object.assign(h.rows[0], { paymentId: original.id, paymentDate: original.paymentDate, gstPercent: 18 });
  h.run("data.incomingPayments = [structuredClone(original)]; selectedIncomingRows.add('a'); const capturedSaveOptions = []; save = async (_value, options) => capturedSaveOptions.push(options);");
  await h.run("applyIncomingBulkUpdate(false)");
  assert.deepEqual(JSON.parse(h.run("JSON.stringify(data.incomingPayments[0])")), { ...original, transactionId: "Synthetic batch", paymentDate: "2026-11-11" });
  assert.deepEqual(JSON.parse(h.run("JSON.stringify(capturedSaveOptions[0].payoutFxContracts)")), []);
});

test("an explicitly changed FX still recalculates only the committed incoming row with established rounding", async () => {
  const h = harness();
  const original = storedHistoricalPayment(); delete original.exchangeRate;
  const untouched = { ...storedHistoricalPayment(), id: "untouched", contractId: "b", extra: "Do not change" };
  h.context.original = original; h.context.untouched = untouched;
  Object.assign(h.rows[0], { paymentId: original.id, paymentDate: original.paymentDate, gstPercent: 18 });
  h.fxFields[0].value = "84";
  h.run("data.incomingPayments = [structuredClone(original), structuredClone(untouched)]; save = async () => {};");
  assert.equal(await h.run("persistIncomingQueueRow('a')"), true);
  const payments = JSON.parse(h.run("JSON.stringify(data.incomingPayments)"));
  assert.equal(payments[0].exchangeRate, 84);
  assert.equal(payments[0].grossUsd, 10);
  assert.equal(payments[0].netUsd, 9);
  assert.equal(payments[0].netInr, 756);
  assert.equal(payments[0].gstPayableInr, 15.12);
  assert.deepEqual(payments[1], untouched);
});

test("actual queue construction and rendering distinguish missing FX from numeric zero", () => {
  for (const [fx, expectedInr] of [[undefined, null], [0, 0], [84, 840]]) {
    const h = harness();
    h.context.paymentFx = fx;
    h.run("data.sources = [{id:'source',name:'Synthetic source'}]; data.clients = [{id:'client',name:'Synthetic client'}]; data.contracts = [{id:'a',sourceId:'source',clientId:'client',name:'Synthetic contract',priceUsd:5}]; data.timeEntries = [{id:'work',employeeId:'employee',contractId:'a',weekStart:'2026-11-02',weekEnd:'2026-11-08',hours:2,rateUsd:5,totalUsd:10}]; data.incomingPayments = [{id:'payment',contractId:'a',workWeekStart:'2026-11-02',workWeekEnd:'2026-11-08',received:false,exchangeRate:paymentFx,serviceChargeUsd:0,whtPercent:0,gstMode:'RCM',gstPercent:18}];");
    const before = h.run("JSON.stringify(data)");
    assert.equal(h.run("actualBuildIncomingQueueRows()[0].netInr"), expectedInr);
    h.run("resetIncomingQueueState(); buildIncomingQueueRows = actualBuildIncomingQueueRows; renderIncomingQueue()");
    if (fx === undefined) assert.match(h.html(), /INR unavailable/);
    else {
      assert.doesNotMatch(h.html(), /INR unavailable/);
      assert.match(h.html(), new RegExp(`data-field="exchangeRate"[^>]*value="${fx}"`));
    }
    assert.equal(h.run("JSON.stringify(data)"), before, "Queue currency presentation must not write or backfill stored data");
    assert.equal(h.writes(), 0);
  }
});

test("actual inline preview shows unavailable only for absent FX and preserves zero/valid references", () => {
  const h = harness();
  h.context.previewRow = h.domRows[0];
  h.context.previewSource = { ...h.rows[0], gstPercent: 18 };
  for (const [fx, expected] of [["", /INR unavailable/], ["0", /₹0\.00/], ["84", /₹756\.00/]]) {
    h.fxFields[0].value = fx;
    h.run("actualQueuePreview(previewRow, previewSource)");
    assert.match(h.netDisplays[0].innerHTML, expected);
    if (fx !== "") assert.doesNotMatch(h.netDisplays[0].innerHTML, /INR unavailable/);
  }
  assert.equal(h.writes(), 0);
});
