// Keyboard shortcuts, the shortcut sheet (?) and the command palette (Ctrl+K / ⌘K).
import {state, $, $$, escape, icon, api, ticketNo, dialog, applyAppearance, appearance, toast} from './ui.js';
import {hooks} from './hooks.js';

const typing = () => {
  const el = document.activeElement;
  return el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);
};
const modalOpen = () => $('#editor')?.open || $('#palette')?.open;
const click = selector => {
  const el = $(selector);
  if (el && !el.disabled) {
    el.click();
    return true;
  }
  return false;
};

const goKeys = {
  d: 'dashboard',
  r: 'orders',
  c: 'calendar',
  n: 'notifications',
  s: 'settings',
  b: 'buildings',
  a: 'assets',
  i: 'inventory',
  p: 'reports',
};
export const shortcuts = [
  [
    'Anywhere',
    [
      ['Ctrl K', 'Command palette: go anywhere, do anything'],
      ['/', 'Find a ticket'],
      ['n', 'New request'],
      ['g then d · r · c · n', 'Go to Today · All requests · Calendar · Notifications'],
      ['g then b · a · i · p · s', 'Go to Buildings · Assets · Inventory · Reports · Settings'],
      ['?', 'This list'],
    ],
  ],
  [
    'Request lists',
    [
      ['j / k', 'Next / previous ticket'],
      ['Enter', 'Open the ticket'],
      ['x', 'Select the ticket (for bulk changes)'],
    ],
  ],
  [
    'A ticket',
    [
      ['t', 'Take it (assign it to yourself)'],
      ['p', 'Mark in progress'],
      ['r', 'Resolve'],
      ['c', 'Write a comment'],
      ['e', 'Edit'],
      ['h', 'Show activity'],
      ['Esc', 'Back to the list'],
    ],
  ],
];

export function showShortcuts() {
  dialog(
    'Keyboard shortcuts',
    `<div class="shortcut-sheet">${shortcuts
      .map(
        ([group, rows]) =>
          `<section><h3>${escape(group)}</h3><dl>${rows
            .map(
              ([keys, what]) =>
                `<div><dt>${keys
                  .split(' ')
                  .map(k =>
                    ['then', '·'].includes(k) || (k === '/' && keys !== '/')
                      ? `<span>${escape(k)}</span>`
                      : `<kbd>${escape(k)}</kbd>`,
                  )
                  .join(' ')}</dt><dd>${escape(what)}</dd></div>`,
            )
            .join('')}</dl></section>`,
      )
      .join('')}<p class="muted-line">Shortcuts are ignored while you type in a field.</p></div>`,
  );
}

// Moves focus through the register's rows.
function moveRow(step) {
  const rows = $$('#order-table tr[data-order]');
  if (!rows.length) return false;
  const at = rows.indexOf(document.activeElement);
  const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + step))];
  next.focus();
  next.scrollIntoView({block: 'nearest'});
  return true;
}

let pendingG = 0;
export function bindShortcuts() {
  // Capture phase: decide before other handlers close popovers, so one Escape does one thing.
  addEventListener(
    'keydown',
    e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        if (!state.me?.user) return;
        e.preventDefault();
        openPalette();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing() || !state.me?.user) return;
      if (e.key === 'Escape') {
        if (!modalOpen() && !state.notifOpen && !$('.rail.menu-open') && state.page === 'ticket') {
          e.preventDefault();
          hooks.leaveTicket();
        }
        return;
      }
      if (modalOpen()) return;
      const key = e.key;
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const page = goKeys[key.toLowerCase()];
        if (page && hooks.navItems().some(([p]) => p === page)) {
          e.preventDefault();
          hooks.go(page);
        }
        return;
      }
      let handled = true;
      if (key === '?') showShortcuts();
      else if (key === 'g') pendingG = Date.now();
      else if (key === 'n') handled = click('[data-create="order"]');
      else if (key === 'j') handled = moveRow(1);
      else if (key === 'k') handled = moveRow(-1);
      else if (key === 'x') {
        const pick = document.activeElement?.closest?.('tr[data-order]')?.querySelector('[data-pick]');
        handled = !!pick;
        pick?.click();
      } else if (state.page === 'ticket') {
        if (key === 't') handled = click('[data-take]');
        else if (key === 'p') handled = click('[data-stamp="In progress"]');
        else if (key === 'r') handled = click('[data-stamp="Completed"]');
        else if (key === 'e') handled = click('#edit-order');
        else if (key === 'h') handled = click('#show-history');
        else if (key === 'c') {
          const box = $('#comment-form textarea');
          handled = !!box;
          box?.focus();
          box?.scrollIntoView({block: 'center'});
        } else handled = false;
      } else handled = false;
      if (handled) e.preventDefault();
    },
    true,
  );
}

// ---- Command palette ----
// Subsequence match: every typed letter in order; earlier, contiguous and word-start matches rank higher.
function score(text, query) {
  const t = text.toLowerCase(),
    q = query.toLowerCase().trim();
  if (!q) return 1;
  let at = -1,
    total = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const next = t.indexOf(ch, at + 1);
    if (next < 0) return 0;
    total += next === at + 1 ? 3 : /\s|·/.test(t[next - 1] || ' ') ? 2 : 1;
    at = next;
  }
  return total + (t.startsWith(q) ? 10 : 0) - at * 0.01;
}
function commands() {
  const list = [];
  const add = (group, label, run, hint = '') => list.push({group, label, run, hint});
  for (const [page, , title] of hooks.navItems()) add('Go to', title, () => hooks.go(page));
  for (const v of state.data?.views || []) add('Views', v.name, () => hooks.openView(v.id));
  if ($('[data-create="order"]') || hooks.canCreate()) add('Do', 'New request', () => hooks.createOrder(), 'n');
  if (state.page === 'ticket') {
    const ticketActions = [
      ['[data-take]', 'Take this ticket', 't'],
      ['[data-stamp="In progress"]', 'Mark in progress', 'p'],
      ['[data-stamp="Completed"]', 'Resolve this ticket', 'r'],
      ['[data-stamp="Open"]', 'Reopen this ticket', ''],
      ['#edit-order', 'Edit this ticket', 'e'],
      ['#show-history', 'Show activity', 'h'],
    ];
    for (const [sel, label, hint] of ticketActions) if ($(sel)) add('This ticket', label, () => click(sel), hint);
    const assign = $('[data-ticket-control="assignee_id"]');
    if (assign)
      for (const opt of assign.options)
        if (opt.value && opt.value !== assign.value)
          add('This ticket', `Assign to ${opt.textContent}`, () => {
            assign.value = opt.value;
            assign.dispatchEvent(new Event('change'));
          });
  }
  if (state.me?.user?.capabilities?.some(c => c.startsWith('admin.')))
    for (const [tab, label] of hooks.settingsTabs())
      add('Settings', label, () => {
        state.settingsTab = tab;
        hooks.go('settings');
      });
  const a = appearance();
  for (const [theme, label] of [
    ['light', 'Light theme'],
    ['dark', 'Dark theme'],
    ['system', 'Match the system theme'],
  ])
    if (a.theme !== theme) add('Appearance', label, () => applyAppearance({theme}));
  add('Appearance', a.contrast === 'more' ? 'Normal contrast' : 'Higher contrast', () =>
    applyAppearance({contrast: a.contrast === 'more' ? 'normal' : 'more'}),
  );
  add('Help', 'Keyboard shortcuts', showShortcuts, '?');
  return list;
}

let paletteSearch = 0;
export function openPalette() {
  let box = $('#palette');
  if (!box) {
    box = document.createElement('dialog');
    box.id = 'palette';
    box.setAttribute('aria-label', 'Command palette');
    box.innerHTML = `<div class="palette-input">${icon('search')}<input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Go to, do, or find a ticket…" autocomplete="off" spellcheck="false"></div><ul id="palette-list" role="listbox" aria-label="Commands"></ul><p class="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close</p>`;
    document.body.append(box);
    box.addEventListener('click', e => {
      if (e.target === box) box.close();
    });
  }
  const input = $('#palette-input'),
    listEl = $('#palette-list');
  const all = commands();
  let shown = [],
    active = 0,
    tickets = [];
  const draw = () => {
    const q = input.value;
    const number = q.trim().match(/^(?:wo-?)?0*(\d{1,9})$/i);
    const found = [
      ...(number
        ? [{group: 'Tickets', label: `Open ${ticketNo(number[1])}`, run: () => hooks.openTicket(ticketNo(number[1]))}]
        : []),
      ...tickets,
      ...all
        .map(c => ({...c, s: score(`${c.group} ${c.label}`, q)}))
        .filter(c => c.s > 0)
        .sort((x, y) => y.s - x.s),
      ...(q.trim().length > 1 && !number
        ? [
            {
              group: 'Tickets',
              label: `Search all requests for “${q.trim()}”`,
              run: () => hooks.searchRequests(q.trim()),
            },
          ]
        : []),
    ].slice(0, 12);
    shown = found;
    active = Math.min(active, Math.max(0, shown.length - 1));
    listEl.innerHTML =
      shown
        .map(
          (c, i) =>
            `<li role="option" id="palette-${i}" aria-selected="${i === active}" data-index="${i}" class="${i === active ? 'active' : ''}"><span class="palette-group">${escape(c.group)}</span><span class="palette-label">${escape(c.label)}</span>${c.hint ? `<kbd>${escape(c.hint)}</kbd>` : ''}</li>`,
        )
        .join('') || '<li class="palette-empty">Nothing matches. Try other words.</li>';
    input.setAttribute('aria-activedescendant', shown.length ? `palette-${active}` : '');
    $$('#palette-list [data-index]').forEach(li => {
      li.onmousemove = () => {
        if (active !== Number(li.dataset.index)) {
          active = Number(li.dataset.index);
          draw();
        }
      };
      li.onclick = () => run(Number(li.dataset.index));
    });
  };
  const run = i => {
    const c = shown[i];
    if (!c) return;
    box.close();
    try {
      c.run();
    } catch (err) {
      toast(err.message);
    }
  };
  input.oninput = () => {
    active = 0;
    tickets = [];
    draw();
    const q = input.value.trim();
    const ticket = ++paletteSearch;
    if (q.length < 2 || /^(?:wo-?)?\d+$/i.test(q) || !state.data?.modules) return;
    setTimeout(async () => {
      if (ticket !== paletteSearch) return;
      try {
        const res = await api('/orders?limit=5&q=' + encodeURIComponent(q));
        if (ticket !== paletteSearch) return;
        tickets = res.orders.map(o => ({
          group: 'Tickets',
          label: `${ticketNo(o.number)} · ${o.title}`,
          run: () => hooks.openTicket(o.id),
        }));
        draw();
      } catch {
        /* keep the command list */
      }
    }, 180);
  };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      draw();
      $(`#palette-${active}`)?.scrollIntoView({block: 'nearest'});
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(active);
    }
  };
  input.value = '';
  draw();
  if (!box.open) box.showModal();
  input.focus();
}
