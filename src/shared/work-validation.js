(function attachWorkValidation(root) {
  function isCalendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizedContractId(value) {
    return value === "__agency__" ? "" : value || "";
  }

  function isUnchangedFinancialEdit(values, original) {
    return Boolean(original &&
      original.employeeId === values.employeeId &&
      normalizedContractId(original.contractId) === normalizedContractId(values.contractId) &&
      original.weekStart === values.weekStart && original.weekEnd === values.weekEnd &&
      Number(original.hours) === Number(values.hours));
  }

  function validateWorkEntry(values, entries = [], { editId = "" } = {}) {
    const errors = [];
    const hours = Number(values.hours);
    if (!Number.isFinite(hours) || hours <= 0) errors.push({ field: "hours", message: "Enter hours greater than 0. Use No work to record a week without financial work." });
    if (!isCalendarDate(values.weekStart)) errors.push({ field: "weekStart", message: "Enter a valid work week start date." });
    if (!isCalendarDate(values.weekEnd)) errors.push({ field: "weekEnd", message: "Enter a valid work week end date." });
    if (errors.length) return { valid: false, errors, overlaps: [] };
    if (values.weekEnd < values.weekStart) {
      return { valid: false, errors: [{ field: "weekEnd", message: "Work week end must be on or after the start date." }], overlaps: [] };
    }

    const contractId = normalizedContractId(values.contractId);
    const original = editId ? entries.find((entry) => entry.id === editId) : null;
    const preservesFinancialFields = isUnchangedFinancialEdit(values, original);
    const overlaps = entries.filter((entry) =>
      entry.id !== editId && entry.employeeId === values.employeeId &&
      normalizedContractId(entry.contractId) === contractId &&
      isCalendarDate(entry.weekStart) && isCalendarDate(entry.weekEnd) &&
      entry.weekStart <= entry.weekEnd &&
      values.weekStart <= entry.weekEnd && values.weekEnd >= entry.weekStart,
    );
    // Existing overlaps are not repaired or rewritten. A notes-only edit may retain
    // its current financial period/hours, but new or changed financial work cannot overlap.
    if (overlaps.length && !preservesFinancialFields) return { valid: false, errors: [], overlaps };
    return { valid: true, errors: [], overlaps: [], preservesLegacyOverlap: Boolean(overlaps.length), unchangedFinancialEdit: preservesFinancialFields };
  }

  const api = { isCalendarDate, isUnchangedFinancialEdit, validateWorkEntry };
  root.PaymentTrackerWorkValidation = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? window : globalThis);
