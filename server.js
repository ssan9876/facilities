import express from 'express';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './db.js';
import {setupAuth, purgeExpiredSessions} from './auth.js';
import {dateInTimezone} from './dates.js';
import {moduleSettings, notify, preferences, visibleNotifications, setupSettings} from './requests.js';
import {setupReleases, installedVersion} from './releases.js';
import {setupAdministration, workspaceSettings} from './administration.js';
import {setupOrders, orderSummary, assignTicketNumber} from './orders.js';
import {setupRecords} from './records.js';
import {setupSpaces} from './reservations.js';
import {setupAttachments} from './attachments.js';
import {setupInventory, listParts} from './inventory.js';
import {setupReports} from './reports.js';
import {setupLabels} from './labels.js';
import {setupHousekeeping, purgeOldData} from './housekeeping.js';
import {setupRequestForms, formConfig} from './requestforms.js';
import {setupEmail, emailConfigured} from './email.js';
import {setupAudit, audit, systemActor} from './audit.js';
import {
  createLogger,
  defaultLogLevel,
  createMetrics,
  requestTelemetry,
  metricsRoute,
  rateLimit,
  limitFromEnv,
} from './observability.js';
import {latestMigration} from './migrations.js';
import {can, loadRoles, sqlRoleList, rolesWith} from './permissions.js';

const today = () => dateInTimezone();

// options: {logger, transport (email, tests), logoutKeys (back-channel logout verification, tests)}
export async function createApp(env = process.env, dbOverride, options = {}) {
  const logger = options.logger || createLogger(defaultLogLevel(env));
  const metrics = createMetrics();
  const db = dbOverride || (await openDatabase(env.DATABASE_URL, env.SQLITE_PATH));
  await loadRoles(db);
  const q = db.query;
  if (env.AUTH_MODE === 'demo' && env.NODE_ENV !== 'production') {
    await q('INSERT INTO users(id,subject,name,email,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(subject) DO NOTHING', [
      'demo-admin',
      'demo-admin',
      'Alex Morgan',
      'alex@example.test',
      'admin',
    ]);
    if (env.SEED_DEMO === 'true' && !(await q('SELECT id FROM buildings')).length) await seed(db);
  }
  const app = express();
  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(requestTelemetry(logger, metrics));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'font-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
        },
      },
    }),
  );
  app.use(express.json({limit: '64kb', type: ['application/json', 'application/scim+json']}));
  app.get('/health', async (req, res) => {
    await q('SELECT 1');
    res.json({ok: true, version: installedVersion, schema: latestMigration});
  });
  metrics.gauge('facilities_open_requests', async () =>
    Number((await q("SELECT COUNT(*) AS count FROM work_orders WHERE status<>'Completed'"))[0].count),
  );
  metrics.gauge('facilities_email_outbox_pending', async () =>
    Number((await q('SELECT COUNT(*) AS count FROM email_outbox WHERE sent_at IS NULL AND attempts<5'))[0].count),
  );
  metrics.gauge('facilities_process_uptime_seconds', () => Math.round(process.uptime()));
  metrics.gauge('facilities_process_resident_memory_bytes', () => process.memoryUsage().rss);
  app.get('/metrics', metricsRoute(metrics, env.METRICS_TOKEN));
  app.use(['/api', '/auth'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Limits are per minute. Sign-in and provisioning are keyed by client address; writes by account.
  const limiter = (name, max, key) => rateLimit({name, max: limitFromEnv(env, name, max), key, metrics});
  app.use(
    '/auth',
    limiter('AUTH', 30, req => req.ip),
  );
  app.use(
    '/api/provisioning',
    limiter('PROVISIONING', 600, req => req.ip),
  );
  await setupAuth(app, db, env, {logger, logoutKeys: options.logoutKeys});
  const writes = limiter('WRITES', 300, req =>
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? null : req.user?.id || req.ip,
  );
  app.use('/api', writes);
  const uploadLimiter = limiter('UPLOADS', 30, req => req.user?.id || req.ip);
  setupSettings(app, db);
  setupReleases(app, env, db);
  setupAdministration(app, db, env);
  setupAudit(app, db);
  const email = setupEmail(app, db, env, {logger, workspaceSettings, transport: options.transport});
  const {accessibleOrder, checkLocation} = setupOrders(app, db, env);
  setupRecords(app, db, {checkLocation});
  setupSpaces(app, db, env, {notify});
  setupAttachments(app, db, env, {accessibleOrder, uploadLimiter});
  setupInventory(app, db, {accessibleOrder});
  setupReports(app, db, env);
  setupLabels(app, db, env);
  setupHousekeeping(app, db, env);
  setupRequestForms(app, db);
  // Reference data and counts. Requests themselves are paged through /api/orders.
  app.get('/api/data', async (req, res) => {
    const modules = await moduleSettings(db);
    const assignable = new Set(rolesWith(db, 'requests.assignable'));
    const [buildings, assets, maintenance, users, spaces, parts, counts] = await Promise.all([
      q('SELECT * FROM buildings ORDER BY name'),
      q('SELECT * FROM assets ORDER BY name'),
      !can(req.user, 'maintenance.view') || !modules.maintenance
        ? []
        : q(
            'SELECT m.*,b.name AS building,a.name AS asset FROM maintenance m JOIN buildings b ON b.id=m.building_id LEFT JOIN assets a ON a.id=m.asset_id ORDER BY m.next_due',
          ),
      can(req.user, 'requests.view_all')
        ? q('SELECT id,name,role FROM users WHERE active=1 ORDER BY name').then(rows =>
            rows.map(u => ({...u, assignable: assignable.has(u.role)})),
          )
        : [],
      modules.schedule ? q('SELECT * FROM spaces ORDER BY name') : [],
      !can(req.user, 'inventory.view') || !modules.inventory ? [] : listParts(db),
      can(req.user, 'admin') ? q('SELECT request_type,COUNT(*) AS count FROM work_orders GROUP BY request_type') : [],
    ]);
    res.json({
      buildings,
      assets,
      maintenance,
      users,
      spaces,
      parts,
      modules,
      emailConfigured: emailConfigured(),
      moduleCounts: Object.fromEntries(counts.map(r => [r.request_type, Number(r.count)])),
      summary: await orderSummary(db, req.user, env.ORG_TIMEZONE || 'America/Phoenix'),
      preferences: await preferences(db, req.user.id),
      notifications: await visibleNotifications(db, req.user),
      forms: await formConfig(db),
    });
  });
  app.post('/api/maintenance/generate', async (req, res, next) => {
    if (!can(req.user, 'maintenance.manage'))
      return res.status(403).json({error: 'Your role cannot manage maintenance plans.'});
    if (!(await moduleSettings(db)).maintenance)
      return res.status(403).json({error: 'This request type is disabled. Contact your administrator.'});
    try {
      res.json({generated: await generateMaintenance(db, req.user)});
    } catch (e) {
      next(e);
    }
  });
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large')
      err = {
        status: 413,
        message: `The upload is too large. The limit is ${env.ATTACHMENT_MAX_MB || 10} MB for files.`,
      };
    else if (err.type === 'entity.parse.failed') err = {status: 400, message: 'The request body is not valid JSON.'};
    if (!err.status || err.status >= 500)
      logger.error('request failed', {
        request_id: req.id,
        method: req.method,
        path: req.path,
        error: err.message,
        stack: err.stack,
      });
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({
      error:
        (err.status && err.status < 500) || err.status === 502 || err.status === 503
          ? err.message
          : 'Something went wrong. Try again or contact your administrator.',
      request_id: req.id,
    });
  });
  return {app, db, logger, metrics, email};
}

export async function generateMaintenance(db, actor = systemActor) {
  if (!(await moduleSettings(db)).maintenance) return 0;
  let count = 0;
  const plans = await db.query('SELECT * FROM maintenance WHERE next_due<=$1 AND active=1', [today()]);
  for (const plan of plans) {
    // Deterministic keys and the unique occurrence constraint prevent duplicate orders across processes.
    const id = `pm-${plan.id}-${plan.next_due}`;
    await db.query(
      'INSERT INTO work_orders(id,title,description,building_id,asset_id,priority,status,requester_id,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING',
      [
        id,
        plan.title,
        `Scheduled maintenance. Recurs every ${plan.interval_days} days.`,
        plan.building_id,
        plan.asset_id,
        'Normal',
        'Open',
        plan.created_by,
        plan.next_due,
        new Date().toISOString(),
      ],
    );
    const inserted = await db.query(
      'INSERT INTO maintenance_runs(id,plan_id,due_date,work_order_id) VALUES($1,$2,$3,$4) ON CONFLICT(plan_id,due_date) DO NOTHING RETURNING id',
      [randomUUID(), plan.id, plan.next_due, id],
    );
    if (inserted.length) {
      count++;
      await assignTicketNumber(db, id);
      await audit(
        db,
        actor,
        'order.create',
        'work_order',
        id,
        `Generated maintenance request “${plan.title}” due ${plan.next_due}`,
      );
      const notified = sqlRoleList(db, 'requests.notified');
      const recipients = await db.query(`SELECT id FROM users WHERE ${notified.sql} AND active=1`, notified.values);
      await notify(
        db,
        {id, title: plan.title},
        'created',
        recipients.map(u => u.id),
        null,
        'A scheduled maintenance request is ready.',
      );
    }
    const next = new Date(plan.next_due + 'T12:00:00Z');
    do {
      next.setUTCDate(next.getUTCDate() + plan.interval_days);
    } while (next.toISOString().slice(0, 10) <= today());
    await db.query('UPDATE maintenance SET next_due=$1 WHERE id=$2 AND next_due=$3', [
      next.toISOString().slice(0, 10),
      plan.id,
      plan.next_due,
    ]);
  }
  return count;
}

async function seed(db) {
  const now = new Date().toISOString();
  for (const [id, name, address] of [
    ['b1', 'North Campus', '1200 North Central Avenue'],
    ['b2', 'Operations Center', '240 West Industrial Drive'],
    ['b3', 'Community Center', '800 East Park Road'],
  ])
    await db.query('INSERT INTO buildings(id,name,address,created_at) VALUES($1,$2,$3,$4)', [id, name, address, now]);
  for (const [id, name, b, category, serial] of [
    ['a1', 'Rooftop HVAC · Unit 04', 'b1', 'HVAC', 'RTU-004'],
    ['a2', 'Main circulation pump', 'b3', 'Plumbing', 'PMP-021'],
    ['a3', 'Emergency generator', 'b2', 'Electrical', 'GEN-008'],
  ])
    await db.query('INSERT INTO assets(id,name,building_id,category,serial,created_at) VALUES($1,$2,$3,$4,$5,$6)', [
      id,
      name,
      b,
      category,
      serial,
      now,
    ]);
  const day = offset => {
    const d = new Date(today() + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  for (const [i, title, b, a, priority, status, offset] of [
    [1, 'Air conditioning not cooling — east wing', 'b1', 'a1', 'Urgent', 'Open', -1],
    [2, 'Replace lobby ceiling lights', 'b3', null, 'Normal', 'In progress', 1],
    [3, 'Inspect emergency generator', 'b2', 'a3', 'High', 'Open', 0],
    [4, 'Repair leaking circulation pump', 'b3', 'a2', 'High', 'On hold', 2],
    [5, 'Adjust conference room door closer', 'b2', null, 'Low', 'Open', 5],
    [6, 'Replace HVAC return filters', 'b1', 'a1', 'Normal', 'Completed', -2],
  ]) {
    await db.query(
      'INSERT INTO work_orders(id,title,description,building_id,asset_id,priority,status,assignee_id,requester_id,due_date,created_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        `demo-${i}`,
        title,
        'Illustrative demo work order. Replace demo records with your organization’s real information.',
        b,
        a,
        priority,
        status,
        'demo-admin',
        'demo-admin',
        day(offset),
        now,
        status === 'Completed' ? now : null,
      ],
    );
    await assignTicketNumber(db, `demo-${i}`);
  }
  await db.query(
    'INSERT INTO maintenance(id,title,building_id,asset_id,interval_days,next_due,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    ['pm1', 'Monthly HVAC inspection', 'b1', 'a1', 30, day(3), 'demo-admin', now],
  );
  await db.query(
    'INSERT INTO maintenance(id,title,building_id,asset_id,interval_days,next_due,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    ['pm2', 'Generator load test', 'b2', 'a3', 90, day(7), 'demo-admin', now],
  );
  for (const [id, b, name, capacity, approval] of [
    ['s1', 'b3', 'Main hall', 120, 1],
    ['s2', 'b2', 'Conference room A', 12, 0],
  ])
    await db.query(
      'INSERT INTO spaces(id,building_id,name,capacity,requires_approval,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, b, name, capacity, approval, now],
    );
  for (const [id, name, sku, b, location, qty, min, cost] of [
    ['p1', 'HVAC return filter 20×25×1', 'FLT-20251', 'b1', 'Mechanical room shelf 2', 14, 6, 899],
    ['p2', 'LED panel 2×4', 'LED-24-40W', 'b3', 'Storage closet', 3, 4, 4650],
    ['p3', 'Pump seal kit', 'PMP-SEAL-21', 'b3', 'Boiler room cabinet', 2, 1, 12800],
  ])
    await db.query(
      'INSERT INTO parts(id,name,sku,building_id,location,quantity,min_quantity,unit_cost_cents,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, name, sku, b, location, qty, min, cost, now],
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {app, db, logger, email} = await createApp();
  const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', async err => {
    if (err) {
      logger.error('unable to start', {error: err.message});
      await db.close();
      process.exit(1);
    }
    logger.info('Facilities started', {
      url: process.env.APP_URL || 'http://localhost:3000',
      version: installedVersion,
      schema: latestMigration,
    });
  });
  if (process.env.AUTH_MODE !== 'demo') {
    const tick = () =>
      generateMaintenance(db).catch(e => logger.error('maintenance generation failed', {error: e.message}));
    await tick();
    const timer = setInterval(tick, 3600000);
    timer.unref();
  }
  // Hourly: expired sessions, then anything past the retention settings.
  const purge = () =>
    purgeExpiredSessions(db)
      .then(() => purgeOldData(db))
      .then(removed => {
        if (removed.notifications || removed.audit || removed.email) logger.info('retention cleanup', removed);
      })
      .catch(e => logger.error('cleanup failed', {error: e.message}));
  await purge();
  setInterval(purge, 3600000).unref();
  email.start();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      logger.info('shutting down', {signal});
      server.close(async () => {
        await db.close();
        process.exit(0);
      });
    });
}
