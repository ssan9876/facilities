// Ticket page extras: checklist, time, followers, saved replies and @mentions in comments.
import {
  state,
  $,
  $$,
  escape,
  icon,
  api,
  toast,
  confirmButton,
  dialog,
  closeDialog,
  field,
  bindForm,
  formActions,
  bindCancel,
} from './ui.js';
import {hooks} from './hooks.js';

export const minutes = m => {
  const h = Math.floor(m / 60),
    r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
};
const since = iso => {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

// ---- Markup ----
export function checklistProgress(o) {
  const done = o.checklist.filter(i => i.done_at).length;
  return o.checklist.length ? `Checklist ${done}/${o.checklist.length}` : '';
}
export function checklistCard(o, p) {
  if (!o.checklist.length && !p.work) return '';
  const done = o.checklist.filter(i => i.done_at).length;
  const templates = state.checklistTemplates || [];
  return `<section class="tp-card checklist-card"><div class="card-head"><h2>Checklist</h2>${o.checklist.length ? `<span class="progress-label">${done} of ${o.checklist.length} done</span>` : ''}</div>${
    o.checklist.length
      ? `<progress class="progress" value="${done}" max="${o.checklist.length}" aria-hidden="true"></progress><ul class="checklist">${o.checklist
          .map(
            i =>
              `<li class="${i.done_at ? 'done' : ''}"><label><input type="checkbox" data-check-item="${escape(i.id)}" ${i.done_at ? 'checked' : ''} ${p.work ? '' : 'disabled'}><span>${escape(i.label)}</span></label>${i.done_at ? `<small>${escape(i.done_by_name || '')}</small>` : ''}${p.work ? `<button type="button" class="icon-button" data-remove-item="${escape(i.id)}" aria-label="Remove ${escape(i.label)}">${icon('close')}</button>` : ''}</li>`,
          )
          .join('')}</ul>`
      : '<p class="muted-line">No checklist yet.</p>'
  }${
    p.work
      ? `<form id="checklist-form" class="checklist-add"><label class="visually-hidden" for="checklist-new">New checklist item</label><input id="checklist-new" name="label" type="text" maxlength="200" placeholder="Add a step" autocomplete="off"><button type="submit" class="secondary">Add</button>${templates.length ? `<select id="checklist-template" aria-label="Add from a template"><option value="">Add from template…</option>${templates.map(t => `<option value="${escape(t.id)}">${escape(t.name)} (${t.items.length})</option>`).join('')}</select>` : ''}</form>`
      : ''
  }</section>`;
}
export function timeCard(o, p) {
  if (!p.work && !o.time.entries.length) return '';
  const running = o.time.running;
  return `<section class="tp-card time-card"><div class="card-head"><h2>Time</h2><span class="progress-label">${o.time.total_minutes ? minutes(o.time.total_minutes) + ' logged' : 'Nothing logged'}</span></div>${
    p.work
      ? `<div class="time-actions">${running ? `<button type="button" class="primary" data-timer-stop>${icon('check')}Stop · <span data-running-since="${escape(running.started_at)}">${since(running.started_at)}</span></button>` : `<button type="button" class="secondary" data-timer-start>${icon('history')}Start timer</button>`}<button type="button" class="quiet-button" data-log-time>Log time</button></div>`
      : ''
  }${
    o.time.entries.length
      ? `<ul class="time-list">${o.time.entries
          .slice(0, 8)
          .map(
            e =>
              `<li><span><strong>${e.ended_at ? minutes(e.minutes) : 'Running'}</strong> ${escape(e.name)}${e.note ? ` · ${escape(e.note)}` : ''}</span>${e.user_id === state.me.user.id || o.permissions.moderate ? `<button type="button" class="icon-button" data-remove-time="${escape(e.id)}" aria-label="Remove this time">${icon('close')}</button>` : ''}</li>`,
          )
          .join('')}</ul>`
      : ''
  }</section>`;
}
export function followersFact(o) {
  return o.followers.length
    ? `<div><dt>Following</dt><dd>${o.followers.map(f => escape(f.name) + (f.source === 'me_too' ? ' (same problem)' : '')).join(', ')}</dd></div>`
    : '';
}
export const followButton = o =>
  `<button type="button" class="secondary" data-follow="${o.following ? 'off' : 'on'}" aria-pressed="${o.following}">${icon('bell')}${o.following ? 'Following' : 'Follow'}</button>`;
export function commentTools(o) {
  const replies = state.replies || [];
  return `<div class="comment-tools">${replies.length ? `<select id="insert-reply" aria-label="Insert a saved reply"><option value="">Insert saved reply…</option>${replies.map(r => `<option value="${escape(r.id)}">${escape(r.title)}${r.user_id ? '' : ' (shared)'}</option>`).join('')}</select>` : ''}<button type="button" class="quiet-button" data-save-reply>Save as reply</button>${o.permissions.mention ? '<span class="muted-line">Type @ to mention someone.</span>' : ''}</div><ul id="mention-list" class="mention-list" role="listbox" hidden></ul>`;
}

// ---- Behaviour ----
export async function loadTicketLookups() {
  const jobs = [];
  if (!state.replies) jobs.push(api('/replies').then(r => (state.replies = r)));
  if (!state.checklistTemplates) jobs.push(api('/checklist-templates').then(r => (state.checklistTemplates = r)));
  await Promise.all(jobs).catch(() => {});
}

export function bindExtras(o, {reload}) {
  const id = encodeURIComponent(o.id);
  // Follow / unfollow.
  const follow = $('[data-follow]');
  if (follow)
    follow.onclick = async () => {
      const on = follow.dataset.follow === 'on';
      try {
        await api(`/orders/${id}/follow`, {method: on ? 'POST' : 'DELETE', body: on ? '{}' : undefined});
        await reload();
        toast(on ? 'You will get updates on this request.' : 'You stopped following this request.');
      } catch (err) {
        toast(err.message);
      }
    };
  // Checklist.
  $$('[data-check-item]').forEach(
    box =>
      (box.onchange = async () => {
        box.disabled = true;
        try {
          o.checklist = await api(`/orders/${id}/checklist/${box.dataset.checkItem}`, {
            method: 'PATCH',
            body: JSON.stringify({done: box.checked}),
          });
          await reload(true);
        } catch (err) {
          toast(err.message);
          box.checked = !box.checked;
          box.disabled = false;
        }
      }),
  );
  $$('[data-remove-item]').forEach(
    b =>
      (b.onclick = async () => {
        await api(`/orders/${id}/checklist/${b.dataset.removeItem}`, {method: 'DELETE'}).catch(e => toast(e.message));
        await reload(true);
      }),
  );
  const add = $('#checklist-form');
  if (add)
    add.onsubmit = async e => {
      e.preventDefault();
      const label = add.elements.label.value.trim();
      if (!label) return;
      try {
        await api(`/orders/${id}/checklist`, {method: 'POST', body: JSON.stringify({label})});
        await reload(true);
        $('#checklist-new')?.focus();
      } catch (err) {
        toast(err.message);
      }
    };
  const template = $('#checklist-template');
  if (template)
    template.onchange = async () => {
      if (!template.value) return;
      try {
        await api(`/orders/${id}/checklist`, {method: 'POST', body: JSON.stringify({template_id: template.value})});
        await reload(true);
      } catch (err) {
        toast(err.message);
      }
    };
  // Time.
  const start = $('[data-timer-start]');
  if (start)
    start.onclick = async () => {
      try {
        const r = await api(`/orders/${id}/time/start`, {method: 'POST'});
        if (r.stopped) toast(`Stopped the timer on another request: ${minutes(r.stopped.minutes)} logged.`);
        await hooks.refresh();
      } catch (err) {
        toast(err.message);
      }
    };
  const stop = $('.time-card [data-timer-stop]');
  if (stop) stop.onclick = () => stopTimer();
  const log = $('[data-log-time]');
  if (log)
    log.onclick = () => {
      dialog(
        'Log time',
        `<form id="time-form"><div class="form-grid">${field('Minutes', 'minutes', 'number', '30', false, 'min="1" max="1440"')}${field('Note', 'note', 'text', '', true)}</div>${formActions('Log time')}</form>`,
      );
      bindCancel();
      bindForm($('#time-form'), async data => {
        await api(`/orders/${id}/time`, {
          method: 'POST',
          body: JSON.stringify({minutes: Number(data.minutes), note: data.note}),
        });
        closeDialog();
        await reload(true);
        toast(`${minutes(Number(data.minutes))} logged.`);
      });
    };
  $$('[data-remove-time]').forEach(b =>
    confirmButton(
      b,
      async () => {
        try {
          await api(`/time/${b.dataset.removeTime}`, {method: 'DELETE'});
          await reload(true);
        } catch (err) {
          toast(err.message);
        }
      },
      'Remove?',
    ),
  );
  // Saved replies and mentions in the comment box.
  const box = $('#comment-form textarea');
  const insert = $('#insert-reply');
  if (insert && box)
    insert.onchange = () => {
      const reply = (state.replies || []).find(r => r.id === insert.value);
      if (reply) {
        box.setRangeText(
          (box.value && !box.value.endsWith('\n') ? '\n' : '') + reply.body,
          box.selectionStart,
          box.selectionEnd,
          'end',
        );
        box.dispatchEvent(new Event('input', {bubbles: true}));
        box.focus();
      }
      insert.value = '';
    };
  const saveReply = $('[data-save-reply]');
  if (saveReply && box)
    saveReply.onclick = () => {
      if (!box.value.trim()) return toast('Write the reply in the comment box first.');
      const body = box.value;
      dialog(
        'Save as reply',
        `<form id="reply-form"><p class="form-context">Saved replies appear in “Insert saved reply” on every ticket.</p><div class="form-grid">${field('Reply name', 'title').replace('class="field ', 'class="field full ')}${state.me.user.capabilities.includes('admin.forms') ? '<label class="field-check full"><input type="checkbox" name="shared">Share with everyone</label>' : ''}</div>${formActions('Save reply')}</form>`,
      );
      bindCancel();
      bindForm($('#reply-form'), async (data, f) => {
        state.replies = await api('/replies', {
          method: 'POST',
          body: JSON.stringify({title: data.title, body, shared: !!f.shared?.checked}),
        });
        closeDialog();
        await reload(true);
        toast(`Reply “${data.title}” saved.`);
      });
    };
  if (box && o.permissions.mention) bindMentions(box);
}

// @mentions: suggestions from the people this workspace lists; chosen people are sent as ids.
function bindMentions(box) {
  const list = $('#mention-list');
  const people = (state.data.users || []).filter(u => u.id !== state.me.user.id);
  box.mentions ||= new Map();
  let active = 0,
    matches = [];
  const query = () => {
    const before = box.value.slice(0, box.selectionStart);
    const m = before.match(/(^|\s)@([\w.'-]{0,30})$/);
    return m ? m[2] : null;
  };
  const close = () => {
    list.hidden = true;
    matches = [];
  };
  const pick = u => {
    const before = box.value.slice(0, box.selectionStart).replace(/@([\w.'-]{0,30})$/, `@${u.name} `);
    box.value = before + box.value.slice(box.selectionStart);
    box.selectionStart = box.selectionEnd = before.length;
    box.mentions.set(u.id, u.name);
    close();
    box.focus();
    box.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const draw = () => {
    list.innerHTML = matches
      .map(
        (u, i) =>
          `<li role="option" class="${i === active ? 'active' : ''}" data-mention="${escape(u.id)}">@${escape(u.name)}</li>`,
      )
      .join('');
    list.hidden = !matches.length;
    $$('[data-mention]').forEach(
      li => (li.onmousedown = e => (e.preventDefault(), pick(people.find(p => p.id === li.dataset.mention)))),
    );
  };
  box.addEventListener('input', () => {
    const q = query();
    if (q === null) return close();
    matches = people.filter(u => u.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
    active = 0;
    draw();
  });
  box.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      draw();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  box.addEventListener('blur', () => setTimeout(close, 150));
}
// The mentions still present in the text when the comment is sent.
export const mentionsIn = box =>
  [...(box.mentions || new Map())].filter(([, name]) => box.value.includes('@' + name)).map(([id]) => id);

// ---- The running timer in the top bar ----
export function timerBadge() {
  const t = state.data?.timer;
  if (!t) return '';
  return `<span class="timer-badge"><button type="button" class="timer-open" data-timer-open="${escape(t.order_id)}" title="Open the ticket you are timing">${icon('history')}<span>WO-${String(t.number).padStart(4, '0')}</span><span data-running-since="${escape(t.started_at)}">${since(t.started_at)}</span></button><button type="button" class="timer-stop" data-timer-stop aria-label="Stop the timer">Stop</button></span>`;
}
export async function stopTimer() {
  try {
    const r = await api('/time/stop', {method: 'POST', body: '{}'});
    toast(`Timer stopped: ${minutes(r.stopped.minutes)} logged.`);
    await hooks.refresh();
  } catch (err) {
    toast(err.message);
  }
}
export function bindTimerBadge() {
  $$('[data-timer-open]').forEach(b => (b.onclick = () => hooks.openTicket(b.dataset.timerOpen)));
  $$('.timer-badge [data-timer-stop]').forEach(b => (b.onclick = () => stopTimer()));
}
// Running clocks tick on screen only (no requests).
setInterval(() => {
  for (const el of document.querySelectorAll('[data-running-since]')) el.textContent = since(el.dataset.runningSince);
}, 1000);

// ---- Rate the fix (requester) and reopen with a reason ----
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
export function ratingCard(o) {
  const mine = o.requester_id === state.me.user.id;
  if (o.status !== 'Completed' || !mine) return '';
  const r = o.rating;
  return `<section class="tp-card rating-card"><h2>${r ? 'Your rating' : 'How did we do?'}</h2><div class="stars" role="group" aria-label="Rate the fix">${[
    1, 2, 3, 4, 5,
  ]
    .map(
      n =>
        `<button type="button" data-rate="${n}" class="${r && r.score >= n ? 'on' : ''}" aria-pressed="${r?.score === n}" aria-label="${n} star${n === 1 ? '' : 's'}">${r && r.score >= n ? '★' : '☆'}</button>`,
    )
    .join(
      '',
    )}</div>${r?.comment ? `<p class="muted-line">“${escape(r.comment)}”</p>` : ''}<p class="muted-line">Not fixed after all? <button type="button" class="quiet-button" data-reopen>Reopen it</button></p></section>`;
}
export const ratingFact = o =>
  o.rating && o.requester_id !== state.me.user.id
    ? `<div><dt>Requester rating</dt><dd><span class="stars-read" aria-label="${o.rating.score} of 5">${stars(o.rating.score)}</span>${o.rating.comment ? ` “${escape(o.rating.comment)}”` : ''}</dd></div>`
    : '';
export function bindRating(o) {
  const id = encodeURIComponent(o.id);
  $$('[data-rate]').forEach(
    b =>
      (b.onclick = () => {
        const score = Number(b.dataset.rate);
        dialog(
          `${stars(score)} · Rate the fix`,
          `<form id="rate-form"><div class="form-grid">${field(score <= 2 ? 'What went wrong? (optional)' : 'Anything to add? (optional)', 'comment', 'textarea', o.rating?.comment || '', true)}</div>${formActions('Send rating')}</form>`,
        );
        bindCancel();
        bindForm($('#rate-form'), async data => {
          await api(`/orders/${id}/rating`, {method: 'POST', body: JSON.stringify({score, comment: data.comment})});
          closeDialog();
          await hooks.refresh();
          toast('Thanks for rating the fix.');
        });
      }),
  );
  const reopen = $('[data-reopen]');
  if (reopen)
    reopen.onclick = () => {
      dialog(
        'Reopen this request',
        `<form id="reopen-form"><p class="form-context">Tell the team what is still wrong. They are notified and the request goes back to Open.</p><div class="form-grid">${field('What is still wrong?', 'reason', 'textarea')}</div>${formActions('Reopen request')}</form>`,
      );
      bindCancel();
      bindForm($('#reopen-form'), async data => {
        await api(`/orders/${id}/reopen`, {method: 'POST', body: JSON.stringify({reason: data.reason})});
        closeDialog();
        await hooks.refresh();
        toast('Request reopened. The team has been told.');
      });
    };
  const print = $('[data-print]');
  if (print) print.onclick = () => printDialog([o.number]);
}
// Printable work orders: choose which copies, then open the print page.
export function printDialog(numbers) {
  const all = [
    ['requester', 'Requester copy (white)'],
    ['technician', 'Technician copy (canary)'],
    ['office', 'Office copy (pink)'],
  ];
  dialog(
    numbers.length === 1 ? 'Print work order' : `Print ${numbers.length} work orders`,
    `<form id="print-form"><p class="form-context">Each copy prints on its own page with a QR code back to the ticket.</p><div class="form-grid"><fieldset class="field full check-group"><legend>Copies</legend>${all.map(([k, l]) => `<label class="field-check inline"><input type="checkbox" name="copy" value="${k}" ${k === 'technician' ? 'checked' : ''}>${l}</label>`).join('')}</fieldset></div>${formActions('Open print view')}</form>`,
  );
  bindCancel();
  $('#print-form').onsubmit = e => {
    e.preventDefault();
    const copies = $$('#print-form [name=copy]:checked').map(i => i.value);
    if (!copies.length) return toast('Choose at least one copy.');
    const tickets = numbers.map(n => `WO-${String(n).padStart(4, '0')}`).join(',');
    window.open(`/print?tickets=${encodeURIComponent(tickets)}&copies=${copies.join(',')}`, '_blank', 'noopener');
    closeDialog();
  };
}
