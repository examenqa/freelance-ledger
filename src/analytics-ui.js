(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PaymentTrackerAnalyticsUI = api;
})(typeof globalThis === "object" ? globalThis : this, function (host) {
  "use strict";

  const metricIds = ["receipts", "hours", "expenses", "payouts"];
  const groupLabels = { client: "Client", contract: "Contract", employee: "Employee", expenseType: "Expense type" };
  const allowedGroups = { receipts: ["client", "contract"], hours: ["employee", "client", "contract"], expenses: ["expenseType"], payouts: ["employee", "client", "contract"] };
  const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
  const currencyFormats = {
    USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    INR: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }),
  };

  function escape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function runtimeMonth(now) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function initialState(now = new Date()) {
    return {
      filters: { period: "month", month: runtimeMonth(now), clientId: "", contractId: "", employeeId: "", currency: "USD" },
      trendMetric: "receipts", breakdownMetric: "receipts", groupBy: "client", details: null,
    };
  }

  function monthLabel(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) return "Undated";
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(`${month}-01T12:00:00`));
  }

  function amountFor(metric, summary, currency) {
    return summary?.[metric === "hours" ? "hours" : currency.toLowerCase()] || { value: null, knownSubtotal: 0, complete: false, missingCount: 0, exceptionCount: 0, knownCount: 0 };
  }

  function format(value, metric, currency) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
    return metric === "hours" ? `${number.format(value)} h` : currencyFormats[currency].format(value);
  }

  function summaryHtml(metric, summary, currency, className = "", context = "") {
    const amount = amountFor(metric, summary, currency);
    const unit = metric === "hours" ? "hours" : currency;
    const incomplete = amount.complete !== true;
    const count = Math.max(amount.missingCount || 0, amount.exceptionCount || 0);
    const value = incomplete ? (amount.knownCount ? format(amount.knownSubtotal, metric, currency) : "Unavailable") : format(amount.value, metric, currency);
    return `<div class="analytics-amount ${escape(className)}" data-metric="${escape(metric)}" data-context="${escape(context)}" data-currency="${escape(unit)}" data-value="${amount.value ?? ""}" data-known-subtotal="${amount.knownSubtotal ?? ""}" data-complete="${!incomplete}">
      <strong>${escape(value)}</strong><span class="analytics-unit">${escape(unit)}</span>
      ${!incomplete && !amount.knownCount ? '<small class="analytics-no-records">No records</small>' : ""}
      ${incomplete ? `<small class="analytics-partial">${amount.knownCount ? "Known subtotal · partial" : "Unavailable"}${count ? ` · ${count} exception${count === 1 ? "" : "s"}` : " · incomplete records"}</small>` : ""}
    </div>`;
  }

  function viewButton(kind, metric, text = "View data", extra = "") {
    return `<button type="button" class="analytics-text-button" data-analytics-view="${escape(kind)}" data-metric="${escape(metric)}" ${extra}>${escape(text)}</button>`;
  }

  function option(value, label, selected) {
    return `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`;
  }

  function entitySelect(model, state, key, optionKey, label) {
    const choices = (model.options?.[optionKey] || []).filter(row => key !== "contractId" || !state.filters.clientId || row.clientId === state.filters.clientId);
    const selectedLabel = choices.find(row => row.id === state.filters[key])?.label || `All ${label.toLowerCase()}s`;
    return `<label class="analytics-field" for="analytics-filter-${key}"><span>${escape(label)}</span><select id="analytics-filter-${key}" data-analytics-filter="${key}" title="${escape(selectedLabel)}">${option("", `All ${label.toLowerCase()}s`, state.filters[key])}${choices.map(row => option(row.id, row.label, state.filters[key])).join("")}</select></label>`;
  }

  function toolbar(model, state) {
    return `<div class="analytics-filters" aria-label="Analytics filters">
      <label class="analytics-field" for="analytics-filter-period"><span>Card and breakdown period</span><select id="analytics-filter-period" data-analytics-filter="period">${option("month", "Selected month", state.filters.period)}${option("all-time", "All time", state.filters.period)}</select></label>
      <label class="analytics-field analytics-month-field" for="analytics-filter-month"><span>Month / trend end</span><input id="analytics-filter-month" type="month" data-analytics-filter="month" value="${escape(state.filters.month)}" /></label>
      ${entitySelect(model, state, "clientId", "clients", "Client")}
      ${entitySelect(model, state, "contractId", "contracts", "Contract")}
      ${entitySelect(model, state, "employeeId", "employees", "Employee")}
      <label class="analytics-field analytics-currency-field" for="analytics-filter-currency"><span>Display currency</span><select id="analytics-filter-currency" data-analytics-filter="currency">${option("USD", "USD", state.filters.currency)}${option("INR", "INR reference", state.filters.currency)}</select></label>
      <button type="button" class="secondary-button analytics-reset" data-analytics-reset>Reset filters</button>
    </div>`;
  }

  function cards(model, state) {
    return `<div class="analytics-cards">${metricIds.map(id => {
      const metric = model.metrics[id];
      return `<article class="analytics-card" id="analytics-card-${id}" data-analytics-metric="${id}"><h3>${escape(metric.label)}</h3>
        ${metric.disabledReason ? `<p class="analytics-disabled">${escape(metric.disabledReason)}</p>` : summaryHtml(id, metric.summary, state.filters.currency, "", "card")}
        ${id === "expenses" ? '<p class="analytics-basis">Expense base · GST excluded.</p>' : ""}
        <p class="analytics-basis">${escape(metric.dateBasis)}</p>${!metric.disabledReason ? viewButton("metric", id, `View ${id === "hours" ? "work" : "data"}`) : ""}</article>`;
    }).join("")}</div>`;
  }

  function metricControl(model, state, panel) {
    const key = panel === "trend" ? "trendMetric" : "breakdownMetric";
    return `<label class="analytics-field" for="analytics-${panel}-metric"><span>Metric</span><select id="analytics-${panel}-metric" data-analytics-control="${key}">${metricIds.map(id => option(id, model.metrics[id].label, state[key])).join("")}</select></label>`;
  }

  function graphValue(metric, summary, currency) {
    const amount = amountFor(metric, summary, currency);
    return amount.complete && amount.value !== null ? amount.value : (amount.knownCount ? amount.knownSubtotal : null);
  }

  function combinedSummary(rows) {
    const result = {};
    for (const field of ["usd", "inr", "hours"]) {
      const amounts = rows.map(row => row.summary?.[field]).filter(Boolean);
      const sum = amounts.reduce((total, amount) => total + (amount.knownSubtotal ?? NaN), 0);
      const rounded = Math.round(sum * 100) / 100;
      const knownSubtotal = Number.isFinite(rounded) ? rounded : null;
      const complete = knownSubtotal !== null && amounts.every(amount => amount.complete);
      result[field] = { value: complete ? knownSubtotal : null, knownSubtotal, complete,
        knownCount: amounts.reduce((sum, amount) => sum + (amount.knownCount || 0), 0),
        missingCount: amounts.reduce((sum, amount) => sum + (amount.missingCount || 0), 0),
        exceptionCount: amounts.reduce((sum, amount) => sum + (amount.exceptionCount || 0), 0) + (knownSubtotal === null ? 1 : 0) };
    }
    return result;
  }

  function tick(value, metric, currency) {
    const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    return metric === "hours" ? `${compact} h` : `${currency === "INR" ? "₹" : "$"}${compact}`;
  }

  function svgChart(rows, metric, currency, kind, groupBy = "", dateBasis = "", scope = "") {
    const width = 680, height = kind === "trend" ? 275 : Math.max(240, rows.length * 42 + 45);
    const left = kind === "trend" ? 74 : 225, right = 24, top = 18, bottom = 58;
    const availableWidth = width - left - right, availableHeight = height - top - bottom;
    const values = rows.map(row => graphValue(metric, row.summary, currency));
    const finite = values.filter(value => value !== null);
    const max = Math.max(1, ...finite.map(value => Math.abs(value)));
    const hasNegative = finite.some(value => value < 0);
    const range = hasNegative ? max * 2 : max;
    const y = value => top + availableHeight - (value + (hasNegative ? max : 0)) / range * availableHeight;
    const zeroY = y(0), unit = metric === "hours" ? "hours" : `${currency}${currency === "INR" ? " reference" : ""}`;
    let marks = "";
    if (kind === "trend") {
      const step = availableWidth / Math.max(rows.length, 1);
      marks = rows.map((row, index) => {
        const value = values[index], amount = amountFor(metric, row.summary, currency);
        const x = left + index * step + step * .18, barWidth = step * .64;
        const label = `${monthLabel(row.month)}: ${value === null ? "Unavailable" : format(value, metric, currency)}${amount.complete ? "" : ", partial known subtotal"}. ${dateBasis}. ${amount.knownCount || 0} known; ${amount.missingCount || 0} missing; ${amount.exceptionCount || 0} exceptions. Trailing twelve months.`;
        const displayHeight = value === null ? 0 : Math.abs(y(value) - zeroY);
        return `<g tabindex="0" role="button" aria-label="${escape(label)}. View contributing records" data-analytics-view="trend" data-metric="${metric}" data-month="${escape(row.month)}"><title>${escape(label)}</title>
          <rect class="analytics-hit-area" x="${x - 5}" y="${top}" width="${barWidth + 10}" height="${availableHeight}" />
          ${value === null ? `<text x="${x + barWidth / 2}" y="${zeroY - 8}" class="analytics-chart-missing">?</text>` : `<rect class="analytics-bar${amount.complete ? "" : " analytics-bar-partial"}" x="${x}" y="${Math.min(y(value), zeroY)}" width="${barWidth}" height="${value === 0 ? 2 : Math.max(displayHeight, 1)}" />`}
          <text x="${x + barWidth / 2}" y="${height - 35}" class="analytics-chart-month">${escape(row.month.slice(5))}</text><text x="${x + barWidth / 2}" y="${height - 19}" class="analytics-chart-year">${escape(row.month.slice(0, 4))}</text>
        </g>`;
      }).join("");
      const ticks = hasNegative ? [-max, 0, max] : [0, max / 2, max];
      marks = ticks.map(value => `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" class="analytics-chart-grid"/><text x="${left - 9}" y="${y(value) + 4}" class="analytics-chart-tick">${escape(tick(value, metric, currency))}</text>`).join("") + marks;
    } else {
      const span = hasNegative ? availableWidth / 2 : availableWidth;
      const zeroX = left + (hasNegative ? span : 0);
      marks = rows.map((row, index) => {
        const value = values[index], amount = amountFor(metric, row.summary, currency), rowY = top + index * 42;
        const barWidth = value === null ? 0 : Math.abs(value) / max * span;
        const label = `${row.label}: ${value === null ? "Unavailable" : format(value, metric, currency)}${amount.complete ? "" : ", partial known subtotal"}. ${scope}. ${dateBasis}. ${amount.knownCount || 0} known; ${amount.missingCount || 0} missing; ${amount.exceptionCount || 0} exceptions.`;
        const shortLabel = row.label.length > 27 ? `${row.label.slice(0, 26)}…` : row.label;
        return `<g tabindex="0" role="button" aria-label="${escape(label)}. View contributing records" data-analytics-view="breakdown" data-metric="${metric}" data-group-by="${escape(groupBy)}" data-group-id="${escape(row.id)}"><title>${escape(label)}</title><rect class="analytics-hit-area" x="0" y="${rowY - 3}" width="${width}" height="38"/>
          <text class="analytics-chart-name" x="0" y="${rowY + 17}">${escape(shortLabel)}</text>
          ${value === null ? `<text x="${zeroX + 5}" y="${rowY + 17}">Unavailable</text>` : `<rect class="analytics-bar${amount.complete ? "" : " analytics-bar-partial"}" x="${value < 0 ? zeroX - barWidth : zeroX}" y="${rowY + 2}" width="${value === 0 ? 2 : Math.max(barWidth, 1)}" height="23"/>`}
        </g>`;
      }).join("");
      marks += `<text x="${left}" y="${height - 22}" class="analytics-chart-unit">${escape(unit)} · keyboard or click a bar for its records</text>`;
    }
    return `<svg id="analytics-${kind}-svg" class="analytics-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="${kind === "trend" ? "Trailing twelve month trend" : "Top five breakdown"}, ${escape(unit)}"><title>${kind === "trend" ? "Monthly trend" : "Supported breakdown"} in ${escape(unit)}</title>${marks}</svg>`;
  }

  function charts(model, state) {
    const trend = model.metrics[state.trendMetric], breakdown = model.metrics[state.breakdownMetric];
    const groups = allowedGroups[state.breakdownMetric];
    const groupBy = groups.includes(state.groupBy) ? state.groupBy : groups[0];
    const allGroups = breakdown.breakdowns?.[groupBy] || [];
    const sorted = [...allGroups].sort((a, b) => (graphValue(state.breakdownMetric, b.summary, state.filters.currency) ?? -Infinity) - (graphValue(state.breakdownMetric, a.summary, state.filters.currency) ?? -Infinity) || a.label.localeCompare(b.label));
    const top = sorted.slice(0, 5);
    const remaining = sorted.slice(5);
    const monthly = trend.monthly || [];
    const trendPeriod = monthly.length ? `${monthLabel(monthly[0].month)} – ${monthLabel(monthly[monthly.length - 1].month)}` : "Trailing 12 months";
    return `<div class="analytics-charts">
      <section class="analytics-chart-panel" aria-labelledby="analytics-trend-heading"><div class="analytics-chart-heading"><div><h3 id="analytics-trend-heading">Monthly trend</h3><p>${escape(trendPeriod)} · separate trailing-12-month scope</p></div>${metricControl(model, state, "trend")}</div>
        <p class="analytics-basis">${escape(trend.dateBasis)}. Ends at the selected month. Entity filters apply; All time does not expand this trend.</p>
        ${trend.disabledReason ? `<p class="analytics-disabled">${escape(trend.disabledReason)}</p>` : `${monthly.some(row => row.rows?.length) ? svgChart(monthly, state.trendMetric, state.filters.currency, "trend", "", trend.dateBasis) : '<p class="analytics-empty">No records in the trailing twelve months.</p>'}<p class="analytics-chart-note">${state.trendMetric === "hours" ? "Hours" : state.filters.currency === "INR" ? "Historical INR reference" : "USD"} · ? unavailable · dashed bars are partial known subtotals.</p>${viewButton("trend", state.trendMetric, "View trend data")}`}
      </section>
      <section class="analytics-chart-panel" aria-labelledby="analytics-breakdown-heading"><div class="analytics-chart-heading"><div><h3 id="analytics-breakdown-heading">${escape(groupLabels[groupBy])} breakdown</h3><p>${state.filters.period === "all-time" ? "All time" : escape(monthLabel(state.filters.month))} · top 5 of ${allGroups.length}</p></div><div class="analytics-chart-controls">${metricControl(model, state, "breakdown")}<label class="analytics-field" for="analytics-group-by"><span>Group by</span><select id="analytics-group-by" data-analytics-control="groupBy">${groups.map(key => option(key, groupLabels[key], groupBy)).join("")}</select></label></div></div>
        ${breakdown.disabledReason ? `<p class="analytics-disabled">${escape(breakdown.disabledReason)}</p>` : top.length ? `${svgChart(top, state.breakdownMetric, state.filters.currency, "breakdown", groupBy, breakdown.dateBasis, state.filters.period === "all-time" ? "All time" : monthLabel(state.filters.month))}${remaining.length ? `<div class="analytics-remaining"><span>Remaining ${remaining.length} groups</span>${summaryHtml(state.breakdownMetric, combinedSummary(remaining), state.filters.currency, "", "remaining-groups")}</div>` : ""}<p class="analytics-chart-note">Full names and amounts are available on focus and in View data. All groups, including the remainder, are listed in the table.</p>${viewButton("breakdown", state.breakdownMetric, "View all breakdown data", `data-group-by="${groupBy}"`)}` : `<p class="analytics-empty">No groups for these filters.</p>${viewButton("breakdown", state.breakdownMetric, "View breakdown data", `data-group-by="${groupBy}"`)}`}
      </section>
    </div>`;
  }

  function undated(model, state) {
    const entries = metricIds.map(id => ({ id, metric: model.metrics[id] })).filter(({ metric }) => !metric.disabledReason && metric.undated?.rows?.length);
    if (!entries.length) return "";
    return `<section class="analytics-undated" aria-labelledby="analytics-undated-heading"><h3 id="analytics-undated-heading">Undated or invalid dates</h3><p>These amounts have no reliable month. Valid saved amounts are included in All time only; no dates have been inferred.</p><div class="analytics-undated-grid">${entries.map(({ id, metric }) => `<article><h4>${escape(metric.label)} · ${metric.undated.rows.length} record${metric.undated.rows.length === 1 ? "" : "s"}</h4>${summaryHtml(id, metric.undated.summary, state.filters.currency, "", "undated")}${viewButton("undated", id)}</article>`).join("")}</div></section>`;
  }

  function commitments(model, state) {
    return `<section class="analytics-commitments" aria-labelledby="analytics-commitments-heading"><div><h3 id="analytics-commitments-heading">Commitments · all periods</h3><p>Current unpaid commitments, independent of the card period. Entity filters apply where supported.</p></div><div class="analytics-commitment-grid">${["incoming", "payouts"].map(id => {
      const metric = model.commitments[id];
      return `<article id="analytics-commitment-${id}"><h4>${id === "incoming" ? "Estimated pending incoming work" : "Pending employee payouts"}</h4>${metric.disabledReason ? `<p class="analytics-disabled">${escape(metric.disabledReason)}</p>` : `${summaryHtml(id, metric.summary, state.filters.currency, "", "commitment")}<p class="analytics-basis">${id === "incoming" ? "Estimate from the existing queue; not an invoice balance or money received." : "Saved unpaid payout snapshots; INR is a reference, not a bank reconciliation."}</p>${id === "payouts" ? pendingSchedule(metric, model.runtimeDate || "") : ""}${viewButton("commitment", id)}`}</article>`;
    }).join("")}</div></section>`;
  }

  function pendingSchedule(metric, today) {
    const rows = (metric.rows || []).filter(row => row.scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(row.scheduledDate));
    if (!rows.length) return '<p class="analytics-basis">No reliable scheduled dates available.</p>';
    const late = rows.filter(row => today && row.scheduledDate < today).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
    const next = rows.filter(row => !today || row.scheduledDate >= today).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
    return `<div class="analytics-schedule"><h5>Scheduled payouts</h5>${[["Past scheduled date", late], ["Next scheduled", next]].map(([label, entries]) => entries.length ? `<p><strong>${label}</strong> · ${entries.length}</p><ul>${entries.slice(0, 2).map(row => `<li>${escape(row.scheduledDate)} · ${escape(row.employeeLabel || row.label || "Employee")}</li>`).join("")}</ul>` : "").join("")}<p>Schedule only; payment is unconfirmed until marked paid.</p></div>`;
  }

  function warnings(model) {
    const rows = model.warnings || [];
    if (!rows.length) return "";
    const prioritized = [...rows].sort((a, b) => Number(/invalid|duplicate|overlap|missing|unresolved|ambiguous|unsupported/.test(b.code)) - Number(/invalid|duplicate|overlap|missing|unresolved|ambiguous|unsupported/.test(a.code)));
    const messages = [...new Set(prioritized.map(row => row.message))];
    return `<aside class="analytics-warnings" aria-labelledby="analytics-warning-heading"><h3 id="analytics-warning-heading">Reporting notes and exceptions · ${rows.length}</h3><p>Incomplete totals are marked partial or Unavailable. Review exceptions and reporting assumptions below; source records remain unchanged.</p><ul>${messages.slice(0, 4).map(message => `<li>${escape(message)}</li>`).join("")}</ul>${messages.length > 4 ? `<p>${messages.length - 4} more warning types are listed in View data.</p>` : ""}${viewButton("warnings", "", "View all exceptions")}</aside>`;
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter(row => {
      const key = row.key || `${row.source?.collection}:${row.source?.index}:${row.id}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  function detailsRows(model, details) {
    if (!details) return [];
    const metric = details.kind === "commitment" ? model.commitments[details.metric] : model.metrics[details.metric];
    if (details.kind === "warnings") return [];
    if (!metric) return [];
    if (details.kind === "undated") return metric.undated?.rows || [];
    if (details.kind === "trend") return uniqueRows((metric.monthly || []).filter(row => !details.month || row.month === details.month).flatMap(row => row.rows || []));
    if (details.kind === "breakdown") {
      const groups = metric.breakdowns?.[details.groupBy] || [];
      return details.groupId !== undefined ? groups.find(row => row.id === details.groupId)?.rows || [] : uniqueRows(groups.flatMap(row => row.rows || []));
    }
    return metric.rows || [];
  }

  function seriesTable(model, state, details) {
    if (!["trend", "breakdown"].includes(details.kind)) return "";
    const metric = model.metrics[details.metric];
    const series = details.kind === "trend" ? (metric.monthly || []).filter(row => !details.month || row.month === details.month).map(row => ({ ...row, label: monthLabel(row.month) })) : (metric.breakdowns?.[details.groupBy] || []).filter(row => details.groupId === undefined || row.id === details.groupId);
    return `<div class="analytics-data-wrap analytics-series-wrap" tabindex="0" aria-label="Chart values"><table id="analytics-series-table"><thead><tr><th>${details.kind === "trend" ? "Month" : escape(groupLabels[details.groupBy])}</th><th>${details.metric === "hours" ? "Hours" : "USD"}</th>${details.metric === "hours" ? "" : "<th>INR reference</th>"}<th>Source rows</th><th>Details</th></tr></thead><tbody>${series.map(row => `<tr><td>${escape(row.label)}</td><td>${summaryHtml(details.metric, row.summary, "USD", "", "series-table")}</td>${details.metric === "hours" ? "" : `<td>${summaryHtml(details.metric, row.summary, "INR", "", "series-table")}</td>`}<td>${row.rows?.length || 0}</td><td>${viewButton(details.kind, details.metric, "View source rows", details.kind === "trend" ? `data-month="${escape(row.month)}"` : `data-group-by="${escape(details.groupBy)}" data-group-id="${escape(row.id)}"`)}</td></tr>`).join("") || '<tr><td colspan="5">No chart values for this scope.</td></tr>'}</tbody></table></div>`;
  }

  function savedCell(value, applicable, metric, currency) {
    return applicable ? escape(format(value, metric, currency)) : "—";
  }

  function contributionRow(row, metric) {
    const monetary = metric !== "hours";
    const hasHours = metric === "hours" || row.saved?.hours !== null && row.saved?.hours !== undefined;
    const refs = (row.sourceRefs || []).map(ref => `${ref.collection || ""}[${ref.index ?? "?"}]${ref.path ? `.${ref.path}` : ""} ${ref.id || ""}`).join("; ");
    const savedDate = row.savedDate && row.savedDate !== row.date ? `<br><small>Saved date: ${escape(row.savedDate)} · not assigned to a month</small>` : "";
    const workDates = row.weekStart || row.weekEnd ? `<br><small>Work: ${escape(row.weekStart || "Unavailable")} – ${escape(row.weekEnd || "Unavailable")}</small>` : "";
    const scheduledDate = row.scheduledDate || row.savedScheduledDate ? `<br><small>Scheduled: ${escape(row.scheduledDate || row.savedScheduledDate)}${row.scheduledDate ? "" : " (invalid)"}</small>` : "";
    return `<tr data-source-key="${escape(row.key)}" data-included="${row.included === true}">
      <td>${escape(row.source?.collection || "")} [${row.source?.index ?? "?"}]<br>${escape(row.id || "No ID")}${refs ? `<br><small>${escape(refs)}</small>` : ""}</td>
      <td>${escape(row.date || "Undated / invalid")}${savedDate}<br><small>${escape(row.dateBasis || "")}</small>${workDates}${scheduledDate}</td>
      <td>${escape(row.label || row.expenseTypeLabel || "—")}</td><td>${escape(row.clientLabel || "—")}</td><td>${escape(row.contractLabel || "—")}</td><td>${escape(row.employeeLabel || "—")}</td>
      <td>${savedCell(row.saved?.usd, monetary, "money", "USD")}</td><td data-counted-usd="${row.usd ?? ""}">${savedCell(row.usd, monetary, "money", "USD")}</td>
      <td>${savedCell(row.saved?.inr, monetary, "money", "INR")}</td><td data-counted-inr="${row.inr ?? ""}">${savedCell(row.inr, monetary, "money", "INR")}</td>
      ${metric === "expenses" ? `<td data-saved-gst-usd="${row.gstUsd ?? ""}">${savedCell(row.gstUsd, true, "money", "USD")}</td><td data-saved-gst-inr="${row.gstInr ?? ""}">${savedCell(row.gstInr, true, "money", "INR")}</td>` : ""}
      <td>${savedCell(row.saved?.hours, hasHours, "hours", "USD")}</td><td data-counted-hours="${row.hours ?? ""}">${savedCell(row.hours, hasHours, "hours", "USD")}</td>
      <td>${escape(row.status || (row.included ? "Included" : "Excluded"))}${(row.issues || []).length ? `<ul>${row.issues.map(issue => `<li>${escape(issue.message)}</li>`).join("")}</ul>` : ""}</td></tr>`;
  }

  function detailsHtml(model, state) {
    const details = state.details;
    if (!details) return "";
    if (details.kind === "warnings") {
      return `<section class="analytics-details" aria-labelledby="analytics-detail-heading"><div class="analytics-detail-title"><h3 id="analytics-detail-heading" tabindex="-1">All reporting exceptions</h3><button type="button" class="secondary-button" data-analytics-close>Close data</button></div><div class="analytics-data-wrap" tabindex="0" aria-label="Reporting exception table"><table><thead><tr><th>Metric</th><th>Warning</th><th>Exact source references</th></tr></thead><tbody>${(model.warnings || []).map(row => `<tr><td>${escape(row.metric || "General")}</td><td>${escape(row.message)}</td><td>${escape((row.refs || []).map(ref => `${ref.collection}[${ref.index}] · ${ref.id || "No ID"}`).join("; "))}</td></tr>`).join("")}</tbody></table></div></section>`;
    }
    const metric = details.kind === "commitment" ? model.commitments[details.metric] : model.metrics[details.metric];
    const rows = detailsRows(model, details);
    const group = details.kind === "breakdown" && details.groupId !== undefined ? metric.breakdowns?.[details.groupBy]?.find(row => row.id === details.groupId) : null;
    const scope = details.kind === "trend" ? (details.month ? monthLabel(details.month) : "Trailing 12 months") : details.kind === "undated" ? "Undated / invalid dates" : details.kind === "commitment" ? "All periods" : state.filters.period === "all-time" ? "All time" : monthLabel(state.filters.month);
    const title = `${metric.label} · ${group?.label || scope}`;
    const selectedSummary = details.kind === "trend" ? combinedSummary((metric.monthly || []).filter(row => !details.month || row.month === details.month)) : details.kind === "undated" ? metric.undated.summary : group?.summary || metric.summary;
    return `<section class="analytics-details" aria-labelledby="analytics-detail-heading"><div class="analytics-detail-title"><div><h3 id="analytics-detail-heading" tabindex="-1">${escape(title)}</h3><p>${rows.length} source row${rows.length === 1 ? "" : "s"} · ${escape(metric.dateBasis)}. Saved amounts and counted contributions are shown separately.${details.metric === "expenses" ? " Expense base excludes GST; saved GST is shown separately and is not added to the base." : ""}</p></div><button type="button" class="secondary-button" data-analytics-close>Close data</button></div>
      ${summaryHtml(details.metric, selectedSummary, state.filters.currency, "", "detail")}${seriesTable(model, state, details)}
      <div class="analytics-data-wrap" tabindex="0" aria-label="${escape(title)} data table"><table id="analytics-detail-table"><thead><tr><th>Source / ID</th><th>Date</th><th>Item / full name</th><th>Client</th><th>Contract</th><th>Employee</th><th>Saved USD</th><th>Counted USD</th><th>Saved INR</th><th>Counted INR</th>${details.metric === "expenses" ? "<th>Saved GST USD</th><th>Saved GST INR</th>" : ""}<th>Saved hours</th><th>Counted hours</th><th>Status / warnings</th></tr></thead><tbody>${rows.length ? rows.map(row => contributionRow(row, details.metric)).join("") : `<tr><td colspan="${details.metric === "expenses" ? 15 : 13}">No contributing records for this view.</td></tr>`}</tbody></table></div>
      <p class="analytics-chart-note">INR is the saved historical reference. Unavailable does not mean zero. Source indexes are zero-based positions in the loaded dataset.</p></section>`;
  }

  function renderHtml(model, state) {
    return `<div class="analytics-heading"><div><h2>Analytics</h2><p>Saved financial history and recorded work, with explicit dates and completeness.</p></div><span class="analytics-scope">${state.filters.period === "all-time" ? "All time" : escape(monthLabel(state.filters.month))}</span></div>
      ${toolbar(model, state)}<p class="analytics-policy">Archived entities are included. Client reporting follows the contract’s current client association. Work periods crossing a month belong entirely to their start month. INR values are historical references; no current exchange rate is applied.</p>
      ${cards(model, state)}${warnings(model)}${charts(model, state)}${undated(model, state)}${commitments(model, state)}${detailsHtml(model, state)}`;
  }

  function createController(element, { getData, getIncomingRows = () => [], now = () => new Date(), isAvailable = () => true, buildAnalytics = host.PaymentTrackerAnalytics?.buildAnalytics } = {}) {
    let state = initialState(now()), model = null;
    function render(focusId = "") {
      if (!isAvailable()) {
        model = null;
        element.innerHTML = '<h2>Analytics</h2><p>Analytics is unavailable until a valid data file loads. Source records have not been changed.</p>';
        return null;
      }
      let incomingRows;
      try { incomingRows = getIncomingRows(); } catch (_error) { /* The queue estimate may fail independently of saved history. */ }
      model = buildAnalytics(getData(), { ...state.filters, incomingRows }, now());
      state.filters = { ...state.filters, ...model.filters };
      element.innerHTML = renderHtml(model, state);
      if (focusId) element.querySelector?.(`#${focusId}`)?.focus();
      return model;
    }
    function openDetails(target) {
      state.details = { kind: target.dataset.analyticsView, metric: target.dataset.metric || "" };
      if (target.dataset.month) state.details.month = target.dataset.month;
      if (target.dataset.groupBy) state.details.groupBy = target.dataset.groupBy;
      if (target.dataset.groupId !== undefined) state.details.groupId = target.dataset.groupId;
      render("analytics-detail-heading");
      element.querySelector?.(".analytics-details")?.scrollIntoView?.({ block: "nearest" });
    }
    element.addEventListener("change", event => {
      const target = event.target;
      if (target.dataset.analyticsFilter) {
        state.filters[target.dataset.analyticsFilter] = target.value;
        if (target.dataset.analyticsFilter === "clientId" && state.filters.contractId && !(model?.options?.contracts || []).some(row => row.id === state.filters.contractId && (!target.value || row.clientId === target.value))) state.filters.contractId = "";
        state.details = null;
      } else if (target.dataset.analyticsControl) {
        state[target.dataset.analyticsControl] = target.value;
        if (target.dataset.analyticsControl === "breakdownMetric") state.groupBy = allowedGroups[state.breakdownMetric][0];
        state.details = null;
      } else return;
      render(target.id);
    });
    element.addEventListener("click", event => {
      const target = event.target.closest?.("[data-analytics-view], [data-analytics-close], [data-analytics-reset]");
      if (!target) return;
      if (target.hasAttribute("data-analytics-reset")) { state = initialState(now()); render("analytics-filter-period"); }
      else if (target.hasAttribute("data-analytics-close")) { state.details = null; render("analytics-filter-period"); }
      else openDetails(target);
    });
    element.addEventListener("keydown", event => {
      const target = event.target.closest?.('svg [data-analytics-view]');
      if (target && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetails(target); }
    });
    return {
      render, getFilters: () => ({ ...state.filters }), getModel: () => model,
      reset() { state = initialState(now()); return render(); },
    };
  }

  return { initialState, renderHtml, detailsRows, createController };
});
