import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startWorkspace} from './helpers.js';
import {dateInTimezone, addDays} from '../dates.js';
import {purgeOldData} from '../housekeeping.js';

test('administrators configure categories, questions and required fields per request type', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  const create = body =>
    call('/api/orders', 'POST', {title: 'Leak', building_id: 'b1', due_date: '2026-10-05', ...body});
  try {
    const plumbing = (await call('/api/admin/forms/maintenance/categories', 'POST', {name: 'Plumbing'})).body;
    const hvac = (await call('/api/admin/forms/maintenance/categories', 'POST', {name: 'HVAC'})).body;
    assert.equal((await call('/api/admin/forms/maintenance/categories', 'POST', {name: 'plumbing'})).status, 409);
    const floor = (
      await call('/api/admin/forms/maintenance/fields', 'POST', {
        label: 'Floor',
        kind: 'select',
        options: ['Ground', 'First', 'Second'],
        required: true,
      })
    ).body;
    const shutoff = (
      await call('/api/admin/forms/maintenance/fields', 'POST', {
        label: 'Is the water shut off?',
        kind: 'yesno',
        category_id: plumbing.id,
        required: true,
      })
    ).body;
    assert.equal(
      (await call('/api/admin/forms/maintenance/fields', 'POST', {label: 'Bad', kind: 'select', options: ['One']}))
        .status,
      400,
    );
    assert.equal((await call('/api/admin/forms/maintenance/fields', 'POST', {label: 'Bad', kind: 'html'})).status, 400);
    assert.equal(
      (
        await call('/api/admin/forms/maintenance/rules', 'PUT', {
          category: 'required',
          description: 'required',
          priority: 'hidden',
        })
      ).status,
      200,
    );
    assert.equal((await call('/api/admin/forms/maintenance/rules', 'PUT', {priority: 'required'})).status, 400);
    const forms = (await call('/api/data')).body.forms.maintenance;
    assert.equal(forms.categories.length, 2);
    assert.equal(forms.rules.category, 'required');
    // Required rules are enforced by the server, not just the form.
    assert.match((await create({description: 'x', answers: {[floor.id]: 'First'}})).body.error, /category/);
    assert.match((await create({category_id: hvac.id, answers: {[floor.id]: 'First'}})).body.error, /Details/);
    assert.match((await create({category_id: hvac.id, description: 'x'})).body.error, /Floor is required/);
    assert.match(
      (await create({category_id: hvac.id, description: 'x', answers: {[floor.id]: 'Attic'}})).body.error,
      /listed options/,
    );
    assert.match(
      (await create({category_id: plumbing.id, description: 'x', answers: {[floor.id]: 'First'}})).body.error,
      /water shut off/,
      'category-specific questions apply to that category',
    );
    const made = await create({
      category_id: plumbing.id,
      description: 'Under the sink',
      priority: 'Urgent',
      answers: {[floor.id]: 'First', [shutoff.id]: 'Yes'},
    });
    assert.equal(made.status, 201);
    const ticket = (await call('/api/orders/' + made.body.id)).body;
    assert.equal(ticket.category, 'Plumbing');
    assert.equal(ticket.priority, 'Normal', 'hidden priority defaults to Normal');
    assert.deepEqual(
      ticket.answers.map(a => [a.label, a.value]),
      [
        ['Floor', 'First'],
        ['Is the water shut off?', 'Yes'],
      ],
    );
    // Filters: by category and by answer.
    assert.equal((await call(`/api/orders?category=${plumbing.id}`)).body.total, 1);
    assert.equal((await call(`/api/orders?category=none&type=maintenance`)).body.total, 6);
    assert.equal((await call(`/api/orders?f_${floor.id}=First`)).body.total, 1);
    assert.equal((await call(`/api/orders?f_${floor.id}=Second`)).body.total, 0);
    assert.equal((await call('/api/orders?q=plumbing')).body.total, 1, 'search covers the category');
    const csv = (await call('/api/reports/orders.csv?category=' + plumbing.id)).body;
    assert.match(csv, /Plumbing/);
    assert.match(csv, /Floor: First; Is the water shut off\?: Yes/);
    // Editing changes the category and answers under the same rules.
    assert.equal(
      (await call('/api/orders/' + made.body.id, 'PATCH', {category_id: hvac.id, answers: {[floor.id]: 'Second'}}))
        .status,
      200,
    );
    assert.deepEqual(
      (await call('/api/orders/' + made.body.id)).body.answers.map(a => a.value),
      ['Second'],
    );
    // A requester sees the form configuration but cannot change it.
    await addUser('req', 'requester');
    await as('req');
    assert.equal((await call('/api/forms')).status, 200);
    assert.equal((await call('/api/admin/forms/maintenance/rules', 'PUT', {asset: 'required'})).status, 403);
    await as('demo-admin');
    // Used categories and answered questions are archived, not deleted.
    assert.equal((await call('/api/admin/categories/' + hvac.id, 'DELETE')).status, 409);
    assert.equal((await call('/api/admin/fields/' + floor.id, 'DELETE')).status, 409);
    assert.equal((await call('/api/admin/fields/' + floor.id, 'PATCH', {archived: true})).status, 200);
    assert.equal(
      (await call('/api/data')).body.forms.maintenance.fields.some(f => f.id === floor.id),
      false,
    );
    assert.equal((await call('/api/orders/' + made.body.id, 'DELETE')).status, 200, 'answers go with the ticket');
    assert.ok((await call('/api/admin/audit?q=question')).body.entries.length >= 2);
  } finally {
    await w.close();
  }
});

test('register filters handle lists, due ranges and sorting', async () => {
  const w = await startWorkspace();
  const {call} = w;
  try {
    assert.equal((await call('/api/orders?priority=High,Urgent')).body.total, 3);
    assert.equal((await call('/api/orders?priority=Extreme')).status, 400);
    assert.equal((await call('/api/orders?statuses=Open,On%20hold')).body.total, 4);
    assert.equal((await call('/api/orders?building=b1,b3')).body.total, 4);
    const today = dateInTimezone();
    assert.equal((await call(`/api/orders?due_from=${today}&due_to=${addDays(today, 2)}`)).body.total, 3);
    assert.equal((await call('/api/orders?overdue=1')).body.total, 1);
    const urgentFirst = (await call('/api/orders?sort=priority')).body.orders.map(o => o.priority);
    assert.equal(urgentFirst[0], 'Urgent');
    assert.equal((await call('/api/orders?sort=sideways')).status, 400);
    assert.deepEqual(
      (await call('/api/orders?sort=number&limit=2')).body.orders.map(o => o.number),
      [6, 5],
    );
  } finally {
    await w.close();
  }
});

test('the calendar lists tickets by due day and projects maintenance plans', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    const today = dateInTimezone();
    const from = addDays(today, -3),
      to = addDays(today, 40);
    const cal = (await call(`/api/calendar?from=${from}&to=${to}`)).body;
    assert.equal(cal.orders.length, 6);
    assert.ok(cal.orders.every(o => o.due_date >= from && o.due_date <= to));
    // pm1 every 30 days from today+3 and pm2 every 90 days from today+7.
    assert.deepEqual(
      cal.plans.map(p => [p.id, p.due_date]),
      [
        ['pm1', addDays(today, 3)],
        ['pm1', addDays(today, 33)],
        ['pm2', addDays(today, 7)],
      ],
    );
    assert.equal((await call(`/api/calendar?from=${from}&to=${to}&plans=0`)).body.plans.length, 0);
    assert.equal((await call(`/api/calendar?from=${from}&to=${to}&priority=Urgent`)).body.orders.length, 1);
    assert.equal((await call(`/api/calendar?from=${to}&to=${from}`)).status, 400);
    assert.equal((await call(`/api/calendar?from=${from}&to=${addDays(from, 90)}`)).status, 400);
    await addUser('req', 'requester');
    await as('req');
    const mine = (await call(`/api/calendar?from=${from}&to=${to}`)).body;
    assert.deepEqual([mine.orders.length, mine.plans.length], [0, 0], 'requesters see only their own, no plans');
  } finally {
    await w.close();
  }
});

test('retention trims old records and backups are requested through the agent folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'facilities-backups-'));
  const w = await startWorkspace({UPDATE_DIR: dir});
  const {call, db} = w;
  try {
    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    await db.query(
      "INSERT INTO notifications(id,user_id,order_id,event,message,created_at) VALUES('old-n','demo-admin','demo-1','comment','x',$1)",
      [old],
    );
    await db.query(
      "INSERT INTO email_outbox(id,to_address,subject,body,created_at,send_after,sent_at) VALUES('old-e','a@b.c','s','b',$1,$1,$1)",
      [old],
    );
    await db.query(
      "INSERT INTO audit_log(id,created_at,actor_name,action,entity_type,summary) VALUES('ancient',$1,'X','x','settings','x')",
      [new Date(Date.now() - 900 * 86400000).toISOString()],
    );
    const removed = await purgeOldData(db);
    assert.deepEqual(removed, {notifications: 1, audit: 1, email: 1});
    assert.ok((await call('/api/admin/audit?q=retention')).body.entries.some(e => e.action === 'retention.purge'));
    assert.equal((await call('/api/admin/retention', 'PUT', {audit_days: 30})).status, 400, 'audit keeps 90 days');
    const saved = (await call('/api/admin/retention', 'PUT', {notifications_days: 0, audit_days: 0, email_days: 7}))
      .body;
    assert.deepEqual([saved.notifications_days, saved.audit_days, saved.email_days], [0, 0, 7]);
    // Backups: status comes from the host; "back up now" drops a request file.
    assert.deepEqual((await call('/api/admin/backups')).body, {agent: true, status: null, pending: false});
    assert.equal((await call('/api/admin/backups', 'POST')).status, 202);
    assert.match(readFileSync(join(dir, 'backup-request.json'), 'utf8'), /Alex Morgan/);
    assert.equal((await call('/api/admin/backups', 'POST')).status, 409);
    rmSync(join(dir, 'backup-request.json'));
    writeFileSync(
      join(dir, 'backup.json'),
      JSON.stringify({state: 'succeeded', last_success: new Date().toISOString(), recent: []}),
    );
    assert.equal((await call('/api/admin/backups')).body.status.state, 'succeeded');
  } finally {
    await w.close();
    rmSync(dir, {recursive: true, force: true});
  }
  const none = await startWorkspace();
  try {
    assert.equal((await none.call('/api/admin/backups', 'POST')).status, 503);
  } finally {
    await none.close();
  }
});
