import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const upload = (w, order, body, type, name = 'file') =>
  w.call(`/api/orders/${order}/attachments`, 'POST', new Uint8Array(body), {
    'Content-Type': type,
    'X-File-Name': encodeURIComponent(name),
  });

test('attachments are type-checked, size-limited and scoped to the request', async () => {
  const w = await startWorkspace({ATTACHMENT_MAX_MB: '0.01', ATTACHMENT_MAX_PER_REQUEST: '3'});
  try {
    await w.addUser('req', 'requester');
    await w.addUser('other', 'requester');
    await w.as('req');
    const order = (await w.call('/api/orders', 'POST', {title: 'Leak', building_id: 'b1', due_date: '2026-10-05'})).body
      .id;
    const photo = await upload(w, order, png, 'image/png', '../../ceiling photo.png');
    assert.equal(photo.status, 201);
    assert.equal(photo.body.file_name, '.._.._ceiling photo.png', 'path separators are neutralized');
    assert.equal((await upload(w, order, Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).status, 415);
    assert.equal(
      (await upload(w, order, Buffer.from('not a png'), 'image/png')).status,
      415,
      'contents must match the declared type',
    );
    assert.equal((await upload(w, order, Buffer.from([0xff, 0xfe, 0x00, 0x41]), 'text/plain')).status, 415);
    assert.equal((await upload(w, order, Buffer.alloc(0), 'text/plain')).status, 400);
    assert.equal((await upload(w, order, Buffer.alloc(20000, 65), 'text/plain')).status, 413);
    assert.equal((await upload(w, order, Buffer.from('%PDF-1.7\n'), 'application/pdf', 'quote.pdf')).status, 201);
    assert.equal((await upload(w, order, Buffer.from('a,b\n1,2\n'), 'text/csv', 'readings.csv')).status, 201);
    assert.equal((await upload(w, order, Buffer.from('x'), 'text/plain')).status, 409, 'per-request limit');
    const image = await w.call('/api/attachments/' + photo.body.id);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.match(image.headers.get('content-disposition'), /^inline/);
    assert.match(image.headers.get('content-security-policy'), /sandbox/);
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(image.body), png);
    assert.match(
      (await w.call(`/api/attachments/${photo.body.id}?download`)).headers.get('content-disposition'),
      /^attachment/,
    );
    const detail = (await w.call('/api/orders/' + order)).body;
    assert.equal(detail.attachments.length, 3);
    assert.equal(detail.attachments[0].data, undefined, 'detail lists metadata only');
    await w.as('other');
    assert.equal((await w.call('/api/attachments/' + photo.body.id)).status, 404);
    assert.equal((await upload(w, order, png, 'image/png')).status, 404);
    await w.addUser('tech', 'technician');
    await w.as('tech');
    assert.equal(
      (await w.call('/api/attachments/' + photo.body.id, 'DELETE')).status,
      403,
      'only the uploader or a manager removes files',
    );
    await w.as('req');
    assert.equal((await w.call('/api/attachments/' + photo.body.id, 'DELETE')).status, 200);
    await w.as('demo-admin');
    assert.ok((await w.call('/api/orders/' + order + '/history')).body.some(h => h.action === 'attachment.delete'));
    assert.equal((await w.call('/api/orders/' + order, 'DELETE')).status, 200, 'deleting a request removes its files');
    assert.equal((await w.db.query('SELECT * FROM attachments WHERE work_order_id=$1', [order])).length, 0);
  } finally {
    await w.close();
  }
});
