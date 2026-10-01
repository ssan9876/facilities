import {error, date} from './validation.js';
import {can, requireCap} from './permissions.js';

const viewReports = requireCap('reports.view', 'Your role cannot view reports.');
const exportCsv = requireCap('reports.export', 'Your role cannot download exports.');
import {dateInTimezone, startOfDayUtc, addDays} from './dates.js';
import {moduleSettings} from './requests.js';
import {orderFilter, listOrders, ticketLabel} from './orders.js';
import {listParts} from './inventory.js';
import {csv} from './csv.js';

const n = v => Number(v || 0);
const hours = (dialect, from, to) =>
  dialect === 'postgres'
    ? `EXTRACT(EPOCH FROM (CAST(${to} AS timestamptz)-CAST(${from} AS timestamptz)))/3600.0`
    : `(julianday(${to})-julianday(${from}))*24.0`;

export async function buildReport(db, user, timezone, {from, to}) {
  const modules = await moduleSettings(db);
  const range = orderFilter(user, modules, {from, to}, timezone);
  const all = orderFilter(user, modules, {}, timezone);
  const joins =
    'FROM work_orders w JOIN buildings b ON b.id=w.building_id LEFT JOIN assets a ON a.id=w.asset_id LEFT JOIN users u ON u.id=w.assignee_id LEFT JOIN spaces s ON s.id=w.space_id';
  const and = (f, cond) => `${f.where} AND ${cond}`;
  const startUtc = startOfDayUtc(from, timezone),
    endUtc = startOfDayUtc(addDays(to, 1), timezone);
  const group = async (column, label, f = range) =>
    (
      await db.query(
        `SELECT ${column} AS key, ${label ? label + ' AS label,' : ''} COUNT(*) AS count, SUM(CASE WHEN w.status='Completed' THEN 1 ELSE 0 END) AS completed ${joins} ${f.where} GROUP BY ${column}${label ? ', ' + label : ''} ORDER BY count DESC`,
        f.values,
      )
    ).map(r => ({key: r.key, label: r.label ?? r.key, count: n(r.count), completed: n(r.completed)}));
  // Completion is reported by completion date, independent of when the request was opened.
  const completedValues = [...all.values, startUtc, endUtc];
  const completedRange = and(
    all,
    `w.completed_at>=$${all.values.length + 1} AND w.completed_at<$${all.values.length + 2}`,
  );
  const [created] = await db.query(`SELECT COUNT(*) AS count ${joins} ${range.where}`, range.values);
  const [completed] = await db.query(
    `SELECT COUNT(*) AS count, AVG(${hours(db.dialect, 'w.created_at', 'w.completed_at')}) AS avg_hours ${joins} ${completedRange}`,
    completedValues,
  );
  const today = dateInTimezone(timezone);
  const [open] = await db.query(
    `SELECT COUNT(*) AS count, SUM(CASE WHEN w.due_date<$${all.values.length + 1} THEN 1 ELSE 0 END) AS overdue ${joins} ${and(all, "w.status<>'Completed'")}`,
    [...all.values, today],
  );
  const byAssignee = (
    await db.query(
      `SELECT w.assignee_id AS key, u.name AS label, COUNT(*) AS count ${joins} ${completedRange} GROUP BY w.assignee_id, u.name ORDER BY count DESC`,
      completedValues,
    )
  ).map(r => ({key: r.key, label: r.label || 'Unassigned', count: n(r.count)}));
  // Preventive maintenance compliance: generated occurrences due in the range, completed by their due date.
  let maintenance = null;
  if (modules.maintenance && can(user, 'maintenance.view')) {
    const [pm] = await db.query(
      "SELECT COUNT(*) AS due, SUM(CASE WHEN w.status='Completed' THEN 1 ELSE 0 END) AS completed FROM maintenance_runs m JOIN work_orders w ON w.id=m.work_order_id WHERE m.due_date>=$1 AND m.due_date<=$2",
      [from, to],
    );
    // completed_at is UTC; compare per row against the end of its due day in the organization timezone.
    const rows = await db.query(
      "SELECT m.due_date,w.completed_at FROM maintenance_runs m JOIN work_orders w ON w.id=m.work_order_id WHERE m.due_date>=$1 AND m.due_date<=$2 AND w.status='Completed'",
      [from, to],
    );
    const onTime = rows.filter(r => r.completed_at < startOfDayUtc(addDays(r.due_date, 1), timezone)).length;
    maintenance = {due: n(pm.due), completed: n(pm.completed), onTime};
  }
  let parts = null;
  if (modules.inventory && can(user, 'inventory.view')) {
    const rows = await db.query(
      'SELECT t.id,t.name,t.sku,SUM(p.quantity) AS quantity,SUM(p.quantity*COALESCE(t.unit_cost_cents,0)) AS cost FROM part_usage p JOIN parts t ON t.id=p.part_id WHERE p.created_at>=$1 AND p.created_at<$2 GROUP BY t.id,t.name,t.sku ORDER BY quantity DESC',
      [startUtc, endUtc],
    );
    parts = {
      items: rows.map(r => ({id: r.id, name: r.name, sku: r.sku, quantity: n(r.quantity), costCents: n(r.cost)})),
      totalCostCents: rows.reduce((s, r) => s + n(r.cost), 0),
    };
  }
  // Labor: time logged on visible tickets, by when the time was logged.
  const laborFrom =
    'FROM time_entries t JOIN users tu ON tu.id=t.user_id JOIN work_orders w ON w.id=t.order_id JOIN buildings b ON b.id=w.building_id LEFT JOIN assets a ON a.id=w.asset_id LEFT JOIN users u ON u.id=w.assignee_id LEFT JOIN spaces s ON s.id=w.space_id';
  const laborWhere = and(all, `t.ended_at>=$${all.values.length + 1} AND t.ended_at<$${all.values.length + 2}`);
  const laborGroup = async (key, label) =>
    (
      await db.query(
        `SELECT ${key} AS key, ${label} AS label, SUM(t.minutes) AS minutes ${laborFrom} ${laborWhere} GROUP BY ${key}, ${label} ORDER BY minutes DESC`,
        [...all.values, startUtc, endUtc],
      )
    ).map(r => ({key: r.key, label: r.label, minutes: n(r.minutes)}));
  const laborByPerson = await laborGroup('t.user_id', 'tu.name');
  const labor = {
    totalMinutes: laborByPerson.reduce((sum, r) => sum + r.minutes, 0),
    byPerson: laborByPerson,
    byBuilding: await laborGroup('w.building_id', 'b.name'),
  };
  return {
    from,
    to,
    timezone,
    labor,
    created: n(created.count),
    completed: n(completed.count),
    averageHoursToComplete: completed.avg_hours == null ? null : Math.round(Number(completed.avg_hours) * 10) / 10,
    openNow: n(open.count),
    overdueNow: n(open.overdue),
    byType: await group('w.request_type'),
    byStatus: await group('w.status'),
    byPriority: await group('w.priority'),
    byBuilding: await group('w.building_id', 'b.name'),
    completedByAssignee: byAssignee,
    maintenance,
    parts,
  };
}

export function setupReports(app, db, env) {
  const timezone = env.ORG_TIMEZONE || 'America/Phoenix';
  const range = req => {
    const to = req.query.to ? date(String(req.query.to)) : dateInTimezone(timezone);
    const from = req.query.from ? date(String(req.query.from)) : addDays(to, -29);
    if (from > to) throw error('The start date must be on or before the end date.');
    if (Date.parse(to) - Date.parse(from) > 3660 * 86400000) throw error('Choose a range of ten years or less.');
    return {from, to};
  };
  app.get('/api/reports/summary', viewReports, async (req, res) =>
    res.json(await buildReport(db, req.user, timezone, range(req))),
  );
  const stamp = () => dateInTimezone(timezone);
  // The order export honours the same filters as the register, so "export what I see" is exact.
  app.get('/api/reports/orders.csv', exportCsv, async (req, res) => {
    const {orders} = await listOrders(db, req.user, req.query, timezone, {limit: 100000, offset: 0});
    // Custom answers export as one "Question: answer" cell per request.
    const answers = new Map(),
      labor = new Map();
    for (let i = 0; i < orders.length; i += 500) {
      const ids = orders.slice(i, i + 500).map(o => o.id);
      if (!ids.length) continue;
      const rows = await db.query(
        `SELECT a.order_id, f.label, a.value FROM order_answers a JOIN form_fields f ON f.id=a.field_id WHERE a.order_id IN (${ids.map((_, n) => '$' + (n + 1)).join(',')}) ORDER BY f.sort, f.created_at`,
        ids,
      );
      for (const r of rows) answers.set(r.order_id, [...(answers.get(r.order_id) || []), `${r.label}: ${r.value}`]);
      for (const r of await db.query(
        `SELECT order_id, SUM(minutes) AS minutes FROM time_entries WHERE order_id IN (${ids.map((_, n) => '$' + (n + 1)).join(',')}) GROUP BY order_id`,
        ids,
      ))
        labor.set(r.order_id, n(r.minutes));
    }
    res
      .attachment(`requests-${stamp()}.csv`)
      .type('text/csv')
      .send(
        csv(
          [
            'Ticket',
            'ID',
            'Type',
            'Category',
            'Title',
            'Status',
            'Priority',
            'Building',
            'Asset',
            'Space',
            'Reservation',
            'Requester',
            'Assigned to',
            'Due',
            'Starts',
            'Ends',
            'Created',
            'Completed',
            'Description',
            'Answers',
            'Labor minutes',
          ],
          orders.map(o => [
            ticketLabel(o.number),
            o.id,
            o.request_type,
            o.category,
            o.title,
            o.status,
            o.priority,
            o.building,
            o.asset,
            o.space,
            o.reservation_status,
            o.requester,
            o.assignee,
            o.due_date,
            o.starts_at,
            o.ends_at,
            o.created_at,
            o.completed_at,
            o.description,
            (answers.get(o.id) || []).join('; '),
            labor.get(o.id) || 0,
          ]),
        ),
      );
  });
  app.get('/api/reports/assets.csv', exportCsv, async (req, res) => {
    const rows = await db.query(
      'SELECT a.*,b.name AS building FROM assets a JOIN buildings b ON b.id=a.building_id ORDER BY b.name,a.name',
    );
    res
      .attachment(`assets-${stamp()}.csv`)
      .type('text/csv')
      .send(
        csv(
          ['ID', 'Asset', 'Category', 'Building', 'Serial', 'Archived', 'Created'],
          rows.map(a => [a.id, a.name, a.category, a.building, a.serial, a.archived_at, a.created_at]),
        ),
      );
  });
  app.get('/api/reports/maintenance.csv', exportCsv, async (req, res) => {
    const rows = await db.query(
      'SELECT m.*,b.name AS building,a.name AS asset FROM maintenance m JOIN buildings b ON b.id=m.building_id LEFT JOIN assets a ON a.id=m.asset_id ORDER BY m.next_due',
    );
    res
      .attachment(`maintenance-plans-${stamp()}.csv`)
      .type('text/csv')
      .send(
        csv(
          ['ID', 'Plan', 'Building', 'Asset', 'Every (days)', 'Next due', 'Active'],
          rows.map(m => [
            m.id,
            m.title,
            m.building,
            m.asset,
            m.interval_days,
            m.next_due,
            Number(m.active) ? 'Yes' : 'No',
          ]),
        ),
      );
  });
  app.get('/api/reports/parts.csv', exportCsv, async (req, res) => {
    const rows = await listParts(db);
    res
      .attachment(`parts-${stamp()}.csv`)
      .type('text/csv')
      .send(
        csv(
          ['ID', 'Part', 'SKU', 'Building', 'Location', 'On hand', 'Reorder level', 'Unit cost', 'Archived'],
          rows.map(p => [
            p.id,
            p.name,
            p.sku,
            p.building,
            p.location,
            p.quantity,
            p.min_quantity,
            p.unit_cost_cents == null ? '' : (p.unit_cost_cents / 100).toFixed(2),
            p.archived_at,
          ]),
        ),
      );
  });
}
