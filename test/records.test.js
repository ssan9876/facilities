import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateMaintenance} from '../server.js';
import {startWorkspace} from './helpers.js';

test('buildings, assets and maintenance plans can be edited, archived and deleted safely', async () => {
  const w = await startWorkspace();
  const {call, db} = w;
  try {
    const b = (await call('/api/buildings', 'POST', {name: 'Annex', address: '1 Side St'})).body;
    assert.equal((await call('/api/buildings/' + b.id, 'PATCH', {name: 'Annex West'})).status, 200);
    assert.equal((await db.query('SELECT name,address FROM buildings WHERE id=$1', [b.id]))[0].address, '1 Side St');
    assert.equal((await call('/api/buildings/' + b.id, 'PATCH', {name: ''})).status, 400);
    assert.equal((await call('/api/buildings/missing', 'PATCH', {name: 'x'})).status, 404);
    const a = (await call('/api/assets', 'POST', {name: 'Boiler', building_id: b.id, category: 'Plumbing'})).body;
    // Referenced records cannot be deleted; they are archived instead.
    assert.equal((await call('/api/buildings/' + b.id, 'DELETE')).status, 409);
    assert.equal(
      (await call('/api/assets/' + a.id, 'PATCH', {building_id: 'b1'})).status,
      200,
      'an unreferenced asset can move',
    );
    assert.equal((await call('/api/assets/' + a.id, 'PATCH', {building_id: b.id, serial: 'BLR-1'})).status, 200);
    const order = (
      await call('/api/orders', 'POST', {
        title: 'Boiler noise',
        building_id: b.id,
        asset_id: a.id,
        due_date: '2026-10-05',
      })
    ).body.id;
    assert.equal(
      (await call('/api/assets/' + a.id, 'PATCH', {building_id: 'b1'})).status,
      409,
      'an asset with requests cannot move',
    );
    assert.equal((await call('/api/assets/' + a.id, 'DELETE')).status, 409);
    assert.equal((await call('/api/buildings/' + b.id, 'PATCH', {archived: true})).status, 200);
    assert.ok((await db.query('SELECT archived_at FROM buildings WHERE id=$1', [b.id]))[0].archived_at);
    // Archived buildings stay on existing requests but are refused for new work.
    assert.equal(
      (await call('/api/orders', 'POST', {title: 'New', building_id: b.id, due_date: '2026-10-05'})).status,
      400,
    );
    assert.equal((await call('/api/orders/' + order, 'PATCH', {status: 'In progress'})).status, 200);
    assert.equal((await call('/api/buildings/' + b.id, 'PATCH', {archived: false})).status, 200);
    const empty = (await call('/api/buildings', 'POST', {name: 'Mistake'})).body;
    assert.equal((await call('/api/buildings/' + empty.id, 'DELETE')).status, 200);
    assert.equal((await db.query('SELECT * FROM buildings WHERE id=$1', [empty.id])).length, 0);

    const plan = (
      await call('/api/maintenance', 'POST', {
        title: 'Filter swap',
        building_id: 'b1',
        interval_days: 7,
        next_due: '2020-01-01',
      })
    ).body.id;
    assert.equal((await call('/api/maintenance/' + plan, 'PATCH', {active: false})).status, 200);
    assert.equal(await generateMaintenance(db), 0, 'paused plans do not generate');
    assert.equal(
      (await call('/api/maintenance/' + plan, 'PATCH', {active: true, interval_days: 14, title: 'Filter replacement'}))
        .status,
      200,
    );
    assert.equal((await call('/api/maintenance/' + plan, 'PATCH', {interval_days: 0})).status, 400);
    assert.equal(
      (await call('/api/maintenance/' + plan, 'PATCH', {asset_id: 'a2'})).status,
      400,
      'asset must match the building',
    );
    assert.ok((await generateMaintenance(db)) >= 1);
    assert.equal((await call('/api/maintenance/' + plan, 'DELETE')).status, 200);
    assert.ok(
      (await db.query('SELECT id FROM work_orders WHERE id LIKE $1', [`pm-${plan}-%`])).length,
      'generated requests stay after the plan is deleted',
    );
    const log = (await call('/api/admin/audit?entity_type=building')).body.entries.map(e => e.action);
    for (const action of [
      'building.create',
      'building.update',
      'building.archive',
      'building.restore',
      'building.delete',
    ])
      assert.ok(log.includes(action), action);
  } finally {
    await w.close();
  }
});

test('request details, deletion, comment ownership and history', async () => {
  const w = await startWorkspace();
  const {call, db, as, addUser} = w;
  try {
    await addUser('req', 'requester');
    await addUser('other', 'requester');
    await addUser('tech', 'technician');
    await as('req');
    const id = (
      await call('/api/orders', 'POST', {
        title: 'Sticky door',
        building_id: 'b1',
        due_date: '2026-10-05',
        description: 'Front entrance',
      })
    ).body.id;
    assert.equal(
      (await call('/api/orders/' + id, 'PATCH', {title: 'Sticky front door', priority: 'High'})).status,
      200,
      'requesters edit their open requests',
    );
    assert.equal(
      (await call('/api/orders/' + id, 'PATCH', {status: 'Completed'})).status,
      403,
      'requesters cannot change status',
    );
    assert.equal((await call('/api/orders/' + id, 'PATCH', {priority: 'Extreme'})).status, 400);
    const comment = (await call(`/api/orders/${id}/comments`, 'POST', {body: 'It sticks in the rain'})).body.id;
    await as('demo-admin');
    assert.equal(
      (await call(`/api/orders/${id}/comments/${comment}`, 'PATCH', {body: 'changed by admin'})).status,
      403,
      'only authors edit comments',
    );
    await call('/api/orders/' + id, 'PATCH', {status: 'In progress', assignee_id: 'tech'});
    await as('req');
    assert.equal(
      (await call('/api/orders/' + id, 'PATCH', {title: 'Too late'})).status,
      403,
      'requesters cannot edit once work starts',
    );
    assert.equal(
      (await call(`/api/orders/${id}/comments/${comment}`, 'PATCH', {body: 'It sticks when wet'})).status,
      200,
    );
    const comments = (await call(`/api/orders/${id}/comments`)).body;
    assert.equal(comments[0].body, 'It sticks when wet');
    assert.ok(comments[0].edited_at);
    await as('other');
    assert.equal((await call('/api/orders/' + id)).status, 404);
    assert.equal((await call(`/api/orders/${id}/history`)).status, 404);
    assert.equal((await call(`/api/orders/${id}/comments/${comment}`, 'DELETE')).status, 404);
    await as('tech');
    assert.equal(
      (await call('/api/orders/' + id, 'PATCH', {title: 'Tech rename', description: 'Seal replaced'})).status,
      200,
      'the assignee can rewrite the text',
    );
    assert.equal(
      (await call('/api/orders/' + id, 'PATCH', {priority: 'Low'})).status,
      403,
      'but not priority, place or dates',
    );
    assert.equal(
      (await call('/api/orders/' + id, 'PATCH', {title: 'Sneaky', building_id: 'b2'})).status,
      403,
      'mixed text and place edits are refused',
    );
    assert.equal((await call('/api/orders/' + id, 'DELETE')).status, 403);
    await as('demo-admin');
    assert.equal(
      (await call(`/api/orders/${id}/comments/${comment}`, 'DELETE')).status,
      200,
      'managers can remove comments',
    );
    const history = (await call(`/api/orders/${id}/history`)).body;
    const titles = history.filter(h => h.action === 'order.update' && h.details?.title).map(h => h.details.title);
    assert.deepEqual(titles, [
      ['Sticky front door', 'Tech rename'],
      ['Sticky door', 'Sticky front door'],
    ]);
    assert.ok(history.some(h => h.action === 'comment.delete'));
    assert.equal((await call('/api/orders/' + id, 'DELETE')).status, 200);
    assert.equal((await call('/api/orders/' + id)).status, 404);
    assert.equal((await db.query('SELECT * FROM comments WHERE work_order_id=$1', [id])).length, 0);
    assert.equal((await db.query('SELECT * FROM notifications WHERE order_id=$1', [id])).length, 0);
    assert.ok(
      (await call('/api/admin/audit?entity_id=' + id)).body.entries.some(e => e.action === 'order.delete'),
      'deletion is retained in the audit log',
    );
  } finally {
    await w.close();
  }
});
