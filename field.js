// Field work: an asset's history (tickets, maintenance, parts and labor, with a repeat-problem flag),
// its page address, and the QR decoder used by the in-app scanner where the browser has none.
import {fileURLToPath} from 'node:url';
import {error} from './validation.js';
import {can} from './permissions.js';
import {moduleSettings} from './requests.js';
import {listOrders} from './orders.js';

const DAY = 86400000;

// "Repeat problem": three or more tickets in 90 days, or two in the same category within 60.
export function repeatSignal(tickets, now = Date.now()) {
  const recent = tickets.filter(t => now - Date.parse(t.created_at) <= 90 * DAY);
  const byCategory = {};
  for (const t of tickets.filter(x => x.category && now - Date.parse(x.created_at) <= 60 * DAY))
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  const category = Object.entries(byCategory).find(([, n]) => n >= 2)?.[0] || null;
  if (recent.length >= 3) return {repeat: true, reason: `${recent.length} requests in the last 90 days`};
  if (category) return {repeat: true, reason: `${byCategory[category]} “${category}” requests in the last 60 days`};
  return {repeat: false, reason: null};
}

export function setupField(app, db, env) {
  const timezone = env.ORG_TIMEZONE || 'America/Phoenix';
  const index = fileURLToPath(new URL('./public/index.html', import.meta.url));
  app.get('/assets/:id', (req, res) => res.sendFile(index));
  app.get('/vendor/jsqr.js', (req, res) =>
    res
      .type('application/javascript')
      .set('Cache-Control', 'public, max-age=86400')
      .sendFile(fileURLToPath(new URL('./node_modules/jsqr/dist/jsQR.js', import.meta.url))),
  );

  app.get('/api/assets/:id/history', async (req, res) => {
    const asset = (
      await db.query(
        'SELECT a.*,b.name AS building FROM assets a JOIN buildings b ON b.id=a.building_id WHERE a.id=$1',
        [req.params.id],
      )
    )[0];
    if (!asset) throw error('Asset not found.', 404);
    const modules = await moduleSettings(db);
    // Tickets the person may see (their own, assigned, followed, or in their role's scope).
    const {orders: tickets} = await listOrders(db, req.user, {asset: asset.id, sort: 'newest'}, timezone, {
      limit: 200,
      offset: 0,
    });
    const ids = tickets.map(t => t.id);
    const inList = ids.map((_, i) => '$' + (i + 1)).join(',');
    const [parts, labor] = ids.length
      ? await Promise.all([
          modules.inventory && can(req.user, 'inventory.view')
            ? db.query(
                `SELECT p.work_order_id,p.quantity,p.created_at,t.name,t.unit_cost_cents FROM part_usage p JOIN parts t ON t.id=p.part_id WHERE p.work_order_id IN (${inList}) ORDER BY p.created_at DESC`,
                ids,
              )
            : [],
          db.query(
            `SELECT order_id, SUM(minutes) AS minutes FROM time_entries WHERE order_id IN (${inList}) GROUP BY order_id`,
            ids,
          ),
        ])
      : [[], []];
    const plans =
      modules.maintenance && can(req.user, 'maintenance.view')
        ? await db.query(
            'SELECT id,title,interval_days,next_due,active FROM maintenance WHERE asset_id=$1 ORDER BY next_due',
            [asset.id],
          )
        : [];
    const runs = plans.length
      ? await db.query(
          `SELECT r.plan_id,r.due_date,r.work_order_id,w.status,w.completed_at FROM maintenance_runs r JOIN work_orders w ON w.id=r.work_order_id WHERE r.plan_id IN (${plans.map((_, i) => '$' + (i + 1)).join(',')}) ORDER BY r.due_date DESC LIMIT 50`,
          plans.map(p => p.id),
        )
      : [];
    const laborMinutes = labor.reduce((n, r) => n + Number(r.minutes || 0), 0);
    const partsCost = parts.reduce((n, p) => n + (p.unit_cost_cents || 0) * p.quantity, 0);
    res.json({
      asset: {
        id: asset.id,
        name: asset.name,
        building_id: asset.building_id,
        building: asset.building,
        category: asset.category,
        serial: asset.serial,
        archived_at: asset.archived_at,
      },
      tickets,
      open: tickets.filter(t => t.status !== 'Completed').length,
      last_completed: tickets.find(t => t.completed_at)?.completed_at || null,
      parts,
      parts_cost_cents: partsCost,
      labor_minutes: laborMinutes,
      plans,
      runs,
      ...repeatSignal(tickets),
    });
  });
}
