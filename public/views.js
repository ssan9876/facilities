// Saved views and shareable register links. A register's tab, search and filters are mirrored into the
// address (/?view=orders&tab=Open&priority=Urgent…) so a link opens the same list; a view pins that
// state to the sidebar for one person.
import {
  state,
  $,
  $$,
  escape,
  icon,
  api,
  toast,
  dialog,
  closeDialog,
  field,
  bindForm,
  formActions,
  bindCancel,
} from './ui.js';
import {filtersFor} from './filters.js';

export const registerPages = ['orders', 'maintenanceRequests', 'scheduleRequests', 'technologyRequests'];
const reserved = ['view', 'tab', 'q'];

const snapshot = page => ({filter: state.filter, search: state.search, adv: {...filtersFor(page)}});
function restore(page, view) {
  state.page = page;
  state.filter = view.filter || 'All';
  state.search = view.search || '';
  state.advByPage ||= {};
  state.advByPage[page] = {...(view.adv || {})};
  try {
    localStorage.setItem('facilities.filters', JSON.stringify(state.advByPage));
  } catch {
    /* this visit only */
  }
}

export function urlFor(page, view = snapshot(page)) {
  const p = new URLSearchParams({view: page});
  if (view.filter && view.filter !== 'All') p.set('tab', view.filter);
  if (view.search) p.set('q', view.search);
  for (const [k, v] of Object.entries(view.adv || {})) if (v !== '' && !reserved.includes(k)) p.set(k, v);
  return '/?' + p;
}
// Keeps the address in step with the register on screen (replaceState: no extra history entries).
export function syncUrl() {
  if (!registerPages.includes(state.page) || location.pathname !== '/') return;
  const next = urlFor(state.page);
  if (location.pathname + location.search !== next) history.replaceState(history.state, '', next);
}
// Opening a shared link: the address decides the page and its filters.
export function readUrl() {
  if (location.pathname !== '/') return false;
  const p = new URLSearchParams(location.search);
  const page = p.get('view');
  if (!registerPages.includes(page)) return false;
  const adv = {};
  for (const [k, v] of p) if (!reserved.includes(k)) adv[k] = v;
  restore(page, {filter: p.get('tab') || 'All', search: p.get('q') || '', adv});
  return true;
}

export const savedViews = () => state.data?.views || [];
export function viewsNav() {
  const views = savedViews();
  if (!views.length) return '';
  return `<section class="nav-group saved-views"><h2 class="nav-tab">Views</h2>${views
    .map(
      v =>
        `<div class="saved-view"><button type="button" data-saved-view="${escape(v.id)}" class="${state.activeView === v.id ? 'active' : ''}">${icon('filter')}<span>${escape(v.name)}</span></button><button type="button" class="saved-view-remove" data-remove-view="${escape(v.id)}" aria-label="Remove view ${escape(v.name)}">${icon('close')}</button></div>`,
    )
    .join('')}</section>`;
}
export function viewTools() {
  if (!registerPages.includes(state.page)) return '';
  return `<button type="button" class="quiet-button" data-save-view>${icon('plus')}Save view</button><button type="button" class="quiet-button" data-copy-link>${icon('link')}Copy link</button>`;
}

export function openView(id, render) {
  const v = savedViews().find(x => x.id === id);
  if (!v) return;
  if (location.pathname !== '/') history.pushState({page: v.page}, '', '/');
  restore(v.page, v.state);
  state.activeView = v.id;
  render();
}

export function bindViews(render) {
  $$('[data-saved-view]').forEach(b => (b.onclick = () => openView(b.dataset.savedView, render)));
  $$('[data-remove-view]').forEach(
    b =>
      (b.onclick = async () => {
        const v = savedViews().find(x => x.id === b.dataset.removeView);
        try {
          state.data.views = await api('/views/' + encodeURIComponent(v.id), {method: 'DELETE'});
          render();
          toast(`View “${v.name}” removed.`, {
            undo: async () => {
              state.data.views = await api('/views', {
                method: 'POST',
                body: JSON.stringify({name: v.name, page: v.page, state: v.state}),
              });
              render();
            },
          });
        } catch (err) {
          toast(err.message);
        }
      }),
  );
  const save = $('[data-save-view]');
  if (save)
    save.onclick = () => {
      dialog(
        'Save this view',
        `<form id="view-form"><p class="form-context">Pins this list, with its tab, search and filters, to your sidebar.</p><div class="form-grid">${field('View name', 'name').replace('class="field ', 'class="field full ')}</div>${formActions('Save view')}</form>`,
      );
      bindCancel();
      $('#view-form [name=name]').focus();
      bindForm($('#view-form'), async data => {
        state.data.views = await api('/views', {
          method: 'POST',
          body: JSON.stringify({name: data.name, page: state.page, state: snapshot(state.page)}),
        });
        state.activeView = state.data.views.at(-1)?.id;
        closeDialog();
        render();
        toast(`View “${data.name}” saved to your sidebar.`);
      });
    };
  const copy = $('[data-copy-link]');
  if (copy)
    copy.onclick = async () => {
      const link = location.origin + urlFor(state.page);
      try {
        await navigator.clipboard.writeText(link);
        toast('Link copied. It opens this list with the same filters.');
      } catch {
        toast(link);
      }
    };
}
