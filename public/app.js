import {requestTypes, settingsUI, notificationsUI, bindSettings} from './request-settings.js';
import {
  state,
  $,
  $$,
  escape,
  icon,
  manage,
  staffRole,
  fmt,
  fmtTime,
  overdue,
  ticketNo,
  tag,
  labelTables,
  reservationTag,
  api,
  upload,
  toast,
  heading,
  dialog,
  closeDialog,
  field,
  select,
  activeBuildings,
  bindForm,
  formActions,
  bindCancel,
} from './ui.js';
import {hooks} from './hooks.js';
import {orderEditor} from './order.js';
import {locationFields, bindLocation, requestTiming, bindTiming} from './forms.js';
import {recordsPage, bindRecords, recordEditor} from './records.js';
import {inventoryPage, bindInventory, partEditor} from './inventory.js';
import {reportsPage, bindReports} from './reports.js';

const enabledTypes = () => Object.keys(requestTypes).filter(key => state.data.modules[key]);
const pageType = () => (state.page.endsWith('Requests') ? state.page.replace('Requests', '') : null);
const pageSize = 50;

async function refresh() {
  state.me = await api('/me');
  state.data = await api('/data');
  if (state.list) state.list.stale = true;
  render();
}
hooks.refresh = refresh;
hooks.render = render;
hooks.openOrder = id => orderEditor(id);
hooks.reloadOrders = () => loadOrders(true);

// Destinations are grouped like the tab dividers of a work-order pad.
function navGroups() {
  const d = state.data,
    me = state.me;
  const groups = [
    [
      'Requests',
      [
        ['dashboard', 'home', 'Overview'],
        ...(enabledTypes().length ? [['orders', 'work', 'All requests']] : []),
        ...enabledTypes().map(key => [key + 'Requests', requestTypes[key].icon, requestTypes[key].label + ' requests']),
        ...(d.modules.maintenance && staffRole() ? [['maintenance', 'calendar', 'Preventive maintenance']] : []),
      ],
    ],
    [
      'Places',
      [
        ['buildings', 'building', 'Buildings'],
        ['assets', 'asset', 'Assets'],
      ],
    ],
    ['Stock', d.modules.inventory && staffRole() ? [['inventory', 'box', 'Inventory']] : []],
    [
      'Office',
      [
        ...(manage() ? [['reports', 'chart', 'Reports']] : []),
        ['notifications', 'bell', 'Notifications'],
        ...(me.user.role === 'admin' ? [['settings', 'settings', 'Settings']] : []),
      ],
    ],
  ];
  return groups.filter(([, items]) => items.length);
}

function go(page, filter = 'All') {
  state.page = page;
  state.filter = filter;
  state.search = '';
  render();
}

function render() {
  const me = state.me;
  document.title = (me.branding?.name || 'Facilities') + ' · Work order pad';
  if (!me.user) {
    $('#app').innerHTML =
      `<main class="login"><div class="login-ticket"><div class="login-head"><span class="brand-mark">${icon(me.branding?.icon || 'building')}</span><span class="brand-name">${escape(me.branding?.name || 'Facilities')}</span><span class="ticket-no">WO-0000</span></div><div class="login-body"><h1>${escape(me.branding?.welcome || 'Your facilities. One connected workspace.')}</h1><p>Maintenance, schedules, equipment and the places your organization depends on, kept on one shared pad.</p><a class="login-link" href="/auth/login">${me.mode === 'demo' ? 'Enter demo workspace' : 'Sign in with your organization'} ${icon('arrow')}</a></div><div class="login-foot"><span>${me.mode === 'demo' ? 'Local demo · Illustrative records · Administrator access' : escape(me.organization) + ' · Secure organization sign-in'}</span></div></div></main>`;
    return;
  }
  const d = state.data;
  if (!d) return;
  const groups = navGroups();
  const navs = groups.flatMap(([, items]) => items);
  if (!navs.some(n => n[0] === state.page)) {
    state.page = 'dashboard';
    state.filter = 'All';
    state.search = '';
  }
  const title = navs.find(x => x[0] === state.page)?.[2] || 'Overview';
  const initials = me.user.name
    .split(' ')
    .map(x => x[0])
    .slice(0, 2)
    .join('');
  const unread = d.notifications.filter(n => !n.read_at).length;
  const count = p => {
    if (p === 'orders') return d.summary.active;
    if (p.endsWith('Requests')) return d.summary.activeByType[p.replace('Requests', '')] || 0;
    if (p === 'notifications') return unread || null;
    return null;
  };
  const navButton = ([p, i, t]) => {
    const n = count(p);
    return `<button data-page="${p}" aria-label="${t}" class="${state.page === p ? 'active' : ''}" ${state.page === p ? 'aria-current="page"' : ''}>${icon(i)}<span>${t}</span>${n != null ? `<span class="count">${n}</span>` : ''}</button>`;
  };
  const dock = [['dashboard', 'home', 'Today'], ...(enabledTypes().length ? [['orders', 'work', 'Requests']] : [])];
  $('#app').innerHTML =
    `<div class="shell"><aside class="rail"><div class="brand"><span class="brand-mark">${icon(me.branding?.icon || 'building')}</span><span class="brand-name">${escape(me.branding?.name || 'Facilities')}<small>${escape(me.organization)}</small></span></div><nav id="workspace-nav" aria-label="Main navigation">${groups.map(([label, items]) => `<section class="nav-group"><h2 class="nav-tab">${label}</h2>${items.map(navButton).join('')}</section>`).join('')}</nav><div class="rail-foot"><div class="user-line"><span class="avatar">${escape(initials)}</span><div><strong>${escape(me.user.name)}</strong><small>${escape(me.user.role)}</small></div></div><button class="logout" id="logout">Sign out</button></div></aside><main class="workspace"><header class="topbar"><span class="crumb"><span class="brand-mark small">${icon(me.branding?.icon || 'building')}</span><span class="crumb-path">${escape(me.branding?.name || 'Facilities')} <span aria-hidden="true">/</span></span> <strong>${title}</strong></span><div class="top-right"><span class="top-date">${new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})}</span><button class="notification-button" data-page="notifications" aria-label="Open notifications">${icon('bell')}${unread ? `<span>${unread}</span>` : ''}</button></div></header><div class="content">${me.mode === 'demo' ? '<div class="notice demo-notice">Demo workspace — these records are illustrative. SSO and an empty database are used in the production deployment.</div>' : ''}${pageContent()}</div></main><div class="dock">${dock.map(([p, i, t]) => `<button data-page="${p}" class="${state.page === p ? 'active' : ''}">${icon(i)}<span>${t}</span></button>`).join('')}${enabledTypes().length ? `<button class="dock-new" data-create="order" aria-label="New request">${icon('plus')}<span>New</span></button>` : ''}<button data-page="notifications" class="${state.page === 'notifications' ? 'active' : ''}">${icon('bell')}<span>Inbox</span>${unread ? `<span class="count">${unread}</span>` : ''}</button><button id="nav-toggle" type="button" aria-controls="workspace-nav" aria-expanded="false">${icon('menu')}<span>Menu</span></button></div></div>`;
  $$('[data-page]').forEach(b => (b.onclick = () => go(b.dataset.page)));
  $$('[data-goto]').forEach(b => (b.onclick = () => go(b.dataset.goto, b.dataset.filter)));
  $$('[data-create]').forEach(
    b =>
      (b.onclick = () =>
        b.dataset.create === 'order'
          ? createOrder()
          : b.dataset.create === 'part'
            ? partEditor()
            : recordEditor(b.dataset.create)),
  );
  $$('[data-filter]').forEach(
    b =>
      (b.onclick = () => {
        state.filter = b.dataset.filter;
        $$('[data-filter]').forEach(x => x.classList.toggle('selected', x === b));
        loadOrders(true);
      }),
  );
  const search = $('#search');
  let searchTimer;
  if (search)
    search.oninput = e => {
      state.search = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadOrders(true), 250);
    };
  $('#logout').onclick = async () => {
    try {
      await api('/logout', {method: 'POST'});
      location.reload();
    } catch (e) {
      toast(e.message);
    }
  };
  if ($('#view-orders')) $('#view-orders').onclick = () => go('orders');
  bindSettings(state, api, refresh, render, toast, orderEditor);
  bindRecords();
  bindInventory();
  bindReports();
  $('#nav-toggle').onclick = () => {
    const open = $('.rail').classList.toggle('menu-open');
    $('#nav-toggle').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-locked', open);
  };
  labelTables();
  if ($('#order-table')) loadOrders(false);
}

function pageContent() {
  const d = state.data,
    s = d.summary;
  if (state.page === 'settings') return settingsUI(state, escape, icon, heading);
  if (state.page === 'notifications') return notificationsUI(state, escape, icon, heading);
  if (['buildings', 'assets', 'maintenance'].includes(state.page)) return recordsPage(state.page);
  if (state.page === 'inventory') return inventoryPage();
  if (state.page === 'reports') return reportsPage();
  if (state.page === 'orders')
    return (
      heading('All requests', 'Every ticket on the pad, across enabled request types.', 'order', 'New request') +
      ordersPanel()
    );
  if (pageType()) {
    const type = pageType();
    return (
      heading(
        requestTypes[type].label + ' requests',
        requestTypes[type].description,
        'order',
        'New ' + type + ' request',
      ) +
      (type === 'schedule'
        ? `<p class="schedule-note">Event times are in ${escape(state.me.timezone)}. Choose a space to reserve it; overlapping reservations are refused, and spaces marked for approval wait for a manager.</p>`
        : '') +
      ordersPanel()
    );
  }
  const lowParts = (d.parts || []).filter(p => !p.archived_at && p.quantity <= p.min_quantity);
  const requester = state.me.user.role === 'requester';
  const tally = [
    ['orders', 'Active', s.active, 'Active', requester ? 'Your open tickets' : 'Not yet completed'],
    ['orders', 'Overdue', s.overdue, 'Overdue', 'Past their due date', s.overdue ? 'alert' : ''],
    ['orders', 'In progress', s.inProgress, 'In progress', 'Work underway'],
    manage() && d.modules.schedule
      ? [
          'scheduleRequests',
          'Awaiting approval',
          s.pendingReservations,
          'Awaiting approval',
          'Space reservations',
          s.pendingReservations ? 'pending' : '',
        ]
      : ['orders', 'Completed', s.completed, 'Completed', 'All time'],
  ];
  const side = [];
  if (enabledTypes().length)
    side.push(
      `<section class="panel"><h2>Request types</h2>${enabledTypes()
        .map(
          key =>
            `<button class="panel-row type-row" data-page="${key}Requests"><span class="panel-row-main"><strong>${requestTypes[key].label}</strong><small>${requestTypes[key].description}</small></span><span class="panel-figure">${s.activeByType[key] || 0}<small>active</small></span></button>`,
        )
        .join('')}</section>`,
    );
  if (d.modules.maintenance && staffRole()) {
    const plans = d.maintenance.filter(p => Number(p.active)).slice(0, 4);
    side.push(
      `<section class="panel"><h2>Upcoming maintenance</h2>${
        plans.length
          ? plans
              .map(
                p =>
                  `<div class="panel-row"><span class="panel-row-main"><strong>${escape(p.title)}</strong><small>${escape(p.building)}${p.asset ? ' · ' + escape(p.asset) : ''}</small></span><span class="panel-figure">${fmt(p.next_due)}<small>every ${p.interval_days} d</small></span></div>`,
              )
              .join('')
          : '<div class="empty">No maintenance plans to display.</div>'
      }</section>`,
    );
  }
  side.push(
    `<section class="panel"><h2>Your buildings</h2>${
      activeBuildings()
        .slice(0, 5)
        .map(
          b =>
            `<div class="panel-row"><span class="panel-row-main"><strong>${escape(b.name)}</strong><small>${d.assets.filter(a => a.building_id === b.id && !a.archived_at).length} assets</small></span><span class="panel-figure">${s.activeByBuilding[b.id] || 0}<small>open</small></span></div>`,
        )
        .join('') || '<div class="empty">Add a building to get started.</div>'
    }</section>`,
  );
  if (lowParts.length)
    side.push(
      `<section class="panel"><h2>Low stock</h2>${lowParts
        .slice(0, 5)
        .map(
          p =>
            `<div class="panel-row"><span class="panel-row-main"><strong>${escape(p.name)}</strong><small>${escape(p.sku) || 'No SKU'}${p.location ? ' · ' + escape(p.location) : ''}</small></span><span class="panel-figure alert">${p.quantity}<small>reorder at ${p.min_quantity}</small></span></div>`,
        )
        .join('')}</section>`,
    );
  return (
    heading(
      'Today',
      `${new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric', timeZone: state.me.timezone})} · ${escape(state.me.organization)}`,
      enabledTypes().length ? 'order' : null,
      'New request',
    ) +
    `<div class="tally">${tally
      .map(
        ([page, filter, value, label, note, tone = '']) =>
          `<button class="tally-cell ${tone}" data-goto="${page}" data-filter="${filter}" title="${note}"><span class="tally-label">${label}</span><strong>${value}</strong></button>`,
      )
      .join('')}</div>` +
    (enabledTypes().length
      ? ''
      : '<div class="notice">Requests are turned off. An administrator can enable request types in Settings.</div>') +
    `<div class="today-grid"><section class="today-main"><div class="section-head"><h2>${requester ? 'Your open tickets' : 'Open tickets by due date'}</h2>${enabledTypes().length ? `<button id="view-orders" class="quiet-button">View requests ${icon('arrow')}</button>` : ''}</div>${ordersPanel(true)}</section><aside class="today-side">${side.join('')}</aside></div>`
  );
}

const filterTabs = compact => [
  'All',
  'Open',
  'In progress',
  'Overdue',
  ...(compact ? [] : ['Completed']),
  ...(staffRole() ? ['Assigned to me'] : []),
  ...(pageType() === 'schedule' && manage() ? ['Awaiting approval'] : []),
];
// The overview ledger shows unfinished work soonest-due first; registers show everything newest first.
function listParams(compact = false) {
  const p = new URLSearchParams();
  if (pageType()) p.set('type', pageType());
  if (state.filter === 'Assigned to me') p.set('assignee', 'me');
  else if (state.filter === 'Awaiting approval') p.set('reservation', 'pending');
  else if (state.filter !== 'All') p.set('status', state.filter);
  if (compact) {
    p.set('sort', 'due');
    if (!['Open', 'In progress', 'Overdue'].includes(state.filter)) p.set('status', 'Active');
  }
  if (state.search.trim()) p.set('q', state.search.trim());
  return p;
}
function ordersPanel(compact = false) {
  if (!filterTabs(compact).includes(state.filter)) state.filter = 'All';
  const exportLink =
    staffRole() && !compact
      ? `<a class="quiet-button export-link" id="export-orders" href="/api/reports/orders.csv?${listParams()}" download>${icon('download')}Export CSV</a>`
      : '';
  return `<section class="work-panel ledger"><div class="filters"><div class="tabs" aria-label="Filter requests">${filterTabs(
    compact,
  )
    .map(
      t =>
        `<button data-filter="${t}" class="${state.filter === t ? 'selected' : ''}">${compact && t === 'All' ? 'Active' : t}</button>`,
    )
    .join(
      '',
    )}</div><div class="filter-tools">${exportLink}<label class="search">${icon('search')}<input id="search" type="search" aria-label="Search requests" placeholder="Search title, place or WO number" value="${escape(state.search)}"></label></div></div><div id="order-table" data-compact="${compact}">${state.list?.rows ? ordersTable(compact) : '<div class="empty">Loading requests…</div>'}</div></section>`;
}
// The register loads one page at a time from the server; filters and search are applied there.
async function loadOrders(reset) {
  const el = $('#order-table');
  if (!el) return;
  const compact = el.dataset.compact === 'true';
  const params = listParams(compact);
  params.set('limit', String(compact ? 8 : pageSize));
  const key = params.toString();
  if (!reset && state.list?.key === key && state.list.rows && !state.list.stale) {
    el.innerHTML = ordersTable(compact);
    bindTable();
    return;
  }
  const offset = reset || state.list?.key !== key || state.list.stale ? 0 : state.list.rows.length;
  if (offset === 0) state.list = {key, rows: state.list?.key === key ? state.list.rows : null, total: 0};
  params.set('offset', String(offset));
  const exportLink = $('#export-orders');
  if (exportLink) exportLink.href = '/api/reports/orders.csv?' + listParams();
  try {
    const result = await api('/orders?' + params);
    if (state.list?.key !== key) return;
    state.list = {key, rows: offset ? [...state.list.rows, ...result.orders] : result.orders, total: result.total};
  } catch (err) {
    state.list = {key, rows: [], total: 0, error: err.message};
  }
  const current = $('#order-table');
  if (current) {
    current.innerHTML = ordersTable(current.dataset.compact === 'true');
    bindTable();
  }
}
function ordersTable(compact) {
  const {rows = [], total = 0, error} = state.list || {};
  const showType = !pageType();
  const excerpt = text => (text.length > 160 ? text.slice(0, 157) + '…' : text);
  return `<div class="table-wrap"><table><thead><tr><th class="col-no">No.</th><th>Request</th>${showType ? '<th class="col-type">Type</th>' : ''}<th class="col-stamp">Status</th><th class="col-priority">Priority</th><th class="col-assignee">Assigned to</th><th class="col-due">Due</th></tr></thead><tbody>${rows
    .map(
      o =>
        `<tr class="clickable ${overdue(o) ? 'is-overdue' : ''}" tabindex="0" data-order="${escape(o.id)}" aria-label="Open ${escape(ticketNo(o.number))} ${escape(o.title)}"><td class="col-no"><span class="ticket-no">${escape(ticketNo(o.number))}</span></td><td class="col-request"><span class="order-title">${escape(o.title)}</span><div class="order-sub">${escape(o.building)}${o.asset ? ' · ' + escape(o.asset) : ''}${o.space ? ' · ' + escape(o.space) : ''}</div><div class="row-more"><div>${o.description ? `<span>${escape(excerpt(o.description))}</span>` : ''}<span>Requested by ${escape(o.requester)}</span></div></div></td>${showType ? `<td class="col-type"><span class="request-kind">${icon(requestTypes[o.request_type].icon)}${requestTypes[o.request_type].label}</span></td>` : ''}<td class="col-stamp">${tag(o.status)}${o.reservation_status && o.reservation_status !== 'approved' ? ' ' + reservationTag(o.reservation_status) : ''}</td><td class="col-priority">${tag(o.priority)}</td><td class="col-assignee">${escape(o.assignee) || '<span class="unassigned">Unassigned</span>'}</td><td class="col-due due ${overdue(o) ? 'overdue' : ''}">${o.request_type === 'schedule' ? fmtTime(o.starts_at) : fmt(o.due_date)}${overdue(o) ? '<span class="overdue-mark">Overdue</span>' : ''}</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table></div>${error ? `<div class="empty">${escape(error)}</div>` : rows.length ? '' : `<div class="empty">${enabledTypes().length ? (compact ? 'Nothing open. Every ticket on the pad is completed.' : 'No requests match. Try a different filter or create a new request.') : 'Request types are disabled. Your existing records are preserved.'}${!enabledTypes().length && state.me.user.role === 'admin' ? '<p><button class="quiet-button" data-page="settings">Configure request types</button></p>' : ''}</div>`}<div class="table-footer">Showing ${rows.length} of ${total} ${compact ? 'open tickets' : 'requests'}${!compact && rows.length < total ? ' <button class="quiet-button" id="load-more">Load more</button>' : ''}</div>`;
}
function bindTable() {
  $$('#order-table [data-order]').forEach(b => {
    b.onclick = () => orderEditor(b.dataset.order);
    b.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        orderEditor(b.dataset.order);
      }
    };
  });
  const more = $('#load-more');
  if (more)
    more.onclick = () => {
      more.disabled = true;
      loadOrders(false);
    };
  $$('#order-table [data-page]').forEach(b => (b.onclick = () => go(b.dataset.page)));
}

function createOrder() {
  if (!enabledTypes().length) {
    toast('An administrator must enable a request type first.');
    return;
  }
  if (!activeBuildings().length) {
    toast('Add a building before creating requests.');
    if (manage()) {
      state.page = 'buildings';
      render();
    }
    return;
  }
  const type = pageType() || enabledTypes()[0];
  const fields =
    select(
      'Request type',
      'request_type',
      enabledTypes().map(key => [key, requestTypes[key].label]),
      type,
    ) +
    select(
      'Priority',
      'priority',
      ['Normal', 'Low', 'High', 'Urgent'].map(x => [x, x]),
    ) +
    field('What do you need?', 'title').replace('class="field ', 'class="field full ') +
    locationFields() +
    `<div class="timing" id="request-timing">${requestTiming(type)}</div>` +
    field('Details', 'description', 'textarea', '', true) +
    `<label class="field full">Photos or files (optional)<input type="file" name="files" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf,text/plain,text/csv,.docx,.xlsx"></label>`;
  dialog(
    'New request',
    `<form id="create-form"><div class="form-grid">${fields}</div>${formActions('Create request')}</form>`,
    {number: 'WO-NEW'},
  );
  bindCancel();
  bindLocation();
  bindTiming();
  const input = $('[name=request_type]');
  input.onchange = () => {
    $('#request-timing').innerHTML = requestTiming(input.value);
    bindTiming();
  };
  bindForm($('#create-form'), async (data, form) => {
    const files = [...form.elements.files.files];
    delete data.files;
    const created = await api('/orders', {method: 'POST', body: JSON.stringify(data)});
    const failed = [];
    for (const file of files) {
      try {
        await upload(created.id, file);
      } catch (e) {
        failed.push(`${file.name}: ${e.message}`);
      }
    }
    closeDialog();
    await refresh();
    toast(
      failed.length
        ? `Request created, but ${failed.length} file${failed.length === 1 ? '' : 's'} could not be attached. ${failed[0]}`
        : created.reservation_status === 'pending'
          ? 'Request created. The space reservation is awaiting approval.'
          : 'Saved to your workspace.',
    );
  });
}

const openFromHash = () => {
  const m = location.hash.match(/^#order=(.+)$/);
  if (m && state.me?.user) {
    history.replaceState(null, '', location.pathname);
    orderEditor(decodeURIComponent(m[1]));
  }
};
try {
  state.me = await api('/me');
  if (state.me.user) {
    await refresh();
    openFromHash();
  } else render();
} catch (err) {
  $('#app').innerHTML =
    `<main class="login"><h1>Workspace unavailable</h1><p>${escape(err.message)}</p><a href="/">Try again</a></main>`;
}
window.addEventListener('hashchange', openFromHash);

setInterval(async () => {
  if (
    !state.me?.user ||
    document.hidden ||
    $('#editor').open ||
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) ||
    ['settings', 'notifications', 'reports', 'inventory'].includes(state.page) ||
    state.list?.rows?.length > pageSize
  )
    return;
  try {
    await refresh();
  } catch {
    /* next poll retries */
  }
}, 30000);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('.rail.menu-open')) {
    $('.rail').classList.remove('menu-open');
    document.body.classList.remove('menu-locked');
    $('#nav-toggle').setAttribute('aria-expanded', 'false');
    $('#nav-toggle').focus();
  }
});
