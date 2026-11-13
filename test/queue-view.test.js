const test = require("node:test");
const assert = require("node:assert/strict");
const queue = require("../src/shared/queue-view");

const row = (key, start, extra = {}) => ({ key, contractId: "contract-a", contractLabel: "Contract A", workWeekStart: start, workWeekEnd: start === "2026-11-02" ? "2026-11-08" : "2026-11-15", received: false, hours: 2, grossUsd: 10, ...extra });
const rows = [
  row("a", "2026-11-02", { grossUsd: 100, transactionId: "Synthetic-ABC" }),
  row("b", "2026-11-02", { contractId: "contract-b", contractLabel: "Contract B", grossUsd: 20, received: true, paymentDate: "2026-11-20" }),
  row("c", "2026-11-09", { grossUsd: 3, exchangeRate: 0 }),
  row("d", "2026-11-09", { grossUsd: 3, exchangeRate: 90 }),
];

test("queue date, exact week, contract, status and search filters compose without changing source rows", () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(queue.filterRows(rows, { dateFrom: "2026-11-02", dateTo: "2026-11-02", status: "pending", search: "abc", contractId: "contract-a" }).map(row => row.key), ["a"]);
  assert.deepEqual(queue.filterRows(rows, { week: "2026-11-02|2026-11-08", status: "received" }).map(row => row.key), ["b"]);
  assert.deepEqual(queue.filterRows(rows, { dateFrom: "2026-11-10" }), []);
  assert.equal(JSON.stringify(rows), before);
});

test("money sorts numerically in either direction with stable row-key ties", () => {
  assert.deepEqual(queue.sortRows(rows, "grossUsd", "asc").map(row => row.key), ["c", "d", "b", "a"]);
  assert.deepEqual(queue.sortRows(rows, "grossUsd", "desc").map(row => row.key), ["a", "b", "c", "d"]);
});

test("unavailable FX sorts last in both directions while a genuine zero remains a number", () => {
  assert.deepEqual(queue.sortRows(rows, "exchangeRate", "asc").map(row => row.key), ["c", "d", "a", "b"]);
  assert.deepEqual(queue.sortRows(rows, "exchangeRate", "desc").map(row => row.key), ["d", "c", "a", "b"]);
});

test("dates and status use calendar/status order, preserving default pending/newest order", () => {
  assert.deepEqual(queue.sortRows(rows, "workWeekStart", "asc").map(row => row.key), ["a", "b", "c", "d"]);
  assert.deepEqual(queue.sortRows(rows, "paymentDate", "desc").map(row => row.key), ["b", "a", "c", "d"]);
  assert.deepEqual(queue.sortRows(rows, "default").map(row => row.key), ["c", "d", "a", "b"]);
});

test("select matching has invariant one-week scope independent of previous selection", () => {
  assert.equal(queue.selectionScope(rows).canSelect, false);
  assert.equal(queue.selectionScope(rows, [rows[0]]).canSelect, false);
  assert.equal(queue.selectionScope(rows.slice(0, 2)).canSelect, true);
  assert.equal(queue.selectionScope(rows.slice(0, 2), [rows[2]]).canSelect, false);
  assert.equal(queue.selectionScope([]).canSelect, false);
});

test("hidden selected counts and ranges follow the current filtered/sorted row order", () => {
  const visible = queue.visibleRows(rows, { filters: { status: "pending" }, sortKey: "grossUsd", sortDirection: "asc" });
  assert.deepEqual(queue.selectionCounts(rows, visible, ["a", "b", "deleted"]), { selected: 2, matching: 1, hidden: 1 });
  assert.deepEqual(queue.rangeRows(visible, "a", "c").map(row => row.key), ["c", "d", "a"]);
  assert.equal(queue.selectionScope(queue.rangeRows(visible, "a", "c")).canSelect, false);
});
