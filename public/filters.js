// Register filters for working through large numbers of tickets. Choices are kept per page
// (and remembered in this browser) and sent to the server, which does the filtering.
import {state, escape, icon, can} from './ui.js';
import {requestTypes} from './request-settings.js';

const storeKey = 'facilities.filters';
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(storeKey) || '{}');
  } catch {
    return {};
  }
};
const persist = () => {
  try {
    localStorage.setItem(storeKey, JSON.stringify(state.advByPage || {}));
  } catch {
    /* private window: filters still work for this visit */
  }
};
export const sorts = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['due', 'Due soonest'],
  ['due_desc', 'Due latest'],
  ['priority', 'Most urgent first'],
  ['updated', 'Recently updated'],
  ['number', 'Ticket number'],
];
const priorities = [
  ['', 'Any priority'],
  ['Urgent', 'Urgent'],
  ['High,Urgent', 'High or urgent'],
  ['High', 'High'],
  ['Normal', 'Normal'],
  ['Low', 'Low'],
];
export function filtersFor(page) {
  state.advByPage ||= load();
  return (state.advByPage[page] ||= {});
}
export function setFilter(page, key, value) {
  const f = filtersFor(page);
  if (value === '' || value === undefined || value === null) delete f[key];
  else f[key] = value;
  // A category or answer only makes sense within its request type.
  if (key === 'type') {
    delete f.category;
    for (const k of Object.keys(f)) if (k.startsWith('f_')) delete f[k];
  }
  persist();
}
export function clearFilters(page) {
  state.advByPage[page] = {};
  persist();
}
export const pageLimit = page => Number(filtersFor(page).limit || 50);

// Adds the active filters to the register's query.
export function applyFilters(params, page) {
  for (const [key, value] of Object.entries(filtersFor(page)))
    if (key !== 'limit' && value !== '' && !(key === 'type' && params.has('type'))) params.set(key, value);
}

const typeOf = (page, fixedType) => fixedType || filtersFor(page).type || '';
function categoriesFor(type) {
  const forms = state.data.forms || {};
  const types = type ? [type] : Object.keys(forms).filter(t => state.data.modules[t]);
  return types.flatMap(t =>
    (forms[t]?.categories || []).map(c => [c.id, types.length > 1 ? `${requestTypes[t].label} · ${c.name}` : c.name]),
  );
}
const answerFields = type =>
  type ? (state.data.forms?.[type]?.fields || []).filter(f => ['select', 'yesno'].includes(f.kind)) : [];

const sel = (key, label, options, value) =>
  `<label class="filter-field">${label}<select data-adv="${key}">${options.map(([v, t]) => `<option value="${escape(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${escape(t)}</option>`).join('')}</select></label>`;

export function filterBar(page, fixedType) {
  const f = filtersFor(page);
  const type = typeOf(page, fixedType);
  const enabled = Object.keys(requestTypes).filter(t => state.data.modules[t]);
  const people = (state.data.users || []).filter(u => u.assignable);
  const categories = categoriesFor(type);
  const fields = [
    fixedType || enabled.length < 2
      ? ''
      : sel('type', 'Type', [['', 'All types'], ...enabled.map(t => [t, requestTypes[t].label])], f.type),
    categories.length
      ? sel('category', 'Category', [['', 'Any category'], ['none', 'No category'], ...categories], f.category)
      : '',
    sel('priority', 'Priority', priorities, f.priority),
    sel('building', 'Building', [['', 'Any building'], ...state.data.buildings.map(b => [b.id, b.name])], f.building),
    can('requests.view_all')
      ? sel(
          'assignee',
          'Assigned to',
          [['', 'Anyone'], ['me', 'Me'], ['none', 'Unassigned'], ...people.map(u => [u.id, u.name])],
          f.assignee,
        )
      : '',
    `<label class="filter-field">Due from<input type="date" data-adv="due_from" value="${escape(f.due_from || '')}"></label>`,
    `<label class="filter-field">Due to<input type="date" data-adv="due_to" value="${escape(f.due_to || '')}"></label>`,
    ...answerFields(type).map(q =>
      sel(
        'f_' + q.id,
        escape(q.label),
        [['', 'Any answer'], ...(q.kind === 'yesno' ? ['Yes', 'No'] : q.options).map(o => [o, o])],
        f['f_' + q.id],
      ),
    ),
    sel('sort', 'Sort', sorts, f.sort || 'newest'),
    sel(
      'limit',
      'Per page',
      [
        ['50', '50'],
        ['100', '100'],
        ['200', '200'],
      ],
      f.limit || '50',
    ),
  ].join('');
  const labelFor = (key, value) => {
    if (key === 'type') return `Type: ${requestTypes[value]?.label || value}`;
    if (key === 'category')
      return `Category: ${value === 'none' ? 'None' : categories.find(c => c[0] === value)?.[1] || 'Unknown'}`;
    if (key === 'priority') return `Priority: ${priorities.find(p => p[0] === value)?.[1] || value}`;
    if (key === 'building') return `Building: ${state.data.buildings.find(b => b.id === value)?.name || 'Unknown'}`;
    if (key === 'assignee')
      return `Assigned: ${value === 'me' ? 'Me' : value === 'none' ? 'Nobody' : people.find(u => u.id === value)?.name || 'Someone'}`;
    if (key === 'due_from') return `Due from ${value}`;
    if (key === 'due_to') return `Due to ${value}`;
    if (key.startsWith('f_'))
      return `${answerFields(type).find(q => 'f_' + q.id === key)?.label || 'Answer'}: ${value}`;
    return null;
  };
  const chips = Object.entries(f)
    .filter(([k]) => !['sort', 'limit'].includes(k))
    .map(([k, v]) => [k, labelFor(k, v)])
    .filter(([, label]) => label);
  const open = state.filtersOpen || chips.length > 0;
  return `<div class="filter-bar ${open ? 'open' : ''}"><button type="button" class="quiet-button filter-toggle" data-filters-toggle aria-expanded="${open}">${icon('settings')}Filters${chips.length ? ` <span class="filter-count">${chips.length}</span>` : ''}</button>${
    chips.length
      ? `<div class="filter-chips">${chips.map(([k, label]) => `<button type="button" class="filter-chip" data-clear-adv="${escape(k)}" aria-label="Remove filter ${escape(label)}">${escape(label)} ${icon('close')}</button>`).join('')}<button type="button" class="quiet-button" data-clear-filters>Clear all</button></div>`
      : ''
  }${open ? `<div class="filter-fields">${fields}</div>` : ''}</div>`;
}
export function bindFilterBar(page, onChange) {
  const toggle = document.querySelector('[data-filters-toggle]');
  if (!toggle) return;
  toggle.onclick = () => {
    state.filtersOpen = toggle.getAttribute('aria-expanded') !== 'true';
    onChange();
  };
  document.querySelectorAll('[data-adv]').forEach(input => {
    input.onchange = () => {
      setFilter(page, input.dataset.adv, input.value);
      state.filtersOpen = true;
      onChange();
    };
  });
  document.querySelectorAll('[data-clear-adv]').forEach(b => {
    b.onclick = () => {
      setFilter(page, b.dataset.clearAdv, '');
      onChange();
    };
  });
  const clear = document.querySelector('[data-clear-filters]');
  if (clear)
    clear.onclick = () => {
      clearFilters(page);
      onChange();
    };
}
