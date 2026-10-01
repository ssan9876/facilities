import {randomUUID, createHash, timingSafeEqual} from 'node:crypto';

const levels = {debug: 10, info: 20, warn: 30, error: 40, silent: 99};
// One JSON object per line so container log collectors can parse records without configuration.
export function createLogger(level = 'info', write = line => process.stdout.write(line + '\n')) {
  const threshold = levels[level] ?? levels.info;
  const log = (name, message, fields = {}) => {
    if (levels[name] >= threshold)
      write(JSON.stringify({time: new Date().toISOString(), level: name, message, ...fields}));
  };
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  };
}
export function defaultLogLevel(env) {
  return env.LOG_LEVEL || (process.env.NODE_TEST_CONTEXT ? 'silent' : 'info');
}

const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
export function createMetrics() {
  const counters = new Map(),
    histograms = new Map(),
    gauges = new Map();
  const key = labels =>
    Object.entries(labels)
      .map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '\\$&')}"`)
      .join(',');
  return {
    inc(name, labels = {}, by = 1) {
      const k = name + '{' + key(labels) + '}';
      counters.set(k, (counters.get(k) || 0) + by);
    },
    observe(name, labels, seconds) {
      const k = key(labels);
      const h = histograms.get(name)?.get(k) || {counts: buckets.map(() => 0), sum: 0, count: 0};
      buckets.forEach((b, i) => {
        if (seconds <= b) h.counts[i]++;
      });
      h.sum += seconds;
      h.count++;
      if (!histograms.has(name)) histograms.set(name, new Map());
      histograms.get(name).set(k, h);
    },
    gauge(name, fn) {
      gauges.set(name, fn);
    },
    async render() {
      const out = [];
      const names = new Set([...counters.keys()].map(k => k.slice(0, k.indexOf('{'))));
      for (const name of names) {
        out.push(`# TYPE ${name} counter`);
        for (const [k, v] of counters) if (k.startsWith(name + '{')) out.push(`${k.replace('{}', '')} ${v}`);
      }
      for (const [name, series] of histograms) {
        out.push(`# TYPE ${name} histogram`);
        for (const [labels, h] of series) {
          const sep = labels ? labels + ',' : '';
          buckets.forEach((b, i) => out.push(`${name}_bucket{${sep}le="${b}"} ${h.counts[i]}`));
          out.push(
            `${name}_bucket{${sep}le="+Inf"} ${h.count}`,
            `${name}_sum${labels ? '{' + labels + '}' : ''} ${h.sum}`,
            `${name}_count${labels ? '{' + labels + '}' : ''} ${h.count}`,
          );
        }
      }
      for (const [name, fn] of gauges) {
        const value = await fn();
        out.push(`# TYPE ${name} gauge`);
        if (typeof value === 'number') out.push(`${name} ${value}`);
        else for (const [labels, v] of value) out.push(`${name}{${key(labels)}} ${v}`);
      }
      return out.join('\n') + '\n';
    },
  };
}

// Request IDs, structured access logs and HTTP metrics. Query strings are never logged.
export function requestTelemetry(logger, metrics) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    const incoming = req.get('x-request-id');
    req.id = incoming && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.id);
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      // Route patterns keep metric label cardinality bounded (no record IDs).
      const route = req.route?.path
        ? (req.baseUrl || '') + req.route.path
        : res.statusCode === 404
          ? 'unmatched'
          : req.path.startsWith('/api')
            ? 'api'
            : 'static';
      metrics.inc('facilities_http_requests_total', {method: req.method, route, status: res.statusCode});
      metrics.observe('facilities_http_request_duration_seconds', {method: req.method, route}, seconds);
      if (req.path === '/health' && res.statusCode < 400) return;
      logger[res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info']('request', {
        request_id: req.id,
        method: req.method,
        path: req.path,
        route,
        status: res.statusCode,
        duration_ms: Math.round(seconds * 1000),
        user_id: req.user?.id,
        ip: req.ip,
      });
    });
    next();
  };
}

// Metrics require METRICS_TOKEN: behind a same-host proxy every request looks like loopback.
export function metricsRoute(metrics, token) {
  const expected = token ? createHash('sha256').update(token).digest() : null;
  return async (req, res) => {
    if (!expected) return res.status(404).json({error: 'Metrics are not enabled. Set METRICS_TOKEN.'});
    const supplied = createHash('sha256')
      .update(req.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || '')
      .digest();
    if (!timingSafeEqual(supplied, expected))
      return res.status(401).json({error: 'A valid metrics bearer token is required.'});
    res
      .set('Cache-Control', 'no-store')
      .type('text/plain; version=0.0.4')
      .send(await metrics.render());
  };
}

// Fixed-window in-memory limiter. One application process serves the organization, so local counts are authoritative.
export function rateLimit({
  windowMs = 60000,
  max,
  key,
  name,
  metrics,
  message = 'Too many requests. Wait a moment and try again.',
}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref();
  return (req, res, next) => {
    if (!max) return next();
    const id = key(req);
    if (id == null) return next();
    const now = Date.now();
    let entry = hits.get(id);
    if (!entry || entry.reset <= now) {
      entry = {count: 0, reset: now + windowMs};
      hits.set(id, entry);
    }
    entry.count++;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      metrics?.inc('facilities_rate_limited_total', {limiter: name});
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({error: message});
    }
    next();
  };
}
export const limitFromEnv = (env, name, fallback) => {
  if (env.RATE_LIMITS === 'off') return 0;
  const value = env[`RATE_LIMIT_${name}`];
  return value === undefined || value === '' ? fallback : Number(value);
};
