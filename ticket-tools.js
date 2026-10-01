// Ticket tools: "already reported?" matching, followers (me too, mentions, by hand), checklists and their
// templates, saved replies, time tracking, and due-date targets with escalation.
import {randomUUID} from 'node:crypto';
import {audit} from './audit.js';
import {error, text} from './validation.js';
import {can, canOn, usersWith, requestTypeIds} from './permissions.js';
import {dateInTimezone, addDays} from './dates.js';

const now = () => new Date().toISOString();
const priorities = ['Urgent', 'High', 'Normal', 'Low'];

// ---- Followers ----
export async function followerIds(db, orderId) {
  return (await db.query('SELECT user_id FROM order_followers WHERE order_id=$1', [orderId])).map(r => r.user_id);
}
export async function isFollower(db, orderId, userId) {
  return (
    (await db.query('SELECT 1 AS x FROM order_followers WHERE order_id=$1 AND user_id=$2', [orderId, userId])).length >
    0
  );
}
export async function addFollower(db, orderId, userId, source) {
  await db.query(
    'INSERT INTO order_followers(order_id,user_id,source,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [orderId, userId, source, now()],
  );
}
// Who works a ticket: whoever may update it, its assignee, or anyone who could be assigned it.
export const canWork = (user, order) =>
  canOn(user, 'requests.update_any', order) ||
  (order.assignee_id === user.id && canOn(user, 'requests.update_assigned', order)) ||
  canOn(user, 'requests.assignable', order);

// ---- Due-date targets ----
export const defaultSla = {enabled: true, days: {Urgent: 0, High: 1, Normal: 3, Low: 7}};
export async function slaSettings(db) {
  const row = (await db.query("SELECT body FROM admin_settings WHERE id='sla'"))[0];
  const saved = row ? JSON.parse(row.body) : {};
  return {...defaultSla, ...saved, days: {...defaultSla.days, ...(saved.days || {})}};
}
// The due date a new ticket gets when the form did not ask for one.
export async function targetDue(db, priority, timezone) {
  const sla = await slaSettings(db);
  return addDays(dateInTimezone(timezone), sla.days[priority] ?? sla.days.Normal);
}

// ---- Checklists ----
const cleanItems = items => {
  if (!Array.isArray(items) || !items.length || items.length > 50)
    throw error('A checklist needs between 1 and 50 items.');
  return items.map(i => {
    const label = typeof i === 'string' ? i.trim() : '';
    if (!label || label.length > 200) throw error('Each checklist item must be 1–200 characters.');
    return label;
  });
};
async function insertItems(db, orderId, labels) {
  const start = Number((await db.query('SELECT COUNT(*) AS n FROM checklist_items WHERE order_id=$1', [orderId]))[0].n);
  let sort = start;
  for (const label of labels)
    await db.query('INSERT INTO checklist_items(id,order_id,label,sort,created_at) VALUES($1,$2,$3,$4,$5)', [
      randomUUID(),
      orderId,
      label,
      sort++,
      now(),
    ]);
}
// New tickets get the checklist template for their category (or, failing that, their request type).
export async function applyTemplates(db, order, templateId = null) {
  const templates = await db.query('SELECT * FROM checklist_templates ORDER BY created_at');
  const t = templateId
    ? templates.find(x => x.id === templateId)
    : templates.find(x => x.category_id && x.category_id === order.category_id) ||
      templates.find(x => !x.category_id && x.request_type === order.request_type);
  if (t) await insertItems(db, order.id, JSON.parse(t.items));
  return t || null;
}
const checklistFor = async (db, orderId) =>
  db.query(
    'SELECT c.id,c.label,c.sort,c.done_at,c.done_by,u.name AS done_by_name FROM checklist_items c LEFT JOIN users u ON u.id=c.done_by WHERE c.order_id=$1 ORDER BY c.sort,c.created_at',
    [orderId],
  );

// ---- Time ----
const minutesBetween = (a, b) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
async function stopRunning(db, userId) {
  const running = (await db.query('SELECT * FROM time_entries WHERE user_id=$1 AND ended_at IS NULL', [userId]))[0];
  if (!running) return null;
  const ended = now();
  const minutes = minutesBetween(running.started_at, ended);
  await db.query('UPDATE time_entries SET ended_at=$1,minutes=$2 WHERE id=$3', [ended, minutes, running.id]);
  return {...running, ended_at: ended, minutes};
}
export async function runningTimer(db, userId) {
  return (
    (
      await db.query(
        'SELECT t.id,t.order_id,t.started_at,w.number,w.title FROM time_entries t JOIN work_orders w ON w.id=t.order_id WHERE t.user_id=$1 AND t.ended_at IS NULL',
        [userId],
      )
    )[0] || null
  );
}
const timeFor = async (db, orderId, userId) => {
  const entries = await db.query(
    'SELECT t.id,t.user_id,t.started_at,t.ended_at,t.minutes,t.note,u.name FROM time_entries t JOIN users u ON u.id=t.user_id WHERE t.order_id=$1 ORDER BY t.started_at DESC',
    [orderId],
  );
  return {
    entries,
    total_minutes: entries.reduce((n, e) => n + (e.minutes || 0), 0),
    running: entries.find(e => !e.ended_at && e.user_id === userId) || null,
  };
};

// Everything the ticket page shows beyond the ticket itself.
export async function orderExtras(db, order, user) {
  const [followers, checklist, time] = await Promise.all([
    db.query(
      'SELECT f.user_id AS id,u.name,f.source FROM order_followers f JOIN users u ON u.id=f.user_id WHERE f.order_id=$1 ORDER BY u.name',
      [order.id],
    ),
    checklistFor(db, order.id),
    timeFor(db, order.id, user.id),
  ]);
  return {followers, following: followers.some(f => f.id === user.id), checklist, time};
}

// ---- "Already reported?" ----
const stop = new Set(
  'the and for with that this from have not are was but its into onto near our your room there their please need needs'.split(
    ' ',
  ),
);
const words = s =>
  new Set(
    String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !stop.has(w)),
  );

// ---- Escalation sweep: "due today" once, then "overdue" once, to the assignee and the triage team. ----
export async function slaSweep(db, {notify, timezone}) {
  const sla = await slaSettings(db);
  if (!sla.enabled) return {warned: 0, escalated: 0};
  const today = dateInTimezone(timezone);
  let warned = 0,
    escalated = 0;
  const due = await db.query(
    "SELECT * FROM work_orders WHERE status<>'Completed' AND due_date IS NOT NULL AND request_type<>'schedule' AND ((due_date=$1 AND sla_warned_at IS NULL) OR (due_date<$1 AND sla_breached_at IS NULL))",
    [today],
  );
  for (const order of due) {
    const overdue = order.due_date < today;
    const team = (await usersWith(db, 'requests.notified', order)).map(u => u.id);
    const recipients = overdue ? [order.assignee_id, ...team] : order.assignee_id ? [order.assignee_id] : team;
    await db.query(`UPDATE work_orders SET ${overdue ? 'sla_breached_at' : 'sla_warned_at'}=$1 WHERE id=$2`, [
      now(),
      order.id,
    ]);
    await notify(
      db,
      order,
      'due',
      [...recipients, ...(await followerIds(db, order.id))],
      null,
      overdue ? `Overdue since ${order.due_date}.` : 'Due today.',
    );
    if (overdue) {
      escalated++;
      await audit(
        db,
        {id: null, name: 'Due-date targets'},
        'order.escalate',
        'work_order',
        order.id,
        'Escalated as overdue',
      );
    } else warned++;
  }
  return {warned, escalated};
}

export function setupTicketTools(app, db, env, {accessibleOrder, notify}) {
  const timezone = env.ORG_TIMEZONE || 'America/Phoenix';
  const forms = (req, res, next) =>
    can(req.user, 'admin.forms') ? next() : res.status(403).json({error: 'Your role cannot manage request forms.'});
  const work = async req => {
    const order = await accessibleOrder(req);
    if (!canWork(req.user, order)) throw error('Your role cannot work on this request.', 403);
    return order;
  };

  // Open tickets in the same building that look like the one being written.
  app.get('/api/orders-similar', async (req, res) => {
    const building = String(req.query.building_id || '');
    if (!building) return res.json([]);
    const type = requestTypeIds.includes(req.query.request_type) ? req.query.request_type : null;
    const asset = String(req.query.asset_id || '');
    const typed = words(req.query.title);
    const since = new Date(Date.now() - 120 * 86400000).toISOString();
    const rows = await db.query(
      `SELECT w.id,w.number,w.title,w.status,w.created_at,w.asset_id,w.category_id,w.requester_id,w.assignee_id,w.request_type,w.building_id,a.name AS asset FROM work_orders w LEFT JOIN assets a ON a.id=w.asset_id WHERE w.building_id=$1 AND w.status<>'Completed' AND w.created_at>$2 ${type ? 'AND w.request_type=$3' : ''} ORDER BY w.created_at DESC LIMIT 200`,
      type ? [building, since, type] : [building, since],
    );
    const following = new Set(
      (await db.query('SELECT order_id FROM order_followers WHERE user_id=$1', [req.user.id])).map(r => r.order_id),
    );
    const scored = rows
      .map(o => {
        const overlap = [...words(o.title)].filter(w => typed.has(w)).length;
        const sameAsset = asset && o.asset_id === asset;
        return {
          o,
          score:
            overlap * 2 +
            (sameAsset ? 3 : 0) +
            (req.query.category_id && o.category_id === req.query.category_id ? 1 : 0),
        };
      })
      .filter(x => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    res.json(
      scored.map(({o}) => ({
        id: o.id,
        number: o.number,
        title: o.title,
        status: o.status,
        created_at: o.created_at,
        asset: o.asset,
        mine: o.requester_id === req.user.id,
        following: following.has(o.id),
      })),
    );
  });

  // Follow / unfollow. "Me too" may follow an open ticket someone else reported (from the list above).
  app.post('/api/orders/:id/follow', async (req, res) => {
    let order;
    try {
      order = await accessibleOrder(req);
    } catch (err) {
      const open = (await db.query('SELECT * FROM work_orders WHERE id=$1', [req.params.id]))[0];
      if (!req.body?.me_too || !open || open.status === 'Completed') throw err;
      order = open;
    }
    await addFollower(db, order.id, req.user.id, req.body?.me_too ? 'me_too' : 'manual');
    await audit(
      db,
      req.user,
      req.body?.me_too ? 'order.me_too' : 'order.follow',
      'work_order',
      order.id,
      req.body?.me_too ? 'Reported the same problem (me too)' : 'Followed the request',
    );
    if (req.body?.me_too)
      await notify(db, order, 'comment', [order.assignee_id], req.user.id, `${req.user.name} has the same problem.`);
    res.json({ok: true});
  });
  app.delete('/api/orders/:id/follow', async (req, res) => {
    const order = await accessibleOrder(req);
    await db.query('DELETE FROM order_followers WHERE order_id=$1 AND user_id=$2', [order.id, req.user.id]);
    res.json({ok: true});
  });

  // Checklist on a ticket.
  app.post('/api/orders/:id/checklist', async (req, res) => {
    const order = await work(req);
    if (req.body?.template_id) {
      const t = await applyTemplates(db, order, String(req.body.template_id));
      if (!t) throw error('Checklist template not found.', 404);
      await audit(db, req.user, 'checklist.apply', 'work_order', order.id, `Added the “${t.name}” checklist`);
    } else {
      const labels = cleanItems([req.body?.label]);
      await insertItems(db, order.id, labels);
      await audit(db, req.user, 'checklist.add', 'work_order', order.id, `Added checklist item “${labels[0]}”`);
    }
    res.status(201).json(await checklistFor(db, order.id));
  });
  app.patch('/api/orders/:id/checklist/:item', async (req, res) => {
    const order = await work(req);
    const item = (
      await db.query('SELECT * FROM checklist_items WHERE id=$1 AND order_id=$2', [req.params.item, order.id])
    )[0];
    if (!item) throw error('Checklist item not found.', 404);
    if (typeof req.body?.done !== 'boolean') throw error('done must be true or false.');
    await db.query('UPDATE checklist_items SET done_at=$1,done_by=$2 WHERE id=$3', [
      req.body.done ? now() : null,
      req.body.done ? req.user.id : null,
      item.id,
    ]);
    await audit(
      db,
      req.user,
      'checklist.check',
      'work_order',
      order.id,
      `${req.body.done ? 'Checked' : 'Unchecked'} “${item.label}”`,
    );
    res.json(await checklistFor(db, order.id));
  });
  app.delete('/api/orders/:id/checklist/:item', async (req, res) => {
    const order = await work(req);
    await db.query('DELETE FROM checklist_items WHERE id=$1 AND order_id=$2', [req.params.item, order.id]);
    await audit(db, req.user, 'checklist.remove', 'work_order', order.id, 'Removed a checklist item');
    res.json(await checklistFor(db, order.id));
  });

  // Checklist templates (Settings → Checklists & replies).
  const templateBody = async body => {
    const name = text(body, 'name', 80);
    const type = body.request_type || null;
    if (type && !requestTypeIds.includes(type)) throw error('Choose a valid request type.');
    const category = body.category_id || null;
    if (category && !(await db.query('SELECT id FROM categories WHERE id=$1', [category])).length)
      throw error('Choose an existing category.');
    return {name, type, category, items: cleanItems(body.items)};
  };
  app.get('/api/checklist-templates', async (req, res) =>
    res.json(
      (await db.query('SELECT * FROM checklist_templates ORDER BY name')).map(t => ({
        ...t,
        items: JSON.parse(t.items),
      })),
    ),
  );
  app.post('/api/admin/checklist-templates', forms, async (req, res) => {
    const t = await templateBody(req.body || {});
    const id = randomUUID();
    await db.query(
      'INSERT INTO checklist_templates(id,name,request_type,category_id,items,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, t.name, t.type, t.category, JSON.stringify(t.items), now()],
    );
    await audit(db, req.user, 'checklist_template.create', 'settings', id, `Created checklist template ${t.name}`);
    res.status(201).json({id});
  });
  app.patch('/api/admin/checklist-templates/:id', forms, async (req, res) => {
    const before = (await db.query('SELECT * FROM checklist_templates WHERE id=$1', [req.params.id]))[0];
    if (!before) throw error('Template not found.', 404);
    const t = await templateBody({...before, items: JSON.parse(before.items), ...req.body});
    await db.query('UPDATE checklist_templates SET name=$1,request_type=$2,category_id=$3,items=$4 WHERE id=$5', [
      t.name,
      t.type,
      t.category,
      JSON.stringify(t.items),
      before.id,
    ]);
    await audit(
      db,
      req.user,
      'checklist_template.update',
      'settings',
      before.id,
      `Updated checklist template ${t.name}`,
    );
    res.json({ok: true});
  });
  app.delete('/api/admin/checklist-templates/:id', forms, async (req, res) => {
    await db.query('UPDATE maintenance SET checklist_template_id=NULL WHERE checklist_template_id=$1', [req.params.id]);
    await db.query('DELETE FROM checklist_templates WHERE id=$1', [req.params.id]);
    await audit(db, req.user, 'checklist_template.delete', 'settings', req.params.id, 'Deleted a checklist template');
    res.json({ok: true});
  });

  // Saved replies: shared ones (managed with Request forms) and each person's own.
  const replies = async userId =>
    db.query('SELECT id,user_id,title,body FROM saved_replies WHERE user_id IS NULL OR user_id=$1 ORDER BY title', [
      userId,
    ]);
  app.get('/api/replies', async (req, res) => res.json(await replies(req.user.id)));
  app.post('/api/replies', async (req, res) => {
    const title = text(req.body, 'title', 80),
      body = text(req.body, 'body', 5000);
    const shared = req.body.shared === true;
    if (shared && !can(req.user, 'admin.forms'))
      throw error('Only people who manage request forms can share replies.', 403);
    await db.query('INSERT INTO saved_replies(id,user_id,title,body,created_at) VALUES($1,$2,$3,$4,$5)', [
      randomUUID(),
      shared ? null : req.user.id,
      title,
      body,
      now(),
    ]);
    res.status(201).json(await replies(req.user.id));
  });
  const ownReply = async req => {
    const r = (await db.query('SELECT * FROM saved_replies WHERE id=$1', [req.params.id]))[0];
    if (!r || (r.user_id && r.user_id !== req.user.id)) throw error('Reply not found.', 404);
    if (!r.user_id && !can(req.user, 'admin.forms'))
      throw error('Only people who manage request forms can change shared replies.', 403);
    return r;
  };
  app.patch('/api/replies/:id', async (req, res) => {
    const r = await ownReply(req);
    await db.query('UPDATE saved_replies SET title=$1,body=$2 WHERE id=$3', [
      text({title: req.body.title ?? r.title}, 'title', 80),
      text({body: req.body.body ?? r.body}, 'body', 5000),
      r.id,
    ]);
    res.json(await replies(req.user.id));
  });
  app.delete('/api/replies/:id', async (req, res) => {
    const r = await ownReply(req);
    await db.query('DELETE FROM saved_replies WHERE id=$1', [r.id]);
    res.json(await replies(req.user.id));
  });

  // Time tracking: one running timer per person; starting another stops the first.
  app.post('/api/orders/:id/time/start', async (req, res) => {
    const order = await work(req);
    const stopped = await stopRunning(db, req.user.id);
    await db.query(
      'INSERT INTO time_entries(id,order_id,user_id,started_at,note,created_at) VALUES($1,$2,$3,$4,$5,$4)',
      [randomUUID(), order.id, req.user.id, now(), ''],
    );
    await audit(db, req.user, 'time.start', 'work_order', order.id, 'Started a timer');
    if (stopped && stopped.order_id !== order.id)
      await audit(db, req.user, 'time.stop', 'work_order', stopped.order_id, `Logged ${stopped.minutes} min`);
    res.status(201).json({running: await runningTimer(db, req.user.id), stopped});
  });
  app.post('/api/time/stop', async (req, res) => {
    const stopped = await stopRunning(db, req.user.id);
    if (!stopped) throw error('No timer is running.', 409);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    if (note) await db.query('UPDATE time_entries SET note=$1 WHERE id=$2', [note, stopped.id]);
    await audit(db, req.user, 'time.stop', 'work_order', stopped.order_id, `Logged ${stopped.minutes} min`);
    res.json({stopped: {...stopped, note}});
  });
  app.post('/api/orders/:id/time', async (req, res) => {
    const order = await work(req);
    const minutes = Number(req.body?.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw error('Enter 1 to 1440 minutes.');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    const ended = now();
    await db.query(
      'INSERT INTO time_entries(id,order_id,user_id,started_at,ended_at,minutes,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$5)',
      [randomUUID(), order.id, req.user.id, new Date(Date.now() - minutes * 60000).toISOString(), ended, minutes, note],
    );
    await audit(db, req.user, 'time.log', 'work_order', order.id, `Logged ${minutes} min`);
    res.status(201).json(await timeFor(db, order.id, req.user.id));
  });
  app.delete('/api/time/:id', async (req, res) => {
    const entry = (await db.query('SELECT * FROM time_entries WHERE id=$1', [req.params.id]))[0];
    if (!entry) throw error('Time entry not found.', 404);
    const order = await accessibleOrder(req, entry.order_id);
    if (entry.user_id !== req.user.id && !canOn(req.user, 'requests.moderate', order))
      throw error('Only the person who logged it or a manager can remove time.', 403);
    await db.query('DELETE FROM time_entries WHERE id=$1', [entry.id]);
    await audit(db, req.user, 'time.remove', 'work_order', order.id, `Removed ${entry.minutes || 0} min of time`);
    res.json(await timeFor(db, order.id, req.user.id));
  });

  // Due-date targets (Settings → Due dates).
  app.get('/api/admin/sla', async (req, res) => {
    if (!can(req.user, 'admin.settings'))
      return res.status(403).json({error: 'Your role cannot change workspace settings.'});
    res.json(await slaSettings(db));
  });
  app.put('/api/admin/sla', async (req, res) => {
    if (!can(req.user, 'admin.settings'))
      return res.status(403).json({error: 'Your role cannot change workspace settings.'});
    const body = req.body || {};
    if (typeof body.enabled !== 'boolean') throw error('Choose whether escalation is on.');
    const days = {};
    for (const p of priorities) {
      const n = Number(body.days?.[p]);
      if (!Number.isInteger(n) || n < 0 || n > 365) throw error(`Enter 0–365 days for ${p}.`);
      days[p] = n;
    }
    const saved = {enabled: body.enabled, days};
    await db.query("INSERT INTO admin_settings VALUES('sla',$1) ON CONFLICT(id) DO UPDATE SET body=$1", [
      JSON.stringify(saved),
    ]);
    await audit(db, req.user, 'settings.sla', 'settings', 'sla', 'Updated due-date targets and escalation');
    res.json(saved);
  });
  // Escalation runs every ten minutes in the server (and on demand in tests).
  const timer = setInterval(() => slaSweep(db, {notify, timezone}).catch(() => {}), 600000);
  timer.unref();
  return {sweep: () => slaSweep(db, {notify, timezone})};
}
