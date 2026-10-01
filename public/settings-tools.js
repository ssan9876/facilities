// Settings → Checklists & replies (templates applied by category, shared saved replies) and
// Settings → Due dates (due-date targets by priority, and escalation).
import {
  $,
  $$,
  escape as e,
  icon,
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

const priorities = ['Urgent', 'High', 'Normal', 'Low'];

export function toolsUI(state) {
  if (state.settingsTab === 'due') {
    const s = state.slaSettings;
    if (!s) return '<section class="settings-sheet" data-tools-loading><div class="empty">Loading…</div></section>';
    return `<form id="sla-form" class="settings-sheet"><div class="sheet-heading"><h2>Due dates and escalation</h2><p>When a request form does not ask for a due date, the request is due this many days after it is opened. Open tickets are flagged to their assignee on the day they are due, and escalated to the people notified of new requests (and followers) once they are overdue.</p></div><div class="form-grid sla-grid">${priorities
      .map(p => field(`${p} (days)`, p, 'number', String(s.days[p]), false, 'min="0" max="365"'))
      .join(
        '',
      )}</div><label class="setting-row"><span><strong>Escalate due and overdue tickets</strong><small>Each ticket is flagged once when due and once when overdue; a new due date starts watching again.</small></span><span class="toggle"><input type="checkbox" role="switch" name="enabled" aria-label="Escalate due and overdue tickets" ${s.enabled ? 'checked' : ''}><span class="toggle-track" aria-hidden="true"></span></span></label><div class="settings-footer"><p>0 days means due the same day.</p><div class="form-error" role="alert"></div><button type="submit" class="primary">Save due dates</button></div></form>`;
  }
  const templates = state.checklistTemplates,
    replies = state.replies;
  if (!templates || !replies)
    return '<section class="settings-sheet" data-tools-loading><div class="empty">Loading…</div></section>';
  const categoryName = id =>
    Object.values(state.data.forms || {})
      .flatMap(f => f.categories || [])
      .find(c => c.id === id)?.name;
  const appliesTo = t =>
    t.category_id
      ? `Category: ${categoryName(t.category_id) || 'removed'}`
      : t.request_type
        ? `All ${requestTypes[t.request_type]?.label.toLowerCase()} requests without a category template`
        : 'Added by hand or from a maintenance plan';
  const shared = replies.filter(r => !r.user_id);
  return `<section class="settings-sheet wide-sheet"><div class="sheet-heading sheet-toolbar"><div><h2>Checklist templates</h2><p>New tickets get the template for their category (or their request type). Technicians can also add one from the ticket, and maintenance plans can name one.</p></div><button class="primary" data-new-template>${icon('plus')}New template</button></div>${
    templates.length
      ? `<div class="table-wrap"><table><thead><tr><th>Template</th><th>Applies to</th><th>Steps</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${templates
          .map(
            t =>
              `<tr><td><strong>${e(t.name)}</strong></td><td>${e(appliesTo(t))}</td><td>${t.items.length}</td><td class="row-actions"><button class="quiet-button" data-edit-template="${e(t.id)}" aria-label="Edit ${e(t.name)}">${icon('edit')}Edit</button><button class="quiet-button" data-delete-template="${e(t.id)}">Delete</button></td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<div class="empty">No templates yet.</div>'
  }</section><section class="settings-sheet wide-sheet"><div class="sheet-heading sheet-toolbar"><div><h2>Shared replies</h2><p>Everyone can insert these into comments. People can also keep their own replies from the comment box.</p></div><button class="primary" data-new-reply>${icon('plus')}New reply</button></div>${
    shared.length
      ? `<div class="table-wrap"><table><thead><tr><th>Reply</th><th>Text</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${shared
          .map(
            r =>
              `<tr><td><strong>${e(r.title)}</strong></td><td class="reply-text">${e(r.body)}</td><td class="row-actions"><button class="quiet-button" data-edit-reply="${e(r.id)}" aria-label="Edit ${e(r.title)}">${icon('edit')}Edit</button><button class="quiet-button" data-delete-reply="${e(r.id)}">Delete</button></td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<div class="empty">No shared replies yet.</div>'
  }</section>`;
}

export function bindTools(state, render) {
  if ($('[data-tools-loading]') && !state.toolsLoading) {
    state.toolsLoading = true;
    (state.settingsTab === 'due'
      ? api('/admin/sla').then(s => (state.slaSettings = s))
      : Promise.all([api('/checklist-templates'), api('/replies')]).then(([t, r]) => {
          state.checklistTemplates = t;
          state.replies = r;
        })
    )
      .catch(err => toast(err.message))
      .finally(() => {
        state.toolsLoading = false;
        render();
      });
  }
  const sla = $('#sla-form');
  if (sla)
    bindForm(sla, async (data, f) => {
      state.slaSettings = await api('/admin/sla', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: f.enabled.checked,
          days: Object.fromEntries(priorities.map(p => [p, Number(data[p])])),
        }),
      });
      toast('Due dates saved.');
      render();
    });
  const reloadTools = async () => {
    [state.checklistTemplates, state.replies] = await Promise.all([api('/checklist-templates'), api('/replies')]);
    render();
  };
  const templateSheet = t => {
    const categories = Object.entries(state.data.forms || {}).flatMap(([type, f]) =>
      (f.categories || []).map(c => [c.id, `${requestTypes[type]?.label || type} · ${c.name}`]),
    );
    dialog(
      t ? t.name : 'New checklist template',
      `<form id="template-form"><div class="form-grid">${field('Template name', 'name', 'text', t?.name || '').replace('class="field ', 'class="field full ')}${select('Apply to category', 'category_id', [['', 'No category'], ...categories], t?.category_id || '', false)}${select('Or to every request of type', 'request_type', [['', 'No type'], ...Object.entries(requestTypes).map(([k, v]) => [k, v.label])], t?.request_type || '', false)}${field('Steps (one per line)', 'items', 'textarea', (t?.items || []).join('\n'))}</div>${formActions(t ? 'Save template' : 'Create template')}</form>`,
    );
    bindCancel();
    bindForm($('#template-form'), async data => {
      const body = {
        name: data.name,
        category_id: data.category_id || null,
        request_type: data.category_id ? null : data.request_type || null,
        items: data.items
          .split('\n')
          .map(x => x.trim())
          .filter(Boolean),
      };
      await api(t ? '/admin/checklist-templates/' + t.id : '/admin/checklist-templates', {
        method: t ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      closeDialog();
      await reloadTools();
      toast(t ? 'Template saved.' : 'Template created.');
    });
  };
  const newTemplate = $('[data-new-template]');
  if (newTemplate) newTemplate.onclick = () => templateSheet(null);
  $$('[data-edit-template]').forEach(
    b => (b.onclick = () => templateSheet(state.checklistTemplates.find(t => t.id === b.dataset.editTemplate))),
  );
  $$('[data-delete-template]').forEach(b =>
    confirmButton(
      b,
      async () => {
        await api('/admin/checklist-templates/' + b.dataset.deleteTemplate, {method: 'DELETE'});
        await reloadTools();
      },
      'Delete?',
    ),
  );
  const replySheet = r => {
    dialog(
      r ? r.title : 'New shared reply',
      `<form id="shared-reply-form"><div class="form-grid">${field('Reply name', 'title', 'text', r?.title || '').replace('class="field ', 'class="field full ')}${field('Text', 'body', 'textarea', r?.body || '')}</div>${formActions(r ? 'Save reply' : 'Create reply')}</form>`,
    );
    bindCancel();
    bindForm($('#shared-reply-form'), async data => {
      state.replies = await api(r ? '/replies/' + r.id : '/replies', {
        method: r ? 'PATCH' : 'POST',
        body: JSON.stringify({...data, shared: true}),
      });
      closeDialog();
      render();
      toast(r ? 'Reply saved.' : 'Reply created.');
    });
  };
  const newReply = $('[data-new-reply]');
  if (newReply) newReply.onclick = () => replySheet(null);
  $$('[data-edit-reply]').forEach(
    b => (b.onclick = () => replySheet(state.replies.find(r => r.id === b.dataset.editReply))),
  );
  $$('[data-delete-reply]').forEach(b =>
    confirmButton(
      b,
      async () => {
        state.replies = await api('/replies/' + b.dataset.deleteReply, {method: 'DELETE'});
        render();
      },
      'Delete?',
    ),
  );
}
