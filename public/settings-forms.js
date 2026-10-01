// Settings → Request forms: what each request type asks for.
import {
  $,
  $$,
  escape,
  icon,
  tag,
  api,
  toast,
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
import {requestTypes} from './request-settings.js';

const kinds = [
  ['text', 'Short text'],
  ['textarea', 'Long text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['select', 'Dropdown'],
  ['yesno', 'Yes / no'],
  ['checkbox', 'Checkbox (confirmation)'],
];
const builtins = [
  [
    'category',
    'Category',
    'Which category the request belongs to. Shown only when the type has categories.',
    ['required', 'optional', 'hidden'],
  ],
  ['asset', 'Asset', 'The equipment the request is about.', ['required', 'optional', 'hidden']],
  ['description', 'Details', 'A free-text description of the problem or request.', ['required', 'optional', 'hidden']],
  ['photos', 'Photos or files', 'Attachments added while creating the request.', ['required', 'optional', 'hidden']],
  ['priority', 'Priority', 'Hidden priority defaults to Normal; staff can still change it.', ['optional', 'hidden']],
  ['due_date', 'Due date', 'Hidden due dates default to the day the request is made.', ['optional', 'hidden']],
];
const modeLabel = {required: 'Required', optional: 'Asked, optional', hidden: 'Not asked'};

export function formsUI(state) {
  const all = state.formsAdmin;
  if (!all)
    return '<section class="settings-sheet" data-forms-loading><div class="empty">Loading request forms…</div></section>';
  const types = Object.keys(requestTypes).filter(t => state.data.modules[t]);
  if (!types.length)
    return '<section class="settings-sheet"><div class="empty">Enable a request type under Features first.</div></section>';
  const type = types.includes(state.formsType) ? state.formsType : types[0];
  const form = all[type];
  const cats = form.categories;
  const rows = builtins
    .filter(([key]) => !(key === 'due_date' && type === 'schedule'))
    .map(
      ([key, label, help, options]) =>
        `<label class="setting-row"><span><strong>${label}</strong><small>${help}</small></span><select name="${key}" aria-label="${label}">${options.map(o => `<option value="${o}" ${form.rules[key] === o ? 'selected' : ''}>${modeLabel[o]}</option>`).join('')}</select></label>`,
    )
    .join('');
  const catRows = cats.length
    ? `<div class="table-wrap"><table><thead><tr><th>Category</th><th>Description</th><th>Own questions</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${cats
        .map(
          c =>
            `<tr><td><strong>${escape(c.name)}</strong>${c.archived_at ? ' ' + tag('archived', 'Archived') : ''}</td><td>${escape(c.description) || '—'}</td><td>${form.fields.filter(f => f.category_id === c.id && !f.archived_at).length}</td><td class="row-actions"><button class="quiet-button" data-edit-category="${escape(c.id)}" aria-label="Edit category ${escape(c.name)}">${icon('edit')}Edit</button></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="empty">No categories yet. Add some so people can say what kind of request this is.</div>';
  const fieldRows = form.fields.length
    ? `<div class="table-wrap"><table><thead><tr><th>Question</th><th>Answer type</th><th>Asked for</th><th>Required</th><th>Order</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${form.fields
        .map(
          (f, i) =>
            `<tr><td><strong>${escape(f.label)}</strong>${f.archived_at ? ' ' + tag('archived', 'Archived') : ''}${f.help ? `<div class="order-sub">${escape(f.help)}</div>` : ''}</td><td>${kinds.find(k => k[0] === f.kind)?.[1] || f.kind}${f.kind === 'select' ? `<div class="order-sub">${escape(f.options.join(', '))}</div>` : ''}</td><td>${f.category_id ? escape(cats.find(c => c.id === f.category_id)?.name || 'One category') : 'Every request'}</td><td>${f.required ? 'Required' : 'Optional'}</td><td class="order-cell"><button class="quiet-button" data-move-field="${escape(f.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${escape(f.label)} up">↑</button><button class="quiet-button" data-move-field="${escape(f.id)}" data-dir="1" ${i === form.fields.length - 1 ? 'disabled' : ''} aria-label="Move ${escape(f.label)} down">↓</button></td><td class="row-actions"><button class="quiet-button" data-edit-field="${escape(f.id)}" aria-label="Edit question ${escape(f.label)}">${icon('edit')}Edit</button></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="empty">No extra questions. Add one to collect what your team needs, such as a room number or a yes/no safety check.</div>';
  return `<section class="settings-sheet wide-sheet forms-sheet"><div class="sheet-heading"><h2>Request forms</h2><p>Choose what a new ticket asks for. Title and building are always required. Categories and dropdown or yes/no answers can be filtered in the request registers.</p></div><div class="form-type-tabs tabs" role="tablist">${types.map(t => `<button type="button" role="tab" aria-selected="${t === type}" data-form-type="${t}" class="${t === type ? 'selected' : ''}">${requestTypes[t].label}</button>`).join('')}</div><form id="rules-form" data-type="${type}"><div class="sheet-heading"><h3>Built-in fields</h3></div>${rows}<div class="settings-footer"><p>Rules apply to new ${requestTypes[type].label.toLowerCase()} requests. Existing tickets keep their information.</p><div class="form-error" role="alert"></div><button type="submit" class="primary">Save form rules</button></div></form><div class="sheet-heading sheet-toolbar"><div><h3>Categories</h3><p>For example Plumbing, HVAC or Electrical. Archive a category to stop offering it without losing its history.</p></div><button type="button" class="secondary" data-new-category>${icon('plus')}Add category</button></div>${catRows}<div class="sheet-heading sheet-toolbar"><div><h3>Questions</h3><p>Extra questions on the new-ticket form. Ask them on every ${requestTypes[type].label.toLowerCase()} request or only for one category.</p></div><button type="button" class="secondary" data-new-field>${icon('plus')}Add question</button></div>${fieldRows}</section>`;
}

export function bindForms(state, render, refresh) {
  const load = async () => {
    state.formsAdmin = await api('/forms?all=1');
  };
  if ($('[data-forms-loading]') && !state.formsLoading) {
    state.formsLoading = true;
    load()
      .catch(e => toast(e.message))
      .finally(() => {
        state.formsLoading = false;
        render();
      });
  }
  const rulesForm = $('#rules-form');
  if (!rulesForm) return;
  const type = rulesForm.dataset.type;
  const form = state.formsAdmin[type];
  const after = async message => {
    await load();
    await refresh();
    toast(message);
  };
  $$('[data-form-type]').forEach(
    b =>
      (b.onclick = () => {
        state.formsType = b.dataset.formType;
        render();
      }),
  );
  bindForm(rulesForm, async data => {
    await api(`/admin/forms/${type}/rules`, {method: 'PUT', body: JSON.stringify(data)});
    await after('Form rules saved.');
  });
  const categorySheet = c => {
    dialog(
      c ? `Edit category · ${c.name}` : `New ${requestTypes[type].label.toLowerCase()} category`,
      `<form id="category-form"><div class="form-grid">${field('Category name', 'name', 'text', c?.name || '').replace('class="field ', 'class="field full ')}${field('Description', 'description', 'text', c?.description || '', true).replace('class="field ', 'class="field full ')}</div>${formActions(c ? 'Save category' : 'Add category', c ? `<button type="button" class="secondary" id="archive-category">${c.archived_at ? 'Restore' : 'Archive'}</button><button type="button" class="secondary danger" id="delete-category">Delete</button>` : '')}</form>`,
    );
    bindCancel();
    bindForm($('#category-form'), async data => {
      await api(c ? `/admin/categories/${c.id}` : `/admin/forms/${type}/categories`, {
        method: c ? 'PATCH' : 'POST',
        body: JSON.stringify(data),
      });
      closeDialog();
      await after(c ? 'Category saved.' : 'Category added.');
    });
    if (!c) return;
    $('#archive-category').onclick = async () => {
      try {
        await api(`/admin/categories/${c.id}`, {method: 'PATCH', body: JSON.stringify({archived: !c.archived_at})});
        closeDialog();
        await after(c.archived_at ? 'Category restored.' : 'Category archived.');
      } catch (e) {
        $('#category-form .form-error').textContent = e.message;
      }
    };
    confirmButton(
      $('#delete-category'),
      async () => {
        try {
          await api(`/admin/categories/${c.id}`, {method: 'DELETE'});
          closeDialog();
          await after('Category deleted.');
        } catch (e) {
          $('#category-form .form-error').textContent = e.message;
        }
      },
      'Delete permanently?',
    );
  };
  $('[data-new-category]').onclick = () => categorySheet(null);
  $$('[data-edit-category]').forEach(
    b => (b.onclick = () => categorySheet(form.categories.find(c => c.id === b.dataset.editCategory))),
  );

  const fieldSheet = f => {
    dialog(
      f ? `Edit question · ${f.label}` : `New ${requestTypes[type].label.toLowerCase()} question`,
      `<form id="field-form"><div class="form-grid">${field('Question', 'label', 'text', f?.label || '').replace('class="field ', 'class="field full ')}${select('Answer type', 'kind', kinds, f?.kind || 'text')}${select('Ask for', 'category_id', [['', 'Every request'], ...form.categories.filter(c => !c.archived_at || c.id === f?.category_id).map(c => [c.id, 'Only ' + c.name])], f?.category_id || '', false)}<label class="field full" id="options-field">Dropdown options (one per line)<textarea name="options" maxlength="5000">${escape((f?.options || []).join('\n'))}</textarea></label>${field('Help text (optional)', 'help', 'text', f?.help || '', true).replace('class="field ', 'class="field full ')}${checkbox('People must answer this question', 'required', f?.required)}</div>${formActions(f ? 'Save question' : 'Add question', f ? `<button type="button" class="secondary" id="archive-field">${f.archived_at ? 'Restore' : 'Archive'}</button><button type="button" class="secondary danger" id="delete-field">Delete</button>` : '')}</form>`,
    );
    bindCancel();
    const kind = $('#field-form [name=kind]'),
      options = $('#options-field');
    const sync = () => (options.hidden = kind.value !== 'select');
    kind.onchange = sync;
    sync();
    bindForm($('#field-form'), async (data, el) => {
      const body = {...data, required: el.required.checked, options: data.options ? data.options.split('\n') : []};
      await api(f ? `/admin/fields/${f.id}` : `/admin/forms/${type}/fields`, {
        method: f ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      closeDialog();
      await after(f ? 'Question saved.' : 'Question added.');
    });
    if (!f) return;
    $('#archive-field').onclick = async () => {
      try {
        await api(`/admin/fields/${f.id}`, {method: 'PATCH', body: JSON.stringify({archived: !f.archived_at})});
        closeDialog();
        await after(f.archived_at ? 'Question restored.' : 'Question archived.');
      } catch (e) {
        $('#field-form .form-error').textContent = e.message;
      }
    };
    confirmButton(
      $('#delete-field'),
      async () => {
        try {
          await api(`/admin/fields/${f.id}`, {method: 'DELETE'});
          closeDialog();
          await after('Question deleted.');
        } catch (e) {
          $('#field-form .form-error').textContent = e.message;
        }
      },
      'Delete permanently?',
    );
  };
  $('[data-new-field]').onclick = () => fieldSheet(null);
  $$('[data-edit-field]').forEach(
    b => (b.onclick = () => fieldSheet(form.fields.find(f => f.id === b.dataset.editField))),
  );
  // Reordering swaps the sort positions of two neighbouring questions.
  $$('[data-move-field]').forEach(
    b =>
      (b.onclick = async () => {
        const list = form.fields;
        const i = list.findIndex(f => f.id === b.dataset.moveField),
          j = i + Number(b.dataset.dir);
        if (j < 0 || j >= list.length) return;
        b.disabled = true;
        try {
          await Promise.all([
            api(`/admin/fields/${list[i].id}`, {method: 'PATCH', body: JSON.stringify({sort: j})}),
            api(`/admin/fields/${list[j].id}`, {method: 'PATCH', body: JSON.stringify({sort: i})}),
          ]);
          for (const [n, f] of list.entries())
            if (n !== i && n !== j && f.sort !== n)
              await api(`/admin/fields/${f.id}`, {method: 'PATCH', body: JSON.stringify({sort: n})});
          await load();
          await refresh();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
