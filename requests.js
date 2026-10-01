import {randomUUID} from 'node:crypto';
import {queueNotificationEmail, emailConfigured} from './email.js';
import {audit, changes} from './audit.js';
import {can, canOn} from './permissions.js';

export const requestTypes = ['maintenance', 'schedule', 'technology'];
export const features = [...requestTypes, 'notifications', 'email', 'inventory'];
export const defaultPreferences = {
  created: true,
  assigned: true,
  status: true,
  comment: true,
  mention: true,
  due: true,
  email: true,
};
const eventKeys = ['created', 'assigned', 'status', 'comment'];
const optionalKeys = ['mention', 'due', 'email'];
export async function moduleSettings(db) {
  return Object.fromEntries((await db.query('SELECT * FROM modules')).map(row => [row.id, Number(row.enabled) === 1]));
}
export async function requireModule(db, type) {
  if (!requestTypes.includes(type))
    throw Object.assign(new Error('Choose Maintenance, Schedule, or Technology.'), {status: 400});
  if (!(await moduleSettings(db))[type])
    throw Object.assign(new Error('This request type is disabled. Contact your administrator.'), {status: 403});
}
export async function requireFeature(db, key, label) {
  if (!(await moduleSettings(db))[key])
    throw Object.assign(new Error(`${label} is turned off. Contact your administrator.`), {status: 403});
}
export async function preferences(db, userId) {
  const row = (await db.query('SELECT body FROM notification_preferences WHERE user_id=$1', [userId]))[0];
  return {...defaultPreferences, ...(row ? JSON.parse(row.body) : {})};
}
export async function notify(db, order, event, recipients, actorId, message) {
  const modules = await moduleSettings(db);
  if (!modules.notifications) return;
  for (const userId of new Set(recipients.filter(id => id && id !== actorId))) {
    const prefs = await preferences(db, userId);
    if (!prefs[event]) continue;
    const id = randomUUID(),
      created = new Date().toISOString();
    await db.query(
      'INSERT INTO notifications(id,user_id,order_id,event,message,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, userId, order.id, event, message, created],
    );
    (db.root || db).live?.toUsers([userId], 'notification', {
      id,
      order_id: order.id,
      event,
      message,
      created_at: created,
    });
    if (modules.email && prefs.email) {
      const user = (await db.query('SELECT id,email FROM users WHERE id=$1 AND active=1', [userId]))[0];
      if (user?.email) await queueNotificationEmail(db, user, order, message);
    }
  }
}
export async function visibleNotifications(db, user) {
  const enabled = await moduleSettings(db);
  const rows = await db.query(
    'SELECT n.*,w.title,w.request_type,w.requester_id,w.building_id FROM notifications n JOIN work_orders w ON w.id=n.order_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 100',
    [user.id],
  );
  return rows.filter(
    n => enabled[n.request_type] && (canOn(user, 'requests.view_all', n) || n.requester_id === user.id),
  );
}
export function setupSettings(app, db) {
  const admin = (req, res, next) =>
    can(req.user, 'admin.settings')
      ? next()
      : res.status(403).json({error: 'Your role cannot change workspace settings.'});
  app.patch('/api/settings', admin, async (req, res) => {
    const body = req.body;
    if (
      !body ||
      Array.isArray(body) ||
      !Object.keys(body).length ||
      Object.keys(body).some(k => !features.includes(k) || typeof body[k] !== 'boolean')
    )
      return res.status(400).json({error: 'Settings must contain known modules with true or false values.'});
    if (body.email && !emailConfigured())
      return res
        .status(400)
        .json({error: 'Configure SMTP on the server (SMTP_HOST or SMTP_URL, and SMTP_FROM) before enabling email.'});
    const before = await moduleSettings(db);
    // One statement avoids partially saving an organization's module selection.
    const params = [];
    const cases = Object.entries(body).map(([key, value]) => {
      params.push(key, value ? 1 : 0);
      return `WHEN $${params.length - 1} THEN $${params.length}`;
    });
    await db.query(`UPDATE modules SET enabled=CASE id ${cases.join(' ')} ELSE enabled END`, params);
    const after = await moduleSettings(db);
    const diff = changes(before, after, Object.keys(body));
    if (Object.keys(diff).length)
      await audit(
        db,
        req.user,
        'settings.modules',
        'settings',
        'modules',
        `Turned ${Object.entries(diff)
          .map(([k, [, v]]) => `${k} ${v ? 'on' : 'off'}`)
          .join(', ')}`,
        diff,
      );
    res.json({modules: after});
  });
  app.get('/api/preferences', async (req, res) => res.json(await preferences(db, req.user.id)));
  app.put('/api/preferences', async (req, res) => {
    const body = req.body;
    // The four event switches are required; the email switch is optional for older clients.
    if (
      !body ||
      Array.isArray(body) ||
      eventKeys.some(k => typeof body[k] !== 'boolean') ||
      Object.keys(body).some(k => !(k in defaultPreferences)) ||
      optionalKeys.some(k => body[k] !== undefined && typeof body[k] !== 'boolean')
    )
      return res.status(400).json({error: 'Provide true or false for all four notification preferences.'});
    const saved = {...(await preferences(db, req.user.id)), ...body};
    await db.query(
      'INSERT INTO notification_preferences(user_id,body) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET body=$2',
      [req.user.id, JSON.stringify(saved)],
    );
    res.json(saved);
  });
  app.get('/api/notifications', async (req, res) => res.json(await visibleNotifications(db, req.user)));
  app.post('/api/notifications/read', async (req, res) => {
    const rows = await visibleNotifications(db, req.user);
    const id = req.body?.id;
    if (id && !rows.some(n => n.id === id)) return res.status(404).json({error: 'Notification not found.'});
    for (const row of rows.filter(n => !n.read_at && (!id || n.id === id)))
      await db.query('UPDATE notifications SET read_at=$1 WHERE id=$2 AND user_id=$3', [
        new Date().toISOString(),
        row.id,
        req.user.id,
      ]);
    // Other open tabs of the same person update their badge.
    db.live?.toUsers([req.user.id], 'notification', {read: id || 'all'});
    res.json({ok: true});
  });
}
