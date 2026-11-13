(function attachWeeklyProgress(root) {
  const validation = root.PaymentTrackerWorkValidation || (typeof require !== "undefined" ? require("./work-validation") : null);
  const contractId = (value) => value === "__agency__" ? "" : value || "";

  function shiftDate(value, days) {
    if (!validation.isCalendarDate(value)) throw new Error("Choose a valid work date.");
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function weekForDate(value) {
    if (!validation.isCalendarDate(value)) throw new Error("Choose a valid work date.");
    const day = new Date(`${value}T12:00:00Z`).getUTCDay();
    const weekStart = shiftDate(value, day === 0 ? -6 : 1 - day);
    return { weekStart, weekEnd: shiftDate(weekStart, 6) };
  }

  function scopeForDate(employeeId, selectedContract, date) {
    return { employeeId, contractId: contractId(selectedContract), ...weekForDate(date) };
  }

  function key(scope) {
    return `${scope.employeeId}|${contractId(scope.contractId)}|${scope.weekStart}|${scope.weekEnd}`;
  }

  function scopeFromKey(value) {
    const [employeeId, selectedContract, weekStart, weekEnd, extra] = String(value).split("|");
    if (extra !== undefined || !employeeId || !validation.isCalendarDate(weekStart) || !validation.isCalendarDate(weekEnd)) return null;
    const canonical = weekForDate(weekStart);
    if (canonical.weekStart !== weekStart || canonical.weekEnd !== weekEnd) return null;
    return { employeeId, contractId: selectedContract, weekStart, weekEnd };
  }

  function overlaps(entry, scope) {
    return entry && entry.employeeId === scope.employeeId && contractId(entry.contractId) === contractId(scope.contractId) &&
      validation.isCalendarDate(entry.weekStart) && validation.isCalendarDate(entry.weekEnd) && entry.weekStart <= entry.weekEnd &&
      entry.weekStart <= scope.weekEnd && entry.weekEnd >= scope.weekStart;
  }

  function stateForWeek(data, scope) {
    const entries = (data.timeEntries || []).filter((entry) => overlaps(entry, scope));
    const marker = data.weeklyProgress?.[key(scope)];
    const status = entries.length ? marker?.status === "complete" ? "complete" : "recorded" : marker?.status === "no-work" ? "no-work" : "no-entry";
    const labels = { complete: "Complete", recorded: "Recorded — completion unconfirmed", "no-work": "No work (confirmed)", "no-entry": "No entry" };
    return { ...scope, status, label: labels[status], entries, entryCount: entries.length, hours: entries.reduce((sum, entry) => sum + (Number.isFinite(Number(entry.hours)) ? Number(entry.hours) : 0), 0) };
  }

  function markWeek(data, scope, status) {
    if (!scope.employeeId) throw new Error("Choose an employee and contract first.");
    const canonical = scopeForDate(scope.employeeId, scope.contractId, scope.weekStart);
    if (scope.weekStart !== canonical.weekStart || scope.weekEnd !== canonical.weekEnd) throw new Error("Progress is recorded for a Monday–Sunday calendar week.");
    if (!["complete", "no-work", "clear"].includes(status)) throw new Error("Choose a supported progress status.");
    const state = stateForWeek(data, canonical);
    if (status === "complete" && !state.entryCount) throw new Error("Record work before marking this week complete.");
    if (status === "no-work" && state.entryCount) throw new Error("This week has overlapping work entries. Open the existing work instead of marking No work.");
    const result = { ...(data.weeklyProgress || {}) };
    if (status === "clear") delete result[key(canonical)];
    else result[key(canonical)] = { ...canonical, status };
    return result;
  }

  function invalidateForWorkChange(data, previous, next) {
    const result = { ...(data.weeklyProgress || {}) };
    if (previous && next && validation.isUnchangedFinancialEdit(next, previous)) return result;
    for (const markerKey of Object.keys(result)) {
      const scope = scopeFromKey(markerKey);
      if (scope && (overlaps(previous, scope) || overlaps(next, scope))) delete result[markerKey];
    }
    return result;
  }

  function history(data, scope, count = 12) {
    const anchor = weekForDate(scope.weekStart);
    return Array.from({ length: Math.max(1, Math.min(52, count)) }, (_, index) =>
      stateForWeek(data, { employeeId: scope.employeeId, contractId: contractId(scope.contractId), ...weekForDate(shiftDate(anchor.weekStart, -7 * index)) }),
    );
  }

  function recordedBounds(data, employeeId, selectedContract) {
    const matching = (data.timeEntries || []).filter((entry) => entry.employeeId === employeeId && contractId(entry.contractId) === contractId(selectedContract) && validation.isCalendarDate(entry.weekStart));
    const dates = matching.map((entry) => entry.weekStart).sort();
    return { count: matching.length, first: dates[0] || "", latest: dates[dates.length - 1] || "" };
  }

  const api = { key, scopeFromKey, shiftDate, weekForDate, scopeForDate, overlaps, stateForWeek, markWeek, invalidateForWorkChange, history, recordedBounds };
  root.PaymentTrackerWeeklyProgress = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? window : globalThis);
