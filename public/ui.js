// Shared state and markup helpers for every workspace page.
export const state = {
  page: 'dashboard',
  filter: 'All',
  search: '',
  data: null,
  me: null,
  settingsTab: 'modules',
  notificationTab: 'inbox',
  showArchived: false,
  list: null,
};
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const escape = v =>
  String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
export const paths = {
  home: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7',
  work: 'M9 5H5v16h14V5h-4 M9 3h6v4H9z M8 12h8 M8 16h5',
  asset: 'M4 4h16v16H4z M4 10h16 M10 10v10',
  building: 'M4 21V3h12v18 M16 9h4v12 M8 7h4 M8 11h4 M8 15h4 M2 21h20',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16 M8 15h3',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  plus: 'M12 5v14 M5 12h14',
  search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  close: 'M6 6l12 12 M6 18 18 6',
  technology: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4',
  check: 'M5 12l5 5L20 7',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  chart: 'M4 20V4 M4 20h16 M8 16v-5 M12 16V8 M16 16v-8',
  clip: 'M16 7l-7.5 7.5a2.1 2.1 0 0 0 3 3L19 10a4.2 4.2 0 0 0-6-6l-7.5 7.5a6.4 6.4 0 0 0 9 9L20 15',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
  door: 'M5 21V3h11v18 M16 6h3v15 M12 12h.01 M2 21h20',
};
export const icon = k =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[k] || paths.work}"/></svg>`;
export const manage = () => ['admin', 'manager'].includes(state.me.user.role);
export const staffRole = () => state.me.user.role !== 'requester';
export const fmt = d =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : '—';
export const fmtTime = value => (value ? fmt(value.slice(0, 10)) + ', ' + value.slice(11) : '—');
export const fmtStamp = v =>
  v
    ? new Date(v).toLocaleString(undefined, {
        timeZone: state.me?.timezone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
export const money = c => (c == null ? '—' : (c / 100).toLocaleString(undefined, {style: 'currency', currency: 'USD'}));
export const bytes = n =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const today = () => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: state.me?.timezone || 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const v = t => p.find(x => x.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
};
export const addDays = (day, n) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const overdue = o => o.status !== 'Completed' && o.due_date < today();
export const tag = (v, label = v) =>
  `<span class="tag ${String(v).toLowerCase().replaceAll(' ', '-')}"><span class="dot"></span>${escape(label)}</span>`;
const reservationLabels = {
  pending: 'Awaiting approval',
  approved: 'Reserved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};
export const reservationTag = s => (s ? tag('reservation-' + s, reservationLabels[s]) : '');
export async function api(url, options = {}) {
  const res = await fetch('/api' + url, {
    ...options,
    headers: {'Content-Type': 'application/json', 'x-csrf-token': state.me?.csrf || '', ...options.headers},
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok)
    throw new Error(
      data?.error ||
        (res.status === 429 ? 'Too many requests. Wait a moment and try again.' : 'Request failed. Please try again.'),
    );
  return data;
}
export const upload = (orderId, file) =>
  api(`/orders/${encodeURIComponent(orderId)}/attachments`, {
    method: 'POST',
    body: file,
    headers: {'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name)},
  });
let toastTimer;
export function toast(message) {
  $('#toast').textContent = message;
  $('#toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').style.display = 'none'), 4500);
}
export function heading(title, sub, type, action, extra = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div><div class="heading-actions">${extra}${type ? `<button class="primary" data-create="${type}">${icon('plus')}${action}</button>` : ''}</div></div>`;
}
export function dialog(title, body) {
  $('#editor-content').innerHTML =
    `<div class="editor-head"><h2>${escape(title)}</h2><button class="close" aria-label="Close dialog">${icon('close')}</button></div><div class="editor-body">${body}</div>`;
  $('#editor .close').onclick = () => $('#editor').close();
  if (!$('#editor').open) $('#editor').showModal();
}
export const closeDialog = () => $('#editor').close();
export const field = (label, name, type = 'text', value = '', optional = false, attrs = '') =>
  `<label class="field ${type === 'textarea' ? 'full' : ''}">${label}${type === 'textarea' ? `<textarea name="${name}" maxlength="5000" ${optional ? '' : 'required'} ${attrs}>${escape(value)}</textarea>` : `<input name="${name}" type="${type}" value="${escape(value)}" ${optional ? '' : 'required'} ${type === 'text' ? 'maxlength="200"' : ''} ${attrs}>`}</label>`;
export const select = (
  label,
  name,
  options,
  value = '',
  required = !['asset_id', 'assignee_id', 'space_id'].includes(name),
) =>
  `<label class="field">${label}<select aria-label="${escape(label)}" name="${name}" ${required ? 'required' : ''}>${options.map(([v, t]) => `<option value="${escape(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${escape(t)}</option>`).join('')}</select></label>`;
export const checkbox = (label, name, checked) =>
  `<label class="field-check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>${escape(label)}</label>`;
export const activeBuildings = keep => state.data.buildings.filter(b => !b.archived_at || b.id === keep);
export const activeAssets = (building, keep) =>
  state.data.assets.filter(a => a.building_id === building && (!a.archived_at || a.id === keep));
// Destructive actions arm on the first press and run on the second, without browser dialogs.
export function confirmButton(button, run, label = 'Press again to confirm') {
  button.onclick = async () => {
    if (!button.dataset.armed) {
      button.dataset.armed = '1';
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.classList.add('armed');
      setTimeout(() => {
        if (button.isConnected && button.dataset.armed) {
          delete button.dataset.armed;
          button.textContent = button.dataset.label;
          button.classList.remove('armed');
        }
      }, 5000);
      return;
    }
    button.disabled = true;
    try {
      await run();
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        delete button.dataset.armed;
        button.textContent = button.dataset.label;
        button.classList.remove('armed');
      }
    }
  };
}
// Submit helper: JSON body from the form, inline error text, button disabled while saving.
export function bindForm(form, submit) {
  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]'),
      error = form.querySelector('.form-error');
    if (button) button.disabled = true;
    if (error) error.textContent = '';
    try {
      await submit(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      if (error) error.textContent = err.message;
      else toast(err.message);
    } finally {
      if (button && button.isConnected) button.disabled = false;
    }
  };
}
export const formActions = (submitLabel, extra = '') =>
  `<div class="form-error" role="alert"></div><div class="editor-actions">${extra}<span class="spacer"></span><button type="button" class="secondary" data-cancel>Cancel</button><button class="primary" type="submit">${escape(submitLabel)}</button></div>`;
export function bindCancel() {
  $$('[data-cancel]').forEach(b => (b.onclick = closeDialog));
}
