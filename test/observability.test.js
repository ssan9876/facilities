import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLogger, createMetrics, rateLimit} from '../observability.js';
import {startWorkspace} from './helpers.js';

test('structured logs are single-line JSON filtered by level', () => {
  const lines = [];
  const log = createLogger('warn', l => lines.push(l));
  log.info('hidden');
  log.warn('shown', {request_id: 'r1'});
  log.error('also');
  assert.equal(lines.length, 2);
  const record = JSON.parse(lines[0]);
  assert.deepEqual([record.level, record.message, record.request_id], ['warn', 'shown', 'r1']);
  assert.ok(!Number.isNaN(Date.parse(record.time)));
});

test('metrics render Prometheus text with bounded labels', async () => {
  const m = createMetrics();
  m.inc('requests_total', {route: '/api/orders/:id', status: 200});
  m.inc('requests_total', {route: '/api/orders/:id', status: 200});
  m.observe('duration_seconds', {route: 'x'}, 0.03);
  m.gauge('open', () => 4);
  const text = await m.render();
  assert.match(text, /requests_total\{route="\/api\/orders\/:id",status="200"\} 2/);
  assert.match(text, /duration_seconds_bucket\{route="x",le="0.05"\} 1/);
  assert.match(text, /duration_seconds_count\{route="x"\} 1/);
  assert.match(text, /# TYPE open gauge\nopen 4/);
});

test('rate limiter returns 429 with Retry-After once the window is spent', () => {
  const limiter = rateLimit({name: 'T', max: 2, key: () => 'k'});
  const responses = [];
  for (let i = 0; i < 3; i++) {
    const res = {
      headers: {},
      statusCode: 200,
      set(k, v) {
        this.headers[k] = v;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
      },
    };
    let passed = false;
    limiter({}, res, () => {
      passed = true;
    });
    responses.push({passed, res});
  }
  assert.deepEqual(
    responses.map(r => r.passed),
    [true, true, false],
  );
  assert.equal(responses[2].res.statusCode, 429);
  assert.ok(Number(responses[2].res.headers['Retry-After']) > 0);
});

test('metrics endpoint requires its token, requests get IDs and writes are rate limited', async () => {
  const w = await startWorkspace({METRICS_TOKEN: 'metrics-secret', RATE_LIMIT_WRITES: '3'});
  try {
    const res = await w.call('/api/data');
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal(
      (await w.call('/api/data', 'GET', undefined, {'x-request-id': 'trace-123'})).headers.get('x-request-id'),
      'trace-123',
    );
    assert.equal((await fetch(w.base + '/metrics')).status, 401);
    assert.equal((await fetch(w.base + '/metrics', {headers: {authorization: 'Bearer wrong'}})).status, 401);
    const metrics = await fetch(w.base + '/metrics', {headers: {authorization: 'Bearer metrics-secret'}});
    assert.equal(metrics.status, 200);
    const text = await metrics.text();
    assert.match(text, /facilities_http_requests_total\{method="GET",route="\/api\/data",status="200"\}/);
    assert.match(text, /facilities_open_requests 5/);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await w.call('/api/notifications/read', 'POST', {})).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
    assert.equal((await w.call('/api/data')).status, 200, 'reads are not counted against the write limit');
    assert.equal((await w.call('/health')).body.schema >= 8, true);
  } finally {
    await w.close();
  }
  const off = await startWorkspace();
  try {
    assert.equal((await fetch(off.base + '/metrics')).status, 404, 'metrics are disabled without a token');
  } finally {
    await off.close();
  }
});

test('authentication endpoints are rate limited per client', async () => {
  const w = await startWorkspace({RATE_LIMIT_AUTH: '2'});
  try {
    // The helper already used one sign-in.
    assert.equal((await fetch(w.base + '/auth/login', {redirect: 'manual'})).status, 302);
    const limited = await fetch(w.base + '/auth/login', {redirect: 'manual'});
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  } finally {
    await w.close();
  }
});
