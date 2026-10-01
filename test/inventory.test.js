import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';

test('parts track stock through adjustments and request usage', async () => {
  const w = await startWorkspace();
  const {call, db, as, addUser} = w;
  const qty = async id => (await db.query('SELECT quantity FROM parts WHERE id=$1', [id]))[0].quantity;
  try {
    const part = (
      await call('/api/parts', 'POST', {
        name: 'Belt',
        sku: 'BLT-1',
        quantity: '5',
        min_quantity: '2',
        unit_cost: '$12.50',
      })
    ).body;
    assert.equal(part.unit_cost_cents, 1250);
    assert.equal((await call('/api/parts', 'POST', {name: 'Bad cost', unit_cost: '12.505'})).status, 400);
    assert.equal((await call('/api/parts', 'POST', {name: 'Negative', quantity: -1})).status, 400);
    assert.equal(
      (await call('/api/parts/' + part.id, 'PATCH', {quantity: 99})).status,
      400,
      'quantity changes go through adjustments',
    );
    assert.equal((await call(`/api/parts/${part.id}/adjust`, 'POST', {delta: -9})).status, 409);
    assert.equal((await call(`/api/parts/${part.id}/adjust`, 'POST', {delta: 0})).status, 400);
    assert.equal((await call(`/api/parts/${part.id}/adjust`, 'POST', {delta: 3, reason: 'Delivery'})).body.quantity, 8);
    await addUser('tech', 'technician');
    await call('/api/orders/demo-1', 'PATCH', {assignee_id: 'tech'});
    await as('tech');
    assert.equal(
      (await call('/api/orders/demo-2/parts', 'POST', {part_id: part.id, quantity: 1})).status,
      403,
      'only on assigned work',
    );
    const used = await call('/api/orders/demo-1/parts', 'POST', {part_id: part.id, quantity: 6});
    assert.equal(used.status, 201);
    assert.deepEqual([used.body.remaining, used.body.low], [2, true]);
    assert.equal(
      (await call('/api/orders/demo-1/parts', 'POST', {part_id: part.id, quantity: 3})).status,
      409,
      'stock cannot go negative',
    );
    assert.equal(await qty(part.id), 2);
    const detail = (await call('/api/orders/demo-1')).body;
    assert.equal(detail.parts[0].quantity, 6);
    assert.equal((await call(`/api/orders/demo-1/parts/${used.body.id}`, 'DELETE')).status, 200);
    assert.equal(await qty(part.id), 8, 'returned parts go back into stock');
    await call('/api/orders/demo-1/parts', 'POST', {part_id: part.id, quantity: 1});
    await as('demo-admin');
    assert.equal((await call('/api/parts/' + part.id, 'DELETE')).status, 409, 'used parts are archived, not deleted');
    assert.equal((await call('/api/parts/' + part.id, 'PATCH', {archived: true})).status, 200);
    assert.equal((await call('/api/orders/demo-1/parts', 'POST', {part_id: part.id, quantity: 1})).status, 400);
    const unused = (await call('/api/parts', 'POST', {name: 'Typo'})).body;
    assert.equal((await call('/api/parts/' + unused.id, 'DELETE')).status, 200);
    const history = (await call('/api/admin/audit?entity_type=part&entity_id=' + part.id)).body.entries;
    assert.ok(history.some(e => e.action === 'part.adjust' && e.details.quantity[1] === 8));
    await call('/api/settings', 'PATCH', {inventory: false});
    assert.equal((await call('/api/parts')).status, 403);
    assert.equal((await call('/api/data')).body.parts.length, 0);
  } finally {
    await w.close();
  }
});
