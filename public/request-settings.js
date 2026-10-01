// Pure markup helpers keep request configuration separate from the workspace renderer.
import {adminUI, bindAdmin, isAdminTab} from './admin-settings.js';
import {auditUI, bindAudit} from './audit.js';
import {formsUI, bindForms} from './settings-forms.js';
import {dataUI, bindData} from './settings-data.js';
import {accessUI, bindAccess} from './access-settings.js';
import {toolsUI, bindTools} from './settings-tools.js';
import {officeUI, bindOffice} from './settings-office.js';
import {appearance, applyAppearance} from './ui.js';
function updatesUI(state, escape) {
  const release = state.release,
    agent = state.updateAgent,
    st = agent?.status;
  const busy = st && ['requested', 'running'].includes(st.state);
  const progress = st
    ? `<div class="update-progress ${escape(st.state)}" role="status" aria-live="polite"><strong>${{requested: 'Update requested', running: 'Updating', succeeded: 'Update finished', failed: 'Update failed'}[st.state] || 'Update'}${st.version ? ' · ' + escape(st.version) : ''}</strong><p>${escape(state.restarting ? 'The application is restarting with the new version…' : st.message || '')}</p>${busy ? '<span class="update-bar" aria-hidden="true"></span>' : ''}</div>`
    : '';
  const install =
    release?.available && agent?.agent
      ? `<div class="setting-row"><span><strong>Install version ${escape(release.latest)}</strong><small>The server downloads and verifies the release, backs up the database, then restarts. The page reloads by itself when the new version is running.</small></span><button class="primary" data-install-update ${busy || agent.pending ? 'disabled' : ''}>${busy ? 'Updating…' : `Install ${escape(release.latest)}`}</button></div>`
      : '';
  const setup =
    agent && !agent.agent
      ? `<div class="sheet-heading"><h2>Enable the update button</h2><p>Run this once on the server. It installs a small system service that installs releases when an administrator asks here; the application itself never gets access to Docker.</p><pre class="update-command">sudo /opt/facilities/bin/facilities-update --install-agent</pre></div>`
      : agent?.stalled
        ? `<div class="sheet-heading"><p class="form-error">The server has not picked up the update request. Run <code>sudo /opt/facilities/bin/facilities-update --install-agent</code> on the server, or install with the command below.</p></div>`
        : '';
  return `<section class="settings-sheet"><div class="sheet-heading"><h2>Application updates</h2><p>Check published GitHub releases and install them from here.</p></div><div class="setting-row"><span><strong>${release ? `Installed version ${escape(release.installed)}` : 'Release status'}</strong><small>${state.releaseLoading ? 'Checking GitHub…' : release ? (release.available ? `Version ${escape(release.latest)} is available.` : release.latest ? 'You’re running the latest stable release.' : 'No stable release has been published yet.') : 'Check for a newer stable version.'}</small></span><button class="${install ? 'secondary' : 'primary'}" data-check-release ${state.releaseLoading ? 'disabled' : ''}>${state.releaseLoading ? 'Checking…' : 'Check for updates'}</button></div>${state.releaseError ? `<p class="form-error" role="alert">${escape(state.releaseError)}</p>` : ''}${install}${progress}${setup}${release?.latest ? `<div class="sheet-heading"><a href="${escape(release.url)}" target="_blank" rel="noopener noreferrer">View release notes</a><p>You can also update from the server with the command below.</p><pre class="update-command">${escape(release.updateCommand)}</pre></div>` : ''}</section>`;
}
export const requestTypes = {
  maintenance: {label: 'Maintenance', icon: 'work', description: 'Repairs, upkeep, and facilities support.'},
  schedule: {label: 'Schedule', icon: 'calendar', description: 'Events, meetings, and use of your buildings.'},
  technology: {label: 'Technology', icon: 'technology', description: 'Devices, connectivity, and technical support.'},
};
const sectionCapability = {
  modules: 'admin.settings',
  delivery: 'admin.settings',
  branding: 'admin.settings',
  workspace: 'admin.settings',
  forms: 'admin.forms',
  checklists: 'admin.forms',
  due: 'admin.settings',
  people: 'admin.people',
  groups: 'admin.people',
  provisioning: 'admin.people',
  roles: 'admin.roles',
  assignment: 'admin.roles',
  access: 'admin.roles',
  data: 'admin.data',
  import: 'admin.settings',
  integrations: 'admin.settings',
  audit: 'admin.audit',
  updates: 'admin.updates',
};
// Settings are grouped by what an administrator is trying to do.
const settingsGroups = [
  [
    'Workspace',
    [
      ['modules', 'Features'],
      ['forms', 'Request forms'],
      ['checklists', 'Checklists & replies'],
      ['due', 'Due dates'],
      ['delivery', 'Notifications'],
      ['branding', 'Identity'],
      ['workspace', 'Workspace'],
    ],
  ],
  [
    'People & access',
    [
      ['people', 'People'],
      ['groups', 'Groups'],
      ['roles', 'Roles'],
      ['assignment', 'Auto-assignment'],
      ['access', 'Access as code'],
      ['provisioning', 'Provisioning'],
    ],
  ],
  [
    'System',
    [
      ['data', 'Backups & data'],
      ['import', 'Import'],
      ['integrations', 'Integrations'],
      ['audit', 'Audit log'],
      ['updates', 'Updates'],
    ],
  ],
];
// The sections this person may open, as [tab, label].
export const allowedSettingsTabs = state =>
  settingsGroups
    .flatMap(([, items]) => items)
    .filter(([key]) => state.me.user.capabilities.includes(sectionCapability[key]));
export function settingsUI(state, escape, icon, heading) {
  const types = requestTypes,
    modules = state.data.modules;
  const groups = settingsGroups;
  // Each section needs its own administration capability; the Administrator role holds them all.
  const caps = state.me.user.capabilities;
  const visible = groups
    .map(([label, items]) => [label, items.filter(([key]) => caps.includes(sectionCapability[key]))])
    .filter(([, items]) => items.length);
  const allowed = visible.flatMap(([, items]) => items.map(([key]) => key));
  if (!allowed.includes(state.settingsTab)) state.settingsTab = allowed[0];
  const tabBar = `<nav class="settings-nav" aria-label="Settings sections">${visible
    .map(
      ([label, items]) =>
        `<div class="settings-group"><h2>${label}</h2>${items.map(([key, name]) => `<button type="button" data-settings-tab="${key}" class="${state.settingsTab === key ? 'selected' : ''}" ${state.settingsTab === key ? 'aria-current="page"' : ''}>${name}</button>`).join('')}</div>`,
    )
    .join('')}</nav>`;
  let body;
  if (['access', 'assignment'].includes(state.settingsTab)) body = accessUI(state);
  else if (['checklists', 'due'].includes(state.settingsTab)) body = toolsUI(state);
  else if (['import', 'integrations'].includes(state.settingsTab)) body = officeUI(state);
  else if (isAdminTab(state.settingsTab)) body = adminUI(state, escape);
  else if (state.settingsTab === 'updates') body = updatesUI(state, escape);
  else if (state.settingsTab === 'audit') body = auditUI(state, escape);
  else if (state.settingsTab === 'forms') body = formsUI(state);
  else if (state.settingsTab === 'data') body = dataUI(state);
  else if (state.settingsTab === 'workspace')
    body = `<section class="panel settings-list"><div><strong>Organization</strong><span>${escape(state.me.organization)}</span></div><div><strong>Authentication</strong><span>${state.me.mode === 'demo' ? 'Local development demo' : 'OpenID Connect SSO'}</span></div><div><strong>Timezone</strong><span>${escape(state.me.timezone)}</span></div><div><strong>Deployment</strong><span>Self hosted · Single organization</span></div></section><p class="settings-copy">Change your workspace identity and people in the administration tabs. SSO connection details and timezone are configured on your server. Provisioned roles remain under administrator control.</p><div class="section-head"><h2>Team</h2></div><section class="work-panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody>${state.data.users.map(u => `<tr><td>${escape(u.name)}</td><td>${escape(u.role)}</td></tr>`).join('')}</tbody></table></div></section>`;
  else {
    const delivery = state.settingsTab === 'delivery';
    const email = state.data.emailConfigured;
    const rows = delivery
      ? toggle(
          escape,
          'notifications',
          'In-app notifications',
          'Notify people about new requests, assignments, status changes, and comments.',
          modules.notifications,
        ) +
        toggle(
          escape,
          'email',
          'Email notifications',
          email
            ? 'Also send each in-app notification by email to people who keep email turned on in their preferences.'
            : 'Email delivery needs SMTP settings on the server (SMTP_HOST or SMTP_URL, and SMTP_FROM).',
          modules.email,
          email ? '' : 'Not configured on this server',
          !email && !modules.email,
        )
      : Object.keys(types)
          .map(key =>
            toggle(
              escape,
              key,
              types[key].label + ' requests',
              types[key].description,
              modules[key],
              `${state.data.moduleCounts[key] || 0} saved requests · ${modules[key] ? 'Visible to your organization' : 'Hidden from your organization'}`,
            ),
          )
          .join('') +
        toggle(
          escape,
          'inventory',
          'Inventory',
          'Track spare parts and supplies, and record what each request uses.',
          modules.inventory,
        );
    body = `<form id="module-form" class="settings-sheet"><div class="sheet-heading"><h2>${delivery ? 'Notification delivery' : 'Choose what your organization uses'}</h2><p>${delivery ? 'Control notifications for everyone. Members choose their own event and email preferences.' : 'Enabled request types appear in navigation and request forms. Turning a feature off preserves its records.'}</p></div>${rows}<div class="settings-footer"><p>${delivery ? 'Email is sent in the background and retried if the mail server is unavailable.' : 'Changes apply to the whole organization. Existing records return when a feature is re-enabled.'}</p><div class="form-error" role="alert"></div><button type="submit" class="primary">Save settings</button></div></form>${delivery ? emailStatus(state, escape) : ''}`;
  }
  return (
    heading('Workspace settings', 'Configure the workspace your organization actually needs.') +
    `<div class="settings-layout">${tabBar}<div class="settings-main">${body}</div></div>`
  );
}
function toggle(escape, name, label, description, checked, detail = '', disabled = false) {
  return `<label class="setting-row"><span><strong>${escape(label)}</strong><small>${escape(description)}</small>${detail ? `<em>${escape(detail)}</em>` : ''}</span><span class="toggle"><input type="checkbox" role="switch" name="${name}" aria-label="${escape(label)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="toggle-track" aria-hidden="true"></span></span></label>`;
}
function emailStatus(state, escape) {
  const e = state.emailStatus;
  if (!state.data.emailConfigured) return '';
  return `<section class="settings-sheet email-status"><div class="sheet-heading"><h2>Email delivery</h2><p>${e ? `Sending as ${escape(e.from)}. ${e.sent} sent · ${e.pending} waiting · ${e.failed} failed after retries.` : 'Check the outbox and send yourself a test message.'}</p>${e?.lastError ? `<p class="form-error">Last error: ${escape(e.lastError.last_error)}</p>` : ''}</div><div class="setting-row"><span><strong>Test email</strong><small>Sends a message to ${escape(state.me.user.email || 'your account email')} right away.</small></span><span class="inline-actions">${e ? '' : '<button class="secondary" data-email-status>Check outbox</button>'}<button class="primary" data-email-test>Send test email</button></span></div></section>`;
}
export function notificationsUI(state, escape, icon, heading) {
  const events = {
    created: ['New requests', 'Requests submitted to your team. Available to managers and administrators.'],
    email: ['Also send by email', 'Receive the updates you choose above by email as well as in this inbox.'],
    assigned: ['Assignments', 'When a request is assigned to you.'],
    status: ['Status updates', 'Changes to your requests or assigned work.'],
    comment: ['Comments', 'Conversation on your requests, assigned work, or requests you follow.'],
    mention: ['Mentions', 'When someone mentions you in a comment.'],
    due: ['Due and overdue', 'When your work is due today or becomes overdue.'],
  };
  const tabBar = `<div class="settings-tabs"><button data-notification-tab="inbox" class="${state.notificationTab === 'inbox' ? 'selected' : ''}">Inbox</button><button data-notification-tab="preferences" class="${state.notificationTab === 'preferences' ? 'selected' : ''}">Preferences</button></div>`;
  const title = heading('Notifications', 'Stay connected to the requests that need you.');
  const disabled = !state.data.modules.notifications
    ? '<div class="notice">Your administrator has paused new in-app notifications. Your preferences are saved for when delivery resumes.</div>'
    : '';
  if (state.notificationTab === 'preferences')
    return (
      title +
      tabBar +
      disabled +
      `<form id="preferences-form" class="settings-sheet"><div class="sheet-heading"><h2>Your notification preferences</h2><p>Choose which updates appear in your in-app inbox. These preferences apply only to you.</p></div>${Object.entries(
        events,
      )
        .filter(([key]) => key !== 'email' || (state.data.modules.email && state.data.emailConfigured))
        .sort(([a], [b]) => (a === 'email') - (b === 'email'))
        .map(([key, [label, description]]) => toggle(escape, key, label, description, state.data.preferences[key]))
        .join('')}${
        state.data.modules.email && state.data.emailConfigured
          ? toggle(
              escape,
              'digest',
              'Daily digest instead',
              'One email each morning with your updates, open work and anything due, instead of an email per update.',
              state.data.preferences.digest,
            ) +
            `<div class="setting-row"><span><strong>Quiet hours</strong><small>No email between these times (organization time); it arrives when they end.</small></span><span class="quiet-hours">${[
              'quiet_start',
              'quiet_end',
            ]
              .map(
                (name, i) =>
                  `<label><span class="visually-hidden">${i ? 'Quiet hours end' : 'Quiet hours start'}</span><select name="${name}" aria-label="${i ? 'Quiet hours end' : 'Quiet hours start'}"><option value="">${i ? 'Until' : 'Off'}</option>${Array.from({length: 24}, (_, h) => `<option value="${h}" ${state.data.preferences[name] === h ? 'selected' : ''}>${new Date(2000, 0, 1, h).toLocaleTimeString(undefined, {hour: 'numeric'})}</option>`).join('')}</select></label>`,
              )
              .join('<span aria-hidden="true">to</span>')}</span></div>`
          : ''
      }<div class="settings-footer"><p>You won’t receive notifications for your own actions.</p><div class="form-error" role="alert"></div><button class="primary" type="submit">Save preferences</button></div></form><section class="settings-sheet appearance-sheet"><div class="sheet-heading"><h2>Appearance on this device</h2><p>Changes apply right away and are remembered in this browser.</p></div><div class="setting-row"><span><strong>Theme</strong><small>Dark is easier at night and in dim mechanical rooms.</small></span><span class="segmented" role="radiogroup" aria-label="Theme">${[
        ['system', 'System'],
        ['light', 'Light'],
        ['dark', 'Dark'],
      ]
        .map(
          ([v, l]) =>
            `<label><input type="radio" name="theme" value="${v}" ${appearance().theme === v ? 'checked' : ''}><span>${l}</span></label>`,
        )
        .join(
          '',
        )}</span></div>${toggle(escape, 'contrast', 'Higher contrast', 'Darker text, stronger lines and focus outlines.', appearance().contrast === 'more')}</section>`
    );
  const notes = state.data.notifications;
  return (
    title +
    tabBar +
    disabled +
    `<section class="panel"><div class="inbox-heading"><h2>Recent updates</h2>${notes.some(n => !n.read_at) ? '<button class="quiet-button" data-read="">Mark all as read</button>' : ''}</div>${notes.map(note => `<div class="inbox-row ${note.read_at ? '' : 'unread'}"><span class="inbox-icon">${icon(requestTypes[note.request_type].icon)}</span><div><button class="inbox-title" data-open-notification="${escape(note.id)}" data-request-id="${escape(note.order_id)}">${escape(note.title)}</button><p>${escape(note.message)}</p><small>${requestTypes[note.request_type].label} · ${new Date(note.created_at).toLocaleString(undefined, {timeZone: state.me.timezone})}</small></div>${!note.read_at ? `<button class="read-button" data-read="${escape(note.id)}" aria-label="Mark notification as read">${icon('check')}</button>` : ''}</div>`).join('') || '<div class="empty"><div class="empty-symbol">' + icon('bell') + '</div><h2>You’re all caught up</h2><p>New assignments and updates will appear here.</p></div>'}</section>`
  );
}
export function bindSettings(state, api, refresh, render, toast, openOrder) {
  bindAdmin(state, api, refresh, render, toast);
  bindAudit(state, api, render, toast);
  bindForms(state, render, refresh);
  bindData(state, render);
  bindAccess(state, render);
  bindTools(state, render);
  bindOffice(state, render);
  document
    .querySelectorAll('.appearance-sheet [name=theme]')
    .forEach(r => (r.onchange = () => applyAppearance({theme: r.value})));
  const contrast = document.querySelector('.appearance-sheet [name=contrast]');
  if (contrast) contrast.onchange = () => applyAppearance({contrast: contrast.checked ? 'more' : 'normal'});
  const status = document.querySelector('[data-email-status]');
  if (status)
    status.onclick = async () => {
      status.disabled = true;
      try {
        state.emailStatus = await api('/admin/email');
        render();
      } catch (e) {
        toast(e.message);
        status.disabled = false;
      }
    };
  const test = document.querySelector('[data-email-test]');
  if (test)
    test.onclick = async () => {
      test.disabled = true;
      try {
        const r = await api('/admin/email/test', {method: 'POST'});
        toast(`Test email sent to ${r.to}.`);
        state.emailStatus = await api('/admin/email');
        render();
      } catch (e) {
        toast(e.message);
        test.disabled = false;
      }
    };
  document.querySelectorAll('[data-settings-tab]').forEach(
    button =>
      (button.onclick = () => {
        state.settingsTab = button.dataset.settingsTab;
        render();
      }),
  );
  // On phones the section list is a scrolling strip; keep the open section in view.
  const strip = document.querySelector('.settings-nav'),
    current = strip?.querySelector('.selected');
  if (strip && current && strip.scrollWidth > strip.clientWidth)
    strip.scrollLeft +=
      current.getBoundingClientRect().left -
      strip.getBoundingClientRect().left -
      (strip.clientWidth - current.offsetWidth) / 2;
  if (state.settingsTab === 'updates' && !state.updateAgent && !state.updateAgentLoading) {
    state.updateAgentLoading = true;
    api('/admin/update')
      .then(r => (state.updateAgent = r))
      .catch(e => (state.updateAgent = {agent: false, reason: e.message}))
      .finally(() => {
        state.updateAgentLoading = false;
        render();
      });
  }
  // Update progress is streamed (live:update); when the server restarts on the new version, the app's
  // reconnect handler reloads the page.
  if (!state.updateListener) {
    state.updateListener = true;
    addEventListener('live:update', async () => {
      try {
        state.updateAgent = await api('/admin/update');
      } catch {
        return;
      }
      if (state.settingsTab === 'updates' && state.page === 'settings') render();
    });
  }
  const install = document.querySelector('[data-install-update]');
  if (install)
    install.onclick = async () => {
      install.disabled = true;
      try {
        state.updateAgent = await api('/admin/update', {method: 'POST', body: JSON.stringify({version: 'latest'})});
        render();
      } catch (e) {
        toast(e.message);
        install.disabled = false;
      }
    };
  const check = document.querySelector('[data-check-release]');
  if (check)
    check.onclick = async () => {
      state.releaseLoading = true;
      state.releaseError = '';
      render();
      try {
        state.release = await api('/releases');
      } catch (e) {
        state.releaseError = e.message;
      } finally {
        state.releaseLoading = false;
        render();
      }
    };
  document.querySelectorAll('[data-notification-tab]').forEach(
    button =>
      (button.onclick = () => {
        state.notificationTab = button.dataset.notificationTab;
        render();
      }),
  );
  for (const name of ['module-form', 'preferences-form']) {
    const form = document.querySelector('#' + name);
    if (!form) continue;
    form.onsubmit = async e => {
      e.preventDefault();
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      const data = Object.fromEntries(
        [...form.querySelectorAll('input[type=checkbox]')].map(input => [input.name, input.checked]),
      );
      for (const select of form.querySelectorAll('select[name^=quiet_]'))
        data[select.name] = select.value === '' ? null : Number(select.value);
      try {
        await api(name === 'module-form' ? '/settings' : '/preferences', {
          method: name === 'module-form' ? 'PATCH' : 'PUT',
          body: JSON.stringify(data),
        });
        await refresh();
        toast(name === 'module-form' ? 'Workspace settings saved.' : 'Notification preferences saved.');
      } catch (err) {
        form.querySelector('.form-error').textContent = err.message;
        button.disabled = false;
      }
    };
  }
  document.querySelectorAll('[data-read]').forEach(
    button =>
      (button.onclick = async () => {
        try {
          await api('/notifications/read', {
            method: 'POST',
            body: JSON.stringify({id: button.dataset.read || undefined}),
          });
          await refresh();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document.querySelectorAll('[data-open-notification]').forEach(
    button =>
      (button.onclick = async () => {
        try {
          await api('/notifications/read', {
            method: 'POST',
            body: JSON.stringify({id: button.dataset.openNotification}),
          });
          await refresh();
          await openOrder(button.dataset.requestId);
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
