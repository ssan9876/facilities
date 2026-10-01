import {promises as fs, constants} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {admin, error} from './validation.js';
import {audit, systemActor} from './audit.js';

// Data retention: how long notifications, audit entries and finished emails are kept. 0 keeps forever.
export const retentionDefaults = {notifications_days: 180, audit_days: 730, email_days: 30};
export async function retentionSettings(db) {
  const row = (await db.query("SELECT body FROM admin_settings WHERE id='retention'"))[0];
  return {...retentionDefaults, ...(row ? JSON.parse(row.body) : {})};
}
const cutoff = days => new Date(Date.now() - days * 86400000).toISOString();

export async function purgeOldData(db) {
  const r = await retentionSettings(db);
  const removed = {notifications: 0, audit: 0, email: 0};
  const count = async (sql, values) => Number((await db.query(sql, values))[0].n);
  if (r.notifications_days) {
    const at = cutoff(r.notifications_days);
    removed.notifications = await count('SELECT COUNT(*) AS n FROM notifications WHERE created_at<$1', [at]);
    if (removed.notifications) await db.query('DELETE FROM notifications WHERE created_at<$1', [at]);
  }
  if (r.email_days) {
    const at = cutoff(r.email_days);
    const finished = '(sent_at IS NOT NULL OR attempts>=5) AND created_at<$1';
    removed.email = await count(`SELECT COUNT(*) AS n FROM email_outbox WHERE ${finished}`, [at]);
    if (removed.email) await db.query(`DELETE FROM email_outbox WHERE ${finished}`, [at]);
  }
  if (r.audit_days) {
    const at = cutoff(r.audit_days);
    removed.audit = await count('SELECT COUNT(*) AS n FROM audit_log WHERE created_at<$1', [at]);
    if (removed.audit) {
      await db.query('DELETE FROM audit_log WHERE created_at<$1', [at]);
      // The trimming itself stays on record.
      await audit(
        db,
        systemActor,
        'retention.purge',
        'settings',
        'retention',
        `Retention removed ${removed.audit} audit entr${removed.audit === 1 ? 'y' : 'ies'} older than ${r.audit_days} days`,
      );
    }
  }
  return removed;
}

export function setupHousekeeping(app, db, env) {
  app.get('/api/admin/retention', admin, async (req, res) => res.json(await retentionSettings(db)));
  app.put('/api/admin/retention', admin, async (req, res) => {
    const before = await retentionSettings(db);
    const next = {};
    for (const key of Object.keys(retentionDefaults)) {
      const value = req.body?.[key] === undefined ? before[key] : Number(req.body[key]);
      if (!Number.isInteger(value) || value < 0 || value > 3650)
        throw error('Retention must be whole days between 0 (keep forever) and 3650.');
      // Short audit retention would defeat its purpose; keep at least 90 days.
      if (key === 'audit_days' && value && value < 90)
        throw error('Keep audit entries for at least 90 days, or 0 to keep them forever.');
      next[key] = value;
    }
    await db.query("INSERT INTO admin_settings(id,body) VALUES('retention',$1) ON CONFLICT(id) DO UPDATE SET body=$1", [
      JSON.stringify(next),
    ]);
    const diff = Object.fromEntries(
      Object.keys(next)
        .filter(k => next[k] !== before[k])
        .map(k => [k, [before[k], next[k]]]),
    );
    if (Object.keys(diff).length)
      await audit(db, req.user, 'settings.retention', 'settings', 'retention', 'Updated data retention', diff);
    res.json({...next, removed: await purgeOldData(db)});
  });

  // Backups run on the host (facilities-update --backup, nightly timer); the app reads their
  // status and can ask for one now through the same shared folder the update agent uses.
  const dir = env.UPDATE_DIR;
  const backupState = async () => {
    if (!dir) return {agent: false};
    try {
      await fs.access(dir, constants.W_OK);
    } catch {
      return {agent: false};
    }
    let status = null,
      pending = false;
    try {
      status = JSON.parse(await fs.readFile(join(dir, 'backup.json'), 'utf8'));
    } catch {
      /* no backup has run yet */
    }
    try {
      await fs.access(join(dir, 'backup-request.json'));
      pending = true;
    } catch {
      /* none waiting */
    }
    return {agent: true, status, pending};
  };
  app.get('/api/admin/backups', admin, async (req, res) => res.json(await backupState()));
  app.post('/api/admin/backups', admin, async (req, res) => {
    const state = await backupState();
    if (!state.agent)
      return res.status(503).json({
        error:
          'Backups are managed on the server. Run sudo /opt/facilities/bin/facilities-update --install-agent once.',
      });
    if (state.pending || state.status?.state === 'running')
      return res.status(409).json({error: 'A backup is already running.'});
    const id = randomUUID();
    const tmp = join(dir, `.backup-${id}.json`);
    await fs.writeFile(tmp, JSON.stringify({id, requested_by: req.user.name, at: new Date().toISOString()}));
    await fs.rename(tmp, join(dir, 'backup-request.json'));
    await audit(db, req.user, 'backup.request', 'settings', 'backups', 'Requested a database backup');
    res.status(202).json(await backupState());
  });
}
