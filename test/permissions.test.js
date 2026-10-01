import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';

// Each row: method, path, body, and the expected allow (non-403) per role.
const matrix = [
  ['POST', '/api/buildings', {name: 'Role check'}, {requester: false, technician: false, manager: true}],
  ['PATCH', '/api/buildings/b2', {name: 'Operations Center'}, {requester: false, technician: false, manager: true}],
  ['PATCH', '/api/assets/a3', {name: 'Emergency generator'}, {requester: false, technician: false, manager: true}],
  [
    'POST',
    '/api/maintenance',
    {title: 'Role plan', building_id: 'b1', interval_days: 30, next_due: '2027-01-01'},
    {requester: false, technician: false, manager: true},
  ],
  [
    'PATCH',
    '/api/maintenance/pm2',
    {title: 'Generator load test'},
    {requester: false, technician: false, manager: true},
  ],
  ['POST', '/api/maintenance/generate', undefined, {requester: false, technician: false, manager: true}],
  ['POST', '/api/spaces', {name: 'Role room', building_id: 'b1'}, {requester: false, technician: false, manager: true}],
  ['GET', '/api/parts', undefined, {requester: false, technician: true, manager: true}],
  ['POST', '/api/parts', {name: 'Role part', quantity: 1}, {requester: false, technician: false, manager: true}],
  ['POST', '/api/parts/p1/adjust', {delta: 1}, {requester: false, technician: false, manager: true}],
  ['GET', '/api/reports/summary', undefined, {requester: false, technician: false, manager: true}],
  ['GET', '/api/reports/orders.csv', undefined, {requester: false, technician: true, manager: true}],
  ['GET', '/api/reports/assets.csv', undefined, {requester: false, technician: true, manager: true}],
  ['DELETE', '/api/orders/demo-5', undefined, {requester: false, technician: false, manager: true}],
  ['GET', '/api/admin', undefined, {requester: false, technician: false, manager: false}],
  ['GET', '/api/admin/audit', undefined, {requester: false, technician: false, manager: false}],
  ['GET', '/api/admin/email', undefined, {requester: false, technician: false, manager: false}],
  ['PATCH', '/api/settings', {maintenance: true}, {requester: false, technician: false, manager: false}],
  [
    'PUT',
    '/api/admin/workspace',
    {name: 'X', welcome: 'Y', provisioned_only: false},
    {requester: false, technician: false, manager: false},
  ],
  ['POST', '/api/admin/keys', {name: 'X'}, {requester: false, technician: false, manager: false}],
  ['GET', '/api/releases', undefined, {requester: false, technician: false, manager: false}],
];

test('API enforces the role permission matrix', async () => {
  const w = await startWorkspace({RELEASE_REPOSITORY: 'invalid repository'});
  try {
    for (const role of ['requester', 'technician', 'manager']) await w.addUser(role, role);
    for (const role of ['requester', 'technician', 'manager']) {
      await w.as(role);
      for (const [method, path, body, allowed] of matrix) {
        const {status} = await w.call(path, method, body);
        if (allowed[role]) assert.notEqual(status, 403, `${role} should be allowed ${method} ${path}`);
        else assert.equal(status, 403, `${role} must be refused ${method} ${path} (got ${status})`);
      }
    }
    // Requesters only see their own requests in lists, details and summaries.
    await w.as('requester');
    assert.equal((await w.call('/api/orders')).body.total, 0);
    assert.equal((await w.call('/api/orders/demo-1')).status, 404);
    assert.equal((await w.call('/api/summary')).body.active, 0);
    const data = (await w.call('/api/data')).body;
    assert.deepEqual([data.users.length, data.maintenance.length, data.parts.length], [0, 0, 0]);
    // Technicians change status only on work assigned to them.
    await w.as('technician');
    assert.equal((await w.call('/api/orders/demo-1', 'PATCH', {status: 'In progress'})).status, 403);
    await w.db.query("UPDATE work_orders SET assignee_id='technician' WHERE id='demo-1'");
    assert.equal((await w.call('/api/orders/demo-1', 'PATCH', {status: 'In progress'})).status, 200);
    assert.equal((await w.call('/api/orders/demo-1', 'PATCH', {assignee_id: 'manager'})).status, 403);
    // A disabled account loses access on its next request.
    await w.db.query("UPDATE users SET active=0 WHERE id='technician'");
    assert.equal((await w.call('/api/data')).status, 401);
  } finally {
    await w.close();
  }
});
