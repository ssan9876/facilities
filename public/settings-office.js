// Settings → Import (CSV for buildings, assets, parts and people) and Settings → Integrations (Slack,
// Microsoft Teams and JSON webhooks).
import {
  state,
  $,
  $$,
  escape as e,
  icon,
  api,
  toast,
  dialog,
  closeDialog,
  field,
  select,
  bindForm,
  formActions,
  bindCancel,
  confirmButton,
  tag,
  fmtStamp,
} from './ui.js';

const kinds = [
  ['buildings', 'Buildings', 'records.manage'],
  ['assets', 'Assets', 'records.manage'],
  ['parts', 'Parts', 'inventory.manage'],
  ['people', 'People', 'admin.people'],
];

export function officeUI(st) {
  if (st.settingsTab === 'integrations') return integrationsUI(st);
  const allowed = kinds.filter(([, , cap]) => st.me.user.capabilities.includes(cap));
  const kind = allowed.some(k => k[0] === st.importKind) ? st.importKind : allowed[0]?.[0];
  st.importKind = kind;
  const result = st.importResult;
  return `<section class="settings-sheet wide-sheet"><div class="sheet-heading"><h2>Import from a spreadsheet</h2><p>Set up a workspace quickly from CSV files. Choose what to import, download the template, fill it in, then preview: every row is checked before anything is created.</p></div><div class="import-controls"><div class="tabs" role="group" aria-label="What to import">${allowed.map(([k, label]) => `<button type="button" data-import-kind="${k}" class="${k === kind ? 'selected' : ''}">${label}</button>`).join('')}</div><a class="quiet-button" href="/api/import/${kind}/template.csv" download>${icon('download')}Template</a><label class="secondary upload-button">${icon('upload')}Choose CSV file<input type="file" id="import-file" accept=".csv,text/csv"></label></div>${
    result
      ? `<div class="sheet-heading import-result"><p><strong>${e(result.name)}</strong>: ${result.valid} ready, ${result.invalid} with problems${result.created ? `, <strong>${result.created} imported</strong>` : ''}.</p><div class="table-wrap"><table><thead><tr><th>Line</th>${Object.keys(
          result.rows[0]?.values || {},
        )
          .map(c => `<th>${e(c)}</th>`)
          .join('')}<th>Check</th></tr></thead><tbody>${result.rows
          .slice(0, 200)
          .map(
            r =>
              `<tr class="${r.error ? 'row-error' : ''}"><td>${r.line}</td>${Object.values(r.values)
                .map(v => `<td>${e(v)}</td>`)
                .join('')}<td>${r.error ? e(r.error) : result.created ? 'Imported' : 'Ready'}</td></tr>`,
          )
          .join(
            '',
          )}</tbody></table></div>${result.created ? '' : `<div class="settings-footer"><p>${result.invalid ? 'Rows with problems are skipped.' : 'Every row is ready.'}</p><button type="button" class="primary" data-import-apply ${result.valid ? '' : 'disabled'}>Import ${result.valid} row${result.valid === 1 ? '' : 's'}</button></div>`}</div>`
      : ''
  }</section>`;
}

function integrationsUI(st) {
  const info = st.webhookInfo;
  if (!info)
    return '<section class="settings-sheet" data-webhooks-loading><div class="empty">Loading integrations…</div></section>';
  const kindLabel = {slack: 'Slack', teams: 'Microsoft Teams', json: 'JSON webhook'};
  return `<section class="settings-sheet wide-sheet"><div class="sheet-heading sheet-toolbar"><div><h2>Integrations</h2><p>Post ticket events to Slack or Microsoft Teams channels, or to your own system as signed JSON. Failed deliveries are retried.</p></div><button class="primary" data-new-webhook>${icon('plus')}Add integration</button></div>${
    st.newWebhookSecret
      ? `<div class="sheet-heading notice"><strong>Signing secret (shown once).</strong> Verify the <code>X-Facilities-Signature</code> header (<code>sha256=</code> HMAC of the body) with it.<pre class="update-command">${e(st.newWebhookSecret)}</pre><button class="quiet-button" data-dismiss-secret>I saved the secret</button></div>`
      : ''
  }${
    info.webhooks.length
      ? `<div class="table-wrap"><table><thead><tr><th>Integration</th><th>Events</th><th>Last delivery</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${info.webhooks
          .map(
            h =>
              `<tr><td><strong>${e(h.name)}</strong><div class="order-sub">${kindLabel[h.kind]} · ${e(new URL(h.url).host)}${h.active ? '' : ' · paused'}</div></td><td>${h.events.map(x => e(info.events[x])).join(', ')}</td><td>${h.last_at ? `${/^2/.test(h.last_status) ? tag('completed', 'OK') : tag('urgent', h.last_status || 'Failed')} <small>${fmtStamp(h.last_at)}</small>` : '—'}</td><td class="row-actions"><button class="quiet-button" data-test-webhook="${e(h.id)}">Send test</button><button class="quiet-button" data-edit-webhook="${e(h.id)}" aria-label="Edit ${e(h.name)}">${icon('edit')}Edit</button><button class="quiet-button" data-delete-webhook="${e(h.id)}">Delete</button></td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<div class="empty">No integrations yet.</div>'
  }</section>`;
}

export function bindOffice(st, render) {
  // ---- Import ----
  $$('[data-import-kind]').forEach(
    b =>
      (b.onclick = () => {
        st.importKind = b.dataset.importKind;
        st.importResult = null;
        render();
      }),
  );
  const file = $('#import-file');
  if (file)
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      const csv = await f.text();
      try {
        const r = await api('/import/' + st.importKind, {method: 'POST', body: JSON.stringify({csv})});
        st.importResult = {...r, name: f.name, csv};
        render();
      } catch (err) {
        toast(err.message);
      }
    };
  const apply = $('[data-import-apply]');
  if (apply)
    apply.onclick = async () => {
      apply.disabled = true;
      try {
        const r = await api('/import/' + st.importKind, {
          method: 'POST',
          body: JSON.stringify({csv: st.importResult.csv, apply: true}),
        });
        st.importResult = {...st.importResult, ...r};
        render();
        toast(`${r.created} imported.`);
      } catch (err) {
        toast(err.message);
        apply.disabled = false;
      }
    };
  // ---- Integrations ----
  if ($('[data-webhooks-loading]') && !st.webhooksLoading) {
    st.webhooksLoading = true;
    api('/admin/webhooks')
      .then(r => (st.webhookInfo = r))
      .catch(err => toast(err.message))
      .finally(() => {
        st.webhooksLoading = false;
        render();
      });
  }
  const sheet = h => {
    const events = st.webhookInfo.events;
    dialog(
      h ? h.name : 'Add integration',
      `<form id="webhook-form"><div class="form-grid">${field('Name', 'name', 'text', h?.name || '').replace('class="field ', 'class="field full ')}${select(
        'Send to',
        'kind',
        [
          ['slack', 'Slack (incoming webhook)'],
          ['teams', 'Microsoft Teams (Workflows webhook)'],
          ['json', 'JSON webhook (signed)'],
        ],
        h?.kind || 'slack',
      )}${field('Webhook address', 'url', 'url', h?.url || '', false, 'placeholder="https://hooks.slack.com/services/…"').replace('class="field ', 'class="field full ')}<fieldset class="field full check-group"><legend>Events</legend>${Object.entries(
        events,
      )
        .map(
          ([k, l]) =>
            `<label class="field-check inline"><input type="checkbox" name="event" value="${k}" ${(h?.events || ['created', 'assigned', 'resolved']).includes(k) ? 'checked' : ''}>${e(l)}</label>`,
        )
        .join(
          '',
        )}</fieldset>${h ? `<label class="field-check full"><input type="checkbox" name="active" ${h.active ? 'checked' : ''}>Active</label>` : ''}</div>${formActions(h ? 'Save integration' : 'Add integration')}</form>`,
    );
    bindCancel();
    bindForm($('#webhook-form'), async (data, f) => {
      const body = {
        name: data.name,
        kind: data.kind,
        url: data.url,
        events: $$('#webhook-form [name=event]:checked').map(i => i.value),
        ...(h ? {active: f.active.checked} : {}),
      };
      const r = await api(h ? '/admin/webhooks/' + h.id : '/admin/webhooks', {
        method: h ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      st.webhookInfo = {...st.webhookInfo, webhooks: r.webhooks};
      if (r.secret) st.newWebhookSecret = r.secret;
      closeDialog();
      render();
      toast(h ? 'Integration saved.' : 'Integration added. Use “Send test” to check it.');
    });
  };
  const add = $('[data-new-webhook]');
  if (add) add.onclick = () => sheet(null);
  $$('[data-edit-webhook]').forEach(
    b => (b.onclick = () => sheet(st.webhookInfo.webhooks.find(h => h.id === b.dataset.editWebhook))),
  );
  $$('[data-delete-webhook]').forEach(b =>
    confirmButton(
      b,
      async () => {
        st.webhookInfo = {
          ...st.webhookInfo,
          ...(await api('/admin/webhooks/' + b.dataset.deleteWebhook, {method: 'DELETE'})),
        };
        render();
      },
      'Delete?',
    ),
  );
  $$('[data-test-webhook]').forEach(
    b =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api(`/admin/webhooks/${b.dataset.testWebhook}/test`, {method: 'POST'});
          toast(/^2/.test(r.status) ? 'Test delivered.' : `Test failed: ${r.error || r.status}`);
          st.webhookInfo = await api('/admin/webhooks');
          render();
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      }),
  );
  const dismiss = $('[data-dismiss-secret]');
  if (dismiss)
    dismiss.onclick = () => {
      st.newWebhookSecret = null;
      render();
    };
  void state;
}
