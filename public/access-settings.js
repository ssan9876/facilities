// Settings → Access as code: edit, upload, check and apply the access document, restore earlier versions,
// and reload the server file. Settings → Auto-assignment: rules that assign new tickets.
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

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sourceLabel = {editor: 'edited in Settings', upload: 'uploaded', file: 'from the server file'};
const problemList = problems =>
  problems?.length ? `<ul class="problem-list">${problems.map(p => `<li>${e(p)}</li>`).join('')}</ul>` : '';

export function accessUI(state) {
  const info = state.accessInfo;
  if (!info || !state.admin || !state.accessDoc)
    return `<section class="settings-sheet" data-access-loading><div class="empty">${state.accessError ? e(state.accessError) : 'Loading access settings…'}</div></section>`;
  if (state.settingsTab === 'assignment') return assignmentUI(state, info);
  const s = info.status || {},
    doc = state.accessDoc;
  const draft = state.accessDraft ?? doc.text;
  const dirty = draft !== doc.text;
  const active = s.applied_at
    ? `Active version ${e(sourceLabel[s.source] || 'applied')} by ${e(s.applied_by || 'someone')}, ${e(when(s.applied_at))}: ${count(s.summary.roles, 'role')}, ${count(s.summary.groups, 'group')}, ${count(s.summary.rules, 'assignment rule')}.`
    : 'Nothing applied yet. Roles, groups and rules are managed in the other Settings tabs.';
  const fileNote =
    s.present === false
      ? `No server file at <code>${e(info.file)}</code>; that's fine, the document here is enough.`
      : s.ok === false && s.rejected_source === 'file'
        ? `<span class="form-error">The server file was rejected ${e(when(s.rejected_at))}; the active version stayed in place.</span>${problemList(s.problems)}`
        : `Server file <code>${e(info.file)}</code> is applied at startup when it changes.`;
  const check = state.accessCheck;
  const result = !check
    ? ''
    : check.ok
      ? `<div class="check-result ok" role="status"><strong>Looks good.</strong> Defines ${check.roles.length} role${check.roles.length === 1 ? '' : 's'}${check.roles.length ? ` (${e(check.roles.join(', '))})` : ''}, ${check.groups.length} group${check.groups.length === 1 ? '' : 's'}${check.groups.length ? ` (${e(check.groups.join(', '))})` : ''}, ${check.rules.length} assignment rule${check.rules.length === 1 ? '' : 's'}${check.sso ? ' and the SSO role map' : ''}.${check.applied ? ' Applied.' : ''}</div>`
      : `<div class="check-result bad" role="alert"><strong>${e(check.error)}</strong>${problemList(check.problems)}</div>`;
  const history = doc.versions.length
    ? `<ol class="version-list">${doc.versions
        .map(
          (v, i) =>
            `<li><span><strong>${e(when(v.created_at))}</strong><small>${e(v.actor_name)} · ${e(sourceLabel[v.source] || v.source)} · ${count(v.summary.roles, 'role')}, ${count(v.summary.groups, 'group')}, ${count(v.summary.rules, 'rule')}${i === 0 ? ' · active' : ''}</small></span>${i === 0 ? '' : `<button type="button" class="quiet-button" data-load-version="${e(v.id)}">Load into editor</button>`}</li>`,
        )
        .join('')}</ol>`
    : '<p class="muted-line">No versions yet.</p>';
  return `<section class="settings-sheet wide-sheet"><div class="sheet-heading"><h2>Access as code</h2><p>Roles, groups, the SSO sign-in role map and auto-assignment rules in one YAML document. Edit it here, upload a file, or start from the template. <strong>Check</strong> validates everything; <strong>Apply</strong> makes it active. Anything it defines becomes read-only in the other tabs; anything it leaves out stays editable there.</p><p class="access-active">${active}</p></div><div class="editor-toolbar" role="toolbar" aria-label="Access document"><label class="secondary upload-button">${icon('upload')}Upload file<input type="file" id="access-upload" accept=".yaml,.yml,text/yaml,text/plain" hidden></label><button type="button" class="secondary" data-access-insert="template">Start from template</button><button type="button" class="secondary" data-access-insert="export">Start from current setup</button><button type="button" class="secondary" data-access-download>${icon('download')}Download</button>${dirty ? '<span class="dirty-note">Unsaved changes</span>' : ''}</div><label class="visually-hidden" for="access-editor">Access document (YAML)</label><textarea id="access-editor" class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" placeholder="version: 1&#10;roles:&#10;  …">${e(draft)}</textarea>${result}<div class="settings-footer access-actions"><span class="muted-line">Up to ${Math.round(doc.max / 1000)} KB. Tab indents two spaces.</span>${dirty ? '<button type="button" class="quiet-button" data-access-revert>Discard changes</button>' : ''}<button type="button" class="secondary" data-access-check>Check</button><button type="button" class="primary" data-access-apply>Apply</button></div></section><section class="settings-sheet"><div class="sheet-heading"><h2>History</h2><p>Every applied version is kept (the latest 50). Load one into the editor, check it, then apply it to roll back.</p>${history}</div></section><section class="settings-sheet"><div class="sheet-heading"><h2>Server file</h2><p>${fileNote}</p></div><div class="settings-footer access-actions"><a class="secondary" href="/api/admin/access/template.yaml" download>${icon('download')}Download template</a><button type="button" class="secondary" data-access-reload>Apply the server file now</button></div></section>`;
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
    const [info, admin, doc] = await Promise.all([
      api('/admin/access'),
      state.admin ? state.admin : api('/admin'),
      api('/admin/access/document'),
    ]);
    state.accessInfo = info;
    state.admin = admin;
    state.accessDoc = doc;
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
  const refreshAll = async () => {
    [state.accessInfo, state.admin, state.accessDoc] = await Promise.all([
      api('/admin/access'),
      api('/admin'),
      api('/admin/access/document'),
    ]);
  };
  const reload = $('[data-access-reload]');
  if (reload)
    reload.onclick = async () => {
      reload.disabled = true;
      try {
        await api('/admin/access/reload', {method: 'POST'});
        toast('Server file applied.');
      } catch (err) {
        toast(err.message);
      }
      await refreshAll();
      state.accessDraft = undefined;
      render();
    };
  // The editor: keeps its draft across redraws, indents with Tab, and checks or applies the whole document.
  const editor = $('#access-editor');
  if (editor) {
    const send = async (url, method, body) => {
      const res = await fetch('/api' + url, {
        method,
        headers: {'Content-Type': 'application/json', 'x-csrf-token': state.me?.csrf || ''},
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({error: 'The server did not answer. Try again.'}));
      return {ok: res.ok, status: res.status, data};
    };
    const setDraft = text => {
      state.accessDraft = text;
      state.accessCheck = null;
      render();
      $('#access-editor')?.focus();
    };
    editor.oninput = () => {
      const was = (state.accessDraft ?? state.accessDoc.text) !== state.accessDoc.text;
      state.accessDraft = editor.value;
      if (state.accessCheck) state.accessCheck = null;
      // Redraw only when the "unsaved changes" state flips, so typing is never interrupted.
      if (was !== (editor.value !== state.accessDoc.text)) {
        const at = [editor.selectionStart, editor.selectionEnd];
        render();
        const again = $('#access-editor');
        again.focus();
        again.setSelectionRange(...at);
      }
    };
    editor.onkeydown = ev => {
      if (ev.key !== 'Tab' || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      ev.preventDefault();
      editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    };
    const fetchText = async url => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load it. Try again.');
      return res.text();
    };
    const replaceDraft = async text => {
      const current = state.accessDraft ?? state.accessDoc.text;
      if (current.trim() && current !== state.accessDoc.text && !confirm('Replace your unsaved changes in the editor?'))
        return;
      setDraft(text);
    };
    $$('[data-access-insert]').forEach(
      b =>
        (b.onclick = async () => {
          try {
            await replaceDraft(
              await fetchText(
                b.dataset.accessInsert === 'template'
                  ? '/api/admin/access/template.yaml'
                  : '/api/admin/access/export.yaml',
              ),
            );
          } catch (err) {
            toast(err.message);
          }
        }),
    );
    $('#access-upload').onchange = async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      if (file.size > state.accessDoc.max)
        return toast(`That file is larger than ${Math.round(state.accessDoc.max / 1000)} KB.`);
      state.accessUpload = true;
      await replaceDraft(await file.text());
      toast(`${file.name} loaded. Check it, then apply.`);
    };
    $('[data-access-download]').onclick = () => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([editor.value], {type: 'application/yaml'}));
      link.download = 'access.yaml';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    const revert = $('[data-access-revert]');
    if (revert) revert.onclick = () => setDraft(state.accessDoc.text);
    $('[data-access-check]').onclick = async () => {
      const {data} = await send('/admin/access/check', 'POST', {text: editor.value});
      state.accessCheck = data.ok ? data : {ok: false, error: data.error, problems: data.problems};
      render();
    };
    $('[data-access-apply]').onclick = async ev => {
      ev.target.disabled = true;
      const text = editor.value;
      const {ok, data} = await send('/admin/access/document', 'PUT', {
        text,
        source: state.accessUpload ? 'upload' : 'editor',
      });
      if (!ok) {
        state.accessCheck = {ok: false, error: data.error, problems: data.problems};
        render();
        return;
      }
      state.accessUpload = false;
      const summary = await send('/admin/access/check', 'POST', {text});
      await refreshAll();
      state.accessDraft = undefined;
      state.accessCheck = summary.ok ? {...summary.data, applied: true} : null;
      toast('Access document applied.');
      render();
    };
    $$('[data-load-version]').forEach(
      b =>
        (b.onclick = async () => {
          try {
            const v = await api('/admin/access/versions/' + b.dataset.loadVersion);
            await replaceDraft(v.text);
            toast(`Version from ${when(v.created_at)} loaded. Check it, then apply to restore it.`);
          } catch (err) {
            toast(err.message);
          }
        }),
    );
  }
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
