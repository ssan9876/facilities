import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp, generateMaintenance} from '../server.js';
import {openDatabase} from '../db.js';

// TEST_DATABASE_URL must name a disposable database, never the running workspace.
test(
  'PostgreSQL supports settings, schedule requests, sessions and maintenance generation',
  {skip: !process.env.TEST_DATABASE_URL},
  async () => {
    const db = await openDatabase(process.env.TEST_DATABASE_URL);
    const {app} = await createApp(
      {
        AUTH_MODE: 'demo',
        SEED_DEMO: 'true',
        SESSION_SECRET: 'postgres-integration-test-secret',
        OIDC_ISSUER: 'https://idp.example/oidc',
      },
      db,
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '',
      csrf = '';
    const call = async (path, method = 'GET', body) => {
      const response = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {cookie, 'Content-Type': 'application/json', 'x-csrf-token': csrf},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return {
        status: response.status,
        body: response.headers.get('content-type')?.includes('json') ? await response.json() : null,
      };
    };
    try {
      assert.equal((await call('/auth/login')).status, 302);
      csrf = (await call('/api/me')).body.csrf;
      const created = await call('/api/orders', 'POST', {
        request_type: 'schedule',
        title: 'PostgreSQL schedule',
        building_id: 'b1',
        starts_at: '2026-10-02T09:00',
        ends_at: '2026-10-02T10:00',
        priority: 'Normal',
      });
      assert.equal(created.status, 201);
      assert.equal((await call('/api/settings', 'PATCH', {schedule: false})).status, 200);
      assert.ok(!(await call('/api/orders')).body.orders.some(x => x.id === created.body.id));
      assert.equal((await call('/api/settings', 'PATCH', {schedule: true})).status, 200);
      assert.ok((await call('/api/orders')).body.orders.some(x => x.id === created.body.id));
      assert.equal(
        (
          await call('/api/maintenance', 'POST', {
            title: 'PostgreSQL recurring',
            building_id: 'b1',
            interval_days: 1,
            next_due: '2020-01-01',
          })
        ).status,
        201,
      );
      assert.equal(await generateMaintenance(db), 1);
      assert.equal(await generateMaintenance(db), 0);
      const g = await call('/api/admin/groups', 'POST', {name: 'PostgreSQL group', auto_assign: true});
      assert.equal(g.status, 201);
      const u = await call('/api/admin/users', 'POST', {oidc_subject: 'postgres-subject', name: 'PostgreSQL user'});
      assert.equal(u.status, 201);
      assert.ok((await call('/api/admin')).body.members.some(m => m.group_id === g.body.id && m.user_id === u.body.id));
      assert.equal((await call('/api/admin/users/' + u.body.id, 'PATCH', {active: false})).status, 200);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await db.close();
    }
  },
);

test(
  'PostgreSQL runs search, reports, attachments, reservations, inventory, audit and email SQL',
  {skip: !process.env.TEST_DATABASE_URL},
  async () => {
    const db = await openDatabase(process.env.TEST_DATABASE_URL);
    const sent = [];
    const {app} = await createApp(
      {
        AUTH_MODE: 'demo',
        SEED_DEMO: 'true',
        SESSION_SECRET: 'postgres-integration-test-secret',
        SMTP_FROM: 'f@example.test',
        LOG_LEVEL: 'silent',
      },
      db,
      {
        transport: {
          sendMail: async m => {
            sent.push(m);
          },
        },
      },
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '',
      csrf = '';
    const call = async (path, method = 'GET', body, headers = {}) => {
      const raw = body instanceof Uint8Array;
      const response = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {cookie, 'x-csrf-token': csrf, ...(raw ? {} : {'Content-Type': 'application/json'}), ...headers},
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const type = response.headers.get('content-type') || '';
      return {
        status: response.status,
        body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
      };
    };
    try {
      await call('/auth/login');
      csrf = (await call('/api/me')).body.csrf;
      const marker = 'pg_' + Date.now();
      const created = await call('/api/orders', 'POST', {
        title: `${marker} 100% done`,
        building_id: 'b1',
        due_date: '2026-10-05',
      });
      assert.equal(created.status, 201);
      assert.equal((await call('/api/orders?q=' + encodeURIComponent(marker + ' 100%'))).body.total, 1);
      assert.equal(
        (await call('/api/orders?q=' + encodeURIComponent('%' + marker))).body.total,
        0,
        'wildcards are literal',
      );
      assert.ok((await call('/api/summary')).body.active >= 1);
      await call('/api/orders/' + created.body.id, 'PATCH', {status: 'Completed', resolution: 'Fixed and checked.'});
      const report = await call('/api/reports/summary');
      assert.equal(report.status, 200);
      assert.ok(report.body.completed >= 1);
      assert.equal(typeof report.body.averageHoursToComplete, 'number');
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );
      const file = await call(`/api/orders/${created.body.id}/attachments`, 'POST', new Uint8Array(png), {
        'Content-Type': 'image/png',
        'X-File-Name': 'p.png',
      });
      assert.equal(file.status, 201);
      assert.deepEqual((await call('/api/attachments/' + file.body.id)).body, png, 'BYTEA round-trips exactly');
      const space = (await call('/api/spaces', 'POST', {name: marker, building_id: 'b2'})).body.id;
      const book = title =>
        call('/api/orders', 'POST', {
          request_type: 'schedule',
          title,
          building_id: 'b2',
          space_id: space,
          starts_at: '2027-01-05T09:00',
          ends_at: '2027-01-05T10:00',
        });
      assert.equal((await book('first')).status, 201);
      assert.equal((await book('second')).status, 409);
      const part = (await call('/api/parts', 'POST', {name: marker, quantity: 3})).body.id;
      assert.equal(
        (await call(`/api/orders/${created.body.id}/parts`, 'POST', {part_id: part, quantity: 2})).body.remaining,
        1,
      );
      assert.equal(
        (await call(`/api/orders/${created.body.id}/parts`, 'POST', {part_id: part, quantity: 2})).status,
        409,
      );
      assert.equal((await call(`/api/parts/${part}/adjust`, 'POST', {delta: -5})).status, 409);
      const audit = (await call('/api/admin/audit?q=' + marker)).body;
      assert.ok(audit.entries.length >= 2);
      const older = (await call('/api/admin/audit?limit=1')).body;
      assert.ok(older.next);
      assert.equal((await call('/api/admin/audit?limit=1&before=' + encodeURIComponent(older.next))).status, 200);
      assert.equal((await call('/api/settings', 'PATCH', {email: true})).status, 200);
      await db.query("UPDATE users SET email='admin@example.test' WHERE id='demo-admin'");
      await db.query(
        "INSERT INTO users(id,subject,name,email,role) VALUES($1,$1,'PG tech','t@example.test','technician') ON CONFLICT DO NOTHING",
        ['pg-tech'],
      );
      await call('/api/orders/demo-3', 'PATCH', {assignee_id: 'pg-tech'});
      const {deliverEmails} = await import('../email.js');
      await deliverEmails(
        db,
        {
          sendMail: async m => {
            sent.push(m);
          },
        },
        {appUrl: 'https://x.example', from: 'f@example.test', organization: 'PG'},
      );
      assert.ok(sent.some(m => m.to === 't@example.test'));
      await call('/api/settings', 'PATCH', {email: false});
      assert.equal((await call('/api/orders/' + created.body.id, 'DELETE')).status, 200);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await db.close();
    }
  },
);

test(
  'PostgreSQL runs request forms, register filters, the calendar and retention SQL',
  {skip: !process.env.TEST_DATABASE_URL},
  async () => {
    const db = await openDatabase(process.env.TEST_DATABASE_URL);
    const {app} = await createApp(
      {AUTH_MODE: 'demo', SEED_DEMO: 'true', SESSION_SECRET: 'postgres-integration-test-secret', LOG_LEVEL: 'silent'},
      db,
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '',
      csrf = '';
    const call = async (path, method = 'GET', body) => {
      const response = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {cookie, 'x-csrf-token': csrf, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const type = response.headers.get('content-type') || '';
      return {status: response.status, body: type.includes('json') ? await response.json() : await response.text()};
    };
    try {
      await call('/auth/login');
      csrf = (await call('/api/me')).body.csrf;
      const marker = 'pgf' + Date.now();
      const cat = (await call('/api/admin/forms/technology/categories', 'POST', {name: marker})).body;
      const q = (
        await call('/api/admin/forms/technology/fields', 'POST', {
          label: marker + ' room',
          kind: 'select',
          options: ['A', 'B'],
        })
      ).body;
      const made = await call('/api/orders', 'POST', {
        request_type: 'technology',
        title: marker,
        building_id: 'b1',
        due_date: '2026-10-05',
        category_id: cat.id,
        answers: {[q.id]: 'B'},
      });
      assert.equal(made.status, 201);
      assert.equal((await call(`/api/orders?category=${cat.id}&f_${q.id}=B`)).body.total, 1);
      assert.ok((await call('/api/orders?sort=priority&priority=High,Urgent&statuses=Open,On%20hold')).status === 200);
      assert.ok(
        (await call('/api/orders?sort=updated&due_from=2020-01-01&due_to=2030-01-01&overdue=1')).status === 200,
      );
      assert.equal((await call(`/api/orders?q=${marker}`)).body.total, 1);
      const cal = await call('/api/calendar?from=2026-10-01&to=2026-10-31');
      assert.equal(cal.status, 200);
      assert.ok(cal.body.orders.some(o => o.title === marker));
      assert.match((await call(`/api/reports/orders.csv?category=${cat.id}`)).body, new RegExp(`${marker} room: B`));
      assert.equal((await call('/api/admin/retention', 'PUT', {notifications_days: 120})).status, 200);
      assert.equal((await call('/api/orders/' + made.body.id, 'DELETE')).status, 200);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await db.close();
    }
  },
);

test(
  'PostgreSQL applies the access file, scoped visibility and assignment rules',
  {skip: !process.env.TEST_DATABASE_URL},
  async () => {
    const {mkdtempSync, writeFileSync, rmSync} = await import('node:fs');
    const {join} = await import('node:path');
    const {tmpdir} = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'pg-access-'));
    const marker = 'pga' + Date.now();
    const file = join(dir, 'access.yaml');
    writeFileSync(
      file,
      `version: 1
roles:
  ${marker}:
    name: Scoped ${marker}
    extends: technician
    scope: {buildings: [North Campus]}
groups:
  ${marker}-crew:
    name: Crew ${marker}
    roles: [${marker}]
assignment:
  - name: Rule ${marker}
    buildings: [Community Center]
    assign_to: {role: ${marker}}
`,
    );
    const db = await openDatabase(process.env.TEST_DATABASE_URL);
    const {app} = await createApp(
      {
        AUTH_MODE: 'demo',
        SEED_DEMO: 'true',
        SESSION_SECRET: 'postgres-integration-test-secret',
        LOG_LEVEL: 'silent',
        ACCESS_FILE: file,
      },
      db,
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '',
      csrf = '';
    const call = async (path, method = 'GET', body) => {
      const response = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {cookie, 'x-csrf-token': csrf, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const type = response.headers.get('content-type') || '';
      return {status: response.status, body: type.includes('json') ? await response.json() : await response.text()};
    };
    try {
      await call('/auth/login');
      csrf = (await call('/api/me')).body.csrf;
      const status = (await call('/api/admin/access')).body.status;
      assert.equal(status.ok, true, JSON.stringify(status.problems));
      assert.equal((await call('/api/admin/roles')).body.find(r => r.id === marker).source, 'code');
      // A scoped person sees their own tickets plus North Campus.
      await db.query("INSERT INTO users(id,subject,name,email,role) VALUES($1,$1,$2,'',$3)", [
        marker,
        'Scoped',
        marker,
      ]);
      const crew = (await call('/api/admin')).body.groups.find(g => g.name === `Crew ${marker}`);
      assert.equal(crew.source, 'code');
      const made = await call('/api/orders', 'POST', {title: marker, building_id: 'b3', due_date: '2026-10-09'});
      assert.equal(made.body.assignee_id, null, 'the scoped role cannot be assigned Community Center work');
      // This test's own session, from its signed cookie (s:<id>.<signature>).
      const sessionId = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
        .slice(2)
        .split('.')[0];
      const row = (await db.query('SELECT body FROM sessions WHERE id=$1', [sessionId]))[0];
      await db.query('UPDATE sessions SET body=$1,user_id=$2 WHERE id=$3', [
        JSON.stringify({...JSON.parse(row.body), userId: marker}),
        marker,
        sessionId,
      ]);
      const visible = (await call('/api/orders?limit=200')).body.orders;
      assert.ok(
        visible.length > 0 && visible.every(o => o.building_id === 'b1'),
        JSON.stringify(visible.map(o => [o.id, o.building_id])) + JSON.stringify((await call('/api/me')).body.user),
      );
      assert.equal((await call('/api/calendar?from=2026-01-01&to=2026-02-28')).status, 200);
      const csv = await call('/api/reports/orders.csv');
      assert.equal(csv.status, 200);
      assert.ok(!csv.body.includes('Operations Center'), 'exports follow the same scope');
    } finally {
      await new Promise(resolve => server.close(resolve));
      await db.close();
      rmSync(dir, {recursive: true, force: true});
    }
  },
);

test(
  'PostgreSQL runs similar tickets, followers, checklists, time, labor and escalation SQL',
  {skip: !process.env.TEST_DATABASE_URL},
  async () => {
    const db = await openDatabase(process.env.TEST_DATABASE_URL);
    const {app, live} = await createApp(
      {AUTH_MODE: 'demo', SEED_DEMO: 'true', SESSION_SECRET: 'postgres-integration-test-secret', LOG_LEVEL: 'silent'},
      db,
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '',
      csrf = '';
    const call = async (path, method = 'GET', body) => {
      const response = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {cookie, 'x-csrf-token': csrf, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const type = response.headers.get('content-type') || '';
      return {status: response.status, body: type.includes('json') ? await response.json() : await response.text()};
    };
    try {
      await call('/auth/login');
      csrf = (await call('/api/me')).body.csrf;
      const marker = 'pgt' + Date.now();
      const id = (await call('/api/orders', 'POST', {title: `${marker} boiler pressure low`, building_id: 'b1'})).body
        .id;
      const similar = (await call(`/api/orders-similar?building_id=b1&title=${marker}%20boiler%20pressure`)).body;
      assert.ok(similar.some(s => s.id === id));
      assert.equal((await call(`/api/orders/${id}/follow`, 'POST', {})).status, 200);
      assert.ok((await call(`/api/orders?q=${marker}`)).body.total >= 1);
      assert.equal((await call(`/api/orders/${id}/checklist`, 'POST', {label: 'Check gauge'})).status, 201);
      assert.equal((await call(`/api/orders/${id}/time`, 'POST', {minutes: 15})).status, 201);
      assert.equal((await call(`/api/orders/${id}/time/start`, 'POST')).status, 201);
      assert.equal((await call('/api/time/stop', 'POST', {})).status, 200);
      const report = (await call('/api/reports/summary')).body;
      assert.ok(report.labor.totalMinutes >= 15);
      assert.equal((await call('/api/reports/orders.csv')).status, 200);
      const {slaSweep} = await import('../ticket-tools.js');
      const {notify} = await import('../requests.js');
      await db.query("UPDATE work_orders SET due_date='2020-01-01' WHERE id=$1", [id]);
      const swept = await slaSweep(db, {notify, timezone: 'America/Phoenix'});
      assert.ok(swept.escalated >= 1);
      assert.equal(
        (await call('/api/views', 'POST', {name: marker, page: 'orders', state: {filter: 'Open'}})).status,
        201,
      );
    } finally {
      live.close();
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
      await db.close();
    }
  },
);
