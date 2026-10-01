import {requestTypes} from './request-settings.js';
import {
  state,
  $,
  $$,
  escape,
  icon,
  manage,
  staffRole,
  fmt,
  fmtTime,
  fmtStamp,
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
const describeChange = (key, [from, to]) => {
  const label = key.replace(/_id$/, '').replaceAll('_', ' ');
  const value = v => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return `<li><strong>${escape(label)}</strong> ${escape(value(from))} → ${escape(value(to))}</li>`;
};

export async function orderEditor(id) {
  let o;
  try {
    o = await api(`/orders/${encodeURIComponent(id)}`);
  } catch (err) {
    toast(err.message);
    return;
  }
  const me = state.me.user,
    owner = o.requester_id === me.id;
  const canUpdate = manage() || (me.role === 'technician' && o.assignee_id === me.id);
  const canEditDetails = manage() || (owner && o.status === 'Open');
  const canRecordParts = state.data.modules.inventory && canUpdate;
  const when =
    o.request_type === 'schedule'
      ? `${fmtTime(o.starts_at)} – ${fmtTime(o.ends_at)} · ${escape(state.me.timezone)}`
      : 'Due ' + fmt(o.due_date);
  const reservation = o.space_id
    ? `<section class="detail-section reservation"><div><strong>${icon('door')}${escape(o.space)}</strong> ${reservationTag(o.reservation_status)}<p>${o.reservation_status === 'pending' ? 'This space reservation is waiting for a manager.' : o.reservation_status === 'approved' ? 'The space is reserved for this time.' : 'The space is not reserved for this request.'}</p></div><div class="inline-actions">${manage() && o.reservation_status === 'pending' ? '<button class="primary" data-reservation="approved">Approve</button><button class="secondary" data-reservation="declined">Decline</button>' : ''}${(manage() || owner) && ['pending', 'approved'].includes(o.reservation_status) ? '<button class="quiet-button" data-reservation="cancelled">Cancel reservation</button>' : ''}</div></section>`
    : '';
  const attachments = `<section class="detail-section"><div class="section-head compact"><h2>Attachments</h2></div>${o.attachments.length ? `<ul class="attachment-list">${o.attachments.map(a => `<li>${a.content_type.startsWith('image/') && a.content_type !== 'image/heic' ? `<a href="/api/attachments/${escape(a.id)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="/api/attachments/${escape(a.id)}" alt="" loading="lazy"></a>` : `<span class="file-symbol">${icon('clip')}</span>`}<div><a href="/api/attachments/${escape(a.id)}?download" download>${escape(a.file_name)}</a><small>${bytes(a.size)} · ${escape(a.uploader)} · ${fmtStamp(a.created_at)}</small></div>${a.uploaded_by === me.id || manage() ? `<button class="quiet-button" data-remove-attachment="${escape(a.id)}">Remove</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted-line">No photos or files yet.</p>'}<label class="upload-button secondary">${icon('clip')}Add photos or files<input type="file" id="attach-input" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf,text/plain,text/csv,.docx,.xlsx"></label></section>`;
  const activeParts = (state.data.parts || []).filter(p => !p.archived_at);
  const parts =
    state.data.modules.inventory && staffRole()
      ? `<section class="detail-section"><div class="section-head compact"><h2>Parts used</h2></div>${o.parts.length ? `<table class="mini-table"><tbody>${o.parts.map(p => `<tr><td>${p.quantity} × ${escape(p.name)}<div class="order-sub">${escape(p.sku) || 'No SKU'} · ${escape(p.used_by)}</div></td><td>${money(p.unit_cost_cents == null ? null : p.unit_cost_cents * p.quantity)}</td><td>${canRecordParts ? `<button class="quiet-button" data-return-part="${escape(p.id)}">Return to stock</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted-line">No parts recorded.</p>'}${canRecordParts && activeParts.length ? `<form id="part-form" class="inline-form">${select('Part', 'part_id', [['', 'Choose part'], ...activeParts.map(p => [p.id, `${p.name} (${p.quantity} on hand)`])])}${field('Quantity', 'quantity', 'number', '1', false, 'min="1"')}<button class="secondary" type="submit">Record part</button><div class="form-error" role="alert"></div></form>` : ''}</section>`
      : '';
  const update = canUpdate
    ? `<form id="update-form"><div class="form-grid">${select(
        'Status',
        'status',
        statuses.map(x => [x, x]),
        o.status,
      )}${manage() ? select('Assigned to', 'assignee_id', [['', 'Unassigned'], ...state.data.users.filter(u => u.role !== 'requester').map(u => [u.id, u.name])], o.assignee_id || '') : ''}</div><div class="form-error" role="alert"></div><div class="editor-actions"><button class="primary" type="submit">Save changes</button></div></form>`
    : `<p>Assigned to ${escape(o.assignee) || 'no one yet'}.</p>`;
  dialog(
    o.title,
    `<div class="detail-meta"><span class="request-kind">${icon(requestTypes[o.request_type].icon)}${requestTypes[o.request_type].label}</span>${tag(o.priority)}${tag(o.status)}<span>${escape(o.building)}${o.asset ? ' · ' + escape(o.asset) : ''}</span><span>${when}</span></div><p class="detail-description">${escape(o.description) || 'No additional details.'}</p><div class="detail-toolbar">${canEditDetails ? `<button class="secondary" id="edit-order">${icon('edit')}Edit details</button>` : ''}<button class="secondary" id="show-history">${icon('history')}Activity</button>${manage() ? '<button class="secondary danger" id="delete-order">Delete request</button>' : ''}</div>${reservation}${update}<div id="history" hidden></div>${attachments}${parts}<div class="section-head"><h2>Conversation</h2></div><div id="comments" aria-live="polite">Loading comments…</div><form id="comment-form">${field('Add a comment', 'body', 'textarea')}<div class="form-error" role="alert"></div><div class="editor-actions"><button class="secondary" type="submit">Post comment</button></div></form>`,
  );
  const reopen = async message => {
    await hooks.refresh();
    await orderEditor(id);
    if (message) toast(message);
  };
  if (canUpdate)
    bindForm($('#update-form'), async data => {
      await api(`/orders/${encodeURIComponent(id)}`, {method: 'PATCH', body: JSON.stringify(data)});
      await hooks.refresh();
      closeDialog();
      toast('Request updated.');
    });
  if ($('#edit-order')) $('#edit-order').onclick = () => editOrder(o);
  if ($('#delete-order'))
    confirmButton(
      $('#delete-order'),
      async () => {
        try {
          await api(`/orders/${encodeURIComponent(id)}`, {method: 'DELETE'});
          closeDialog();
          await hooks.refresh();
          toast('Request deleted. The activity log keeps a record.');
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
            `<div class="comment" data-comment="${escape(c.id)}"><strong>${escape(c.author)}</strong><small>${new Date(c.created_at).toLocaleString()}${c.edited_at ? ' · edited' : ''}</small>${c.user_id === me.id || manage() ? `<span class="comment-actions">${c.user_id === me.id ? `<button class="quiet-button" data-edit-comment="${escape(c.id)}">Edit</button>` : ''}<button class="quiet-button" data-delete-comment="${escape(c.id)}">Delete</button></span>` : ''}<p>${escape(c.body)}</p></div>`,
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
    )}${locationFields(o.building_id, o.asset_id || '')}<div class="field full" id="request-timing">${requestTiming(o.request_type, o)}</div>${field('Details', 'description', 'textarea', o.description, true)}</div>${formActions('Save details')}</form>`,
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
    await hooks.refresh();
    await orderEditor(o.id);
    toast(
      r.reservation_status === 'pending' && o.reservation_status !== 'pending'
        ? 'Saved. The new reservation time needs approval.'
        : 'Request details saved.',
    );
  });
}
