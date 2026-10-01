import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';

test('space reservations refuse conflicts and follow the approval workflow', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  const book = (title, space, starts, ends, building = 'b2') =>
    call('/api/orders', 'POST', {
      request_type: 'schedule',
      title,
      building_id: building,
      space_id: space,
      starts_at: starts,
      ends_at: ends,
    });
  try {
    await addUser('req', 'requester');
    await addUser('req2', 'requester');
    const room = (await call('/api/spaces', 'POST', {name: 'Board room', building_id: 'b2', capacity: '10'})).body;
    assert.equal(room.capacity, 10);
    assert.equal((await call('/api/spaces', 'POST', {name: 'Nowhere', building_id: 'missing'})).status, 400);
    await as('req');
    const first = await book('Planning', 's2', '2026-11-02T09:00', '2026-11-02T10:00');
    assert.deepEqual([first.status, first.body.reservation_status], [201, 'approved']);
    const clash = await book('Clash', 's2', '2026-11-02T09:30', '2026-11-02T11:00');
    assert.equal(clash.status, 409);
    assert.match(clash.body.error, /already reserved/);
    assert.equal(
      (await book('Back to back', 's2', '2026-11-02T10:00', '2026-11-02T11:00')).status,
      201,
      'adjacent bookings are allowed',
    );
    assert.equal(
      (await book('Other room', 's1', '2026-11-02T09:00', '2026-11-02T10:00')).status,
      400,
      'space must be in the building',
    );
    // Requesters see when a space is busy but not other people's titles.
    await as('req2');
    const busy = (await call('/api/spaces/s2/bookings?date=2026-11-02')).body;
    assert.equal(busy.length, 2);
    assert.equal(busy[0].title, undefined);
    const hall = await book('Gala', 's1', '2026-12-01T18:00', '2026-12-01T22:00', 'b3');
    assert.equal(hall.body.reservation_status, 'pending', 'Main hall needs approval');
    assert.equal(
      (await book('Gala rival', 's1', '2026-12-01T20:00', '2026-12-01T21:00', 'b3')).status,
      409,
      'pending requests hold the slot',
    );
    assert.equal((await call(`/api/orders/${hall.body.id}/reservation`, 'POST', {decision: 'approved'})).status, 403);
    await as('demo-admin');
    assert.equal((await call('/api/summary')).body.pendingReservations, 1);
    assert.equal((await call('/api/orders?reservation=pending')).body.total, 1);
    assert.equal((await call(`/api/orders/${hall.body.id}/reservation`, 'POST', {decision: 'declined'})).status, 200);
    await as('req');
    assert.equal(
      (await book('Second try', 's1', '2026-12-01T20:00', '2026-12-01T21:00', 'b3')).status,
      201,
      'declined reservations free the slot',
    );
    // Moving a booking re-checks conflicts, excluding itself.
    assert.equal(
      (
        await call('/api/orders/' + first.body.id, 'PATCH', {
          starts_at: '2026-11-02T08:30',
          ends_at: '2026-11-02T09:45',
        })
      ).status,
      200,
    );
    assert.equal((await call('/api/orders/' + first.body.id, 'PATCH', {ends_at: '2026-11-02T10:30'})).status, 409);
    assert.equal((await call(`/api/orders/${first.body.id}/reservation`, 'POST', {decision: 'cancelled'})).status, 200);
    await as('req2');
    assert.equal((await book('After cancel', 's2', '2026-11-02T09:00', '2026-11-02T09:30')).status, 201);
    await as('demo-admin');
    assert.equal((await call('/api/spaces/s2', 'DELETE')).status, 409, 'spaces with reservations are archived');
    assert.equal((await call('/api/spaces/s2', 'PATCH', {archived: true})).status, 200);
    assert.equal((await book('Archived', 's2', '2026-11-03T09:00', '2026-11-03T10:00')).status, 400);
    assert.equal((await call('/api/spaces/' + room.id, 'DELETE')).status, 200);
  } finally {
    await w.close();
  }
});
