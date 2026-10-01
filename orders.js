import {randomUUID} from 'node:crypto';
import {statuses, priorities, error, text, date, localTime, likePattern} from './validation.js';
import {can, canOn, canSubmit, requireCap, scopeSql, usersWith} from './permissions.js';
import {autoAssign} from './access.js';
import {dateInTimezone, startOfDayUtc, addDays} from './dates.js';
import {moduleSettings, requireModule, notify} from './requests.js';
import {audit, auditQuery, changes} from './audit.js';
import {reserveSpace} from './reservations.js';
import {checkSubmission, saveAnswers, answersFor} from './requestforms.js';

const orderColumns =
  'w.*, b.name AS building, a.name AS asset, u.name AS assignee, r.name AS requester, s.name AS space, c.name AS category';
const orderJoins =
  'FROM work_orders w JOIN buildings b ON b.id=w.building_id LEFT JOIN assets a ON a.id=w.asset_id LEFT JOIN users u ON u.id=w.assignee_id JOIN users r ON r.id=w.requester_id LEFT JOIN spaces s ON s.id=w.space_id LEFT JOIN categories c ON c.id=w.category_id';
const detailFields = [
  'title',
  'description',
  'priority',
  'due_date',
  'building_id',
  'asset_id',
  'starts_at',
  'ends_at',
  'space_id',
  'category_id',
  'answers',
];

// Allocates the next ticket number atomically; safe across concurrent requests and processes.
export async function assignTicketNumber(conn, id) {
  const [{value}] = await conn.query("UPDATE counters SET value=value+1 WHERE id='work_order' RETURNING value");
  await conn.query('UPDATE work_orders SET number=$1 WHERE id=$2 AND number IS NULL', [Number(value), id]);
  return Number(value);
}
export const ticketLabel = number => (number ? `WO-${String(number).padStart(4, '0')}` : 'WO-—');

// Shared by the register, CSV export and reports so every view applies identical access rules.
export function orderFilter(user, modules, params, timezone) {
  const where = [],
    values = [];
  const add = (sql, ...vals) => {
    let s = sql;
    for (const v of vals) {
      values.push(v);
      s = s.replace('?', '$' + values.length);
    }
    where.push(s);
  };
  const enabled = ['maintenance', 'schedule', 'technology'].filter(t => modules[t]);
  if (!enabled.length) where.push('1=0');
  else add(`w.request_type IN (${enabled.map(() => '?').join(',')})`, ...enabled);
  // Everyone sees their own requests; "see every request" covers the request types and buildings in scope.
  const visible = scopeSql(user, 'requests.view_all');
  if (visible.sql !== '1=1') add(`(w.requester_id=? OR ${visible.sql})`, user.id, ...visible.values);
  // List filters accept one value or a comma-separated list ("High,Urgent").
  const list = (value, allowed, label) => {
    const items = String(value)
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
    if (!items.length || items.length > 10 || items.some(v => allowed && !allowed.includes(v)))
      throw error(`Choose a valid ${label} filter.`);
    return items;
  };
  if (params.type) {
    const types = list(params.type, ['maintenance', 'schedule', 'technology'], 'type').filter(t => enabled.includes(t));
    if (!types.length) where.push('1=0');
    else add(`w.request_type IN (${types.map(() => '?').join(',')})`, ...types);
  }
  if (params.priority) {
    const chosen = list(params.priority, priorities, 'priority');
    add(`w.priority IN (${chosen.map(() => '?').join(',')})`, ...chosen);
  }
  if (params.statuses) {
    const chosen = list(params.statuses, statuses, 'status');
    add(`w.status IN (${chosen.map(() => '?').join(',')})`, ...chosen);
  }
  const today = dateInTimezone(timezone);
  if (params.status === 'Overdue') add("w.status<>'Completed' AND w.due_date<?", today);
  else if (params.status === 'Active') where.push("w.status<>'Completed'");
  else if (params.status && params.status !== 'All') {
    if (!statuses.includes(params.status)) throw error('Choose a valid status filter.');
    add('w.status=?', params.status);
  }
  if (params.q) {
    // "WO-0042", "wo42" and "42" also find the ticket by number.
    const ticket = String(params.q)
      .trim()
      .match(/^(?:wo-?)?0*(\d{1,9})$/i);
    values.push(likePattern(String(params.q).slice(0, 200)));
    const like = `LOWER(w.title || ' ' || b.name || ' ' || COALESCE(a.name,'') || ' ' || COALESCE(u.name,'') || ' ' || COALESCE(s.name,'') || ' ' || COALESCE(c.name,'')) LIKE $${values.length} ESCAPE '\\'`;
    if (ticket) {
      values.push(Number(ticket[1]));
      where.push(`(${like} OR w.number=$${values.length})`);
    } else where.push(like);
  }
  if (params.building) {
    const chosen = list(params.building, null, 'building');
    add(`w.building_id IN (${chosen.map(() => '?').join(',')})`, ...chosen);
  }
  if (params.space) add('w.space_id=?', params.space);
  if (params.category) {
    const chosen = list(params.category, null, 'category');
    const ids = chosen.filter(c => c !== 'none');
    const parts = [];
    if (ids.length) {
      for (const id of ids) values.push(id);
      parts.push(`w.category_id IN (${ids.map((_, i) => '$' + (values.length - ids.length + 1 + i)).join(',')})`);
    }
    if (chosen.includes('none')) parts.push('w.category_id IS NULL');
    where.push(`(${parts.join(' OR ')})`);
  }
  // Custom question filters: f_<question id>=<answer>.
  const answerFilters = Object.entries(params).filter(([k]) => k.startsWith('f_'));
  if (answerFilters.length > 5) throw error('Filter on at most five questions at a time.');
  for (const [key, value] of answerFilters)
    add(
      'EXISTS (SELECT 1 FROM order_answers x WHERE x.order_id=w.id AND x.field_id=? AND x.value=?)',
      key.slice(2),
      String(value),
    );
  if (params.asset) add('w.asset_id=?', params.asset);
  if (params.assignee === 'me') add('w.assignee_id=?', user.id);
  else if (params.assignee === 'none') where.push('w.assignee_id IS NULL');
  else if (params.assignee) add('w.assignee_id=?', params.assignee);
  if (params.reservation) add('w.reservation_status=?', params.reservation);
  const day = v => {
    try {
      return date(v);
    } catch {
      throw error('Dates must use YYYY-MM-DD.');
    }
  };
  if (params.overdue === '1' || params.overdue === 'true') add("w.status<>'Completed' AND w.due_date<?", today);
  if (params.due_from) add('w.due_date>=?', day(params.due_from));
  if (params.due_to) add('w.due_date<=?', day(params.due_to));
  if (params.from) add('w.created_at>=?', startOfDayUtc(day(params.from), timezone));
  if (params.to) add('w.created_at<?', startOfDayUtc(addDays(day(params.to), 1), timezone));
  return {where: where.length ? 'WHERE ' + where.join(' AND ') : '', values};
}
const priorityRank = "CASE w.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END";
const sortOrders = {
  newest: 'w.created_at DESC, w.id DESC',
  oldest: 'w.created_at ASC, w.id ASC',
  due: 'w.due_date ASC, w.created_at DESC',
  due_desc: 'w.due_date DESC, w.created_at DESC',
  priority: `${priorityRank}, w.due_date ASC, w.created_at DESC`,
  updated: 'COALESCE(w.updated_at, w.created_at) DESC, w.id DESC',
  number: 'w.number DESC',
};
export async function listOrders(db, user, params, timezone, {limit = 50, offset = 0} = {}) {
  const {where, values} = orderFilter(user, await moduleSettings(db), params, timezone);
  const order = sortOrders[params.sort || 'newest'];
  if (!order) throw error('Choose a valid sort order.');
  const [rows, count] = await Promise.all([
    db.query(
      `SELECT ${orderColumns} ${orderJoins} ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
    db.query(`SELECT COUNT(*) AS count ${orderJoins} ${where}`, values),
  ]);
  return {orders: rows, total: Number(count[0].count)};
}

export async function orderSummary(db, user, timezone) {
  const modules = await moduleSettings(db);
  const {where, values} = orderFilter(user, modules, {}, timezone);
  values.push(dateInTimezone(timezone));
  const today = '$' + values.length;
  const [totals] = await db.query(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN w.status<>'Completed' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN w.status<>'Completed' AND w.due_date<${today} THEN 1 ELSE 0 END) AS overdue, SUM(CASE WHEN w.status='In progress' THEN 1 ELSE 0 END) AS in_progress, SUM(CASE WHEN w.status='Completed' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN w.reservation_status='pending' THEN 1 ELSE 0 END) AS pending_reservations ${orderJoins} ${where}`,
    values,
  );
  values.pop();
  const byType = await db.query(
    `SELECT w.request_type AS key, COUNT(*) AS count ${orderJoins} ${where}${where ? ' AND' : ' WHERE'} w.status<>'Completed' GROUP BY w.request_type`,
    values,
  );
  const byBuilding = await db.query(
    `SELECT w.building_id AS key, COUNT(*) AS count ${orderJoins} ${where}${where ? ' AND' : ' WHERE'} w.status<>'Completed' GROUP BY w.building_id`,
    values,
  );
  const n = v => Number(v || 0);
  return {
    total: n(totals.total),
    active: n(totals.active),
    overdue: n(totals.overdue),
    inProgress: n(totals.in_progress),
    completed: n(totals.completed),
    pendingReservations: n(totals.pending_reservations),
    activeByType: Object.fromEntries(byType.map(r => [r.key, n(r.count)])),
    activeByBuilding: Object.fromEntries(byBuilding.map(r => [r.key, n(r.count)])),
  };
}

export function setupOrders(app, db, env) {
  const q = db.query;
  const timezone = env.ORG_TIMEZONE || 'America/Phoenix';
  const checkLocation = async (conn, building, asset, {allowArchived = false} = {}) => {
    if (
      !(
        await conn.query(`SELECT id FROM buildings WHERE id=$1${allowArchived ? '' : ' AND archived_at IS NULL'}`, [
          building,
        ])
      ).length
    )
      throw error('Choose an existing building.');
    if (
      asset &&
      !(
        await conn.query(
          `SELECT id FROM assets WHERE id=$1 AND building_id=$2${allowArchived ? '' : ' AND archived_at IS NULL'}`,
          [asset, building],
        )
      ).length
    )
      throw error('The asset must belong to the selected building.');
  };
  const accessibleOrder = async (req, id = req.params.id) => {
    const order = (await q('SELECT * FROM work_orders WHERE id=$1', [id]))[0];
    if (!order || (!canOn(req.user, 'requests.view_all', order) && order.requester_id !== req.user.id))
      throw error('Work order not found.', 404);
    await requireModule(db, order.request_type);
    return order;
  };
  const schedule = body => {
    if (!localTime(body.starts_at) || !localTime(body.ends_at) || body.ends_at <= body.starts_at)
      throw error('Schedule requests need valid start and end times, with the end after the start.');
    return [body.starts_at, body.ends_at];
  };
  const page = req => {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit),
      offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0)
      throw error('limit must be 1–200 and offset zero or more.');
    return {limit, offset};
  };

  app.get('/api/orders', async (req, res) => res.json(await listOrders(db, req.user, req.query, timezone, page(req))));
  app.get('/api/summary', async (req, res) => res.json(await orderSummary(db, req.user, timezone)));
  app.get('/api/calendar', async (req, res) => {
    let from, to;
    try {
      from = date(String(req.query.from));
      to = date(String(req.query.to));
    } catch {
      throw error('Choose a date range with from and to (YYYY-MM-DD).');
    }
    if (from > to || Date.parse(to) - Date.parse(from) > 62 * 86400000)
      throw error('Choose a range of up to two months.');
    const params = {...req.query, due_from: from, due_to: to, sort: 'due'};
    const {orders, total} = await listOrders(db, req.user, params, timezone, {limit: 3000, offset: 0});
    const modules = await moduleSettings(db);
    const plans = [];
    if (modules.maintenance && can(req.user, 'maintenance.view') && req.query.plans !== '0') {
      const rows = await q(
        'SELECT m.id,m.title,m.next_due,m.interval_days,b.name AS building FROM maintenance m JOIN buildings b ON b.id=m.building_id WHERE m.active=1 AND m.next_due<=$1',
        [to],
      );
      for (const plan of rows)
        for (let due = plan.next_due; due <= to && plans.length < 2000; due = addDays(due, plan.interval_days))
          if (due >= from) plans.push({id: plan.id, title: plan.title, building: plan.building, due_date: due});
    }
    res.json({
      from,
      to,
      total,
      orders: orders.map(o => ({
        id: o.id,
        number: o.number,
        title: o.title,
        status: o.status,
        priority: o.priority,
        request_type: o.request_type,
        due_date: o.due_date,
        starts_at: o.starts_at,
        building: o.building,
        assignee: o.assignee,
        reservation_status: o.reservation_status,
      })),
      plans,
    });
  });
  app.get('/api/orders/:id', async (req, res) => {
    // Ticket pages address tickets by number ("WO-0042" or "42") as well as by id.
    const byNumber = req.params.id.match(/^(?:wo-?)?0*(\d{1,9})$/i);
    if (byNumber) {
      const found = (await q('SELECT id FROM work_orders WHERE number=$1', [Number(byNumber[1])]))[0];
      if (!found) throw error('Work order not found.', 404);
      req.params.id = found.id;
    }
    await accessibleOrder(req);
    const order = (await q(`SELECT ${orderColumns} ${orderJoins} WHERE w.id=$1`, [req.params.id]))[0];
    const modules = await moduleSettings(db);
    const [attachments, parts] = await Promise.all([
      q(
        'SELECT t.id,t.file_name,t.content_type,t.size,t.created_at,t.uploaded_by,u.name AS uploader FROM attachments t JOIN users u ON u.id=t.uploaded_by WHERE t.work_order_id=$1 ORDER BY t.created_at',
        [order.id],
      ),
      modules.inventory && can(req.user, 'inventory.view')
        ? q(
            'SELECT p.id,p.quantity,p.created_at,p.part_id,t.name,t.sku,t.unit_cost_cents,u.name AS used_by FROM part_usage p JOIN parts t ON t.id=p.part_id JOIN users u ON u.id=p.user_id WHERE p.work_order_id=$1 ORDER BY p.created_at',
            [order.id],
          )
        : [],
    ]);
    const mine = order.assignee_id === req.user.id;
    const permissions = {
      edit_any: canOn(req.user, 'requests.edit_any', order),
      edit_assigned: mine && canOn(req.user, 'requests.edit_assigned', order),
      update:
        canOn(req.user, 'requests.update_any', order) || (mine && canOn(req.user, 'requests.update_assigned', order)),
      assign: canOn(req.user, 'requests.assign', order),
      delete: canOn(req.user, 'requests.delete', order),
      moderate: canOn(req.user, 'requests.moderate', order),
      record_parts:
        canOn(req.user, 'parts.record_any', order) || (mine && canOn(req.user, 'requests.update_assigned', order)),
      approve: canOn(req.user, 'reservations.approve', order),
      take: !order.assignee_id && canOn(req.user, 'requests.assignable', order),
    };
    const assignable = permissions.assign
      ? (await usersWith(db, 'requests.assignable', order)).map(u => ({id: u.id, name: u.name}))
      : undefined;
    res.json({...order, attachments, parts, answers: await answersFor(db, order.id), permissions, assignable});
  });

  app.post('/api/orders', async (req, res) => {
    const body = req.body;
    const requestType = body.request_type || 'maintenance';
    await requireModule(db, requestType);
    if (!canSubmit(req.user, requestType)) throw error('Your role cannot submit this type of request.', 403);
    const form = await checkSubmission(db, requestType, body, {today: dateInTimezone(timezone)});
    const title = text(body, 'title'),
      description = text(body, 'description', 5000, true),
      building = text(body, 'building_id'),
      asset = text(body, 'asset_id', 200, true) || null;
    const priority = body.priority || 'Normal';
    if (!priorities.includes(priority)) throw error('Choose a valid priority.');
    let starts = null,
      ends = null;
    if (requestType === 'schedule') [starts, ends] = schedule(body);
    const due = date(requestType === 'schedule' ? starts.slice(0, 10) : body.due_date);
    const space = requestType === 'schedule' ? text(body, 'space_id', 200, true) || null : null;
    const id = randomUUID();
    const reservation = await db.transaction(async tx => {
      await checkLocation(tx, building, asset);
      const reserved = await reserveSpace(tx, {spaceId: space, buildingId: building, starts, ends, timezone});
      await tx.query(
        'INSERT INTO work_orders(id,title,description,building_id,asset_id,priority,status,requester_id,due_date,created_at,request_type,starts_at,ends_at,space_id,reservation_status,updated_at,category_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$10,$16)',
        [
          id,
          title,
          description,
          building,
          asset,
          priority,
          'Open',
          req.user.id,
          due,
          new Date().toISOString(),
          requestType,
          starts,
          ends,
          reserved.space_id,
          reserved.reservation_status,
          form.category_id,
        ],
      );
      await assignTicketNumber(tx, id);
      await saveAnswers(tx, id, form.answers);
      await audit(
        tx,
        req.user,
        'order.create',
        'work_order',
        id,
        `Created ${requestType} request “${title}”`,
        reserved.space
          ? {space: [null, reserved.space.name], reservation_status: [null, reserved.reservation_status]}
          : undefined,
      );
      return reserved;
    });
    const created = (await q('SELECT * FROM work_orders WHERE id=$1', [id]))[0];
    const recipients = await usersWith(db, 'requests.notified', created);
    await notify(
      db,
      {id},
      'created',
      recipients.map(u => u.id),
      req.user.id,
      `${req.user.name} submitted a ${requestType} request${reservation.reservation_status === 'pending' ? ' that needs reservation approval' : ''}.`,
    );
    const assigned = await autoAssign(db, id, {notify});
    res.status(201).json({id, reservation_status: reservation.reservation_status, assignee_id: assigned?.id || null});
  });

  app.patch('/api/orders/:id', async (req, res) => {
    const row = await accessibleOrder(req);
    const body = req.body || {};
    const editsDetails = detailFields.some(k => k in body);
    const owner = row.requester_id === req.user.id;
    const fullEdit = canOn(req.user, 'requests.edit_any', row) || (owner && row.status === 'Open');
    // The assignee may rewrite the ticket's text (title and description) but not where, when or how urgent.
    const textEdit =
      canOn(req.user, 'requests.edit_assigned', row) &&
      row.assignee_id === req.user.id &&
      detailFields.filter(k => k in body).every(k => ['title', 'description'].includes(k));
    if (editsDetails && !(fullEdit || textEdit))
      throw error(
        row.assignee_id === req.user.id && canOn(req.user, 'requests.edit_assigned', row)
          ? 'As the assignee you can edit the title and description only.'
          : owner
            ? 'Requests can be edited by the requester only while they are Open.'
            : 'Your role cannot edit the details of this request.',
        403,
      );
    const mayStamp =
      canOn(req.user, 'requests.update_any', row) ||
      (canOn(req.user, 'requests.update_assigned', row) && row.assignee_id === req.user.id);
    if ('status' in body && body.status !== row.status && !mayStamp)
      throw error('Your role cannot change the status of this request.', 403);
    const status = body.status ?? row.status;
    if (!statuses.includes(status)) throw error('Choose a valid status.');
    // Resolving a ticket records how it was resolved; the note is kept as a comment.
    const resolving = status === 'Completed' && row.status !== 'Completed';
    const resolution = resolving ? String(body.resolution ?? '').trim() : '';
    // Undo: the same person reopened this resolved ticket in the last ten minutes, so it can go back to
    // Completed without a second note (the original resolution stays in the conversation).
    const undoing =
      resolving &&
      !resolution &&
      body.undo === true &&
      (
        await q(
          "SELECT details FROM audit_log WHERE entity_type='work_order' AND entity_id=$1 AND action='order.update' AND actor_id=$2 AND created_at>$3 ORDER BY created_at DESC LIMIT 1",
          [row.id, req.user.id, new Date(Date.now() - 600000).toISOString()],
        )
      ).some(a => JSON.parse(a.details || '{}').status?.[0] === 'Completed');
    if (resolving && !resolution && !undoing) throw error('Add a note describing how the request was resolved.');
    if (resolution.length > 5000) throw error('The resolution note must be 5000 characters or fewer.');
    let assignee = row.assignee_id;
    if ('assignee_id' in body) {
      assignee = body.assignee_id || null;
      // "Take it": anyone who can be assigned this ticket may take it while nobody has it.
      const taking = assignee === req.user.id && !row.assignee_id && canOn(req.user, 'requests.assignable', row);
      // ...and give back a ticket they hold (the undo of "Take it").
      const releasing =
        assignee === null && row.assignee_id === req.user.id && canOn(req.user, 'requests.assignable', row);
      if (assignee !== row.assignee_id && !taking && !releasing && !canOn(req.user, 'requests.assign', row))
        throw error('Your role cannot assign work.', 403);
      if (assignee && !(await usersWith(db, 'requests.assignable', row)).some(u => u.id === assignee))
        throw error('Choose an enabled person whose role can be assigned work.');
    }
    const next = {...row, status, assignee_id: assignee};
    if (editsDetails) {
      if ('title' in body) next.title = text(body, 'title');
      if ('description' in body) next.description = text(body, 'description', 5000, true);
      if ('priority' in body) {
        if (!priorities.includes(body.priority)) throw error('Choose a valid priority.');
        next.priority = body.priority;
      }
      if ('building_id' in body) next.building_id = text(body, 'building_id');
      if ('asset_id' in body) next.asset_id = text(body, 'asset_id', 200, true) || null;
      else if (next.building_id !== row.building_id) next.asset_id = null;
      if (row.request_type === 'schedule') {
        if ('starts_at' in body || 'ends_at' in body)
          [next.starts_at, next.ends_at] = schedule({
            starts_at: body.starts_at ?? row.starts_at,
            ends_at: body.ends_at ?? row.ends_at,
          });
        next.due_date = next.starts_at.slice(0, 10);
        if ('space_id' in body) next.space_id = text(body, 'space_id', 200, true) || null;
      } else if ('due_date' in body) next.due_date = date(body.due_date);
    }
    let form = null;
    if ('category_id' in body || 'answers' in body) {
      form = await checkSubmission(db, row.request_type, body, {existing: row});
      next.category_id = form.category_id;
    }
    const now = new Date().toISOString();
    next.completed_at = status === 'Completed' ? row.completed_at || now : null;
    const fields = [
      'title',
      'description',
      'priority',
      'status',
      'assignee_id',
      'building_id',
      'asset_id',
      'due_date',
      'starts_at',
      'ends_at',
      'space_id',
      'reservation_status',
    ];
    await db.transaction(async tx => {
      if (next.building_id !== row.building_id || next.asset_id !== row.asset_id)
        await checkLocation(tx, next.building_id, next.asset_id, {
          allowArchived: next.building_id === row.building_id && next.asset_id === row.asset_id,
        });
      const rebook =
        next.space_id !== row.space_id ||
        next.starts_at !== row.starts_at ||
        next.ends_at !== row.ends_at ||
        next.building_id !== row.building_id;
      if (rebook && !next.space_id) next.reservation_status = null;
      else if (rebook)
        Object.assign(
          next,
          await reserveSpace(tx, {
            spaceId: next.space_id,
            buildingId: next.building_id,
            starts: next.starts_at,
            ends: next.ends_at,
            excludeId: row.id,
            timezone,
          }),
        );
      await tx.query(
        'UPDATE work_orders SET title=$1,description=$2,priority=$3,status=$4,assignee_id=$5,building_id=$6,asset_id=$7,due_date=$8,starts_at=$9,ends_at=$10,space_id=$11,reservation_status=$12,completed_at=$13,updated_at=$14,category_id=$16 WHERE id=$15',
        [
          next.title,
          next.description,
          next.priority,
          next.status,
          next.assignee_id,
          next.building_id,
          next.asset_id,
          next.due_date,
          next.starts_at,
          next.ends_at,
          next.space_id,
          next.reservation_status,
          next.completed_at,
          now,
          row.id,
          next.category_id ?? null,
        ],
      );
      if (form?.replaceAnswers) await saveAnswers(tx, row.id, form.answers);
      if (resolution)
        await tx.query('INSERT INTO comments(id,work_order_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5)', [
          randomUUID(),
          row.id,
          req.user.id,
          `Resolution: ${resolution}`,
          now,
        ]);
      const diff = changes(row, next, [...fields, 'category_id']);
      if (Object.keys(diff).length)
        await audit(
          tx,
          req.user,
          'order.update',
          'work_order',
          row.id,
          `Updated ${Object.keys(diff)
            .map(f => f.replace('_id', '').replaceAll('_', ' '))
            .join(', ')}`,
          diff,
        );
    });
    if (assignee !== row.assignee_id && assignee)
      await notify(db, row, 'assigned', [assignee], req.user.id, `${req.user.name} assigned this request to you.`);
    if (status !== row.status)
      await notify(
        db,
        row,
        'status',
        [row.requester_id, assignee],
        req.user.id,
        resolving ? `${req.user.name} resolved this request.` : `${req.user.name} changed the status to ${status}.`,
      );
    else if (editsDetails)
      await notify(
        db,
        row,
        'status',
        [row.requester_id, assignee],
        req.user.id,
        `${req.user.name} updated the request details.`,
      );
    res.json({ok: true, reservation_status: next.reservation_status});
  });

  app.delete(
    '/api/orders/:id',
    requireCap('requests.delete', 'Your role cannot delete requests.'),
    async (req, res) => {
      const row = await accessibleOrder(req);
      if (!canOn(req.user, 'requests.delete', row)) throw error('Your role cannot delete this request.', 403);
      await db.transaction(async tx => {
        const used = await tx.query('SELECT part_id,quantity FROM part_usage WHERE work_order_id=$1', [row.id]);
        for (const table of [
          'notifications WHERE order_id',
          'comments WHERE work_order_id',
          'attachments WHERE work_order_id',
          'part_usage WHERE work_order_id',
          'maintenance_runs WHERE work_order_id',
          'order_answers WHERE order_id',
        ])
          await tx.query(`DELETE FROM ${table}=$1`, [row.id]);
        await tx.query('DELETE FROM work_orders WHERE id=$1', [row.id]);
        await audit(
          tx,
          req.user,
          'order.delete',
          'work_order',
          row.id,
          `Deleted ${row.request_type} request “${row.title}”`,
          {title: [row.title, null], status: [row.status, null], ...(used.length ? {parts_used: [used, null]} : {})},
        );
      });
      res.json({ok: true});
    },
  );

  app.get('/api/orders/:id/history', async (req, res) => {
    await accessibleOrder(req);
    res.json((await auditQuery(db, {entityType: 'work_order', entityId: req.params.id, limit: 200})).entries);
  });

  app.get('/api/orders/:id/comments', async (req, res) => {
    await accessibleOrder(req);
    res.json(
      await q(
        'SELECT c.*,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.work_order_id=$1 ORDER BY c.created_at',
        [req.params.id],
      ),
    );
  });
  app.post('/api/orders/:id/comments', async (req, res) => {
    const row = await accessibleOrder(req),
      body = text(req.body, 'body', 5000),
      id = randomUUID();
    await q('INSERT INTO comments(id,work_order_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5)', [
      id,
      row.id,
      req.user.id,
      body,
      new Date().toISOString(),
    ]);
    await audit(db, req.user, 'comment.create', 'work_order', row.id, 'Added a comment');
    await notify(
      db,
      row,
      'comment',
      [row.requester_id, row.assignee_id],
      req.user.id,
      `${req.user.name} added a comment.`,
    );
    res.status(201).json({ok: true, id});
  });
  const ownComment = async (req, {allowManager}) => {
    const row = await accessibleOrder(req);
    const comment = (
      await q('SELECT * FROM comments WHERE id=$1 AND work_order_id=$2', [req.params.comment, row.id])
    )[0];
    if (!comment) throw error('Comment not found.', 404);
    if (comment.user_id !== req.user.id && !(allowManager && canOn(req.user, 'requests.moderate', row)))
      throw error(
        allowManager
          ? 'Only the author or a manager can delete this comment.'
          : 'Only the author can edit this comment.',
        403,
      );
    return {row, comment};
  };
  app.patch('/api/orders/:id/comments/:comment', async (req, res) => {
    const {row, comment} = await ownComment(req, {allowManager: false}),
      body = text(req.body, 'body', 5000);
    await q('UPDATE comments SET body=$1,edited_at=$2 WHERE id=$3', [body, new Date().toISOString(), comment.id]);
    await audit(db, req.user, 'comment.update', 'work_order', row.id, 'Edited a comment', {
      comment: [comment.body, body],
    });
    res.json({ok: true});
  });
  app.delete('/api/orders/:id/comments/:comment', async (req, res) => {
    const {row, comment} = await ownComment(req, {allowManager: true});
    await q('DELETE FROM comments WHERE id=$1', [comment.id]);
    await audit(
      db,
      req.user,
      'comment.delete',
      'work_order',
      row.id,
      comment.user_id === req.user.id ? 'Deleted their comment' : 'Deleted a comment',
      {comment: [comment.body, null]},
    );
    res.json({ok: true});
  });
  return {accessibleOrder, checkLocation};
}
