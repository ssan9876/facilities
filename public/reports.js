import {requestTypes} from './request-settings.js';
import {state, $, escape, icon, money, today, addDays, api, heading, fmt} from './ui.js';
import {hooks} from './hooks.js';

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) + '%' : '—');
function breakdown(title, rows, label = r => r.label, {completed = true} = {}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return `<section class="panel"><h2>${title}</h2>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${title.replace(/^By /, '')}</th><th>Requests</th><th>Share</th>${completed ? '<th>Completed</th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr><td>${escape(label(r))}</td><td>${r.count}</td><td>${pct(r.count, total)}</td>${completed ? `<td>${r.completed}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">No requests in this period.</div>'}</section>`;
}
export function reportsPage() {
  const r = state.report,
    range = (state.reportRange ||= {from: addDays(today(), -29), to: today()});
  const query = `from=${range.from}&to=${range.to}`;
  const controls = `<form id="report-range" class="report-range"><label class="field">From<input type="date" name="from" value="${range.from}" required></label><label class="field">To<input type="date" name="to" value="${range.to}" required></label><button class="secondary" type="submit">Update report</button><div class="form-error" role="alert">${escape(state.reportError || '')}</div></form>`;
  const exports = `<section class="panel"><h2>Exports</h2><div class="export-row"><a class="secondary link-button" href="/api/reports/orders.csv?${query}" download>${icon('download')}Requests opened in this period</a><a class="secondary link-button" href="/api/reports/orders.csv" download>${icon('download')}All requests</a><a class="secondary link-button" href="/api/reports/assets.csv" download>${icon('download')}Assets</a>${state.data.modules.maintenance ? `<a class="secondary link-button" href="/api/reports/maintenance.csv" download>${icon('download')}Maintenance plans</a>` : ''}${state.data.modules.inventory ? `<a class="secondary link-button" href="/api/reports/parts.csv" download>${icon('download')}Parts</a>` : ''}</div><p class="settings-copy">CSV files open in Excel, Numbers and Google Sheets. Dates are in ${escape(state.me.timezone)}.</p></section>`;
  if (!r || r.from !== range.from || r.to !== range.to)
    return (
      heading('Reports', 'Workload, response times and maintenance compliance for a period.') +
      controls +
      '<div class="empty" id="report-loading">Loading report…</div>'
    );
  const pm = r.maintenance,
    parts = r.parts;
  return (
    heading('Reports', 'Workload, response times and maintenance compliance for a period.') +
    controls +
    `<div class="metrics"><div class="metric"><span>Opened</span><strong>${r.created}</strong><small>${fmt(r.from)} – ${fmt(r.to)}</small></div><div class="metric"><span>Completed</span><strong>${r.completed}</strong><small>In this period</small></div><div class="metric"><span>Average time to complete</span><strong>${r.averageHoursToComplete == null ? '—' : r.averageHoursToComplete < 1 ? 'Under 1 h' : r.averageHoursToComplete < 48 ? r.averageHoursToComplete + ' h' : Math.round((r.averageHoursToComplete / 24) * 10) / 10 + ' d'}</strong><small>From request to completion</small></div><div class="metric attention"><span>Overdue now</span><strong>${r.overdueNow}</strong><small>Of ${r.openNow} open today</small></div></div>` +
    `<div class="report-grid">${breakdown('By type', r.byType, x => requestTypes[x.key]?.label || x.key)}${breakdown('By status', r.byStatus)}${breakdown('By priority', r.byPriority)}${breakdown('By building', r.byBuilding)}${breakdown('Completed by assignee', r.completedByAssignee, x => x.label, {completed: false})}` +
    (pm
      ? `<section class="panel"><h2>Preventive maintenance</h2><div class="settings-list"><div><strong>Occurrences due</strong><span>${pm.due}</span></div><div><strong>Completed</strong><span>${pm.completed} (${pct(pm.completed, pm.due)})</span></div><div><strong>Completed by the due date</strong><span>${pm.onTime} (${pct(pm.onTime, pm.due)})</span></div></div></section>`
      : '') +
    (parts
      ? `<section class="panel"><h2>Parts used</h2>${parts.items.length ? `<div class="table-wrap"><table><thead><tr><th>Part</th><th>Quantity</th><th>Cost</th></tr></thead><tbody>${parts.items.map(p => `<tr><td>${escape(p.name)}<div class="order-sub">${escape(p.sku) || 'No SKU'}</div></td><td>${p.quantity}</td><td>${money(p.costCents)}</td></tr>`).join('')}</tbody></table></div><div class="table-footer">Total ${money(parts.totalCostCents)}</div>` : '<div class="empty">No parts recorded in this period.</div>'}</section>`
      : '') +
    `</div>` +
    exports
  );
}
async function load() {
  const range = state.reportRange;
  try {
    state.report = await api(`/reports/summary?from=${range.from}&to=${range.to}`);
    state.reportError = '';
  } catch (e) {
    state.reportError = e.message;
    state.report = {
      ...range,
      created: 0,
      completed: 0,
      averageHoursToComplete: null,
      openNow: 0,
      overdueNow: 0,
      byType: [],
      byStatus: [],
      byPriority: [],
      byBuilding: [],
      completedByAssignee: [],
    };
  }
  if (state.page === 'reports') hooks.render();
}
export function bindReports() {
  const form = $('#report-range');
  if (!form) return;
  form.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (d.from > d.to) {
      form.querySelector('.form-error').textContent = 'The start date must be on or before the end date.';
      return;
    }
    state.reportRange = d;
    hooks.render();
  };
  if ($('#report-loading')) load();
}
