// Settings → Backups & data: nightly backup status, "back up now", and data retention.
import {$, escape, api, toast, bytes, fmtStamp, field, bindForm} from './ui.js';

const ago = iso => {
  if (!iso) return 'Never';
  const hours = (Date.now() - Date.parse(iso)) / 3600000;
  const when = fmtStamp(iso);
  return hours < 1
    ? `${when} (within the hour)`
    : hours < 48
      ? `${when} (${Math.round(hours)} h ago)`
      : `${when} (${Math.round(hours / 24)} days ago)`;
};

export function dataUI(state) {
  const b = state.backupInfo,
    r = state.retention;
  if (!b || !r)
    return '<section class="settings-sheet" data-data-loading><div class="empty">Loading backups and retention…</div></section>';
  const st = b.status;
  const stale = st?.last_success && Date.now() - Date.parse(st.last_success) > 36 * 3600000;
  const backups = !b.agent
    ? `<div class="sheet-heading"><h2>Backups</h2><p>Backups run on the server. Install the server agent once to schedule nightly backups and enable this page:</p><pre class="update-command">sudo /opt/facilities/bin/facilities-update --install-agent</pre><p class="settings-copy">The updater also backs up the database before every update.</p></div>`
    : `<div class="sheet-heading sheet-toolbar"><div><h2>Backups</h2><p>The database (including attachments) is backed up every night and before every update. Nightly backups are kept for ${st?.keep_days ?? 14} days.</p></div><button type="button" class="primary" data-backup-now ${b.pending || st?.state === 'running' ? 'disabled' : ''}>${b.pending || st?.state === 'running' ? 'Backing up…' : 'Back up now'}</button></div><div class="settings-list backup-facts"><div><strong>Last successful backup</strong><span class="${stale ? 'overdue' : ''}">${escape(ago(st?.last_success))}${stale ? ' · older than a day' : ''}</span></div><div><strong>Latest run</strong><span class="${st?.state === 'failed' ? 'overdue' : ''}">${st ? escape(st.message || st.state) : 'No backup has run yet.'}</span></div><div><strong>Copy off the server</strong><span>${st?.copy_to ? (st.copied ? 'Copied with the latest backup' : 'Configured; latest copy did not complete') : 'Not configured. Set BACKUP_COPY_TO in /opt/facilities/.env'}</span></div></div>${
        st?.recent?.length
          ? `<div class="table-wrap"><table><thead><tr><th>Backup file</th><th>Size</th><th>Saved</th></tr></thead><tbody>${st.recent.map(f => `<tr><td>${escape(f.name)}</td><td>${bytes(f.size)}</td><td>${escape(fmtStamp(f.at))}</td></tr>`).join('')}</tbody></table></div>`
          : ''
      }<div class="sheet-heading"><p>Backups are stored in <code>/opt/facilities/backups</code> on the server. To restore one, stop the app and load it into an empty database; see the README's restore steps.</p></div>`;
  const retention = `<form id="retention-form"><div class="sheet-heading"><h2>Data retention</h2><p>Older records are removed every hour. Use 0 to keep a kind of record forever.</p></div><div class="form-grid retention-grid">${field('Notifications (days)', 'notifications_days', 'number', r.notifications_days, false, 'min="0" max="3650"')}${field('Audit log (days)', 'audit_days', 'number', r.audit_days, false, 'min="0" max="3650"')}${field('Sent and failed emails (days)', 'email_days', 'number', r.email_days, false, 'min="0" max="3650"')}</div><div class="settings-footer"><p>The audit log keeps at least 90 days. Requests, comments and attachments are never removed by retention.</p><div class="form-error" role="alert"></div><button type="submit" class="primary">Save retention</button></div></form>`;
  return `<section class="settings-sheet">${backups}</section><section class="settings-sheet data-sheet">${retention}</section>`;
}

export function bindData(state, render) {
  // Backup progress is streamed (live:backup) instead of polled.
  if (!state.backupListener) {
    state.backupListener = true;
    addEventListener('live:backup', async () => {
      try {
        state.backupInfo = await api('/admin/backups');
      } catch {
        return;
      }
      if (state.backupWatching && !state.backupInfo.pending && state.backupInfo.status?.state !== 'running') {
        state.backupWatching = false;
        toast(state.backupInfo.status?.state === 'failed' ? 'The backup failed.' : 'Backup finished.');
      }
      if (state.settingsTab === 'data' && state.page === 'settings') render();
    });
  }
  const load = async () => {
    [state.backupInfo, state.retention] = await Promise.all([api('/admin/backups'), api('/admin/retention')]);
  };
  if ($('[data-data-loading]') && !state.dataLoading) {
    state.dataLoading = true;
    load()
      .catch(e => toast(e.message))
      .finally(() => {
        state.dataLoading = false;
        render();
      });
  }
  const now = $('[data-backup-now]');
  if (now)
    now.onclick = async () => {
      now.disabled = true;
      try {
        state.backupInfo = await api('/admin/backups', {method: 'POST'});
        toast('Backup started. This page updates when it finishes.');
        render();
        state.backupWatching = true;
      } catch (e) {
        toast(e.message);
        now.disabled = false;
      }
    };
  const form = $('#retention-form');
  if (form)
    bindForm(form, async data => {
      const r = await api('/admin/retention', {method: 'PUT', body: JSON.stringify(data)});
      state.retention = r;
      const removed = r.removed.notifications + r.removed.audit + r.removed.email;
      toast(
        removed ? `Retention saved. ${removed} older record${removed === 1 ? '' : 's'} removed.` : 'Retention saved.',
      );
      render();
    });
}
