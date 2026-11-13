(function attachQueueView(root) {
  const numericSorts = new Set(["hours", "grossUsd", "exchangeRate", "serviceChargeUsd", "whtUsd", "netUsd", "netInr", "gstPayableUsd"]);
  const sortFields = ["default", "workWeekStart", "paymentDate", "contractLabel", "hours", "grossUsd", "exchangeRate", "serviceChargeUsd", "whtUsd", "netUsd", "netInr", "gstPayableUsd", "transactionId", "received"];
  const weekKey = row => `${row.workWeekStart || ""}|${row.workWeekEnd || ""}`;
  const isMissing = value => value === "" || value === undefined || value === null;

  function filterRows(rows, filters = {}) {
    const search = String(filters.search || "").trim().toLocaleLowerCase();
    return rows.filter(row => {
      if (filters.week && weekKey(row) !== filters.week) return false;
      if (filters.contractId && row.contractId !== filters.contractId) return false;
      if (filters.status === "pending" && row.received !== false) return false;
      if (filters.status === "received" && row.received === false) return false;
      if (filters.dateFrom && (!row.workWeekStart || row.workWeekStart < filters.dateFrom)) return false;
      if (filters.dateTo && (!row.workWeekStart || row.workWeekStart > filters.dateTo)) return false;
      if (search && ![row.contractLabel, row.transactionId, row.workWeekStart, row.workWeekEnd, row.paymentDate]
        .some(value => String(value || "").toLocaleLowerCase().includes(search))) return false;
      return true;
    });
  }

  function sortRows(rows, key = "default", direction = "asc") {
    if (!sortFields.includes(key)) key = "default";
    const sign = direction === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (key === "default") {
        if (a.received !== b.received) return a.received ? 1 : -1;
        const week = `${b.workWeekStart || ""}${b.workWeekEnd || ""}`.localeCompare(`${a.workWeekStart || ""}${a.workWeekEnd || ""}`);
        return week || String(a.contractLabel || "").localeCompare(String(b.contractLabel || "")) || String(a.key).localeCompare(String(b.key));
      }
      let left = a[key], right = b[key];
      if (key === "received") { left = a.received === false ? 0 : 1; right = b.received === false ? 0 : 1; }
      const numeric = numericSorts.has(key);
      const leftMissing = isMissing(left) || (numeric && !Number.isFinite(Number(left)));
      const rightMissing = isMissing(right) || (numeric && !Number.isFinite(Number(right)));
      // Unavailable values remain last in both directions, rather than pretending to be zero.
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      let compared = 0;
      if (!leftMissing) compared = numeric || key === "received" ? Number(left) - Number(right) : String(left).localeCompare(String(right));
      if (!compared && key === "workWeekStart") compared = String(a.workWeekEnd || "").localeCompare(String(b.workWeekEnd || ""));
      return compared * sign || String(a.key).localeCompare(String(b.key));
    });
  }

  function visibleRows(rows, state = {}) {
    return sortRows(filterRows(rows, state.filters), state.sortKey, state.sortDirection);
  }

  function selectionScope(matchingRows = [], selectedRows = []) {
    const matchingWeeks = new Set(matchingRows.map(weekKey));
    const combinedWeeks = new Set([...matchingRows, ...selectedRows].map(weekKey));
    let reason = "";
    if (!matchingRows.length) reason = "No matching rows to select.";
    else if (matchingWeeks.size !== 1) reason = "Choose one work week to select all matching rows.";
    else if (combinedWeeks.size > 1) reason = "Clear the other work week's selection first.";
    return { canSelect: !reason, reason, count: matchingRows.length, weekCount: matchingWeeks.size };
  }

  function selectionCounts(rows = [], matchingRows = [], selectedKeys = []) {
    const selected = new Set(selectedKeys), available = new Set(rows.map(row => row.key));
    const matching = new Set(matchingRows.map(row => row.key));
    const keys = [...selected].filter(key => available.has(key));
    const visible = keys.filter(key => matching.has(key)).length;
    return { selected: keys.length, matching: visible, hidden: keys.length - visible };
  }

  function rangeRows(rows = [], anchorKey, targetKey) {
    const start = rows.findIndex(row => row.key === anchorKey), end = rows.findIndex(row => row.key === targetKey);
    if (start < 0 || end < 0) return rows.filter(row => row.key === targetKey);
    return rows.slice(Math.min(start, end), Math.max(start, end) + 1);
  }

  const api = { filterRows, sortRows, visibleRows, selectionScope, selectionCounts, rangeRows, weekKey, sortFields };
  root.PaymentTrackerQueue = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? window : globalThis);
