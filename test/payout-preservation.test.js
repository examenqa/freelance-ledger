const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDefaultData } = require("../src/shared/data-schema");

function harness(initial) {
  const writes = [];
  const context = vm.createContext({ console, Intl, Date, structuredClone, initial: structuredClone(initial) });
  context.window = context;
  context.tracker = { async saveData(value, options) { writes.push({ value: structuredClone(value), options }); return structuredClone(value); } };
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  for (const [, filename] of index.matchAll(/<script src="\.\/(shared\/[^"<>]+\.js)"><\/script>/g)) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", filename), "utf8"), context);
  const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
  vm.runInContext(renderer.slice(0, renderer.lastIndexOf("\nboot(")), context);
  vm.runInContext("data = initial; render = () => {};", context);
  return { context, writes, call: text => vm.runInContext(text, context), data: () => JSON.parse(vm.runInContext("JSON.stringify(data)", context)) };
}

function fixture() {
  return { ...createDefaultData(),
    sources: [{ id: "source", name: "Synthetic source" }],
    contracts: [{ id: "contract", sourceId: "source", name: "Synthetic contract" }],
    employees: [{ id: "employee", name: "Synthetic person" }],
    employeeRates: [{ id: "archived", employeeId: "employee", contractId: "contract", rateUsd: 9, archived: true }, { id: "active", employeeId: "employee", contractId: "contract", rateUsd: 30 }],
    timeEntries: [{ id: "new-work", employeeId: "employee", contractId: "contract", weekStart: "2026-11-02", weekEnd: "2026-11-08", hours: 5, rateUsd: 11, totalUsd: 55 }],
    payouts: [{ id: "old", employeeId: "employee", weekStart: "2026-10-19", weekEnd: "2026-10-25", paid: false, totalUsd: 40, totalInr: 3200, contracts: [{ contractId: "contract", totalUsd: 40, exchangeRate: 80, totalInr: 3200 }], note: "Keep stored history" }],
  };
}

test("only explicit changed work generates its pending payout using stored work snapshots", async () => {
  const input = fixture(), h = harness(input);
  await h.call("save(data, { payoutWorkPeriods: [data.timeEntries[0]], backupReason: 'test' })");
  const saved = h.data();
  assert.deepEqual(saved.payouts.find(p => p.id === "old"), input.payouts[0]);
  const generated = saved.payouts.find(p => p.id !== "old");
  assert.equal(generated.totalUsd, 55);
  assert.equal(generated.contracts[0].rateUsd, 11);
  assert.equal(generated.totalInr, null);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].options)), { backupReason: "test" });
});

test("metadata saves never backfill an absent historical payout", async () => {
  const input = fixture(), h = harness(input);
  await h.call("save()");
  assert.deepEqual(h.data().payouts, input.payouts);
});

test("committed FX refresh changes pending INR only and freezes paid snapshots", async () => {
  const input = fixture();
  input.incomingPayments = [{ id: "received", contractId: "contract", received: true, paymentDate: "2026-11-12", exchangeRate: 90 }];
  input.payouts.push({ ...structuredClone(input.payouts[0]), id: "paid", paid: true, note: "Paid snapshot" });
  const h = harness(input);
  await h.call("save(data, { payoutFxContracts: ['contract'] })");
  const pending = h.data().payouts.find(p => p.id === "old");
  assert.equal(pending.totalUsd, 40);
  assert.equal(pending.totalInr, 3600);
  assert.equal(pending.contracts[0].totalUsd, 40);
  assert.deepEqual(h.data().payouts.find(p => p.id === "paid"), input.payouts[1]);
});

test("failed persistence leaves current payout snapshots untouched", async () => {
  const input = fixture(), h = harness(input);
  h.context.tracker.saveData = async () => { throw new Error("Synthetic write failure"); };
  await assert.rejects(h.call("save(data, { payoutWorkPeriods: [data.timeEntries[0]] })"), /Synthetic write failure/);
  assert.deepEqual(h.data().payouts, input.payouts);
});

test("explicit work reconciliation cannot change paid or incomplete historical periods", async () => {
  const input = fixture();
  input.payouts.push({ id: "employee|2026-11-02|2026-11-08", paid: true });
  await assert.rejects(harness(input).call("save(data, { payoutWorkPeriods: [data.timeEntries[0]] })"), /Paid work periods/);
  input.payouts.pop();
  delete input.timeEntries[0].rateUsd;
  await assert.rejects(harness(input).call("save(data, { payoutWorkPeriods: [data.timeEntries[0]] })"), /incomplete historical financial/);
});
