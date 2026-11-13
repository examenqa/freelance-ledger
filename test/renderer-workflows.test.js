const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDefaultData, validateData } = require("../src/shared/data-schema");

function fixture() {
  return {
    ...createDefaultData(),
    sources: [{ id: "source", name: "Synthetic Upwork" }],
    clients: [{ id: "client", sourceId: "source", name: "Synthetic client" }],
    contracts: [{ id: "contract", sourceId: "source", clientId: "client", name: "Synthetic contract", priceUsd: 25, serviceChargeMode: "FIXED", serviceChargePercent: 10, gstMode: "RCM", gstPercent: 18 }],
    employees: [{ id: "employee", name: "Synthetic person", email: "review@example.invalid", phone: "synthetic phone", bankAccount: "synthetic account", ifsc: "synthetic ifsc", bankName: "synthetic bank", notes: "old note", extraField: "keep me" }],
    employeeRates: [{ id: "rate", employeeId: "employee", contractId: "contract", rateUsd: 11, noAgencyCut: false }],
  };
}

function harness(initialData = fixture()) {
  const nodes = new Map();
  const writes = [];
  const alerts = [];
  const activations = [];
  const selects = [];
  const storage = new Map();
  let nextId = 0;
  function element() {
    const classes = new Set();
    const listeners = new Map();
    return {
      value: "", textContent: "", dataset: {}, children: [], elements: {}, attributes: {}, listeners,
      classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
        toggle(name, force) { const add = force ?? !classes.has(name); add ? classes.add(name) : classes.delete(name); return add; },
      },
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      dispatch(type, event = {}) { return Promise.all([...(listeners.get(type) || [])].map((fn) => fn({ currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, ...event }))); },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      setCustomValidity(message) { this.validationMessage = message; },
      reportValidity() { this.reportedValidity = true; return !this.validationMessage; },
      focus() { this.focused = true; },
      replaceChildren(...children) { this.children = children; this.textContent = ""; },
      append(child) { this.children.push(child); if (child.id) nodes.set(`#${child.id}`, child); },
      reset() { Object.values(this.elements).forEach((input) => { input.value = ""; }); },
      querySelector(selector) { return get(selector); },
      querySelectorAll() { return []; },
    };
  }
  function get(selector) {
    if (selector === "#weekly-progress" && !nodes.has(selector)) return null;
    const control = selector.match(/^(#[\w-]+) (?:input|select)\[name=['"]([^'"]+)['"]\]$/);
    if (control) {
      const form = get(control[1]);
      if (!form.elements[control[2]]) form.elements[control[2]] = element();
      return form.elements[control[2]];
    }
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }
  const time = get("#time-form");
  time.id = "time-form";
  for (const name of ["employeeId", "contractId", "weekStart", "weekEnd", "hours", "notes", "editId"]) time.elements[name] = Object.assign(element(), { name, form: time });
  const employee = get("#employee-form");
  employee.id = "employee-form";
  for (const name of ["name", "email", "phone", "bankAccount", "ifsc", "bankName", "notes", "editId"]) employee.elements[name] = Object.assign(element(), { name, form: employee });
  const body = element();
  const window = element();
  Object.assign(window, {
    PaymentTrackerCalculations: require("../src/shared/calculations"),
    PaymentTrackerIncomingPayments: require("../src/shared/incoming-payment-updates"),
    PaymentTrackerFinancialDisplay: require("../src/shared/financial-display"),
    PaymentTrackerWorkValidation: require("../src/shared/work-validation"),
    PaymentTrackerWeeklyProgress: require("../src/shared/weekly-progress"),
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    requestAnimationFrame: (fn) => fn(), scrollTo() {}, scrollY: 0,
    tracker: {
      async saveData(data) {
        // Exercise the JSON boundary and production schema without a filesystem.
        const serialized = JSON.parse(JSON.stringify(data));
        const validation = validateData(serialized);
        assert.equal(validation.valid, true, validation.errors.join(" "));
        writes.push(serialized);
        return serialized;
      },
    },
  });
  class SyntheticFormData {
    constructor(form) { this.form = form; }
    entries() { return Object.entries(this.form.elements).map(([name, input]) => [name, input.value]); }
  }
  const context = vm.createContext({
    window, document: { querySelector: get, querySelectorAll: (selector) => selector === "select[data-options]" ? selects : [], body, createElement: element },
    console, structuredClone, FormData: SyntheticFormData,
    crypto: { randomUUID: () => `synthetic-new-${++nextId}` },
    alert: (message) => alerts.push(message), confirm: () => true,
    initialData: structuredClone(initialData), activations,
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
  const bootCall = source.lastIndexOf("\nboot(");
  assert.ok(bootCall >= 0, "Renderer entry-point boundary must remain explicit for isolated handler tests");
  vm.runInContext(source.slice(0, bootCall), context);
  vm.runInContext("data = initialData; const actualReset = reset; render = () => {}; reset = () => {}; activateTab = (tab) => activations.push(tab); activateSetupFormTab = (tab) => activations.push(tab); bindForms();", context);
  return {
    get, body, window, writes, alerts, activations, selects, storage,
    data: () => JSON.parse(vm.runInContext("JSON.stringify(data)", context)),
    call(name, ...args) { context.callArgs = args; return vm.runInContext(`${name}(...callArgs)`, context); },
    fill(values) { Object.entries(values).forEach(([name, value]) => { time.elements[name].value = value; }); },
    submit: () => time.dispatch("submit"),
  };
}

const workValues = { employeeId: "employee", contractId: "contract", weekStart: "2026-11-02", weekEnd: "2026-11-08", hours: "6", notes: "synthetic work", editId: "" };

test("new Weekly Work writes its effective rate and total through the actual submit handler", async () => {
  const h = harness();
  h.fill(workValues);
  await h.submit();
  assert.equal(h.writes.length, 1);
  const entry = h.writes[0].timeEntries[0];
  assert.equal(entry.rateUsd, 11);
  assert.equal(entry.totalUsd, 66);
  assert.equal(entry.hours, 6);
  assert.equal(entry.contractId, "contract");
});

test("work edit preserves its id/extra fields and leaves unrelated historical work unchanged", async () => {
  const initial = fixture();
  initial.timeEntries = [
    { id: "edited", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66, extraField: "preserve" },
    { id: "history", employeeId: "employee", contractId: "contract", weekStart: "2026-10-19", weekEnd: "2026-10-25", hours: 3, rateUsd: 9, totalUsd: 27, notes: "historical" },
  ];
  const h = harness(initial);
  h.fill({ ...workValues, editId: "edited", notes: "changed note" });
  await h.submit();
  const entries = h.writes[0].timeEntries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "edited");
  assert.equal(entries[0].rateUsd, 11);
  assert.equal(entries[0].totalUsd, 66);
  assert.equal(entries[0].extraField, "preserve");
  assert.deepEqual(entries[1], initial.timeEntries[1]);
});

test("new no-agency-cut work retains the existing pass-through formula", async () => {
  const initial = fixture();
  initial.employeeRates[0].noAgencyCut = true;
  const h = harness(initial);
  h.fill({ ...workValues, hours: "2" });
  await h.submit();
  assert.equal(h.writes[0].timeEntries[0].rateUsd, 22.02);
  assert.equal(h.writes[0].timeEntries[0].totalUsd, 44.04);
});

test("an explicit active rate is used instead of an archived first-match rate", () => {
  const initial = fixture();
  initial.employeeRates.unshift({ id: "archived-rate", employeeId: "employee", contractId: "contract", rateUsd: 9, archived: true });
  const h = harness(initial);
  assert.equal(h.call("effectiveRateForEntry", { employeeId: "employee", contractId: "contract", rateUsd: 11 }, initial.employeeRates[1]), 11);
});

test("notes-only edits preserve historical rates/totals exactly, including absent legacy fields", async () => {
  const initial = fixture();
  initial.employeeRates[0].rateUsd = 19;
  initial.timeEntries = [
    { id: "old-rate", ...workValues, hours: 6, rateUsd: 8, totalUsd: 48 },
    { id: "legacy", employeeId: "employee", contractId: "contract", weekStart: "2026-10-19", weekEnd: "2026-10-25", hours: 3, totalUsd: 0, notes: "old" },
  ];
  const h = harness(initial);
  h.fill({ ...workValues, editId: "old-rate", notes: "new note" });
  await h.submit();
  assert.equal(h.writes[0].timeEntries[0].rateUsd, 8);
  assert.equal(h.writes[0].timeEntries[0].totalUsd, 48);
  h.fill({ ...workValues, editId: "legacy", weekStart: "2026-10-19", weekEnd: "2026-10-25", hours: "3", notes: "legacy new note" });
  await h.submit();
  const legacy = h.writes[1].timeEntries.find((item) => item.id === "legacy");
  assert.equal(Object.hasOwn(legacy, "rateUsd"), false);
  assert.equal(legacy.totalUsd, 0);
});

test("financially changed work stores its applicable rate without rewriting other work", async () => {
  const initial = fixture();
  initial.timeEntries = [{ id: "changed", ...workValues, hours: 6, rateUsd: 8, totalUsd: 48 }];
  const h = harness(initial);
  h.fill({ ...workValues, editId: "changed", hours: "7" });
  await h.submit();
  assert.equal(h.writes[0].timeEntries[0].rateUsd, 11);
  assert.equal(h.writes[0].timeEntries[0].totalUsd, 77);
});

for (const [name, overrides, field] of [
  ["negative hours", { hours: "-5" }, "hours"],
  ["zero hours", { hours: "0" }, "hours"],
  ["impossible date", { weekStart: "2026-02-30" }, "weekStart"],
  ["reversed period", { weekEnd: "2026-11-01" }, "weekEnd"],
]) {
  test(`actual work submit rejects ${name} with feedback and no storage mutation`, async () => {
    const initial = fixture();
    const h = harness(initial);
    h.fill({ ...workValues, ...overrides });
    await h.submit();
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.data(), initial);
    assert.ok(h.get("#time-validation-message").textContent);
    assert.ok(h.get("#time-form").elements[field].validationMessage);
    assert.equal(h.get("#time-form").elements[field].focused, true);
  });
}

test("new overlapping work is blocked and offers Edit for the existing record", async () => {
  const initial = fixture();
  initial.timeEntries = [{ id: "existing", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const h = harness(initial);
  h.fill({ ...workValues, weekStart: "2026-11-05", weekEnd: "2026-11-11" });
  await h.submit();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.data(), initial);
  const edit = h.get("#time-validation-message").children[0];
  assert.match(edit.textContent, /Edit 2026-11-02 to 2026-11-08/);
  await edit.dispatch("click");
  assert.equal(h.get("#time-form").elements.editId.value, "existing");
  assert.equal(h.get("#time-form").elements.weekStart.value, "2026-11-02");
  assert.equal(h.writes.length, 0);
});

test("notes-only legacy-overlap edits save while changed overlapping hours are blocked", async () => {
  const initial = fixture();
  initial.timeEntries = [
    { id: "existing", ...workValues, hours: 6, rateUsd: 8, totalUsd: 48 },
    { id: "legacy-overlap", employeeId: "employee", contractId: "contract", weekStart: "2026-11-05", weekEnd: "2026-11-11", hours: 2, rateUsd: 9, totalUsd: 18 },
  ];
  const h = harness(initial);
  h.fill({ ...workValues, editId: "existing", notes: "notes only" });
  await h.submit();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].timeEntries[0].rateUsd, 8);
  assert.equal(h.writes[0].timeEntries[0].totalUsd, 48);
  assert.deepEqual(h.writes[0].timeEntries[1], initial.timeEntries[1]);
  h.fill({ ...workValues, editId: "existing", hours: "7" });
  await h.submit();
  assert.equal(h.writes.length, 1, "Blocked financial edit must not save");
  assert.equal(h.data().timeEntries[0].hours, 6);
});

for (const scenario of [
  { name: "scheduled", actualDate: null, expected: "2026-11-19" },
  { name: "actual", actualDate: "2026-11-20", expected: "2026-11-20" },
  { name: "existing actual", actualDate: null, existingDate: "2026-11-20", expected: "2026-11-20" },
]) {
  test(`payout ${scenario.name} date branch persists status and transaction through the actual click handler`, async () => {
    const initial = fixture();
    initial.timeEntries = [{ id: "work", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
    const payoutId = "employee|2026-11-02|2026-11-08";
    initial.payouts = [{ id: payoutId, payoutDate: "2026-11-19", employeeId: "employee", paid: Boolean(scenario.existingDate), paidDate: scenario.existingDate || "" }];
    const h = harness(initial);
    const wrap = { scrollTop: 120, parentElement: { id: "generated-payouts-table" } };
    const button = { dataset: { payoutPaid: payoutId }, closest: (selector) => selector === ".table-wrap" ? wrap : null };
    const target = { closest: (selector) => selector === "[data-payout-paid]" ? button : null };
    const pending = h.body.dispatch("click", { target });
    if (scenario.actualDate) {
      await h.get("#payout-paid-no").dispatch("click");
      h.get("#payout-paid-date").value = scenario.actualDate;
    }
    h.get("#payout-paid-transaction").value = " SYNTHETIC-TXN ";
    await h.get("#payout-paid-save").dispatch("click");
    await pending;
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0].payoutPaymentStatus[payoutId], { paid: true, paidDate: scenario.expected, transactionId: "SYNTHETIC-TXN" });
    assert.equal(h.writes[0].payouts[0].paid, true);
    assert.equal(h.writes[0].payouts[0].paidDate, scenario.expected);
    assert.equal(h.get("#payout-paid-modal").classList.contains("hidden"), true);
  });
}

for (const cancel of ["escape", "backdrop"]) {
  test(`payout ${cancel} cancellation leaves synthetic data unchanged`, async () => {
    const initial = fixture();
    const h = harness(initial);
    const result = h.call("openPayoutPaidDialog", { payoutDate: "2026-11-19" });
    if (cancel === "escape") await h.window.dispatch("keydown", { key: "Escape" });
    else await h.get("#payout-paid-modal").dispatch("click");
    assert.equal(await result, null);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.data(), initial);
    assert.equal(h.get("#payout-paid-save").listeners.get("click").size, 0);
  });
}

test("payout blank actual date stays open with field feedback, then accepts a valid date", async () => {
  const h = harness();
  const result = h.call("openPayoutPaidDialog", { payoutDate: "2026-11-19" });
  await h.get("#payout-paid-no").dispatch("click");
  h.get("#payout-paid-date").value = "";
  await h.get("#payout-paid-save").dispatch("click");
  assert.equal(h.get("#payout-paid-modal").classList.contains("hidden"), false);
  assert.match(h.get("#payout-paid-date").validationMessage, /actual paid date/);
  assert.equal(h.get("#payout-paid-date").reportedValidity, true);
  h.get("#payout-paid-date").value = "2026-11-20";
  await h.get("#payout-paid-save").dispatch("click");
  assert.equal((await result).paidDate, "2026-11-20");
});

test("employee Edit opens all existing fields and saving preserves identity and linked work", async () => {
  const initial = fixture();
  initial.timeEntries = [{ id: "history", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const h = harness(initial);
  h.call("editItem", "employees", "employee");
  assert.deepEqual(h.activations, ["setup", "setup-employee-form"]);
  const form = h.get("#employee-form");
  for (const field of ["name", "email", "phone", "bankAccount", "ifsc", "bankName", "notes"]) assert.equal(form.elements[field].value, initial.employees[0][field]);
  assert.equal(form.elements.editId.value, "employee");
  assert.equal(h.writes.length, 0, "Opening an edit form must not save");
  form.elements.name.value = "Synthetic revised person";
  await form.dispatch("submit");
  assert.equal(h.writes[0].employees.length, 1);
  assert.equal(h.writes[0].employees[0].id, "employee");
  assert.equal(h.writes[0].employees[0].name, "Synthetic revised person");
  assert.equal(h.writes[0].employees[0].extraField, "keep me");
  assert.deepEqual(h.writes[0].employeeRates, initial.employeeRates);
  assert.deepEqual(h.writes[0].timeEntries, initial.timeEntries);
});

test("new work ignores archived rates and rejects archived employees or contract parents", async () => {
  const initial = fixture();
  initial.employeeRates.unshift({ ...initial.employeeRates[0], id: "archived-rate", rateUsd: 9, archived: true });
  const h = harness(initial);
  assert.equal(h.call("activeEmployeeRate", "employee", "contract").id, "rate");
  h.fill(workValues);
  await h.submit();
  assert.equal(h.writes[0].timeEntries[0].rateUsd, 11);
  for (const collection of ["employees", "sources", "clients", "contracts"]) {
    const blockedData = fixture();
    blockedData[collection][0].archived = true;
    const blocked = harness(blockedData);
    blocked.fill(workValues);
    await blocked.submit();
    assert.equal(blocked.writes.length, 0, collection);
    assert.match(blocked.get("#time-validation-message").textContent, /active employee/);
    assert.equal(blocked.call("employeeContractOptions", "employee").length, 0);
  }
});

test("an unchanged archived historical edit preserves absent rate fields and original identity", async () => {
  const initial = fixture();
  initial.employees[0].archived = true;
  initial.employeeRates[0].archived = true;
  initial.timeEntries = [{ id: "legacy", ...workValues, hours: 6, totalUsd: 0 }];
  const h = harness(initial);
  h.fill({ ...workValues, editId: "legacy", notes: "only notes" });
  await h.submit();
  assert.equal(h.writes[0].timeEntries[0].id, "legacy");
  assert.equal(Object.hasOwn(h.writes[0].timeEntries[0], "rateUsd"), false);
  assert.equal(h.writes[0].timeEntries[0].totalUsd, 0);
});

test("archive-aware choices hide inactive setup rows except the explicit historical edit selection", () => {
  const initial = fixture();
  initial.employees[0].archived = true;
  initial.timeEntries = [{ id: "history", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const h = harness(initial);
  const employee = h.get("#time-form").elements.employeeId;
  employee.dataset.options = "employees";
  employee.dataset.placeholder = "Select employee";
  const contract = h.get("#time-form").elements.contractId;
  contract.dataset.options = "employee-contracts";
  contract.dataset.placeholder = "Select contract";
  h.selects.push(employee, contract);
  h.call("fillSelects");
  assert.doesNotMatch(employee.innerHTML, /value="employee"/);
  h.call("editItem", "timeEntries", "history");
  assert.match(employee.innerHTML, /Synthetic person \(historical selection\)/);
  assert.match(contract.innerHTML, /historical selection/);
  assert.equal(employee.value, "employee");
  assert.equal(h.get("#time-form").elements.editId.value, "history");
  assert.equal(h.writes.length, 0);
  assert.match(h.call("setupStateBadge", "employees", initial.employees[0]), /Archived/);
  assert.match(h.call("setupItemAction", "employees", initial.employees[0], "person"), /data-restore-collection="employees"/);
});

test("work context persists only navigation fields and safely restores an active selection", () => {
  const h = harness();
  h.call("restoreWorkContext");
  h.fill({ ...workValues, hours: "999", notes: "draft must stay private to memory" });
  h.call("persistWorkContext", "weekly-work");
  const stored = JSON.parse(h.storage.get("payment-tracker-work-context-v1"));
  assert.deepEqual(Object.keys(stored).sort(), ["contractId", "employeeId", "tab", "weekEnd", "weekStart"]);
  const reopened = harness();
  reopened.storage.set("payment-tracker-work-context-v1", JSON.stringify({ ...stored, hours: "999", notes: "ignored legacy draft" }));
  reopened.call("restoreWorkContext");
  const form = reopened.get("#time-form");
  assert.equal(form.elements.employeeId.value, "employee");
  assert.equal(form.elements.contractId.value, "contract");
  assert.equal(form.elements.weekStart.value, "2026-11-02");
  assert.equal(form.elements.hours.value, "");
  assert.equal(form.elements.notes.value, "");
  assert.equal(reopened.writes.length, 0);
});

test("context restoration excludes archived choices and storage failures do not block work", () => {
  const initial = fixture();
  initial.employees[0].archived = true;
  const h = harness(initial);
  h.storage.set("payment-tracker-work-context-v1", JSON.stringify({ tab: "weekly-work", ...workValues }));
  h.call("restoreWorkContext");
  assert.equal(h.get("#time-form").elements.employeeId.value, "");
  assert.equal(h.get("#time-form").elements.contractId.value, "");
  const restricted = harness();
  restricted.window.localStorage.getItem = () => { throw new Error("synthetic storage denied"); };
  restricted.window.localStorage.setItem = () => { throw new Error("synthetic storage denied"); };
  assert.doesNotThrow(() => restricted.call("restoreWorkContext"));
  restricted.fill(workValues);
  assert.doesNotThrow(() => restricted.call("persistWorkContext", "weekly-work"));
});

test("Time Save reset retains its week/employee/contract and unrelated form resets leave it alone", () => {
  const h = harness();
  h.fill({ ...workValues, editId: "editing" });
  h.call("restoreWorkContext");
  const form = h.get("#time-form");
  h.call("actualReset", form);
  assert.equal(form.elements.employeeId.value, "employee");
  assert.equal(form.elements.contractId.value, "contract");
  assert.equal(form.elements.weekStart.value, "2026-11-02");
  assert.equal(form.elements.weekEnd.value, "2026-11-08");
  for (const field of ["hours", "notes", "editId"]) assert.equal(form.elements[field].value, "");
  const expense = h.get("#expense-form");
  expense.id = "expense-form";
  h.call("actualReset", expense);
  assert.equal(form.elements.weekStart.value, "2026-11-02");
  assert.equal(form.elements.contractId.value, "contract");
});

test("No work action saves metadata without creating work/payouts, and new work invalidates it", async () => {
  const h = harness();
  h.fill({ ...workValues, hours: "", notes: "" });
  const button = { dataset: { progressAction: "no-work" } };
  await h.call("handleWeeklyProgressAction", { target: { closest: () => button } });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].timeEntries.length, 0);
  assert.equal(h.writes[0].payouts.length, 0);
  assert.equal(h.writes[0].weeklyProgress["employee|contract|2026-11-02|2026-11-08"].status, "no-work");
  h.fill(workValues);
  await h.submit();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].weeklyProgress["employee|contract|2026-11-02|2026-11-08"], undefined);
  assert.equal(h.writes[1].timeEntries[0].totalUsd, 66);
});

test("explicit dataset switch clears navigation restoration without changing financial records", () => {
  const h = harness();
  h.fill(workValues);
  h.call("restoreWorkContext");
  h.call("persistWorkContext", "weekly-work");
  const before = h.data();
  h.call("resetWeeklyProgressContext");
  assert.equal(h.storage.has("payment-tracker-work-context-v1"), false);
  assert.equal(h.get("#time-form").elements.employeeId.value, "");
  assert.equal(h.get("#time-form").elements.hours.value, "");
  assert.deepEqual(h.data(), before);
  assert.equal(h.writes.length, 0);
});

function paidWorkFixture() {
  const initial = fixture();
  initial.timeEntries = [{ id: "paid-work", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const payoutId = "employee|2026-11-02|2026-11-08";
  initial.payouts = [{ id: payoutId, employeeId: "employee", weekStart: "2026-11-02", weekEnd: "2026-11-08", payoutDate: "2026-11-19", paid: true, paidDate: "2026-11-20", transactionId: "SYNTHETIC-PAID", totalUsd: 66, totalInr: 5280, totalHours: 6, contracts: [{ contractId: "contract", hours: 6, rateUsd: 11, totalUsd: 66, exchangeRate: 80, totalInr: 5280 }], note: "Stored paid note" }];
  initial.payoutPaymentStatus[payoutId] = { paid: true, paidDate: "2026-11-20", transactionId: "SYNTHETIC-PAID" };
  return initial;
}

test("paid work financial edits and additions to that employee period require a separate correction", async () => {
  const initial = paidWorkFixture();
  const changed = harness(initial);
  changed.fill({ ...workValues, editId: "paid-work", hours: "7" });
  await changed.submit();
  assert.equal(changed.writes.length, 0);
  assert.deepEqual(changed.data(), initial);
  assert.match(changed.get("#time-validation-message").textContent, /separately approved correction/);
  const additionData = paidWorkFixture();
  additionData.contracts.push({ ...additionData.contracts[0], id: "another-contract" });
  additionData.employeeRates.push({ ...additionData.employeeRates[0], id: "another-rate", contractId: "another-contract" });
  const addition = harness(additionData);
  addition.fill({ ...workValues, contractId: "another-contract" });
  await addition.submit();
  assert.equal(addition.writes.length, 0, "Paid employee periods include work on another contract");
  assert.match(addition.get("#time-validation-message").textContent, /paid payout/);
  const moved = harness(initial);
  moved.fill({ ...workValues, editId: "paid-work", weekStart: "2026-11-09", weekEnd: "2026-11-15" });
  await moved.submit();
  assert.equal(moved.writes.length, 0, "Moving work out of a paid period must also block");
});

test("paid-period notes-only edits preserve stored financial and payout snapshots exactly", async () => {
  const initial = paidWorkFixture();
  initial.employeeRates[0].rateUsd = 19;
  const h = harness(initial);
  h.fill({ ...workValues, editId: "paid-work", notes: "notes only" });
  await h.submit();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].timeEntries[0].rateUsd, 11);
  assert.equal(h.writes[0].timeEntries[0].totalUsd, 66);
  assert.deepEqual(h.writes[0].payouts, initial.payouts);
  assert.deepEqual(h.writes[0].payoutPaymentStatus, initial.payoutPaymentStatus);
});

test("paid status-map-only periods are protected even without a generated payout row", async () => {
  const initial = paidWorkFixture();
  initial.payouts = [];
  initial.timeEntries = [];
  const h = harness(initial);
  h.fill(workValues);
  await h.submit();
  assert.equal(h.writes.length, 0);
  assert.match(h.get("#time-validation-message").textContent, /paid payout/);
  assert.equal(h.call("paidPayoutsAffectedByWorkChange", { ...workValues }, null).length, 1);
});

test("failed work persistence restores memory/progress and a retry can save without phantom overlap", async () => {
  const initial = fixture();
  initial.weeklyProgress = { "employee|contract|2026-11-02|2026-11-08": { employeeId: "employee", contractId: "contract", weekStart: "2026-11-02", weekEnd: "2026-11-08", status: "no-work" } };
  const h = harness(initial);
  const persist = h.window.tracker.saveData;
  let first = true;
  h.window.tracker.saveData = async (...args) => {
    if (first) { first = false; throw new Error("synthetic disk failure"); }
    return persist(...args);
  };
  h.fill(workValues);
  await h.submit();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.data(), initial);
  assert.equal(h.get("#time-form").elements.hours.value, "6");
  assert.match(h.get("#time-validation-message").textContent, /Work was not saved/);
  await h.submit();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].timeEntries.length, 1);
  assert.equal(h.writes[0].timeEntries[0].rateUsd, 11);
  assert.equal(h.writes[0].timeEntries[0].totalUsd, 66);
  assert.equal(h.writes[0].payouts[0].totalUsd, 66);
  assert.equal(h.writes[0].weeklyProgress["employee|contract|2026-11-02|2026-11-08"], undefined);
});

test("No work is rejected for unsaved drafts and for a week with overlapping records", async () => {
  const h = harness();
  h.fill(workValues);
  const button = { dataset: { progressAction: "no-work" } };
  await h.call("handleWeeklyProgressAction", { target: { closest: () => button } });
  assert.equal(h.writes.length, 0);
  assert.match(h.get("#weekly-progress").innerHTML, /Save or clear unsaved hours/);
  const initial = fixture();
  initial.timeEntries = [{ id: "work", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const occupied = harness(initial);
  occupied.fill({ ...workValues, hours: "", notes: "" });
  await occupied.call("handleWeeklyProgressAction", { target: { closest: () => button } });
  assert.equal(occupied.writes.length, 0);
  assert.deepEqual(occupied.data().timeEntries, initial.timeEntries);
  assert.match(occupied.get("#weekly-progress").innerHTML, /overlapping work entries/);
});

test("progress history presents gaps without implying completion and pages without changing form data", async () => {
  const initial = fixture();
  initial.timeEntries = [{ id: "work", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const h = harness(initial);
  h.fill({ ...workValues, weekStart: "2026-11-09", weekEnd: "2026-11-15", hours: "", notes: "" });
  h.call("renderWeeklyProgress");
  const panel = h.get("#weekly-progress");
  assert.match(panel.innerHTML, /Recorded — completion unconfirmed/);
  assert.match(panel.innerHTML, /No entry means unrecorded/);
  assert.match(panel.innerHTML, /does not confirm earlier weeks/);
  const oldHtml = panel.innerHTML;
  await h.call("handleWeeklyProgressAction", { target: { closest: () => ({ dataset: { progressAction: "earlier" } }) } });
  assert.notEqual(panel.innerHTML, oldHtml);
  assert.equal(h.get("#time-form").elements.weekStart.value, "2026-11-09");
  assert.equal(h.writes.length, 0);
});

test("rate assignment retains archived history while replacing the active assignment only", async () => {
  const initial = fixture();
  const archived = { ...initial.employeeRates[0], id: "old-rate", rateUsd: 9, archived: true, legacyNote: "keep" };
  initial.employeeRates.unshift(archived);
  initial.timeEntries = [{ id: "history", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const h = harness(initial);
  for (const [field, value] of Object.entries({ employeeId: "employee", contractId: "contract", noAgencyCut: "false", rateUsd: "13" })) h.get(`#rate-form input[name='${field}']`).value = value;
  await h.get("#rate-form").dispatch("submit");
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].employeeRates.length, 2);
  assert.deepEqual(h.writes[0].employeeRates[0], archived);
  assert.equal(h.call("activeEmployeeRate", "employee", "contract").rateUsd, 13);
  assert.deepEqual(h.writes[0].timeEntries, initial.timeEntries);
});

test("explicit Complete requires recorded work and Clear removes only progress metadata", async () => {
  const initial = fixture();
  initial.timeEntries = [{ id: "work", ...workValues, hours: 6, rateUsd: 11, totalUsd: 66 }];
  const h = harness(initial);
  const action = (name) => ({ target: { closest: () => ({ dataset: { progressAction: name } }) } });
  h.fill({ ...workValues, weekStart: "2026-11-09", weekEnd: "2026-11-15", hours: "", notes: "" });
  await h.call("handleWeeklyProgressAction", action("complete"));
  assert.equal(h.writes.length, 0);
  assert.match(h.get("#weekly-progress").innerHTML, /Record work before/);
  h.fill({ ...workValues, hours: "", notes: "" });
  await h.call("handleWeeklyProgressAction", action("complete"));
  assert.equal(h.writes[0].weeklyProgress["employee|contract|2026-11-02|2026-11-08"].status, "complete");
  assert.deepEqual(h.writes[0].timeEntries, initial.timeEntries);
  assert.deepEqual(h.writes[0].payouts, initial.payouts);
  await h.call("handleWeeklyProgressAction", action("clear"));
  assert.equal(h.writes[1].weeklyProgress["employee|contract|2026-11-02|2026-11-08"], undefined);
  assert.deepEqual(h.writes[1].timeEntries, initial.timeEntries);
});

test("payout failed save keeps the dialog/values and original status until a successful retry", async () => {
  const initial = paidWorkFixture();
  initial.payouts[0].paid = false;
  initial.payouts[0].paidDate = "";
  initial.payoutPaymentStatus[initial.payouts[0].id] = { paid: false };
  const h = harness(initial);
  const persist = h.window.tracker.saveData;
  h.window.tracker.saveData = async () => { throw new Error("synthetic disk failure"); };
  const button = { dataset: { payoutPaid: initial.payouts[0].id }, closest: () => null };
  const pending = h.body.dispatch("click", { target: { closest: (selector) => selector === "[data-payout-paid]" ? button : null } });
  await h.get("#payout-paid-no").dispatch("click");
  h.get("#payout-paid-date").value = "2026-11-21";
  h.get("#payout-paid-transaction").value = "SYNTHETIC-RETRY";
  await h.get("#payout-paid-save").dispatch("click");
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.data(), initial);
  assert.equal(h.get("#payout-paid-modal").classList.contains("hidden"), false);
  assert.equal(h.get("#payout-paid-date").value, "2026-11-21");
  assert.equal(h.get("#payout-paid-transaction").value, "SYNTHETIC-RETRY");
  assert.match(h.get("#payout-paid-message").textContent, /Payment was not saved/);
  assert.equal(h.call("paidPayoutsAffectedByWorkChange", initial.timeEntries[0], null).length, 0, "Unsaved paid status must not block work as if it were real");
  h.window.tracker.saveData = persist;
  await h.get("#payout-paid-save").dispatch("click");
  await pending;
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].payouts[0].paid, true);
  assert.equal(h.writes[0].payouts[0].paidDate, "2026-11-21");
  assert.equal(h.writes[0].payouts[0].transactionId, "SYNTHETIC-RETRY");
  assert.equal(h.get("#payout-paid-modal").classList.contains("hidden"), true);
});

test("payout cancellation after a failed save still leaves all stored and in-memory fields unchanged", async () => {
  const initial = fixture();
  const h = harness(initial);
  const result = h.call("openPayoutPaidDialog", { payoutDate: "2026-11-19" }, async () => { throw new Error("synthetic denied"); });
  await h.get("#payout-paid-save").dispatch("click");
  await h.window.dispatch("keydown", { key: "Escape" });
  assert.equal(await result, null);
  assert.deepEqual(h.data(), initial);
  assert.equal(h.writes.length, 0);
});

test("rate failed save retains the original assignment and retry uses the preserved entered rate", async () => {
  const initial = fixture();
  initial.employeeRates.unshift({ ...initial.employeeRates[0], id: "archived-rate", rateUsd: 9, archived: true });
  const h = harness(initial);
  const persist = h.window.tracker.saveData;
  h.window.tracker.saveData = async () => { throw new Error("synthetic disk failure"); };
  for (const [field, value] of Object.entries({ employeeId: "employee", contractId: "contract", noAgencyCut: "false", rateUsd: "13" })) h.get(`#rate-form input[name='${field}']`).value = value;
  await h.get("#rate-form").dispatch("submit");
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.data(), initial);
  assert.equal(h.call("activeEmployeeRate", "employee", "contract").rateUsd, 11);
  assert.equal(h.get("#rate-form input[name='rateUsd']").value, "13");
  assert.match(h.get("#rate-save-message").textContent, /Rate was not saved/);
  h.window.tracker.saveData = persist;
  await h.get("#rate-form").dispatch("submit");
  assert.equal(h.writes.length, 1);
  assert.equal(h.call("activeEmployeeRate", "employee", "contract").rateUsd, 13);
  assert.deepEqual(h.writes[0].employeeRates[0], initial.employeeRates[0]);
});
