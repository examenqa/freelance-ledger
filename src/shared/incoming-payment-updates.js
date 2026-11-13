(function attachIncomingPaymentUpdates(root) {
  const calculations = root.PaymentTrackerCalculations || (typeof require !== "undefined" ? require("./calculations") : null);

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function recalculateIncomingPayment(payment = {}) {
    if (!calculations) throw new Error("Payment calculations are unavailable.");
    const grossUsd = toNumber(payment.grossUsd);
    const serviceChargeUsd = toNumber(payment.serviceChargeUsd);
    const whtPercent = toNumber(payment.whtPercent);
    const whtUsd = calculations.calculateWht(grossUsd, whtPercent);
    const exchangeRate = toNumber(payment.exchangeRate);
    const netUsd = calculations.calculateIncomingNet(grossUsd, serviceChargeUsd, whtUsd);
    const gstPayableUsd = calculations.calculateGstPayable(serviceChargeUsd, payment.gstMode, payment.gstPercent);
    return {
      ...payment,
      grossUsd,
      serviceChargeUsd,
      whtPercent,
      whtUsd,
      exchangeRate,
      netUsd,
      netInr: calculations.round(netUsd * exchangeRate),
      gstPayableUsd,
      gstPayableInr: calculations.round(gstPayableUsd * exchangeRate),
    };
  }

  function applyBulkPaymentDetails(rows = [], selectedKeys = [], details = {}) {
    const keys = new Set(selectedKeys);
    const selected = rows.filter((row) => keys.has(row.key));
    const weeks = new Set(selected.map((row) => `${row.workWeekStart || ""}|${row.workWeekEnd || ""}`));
    if (!selected.length) throw new Error("Select at least one payment row.");
    if (weeks.size !== 1) throw new Error("A payment batch can contain entries from one work week only.");
    return rows.map((row) => {
      if (!keys.has(row.key)) return row;
      const received = details.markReceived === true ? true : row.received;
      return recalculateIncomingPayment({
        ...row,
        transactionId: details.transactionId,
        exchangeRate: details.exchangeRate,
        paymentDate: details.paymentDate,
        received,
      });
    });
  }

  function batchWouldOverwrite(rows = [], selectedKeys = []) {
    const keys = new Set(selectedKeys);
    return rows.some(
      (row) =>
        keys.has(row.key) &&
        Boolean(row.received || row.transactionId || row.exchangeRate || row.paymentDate),
    );
  }

  function batchSelectionState(rows = []) {
    const weekKeys = [...new Set(rows.map((row) => `${row.workWeekStart || ""}|${row.workWeekEnd || ""}`))];
    return {
      selectedCount: rows.length,
      weekCount: weekKeys.length,
      weekKeys,
      isValid: rows.length > 0 && weekKeys.length === 1,
      hasMultipleWeeks: weekKeys.length > 1,
    };
  }

  const api = { recalculateIncomingPayment, applyBulkPaymentDetails, batchWouldOverwrite, batchSelectionState };
  root.PaymentTrackerIncomingPayments = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? window : globalThis);
