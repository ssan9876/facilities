import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';
import {deliverEmails} from '../email.js';

// A transport double that records messages and can be switched to fail.
function transport() {
  const sent = [];
  let fail = false;
  return {
    sent,
    set fail(v) {
      fail = v;
    },
    sendMail: async m => {
      if (fail) throw new Error('connection refused');
      sent.push(m);
      return {messageId: String(sent.length)};
    },
  };
}

test('email cannot be enabled without SMTP', async () => {
  const w = await startWorkspace();
  try {
    assert.equal((await w.call('/api/settings', 'PATCH', {email: true})).status, 400);
    assert.equal((await w.call('/api/admin/email/test', 'POST')).status, 503);
    assert.equal((await w.call('/api/data')).body.emailConfigured, false);
  } finally {
    await w.close();
  }
});

test('notifications are queued as email, honour preferences and retry on failure', async () => {
  const mail = transport();
  const w = await startWorkspace(
    {SMTP_FROM: 'facilities@example.test', APP_URL: 'http://localhost:3000', ORG_NAME: 'Campus'},
    {transport: mail},
  );
  const {call, db, as, addUser} = w;
  const options = {appUrl: 'https://facilities.example.test', from: 'facilities@example.test', organization: 'Campus'};
  try {
    await addUser('tech', 'technician', {email: 'tech@example.test', name: 'Taylor'});
    await addUser('quiet', 'technician', {email: 'quiet@example.test'});
    assert.equal((await call('/api/settings', 'PATCH', {email: true})).status, 200);
    await call('/api/orders/demo-1', 'PATCH', {assignee_id: 'tech'});
    let queued = await db.query('SELECT * FROM email_outbox');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].to_address, 'tech@example.test');
    // Personal preference: in-app only.
    await as('quiet');
    assert.equal(
      (
        await call('/api/preferences', 'PUT', {
          created: true,
          assigned: true,
          status: true,
          comment: true,
          email: false,
        })
      ).status,
      200,
    );
    assert.equal((await call('/api/preferences')).body.email, false);
    await as('demo-admin');
    await call('/api/orders/demo-2', 'PATCH', {assignee_id: 'quiet'});
    assert.equal((await db.query("SELECT * FROM notifications WHERE user_id='quiet'")).length, 1);
    assert.equal((await db.query("SELECT * FROM email_outbox WHERE to_address='quiet@example.test'")).length, 0);
    // Delivery with a failing server schedules a retry rather than losing the message.
    await db.query('DELETE FROM email_outbox WHERE id<>$1', [queued[0].id]);
    mail.fail = true;
    assert.equal(await deliverEmails(db, mail, options), 0);
    queued = await db.query('SELECT * FROM email_outbox');
    assert.equal(queued[0].attempts, 1);
    assert.match(queued[0].last_error, /connection refused/);
    assert.equal(queued[0].sent_at, null);
    assert.equal(await deliverEmails(db, mail, options), 0, 'the retry waits for its backoff');
    await db.query('UPDATE email_outbox SET send_after=$1', [new Date(0).toISOString()]);
    mail.fail = false;
    assert.equal(await deliverEmails(db, mail, options), 1);
    assert.equal(mail.sent.length, 1);
    assert.match(mail.sent[0].subject, /^Campus: WO-0001 Air conditioning not cooling/);
    assert.match(mail.sent[0].text, /https:\/\/facilities\.example\.test\/tickets\/WO-0001/);
    assert.equal(await deliverEmails(db, mail, options), 0, 'sent messages are not repeated');
    const status = (await call('/api/admin/email')).body;
    assert.deepEqual([status.configured, status.sent, status.pending], [true, 1, 0]);
    // Messages that keep failing stop after the final attempt.
    await db.query(
      "INSERT INTO email_outbox(id,to_address,subject,body,created_at,send_after,attempts) VALUES('dead','x@example.test','s','b',$1,$1,5)",
      [new Date(0).toISOString()],
    );
    assert.equal(await deliverEmails(db, mail, options), 0);
    assert.equal((await call('/api/admin/email')).body.failed, 1);
    assert.equal((await call('/api/admin/email/test', 'POST')).status, 200);
    assert.equal(mail.sent.at(-1).to, 'alex@example.test');
    await call('/api/settings', 'PATCH', {email: false});
    await call('/api/orders/demo-3', 'PATCH', {assignee_id: 'tech'});
    assert.equal(
      (await db.query("SELECT * FROM email_outbox WHERE subject LIKE 'Inspect%'")).length,
      0,
      'turning email off stops new messages',
    );
  } finally {
    await w.close();
  }
});
