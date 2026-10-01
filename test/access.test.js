import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import YAML from 'yaml';
import {startWorkspace} from './helpers.js';
import {capabilityIds} from '../permissions.js';
import {accessTemplate} from '../access.js';
import {roleForClaims, syncSsoGroups} from '../auth.js';

const tempFile = text => {
  const dir = mkdtempSync(join(tmpdir(), 'facilities-access-'));
  const file = join(dir, 'access.yaml');
  writeFileSync(file, text);
  return {dir, file, write: t => writeFileSync(file, t)};
};

test('administration is split into sections and nobody can hand out what they lack', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    // An IT administrator who only installs updates and reads the audit log.
    assert.equal(
      (await call('/api/admin/roles', 'POST', {name: 'IT admin', capabilities: ['admin.updates', 'admin.audit']}))
        .status,
      201,
    );
    await addUser('it', 'it-admin');
    await as('it');
    assert.equal((await call('/api/admin/update')).status, 200);
    assert.equal((await call('/api/admin/audit')).status, 200);
    assert.equal((await call('/api/admin/backups')).status, 403);
    assert.equal((await call('/api/admin/roles')).status, 403);
    assert.equal((await call('/api/settings', 'PATCH', {maintenance: true})).status, 403);
    await as('demo-admin');
    // A people-and-roles administrator cannot create or assign roles stronger than their own.
    await call('/api/admin/roles', 'POST', {
      name: 'Access desk',
      capabilities: ['admin.people', 'admin.roles', 'requests.view_all'],
    });
    await addUser('desk', 'access-desk');
    await as('desk');
    const tooStrong = await call('/api/admin/roles', 'POST', {name: 'Sneaky', capabilities: ['requests.delete']});
    assert.equal(tooStrong.status, 403);
    assert.match(tooStrong.body.error, /requests\.delete/);
    assert.equal(
      (await call('/api/admin/roles', 'POST', {name: 'Viewer', capabilities: ['requests.view_all']})).status,
      201,
    );
    const group = (await call('/api/admin/groups', 'POST', {name: 'Managers', roles: ['manager']})).body;
    assert.equal(group.error && /cannot grant/.test(group.error), true, 'a group cannot grant a stronger role');
    assert.equal((await call('/api/admin/backups')).status, 403);
  } finally {
    await w.close();
  }
});

test('scoped roles and groups limit ticket work to request types and buildings', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    // North Campus (b1) maintenance only; may submit maintenance requests only.
    const north = await call('/api/admin/roles', 'POST', {
      name: 'North tech',
      base: 'technician',
      scope: {request_types: ['maintenance'], buildings: ['b1']},
      submit: ['maintenance'],
    });
    assert.equal(north.status, 201);
    assert.equal(
      (await call('/api/admin/roles', 'POST', {name: 'Bad', scope: {buildings: ['nowhere']}})).status,
      400,
      'unknown buildings are refused',
    );
    await addUser('nt', 'north-tech', {name: 'Nora Tech'});
    await as('nt');
    const seen = (await call('/api/orders')).body.orders.map(o => o.id).sort();
    assert.deepEqual(seen, ['demo-1', 'demo-6'], 'only North Campus tickets');
    assert.equal((await call('/api/orders/demo-3')).status, 404, 'other buildings are out of sight');
    const ticket = (await call('/api/orders/demo-1')).body;
    assert.equal(ticket.permissions.update, false, 'not assigned yet');
    assert.equal(
      (
        await call('/api/orders', 'POST', {
          title: 'Router',
          building_id: 'b1',
          request_type: 'technology',
          due_date: '2026-10-09',
        })
      ).status,
      403,
    );
    await as('demo-admin');
    await call('/api/settings', 'PATCH', {technology: true});
    // Assignable only inside the scope.
    assert.equal((await call('/api/orders/demo-1', 'PATCH', {assignee_id: 'nt'})).status, 200);
    assert.equal((await call('/api/orders/demo-3', 'PATCH', {assignee_id: 'nt'})).status, 400);
    assert.ok((await call('/api/orders/demo-1')).body.assignable.some(u => u.id === 'nt'));
    assert.ok(!(await call('/api/orders/demo-3')).body.assignable.some(u => u.id === 'nt'));
    await as('nt');
    assert.equal((await call('/api/orders/demo-1')).body.permissions.update, true);
    // A group adds an unscoped role on top.
    await as('demo-admin');
    const crew = (await call('/api/admin/groups', 'POST', {name: 'Whole campus', roles: ['technician']})).body;
    assert.equal((await call(`/api/admin/groups/${crew.id}/members/nt`, 'PUT', {member: true})).status, 200);
    await as('nt');
    assert.equal((await call('/api/orders')).body.total, 6, 'the group widens what they see');
    const me = (await call('/api/me')).body.user;
    assert.equal(me.submit_types, null, 'the technician grant allows every type');
    await as('demo-admin');
    await call(`/api/admin/groups/${crew.id}/members/nt`, 'PUT', {member: false});
    await as('nt');
    assert.equal((await call('/api/orders')).body.total, 2);
  } finally {
    await w.close();
  }
});

test('the access file defines roles, groups, sso and assignment rules, and the UI defers to it', async () => {
  const yaml = `
version: 1
roles:
  north-plumber:
    name: North Campus plumber
    extends: technician
    remove: [reports.export]
    scope: {request_types: [maintenance], buildings: [North Campus]}
  technician:
    capabilities: [requests.*]
groups:
  plumbers:
    name: Plumbers
    roles: [north-plumber]
    sso: [idp-plumbers]
    members: [pat@example.test, sam@example.test]
sso:
  roles:
    manager: [idp-managers]
  default_role: requester
assignment:
  - name: North plumbing
    request_type: maintenance
    buildings: [North Campus]
    assign_to: {group: plumbers}
    strategy: least_busy
`;
  const f = tempFile(yaml);
  const w = await startWorkspace({ACCESS_FILE: f.file});
  const {call, as, addUser, db} = w;
  try {
    // People named in the file must exist; they are added and the file reloaded.
    let status = (await call('/api/admin/access')).body.status;
    assert.equal(status.ok, false);
    assert.ok(status.problems.some(p => p.includes('pat@example.test')));
    await addUser('pat', 'requester', {name: 'Pat', email: 'pat@example.test'});
    await addUser('sam', 'requester', {name: 'Sam', email: 'sam@example.test'});
    const reload = await call('/api/admin/access/reload', 'POST');
    assert.equal(reload.status, 200, JSON.stringify(reload.body));
    status = reload.body.status;
    assert.deepEqual(status.summary, {roles: 2, groups: 1, rules: 1});
    const roles = (await call('/api/admin/roles')).body;
    const plumber = roles.find(r => r.id === 'north-plumber');
    assert.equal(plumber.source, 'code');
    assert.deepEqual(plumber.scope, {request_types: ['maintenance'], buildings: ['b1']});
    assert.ok(!plumber.capabilities.includes('reports.export'));
    assert.ok(roles.find(r => r.id === 'technician').capabilities.every(c => c.startsWith('requests.')));
    // The UI cannot change what the file owns.
    assert.equal((await call('/api/admin/roles/north-plumber', 'PATCH', {capabilities: []})).status, 409);
    const group = (await call('/api/admin')).body.groups.find(g => g.name === 'Plumbers');
    assert.equal(group.source, 'code');
    assert.equal((await call(`/api/admin/groups/${group.id}`, 'PATCH', {name: 'X'})).status, 409);
    assert.equal((await call(`/api/admin/groups/${group.id}/members/demo-admin`, 'PUT', {member: true})).status, 409);
    // Members get the group's scoped role.
    await as('pat');
    assert.deepEqual((await call('/api/orders')).body.orders.map(o => o.id).sort(), ['demo-1', 'demo-6']);
    await as('demo-admin');
    // Auto-assignment: least busy first, then taking turns.
    const make = async title =>
      (await call('/api/orders', 'POST', {title, building_id: 'b1', due_date: '2026-10-09'})).body.assignee_id;
    const first = await make('Leak 1'),
      second = await make('Leak 2');
    assert.ok(['pat', 'sam'].includes(first) && ['pat', 'sam'].includes(second) && first !== second);
    assert.equal(
      (await call('/api/orders', 'POST', {title: 'Elsewhere', building_id: 'b2', due_date: '2026-10-09'})).body
        .assignee_id,
      null,
      'rules only match their buildings',
    );
    assert.ok(
      (await call('/api/admin/audit?q=North plumbing')).body.entries.some(e => e.action === 'order.auto_assign'),
    );
    // SSO: the file's role map and group claims.
    assert.equal(roleForClaims({sub: 'x', groups: ['idp-managers']}, {}, db.access.sso), 'manager');
    assert.equal(roleForClaims({sub: 'x', groups: ['facilities-admins']}, {}, db.access.sso), 'requester');
    await addUser('lee', 'requester');
    await syncSsoGroups(db, 'lee', {groups: ['idp-plumbers']});
    assert.equal((await db.query("SELECT * FROM group_members WHERE user_id='lee' AND source='sso'")).length, 1);
    await syncSsoGroups(db, 'lee', {groups: []});
    assert.equal((await db.query("SELECT * FROM group_members WHERE user_id='lee'")).length, 0);
    // A broken file changes nothing and reports every problem.
    f.write(yaml.replace('capabilities: [requests.*]', 'capabilities: [requests.fly, admin]'));
    const bad = await call('/api/admin/access/reload', 'POST');
    assert.equal(bad.status, 422);
    assert.ok(bad.body.problems.some(p => p.includes('requests.fly')));
    assert.ok(bad.body.problems.some(p => p.includes('"admin"')));
    assert.equal((await call('/api/admin/roles')).body.find(r => r.id === 'north-plumber').source, 'code');
    // Export round-trips through the validator.
    const exported = (await call('/api/admin/access/export.yaml')).body.toString();
    const parsed = YAML.parse(exported);
    assert.ok(parsed.roles['north-plumber'] && parsed.groups.plumbers && parsed.assignment.length === 1);
    // Dropping the role and group from the file hands them back to the UI.
    f.write('version: 1\n');
    assert.equal((await call('/api/admin/access/reload', 'POST')).status, 200);
    const after = (await call('/api/admin/roles')).body;
    assert.ok(!after.some(r => r.id === 'north-plumber'), 'unused file roles are removed');
    assert.equal(after.find(r => r.id === 'technician').overridden, false, 'built-in roles return to defaults');
    assert.equal((await call('/api/admin')).body.groups.find(g => g.name === 'Plumbers').source, 'ui');
  } finally {
    await w.close();
    rmSync(f.dir, {recursive: true, force: true});
  }
});

test('assignment rules can be managed in Settings and the template documents every capability', async () => {
  const w = await startWorkspace();
  const {call, addUser} = w;
  try {
    await addUser('t1', 'technician', {name: 'Taylor'});
    const rule = await call('/api/admin/assignment-rules', 'POST', {
      name: 'Community Center',
      buildings: ['b3'],
      target_kind: 'user',
      target_id: 't1',
    });
    assert.equal(rule.status, 201);
    assert.equal(
      (await call('/api/orders', 'POST', {title: 'Door', building_id: 'b3', due_date: '2026-10-09'})).body.assignee_id,
      't1',
    );
    assert.equal(
      (await call('/api/admin/assignment-rules', 'POST', {name: 'X', target_kind: 'group', target_id: 'nope'})).status,
      400,
    );
    assert.equal(
      (await call('/api/admin/assignment-rules/' + rule.body.id, 'PATCH', {active: false})).body.rules[0].active,
      false,
    );
    assert.equal((await call('/api/admin/assignment-rules/' + rule.body.id, 'DELETE')).status, 200);
    const template = accessTemplate();
    for (const id of capabilityIds) assert.ok(template.includes(id), `template lists ${id}`);
    assert.ok(YAML.parse(template).roles.plumber);
    const applied = await call('/api/admin/access/document', 'PUT', {text: template});
    assert.equal(applied.status, 200, 'the template applies as-is: ' + JSON.stringify(applied.body.problems));
  } finally {
    await w.close();
  }
});

test('the committed template matches the code (npm run access:template)', async () => {
  const {readFileSync} = await import('node:fs');
  assert.equal(readFileSync(new URL('../deployment/access.example.yaml', import.meta.url), 'utf8'), accessTemplate());
});

test('administrators edit, upload, check and restore the access document in Settings', async () => {
  const f = tempFile('version: 1\nroles:\n  night-crew:\n    name: Night crew\n    extends: technician\n');
  const env = {ACCESS_FILE: f.file};
  const w = await startWorkspace(env);
  const {call, as, addUser, db} = w;
  try {
    const {loadAccessFile} = await import('../access.js');
    let doc = (await call('/api/admin/access/document')).body;
    assert.match(doc.text, /night-crew/, 'the file applied at startup is the active document');
    assert.equal(doc.versions[0].source, 'file');
    // Checking reports problems without changing anything.
    const broken = 'version: 1\nroles:\n  bad:\n    name: Bad\n    capabilities: [requests.fly]\n';
    const check = await call('/api/admin/access/check', 'POST', {text: broken});
    assert.equal(check.status, 422);
    assert.ok(check.body.problems.some(p => p.includes('requests.fly')));
    assert.equal((await call('/api/admin/access/document', 'PUT', {text: broken})).status, 422);
    assert.equal((await call('/api/admin/access/document')).body.versions.length, 1, 'nothing was applied');
    const good =
      'version: 1\nroles:\n  day-crew:\n    name: Day crew\n    extends: technician\n    scope: {buildings: [North Campus]}\n';
    assert.deepEqual((await call('/api/admin/access/check', 'POST', {text: good})).body.roles, ['day-crew']);
    // Upload applies it: day crew replaces night crew.
    const applied = await call('/api/admin/access/document', 'PUT', {text: good, source: 'upload'});
    assert.equal(applied.status, 200);
    assert.equal(applied.body.status.source, 'upload');
    assert.equal(applied.body.status.applied_by, 'Alex Morgan');
    const roles = (await call('/api/admin/roles')).body;
    assert.equal(roles.find(r => r.id === 'day-crew').source, 'code');
    assert.ok(!roles.some(r => r.id === 'night-crew'));
    // A restart with the same server file keeps the console's version.
    await loadAccessFile(db, env);
    assert.equal(db.access.source, 'upload');
    assert.ok((await call('/api/admin/roles')).body.some(r => r.id === 'day-crew'));
    // Restoring an earlier version: load it, then apply it again.
    doc = (await call('/api/admin/access/document')).body;
    assert.equal(doc.versions.length, 2);
    const first = (await call('/api/admin/access/versions/' + doc.versions[1].id)).body;
    assert.match(first.text, /night-crew/);
    assert.equal((await call('/api/admin/access/document', 'PUT', {text: first.text})).body.status.source, 'editor');
    // A changed server file wins at the next start.
    f.write('version: 1\nroles:\n  late-crew:\n    name: Late crew\n    extends: requester\n');
    await loadAccessFile(db, env);
    assert.equal(db.access.source, 'file');
    assert.ok((await call('/api/admin/roles')).body.some(r => r.id === 'late-crew'));
    assert.equal((await call('/api/admin/access/document', 'PUT', {text: 'x'.repeat(61000)})).status, 413);
    // Only people who manage roles may see or change it.
    await addUser('mgr', 'manager');
    await as('mgr');
    assert.equal((await call('/api/admin/access/document')).status, 403);
    assert.equal((await call('/api/admin/access/document', 'PUT', {text: good})).status, 403);
  } finally {
    await w.close();
    rmSync(f.dir, {recursive: true, force: true});
  }
});
