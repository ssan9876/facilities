// Calendar: every ticket on the day it is due (schedule requests on their start day), with
// projected preventive maintenance. Month grid on wide screens, an agenda list on phones.
import {state, $, $$, escape, icon, can, today, addDays, api, heading, ticketNo} from './ui.js';
import {requestTypes} from './request-settings.js';
import {hooks} from './hooks.js';

const pad = n => String(n).padStart(2, '0');
const monthOf = day => day.slice(0, 7);
const monthLabel = month =>
  new Date(month + '-15T12:00:00').toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
// Six full weeks starting on the Sunday on or before the 1st.
function gridRange(month) {
  const first = month + '-01';
  const weekday = new Date(first + 'T12:00:00Z').getUTCDay();
  const start = addDays(first, -weekday);
  return {start, end: addDays(start, 41)};
}
const cal = () =>
  (state.cal ||= {
    month: monthOf(today()),
    view: matchMedia('(max-width: 760px)').matches ? 'agenda' : 'month',
    plans: true,
    type: '',
    mine: false,
  });

export function calendarPage() {
  const c = cal();
  const types = Object.keys(requestTypes).filter(t => state.data.modules[t]);
  return (
    heading(
      'Calendar',
      'Every ticket on the day it is due. Schedule requests appear on their start day.',
      types.length ? 'order' : null,
      'New request',
    ) +
    `<div class="cal-toolbar"><div class="cal-nav"><button type="button" class="secondary icon-only" data-cal-shift="-1" aria-label="Previous month">${icon('arrow-left')}</button><h2 id="cal-title">${escape(monthLabel(c.month))}</h2><button type="button" class="secondary icon-only" data-cal-shift="1" aria-label="Next month">${icon('arrow')}</button><button type="button" class="secondary" data-cal-today>Today</button></div><div class="cal-options">${
      types.length > 1
        ? `<label class="filter-field">Type<select data-cal-type><option value="">All types</option>${types.map(t => `<option value="${t}" ${c.type === t ? 'selected' : ''}>${requestTypes[t].label}</option>`).join('')}</select></label>`
        : ''
    }${can('requests.assignable') ? `<label class="field-check inline"><input type="checkbox" data-cal-mine ${c.mine ? 'checked' : ''}>Only my work</label>` : ''}${
      state.data.modules.maintenance && can('maintenance.view')
        ? `<label class="field-check inline"><input type="checkbox" data-cal-plans ${c.plans ? 'checked' : ''}>Planned maintenance</label>`
        : ''
    }<div class="tabs view-toggle" role="group" aria-label="Calendar view"><button type="button" data-cal-view="month" class="${c.view === 'month' ? 'selected' : ''}">Month</button><button type="button" data-cal-view="agenda" class="${c.view === 'agenda' ? 'selected' : ''}">Agenda</button></div></div></div><div id="calendar-root" class="calendar"><div class="empty">Loading calendar…</div></div>`
  );
}

function chip(o) {
  const late = o.status !== 'Completed' && o.due_date < today();
  const when = o.request_type === 'schedule' && o.starts_at ? o.starts_at.slice(11) + ' ' : '';
  return `<li><button type="button" class="cal-chip ${o.status.toLowerCase().replaceAll(' ', '-')} ${late ? 'late' : ''} ${o.priority === 'Urgent' ? 'urgent' : ''}" data-cal-open="${escape(o.id)}" title="${escape(`${ticketNo(o.number)} ${o.title} · ${o.status} · ${o.building}${o.assignee ? ' · ' + o.assignee : ''}`)}"><span class="cal-no">${escape(ticketNo(o.number))}</span> ${escape(when)}${escape(o.title)}</button></li>`;
}
const planChip = p =>
  `<li><button type="button" class="cal-chip planned" data-cal-plans-page title="${escape(`Planned maintenance: ${p.title} · ${p.building}`)}"><span class="cal-no">PM</span> ${escape(p.title)}</button></li>`;

function render(data) {
  const c = cal();
  const root = $('#calendar-root');
  if (!root) return;
  const byDay = {};
  for (const o of data.orders) (byDay[o.due_date] ||= {orders: [], plans: []}).orders.push(o);
  for (const p of data.plans) (byDay[p.due_date] ||= {orders: [], plans: []}).plans.push(p);
  const now = today();
  if (c.view === 'agenda') {
    const days = Object.keys(byDay)
      .filter(d => monthOf(d) === c.month)
      .sort();
    root.innerHTML = days.length
      ? `<ol class="agenda">${days
          .map(
            d =>
              `<li class="${d === now ? 'today' : ''}"><h3>${escape(new Date(d + 'T12:00:00').toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'}))}${d === now ? ' <span class="today-mark">Today</span>' : ''}</h3><ul class="cal-items">${byDay[d].orders.map(chip).join('')}${byDay[d].plans.map(planChip).join('')}</ul></li>`,
          )
          .join('')}</ol>`
      : '<div class="empty">Nothing is due this month.</div>';
  } else {
    const {start} = gridRange(c.month);
    const names = Array.from({length: 7}, (_, i) =>
      new Date(addDays(start, i) + 'T12:00:00').toLocaleDateString(undefined, {weekday: 'short'}),
    );
    const cells = Array.from({length: 42}, (_, i) => {
      const d = addDays(start, i);
      const items = byDay[d] || {orders: [], plans: []};
      const all = [...items.orders.map(chip), ...items.plans.map(planChip)];
      const shown = c.expanded === d ? all : all.slice(0, 4);
      return `<div class="cal-day ${monthOf(d) === c.month ? '' : 'outside'} ${d === now ? 'today' : ''}" role="gridcell" aria-label="${escape(new Date(d + 'T12:00:00').toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'}))}, ${all.length} item${all.length === 1 ? '' : 's'}"><span class="cal-date">${Number(d.slice(8))}</span><ul class="cal-items">${shown.join('')}</ul>${all.length > shown.length ? `<button type="button" class="quiet-button cal-more" data-cal-expand="${d}">+${all.length - shown.length} more</button>` : ''}</div>`;
    }).join('');
    root.innerHTML = `<div class="cal-grid" role="grid" aria-label="${escape(monthLabel(c.month))}"><div class="cal-week cal-head" role="row">${names.map(n => `<span role="columnheader">${escape(n)}</span>`).join('')}</div><div class="cal-days">${cells}</div></div>`;
  }
  if (data.total > data.orders.length)
    root.insertAdjacentHTML(
      'beforeend',
      `<p class="muted-line">Showing the first ${data.orders.length} of ${data.total} tickets in this range.</p>`,
    );
  $$('[data-cal-open]').forEach(b => (b.onclick = () => hooks.openTicket(b.dataset.calOpen)));
  $$('[data-cal-plans-page]').forEach(
    b =>
      (b.onclick = () => {
        state.page = 'maintenance';
        hooks.render();
      }),
  );
  $$('[data-cal-expand]').forEach(
    b =>
      (b.onclick = () => {
        c.expanded = b.dataset.calExpand;
        render(data);
      }),
  );
}

export async function bindCalendar() {
  const root = $('#calendar-root');
  if (!root) return;
  const c = cal();
  const rerender = () => hooks.render();
  $$('[data-cal-shift]').forEach(
    b =>
      (b.onclick = () => {
        c.month = shiftMonth(c.month, Number(b.dataset.calShift));
        c.expanded = null;
        rerender();
      }),
  );
  $('[data-cal-today]').onclick = () => {
    c.month = monthOf(today());
    rerender();
  };
  $$('[data-cal-view]').forEach(
    b =>
      (b.onclick = () => {
        c.view = b.dataset.calView;
        rerender();
      }),
  );
  const type = $('[data-cal-type]');
  if (type)
    type.onchange = () => {
      c.type = type.value;
      rerender();
    };
  const mine = $('[data-cal-mine]');
  if (mine)
    mine.onchange = () => {
      c.mine = mine.checked;
      rerender();
    };
  const plans = $('[data-cal-plans]');
  if (plans)
    plans.onchange = () => {
      c.plans = plans.checked;
      rerender();
    };
  const {start, end} = gridRange(c.month);
  const params = new URLSearchParams({
    from: c.view === 'agenda' ? c.month + '-01' : start,
    to: c.view === 'agenda' ? addDays(shiftMonth(c.month, 1) + '-01', -1) : end,
  });
  if (c.type) params.set('type', c.type);
  if (c.mine) params.set('assignee', 'me');
  if (!c.plans) params.set('plans', '0');
  try {
    render(await api('/calendar?' + params));
  } catch (err) {
    root.innerHTML = `<div class="empty">${escape(err.message)}</div>`;
  }
}
