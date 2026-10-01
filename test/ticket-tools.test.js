import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';
import {dateInTimezone, addDays} from '../dates.js';

test('already reported: similar open tickets, me too, followers and mentions', async () => {
  const w = await startWorkspace();
  const {call, as, addUser, db} = w;
  try {
    const leak = (
      await call('/api/orders', 'POST', {
        title: 'Kitchen sink leaking badly',
        building_id: 'b1',
        due_date: '2026-10-09',
      })
    ).body.id;
    await addUser('req', 'requester', {name: 'Riley'});
    await as('req');
    const similar = (await call('/api/orders-similar?building_id=b1&title=sink%20is%20leaking')).body;
    assert.deepEqual(
      similar.map(s => s.id),
      [leak],
    );
    assert.equal(
      (await call('/api/orders-similar?building_id=b2&title=sink%20leaking')).body.length,
      0,
      'other buildings',
    );
    assert.equal((await call('/api/orders/' + leak)).status, 404, 'not visible before following');
    assert.equal((await call(`/api/orders/${leak}/follow`, 'POST', {})).status, 404, 'plain follow needs access');
    assert.equal((await call(`/api/orders/${leak}/follow`, 'POST', {me_too: true})).status, 200);
    const ticket = (await call('/api/orders/' + leak)).body;
    assert.equal(ticket.following, true);
    assert.equal(
      (await call('/api/orders')).body.orders.some(o => o.id === leak),
      true,
      'followed tickets are listed',
    );
    // Followers hear about comments; mentions bring people in.
    await as('demo-admin');
    await addUser('req2', 'requester', {name: 'Morgan'});
    await call(`/api/orders/${leak}/comments`, 'POST', {body: 'Plumber booked. @Morgan FYI', mentions: ['req2']});
    const notes = await db.query('SELECT user_id,event FROM notifications WHERE order_id=$1 ORDER BY user_id', [leak]);
    assert.ok(notes.some(n => n.user_id === 'req' && n.event === 'comment'));
    assert.ok(notes.some(n => n.user_id === 'req2' && n.event === 'mention'));
    await as('req2');
    assert.equal((await call('/api/orders/' + leak)).status, 200, 'mentioned people can open it');
    // A requester cannot mention people into tickets.
    await call(`/api/orders/${leak}/comments`, 'POST', {body: 'thanks', mentions: ['demo-admin']});
    assert.equal(
      (await db.query("SELECT * FROM order_followers WHERE order_id=$1 AND user_id='demo-admin'", [leak])).length,
      0,
    );
    await call(`/api/orders/${leak}/follow`, 'DELETE');
    assert.equal((await call('/api/orders/' + leak)).status, 404, 'unfollowing removes access');
  } finally {
    await w.close();
  }
});

test('checklists, templates and saved replies', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    const cat = (await call('/api/admin/forms/maintenance/categories', 'POST', {name: 'HVAC'})).body;
    const tpl = await call('/api/admin/checklist-templates', 'POST', {
      name: 'Filter change',
      category_id: cat.id,
      items: ['Power off unit', 'Replace filter', 'Record pressure'],
    });
    assert.equal(tpl.status, 201);
    assert.equal((await call('/api/admin/checklist-templates', 'POST', {name: 'Empty', items: []})).status, 400);
    const id = (
      await call('/api/orders', 'POST', {
        title: 'Filters',
        building_id: 'b1',
        due_date: '2026-10-09',
        category_id: cat.id,
      })
    ).body.id;
    let t = (await call('/api/orders/' + id)).body;
    assert.deepEqual(
      t.checklist.map(i => i.label),
      ['Power off unit', 'Replace filter', 'Record pressure'],
    );
    const first = t.checklist[0].id;
    const after = (await call(`/api/orders/${id}/checklist/${first}`, 'PATCH', {done: true})).body;
    assert.equal(after[0].done_by_name, 'Alex Morgan');
    assert.equal((await call(`/api/orders/${id}/checklist`, 'POST', {label: 'Photo of label'})).body.length, 4);
    await addUser('req', 'requester');
    await as('req');
    assert.equal((await call(`/api/orders/${id}/checklist/${first}`, 'PATCH', {done: false})).status, 404);
    // Replies: personal for everyone, shared only for people who manage forms.
    assert.equal((await call('/api/replies', 'POST', {title: 'Thanks', body: 'Thanks for reporting!'})).status, 201);
    assert.equal((await call('/api/replies', 'POST', {title: 'X', body: 'Y', shared: true})).status, 403);
    await as('demo-admin');
    await call('/api/replies', 'POST', {title: 'On our way', body: 'A technician is on the way.', shared: true});
    const mine = (await call('/api/replies')).body;
    assert.deepEqual(
      mine.map(r => r.title),
      ['On our way'],
      'others’ personal replies stay private',
    );
    await as('req');
    assert.deepEqual((await call('/api/replies')).body.map(r => r.title).sort(), ['On our way', 'Thanks']);
    const shared = (await call('/api/replies')).body.find(r => r.title === 'On our way');
    assert.equal((await call('/api/replies/' + shared.id, 'DELETE')).status, 403);
  } finally {
    await w.close();
  }
});

test('time tracking: one running timer, manual entries, totals and labor reports', async () => {
  const w = await startWorkspace();
  const {call, as, addUser, db} = w;
  try {
    assert.equal((await call('/api/orders/demo-1/time/start', 'POST')).status, 201);
    assert.equal((await call('/api/data')).body.timer.order_id, 'demo-1');
    const moved = (await call('/api/orders/demo-3/time/start', 'POST')).body;
    assert.equal(moved.stopped.order_id, 'demo-1', 'starting another timer stops the first');
    await db.query('UPDATE time_entries SET started_at=$1 WHERE ended_at IS NULL', [
      new Date(Date.now() - 45 * 60000).toISOString(),
    ]);
    const stopped = (await call('/api/time/stop', 'POST', {note: 'Swapped breaker'})).body.stopped;
    assert.equal(stopped.minutes, 45);
    assert.equal((await call('/api/time/stop', 'POST')).status, 409);
    const logged = (await call('/api/orders/demo-3/time', 'POST', {minutes: 30, note: 'Paperwork'})).body;
    assert.equal(logged.total_minutes, 75);
    assert.equal((await call('/api/orders/demo-3/time', 'POST', {minutes: 0})).status, 400);
    assert.equal((await call('/api/orders/demo-3')).body.time.total_minutes, 75);
    const report = (await call('/api/reports/summary')).body;
    assert.ok(report.labor.totalMinutes >= 75);
    assert.match((await call('/api/reports/orders.csv')).body, /Labor minutes/);
    await addUser('req', 'requester');
    await as('req');
    assert.equal((await call('/api/orders/demo-3/time/start', 'POST')).status, 404);
  } finally {
    await w.close();
  }
});

test('due-date targets fill missing due dates and escalate once', async () => {
  const w = await startWorkspace();
  const {call, db} = w;
  try {
    const today = dateInTimezone();
    // The form does not ask for a due date: the priority target sets it.
    await call('/api/admin/forms/maintenance/rules', 'PUT', {due_date: 'hidden'});
    const urgent = (await call('/api/orders', 'POST', {title: 'Gas smell', building_id: 'b1', priority: 'Urgent'})).body
      .id;
    const low = (await call('/api/orders', 'POST', {title: 'Squeaky door', building_id: 'b1', priority: 'Low'})).body
      .id;
    assert.equal((await call('/api/orders/' + urgent)).body.due_date, today);
    assert.equal((await call('/api/orders/' + low)).body.due_date, addDays(today, 7));
    assert.equal(
      (await call('/api/admin/sla', 'PUT', {enabled: true, days: {Urgent: 0, High: 1, Normal: 2, Low: -1}})).status,
      400,
    );
    // Sweep: due today warns once; overdue escalates once.
    await db.query('UPDATE work_orders SET due_date=$1 WHERE id=$2', [addDays(today, -2), low]);
    const {slaSweep} = await import('../ticket-tools.js');
    const {notify} = await import('../requests.js');
    const first = await slaSweep(db, {notify, timezone: undefined});
    assert.ok(first.warned >= 1 && first.escalated >= 1);
    const again = await slaSweep(db, {notify, timezone: undefined});
    assert.deepEqual(again, {warned: 0, escalated: 0}, 'each ticket is warned and escalated once');
    assert.ok((await db.query("SELECT * FROM notifications WHERE order_id=$1 AND event='due'", [low])).length >= 1);
    // A new due date starts watching again.
    await call('/api/orders/' + low, 'PATCH', {due_date: addDays(today, -1)});
    assert.equal((await slaSweep(db, {notify, timezone: undefined})).escalated, 1);
    await call('/api/admin/sla', 'PUT', {enabled: false, days: {Urgent: 0, High: 1, Normal: 3, Low: 7}});
    await db.query('UPDATE work_orders SET sla_breached_at=NULL');
    assert.deepEqual(await slaSweep(db, {notify, timezone: undefined}), {warned: 0, escalated: 0});
  } finally {
    await w.close();
  }
});
