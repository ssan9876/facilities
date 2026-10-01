import {requestTypes} from './request-settings.js';
import {
  state,
  $,
  $$,
  escape,
  icon,
  can,
  fmt,
  fmtTime,
  fmtStamp,
  ticketNo,
  money,
  bytes,
  tag,
  reservationTag,
  api,
  upload,
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
import {hooks} from './hooks.js';
import {locationFields, bindLocation, requestTiming, bindTiming} from './forms.js';

const statuses = ['Open', 'In progress', 'On hold', 'Completed'];
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Legal next stages from each stage; Completed tickets can only be reopened.
const nextStages = {
  Open: ['In progress', 'On hold', 'Completed'],
  'In progress': ['On hold', 'Completed'],
  'On hold': ['In progress', 'Completed'],
  Completed: ['Open'],
};
const pause = ms => new Promise(resolve => setTimeout(resolve, reducedMotion() ? 0 : ms));
// The new stage is stamped onto the strip before the ticket redraws with its new state.
async function stampLand(status) {
  $('#lifecycle-slot').innerHTML = lifecycle(status, true);
  await pause(620);
}
const cell = (label, value, cls = '') =>
  `<div class="cell ${cls}"><span class="cell-label">${label}</span><span class="cell-value">${value}</span></div>`;
// The fixed-scale lifecycle strip: stages before the current one are filed, the current one carries the stamp.
export function lifecycle(status, landing = false) {
  const at = statuses.indexOf(status);
  return `<ol class="lifecycle" aria-label="Progress: ${escape(status)}">${statuses
    .map(
      (stage, i) =>
        `<li class="${i < at ? 'done' : i === at ? 'current' : ''}"><span class="lc-label">${stage}</span>${i === at ? `<span class="lc-stamp ${stage.toLowerCase().replaceAll(' ', '-')} ${landing ? 'landing' : ''}" aria-hidden="true">${stage}</span>` : ''}</li>`,
    )
    .join('')}</ol>`;
}
const describeChange = (key, [from, to]) => {
  const label = key.replace(/_id$/, '').replaceAll('_', ' ');
  const value = v => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return `<li><strong>${escape(label)}</strong> ${escape(value(from))} → ${escape(value(to))}</li>`;
};

// Opening a ticket navigates to its own page (/tickets/WO-0042); the shell handles history.
export const orderEditor = ref => hooks.openTicket(ref);

// Renders the ticket page into #ticket-page. ref is a ticket id or WO number.
export async function ticketPage(ref) {
  const page = $('#ticket-page');
  let o;
  try {
    o = await api(`/orders/${encodeURIComponent(ref)}`);
  } catch (err) {
    if (page) page.innerHTML = `<div class="empty"><h2>Ticket unavailable</h2><p>${escape(err.message)}</p></div>`;
    return;
  }
  if (!$('#ticket-page')) return;
  const id = o.id,
    number = ticketNo(o.number);
  if (o.number && location.pathname !== `/tickets/${number}`)
    history.replaceState(history.state, '', `/tickets/${number}`);
  document.title = `${number} ${o.title} · ${state.me.branding?.name || 'Facilities'}`;
  const me = state.me.user,
    owner = o.requester_id === me.id;
  const canStamp = can('requests.update_any') || (can('requests.update_assigned') && o.assignee_id === me.id);
  const canAssign = can('requests.assign');
  const canUpdate = canStamp || canAssign;
  const fullEdit = can('requests.edit_any') || (owner && o.status === 'Open');
  const textEdit = !fullEdit && can('requests.edit_assigned') && o.assignee_id === me.id;
  const canEditDetails = fullEdit || textEdit;
  const canRecordParts =
    state.data.modules.inventory &&
    (can('parts.record_any') || (can('requests.update_assigned') && o.assignee_id === me.id));
  const when =
    o.request_type === 'schedule'
      ? `${fmtTime(o.starts_at)} – ${fmtTime(o.ends_at)} · ${escape(state.me.timezone)}`
      : 'Due ' + fmt(o.due_date);
  const reservation = o.space_id
    ? `<section class="detail-section reservation"><div><strong>${icon('door')}${escape(o.space)}</strong> ${reservationTag(o.reservation_status)}<p>${o.reservation_status === 'pending' ? 'This space reservation is waiting for a manager.' : o.reservation_status === 'approved' ? 'The space is reserved for this time.' : 'The space is not reserved for this request.'}</p></div><div class="inline-actions">${can('reservations.approve') && o.reservation_status === 'pending' ? '<button class="primary" data-reservation="approved">Approve</button><button class="secondary" data-reservation="declined">Decline</button>' : ''}${(can('reservations.approve') || owner) && ['pending', 'approved'].includes(o.reservation_status) ? '<button class="quiet-button" data-reservation="cancelled">Cancel reservation</button>' : ''}</div></section>`
    : '';
  const attachments = `<section class="detail-section"><div class="section-head compact"><h2>Attachments</h2></div>${o.attachments.length ? `<ul class="attachment-list">${o.attachments.map(a => `<li>${a.content_type.startsWith('image/') && a.content_type !== 'image/heic' ? `<a href="/api/attachments/${escape(a.id)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="/api/attachments/${escape(a.id)}" alt="" loading="lazy"></a>` : `<span class="file-symbol">${icon('clip')}</span>`}<div><a href="/api/attachments/${escape(a.id)}?download" download>${escape(a.file_name)}</a><small>${bytes(a.size)} · ${escape(a.uploader)} · ${fmtStamp(a.created_at)}</small></div>${a.uploaded_by === me.id || can('requests.moderate') ? `<button class="quiet-button" data-remove-attachment="${escape(a.id)}">Remove</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted-line">No photos or files yet.</p>'}<label class="upload-button secondary">${icon('clip')}Add photos or files<input type="file" id="attach-input" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf,text/plain,text/csv,.docx,.xlsx"></label></section>`;
  const activeParts = (state.data.parts || []).filter(p => !p.archived_at);
  const parts =
    state.data.modules.inventory && can('inventory.view')
      ? `<section class="detail-section"><div class="section-head compact"><h2>Parts used</h2></div>${o.parts.length ? `<table class="mini-table"><tbody>${o.parts.map(p => `<tr><td>${p.quantity} × ${escape(p.name)}<div class="order-sub">${escape(p.sku) || 'No SKU'} · ${escape(p.used_by)}</div></td><td>${money(p.unit_cost_cents == null ? null : p.unit_cost_cents * p.quantity)}</td><td>${canRecordParts ? `<button class="quiet-button" data-return-part="${escape(p.id)}">Return to stock</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted-line">No parts recorded.</p>'}${canRecordParts && activeParts.length ? `<form id="part-form" class="inline-form">${select('Part', 'part_id', [['', 'Choose part'], ...activeParts.map(p => [p.id, `${p.name} (${p.quantity} on hand)`])])}${field('Quantity', 'quantity', 'number', '1', false, 'min="1"')}<button class="secondary" type="submit">Record part</button><div class="form-error" role="alert"></div></form>` : ''}</section>`
      : '';
  const stampBar = canUpdate
    ? `<div class="stamp-bar" role="group" aria-label="Stamp this ticket">${nextStages[o.status]

        .map(
          (stage, i) =>
            `<button type="button" class="stamp-button ${i === 0 ? 'next' : ''}" data-stamp="${stage}">${stage === 'Open' && o.status === 'Completed' ? 'Reopen' : 'Stamp ' + stage}</button>`,
        )
        .join('')}</div>`
    : '';
  const update = canUpdate
    ? `<form id="update-form"><div class="form-grid">${select(
        'Status',
        'status',
        statuses.map(x => [x, x]),
        o.status,
      )}${canAssign ? select('Assigned to', 'assignee_id', [['', 'Unassigned'], ...state.data.users.filter(u => u.assignable).map(u => [u.id, u.name])], o.assignee_id || '') : ''}</div><div class="form-error" role="alert"></div><div class="editor-actions"><button class="secondary" type="submit">Save changes</button></div></form>`
    : '';
  const copy = !can('requests.view_all') ? 'requester' : canAssign ? 'office' : 'technician';
  const fields = [
    cell(
      'Type',
      `<span class="request-kind">${icon(requestTypes[o.request_type].icon)}${requestTypes[o.request_type].label}</span>`,
    ),
    cell('Priority', tag(o.priority)),
    cell('Opened', fmtStamp(o.created_at)),
    cell('Building', escape(o.building)),
    cell('Asset', escape(o.asset) || '<span class="unassigned">None</span>'),
    o.request_type === 'schedule'
      ? cell(
          'Space',
          o.space
            ? `${escape(o.space)} ${reservationTag(o.reservation_status)}`
            : '<span class="unassigned">None</span>',
        )
      : cell(
          'Due',
          `<span class="${o.status !== 'Completed' && o.due_date < new Date().toISOString().slice(0, 10) ? 'overdue' : ''}">${fmt(o.due_date)}</span>`,
        ),
    cell('Requested by', escape(o.requester)),
    cell('Assigned to', escape(o.assignee) || '<span class="unassigned">Unassigned</span>'),
    o.request_type === 'schedule'
      ? cell('When', when)
      : cell('Completed', o.completed_at ? fmtStamp(o.completed_at) : '—'),
  ].join('');
  $('#ticket-page').innerHTML =
    `<div class="ticket-bar"><button type="button" class="quiet-button" data-ticket-back>${icon('arrow-left')}Back</button><span class="copy-label"><span class="copies" data-copy="${copy}" aria-hidden="true"><i class="c-requester"></i><i class="c-technician"></i><i class="c-office"></i></span>${{requester: 'Requester copy', technician: 'Technician copy', office: 'Office copy'}[copy]}</span></div><article class="ticket-sheet" data-copy="${copy}"><header class="ticket-head"><span class="ticket-no">${escape(number)}</span><h1>${escape(o.title)}</h1></header><div class="ticket-body">` +
    `<div id="lifecycle-slot">${lifecycle(o.status)}</div>${stampBar}<div class="ticket-fields">${fields}${cell('Description of work', `<span class="detail-description">${escape(o.description) || 'No additional details.'}</span>`, 'wide')}</div><div class="detail-toolbar">${canEditDetails ? `<button class="secondary" id="edit-order">${icon('edit')}${textEdit ? 'Edit text' : 'Edit details'}</button>` : ''}<button class="secondary" id="show-history">${icon('history')}Activity</button>${can('requests.delete') ? '<button class="secondary danger" id="delete-order">Delete request</button>' : ''}</div>${reservation}${canUpdate ? `<section class="detail-section stamp-forward"><div class="section-head compact"><h2>${canAssign ? 'Reassign or correct' : 'Correct the status'}</h2></div>${update}</section>` : `<p class="muted-line">Assigned to ${escape(o.assignee) || 'no one yet'}.</p>`}<div id="history" hidden></div>${attachments}${parts}<section class="detail-section"><div class="section-head compact"><h2>Conversation</h2></div><div id="comments" aria-live="polite">Loading comments…</div><form id="comment-form">${field('Add a comment', 'body', 'textarea')}<div class="form-error" role="alert"></div><div class="editor-actions"><button class="secondary" type="submit">Post comment</button></div></form></section>` +
    `</div></article>`;
  const reopen = async message => {
    await hooks.refresh();
    if (message) toast(message);
  };
  const back = $('[data-ticket-back]');
  if (back) back.onclick = () => hooks.leaveTicket();
  if (canUpdate)
    bindForm($('#update-form'), async data => {
      await api(`/orders/${encodeURIComponent(id)}`, {method: 'PATCH', body: JSON.stringify(data)});
      if (data.status !== o.status) await stampLand(data.status);
      await reopen(data.status !== o.status ? `${number} stamped ${data.status}.` : 'Request updated.');
    });
  $$('[data-stamp]').forEach(
    b =>
      (b.onclick = async () => {
        $$('[data-stamp]').forEach(x => (x.disabled = true));
        try {
          await api(`/orders/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({status: b.dataset.stamp}),
          });
          await stampLand(b.dataset.stamp);
          await reopen(`${number} stamped ${b.dataset.stamp}.`);
        } catch (e) {
          toast(e.message);
          $$('[data-stamp]').forEach(x => (x.disabled = false));
        }
      }),
  );
  if ($('#edit-order')) $('#edit-order').onclick = () => (textEdit ? editText(o) : editOrder(o));
  if ($('#delete-order'))
    confirmButton(
      $('#delete-order'),
      async () => {
        try {
          await api(`/orders/${encodeURIComponent(id)}`, {method: 'DELETE'});
          toast('Request deleted. The activity log keeps a record.');
          hooks.leaveTicket();
        } catch (e) {
          toast(e.message);
        }
      },
      'Delete permanently?',
    );
  $('#show-history').onclick = async () => {
    const box = $('#history');
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = '<p class="muted-line">Loading activity…</p>';
    try {
      const rows = await api(`/orders/${encodeURIComponent(id)}/history`);
      box.innerHTML = `<section class="detail-section"><div class="section-head compact"><h2>Activity</h2></div>${
        rows.length
          ? `<ol class="history-list">${rows
              .map(
                r =>
                  `<li><div><strong>${escape(r.actor_name)}</strong> ${escape(r.summary)}<small>${fmtStamp(r.created_at)}</small></div>${
                    r.details && r.action === 'order.update'
                      ? `<ul>${Object.entries(r.details)
                          .map(([k, v]) => describeChange(k, v))
                          .join('')}</ul>`
                      : ''
                  }</li>`,
              )
              .join('')}</ol>`
          : '<p class="muted-line">No recorded activity yet.</p>'
      }</section>`;
    } catch (e) {
      box.textContent = e.message;
    }
  };
  $$('[data-reservation]').forEach(
    b =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api(`/orders/${encodeURIComponent(id)}/reservation`, {
            method: 'POST',
            body: JSON.stringify({decision: b.dataset.reservation}),
          });
          await reopen(
            {approved: 'Reservation approved.', declined: 'Reservation declined.', cancelled: 'Reservation cancelled.'}[
              b.dataset.reservation
            ],
          );
        } catch (e) {
          toast(e.message);
          b.disabled = false;
        }
      }),
  );
  $('#attach-input').onchange = async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    e.target.disabled = true;
    let done = 0;
    for (const file of files) {
      try {
        await upload(id, file);
        done++;
      } catch (err) {
        toast(`${file.name}: ${err.message}`);
      }
    }
    if (done) await reopen(`${done} file${done === 1 ? '' : 's'} attached.`);
    else e.target.disabled = false;
  };
  $$('[data-remove-attachment]').forEach(b =>
    confirmButton(
      b,
      async () => {
        try {
          await api('/attachments/' + encodeURIComponent(b.dataset.removeAttachment), {method: 'DELETE'});
          await reopen('Attachment removed.');
        } catch (e) {
          toast(e.message);
        }
      },
      'Remove?',
    ),
  );
  if ($('#part-form'))
    bindForm($('#part-form'), async data => {
      const r = await api(`/orders/${encodeURIComponent(id)}/parts`, {
        method: 'POST',
        body: JSON.stringify({part_id: data.part_id, quantity: Number(data.quantity)}),
      });
      await reopen(r.low ? `Part recorded. Only ${r.remaining} left — time to reorder.` : 'Part recorded.');
    });
  $$('[data-return-part]').forEach(b =>
    confirmButton(
      b,
      async () => {
        try {
          await api(`/orders/${encodeURIComponent(id)}/parts/${encodeURIComponent(b.dataset.returnPart)}`, {
            method: 'DELETE',
          });
          await reopen('Part returned to stock.');
        } catch (e) {
          toast(e.message);
        }
      },
      'Return?',
    ),
  );
  const loadComments = async () => {
    const comments = await api(`/orders/${encodeURIComponent(id)}/comments`);
    if (!$('#comments')) return;
    $('#comments').innerHTML =
      comments
        .map(
          c =>
            `<div class="comment" data-comment="${escape(c.id)}"><strong>${escape(c.author)}</strong><small>${new Date(c.created_at).toLocaleString()}${c.edited_at ? ' · edited' : ''}</small>${c.user_id === me.id || can('requests.moderate') ? `<span class="comment-actions">${c.user_id === me.id ? `<button class="quiet-button" data-edit-comment="${escape(c.id)}">Edit</button>` : ''}<button class="quiet-button" data-delete-comment="${escape(c.id)}">Delete</button></span>` : ''}<p>${escape(c.body)}</p></div>`,
        )
        .join('') || '<p>No comments yet. Keep your team in the loop.</p>';
    $$('[data-edit-comment]').forEach(
      b =>
        (b.onclick = () => {
          const c = comments.find(x => x.id === b.dataset.editComment),
            box = b.closest('.comment');
          box.querySelector('p').outerHTML =
            `<form class="comment-edit">${field('Edit comment', 'body', 'textarea', c.body)}<div class="form-error" role="alert"></div><div class="editor-actions"><button type="button" class="secondary" data-cancel-edit>Cancel</button><button class="primary" type="submit">Save comment</button></div></form>`;
          box.querySelector('[data-cancel-edit]').onclick = loadComments;
          bindForm(box.querySelector('form'), async data => {
            await api(`/orders/${encodeURIComponent(id)}/comments/${encodeURIComponent(c.id)}`, {
              method: 'PATCH',
              body: JSON.stringify(data),
            });
            await loadComments();
          });
        }),
    );
    $$('[data-delete-comment]').forEach(b =>
      confirmButton(
        b,
        async () => {
          try {
            await api(`/orders/${encodeURIComponent(id)}/comments/${encodeURIComponent(b.dataset.deleteComment)}`, {
              method: 'DELETE',
            });
            await loadComments();
          } catch (e) {
            toast(e.message);
          }
        },
        'Delete?',
      ),
    );
  };
  $('#comment-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.currentTarget,
      b = f.querySelector('button');
    b.disabled = true;
    try {
      await api(`/orders/${encodeURIComponent(id)}/comments`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(f))),
      });
      f.reset();
      await loadComments();
    } catch (err) {
      f.querySelector('.form-error').textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
  try {
    await loadComments();
  } catch (err) {
    if ($('#comments')) $('#comments').textContent = err.message;
  }
}

function editOrder(o) {
  dialog(
    'Edit request',
    `<form id="edit-form"><div class="form-grid">${field('Title', 'title', 'text', o.title)}${select(
      'Priority',
      'priority',
      ['Low', 'Normal', 'High', 'Urgent'].map(x => [x, x]),
      o.priority,
    )}${locationFields(o.building_id, o.asset_id || '')}<div class="timing" id="request-timing">${requestTiming(o.request_type, o)}</div>${field('Details', 'description', 'textarea', o.description, true)}</div>${formActions('Save details')}</form>`,
    {number: ticketNo(o.number)},
  );
  bindCancel();
  bindLocation();
  bindTiming(o.id);
  bindForm($('#edit-form'), async data => {
    if (o.request_type === 'schedule') delete data.due_date;
    else {
      delete data.starts_at;
      delete data.ends_at;
      delete data.space_id;
    }
    const r = await api(`/orders/${encodeURIComponent(o.id)}`, {method: 'PATCH', body: JSON.stringify(data)});
    closeDialog();
    await hooks.refresh();
    toast(
      r.reservation_status === 'pending' && o.reservation_status !== 'pending'
        ? 'Saved. The new reservation time needs approval.'
        : 'Request details saved.',
    );
  });
}

// The assignee's editor: the ticket's words only, never its place, priority or dates.
function editText(o) {
  dialog(
    'Edit ticket text',
    `<form id="edit-form"><div class="form-grid">${field('Title', 'title', 'text', o.title).replace('class="field ', 'class="field full ')}${field('Details', 'description', 'textarea', o.description, true)}</div>${formActions('Save text')}</form>`,
    {number: ticketNo(o.number)},
  );
  bindCancel();
  bindForm($('#edit-form'), async data => {
    await api(`/orders/${encodeURIComponent(o.id)}`, {method: 'PATCH', body: JSON.stringify(data)});
    closeDialog();
    await hooks.refresh();
    toast('Ticket text saved.');
  });
}
