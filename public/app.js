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
  tag,
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

function render() {
  const me = state.me;
  document.title = (me.branding?.name || 'Facilities') + ' · Operations workspace';
  if (!me.user) {
    $('#app').innerHTML =
      `<main class="login"><div class="brand"><span class="brand-mark">${icon(me.branding?.icon || 'building')}</span>${escape(me.branding?.name || 'Facilities')}</div><h1>${escape(me.branding?.welcome || 'Your facilities. One connected workspace.')}</h1><p>Manage maintenance, equipment, and the places your organization depends on.</p><a class="login-link" href="/auth/login">${me.mode === 'demo' ? 'Enter demo workspace' : 'Sign in with your organization'} ${icon('arrow')}</a><small>${me.mode === 'demo' ? 'Local demo · Illustrative records · Administrator access' : escape(me.organization) + ' · Secure organization sign-in'}</small></main>`;
    return;
  }
  const d = state.data;
  if (!d) return;
  const navs = [
    ['dashboard', 'home', 'Overview'],
    ...(enabledTypes().length ? [['orders', 'work', 'All requests']] : []),
    ...enabledTypes().map(key => [key + 'Requests', requestTypes[key].icon, requestTypes[key].label + ' requests']),
    ...(d.modules.maintenance && staffRole() ? [['maintenance', 'calendar', 'Preventive maintenance']] : []),
    ['assets', 'asset', 'Assets'],
    ['buildings', 'building', 'Buildings'],
    ...(d.modules.inventory && staffRole() ? [['inventory', 'box', 'Inventory']] : []),
    ...(manage() ? [['reports', 'chart', 'Reports']] : []),
    ['notifications', 'bell', 'Notifications'],
    ...(me.user.role === 'admin' ? [['settings', 'settings', 'Settings']] : []),
  ];
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
  $('#app').innerHTML =
    `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon(me.branding?.icon || 'building')}</span>${escape(me.branding?.name || 'Facilities')}</div><button id="nav-toggle" class="mobile-menu" type="button" aria-controls="workspace-nav" aria-expanded="false">${icon('menu')}Menu</button><div class="org">${escape(me.organization)}<small>Organization workspace</small></div><nav id="workspace-nav" aria-label="Main navigation">${navs.map(([p, i, t]) => `<button data-page="${p}" aria-label="${t}" class="${state.page === p ? 'active' : ''}" ${state.page === p ? 'aria-current="page"' : ''}>${icon(i)}${t}${p.endsWith('Requests') ? `<span class="count">${d.summary.activeByType[p.replace('Requests', '')] || 0}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="user-line"><span class="avatar">${escape(initials)}</span><div><strong>${escape(me.user.name)}</strong><small>${escape(me.user.role)}</small></div></div><button class="logout" id="logout">Sign out</button></div></aside><main class="workspace"><header class="topbar"><span>Workspace <span aria-hidden="true"> / </span> <strong>${title}</strong></span><div class="top-right"><span class="pill">Single organization</span><button class="notification-button" data-page="notifications" aria-label="Open notifications">${icon('bell')}${unread ? `<span>${unread}</span>` : ''}</button><span>${new Date().toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'})}</span><button class="quiet-button mobile-nav" id="mobile-logout">Sign out</button></div></header><div class="content">${me.mode === 'demo' ? '<div class="notice">Demo workspace — these records are illustrative. SSO and an empty database are used in the production deployment.</div>' : ''}${pageContent()}</div></main></div>`;
  $$('[data-page]').forEach(
    b =>
      (b.onclick = () => {
        state.page = b.dataset.page;
        state.filter = 'All';
        state.search = '';
        render();
      }),
  );
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
  const logout = async () => {
    try {
      await api('/logout', {method: 'POST'});
      location.reload();
    } catch (e) {
      toast(e.message);
    }
  };
  $('#logout').onclick = logout;
  if ($('#mobile-logout')) $('#mobile-logout').onclick = logout;
  if ($('#view-orders'))
    $('#view-orders').onclick = () => {
      state.page = 'orders';
      render();
    };
  bindSettings(state, api, refresh, render, toast, orderEditor);
  bindRecords();
  bindInventory();
  bindReports();
  $('#nav-toggle').onclick = () => {
    const open = $('.sidebar').classList.toggle('menu-open');
    $('#nav-toggle').setAttribute('aria-expanded', String(open));
  };
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
      heading('All requests', 'A shared register across enabled request types.', 'order', 'New request') + ordersPanel()
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
  return (
    heading(
      'Keep things running.',
      enabledTypes().length
        ? enabledTypes()
            .map(key => requestTypes[key].label)
            .join(', ') + ' requests in one workspace.'
        : 'Your buildings and equipment in one workspace.',
      enabledTypes().length ? 'order' : null,
      'New request',
    ) +
    `<div class="metrics"><div class="metric"><span>Active requests</span><strong>${s.active}</strong><small>${state.me.user.role === 'requester' ? 'Your open requests' : 'Across your organization'}</small></div><div class="metric attention"><span>Overdue</span><strong>${s.overdue}</strong><small>Need your attention</small></div><div class="metric"><span>In progress</span><strong>${s.inProgress}</strong><small>Work underway</small></div>${manage() && d.modules.schedule && s.pendingReservations ? `<div class="metric attention"><span>Reservations to review</span><strong>${s.pendingReservations}</strong><small>Awaiting approval</small></div>` : `<div class="metric"><span>Completed</span><strong>${s.completed}</strong><small>All time</small></div>`}</div>` +
    `<div class="request-summary">${enabledTypes()
      .map(
        key =>
          `<button class="type-summary" data-page="${key}Requests"><span class="type-symbol">${icon(requestTypes[key].icon)}</span><span><strong>${requestTypes[key].label}</strong><small>${s.activeByType[key] || 0} active<span class="summary-detail"> requests</span></small></span>${icon('arrow')}</button>`,
      )
      .join(
        '',
      )}</div>${enabledTypes().length ? '' : '<div class="notice">Requests are turned off. An administrator can enable request types in Settings.</div>'}` +
    `<div class="section-head"><h2>Request activity</h2>${enabledTypes().length ? `<button id="view-orders" class="quiet-button">View requests ${icon('arrow')}</button>` : ''}</div>` +
    ordersPanel(true) +
    `<div class="bottom-grid">${
      d.modules.maintenance && staffRole()
        ? `<section class="panel"><h2>Upcoming maintenance</h2>${
            d.maintenance.filter(p => Number(p.active)).length
              ? d.maintenance
                  .filter(p => Number(p.active))
                  .slice(0, 4)
                  .map(
                    p =>
                      `<div class="plan-row"><div><strong>${escape(p.title)}</strong><small>${escape(p.building)}${p.asset ? ' · ' + escape(p.asset) : ''}</small></div><div class="plan-date"><strong>${fmt(p.next_due)}</strong><small>Every ${p.interval_days} days</small></div></div>`,
                  )
                  .join('')
              : '<div class="empty">No maintenance plans to display.</div>'
          }</section>`
        : ''
    }<section class="panel"><h2>Your buildings</h2>${
      activeBuildings()
        .slice(0, 4)
        .map(
          b =>
            `<div class="building-row"><span class="building-symbol">${icon('building')}</span><div><strong>${escape(b.name)}</strong><small>${d.assets.filter(a => a.building_id === b.id && !a.archived_at).length} assets</small></div><span class="open-count">${s.activeByBuilding[b.id] || 0} open</span></div>`,
        )
        .join('') || '<div class="empty">Add a building to get started.</div>'
    }</section>${
      lowParts.length
        ? `<section class="panel"><h2>Low stock</h2>${lowParts
            .slice(0, 5)
            .map(
              p =>
                `<div class="plan-row"><div><strong>${escape(p.name)}</strong><small>${escape(p.sku) || 'No SKU'}${p.location ? ' · ' + escape(p.location) : ''}</small></div><div class="plan-date"><strong>${p.quantity} on hand</strong><small>Reorder at ${p.min_quantity}</small></div></div>`,
            )
            .join('')}</section>`
        : ''
    }</div>`
  );
}

const filterTabs = () => [
  'All',
  'Open',
  'In progress',
  'Overdue',
  'Completed',
  ...(staffRole() ? ['Assigned to me'] : []),
  ...(pageType() === 'schedule' && manage() ? ['Awaiting approval'] : []),
];
function listParams() {
  const p = new URLSearchParams();
  if (pageType()) p.set('type', pageType());
  if (state.filter === 'Assigned to me') p.set('assignee', 'me');
  else if (state.filter === 'Awaiting approval') p.set('reservation', 'pending');
  else if (state.filter !== 'All') p.set('status', state.filter);
  if (state.search.trim()) p.set('q', state.search.trim());
  return p;
}
function ordersPanel(compact = false) {
  if (!filterTabs().includes(state.filter)) state.filter = 'All';
  const exportLink =
    staffRole() && !compact
      ? `<a class="quiet-button export-link" id="export-orders" href="/api/reports/orders.csv?${listParams()}" download>${icon('download')}Export CSV</a>`
      : '';
  return `<section class="work-panel"><div class="filters"><div class="tabs" aria-label="Filter requests">${filterTabs()
    .map(t => `<button data-filter="${t}" class="${state.filter === t ? 'selected' : ''}">${t}</button>`)
    .join(
      '',
    )}</div><div class="filter-tools">${exportLink}<label class="search">${icon('search')}<input id="search" type="search" aria-label="Search requests" placeholder="Search requests" value="${escape(state.search)}"></label></div></div><div id="order-table" data-compact="${compact}">${state.list?.rows ? ordersTable(compact) : '<div class="empty">Loading requests…</div>'}</div></section>`;
}
// The register loads one page at a time from the server; filters and search are applied there.
async function loadOrders(reset) {
  const el = $('#order-table');
  if (!el) return;
  const compact = el.dataset.compact === 'true';
  const params = listParams();
  params.set('limit', String(compact ? 6 : pageSize));
  const key = params.toString();
  if (!reset && state.list?.key === key && state.list.rows && !state.list.stale) {
    el.innerHTML = ordersTable(compact);
    bindTable();
    return;
  }
  const offset = reset || state.list?.key !== key || state.list.stale ? 0 : state.list.rows.length;
  if (offset === 0) state.list = {key, rows: null, total: 0};
  params.set('offset', String(offset));
  const exportLink = $('#export-orders');
  if (exportLink) {
    const p = listParams();
    exportLink.href = '/api/reports/orders.csv?' + p;
  }
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
  return `<div class="table-wrap"><table><thead><tr><th>Request</th>${showType ? '<th>Type</th>' : ''}<th>Priority</th><th>Status</th><th>Assigned to</th><th>Due</th></tr></thead><tbody>${rows.map(o => `<tr class="clickable" tabindex="0" data-order="${escape(o.id)}" aria-label="Open ${escape(o.title)}"><td><span class="order-title">${escape(o.title)}</span><div class="order-sub">${escape(o.building)}${o.asset ? ' · ' + escape(o.asset) : ''}${o.space ? ' · ' + escape(o.space) : ''}</div></td>${showType ? `<td><span class="request-kind">${icon(requestTypes[o.request_type].icon)}${requestTypes[o.request_type].label}</span></td>` : ''}<td>${tag(o.priority)}</td><td>${tag(o.status)}${o.reservation_status && o.reservation_status !== 'approved' ? ' ' + reservationTag(o.reservation_status) : ''}</td><td>${escape(o.assignee) || 'Unassigned'}</td><td class="due ${overdue(o) ? 'overdue' : ''}">${o.request_type === 'schedule' ? fmtTime(o.starts_at) : fmt(o.due_date)}${overdue(o) ? '<div class="order-sub">Overdue</div>' : ''}</td></tr>`).join('')}</tbody></table></div>${error ? `<div class="empty">${escape(error)}</div>` : rows.length ? '' : `<div class="empty">${enabledTypes().length ? 'No requests match. Try a different filter or create a new request.' : 'Request types are disabled. Your existing records are preserved.'}${!enabledTypes().length && state.me.user.role === 'admin' ? '<p><button class="quiet-button" data-page="settings">Configure request types</button></p>' : ''}</div>`}<div class="table-footer">Showing ${rows.length} of ${total} requests${!compact && rows.length < total ? ' <button class="quiet-button" id="load-more">Load more</button>' : ''}</div>`;
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
  $$('#order-table [data-page]').forEach(
    b =>
      (b.onclick = () => {
        state.page = b.dataset.page;
        render();
      }),
  );
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
    field('What do you need?', 'title') +
    select(
      'Priority',
      'priority',
      ['Normal', 'Low', 'High', 'Urgent'].map(x => [x, x]),
    ) +
    locationFields() +
    `<div class="field full" id="request-timing">${requestTiming(type)}</div>` +
    field('Details', 'description', 'textarea', '', true) +
    `<label class="field full">Photos or files (optional)<input type="file" name="files" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf,text/plain,text/csv,.docx,.xlsx"></label>`;
  dialog(
    'New request',
    `<form id="create-form"><div class="form-grid">${fields}</div>${formActions('Create request')}</form>`,
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
  if (e.key === 'Escape' && $('.sidebar.menu-open')) {
    $('.sidebar').classList.remove('menu-open');
    $('#nav-toggle').setAttribute('aria-expanded', 'false');
    $('#nav-toggle').focus();
  }
});
