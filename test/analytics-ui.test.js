const test = require('node:test');
const assert = require('node:assert/strict');
const analytics = require('../src/shared/analytics');
const ui = require('../src/analytics-ui');
const { createDefaultData } = require('../src/shared/data-schema');

const now = new Date(2026, 10, 13, 12);
const longName = 'Synthetic <script>unsafe()</script> & Studio '.repeat(4);
function fixture() {
  return { ...createDefaultData(), clients: [{ id: 'cl1', name: longName }, { id: 'cl2', name: 'Synthetic client B' }],
    contracts: [{ id: 'c1', clientId: 'cl1', shortName: longName }, { id: 'c2', clientId: 'cl2', shortName: 'Synthetic contract B' }],
    employees: [{ id: 'e1', name: 'Synthetic employee A' }], expenseTypes: [{ id: 'x1', name: 'Synthetic software' }],
    incomingPayments: [{ id: 'i1', contractId: 'c1', received: true, paymentDate: '2026-11-04', netUsd: 50, netInr: 5000 },
      { id: 'i2', contractId: 'c2', received: true, paymentDate: '2026-11-05', netUsd: 25, netInr: 2000 },
      { id: 'io', contractId: 'c1', received: true, paymentDate: '2026-10-06', netUsd: 20, netInr: 1600 }],
    timeEntries: [{ id: 'w1', employeeId: 'e1', contractId: 'c1', weekStart: '2026-11-02', weekEnd: '2026-11-08', hours: 8 }],
    expenses: [{ id: 'x1', expenseTypeId: 'x1', expenseDate: '2026-11-06', amountUsd: 10, amountInr: 830 }],
    payouts: [{ id: 'p1', employeeId: 'e1', paid: true, paidDate: '2026-11-10', payoutDate: '2026-11-12',
      weekStart: '2026-10-26', weekEnd: '2026-11-01', totalUsd: 60, totalInr: 4980,
      contracts: [{ contractId: 'c1', totalUsd: 40, totalInr: 3320 }, { contractId: 'c2', totalUsd: 20, totalInr: 1660 }] }] };
}
function deepFreeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(item => { if (item && typeof item === 'object' && !Object.isFrozen(item)) deepFreeze(item); }); } return value; }
const sum = (rows, field) => rows.reduce((total, row) => total + (row.included !== false && typeof row[field] === 'number' ? row[field] : 0), 0);
const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function rootStub() {
  const listeners = new Map();
  return { innerHTML: '', addEventListener(type, callback) { listeners.set(type, callback); }, querySelector() { return null; },
    dispatch(type, event) { assert.ok(listeners.has(type), `bound ${type}`); listeners.get(type)(event); }, listeners };
}
function attributeNumber(html, metric, attribute) {
  const card = html.match(new RegExp(`<article[^>]*id="analytics-card-${metric}"[\\s\\S]*?<\\/article>`));
  assert.ok(card, metric + ' card');
  const value = card[0].match(new RegExp(`${attribute}="([^"]*)"`));
  return value ? (value[1] === '' ? null : Number(value[1])) : undefined;
}

test('Analytics UI renders matching cards, trend/bar contributor tables, full escaped names and explicit scopes', () => {
  const input = deepFreeze(fixture()), before = JSON.stringify(input), state = ui.initialState(now);
  const model = analytics.buildAnalytics(input, { ...state.filters, incomingRows: [] }, now);
  let html = ui.renderHtml(model, state);
  for (const [metric, field, expected] of [['receipts', 'usd', 75], ['hours', 'hours', 8], ['expenses', 'usd', 10], ['payouts', 'usd', 60]]) {
    assert.equal(attributeNumber(html, metric, 'data-value'), expected);
    assert.equal(sum(ui.detailsRows(model, { kind: 'metric', metric }), field), expected);
    assert.equal(sum(ui.detailsRows(model, { kind: 'trend', metric, month: '2026-11' }), field), expected);
  }
  const group = model.metrics.receipts.breakdowns.client.find(row => row.id === 'cl1');
  assert.equal(sum(ui.detailsRows(model, { kind: 'breakdown', metric: 'receipts', groupBy: 'client', groupId: 'cl1' }), 'usd'), group.summary.usd.value);
  assert.match(html, /separate trailing-12-month scope/);
  assert.match(html, /Commitments[^<]*all periods/i);
  assert.match(html, /data-analytics-view="trend"/);
  assert.match(html, /tabindex="0" role="button"/);
  assert.match(html, /Nov 2026: \$75\.00/, 'plotted November value matches the received-money card');
  assert.ok(html.includes(esc(longName)), 'complete long name available in labels/options/tooltips');
  assert.doesNotMatch(html, /<script>unsafe|NaN|Infinity/);
  state.details = { kind: 'metric', metric: 'receipts' };
  html = ui.renderHtml(model, state);
  assert.match(html, /id="analytics-detail-table"/);
  assert.equal((html.match(/data-counted-usd=/g) || []).length, 2);
  assert.match(html, /Saved USD<\/th><th>Counted USD/);
  assert.equal(JSON.stringify(input), before);
});

test('all payout breakdown data exposes saved line contributors rather than substituting full parents', () => {
  const model = analytics.buildAnalytics(deepFreeze(fixture()), ui.initialState(now).filters, now);
  const allLines = ui.detailsRows(model, { kind: 'breakdown', metric: 'payouts', groupBy: 'contract' });
  assert.equal(allLines.length, 2, 'two contract allocations, not the single parent');
  assert.equal(sum(allLines, 'usd'), 60);
  assert.deepEqual(allLines.map(row => row.contractId).sort(), ['c1', 'c2']);
  assert.ok(allLines.every(row => row.sourceRefs.some(ref => /^contracts\[\d+\]$/.test(ref.path))), 'exact allocation path is retained');
  assert.equal(ui.detailsRows(model, { kind: 'metric', metric: 'payouts' }).length, 1, 'card detail remains parent-authoritative');
});

test('controller filters and keyboard View data are session-only reporting operations on frozen input', () => {
  const input = deepFreeze(fixture()), before = JSON.stringify(input), root = rootStub();
  let builds = 0;
  const controller = ui.createController(root, { getData: () => input, getIncomingRows: () => [], now: () => now,
    buildAnalytics(data, filters, time) { builds++; return analytics.buildAnalytics(data, filters, time); } });
  controller.render();
  assert.equal(controller.getFilters().month, '2026-11');
  const change = (name, value) => root.dispatch('change', { target: { id: `analytics-filter-${name}`, dataset: { analyticsFilter: name }, value } });
  change('currency', 'INR');
  assert.equal(attributeNumber(root.innerHTML, 'receipts', 'data-value'), 7000);
  change('employeeId', 'e1');
  assert.ok(controller.getModel().metrics.receipts.disabledReason);
  assert.ok(controller.getModel().metrics.expenses.disabledReason);
  assert.equal(attributeNumber(root.innerHTML, 'hours', 'data-value'), 8);
  change('employeeId', '');
  let prevented = false;
  const target = { dataset: { analyticsView: 'trend', metric: 'receipts', month: '2026-11' }, closest() { return this; } };
  root.dispatch('keydown', { target, key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(root.innerHTML, /id="analytics-detail-table"/);
  assert.equal((root.innerHTML.match(/data-counted-usd=/g) || []).length, 2);
  change('period', 'all-time');
  assert.equal(attributeNumber(root.innerHTML, 'receipts', 'data-value'), 8600, 'All-time currency remains INR');
  const detached = controller.getFilters(); detached.employeeId = 'unrelated';
  assert.equal(controller.getFilters().employeeId, '', 'external callers cannot mutate session filters');
  controller.reset();
  assert.equal(controller.getFilters().currency, 'USD');
  assert.ok(builds >= 7);
  assert.equal(JSON.stringify(input), before);
});

test('empty data stays distinct from unavailable money and raw invalid dates stay visible in View data', () => {
  const state = ui.initialState(now);
  const empty = analytics.buildAnalytics(createDefaultData(), { ...state.filters, incomingRows: [] }, now);
  const emptyHtml = ui.renderHtml(empty, state);
  assert.equal(attributeNumber(emptyHtml, 'receipts', 'data-value'), 0);
  const bad = fixture();
  bad.incomingPayments = [{ id: 'bad', contractId: 'c1', received: true, paymentDate: '2026-02-30', netInr: 0 }];
  const model = analytics.buildAnalytics(deepFreeze(bad), { ...state.filters, incomingRows: [] }, now);
  state.details = { kind: 'undated', metric: 'receipts' };
  const html = ui.renderHtml(model, state);
  assert.equal(attributeNumber(html, 'receipts', 'data-value'), null);
  assert.match(html, /Unavailable/);
  assert.match(html, /2026-02-30/, 'show invalid saved date without normalizing it to another month');
  assert.match(html, /data-counted-usd=""/);
  assert.match(html, /Saved INR/);
});

test('recovery availability removes stale totals and old delegated events cannot read or render financial data', () => {
  const input = deepFreeze(fixture()), root = rootStub();
  let available = true, reads = 0;
  const controller = ui.createController(root, { isAvailable: () => available,
    getData() { assert.equal(available, true); reads++; return input; },
    getIncomingRows: () => [], now: () => now, buildAnalytics: analytics.buildAnalytics });
  controller.render();
  assert.equal(attributeNumber(root.innerHTML, 'receipts', 'data-value'), 75);
  available = false;
  assert.equal(controller.render(), null);
  assert.equal(controller.getModel(), null);
  assert.doesNotMatch(root.innerHTML, /analytics-card-receipts|data-value="75"/);
  const readsBeforeOldEvent = reads;
  root.dispatch('change', { target: { id: 'analytics-filter-currency', dataset: { analyticsFilter: 'currency' }, value: 'INR' } });
  assert.equal(reads, readsBeforeOldEvent, 'a stale event must not read a blocked dataset');
  assert.equal(controller.getModel(), null);
  available = true;
  controller.reset();
  assert.equal(attributeNumber(root.innerHTML, 'receipts', 'data-value'), 75);
  assert.equal(controller.getFilters().currency, 'USD');
});

test('changing client clears an incompatible contract rather than leaving a misleading filter intersection', () => {
  const root = rootStub();
  const controller = ui.createController(root, { getData: fixture, getIncomingRows: () => [], now: () => now, buildAnalytics: analytics.buildAnalytics });
  controller.render();
  const change = (name, value) => root.dispatch('change', { target: { id: `analytics-filter-${name}`, dataset: { analyticsFilter: name }, value } });
  change('contractId', 'c2');
  assert.equal(controller.getModel().metrics.receipts.summary.usd.value, 25);
  change('clientId', 'cl1');
  assert.equal(controller.getFilters().contractId, '');
  assert.equal(controller.getModel().metrics.receipts.summary.usd.value, 50);
  const select = root.innerHTML.match(/<select id="analytics-filter-contractId"[\s\S]*?<\/select>/)[0];
  assert.match(select, /value="c1"/);
  assert.doesNotMatch(select, /value="c2"/);
});

test('expense base excludes GST while View data shows separate saved GST currencies without filling missing INR', () => {
  const input = fixture();
  input.expenses[0].gstPayableUsd = 1.8;
  input.expenses.push({ id: 'x2', expenseTypeId: 'x1', expenseDate: '2026-11-09', amountUsd: 5, amountInr: 415,
    gstPayableUsd: 0.9, gstPayableInr: 74.7 });
  deepFreeze(input);
  const before = JSON.stringify(input), state = ui.initialState(now);
  const model = analytics.buildAnalytics(input, { ...state.filters, incomingRows: [] }, now);
  state.details = { kind: 'metric', metric: 'expenses' };
  const html = ui.renderHtml(model, state);
  const card = html.match(/<article[^>]*id="analytics-card-expenses"[\s\S]*?<\/article>/)[0];
  assert.match(card, /Expense base · GST excluded/);
  assert.equal(attributeNumber(html, 'expenses', 'data-value'), 15);
  assert.equal(model.metrics.expenses.summary.inr.value, 1245, 'missing GST INR must not make saved expense base INR incomplete');
  assert.equal(sum(ui.detailsRows(model, state.details), 'usd'), 15, 'GST is not added to counted expense base');
  assert.match(html, /<th>Saved GST USD<\/th>/);
  assert.match(html, /<th>Saved GST INR<\/th>/);
  assert.match(html, /data-saved-gst-usd="1\.8"/);
  assert.match(html, /data-saved-gst-usd="0\.9"/);
  assert.match(html, /data-saved-gst-inr="74\.7"/);
  const missing = html.match(/<td\b[^>]*data-saved-gst-inr=""[^>]*>([\s\S]*?)<\/td>/);
  assert.ok(missing, 'missing saved GST INR cell remains blank in numeric metadata');
  assert.match(missing[1], /Unavailable/);
  assert.equal(JSON.stringify(input), before, 'presentation must not infer or backfill saved GST');
});
