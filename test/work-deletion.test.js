const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDefaultData } = require("../src/shared/data-schema");

function fixture() {
  return { ...createDefaultData(), sources: [{ id: "s", name: "Synthetic" }], clients: [{ id: "client", sourceId: "s" }],
    contracts: [{ id: "ct", sourceId: "s", clientId: "client", name: "Synthetic contract", priceUsd: 99 }],
    employees: [{ id: "e", name: "Synthetic employee" }], employeeRates: [{ id: "r", employeeId: "e", contractId: "ct", rateUsd: 99 }],
    timeEntries: [
      { id: "remove", employeeId: "e", contractId: "ct", weekStart: "2026-11-02", weekEnd: "2026-11-08", hours: 5, rateUsd: 7, totalUsd: 35 },
      { id: "remain", employeeId: "e", contractId: "ct", weekStart: "2026-11-02", weekEnd: "2026-11-08", hours: 3, rateUsd: 7, totalUsd: 21 },
      { id: "other", employeeId: "e", contractId: "ct", weekStart: "2026-10-19", weekEnd: "2026-10-25", hours: 2, rateUsd: 9, totalUsd: 18 },
    ],
    incomingPayments: [{ id: "fx", contractId: "ct", received: true, paymentDate: "2026-11-10", exchangeRate: 83 }],
    payouts: [
      { id: "e|2026-11-02|2026-11-08", employeeId: "e", weekStart: "2026-11-02", weekEnd: "2026-11-08", totalUsd: 56, paid: false, contracts: [{ contractId: "ct", totalUsd: 56 }] },
      { id: "e|2026-10-19|2026-10-25", employeeId: "e", weekStart: "2026-10-19", weekEnd: "2026-10-25", totalUsd: 777, totalInr: 12345, paid: false, note: "Preserved historical override", contracts: [{ contractId: "ct", totalUsd: 777, totalInr: 12345 }] },
    ],
    weeklyProgress: { "e|ct|2026-11-02|2026-11-08": { status: "complete" }, "e|ct|2026-10-19|2026-10-25": { status: "complete" } },
  };
}

function harness(initial, failSave = false) {
  const writes = [], alerts = [];
  let confirms = 0;
  const context = vm.createContext({ console, Intl, Date, structuredClone, initial: structuredClone(initial),
    alert: message => alerts.push(message), confirm: () => { confirms++; return true; },
    document: { querySelector: () => null, querySelectorAll: () => [] },
  });
  context.window = context;
  context.tracker = { saveData: async (value, options) => {
    if (failSave) throw new Error("Synthetic save failure");
    writes.push({ value: JSON.parse(JSON.stringify(value)), options: JSON.parse(JSON.stringify(options)) });
    return structuredClone(value);
  } };
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  for (const [, file] of index.matchAll(/<script src="\.\/(shared\/[^"<>]+\.js)"><\/script>/g)) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
  vm.runInContext(source.slice(0, source.lastIndexOf("\nboot(")), context);
  vm.runInContext("data=initial; render=()=>{};", context);
  return { writes, alerts, confirms: () => confirms,
    remove: () => vm.runInContext("removeItem('timeEntries','remove','synthetic work')", context),
    data: () => JSON.parse(vm.runInContext("JSON.stringify(data)", context)),
  };
}

test("production work deletion blocks paid periods before confirmation or mutation", async () => {
  const initial = fixture(); initial.payouts[0].paid = true;
  const h = harness(initial);
  await h.remove();
  assert.equal(h.confirms(), 0);
  assert.equal(h.writes.length, 0);
  assert.match(h.alerts[0], /separately approved correction/);
  assert.deepEqual(h.data(), initial);
});

test("paid status metadata blocks deletion even if the corresponding payout row is missing", async () => {
  const initial = fixture(); initial.payouts.shift(); initial.payoutPaymentStatus["e|2026-11-02|2026-11-08"] = { paid: true };
  const h = harness(initial);
  await h.remove();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.data(), initial);
});

test("pending work deletion reconciles only its period from remaining stored financial values", async () => {
  const initial = fixture();
  const h = harness(initial);
  await h.remove();
  assert.equal(h.writes.length, 1);
  const saved = h.writes[0].value;
  assert.deepEqual(h.writes[0].options, { backupReason: "destructive" });
  assert.equal(saved.timeEntries.some(entry => entry.id === "remove"), false);
  const affected = saved.payouts.find(payout => payout.id === initial.payouts[0].id);
  assert.equal(affected.totalHours, 3);
  assert.equal(affected.totalUsd, 21, "Use remaining stored total, never the current contract/rate price of 99");
  assert.equal(affected.totalInr, 1743);
  assert.deepEqual(saved.payouts.find(payout => payout.id === initial.payouts[1].id), initial.payouts[1]);
  assert.equal(Object.hasOwn(saved.weeklyProgress, "e|ct|2026-11-02|2026-11-08"), false);
  assert.deepEqual(saved.weeklyProgress["e|ct|2026-10-19|2026-10-25"], initial.weeklyProgress["e|ct|2026-10-19|2026-10-25"]);
});

test("failed pending-work deletion leaves work, payouts and progress metadata unchanged", async () => {
  const initial = fixture(); const h = harness(initial, true);
  await h.remove();
  assert.equal(h.writes.length, 0);
  assert.match(h.alerts[0], /Synthetic save failure/);
  assert.deepEqual(h.data(), initial);
});
