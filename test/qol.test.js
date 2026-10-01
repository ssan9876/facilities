import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';

test('technicians take unassigned work and can give it back; views are personal', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    await addUser('tech', 'technician', {name: 'Toni'});
    await addUser('tech2', 'technician', {name: 'Sam'});
    await call('/api/orders/demo-3', 'PATCH', {assignee_id: ''});
    await as('tech');
    const ticket = (await call('/api/orders/demo-3')).body;
    assert.equal(ticket.permissions.take, true);
    assert.equal(ticket.permissions.assign, false);
    assert.equal((await call('/api/orders/demo-3', 'PATCH', {assignee_id: 'tech2'})).status, 403, 'not for others');
    assert.equal((await call('/api/orders/demo-3', 'PATCH', {assignee_id: 'tech'})).status, 200, 'take it');
    assert.equal((await call('/api/orders/demo-3')).body.permissions.take, false);
    await as('tech2');
    assert.equal((await call('/api/orders/demo-3', 'PATCH', {assignee_id: 'tech2'})).status, 403, 'taken already');
    assert.equal((await call('/api/orders/demo-3', 'PATCH', {assignee_id: ''})).status, 403, 'not theirs to release');
    await as('tech');
    assert.equal((await call('/api/orders/demo-3', 'PATCH', {assignee_id: ''})).status, 200, 'give it back (undo)');
    // Saved views belong to one person.
    const saved = await call('/api/views', 'POST', {
      name: 'Urgent North',
      page: 'orders',
      state: {filter: 'Open', search: 'leak', adv: {priority: 'Urgent', building: 'b1'}},
    });
    assert.equal(saved.status, 201);
    assert.deepEqual(saved.body[0].state.adv, {priority: 'Urgent', building: 'b1'});
    assert.equal((await call('/api/data')).body.views.length, 1);
    assert.equal((await call('/api/views', 'POST', {name: 'x', page: 'settings', state: {}})).status, 400);
    assert.equal(
      (await call('/api/views', 'POST', {name: 'x', page: 'orders', state: {adv: {'bad key!': '1'}}})).status,
      400,
    );
    const id = saved.body[0].id;
    assert.equal((await call('/api/views/' + id, 'PATCH', {name: 'Urgent · North'})).body[0].name, 'Urgent · North');
    await as('tech2');
    assert.equal((await call('/api/views')).body.length, 0);
    await call('/api/views/' + id, 'DELETE');
    await as('tech');
    assert.equal((await call('/api/views')).body.length, 1, 'others cannot remove it');
    assert.equal((await call('/api/views/' + id, 'DELETE')).body.length, 0);
  } finally {
    await w.close();
  }
});

test('undo can put a resolved ticket back without a second note, but only right after reopening it', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    await call('/api/orders/demo-3', 'PATCH', {status: 'Completed', resolution: 'Replaced the fuse.'});
    await call('/api/orders/demo-3', 'PATCH', {status: 'In progress'});
    assert.equal(
      (await call('/api/orders/demo-3', 'PATCH', {status: 'Completed'})).status,
      400,
      'a plain resolve needs a note',
    );
    await addUser('boss', 'manager');
    await as('boss');
    assert.equal(
      (await call('/api/orders/demo-3', 'PATCH', {status: 'Completed', undo: true})).status,
      400,
      'only the person who reopened it can undo',
    );
    await as('demo-admin');
    assert.equal((await call('/api/orders/demo-3', 'PATCH', {status: 'Completed', undo: true})).status, 200);
    const comments = (await call('/api/orders/demo-3/comments')).body.filter(c => c.body.startsWith('Resolution:'));
    assert.equal(comments.length, 1, 'no duplicate resolution note');
    assert.equal(
      (await call('/api/orders/demo-5', 'PATCH', {status: 'Completed', undo: true})).status,
      400,
      'never resolved, nothing to undo',
    );
  } finally {
    await w.close();
  }
});
