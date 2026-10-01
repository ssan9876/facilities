// Location and timing fields shared by request creation and editing.
import {state, $, escape, today, fmt, api, field, select, activeBuildings, activeAssets} from './ui.js';

export function locationFields(building = '', asset = '', withAsset = true, assetRequired = false) {
  return (
    select(
      'Building',
      'building_id',
      [['', 'Choose building'], ...activeBuildings(building).map(b => [b.id, b.name])],
      building,
    ) +
    (withAsset
      ? select(
          assetRequired ? 'Asset' : 'Asset (optional)',
          'asset_id',
          [
            ['', assetRequired ? 'Choose asset' : 'No asset'],
            ...(building ? activeAssets(building, asset).map(a => [a.id, a.name]) : []),
          ],
          asset,
          assetRequired,
        )
      : '')
  );
}

export function bindLocation(onChange, root = $('#editor')) {
  const building = root.querySelector('[name=building_id]'),
    asset = root.querySelector('[name=asset_id]');
  if (building)
    building.addEventListener('change', () => {
      if (asset)
        asset.innerHTML = [['', 'No asset'], ...activeAssets(building.value).map(a => [a.id, a.name])]
          .map(([v, t]) => `<option value="${escape(v)}">${escape(t)}</option>`)
          .join('');
      onChange?.();
    });
}
export function requestTiming(type, order = {}) {
  // New requests may leave the due date blank: the server sets it from the priority's due-date target.
  if (type !== 'schedule')
    return order.due_date
      ? field('Due date', 'due_date', 'date', order.due_date)
      : field('Due date (optional: blank uses the priority’s target)', 'due_date', 'date', '', true);
  const spaces = state.data.spaces.filter(s => !s.archived_at || s.id === order.space_id);
  return `<p class="form-context">Event times · ${escape(state.me.timezone)}</p><div class="form-grid">${field('Starts', 'starts_at', 'datetime-local', order.starts_at || today() + 'T09:00')}${field('Ends', 'ends_at', 'datetime-local', order.ends_at || today() + 'T10:00')}${spaces.length ? select('Space (optional)', 'space_id', [['', 'No space reservation'], ...spaces.map(s => [s.id, s.name + (s.requires_approval ? ' · needs approval' : '')])], order.space_id || '') : ''}<div class="availability" id="availability" aria-live="polite"></div></div>`;
}
// Space options follow the chosen building, and the selected day's bookings are shown before submitting.
export function bindTiming(excludeId, root = $('#editor')) {
  const building = root.querySelector('[name=building_id]'),
    space = root.querySelector('[name=space_id]'),
    starts = root.querySelector('[name=starts_at]');
  if (!space) return;
  const filter = () => {
    const current = space.value;
    space.innerHTML = [
      ['', 'No space reservation'],
      ...state.data.spaces
        .filter(s => s.building_id === building.value && (!s.archived_at || s.id === current))
        .map(s => [s.id, s.name + (s.requires_approval ? ' · needs approval' : '')]),
    ]
      .map(([v, t]) => `<option value="${escape(v)}" ${v === current ? 'selected' : ''}>${escape(t)}</option>`)
      .join('');
  };
  const show = async () => {
    const box = root.querySelector('#availability');
    if (!box) return;
    if (!space.value || !starts.value) {
      box.textContent = '';
      return;
    }
    try {
      const rows = (
        await api(`/spaces/${encodeURIComponent(space.value)}/bookings?date=${starts.value.slice(0, 10)}`)
      ).filter(r => r.id !== excludeId);
      box.innerHTML = rows.length
        ? `<span>Already booked ${escape(fmt(starts.value.slice(0, 10)))}:</span> ${rows.map(r => `${escape(r.starts_at.slice(11))}–${escape(r.ends_at.slice(11))}${r.title ? ' ' + escape(r.title) : ''}${r.reservation_status === 'pending' ? ' (awaiting approval)' : ''}`).join('; ')}`
        : '<span>Free all day on the selected date.</span>';
    } catch (e) {
      box.textContent = e.message;
    }
  };
  filter();
  building.addEventListener('change', () => {
    filter();
    show();
  });
  space.onchange = show;
  starts.addEventListener('change', show);
  show();
}
