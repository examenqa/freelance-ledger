(function attachCalculations(root) {
  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function round(value) {
    return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
  }

  function normalizeGstMode(mode) {
    const value = String(mode || "NONE").trim().toUpperCase();
    return value === "RCM" || value.includes("RCM") ? "RCM" : "NONE";
  }

  function calculateWht(grossUsd, percent) {
    return round(toNumber(grossUsd) * (toNumber(percent) / 100));
  }

  function calculateIncomingNet(grossUsd, serviceChargeUsd, whtUsd) {
    return round(toNumber(grossUsd) - toNumber(serviceChargeUsd) - toNumber(whtUsd));
  }

  function calculateGstPayable(baseUsd, mode, percent) {
    return normalizeGstMode(mode) === "RCM" ? round(toNumber(baseUsd) * (toNumber(percent) / 100)) : 0;
  }

  function calculatePayoutLine(hours, rateUsd, exchangeRate) {
    const totalUsd = round(toNumber(hours) * toNumber(rateUsd));
    return { totalUsd, totalInr: exchangeRate ? round(totalUsd * toNumber(exchangeRate)) : 0 };
  }

  function dateInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function weekBounds(anchorDate) {
    const date = new Date(anchorDate);
    const monday = new Date(date);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(date.getDate() + (date.getDay() === 0 ? -6 : 1 - date.getDay()));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { weekStart: dateInput(monday), weekEnd: dateInput(sunday), weekStartDate: monday, weekEndDate: sunday };
  }

  function isDateInRange(dateValue, range) {
    if (!range) return true;
    if (!dateValue) return false;
    const date = new Date(`${dateValue}T00:00:00`);
    return date >= range.start && date <= range.end;
  }

  function pendingPayoutsForPeriod(payouts, range) {
    return (payouts || []).filter((item) => item.paid !== true && isDateInRange(item.weekStart, range));
  }

  function sum(items, selector) {
    return round(items.reduce((total, item) => total + toNumber(selector(item)), 0));
  }

  function calculateOverviewMetrics({
    receivedIncoming = [],
    outstandingIncoming = [],
    periodPayouts = [],
    pendingPayouts = [],
    periodPendingPayouts = pendingPayouts,
    periodExpenses = [],
    estimatedRateFor = () => 0,
    referenceRate = 0,
  }) {
    const grossIncomeUsd = sum(receivedIncoming, (item) => item.grossUsd);
    const grossIncomeInr = round(receivedIncoming.reduce((total, item) => total + toNumber(item.grossUsd) * toNumber(item.exchangeRate), 0));
    const serviceChargeUsd = sum(receivedIncoming, (item) => item.serviceChargeUsd);
    const whtUsd = sum(receivedIncoming, (item) => item.whtUsd);
    const deductionsUsd = round(serviceChargeUsd + whtUsd);
    const deductionsInr = round(receivedIncoming.reduce((total, item) => total + (toNumber(item.serviceChargeUsd) + toNumber(item.whtUsd)) * toNumber(item.exchangeRate), 0));
    const netIncomeUsd = sum(receivedIncoming, (item) => item.netUsd);
    const netIncomeInr = sum(receivedIncoming, (item) => item.netInr);
    const outstandingIncomingUsd = sum(outstandingIncoming, (item) => item.netUsd);
    const outstandingIncomingEstimate = outstandingIncoming.reduce((totals, item) => {
      const rate = toNumber(estimatedRateFor(item));
      if (rate) { totals.total += toNumber(item.netUsd) * rate; totals.count += 1; }
      return totals;
    }, { total: 0, count: 0 });
    const payoutsPaidUsd = sum(periodPayouts, (item) => item.totalUsd);
    const payoutsPaidInr = sum(periodPayouts, (item) => item.totalInr);
    const pendingPayoutsUsd = sum(pendingPayouts, (item) => item.totalUsd);
    const pendingPayoutsInr = sum(pendingPayouts, (item) => item.totalInr);
    const periodPendingPayoutsUsd = sum(periodPendingPayouts, (item) => item.totalUsd);
    const periodPendingPayoutsInr = sum(periodPendingPayouts, (item) => item.totalInr);
    const expensesUsd = sum(periodExpenses, (item) => item.amountUsd);
    const expensesInr = sum(periodExpenses, (item) => item.amountInr);
    const gstRcmUsd = round(sum(receivedIncoming, (item) => item.gstPayableUsd) + sum(periodExpenses, (item) => item.gstPayableUsd));
    const gstRcmInr = round(sum(receivedIncoming, (item) => item.gstPayableInr) + sum(periodExpenses, (item) => item.gstPayableInr));
    const agencyGainsUsd = round(grossIncomeUsd - deductionsUsd - payoutsPaidUsd - periodPendingPayoutsUsd - expensesUsd - gstRcmUsd);
    const agencyGainsInr = referenceRate ? round(agencyGainsUsd * referenceRate) : 0;
    return { grossIncomeUsd, grossIncomeInr, serviceChargeUsd, whtUsd, deductionsUsd, deductionsInr, netIncomeUsd, netIncomeInr, outstandingIncomingUsd, outstandingIncomingInr: round(outstandingIncomingEstimate.total), outstandingRateCoverage: outstandingIncomingEstimate.count, payoutsPaidUsd, payoutsPaidInr, pendingPayoutsUsd, pendingPayoutsInr, periodPendingPayoutsUsd, periodPendingPayoutsInr, expensesUsd, expensesInr, gstRcmUsd, gstRcmInr, agencyGainsUsd, agencyGainsInr };
  }

  const api = { toNumber, round, normalizeGstMode, calculateWht, calculateIncomingNet, calculateGstPayable, calculatePayoutLine, weekBounds, isDateInRange, pendingPayoutsForPeriod, calculateOverviewMetrics };
  root.PaymentTrackerCalculations = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? window : globalThis);
