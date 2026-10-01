import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {startWorkspace} from './helpers.js';
import {quietDelay, replyAddress} from '../email.js';
import {stripQuoted} from '../office.js';
import {parseCsv} from '../importer.js';
import {checkTarget, eventsFor} from '../integrations.js';

test('requesters rate the fix and reopen with a reason', async () => {
  const w = await startWorkspace();
  const {call, as, addUser, db} = w;
  try {
    await addUser('req', 'requester', {name: 'Riley'});
    await as('req');
    const id = (await call('/api/orders', 'POST', {title: 'Door sticks', building_id: 'b1'})).body.id;
    assert.equal((await call(`/api/orders/${id}/rating`, 'POST', {score: 5})).status, 400, 'not resolved yet');
    await as('demo-admin');
    await call(`/api/orders/${id}`, 'PATCH', {assignee_id: 'demo-admin'});
    await call(`/api/orders/${id}`, 'PATCH', {status: 'Completed', resolution: 'Planed the door.'});
    assert.equal((await call(`/api/orders/${id}/rating`, 'POST', {score: 5})).status, 403, 'only the requester rates');
    await as('req');
    assert.equal((await call(`/api/orders/${id}/rating`, 'POST', {score: 9})).status, 400);
    const rated = await call(`/api/orders/${id}/rating`, 'POST', {score: 2, comment: 'Still sticks a bit'});
    assert.equal(rated.body.score, 2);
    assert.equal((await call('/api/orders/' + id)).body.rating.score, 2);
    const notes = await db.query("SELECT * FROM notifications WHERE order_id=$1 AND user_id='demo-admin'", [id]);
    assert.ok(notes.some(n => /rated the fix 2/.test(n.message)));
    assert.equal((await call(`/api/orders/${id}/reopen`, 'POST', {reason: ''})).status, 400);
    assert.equal((await call(`/api/orders/${id}/reopen`, 'POST', {reason: 'It sticks again in the rain'})).status, 200);
    assert.equal((await call('/api/orders/' + id)).body.status, 'Open');
    const comments = (await call(`/api/orders/${id}/comments`)).body;
    assert.ok(comments.some(c => c.body === 'Reopened: It sticks again in the rain'));
    assert.equal((await call(`/api/orders/${id}/reopen`, 'POST', {reason: 'again'})).status, 400, 'only resolved ones');
    await as('demo-admin');
    assert.equal((await call('/api/reports/summary')).body.rating.count, 0, 'reopened requests leave the set');
    assert.match((await call('/api/reports/orders.csv')).body, /Rating/);
  } finally {
    await w.close();
  }
});

test('email replies become comments only through a valid reply address and key', async () => {
  process.env.INBOUND_EMAIL_ADDRESS = 'replies@example.test';
  const key = 'k'.repeat(24);
  const w = await startWorkspace({INBOUND_EMAIL_KEY: key});
  const {call, db, base} = w;
  const post = (body, {form = false, k = key} = {}) =>
    fetch(`${base}/api/inbound/email?key=${k}`, {
      method: 'POST',
      headers: {'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json'},
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
  try {
    const address = await replyAddress(db, 'demo-2', 'demo-admin');
    assert.match(address, /^replies\+[a-f0-9]{20}@example\.test$/);
    assert.equal((await post({to: address, text: 'hi'}, {k: 'x'.repeat(24)})).status, 401);
    const reply = await post({
      to: `Facilities <${address}>`,
      from: 'someone@else.test',
      text: 'Parts arrive Thursday.\n\nOn Tue, Oct 1, 2026 Facilities wrote:\n> Earlier message',
    });
    assert.equal(reply.status, 200);
    assert.equal((await call('/api/orders/demo-2/comments')).body.at(-1).body, 'Parts arrive Thursday.');
    // Mailgun posts form fields.
    assert.equal((await post({recipient: address, 'stripped-text': 'Done.'}, {form: true})).status, 200);
    assert.equal((await call('/api/orders/demo-2/comments')).body.at(-1).body, 'Done.');
    assert.equal((await post({to: 'replies+0000000000aaaaaaaaaa@example.test', text: 'x'})).status, 202);
    assert.equal((await post({to: 'replies@example.test', text: 'x'})).status, 202, 'no token');
    assert.equal(stripQuoted('Thanks!\n-----Original Message-----\nFrom: x'), 'Thanks!');
  } finally {
    delete process.env.INBOUND_EMAIL_ADDRESS;
    await w.close();
  }
});

test('quiet hours delay email; the digest replaces individual emails', async () => {
  const at = iso => new Date(iso);
  // 22:30 in Phoenix (UTC-7) with quiet hours 21–7: held until 07:00, 8.5 hours.
  assert.equal(
    quietDelay({quiet_start: 21, quiet_end: 7}, at('2026-10-02T05:30:00Z'), 'America/Phoenix'),
    8.5 * 3600000,
  );
  assert.equal(quietDelay({quiet_start: 21, quiet_end: 7}, at('2026-10-01T19:00:00Z'), 'America/Phoenix'), 0);
  assert.equal(quietDelay({quiet_start: null, quiet_end: 7}), 0);
  const w = await startWorkspace(
    {SMTP_FROM: 'facilities@example.test', APP_URL: 'http://localhost:3000'},
    {transport: {sendMail: async () => ({})}},
  );
  const {call, db} = w;
  try {
    await call('/api/settings', 'PATCH', {email: true});
    const prefs = (await call('/api/preferences')).body;
    assert.equal((await call('/api/preferences', 'PUT', {...prefs, quiet_start: 25})).status, 400);
    assert.equal(
      (await call('/api/preferences', 'PUT', {...prefs, digest: true, quiet_start: 21, quiet_end: 7})).status,
      200,
    );
    await db.query("UPDATE users SET email='alex@example.test' WHERE id='demo-admin'");
    assert.equal(await w.server.office.sendDigests(true), 1);
    const digest = (await db.query("SELECT * FROM email_outbox WHERE subject LIKE 'Your day%'"))[0];
    assert.match(digest.body, /Your open work/);
    assert.equal(await w.server.office.sendDigests(), 0, 'once a day');
  } finally {
    await w.close();
  }
});

test('CSV import previews, then creates valid rows and reports the rest', async () => {
  const w = await startWorkspace({OIDC_ISSUER: 'https://idp.example/oidc'});
  const {call, as, addUser} = w;
  try {
    assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    const buildings = 'Name,Address\nWest Annex,"1 West Rd, Suite 2"\nNorth Campus,dup\n,missing\n';
    const preview = (await call('/api/import/buildings', 'POST', {csv: buildings})).body;
    assert.deepEqual([preview.valid, preview.invalid, preview.created], [1, 2, 0]);
    assert.match(preview.rows[1].error, /already exists/);
    assert.equal((await call('/api/import/buildings', 'POST', {csv: buildings, apply: true})).body.created, 1);
    const assets = 'name,building,category,serial\nBoiler 1,West Annex,HVAC,B-1\nGhost,Nowhere,,\n';
    assert.equal((await call('/api/import/assets', 'POST', {csv: assets, apply: true})).body.created, 1);
    const parts = 'name,sku,quantity,reorder_at,unit_cost\nFilter,F-1,10,2,$4.50\nBad,B-2,ten,,\n';
    const p = (await call('/api/import/parts', 'POST', {csv: parts, apply: true})).body;
    assert.equal(p.created, 1);
    assert.match(p.rows[1].error, /whole number/);
    const people =
      'name,oidc_subject,email,role\nPat Lee,pat-1,pat@example.test,Technician\nAdmin Wannabe,x-2,,admin\n';
    const pe = (await call('/api/import/people', 'POST', {csv: people, apply: true})).body;
    assert.equal(pe.created, 1);
    assert.match(pe.rows[1].error, /administrator/);
    assert.equal((await call('/api/import/people', 'POST', {csv: 'name\nx\n'})).status, 400, 'required column');
    assert.match((await call('/api/import/assets/template.csv')).body, /^name,building,category,serial/);
    await addUser('tech', 'technician');
    await as('tech');
    assert.equal((await call('/api/import/buildings', 'POST', {csv: buildings})).status, 403);
  } finally {
    await w.close();
  }
});

test('webhooks deliver signed JSON, Slack and Teams messages and refuse private addresses', async () => {
  const received = [];
  const hook = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      received.push({headers: req.headers, body});
      res.end('ok');
    });
  });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${hook.address().port}/hook`;
  assert.deepEqual(eventsFor('order.update', {status: ['Open', 'Completed']}), ['resolved']);
  await assert.rejects(checkTarget('https://127.0.0.1/x', {}), /internet/);
  await assert.rejects(checkTarget('http://example.com/x', {}), /https/);
  const w = await startWorkspace({WEBHOOK_ALLOW_PRIVATE: 'true', WEBHOOK_ALLOW_HTTP: 'true'});
  const {call} = w;
  try {
    const created = await call('/api/admin/webhooks', 'POST', {
      name: 'Ops',
      kind: 'json',
      url,
      events: ['created', 'resolved'],
    });
    assert.equal(created.status, 201);
    const secret = created.body.secret;
    await call('/api/admin/webhooks', 'POST', {name: 'Slack', kind: 'slack', url, events: ['created']});
    await call('/api/admin/webhooks', 'POST', {name: 'Teams', kind: 'teams', url, events: ['created']});
    await call('/api/orders', 'POST', {title: 'Flooded basement', building_id: 'b1'});
    await w.server.integrations.flush();
    await w.server.integrations.deliver();
    const json = received.find(r => r.headers['x-facilities-event'] === 'created');
    assert.ok(json, 'JSON webhook delivered');
    assert.equal(
      json.headers['x-facilities-signature'],
      'sha256=' + createHmac('sha256', secret).update(json.body).digest('hex'),
    );
    assert.equal(JSON.parse(json.body).ticket.title, 'Flooded basement');
    assert.ok(
      received.some(r => JSON.parse(r.body).text?.includes('Flooded basement')),
      'Slack',
    );
    assert.ok(
      received.some(r => JSON.parse(r.body).type === 'message'),
      'Teams',
    );
    const sample = await call(`/api/admin/webhooks/${created.body.id}/test`, 'POST');
    assert.equal(sample.body.status, '200');
    assert.equal((await call('/api/admin/webhooks', 'POST', {name: 'x', kind: 'json', url, events: []})).status, 400);
  } finally {
    await w.close();
    hook.close();
  }
});

test('printable work orders: copies, QR and visibility', async () => {
  const w = await startWorkspace();
  const {as, addUser, base} = w;
  try {
    const page = await fetch(`${base}/print?tickets=WO-0001,demo-2&copies=requester,technician,office`, {
      headers: {cookie: w.cookie},
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.equal((html.match(/<article class="sheet /g) || []).length, 6);
    assert.match(html, /Office copy/);
    assert.match(html, /<svg/);
    await addUser('req', 'requester');
    await as('req');
    assert.equal((await fetch(`${base}/print?tickets=WO-0001`, {headers: {cookie: w.cookie}})).status, 404);
  } finally {
    await w.close();
  }
});
