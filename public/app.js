import {requestTypes, settingsUI, notificationsUI, bindSettings} from './request-settings.js';
import {
  state,
  $,
  $$,
  escape,
  icon,
  can,
  fmt,
  fmtTime,
  today,
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
import {orderEditor, ticketPage} from './order.js';
import {locationFields, bindLocation, requestTiming, bindTiming} from './forms.js';
import {configurableFields, bindConfigurable, withAnswers, ruleFor} from './requestform.js';
import {filterBar, bindFilterBar, applyFilters, pageLimit} from './filters.js';
import {calendarPage, bindCalendar} from './calendar.js';
import {recordsPage, bindRecords, recordEditor} from './records.js';
import {inventoryPage, bindInventory, partEditor} from './inventory.js';
import {reportsPage, bindReports} from './reports.js';

const enabledTypes = () => Object.keys(requestTypes).filter(key => state.data.modules[key]);
const pageType = () => (state.page.endsWith('Requests') ? state.page.replace('Requests', '') : null);
const pageSize = 50;
const reportLink = (() => {
  if (location.pathname !== '/report') return null;
  const p = new URLSearchParams(location.search);
  return {building: p.get('building') || '', asset: p.get('asset') || '', space: p.get('space') || ''};
})();
const requesterView = () => !can('requests.view_all');
const ticketPath = path => path.match(/^\/tickets\/([^/]+)$/)?.[1];
if (ticketPath(location.pathname)) {
  state.page = 'ticket';
  state.ticketRef = decodeURIComponent(ticketPath(location.pathname));
}
function openTicket(ref) {
  if (state.page !== 'ticket') state.returnPage = {page: state.page, filter: state.filter, search: state.search};
  state.page = 'ticket';
  state.ticketRef = String(ref);
  history.pushState({ticket: state.ticketRef}, '', '/tickets/' + encodeURIComponent(state.ticketRef));
  render();
  scrollTo(0, 0);
}
function leaveTicket() {
  const back = state.returnPage || {page: 'dashboard', filter: 'All', search: ''};
  state.returnPage = null;
  Object.assign(state, back);
  history.pushState({page: back.page}, '', '/');
  render();
}
addEventListener('popstate', () => {
  const ref = ticketPath(location.pathname);
  if (ref) {
    state.page = 'ticket';
    state.ticketRef = decodeURIComponent(ref);
  } else if (state.page === 'ticket') Object.assign(state, state.returnPage || {page: 'dashboard'});
  if (state.me?.user) render();
});

async function refresh() {
  state.me = await api('/me');
  state.data = await api('/data');
  if (state.list) state.list.stale = true;
  render();
}
hooks.refresh = refresh;
hooks.openTicket = openTicket;
hooks.leaveTicket = leaveTicket;
hooks.render = render;
hooks.openOrder = id => orderEditor(id);
hooks.reloadOrders = () => loadOrders(true);

// Destinations are grouped like the tab dividers of a work-order pad.
function navGroups() {
  const d = state.data;
  if (requesterView())
    return [
      [
        'Requests',
        [
          ['dashboard', 'home', 'Your requests'],
          ...(enabledTypes().length ? [['calendar', 'calendar', 'Calendar']] : []),
        ],
      ],
      ['Office', [['notifications', 'bell', 'Notifications']]],
    ];
  const groups = [
    [
      'Requests',
      [
        ['dashboard', 'home', 'Overview'],
        ...(enabledTypes().length
          ? [
              ['orders', 'work', 'All requests'],
              ['calendar', 'calendar', 'Calendar'],
            ]
          : []),
        ...enabledTypes().map(key => [key + 'Requests', requestTypes[key].icon, requestTypes[key].label + ' requests']),
        ...(d.modules.maintenance && can('maintenance.view')
          ? [['maintenance', 'calendar', 'Preventive maintenance']]
          : []),
      ],
    ],
    [
      'Places',
      [
        ['buildings', 'building', 'Buildings'],
        ['assets', 'asset', 'Assets'],
      ],
    ],
    ['Stock', d.modules.inventory && can('inventory.view') ? [['inventory', 'box', 'Inventory']] : []],
    [
      'Office',
      [
        ...(can('reports.view') ? [['reports', 'chart', 'Reports']] : []),
        ['notifications', 'bell', 'Notifications'],
        ...(can('admin') ? [['settings', 'settings', 'Settings']] : []),
      ],
    ],
  ];
  return groups.filter(([, items]) => items.length);
}

function go(page, filter = 'All') {
  if (location.pathname !== '/') history.pushState({page}, '', '/');
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
      `<main class="login"><div class="login-ticket">${reportLink ? '<p class="login-context">Sign in to report a problem. The location from the label is kept.</p>' : ''}<div class="login-head"><span class="brand-mark">${icon(me.branding?.icon || 'building')}</span><span class="brand-name">${escape(me.branding?.name || 'Facilities')}</span><span class="ticket-no">WO-0000</span></div><div class="login-body"><h1>${escape(me.branding?.welcome || 'Your facilities. One connected workspace.')}</h1><p>Maintenance, schedules, equipment and the places your organization depends on, kept on one shared pad.</p><a class="login-link" href="/auth/login${location.pathname !== '/' ? '?return=' + encodeURIComponent(location.pathname + location.search) : ''}">${me.mode === 'demo' ? 'Enter demo workspace' : 'Sign in with your organization'} ${icon('arrow')}</a></div><div class="login-foot"><span>${me.mode === 'demo' ? 'Local demo · Illustrative records · Administrator access' : escape(me.organization) + ' · Secure organization sign-in'}</span></div></div></main>`;
    return;
  }
  const d = state.data;
  if (!d) return;
  const groups = navGroups();
  const navs = groups.flatMap(([, items]) => items);
  if (state.page !== 'ticket' && !navs.some(n => n[0] === state.page)) {
    state.page = 'dashboard';
    state.filter = 'All';
    state.search = '';
  }
  const title = state.page === 'ticket' ? 'Ticket' : navs.find(x => x[0] === state.page)?.[2] || 'Overview';
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
  const dock = requesterView()
    ? [['dashboard', 'home', 'Requests']]
    : [['dashboard', 'home', 'Today'], ...(enabledTypes().length ? [['orders', 'work', 'Requests']] : [])];
  $('#app').innerHTML =
    `<div class="shell"><aside class="rail"><div class="brand"><span class="brand-mark">${icon(me.branding?.icon || 'building')}</span><span class="brand-name">${escape(me.branding?.name || 'Facilities')}<small>${escape(me.organization)}</small></span></div><nav id="workspace-nav" aria-label="Main navigation">${groups.map(([label, items]) => `<section class="nav-group"><h2 class="nav-tab">${label}</h2>${items.map(navButton).join('')}</section>`).join('')}</nav><div class="rail-foot"><div class="user-line"><span class="avatar">${escape(initials)}</span><div><strong>${escape(me.user.name)}</strong><small>${escape(me.user.role_name || me.user.role)}</small></div></div><button class="logout" id="logout">Sign out</button></div></aside><main class="workspace"><header class="topbar"><span class="crumb"><span class="brand-mark small">${icon(me.branding?.icon || 'building')}</span><span class="crumb-path">${escape(me.branding?.name || 'Facilities')} <span aria-hidden="true">/</span></span> <strong>${title}</strong></span><form class="top-search" id="top-search-form" role="search"><label class="search">${icon('search')}<input id="top-search" type="search" aria-label="Find a ticket" placeholder="Find a ticket" title="Type a WO number to open it, or words to search" autocomplete="off" enterkeyhint="search"></label><kbd aria-hidden="true">/</kbd></form><div class="top-right"><span class="top-date">${new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})}</span><button class="notification-button" id="bell" type="button" aria-haspopup="true" aria-controls="notif-pop" aria-expanded="${state.notifOpen ? 'true' : 'false'}" aria-label="Open notifications${unread ? `, ${unread} unread` : ''}">${icon('bell')}${unread ? `<span>${unread}</span>` : ''}</button>${state.notifOpen ? notifPanel() : ''}</div></header><div class="content">${me.mode === 'demo' ? '<div class="notice demo-notice">Demo workspace — these records are illustrative. SSO and an empty database are used in the production deployment.</div>' : ''}${pageContent()}</div></main><div class="dock">${dock.map(([p, i, t]) => `<button data-page="${p}" class="${state.page === p ? 'active' : ''}">${icon(i)}<span>${t}</span></button>`).join('')}${enabledTypes().length ? `<button class="dock-new" data-create="order" aria-label="New request">${icon('plus')}<span>New</span></button>` : ''}<button data-page="notifications" class="${state.page === 'notifications' ? 'active' : ''}">${icon('bell')}<span>Inbox</span>${unread ? `<span class="count">${unread}</span>` : ''}</button><button id="nav-toggle" type="button" aria-controls="workspace-nav" aria-expanded="false">${icon('menu')}<span>Menu</span></button></div></div>`;
  $$('[data-page]').forEach(
    b =>
      (b.onclick = () => {
        state.notifOpen = false;
        go(b.dataset.page);
      }),
  );
  bindNotifPanel();
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
  $('#top-search-form').onsubmit = e => {
    e.preventDefault();
    const q = $('#top-search').value.trim();
    if (!q) return;
    // A ticket number opens that ticket; anything else searches the full register.
    if (/^(wo-?)?\d+$/i.test(q)) return openTicket(ticketNo(q.replace(/\D/g, '')));
    const target = navs.some(n => n[0] === 'orders') ? 'orders' : 'dashboard';
    go(target);
    state.search = q;
    render();
  };
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
  if ($('#quick-form')) bindQuickForm();
  if ($('#ticket-page')) ticketPage(state.ticketRef);
  bindFilterBar(state.page, () => render());
  if ($('#calendar-root')) bindCalendar();
  if ($('#order-table')) loadOrders(false);
}

// Requesters: report a problem on the page itself, then follow their own tickets below.
const quickTypes = () => enabledTypes().filter(t => t !== 'schedule');
function requesterHome() {
  const types = quickTypes();
  const type = types.includes(state.quickType) ? state.quickType : types[0];
  const form = types.length
    ? `<section class="quick-report"><div class="section-head compact"><h2>Report a problem</h2></div><form id="quick-form" data-type="${escape(type)}"><div class="form-grid">${ticketFields(type, {quick: true, values: state.quickValues || {}})}</div><div class="form-error" role="alert"></div><div class="editor-actions">${enabledTypes().includes('schedule') ? '<button type="button" class="secondary" data-create="order">Book a space or event</button>' : ''}<span class="spacer"></span><button class="primary" type="submit">Submit request</button></div></form></section>`
    : '';
  return (
    heading(
      'Your requests',
      'Report a problem in a few seconds and follow every ticket you have submitted.',
      types.length ? null : 'order',
      'New request',
    ) +
    form +
    `<div class="section-head"><h2>Your tickets</h2></div>` +
    ordersPanel()
  );
}
function bindQuickForm() {
  const form = $('#quick-form');
  bindTicketFields(form, form.dataset.type, (next, values) => {
    state.quickType = next;
    state.quickValues = {title: values.title, description: values.description};
    render();
  });
  bindForm(form, async (data, f) => {
    const {failed} = await submitTicket(f, {...data, priority: data.priority || 'Normal'});
    state.quickValues = null;
    f.reset();
    await refresh();
    toast(
      failed.length
        ? `Request submitted, but ${failed.length} file${failed.length === 1 ? '' : 's'} could not be attached.`
        : 'Request submitted. You will be notified as it moves forward.',
    );
  });
}

// The bell opens a dropdown of recent updates; the Notifications page keeps the full inbox and preferences.
function notifPanel() {
  const notes = state.data.notifications.slice(0, 8);
  const unread = state.data.notifications.some(n => !n.read_at);
  return `<div class="notif-pop" id="notif-pop" role="dialog" aria-label="Recent notifications"><div class="notif-head"><strong>Notifications</strong>${unread ? '<button type="button" class="quiet-button" data-notif-read-all>Mark all as read</button>' : ''}</div>${
    notes.length
      ? `<ul class="notif-list">${notes
          .map(
            n =>
              `<li class="${n.read_at ? '' : 'unread'}"><button type="button" data-notif="${escape(n.id)}" data-notif-order="${escape(n.order_id)}"><span class="notif-title">${escape(n.title)}</span><span class="notif-message">${escape(n.message)}</span><small>${requestTypes[n.request_type]?.label || ''} · ${new Date(n.created_at).toLocaleString(undefined, {timeZone: state.me.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</small></button></li>`,
          )
          .join('')}</ul>`
      : `<div class="empty">You’re all caught up.</div>`
  }<button type="button" class="notif-all" data-notif-page>All notifications and preferences ${icon('arrow')}</button></div>`;
}
function bindNotifPanel() {
  const bell = $('#bell');
  if (!bell) return;
  bell.onclick = e => {
    e.stopPropagation();
    state.notifOpen = !state.notifOpen;
    render();
    if (state.notifOpen) $('#notif-pop [data-notif], #notif-pop [data-notif-page]')?.focus();
  };
  const pop = $('#notif-pop');
  if (!pop) return;
  pop.onclick = e => e.stopPropagation();
  $$('[data-notif]').forEach(
    b =>
      (b.onclick = async () => {
        state.notifOpen = false;
        try {
          await api('/notifications/read', {method: 'POST', body: JSON.stringify({id: b.dataset.notif})});
          state.data.notifications = state.data.notifications.map(n =>
            n.id === b.dataset.notif ? {...n, read_at: new Date().toISOString()} : n,
          );
        } catch {
          /* opening the ticket matters more than the read mark */
        }
        openTicket(b.dataset.notifOrder);
      }),
  );
  const all = $('[data-notif-read-all]');
  if (all)
    all.onclick = async () => {
      all.disabled = true;
      try {
        await api('/notifications/read', {method: 'POST', body: JSON.stringify({})});
        await refresh();
      } catch (e) {
        toast(e.message);
      }
    };
  $('[data-notif-page]').onclick = () => {
    state.notifOpen = false;
    go('notifications');
  };
}
const closeNotif = () => {
  if (!state.notifOpen) return;
  state.notifOpen = false;
  render();
  $('#bell')?.focus();
};
document.addEventListener('click', () => closeNotif());

function pageContent() {
  const d = state.data,
    s = d.summary;
  if (state.page === 'ticket')
    return '<div id="ticket-page" class="ticket-page"><div class="empty">Loading ticket…</div></div>';
  if (state.page === 'calendar') return calendarPage();
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
  if (requesterView()) return requesterHome();
  const lowParts = (d.parts || []).filter(p => !p.archived_at && p.quantity <= p.min_quantity);
  const requester = !can('requests.view_all');
  const tally = [
    ['orders', 'Active', s.active, 'Active', requester ? 'Your open tickets' : 'Not yet completed'],
    ['orders', 'Overdue', s.overdue, 'Overdue', 'Past their due date', s.overdue ? 'alert' : ''],
    ['orders', 'In progress', s.inProgress, 'In progress', 'Work underway'],
    can('reservations.approve') && d.modules.schedule
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
  if (d.modules.maintenance && can('maintenance.view')) {
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
  ...(can('requests.assignable') ? ['Assigned to me'] : []),
  ...(pageType() === 'schedule' && can('reservations.approve') ? ['Awaiting approval'] : []),
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
  if (!compact) applyFilters(p, state.page);
  return p;
}
function ordersPanel(compact = false) {
  if (!filterTabs(compact).includes(state.filter)) state.filter = 'All';
  const exportLink =
    can('reports.export') && !compact
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
    )}</div><div class="filter-tools">${exportLink}<label class="search">${icon('search')}<input id="search" type="search" aria-label="Search requests" placeholder="Search title, place or WO number" value="${escape(state.search)}"></label></div></div>${compact ? '' : filterBar(state.page, pageType())}<div id="order-table" data-compact="${compact}">${state.list?.rows ? ordersTable(compact) : '<div class="empty">Loading requests…</div>'}</div></section>`;
}
// The register loads one page at a time from the server; filters and search are applied there.
async function loadOrders(reset) {
  const el = $('#order-table');
  if (!el) return;
  const compact = el.dataset.compact === 'true';
  const params = listParams(compact);
  params.set('limit', String(compact ? 8 : pageLimit(state.page)));
  const key = params.toString();
  if (!reset && state.list?.key === key && state.list.rows && !state.list.stale) {
    el.innerHTML = ordersTable(compact);
    bindTable();
    return;
  }
  const offset = reset || state.list?.key !== key || state.list.stale ? 0 : state.list.rows.length;
  if (state.list?.key !== key) selection().clear();
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
// People who stamp or assign any ticket can select rows and update them together.
const canBulk = () => can('requests.update_any') || can('requests.assign');
const selection = () => (state.selected ||= new Set());
function bulkBar() {
  const n = selection().size;
  const people = state.data.users.filter(u => u.assignable);
  return `<div class="bulk-bar" id="bulk-bar" role="region" aria-label="Selected requests" ${n ? '' : 'hidden'}><strong id="bulk-count">${n} selected</strong>${can('requests.update_any') ? `<label class="ticket-control">Set status<select id="bulk-status"><option value="">Keep status</option>${['Open', 'In progress', 'On hold', 'Completed'].map(x => `<option>${x}</option>`).join('')}</select></label>` : ''}${can('requests.assign') ? `<label class="ticket-control">Assign to<select id="bulk-assign"><option value="">Keep assignee</option><option value="none">Unassigned</option>${people.map(u => `<option value="${escape(u.id)}">${escape(u.name)}</option>`).join('')}</select></label>` : ''}<button type="button" class="primary" id="bulk-apply">Apply to selected</button><button type="button" class="quiet-button" id="bulk-clear">Clear selection</button></div>`;
}
function ordersTable(compact) {
  const {rows = [], total = 0, error} = state.list || {};
  const showType = !pageType();
  const bulk = !compact && canBulk() && rows.length > 0;
  const sel = selection();
  const excerpt = text => (text.length > 160 ? text.slice(0, 157) + '…' : text);
  return `${bulk ? bulkBar() : ''}<div class="table-wrap"><table><thead><tr>${bulk ? `<th class="col-pick"><input type="checkbox" id="pick-all" aria-label="Select all ${rows.length} shown" ${rows.every(o => sel.has(o.id)) ? 'checked' : ''}></th>` : ''}<th class="col-no">No.</th><th>Request</th>${showType ? '<th class="col-type">Type</th>' : ''}<th class="col-stamp">Status</th><th class="col-priority">Priority</th><th class="col-assignee">Assigned to</th><th class="col-due">Due</th></tr></thead><tbody>${rows
    .map(
      o =>
        `<tr class="clickable ${overdue(o) ? 'is-overdue' : ''}" tabindex="0" data-order="${escape(o.id)}" aria-label="Open ${escape(ticketNo(o.number))} ${escape(o.title)}">${bulk ? `<td class="col-pick"><input type="checkbox" data-pick="${escape(o.id)}" aria-label="Select ${escape(ticketNo(o.number))}" ${sel.has(o.id) ? 'checked' : ''}></td>` : ''}<td class="col-no"><span class="ticket-no">${escape(ticketNo(o.number))}</span></td><td class="col-request"><span class="order-title">${escape(o.title)}</span><div class="order-sub">${o.category ? `<span class="category-mark">${escape(o.category)}</span> · ` : ''}${escape(o.building)}${o.asset ? ' · ' + escape(o.asset) : ''}${o.space ? ' · ' + escape(o.space) : ''}</div><div class="row-more"><div>${o.description ? `<span>${escape(excerpt(o.description))}</span>` : ''}<span>Requested by ${escape(o.requester)}</span></div></div></td>${showType ? `<td class="col-type"><span class="request-kind">${icon(requestTypes[o.request_type].icon)}${requestTypes[o.request_type].label}</span></td>` : ''}<td class="col-stamp">${tag(o.status)}${o.reservation_status && o.reservation_status !== 'approved' ? ' ' + reservationTag(o.reservation_status) : ''}</td><td class="col-priority">${tag(o.priority)}</td><td class="col-assignee">${escape(o.assignee) || '<span class="unassigned">Unassigned</span>'}</td><td class="col-due due ${overdue(o) ? 'overdue' : ''}">${o.request_type === 'schedule' ? fmtTime(o.starts_at) : fmt(o.due_date)}${overdue(o) ? '<span class="overdue-mark">Overdue</span>' : ''}</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table></div>${error ? `<div class="empty">${escape(error)}</div>` : rows.length ? '' : `<div class="empty">${enabledTypes().length ? (compact ? 'Nothing open. Every ticket on the pad is completed.' : 'No requests match. Try a different filter or create a new request.') : 'Request types are disabled. Your existing records are preserved.'}${!enabledTypes().length && can('admin') ? '<p><button class="quiet-button" data-page="settings">Configure request types</button></p>' : ''}</div>`}<div class="table-footer">Showing ${rows.length} of ${total} ${compact ? 'open tickets' : 'requests'}${!compact && rows.length < total ? ' <button class="quiet-button" id="load-more">Load more</button>' : ''}</div>`;
}
function bindTable() {
  $$('#order-table [data-order]').forEach(b => {
    b.onclick = e => {
      if (e.target.closest('.col-pick')) return;
      orderEditor(b.dataset.order);
    };
    b.onkeydown = e => {
      if (e.target.closest('.col-pick')) return;
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
  bindBulk();
}
function bindBulk() {
  const bar = $('#bulk-bar');
  if (!bar) return;
  const sel = selection();
  const sync = () => {
    bar.hidden = !sel.size;
    $('#bulk-count').textContent = `${sel.size} selected`;
    const boxes = $$('[data-pick]');
    $('#pick-all').checked = boxes.length > 0 && boxes.every(b => b.checked);
    boxes.forEach(b => b.closest('tr').classList.toggle('picked', b.checked));
  };
  $$('[data-pick]').forEach(
    b =>
      (b.onchange = () => {
        if (b.checked) sel.add(b.dataset.pick);
        else sel.delete(b.dataset.pick);
        sync();
      }),
  );
  $$('#order-table .col-pick').forEach(
    cell =>
      (cell.onclick = e => {
        // The whole cell toggles its box, so the target is the cell rather than a 20px square.
        if (e.target === cell) cell.querySelector('input').click();
      }),
  );
  $('#pick-all').onchange = e => {
    $$('[data-pick]').forEach(b => {
      b.checked = e.target.checked;
      if (b.checked) sel.add(b.dataset.pick);
      else sel.delete(b.dataset.pick);
    });
    sync();
  };
  $('#bulk-clear').onclick = () => {
    sel.clear();
    $$('[data-pick]').forEach(b => (b.checked = false));
    sync();
  };
  $('#bulk-apply').onclick = async () => {
    const change = {};
    const status = $('#bulk-status')?.value,
      assign = $('#bulk-assign')?.value;
    if (status) change.status = status;
    if (assign) change.assignee_id = assign === 'none' ? '' : assign;
    if (!Object.keys(change).length) return toast('Choose a status or a person to apply.');
    const ids = [...sel],
      button = $('#bulk-apply');
    button.disabled = true;
    let done = 0;
    const failed = [];
    for (const id of ids) {
      button.textContent = `Updating ${done + failed.length + 1} of ${ids.length}…`;
      try {
        await api(`/orders/${encodeURIComponent(id)}`, {method: 'PATCH', body: JSON.stringify(change)});
        done++;
        sel.delete(id);
      } catch (e) {
        failed.push(e.message);
      }
    }
    toast(
      failed.length
        ? `${done} updated. ${failed.length} could not be updated: ${failed[0]}`
        : `${done} request${done === 1 ? '' : 's'} updated.`,
    );
    await refresh();
  };
  sync();
}

const fileTypes =
  'image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf,text/plain,text/csv,.docx,.xlsx';
// The new-ticket fields for one request type, honouring the administrator's form rules.
function ticketFields(type, {prefill = {}, quick = false, values = {}} = {}) {
  const r = key => ruleFor(type, key);
  const types = quick ? quickTypes() : enabledTypes();
  const typeSelect =
    types.length > 1
      ? select(
          'Request type',
          'request_type',
          types.map(key => [key, requestTypes[key].label]),
          type,
        )
      : `<input type="hidden" name="request_type" value="${escape(type)}">`;
  const priority =
    r('priority') === 'hidden'
      ? ''
      : select(
          'Priority',
          'priority',
          ['Normal', 'Low', 'High', 'Urgent'].map(x => [x, x]),
          values.priority || 'Normal',
        );
  const title = field(
    quick ? 'What needs attention?' : 'What do you need?',
    'title',
    'text',
    values.title || '',
  ).replace('class="field ', 'class="field full ');
  const location = locationFields(
    prefill.building || '',
    prefill.asset || '',
    r('asset') !== 'hidden',
    r('asset') === 'required',
  );
  const timing =
    type === 'schedule' || (!quick && r('due_date') !== 'hidden')
      ? `<div class="timing" id="request-timing">${requestTiming(type, {space_id: prefill.space})}</div>`
      : '';
  const details =
    r('description') === 'hidden'
      ? ''
      : field(
          r('description') === 'required' ? 'Details' : 'Details (optional)',
          'description',
          'textarea',
          values.description || '',
          r('description') !== 'required',
        );
  const photos =
    r('photos') === 'hidden'
      ? ''
      : `<label class="field full">Photos or files${r('photos') === 'required' ? '' : ' (optional)'}<input type="file" name="files" multiple accept="${fileTypes}" ${r('photos') === 'required' ? 'required' : ''}></label>`;
  const configurable = `<div class="configurable" id="configurable">${configurableFields(type, {category: prefill.category || ''})}</div>`;
  return typeSelect + priority + title + configurable + location + timing + details + photos;
}
function bindTicketFields(root, type, onTypeChange) {
  bindLocation(undefined, root);
  bindTiming(undefined, root);
  bindConfigurable(root, type, root.querySelector('#configurable'));
  const pick = root.querySelector('select[name=request_type]');
  if (pick) pick.onchange = () => onTypeChange(pick.value, Object.fromEntries(new FormData(root)));
}
async function submitTicket(form, data) {
  const files = form.elements.files ? [...form.elements.files.files] : [];
  delete data.files;
  const body = withAnswers(data, form);
  if (!body.due_date && body.request_type !== 'schedule' && ruleFor(body.request_type, 'due_date') !== 'hidden')
    body.due_date = today();
  const created = await api('/orders', {method: 'POST', body: JSON.stringify(body)});
  const failed = [];
  for (const file of files) {
    try {
      await upload(created.id, file);
    } catch (e) {
      failed.push(`${file.name}: ${e.message}`);
    }
  }
  return {created, failed};
}

function createOrder(prefill = {}) {
  if (!enabledTypes().length) {
    toast('An administrator must enable a request type first.');
    return;
  }
  if (!activeBuildings().length) {
    toast('Add a building before creating requests.');
    if (can('records.manage')) {
      state.page = 'buildings';
      render();
    }
    return;
  }
  const type =
    prefill.type ||
    (prefill.space && enabledTypes().includes('schedule')
      ? 'schedule'
      : pageType() || (prefill.building ? quickTypes()[0] || enabledTypes()[0] : enabledTypes()[0]));
  dialog(
    'New request',
    `<form id="create-form"><div class="form-grid">${ticketFields(type, {prefill, values: prefill.values})}</div>${formActions('Create request')}</form>`,
    {number: 'WO-NEW'},
  );
  bindCancel();
  const form = $('#create-form');
  bindTicketFields(form, type, (next, values) =>
    createOrder({...prefill, type: next, building: values.building_id, asset: values.asset_id, values}),
  );
  bindForm(form, async (data, f) => {
    const {created, failed} = await submitTicket(f, data);
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

const openReportLink = () => {
  if (!reportLink || !state.me?.user) return;
  history.replaceState(null, '', '/');
  const building = state.data.buildings.find(b => b.id === reportLink.building && !b.archived_at);
  if (!building) return toast('That label points to a place that no longer exists. Choose the location yourself.');
  createOrder({
    building: building.id,
    asset: state.data.assets.some(a => a.id === reportLink.asset && a.building_id === building.id)
      ? reportLink.asset
      : '',
    space: state.data.spaces.some(s => s.id === reportLink.space && s.building_id === building.id)
      ? reportLink.space
      : '',
  });
};
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
    openReportLink();
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
    state.selected?.size ||
    ['settings', 'notifications', 'reports', 'inventory', 'ticket', 'calendar'].includes(state.page) ||
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
  // "/" jumps to the ticket finder from anywhere that is not already a text field.
  if (
    e.key === '/' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) &&
    !document.activeElement?.isContentEditable &&
    !$('#editor')?.open &&
    $('#top-search')
  ) {
    e.preventDefault();
    $('#top-search').focus();
  }
  if (e.key === 'Escape' && state.notifOpen) closeNotif();
  if (e.key === 'Escape' && $('.rail.menu-open')) {
    $('.rail').classList.remove('menu-open');
    document.body.classList.remove('menu-locked');
    $('#nav-toggle').setAttribute('aria-expanded', 'false');
    $('#nav-toggle').focus();
  }
});
