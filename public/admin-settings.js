// Administration: identity, people, groups, roles and provisioning. Data loads automatically
// when an administration tab opens; people and groups are ledgers edited in sheets.
import {
  $,
  $$,
  escape as escapeHtml,
  icon,
  tag,
  dialog,
  closeDialog,
  field,
  select,
  checkbox,
  bindForm,
  formActions,
  bindCancel,
  confirmButton,
} from './ui.js';

const adminTabs = ['branding', 'people', 'groups', 'roles', 'provisioning'];
export const isAdminTab = tab => adminTabs.includes(tab);
const roleName = (a, id) => a.roles.find(r => r.id === id)?.name || id;
const assignableRoles = a => a.roles.filter(r => !r.locked);

export function adminUI(state, e) {
  const a = state.admin;
  if (!a)
    return `<section class="settings-sheet" data-admin-loading><div class="empty">${state.adminError ? e(state.adminError) : 'Loading administration…'}</div></section>`;
  const input = (name, label, value = '', type = 'text') =>
    `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" required></label>`;
  const save = '<p class="form-error" role="alert"></p><button class="primary" type="submit">Save changes</button>';
  if (state.settingsTab === 'branding')
    return `<form id="branding-form" class="settings-sheet admin-form"><div class="sheet-heading"><h2>Workspace identity</h2><p>Personalize the sign-in page, navigation and browser title.</p></div>${input('name', 'Workspace name', a.settings.name || state.me.organization)}${input('welcome', 'Welcome message', a.settings.welcome || 'Your facilities. One connected workspace.')}<label>Workspace icon<select name="icon">${[
      ['building', 'Building'],
      ['work', 'Maintenance'],
      ['technology', 'Technology'],
      ['calendar', 'Calendar'],
    ]
      .map(([v, l]) => `<option value="${v}" ${a.settings.icon === v ? 'selected' : ''}>${l}</option>`)
      .join(
        '',
      )}</select></label><label class="admin-check"><input name="provisioned_only" type="checkbox" ${a.settings.provisioned_only ? 'checked' : ''}>Require users to be provisioned before SSO sign-in</label><p class="settings-copy">Your bootstrap administrator can always sign in. Groups organize people; roles control what they can do.</p>${save}</form>`;
  if (state.settingsTab === 'people') {
    const f = (state.peopleFilter ||= {q: '', role: '', status: ''});
    return `<section class="settings-sheet wide-sheet"><div class="sheet-heading sheet-toolbar"><div><h2>People and access</h2><p>${a.users.length} ${a.users.length === 1 ? 'person' : 'people'}. Disabling an account ends its sessions immediately.</p></div><button class="primary" data-provision>${icon('plus')}Provision person</button></div><div class="ledger-tools"><label class="search">${icon('search')}<input id="people-search" type="search" aria-label="Search people" placeholder="Search name or email" value="${e(f.q)}"></label><select id="people-role" aria-label="Filter by role"><option value="">All roles</option>${a.roles.map(r => `<option value="${e(r.id)}" ${f.role === r.id ? 'selected' : ''}>${e(r.name)}</option>`).join('')}</select><select id="people-status" aria-label="Filter by status"><option value="">Enabled and disabled</option><option value="enabled" ${f.status === 'enabled' ? 'selected' : ''}>Enabled</option><option value="disabled" ${f.status === 'disabled' ? 'selected' : ''}>Disabled</option></select></div><div id="people-table">${peopleTable(a, f, e)}</div></section>`;
  }
  if (state.settingsTab === 'groups')
    return `<section class="settings-sheet wide-sheet"><div class="sheet-heading sheet-toolbar"><div><h2>Groups</h2><p>Organize people by hand, through SCIM, or automatically when they are first provisioned. Groups do not grant permissions; roles do.</p></div><button class="primary" data-new-group>${icon('plus')}Create group</button></div>${
      a.groups.length
        ? `<div class="table-wrap"><table><thead><tr><th>Group</th><th>Description</th><th>Members</th><th>New people</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${a.groups
            .map(
              g =>
                `<tr><td><strong>${e(g.name)}</strong></td><td>${e(g.description) || '—'}</td><td>${new Set(a.members.filter(m => m.group_id === g.id).map(m => m.user_id)).size}</td><td>${g.auto_assign ? 'Added automatically' : 'Manual'}</td><td class="row-actions"><button class="quiet-button" data-edit-group="${e(g.id)}" aria-label="Edit ${e(g.name)}">${icon('edit')}Edit</button></td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<div class="empty">No groups yet. Create your first team.</div>'
    }</section>`;
  if (state.settingsTab === 'roles') return rolesUI(state, a, e);
  return `<section class="settings-sheet"><div class="sheet-heading"><h2>Provisioning connections</h2><p>Use expiring bearer tokens for Syntra SCIM or your own REST integrations.</p><p>SCIM base URL</p><pre class="update-command">${e(location.origin)}/api/provisioning/v1/scim</pre><p>REST base URL</p><pre class="update-command">${e(location.origin)}/api/provisioning/v1</pre><p class="settings-copy">Map the immutable OIDC subject into the FMXIdentity SCIM extension. Tokens manage ordinary users and memberships; administrator accounts are protected.</p></div>${state.newKey ? `<div class="sheet-heading notice"><strong>Copy this token now. It is shown once.</strong><pre class="update-command">${e(state.newKey)}</pre><button class="quiet-button" data-dismiss-key>I saved the token</button></div>` : ''}<div class="sheet-heading">${a.keys.map(k => `<div class="setting-row"><span><strong>${e(k.name)}</strong><small>${k.revoked ? 'Revoked' : 'Expires ' + e(k.expires_at.slice(0, 10))}</small></span>${k.revoked ? '' : `<button class="quiet-button" data-revoke-key="${e(k.id)}">Revoke</button>`}</div>`).join('') || '<p>No provisioning tokens yet.</p>'}</div><form id="key-create" class="admin-form sheet-heading"><h2>Create a token</h2>${input('name', 'Connection name')}${input('days', 'Expires in days', '90', 'number')}${save.replace('Save changes', 'Create token')}</form></section>`;
}

function peopleTable(a, f, e) {
  const q = f.q.trim().toLowerCase();
  const groupsOf = id =>
    [...new Set(a.members.filter(m => m.user_id === id).map(m => m.group_id))]
      .map(g => a.groups.find(x => x.id === g)?.name)
      .filter(Boolean);
  const rows = a.users.filter(
    u =>
      (!q || `${u.name} ${u.email} ${u.userName || ''}`.toLowerCase().includes(q)) &&
      (!f.role || u.role === f.role) &&
      (!f.status || (f.status === 'enabled') === u.active),
  );
  return `<div class="table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Account</th><th>Groups</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows
    .map(
      u =>
        `<tr><td><strong>${e(u.name)}</strong><div class="order-sub">${e(u.email) || 'No email'}</div></td><td>${e(roleName(a, u.role))}</td><td>${u.active ? tag('completed', 'Enabled') : tag('archived', 'Disabled')}</td><td>${u.managed ? 'Provisioned' : 'SSO managed'}</td><td>${e(groupsOf(u.id).join(', ')) || '—'}</td><td class="row-actions">${u.role === 'admin' ? '<span class="order-sub">Protected</span>' : `<button class="quiet-button" data-edit-user="${e(u.id)}" aria-label="Edit ${e(u.name)}">${icon('edit')}Edit</button>`}</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table></div>${rows.length ? '' : '<div class="empty">No people match these filters.</div>'}<div class="table-footer">Showing ${rows.length} of ${a.users.length}</div>`;
}

function rolesUI(state, a, e) {
  const groups = [...new Set(a.capabilities.map(c => c.group))];
  const head = a.roles
    .map(
      r =>
        `<th class="role-col"><span class="role-name">${e(r.name)}</span><small>${r.people} ${r.people === 1 ? 'person' : 'people'}${r.overridden ? ' · customized' : r.builtin ? '' : ' · custom'}</small>${r.locked ? '<small>Always everything</small>' : r.builtin ? (r.overridden ? `<button type="button" class="quiet-button" data-reset-role="${e(r.id)}">Reset to defaults</button>` : '') : `<button type="button" class="quiet-button danger-text" data-delete-role="${e(r.id)}">Delete role</button>`}</th>`,
    )
    .join('');
  const body = groups
    .map(
      g =>
        `<tr class="matrix-group"><th colspan="${a.roles.length + 1}">${e(g)}</th></tr>${a.capabilities
          .filter(c => c.group === g)
          .map(
            c =>
              `<tr><th scope="row" class="cap"><strong>${e(c.label)}</strong><small>${e(c.description)}</small></th>${a.roles
                .map(
                  r =>
                    `<td class="matrix-cell"><input type="checkbox" aria-label="${e(r.name)}: ${e(c.label)}" data-role="${e(r.id)}" data-cap="${e(c.id)}" ${r.capabilities.includes(c.id) ? 'checked' : ''} ${r.locked || c.id === 'admin' ? 'disabled' : ''}></td>`,
                )
                .join('')}</tr>`,
          )
          .join('')}`,
    )
    .join('');
  return `<form id="roles-form" class="settings-sheet wide-sheet"><div class="sheet-heading sheet-toolbar"><div><h2>Roles and permissions</h2><p>Defaults for the built-in roles are defined in <code>permissions.js</code>. Changes here override them for this workspace and are recorded in the audit log. Administrators always keep every permission.</p></div><button class="primary" type="button" data-new-role>${icon('plus')}New role</button></div><div class="table-wrap matrix-wrap" data-no-stack><table class="matrix"><thead><tr><th class="cap">Permission</th>${head}</tr></thead><tbody>${body}</tbody></table></div><div class="settings-footer"><p>Everyone can submit requests, follow their own, comment on them, and edit their own request while it is Open.</p><div class="form-error" role="alert"></div><button type="submit" class="primary">Save roles</button></div></form>`;
}

export function bindAdmin(state, api, refresh, render, toast) {
  const load = async () => {
    state.admin = await api('/admin');
    state.adminError = '';
  };
  if ($('[data-admin-loading]') && !state.adminLoading) {
    state.adminLoading = true;
    load()
      .catch(err => (state.adminError = err.message))
      .finally(() => {
        state.adminLoading = false;
        render();
      });
  }
  const a = state.admin;
  if (!a) return;
  const after = async message => {
    await load();
    await refresh();
    toast(message);
  };
  const wire = (selector, endpoint, method, convert) =>
    $$(selector).forEach(form =>
      bindForm(form, async (data, f) => {
        await api(typeof endpoint === 'function' ? endpoint(f) : endpoint, {
          method,
          body: JSON.stringify(convert ? convert(data, f) : data),
        });
        await after('Administration settings saved.');
      }),
    );
  wire('#branding-form', '/admin/workspace', 'PUT', (d, f) => ({...d, provisioned_only: f.provisioned_only.checked}));

  // People
  const table = $('#people-table');
  if (table) {
    const update = () => {
      state.peopleFilter = {
        q: $('#people-search').value,
        role: $('#people-role').value,
        status: $('#people-status').value,
      };
      table.innerHTML = peopleTable(a, state.peopleFilter, escapeHtml);
      bindPeopleRows();
    };
    $('#people-search').oninput = update;
    $('#people-role').onchange = update;
    $('#people-status').onchange = update;
  }
  const roleOptions = () => assignableRoles(a).map(r => [r.id, r.name]);
  const bindPeopleRows = () =>
    $$('[data-edit-user]').forEach(b => (b.onclick = () => editPerson(a.users.find(u => u.id === b.dataset.editUser))));
  bindPeopleRows();
  const editPerson = u => {
    const groupBoxes = a.groups
      .map(
        g =>
          `<label class="admin-check"><input type="checkbox" data-membership="${escapeHtml(g.id)}" data-member="${escapeHtml(u.id)}" ${a.members.some(m => m.group_id === g.id && m.user_id === u.id) ? 'checked' : ''}>${escapeHtml(g.name)}</label>`,
      )
      .join('');
    dialog(
      u.name,
      `<form id="person-form"><div class="form-grid">${field('Display name', 'name', 'text', u.name)}${field('Email', 'email', 'email', u.email, true)}${select('Role', 'role', roleOptions(), u.role)}${checkbox('Account enabled', 'active', u.active)}</div><p class="form-context lifecycle-note">${u.managed ? 'Provisioned account.' : 'SSO managed: saving here makes the account administrator-managed, so sign-in no longer overwrites its role.'} SSO subject: ${escapeHtml(u.oidc_subject || '—')}</p>${formActions('Save changes')}</form>${a.groups.length ? `<section class="detail-section"><div class="section-head compact"><h2>Groups · Changes save immediately</h2></div><div class="check-list">${groupBoxes}</div></section>` : ''}`,
    );
    bindCancel();
    bindForm($('#person-form'), async (data, f) => {
      await api('/admin/users/' + u.id, {method: 'PATCH', body: JSON.stringify({...data, active: f.active.checked})});
      closeDialog();
      await after(`${data.name} saved.`);
    });
    bindMemberships();
  };
  const provision = $('[data-provision]');
  if (provision)
    provision.onclick = () => {
      dialog(
        'Provision a person',
        `<form id="user-create"><div class="form-grid">${field('Immutable SSO subject', 'oidc_subject').replace('class="field ', 'class="field full ')}${field('Display name', 'name')}${field('Email', 'email', 'email', '', true)}${select('Role', 'role', roleOptions(), 'requester')}</div><p class="form-context lifecycle-note">Use the identity provider’s user ID, never an email address or SCIM externalId.</p>${formActions('Provision person')}</form>`,
      );
      bindCancel();
      bindForm($('#user-create'), async data => {
        await api('/admin/users', {method: 'POST', body: JSON.stringify(data)});
        closeDialog();
        await after(`${data.name} provisioned.`);
      });
    };

  // Groups
  const groupSheet = g => {
    const memberIds = new Set(a.members.filter(m => m.group_id === g?.id).map(m => m.user_id));
    dialog(
      g ? g.name : 'Create group',
      `<form id="${g ? 'group-form' : 'group-create'}"><div class="form-grid">${field('Group name', 'name', 'text', g?.name || '').replace('class="field ', 'class="field full ')}${field('Description', 'description', 'text', g?.description || '', true).replace('class="field ', 'class="field full ')}${checkbox('Add newly provisioned users automatically', 'auto_assign', g?.auto_assign)}</div>${formActions(g ? 'Save group' : 'Create group')}</form>${
        g
          ? `<section class="detail-section"><div class="section-head compact"><h2>Members · Changes save immediately</h2><p>${memberIds.size} of ${a.users.length}</p></div><label class="search member-search">${icon('search')}<input id="member-search" type="search" aria-label="Search people" placeholder="Search people"></label><div class="check-list" id="member-list">${a.users
              .map(
                u =>
                  `<label class="admin-check" data-person="${escapeHtml(`${u.name} ${u.email}`.toLowerCase())}"><input type="checkbox" data-membership="${escapeHtml(g.id)}" data-member="${escapeHtml(u.id)}" ${memberIds.has(u.id) ? 'checked' : ''}>${escapeHtml(u.name)}</label>`,
              )
              .join(
                '',
              )}</div><p class="muted-line">Removing a member clears current assignments. A later provider sync may add them again.</p></section>`
          : ''
      }`,
    );
    bindCancel();
    bindForm($(g ? '#group-form' : '#group-create'), async (data, f) => {
      await api(g ? '/admin/groups/' + g.id : '/admin/groups', {
        method: g ? 'PATCH' : 'POST',
        body: JSON.stringify({...data, auto_assign: f.auto_assign.checked}),
      });
      if (!g) closeDialog();
      await after(g ? 'Group saved.' : 'Group created.');
      if (g) groupSheet(state.admin.groups.find(x => x.id === g.id));
    });
    const search = $('#member-search');
    if (search)
      search.oninput = () =>
        $$('#member-list [data-person]').forEach(
          l => (l.hidden = !l.dataset.person.includes(search.value.trim().toLowerCase())),
        );
    bindMemberships();
  };
  const newGroup = $('[data-new-group]');
  if (newGroup) newGroup.onclick = () => groupSheet(null);
  $$('[data-edit-group]').forEach(
    b => (b.onclick = () => groupSheet(a.groups.find(g => g.id === b.dataset.editGroup))),
  );
  const bindMemberships = () =>
    $$('[data-membership]').forEach(
      input =>
        (input.onchange = async () => {
          input.disabled = true;
          try {
            await api(`/admin/groups/${input.dataset.membership}/members/${input.dataset.member}`, {
              method: 'PUT',
              body: JSON.stringify({member: input.checked}),
            });
            await load();
            toast('Group membership saved.');
          } catch (err) {
            input.checked = !input.checked;
            toast(err.message);
          } finally {
            input.disabled = false;
          }
        }),
    );

  // Roles
  const rolesForm = $('#roles-form');
  if (rolesForm) {
    bindForm(rolesForm, async () => {
      const changed = a.roles.filter(r => !r.locked);
      let saved = 0;
      for (const r of changed) {
        const caps = $$(`[data-role="${CSS.escape(r.id)}"]:checked`).map(i => i.dataset.cap);
        const same = caps.length === r.capabilities.length && caps.every(c => r.capabilities.includes(c));
        if (same) continue;
        await api('/admin/roles/' + encodeURIComponent(r.id), {
          method: 'PATCH',
          body: JSON.stringify({capabilities: caps}),
        });
        saved++;
      }
      await after(saved ? `${saved} role${saved === 1 ? '' : 's'} updated.` : 'No changes to save.');
    });
    $$('[data-reset-role]').forEach(b =>
      confirmButton(
        b,
        async () => {
          try {
            await api('/admin/roles/' + encodeURIComponent(b.dataset.resetRole), {method: 'DELETE'});
            await after('Role reset to the defaults in permissions.js.');
          } catch (err) {
            toast(err.message);
          }
        },
        'Reset?',
      ),
    );
    $$('[data-delete-role]').forEach(b =>
      confirmButton(
        b,
        async () => {
          try {
            await api('/admin/roles/' + encodeURIComponent(b.dataset.deleteRole), {method: 'DELETE'});
            await after('Role deleted.');
          } catch (err) {
            toast(err.message);
          }
        },
        'Delete?',
      ),
    );
    $('[data-new-role]').onclick = () => {
      dialog(
        'New role',
        `<form id="role-create"><div class="form-grid">${field('Role name', 'name')}${select('Start from', 'base', [['', 'No permissions'], ...assignableRoles(a).map(r => [r.id, r.name])], 'requester')}${field('Description', 'description', 'text', '', true).replace('class="field ', 'class="field full ')}</div><p class="form-context lifecycle-note">After creating it, choose its permissions in the grid and assign it to people under People.</p>${formActions('Create role')}</form>`,
      );
      bindCancel();
      bindForm($('#role-create'), async data => {
        await api('/admin/roles', {method: 'POST', body: JSON.stringify({...data, base: data.base || undefined})});
        closeDialog();
        await after(`Role ${data.name} created.`);
      });
    };
  }

  // Provisioning tokens
  const key = $('#key-create');
  if (key)
    bindForm(key, async () => {
      const result = await api('/admin/keys', {
        method: 'POST',
        body: JSON.stringify({name: key.elements.name.value, days: Number(key.elements.days.value)}),
      });
      state.newKey = result.secret;
      await load();
      render();
    });
  $$('[data-revoke-key]').forEach(
    b =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api('/admin/keys/' + b.dataset.revokeKey, {method: 'DELETE'});
          state.newKey = null;
          await load();
          render();
          toast('Token revoked.');
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      }),
  );
  const dismiss = $('[data-dismiss-key]');
  if (dismiss)
    dismiss.onclick = () => {
      state.newKey = null;
      render();
    };
}
