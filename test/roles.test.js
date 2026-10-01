import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';
import {builtinRoles, capabilityIds} from '../permissions.js';

test('built-in roles follow permissions.js and administrators can override and reset them', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    await addUser('tech', 'technician');
    await addUser('boss', 'manager');
    const roles = (await call('/api/admin/roles')).body;
    assert.deepEqual(
      roles.map(r => r.id),
      ['requester', 'technician', 'manager', 'admin'],
    );
    assert.deepEqual(roles.find(r => r.id === 'technician').capabilities, builtinRoles.technician.capabilities);
    assert.deepEqual(roles.find(r => r.id === 'admin').capabilities, capabilityIds);
    await as('tech');
    assert.deepEqual((await call('/api/me')).body.user.capabilities, builtinRoles.technician.capabilities);
    assert.equal((await call('/api/parts')).status, 200);
    await as('boss');
    assert.equal((await call('/api/admin/roles')).status, 403, 'managers cannot edit roles');
    await as('demo-admin');
    // Override: technicians lose inventory; the change applies on their next request.
    const without = builtinRoles.technician.capabilities.filter(c => c !== 'inventory.view');
    assert.equal((await call('/api/admin/roles/technician', 'PATCH', {capabilities: without})).status, 200);
    await as('tech');
    assert.equal((await call('/api/parts')).status, 403);
    await as('demo-admin');
    assert.equal((await call('/api/admin/roles')).body.find(r => r.id === 'technician').overridden, true);
    assert.equal((await call('/api/admin/roles/technician', 'DELETE')).status, 200, 'reset to defaults');
    await as('tech');
    assert.equal((await call('/api/parts')).status, 200);
    await as('demo-admin');
    // Guard rails.
    assert.equal((await call('/api/admin/roles/admin', 'PATCH', {capabilities: []})).status, 403);
    assert.equal((await call('/api/admin/roles/manager', 'PATCH', {capabilities: ['admin']})).status, 400);
    assert.equal((await call('/api/admin/roles/manager', 'PATCH', {capabilities: ['invented']})).status, 400);
    assert.equal((await call('/api/admin/roles/nobody', 'PATCH', {capabilities: []})).status, 404);
    const audit = (await call('/api/admin/audit?entity_type=role')).body.entries.map(e => e.action);
    assert.ok(audit.includes('role.update') && audit.includes('role.reset'));
  } finally {
    await w.close();
  }
});

test('custom roles grant exactly their capabilities', async () => {
  const w = await startWorkspace({OIDC_ISSUER: 'https://idp.example/oidc'});
  const {call, as, db} = w;
  try {
    const custodian = (
      await call('/api/admin/roles', 'POST', {name: 'Custodian', description: 'Night crew', base: 'technician'})
    ).body;
    assert.equal(custodian.id, 'custodian');
    assert.deepEqual(custodian.capabilities, builtinRoles.technician.capabilities);
    assert.equal((await call('/api/admin/roles', 'POST', {name: ''})).status, 400);
    const person = (
      await call('/api/admin/users', 'POST', {oidc_subject: 'night-1', name: 'Night Crew', role: 'custodian'})
    ).body;
    assert.equal(person.role, 'custodian');
    assert.equal((await call('/api/admin/users', 'POST', {oidc_subject: 'x', name: 'X', role: 'admin'})).status, 400);
    assert.equal((await call('/api/admin/users', 'POST', {oidc_subject: 'y', name: 'Y', role: 'ghost'})).status, 400);
    // Assignable, so managers can give them work; they see every request.
    assert.equal((await call('/api/orders/demo-2', 'PATCH', {assignee_id: person.id})).status, 200);
    await as(person.id);
    assert.equal((await call('/api/orders')).body.total, 6);
    assert.equal(
      (await call('/api/orders/demo-2', 'PATCH', {status: 'Completed', resolution: 'Fixed and checked.'})).status,
      200,
      'assigned work',
    );
    assert.equal(
      (await call('/api/orders/demo-3', 'PATCH', {status: 'Completed', resolution: 'Fixed and checked.'})).status,
      403,
      'unassigned work',
    );
    await as('demo-admin');
    // Narrow the role: only their own requests, and notified of new ones.
    assert.equal(
      (await call('/api/admin/roles/custodian', 'PATCH', {capabilities: ['requests.notified'], name: 'Custodial'}))
        .status,
      200,
    );
    await as(person.id);
    assert.equal((await call('/api/orders')).body.total, 0);
    assert.equal((await call('/api/parts')).status, 403);
    await as('demo-admin');
    await call('/api/orders', 'POST', {title: 'Spill in hallway', building_id: 'b1', due_date: '2026-10-05'});
    assert.equal(
      (await db.query("SELECT * FROM notifications WHERE user_id=$1 AND event='created'", [person.id])).length,
      1,
    );
    assert.equal(
      (await call('/api/orders/demo-3', 'PATCH', {assignee_id: person.id})).status,
      400,
      'no longer assignable',
    );
    // A role in use cannot be deleted.
    assert.equal((await call('/api/admin/roles/custodian', 'DELETE')).status, 409);
    await call('/api/admin/users/' + person.id, 'PATCH', {role: 'requester'});
    assert.equal((await call('/api/admin/roles/custodian', 'DELETE')).status, 200);
    assert.ok(!(await call('/api/admin/roles')).body.some(r => r.id === 'custodian'));
  } finally {
    await w.close();
  }
});

test('report links survive sign-in and QR labels print for managers only', async () => {
  const w = await startWorkspace();
  const {call, as, addUser, base} = w;
  try {
    const page = await fetch(base + '/report?building=b1&asset=a1');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="app">/);
    const anon = await fetch(base + '/labels?building=b1', {redirect: 'manual'});
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/auth/login?return=%2Flabels%3Fbuilding%3Db1');
    for (const [target, expected] of [
      ['/report?building=b1&asset=a1', '/report?building=b1&asset=a1'],
      ['//evil.example/x', '/'],
      ['https://evil.example', '/'],
    ]) {
      const login = await fetch(base + '/auth/login?return=' + encodeURIComponent(target), {redirect: 'manual'});
      assert.equal(login.headers.get('location'), expected, target);
    }
    const labels = await call('/labels?building=b1');
    assert.equal(labels.status, 200);
    assert.equal((labels.body.match(/class="label"/g) || []).length, 2, 'the building and its one asset');
    assert.match(labels.body, /Rooftop HVAC/);
    assert.match(labels.body, /<svg/);
    assert.equal((await call('/labels?building=missing')).status, 404);
    await addUser('tech', 'technician');
    await as('tech');
    assert.equal((await call('/labels?building=b1')).status, 403);
  } finally {
    await w.close();
  }
});
