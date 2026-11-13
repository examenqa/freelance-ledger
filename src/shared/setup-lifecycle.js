(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PaymentTrackerSetupLifecycle = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const archivableCollections = ["sources", "clients", "contracts", "employees", "expenseTypes", "employeeRates"];

  function dependencyCounts(data, collection, itemId) {
    const rows = name => Array.isArray(data[name]) ? data[name] : [];
    const counts = {};
    const add = (name, matches) => { if (matches.length) counts[name] = matches.length; };
    const contractIds = new Set();
    if (collection === "sources") {
      const clients = rows("clients").filter(item => item.sourceId === itemId);
      const clientIds = new Set(clients.map(item => item.id));
      add("clients", clients);
      rows("contracts").filter(item => item.sourceId === itemId || clientIds.has(item.clientId)).forEach(item => contractIds.add(item.id));
      add("weeklyFxRates", rows("weeklyFxRates").filter(item => item.sourceId === itemId));
    }
    if (collection === "clients") rows("contracts").filter(item => item.clientId === itemId).forEach(item => contractIds.add(item.id));
    if (collection === "contracts") contractIds.add(itemId);
    if (collection === "sources" || collection === "clients") add("contracts", rows("contracts").filter(item => contractIds.has(item.id)));
    for (const name of ["employeeRates", "timeEntries", "incomingPayments", "payouts", "expenses"]) {
      add(name, rows(name).filter(item => contractIds.has(item.contractId) || (name === "payouts" && item.contracts?.some(line => contractIds.has(line.contractId)))));
    }
    if (collection === "employees") {
      for (const name of ["employeeRates", "timeEntries", "payouts"]) add(name, rows(name).filter(item => item.employeeId === itemId));
    }
    if (collection === "expenseTypes") add("expenses", rows("expenses").filter(item => item.expenseTypeId === itemId));
    if (collection === "employeeRates") {
      const rate = rows("employeeRates").find(item => item.id === itemId);
      if (rate) {
        add("timeEntries", rows("timeEntries").filter(item => item.employeeId === rate.employeeId && (item.contractId || "") === (rate.contractId || "")));
        add("payouts", rows("payouts").filter(item => item.employeeId === rate.employeeId && ((item.contractId !== undefined && (item.contractId || "") === (rate.contractId || "")) || item.contracts?.some(line => (line.contractId || "") === (rate.contractId || "")))));
      }
    }
    const progress = Object.keys(data.weeklyProgress || {}).filter(key => {
      const [employeeId, contractId] = key.split("|");
      return collection === "employees" ? employeeId === itemId : contractIds.has(contractId);
    });
    add("weeklyProgress", progress);
    return counts;
  }

  return { archivableCollections, dependencyCounts };
});
