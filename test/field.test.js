import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';
import {repeatSignal} from '../field.js';

test('asset history lists visible tickets, parts and labor and flags repeat problems', async () => {
  const w = await startWorkspace();
  const {call, as, addUser, base} = w;
  try {
    // The pump (a2) gets three requests: a repeat problem.
    for (const title of ['Pump noisy', 'Pump leaking', 'Pump tripped breaker'])
      await call('/api/orders', 'POST', {title, building_id: 'b3', asset_id: 'a2', due_date: '2026-10-09'});
    await call('/api/orders/demo-4/time', 'POST', {minutes: 40});
    const h = (await call('/api/assets/a2/history')).body;
    assert.equal(h.asset.name, 'Main circulation pump');
    assert.equal(h.tickets.length, 4);
    assert.equal(h.repeat, true);
    assert.match(h.reason, /in the last 90 days/);
    assert.equal(h.labor_minutes, 40);
    assert.equal((await call('/api/assets/nope/history')).status, 404);
    // Requesters see only their own tickets for the asset.
    await addUser('req', 'requester');
    await as('req');
    const mine = (await call('/api/assets/a2/history')).body;
    assert.equal(mine.tickets.length, 0);
    assert.equal(mine.asset.name, 'Main circulation pump', 'a scanned label still names the asset');
    // Page routes and the scanner's decoder are served.
    assert.equal((await fetch(base + '/assets/a2')).status, 200);
    const js = await fetch(base + '/vendor/jsqr.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    const sw = await fetch(base + '/sw.js');
    assert.equal(sw.status, 200);
    assert.equal((await fetch(base + '/manifest.webmanifest')).status, 200);
  } finally {
    await w.close();
  }
});

test('repeat signal: three in 90 days, or two of a category in 60', () => {
  const day = 86400000,
    now = Date.parse('2026-10-01T12:00:00Z');
  const at = d => new Date(now - d * day).toISOString();
  assert.equal(repeatSignal([{created_at: at(1)}, {created_at: at(30)}], now).repeat, false);
  assert.equal(repeatSignal([{created_at: at(1)}, {created_at: at(30)}, {created_at: at(80)}], now).repeat, true);
  assert.equal(
    repeatSignal(
      [
        {created_at: at(1), category: 'Plumbing'},
        {created_at: at(50), category: 'Plumbing'},
      ],
      now,
    ).repeat,
    true,
  );
  assert.equal(
    repeatSignal(
      [
        {created_at: at(1), category: 'Plumbing'},
        {created_at: at(70), category: 'Plumbing'},
      ],
      now,
    ).repeat,
    false,
  );
});
