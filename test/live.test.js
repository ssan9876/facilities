import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';

// Opens /api/stream with the workspace's current session and collects events.
async function listen(w, query = '') {
  const controller = new AbortController();
  const res = await fetch(w.base + '/api/stream' + query, {headers: {cookie: w.cookie}, signal: controller.signal});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = [];
  const waiters = [];
  (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = chunk.match(/^event: (.+)$/m)?.[1];
          const data = chunk.match(/^data: (.+)$/m)?.[1];
          if (!event) continue;
          events.push({event, data: JSON.parse(data)});
          for (const w of [...waiters]) if (w.test(events.at(-1))) w.resolve(events.at(-1));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const next = (test, ms = 3000) =>
    new Promise((resolve, reject) => {
      const found = events.find(test);
      if (found) return resolve(found);
      const waiter = {test, resolve};
      waiters.push(waiter);
      setTimeout(
        () => reject(new Error('No matching event within ' + ms + ' ms: ' + test + ' got ' + JSON.stringify(events))),
        ms,
      );
    });
  await next(e => e.event === 'ready');
  return {events, next, close: () => controller.abort()};
}

test('notifications and ticket changes stream to the people allowed to see them', async () => {
  const w = await startWorkspace();
  const {call, as, addUser} = w;
  try {
    const anonymous = await fetch(w.base + '/api/stream');
    assert.equal(anonymous.status, 401);
    await addUser('req', 'requester', {name: 'Riley'});
    // Riley's stream.
    await as('req');
    const riley = await listen(w);
    const mine = (await call('/api/orders', 'POST', {title: 'Leaky tap', building_id: 'b1', due_date: '2026-10-09'}))
      .body.id;
    // The administrator's stream (same browser session, switched back).
    await as('demo-admin');
    const admin = await listen(w);
    // A comment on Riley's ticket: Riley is notified and both see the ticket change.
    assert.equal((await call(`/api/orders/${mine}/comments`, 'POST', {body: 'On our way'})).status, 201);
    const note = await riley.next(e => e.event === 'notification' && e.data.order_id === mine);
    assert.equal(note.data.event, 'comment');
    await riley.next(e => e.event === 'order' && e.data.id === mine);
    await admin.next(e => e.event === 'order' && e.data.id === mine);
    // Someone else's ticket never reaches Riley.
    await call('/api/orders/demo-3', 'PATCH', {priority: 'Low'});
    await admin.next(e => e.event === 'order' && e.data.id === 'demo-3');
    assert.ok(!riley.events.some(e => e.event === 'order' && e.data.id === 'demo-3'));
    assert.ok(!admin.events.some(e => e.event === 'notification' && e.data.order_id === mine), 'no self-notifications');
    // Workspace changes reach everyone as a data event; deletions as order {deleted}.
    await call('/api/settings', 'PATCH', {inventory: false});
    await riley.next(e => e.event === 'data');
    await call(`/api/orders/${mine}`, 'DELETE');
    await riley.next(e => e.event === 'order' && e.data.id === mine && e.data.deleted);
    // Reading notifications updates the person's other tabs.
    await as('req');
    await call('/api/notifications/read', 'POST', {});
    await riley.next(e => e.event === 'notification' && e.data.read === 'all');
    riley.close();
    admin.close();
  } finally {
    await w.close();
  }
});

test('a change is not echoed back to the tab that made it', async () => {
  const w = await startWorkspace();
  const {call} = w;
  try {
    const mine = await listen(w, '?client=tab-mine-123456');
    const other = await listen(w, '?client=tab-other-123456');
    await call('/api/orders/demo-3', 'PATCH', {priority: 'Low'}, {'x-live-client': 'tab-mine-123456'});
    await other.next(e => e.event === 'order' && e.data.id === 'demo-3');
    await new Promise(r => setTimeout(r, 400));
    assert.ok(!mine.events.some(e => e.event === 'order'), 'the tab that made the change already shows it');
    mine.close();
    other.close();
  } finally {
    await w.close();
  }
});
