const CURRENT_SCHEMA_VERSION = 2;
const { isCalendarDate } = require("./work-validation");

const collectionNames = [
  "clients",
  "sources",
  "contracts",
  "employees",
  "employeeRates",
  "timeEntries",
  "incomingPayments",
  "payouts",
  "expenseTypes",
  "expenses",
  "weeklyFxRates",
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createDefaultData() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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
}

function normalizeDataShape(value) {
  const input = isObject(value) ? value : {};
  const normalized = { ...createDefaultData(), ...input };
  for (const name of collectionNames) normalized[name] = Array.isArray(input[name]) ? input[name] : [];
  normalized.payoutPaymentStatus = isObject(input.payoutPaymentStatus) ? input.payoutPaymentStatus : {};
  normalized.weeklyProgress = isObject(input.weeklyProgress) ? input.weeklyProgress : {};
  normalized.schemaVersion = Number.isInteger(input.schemaVersion) ? input.schemaVersion : 0;
  return normalized;
}

function seedWeeklyFxRates(data) {
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  const contracts = new Map(data.contracts.map((contract) => [contract.id, contract]));
  const groupedRates = new Map();

  for (const payment of data.incomingPayments) {
    const contract = contracts.get(payment.contractId);
    const source = contract ? sources.get(contract.sourceId) : null;
    const rate = Number(payment.exchangeRate);
    if (!source?.name?.trim().toLowerCase().includes("upwork") || !payment.workWeekStart || !Number.isFinite(rate) || rate <= 0) continue;
    const key = `${source.id}|${payment.workWeekStart}`;
    const rates = groupedRates.get(key) ?? { sourceId: source.id, weekStart: payment.workWeekStart, values: new Set() };
    rates.values.add(rate);
    groupedRates.set(key, rates);
  }

  const weeklyFxRates = [];
  const warnings = [];
  for (const group of groupedRates.values()) {
    if (group.values.size === 1) {
      weeklyFxRates.push({ sourceId: group.sourceId, weekStart: group.weekStart, exchangeRate: [...group.values][0] });
    } else {
      warnings.push(`Conflicting legacy Upwork FX rates for ${group.weekStart}; no shared override was created.`);
    }
  }
  return { weeklyFxRates, warnings };
}

function migrateV0ToV1(data) {
  return { data: { ...data, schemaVersion: 1 }, warnings: [] };
}

function migrateV1ToV2(data) {
  const seeded = seedWeeklyFxRates(data);
  return { data: { ...data, weeklyFxRates: seeded.weeklyFxRates, schemaVersion: 2 }, warnings: seeded.warnings };
}

const migrations = {
  0: migrateV0ToV1,
  1: migrateV1ToV2,
};

function migrateData(value) {
  const originalVersion = isObject(value) && Number.isInteger(value.schemaVersion) ? value.schemaVersion : 0;
  if (originalVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`This data file uses schema version ${originalVersion}, which is newer than this app supports.`);
  }

  let data = normalizeDataShape(value);
  const warnings = [];
  while (data.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[data.schemaVersion];
    if (!migrate) throw new Error(`No migration is available for schema version ${data.schemaVersion}.`);
    const result = migrate(data);
    data = normalizeDataShape(result.data);
    warnings.push(...result.warnings);
  }
  data.schemaVersion = CURRENT_SCHEMA_VERSION;
  return { data, migrated: originalVersion !== CURRENT_SCHEMA_VERSION, warnings };
}

function validateDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).valueOf());
}

function validateData(value) {
  const errors = [];
  const warnings = [];
  if (!isObject(value)) return { valid: false, errors: ["Data must be a JSON object."], warnings, data: null, summary: {} };

  for (const name of collectionNames) {
    if (value[name] !== undefined && !Array.isArray(value[name])) errors.push(`${name} must be an array.`);
  }
  if (value.payoutPaymentStatus !== undefined && !isObject(value.payoutPaymentStatus)) errors.push("payoutPaymentStatus must be an object.");
  if (value.weeklyProgress !== undefined && !isObject(value.weeklyProgress)) errors.push("weeklyProgress must be an object.");
  for (const progress of Object.values(isObject(value.weeklyProgress) ? value.weeklyProgress : {})) {
    if (!isObject(progress) || !["complete", "no-work"].includes(progress.status)) errors.push("weeklyProgress entries must have a complete or no-work status.");
  }
  if (value.schemaVersion !== undefined && (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 0)) {
    errors.push("schemaVersion must be a non-negative integer.");
  }
  if (errors.length) return { valid: false, errors, warnings, data: null, summary: {} };

  let migration;
  try {
    migration = migrateData(value);
  } catch (error) {
    return { valid: false, errors: [error.message], warnings, data: null, summary: {} };
  }

  const data = migration.data;
  warnings.push(...migration.warnings);
  const numericFields = {
    incomingPayments: ["grossUsd", "exchangeRate", "serviceChargeUsd", "whtUsd", "whtPercent", "netUsd", "netInr", "gstPercent", "gstPayableUsd", "gstPayableInr"],
    payouts: ["totalUsd", "totalInr"],
    expenses: ["amountUsd", "amountInr", "exchangeRate", "gstPercent", "gstPayableUsd", "gstPayableInr"],
    timeEntries: ["hours", "rateUsd", "totalUsd"],
    employeeRates: ["rateUsd"],
    weeklyFxRates: ["exchangeRate"],
  };
  for (const [collection, fields] of Object.entries(numericFields)) {
    for (const item of data[collection]) {
      for (const field of fields) {
        if (item[field] !== undefined && item[field] !== null && item[field] !== "" && !Number.isFinite(Number(item[field]))) {
          errors.push(`${collection}.${field} must be a finite number.`);
        }
      }
    }
  }
  for (const payment of data.incomingPayments) {
    if (payment.paymentDate && !validateDate(payment.paymentDate)) errors.push("incomingPayments.paymentDate must use YYYY-MM-DD.");
    if (payment.serviceChargeOverridden !== undefined && typeof payment.serviceChargeOverridden !== "boolean") {
      errors.push("incomingPayments.serviceChargeOverridden must be a boolean when supplied.");
    }
  }
  for (const expense of data.expenses) {
    if (expense.expenseDate && !validateDate(expense.expenseDate)) errors.push("expenses.expenseDate must use YYYY-MM-DD.");
  }

  if (value.schemaVersion === CURRENT_SCHEMA_VERSION) {
    const workGroups = new Map();
    data.timeEntries.forEach((entry, index) => {
      const label = entry.id || `row ${index + 1}`;
      const hours = Number(entry.hours);
      if (!Number.isFinite(hours) || hours <= 0) warnings.push(`Historical weekly work ${label} has invalid or non-positive hours. It was preserved unchanged.`);
      const validStart = isCalendarDate(entry.weekStart);
      const validEnd = isCalendarDate(entry.weekEnd);
      if (!validStart || !validEnd) warnings.push(`Historical weekly work ${label} has an invalid calendar date. It was preserved unchanged.`);
      else if (entry.weekEnd < entry.weekStart) warnings.push(`Historical weekly work ${label} ends before it starts. It was preserved unchanged.`);
      else if (entry.employeeId) {
        const contractId = entry.contractId === "__agency__" ? "" : entry.contractId || "";
        const key = JSON.stringify([entry.employeeId, contractId]);
        const group = workGroups.get(key) || [];
        group.push(entry);
        workGroups.set(key, group);
      }
    });
    for (const entries of workGroups.values()) {
      const ordered = [...entries].sort((left, right) => left.weekStart.localeCompare(right.weekStart) || left.weekEnd.localeCompare(right.weekEnd));
      let furthest = ordered[0];
      for (const entry of ordered.slice(1)) {
        if (entry.weekStart <= furthest.weekEnd) {
          warnings.push(`Historical weekly work ${furthest.id || "(unknown)"} and ${entry.id || "(unknown)"} overlap for the same employee and contract. No records were merged or changed.`);
          break; // One useful warning per scope avoids flooding large imports.
        }
        if (entry.weekEnd > furthest.weekEnd) furthest = entry;
      }
    }
  }

  const absent = value => value === undefined || value === null || value === "";
  for (const [collection, label] of [["incomingPayments", "Incoming payment"], ["expenses", "Expense"]]) {
    for (const item of data[collection]) {
      if (Number(item.gstPayableUsd) > 0 && absent(item.gstPayableInr)) {
        warnings.push(`${label} ${item.id || "(unknown)"} is missing GST INR. It will be shown as unavailable; no historical amount was recalculated.`);
      }
      if (collection === "expenses" && String(item.gstMode || "").toUpperCase() === "RCM" && Number(item.amountUsd) > 0 && absent(item.amountInr)) {
        warnings.push(`${label} ${item.id || "(unknown)"} is missing its INR amount. It will be shown as unavailable; no historical amount was recalculated.`);
      }
    }
  }

  const sourceIds = new Set(data.sources.map((item) => item.id));
  const contractIds = new Set(data.contracts.map((item) => item.id));
  for (const contract of data.contracts) if (contract.sourceId && !sourceIds.has(contract.sourceId)) warnings.push(`Contract ${contract.id || "(unknown)"} references a missing source.`);
  for (const payment of data.incomingPayments) if (payment.contractId && !contractIds.has(payment.contractId)) warnings.push(`Incoming payment ${payment.id || "(unknown)"} references a missing contract.`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    data,
    migrated: migration.migrated,
    summary: Object.fromEntries(collectionNames.map((name) => [name, data[name].length])),
  };
}

module.exports = { CURRENT_SCHEMA_VERSION, createDefaultData, migrateData, normalizeDataShape, validateData };
