const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDefaultData } = require('../src/shared/data-schema');
const analytics = require('../src/shared/analytics');

const now = new Date(2026, 10, 13, 12);
const month = { period: 'month', month: '2026-11' };
const line = (contractId, totalUsd, totalInr) => ({ contractId, totalUsd, totalInr, hours: totalUsd / 10, rateUsd: 10, exchangeRate: 999 });
function receipt(id, contractId, paymentDate, netUsd, netInr, extra = {}) {
  return { id, contractId, paymentDate, netUsd, netInr, received: true, grossUsd: netUsd + 20, serviceChargeUsd: 20,
    whtUsd: 0, whtPercent: 0, exchangeRate: 999, gstMode: 'NONE', gstPayableUsd: 0, gstPayableInr: 0,
    workWeekStart: paymentDate === '2026-10-09' ? '2026-09-21' : '2026-10-19', workWeekEnd: paymentDate === '2026-10-09' ? '2026-09-27' : '2026-10-25', ...extra };
}
function payout(id, employeeId, totalUsd, totalInr, contracts, extra = {}) {
  return { id, employeeId, totalUsd, totalInr, contracts, paid: true, paidDate: '2026-11-04', payoutDate: '2026-10-29',
    weekStart: '2026-10-12', weekEnd: '2026-10-18', ...extra };
}
function fixture(extra = {}) {
  return { ...createDefaultData(), sources: [{ id: 's', name: 'Synthetic direct' }],
    clients: [{ id: 'cl1', name: 'Current synthetic client' }, { id: 'cl2', name: 'Archived synthetic client', archived: true }],
    contracts: [{ id: 'c1', clientId: 'cl1', sourceId: 's', shortName: 'Historical contract A', priceType: 'HOURLY', priceUsd: 999, serviceChargeMode: 'NONE' },
      { id: 'c2', clientId: 'cl2', sourceId: 's', shortName: 'Archived contract B', priceType: 'HOURLY', priceUsd: 999, archived: true, serviceChargeMode: 'NONE' }],
    employees: [{ id: 'e1', name: 'Synthetic employee A' }, { id: 'e2', name: 'Archived employee B', archived: true }],
    employeeRates: [{ id: 'r1', employeeId: 'e1', contractId: 'c1', rateUsd: 777 }],
    expenseTypes: [{ id: 'x1', name: 'Synthetic software' }, { id: 'x2', name: 'Synthetic equipment' }],
    incomingPayments: [receipt('i1', 'c1', '2026-11-04', 180, 15000), receipt('i2', 'c2', '2026-11-10', 90, 7490), receipt('io', 'c1', '2026-10-09', 70, 5800)],
    timeEntries: [{ id: 't1', employeeId: 'e1', contractId: 'c1', weekStart: '2026-11-02', weekEnd: '2026-11-08', hours: 8, rateUsd: 10, totalUsd: 80 },
      { id: 't2', employeeId: 'e2', contractId: 'c2', weekStart: '2026-11-09', weekEnd: '2026-11-15', hours: 4, rateUsd: 11, totalUsd: 44 },
      { id: 'to', employeeId: 'e1', contractId: 'c1', weekStart: '2026-10-26', weekEnd: '2026-11-01', hours: 6, rateUsd: 10, totalUsd: 60 }],
    expenses: [{ id: 'xnov1', expenseTypeId: 'x1', expenseDate: '2026-11-05', amountUsd: 25, amountInr: 2100, gstMode: 'NONE', gstPayableUsd: 0, gstPayableInr: 0 },
      { id: 'xnov2', expenseTypeId: 'x2', expenseDate: '2026-11-09', amountUsd: 15, amountInr: 1250, gstMode: 'NONE', gstPayableUsd: 0, gstPayableInr: 0 },
      { id: 'xo', expenseTypeId: 'x1', expenseDate: '2026-10-13', amountUsd: 10, amountInr: 800, gstMode: 'NONE', gstPayableUsd: 0, gstPayableInr: 0 }],
    payouts: [payout('p1', 'e1', 100, 8300, [line('c1', 60, 5000), line('c2', 40, 3300)]),
      payout('p2', 'e2', 50, 4000, [line('c1', 50, 4000)], { paidDate: '2026-11-21', payoutDate: '2026-11-20', weekStart: '2026-11-03', weekEnd: '2026-11-08' }),
      payout('po', 'e1', 20, 1640, [line('c1', 20, 1640)], { paidDate: '2026-10-15', payoutDate: '2026-10-15', weekStart: '2026-09-28', weekEnd: '2026-10-04' })], ...extra };
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
const subtotal = (metric, currency) => metric.summary[currency].knownSubtotal;
const rowSum = (rows, field) => Math.round(rows.reduce((sum, row) => sum + (row.included !== false && typeof row[field] === 'number' ? row[field] : 0), 0) * 100) / 100;
const november = metric => metric.monthly.find(point => point.month === '2026-11');

test('Analytics cards, trailing trend, exact contributors and breakdowns reconcile to saved snapshots', () => {
  const input = freeze(fixture());
  const before = JSON.stringify(input);
  const model = analytics.buildAnalytics(input, month, now);
  for (const [id, field, expected] of [['receipts', 'usd', 270], ['receipts', 'inr', 22490], ['hours', 'hours', 12],
    ['expenses', 'usd', 40], ['expenses', 'inr', 3350], ['payouts', 'usd', 150], ['payouts', 'inr', 12300]]) {
    const metric = model.metrics[id];
    assert.equal(metric.summary[field].value, expected, `${id} ${field} card`);
    assert.equal(november(metric).summary[field].value, expected, `${id} ${field} November trend`);
    assert.equal(rowSum(metric.rows, field), expected, `${id} exact contributor rows`);
    const group = id === 'expenses' ? 'expenseType' : id === 'hours' ? 'employee' : 'contract';
    assert.equal(metric.breakdowns[group].reduce((sum, item) => sum + item.summary[field].knownSubtotal, 0), expected, `${id} ${group} breakdown`);
  }
  assert.equal(model.metrics.hours.monthly.find(point => point.month === '2026-10').summary.hours.value, 6,
    'October 26–November 1 work belongs wholly to its stored start month');
  assert.deepEqual(model.metrics.receipts.rows.filter(row => row.included).map(row => row.source.id).sort(), ['i1', 'i2']);
  assert.deepEqual(model.metrics.payouts.rows.filter(row => row.included).map(row => row.source.id).sort(), ['p1', 'p2']);
  assert.equal(JSON.stringify(input), before, 'current prices, rates and FX must not replace saved values');
});

test('All-time includes undated monetary snapshots once and reconciles with dated trend plus undated bucket', () => {
  const input = fixture();
  input.incomingPayments.push(receipt('iu', 'c1', '', 40, 3320, { workWeekStart: '2026-10-05', workWeekEnd: '2026-10-11' }));
  input.expenses.push({ id: 'xu', expenseTypeId: 'x1', expenseDate: '', amountUsd: 5, amountInr: 400 });
  input.payouts.push(payout('pu', 'e1', 30, 2460, [line('c1', 30, 2460)], { paidDate: '', payoutDate: '2026-11-12', weekStart: '2026-10-05', weekEnd: '2026-10-11' }));
  freeze(input);
  const all = analytics.buildAnalytics(input, { ...month, period: 'all-time' }, now);
  const selected = analytics.buildAnalytics(input, month, now);
  for (const [id, usd, inr, undatedUsd] of [['receipts', 380, 31610, 40], ['expenses', 55, 4550, 5], ['payouts', 200, 16400, 30]]) {
    const metric = all.metrics[id];
    assert.equal(metric.summary.usd.value, usd, `${id} all-time USD`);
    assert.equal(metric.summary.inr.value, inr, `${id} all-time INR`);
    assert.equal(metric.undated.summary.usd.knownSubtotal, undatedUsd);
    assert.equal(metric.monthly.reduce((sum, point) => sum + point.summary.usd.knownSubtotal, 0) + undatedUsd, usd,
      'fixture lies within trailing twelve months; undated is never placed into a trend month');
    const u = selected.metrics[id].rows.find(row => row.source.id === ({ receipts: 'iu', expenses: 'xu', payouts: 'pu' })[id]);
    assert.equal(u.included, false, 'selected month cannot invent a date');
    assert.equal(u.usd, null);
    assert.equal(u.saved.usd, undatedUsd);
  }
});

test('selected-month cards use each metric date basis while the twelve-month trend ends at the selected anchor', () => {
  const input = freeze(fixture());
  const model = analytics.buildAnalytics(input, { ...month, month: '2026-10' }, now);
  assert.equal(model.metrics.receipts.summary.usd.value, 70);
  assert.equal(model.metrics.hours.summary.hours.value, 6);
  assert.equal(model.metrics.expenses.summary.usd.value, 10);
  assert.equal(model.metrics.payouts.summary.usd.value, 20, 'October schedule does not pull November paid snapshots into October');
  assert.equal(model.metrics.receipts.monthly.length, 12);
  assert.equal(model.metrics.receipts.monthly[0].month, '2025-11');
  assert.equal(model.metrics.receipts.monthly[11].month, '2026-10');
  const all = analytics.buildAnalytics(input, { ...month, period: 'all-time', month: '2026-10' }, now);
  assert.equal(all.metrics.receipts.summary.usd.value, 340, 'All-time card still includes November snapshots');
  assert.equal(all.metrics.receipts.monthly[11].month, '2026-10', 'trend scope remains separately anchored');
});

test('entity filters use reconciled payout portions and disclose unsupported metric scopes', () => {
  const input = freeze(fixture());
  const contract = analytics.buildAnalytics(input, { ...month, contractId: 'c1' }, now);
  assert.equal(subtotal(contract.metrics.receipts, 'usd'), 180);
  assert.equal(subtotal(contract.metrics.hours, 'hours'), 8);
  assert.equal(subtotal(contract.metrics.payouts, 'usd'), 110);
  assert.equal(subtotal(contract.metrics.payouts, 'inr'), 9000);
  assert.ok(contract.metrics.expenses.disabledReason, 'general expenses have no contract allocation');
  const client = analytics.buildAnalytics(input, { ...month, clientId: 'cl1' }, now);
  assert.equal(subtotal(client.metrics.payouts, 'usd'), 110);
  const employee = analytics.buildAnalytics(input, { ...month, employeeId: 'e1' }, now);
  assert.equal(subtotal(employee.metrics.payouts, 'usd'), 100);
  assert.equal(subtotal(employee.metrics.hours, 'hours'), 8);
  assert.ok(employee.metrics.receipts.disabledReason);
  assert.ok(employee.metrics.expenses.disabledReason);
  const intersection = analytics.buildAnalytics(input, { ...month, employeeId: 'e1', contractId: 'c1' }, now);
  assert.equal(subtotal(intersection.metrics.payouts, 'usd'), 60, 'never include both payout parent and selected line');
});

test('payout allocation reconciliation is independent per currency and never invents a balancing allocation', () => {
  const input = freeze(fixture({ incomingPayments: [], timeEntries: [], expenses: [],
    payouts: [payout('mismatch', 'e1', 100, 8300, [line('c1', 60, 5000), line('c2', 40, 3000)])] }));
  const overall = analytics.buildAnalytics(input, month, now);
  assert.equal(overall.metrics.payouts.summary.usd.value, 100);
  assert.equal(overall.metrics.payouts.summary.inr.value, 8300, 'valid parent remains all-contract authority');
  const filtered = analytics.buildAnalytics(input, { ...month, contractId: 'c1' }, now);
  assert.equal(filtered.metrics.payouts.summary.usd.value, 60);
  assert.equal(filtered.metrics.payouts.summary.inr.value, null);
  assert.equal(filtered.metrics.payouts.summary.inr.knownSubtotal, 0);
  assert.ok(filtered.metrics.payouts.summary.inr.exceptionCount > 0 || filtered.metrics.payouts.summary.inr.missingCount > 0);
  assert.ok(filtered.metrics.payouts.exceptions.length || filtered.warnings.length, 'unresolved allocation remains visible');
});

test('duplicate identities and overlapping work are visible exclusions, not silent deduplication or valid totals', () => {
  const input = fixture();
  input.incomingPayments = [receipt('known', 'c1', '2026-11-04', 100, 8300),
    receipt('dup', 'c1', '2026-11-05', 10, 830), receipt('dup', 'c1', '2026-11-06', 20, 1660)];
  input.timeEntries.push({ id: 'overlap', employeeId: 'e1', contractId: 'c1', weekStart: '2026-11-04', weekEnd: '2026-11-10', hours: 3, rateUsd: 10, totalUsd: 30 });
  const model = analytics.buildAnalytics(freeze(input), month, now);
  assert.equal(model.metrics.receipts.summary.usd.value, null);
  assert.equal(subtotal(model.metrics.receipts, 'usd'), 100);
  assert.equal(model.metrics.receipts.rows.filter(row => row.source.id === 'dup' && !row.included).length, 2);
  assert.equal(model.metrics.hours.summary.hours.value, null);
  assert.equal(subtotal(model.metrics.hours, 'hours'), 4, 'both mutually ambiguous overlapping entries are excluded');
  assert.ok(model.warnings.length > 0);
});

test('client-filter ambiguity cannot become complete again in payout contract breakdowns or exact chart rows', () => {
  const input = freeze(fixture({ incomingPayments: [], timeEntries: [], expenses: [],
    payouts: [payout('unknown-client-line', 'e1', 100, 8300, [line('c1', 60, 5000), line('orphan-contract', 40, 3300)])] }));
  const metric = analytics.buildAnalytics(input, { ...month, clientId: 'cl1' }, now).metrics.payouts;
  assert.equal(metric.summary.usd.value, null);
  assert.equal(metric.summary.inr.value, null);
  assert.equal(metric.summary.usd.knownSubtotal, 0);
  const contract = metric.breakdowns.contract.find(group => group.id === 'c1');
  assert.ok(contract);
  assert.equal(contract.summary.usd.value, null, 'a valid line amount cannot undo unknown client attribution');
  assert.equal(contract.summary.inr.value, null);
  assert.equal(rowSum(contract.rows, 'usd'), 0);
});

function rendererHarness(input) {
  const analyticsListeners = new Map();
  const analyticsPanel = { innerHTML: '', addEventListener(type, callback) { analyticsListeners.set(type, callback); }, querySelector() { return null; } };
  const nodes = new Map([
    ['#record-filter-month', { value: '2026-11' }], ['#record-filter-employee', { value: '' }], ['#record-filter-week', { value: '' }],
    ['#overview-month', { value: '2026-11' }], ['[data-overview-period].active', { dataset: { overviewPeriod: 'month' } }],
    ['#stats', { innerHTML: '' }], ['.overview-title .report-note', { textContent: '' }],
    ['#gst-rcm-summary', { innerHTML: '' }], ['#gst-rcm-table', { innerHTML: '' }],
    ['#analytics-panel', analyticsPanel],
  ]);
  const calls = [];
  const forbid = name => () => { calls.push(name); throw new Error(`Reporting called ${name}`); };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [2026, 10, 13, 12])); } }
  const context = vm.createContext({ console, Intl, Date: FixedDate, structuredClone, crypto: { randomUUID: forbid('randomUUID') },
    initialData: freeze(structuredClone(input)), document: { querySelector: key => nodes.get(key) || null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: forbid('localStorage.setItem') }, tracker: new Proxy({}, { get: (_, name) => forbid(`tracker.${String(name)}`) }), forbid });
  context.window = context;
  const index = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  for (const [, file] of index.matchAll(/<script src="\.\/((?:shared\/[^"<>]+|analytics-ui)\.js)"><\/script>/g)) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context, { filename: file });
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  const boundary = source.lastIndexOf('\nboot(');
  assert.ok(boundary > 0);
  vm.runInContext(source.slice(0, boundary), context, { filename: 'renderer.js' });
  vm.runInContext('data = initialData;', context);
  for (const name of ['save', 'persistIncomingPayments', 'persistIncomingQueueRow', 'reconcilePayoutWorkPeriods', 'refreshPendingPayoutFx', 'buildGeneratedPayouts', 'saveSharedUpworkFxRate', 'persistWorkContext']) {
    vm.runInContext(`${name} = forbid(${JSON.stringify(name)});`, context);
  }
  return { context, nodes, calls, analyticsPanel, analyticsListeners, run: code => vm.runInContext(code, context) };
}

test('Analytics reporting leaves source, existing Overview and Records outputs unchanged under financial write guards', () => {
  const h = rendererHarness(fixture());
  const before = h.run('JSON.stringify(data)');
  const reportsBefore = h.run("JSON.stringify(['records-time','records-payments','records-payouts','records-expenses','records-gst-rcm'].map(buildRecordsReport))");
  h.run('renderStats()');
  const overviewBefore = h.nodes.get('#stats').innerHTML;
  const legacyPaidSummary = h.run("buildRecordsReport('records-payouts').xlsxSummary.find(item => item.label === 'Total payouts').value");
  assert.equal(legacyPaidSummary, 50, 'Records intentionally retains scheduled-month scope');
  h.run("PaymentTrackerAnalytics.buildAnalytics(data, {period:'month', month:'2026-11', incomingRows:buildIncomingQueueRows(data)}, new Date())");
  h.run("PaymentTrackerAnalytics.buildAnalytics(data, {period:'all-time', month:'2026-11', contractId:'c1', currency:'INR', incomingRows:buildIncomingQueueRows(data)}, new Date())");
  h.run('analyticsDataReady = true; renderAnalytics()');
  assert.match(h.analyticsPanel.innerHTML, /id="analytics-card-receipts"/);
  h.analyticsListeners.get('change')({ target: { id: 'analytics-filter-currency', dataset: { analyticsFilter: 'currency' }, value: 'INR' } });
  h.analyticsListeners.get('change')({ target: { id: 'analytics-filter-contractId', dataset: { analyticsFilter: 'contractId' }, value: 'c1' } });
  assert.equal(h.run('analyticsController.getFilters().contractId'), 'c1');
  assert.equal(h.run('analyticsController.getFilters().currency'), 'INR');
  h.run('analyticsDataReady = false; renderAnalytics()');
  assert.doesNotMatch(h.analyticsPanel.innerHTML, /analytics-card-receipts/);
  h.analyticsListeners.get('change')({ target: { id: 'analytics-filter-currency', dataset: { analyticsFilter: 'currency' }, value: 'USD' } });
  assert.equal(h.run('analyticsController.getModel()'), null, 'stale controls cannot restore blocked totals');
  h.run('renderStats()');
  assert.equal(h.nodes.get('#stats').innerHTML, overviewBefore);
  assert.equal(h.run("JSON.stringify(['records-time','records-payments','records-payouts','records-expenses','records-gst-rcm'].map(buildRecordsReport))"), reportsBefore);
  assert.equal(h.run('JSON.stringify(data)'), before);
  assert.deepEqual(h.calls, []);
});
