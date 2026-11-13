(function (root, factory) {
  const validation = root.PaymentTrackerWorkValidation || (typeof require === "function" ? require("./work-validation") : null);
  const api = factory(validation);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PaymentTrackerAnalytics = api;
})(typeof globalThis === "object" ? globalThis : this, function (validation) {
  "use strict";

  // Reporting only. No function in this module changes a supplied record or calls a save boundary.
  function strictNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  const round = value => Math.abs(value) > Number.MAX_VALUE / 100 ? value : Math.round((value + Number.EPSILON) * 100) / 100;
  const rowsOf = (data, name) => Array.isArray(data?.[name]) ? data[name] : [];
  const object = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const validId = value => typeof value === "string" && value.trim().length > 0;
  const agencyId = value => value === "" || value === "__agency__";
  const normalizeContract = value => agencyId(value) ? "" : typeof value === "string" ? value : "__unknown__";
  const validDate = value => Boolean(validation?.isCalendarDate(value));
  const validMonth = value => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const own = (value, field) => Object.prototype.hasOwnProperty.call(value || {}, field);

  function entityIndex(data, collection) {
    const result = new Map();
    for (const item of rowsOf(data, collection)) {
      if (!object(item) || !validId(item.id)) continue;
      result.set(item.id, result.has(item.id) ? null : item);
    }
    return result;
  }

  function buildAnalytics(input = {}, filters = {}, now = new Date()) {
    const data = object(input) ? input : {};
    const clock = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(clock.getTime())) throw new Error("Analytics requires a valid current date.");
    const currentMonth = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, "0")}`;
    const month = validMonth(filters.month) ? filters.month : currentMonth;
    const period = (filters.period || filters.scope) === "all-time" ? "all-time" : "month";
    const selected = Object.fromEntries(["employeeId", "clientId", "contractId"].map(key => [key, typeof filters[key] === "string" ? filters[key] : ""]));
    const entities = Object.fromEntries(["clients", "contracts", "employees", "expenseTypes", "sources"].map(name => [name, entityIndex(data, name)]));
    const warnings = [];
    const aggregateWarnings = new Set();
    const metrics = {};
    const duplicateSets = {};
    const occurrences = {};
    const metricLabels = { receipts: "Net money received", hours: "Hours worked", expenses: "Recorded expenses", payouts: "Employee payouts marked paid", incoming: "Estimated pending incoming work", pendingPayouts: "Pending payouts" };
    const bases = { receipts: "Receipt date", hours: "Work-period start", expenses: "Expense date", payouts: "Actual payment date", incoming: "Work-period start (estimate)", pendingPayouts: "Scheduled payout date" };

    for (const collection of ["incomingPayments", "timeEntries", "expenses", "payouts"]) {
      const counts = new Map();
      rowsOf(data, collection).forEach(item => { if (validId(item?.id)) counts.set(item.id, (counts.get(item.id) || 0) + 1); });
      duplicateSets[collection] = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
      occurrences[collection] = rowsOf(data, collection).map((item, index) => ({ collection, index, id: validId(item?.id) ? item.id : "" }));
    }

    function label(collection, id, fallback) {
      const item = entities[collection]?.get(id);
      return item ? String(item.shortName?.trim() || item.name || fallback) + (item.archived === true ? " (archived)" : "") : `${fallback}${id && id !== "__unknown__" ? ` [${id}]` : ""}`;
    }

    function identity(contractId) {
      const normalized = normalizeContract(contractId);
      const contract = entities.contracts.get(normalized);
      return {
        contractId: normalized,
        contractLabel: normalized === "" ? "Agency Payroll" : label("contracts", normalized, "Unknown contract"),
        clientId: normalized === "" ? "__agency__" : contract && validId(contract.clientId) ? contract.clientId : "__unknown__",
        clientLabel: normalized === "" ? "Agency Payroll" : contract && validId(contract.clientId) ? label("clients", contract.clientId, "Unknown client") : "Unknown client",
        attributionKnown: normalized === "" || Boolean(contract && validId(contract.clientId) && entities.clients.get(contract.clientId)),
        contractAttributionKnown: normalized === "" || Boolean(contract),
      };
    }

    function issue(row, code, message, refs = row.sourceRefs) {
      if (row.issues.some(item => item.code === code)) return;
      row.issues.push({ code, message });
      warnings.push({ metric: row.metric, code, message, refs: refs.map(ref => ({ ...ref })) });
    }

    function rowFor(collection, index, raw, metric, dateField, fields) {
      const item = object(raw) ? raw : {};
      const source = { collection, index, id: validId(item.id) ? item.id : "" };
      const amounts = Object.fromEntries(["usd", "inr", "hours"].map(key => [key, fields[key] ? strictNumber(item[fields[key]]) : null]));
      const row = {
        key: `${collection}:${index}`, id: source.id, source, sourceRefs: [source], metric,
        date: validDate(item[dateField]) ? item[dateField] : "", savedDate: typeof item[dateField] === "string" ? item[dateField] : "",
        dateBasis: bases[metric], label: String(item.label || item.transactionId || source.id || `${collection} row ${index + 1}`),
        employeeId: validId(item.employeeId) ? item.employeeId : "__unknown__",
        employeeLabel: label("employees", item.employeeId, "Unknown employee"),
        expenseTypeId: validId(item.expenseTypeId) ? item.expenseTypeId : "__unknown__",
        expenseTypeLabel: label("expenseTypes", item.expenseTypeId, "Unknown expense type"),
        ...identity(item.contractId), ...amounts, saved: { ...amounts }, included: true,
        issues: [], uncertain: { usd: false, inr: false, hours: false }, quarantined: false, status: "", lines: [],
      };
      if (!object(raw)) quarantine(row, "invalid-record", "The source occurrence is not a record.");
      else if (!validId(item.id)) quarantine(row, "missing-id", "Missing record ID; this occurrence is excluded rather than merged.");
      else if (duplicateSets[collection]?.has(item.id)) quarantine(row, "duplicate-id", "Duplicate record ID; every occurrence with this ID is quarantined.", occurrences[collection].filter(ref => ref.id === item.id));
      if (!row.date && !(metric === "payouts" && item.paid !== true)) issue(row, "undated", `Missing or invalid ${bases[metric].toLowerCase()}; no monthly date was invented.`);
      for (const key of Object.keys(fields)) if (fields[key] && amounts[key] === null) issue(row, `missing-${key}`, `Saved ${key.toUpperCase()} value is missing or invalid.`);
      if (metric !== "expenses" && row.contractId !== "" && !entities.contracts.get(row.contractId) && collection !== "payouts") issue(row, "unknown-contract", "The contract association is missing or ambiguous; retain its historical ID.");
      if (metric !== "expenses" && collection !== "payouts" && !row.attributionKnown) {
        const refs = [...row.sourceRefs];
        for (const name of ["contracts", "clients"]) rowsOf(data, name).forEach((record, occurrence) => {
          if ((name === "contracts" && record?.id === row.contractId) || (name === "clients" && record?.id === row.clientId)) refs.push({ collection: name, index: occurrence, id: record.id });
        });
        issue(row, "unknown-current-client", "Current client attribution is missing or ambiguous; client grouping is qualified rather than inferred.", refs);
      }
      for (const [name, id] of [["employees", row.employeeId], ["expenseTypes", row.expenseTypeId]]) {
        if (entities[name].has(id) && !entities[name].get(id)) issue(row, `ambiguous-${name}`, `Duplicate ${name} setup IDs make this identity ambiguous.`, [row.source, ...rowsOf(data, name).flatMap((record, occurrence) => record?.id === id ? [{ collection: name, index: occurrence, id }] : [])]);
      }
      return row;
    }

    function quarantine(row, code, message, refs) {
      row.quarantined = true;
      row.included = false;
      row.usd = row.inr = row.hours = null;
      issue(row, code, message, refs);
    }

    function cloneRow(row) {
      return { ...row, issues: row.issues.map(item => ({ ...item })), uncertain: { ...row.uncertain }, sourceRefs: row.sourceRefs.map(ref => ({ ...ref })), saved: { ...row.saved } };
    }

    const work = rowsOf(data, "timeEntries").map((entry, index) => {
      const row = rowFor("timeEntries", index, entry, "hours", "weekStart", { hours: "hours" });
      row.weekStart = typeof entry?.weekStart === "string" ? entry.weekStart : "";
      row.weekEnd = typeof entry?.weekEnd === "string" ? entry.weekEnd : "";
      if (!validDate(entry?.weekStart) || !validDate(entry?.weekEnd) || entry.weekEnd < entry.weekStart) quarantine(row, "invalid-work-period", "Work requires real, ordered start/end dates; invalid periods are excluded from valid hours.");
      if (row.saved.hours === null || row.saved.hours <= 0) quarantine(row, "invalid-hours", "Hours must be a finite number greater than zero.");
      if (validDate(entry?.weekStart) && validDate(entry?.weekEnd) && entry.weekStart.slice(0, 7) !== entry.weekEnd.slice(0, 7)) issue(row, "cross-month-work", "The complete work period belongs to its start month; hours were not prorated.");
      return row;
    });
    const workGroups = new Map();
    for (const row of work.filter(row => row.date && validDate(row.weekEnd) && row.weekEnd >= row.date)) {
      const key = JSON.stringify([row.employeeId, row.contractId]);
      if (!workGroups.has(key)) workGroups.set(key, []);
      workGroups.get(key).push(row);
    }
    for (const group of workGroups.values()) {
      const ordered = [...group].sort((left, right) => left.date.localeCompare(right.date) || left.weekEnd.localeCompare(right.weekEnd));
      let furthest = ordered[0];
      for (const row of ordered.slice(1)) {
        if (row.date <= furthest.weekEnd) {
          const refs = [furthest.source, row.source];
          quarantine(furthest, "overlapping-work", "Overlapping work for the same employee/contract is quarantined; no records were merged.", refs);
          quarantine(row, "overlapping-work", "Overlapping work for the same employee/contract is quarantined; no records were merged.", refs);
        }
        if (row.weekEnd > furthest.weekEnd) furthest = row;
      }
    }

    const receiptGroups = new Map();
    const receipts = rowsOf(data, "incomingPayments").map((payment, index) => {
      const row = rowFor("incomingPayments", index, payment, "receipts", "paymentDate", { usd: "netUsd", inr: "netInr" });
      row.weekStart = typeof payment?.workWeekStart === "string" ? payment.workWeekStart : "";
      row.weekEnd = typeof payment?.workWeekEnd === "string" ? payment.workWeekEnd : "";
      if (!own(payment, "received")) {
        row.status = "Received (legacy inferred)";
        issue(row, "legacy-received", "Absent legacy received status follows the existing app convention: received is inferred.");
      } else if (payment.received === true) row.status = "Received";
      else if (payment.received === false) row.status = "Pending";
      else {
        row.status = "Unresolved status";
        quarantine(row, "invalid-received-status", "Received status is malformed; it is not treated as true or false.");
      }
      if (validId(payment?.contractId) && validDate(row.weekStart) && validDate(row.weekEnd)) {
        const key = JSON.stringify([payment.contractId, row.weekStart, row.weekEnd]);
        if (!receiptGroups.has(key)) receiptGroups.set(key, []);
        receiptGroups.get(key).push(row);
      }
      return row;
    });
    for (const group of receiptGroups.values()) if (group.length > 1) {
      for (const row of group) {
        row.uncertain.usd = row.uncertain.inr = true;
        issue(row, "same-work-receipts", "Multiple saved payment occurrences share this work period. Distinct IDs are retained, but installment/correction/duplicate meaning is unconfirmed.", group.map(item => item.source));
      }
    }

    const expenses = rowsOf(data, "expenses").map((expense, index) => {
      const row = rowFor("expenses", index, expense, "expenses", "expenseDate", { usd: "amountUsd", inr: "amountInr" });
      row.gstUsd = strictNumber(expense?.gstPayableUsd);
      row.gstInr = strictNumber(expense?.gstPayableInr);
      row.label = String(expense?.label || row.expenseTypeLabel);
      return row;
    });

    function reconciliation(row, currency) {
      const field = currency === "usd" ? "totalUsd" : "totalInr";
      const parent = row.saved[currency];
      if (parent === null) return { valid: false, reason: "The saved parent amount is unavailable." };
      if (!row.lines.length) return { valid: false, reason: "No saved allocation lines are available." };
      const amounts = row.lines.map(line => strictNumber(line.raw[field]));
      if (amounts.some(value => value === null)) return { valid: false, reason: "A saved allocation line amount is unavailable." };
      const sum = amounts.reduce((total, amount) => total + amount, 0);
      if (!Number.isFinite(sum)) return { valid: false, reason: "The saved allocation sum is not finite." };
      if (round(sum) !== round(parent)) return { valid: false, reason: "The saved line sum does not match the saved parent amount." };
      return { valid: true, reason: "" };
    }

    const payoutRows = rowsOf(data, "payouts").map((payout, index) => {
      const row = rowFor("payouts", index, payout, "payouts", "paidDate", { usd: "totalUsd", inr: "totalInr" });
      row.scheduledDate = validDate(payout?.payoutDate) ? payout.payoutDate : "";
      row.savedScheduledDate = typeof payout?.payoutDate === "string" ? payout.payoutDate : "";
      row.weekStart = typeof payout?.weekStart === "string" ? payout.weekStart : "";
      row.weekEnd = typeof payout?.weekEnd === "string" ? payout.weekEnd : "";
      row.status = payout?.paid === true ? "Paid" : payout?.paid === false || !own(payout, "paid") ? "Pending" : "Unresolved status";
      if (row.status === "Unresolved status") quarantine(row, "invalid-paid-status", "Paid status is malformed; it is not treated as paid or pending.");
      const status = object(data.payoutPaymentStatus) ? data.payoutPaymentStatus[row.id] : null;
      if (own(data.payoutPaymentStatus, row.id) && (!object(status) || (own(status, "paid") && typeof status.paid !== "boolean") || (typeof status.paid === "boolean" && status.paid !== (payout?.paid === true)))) {
        row.status = "Unresolved status";
        quarantine(row, "payout-status-conflict", "The payout snapshot and payment-status metadata disagree; no status was invented.");
      }
      if (status && object(status) && typeof status.paidDate === "string" && status.paidDate && payout?.paidDate && status.paidDate !== payout.paidDate) {
        row.status = "Unresolved status";
        quarantine(row, "payout-date-conflict", "Saved payout and status metadata have different actual payment dates.");
      }
      row.lines = (Array.isArray(payout?.contracts) ? payout.contracts : []).map((raw, lineIndex) => ({ raw: object(raw) ? raw : {}, ...identity(raw?.contractId), source: { ...row.source, path: `contracts[${lineIndex}]` } }));
      if (row.lines.some(line => !line.attributionKnown)) issue(row, "unknown-current-client", "A payout allocation line has missing or ambiguous current client attribution.", row.lines.filter(line => !line.attributionKnown).map(line => line.source));
      if (row.lines.length) {
        row.contractLabel = [...new Set(row.lines.map(line => line.contractLabel))].join("; ");
        row.clientLabel = [...new Set(row.lines.map(line => line.clientLabel))].join("; ");
      }
      row.allocation = { usd: reconciliation(row, "usd"), inr: reconciliation(row, "inr") };
      for (const currency of ["usd", "inr"]) if (!row.allocation[currency].valid) issue(row, `unresolved-allocation-${currency}`, `${currency.toUpperCase()} allocation unresolved: ${row.allocation[currency].reason}`);
      return row;
    });
    const payoutPeriodGroups = new Map();
    payoutRows.forEach((row, index) => {
      const raw = rowsOf(data, "payouts")[index];
      if (!validId(raw?.employeeId) || !validDate(raw?.weekStart) || !validDate(raw?.weekEnd)) return;
      const key = JSON.stringify([raw.employeeId, raw.weekStart, raw.weekEnd]);
      if (!payoutPeriodGroups.has(key)) payoutPeriodGroups.set(key, []);
      payoutPeriodGroups.get(key).push(row);
    });
    for (const group of payoutPeriodGroups.values()) if (group.length > 1) for (const row of group) {
      quarantine(row, "duplicate-payout-period", "Multiple payout snapshots share the same employee/work period; partial payout semantics are undefined.", group.map(item => item.source));
    }
    if (object(data.payoutPaymentStatus)) Object.entries(data.payoutPaymentStatus).forEach(([id, status]) => {
      if (status?.paid !== true || payoutRows.some(row => row.id === id)) return;
      const row = rowFor("payoutPaymentStatus", -1, { id, paidDate: status.paidDate }, "payouts", "paidDate", { usd: "totalUsd", inr: "totalInr" });
      row.key = `payoutPaymentStatus:${id}`;
      row.employeeId = id.split("|")[0] || "__unknown__";
      row.employeeLabel = label("employees", row.employeeId, "Unknown employee");
      row.status = "Unresolved status";
      quarantine(row, "missing-payout-snapshot", "Paid status metadata has no payout snapshot; an amount was not regenerated.");
      payoutRows.push(row);
    });

    function entityFilter(sourceRows, payout = false) {
      const result = [];
      for (const original of sourceRows) {
        const row = cloneRow(original);
        if (selected.employeeId && row.employeeId !== selected.employeeId) continue;
        if (selected.employeeId && entities.employees.has(selected.employeeId) && !entities.employees.get(selected.employeeId)) {
          row.usd = row.inr = row.hours = null;
          row.identityFilterBlocked = true;
          issue(row, "ambiguous-employee-filter", "Duplicate employee setup IDs prevent assigning this occurrence to a unique selected employee.");
        }
        if (!selected.contractId && !selected.clientId) { result.push(row); continue; }
        if (payout) {
          const matching = row.lines.filter(line => (!selected.contractId || line.contractId === normalizeContract(selected.contractId)) && (!selected.clientId || line.clientId === selected.clientId));
          const uncertainIdentity = row.lines.some(line => (!selected.contractId || line.contractId === normalizeContract(selected.contractId)) && selected.clientId && !line.attributionKnown);
          if (!matching.length && row.lines.length && !uncertainIdentity) continue;
          for (const currency of ["usd", "inr"]) {
            row[currency] = !row.quarantined && !row.identityFilterBlocked && row.allocation?.[currency]?.valid && !uncertainIdentity ? round(matching.reduce((sum, line) => sum + strictNumber(line.raw[currency === "usd" ? "totalUsd" : "totalInr"]), 0)) : null;
          }
          if (!matching.length || uncertainIdentity) issue(row, "unresolved-filter-allocation", "The selected contract/client portion cannot be established from saved allocation identities.");
          row.sourceRefs = matching.length ? matching.map(line => line.source) : row.sourceRefs;
          row.lines = matching;
          if (selected.contractId) Object.assign(row, identity(selected.contractId));
        } else {
          if (selected.contractId && row.contractId !== normalizeContract(selected.contractId)) continue;
          if (selected.clientId) {
            if (row.attributionKnown && row.clientId !== selected.clientId) continue;
            if (!row.attributionKnown) {
              row.usd = row.inr = row.hours = null;
              issue(row, "unknown-client-filter", "Missing current client attribution prevents assigning this occurrence to the selected client.");
            }
          }
        }
        result.push(row);
      }
      return result;
    }

    function amountSummary(rows, field, dateUnknown = 0) {
      const known = rows.filter(row => row[field] !== null && strictNumber(row[field]) !== null);
      const missingCount = rows.length - known.length + dateUnknown;
      const exceptionCount = rows.filter(row => row[field] === null || row.uncertain?.[field]).length + dateUnknown;
      let complete = missingCount === 0 && !rows.some(row => row.uncertain?.[field]);
      const sum = known.reduce((total, row) => total + row[field], 0);
      const finite = Number.isFinite(sum);
      const knownSubtotal = finite ? round(sum) : null;
      if (!finite) {
        complete = false;
        const refs = known.flatMap(row => row.sourceRefs);
        const key = JSON.stringify([known[0]?.metric, field, refs]);
        if (!aggregateWarnings.has(key)) {
          aggregateWarnings.add(key);
          warnings.push({ metric: known[0]?.metric || "analytics", code: `nonfinite-aggregate-${field}`, message: `The ${field.toUpperCase()} aggregate is not finite; even its known subtotal is unavailable.`, refs });
        }
      }
      return { value: complete ? knownSubtotal : null, knownSubtotal, complete, knownCount: known.length, missingCount, exceptionCount: exceptionCount + (finite ? 0 : 1) };
    }

    function summarize(rows, dateUnknown = 0) {
      return Object.fromEntries(["usd", "inr", "hours"].map(field => [field, amountSummary(rows, field, dateUnknown)]));
    }

    function groups(rows, dimension, payout) {
      let groupedRows = rows;
      if (payout && (dimension === "client" || dimension === "contract")) {
        groupedRows = [];
        for (const parent of rows) {
          const allocationLines = parent.lines || [];
          for (const line of allocationLines) {
            const row = cloneRow(parent);
            row.key = `${parent.key}:${line.source.path}`;
            Object.assign(row, identity(line.contractId));
            row.sourceRefs = [line.source];
            for (const currency of ["usd", "inr"]) row[currency] = parent.included && parent[currency] !== null && !parent.quarantined && parent.allocation?.[currency]?.valid ? strictNumber(line.raw[currency === "usd" ? "totalUsd" : "totalInr"]) : null;
            groupedRows.push(row);
          }
          if (!allocationLines.length || ["usd", "inr"].some(currency => !parent.allocation?.[currency]?.valid)) {
            const row = cloneRow(parent);
            row.key = `${parent.key}:unallocated`;
            row.contractId = row.clientId = "__unallocated__";
            row.contractLabel = row.clientLabel = "Allocation unresolved";
            for (const currency of ["usd", "inr"]) row[currency] = parent.included && !parent.quarantined ? parent.allocation?.[currency]?.valid ? 0 : parent[currency] : null;
            groupedRows.push(row);
          }
        }
      }
      const map = new Map();
      for (const row of groupedRows) {
        const grouped = cloneRow(row);
        if ((dimension === "client" && !row.attributionKnown && row.clientId !== "__unallocated__") || (dimension === "contract" && !row.contractAttributionKnown && row.contractId !== "__unallocated__")) {
          grouped.uncertain.usd = grouped.uncertain.inr = grouped.uncertain.hours = true;
        }
        const setupCollection = dimension === "employee" ? "employees" : dimension === "expenseType" ? "expenseTypes" : "";
        const setupId = row[`${dimension}Id`];
        if (setupCollection && entities[setupCollection].has(setupId) && !entities[setupCollection].get(setupId)) {
          grouped.uncertain.usd = grouped.uncertain.inr = grouped.uncertain.hours = true;
        }
        const id = grouped[`${dimension}Id`] || "__unknown__";
        if (!map.has(id)) map.set(id, { id, label: grouped[`${dimension}Label`] || "Unknown", rows: [] });
        map.get(id).rows.push(grouped);
      }
      return [...map.values()].map(group => ({ ...group, summary: summarize(group.rows) })).sort((a, b) => a.label.localeCompare(b.label));
    }

    const [anchorYear, anchorMonth] = month.split("-").map(Number);
    const trendMonths = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(anchorYear, anchorMonth - 12 + index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });

    function metric(id, baseRows, { payout = false, allPeriod = false, disabledReason = "" } = {}) {
      const filtered = disabledReason ? [] : entityFilter(baseRows, payout);
      const undatedRows = filtered.filter(row => !row.date);
      const scoped = filtered.filter(row => allPeriod || period === "all-time" || row.date?.slice(0, 7) === month || !row.date).map(row => {
        if (!allPeriod && period !== "all-time" && !row.date) return { ...cloneRow(row), usd: null, inr: null, hours: null, included: false };
        return row;
      });
      const summary = summarize(scoped);
      if (disabledReason) for (const value of Object.values(summary)) { value.value = null; value.complete = false; }
      const result = {
        id, label: metricLabels[id], dateBasis: bases[id], disabledReason, summary, rows: scoped,
        exceptions: scoped.filter(row => row.issues.length), undated: { summary: summarize(undatedRows), rows: undatedRows },
        monthly: trendMonths.map(key => {
          const bucket = filtered.filter(row => row.date?.slice(0, 7) === key);
          return { month: key, summary: summarize(bucket, undatedRows.length), rows: bucket };
        }),
        breakdowns: Object.fromEntries(["client", "contract", "employee", "expenseType"].map(dimension => [dimension, groups(scoped, dimension, payout)])),
      };
      return result;
    }

    metrics.receipts = metric("receipts", receipts.filter(row => row.status !== "Pending"), { disabledReason: selected.employeeId ? "Receipts have no saved employee allocation. Clear the employee filter to view receipts." : "" });
    metrics.hours = metric("hours", work);
    metrics.expenses = metric("expenses", expenses, { disabledReason: selected.employeeId || selected.clientId || selected.contractId ? "General expenses have no saved employee/client/contract allocation. Clear those filters to view expenses." : "" });
    metrics.payouts = metric("payouts", payoutRows.filter(row => row.status !== "Pending"), { payout: true });

    const pending = payoutRows.filter(row => row.status !== "Paid").map(original => {
      const row = cloneRow(original);
      row.metric = "pendingPayouts";
      row.dateBasis = bases.pendingPayouts;
      row.date = original.scheduledDate || "";
      if (!row.date) issue(row, "missing-scheduled-date", "No valid scheduled payout date is saved.");
      return row;
    });
    const incoming = [];
    const incomingDisabled = selected.employeeId ? "Pending incoming work has no reliable employee cash allocation. Clear the employee filter to view this estimate." : !Array.isArray(filters.incomingRows) ? "Incoming work estimates are unavailable; the existing local queue adapter was not supplied." : "";
    if (!incomingDisabled) {
      const keyCounts = new Map();
      for (const candidate of filters.incomingRows) if (validId(candidate?.key)) keyCounts.set(candidate.key, (keyCounts.get(candidate.key) || 0) + 1);
      filters.incomingRows.forEach((candidate, index) => {
        if (candidate?.received === true) return;
        const row = rowFor("incomingQueue", index, { ...candidate, id: candidate?.key, netUsd: candidate?.netUsd, netInr: candidate?.netInr, workWeekStart: candidate?.workWeekStart }, "incoming", "workWeekStart", { usd: "netUsd", inr: "netInr" });
        row.status = "Estimate — pending";
        row.sourceRefs = [];
        const relatedWork = work.filter(entry => entry.contractId === normalizeContract(candidate?.contractId) && entry.weekStart === candidate?.workWeekStart && entry.weekEnd === candidate?.workWeekEnd);
        const relatedReceipts = receipts.filter(entry => entry.contractId === normalizeContract(candidate?.contractId) && entry.weekStart === candidate?.workWeekStart && entry.weekEnd === candidate?.workWeekEnd);
        row.sourceRefs = [...relatedWork, ...relatedReceipts].map(item => item.source);
        if (!row.sourceRefs.length) row.sourceRefs = [row.source];
        const contract = entities.contracts.get(row.contractId);
        const hasValidWork = relatedWork.length && relatedWork.every(item => !item.quarantined && item.saved.hours > 0);
        const hasValidSavedPending = relatedReceipts.length === 1 && relatedReceipts[0].status === "Pending" && !relatedReceipts[0].quarantined && relatedReceipts[0].saved.usd !== null;
        if (!relatedWork.length && hasValidSavedPending) {
          row.usd = relatedReceipts[0].saved.usd;
          row.inr = relatedReceipts[0].saved.inr;
          row.saved = { usd: row.usd, inr: row.inr, hours: null };
        }
        if (candidate?.received !== false || keyCounts.get(candidate?.key) !== 1 || !validDate(candidate?.workWeekStart) || !validDate(candidate?.workWeekEnd) || candidate.workWeekEnd < candidate.workWeekStart || relatedReceipts.length > 1 || relatedReceipts.some(item => item.quarantined || item.status !== "Pending") || (!hasValidWork && !hasValidSavedPending)) quarantine(row, "ambiguous-incoming-estimate", "Pending estimate prerequisites are incomplete, duplicate, or ambiguous; no committed receipt was inferred.");
        if (hasValidWork && strictNumber(candidate.hours) !== round(relatedWork.reduce((sum, item) => sum + item.saved.hours, 0))) quarantine(row, "invalid-estimate-hours", "The queue hours do not equal the validated source hours; numeric-string concatenation or incomplete grouping cannot produce a trusted estimate.");
        if (hasValidWork && (!contract || contract.priceType !== "HOURLY" || strictNumber(contract.priceUsd) === null || strictNumber(contract.priceUsd) < 0)) quarantine(row, "unsupported-billing-estimate", "Work-based estimates require an explicit hourly contract and a valid current rate; fixed/unknown pricing is unresolved.");
        if (hasValidWork && row.inr !== null && !(strictNumber(candidate?.exchangeRate) > 0)) {
          row.inr = null;
          issue(row, "missing-estimate-fx", "The estimate has no valid positive historical/reference exchange rate.");
        }
        incoming.push(row);
      });
      const represented = new Set(incoming.flatMap(row => row.sourceRefs.map(ref => `${ref.collection}:${ref.index}`)));
      for (const receipt of receipts.filter(row => row.status !== "Received" && row.status !== "Received (legacy inferred)")) {
        if (represented.has(receipt.key)) continue;
        const row = cloneRow(receipt);
        row.metric = "incoming"; row.dateBasis = bases.incoming; row.date = validDate(receipt.weekStart) ? receipt.weekStart : "";
        quarantine(row, "unrepresented-pending-receipt", "A raw pending/unresolved payment was omitted by the queue projection; its commitment remains unresolved.");
        incoming.push(row); represented.add(receipt.key);
      }
      for (const entry of work) {
        const raw = rowsOf(data, "timeEntries")[entry.source.index];
        if (agencyId(raw?.contractId) || represented.has(entry.key)) continue;
        const related = receipts.filter(row => row.contractId === entry.contractId && row.weekStart === entry.weekStart && row.weekEnd === entry.weekEnd);
        if (related.length && related.every(row => row.status === "Received" || row.status === "Received (legacy inferred)")) continue;
        const row = cloneRow(entry);
        row.metric = "incoming"; row.dateBasis = bases.incoming;
        row.usd = row.inr = null;
        quarantine(row, "unrepresented-pending-work", "Raw work has no complete received counterpart or pending queue projection; no zero commitment was inferred.");
        incoming.push(row);
      }
    }
    const commitments = {
      incoming: metric("incoming", incoming, { allPeriod: true, disabledReason: incomingDisabled }),
      payouts: metric("pendingPayouts", pending, { payout: true, allPeriod: true }),
    };
    const options = Object.fromEntries(["clients", "contracts", "employees", "expenseTypes"].map(collection => [collection, [...entities[collection]].filter(([, item]) => item).map(([id, item]) => ({ id, label: label(collection, id, "Unknown"), clientId: item.clientId || "", archived: item.archived === true })).sort((a, b) => a.label.localeCompare(b.label))]));
    const runtimeDate = `${currentMonth}-${String(clock.getDate()).padStart(2, "0")}`;
    return { metrics, commitments, warnings, options, period, scope: period, month, currentMonth, runtimeDate, trendMonths, filters: { ...selected, period, month, currency: filters.currency === "INR" ? "INR" : "USD" }, clientAttribution: "Historical client grouping uses current contract associations; archived entities remain included." };
  }

  return { buildAnalytics, strictNumber };
});
