import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../db.js';
import {createApp, generateMaintenance} from '../server.js';
import {roleForClaims} from '../auth.js';
import {dateInTimezone} from '../dates.js';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('organization timezone defines date boundaries', () => {
  const instant = new Date('2026-10-01T01:00:00Z');
  assert.equal(dateInTimezone('America/Phoenix', instant), '2026-09-30');
  assert.equal(dateInTimezone('UTC', instant), '2026-10-01');
});

test('local records persist after reopening the database', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'facilities-test-'));
  const path = join(folder, 'persistence.db');
  try {
    let db = await openDatabase(null, path);
    await db.query('INSERT INTO buildings(id,name,address,created_at) VALUES($1,$2,$3,$4)', [
      'persistent',
      'Test building',
      '',
      new Date().toISOString(),
    ]);
    await db.close();
    db = await openDatabase(null, path);
    assert.equal((await db.query('SELECT name FROM buildings WHERE id=$1', ['persistent']))[0].name, 'Test building');
    await db.close();
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
});

test('role mapping uses explicit IdP groups and allowed group restriction', () => {
  assert.equal(roleForClaims({sub: 'first-user'}), 'requester');
  assert.equal(roleForClaims({groups: ['facilities-technicians']}), 'technician');
  assert.equal(roleForClaims({groups: ['facilities-managers']}), 'manager');
  assert.equal(roleForClaims({groups: ['facilities-admins']}), 'admin');
  assert.equal(roleForClaims({groups: 'facilities-admins'}), 'admin');
  assert.equal(roleForClaims({sub: 'admin-sub'}, {OIDC_ADMIN_SUBJECT: 'admin-sub'}), 'admin');
  assert.throws(
    () => roleForClaims({groups: ['facilities-admins']}, {OIDC_ALLOWED_GROUPS: 'employees'}),
    /allowed organization/,
  );
});

test('production refuses demo login and unsafe configuration', async () => {
  const db = await openDatabase(null, ':memory:');
  try {
    await assert.rejects(createApp({NODE_ENV: 'production', AUTH_MODE: 'demo'}, db), /disabled in production/);
    await assert.rejects(createApp({NODE_ENV: 'production', AUTH_MODE: 'oidc'}, db), /SESSION_SECRET/);
    await assert.rejects(
      createApp(
        {NODE_ENV: 'production', AUTH_MODE: 'oidc', SESSION_SECRET: 'x'.repeat(40), APP_URL: 'http://example.test'},
        db,
      ),
      /HTTPS/,
    );
  } finally {
    await db.close();
  }
});

test('persistent workflows, CSRF, role boundaries and recurring maintenance', async () => {
  const db = await openDatabase(null, ':memory:');
  const {app} = await createApp({AUTH_MODE: 'demo', SEED_DEMO: 'true', SESSION_SECRET: 'test-secret'}, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '',
    csrf = '';
  async function call(path, method = 'GET', body, token = csrf) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {cookie, 'Content-Type': 'application/json', 'x-csrf-token': token},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return {status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null};
  }
  try {
    assert.equal((await call('/api/data')).status, 401);
    assert.equal((await call('/auth/login')).status, 302);
    csrf = (await call('/api/me')).json.csrf;
    const data = (await call('/api/data')).json;
    assert.equal(data.buildings.length, 3);
    assert.equal((await call('/api/buildings', 'POST', {name: 'Test'}, '')).status, 403);
    assert.equal(
      (await call('/api/orders', 'POST', {title: 'Broken', building_id: 'b1', asset_id: 'a2', due_date: '2026-10-01'}))
        .status,
      400,
    );
    assert.equal(
      (await call('/api/orders', 'POST', {title: 'Bad date', building_id: 'b1', due_date: '2026-02-30'})).status,
      400,
    );
    const created = await call('/api/orders', 'POST', {
      title: 'Test repair',
      description: 'Inspect and fix',
      building_id: 'b1',
      priority: 'High',
      due_date: '2026-10-01',
    });
    assert.equal(created.status, 201);
    const id = created.json.id;
    // Resolving needs a note, which is kept on the ticket as a comment.
    const noNote = await call(`/api/orders/${id}`, 'PATCH', {status: 'Completed'});
    assert.equal(noNote.status, 400);
    assert.match(noNote.json.error, /resolved/);
    assert.equal((await call(`/api/orders/${id}`, 'PATCH', {status: 'Completed', resolution: '  '})).status, 400);
    assert.equal(
      (await call(`/api/orders/${id}`, 'PATCH', {status: 'Completed', resolution: 'Fixed and checked.'})).status,
      200,
    );
    assert.equal((await call(`/api/orders/${id}/comments`)).json[0].body, 'Resolution: Fixed and checked.');
    assert.equal(
      (await call(`/api/orders/${id}`, 'PATCH', {status: 'Completed'})).status,
      200,
      'an already resolved ticket needs no second note',
    );
    assert.equal((await call(`/api/orders/${id}/comments`, 'POST', {body: 'Repair complete'})).status, 201);
    assert.equal((await call(`/api/orders/${id}/comments`)).json[1].body, 'Repair complete');
    assert.equal(
      (
        await call('/api/maintenance', 'POST', {
          title: 'Daily inspection',
          building_id: 'b1',
          interval_days: 1,
          next_due: '2020-01-01',
        })
      ).status,
      201,
    );
    assert.equal(await generateMaintenance(db), 1);
    assert.equal(await generateMaintenance(db), 0);
    const plan = (await db.query("SELECT * FROM maintenance WHERE title='Daily inspection'"))[0];
    assert.ok(plan.next_due > dateInTimezone());
    assert.equal((await db.query('SELECT * FROM maintenance_runs')).length, 1);
    // Reuse the same session while changing its database role: every request rechecks access.
    await db.query('UPDATE users SET role=$1 WHERE id=$2', ['requester', 'demo-admin']);
    assert.equal((await call('/api/buildings', 'POST', {name: 'Forbidden'})).status, 403);
    assert.equal((await call(`/api/orders/${id}`, 'PATCH', {status: 'Open'})).status, 403);
    await db.query('INSERT INTO users(id,subject,name,email,role) VALUES($1,$2,$3,$4,$5)', [
      'other',
      'other',
      'Other user',
      '',
      'requester',
    ]);
    await db.query('UPDATE work_orders SET requester_id=$1 WHERE id=$2', ['other', id]);
    assert.ok(!(await call('/api/orders')).json.orders.some(x => x.id === id));
    assert.equal((await call(`/api/orders/${id}/comments`)).status, 404);
    assert.equal((await call('/api/logout', 'POST')).status, 200);
    assert.equal((await call('/api/data')).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});
