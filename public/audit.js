// Settings → Audit log: a filterable, exportable record of who changed what.
const types = [
  ['', 'All records'],
  ['work_order', 'Requests'],
  ['building', 'Buildings'],
  ['asset', 'Assets'],
  ['space', 'Spaces'],
  ['maintenance', 'Maintenance plans'],
  ['part', 'Parts'],
  ['user', 'People and sign-in'],
  ['group', 'Groups'],
  ['provisioning_key', 'Provisioning tokens'],
  ['settings', 'Settings'],
];
const query = f => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

export function auditUI(state, e) {
  const a = state.audit,
    f = (state.auditFilters ||= {entity_type: '', q: '', from: '', to: ''});
  const filters = `<form id="audit-filters" class="audit-filters"><label class="field">Record type<select name="entity_type">${types.map(([v, l]) => `<option value="${v}" ${f.entity_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="field">Search<input name="q" type="search" value="${e(f.q)}" placeholder="Person or change"></label><label class="field">From<input name="from" type="date" value="${e(f.from)}"></label><label class="field">To<input name="to" type="date" value="${e(f.to)}"></label><div class="audit-buttons"><button class="primary" type="submit">Apply</button><a class="secondary link-button" href="/api/admin/audit.csv?${query(f)}" download>Export CSV</a></div></form>`;
  const value = v => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const rows = a?.entries?.length
    ? `<ol class="history-list audit-list">${a.entries
        .map(
          x =>
            `<li><div><strong>${e(x.actor_name)}</strong> ${e(x.summary)}<small>${new Date(x.created_at).toLocaleString(undefined, {timeZone: state.me.timezone})} · ${e(x.action)}</small></div>${
              x.details
                ? `<details><summary>Changes</summary><ul>${Object.entries(x.details)
                    .map(
                      ([k, [from, to]]) =>
                        `<li><strong>${e(k.replaceAll('_', ' '))}</strong> ${e(value(from))} → ${e(value(to))}</li>`,
                    )
                    .join('')}</ul></details>`
                : ''
            }</li>`,
        )
        .join(
          '',
        )}</ol>${a.next ? '<div class="table-footer"><button class="quiet-button" data-audit-more>Load older entries</button></div>' : ''}`
    : a
      ? '<div class="empty">No activity matches these filters.</div>'
      : '<div class="empty">Loading activity…</div>';
  return `<section class="settings-sheet audit-sheet"><div class="sheet-heading"><h2>Audit log</h2><p>Every change to requests, records, people, groups, tokens and settings, with the person or connection that made it. Entries cannot be edited or deleted.</p></div>${filters}${a?.error ? `<p class="form-error" role="alert">${e(a.error)}</p>` : ''}${rows}</section>`;
}
export function bindAudit(state, api, render) {
  const form = document.querySelector('#audit-filters');
  if (!form) return;
  const load = async (more = false) => {
    const f = state.auditFilters,
      params = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    if (more) params.set('before', state.audit.next);
    try {
      const r = await api('/admin/audit?' + params);
      state.audit = {entries: more ? [...state.audit.entries, ...r.entries] : r.entries, next: r.next};
    } catch (err) {
      state.audit = {entries: [], next: null, error: err.message};
    }
    render();
  };
  form.onsubmit = ev => {
    ev.preventDefault();
    state.auditFilters = Object.fromEntries(new FormData(form));
    state.audit = null;
    render();
  };
  const more = document.querySelector('[data-audit-more]');
  if (more)
    more.onclick = () => {
      more.disabled = true;
      load(true);
    };
  if (!state.audit) load();
}
