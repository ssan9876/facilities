import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';
import {dateInTimezone} from '../dates.js';

test('register pages, filters and searches on the server', async () => {
  const w = await startWorkspace();
  const {call} = w;
  try {
    for (let i = 0; i < 7; i++)
      await call('/api/orders', 'POST', {
        title: `Bulk item ${i}`,
        building_id: 'b2',
        due_date: '2030-01-01',
        request_type: i % 2 ? 'technology' : 'maintenance',
      });
    await call('/api/orders', 'POST', {title: '100% literal_match', building_id: 'b3', due_date: '2030-01-01'});
    const all = (await call('/api/orders')).body;
    assert.equal(all.total, 14);
    const page1 = (await call('/api/orders?limit=5')).body,
      page2 = (await call('/api/orders?limit=5&offset=5')).body;
    assert.equal(page1.orders.length, 5);
    assert.equal(page1.total, 14);
    assert.equal(new Set([...page1.orders, ...page2.orders].map(o => o.id)).size, 10, 'pages do not overlap');
    assert.equal((await call('/api/orders?limit=500')).status, 400);
    assert.equal((await call('/api/orders?offset=-1')).status, 400);
    assert.equal((await call('/api/orders?type=technology')).body.total, 3);
    assert.equal((await call('/api/orders?status=Completed')).body.total, 1);
    assert.equal((await call('/api/orders?status=Invented')).status, 400);
    const overdue = (await call('/api/orders?status=Overdue')).body.orders;
    assert.ok(overdue.length >= 1 && overdue.every(o => o.status !== 'Completed' && o.due_date < dateInTimezone()));
    assert.equal((await call('/api/orders?status=Active')).body.total, 13);
    // LIKE wildcards in search text are literal.
    assert.equal((await call('/api/orders?q=' + encodeURIComponent('100%'))).body.total, 1);
    assert.equal((await call('/api/orders?q=' + encodeURIComponent('_match'))).body.total, 1);
    assert.equal((await call('/api/orders?q=' + encodeURIComponent('%'))).body.total, 1);
    assert.equal((await call('/api/orders?q=rooftop')).body.total, 2, 'search covers asset names');
    assert.equal((await call('/api/orders?building=b3&q=pump')).body.total, 1);
    assert.equal((await call('/api/orders?assignee=none')).body.total, 8);
    assert.equal((await call('/api/orders?assignee=me')).body.total, 6);
    assert.equal((await call('/api/orders?from=2030-13-01')).status, 400);
    assert.equal((await call(`/api/orders?from=${dateInTimezone()}&to=${dateInTimezone()}`)).body.total, 14);
    const summary = (await call('/api/summary')).body;
    assert.deepEqual([summary.total, summary.active, summary.completed], [14, 13, 1]);
    assert.equal(summary.activeByType.technology, 3);
    assert.equal(summary.activeByBuilding.b2, 9);
    await call('/api/settings', 'PATCH', {technology: false});
    assert.equal((await call('/api/orders')).body.total, 11, 'disabled request types leave the register');
    assert.equal((await call('/api/orders?type=technology')).body.total, 0);
    assert.equal((await call('/api/summary')).body.activeByType.technology, undefined);
  } finally {
    await w.close();
  }
});
