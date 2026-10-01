// Settings → Access as code (the access file's status, reload, export and template) and
// Settings → Auto-assignment (rules that assign new tickets to a group, role or person).
import {
  $,
  $$,
  escape as e,
  icon,
  tag,
  api,
  toast,
  dialog,
  closeDialog,
  field,
  select,
  bindForm,
  formActions,
  bindCancel,
  confirmButton,
} from './ui.js';
import {requestTypes} from './request-settings.js';

const when = iso => (iso ? new Date(iso).toLocaleString() : '—');
const codeBadge = '<span class="source-badge">Access file</span>';

export function accessUI(state) {
  const info = state.accessInfo;
  if (!info || !state.admin)
    return `<section class="settings-sheet" data-access-loading><div class="empty">${state.accessError ? e(state.accessError) : 'Loading access settings…'}</div></section>`;
  if (state.settingsTab === 'assignment') return assignmentUI(state, info);
  const s = info.status || {};
  const state_ =
    s.present === false
      ? `<p>No file at <code>${e(info.file)}</code>. Everything is managed here in Settings.</p>`
      : s.ok === false
        ? `<p class="form-error">The file was rejected ${e(when(s.failed_at))}. ${e(s.error || '')} The last good configuration is still active.</p>${s.problems?.length ? `<ul class="problem-list">${s.problems.map(p => `<li>${e(p)}</li>`).join('')}</ul>` : ''}`
        : s.applied_at
          ? `<p>Applied ${e(when(s.applied_at))}: ${s.summary.roles} roles, ${s.summary.groups} groups, ${s.summary.rules} assignment rules.</p>`
          : `<p>The file has not been applied yet.</p>`;
  return `<section class="settings-sheet"><div class="sheet-heading"><h2>Access as code</h2><p>Keep roles, groups, the SSO sign-in role mapping and auto-assignment rules in one YAML file, version it with the rest of your configuration, and apply it here or on restart. Everything the file defines is read-only in Settings; anything it leaves out stays editable.</p></div><div class="setting-row"><span><strong>Access file</strong><small><code>${e(info.file)}</code></small></span>${s.present === false ? tag('on-hold', 'No file yet') : s.ok === false ? tag('urgent', 'Rejected') : s.applied_at ? tag('completed', 'Applied') : ''}</div><div class="sheet-heading access-status">${state_}</div><div class="settings-footer access-actions"><a class="secondary" href="/api/admin/access/template.yaml" download>${icon('download')}Download template</a><a class="secondary" href="/api/admin/access/export.yaml" download>${icon('download')}Export current setup</a><button type="button" class="primary" data-access-reload>Reload from file</button></div></section><section class="settings-sheet"><div class="sheet-heading"><h2>How to use it</h2><ol class="steps"><li>Download the template (every option is explained) or export what you have set up so far.</li><li>Edit it and save it as <code>${e(info.file)}</code> on the server. In the standard install that is <code>/opt/facilities/config/access.yaml</code>.</li><li>Press <strong>Reload from file</strong>. The whole file is checked first; if anything is wrong nothing changes and each problem is listed here.</li></ol></div></section>`;
}

function describeRule(state, r) {
  const parts = [];
  if (r.request_type) parts.push(requestTypes[r.request_type]?.label || r.request_type);
  if (r.category_id) {
    const c = Object.values(state.data.forms || {})
      .flatMap(f => f.categories || [])
      .find(x => x.id === r.category_id);
    parts.push(c ? c.name : 'a category');
  }
  if (r.buildings.length)
    parts.push(r.buildings.map(b => state.data.buildings.find(x => x.id === b)?.name || b).join(', '));
  return parts.length ? parts.join(' · ') : 'Every new ticket';
}
function target(state, r) {
  const a = state.admin;
  if (r.target_kind === 'group') return `Group: ${a.groups.find(g => g.id === r.target_id)?.name || r.target_id}`;
  if (r.target_kind === 'role') return `Role: ${a.roles.find(x => x.id === r.target_id)?.name || r.target_id}`;
  return a.users.find(u => u.id === r.target_id)?.name || 'A person';
}
function assignmentUI(state, info) {
  const rows = info.rules
    .map(
      r =>
        `<tr><td><strong>${e(r.name)}</strong>${r.source === 'code' ? ` ${codeBadge}` : ''}</td><td>${e(describeRule(state, r))}</td><td>${e(target(state, r))}</td><td>${r.strategy === 'least_busy' ? 'Least busy' : 'Take turns'}</td><td>${r.active ? tag('completed', 'On') : tag('archived', 'Off')}</td><td class="row-actions">${r.source === 'code' ? '' : `<button class="quiet-button" data-edit-rule="${e(r.id)}" aria-label="Edit ${e(r.name)}">${icon('edit')}Edit</button><button class="quiet-button" data-delete-rule="${e(r.id)}">Delete</button>`}</td></tr>`,
    )
    .join('');
  return `<section class="settings-sheet wide-sheet"><div class="sheet-heading sheet-toolbar"><div><h2>Auto-assignment</h2><p>New tickets that nobody assigned yet go to someone in the matching rule's group or role, or to one person. The first matching rule wins; only people who can be assigned that ticket (their role's scope included) are picked.</p></div><button class="primary" data-new-rule>${icon('plus')}New rule</button></div>${info.rules.length ? `<div class="table-wrap"><table><thead><tr><th>Rule</th><th>Matches</th><th>Assigns to</th><th>Picks</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No rules yet. New tickets stay unassigned until someone assigns them.</div>'}</section>`;
}

export function bindAccess(state, render) {
  const load = async () => {
    const [info, admin] = await Promise.all([api('/admin/access'), state.admin ? state.admin : api('/admin')]);
    state.accessInfo = info;
    state.admin = admin;
    state.accessError = '';
  };
  if ($('[data-access-loading]') && !state.accessLoading) {
    state.accessLoading = true;
    load()
      .catch(err => (state.accessError = err.message))
      .finally(() => {
        state.accessLoading = false;
        render();
      });
  }
  const reload = $('[data-access-reload]');
  if (reload)
    reload.onclick = async () => {
      reload.disabled = true;
      try {
        state.accessInfo = {...state.accessInfo, ...(await api('/admin/access/reload', {method: 'POST'}))};
        state.admin = await api('/admin');
        toast('Access file applied.');
      } catch (err) {
        state.accessInfo = await api('/admin/access');
        toast(err.message);
      }
      render();
    };
  const ruleSheet = rule => {
    const a = state.admin;
    const categories = Object.entries(state.data.forms || {}).flatMap(([type, f]) =>
      (f.categories || []).map(c => [c.id, `${requestTypes[type]?.label || type} · ${c.name}`]),
    );
    const kind = rule?.target_kind || 'group';
    const targets = {
      group: a.groups.map(g => [g.id, g.name]),
      role: a.roles.filter(r => !r.locked).map(r => [r.id, r.name]),
      user: a.users.filter(u => u.active).map(u => [u.id, u.name]),
    };
    const chosen = new Set(rule?.buildings || []);
    dialog(
      rule ? rule.name : 'New assignment rule',
      `<form id="rule-form"><div class="form-grid">${field('Rule name', 'name', 'text', rule?.name || '').replace('class="field ', 'class="field full ')}${select(
        'Request type',
        'request_type',
        [['', 'Any type'], ...Object.entries(requestTypes).map(([k, t]) => [k, t.label])],
        rule?.request_type || '',
        false,
      )}${select('Category', 'category_id', [['', 'Any category'], ...categories], rule?.category_id || '', false)}<fieldset class="field full check-group"><legend>Buildings (none means every building)</legend>${state.data.buildings
        .filter(b => !b.archived_at)
        .map(
          b =>
            `<label class="field-check inline"><input type="checkbox" name="building" value="${e(b.id)}" ${chosen.has(b.id) ? 'checked' : ''}>${e(b.name)}</label>`,
        )
        .join('')}</fieldset>${select(
        'Assign to a',
        'target_kind',
        [
          ['group', 'Group'],
          ['role', 'Role'],
          ['user', 'Person'],
        ],
        kind,
      )}<div id="rule-target">${select('Who', 'target_id', targets[kind], rule?.target_id || '')}</div>${select(
        'How to pick',
        'strategy',
        [
          ['least_busy', 'Least busy (fewest open tickets)'],
          ['round_robin', 'Take turns'],
        ],
        rule?.strategy || 'least_busy',
      )}</div>${formActions(rule ? 'Save rule' : 'Create rule')}</form>`,
    );
    bindCancel();
    const form = $('#rule-form');
    form.elements.target_kind.onchange = () => {
      $('#rule-target').innerHTML = select('Who', 'target_id', targets[form.elements.target_kind.value], '');
    };
    bindForm(form, async data => {
      const body = {
        name: data.name,
        request_type: data.request_type || null,
        category_id: data.category_id || null,
        buildings: $$('#rule-form [name=building]:checked').map(i => i.value),
        target_kind: data.target_kind,
        target_id: data.target_id,
        strategy: data.strategy,
      };
      const result = await api(rule ? '/admin/assignment-rules/' + rule.id : '/admin/assignment-rules', {
        method: rule ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      state.accessInfo.rules = result.rules;
      closeDialog();
      toast(rule ? 'Rule saved.' : 'Rule created.');
      render();
    });
  };
  const add = $('[data-new-rule]');
  if (add) add.onclick = () => ruleSheet(null);
  $$('[data-edit-rule]').forEach(
    b => (b.onclick = () => ruleSheet(state.accessInfo.rules.find(r => r.id === b.dataset.editRule))),
  );
  $$('[data-delete-rule]').forEach(b =>
    confirmButton(
      b,
      async () => {
        try {
          state.accessInfo.rules = (
            await api('/admin/assignment-rules/' + b.dataset.deleteRule, {method: 'DELETE'})
          ).rules;
          toast('Rule deleted.');
          render();
        } catch (err) {
          toast(err.message);
        }
      },
      'Delete?',
    ),
  );
}
