const blankData = {
  schemaVersion: 2,
  clients: [],
  sources: [],
  contracts: [],
  employees: [],
  employeeRates: [],
  timeEntries: [],
  incomingPayments: [],
  payouts: [],
  payoutPaymentStatus: {},
  weeklyFxRates: [],
  weeklyProgress: {},
  expenseTypes: [],
  expenses: [],
};

let data = structuredClone(blankData);
const calculations = window.PaymentTrackerCalculations;
const incomingPaymentUpdates = window.PaymentTrackerIncomingPayments;
const financialDisplay = window.PaymentTrackerFinancialDisplay;
const workValidation = window.PaymentTrackerWorkValidation;
const weeklyProgress = window.PaymentTrackerWeeklyProgress;
let analyticsController = null;
let analyticsDataReady = false;
const WORK_CONTEXT_STORAGE_KEY = "payment-tracker-work-context-v1";
let workContextRestored = false;
let weeklyHistoryAnchor = "";
let weeklyHistoryScope = "";
let weeklyProgressFeedback = "";
let weeklyProgressSaving = false;
let workSaving = false;
let rateSaving = false;
const selectedIncomingRows = new Set();
const activeServiceOverrides = new Set();
const incomingQueueView = window.PaymentTrackerQueue;
const incomingQueueState = { filters: { week: "", contractId: "", status: "", dateFrom: "", dateTo: "", search: "" }, sortKey: "default", sortDirection: "asc" };
const incomingQueueDrafts = new Map();
const incomingQueueRenderedValues = new Map();
const incomingQueueResetDraftKeys = new Set();
let incomingQueueRenderVersion = 0;
let incomingQueueRangeAnchor = "";
let incomingQueueShiftSelection = false;
let incomingQueueSkipCapture = false;
const INCOMING_BATCH_WEEK_ERROR = "A payment batch can contain entries from one work week only. Deselect entries until one work week remains.";

const moneyUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const moneyInr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

function id() {
  return crypto.randomUUID();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function toNumber(value, fallback = 0) {
  return calculations.toNumber(value, fallback);
}

function round(value) {
  return calculations.round(value);
}

function formatHours(value) {
  return number.format(value);
}

function weekKey(start, end) {
  return `${start}|${end}`;
}

function dateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDate(value) {
  return new Date(`${value}-01T00:00:00`);
}

function currentWeek() {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() + mondayOffset);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    weekStart: dateInput(monday),
    weekEnd: dateInput(sunday),
  };
}

function payoutSchedule(anchorDate = new Date()) {
  const anchorWeek = weekForDate(anchorDate);
  const payoutDate = new Date(anchorWeek.weekStartDate);
  payoutDate.setDate(anchorWeek.weekStartDate.getDate() + 3);

  const workWeekStart = new Date(anchorWeek.weekStartDate);
  workWeekStart.setDate(anchorWeek.weekStartDate.getDate() - 14);
  const workWeekEnd = new Date(workWeekStart);
  workWeekEnd.setDate(workWeekStart.getDate() + 6);

  return {
    payoutDate: dateInput(payoutDate),
    workWeekStart: dateInput(workWeekStart),
    workWeekEnd: dateInput(workWeekEnd),
    period: `${dateInput(workWeekStart)} to ${dateInput(workWeekEnd)}`,
  };
}

function formatPayoutSummary(form) {
  const values = formData(form);
  const payoutDate = values.payoutDate ? new Date(`${values.payoutDate}T00:00:00`) : new Date();
  const schedule = payoutSchedule(payoutDate);
  const employee = employeeName(values.employeeId);
  const payoutAmountUsd = toNumber(values.amountUsd);
  const payoutAmountInr = toNumber(values.amountInr);
  const exchangeRate = payoutAmountUsd ? round(payoutAmountInr / payoutAmountUsd) : 0;
  const entries = data.timeEntries
    .filter(
      (entry) =>
        entry.employeeId === values.employeeId &&
        entry.weekStart === schedule.workWeekStart &&
        entry.weekEnd === schedule.workWeekEnd,
    )
    .reduce((groups, entry) => {
      const group = groups.get(entry.contractId) ?? {
        contractId: entry.contractId,
        hours: 0,
        totalUsd: 0,
        rateUsd: entry.rateUsd,
      };
      group.hours += entry.hours;
      group.totalUsd += entry.totalUsd;
      group.rateUsd = entry.rateUsd;
      groups.set(entry.contractId, group);
      return groups;
    }, new Map());

  const lines = [
    `Payment summary for ${employee}`,
    `Work week: ${schedule.workWeekStart} to ${schedule.workWeekEnd}`,
    `Payout date: ${values.payoutDate || "-"}`,
    `Exchange rate applied: ${exchangeRate ? `${moneyInr.format(exchangeRate)} per USD` : "-"}`,
    "",
  ];

  if (entries.size) {
    lines.push("Contracts worked on:");
    Array.from(entries.values()).forEach((entry) => {
      lines.push(
        `- ${contractName(entry.contractId)}: ${formatHours(entry.hours)} hrs @ ${moneyUsd.format(entry.rateUsd)}/hr = ${moneyUsd.format(entry.totalUsd)}`,
      );
    });
    const totalHours = Array.from(entries.values()).reduce((sum, entry) => sum + entry.hours, 0);
    const totalUsd = Array.from(entries.values()).reduce((sum, entry) => sum + entry.totalUsd, 0);
    lines.push("");
    lines.push(`Total hours: ${formatHours(totalHours)}`);
    lines.push(`Total payout: ${moneyUsd.format(payoutAmountUsd)} | ${moneyInr.format(payoutAmountInr)}`);
    lines.push(`Calculated work total: ${moneyUsd.format(totalUsd)}`);
  } else {
    lines.push("Contracts worked on: No time entries found for this payout week.");
    lines.push(`Total payout: ${moneyUsd.format(payoutAmountUsd)} | ${moneyInr.format(payoutAmountInr)}`);
  }

  return lines.join("\n");
}

function updatePayoutNote() {
  const form = document.querySelector("#payout-form");
  const note = document.querySelector("#payout-note");
  if (!form || !note) return;
  note.value = formatPayoutSummary(form);
}

function setIncomingWhtDefault() {
  const form = document.querySelector("#payment-form");
  if (!form) return;
  syncIncomingDraft();
}

function clearTimeValidation() {
  const form = document.querySelector("#time-form");
  ["hours", "weekStart", "weekEnd"].forEach((name) => {
    const field = form?.elements[name];
    field?.setCustomValidity("");
    field?.removeAttribute("aria-invalid");
  });
  document.querySelector("#time-validation-message")?.replaceChildren();
}

function showTimeValidation(validation) {
  clearTimeValidation();
  const form = document.querySelector("#time-form");
  const message = document.querySelector("#time-validation-message");
  validation.errors.forEach(({ field, message: text }) => {
    form?.elements[field]?.setCustomValidity(text);
    form?.elements[field]?.setAttribute("aria-invalid", "true");
  });
  if (message) {
    if (validation.errors.length) message.textContent = validation.errors.map((error) => error.message).join(" ");
    if (validation.overlaps.length) {
      message.textContent = "Work already exists for this employee and contract in the selected period. Edit an existing entry instead of adding overlapping work.";
      validation.overlaps.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.textContent = `Edit ${entry.weekStart} to ${entry.weekEnd}`;
        button.addEventListener("click", () => {
          clearTimeValidation();
          editItem("timeEntries", entry.id);
        });
        message.append(button);
      });
    }
  }
  const firstField = validation.errors[0]?.field || "weekStart";
  form?.elements[firstField]?.focus();
}

function duplicateTimeEntry(values, editId = "") {
  return data.timeEntries.find(
    (entry) =>
      entry.id !== editId &&
      entry.employeeId === values.employeeId &&
      entry.contractId === (values.contractId === "__agency__" ? "" : values.contractId) &&
      entry.weekStart === values.weekStart &&
      entry.weekEnd === values.weekEnd,
  );
}

function duplicateIncomingPayment(values, editId = "") {
  const contractId = values.contractId === "__agency__" ? "" : values.contractId;
  return data.incomingPayments.find(
    (payment) =>
      payment.id !== editId &&
      payment.contractId === contractId &&
      payment.paymentDate === values.paymentDate &&
      payment.workWeekStart === values.workWeekStart &&
      payment.workWeekEnd === values.workWeekEnd,
  );
}

function activateTab(tab) {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabTarget === tab);
  });
  document.querySelectorAll("[data-tab]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tab === tab);
  });
  persistWorkContext(tab);
  if (tab === "weekly-work") renderWeeklyProgress();
  if (tab === "analytics") renderAnalytics();
}

function activateSetupFormTab(tab) {
  document.querySelectorAll("[data-formtab-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.formtabTarget === tab);
  });
  document.querySelectorAll("[data-formtab]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.formtab === tab);
  });
}

function closeSetupForms() {
  document.querySelectorAll("[data-formtab-target]").forEach((button) => {
    button.classList.remove("active");
  });
  document.querySelectorAll("[data-formtab]").forEach((panel) => {
    panel.classList.remove("active");
  });
  const menu = document.querySelector("#setup-add-new-menu");
  const addNew = document.querySelector("#setup-add-new");
  if (menu) menu.classList.add("hidden");
  if (addNew) addNew.setAttribute("aria-expanded", "false");
}

function updateDataPathLabel(value) {
  const label = document.querySelector("#setup-data-path-value");
  const button = document.querySelector("#setup-data-path");
  const text = value || "Using default app data folder";
  if (label) label.textContent = text;
  if (button) button.title = text;
}

function editItem(collectionName, itemId) {
  if (collectionName === "employees") {
    const item = byId(data.employees, itemId);
    if (!item) return;
    const form = document.querySelector("#employee-form");
    form.elements.name.value = item.name || "";
    form.elements.email.value = item.email || "";
    form.elements.phone.value = item.phone || "";
    form.elements.bankAccount.value = item.bankAccount || "";
    form.elements.ifsc.value = item.ifsc || "";
    form.elements.bankName.value = item.bankName || "";
    form.elements.notes.value = item.notes || "";
    form.elements.editId.value = item.id;
    activateTab("setup");
    activateSetupFormTab("setup-employee-form");
    return;
  }

  if (collectionName === "timeEntries") {
    const item = byId(data.timeEntries, itemId);
    if (!item) return;
    clearTimeValidation();
    const form = document.querySelector("#time-form");
    form.elements.editId.value = item.id;
    form.elements.employeeId.dataset.editValue = item.employeeId;
    form.elements.contractId.dataset.editValue = item.contractId || "__agency__";
    form.elements.employeeId.value = item.employeeId;
    fillSelects();
    form.elements.contractId.value = item.contractId || "__agency__";
    form.elements.weekStart.value = item.weekStart;
    form.elements.weekEnd.value = item.weekEnd;
    form.elements.hours.value = item.hours;
    form.elements.notes.value = item.notes || "";
    form.elements.editId.value = item.id;
    weeklyHistoryAnchor = item.weekStart;
    activateTab("weekly-work");
    return;
  }

  if (collectionName === "incomingPayments") {
    const item = byId(data.incomingPayments, itemId);
    if (!item) return;
    activateTab("incoming");
    const key = incomingRowKey(item.contractId || "", item.workWeekStart || "", item.workWeekEnd || "");
    window.requestAnimationFrame(() => {
      const row = document.querySelector(`[data-incoming-key="${key}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.classList.add("row-focus");
      window.setTimeout(() => row?.classList.remove("row-focus"), 1600);
    });
    return;
  }

  if (collectionName === "contracts") {
    const item = byId(data.contracts, itemId);
    if (!item) return;
    const form = document.querySelector("#contract-form");
    form.elements.editId.value = item.id;
    form.elements.sourceId.dataset.editValue = item.sourceId || "";
    form.elements.clientId.dataset.editValue = item.clientId || "";
    form.elements.name.value = item.name || "";
    form.elements.shortName.value = item.shortName || "";
    form.elements.sourceId.value = item.sourceId || "";
    fillSelects();
    form.elements.clientId.value = item.clientId || "";
    form.elements.priceType.value = item.priceType || "FIXED";
    form.elements.priceUsd.value = item.priceUsd ?? "";
    form.elements.serviceChargeMode.value = item.serviceChargeMode || "NONE";
    form.elements.serviceChargePercent.value = item.serviceChargePercent ?? "";
    form.elements.gstMode.value = item.gstMode || "NONE";
    form.elements.gstPercent.value = item.gstPercent ?? "";
    form.elements.notes.value = item.notes || "";
    form.elements.editId.value = item.id;
    activateTab("setup");
    activateSetupFormTab("setup-contract-form");
    return;
  }

  if (collectionName === "payouts") {
    const item = byId(data.payouts, itemId);
    if (!item) return;
    const form = document.querySelector("#payout-form");
    form.elements.employeeId.value = item.employeeId;
    form.elements.contractId.value = item.contractId || "__agency__";
    form.elements.period.value = item.period;
    form.elements.payoutDate.value = item.payoutDate;
    form.elements.amountUsd.value = item.amountUsd;
    form.elements.amountInr.value = item.amountInr;
    form.elements.notes.value = item.notes || "";
    form.elements.editId.value = item.id;
    updatePayoutNote();
    activateTab("payouts");
    return;
  }

  if (collectionName === "expenses") {
    const item = byId(data.expenses, itemId);
    if (!item) return;
    const form = document.querySelector("#expense-form");
    form.elements.editId.value = item.id;
    form.elements.expenseTypeId.dataset.editValue = item.expenseTypeId;
    fillSelects();
    form.elements.expenseTypeId.value = item.expenseTypeId;
    form.elements.expenseDate.value = item.expenseDate;
    form.elements.label.value = item.label || "";
    form.elements.amountUsd.value = item.amountUsd;
    form.elements.exchangeRate.value = item.exchangeRate;
    form.elements.gstMode.value = item.gstMode;
    form.elements.gstPercent.value = item.gstPercent;
    form.elements.notes.value = item.notes || "";
    form.elements.editId.value = item.id;
    activateTab("expenses");
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
}

function weekForDate(anchorDate) {
  return calculations.weekBounds(anchorDate);
}

function currentMonth() {
  return monthInput(new Date());
}

function overviewMonthValue() {
  return document.querySelector("#overview-month")?.value || currentMonth();
}

function setOverviewMonth(value = currentMonth()) {
  const input = document.querySelector("#overview-month");
  if (!input) return;
  input.value = value;
}

function shiftOverviewMonth(months) {
  const input = document.querySelector("#overview-month");
  if (!input) return;
  const date = monthDate(input.value || currentMonth());
  date.setMonth(date.getMonth() + months);
  input.value = monthInput(date);
  activateOverviewPeriod("month");
  renderStats();
}

function overviewPeriodType() {
  return document.querySelector("[data-overview-period].active")?.dataset.overviewPeriod || "month";
}

function overviewPeriodRange(periodType, anchorDate = new Date()) {
  const anchor = new Date(anchorDate);
  anchor.setHours(0, 0, 0, 0);

  if (periodType === "all-time") return null;

  if (periodType === "financial-year") {
    const year = anchor.getMonth() >= 3 ? anchor.getFullYear() : anchor.getFullYear() - 1;
    const start = new Date(year, 3, 1);
    const end = new Date(year + 1, 2, 31);
    return { start, end };
  }

  if (periodType === "calendar-year") {
    const year = anchor.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    return { start, end };
  }

  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start, end };
}

function inDateRange(dateValue, range) {
  return calculations.isDateInRange(dateValue, range);
}

function overviewPeriodLabel(periodType, range) {
  if (periodType === "all-time" || !range) return "All Time";
  if (periodType === "financial-year") {
    const startYear = range.start.getFullYear();
    const endYear = range.end.getFullYear();
    return `FY ${startYear}-${String(endYear).slice(-2)}`;
  }
  if (periodType === "calendar-year") return String(range.start.getFullYear());
  return monthLabel.format(range.start);
}

function activateOverviewPeriod(periodType) {
  document.querySelectorAll("[data-overview-period]").forEach((button) => {
    button.classList.toggle("active", button.dataset.overviewPeriod === periodType);
  });
}

function payoutDateForWeekStart(weekStart) {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + 17);
  return dateInput(date);
}

function parseWeekKey(value) {
  const [start = "", end = ""] = String(value || "").split("|");
  return { start, end };
}

function currentRecordFilters() {
  return {
    employeeId: document.querySelector("#record-filter-employee")?.value || "",
    month: document.querySelector("#record-filter-month")?.value || "",
    week: document.querySelector("#record-filter-week")?.value || "",
  };
}

function currentRecordTab() {
  return document.querySelector("[data-recordtab-target].active")?.dataset.recordtabTarget || "records-time";
}

function matchesSelectedWeek(start, end, selectedWeek) {
  if (!selectedWeek) return true;
  return weekKey(start, end) === selectedWeek;
}

function shiftDate(value, days) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return dateInput(date);
}

function upworkReceivedDate(workWeekStart) {
  const date = new Date(`${workWeekStart}T00:00:00`);
  date.setDate(date.getDate() + 16);
  return dateInput(date);
}

function byId(collection, idValue) {
  return collection.find((item) => item.id === idValue);
}

function contractName(contractId) {
  if (!contractId || contractId === "__agency__") return "Agency Payroll";
  const contract = byId(data.contracts, contractId);
  if (!contract) return "Unknown contract";
  const client = byId(data.clients, contract.clientId);
  const source = byId(data.sources, contract.sourceId);
  return contract.shortName?.trim() || `${source?.name ?? "Unknown source"} / ${client?.name ?? "Unknown client"} - ${contract.name}`;
}

function employeeName(employeeId) {
  return byId(data.employees, employeeId)?.name ?? "Unknown employee";
}

function sourceForContract(contractId) {
  const contract = byId(data.contracts, contractId);
  return contract ? byId(data.sources, contract.sourceId) : null;
}

function isUpworkContract(contractId) {
  const source = sourceForContract(contractId);
  return source?.name.trim().toLowerCase().includes("upwork") ?? false;
}

function sharedUpworkFxRate(sourceData, contractId, weekStart) {
  const source = sourceForContract(contractId);
  if (!source || !isUpworkContract(contractId) || !weekStart) return null;
  const rate = (sourceData.weeklyFxRates || []).find(
    (item) => item.sourceId === source.id && item.weekStart === weekStart,
  );
  const exchangeRate = toNumber(rate?.exchangeRate, 0);
  return exchangeRate > 0 ? exchangeRate : null;
}

function saveSharedUpworkFxRate(contractId, weekStart, exchangeRate) {
  const source = sourceForContract(contractId);
  if (!source || !isUpworkContract(contractId) || !weekStart || !exchangeRate) return;
  const nextRate = { sourceId: source.id, weekStart, exchangeRate };
  const index = (data.weeklyFxRates || []).findIndex(
    (item) => item.sourceId === source.id && item.weekStart === weekStart,
  );
  data.weeklyFxRates = [...(data.weeklyFxRates || [])];
  if (index >= 0) data.weeklyFxRates[index] = nextRate;
  else data.weeklyFxRates.push(nextRate);
}

function defaultWhtPercentForContract(contractId) {
  const source = sourceForContract(contractId);
  if (!source) return 0;
  return source.name.trim().toLowerCase().includes("upwork") ? 0.1 : 0;
}

function whtFor(contractId, grossUsd, explicitPercent) {
  if (explicitPercent !== "" && explicitPercent !== undefined) {
    const percent = toNumber(explicitPercent);
    return calculations.calculateWht(grossUsd, percent);
  }
  const percent = defaultWhtPercentForContract(contractId);
  return calculations.calculateWht(grossUsd, percent);
}

function contractById(contractId) {
  return byId(data.contracts, contractId);
}

function employeeRate(employeeId, contractId) {
  if (!contractId || contractId === "__agency__") {
    return data.employeeRates.find((rate) => rate.employeeId === employeeId && !rate.contractId);
  }
  return (
    data.employeeRates.find((rate) => rate.employeeId === employeeId && rate.contractId === contractId) ??
    data.employeeRates.find((rate) => rate.employeeId === employeeId && !rate.contractId)
  );
}

function isActiveSetupItem(collection, itemOrId) {
  const item = typeof itemOrId === "object" ? itemOrId : byId(data[collection] || [], itemOrId);
  if (!item || item.archived === true) return false;
  if (collection === "clients") return !item.sourceId || isActiveSetupItem("sources", item.sourceId);
  if (collection === "contracts") return isActiveSetupItem("sources", item.sourceId) && isActiveSetupItem("clients", item.clientId);
  if (collection === "employeeRates") return isActiveSetupItem("employees", item.employeeId) && (!item.contractId || isActiveSetupItem("contracts", item.contractId));
  return true;
}

function activeEmployeeRate(employeeId, selectedContractId) {
  const contractId = selectedContractId === "__agency__" ? "" : selectedContractId || "";
  if (!isActiveSetupItem("employees", employeeId) || (contractId && !isActiveSetupItem("contracts", contractId))) return null;
  const available = data.employeeRates.filter((rate) => rate.employeeId === employeeId && isActiveSetupItem("employeeRates", rate));
  return available.find((rate) => (rate.contractId || "") === contractId) || (contractId ? available.find((rate) => !rate.contractId) : null) || null;
}

function paidPayoutsAffectedByWorkChange(previous, next, sourceData = data) {
  const payouts = new Map((sourceData.payouts || []).map((payout) => [payout.id, payout]));
  Object.entries(sourceData.payoutPaymentStatus || {}).forEach(([id, status]) => {
    if (status?.paid === true && !payouts.has(id)) payouts.set(id, { id, paid: true });
  });
  return [...payouts.values()].filter((payout) => {
    if (payout.paid !== true && sourceData.payoutPaymentStatus?.[payout.id]?.paid !== true) return false;
    const [keyEmployee, keyStart, keyEnd] = String(payout.id || "").split("|");
    const employeeId = payout.employeeId || keyEmployee;
    const weekStart = payout.weekStart || keyStart;
    const weekEnd = payout.weekEnd || keyEnd;
    if (!workValidation.isCalendarDate(weekStart) || !workValidation.isCalendarDate(weekEnd)) return false;
    return [previous, next].some((entry) => entry?.employeeId === employeeId &&
      workValidation.isCalendarDate(entry.weekStart) && workValidation.isCalendarDate(entry.weekEnd) &&
      entry.weekStart <= weekEnd && entry.weekEnd >= weekStart);
  });
}

function passThroughRateForContract(contractId) {
  const contract = contractById(contractId);
  if (!contract) return 0;
  const grossUsd = toNumber(contract.priceUsd);
  const serviceChargeUsd = serviceChargeFor(contractId, grossUsd, "");
  const serviceChargeGstUsd = gstPayableUsd(serviceChargeUsd, "RCM", 18);
  const whtPercent = defaultWhtPercentForContract(contractId);
  const whtUsd = whtFor(contractId, grossUsd, whtPercent);
  return round(grossUsd - serviceChargeUsd - serviceChargeGstUsd - whtUsd);
}

function effectiveRateForEntry(entry, rateOverride) {
  const rate = rateOverride || (entry.noAgencyCut ? { noAgencyCut: true } : employeeRate(entry.employeeId, entry.contractId));
  if (rate?.noAgencyCut) {
    const passThroughRate = passThroughRateForContract(entry.contractId);
    return passThroughRate || rate.rateUsd || entry.rateUsd;
  }
  return rate?.rateUsd ?? entry.rateUsd;
}

function timeEntryNetTotal(entry) {
  const contract = contractById(entry.contractId);
  if (!contract) return entry.totalUsd ?? round(entry.hours * (effectiveRateForEntry(entry) || entry.rateUsd || 0));
  const grossUsd = round(entry.hours * toNumber(contract.priceUsd, entry.rateUsd || 0));
  const serviceFeeUsd = serviceChargeFor(entry.contractId, grossUsd, "");
  const whtPercent = defaultWhtPercentForContract(entry.contractId);
  const whtUsd = whtFor(entry.contractId, grossUsd, whtPercent);
  return round(grossUsd - serviceFeeUsd - whtUsd);
}

function timeEntryGrossTotal(entry) {
  const contract = contractById(entry.contractId);
  if (!contract) return round(entry.hours * (effectiveRateForEntry(entry) || entry.rateUsd || 0));
  return round(entry.hours * toNumber(contract.priceUsd, entry.rateUsd || 0));
}

function incomingNetTotal(grossUsd, serviceChargeUsd, whtUsd) {
  return calculations.calculateIncomingNet(grossUsd, serviceChargeUsd, whtUsd);
}

function syncTimePreview() {
  const form = document.querySelector("#time-form");
  const preview = document.querySelector("#time-preview");
  if (!form || !preview) return;

  const employeeId = form.elements.employeeId.value;
  const contractId = form.elements.contractId.value;
  const hours = toNumber(form.elements.hours.value, 0);
  const rate = employeeRate(employeeId, contractId);
  const contract = contractById(contractId);

  if (!employeeId || !contractId || !hours || !rate) {
    preview.innerHTML = "";
    preview.classList.add("hidden");
    return;
  }

  const billedRateUsd = contract ? toNumber(contract.priceUsd, rate.rateUsd) : rate.rateUsd;
  const billedAmount = round(hours * billedRateUsd);
  const serviceFee = serviceChargeFor(contractId, billedAmount, "");
  const whtPercent = defaultWhtPercentForContract(contractId);
  const whtAmount = whtFor(contractId, billedAmount, whtPercent);
  const netAmount = round(billedAmount - serviceFee - whtAmount);

  preview.innerHTML = `
    <article><span>Billed Amount</span><strong>${moneyUsd.format(billedAmount)}</strong><small>${formatHours(hours)} hrs</small></article>
    <article><span>Service Fee Deduction</span><strong>${moneyUsd.format(serviceFee)}</strong><small>${serviceFee ? "From contract settings" : "No fixed fee set"}</small></article>
    <article><span>WHT Deduction</span><strong>${moneyUsd.format(whtAmount)}</strong><small>${whtPercent ? `${number.format(whtPercent)}% on billed amount` : "No WHT"}</small></article>
    <article><span>Net After Deductions</span><strong>${moneyUsd.format(netAmount)}</strong><small>Before incoming exchange rate</small></article>
  `;
  preview.classList.remove("hidden");
}

function employeeContractOptions(employeeId) {
  if (!isActiveSetupItem("employees", employeeId)) return [];
  const linkedContractIds = data.employeeRates
    .filter((rate) => rate.employeeId === employeeId && rate.contractId && isActiveSetupItem("employeeRates", rate))
    .map((rate) => rate.contractId);
  const linkedContracts = data.contracts.filter((contract) => linkedContractIds.includes(contract.id) && isActiveSetupItem("contracts", contract));
  const options = linkedContracts.map((contract) => [contract.id, contractName(contract.id)]);
  if (activeEmployeeRate(employeeId, "")) options.push(["__agency__", "Agency Payroll"]);
  return options;
}

function currentWorkContext() {
  const form = document.querySelector("#time-form");
  return form ? {
    employeeId: form.elements.employeeId.value,
    contractId: form.elements.contractId.value,
    weekStart: form.elements.weekStart.value,
    weekEnd: form.elements.weekEnd.value,
  } : null;
}

function persistWorkContext(tab) {
  if (!workContextRestored) return;
  const context = currentWorkContext();
  if (!context) return;
  const activeTab = tab || document.querySelector("[data-tab-target].active")?.dataset.tabTarget || "overview";
  try {
    window.localStorage.setItem(WORK_CONTEXT_STORAGE_KEY, JSON.stringify({ tab: activeTab, ...context }));
  } catch (_error) {
    // Context restoration is optional; storage restrictions must not block work.
  }
}

function restoreWorkContext() {
  if (workContextRestored) return;
  workContextRestored = true;
  const form = document.querySelector("#time-form");
  let stored;
  try { stored = JSON.parse(window.localStorage.getItem(WORK_CONTEXT_STORAGE_KEY) || "null"); } catch (_error) { return; }
  if (!stored || !form) return;
  const employeeId = isActiveSetupItem("employees", stored.employeeId) ? stored.employeeId : "";
  form.elements.employeeId.value = employeeId;
  fillSelects();
  const options = employeeContractOptions(employeeId);
  form.elements.contractId.value = options.some(([value]) => value === stored.contractId) ? stored.contractId : "";
  if (workValidation.isCalendarDate(stored.weekStart) && workValidation.isCalendarDate(stored.weekEnd) && stored.weekStart <= stored.weekEnd) {
    form.elements.weekStart.value = stored.weekStart;
    form.elements.weekEnd.value = stored.weekEnd;
  }
  weeklyHistoryAnchor = form.elements.weekStart.value;
  if (["overview", "analytics", "weekly-work", "incoming", "payouts", "expenses", "records", "setup"].includes(stored.tab)) activateTab(stored.tab);
}

function resetWeeklyProgressContext() {
  workContextRestored = true;
  weeklyHistoryAnchor = "";
  weeklyHistoryScope = "";
  weeklyProgressFeedback = "";
  try { window.localStorage.removeItem(WORK_CONTEXT_STORAGE_KEY); } catch (_error) {}
  const form = document.querySelector("#time-form");
  if (form) {
    ["employeeId", "contractId", "hours", "notes", "editId"].forEach((field) => { form.elements[field].value = ""; });
    const week = currentWeek();
    form.elements.weekStart.value = week.weekStart;
    form.elements.weekEnd.value = week.weekEnd;
  }
  clearTimeValidation();
}

function updateWorkContext() {
  weeklyHistoryAnchor = document.querySelector("#time-form")?.elements.weekStart.value || "";
  weeklyProgressFeedback = "";
  persistWorkContext();
  renderWeeklyProgress();
}

function hasUnsavedWorkDraft() {
  const form = document.querySelector("#time-form");
  if (!form) return false;
  const values = formData(form);
  const original = values.editId ? byId(data.timeEntries, values.editId) : null;
  if (original) return !workValidation.isUnchangedFinancialEdit(values, original) || values.notes.trim() !== (original.notes || "");
  return Boolean(values.hours || values.notes.trim());
}

function invalidateWeeklyProgressForWorkChange(previous, next) {
  data.weeklyProgress = weeklyProgress.invalidateForWorkChange(data, previous, next);
}

function openProgressWeek(weekStart) {
  if (hasUnsavedWorkDraft() && !confirm("Discard unsaved hours and notes to open this week?")) return;
  const form = document.querySelector("#time-form");
  const week = weeklyProgress.weekForDate(weekStart);
  form.elements.weekStart.value = week.weekStart;
  form.elements.weekEnd.value = week.weekEnd;
  ["hours", "notes", "editId"].forEach((field) => { form.elements[field].value = ""; });
  clearTimeValidation();
  syncTimePreview();
  updateWorkContext();
  form.elements.hours.focus();
}

async function handleWeeklyProgressAction(event) {
  const button = event.target.closest("button[data-progress-action]");
  if (!button || weeklyProgressSaving) return;
  const action = button.dataset.progressAction;
  const context = currentWorkContext();
  if (!context?.employeeId || !context.contractId) return;
  const bounds = weeklyProgress.recordedBounds(data, context.employeeId, context.contractId);
  if (action === "earlier" || action === "later") {
    weeklyHistoryAnchor = weeklyProgress.shiftDate(weeklyHistoryAnchor || context.weekStart, action === "earlier" ? -84 : 84);
    renderWeeklyProgress();
    return;
  }
  if (["open", "selected", "latest", "first"].includes(action)) {
    const date = action === "latest" ? bounds.latest : action === "first" ? bounds.first : action === "open" ? button.dataset.progressStart : context.weekStart;
    if (date) openProgressWeek(date);
    return;
  }
  if (action === "edit") {
    if (hasUnsavedWorkDraft() && !confirm("Discard unsaved hours and notes to edit this entry?")) return;
    editItem("timeEntries", button.dataset.progressEntry);
    return;
  }
  if (!["complete", "no-work", "clear"].includes(action)) return;
  if (hasUnsavedWorkDraft()) {
    weeklyProgressFeedback = "Save or clear unsaved hours and notes before changing week progress.";
    renderWeeklyProgress();
    return;
  }
  const previous = data.weeklyProgress;
  try {
    const scope = weeklyProgress.scopeForDate(context.employeeId, context.contractId, context.weekStart);
    if (action === "no-work" && !activeEmployeeRate(context.employeeId, context.contractId)) throw new Error("Choose an active employee, contract and assigned rate before marking a new No work week.");
    data.weeklyProgress = weeklyProgress.markWeek(data, scope, action);
    weeklyProgressSaving = true;
    weeklyProgressFeedback = action === "clear" ? "Explicit progress cleared. Existing work was kept." : action === "complete" ? "Week explicitly marked complete." : "No work confirmed for this week. No financial record was created.";
    await save();
  } catch (error) {
    data.weeklyProgress = previous;
    weeklyProgressFeedback = error.message || "Week progress could not be saved.";
  } finally {
    weeklyProgressSaving = false;
    renderWeeklyProgress();
  }
}

function renderWeeklyProgress() {
  const host = document.querySelector('[data-tab="weekly-work"]');
  if (!host || !weeklyProgress) return;
  let panel = document.querySelector("#weekly-progress");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "weekly-progress";
    panel.className = "panel weekly-progress";
    panel.addEventListener("click", handleWeeklyProgressAction);
    host.append(panel);
  }
  const context = currentWorkContext();
  const title = '<h2>Week progress</h2><p>Recorded work is not automatically complete. Earlier gaps stay visible until you review them.</p>';
  if (!context?.employeeId || !context.contractId || !workValidation.isCalendarDate(context.weekStart)) {
    panel.innerHTML = `${title}<p class="empty">Choose an employee, contract and work date to review recorded, complete and No work weeks.</p>`;
    return;
  }
  const scopeId = `${context.employeeId}|${context.contractId}`;
  if (scopeId !== weeklyHistoryScope) { weeklyHistoryScope = scopeId; weeklyHistoryAnchor = context.weekStart; }
  const scope = weeklyProgress.scopeForDate(context.employeeId, context.contractId, context.weekStart);
  const selected = weeklyProgress.stateForWeek(data, scope);
  const bounds = weeklyProgress.recordedBounds(data, context.employeeId, context.contractId);
  const history = weeklyProgress.history(data, { ...scope, weekStart: weeklyHistoryAnchor || scope.weekStart });
  const disabled = (condition) => condition || weeklyProgressSaving ? "disabled" : "";
  const marker = data.weeklyProgress?.[weeklyProgress.key(scope)];
  const edits = selected.entries.map((entry) => `<button type="button" class="secondary-button" data-progress-action="edit" data-progress-entry="${escapeUiText(entry.id)}">Edit ${escapeUiText(entry.weekStart)} to ${escapeUiText(entry.weekEnd)} · ${formatHours(entry.hours)} hrs</button>`).join("");
  panel.innerHTML = `${title}
    <div class="weekly-progress-summary"><strong>${escapeUiText(employeeName(context.employeeId))} · ${escapeUiText(contractName(context.contractId))}</strong><span>${scope.weekStart} to ${scope.weekEnd}</span><span class="pill ${selected.status === "complete" || selected.status === "no-work" ? "" : "warn"}">${selected.label}</span><span>${selected.entryCount} recorded ${selected.entryCount === 1 ? "entry" : "entries"} · ${formatHours(selected.hours)} hours</span><p>${bounds.latest ? `Latest recorded week begins ${escapeUiText(bounds.latest)}. This does not confirm earlier weeks.` : "No work entries recorded for this employee and contract."}</p></div>
    <div class="weekly-progress-actions">${edits}<button type="button" data-progress-action="complete" ${disabled(!selected.entryCount)}>Mark week complete</button><button type="button" class="secondary-button" data-progress-action="no-work" ${disabled(Boolean(selected.entryCount) || !activeEmployeeRate(context.employeeId, context.contractId))}>Confirm No work</button><button type="button" class="secondary-button" data-progress-action="clear" ${disabled(!marker)}>Clear explicit status</button></div>
    <p id="weekly-progress-status" class="inline-message" aria-live="polite">${escapeUiText(weeklyProgressFeedback)}</p>
    <div class="weekly-progress-toolbar"><button type="button" class="secondary-button" data-progress-action="earlier">Earlier 12 weeks</button><button type="button" class="secondary-button" data-progress-action="later">Later 12 weeks</button><button type="button" class="secondary-button" data-progress-action="selected">Selected week</button><button type="button" class="secondary-button" data-progress-action="latest" ${disabled(!bounds.latest)}>Open latest recorded</button><button type="button" class="secondary-button" data-progress-action="first" ${disabled(!bounds.first)}>Open first recorded</button></div>
    <p>Showing ${history[history.length - 1].weekStart} to ${history[0].weekEnd}. No entry means unrecorded; it does not mean No work.</p>
    <div class="table-wrap weekly-progress-history"><table><thead><tr><th>Work week</th><th>Progress</th><th>Recorded</th><th>Action</th></tr></thead><tbody>${history.map((week) => `<tr><td>${week.weekStart} to ${week.weekEnd}</td><td>${week.label}</td><td>${week.entryCount} ${week.entryCount === 1 ? "entry" : "entries"} · ${formatHours(week.hours)} hrs</td><td><button type="button" class="secondary-button" data-progress-action="open" data-progress-start="${week.weekStart}">Open week</button></td></tr>`).join("")}</tbody></table></div>`;
}

function recordWeeks() {
  const weeks = new Map();
  const add = (start, end) => {
    if (!start || !end) return;
    weeks.set(weekKey(start, end), { start, end });
  };

  data.timeEntries.forEach((entry) => add(entry.weekStart, entry.weekEnd));
  data.incomingPayments.forEach((payment) => add(payment.workWeekStart, payment.workWeekEnd));
  data.payouts.forEach((payout) => {
    const schedule = payoutSchedule(payout.payoutDate || new Date());
    add(schedule.workWeekStart, schedule.workWeekEnd);
  });

  return [...weeks.values()].sort((a, b) => `${b.start}${b.end}`.localeCompare(`${a.start}${a.end}`));
}

function filteredRecordWeeks(filters, tab) {
  const weeks = new Map();
  const add = (start, end) => {
    if (!start || !end) return;
    weeks.set(weekKey(start, end), { start, end });
  };

  if (tab === "records-payouts") {
    data.payouts.forEach((payout) => {
      if (filters.employeeId && payout.employeeId !== filters.employeeId) return;
      if (filters.month && payout.payoutDate?.slice(0, 7) !== filters.month) return;
      add(payout.weekStart, payout.weekEnd);
    });
    return [...weeks.values()].sort((a, b) => `${b.start}${b.end}`.localeCompare(`${a.start}${a.end}`));
  }

  data.timeEntries.forEach((entry) => {
    if (filters.employeeId && entry.employeeId !== filters.employeeId) return;
    if (filters.month && entry.weekStart?.slice(0, 7) !== filters.month) return;
    add(entry.weekStart, entry.weekEnd);
  });

  return [...weeks.values()].sort((a, b) => `${b.start}${b.end}`.localeCompare(`${a.start}${a.end}`));
}

function fillRecordFilters() {
  const employeeSelect = document.querySelector("#record-filter-employee");
  const weekSelect = document.querySelector("#record-filter-week");
  const filters = currentRecordFilters();
  const tab = currentRecordTab();

  if (employeeSelect) {
    const selectedEmployee = employeeSelect.value;
    employeeSelect.innerHTML = `<option value="">All employees</option>${data.employees
      .map((employee) => `<option value="${employee.id}">${employee.name}</option>`)
      .join("")}`;
    if (data.employees.some((employee) => employee.id === selectedEmployee)) {
      employeeSelect.value = selectedEmployee;
    }
  }

  if (weekSelect) {
    const selectedWeek = weekSelect.value;
    const options = filteredRecordWeeks(filters, tab)
      .map(({ start, end }) => `<option value="${weekKey(start, end)}">${start} to ${end}</option>`)
      .join("");
    weekSelect.innerHTML = `<option value="">All weeks</option>${options}`;
    if (selectedWeek && [...weekSelect.options].some((option) => option.value === selectedWeek)) {
      weekSelect.value = selectedWeek;
    } else if (selectedWeek) {
      weekSelect.value = "";
    }
  }
}

function syncRecordFilterVisibility(tab) {
  const filters = document.querySelector(".records-filters");
  const toolbar = document.querySelector(".records-toolbar");
  if (toolbar) toolbar.dataset.activeRecordtab = tab;
  const showFilters = ["records-time", "records-payouts"].includes(tab);
  if (filters) filters.classList.toggle("hidden", !showFilters);
}

function serviceChargeFor(contractId, grossUsd, manualCharge) {
  const contract = contractById(contractId);
  if (manualCharge !== "" && manualCharge !== undefined) return toNumber(manualCharge);
  if (contract?.serviceChargeMode === "FIXED") return round((grossUsd * toNumber(contract.serviceChargePercent)) / 100);
  return 0;
}

function gstModeFor(contractId, selectedMode) {
  if (selectedMode && selectedMode !== "SOURCE_DEFAULT") return normalizeGstMode(selectedMode);
  return normalizeGstMode(contractById(contractId)?.gstMode ?? "NONE");
}

function normalizeGstMode(mode) {
  return calculations.normalizeGstMode(mode);
}

function gstPercentFor(contractId, explicitPercent) {
  if (explicitPercent !== "" && explicitPercent !== undefined) return toNumber(explicitPercent);
  return toNumber(contractById(contractId)?.gstPercent, 18);
}

function gstPayableUsd(baseUsd, mode, percent) {
  return calculations.calculateGstPayable(baseUsd, mode, percent);
}

function incomingCurrencyDisplay(value, currency, context) {
  if (currency === "INR" && (value === undefined || value === null || value === "")) return "INR unavailable";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return currency === "INR" ? moneyInr.format(numeric) : moneyUsd.format(numeric);
  console.error(`Invalid ${currency} value in Incoming queue (${context}).`, value);
  return "Invalid amount";
}

function incomingWorkEntries(contractId, workWeekStart, workWeekEnd) {
  const normalizedContractId = contractId === "__agency__" ? "" : contractId;
  return data.timeEntries.filter(
    (entry) =>
      entry.contractId === normalizedContractId &&
      entry.weekStart === workWeekStart &&
      entry.weekEnd === workWeekEnd,
  );
}

function incomingDraft(contractId, workWeekStart, workWeekEnd) {
  const entries = incomingWorkEntries(contractId, workWeekStart, workWeekEnd);
  const grossUsd = round(entries.reduce((sum, entry) => sum + entry.totalUsd, 0));
  const serviceChargeUsd = serviceChargeFor(contractId, grossUsd, "");
  const whtPercent = defaultWhtPercentForContract(contractId);
  const whtUsd = whtFor(contractId, grossUsd, whtPercent);
  const gstMode = gstModeFor(contractId);
  const gstPercent = gstPercentFor(contractId);
  const gstPayable = gstPayableUsd(serviceChargeUsd, gstMode, gstPercent);
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
  const notes = entries.length
    ? `Auto-generated from Weekly Work: ${entries.length} ${entries.length === 1 ? "entry" : "entries"}, ${formatHours(totalHours)} hours, ${moneyUsd.format(grossUsd)} gross.`
    : "Auto-generated from Weekly Work: no matching time entries found.";

  return {
    entries,
    grossUsd,
    serviceChargeUsd,
    whtPercent,
    whtUsd,
    gstMode,
    gstPercent,
    gstPayableUsd: gstPayable,
    netUsd: round(grossUsd - serviceChargeUsd - whtUsd),
    notes,
  };
}

function incomingRowKey(contractId, workWeekStart, workWeekEnd) {
  return `${contractId || ""}|${workWeekStart || ""}|${workWeekEnd || ""}`;
}

function latestIncomingPaymentForRow(sourceData, contractId, workWeekStart, workWeekEnd) {
  const normalizedContractId = contractId === "__agency__" ? "" : contractId;
  const matches = sourceData.incomingPayments.filter(
    (payment) =>
      payment.contractId === normalizedContractId &&
      payment.workWeekStart === workWeekStart &&
      payment.workWeekEnd === workWeekEnd,
  );
  return [...matches].sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")))[0] ?? null;
}

function buildIncomingQueueRows(sourceData = data) {
  const grouped = new Map();

  sourceData.timeEntries.forEach((entry) => {
    if (!entry.contractId) return;
    const key = incomingRowKey(entry.contractId, entry.weekStart, entry.weekEnd);
    const row = grouped.get(key) ?? {
      key,
      contractId: entry.contractId,
      workWeekStart: entry.weekStart,
      workWeekEnd: entry.weekEnd,
      entries: [],
    };
    row.entries.push(entry);
    grouped.set(key, row);
  });

  sourceData.incomingPayments.forEach((payment) => {
    if (!payment.contractId) return;
    const key = incomingRowKey(payment.contractId, payment.workWeekStart, payment.workWeekEnd);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        contractId: payment.contractId || "",
        workWeekStart: payment.workWeekStart || "",
        workWeekEnd: payment.workWeekEnd || "",
        entries: [],
      });
    }
  });

  return [...grouped.values()]
    .map((group) => {
      const payment = latestIncomingPaymentForRow(sourceData, group.contractId, group.workWeekStart, group.workWeekEnd);
      const entries = group.entries.length ? group.entries : incomingWorkEntries(group.contractId, group.workWeekStart, group.workWeekEnd);
      const grossUsd = round(
        entries.length ? entries.reduce((sum, entry) => sum + timeEntryGrossTotal(entry), 0) : payment ? toNumber(payment.grossUsd) : 0,
      );
      const hours = round(entries.reduce((sum, entry) => sum + entry.hours, 0));
      const sharedExchangeRate = sharedUpworkFxRate(sourceData, group.contractId, group.workWeekStart);
      const exchangeRate =
        payment && payment.exchangeRate !== undefined && payment.exchangeRate !== null && payment.exchangeRate !== ""
          ? toNumber(payment.exchangeRate)
          : sharedExchangeRate ?? "";
      const automaticServiceChargeUsd = serviceChargeFor(group.contractId, grossUsd, "");
      const serviceChargeOverridden = payment?.serviceChargeOverridden === true;
      const serviceChargeUsd =
        serviceChargeOverridden || !isUpworkContract(group.contractId)
          ? payment && payment.serviceChargeUsd !== undefined && payment.serviceChargeUsd !== null && payment.serviceChargeUsd !== ""
            ? toNumber(payment.serviceChargeUsd)
            : automaticServiceChargeUsd
          : automaticServiceChargeUsd;
      const whtPercent =
        payment && payment.whtPercent !== undefined && payment.whtPercent !== null && payment.whtPercent !== ""
          ? toNumber(payment.whtPercent)
          : defaultWhtPercentForContract(group.contractId);
      const whtUsd = whtFor(group.contractId, grossUsd, whtPercent);
      const gstMode = normalizeGstMode(payment && payment.gstMode ? payment.gstMode : gstModeFor(group.contractId));
      const gstPercent =
        payment && payment.gstPercent !== undefined && payment.gstPercent !== null && payment.gstPercent !== ""
          ? toNumber(payment.gstPercent)
          : gstPercentFor(group.contractId);
      const gstPayableUsdValue = gstPayableUsd(serviceChargeUsd, gstMode, gstPercent);
      const netUsd = incomingNetTotal(grossUsd, serviceChargeUsd, whtUsd);
      const received = payment ? payment.received !== false : false;
      const paymentDate = payment?.paymentDate || "";
      const transactionId = payment?.transactionId || "";
      const hasExchangeRate = exchangeRate !== undefined && exchangeRate !== null && exchangeRate !== "";
      const netInr = hasExchangeRate ? round(netUsd * exchangeRate) : null;
      const gstPayableInrValue = hasExchangeRate ? round(gstPayableUsdValue * exchangeRate) : null;
      const noAgencyCut = entries.some((entry) => entry.noAgencyCut || employeeRate(entry.employeeId, entry.contractId)?.noAgencyCut);
      return {
        ...group,
        paymentId: payment?.id || "",
        grossUsd,
        hours,
        exchangeRate,
        serviceChargeUsd,
        automaticServiceChargeUsd,
        serviceChargeOverridden,
        whtPercent,
        whtUsd,
        gstMode,
        gstPercent,
        gstPayableUsd: gstPayableUsdValue,
        gstPayableInr: gstPayableInrValue,
        netUsd,
        netInr,
        received,
        paymentDate,
        transactionId,
        contractLabel: contractName(group.contractId),
        serviceEditable: !isUpworkContract(group.contractId) || serviceChargeOverridden,
        noAgencyCut,
      };
    })
    .sort((a, b) => {
      if (a.received !== b.received) return a.received ? 1 : -1;
      const weekSort = `${b.workWeekStart}${b.workWeekEnd}`.localeCompare(`${a.workWeekStart}${a.workWeekEnd}`);
      if (weekSort !== 0) return weekSort;
      return a.contractLabel.localeCompare(b.contractLabel);
    });
}

function sameIncomingFinancialNumber(left, right) {
  const absent = value => value === undefined || value === null || value === "";
  return absent(left) || absent(right) ? absent(left) && absent(right) : Number(left) === Number(right);
}

function incomingPaymentFromQueueRow(sourceRow, overrides = {}) {
  const existing = sourceRow.paymentId ? byId(data.incomingPayments, sourceRow.paymentId) : null;
  const received = overrides.received ?? sourceRow.received;
  const serviceChargeOverridden = overrides.serviceChargeOverridden ?? sourceRow.serviceChargeOverridden;
  const changedFinancialInput = existing && (
    ["grossUsd", "exchangeRate", "serviceChargeUsd", "whtPercent", "gstPercent"].some(field =>
      overrides[field] !== undefined && !sameIncomingFinancialNumber(existing[field], overrides[field])) ||
    (overrides.gstMode !== undefined && normalizeGstMode(existing.gstMode) !== normalizeGstMode(overrides.gstMode)) ||
    (overrides.serviceChargeOverridden !== undefined && Boolean(existing.serviceChargeOverridden) !== Boolean(overrides.serviceChargeOverridden))
  );
  const financialCommit = !existing || overrides.financialCommit === true || changedFinancialInput || (existing.received === false && received === true);
  if (!financialCommit) {
    // A transaction/date-only save must retain stored overrides and absent INR,
    // even if the queue currently displays a newer gross amount or reference FX.
    const metadata = { ...existing, key: sourceRow.key };
    if (overrides.transactionId !== undefined && overrides.transactionId !== (existing.transactionId || "")) metadata.transactionId = overrides.transactionId;
    if (overrides.paymentDate !== undefined && overrides.paymentDate !== (existing.paymentDate || "")) metadata.paymentDate = overrides.paymentDate;
    if (overrides.received !== undefined && overrides.received !== (existing.received !== false)) metadata.received = overrides.received;
    return metadata;
  }
  const usesManualServiceCharge = serviceChargeOverridden || !isUpworkContract(sourceRow.contractId);
  const serviceChargeUsd = usesManualServiceCharge ? toNumber(overrides.serviceChargeUsd, sourceRow.serviceChargeUsd) : sourceRow.automaticServiceChargeUsd;
  return incomingPaymentUpdates.recalculateIncomingPayment({
    id: sourceRow.paymentId || id(),
    key: sourceRow.key,
    contractId: sourceRow.contractId,
    workWeekStart: sourceRow.workWeekStart,
    workWeekEnd: sourceRow.workWeekEnd,
    paymentDate: overrides.paymentDate ?? sourceRow.paymentDate,
    grossUsd: overrides.grossUsd ?? sourceRow.grossUsd,
    exchangeRate: overrides.exchangeRate ?? sourceRow.exchangeRate,
    serviceChargeUsd,
    serviceChargeOverridden: Boolean(serviceChargeOverridden),
    whtPercent: overrides.whtPercent ?? sourceRow.whtPercent,
    gstMode: normalizeGstMode(overrides.gstMode ?? sourceRow.gstMode),
    gstPercent: overrides.gstPercent ?? sourceRow.gstPercent,
    transactionId: overrides.transactionId ?? sourceRow.transactionId ?? "",
    notes: existing?.notes || "",
    received,
  });
}

function persistIncomingPayments(payments) {
  for (const payment of payments) {
    const { key, ...storedPayment } = payment;
    const index = data.incomingPayments.findIndex((item) => item.id === storedPayment.id);
    if (index >= 0) data.incomingPayments[index] = { ...data.incomingPayments[index], ...storedPayment };
    else data.incomingPayments.push(storedPayment);
  }
}

async function persistIncomingQueueRow(rowKey, { markReceived = false, receivedDateOverride = "", serviceChargeOverridden } = {}) {
  const row = incomingQueueRowElement(rowKey);
  if (!row) return false;
  const sourceRow = buildIncomingQueueRows().find((item) => item.key === rowKey);
  if (!sourceRow) return false;
  captureIncomingQueueUi();
  const previousDraft = incomingQueueDrafts.get(rowKey);
  const previousPayments = data.incomingPayments.map(payment => ({ ...payment }));
  const scrollY = window.scrollY;
  const tableWrap = document.querySelector("#incoming-queue .table-wrap");
  const tableScrollTop = tableWrap?.scrollTop ?? 0;
  const message = document.querySelector("#incoming-queue-message");

  const exchangeRate = toNumber(row.querySelector("[data-field='exchangeRate']")?.value, sourceRow.exchangeRate || 0);
  if (markReceived && exchangeRate <= 0) {
    if (message) message.textContent = "Please enter an exchange rate before marking this row as Received.";
    row.classList.add("row-error");
    row.querySelector("[data-field='exchangeRate']")?.focus();
    return false;
  }
  if (message) message.textContent = "";
  row.classList.remove("row-error");

  const serviceField = row.querySelector("[data-field='serviceChargeUsd']");
  const transactionField = row.querySelector("[data-field='transactionId']");
  const serviceChargeUsd = sourceRow.serviceEditable || serviceChargeOverridden === true
    ? serviceField?.value !== "" && serviceField?.value !== undefined
      ? toNumber(serviceField.value, sourceRow.serviceChargeUsd)
      : sourceRow.serviceChargeUsd
    : sourceRow.serviceChargeUsd;
  const nextPayment = incomingPaymentFromQueueRow(sourceRow, {
    ...(Object.hasOwn(previousDraft || {}, "exchangeRate") || markReceived ? { exchangeRate } : {}),
    ...(Object.hasOwn(previousDraft || {}, "serviceChargeUsd") || serviceChargeOverridden !== undefined
      ? { serviceChargeUsd, serviceChargeOverridden } : {}),
    financialCommit: markReceived || serviceChargeOverridden !== undefined,
    received: markReceived ? true : sourceRow.received,
    paymentDate: receivedDateOverride || (markReceived ? dateInput(new Date()) : sourceRow.paymentDate || ""),
    transactionId: transactionField ? transactionField.value.trim() : sourceRow.transactionId || "",
  });
  const previousPayment = previousPayments.find(payment => payment.id === nextPayment.id);
  const refreshPayoutFx = nextPayment.received !== false &&
    (!previousPayment || previousPayment.received === false || !sameIncomingFinancialNumber(previousPayment.exchangeRate, nextPayment.exchangeRate));
  persistIncomingPayments([nextPayment]);
  discardIncomingDrafts([rowKey]);
  try {
    await save(data, { payoutFxContracts: refreshPayoutFx ? [nextPayment.contractId] : [] });
  } catch (error) {
    data.incomingPayments = previousPayments;
    incomingQueueResetDraftKeys.delete(rowKey);
    if (previousDraft) incomingQueueDrafts.set(rowKey, previousDraft);
    setIncomingQueueMessage(error.message || "Payment update could not be saved. Your draft is still available.", "action");
    return false;
  }
  window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
  const nextTableWrap = document.querySelector("#incoming-queue .table-wrap");
  if (nextTableWrap) nextTableWrap.scrollTop = tableScrollTop;
  return true;
}

function syncIncomingQueueRowPreview(row, knownSourceRow = null) {
  const paidButton = row?.querySelector("[data-incoming-paid]");
  const rowKey = row?.dataset.incomingKey || paidButton?.dataset.incomingPaid;
  if (!rowKey) return;
  const sourceRow = knownSourceRow || buildIncomingQueueRows().find((item) => item.key === rowKey);
  if (!sourceRow) return;

  const grossField = row.querySelector("[data-field='grossUsd']");
  const serviceField = row.querySelector("[data-field='serviceChargeUsd']");
  const gstDisplay = row.querySelector("[data-display='gst']");
  const exchangeField = row.querySelector("[data-field='exchangeRate']");
  const grossUsd = grossField ? toNumber(grossField.value, sourceRow.grossUsd) : sourceRow.grossUsd;
  const serviceChargeUsd = sourceRow.serviceEditable || activeServiceOverrides.has(sourceRow.key)
    ? serviceField?.value !== "" && serviceField?.value !== undefined
      ? toNumber(serviceField.value, sourceRow.serviceChargeUsd)
      : sourceRow.serviceChargeUsd
    : sourceRow.serviceChargeUsd;
  const gstPayableUsdValue = gstPayableUsd(serviceChargeUsd, sourceRow.gstMode, sourceRow.gstPercent);
  const exchangeValue = exchangeField ? exchangeField.value : sourceRow.exchangeRate;
  const exchangeRate = toNumber(exchangeValue, sourceRow.exchangeRate || 0);
  const netUsd = incomingNetTotal(grossUsd, serviceChargeUsd, sourceRow.whtUsd);
  const hasExchangeRate = exchangeValue !== undefined && exchangeValue !== null && exchangeValue !== "";
  const netInr = hasExchangeRate ? round(netUsd * exchangeRate) : null;

  if (gstDisplay) gstDisplay.textContent = incomingCurrencyDisplay(gstPayableUsdValue, "USD", "GST payable");

  const whtDisplay = row.querySelector("[data-display='wht']");
  if (whtDisplay) {
    whtDisplay.innerHTML = `${incomingCurrencyDisplay(sourceRow.whtUsd, "USD", "WHT")}<br>${number.format(sourceRow.whtPercent ?? 0)}%`;
  }

  const netDisplay = row.querySelector("[data-display='net']");
  if (netDisplay) {
    netDisplay.innerHTML = `${incomingCurrencyDisplay(netUsd, "USD", "Net income")}<br>${incomingCurrencyDisplay(netInr, "INR", "Net INR reference")}`;
  }
}

function queueEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function incomingQueueRowElement(rowKey) {
  return [...(document.querySelector("#incoming-queue")?.querySelectorAll("[data-incoming-key]") || [])].find(row => row.dataset.incomingKey === rowKey) || null;
}

function resetIncomingQueueState() {
  // The old dataset's fields remain mounted until the next render. They must
  // never become drafts for a newly opened/imported dataset with matching keys.
  incomingQueueSkipCapture = true;
  incomingQueueDrafts.clear();
  incomingQueueRenderedValues.clear();
  incomingQueueResetDraftKeys.clear();
  activeServiceOverrides.clear();
  Object.keys(incomingQueueState.filters).forEach(key => { incomingQueueState.filters[key] = ""; });
  incomingQueueState.sortKey = "default";
  incomingQueueState.sortDirection = "asc";
  clearIncomingSelection();
}

function matchingIncomingRows(rows = buildIncomingQueueRows()) {
  return incomingQueueView.visibleRows(rows, incomingQueueState);
}

function rememberIncomingField(field) {
  const rowKey = field?.closest("[data-incoming-key]")?.dataset.incomingKey;
  const name = field?.dataset.field;
  if (!rowKey || !name || field.readOnly || incomingQueueResetDraftKeys.has(rowKey)) return;
  const baseline = incomingQueueRenderedValues.get(rowKey) || {};
  const draft = { ...(incomingQueueDrafts.get(rowKey) || {}) };
  if (String(field.value) === String(baseline[name] ?? "")) delete draft[name];
  else draft[name] = field.value;
  if (Object.keys(draft).length) incomingQueueDrafts.set(rowKey, draft);
  else incomingQueueDrafts.delete(rowKey);
}

function captureIncomingQueueUi() {
  const container = document.querySelector("#incoming-queue");
  if (!container) return null;
  container.querySelectorAll("[data-field]").forEach(rememberIncomingField);
  const wrap = container.querySelector(".table-wrap");
  const panel = container.closest(".tab-panel");
  const active = document.activeElement;
  let focus = null;
  if (active && container.contains(active)) {
    focus = { rowKey: active.closest("[data-incoming-key]")?.dataset.incomingKey || "", field: active.dataset.field,
      select: active.dataset.incomingSelect, filter: active.dataset.incomingFilter, sort: active.dataset.incomingSort,
      control: active.dataset.incomingControl, id: active.id, start: active.selectionStart, end: active.selectionEnd };
  }
  return { top: wrap?.scrollTop || 0, left: wrap?.scrollLeft || 0, panelTop: panel?.scrollTop || 0,
    panelLeft: panel?.scrollLeft || 0, windowX: window.scrollX || 0, windowY: window.scrollY || 0, focus };
}

function restoreIncomingQueueUi(snapshot) {
  if (!snapshot) return;
  const container = document.querySelector("#incoming-queue");
  if (!container) return;
  const focus = snapshot.focus;
  if (focus) {
    const target = [...container.querySelectorAll("input, select, button")].find(element =>
      (focus.field && element.dataset.field === focus.field && element.closest("[data-incoming-key]")?.dataset.incomingKey === focus.rowKey) ||
      (focus.select !== undefined && element.dataset.incomingSelect === focus.select) ||
      (focus.filter && element.dataset.incomingFilter === focus.filter) ||
      (focus.sort && element.dataset.incomingSort === focus.sort) ||
      (focus.control && element.dataset.incomingControl === focus.control) || (focus.id && element.id === focus.id));
    if (target) {
      target.focus({ preventScroll: true });
      if (typeof focus.start === "number" && typeof target.setSelectionRange === "function") {
        try { target.setSelectionRange(focus.start, focus.end); } catch (_) { /* Number/date inputs have no text selection. */ }
      }
    }
  }
  const version = incomingQueueRenderVersion;
  const restoreScroll = () => {
    if (version !== incomingQueueRenderVersion) return;
    const wrap = container.querySelector(".table-wrap"), panel = container.closest(".tab-panel");
    if (wrap) { wrap.scrollTop = snapshot.top; wrap.scrollLeft = snapshot.left; }
    if (panel) { panel.scrollTop = snapshot.panelTop; panel.scrollLeft = snapshot.panelLeft; }
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  };
  restoreScroll();
  window.requestAnimationFrame?.(restoreScroll);
}

function discardIncomingDrafts(keys) {
  keys.forEach(key => { incomingQueueDrafts.delete(key); incomingQueueResetDraftKeys.add(key); });
}

function incomingQueueControls(rows, matching) {
  const filters = incomingQueueState.filters;
  const option = (value, label, selected) => `<option value="${queueEscape(value)}" ${value === selected ? "selected" : ""}>${queueEscape(label)}</option>`;
  const weeks = [...new Set(rows.map(incomingQueueView.weekKey))].sort().reverse();
  const contracts = [...new Map(rows.map(row => [row.contractId, row.contractLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const sorts = [["default", "Pending first, newest week"], ["workWeekStart", "Work week"], ["paymentDate", "Received date"], ["contractLabel", "Contract"], ["hours", "Hours"], ["grossUsd", "Gross USD"], ["exchangeRate", "Exchange rate"], ["serviceChargeUsd", "Service charge USD"], ["whtUsd", "WHT USD"], ["netUsd", "Net USD"], ["netInr", "Net INR"], ["gstPayableUsd", "GST USD"], ["transactionId", "Transaction ID"], ["received", "Status"]];
  return `<div class="queue-tools" role="group" aria-label="Filter and sort payment queue">
    <label>Work week<select data-incoming-filter="week">${option("", "All work weeks", filters.week)}${weeks.map(week => option(week, week.replace("|", " to "), filters.week)).join("")}</select></label>
    <label>Contract<select data-incoming-filter="contractId">${option("", "All contracts", filters.contractId)}${contracts.map(([key, name]) => option(key, name, filters.contractId)).join("")}</select></label>
    <label>Status<select data-incoming-filter="status">${[["", "All statuses"], ["pending", "Pending"], ["received", "Received"]].map(([key, label]) => option(key, label, filters.status)).join("")}</select></label>
    <label>Week starts on/after<input type="date" data-incoming-filter="dateFrom" value="${queueEscape(filters.dateFrom)}" /></label>
    <label>Week starts on/before<input type="date" data-incoming-filter="dateTo" value="${queueEscape(filters.dateTo)}" /></label>
    <label class="queue-search">Search contract / transaction<input type="search" data-incoming-filter="search" value="${queueEscape(filters.search)}" placeholder="Search matching rows" /></label>
    <label>Sort by<select data-incoming-control="sort-key">${sorts.map(([key, label]) => option(key, label, incomingQueueState.sortKey)).join("")}</select></label>
    <button type="button" class="secondary-button" data-incoming-control="sort-direction" ${incomingQueueState.sortKey === "default" ? "disabled" : ""}>${incomingQueueState.sortDirection === "asc" ? "Ascending ↑" : "Descending ↓"}</button>
    <button type="button" class="secondary-button" data-incoming-control="clear-filters">Clear filters</button>
    <button type="button" class="secondary-button" data-incoming-control="select-matching">Select matching ${matching.length}</button>
    <p id="incoming-matching-summary" class="queue-match-summary" aria-live="polite"></p>
  </div>`;
}

function incomingSortHeader(label, key) {
  const active = incomingQueueState.sortKey === key;
  const direction = incomingQueueState.sortDirection === "asc" ? "↑" : "↓";
  return `<button type="button" class="queue-sort-button" data-incoming-sort="${key}" aria-pressed="${active}" aria-label="Sort ${queueEscape(label)} ${active && incomingQueueState.sortDirection === "asc" ? "descending" : "ascending"}">${queueEscape(label)}${active ? ` ${direction}` : ""}</button>`;
}

function updateIncomingSelectionUi(rows = buildIncomingQueueRows(), snapshot = captureIncomingQueueUi()) {
  const matching = matchingIncomingRows(rows);
  const { selected } = incomingBatchSelection(rows);
  const scope = incomingQueueView.selectionScope(matching, selected);
  const counts = incomingQueueView.selectionCounts(rows, matching, selectedIncomingRows);
  const container = document.querySelector("#incoming-queue");
  container?.querySelectorAll("[data-incoming-select]").forEach(input => { input.checked = selectedIncomingRows.has(input.dataset.incomingSelect); });
  const header = container?.querySelector("[data-incoming-select-all]");
  const allMatchingSelected = matching.length > 0 && matching.every(row => selectedIncomingRows.has(row.key));
  if (header) {
    header.checked = allMatchingSelected;
    header.indeterminate = !allMatchingSelected && matching.some(row => selectedIncomingRows.has(row.key));
    header.disabled = !scope.canSelect && !allMatchingSelected;
    header.setAttribute("aria-label", `${allMatchingSelected ? "Deselect" : "Select"} all ${matching.length} matching rows across the filtered list; one work week only`);
    header.title = scope.reason || `All ${matching.length} matching rows, including rows outside the scroll viewport`;
  }
  const selectButton = container?.querySelector("[data-incoming-control='select-matching']");
  if (selectButton) { selectButton.disabled = !scope.canSelect; selectButton.title = scope.reason || "Select every matching row, including rows outside the scroll viewport"; }
  const status = container?.querySelector("#incoming-matching-summary");
  if (status) status.textContent = `${matching.length} matching of ${rows.length} rows. ${counts.selected} selected${counts.hidden ? ` (${counts.hidden} hidden by filters)` : ""}. ${scope.reason || "Select matching includes all filtered rows, not just the scroll viewport."}${incomingQueueState.filters.dateFrom && incomingQueueState.filters.dateTo && incomingQueueState.filters.dateFrom > incomingQueueState.filters.dateTo ? " Start-date range is reversed." : ""}`;
  updateIncomingBulkToolbar(rows);
  restoreIncomingQueueUi(snapshot);
}

function selectedIncomingQueueRows(rows = buildIncomingQueueRows()) {
  const available = new Set(rows.map((row) => row.key));
  [...selectedIncomingRows].forEach((key) => {
    if (!available.has(key)) selectedIncomingRows.delete(key);
  });
  return rows.filter((row) => selectedIncomingRows.has(row.key));
}

function incomingBatchWeek(rows) {
  const first = rows[0];
  return first ? `${first.workWeekStart} to ${first.workWeekEnd}` : "";
}

function incomingBatchSelection(rows = buildIncomingQueueRows()) {
  const selected = selectedIncomingQueueRows(rows);
  return { selected, state: incomingPaymentUpdates.batchSelectionState(selected) };
}

function setIncomingQueueMessage(text = "", kind = "") {
  const message = document.querySelector("#incoming-queue-message");
  if (!message) return;
  message.textContent = text;
  message.dataset.messageKind = kind;
}

function clearIncomingSelectionMessage() {
  const message = document.querySelector("#incoming-queue-message");
  if (message?.dataset.messageKind === "selection") setIncomingQueueMessage();
}

function clearIncomingSelection() {
  selectedIncomingRows.clear();
  incomingQueueRangeAnchor = "";
  document.querySelector("#incoming-bulk-form")?.reset();
  clearIncomingSelectionMessage();
}

function updateIncomingBulkToolbar(rows) {
  const form = document.querySelector("#incoming-bulk-form");
  const summary = document.querySelector("#incoming-bulk-summary");
  const receivedDate = document.querySelector("#incoming-bulk-received-date");
  const applyButton = document.querySelector("#incoming-bulk-apply");
  const receiveButton = document.querySelector("#incoming-bulk-receive");
  if (!form || !summary) return;
  const { selected, state } = incomingBatchSelection(rows);
  form.classList.toggle("hidden", !selected.length);
  if (!selected.length) {
    clearIncomingSelectionMessage();
    return;
  }
  const grossUsd = round(selected.reduce((total, row) => total + row.grossUsd, 0));
  const netUsd = round(selected.reduce((total, row) => total + row.netUsd, 0));
  const pending = selected.filter((row) => !row.received).length;
  const received = selected.length - pending;
  const selectionLabel = state.hasMultipleWeeks ? `${state.weekCount} work weeks selected` : incomingBatchWeek(selected);
  const counts = incomingQueueView.selectionCounts(rows, matchingIncomingRows(rows), selectedIncomingRows);
  summary.innerHTML = `<strong>${selected.length} selected${counts.hidden ? ` · ${counts.hidden} hidden by filters` : ""}</strong><span>${selectionLabel}</span><span>Actions apply to all ${selected.length} selected rows.</span><span>Gross ${moneyUsd.format(grossUsd)} · Net ${moneyUsd.format(netUsd)}</span>${received ? `<span class="pill">Editing ${received} received</span>` : ""}${pending ? `<span class="pill warn">${pending} pending</span>` : ""}`;
  const actionsDisabled = !state.isValid;
  [applyButton, receiveButton].forEach((button) => {
    if (!button) return;
    button.disabled = actionsDisabled;
    button.setAttribute("aria-disabled", String(actionsDisabled));
  });
  if (state.hasMultipleWeeks) setIncomingQueueMessage(INCOMING_BATCH_WEEK_ERROR, "selection");
  else clearIncomingSelectionMessage();
  if (receivedDate && !receivedDate.value) receivedDate.value = dateInput(new Date());
}

function selectIncomingRow(rowKey, checked, extendRange = false) {
  const rows = buildIncomingQueueRows();
  const row = rows.find((item) => item.key === rowKey);
  if (!row) return;
  const snapshot = captureIncomingQueueUi();
  const affected = extendRange ? incomingQueueView.rangeRows(matchingIncomingRows(rows), incomingQueueRangeAnchor, rowKey) : [row];
  if (checked) {
    const selected = selectedIncomingQueueRows(rows);
    const scope = incomingQueueView.selectionScope(affected, selected);
    if (!scope.canSelect) {
      updateIncomingSelectionUi(rows, snapshot);
      setIncomingQueueMessage(scope.reason, "selection");
      return;
    }
    affected.forEach(item => selectedIncomingRows.add(item.key));
  } else {
    affected.forEach(item => selectedIncomingRows.delete(item.key));
  }
  if (!extendRange) incomingQueueRangeAnchor = rowKey;
  updateIncomingSelectionUi(rows, snapshot);
}

function selectAllIncomingRows(checked) {
  const rows = buildIncomingQueueRows();
  const snapshot = captureIncomingQueueUi();
  const matching = matchingIncomingRows(rows);
  if (checked) {
    const scope = incomingQueueView.selectionScope(matching, selectedIncomingQueueRows(rows));
    if (!scope.canSelect) {
      updateIncomingSelectionUi(rows, snapshot);
      setIncomingQueueMessage(scope.reason, "selection");
      return;
    }
    matching.forEach(row => selectedIncomingRows.add(row.key));
  } else {
    matching.forEach(row => selectedIncomingRows.delete(row.key));
  }
  updateIncomingSelectionUi(rows, snapshot);
}

async function applyIncomingBulkUpdate(markReceived = false) {
  captureIncomingQueueUi();
  const rows = buildIncomingQueueRows();
  const selected = selectedIncomingQueueRows(rows);
  const transactionId = document.querySelector("#incoming-bulk-transaction")?.value.trim() || "";
  const exchangeRate = toNumber(document.querySelector("#incoming-bulk-exchange-rate")?.value, 0);
  const paymentDate = document.querySelector("#incoming-bulk-received-date")?.value || "";
  const message = document.querySelector("#incoming-queue-message");
  const selectionState = incomingPaymentUpdates.batchSelectionState(selected);
  if (!selectionState.isValid) {
    setIncomingQueueMessage(selectionState.hasMultipleWeeks ? INCOMING_BATCH_WEEK_ERROR : "Select at least one payment row.", "selection");
    return;
  }
  if (!selected.length || !transactionId || exchangeRate <= 0 || !paymentDate) {
    if (message) {
      message.textContent = "Enter a transaction ID, exchange rate, and received date for the selected batch.";
      message.dataset.messageKind = "action";
    }
    return;
  }
  const replacing = incomingPaymentUpdates.batchWouldOverwrite(selected, selected.map((row) => row.key));
  if (replacing && !confirm(`This will replace stored transaction details for ${selected.length} selected row${selected.length === 1 ? "" : "s"}. Continue?`)) return;
  const previousPayments = data.incomingPayments.map(payment => ({ ...payment }));
  const previousDrafts = new Map(selected.map(row => [row.key, incomingQueueDrafts.get(row.key)]));
  try {
    const basePayments = selected.map(row => incomingPaymentFromQueueRow(row));
    const sourceByKey = new Map(selected.map(row => [row.key, row]));
    const updated = incomingPaymentUpdates.applyBulkPaymentDetails(basePayments, selected.map((row) => row.key), {
      transactionId,
      exchangeRate,
      paymentDate,
      markReceived,
    }).map(details => {
      const row = sourceByKey.get(details.key);
      const draft = incomingQueueDrafts.get(row.key) || {};
      const serviceCommit = draft.serviceChargeUsd !== undefined || activeServiceOverrides.has(row.key);
      return incomingPaymentFromQueueRow(row, {
        transactionId: details.transactionId, exchangeRate: details.exchangeRate, paymentDate: details.paymentDate,
        received: details.received, financialCommit: serviceCommit,
        ...(serviceCommit ? { serviceChargeOverridden: row.serviceChargeOverridden || activeServiceOverrides.has(row.key),
          serviceChargeUsd: draft.serviceChargeUsd !== undefined ? toNumber(draft.serviceChargeUsd, row.serviceChargeUsd) : row.serviceChargeUsd } : {}),
      });
    });
    const previousById = new Map(previousPayments.map(payment => [payment.id, payment]));
    const payoutFxContracts = [...new Set(updated.filter(payment => {
      const previous = previousById.get(payment.id);
      return payment.received !== false && (!previous || previous.received === false || !sameIncomingFinancialNumber(previous.exchangeRate, payment.exchangeRate));
    }).map(payment => payment.contractId))];
    persistIncomingPayments(updated);
    discardIncomingDrafts(selected.map(row => row.key));
    await save(data, { payoutFxContracts });
    clearIncomingSelection();
    updateIncomingSelectionUi(buildIncomingQueueRows());
    if (message) {
      message.textContent = `${updated.length} selected payment${updated.length === 1 ? "" : "s"} updated${markReceived ? " and marked as received" : ""}.`;
      message.dataset.messageKind = "action";
    }
  } catch (error) {
    data.incomingPayments = previousPayments;
    selected.forEach(row => {
      incomingQueueResetDraftKeys.delete(row.key);
      const draft = previousDrafts.get(row.key);
      if (draft) incomingQueueDrafts.set(row.key, draft);
    });
    console.error("Bulk payment update failed", error);
    if (message) message.textContent = error.message || "Bulk payment update failed.";
  }
}

function renderIncomingQueue() {
  const container = document.querySelector("#incoming-queue");
  const summary = document.querySelector("#incoming-queue-summary");
  const message = document.querySelector("#incoming-queue-message");
  if (!container || !summary) return;

  const snapshot = incomingQueueSkipCapture ? null : captureIncomingQueueUi();
  incomingQueueSkipCapture = false;
  incomingQueueRenderVersion += 1;
  const allRows = buildIncomingQueueRows();
  const available = new Set(allRows.map(row => row.key));
  [...incomingQueueDrafts.keys()].forEach(key => { if (!available.has(key)) incomingQueueDrafts.delete(key); });
  selectedIncomingQueueRows(allRows);
  const rows = matchingIncomingRows(allRows);
  const pendingCount = allRows.filter((row) => row.received === false).length;
  const paidCount = allRows.length - pendingCount;
  incomingQueueRenderedValues.clear();
  allRows.forEach(row => incomingQueueRenderedValues.set(row.key, { exchangeRate: row.exchangeRate === undefined || row.exchangeRate === null || row.exchangeRate === "" ? "" : String(row.exchangeRate), serviceChargeUsd: row.serviceChargeUsd.toFixed(2), transactionId: row.transactionId || "" }));
  const fieldValue = (row, name) => queueEscape(incomingQueueDrafts.get(row.key)?.[name] ?? incomingQueueRenderedValues.get(row.key)?.[name] ?? "");

  summary.innerHTML = `
    <span class="pill warn">Pending: ${pendingCount}</span>
    <span class="pill">Received: ${paidCount}</span>
  `;
  container.innerHTML = incomingQueueControls(allRows, rows) + (rows.length ? table(
    [`<input type="checkbox" data-incoming-select-all data-incoming-control="matching-checkbox" />`, incomingSortHeader("Work week", "workWeekStart"), `${incomingSortHeader("Contract", "contractLabel")}<br>${incomingSortHeader("Received date", "paymentDate")}`, `${incomingSortHeader("Hours", "hours")} /<br>${incomingSortHeader("Gross USD", "grossUsd")}`, incomingSortHeader("Exchange rate", "exchangeRate"), incomingSortHeader("Service charge", "serviceChargeUsd"), incomingSortHeader("WHT", "whtUsd"), `${incomingSortHeader("Net USD", "netUsd")} / ${incomingSortHeader("INR", "netInr")}`, incomingSortHeader("GST USD", "gstPayableUsd"), incomingSortHeader("Txn ID", "transactionId"), `${incomingSortHeader("Status", "received")} / Action`],
    rows.map((row) => {
      const serviceInput = !isUpworkContract(row.contractId)
        ? `<input data-field="serviceChargeUsd" type="number" step="0.01" value="${fieldValue(row, "serviceChargeUsd")}" aria-label="Service charge USD for ${queueEscape(row.contractLabel)}" />`
        : row.serviceChargeOverridden || activeServiceOverrides.has(row.key)
          ? `<input data-field="serviceChargeUsd" type="number" step="0.01" value="${fieldValue(row, "serviceChargeUsd")}" aria-label="Service charge USD for ${queueEscape(row.contractLabel)}" /><small class="manual-override">Manual override</small><button class="inline-link-button" type="button" data-service-save="${queueEscape(row.key)}">Save</button><button class="inline-link-button" type="button" data-service-reset="${queueEscape(row.key)}">Reset</button>`
          : `${incomingCurrencyDisplay(row.automaticServiceChargeUsd, "USD", "Automatic service charge")}<br><small>Auto from contract</small><button class="inline-link-button" type="button" data-service-override="${queueEscape(row.key)}">Override</button>`;
      const transactionInput = row.received
        ? `<input data-field="transactionId" type="text" value="${queueEscape(row.transactionId || "")}" aria-label="Transaction ID for ${queueEscape(row.contractLabel)}" readonly />`
        : `<input data-field="transactionId" type="text" value="${fieldValue(row, "transactionId")}" aria-label="Transaction ID for ${queueEscape(row.contractLabel)}" placeholder="Txn ID" />`;
      return {
        attrs: `data-incoming-key="${queueEscape(row.key)}"`,
        cells: [
        `<input type="checkbox" data-incoming-select="${queueEscape(row.key)}" aria-label="Select ${queueEscape(row.contractLabel)} for ${queueEscape(row.workWeekStart)} for bulk update" ${selectedIncomingRows.has(row.key) ? "checked" : ""} />`,
        `${queueEscape(row.workWeekStart)} to ${queueEscape(row.workWeekEnd)}`,
        `${queueEscape(row.contractLabel)}${row.paymentDate ? `<br><small>Received ${row.received ? queueEscape(row.paymentDate) : "pending"}</small>` : ""}`,
        `<span class="hours-gross"><span>${formatHours(row.hours)} hrs</span>${incomingCurrencyDisplay(row.grossUsd, "USD", "Gross income")}</span>`,
        `<input data-field="exchangeRate" type="number" step="0.0001" value="${fieldValue(row, "exchangeRate")}" aria-label="Exchange rate for ${queueEscape(row.contractLabel)}" />`,
        serviceInput,
        `<span data-display="wht">${incomingCurrencyDisplay(row.whtUsd, "USD", "WHT")}<br>${number.format(row.whtPercent ?? 0)}%</span>`,
        `<span data-display="net">${incomingCurrencyDisplay(row.netUsd, "USD", "Net income")}<br>${incomingCurrencyDisplay(row.netInr, "INR", "Net INR reference")}</span>`,
        `<span class="pill ${normalizeGstMode(row.gstMode) === "RCM" ? "warn" : ""}">${row.gstMode}</span><br><span data-display="gst">${incomingCurrencyDisplay(row.gstPayableUsd, "USD", "GST payable")}</span>`,
        transactionInput,
        row.received === false
          ? `<button class="incoming-action-button" type="button" data-incoming-paid="${queueEscape(row.key)}">Mark as Received</button>`
          : `<span class="pill">Received</span>`,
        ],
      };
    }),
  ) : `<div class="empty">${allRows.length ? "No payment rows match these filters. Clear or change the filters to continue." : "No payment rows yet. Record weekly work to build the queue."}</div>`);
  container.querySelectorAll("th").forEach(header => {
    const active = [...header.querySelectorAll("[data-incoming-sort]")].some(button => button.dataset.incomingSort === incomingQueueState.sortKey);
    if (header.querySelector("[data-incoming-sort]")) header.setAttribute("aria-sort", active ? (incomingQueueState.sortDirection === "asc" ? "ascending" : "descending") : "none");
  });
  const sourceMap = new Map(allRows.map(row => [row.key, row]));
  container.querySelectorAll("[data-incoming-key]").forEach(row => {
    if (incomingQueueDrafts.has(row.dataset.incomingKey)) syncIncomingQueueRowPreview(row, sourceMap.get(row.dataset.incomingKey));
  });
  incomingQueueResetDraftKeys.clear();
  updateIncomingSelectionUi(allRows, snapshot);
}

function syncRateForm() {
  const form = document.querySelector("#rate-form");
  if (!form) return;
  const contractId = form.elements.contractId.value;
  const passThrough = form.elements.noAgencyCut.value === "true";
  const contractRate = passThrough ? passThroughRateForContract(contractId) : "";
  form.elements.rateUsd.readOnly = passThrough;
  form.elements.rateUsd.value = passThrough ? contractRate.toFixed(2) : "";
  form.dataset.passThrough = passThrough ? "true" : "false";
  const passButton = document.querySelector("#rate-mode-pass");
  const standardButton = document.querySelector("#rate-mode-standard");
  if (passButton) passButton.setAttribute("aria-pressed", passThrough ? "true" : "false");
  if (standardButton) standardButton.setAttribute("aria-pressed", passThrough ? "false" : "true");
}

function latestIncomingExchangeRate(sourceData, contractId) {
  return latestReceivedIncomingExchangeRate(sourceData, contractId);
}

function latestReceivedIncomingExchangeRate(sourceData, contractId) {
  const receivedPayments = sourceData.incomingPayments.filter(
    (payment) => payment.received !== false && payment.exchangeRate !== undefined && payment.exchangeRate !== null && payment.exchangeRate !== "",
  );
  const latestPayment = (pool) =>
    [...pool].sort(
      (a, b) =>
        String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")) ||
        String(b.id || "").localeCompare(String(a.id || "")),
    )[0];

  if (contractId) {
    const byContract = receivedPayments.filter((payment) => payment.contractId === contractId);
    const latestContractPayment = latestPayment(byContract);
    if (latestContractPayment) return toNumber(latestContractPayment.exchangeRate);

    const contract = sourceData.contracts.find((item) => item.id === contractId);
    if (contract?.sourceId) {
      const contractIds = new Set(
        sourceData.contracts.filter((item) => item.sourceId === contract.sourceId).map((item) => item.id),
      );
      const bySource = receivedPayments.filter((payment) => contractIds.has(payment.contractId));
      const latestSourcePayment = latestPayment(bySource);
      if (latestSourcePayment) return toNumber(latestSourcePayment.exchangeRate);
    }
    return null;
  }

  const latestOverallPayment = latestPayment(receivedPayments);
  return latestOverallPayment ? toNumber(latestOverallPayment.exchangeRate) : null;
}

function estimatedIncomingExchangeRate(sourceData, row) {
  if (row.exchangeRate !== undefined && row.exchangeRate !== null && row.exchangeRate !== "") {
    return toNumber(row.exchangeRate);
  }
  return latestReceivedIncomingExchangeRate(sourceData, row.contractId);
}

function buildGeneratedPayouts(sourceData = data, periodIds = null) {
  const groups = new Map();

  sourceData.timeEntries.forEach((entry) => {
    const key = `${entry.employeeId}|${entry.weekStart}|${entry.weekEnd}`;
    if (periodIds && !periodIds.has(key)) return;
    const effectiveRateUsd = financialDisplay.optionalNumber(entry.rateUsd);
    const storedTotal = financialDisplay.optionalNumber(entry.totalUsd);
    if (effectiveRateUsd === null || storedTotal === null) {
      throw new Error("This work period contains incomplete historical financial fields. A separately approved correction is required before changing its payout.");
    }
    const payout = groups.get(key) ?? {
      id: key,
      employeeId: entry.employeeId,
      weekStart: entry.weekStart,
      weekEnd: entry.weekEnd,
      payoutDate: payoutDateForWeekStart(entry.weekStart),
      contracts: new Map(),
    };
    const contractGroup = payout.contracts.get(entry.contractId) ?? {
      contractId: entry.contractId,
      hours: 0,
      rateUsd: effectiveRateUsd,
      totalUsd: 0,
      exchangeRate: latestIncomingExchangeRate(sourceData, entry.contractId),
      totalInr: 0,
      noAgencyCut: Boolean(entry.noAgencyCut),
    };
    contractGroup.hours += entry.hours;
    contractGroup.rateUsd = effectiveRateUsd;
    contractGroup.totalUsd = round(contractGroup.totalUsd + storedTotal);
    contractGroup.exchangeRate = latestIncomingExchangeRate(sourceData, entry.contractId);
    contractGroup.totalInr = contractGroup.exchangeRate ? round(contractGroup.totalUsd * contractGroup.exchangeRate) : null;
    contractGroup.noAgencyCut = contractGroup.noAgencyCut || Boolean(entry.noAgencyCut);
    payout.contracts.set(entry.contractId, contractGroup);
    groups.set(key, payout);
  });

  return [...groups.values()]
    .map((payout) => {
      const existing = sourceData.payouts.find((item) => item.id === payout.id);
      const status = sourceData.payoutPaymentStatus?.[payout.id] || existing || {};
      const contracts = [...payout.contracts.values()].sort((a, b) => contractName(a.contractId).localeCompare(contractName(b.contractId)));
      const totalHours = contracts.reduce((sum, item) => sum + item.hours, 0);
      const totalUsd = contracts.reduce((sum, item) => sum + item.totalUsd, 0);
      const totalInr = financialDisplay.sumKnown(contracts, item => item.totalInr);
      return {
        id: payout.id,
        employeeId: payout.employeeId,
        weekStart: payout.weekStart,
        weekEnd: payout.weekEnd,
        payoutDate: payout.payoutDate,
        paid: status.paid === true,
        paidDate: status.paidDate || "",
        transactionId: status.transactionId || "",
        contracts,
        totalHours,
        totalUsd,
        totalInr,
        note: buildPayoutNote({
          employeeId: payout.employeeId,
          weekStart: payout.weekStart,
          weekEnd: payout.weekEnd,
          payoutDate: payout.payoutDate,
          contracts,
          totalHours,
          totalUsd,
          totalInr,
          paid: status.paid === true,
          paidDate: status.paidDate || "",
          transactionId: status.transactionId || "",
        }),
      };
    })
    .sort((a, b) => `${b.weekStart}${b.employeeId}`.localeCompare(`${a.weekStart}${a.employeeId}`));
}

function buildPayoutNote(payout) {
  const lines = [
    `Payment summary for ${employeeName(payout.employeeId)}`,
    `Work week: ${payout.weekStart} to ${payout.weekEnd}`,
    `Scheduled payout date: ${payout.payoutDate}`,
    "",
    "Contracts worked on:",
  ];

  payout.contracts.forEach((contract) => {
    const rateText = contract.exchangeRate ? moneyInr.format(contract.exchangeRate) : "N/A";
    const inrText = contract.exchangeRate ? moneyInr.format(contract.totalInr) : "Pending exchange rate";
    const modeText = contract.noAgencyCut ? "Pass-through, no agency cut" : "";
    lines.push(
      `- ${contractName(contract.contractId)}${modeText ? ` (${modeText})` : ""}: ${formatHours(contract.hours)} hrs @ ${moneyUsd.format(contract.rateUsd)}/hr = ${moneyUsd.format(contract.totalUsd)}; exchange rate ${rateText}; payout ${inrText}`,
    );
  });

  lines.push("");
  lines.push(`Total hours: ${formatHours(payout.totalHours)}`);
  lines.push(`Total payout: ${moneyUsd.format(payout.totalUsd)} | ${formatInrReference(payout.totalInr)}`);
  if (payout.paid) {
    lines.push(`Paid date: ${payout.paidDate || payout.payoutDate}`);
    if (payout.transactionId) lines.push(`Transaction ID: ${payout.transactionId}`);
  } else {
    lines.push("Status: Pending");
  }
  return lines.join("\n");
}

function recordReportMonthValue() {
  return document.querySelector("#record-filter-month")?.value || "";
}

function setRecordReportMonth(value = currentMonth()) {
  const input = document.querySelector("#record-filter-month");
  if (!input) return;
  input.value = value;
}

function shiftRecordReportMonth(months) {
  const input = document.querySelector("#record-filter-month");
  if (!input) return;
  const date = monthDate(input.value || currentMonth());
  date.setMonth(date.getMonth() + months);
  input.value = monthInput(date);
  renderTables();
}

function formatInrReference(value) {
  const known = financialDisplay.optionalNumber(value);
  return known === null ? "INR unavailable" : moneyInr.format(known);
}

function inrReferenceDetail(value) {
  const known = financialDisplay.optionalNumber(value);
  return known === null ? "INR unavailable" : `${moneyInr.format(known)} reference`;
}

function currencyReferenceCell(usd, inr) {
  return { kind: "currency-reference", value: financialDisplay.optionalNumber(usd) === null ? "USD unavailable" : moneyUsd.format(usd), reference: inrReferenceDetail(inr) };
}

function escapeUiText(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function reportSummaryItem(label, options = {}) {
  const { value = "", valueKind = "text", usd, inr, detail = "" } = options;
  const displayValue = valueKind === "usd" ? (financialDisplay.optionalNumber(value) === null ? "USD unavailable" : moneyUsd.format(value)) : valueKind === "inr" ? formatInrReference(value) : value;
  const referenceDetail = detail || (Object.hasOwn(options, "inr") ? inrReferenceDetail(inr) : "");
  return {
    display: { label, value: displayValue, detail: referenceDetail },
    xlsx: { label, value, valueKind, usd, inr, detail: referenceDetail },
  };
}

function sumInrRows(rows, field) {
  return financialDisplay.sumKnown(rows, field);
}

function sumRows(rows, field) {
  return round(rows.reduce((total, row) => total + toNumber(row[field]), 0));
}

function payoutContractsText(payout) {
  return (payout.contracts || [])
    .map((contract) => `${contractName(contract.contractId)} — ${formatHours(contract.hours)} hrs @ ${moneyUsd.format(contract.rateUsd)}/hr${contract.exchangeRate ? `; FX ${number.format(contract.exchangeRate)}` : ""}`)
    .join("\n");
}

function reportFilename(tab, extension, month) {
  const names = {
    "records-time": "Time-Entries",
    "records-payments": "Incoming-Payments",
    "records-payouts": "Payouts",
    "records-expenses": "Expenses",
    "records-gst-rcm": "GST-RCM",
  };
  return `Payment-Tracker-${names[tab] || "Records"}-${month || "All-Records"}.${extension}`;
}

function selectedRecordRows(filters) {
  const filteredTimeEntries = data.timeEntries.filter((entry) => {
    if (filters.employeeId && entry.employeeId !== filters.employeeId) return false;
    if (filters.month && entry.weekStart?.slice(0, 7) !== filters.month) return false;
    return matchesSelectedWeek(entry.weekStart, entry.weekEnd, filters.week);
  });
  const filteredIncomingPayments = [...data.incomingPayments]
    .filter((payment) => !filters.month || payment.paymentDate?.slice(0, 7) === filters.month)
    .sort((a, b) => {
      const aPending = a.received === false;
      const bPending = b.received === false;
      if (aPending !== bPending) return aPending ? -1 : 1;
      const dateSort = String(b.paymentDate || "").localeCompare(String(a.paymentDate || ""));
      if (dateSort !== 0) return dateSort;
      return contractName(a.contractId).localeCompare(contractName(b.contractId));
    });
  const filteredPayouts = data.payouts.filter((payout) => {
    if (filters.employeeId && payout.employeeId !== filters.employeeId) return false;
    if (filters.month && payout.payoutDate?.slice(0, 7) !== filters.month) return false;
    const schedule = payoutSchedule(payout.payoutDate || `${payout.weekStart}T00:00:00`);
    return matchesSelectedWeek(schedule.workWeekStart, schedule.workWeekEnd, filters.week);
  });
  const filteredExpenses = data.expenses.filter((expense) => !filters.month || expense.expenseDate?.slice(0, 7) === filters.month);
  const gstIncoming = data.incomingPayments.filter(
    (payment) => payment.received !== false && (!filters.month || payment.paymentDate?.slice(0, 7) === filters.month) && payment.gstPayableUsd > 0,
  );
  const gstExpenses = data.expenses.filter(
    (expense) => (!filters.month || expense.expenseDate?.slice(0, 7) === filters.month) && normalizeGstMode(expense.gstMode) === "RCM" && expense.gstPayableUsd > 0,
  );
  return { filteredTimeEntries, filteredIncomingPayments, filteredPayouts, filteredExpenses, gstIncoming, gstExpenses };
}

function gstDisplayRecords(selected) {
  return financialDisplay.gstRecords(selected.gstIncoming, selected.gstExpenses).map(record => ({
    ...record,
    item: record.type === "Expense" ? byId(data.expenseTypes, record.expenseTypeId)?.name ?? record.label ?? "Expense" : contractName(record.contractId),
  }));
}

function renderGstRcm(selected) {
  const reportMonth = recordReportMonthValue();
  const period = reportMonth ? monthLabel.format(monthDate(reportMonth)) : "All records";
  const records = gstDisplayRecords(selected);
  const totals = financialDisplay.gstTotals(records);
  const summary = (label, usd, inr) => `<article><span>${label}</span><strong>${usd === null ? "USD unavailable" : moneyUsd.format(usd)}</strong><small>${inrReferenceDetail(inr)}</small></article>`;
  document.querySelector("#gst-rcm-summary").innerHTML = `<div class="report-summary">
    <article><span>Period</span><strong>${escapeUiText(period)}</strong></article>
    ${summary("Gross USD", totals.grossUsd, totals.grossInr)}
    ${summary("Service Charge USD", totals.serviceChargeUsd, totals.serviceChargeInr)}
    ${summary("Expense GST", totals.expenseGstUsd, totals.expenseGstInr)}
    ${summary("GST Payable", totals.gstUsd, totals.gstInr)}
  </div>`;
  const cell = (usd, inr) => `${usd === null ? "USD unavailable" : moneyUsd.format(usd)}<br><small class="inr-reference">${inrReferenceDetail(inr)}</small>`;
  const rows = records.map(record => [
    record.type, record.date, escapeUiText(record.transactionId || "-"), escapeUiText(record.item),
    cell(record.grossUsd, record.grossInr), record.type === "Expense" ? "-" : cell(record.serviceChargeUsd, record.serviceChargeInr),
    `<span class="pill warn">${escapeUiText(record.gstMode)}</span>`, cell(record.gstUsd, record.gstInr),
    record.exchangeRate === null ? "Unavailable" : number.format(record.exchangeRate),
  ]);
  document.querySelector("#gst-rcm-table").innerHTML = `<div class="report-head"><h4>Itemized GST RCM for ${escapeUiText(period)}</h4><p>Based on the incoming payment date and expense date. INR is a reference; unavailable values have not been inferred.</p></div>${table(["Type", "Date", "Txn ID", "Item", "Gross / INR", "Service Charge / INR", "GST Mode", "GST Payable / INR", "Exchange Rate"], rows)}`;
}

function buildRecordsReport(tab = currentRecordTab()) {
  const filters = currentRecordFilters();
  const month = filters.month;
  const period = month ? monthLabel.format(monthDate(month)) : "All records";
  const selected = selectedRecordRows(filters);
  const base = {
    applicationTitle: "ExamenQA Payment Tracker",
    period,
    generatedAt: new Date().toLocaleString(),
    pdfFilename: reportFilename(tab, "pdf", month),
    xlsxFilename: reportFilename(tab, "xlsx", month),
  };
  const makeReport = (title, sheetName, columns, rows, displayRows, summaries) => ({
    ...base,
    title,
    sheetName,
    columns,
    rows,
    displayRows,
    summary: summaries.map((item) => item.display),
    xlsxSummary: summaries.map((item) => item.xlsx),
  });

  if (tab === "records-time") {
    const rows = selected.filteredTimeEntries.map((entry) => [
      entry.weekStart,
      entry.weekEnd,
      employeeName(entry.employeeId),
      contractName(entry.contractId),
      toNumber(entry.hours),
      toNumber(entry.rateUsd),
      timeEntryNetTotal(entry),
      entry.notes || "",
    ]);
    return makeReport(
      "Time Entries",
      "Time Entries",
      [
        { label: "Week Start", kind: "date", width: 13 }, { label: "Week End", kind: "date", width: 13 }, { label: "Employee", width: 20 }, { label: "Contract", width: 32 },
        { label: "Hours", kind: "decimal", width: 12 }, { label: "Rate USD", kind: "usd", width: 14 }, { label: "Net USD", kind: "usd", width: 14 }, { label: "Notes", width: 32 },
      ],
      rows,
      rows.map((row) => [row[0], row[1], row[2], row[3], number.format(row[4]), moneyUsd.format(row[5]), moneyUsd.format(row[6]), row[7]]),
      [reportSummaryItem("Records", { value: rows.length, valueKind: "number" }), reportSummaryItem("Hours", { value: sumRows(selected.filteredTimeEntries, "hours"), valueKind: "decimal" }), reportSummaryItem("Net total", { value: rows.reduce((total, row) => total + row[6], 0), valueKind: "usd" })],
    );
  }

  if (tab === "records-payments") {
    const rows = selected.filteredIncomingPayments.map((payment) => [
      payment.workWeekStart || "", payment.workWeekEnd || "", payment.paymentDate, contractName(payment.contractId), toNumber(payment.grossUsd), toNumber(payment.exchangeRate),
      toNumber(payment.serviceChargeUsd), toNumber(payment.whtUsd), toNumber(payment.whtPercent), toNumber(payment.netUsd), financialDisplay.optionalNumber(payment.netInr), payment.gstMode || "NONE", toNumber(payment.gstPayableUsd), payment.received === false ? "Pending" : "Received", payment.transactionId || "", payment.notes || "",
    ]);
    return makeReport(
      "Incoming Payments",
      "Incoming Payments",
      [
        { label: "Week Start", kind: "date", width: 13 }, { label: "Week End", kind: "date", width: 13 }, { label: "Payment Date", kind: "date", width: 14 }, { label: "Contract", width: 28 }, { label: "Gross USD", kind: "usd", width: 14 }, { label: "FX Rate", kind: "decimal", width: 12 }, { label: "Service Charge USD", kind: "usd", width: 18 }, { label: "WHT USD", kind: "usd", width: 14 }, { label: "WHT %", kind: "decimal", width: 10 }, { label: "Net USD", kind: "usd", width: 14 }, { label: "Net INR", kind: "inr", width: 15 }, { label: "GST Mode", width: 14 }, { label: "GST Payable USD", kind: "usd", width: 18 }, { label: "Status", width: 12 }, { label: "Transaction ID", width: 18 }, { label: "Notes", width: 30 },
      ],
      rows,
      rows.map((row) => [row[0], row[1], row[2], row[3], moneyUsd.format(row[4]), number.format(row[5]), moneyUsd.format(row[6]), moneyUsd.format(row[7]), `${number.format(row[8])}%`, moneyUsd.format(row[9]), formatInrReference(row[10]), row[11], moneyUsd.format(row[12]), row[13], row[14], row[15]]),
      [reportSummaryItem("Records", { value: rows.length, valueKind: "number" }), reportSummaryItem("Gross income", { value: sumRows(selected.filteredIncomingPayments, "grossUsd"), valueKind: "usd" }), reportSummaryItem("Net received", { value: sumRows(selected.filteredIncomingPayments.filter((item) => item.received !== false), "netUsd"), valueKind: "usd", inr: sumInrRows(selected.filteredIncomingPayments.filter((item) => item.received !== false), "netInr") }), reportSummaryItem("Pending", { value: selected.filteredIncomingPayments.filter((item) => item.received === false).length, valueKind: "number" })],
    );
  }

  if (tab === "records-payouts") {
    const rows = selected.filteredPayouts.map((payout) => [
      payout.weekStart, payout.weekEnd, payout.payoutDate, employeeName(payout.employeeId), payoutContractsText(payout), toNumber(payout.totalUsd), financialDisplay.optionalNumber(payout.totalInr), payout.paid ? "Paid" : "Pending", payout.paidDate || "", payout.transactionId || "",
    ]);
    return makeReport(
      "Payouts",
      "Payouts",
      [
        { label: "Week Start", kind: "date", width: 13 }, { label: "Week End", kind: "date", width: 13 }, { label: "Payout Date", kind: "date", width: 14 }, { label: "Employee", width: 20 }, { label: "Contracts", width: 42 }, { label: "Payout USD", kind: "usd", width: 14 }, { label: "Payout INR", kind: "inr", width: 15 }, { label: "Status", width: 12 }, { label: "Paid Date", kind: "date", width: 14 }, { label: "Transaction ID", width: 18 },
      ],
      rows,
      rows.map((row) => [row[0], row[1], row[2], row[3], row[4], moneyUsd.format(row[5]), formatInrReference(row[6]), row[7], row[8], row[9]]),
      [reportSummaryItem("Records", { value: rows.length, valueKind: "number" }), reportSummaryItem("Total payouts", { value: sumRows(selected.filteredPayouts, "totalUsd"), valueKind: "usd", inr: sumInrRows(selected.filteredPayouts, "totalInr") }), reportSummaryItem("Paid", { value: selected.filteredPayouts.filter((item) => item.paid).length, valueKind: "number" }), reportSummaryItem("Pending", { value: selected.filteredPayouts.filter((item) => !item.paid).length, valueKind: "number" })],
    );
  }

  if (tab === "records-expenses") {
    const rows = selected.filteredExpenses.map((expense) => [
      expense.expenseDate, byId(data.expenseTypes, expense.expenseTypeId)?.name ?? expense.label ?? "Expense", expense.label || "", toNumber(expense.amountUsd), financialDisplay.optionalNumber(expense.amountInr), toNumber(expense.exchangeRate), expense.gstMode || "NONE", toNumber(expense.gstPercent), toNumber(expense.gstPayableUsd), financialDisplay.optionalNumber(expense.gstPayableInr), expense.notes || "",
    ]);
    return makeReport(
      "Expenses",
      "Expenses",
      [
        { label: "Expense Date", kind: "date", width: 14 }, { label: "Expense", width: 22 }, { label: "Transaction ID", width: 20 }, { label: "Amount USD", kind: "usd", width: 14 }, { label: "Amount INR", kind: "inr", width: 15 }, { label: "FX Rate", kind: "decimal", width: 12 }, { label: "GST Mode", width: 14 }, { label: "GST %", kind: "decimal", width: 10 }, { label: "GST Payable USD", kind: "usd", width: 18 }, { label: "GST Payable INR", kind: "inr", width: 18 }, { label: "Notes", width: 30 },
      ],
      rows,
      rows.map((row) => [row[0], row[1], row[2], moneyUsd.format(row[3]), formatInrReference(row[4]), number.format(row[5]), row[6], `${number.format(row[7])}%`, moneyUsd.format(row[8]), formatInrReference(row[9]), row[10]]),
      [reportSummaryItem("Records", { value: rows.length, valueKind: "number" }), reportSummaryItem("Expense total", { value: sumRows(selected.filteredExpenses, "amountUsd"), valueKind: "usd", inr: sumInrRows(selected.filteredExpenses, "amountInr") }), reportSummaryItem("RCM GST", { value: sumRows(selected.filteredExpenses, "gstPayableUsd"), valueKind: "usd", inr: sumInrRows(selected.filteredExpenses, "gstPayableInr") })],
    );
  }

  const records = gstDisplayRecords(selected);
  const totals = financialDisplay.gstTotals(records);
  const rows = records.map(record => [record.type, record.date, record.transactionId, record.item, record.grossUsd, record.grossInr, record.serviceChargeUsd, record.serviceChargeInr, record.gstMode, record.gstUsd, record.gstInr, record.exchangeRate]);
  return makeReport(
    "GST RCM",
    "GST RCM",
    [
      { label: "Type", width: 18, pdfNoWrap: true }, { label: "Date", kind: "date", width: 14, pdfNoWrap: true }, { label: "Transaction ID", width: 20 }, { label: "Item", width: 32 },
      { label: "Gross USD", kind: "usd", width: 14 }, { label: "Gross INR", kind: "inr", width: 16, pdfHidden: true },
      { label: "Service Charge USD", kind: "usd", width: 18 }, { label: "Service Charge INR", kind: "inr", width: 18, pdfHidden: true },
      { label: "GST Mode", width: 14 }, { label: "GST Payable USD", kind: "usd", width: 18 }, { label: "GST Payable INR", kind: "inr", width: 18, pdfHidden: true }, { label: "FX Rate", kind: "decimal", width: 12 },
    ],
    rows,
    rows.map(row => [row[0], row[1], row[2], row[3], currencyReferenceCell(row[4], row[5]), formatInrReference(row[5]), currencyReferenceCell(row[6], row[7]), formatInrReference(row[7]), row[8], currencyReferenceCell(row[9], row[10]), formatInrReference(row[10]), row[11] === null ? "Unavailable" : number.format(row[11])]),
    [reportSummaryItem("Records", { value: rows.length, valueKind: "number" }), reportSummaryItem("Gross total", { value: totals.grossUsd, valueKind: "usd", inr: totals.grossInr }), reportSummaryItem("Service charge", { value: totals.serviceChargeUsd, valueKind: "usd", inr: totals.serviceChargeInr }), reportSummaryItem("GST payable", { value: totals.gstUsd, valueKind: "usd", inr: totals.gstInr })],
  );
}

function showRecordsReportMessage(message = "", isError = false) {
  const target = document.querySelector("#records-report-message");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", isError);
}

async function runRecordsReportAction(action) {
  const report = buildRecordsReport();
  try {
    let result = null;
    if (action === "print") result = await window.tracker.printReport(report);
    if (action === "pdf") result = await window.tracker.exportReportPdf(report);
    if (action === "xlsx") result = await window.tracker.exportReportXlsx(report);
    if (!result) {
      showRecordsReportMessage("Export cancelled.");
      return;
    }
    showRecordsReportMessage(action === "print" ? "Print dialog opened." : `Saved ${report.rows.length} filtered record${report.rows.length === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error(`Records ${action} failed`, error);
    showRecordsReportMessage(`${action === "xlsx" ? "Excel export" : action === "pdf" ? "PDF export" : "Print"} failed. ${error.message || "Please try again."}`, true);
  }
}

function reconcilePayoutWorkPeriods(sourceData, entries = []) {
  const periodIds = new Set(entries.map(entry => `${entry.employeeId}|${entry.weekStart}|${entry.weekEnd}`));
  if (!periodIds.size) return sourceData;
  const paidIds = new Set(sourceData.payouts.filter(payout => payout.paid === true || sourceData.payoutPaymentStatus?.[payout.id]?.paid === true).map(payout => payout.id));
  for (const periodId of periodIds) {
    if (paidIds.has(periodId)) throw new Error("Paid work periods cannot be changed. A separately approved financial correction is required.");
  }
  const generated = buildGeneratedPayouts(sourceData, periodIds);
  sourceData.payouts = [...sourceData.payouts.filter(payout => !periodIds.has(payout.id)), ...generated]
    .sort((a, b) => `${b.weekStart}${b.employeeId}`.localeCompare(`${a.weekStart}${a.employeeId}`));
  return sourceData;
}

function refreshPendingPayoutFx(sourceData, contractIds = []) {
  const affected = new Set(contractIds);
  if (!affected.size) return sourceData;
  sourceData.payouts = sourceData.payouts.map(payout => {
    if (payout.paid === true || sourceData.payoutPaymentStatus?.[payout.id]?.paid === true || !payout.contracts?.some(line => affected.has(line.contractId))) return payout;
    const contracts = payout.contracts.map(line => {
      if (!affected.has(line.contractId)) return line;
      const exchangeRate = latestIncomingExchangeRate(sourceData, line.contractId);
      return { ...line, exchangeRate, totalInr: exchangeRate && financialDisplay.optionalNumber(line.totalUsd) !== null ? round(line.totalUsd * exchangeRate) : null };
    });
    const next = { ...payout, contracts, totalInr: financialDisplay.sumKnown(contracts, line => line.totalInr) };
    next.note = buildPayoutNote(next);
    return next;
  });
  return sourceData;
}

async function save(nextData = data, options = {}) {
  const { payoutWorkPeriods = [], payoutFxContracts = [], ...storageOptions } = options;
  const candidate = structuredClone(nextData);
  reconcilePayoutWorkPeriods(candidate, payoutWorkPeriods);
  refreshPendingPayoutFx(candidate, payoutFxContracts);
  data = await window.tracker.saveData(candidate, storageOptions);
  render();
}

function historicalSelectChoice(select, selected) {
  if (!selected) return null;
  const form = select.form || select.closest?.("form");
  const editId = form?.elements.editId?.value;
  const collections = { "time-form": "timeEntries", "contract-form": "contracts", "expense-form": "expenses" };
  const original = editId && collections[form.id] ? byId(data[collections[form.id]], editId) : null;
  if (!original) return null;
  const expected = select.name === "contractId" ? original.contractId || "__agency__" : original[select.name];
  if (expected !== selected) return null;
  const type = select.dataset.options;
  if (["contracts", "employee-contracts", "payroll-contracts"].includes(type)) return [selected, `${contractName(selected)} (historical selection)`];
  const collection = { employees: "employees", sources: "sources", clients: "clients", "source-clients": "clients", "expense-types": "expenseTypes" }[type];
  const item = collection ? byId(data[collection], selected) : null;
  return collection ? [selected, `${item?.name || `Unknown ${collection}`} (historical selection)`] : null;
}

function fillSelects() {
  document.querySelectorAll("select[data-options]").forEach((select) => {
    const type = select.dataset.options;
    const selected = select.dataset.editValue ?? select.value;
    delete select.dataset.editValue;
    let options = [];

    if (type === "clients") options = data.clients.filter((item) => isActiveSetupItem("clients", item)).map((item) => [item.id, item.name]);
    if (type === "sources") options = data.sources.filter((item) => isActiveSetupItem("sources", item)).map((item) => [item.id, item.name]);
    if (type === "source-clients") {
      const sourceId = document.querySelector("#contract-form select[name='sourceId']")?.value;
      options = data.clients
        .filter((item) => isActiveSetupItem("clients", item) && (!sourceId || !item.sourceId || item.sourceId === sourceId))
        .map((item) => [item.id, item.name]);
    }
    if (type === "employees") options = data.employees.filter((item) => isActiveSetupItem("employees", item)).map((item) => [item.id, item.name]);
    if (type === "contracts") options = data.contracts.filter((item) => isActiveSetupItem("contracts", item)).map((item) => [item.id, contractName(item.id)]);
    if (type === "payroll-contracts") {
      options = [...data.contracts.filter((item) => isActiveSetupItem("contracts", item)).map((item) => [item.id, contractName(item.id)]), ["__agency__", "Agency Payroll"]];
    }
    if (type === "employee-contracts") {
      const employeeId = document.querySelector("#time-form select[name='employeeId']")?.value;
      options = employeeContractOptions(employeeId);
    }
    if (type === "expense-types") options = data.expenseTypes.filter((item) => isActiveSetupItem("expenseTypes", item)).map((item) => [item.id, item.name]);
    if (!options.some(([value]) => value === selected)) {
      const historical = historicalSelectChoice(select, selected);
      if (historical) options.push(historical);
    }

    const placeholder = select.dataset.placeholder || "";
    const label =
      type === "sources"
        ? "Select source or click Add"
        : type === "expense-types"
          ? "Select expense or click Add"
          : `Select ${type.replace("-", " ")}`;
    const baseOptions = options.length
      ? options.map(([value, text]) => `<option value="${escapeUiText(value)}">${escapeUiText(text)}</option>`).join("")
      : `<option value="">${placeholder || label}</option>`;
    const selectionUnavailable = selected && !options.some(([value]) => value === selected);
    select.innerHTML = placeholder || selectionUnavailable
      ? `<option value="">${escapeUiText(placeholder || label)}</option>${options
          .map(([value, text]) => `<option value="${escapeUiText(value)}">${escapeUiText(text)}</option>`)
          .join("")}`
      : baseOptions;

    if (options.some(([value]) => value === selected)) select.value = selected;
    else if (selectionUnavailable) select.value = "";
  });
  syncTimePreview();
}

function renderStats() {
  const periodType = overviewPeriodType();
  const monthAnchor = monthDate(overviewMonthValue());
  const range = overviewPeriodRange(periodType, monthAnchor);
  const periodLabel = overviewPeriodLabel(periodType, range);
  const receivedIncoming = data.incomingPayments.filter((item) => item.received !== false && inDateRange(item.paymentDate, range));
  const outstandingIncoming = buildIncomingQueueRows(data).filter((item) => item.received === false);
  const periodExpenses = data.expenses.filter((item) => inDateRange(item.expenseDate, range));
  const periodPayouts = data.payouts.filter((item) => item.paid === true && inDateRange(item.paidDate || item.payoutDate, range));
  const pendingPayouts = data.payouts.filter((item) => item.paid !== true);
  const periodPendingPayouts = calculations.pendingPayoutsForPeriod(pendingPayouts, range);

  const receivedGrossUsd = receivedIncoming.reduce((sum, item) => sum + (item.grossUsd || 0), 0);
  const receivedGrossInr = receivedIncoming.reduce((sum, item) => sum + (item.grossUsd || 0) * (item.exchangeRate || 0), 0);
  const agencyReferenceRate = receivedGrossUsd > 0 ? receivedGrossInr / receivedGrossUsd : latestReceivedIncomingExchangeRate(data) || 0;
  const metrics = calculations.calculateOverviewMetrics({
    receivedIncoming,
    outstandingIncoming,
    periodPayouts,
    pendingPayouts,
    periodPendingPayouts,
    periodExpenses,
    estimatedRateFor: (item) => estimatedIncomingExchangeRate(data, item),
    referenceRate: agencyReferenceRate,
  });
  const {
    grossIncomeUsd,
    grossIncomeInr,
    deductionsUsd,
    deductionsInr,
    netIncomeUsd,
    netIncomeInr,
    outstandingIncomingUsd,
    outstandingIncomingInr,
    outstandingRateCoverage,
    payoutsPaidUsd,
    payoutsPaidInr,
    pendingPayoutsUsd,
    pendingPayoutsInr,
    expensesUsd,
    expensesInr,
    gstRcmUsd,
    gstRcmInr,
    agencyGainsUsd,
    agencyGainsInr,
  } = metrics;
  // Keep the established totals/formulas, but do not label an incomplete INR
  // aggregate as a real zero or a complete reference amount.
  const hasStoredInr = (rows, usdField, inrField) => rows.every(item =>
    financialDisplay.optionalNumber(item[inrField]) !== null || financialDisplay.optionalNumber(item[usdField]) === 0);
  const hasFxReference = (rows, usdFor) => rows.every(item =>
    financialDisplay.optionalNumber(usdFor(item)) === 0 || financialDisplay.referenceFromFx(usdFor(item), item.exchangeRate) !== null);
  const reference = (value, complete) => complete ? inrReferenceDetail(value) : "INR unavailable";
  const grossReferenceComplete = hasFxReference(receivedIncoming, item => item.grossUsd);
  const outstandingReferenceComplete = outstandingIncoming.every(item => toNumber(item.netUsd) === 0 || toNumber(estimatedIncomingExchangeRate(data, item)) > 0);
  const agencyReferenceComplete = agencyGainsUsd === 0 || (agencyReferenceRate > 0 && (receivedGrossUsd > 0 ? grossReferenceComplete : true));
  const outstandingIncomingEstimate = { total: outstandingIncomingInr, count: outstandingRateCoverage };
  const outstandingIncomingValue = outstandingIncoming.length ? moneyUsd.format(outstandingIncomingUsd) : "Nill";
  const outstandingIncomingHelper = outstandingIncoming.length
    ? `Includes all outstanding payments across all periods. ${outstandingIncoming.length} pending · ${outstandingReferenceComplete && outstandingIncomingEstimate.count ? `${moneyInr.format(outstandingIncomingInr)} estimated reference` : "INR unavailable"}`
    : "Includes all outstanding payments across all periods. 0 pending · N/A estimated reference";

  const cards = [
      ["Gross Income", moneyUsd.format(grossIncomeUsd), reference(grossIncomeInr, grossReferenceComplete)],
      [
        "Outstanding Incoming",
        outstandingIncomingValue,
        outstandingIncomingHelper,
      ],
      ["Deductions", moneyUsd.format(deductionsUsd), reference(deductionsInr, hasFxReference(receivedIncoming, item => toNumber(item.serviceChargeUsd) + toNumber(item.whtUsd)))],
      ["Net Income", moneyUsd.format(netIncomeUsd), reference(netIncomeInr, hasStoredInr(receivedIncoming, "netUsd", "netInr"))],
      ["Payouts Paid", moneyUsd.format(payoutsPaidUsd), reference(payoutsPaidInr, hasStoredInr(periodPayouts, "totalUsd", "totalInr"))],
      ["Pending Payouts", moneyUsd.format(pendingPayoutsUsd), `${reference(pendingPayoutsInr, hasStoredInr(pendingPayouts, "totalUsd", "totalInr"))} · Includes all unpaid team payouts across all periods.`],
      ["Expenses", moneyUsd.format(expensesUsd), reference(expensesInr, hasStoredInr(periodExpenses, "amountUsd", "amountInr"))],
      ["RCM GST Payable", moneyUsd.format(gstRcmUsd), reference(gstRcmInr, hasStoredInr([...receivedIncoming, ...periodExpenses], "gstPayableUsd", "gstPayableInr"))],
      ["Agency Gains", moneyUsd.format(agencyGainsUsd), reference(agencyGainsInr, agencyReferenceComplete)],
  ];

  const stats = document.querySelector("#stats");
  if (!stats) return;
  stats.innerHTML = cards
    .map(
      ([label, value, helper]) => `
        <article class="stat stat-large">
          <span>${label}</span>
          <strong>${value}</strong>
          <small>${helper}</small>
        </article>
      `,
    )
    .join("");

  const overviewPeriods = document.querySelector("#overview-periods");
  if (overviewPeriods) {
    overviewPeriods.querySelectorAll("[data-overview-period]").forEach((button) => {
      button.classList.toggle("active", button.dataset.overviewPeriod === periodType);
    });
  }

  const overviewTitle = document.querySelector(".overview-title .report-note");
  if (overviewTitle) {
    overviewTitle.textContent = `${periodLabel} summary. Incoming payments, paid payouts, expenses, and GST use the selected period; outstanding incoming and pending payouts include all periods.`;
  }

  const overviewMonthInput = document.querySelector("#overview-month");
  if (overviewMonthInput && !overviewMonthInput.value) {
    overviewMonthInput.value = currentMonth();
  }
}

function table(headers, rows) {
  if (!rows.length) return `<div class="empty">No records yet.</div>`;
  return `
      <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows
          .map((row) => {
            const cells = Array.isArray(row) ? row : row.cells;
            const attrs = Array.isArray(row) || !row.attrs ? "" : ` ${row.attrs}`;
            return `<tr${attrs}>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
          })
          .join("")}</tbody>
        <tfoot>
          <tr>
            <td class="table-footer-cell" colspan="${headers.length}"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

async function removeItem(collectionName, itemId, label) {
  const lifecycle = window.PaymentTrackerSetupLifecycle;
  const item = data[collectionName]?.find(row => row.id === itemId);
  if (!item) return;
  if (collectionName === "timeEntries" && paidPayoutsAffectedByWorkChange(item, null).length) {
    alert("Paid work periods require a separately approved correction; notes-only edits remain allowed.");
    return;
  }
  if (!lifecycle) {
    alert("Setup safety checks could not load. Restart the app before deleting records.");
    return;
  }
  if (lifecycle.archivableCollections.includes(collectionName)) {
    const counts = lifecycle.dependencyCounts(data, collectionName, itemId);
    const names = { clients: "clients", contracts: "contracts", employeeRates: "employee rates", timeEntries: "weekly work entries", incomingPayments: "incoming payments", payouts: "payouts", expenses: "expenses", weeklyFxRates: "weekly FX rates", weeklyProgress: "week progress markers" };
    const summary = Object.entries(counts).map(([name, count]) => `${count} ${names[name] || name}`).join(", ");
    if (summary) {
      if (item.archived) {
        alert(`This item cannot be deleted because it has linked history: ${summary}. It is already archived; its history is preserved.`);
      } else if (confirm(`Cannot delete ${label}: linked records include ${summary}.\n\nArchive this item instead? Its records and financial history will stay unchanged, and it will be hidden from new-entry choices. You can restore it later.`)) {
        await setSetupArchived(collectionName, itemId, true);
      }
      return;
    }
  }
  const detail = lifecycle.archivableCollections.includes(collectionName) ? "No linked financial history will be removed. " : "";
  if (!confirm(`Delete ${label}? ${detail}A backup is created before saving. This cannot be undone in this screen.`)) return;
  const nextData = structuredClone(data);
  nextData[collectionName] = nextData[collectionName].filter(row => row.id !== itemId);
  if (collectionName === "timeEntries") nextData.weeklyProgress = weeklyProgress.invalidateForWorkChange(nextData, item, null);
  try {
    await save(nextData, { backupReason: "destructive", payoutWorkPeriods: collectionName === "timeEntries" ? [item] : [] });
  } catch (error) {
    alert(`Delete failed. ${error.message || "Please try again."}`);
  }
}

async function setSetupArchived(collectionName, itemId, archived) {
  if (!window.PaymentTrackerSetupLifecycle?.archivableCollections.includes(collectionName)) return;
  const nextData = structuredClone(data);
  const item = nextData[collectionName].find(row => row.id === itemId);
  if (!item) return;
  if (archived) item.archived = true;
  else delete item.archived;
  try {
    await save(nextData, { backupReason: "destructive" });
  } catch (error) {
    alert(`${archived ? "Archive" : "Restore"} failed. ${error.message || "Please try again."}`);
  }
}

function removeContractChildren(contractIds) {
  data.employeeRates = data.employeeRates.filter((item) => !contractIds.includes(item.contractId));
  data.timeEntries = data.timeEntries.filter((item) => !contractIds.includes(item.contractId));
  data.incomingPayments = data.incomingPayments.filter((item) => !contractIds.includes(item.contractId));
  data.payouts = data.payouts.filter((item) => !contractIds.includes(item.contractId));
  data.expenses = data.expenses.filter((item) => !contractIds.includes(item.contractId));
}

function deleteButton(collectionName, itemId, label) {
  return `<button class="danger-button" data-delete="${collectionName}" data-id="${itemId}" data-label="${label}">Delete</button>`;
}

function editButton(collectionName, itemId, label) {
  return `<button class="secondary-button" data-edit="${collectionName}" data-id="${itemId}" data-label="${label}">Edit</button>`;
}

function copyPayoutButton(itemId) {
  return `<button class="secondary-button" data-copy-payout="${itemId}">Copy Note</button>`;
}

function payoutPaidButton(payout) {
  return `<button class="secondary-button" data-payout-paid="${payout.id}">${payout.paid ? "Update Paid" : "Paid"}</button>`;
}

function payoutStatusPill(payout) {
  const label = payout.paid ? "Paid" : "Pending";
  const klass = payout.paid ? "" : "warn";
  const meta = payout.paid
    ? `<br><small>${payout.paidDate || payout.payoutDate}${payout.transactionId ? `<br>${payout.transactionId}` : ""}</small>`
    : "";
  return `<span class="pill ${klass}">${label}</span>${meta}`;
}

function payoutPaidSummary(payout) {
  if (!payout.paid) return "-";
  const dateLine = payout.paidDate || payout.payoutDate;
  return `${dateLine}${payout.transactionId ? `<br><small>${payout.transactionId}</small>` : ""}`;
}

function payoutTransactionSummary(payout) {
  return payout.transactionId || "-";
}

function openPayoutPaidDialog(payout, onSave) {
  const modal = document.querySelector("#payout-paid-modal");
  if (!modal) return Promise.resolve(null);

  const question = modal.querySelector("#payout-paid-question");
  const lateFields = modal.querySelector("#payout-paid-late-fields");
  const paidDateInput = modal.querySelector("#payout-paid-date");
  const txnInput = modal.querySelector("#payout-paid-transaction");
  const yesButton = modal.querySelector("#payout-paid-yes");
  const noButton = modal.querySelector("#payout-paid-no");
  const saveButton = modal.querySelector("#payout-paid-save");

  if (!question || !txnInput || !lateFields || !paidDateInput || !yesButton || !noButton || !saveButton) {
    return Promise.resolve(null);
  }

  let feedback = modal.querySelector("#payout-paid-message");
  if (!feedback) {
    feedback = document.createElement("p");
    feedback.id = "payout-paid-message";
    feedback.className = "inline-message";
    (saveButton.parentElement || modal).append(feedback);
  }
  feedback.setAttribute("role", "alert");
  feedback.textContent = "";
  let saving = false;

  question.textContent = `Did you pay this payout on the scheduled date (${payout.payoutDate})?`;
  txnInput.value = payout.transactionId || "";
  paidDateInput.value = payout.paidDate || payout.payoutDate;
  paidDateInput.setCustomValidity("");
  let paymentMode = payout.paidDate && payout.paidDate !== payout.payoutDate ? "no" : "yes";
  lateFields.classList.toggle("hidden", paymentMode === "yes");
  saveButton.textContent = "Save Payment";

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  paidDateInput.value = payout.paidDate || payout.payoutDate;

  return new Promise((resolve) => {
    const handleBackdrop = (event) => {
      if (event.target === modal && !saving) cleanup(null);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape" && !saving) cleanup(null);
    };
    const cleanup = (result) => {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      yesButton.removeEventListener("click", handleYes);
      noButton.removeEventListener("click", handleNo);
      saveButton.removeEventListener("click", handleSave);
      modal.removeEventListener("click", handleBackdrop);
      window.removeEventListener("keydown", handleKeydown);
      resolve(result);
    };

    const handleYes = () => {
      if (saving) return;
      paymentMode = "yes";
      lateFields.classList.add("hidden");
    };

    const handleNo = () => {
      if (saving) return;
      paymentMode = "no";
      lateFields.classList.remove("hidden");
      paidDateInput.focus();
    };

    const handleSave = async () => {
      if (saving) return;
      const paidDate = paymentMode === "yes" || lateFields.classList.contains("hidden") ? payout.payoutDate : paidDateInput.value;
      paidDateInput.setCustomValidity("");
      if (!paidDate) {
        paidDateInput.setCustomValidity("Enter the actual paid date.");
        paidDateInput.reportValidity();
        paidDateInput.focus();
        return;
      }
      const result = {
        paidDate,
        transactionId: txnInput.value.trim(),
      };
      saving = true;
      [yesButton, noButton, saveButton, paidDateInput, txnInput].forEach((control) => { control.disabled = true; });
      saveButton.textContent = "Saving…";
      feedback.textContent = "";
      try {
        if (onSave) await onSave(result);
        cleanup(result);
      } catch (error) {
        feedback.textContent = `Payment was not saved. ${error.message || "Please retry."} Your entered date and transaction are kept; retry after resolving the storage problem.`;
      } finally {
        saving = false;
        [yesButton, noButton, saveButton, paidDateInput, txnInput].forEach((control) => { control.disabled = false; });
        saveButton.textContent = "Save Payment";
      }
    };

    yesButton.addEventListener("click", handleYes);
    noButton.addEventListener("click", handleNo);
    saveButton.addEventListener("click", handleSave);
    modal.addEventListener("click", handleBackdrop);
    window.addEventListener("keydown", handleKeydown);
  });
}

function openIncomingReceivedDateDialog(sourceRow) {
  const modal = document.querySelector("#incoming-received-modal");
  if (!modal) return Promise.resolve(null);

  const question = modal.querySelector("#incoming-received-question");
  const dateInputField = modal.querySelector("#incoming-received-date");
  const saveButton = modal.querySelector("#incoming-received-save");
  const cancelButton = modal.querySelector("#incoming-received-cancel");

  if (!question || !dateInputField || !saveButton || !cancelButton) {
    return Promise.resolve(null);
  }

  question.textContent = `Enter the actual received date for ${sourceRow.contractLabel}.`;
  dateInputField.value = sourceRow.paymentDate || dateInput(new Date());

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  dateInputField.focus();

  return new Promise((resolve) => {
    const handleBackdrop = (event) => {
      if (event.target === modal) cleanup(null);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") cleanup(null);
    };
    const cleanup = (result) => {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      saveButton.removeEventListener("click", handleSave);
      cancelButton.removeEventListener("click", handleCancel);
      modal.removeEventListener("click", handleBackdrop);
      window.removeEventListener("keydown", handleKeydown);
      resolve(result);
    };
    const handleSave = () => {
      if (!dateInputField.value) {
        dateInputField.focus();
        return;
      }
      cleanup({ receivedDate: dateInputField.value });
    };
    const handleCancel = () => cleanup(null);

    saveButton.addEventListener("click", handleSave);
    cancelButton.addEventListener("click", handleCancel);
    modal.addEventListener("click", handleBackdrop);
    window.addEventListener("keydown", handleKeydown);
  });
}

function setupStateBadge(collection, item) {
  if (item.archived === true) return ' <span class="pill warn">Archived</span>';
  return isActiveSetupItem(collection, item) ? "" : ' <span class="pill warn">Unavailable parent</span>';
}

function setupItemAction(collection, item, label) {
  return item.archived === true
    ? `<button class="secondary-button" type="button" data-restore-collection="${collection}" data-id="${escapeUiText(item.id)}">Restore</button>`
    : deleteButton(collection, item.id, label);
}

function renderTables() {
  fillRecordFilters();
  const filters = currentRecordFilters();
  const selected = selectedRecordRows(filters);

  document.querySelector("#sources-table").innerHTML = table(
    ["Source", "Action"],
    data.sources.map((source) => [`${escapeUiText(source.name)}${setupStateBadge("sources", source)}`, setupItemAction("sources", source, source.name)]),
  );

  document.querySelector("#clients-table").innerHTML = table(
    ["Client", "Source", "Action"],
    data.clients.map((client) => [
      `${escapeUiText(client.name)}${setupStateBadge("clients", client)}`,
      byId(data.sources, client.sourceId)?.name ?? "-",
      setupItemAction("clients", client, client.name),
    ]),
  );

  document.querySelector("#employees-table").innerHTML = table(
    ["Employee", "Contact", "Bank", "Action"],
    data.employees.map((employee) => [
      `${escapeUiText(employee.name)}${setupStateBadge("employees", employee)}${employee.notes ? `<br>${escapeUiText(employee.notes)}` : ""}`,
      `${employee.email || "-"}<br>${employee.phone || "-"}`,
      `${employee.bankName || "-"}<br>A/C: ${employee.bankAccount || "-"}<br>IFSC: ${employee.ifsc || "-"}`,
      `${editButton("employees", employee.id, employee.name)} ${setupItemAction("employees", employee, employee.name)}`,
    ]),
  );

  document.querySelector("#rates-table").innerHTML = table(
    ["Employee", "Contract", "Rate", "Mode", "Action"],
    data.employeeRates.map((rate) => [
      `${escapeUiText(employeeName(rate.employeeId))}${setupStateBadge("employeeRates", rate)}`,
      contractName(rate.contractId),
      moneyUsd.format(rate.rateUsd),
      rate.noAgencyCut ? `<span class="pill warn">No cut</span>` : `<span class="pill">Standard</span>`,
      setupItemAction("employeeRates", rate, "employee rate"),
    ]),
  );

  document.querySelector("#expense-types-table").innerHTML = table(
    ["Expense", "Action"],
    data.expenseTypes.map((expenseType) => [`${escapeUiText(expenseType.name)}${setupStateBadge("expenseTypes", expenseType)}`, setupItemAction("expenseTypes", expenseType, expenseType.name)]),
  );

  document.querySelector("#contracts-table").innerHTML = table(
    ["Short Name", "Source", "Type", "Price", "Notes", "Action"],
    data.contracts.map((contract) => {
      const source = byId(data.sources, contract.sourceId);
      return [
        `${escapeUiText(contractName(contract.id))}${setupStateBadge("contracts", contract)}`,
        source?.name ?? "-",
        `${contract.priceType}<br><span class="pill">${contract.serviceChargeMode ?? "NONE"}</span>`,
        `${moneyUsd.format(contract.priceUsd)}<br>Fee: ${number.format(contract.serviceChargePercent ?? 0)}%`,
        contract.notes || "-",
        `${editButton("contracts", contract.id, contract.shortName || contract.name || "contract")} ${setupItemAction("contracts", contract, contract.shortName || contract.name || "contract")}`,
      ];
    }),
  );

  document.querySelector("#generated-payouts-table").innerHTML = table(
    ["Payout Date", "Work Week", "Employee", "Contracts", "USD", "INR", "Paid Date", "Txn ID", "Status", "Action"],
    data.payouts.map((payout) => [
      payout.payoutDate,
      `${payout.weekStart} to ${payout.weekEnd}`,
      employeeName(payout.employeeId),
      payout.contracts
        .map(
          (contract) =>
            `${contractName(contract.contractId)}<br>${formatHours(contract.hours)} hrs @ ${moneyUsd.format(contract.rateUsd)}/hr`,
        )
        .join("<hr>"),
      moneyUsd.format(payout.totalUsd),
      formatInrReference(payout.totalInr),
      payoutPaidSummary(payout),
      payoutTransactionSummary(payout),
      payoutStatusPill(payout),
      `${payoutPaidButton(payout)} ${copyPayoutButton(payout.id)}`,
    ]),
  );

  const filteredTimeEntries = selected.filteredTimeEntries;

  document.querySelector("#time-table").innerHTML = table(
    ["Week", "Employee", "Contract", "Hours", "Total", "Action"],
    filteredTimeEntries.map((entry) => {
      const totalUsd = timeEntryNetTotal(entry);
      return [
        `${entry.weekStart} to ${entry.weekEnd}`,
        employeeName(entry.employeeId),
        contractName(entry.contractId),
        number.format(entry.hours),
        moneyUsd.format(totalUsd),
        `${editButton("timeEntries", entry.id, "time entry")} ${deleteButton("timeEntries", entry.id, "time entry")}`,
      ];
    }),
  );

  const filteredIncomingPayments = selected.filteredIncomingPayments;

  document.querySelector("#payments-table").innerHTML = table(
    ["Work Week", "Date", "Contract", "Gross", "Charge", "WHT", "Net", "GST", "Status", "Action"],
    filteredIncomingPayments.map((payment) => [
      payment.workWeekStart && payment.workWeekEnd ? `${payment.workWeekStart} to ${payment.workWeekEnd}` : "-",
      payment.paymentDate,
      contractName(payment.contractId),
      moneyUsd.format(payment.grossUsd),
      moneyUsd.format(payment.serviceChargeUsd),
      `${moneyUsd.format(payment.whtUsd)}<br>${payment.whtPercent ?? 0}%`,
      `${moneyUsd.format(payment.netUsd)}<br>${formatInrReference(payment.netInr)}`,
       `<span class="pill ${normalizeGstMode(payment.gstMode) === "RCM" ? "warn" : ""}">${payment.gstMode}</span><br>${moneyUsd.format(payment.gstPayableUsd)}`,
      payment.received === false ? `<span class="pill warn">Pending</span>` : `<span class="pill">Received</span>`,
      `${editButton("incomingPayments", payment.id, "payment")} ${deleteButton("incomingPayments", payment.id, "payment")}`,
    ]),
  );

  const filteredPayouts = selected.filteredPayouts;

  document.querySelector("#payouts-table").innerHTML = table(
    ["Work Week", "Employee", "Contracts", "USD", "INR", "Paid Date", "Txn ID", "Status", "Action"],
    filteredPayouts.map((payout) => [
      `${payout.weekStart} to ${payout.weekEnd}<br>${payout.payoutDate}`,
      employeeName(payout.employeeId),
      payout.contracts
        .map(
          (contract) =>
            `${contractName(contract.contractId)}<br>${formatHours(contract.hours)} hrs @ ${moneyUsd.format(contract.rateUsd)}/hr<br>FX ${contract.exchangeRate ? moneyInr.format(contract.exchangeRate) : "N/A"}`,
        )
        .join("<hr>"),
      moneyUsd.format(payout.totalUsd),
      formatInrReference(payout.totalInr),
      payoutPaidSummary(payout),
      payoutTransactionSummary(payout),
      payoutStatusPill(payout),
      `${payoutPaidButton(payout)} ${copyPayoutButton(payout.id)}`,
    ]),
  );

  const filteredExpenses = selected.filteredExpenses;

  document.querySelector("#expenses-table").innerHTML = table(
    ["Date", "Expense", "Transaction ID", "Amount", "GST", "Action"],
    filteredExpenses.map((expense) => [
      expense.expenseDate,
      `${byId(data.expenseTypes, expense.expenseTypeId)?.name ?? expense.label ?? "Expense"}${expense.label ? `<br>${expense.label}` : ""}`,
      expense.label || "-",
      `${moneyUsd.format(expense.amountUsd)}<br>${formatInrReference(expense.amountInr)}`,
       `<span class="pill ${normalizeGstMode(expense.gstMode) === "RCM" ? "warn" : ""}">${expense.gstMode}</span><br>${moneyUsd.format(expense.gstPayableUsd)}`,
      `${editButton("expenses", expense.id, "expense")} ${deleteButton("expenses", expense.id, "expense")}`,
    ]),
  );

  renderGstRcm(selected);
}

function renderAnalytics() {
  const panel = document.querySelector("#analytics-panel");
  if (!panel || !window.PaymentTrackerAnalyticsUI || !window.PaymentTrackerAnalytics) return null;
  if (!analyticsDataReady) {
    panel.innerHTML = '<h2>Analytics</h2><p>Analytics is unavailable until a valid data file loads. Use the recovery controls to retry or choose a data file.</p>';
    return null;
  }
  if (!analyticsController) {
    analyticsController = window.PaymentTrackerAnalyticsUI.createController(panel, {
      getData: () => data,
      getIncomingRows: () => buildIncomingQueueRows(data),
      isAvailable: () => analyticsDataReady,
    });
  }
  try {
    return analyticsController.render();
  } catch (error) {
    console.error("Analytics render failed", error);
    panel.innerHTML = '<h2>Analytics</h2><p>Analytics could not load. Source records have not been changed.</p>';
    return null;
  }
}

function render() {
  fillSelects();
  restoreWorkContext();
  renderWeeklyProgress();
  try {
    renderIncomingQueue();
  } catch (error) {
    console.error("Incoming queue render failed", error);
    const container = document.querySelector("#incoming-queue");
    if (container) container.innerHTML = `<div class="empty">Incoming queue could not load.</div>`;
  }
  try {
    renderStats();
  } catch (error) {
    console.error("Stats render failed", error);
  }
  try {
    renderTables();
  } catch (error) {
    console.error("Tables render failed", error);
  }
  if (analyticsController || document.querySelector('[data-tab-target="analytics"].active')) renderAnalytics();
}

function reset(form) {
  const retainedWorkContext = form.id === "time-form" ? currentWorkContext() : null;
  form.reset();
  form.elements.editId && (form.elements.editId.value = "");
  document.querySelector("#new-source-fields")?.classList.add("hidden");
  document.querySelector("#new-client-fields")?.classList.add("hidden");
  document.querySelector("#new-expense-type-fields")?.classList.add("hidden");
  if (form.id === "payment-form") {
    form.dataset.serviceManual = "false";
    form.elements.received && (form.elements.received.checked = true);
  }
  if (retainedWorkContext) {
    form.elements.employeeId.value = isActiveSetupItem("employees", retainedWorkContext.employeeId) ? retainedWorkContext.employeeId : "";
    fillSelects();
    form.elements.contractId.value = employeeContractOptions(form.elements.employeeId.value).some(([value]) => value === retainedWorkContext.contractId) ? retainedWorkContext.contractId : "";
    form.elements.weekStart.value = retainedWorkContext.weekStart;
    form.elements.weekEnd.value = retainedWorkContext.weekEnd;
    ["hours", "notes", "editId"].forEach((field) => { form.elements[field].value = ""; });
    clearTimeValidation();
    weeklyHistoryAnchor = retainedWorkContext.weekStart;
    persistWorkContext();
    renderWeeklyProgress();
  }
  if (form.id === "payment-form") { setIncomingWeek(); syncIncomingDraft(); }
  if (form.id === "payout-form") setDefaultPayoutWeek();
  fillSelects();
  if (form.id === "rate-form") syncRateForm();
}

function setDefaultWeek() {
  const form = document.querySelector("#time-form");
  if (!form) return;
  const week = currentWeek();
  form.elements.weekStart.value = week.weekStart;
  form.elements.weekEnd.value = week.weekEnd;
  if (workContextRestored) updateWorkContext();
}

function shiftWeek(days) {
  const form = document.querySelector("#time-form");
  if (!form) return;
  form.elements.weekStart.value = shiftDate(form.elements.weekStart.value, days);
  form.elements.weekEnd.value = shiftDate(form.elements.weekEnd.value, days);
  updateWorkContext();
}

function setIncomingWeek(anchorDate = new Date()) {
  const form = document.querySelector("#payment-form");
  if (!form) return;
  const week = weekForDate(anchorDate);
  form.elements.workWeekStart.value = week.weekStart;
  form.elements.workWeekEnd.value = week.weekEnd;
}

function shiftIncomingWeek(days) {
  const form = document.querySelector("#payment-form");
  if (!form) return;
  const currentStart = form.elements.workWeekStart.value ? new Date(`${form.elements.workWeekStart.value}T00:00:00`) : new Date();
  currentStart.setDate(currentStart.getDate() + days);
  setIncomingWeek(currentStart);
  syncIncomingDraft();
}

function syncIncomingDraft() {
  const form = document.querySelector("#payment-form");
  if (!form) return;
  const contractId = form.elements.contractId.value;
  const workWeekStart = form.elements.workWeekStart.value;
  const workWeekEnd = form.elements.workWeekEnd.value;
  const editId = form.elements.editId?.value || "";
  const draft = incomingDraft(contractId, workWeekStart, workWeekEnd);
  const upwork = isUpworkContract(contractId);
  const serviceManual = form.dataset.serviceManual === "true";

  if (!form.elements.paymentDate.value) {
    form.elements.paymentDate.value = dateInput(new Date());
  }

  form.elements.grossUsd.value = draft.grossUsd.toFixed(2);
  form.elements.whtPercent.value = draft.whtPercent ? draft.whtPercent : "";
  form.elements.gstMode.value = draft.gstMode;
  form.elements.gstPercent.value = draft.gstPercent;

  if (!editId || !form.elements.notes.value) {
    form.elements.notes.value = draft.notes;
  }

  form.elements.paymentDate.readOnly = true;
  form.elements.grossUsd.readOnly = true;
  form.elements.whtPercent.readOnly = true;
  form.elements.gstPercent.readOnly = true;
  form.elements.notes.readOnly = true;
  form.elements.gstMode.disabled = true;
  form.elements.serviceChargeUsd.readOnly = upwork;

  if (upwork || !serviceManual || !form.elements.serviceChargeUsd.value) {
    form.elements.serviceChargeUsd.value = draft.serviceChargeUsd.toFixed(2);
    if (upwork) {
      form.dataset.serviceManual = "false";
    }
  }
}

function setDefaultPayoutWeek() {
  const form = document.querySelector("#payout-form");
  if (!form) return;
  const schedule = payoutSchedule();
  form.elements.period.value = schedule.period;
  form.elements.payoutDate.value = schedule.payoutDate;
  updatePayoutNote();
}

function shiftPayoutWeek(days) {
  const form = document.querySelector("#payout-form");
  if (!form) return;
  const currentDate = form.elements.payoutDate.value ? new Date(`${form.elements.payoutDate.value}T00:00:00`) : new Date();
  currentDate.setDate(currentDate.getDate() + days);
  const schedule = payoutSchedule(currentDate);
  form.elements.period.value = schedule.period;
  form.elements.payoutDate.value = schedule.payoutDate;
  updatePayoutNote();
}

function bindForms() {
  const setupAddNewButton = document.querySelector("#setup-add-new");
  const setupAddNewMenu = document.querySelector("#setup-add-new-menu");

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tabTarget;
      if (tab !== "incoming") clearIncomingSelection();
      activateTab(tab);
    });
  });

  document.querySelectorAll("[data-subtab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.subtabTarget;
      document.querySelectorAll("[data-subtab-target]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-subtab]").forEach((panel) => panel.classList.toggle("active", panel.dataset.subtab === tab));
    });
  });

  document.querySelectorAll("[data-recordtab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.recordtabTarget;
      document.querySelectorAll("[data-recordtab-target]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-recordtab]").forEach((panel) => panel.classList.toggle("active", panel.dataset.recordtab === tab));
      syncRecordFilterVisibility(tab);
      renderTables();
    });
  });

  syncRecordFilterVisibility(document.querySelector("[data-recordtab-target].active")?.dataset.recordtabTarget || "records-time");

  document.querySelectorAll("[data-formtab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.formtabTarget;
      document.querySelectorAll("[data-formtab-target]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-formtab]").forEach((panel) => panel.classList.toggle("active", panel.dataset.formtab === tab));
      if (setupAddNewMenu) setupAddNewMenu.classList.add("hidden");
      if (setupAddNewButton) setupAddNewButton.setAttribute("aria-expanded", "false");
    });
  });

  setupAddNewButton?.addEventListener("click", () => {
    if (!setupAddNewMenu) return;
    const nextHidden = !setupAddNewMenu.classList.contains("hidden");
    setupAddNewMenu.classList.toggle("hidden");
    setupAddNewButton.setAttribute("aria-expanded", String(nextHidden ? false : true));
  });

  document.querySelector("#setup-data-path")?.addEventListener("click", async () => {
    try {
      const nextPath = await window.tracker.chooseDataPath();
      if (!nextPath) return;
      await loadAvailableData({ resetContext: true });
    } catch (error) {
      await showDataLoadError(error);
    }
  });

  document.querySelector("#setup-export-data")?.addEventListener("click", async () => {
    try {
      const filePath = await window.tracker.exportData();
      if (!filePath) return;
      updateDataPathLabel(await window.tracker.dataPath());
    } catch (error) {
      console.error("Failed to export data", error);
      alert(`Export failed. ${error.message || "Please try again."}`);
    }
  });

  document.querySelector("#setup-import-data")?.addEventListener("click", async () => {
    await importAvailableData();
  });

  document.querySelectorAll("[data-formtab-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      closeSetupForms();
    });
  });

  closeSetupForms();

  document.querySelectorAll("[data-overview-period]").forEach((button) => {
    button.addEventListener("click", () => {
      activateOverviewPeriod(button.dataset.overviewPeriod);
      if (button.dataset.overviewPeriod === "month") setOverviewMonth();
      renderStats();
    });
  });

  document.querySelectorAll("[data-overview-month-shift]").forEach((button) => {
    button.addEventListener("click", () => {
      shiftOverviewMonth(toNumber(button.dataset.overviewMonthShift, 0));
    });
  });

  document.querySelector("#show-source-fields").addEventListener("click", () => {
    document.querySelector("#new-source-fields").classList.toggle("hidden");
  });

  document.querySelector("#show-client-fields").addEventListener("click", () => {
    document.querySelector("#new-client-fields").classList.toggle("hidden");
  });

  document.querySelector("#show-expense-type-fields").addEventListener("click", () => {
    document.querySelector("#new-expense-type-fields").classList.toggle("hidden");
  });

  document.querySelector("#contract-form select[name='sourceId']").addEventListener("change", fillSelects);
  document.querySelector("#time-form select[name='employeeId']").addEventListener("change", () => { fillSelects(); updateWorkContext(); });
  document.querySelector("#time-form select[name='contractId']").addEventListener("change", () => { syncTimePreview(); updateWorkContext(); });
  document.querySelector("#time-form input[name='hours']").addEventListener("input", syncTimePreview);
  ["hours", "weekStart", "weekEnd"].forEach((name) => {
    document.querySelector("#time-form").elements[name].addEventListener("input", clearTimeValidation);
  });
  ["employeeId", "contractId"].forEach((name) => {
    document.querySelector("#time-form").elements[name].addEventListener("change", clearTimeValidation);
  });
  ["weekStart", "weekEnd"].forEach((name) => {
    document.querySelector("#time-form").elements[name].addEventListener("change", updateWorkContext);
  });
  document.querySelector("#rate-form select[name='contractId']").addEventListener("change", syncRateForm);
  document.querySelector("#rate-mode-pass").addEventListener("click", () => {
    const form = document.querySelector("#rate-form");
    if (!form) return;
    form.elements.noAgencyCut.value = "true";
    syncRateForm();
  });
  document.querySelector("#rate-mode-standard").addEventListener("click", () => {
    const form = document.querySelector("#rate-form");
    if (!form) return;
    form.elements.noAgencyCut.value = "false";
    syncRateForm();
  });
  document.querySelector("#rate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (rateSaving) return;
    const form = event.currentTarget;
    const values = formData(form);
    const contractId = values.contractId === "__agency__" ? "" : values.contractId;
    let feedback = form.querySelector("#rate-save-message");
    if (!feedback) {
      feedback = document.createElement("p");
      feedback.id = "rate-save-message";
      feedback.className = "inline-message";
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      form.append(feedback);
    }
    if (!isActiveSetupItem("employees", values.employeeId) || (contractId && !isActiveSetupItem("contracts", contractId))) {
      feedback.textContent = "Choose an active employee and contract before assigning a rate.";
      return;
    }
    const noAgencyCut = values.noAgencyCut === "true";
    const rateUsd = noAgencyCut ? passThroughRateForContract(contractId) : toNumber(values.rateUsd);
    const candidate = structuredClone(data);
    candidate.employeeRates = candidate.employeeRates.filter((rate) => rate.archived === true || !(rate.employeeId === values.employeeId && (rate.contractId || "") === contractId));
    candidate.employeeRates.push({
      id: id(),
      employeeId: values.employeeId,
      contractId,
      rateUsd,
      noAgencyCut,
    });
    const saveButton = form.querySelector("button[type='submit']");
    rateSaving = true;
    if (saveButton) saveButton.disabled = true;
    try {
      await save(candidate);
      reset(form);
      feedback.textContent = "Rate saved. Historical work and payouts were kept.";
    } catch (error) {
      feedback.textContent = `Rate was not saved. ${error.message || "Please retry."} Your entered values are kept so you can retry.`;
    } finally {
      rateSaving = false;
      if (saveButton) saveButton.disabled = false;
    }
  });
  document.querySelector("#previous-week").addEventListener("click", () => shiftWeek(-7));
  document.querySelector("#current-week").addEventListener("click", setDefaultWeek);
  document.querySelector("#next-week").addEventListener("click", () => shiftWeek(7));
  document.querySelector("#incoming-queue")?.addEventListener("change", async (event) => {
    const filter = event.target.closest("[data-incoming-filter]");
    if (filter) {
      incomingQueueState.filters[filter.dataset.incomingFilter] = filter.value;
      renderIncomingQueue();
      return;
    }
    const sortKey = event.target.closest("[data-incoming-control='sort-key']");
    if (sortKey) {
      incomingQueueState.sortKey = incomingQueueView.sortFields.includes(sortKey.value) ? sortKey.value : "default";
      renderIncomingQueue();
      return;
    }
    const selection = event.target.closest("[data-incoming-select]");
    if (selection) {
      selectIncomingRow(selection.dataset.incomingSelect, selection.checked, incomingQueueShiftSelection);
      incomingQueueShiftSelection = false;
      return;
    }
    const selectAll = event.target.closest("[data-incoming-select-all]");
    if (selectAll) {
      selectAllIncomingRows(selectAll.checked);
      return;
    }
    const field = event.target.closest("[data-field]");
    if (!field) return;
    rememberIncomingField(field);
    const row = field.closest("tr");
    syncIncomingQueueRowPreview(row);
  });
  document.querySelector("#incoming-queue")?.addEventListener("input", (event) => {
    const search = event.target.closest("[data-incoming-filter='search']");
    if (search) {
      incomingQueueState.filters.search = search.value;
      renderIncomingQueue();
      return;
    }
    const field = event.target.closest("[data-field]");
    if (!field) return;
    rememberIncomingField(field);
    const row = field.closest("tr");
    if (!row) return;
    syncIncomingQueueRowPreview(row);
  });
  document.querySelector("#incoming-queue")?.addEventListener("click", async (event) => {
    const selection = event.target.closest("[data-incoming-select]");
    if (selection) { incomingQueueShiftSelection = event.shiftKey === true; return; }
    const sort = event.target.closest("[data-incoming-sort]");
    if (sort) {
      incomingQueueState.sortDirection = incomingQueueState.sortKey === sort.dataset.incomingSort && incomingQueueState.sortDirection === "asc" ? "desc" : "asc";
      incomingQueueState.sortKey = sort.dataset.incomingSort;
      renderIncomingQueue();
      return;
    }
    const control = event.target.closest("[data-incoming-control]");
    if (control?.dataset.incomingControl === "sort-direction") {
      incomingQueueState.sortDirection = incomingQueueState.sortDirection === "asc" ? "desc" : "asc";
      renderIncomingQueue();
      return;
    }
    if (control?.dataset.incomingControl === "clear-filters") {
      Object.keys(incomingQueueState.filters).forEach(key => { incomingQueueState.filters[key] = ""; });
      renderIncomingQueue();
      return;
    }
    if (control?.dataset.incomingControl === "select-matching") { selectAllIncomingRows(true); return; }
    const paidButton = event.target.closest("[data-incoming-paid]");
    if (paidButton) {
      event.preventDefault();
      event.stopPropagation();
      const row = paidButton.closest("tr");
      if (!row) return;
      syncIncomingQueueRowPreview(row);
      const rowKey = paidButton.dataset.incomingPaid;
      const sourceRow = buildIncomingQueueRows().find((item) => item.key === rowKey);
      if (!sourceRow) return;
      let receivedDate = upworkReceivedDate(sourceRow.workWeekStart);
      if (!isUpworkContract(sourceRow.contractId)) {
        const result = await openIncomingReceivedDateDialog(sourceRow);
        if (!result) return;
        receivedDate = result.receivedDate;
      }
      await persistIncomingQueueRow(rowKey, { markReceived: true, receivedDateOverride: receivedDate });
      return;
    }
    const overrideButton = event.target.closest("[data-service-override]");
    if (overrideButton) {
      activeServiceOverrides.add(overrideButton.dataset.serviceOverride);
      renderIncomingQueue();
      incomingQueueRowElement(overrideButton.dataset.serviceOverride)?.querySelector("[data-field='serviceChargeUsd']")?.focus({ preventScroll: true });
      return;
    }
    const saveOverrideButton = event.target.closest("[data-service-save]");
    if (saveOverrideButton) {
      const saved = await persistIncomingQueueRow(saveOverrideButton.dataset.serviceSave, { serviceChargeOverridden: true });
      if (saved) {
        activeServiceOverrides.delete(saveOverrideButton.dataset.serviceSave);
        incomingQueueRowElement(saveOverrideButton.dataset.serviceSave)?.querySelector("[data-service-save]")?.focus({ preventScroll: true });
      }
      return;
    }
    const resetOverrideButton = event.target.closest("[data-service-reset]");
    if (resetOverrideButton) {
      const rowKey = resetOverrideButton.dataset.serviceReset;
      const sourceRow = buildIncomingQueueRows().find((item) => item.key === rowKey);
      if (sourceRow?.serviceChargeOverridden && !await persistIncomingQueueRow(rowKey, { serviceChargeOverridden: false })) return;
      const serviceField = incomingQueueRowElement(rowKey)?.querySelector("[data-field='serviceChargeUsd']");
      if (serviceField) serviceField.value = incomingQueueRenderedValues.get(rowKey)?.serviceChargeUsd || "0.00";
      const draft = incomingQueueDrafts.get(rowKey);
      if (draft) { delete draft.serviceChargeUsd; if (!Object.keys(draft).length) incomingQueueDrafts.delete(rowKey); }
      activeServiceOverrides.delete(rowKey);
      renderIncomingQueue();
      incomingQueueRowElement(rowKey)?.querySelector("[data-service-override]")?.focus({ preventScroll: true });
    }
  });
  document.querySelector("#incoming-bulk-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await applyIncomingBulkUpdate(false);
  });
  document.querySelector("#incoming-bulk-receive")?.addEventListener("click", async () => applyIncomingBulkUpdate(true));
  document.querySelector("#incoming-bulk-clear")?.addEventListener("click", () => {
    clearIncomingSelection();
    updateIncomingSelectionUi(buildIncomingQueueRows());
  });
  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-payout-paid]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const payout = byId(data.payouts, button.dataset.payoutPaid);
    if (!payout) return;

    const scrollY = window.scrollY;
    const tableWrap = button.closest(".table-wrap");
    const tableContainerId = tableWrap?.parentElement?.id || "";
    const tableScrollTop = tableWrap?.scrollTop ?? 0;
    const result = await openPayoutPaidDialog(payout, async (details) => {
      if (!byId(data.payouts, payout.id)) throw new Error("This payout is no longer available. Close this dialog and reopen the payout.");
      const candidate = structuredClone(data);
      candidate.payouts = candidate.payouts.map((item) => item.id === payout.id
        ? { ...item, paid: true, paidDate: details.paidDate, transactionId: details.transactionId }
        : item);
      candidate.payoutPaymentStatus = {
        ...(candidate.payoutPaymentStatus || {}),
        [payout.id]: { paid: true, paidDate: details.paidDate, transactionId: details.transactionId },
      };
      await save(candidate);
    });
    if (!result) return;
    window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
    const nextTableWrap = tableContainerId ? document.querySelector(`#${tableContainerId} .table-wrap`) : null;
    if (nextTableWrap) nextTableWrap.scrollTop = tableScrollTop;
  });
  document.querySelector("#previous-record-month").addEventListener("click", () => shiftRecordReportMonth(-1));
  document.querySelector("#current-record-month").addEventListener("click", () => {
    setRecordReportMonth();
    renderTables();
  });
  document.querySelector("#next-record-month").addEventListener("click", () => shiftRecordReportMonth(1));
  document.querySelector("#print-records-report").addEventListener("click", () => runRecordsReportAction("print"));
  document.querySelector("#export-records-pdf").addEventListener("click", () => runRecordsReportAction("pdf"));
  document.querySelector("#export-records-xlsx").addEventListener("click", () => runRecordsReportAction("xlsx"));
  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    removeItem(button.dataset.delete, button.dataset.id, button.dataset.label);
  });
  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit]");
    if (!button) return;
    editItem(button.dataset.edit, button.dataset.id);
  });
  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-payout]");
    if (!button) return;
    const payout = byId(data.payouts, button.dataset.copyPayout);
    if (!payout) return;
    await copyText(payout.note);
  });
  document.querySelector("#record-filter-employee").addEventListener("change", renderTables);
  document.querySelector("#record-filter-month").addEventListener("change", renderTables);
  document.querySelector("#record-filter-week").addEventListener("change", renderTables);
  document.querySelector("#clear-record-filters").addEventListener("click", () => {
    document.querySelector("#record-filter-employee").value = "";
    document.querySelector("#record-filter-month").value = "";
    document.querySelector("#record-filter-week").value = "";
    renderTables();
  });

  document.querySelector("#contract-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formData(form);
    const editId = values.editId || "";
    let sourceId = values.sourceId;
    if (values.newSourceName?.trim()) {
      sourceId = id();
      data.sources.push({
        id: sourceId,
        name: values.newSourceName.trim(),
      });
    }

    if (!sourceId) {
      alert("Please select a source or add a new one.");
      return;
    }

    let clientId = values.clientId;
    if (values.newClientName?.trim()) {
      clientId = id();
      data.clients.push({
        id: clientId,
        sourceId,
        name: values.newClientName.trim(),
      });
    }

    if (!clientId) {
      alert("Please select a client or add a new one.");
      return;
    }

    const nextContract = {
      id: editId || id(),
      name: values.name.trim(),
      shortName: values.shortName.trim(),
      clientId,
      sourceId,
      priceType: values.priceType,
      priceUsd: toNumber(values.priceUsd),
      serviceChargeMode: values.serviceChargeMode,
      serviceChargePercent: toNumber(values.serviceChargePercent),
      gstMode: values.gstMode,
      gstPercent: toNumber(values.gstPercent, 18),
      notes: values.notes.trim(),
    };

    if (editId) {
      const index = data.contracts.findIndex((contract) => contract.id === editId);
      if (index >= 0) data.contracts[index] = { ...data.contracts[index], ...nextContract };
      else data.contracts.push(nextContract);
    } else {
      data.contracts.push(nextContract);
    }
    await save();
    reset(form);
  });

  document.querySelector("#employee-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formData(form);
    const editId = values.editId || "";
    const nextEmployee = {
      id: editId || id(),
      name: values.name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      bankAccount: values.bankAccount.trim(),
      ifsc: values.ifsc.trim(),
      bankName: values.bankName.trim(),
      notes: values.notes.trim(),
    };
    if (editId) {
      const index = data.employees.findIndex((item) => item.id === editId);
      if (index >= 0) data.employees[index] = { ...data.employees[index], ...nextEmployee };
      else data.employees.push(nextEmployee);
    } else {
      data.employees.push(nextEmployee);
    }
    await save();
    reset(form);
  });

  document.querySelector("#time-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (workSaving) return;
    const form = event.currentTarget;
    const values = formData(form);
    clearTimeValidation();
    const editId = values.editId || "";
    const validation = workValidation.validateWorkEntry(values, data.timeEntries, { editId });
    if (!validation.valid) {
      showTimeValidation(validation);
      return;
    }
    const contractId = values.contractId === "__agency__" ? "" : values.contractId;
    const existingEntry = editId ? byId(data.timeEntries, editId) : null;
    const unchangedFinancialEdit = validation.unchangedFinancialEdit;
    if (!unchangedFinancialEdit && paidPayoutsAffectedByWorkChange(existingEntry, { ...values, contractId }).length) {
      const message = document.querySelector("#time-validation-message");
      if (message) message.textContent = "This employee's work period has a paid payout. Financial changes require a separately approved correction. You can still edit notes without changing the employee, contract, dates or hours.";
      return;
    }
    const rate = unchangedFinancialEdit ? null : activeEmployeeRate(values.employeeId, contractId);
    if (!unchangedFinancialEdit && !rate) {
      const message = document.querySelector("#time-validation-message");
      if (message) message.textContent = "Choose an active employee, contract and assigned rate before saving new or changed work.";
      form.elements.contractId.focus();
      return;
    }
    const hours = toNumber(values.hours);
    const effectiveRateUsd = unchangedFinancialEdit ? null : effectiveRateForEntry({
      employeeId: values.employeeId,
      contractId,
      weekStart: values.weekStart,
      weekEnd: values.weekEnd,
      noAgencyCut: Boolean(rate.noAgencyCut),
      rateUsd: rate.rateUsd,
    }, rate);
    const nextEntry = {
      id: editId || id(),
      employeeId: values.employeeId,
      contractId,
      weekStart: values.weekStart,
      weekEnd: values.weekEnd,
      hours,
      ...(!unchangedFinancialEdit ? {
        rateUsd: effectiveRateUsd,
        totalUsd: round(hours * effectiveRateUsd),
        noAgencyCut: Boolean(rate.noAgencyCut),
      } : {}),
      notes: values.notes.trim(),
    };
    const previousData = structuredClone(data);
    const saveButton = form.querySelector("button[type='submit']");
    workSaving = true;
    if (saveButton) saveButton.disabled = true;
    try {
      data.timeEntries = existingEntry
        ? data.timeEntries.map((entry) => entry.id === editId ? { ...entry, ...nextEntry } : entry)
        : [...data.timeEntries, nextEntry];
      if (!unchangedFinancialEdit) invalidateWeeklyProgressForWorkChange(existingEntry, nextEntry);
      await save(data, { payoutWorkPeriods: unchangedFinancialEdit ? [] : [existingEntry, nextEntry].filter(Boolean) });
      reset(form);
    } catch (error) {
      data = previousData;
      const message = document.querySelector("#time-validation-message");
      if (message) message.textContent = `Work was not saved. ${error.message || "Please retry."} Your entered values are still available to retry.`;
    } finally {
      workSaving = false;
      if (saveButton) saveButton.disabled = false;
    }
  });

  document.querySelector("#expense-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formData(form);
    let expenseTypeId = values.expenseTypeId;
    if (values.newExpenseTypeName?.trim()) {
      expenseTypeId = id();
      data.expenseTypes.push({ id: expenseTypeId, name: values.newExpenseTypeName.trim() });
    }

    if (!expenseTypeId) {
      alert("Please select an expense or add a new one.");
      return;
    }

    const amountUsd = toNumber(values.amountUsd);
    const exchangeRate = toNumber(values.exchangeRate);
    const gstPercent = toNumber(values.gstPercent, 18);
    const gstPayUsd = gstPayableUsd(amountUsd, values.gstMode, gstPercent);
    const editId = values.editId || "";
    const existingExpense = editId ? byId(data.expenses, editId) : null;
    const sameNumericInput = (original, entered) => {
      const stored = original === undefined || original === null ? "" : String(original);
      const current = String(entered ?? "");
      return stored === "" || current === "" ? stored === current : Number(stored) === Number(current);
    };
    const unchangedFinancialEdit = existingExpense &&
      ["amountUsd", "exchangeRate", "gstPercent"].every(field => sameNumericInput(existingExpense[field], values[field])) &&
      String(existingExpense.gstMode || "") === String(values.gstMode || "");
    const nextExpense = {
      id: id(),
      expenseTypeId,
      expenseDate: values.expenseDate,
      label: values.label.trim(),
      ...(!unchangedFinancialEdit ? {
        amountUsd,
        exchangeRate,
        amountInr: round(amountUsd * exchangeRate),
        gstMode: values.gstMode,
        gstPercent,
        gstPayableUsd: gstPayUsd,
        gstPayableInr: round(gstPayUsd * exchangeRate),
      } : {}),
      notes: values.notes.trim(),
    };
    if (editId) {
      const index = data.expenses.findIndex((item) => item.id === editId);
      if (index >= 0) data.expenses[index] = { ...data.expenses[index], ...nextExpense, id: editId };
      else data.expenses.push(nextExpense);
    } else {
      data.expenses.push(nextExpense);
    }
    await save();
    reset(form);
  });
}

function setDataAccessState(available) {
  document.querySelectorAll("main input, main select, main textarea, main button").forEach(control => {
    if (control.matches("[data-tab-target], [data-recovery-action], #setup-import-data, #setup-data-path")) return;
    if (!available && !control.disabled) {
      control.dataset.recoveryDisabled = "true";
      control.disabled = true;
    } else if (available && control.dataset.recoveryDisabled === "true") {
      control.disabled = false;
      delete control.dataset.recoveryDisabled;
    }
  });
}

async function showDataLoadError(error) {
  analyticsDataReady = false;
  renderAnalytics();
  setDataAccessState(false);
  let recovery = { canImport: false, reason: "Choose a valid data file or backup before importing a replacement." };
  try {
    if (window.tracker.recoveryState) recovery = await window.tracker.recoveryState();
  } catch { /* Keep import unavailable if its replacement target cannot be verified. */ }
  let panel = document.querySelector("#data-recovery");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "data-recovery";
    panel.className = "panel data-recovery";
    panel.setAttribute("role", "alert");
    panel.style.marginBottom = "16px";
    document.querySelector("main").prepend(panel);
  }
  panel.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Your data could not load";
  const message = document.createElement("p");
  message.textContent = error?.message || "The data file is unavailable. No file has been replaced.";
  const note = document.createElement("p");
  note.textContent = "Your original file is unchanged. Retry after fixing access, open a valid data file or backup, or explicitly import a replacement. Saving is disabled until data loads.";
  panel.append(heading, message, note);
  const importButton = document.querySelector("#setup-import-data");
  if (importButton) importButton.disabled = !recovery.canImport;
  if (!recovery.canImport) {
    const destinationNote = document.createElement("p");
    destinationNote.textContent = recovery.reason;
    panel.append(destinationNote);
  }
  for (const [action, label] of [["retry", "Retry"], ["choose", "Choose Data File / Backup"], ["import", "Import Backup"]]) {
    if (action === "import" && !recovery.canImport) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.recoveryAction = action;
    button.textContent = label;
    button.style.marginRight = "8px";
    panel.append(button);
  }
  setDataAccessState(false);
}

function resetLoadedDatasetContext() {
  if (typeof resetIncomingQueueState === "function") resetIncomingQueueState();
  if (typeof resetWeeklyProgressContext === "function") resetWeeklyProgressContext();
}

function initializeLoadedData(nextData, { resetContext = false } = {}) {
  if (resetContext) resetLoadedDatasetContext();
  data = { ...blankData, ...nextData };
  analyticsDataReady = true;
  if (resetContext && analyticsController) {
    try { analyticsController.reset(); } catch (error) { console.error("Analytics filter reset failed", error); }
  }
  document.querySelector("#data-recovery")?.remove();
  setDataAccessState(true);
  const importButton = document.querySelector("#setup-import-data");
  if (importButton) importButton.disabled = false;
  setOverviewMonth();
  setDefaultWeek();
  setIncomingWeek();
  setIncomingWhtDefault();
  setDefaultPayoutWeek();
  setRecordReportMonth();
  render();
}

async function loadAvailableData(options = {}) {
  analyticsDataReady = false;
  setDataAccessState(false);
  try {
    const nextData = await window.tracker.loadData();
    initializeLoadedData(nextData, options);
    updateDataPathLabel(await window.tracker.dataPath());
    return true;
  } catch (error) {
    await showDataLoadError(error);
    return false;
  }
}

async function importAvailableData() {
  try {
    const recovery = await window.tracker.recoveryState?.();
    if (recovery && !recovery.canImport) {
      await showDataLoadError(new Error(recovery.reason));
      return;
    }
    if (!confirm("Import will replace the current dataset. A backup of an existing target file is created first. To leave that file unchanged, cancel and choose a data file/backup instead. Continue?")) return;
    const nextData = await window.tracker.importData();
    if (!nextData) return;
    initializeLoadedData(nextData, { resetContext: true });
    updateDataPathLabel(await window.tracker.dataPath());
  } catch (error) {
    alert(`Import failed. ${error.message || "Please make sure the file is a valid payment tracker JSON export."}`);
  }
}

function bindDataRecovery() {
  document.body.addEventListener("click", async event => {
    const restore = event.target.closest("[data-restore-collection]");
    if (restore) {
      await setSetupArchived(restore.dataset.restoreCollection, restore.dataset.id, false);
      return;
    }
    const archive = event.target.closest("[data-archive-collection]");
    if (archive) {
      if (confirm("Archive this setup item? Its history stays unchanged and it can be restored later.")) await setSetupArchived(archive.dataset.archiveCollection, archive.dataset.id, true);
      return;
    }
    const action = event.target.closest("[data-recovery-action]")?.dataset.recoveryAction;
    if (!action) return;
    if (action === "retry") await loadAvailableData();
    if (action === "import") await importAvailableData();
    if (action === "choose") {
      try {
        const nextPath = await window.tracker.chooseDataFile();
        if (nextPath) await loadAvailableData({ resetContext: true });
      } catch (error) { await showDataLoadError(error); }
    }
  });
}

async function boot() {
  // Navigation and recovery must work even when the dataset cannot be parsed.
  bindForms();
  bindDataRecovery();
  await loadAvailableData();
}

boot();
