import {
  state,
  $,
  $$,
  escape,
  icon,
  manage,
  money,
  tag,
  api,
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
  confirmButton,
} from './ui.js';
import {hooks} from './hooks.js';

const low = p => !p.archived_at && p.quantity <= p.min_quantity;
export function inventoryPage() {
  const parts = (state.data.parts || []).filter(p => state.showArchived || !p.archived_at);
  const lowCount = parts.filter(low).length;
  const extra = `${(state.data.parts || []).some(p => p.archived_at) ? `<label class="field-check inline"><input type="checkbox" id="show-archived-parts" ${state.showArchived ? 'checked' : ''}>Show archived</label>` : ''}<a class="secondary link-button" href="/api/reports/parts.csv" download>${icon('download')}Export</a>`;
  return (
    heading(
      'Inventory',
      'Spare parts and supplies, deducted as technicians record them on requests.',
      manage() ? 'part' : null,
      'Add part',
      extra,
    ) +
    (lowCount
      ? `<div class="notice">${lowCount} part${lowCount === 1 ? ' is' : 's are'} at or below the reorder level.</div>`
      : '') +
    `<div class="work-panel"><div class="table-wrap"><table><thead><tr><th>Part</th><th>Stored at</th><th>On hand</th><th>Reorder level</th><th>Unit cost</th>${manage() ? '<th><span class="visually-hidden">Actions</span></th>' : ''}</tr></thead><tbody>${parts.map(p => `<tr><td><strong>${escape(p.name)}</strong>${p.archived_at ? ' ' + tag('archived', 'Archived') : ''}<div class="order-sub">${escape(p.sku) || 'No SKU'}</div></td><td>${escape(p.building) || 'Any building'}<div class="order-sub">${escape(p.location) || '—'}</div></td><td>${p.quantity}${low(p) ? ' ' + tag('urgent', 'Low stock') : ''}</td><td>${p.min_quantity}</td><td>${money(p.unit_cost_cents)}</td>${manage() ? `<td class="row-actions"><button class="quiet-button" data-edit-part="${escape(p.id)}" aria-label="Edit ${escape(p.name)}">${icon('edit')}Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div>${parts.length ? '' : '<div class="empty">No parts yet. Add the supplies your technicians use most.</div>'}</div>`
  );
}
export function bindInventory() {
  $$('[data-edit-part]').forEach(b => (b.onclick = () => partEditor(b.dataset.editPart)));
  const toggle = $('#show-archived-parts');
  if (toggle)
    toggle.onchange = () => {
      state.showArchived = toggle.checked;
      hooks.render();
    };
}
export function partEditor(id) {
  const p = id ? state.data.parts.find(x => x.id === id) : {};
  if (id && !p) return;
  const fields =
    field('Part name', 'name', 'text', p.name) +
    field('SKU / part number (optional)', 'sku', 'text', p.sku, true) +
    select(
      'Building (optional)',
      'building_id',
      [['', 'Any building'], ...activeBuildings(p.building_id).map(b => [b.id, b.name])],
      p.building_id || '',
      false,
    ) +
    field('Storage location (optional)', 'location', 'text', p.location, true) +
    (id ? '' : field('Quantity on hand', 'quantity', 'number', '0', false, 'min="0"')) +
    field('Reorder level', 'min_quantity', 'number', p.min_quantity ?? 0, false, 'min="0"') +
    field(
      'Unit cost (optional)',
      'unit_cost',
      'text',
      p.unit_cost_cents == null ? '' : (p.unit_cost_cents / 100).toFixed(2),
      true,
      'inputmode="decimal" placeholder="0.00"',
    );
  const adjust = id
    ? `<form id="adjust-form" class="detail-section"><div class="section-head compact"><h2>Adjust stock</h2><p>${p.quantity} on hand</p></div><div class="form-grid">${field('Change (use a minus sign to remove)', 'delta', 'number', '', false, 'step="1"')}${field('Reason', 'reason', 'text', '', true, 'placeholder="Restock, count correction…"')}</div><div class="form-error" role="alert"></div><div class="editor-actions"><button class="secondary" type="submit">Apply adjustment</button></div></form>`
    : '';
  const lifecycle = id
    ? `<button type="button" class="secondary" id="archive-part">${p.archived_at ? 'Restore' : 'Archive'}</button><button type="button" class="secondary danger" id="delete-part">Delete</button>`
    : '';
  dialog(
    id ? 'Edit part' : 'Add part',
    `<form id="part-editor"><div class="form-grid">${fields}</div>${formActions(id ? 'Save changes' : 'Save part', lifecycle)}</form>${adjust}`,
  );
  bindCancel();
  const path = id ? `/parts/${encodeURIComponent(id)}` : '/parts';
  bindForm($('#part-editor'), async data => {
    await api(path, {method: id ? 'PATCH' : 'POST', body: JSON.stringify(data)});
    closeDialog();
    await hooks.refresh();
    toast(id ? 'Part saved.' : 'Part added.');
  });
  if (!id) return;
  bindForm($('#adjust-form'), async data => {
    const r = await api(`${path}/adjust`, {
      method: 'POST',
      body: JSON.stringify({delta: Number(data.delta), reason: data.reason}),
    });
    await hooks.refresh();
    partEditor(id);
    toast(`Stock updated: ${r.quantity} on hand.`);
  });
  $('#archive-part').onclick = async () => {
    try {
      await api(path, {method: 'PATCH', body: JSON.stringify({archived: !p.archived_at})});
      closeDialog();
      await hooks.refresh();
      toast(p.archived_at ? 'Part restored.' : 'Part archived.');
    } catch (e) {
      $('#part-editor .form-error').textContent = e.message;
    }
  };
  confirmButton(
    $('#delete-part'),
    async () => {
      try {
        await api(path, {method: 'DELETE'});
        closeDialog();
        await hooks.refresh();
        toast('Part deleted.');
      } catch (e) {
        $('#part-editor .form-error').textContent = e.message;
      }
    },
    'Delete permanently?',
  );
}
