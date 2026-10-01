import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startWorkspace} from './helpers.js';

test('the update button hands a validated request to the host agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'facilities-updates-'));
  const w = await startWorkspace({UPDATE_DIR: dir});
  const {call, as, addUser} = w;
  try {
    const before = (await call('/api/admin/update')).body;
    assert.deepEqual([before.agent, before.pending, before.status], [true, false, null]);
    assert.equal((await call('/api/admin/update', 'POST', {version: 'main; rm -rf /'})).status, 400);
    assert.equal((await call('/api/admin/update', 'POST', {version: '../v1.0.0'})).status, 400);
    const requested = await call('/api/admin/update', 'POST', {version: 'latest'});
    assert.equal(requested.status, 202);
    assert.equal(requested.body.pending, true);
    assert.equal(requested.body.status.state, 'requested');
    const request = JSON.parse(readFileSync(join(dir, 'request.json'), 'utf8'));
    assert.deepEqual([request.version, request.requested_by], ['latest', 'Alex Morgan']);
    assert.equal((await call('/api/admin/update', 'POST', {})).status, 409, 'one update at a time');
    // The host agent consumes the request and reports progress through status.json.
    rmSync(join(dir, 'request.json'));
    writeFileSync(join(dir, 'status.json'), JSON.stringify({state: 'running', version: 'v9.9.9', message: 'Building'}));
    assert.equal((await call('/api/admin/update')).body.status.state, 'running');
    assert.equal((await call('/api/admin/update', 'POST', {})).status, 409);
    writeFileSync(join(dir, 'status.json'), JSON.stringify({state: 'failed', message: 'Download failed'}));
    assert.equal((await call('/api/admin/update', 'POST', {version: 'v9.9.9'})).status, 202, 'retry after a failure');
    // A request nobody picked up for a minute is reported as stalled.
    writeFileSync(
      join(dir, 'request.json'),
      JSON.stringify({version: 'latest', at: new Date(Date.now() - 120000).toISOString()}),
    );
    assert.equal((await call('/api/admin/update')).body.stalled, true);
    assert.ok((await call('/api/admin/audit?q=update')).body.entries.some(e => e.action === 'update.request'));
    await addUser('boss', 'manager');
    await as('boss');
    assert.equal((await call('/api/admin/update', 'POST', {})).status, 403);
  } finally {
    await w.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('without the agent the button explains how to enable it', async () => {
  const w = await startWorkspace();
  try {
    assert.deepEqual((await w.call('/api/admin/update')).body, {agent: false, reason: 'not-configured'});
    const refused = await w.call('/api/admin/update', 'POST', {});
    assert.equal(refused.status, 503);
    assert.match(refused.body.error, /--install-agent/);
    const missing = await startWorkspace({UPDATE_DIR: join(tmpdir(), 'does-not-exist-' + Date.now())});
    try {
      assert.equal((await missing.call('/api/admin/update')).body.reason, 'not-writable');
      assert.equal(existsSync(join(tmpdir(), 'does-not-exist')), false);
    } finally {
      await missing.close();
    }
  } finally {
    await w.close();
  }
});

test('tickets have their own address and can be opened by number', async () => {
  const w = await startWorkspace();
  try {
    const page = await fetch(w.base + '/tickets/WO-0003');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="app">/);
    for (const ref of ['WO-0003', 'wo3', '3', 'demo-3']) {
      const ticket = await w.call('/api/orders/' + ref);
      assert.equal(ticket.status, 200, ref);
      assert.equal(ticket.body.id, 'demo-3', ref);
    }
    assert.equal((await w.call('/api/orders/WO-9999')).status, 404);
    await w.addUser('req', 'requester');
    await w.as('req');
    assert.equal((await w.call('/api/orders/WO-0003')).status, 404, 'numbers do not bypass access rules');
  } finally {
    await w.close();
  }
});
