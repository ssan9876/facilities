import {
  state,
  $,
  $$,
  escape,
  icon,
  can,
  fmt,
  today,
  tag,
  api,
  toast,
  heading,
  dialog,
  closeDialog,
  field,
  select,
  checkbox,
  activeBuildings,
  bindForm,
  formActions,
  bindCancel,
  confirmButton,
} from './ui.js';
import {hooks} from './hooks.js';
import {locationFields, bindLocation} from './forms.js';

const categories = ['HVAC', 'Electrical', 'Plumbing', 'Safety', 'Equipment', 'Other'];
const archivedTag = r => (r.archived_at ? ' ' + tag('archived', 'Archived') : '');
const visible = rows => rows.filter(r => state.showArchived || !r.archived_at);
const editButton = (kind, id, label) =>
  can('records.manage')
    ? `<button class="quiet-button" data-edit="${kind}" data-id="${escape(id)}" aria-label="${escape(label)}">${icon('edit')}Edit</button>`
    : '';
const archivedToggle = rows =>
  rows.some(r => r.archived_at)
    ? `<label class="field-check inline"><input type="checkbox" id="show-archived" ${state.showArchived ? 'checked' : ''}>Show archived</label>`
    : '';
const exportLink = (file, label) =>
  can('reports.export')
    ? `<a class="secondary link-button" href="/api/reports/${file}" download>${icon('download')}${label}</a>`
    : '';

export function recordsPage(page) {
  const d = state.data;
  if (page === 'buildings') {
    const spaces = d.modules.schedule
      ? `<div class="section-head"><div><h2>Spaces</h2><p>Rooms and areas that schedule requests can reserve.</p></div>${can('records.manage') ? `<button class="secondary" data-create="space">${icon('plus')}Add space</button>` : ''}</div><div class="work-panel"><div class="table-wrap"><table><thead><tr><th>Space</th><th>Building</th><th>Capacity</th><th>Reservations</th>${can('records.manage') ? '<th><span class="visually-hidden">Actions</span></th>' : ''}</tr></thead><tbody>${visible(
          d.spaces,
        )
          .map(
            s =>
              `<tr><td><strong>${escape(s.name)}</strong>${archivedTag(s)}</td><td>${escape(d.buildings.find(b => b.id === s.building_id)?.name)}</td><td>${s.capacity ?? '—'}</td><td>${s.requires_approval ? 'Manager approval' : 'Confirmed automatically'}</td>${can('records.manage') ? `<td class="row-actions">${editButton('space', s.id, 'Edit ' + s.name)}</td>` : ''}</tr>`,
          )
          .join(
            '',
          )}</tbody></table></div>${visible(d.spaces).length ? '' : '<div class="empty">No spaces yet. Add rooms people can reserve.</div>'}</div>`
      : '';
    return (
      heading(
        'Buildings',
        'The places your team looks after.',
        can('records.manage') ? 'building' : null,
        'Add building',
        archivedToggle([...d.buildings, ...d.spaces]),
      ) +
      `<div class="work-panel"><div class="table-wrap"><table><thead><tr><th>Building</th><th>Address</th><th>Assets</th><th>Active requests</th>${can('records.manage') ? '<th><span class="visually-hidden">Actions</span></th>' : ''}</tr></thead><tbody>${visible(
        d.buildings,
      )
        .map(
          b =>
            `<tr><td><strong>${escape(b.name)}</strong>${archivedTag(b)}</td><td>${escape(b.address) || '—'}</td><td>${d.assets.filter(a => a.building_id === b.id && !a.archived_at).length}</td><td>${d.summary.activeByBuilding[b.id] || 0}</td>${can('records.manage') ? `<td class="row-actions">${b.archived_at ? '' : `<a class="quiet-button" href="/labels?building=${encodeURIComponent(b.id)}" target="_blank" rel="noopener" aria-label="Print QR labels for ${escape(b.name)}">${icon('qr')}QR labels</a>`}${editButton('building', b.id, 'Edit ' + b.name)}</td>` : ''}</tr>`,
        )
        .join(
          '',
        )}</tbody></table></div>${d.buildings.length ? '' : '<div class="empty">No buildings yet. Add your first building.</div>'}</div>` +
      spaces
    );
  }
  if (page === 'assets')
    return (
      heading(
        'Assets',
        'Equipment, locations, and the work that keeps them reliable.',
        can('records.manage') ? 'asset' : null,
        'Add asset',
        archivedToggle(d.assets) + exportLink('assets.csv', 'Export'),
      ) +
      `<div class="work-panel"><div class="table-wrap"><table><thead><tr><th>Asset</th><th>Category</th><th>Building</th><th>Serial / identifier</th>${can('records.manage') ? '<th><span class="visually-hidden">Actions</span></th>' : ''}</tr></thead><tbody>${visible(
        d.assets,
      )
        .map(
          a =>
            `<tr><td><strong>${escape(a.name)}</strong>${archivedTag(a)}</td><td>${escape(a.category)}</td><td>${escape(d.buildings.find(b => b.id === a.building_id)?.name)}</td><td>${escape(a.serial) || '—'}</td>${can('records.manage') ? `<td class="row-actions">${editButton('asset', a.id, 'Edit ' + a.name)}</td>` : ''}</tr>`,
        )
        .join(
          '',
        )}</tbody></table></div>${d.assets.length ? '' : '<div class="empty">No assets yet. Add a building, then register its equipment.</div>'}</div>`
    );
  return (
    heading(
      'Preventive maintenance',
      'Recurring work, planned before it becomes urgent.',
      can('maintenance.manage') ? 'maintenance' : null,
      'New maintenance plan',
      exportLink('maintenance.csv', 'Export'),
    ) +
    `<div class="section-head"><p>Due plans generate requests automatically every hour in production. Paused plans are skipped.</p>${can('maintenance.manage') ? '<button id="generate" class="secondary">Generate due requests</button>' : ''}</div><div class="work-panel"><div class="table-wrap"><table><thead><tr><th>Maintenance plan</th><th>Building / asset</th><th>Recurrence</th><th>Next due</th>${can('maintenance.manage') ? '<th><span class="visually-hidden">Actions</span></th>' : ''}</tr></thead><tbody>${d.maintenance.map(p => `<tr><td><strong>${escape(p.title)}</strong>${Number(p.active) ? '' : ' ' + tag('on-hold', 'Paused')}</td><td>${escape(p.building)}<div class="order-sub">${escape(p.asset) || 'Building maintenance'}</div></td><td>Every ${p.interval_days} days</td><td>${fmt(p.next_due)}</td>${can('maintenance.manage') ? `<td class="row-actions">${editButton('maintenance', p.id, 'Edit ' + p.title)}</td>` : ''}</tr>`).join('')}</tbody></table></div>${d.maintenance.length ? '' : '<div class="empty">No maintenance plans yet. Create a recurring inspection or service task.</div>'}</div>`
  );
}

export function bindRecords() {
  $$('[data-edit]').forEach(b => (b.onclick = () => recordEditor(b.dataset.edit, b.dataset.id)));
  const toggle = $('#show-archived');
  if (toggle)
    toggle.onchange = () => {
      state.showArchived = toggle.checked;
      hooks.render();
    };
  const generate = $('#generate');
  if (generate)
    generate.onclick = async () => {
      generate.disabled = true;
      try {
        const r = await api('/maintenance/generate', {method: 'POST'});
        await hooks.refresh();
        toast(`${r.generated} maintenance request${r.generated === 1 ? '' : 's'} generated.`);
      } catch (e) {
        toast(e.message);
        generate.disabled = false;
      }
    };
}

const kinds = {
  building: {
    title: 'building',
    endpoint: '/buildings',
    list: () => state.data.buildings,
    name: r => r.name,
    fields: r => field('Building name', 'name', 'text', r.name) + field('Address', 'address', 'text', r.address, true),
  },
  asset: {
    title: 'asset',
    endpoint: '/assets',
    list: () => state.data.assets,
    name: r => r.name,
    fields: r =>
      field('Asset name', 'name', 'text', r.name) +
      select(
        'Category',
        'category',
        categories.map(x => [x, x]),
        r.category,
      ) +
      locationFields(r.building_id, '', false) +
      field('Serial / identifier (optional)', 'serial', 'text', r.serial, true),
  },
  maintenance: {
    title: 'maintenance plan',
    endpoint: '/maintenance',
    list: () => state.data.maintenance,
    name: r => r.title,
    fields: r =>
      field('Maintenance task', 'title', 'text', r.title) +
      field('Repeat every (days)', 'interval_days', 'number', r.interval_days ?? 30, false, 'min="1" max="3650"') +
      locationFields(r.building_id, r.asset_id || '') +
      field(r.id ? 'Next due date' : 'First due date', 'next_due', 'date', r.next_due || today()) +
      checkbox('Plan is active (generates requests)', 'active', r.id ? Number(r.active) : true),
  },
  space: {
    title: 'space',
    endpoint: '/spaces',
    list: () => state.data.spaces,
    name: r => r.name,
    fields: r =>
      field('Space name', 'name', 'text', r.name) +
      select(
        'Building',
        'building_id',
        [['', 'Choose building'], ...activeBuildings(r.building_id).map(b => [b.id, b.name])],
        r.building_id || '',
      ) +
      field('Capacity (optional)', 'capacity', 'number', r.capacity ?? '', true, 'min="1"') +
      checkbox('Reservations need manager approval', 'requires_approval', Number(r.requires_approval)),
  },
};

export function recordEditor(kind, id) {
  const k = kinds[kind];
  if (kind !== 'building' && !activeBuildings().length) {
    toast('Add a building first.');
    state.page = 'buildings';
    hooks.render();
    return;
  }
  const record = id ? k.list().find(r => r.id === id) : {};
  if (id && !record) return;
  const lifecycle = id
    ? `${kind === 'maintenance' ? '' : `<button type="button" class="secondary" id="archive-record">${record.archived_at ? 'Restore' : 'Archive'}</button>`}<button type="button" class="secondary danger" id="delete-record">Delete</button>`
    : '';
  dialog(
    `${id ? 'Edit' : 'Add'} ${k.title}`,
    `<form id="record-form"><div class="form-grid">${k.fields(record)}</div>${id ? '<p class="form-context lifecycle-note">Delete removes a record entered by mistake. Records with history can only be archived; archived records stay in reports and existing requests.</p>' : ''}${formActions(id ? 'Save changes' : `Save ${kind === 'maintenance' ? 'plan' : k.title}`, lifecycle)}</form>`,
  );
  bindCancel();
  bindLocation();
  const path = id ? `${k.endpoint}/${encodeURIComponent(id)}` : k.endpoint;
  bindForm($('#record-form'), async (data, form) => {
    for (const box of form.querySelectorAll('input[type=checkbox]')) data[box.name] = box.checked;
    if (kind === 'maintenance') data.interval_days = Number(data.interval_days);
    await api(path, {method: id ? 'PATCH' : 'POST', body: JSON.stringify(data)});
    closeDialog();
    await hooks.refresh();
    toast(id ? 'Changes saved.' : 'Saved to your workspace.');
  });
  if (!id) return;
  const archive = $('#archive-record');
  if (archive)
    archive.onclick = async () => {
      archive.disabled = true;
      try {
        await api(path, {method: 'PATCH', body: JSON.stringify({archived: !record.archived_at})});
        closeDialog();
        await hooks.refresh();
        toast(record.archived_at ? 'Restored.' : 'Archived. It no longer appears in new forms.');
      } catch (e) {
        $('#record-form .form-error').textContent = e.message;
        archive.disabled = false;
      }
    };
  confirmButton(
    $('#delete-record'),
    async () => {
      try {
        await api(path, {method: 'DELETE'});
        closeDialog();
        await hooks.refresh();
        toast(`${k.name(record)} deleted.`);
      } catch (e) {
        $('#record-form .form-error').textContent = e.message;
      }
    },
    'Delete permanently?',
  );
}
