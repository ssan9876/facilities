import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';
import {csv} from '../csv.js';
import {dateInTimezone} from '../dates.js';
import {generateMaintenance} from '../server.js';

test('CSV cells are quoted and spreadsheet formulas neutralized', () => {
  const out = csv(
    ['a', 'b'],
    [
      ['=HYPERLINK("x")', 'plain'],
      ['line\nbreak', '-5'],
      ['@cmd', 'say "hi", ok'],
    ],
  );
  assert.ok(out.startsWith('﻿a,b\r\n'));
  assert.ok(out.includes(`"'=HYPERLINK(""x"")",plain`));
  assert.ok(out.includes(`"line\nbreak",'-5`));
  assert.ok(out.includes(`'@cmd,"say ""hi"", ok"`));
});

test('reports summarize the period and exports follow register filters', async () => {
  const w = await startWorkspace();
  const {call, db} = w;
  const today = dateInTimezone();
  try {
    await call('/api/orders/demo-1', 'PATCH', {status: 'Completed'});
    await db.query("UPDATE work_orders SET created_at=$1,completed_at=$2 WHERE id='demo-1'", [
      new Date(Date.now() - 5 * 3600000).toISOString(),
      new Date().toISOString(),
    ]);
    await call('/api/maintenance', 'POST', {title: 'Due PM', building_id: 'b1', interval_days: 30, next_due: today});
    await generateMaintenance(db);
    const pm = (await db.query('SELECT work_order_id FROM maintenance_runs'))[0].work_order_id;
    await call('/api/orders/' + pm, 'PATCH', {status: 'Completed'});
    await call('/api/orders/demo-2/parts', 'POST', {part_id: 'p1', quantity: 2});
    const r = (await call(`/api/reports/summary?from=${today}&to=${today}`)).body;
    assert.equal(r.created, 7);
    assert.equal(r.completed, 3);
    assert.ok(r.averageHoursToComplete >= 1 && r.averageHoursToComplete < 5);
    assert.equal(r.byType.find(x => x.key === 'maintenance').count, 7);
    assert.equal(r.byBuilding.find(x => x.key === 'b1').label, 'North Campus');
    assert.deepEqual(r.maintenance, {due: 1, completed: 1, onTime: 1});
    assert.equal(r.parts.items[0].quantity, 2);
    assert.equal(r.parts.totalCostCents, 1798);
    assert.equal((await call('/api/reports/summary?from=2026-02-01&to=2026-01-01')).status, 400);
    assert.equal((await call('/api/reports/summary?from=nonsense')).status, 400);
    const empty = (await call('/api/reports/summary?from=2001-01-01&to=2001-01-31')).body;
    assert.deepEqual([empty.created, empty.completed, empty.averageHoursToComplete], [0, 0, null]);
    const exported = await call('/api/reports/orders.csv?status=Completed');
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), /attachment; filename="requests-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = exported.body.trim().split('\r\n');
    assert.equal(lines.length, 1 + 3, 'header plus the completed requests');
    assert.ok(lines[0].includes('Title') && lines[0].includes('Completed'));
    for (const file of ['assets.csv', 'maintenance.csv', 'parts.csv'])
      assert.equal((await call('/api/reports/' + file)).status, 200);
    assert.ok((await call('/api/reports/parts.csv')).body.includes('FLT-20251'));
  } finally {
    await w.close();
  }
});
