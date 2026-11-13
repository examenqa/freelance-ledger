const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDefaultData } = require("../src/shared/data-schema");

function historicalFixture() {
  const payoutId = "employee|2026-10-19|2026-10-25";
  return {
    ...createDefaultData(),
    sources: [{ id: "source", name: "Synthetic source" }],
    clients: [{ id: "client", name: "Synthetic client", sourceId: "source" }],
    contracts: [{ id: "contract", name: "Synthetic contract", sourceId: "source", clientId: "client", priceUsd: 20 }],
    employees: [{ id: "employee", name: "Synthetic employee" }],
    employeeRates: [{ id: "rate", employeeId: "employee", contractId: "contract", rateUsd: 20 }],
    timeEntries: [{ id: "work", employeeId: "employee", contractId: "contract", weekStart: "2026-10-19", weekEnd: "2026-10-25", hours: 5, rateUsd: 10, totalUsd: 50, notes: "Historical" }],
    incomingPayments: [{ id: "received", contractId: "contract", paymentDate: "2026-11-02", exchangeRate: 90, received: true }],
    payouts: [{ id: payoutId, employeeId: "employee", weekStart: "2026-10-19", weekEnd: "2026-10-25", payoutDate: "2026-11-05", paid: true, paidDate: "2026-11-05", transactionId: "Synthetic paid transaction", totalHours: 5, totalUsd: 50, totalInr: 4000,
      contracts: [{ contractId: "contract", hours: 5, rateUsd: 10, totalUsd: 50, exchangeRate: 80, totalInr: 4000 }], note: "Stored historical payout" }],
    payoutPaymentStatus: { [payoutId]: { paid: true, paidDate: "2026-11-05", transactionId: "Synthetic paid transaction" } },
  };
}

function harness(initialData) {
  const writes = [];
  const nodes = new Map([["#overview-month", { value: "2026-11" }], ["#stats", { innerHTML: "" }]]);
  const context = vm.createContext({ console, Intl, Date, structuredClone, initialData: structuredClone(initialData),
    crypto: { randomUUID: () => "synthetic-id" }, alert() {},
    document: { querySelector: selector => nodes.get(selector) || null, querySelectorAll: () => [] },
  });
  context.window = context;
  context.tracker = { async saveData(value) { const saved = JSON.parse(JSON.stringify(value)); writes.push(saved); return saved; } };
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  for (const [, filename] of index.matchAll(/<script src="\.\/(shared\/[^"<>]+\.js)"><\/script>/g)) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", filename), "utf8"), context);
  }
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
  vm.runInContext(source.slice(0, source.lastIndexOf("\nboot(")), context);
  vm.runInContext("data = initialData; fillSelects = restoreWorkContext = renderWeeklyProgress = renderIncomingQueue = renderTables = () => {};", context);
  return { nodes, writes, context,
    call(source) { return vm.runInContext(source, context); },
    data() { return JSON.parse(vm.runInContext("JSON.stringify(data)", context)); },
    async submitExpense(values) {
      let listener;
      const form = { id: "expense-form", elements: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }])), addEventListener(_event, callback) { listener = callback; } };
      nodes.set("#expense-form", form);
      context.FormData = class { constructor(input) { this.form = input; } entries() { return Object.entries(this.form.elements).map(([name, field]) => [name, field.value]); } };
      // Register the production handler verbatim; do not reimplement the calculation or save path in the test.
      const start = source.indexOf('document.querySelector("#expense-form").addEventListener("submit"');
      const end = source.indexOf("\n  });", start);
      assert.ok(start > 0 && end > start, "Expense submit handler must remain discoverable for the isolated integration test");
      vm.runInContext(source.slice(start, end + 7), context);
      vm.runInContext("reset = () => {};", context);
      await listener({ currentTarget: form, preventDefault() {} });
    },
  };
}

test("rendering preserves previously saved historical payout financial fields", () => {
  const initial = historicalFixture();
  const h = harness(initial);
  h.call("render()");
  assert.deepEqual(h.data().payouts, initial.payouts, "Opening or rerendering the application must not recalculate stored historical payouts");
});

test("archiving setup metadata preserves historical payouts through the real save boundary", async () => {
  const initial = historicalFixture();
  const h = harness(initial);
  await h.call("setSetupArchived('employees', 'employee', true)");
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].employees[0].archived, true);
  assert.deepEqual(h.writes[0].timeEntries, initial.timeEntries);
  assert.deepEqual(h.writes[0].incomingPayments, initial.incomingPayments);
  assert.deepEqual(h.writes[0].payouts, initial.payouts, "Archiving must not silently persist repriced historical payouts");
});

test("Overview distinguishes missing historical GST INR from a genuine zero", () => {
  const h = harness({ ...createDefaultData(), expenses: [{ id: "missing", expenseDate: "2026-11-10", amountUsd: 100, amountInr: 8300, exchangeRate: 83, gstMode: "RCM", gstPayableUsd: 18 }] });
  h.call("renderStats()");
  const gstCard = h.nodes.get("#stats").innerHTML.match(/<article[^>]*>\s*<span>RCM GST Payable<\/span>([\s\S]*?)<\/article>/)?.[1];
  assert.ok(gstCard, "Overview RCM GST card should be present");
  assert.match(gstCard, /\$18\.00/);
  assert.match(gstCard, /INR unavailable/, "Overview and GST Records must agree that the stored INR is absent");
  assert.doesNotMatch(gstCard, /₹0\.00/);
  assert.equal(Object.hasOwn(h.data().expenses[0], "gstPayableInr"), false);
});

test("an expense notes-only edit preserves stored overrides and absent historical INR", async () => {
  const original = { id: "expense", expenseTypeId: "type", expenseDate: "2026-11-10", label: "Synthetic invoice", amountUsd: 100, amountInr: 8000, exchangeRate: 83, gstMode: "RCM", gstPercent: 18, gstPayableUsd: 18, notes: "Original note" };
  const h = harness({ ...createDefaultData(), expenseTypes: [{ id: "type", name: "Synthetic expense" }], expenses: [original] });
  await h.submitExpense({ editId: "expense", expenseTypeId: "type", newExpenseTypeName: "", expenseDate: original.expenseDate, label: original.label, amountUsd: "100", exchangeRate: "83", gstMode: "RCM", gstPercent: "18", notes: "Changed note only" });
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].expenses[0], { ...original, notes: "Changed note only" }, "Notes edits must not backfill GST INR or overwrite a stored historical INR amount");
  assert.equal(Object.hasOwn(h.writes[0].expenses[0], "gstPayableInr"), false);
});

test("Overview keeps complete INR, genuine zero and unavailable partial totals distinct", () => {
  function gstCard(expenses) {
    const h = harness({ ...createDefaultData(), expenses });
    const before = JSON.stringify(h.data());
    h.call("renderStats()");
    assert.equal(JSON.stringify(h.data()), before, "Completeness display must not recalculate or mutate source data");
    return h.nodes.get("#stats").innerHTML.match(/<span>RCM GST Payable<\/span>([\s\S]*?)<\/article>/)[1];
  }
  const expense = { id: "known", expenseDate: "2026-11-10", amountUsd: 100, amountInr: 8300, gstPayableUsd: 18, gstPayableInr: 1494 };
  assert.match(gstCard([expense]), /₹1,494\.00 reference/);
  assert.match(gstCard([{ ...expense, gstPayableInr: 0 }]), /₹0\.00 reference/);
  const missing = { ...expense, id: "missing" }; delete missing.gstPayableInr;
  assert.match(gstCard([expense, missing]), /INR unavailable/);
  assert.match(gstCard([{ ...missing, gstPayableUsd: 0 }]), /₹0\.00 reference/, "Zero GST USD does not need invented historical INR");
});

test("Overview uses unavailable references for missing expense INR and incoming FX/net INR", () => {
  const h = harness({ ...createDefaultData(), expenses: [{ id: "expense", expenseDate: "2026-11-10", amountUsd: 100, gstPayableUsd: 0 }],
    incomingPayments: [{ id: "income", paymentDate: "2026-11-11", received: true, grossUsd: 200, serviceChargeUsd: 20, whtUsd: 0, netUsd: 180, gstPayableUsd: 0 }] });
  h.call("renderStats()");
  const html = h.nodes.get("#stats").innerHTML;
  for (const label of ["Gross Income", "Deductions", "Net Income", "Expenses", "Agency Gains"]) {
    const card = html.split(`<span>${label}</span>`)[1]?.split("</article>")[0];
    assert.ok(card, `${label} card must exist`);
    assert.match(card, /INR unavailable/, `${label} must not format missing currency information as a known zero`);
  }
});

test("an explicit expense financial change keeps established USD/FX/GST calculations", async () => {
  const original = { id: "expense", expenseTypeId: "type", expenseDate: "2026-11-10", label: "Synthetic invoice", amountUsd: 100, amountInr: 8000, exchangeRate: 83, gstMode: "RCM", gstPercent: 18, gstPayableUsd: 18, notes: "Original note" };
  const h = harness({ ...createDefaultData(), expenseTypes: [{ id: "type", name: "Synthetic expense" }], expenses: [original] });
  await h.submitExpense({ editId: "expense", expenseTypeId: "type", newExpenseTypeName: "", expenseDate: original.expenseDate, label: original.label, amountUsd: "200", exchangeRate: "83", gstMode: "RCM", gstPercent: "18", notes: "Financial amount explicitly changed" });
  assert.equal(h.writes[0].expenses[0].amountUsd, 200);
  assert.equal(h.writes[0].expenses[0].amountInr, 16600);
  assert.equal(h.writes[0].expenses[0].gstPayableUsd, 36);
  assert.equal(h.writes[0].expenses[0].gstPayableInr, 2988);
});
