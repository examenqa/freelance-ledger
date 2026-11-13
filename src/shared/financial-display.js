(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PaymentTrackerFinancialDisplay = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  function optionalNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function sumKnown(rows, field) {
    let sum = 0;
    for (const row of rows) {
      const value = optionalNumber(typeof field === "function" ? field(row) : row[field]);
      if (value === null) return null;
      sum += value;
    }
    return Math.round((sum + Number.EPSILON) * 100) / 100;
  }

  // Presentation only: never assigns derived values to a stored record.
  function referenceFromFx(usd, fx) {
    const amount = optionalNumber(usd), rate = optionalNumber(fx);
    if (amount === null || rate === null || rate <= 0) return null;
    return Math.round((amount * rate + Number.EPSILON) * 100) / 100;
  }

  function gstRecords(incoming, expenses) {
    return [
      ...incoming.map(payment => ({
        type: "Service Charge", date: payment.paymentDate, transactionId: payment.transactionId || "",
        contractId: payment.contractId, grossUsd: optionalNumber(payment.grossUsd),
        grossInr: referenceFromFx(payment.grossUsd, payment.exchangeRate),
        serviceChargeUsd: optionalNumber(payment.serviceChargeUsd),
        serviceChargeInr: referenceFromFx(payment.serviceChargeUsd, payment.exchangeRate),
        gstMode: payment.gstMode || "RCM", gstUsd: optionalNumber(payment.gstPayableUsd),
        gstInr: optionalNumber(payment.gstPayableInr), exchangeRate: optionalNumber(payment.exchangeRate),
      })),
      ...expenses.map(expense => ({
        type: "Expense", date: expense.expenseDate, transactionId: expense.label || "",
        expenseTypeId: expense.expenseTypeId, label: expense.label || "", grossUsd: optionalNumber(expense.amountUsd),
        grossInr: optionalNumber(expense.amountInr), serviceChargeUsd: 0, serviceChargeInr: 0,
        gstMode: expense.gstMode || "RCM", gstUsd: optionalNumber(expense.gstPayableUsd),
        gstInr: optionalNumber(expense.gstPayableInr), exchangeRate: optionalNumber(expense.exchangeRate),
      })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.type.localeCompare(b.type));
  }

  function gstTotals(records) {
    const expenses = records.filter(row => row.type === "Expense");
    return {
      count: records.length, grossUsd: sumKnown(records, "grossUsd"), grossInr: sumKnown(records, "grossInr"),
      serviceChargeUsd: sumKnown(records, "serviceChargeUsd"), serviceChargeInr: sumKnown(records, "serviceChargeInr"),
      gstUsd: sumKnown(records, "gstUsd"), gstInr: sumKnown(records, "gstInr"),
      expenseGstUsd: sumKnown(expenses, "gstUsd"), expenseGstInr: sumKnown(expenses, "gstInr"),
    };
  }

  return { optionalNumber, sumKnown, referenceFromFx, gstRecords, gstTotals };
});
