const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { createDataAccess } = require("../src/main/data-access");
const { createDefaultData } = require("../src/shared/data-schema");
const { reportHtml, xlsxBuffer } = require("../src/main/report-export");

// This is a persistence/data-flow regression, not a visual browser test. It binds
// production renderer handlers against minimal controls and uses the real JSON
// access, atomic writer/backups, reopening and report exporters in a disposable folder.
async function session(store) {
  const nodes = new Map();
  function element() {
    const listeners = new Map(), classes = new Set();
    return {
      value: "", dataset: {}, elements: {}, children: [], innerHTML: "", textContent: "", listeners,
      classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key), toggle(key, force) { const add = force ?? !classes.has(key); add ? classes.add(key) : classes.delete(key); return add; } },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      fire(type, extra = {}) { return Promise.all([...(listeners.get(type) || [])].map((fn) => fn({ currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, ...extra }))); },
      setAttribute() {}, removeAttribute() {}, setCustomValidity(text) { this.validationMessage = text; }, reportValidity() {}, focus() {},
      replaceChildren(...children) { this.children = children; this.textContent = ""; },
      append(child) { this.children.push(child); if (child.id) nodes.set(`#${child.id}`, child); },
      reset() { Object.values(this.elements).forEach((field) => { field.value = ""; }); },
      querySelector(selector) { return get(selector); }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    };
  }
  function get(selector) {
    if (selector === "#weekly-progress" && !nodes.has(selector)) return null;
    const match = selector.match(/^(#[\w-]+) (?:input|select)\[name=['"]([^'"]+)['"]\]$/);
    if (match) {
      const form = get(match[1]);
      if (!form.elements[match[2]]) form.elements[match[2]] = Object.assign(element(), { name: match[2], form });
      return form.elements[match[2]];
    }
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }
  const form = get("#time-form");
  form.id = "time-form";
  for (const name of ["employeeId", "contractId", "weekStart", "weekEnd", "hours", "notes", "editId"]) form.elements[name] = Object.assign(element(), { name, form });
  get("#record-filter-month").value = "2026-11";
  const body = element(), windowEvents = element();
  class SyntheticFormData {
    constructor(target) { this.target = target; }
    entries() { return Object.entries(this.target.elements).map(([name, field]) => [name, field.value]); }
  }
  const storage = new Map();
  const context = vm.createContext({ console, Intl, Date, structuredClone, crypto: { randomUUID }, FormData: SyntheticFormData,
    document: { querySelector: get, querySelectorAll: () => [], body, createElement: element, activeElement: null },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    alert() {}, confirm: () => true, requestAnimationFrame: (fn) => fn(), scrollTo() {}, scrollX: 0, scrollY: 0,
    addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    tracker: {
      loadData: () => store.readData(),
      async saveData(value, options) {
        assert.equal(Object.hasOwn(options, "payoutWorkPeriods"), false, "Internal reconciliation instructions must not leak into storage IPC options");
        assert.equal(Object.hasOwn(options, "payoutFxContracts"), false);
        await store.writeData(value, options);
        return store.readData();
      },
    },
  });
  context.window = context;
  const index = syncFs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  for (const [, filename] of index.matchAll(/<script src="\.\/(shared\/[^"<>]+\.js)"><\/script>/g)) vm.runInContext(syncFs.readFileSync(path.join(__dirname, "../src", filename), "utf8"), context, { filename });
  const renderer = syncFs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
  const boot = renderer.lastIndexOf("\nboot(");
  assert.ok(boot > 0);
  vm.runInContext(renderer.slice(0, boot), context);
  context.loaded = await store.readData();
  vm.runInContext("data = loaded; render = () => {}; bindForms();", context);
  return {
    get, body, nodes,
    call(name, ...args) { context.args = args; return vm.runInContext(`${name}(...args)`, context); },
    data: () => JSON.parse(vm.runInContext("JSON.stringify(data)", context)),
    fill(values) { Object.entries(values).forEach(([name, value]) => { form.elements[name].value = value; }); },
    submit: () => form.fire("submit"),
    mountIncoming(row, fx, transaction) {
      const domRow = element(); domRow.dataset.incomingKey = row.key;
      const fields = new Map([ ["exchangeRate", fx], ["serviceChargeUsd", String(row.serviceChargeUsd)], ["transactionId", transaction] ].map(([name, value]) => {
        const field = element(); field.value = value; field.dataset.field = name; field.closest = () => domRow; return [name, field];
      }));
      domRow.querySelector = (selector) => fields.get(selector.match(/data-field='([^']+)'/)?.[1]) || null;
      const wrap = { scrollTop: 120, scrollLeft: 0 }, panel = { scrollTop: 0, scrollLeft: 0 };
      const container = get("#incoming-queue");
      container.querySelectorAll = (selector) => selector === "[data-incoming-key]" ? [domRow] : selector === "[data-field]" ? [...fields.values()] : [];
      container.querySelector = (selector) => selector === ".table-wrap" ? wrap : null;
      container.closest = () => panel;
      nodes.set("#incoming-queue .table-wrap", wrap);
    },
  };
}

function fixture() {
  const data = createDefaultData();
  data.sources = [{ id: "source", name: "Synthetic Upwork" }];
  data.clients = [{ id: "client", sourceId: "source", name: "Synthetic client" }];
  data.contracts = [{ id: "contract", sourceId: "source", clientId: "client", name: "Synthetic contract", priceUsd: 25, serviceChargeMode: "FIXED", serviceChargePercent: 10, gstMode: "RCM", gstPercent: 18 }];
  data.employees = [{ id: "employee", name: "Synthetic employee" }];
  data.employeeRates = [{ id: "archived-rate", employeeId: "employee", contractId: "contract", rateUsd: 9, archived: true }, { id: "active-rate", employeeId: "employee", contractId: "contract", rateUsd: 11 }];
  data.timeEntries = [{ id: "history", employeeId: "employee", contractId: "contract", weekStart: "2026-10-05", weekEnd: "2026-10-11", hours: 5, rateUsd: 10, totalUsd: 50, notes: "Keep synthetic history" }];
  data.payouts = [{ id: "employee|2026-10-05|2026-10-11", employeeId: "employee", weekStart: "2026-10-05", weekEnd: "2026-10-11", payoutDate: "2026-10-22", paid: true, paidDate: "2026-10-23", transactionId: "SYNTHETIC-HISTORY", totalHours: 5, totalUsd: 50, totalInr: 4000, contracts: [{ contractId: "contract", hours: 5, rateUsd: 10, totalUsd: 50, exchangeRate: 80, totalInr: 4000 }], note: "Keep stored synthetic payout" }];
  data.payoutPaymentStatus[data.payouts[0].id] = { paid: true, paidDate: "2026-10-23", transactionId: "SYNTHETIC-HISTORY" };
  data.expenses = [{ id: "historical-expense", expenseDate: "2026-10-10", amountUsd: 5, amountInr: 400, exchangeRate: 80, gstMode: "NONE", gstPayableUsd: 0, gstPayableInr: 0, extraField: "Preserve synthetic extra field" }];
  return data;
}

function zipEntry(buffer, wanted) {
  let cursor = 0;
  while (cursor + 30 <= buffer.length && buffer.readUInt32LE(cursor) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(cursor + 8), 0);
    const length = buffer.readUInt32LE(cursor + 18), nameLength = buffer.readUInt16LE(cursor + 26), extraLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 30, cursor + 30 + nameLength).toString("utf8"), start = cursor + 30 + nameLength + extraLength;
    if (name === wanted) return buffer.subarray(start, start + length).toString("utf8");
    cursor = start + length;
  }
  throw new Error(`Missing XLSX entry ${wanted}`);
}

function assertCurrencyCell(buffer, value, currency) {
  const sheet = zipEntry(buffer, "xl/worksheets/sheet1.xml"), styles = zipEntry(buffer, "xl/styles.xml");
  const formats = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"\/>/g)].map((match) => [match[1], match[2]]));
  const cellStyles = [...styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf numFmtId="(\d+)"/g)].map((match) => match[1]);
  const matches = [...sheet.matchAll(/<c r="([A-Z]+\d+)" s="(\d+)"><v>([^<]+)<\/v><\/c>/g)].filter((match) => Number(match[3]) === value);
  assert.ok(matches.some((match) => (formats.get(cellStyles[Number(match[2])]) || "").includes(currency)), `Expected a typed numeric ${currency} cell holding ${value}`);
}

test("work → disk save → reopen → incoming/paid payout → reopen exports preserves financial snapshots", async (t) => {
  const tempBase = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(tempBase, "payment-tracker-full-flow-"));
  // Check the resolved recursive-cleanup target is exactly this named temp workspace.
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tempBase));
  assert.ok(path.basename(root).startsWith("payment-tracker-full-flow-"));
  t.after(async () => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(tempBase));
    assert.ok(path.basename(target).startsWith("payment-tracker-full-flow-"));
    await fs.rm(target, { recursive: true, force: true });
  });
  const profile = path.join(root, "profile"), file = path.join(root, "synthetic-data.json");
  await fs.mkdir(profile);
  const settings = path.join(profile, "payment-tracker-settings.json"), sentinel = path.join(root, "untouched-synthetic-sentinel.json");
  const settingsBytes = "SYNTHETIC SESSION-OVERRIDE SETTINGS SENTINEL", sentinelBytes = '{"synthetic":"untouched"}';
  await fs.writeFile(settings, settingsBytes); await fs.writeFile(sentinel, sentinelBytes);
  const initial = fixture(); await fs.writeFile(file, JSON.stringify(initial));
  const openStore = () => createDataAccess({ userDataPath: profile, dataFileOverride: file });
  const first = await session(openStore());
  const workValues = { employeeId: "employee", contractId: "contract", weekStart: "2026-11-02", weekEnd: "2026-11-08", hours: "6", notes: "Synthetic new work", editId: "" };
  first.fill(workValues); await first.submit();
  let saved = JSON.parse(await fs.readFile(file, "utf8"));
  const newWork = saved.timeEntries.find((entry) => entry.id !== "history");
  assert.equal(newWork.rateUsd, 11); assert.equal(newWork.totalUsd, 66);
  const payoutId = "employee|2026-11-02|2026-11-08";
  assert.equal(saved.payouts.find((payout) => payout.id === payoutId).totalUsd, 66);
  assert.equal(saved.payouts.find((payout) => payout.id === payoutId).totalInr, null);
  assert.deepEqual(saved.payouts.find((payout) => payout.id !== payoutId), initial.payouts[0]);

  const reopened = await session(openStore());
  const queueRow = reopened.call("buildIncomingQueueRows").find((row) => row.workWeekStart === "2026-11-02");
  assert.equal(queueRow.grossUsd, 150); assert.equal(queueRow.hours, 6); assert.equal(queueRow.received, false);
  reopened.mountIncoming(queueRow, "83.25", "SYNTHETIC-INCOMING");
  assert.equal(await reopened.call("persistIncomingQueueRow", queueRow.key, { markReceived: true, receivedDateOverride: "2026-11-18" }), true);
  saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.incomingPayments[0].netUsd, 134.85); assert.equal(saved.incomingPayments[0].netInr, 11226.26);
  assert.equal(saved.incomingPayments[0].gstPayableUsd, 2.7); assert.equal(saved.incomingPayments[0].gstPayableInr, 224.78);
  assert.equal(saved.payouts.find((payout) => payout.id === payoutId).totalInr, 5494.5);
  assert.deepEqual(saved.payouts.find((payout) => payout.id !== payoutId), initial.payouts[0], "A received FX change must not rewrite the paid historical snapshot");

  const target = { closest: (selector) => selector === "[data-payout-paid]" ? { dataset: { payoutPaid: payoutId }, closest: () => null } : null };
  const paidClick = reopened.body.fire("click", { target });
  await reopened.get("#payout-paid-no").fire("click");
  reopened.get("#payout-paid-date").value = "2026-11-20";
  reopened.get("#payout-paid-transaction").value = "SYNTHETIC-PAYOUT";
  await reopened.get("#payout-paid-save").fire("click"); await paidClick;
  saved = JSON.parse(await fs.readFile(file, "utf8"));
  const paid = saved.payouts.find((payout) => payout.id === payoutId);
  assert.equal(paid.paid, true); assert.equal(paid.paidDate, "2026-11-20");
  assert.equal(paid.totalUsd, 66); assert.equal(paid.totalInr, 5494.5);

  const final = await session(openStore());
  const beforeBlocked = await fs.readFile(file, "utf8");
  final.fill({ ...workValues, editId: newWork.id, hours: "7" }); await final.submit();
  assert.equal(await fs.readFile(file, "utf8"), beforeBlocked, "Paid-period financial edit must not reach the real file writer");
  assert.match(final.get("#time-validation-message").textContent, /separately approved correction/);
  final.fill({ ...workValues, editId: newWork.id, notes: "Synthetic paid-period note only" }); await final.submit();
  saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(saved.payouts.find((payout) => payout.id === payoutId), paid);
  assert.deepEqual(saved.timeEntries.find((entry) => entry.id === "history"), initial.timeEntries[0]);
  assert.deepEqual(saved.expenses, initial.expenses);
  const beforeExport = await fs.readFile(file, "utf8");
  const exportsSession = await session(openStore());
  for (const [tab, usd, inr] of [["records-payments", 134.85, 11226.26], ["records-payouts", 66, 5494.5]]) {
    const report = exportsSession.call("buildRecordsReport", tab);
    assert.equal(report.rows.length, 1);
    const html = reportHtml(report), workbook = xlsxBuffer(report);
    assert.ok(html.includes(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(usd)));
    assert.ok(html.includes(new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(inr)));
    assertCurrencyCell(workbook, usd, "$" ); assertCurrencyCell(workbook, inr, "₹");
    await fs.writeFile(path.join(root, `${tab}.html`), html); await fs.writeFile(path.join(root, `${tab}.xlsx`), workbook);
  }
  const workReport = exportsSession.call("buildRecordsReport", "records-time");
  const rateIndex = workReport.columns.findIndex((column) => column.label === "Rate USD");
  assert.equal(workReport.rows[0][rateIndex], 11, "A reopened export must retain the stored active rate, not archived rate 9");
  assert.equal(await fs.readFile(file, "utf8"), beforeExport, "Read/reopen/export must not rewrite storage");
  assert.equal(await fs.readFile(settings, "utf8"), settingsBytes);
  assert.equal(await fs.readFile(sentinel, "utf8"), sentinelBytes);
});
