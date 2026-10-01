// Integrations: ticket events posted to Slack, Microsoft Teams (Workflows webhooks) or any JSON endpoint.
// Events come from the audit hook, so every audited change can be delivered. Deliveries are queued and
// retried; JSON deliveries are signed with the webhook's secret (X-Facilities-Signature: sha256=…).
// Webhook addresses must be HTTPS and must not resolve to private networks unless the server allows it.
import {randomUUID, randomBytes, createHmac} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {audit} from './audit.js';
import {error, text} from './validation.js';
import {can} from './permissions.js';

export const webhookEvents = {
  created: 'New request',
  assigned: 'Assigned',
  status: 'Status changed',
  resolved: 'Resolved',
  comment: 'New comment',
  overdue: 'Overdue',
};
const kinds = ['slack', 'teams', 'json'];
const retryMinutes = [1, 5, 30, 120];
const maxAttempts = 5;

// Which webhook events an audited change is.
export function eventsFor(action, details) {
  if (action === 'order.create') return ['created'];
  if (action === 'order.auto_assign') return ['assigned'];
  if (action === 'comment.create') return ['comment'];
  if (action === 'order.escalate') return ['overdue'];
  if (action !== 'order.update' || !details) return [];
  const out = [];
  if (details.status) out.push(details.status[1] === 'Completed' ? 'resolved' : 'status');
  if (details.assignee_id && details.assignee_id[1]) out.push('assigned');
  return out;
}

const privateAddress = ip =>
  /^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ||
  ip === '::1' ||
  /^f[cd]/i.test(ip) ||
  /^fe80/i.test(ip) ||
  /^::ffff:(10\.|127\.|192\.168\.|169\.254\.)/i.test(ip);
export async function checkTarget(url, env) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw error('Enter a full webhook address starting with https://.');
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && env.WEBHOOK_ALLOW_HTTP === 'true'))
    throw error('Webhook addresses must use https://.');
  if (u.username || u.password) throw error('Put credentials in the webhook secret, not the address.');
  if (env.WEBHOOK_ALLOW_PRIVATE === 'true') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal'))
    throw error('Webhook addresses must be on the internet, not this network.');
  const ips = isIP(host) ? [host] : (await lookup(host, {all: true}).catch(() => [])).map(a => a.address);
  if (!ips.length) throw error('That webhook address does not resolve.');
  if (ips.some(privateAddress)) throw error('Webhook addresses must be on the internet, not this network.');
  return u;
}

function message(kind, event, ticket, actor, extra) {
  const what = {
    created: `New ${ticket.request_type} request`,
    assigned: `Assigned to ${ticket.assignee || 'someone'}`,
    status: `Status changed to ${ticket.status}`,
    resolved: 'Resolved',
    comment: 'New comment',
    overdue: `Overdue since ${ticket.due_date}`,
  }[event];
  const title = `${ticket.label} ${ticket.title}`;
  const line = `${what}${actor ? ` · ${actor}` : ''} · ${ticket.building} · ${ticket.priority}`;
  if (kind === 'slack') return {text: `*<${ticket.url}|${title}>*\n${line}`};
  if (kind === 'teams')
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {type: 'TextBlock', text: title, weight: 'Bolder', wrap: true},
              {type: 'TextBlock', text: line, wrap: true, spacing: 'Small'},
            ],
            actions: [{type: 'Action.OpenUrl', title: 'Open ticket', url: ticket.url}],
          },
        },
      ],
    };
  return {event, at: new Date().toISOString(), actor: actor || null, ticket, details: extra || null};
}

export function setupIntegrations(app, db, env, {logger} = {}) {
  const appUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const settings = (req, res, next) =>
    can(req.user, 'admin.settings') ? next() : res.status(403).json({error: 'Your role cannot manage integrations.'});
  const fetcher = env.__webhookFetch || fetch;

  // Changes are queued shortly after they are audited, once their transaction has committed.
  const pending = [];
  let timer = null;
  db.webhooks = {
    event(action, entityType, entityId, details, actor) {
      if (entityType !== 'work_order' || !entityId) return;
      const events = eventsFor(action, details);
      if (!events.length) return;
      pending.push({entityId, events, actor: actor?.name || null, details});
      if (!timer) {
        timer = setTimeout(() => flush().catch(err => logger?.warn('webhook queue failed', {error: err.message})), 200);
        timer.unref?.();
      }
    },
  };
  async function flush() {
    timer = null;
    const batch = pending.splice(0);
    const hooks = (await db.query('SELECT * FROM webhooks WHERE active=1')).map(h => ({
      ...h,
      events: JSON.parse(h.events),
    }));
    if (!hooks.length) return;
    for (const item of batch) {
      const row = (
        await db.query(
          'SELECT w.id,w.number,w.title,w.status,w.priority,w.request_type,w.due_date,b.name AS building,u.name AS assignee FROM work_orders w JOIN buildings b ON b.id=w.building_id LEFT JOIN users u ON u.id=w.assignee_id WHERE w.id=$1',
          [item.entityId],
        )
      )[0];
      if (!row) continue;
      const label = `WO-${String(row.number).padStart(4, '0')}`;
      const ticket = {...row, label, url: `${appUrl}/tickets/${label}`};
      for (const event of item.events)
        for (const h of hooks.filter(x => x.events.includes(event)))
          await db.query(
            'INSERT INTO webhook_deliveries(id,webhook_id,event,payload,created_at,send_after) VALUES($1,$2,$3,$4,$5,$5)',
            [
              randomUUID(),
              h.id,
              event,
              JSON.stringify(message(h.kind, event, ticket, item.actor, item.details)),
              new Date().toISOString(),
            ],
          );
    }
    await deliver().catch(err => logger?.warn('webhook delivery failed', {error: err.message}));
  }

  let delivering = false;
  async function deliver() {
    if (delivering) return 0;
    delivering = true;
    let sent = 0;
    try {
      const due = await db.query(
        'SELECT d.*,h.url,h.kind,h.secret,h.active FROM webhook_deliveries d JOIN webhooks h ON h.id=d.webhook_id WHERE d.sent_at IS NULL AND d.attempts<$1 AND d.send_after<=$2 ORDER BY d.created_at LIMIT 50',
        [maxAttempts, new Date().toISOString()],
      );
      for (const d of due) {
        if (!Number(d.active)) continue;
        const retry = new Date(Date.now() + (retryMinutes[d.attempts] ?? 120) * 60000).toISOString();
        await db.query('UPDATE webhook_deliveries SET attempts=attempts+1,send_after=$1 WHERE id=$2', [retry, d.id]);
        let status;
        try {
          await checkTarget(d.url, env);
          const headers = {'Content-Type': 'application/json', 'User-Agent': 'Facilities-Webhooks/1'};
          if (d.kind === 'json') {
            headers['X-Facilities-Event'] = d.event;
            headers['X-Facilities-Signature'] =
              'sha256=' + createHmac('sha256', d.secret).update(d.payload).digest('hex');
          }
          const res = await fetcher(d.url, {
            method: 'POST',
            headers,
            body: d.payload,
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          });
          status = `${res.status}`;
          if (!res.ok) throw new Error(`The endpoint answered ${res.status}.`);
          await db.query('UPDATE webhook_deliveries SET sent_at=$1,last_error=NULL WHERE id=$2', [
            new Date().toISOString(),
            d.id,
          ]);
          sent++;
        } catch (err) {
          status = status || 'error';
          await db.query('UPDATE webhook_deliveries SET last_error=$1 WHERE id=$2', [
            String(err.message).slice(0, 300),
            d.id,
          ]);
        }
        await db.query('UPDATE webhooks SET last_status=$1,last_at=$2 WHERE id=$3', [
          status,
          new Date().toISOString(),
          d.webhook_id,
        ]);
      }
      // Delivered entries are kept for a week for troubleshooting.
      await db.query('DELETE FROM webhook_deliveries WHERE sent_at IS NOT NULL AND sent_at<$1', [
        new Date(Date.now() - 7 * 86400000).toISOString(),
      ]);
    } finally {
      delivering = false;
    }
    return sent;
  }
  const tick = setInterval(() => deliver().catch(() => {}), 15000);
  tick.unref();

  const list = async () =>
    (await db.query('SELECT * FROM webhooks ORDER BY created_at')).map(h => ({
      id: h.id,
      name: h.name,
      kind: h.kind,
      url: h.url,
      events: JSON.parse(h.events),
      active: !!Number(h.active),
      last_status: h.last_status,
      last_at: h.last_at,
      secret_hint: h.kind === 'json' ? h.secret.slice(0, 6) + '…' : null,
    }));
  const body = async (b, before) => {
    const name = text(b, 'name', 80);
    const kind = b.kind ?? before?.kind;
    if (!kinds.includes(kind)) throw error('Choose Slack, Microsoft Teams or JSON.');
    const url = String(b.url ?? before?.url ?? '');
    await checkTarget(url, env);
    const events = b.events ?? before?.events ?? [];
    if (!Array.isArray(events) || !events.length || events.some(e => !webhookEvents[e]))
      throw error('Choose at least one event.');
    return {
      name,
      kind,
      url,
      events: [...new Set(events)],
      active: b.active === undefined ? (before ? before.active : true) : b.active === true,
    };
  };
  app.get('/api/admin/webhooks', settings, async (req, res) =>
    res.json({webhooks: await list(), events: webhookEvents}),
  );
  app.post('/api/admin/webhooks', settings, async (req, res) => {
    const h = await body(req.body || {});
    const id = randomUUID(),
      secret = randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO webhooks(id,name,kind,url,secret,events,active,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, h.name, h.kind, h.url, secret, JSON.stringify(h.events), Number(h.active), new Date().toISOString()],
    );
    await audit(db, req.user, 'webhook.create', 'settings', id, `Added the ${h.name} integration`);
    res.status(201).json({id, secret: h.kind === 'json' ? secret : null, webhooks: await list()});
  });
  app.patch('/api/admin/webhooks/:id', settings, async (req, res) => {
    const before = (await list()).find(h => h.id === req.params.id);
    if (!before) throw error('Integration not found.', 404);
    const h = await body(req.body || {}, before);
    await db.query('UPDATE webhooks SET name=$1,kind=$2,url=$3,events=$4,active=$5 WHERE id=$6', [
      h.name,
      h.kind,
      h.url,
      JSON.stringify(h.events),
      Number(h.active),
      before.id,
    ]);
    await audit(db, req.user, 'webhook.update', 'settings', before.id, `Updated the ${h.name} integration`);
    res.json({webhooks: await list()});
  });
  app.delete('/api/admin/webhooks/:id', settings, async (req, res) => {
    await db.query('DELETE FROM webhook_deliveries WHERE webhook_id=$1', [req.params.id]);
    await db.query('DELETE FROM webhooks WHERE id=$1', [req.params.id]);
    await audit(db, req.user, 'webhook.delete', 'settings', req.params.id, 'Removed an integration');
    res.json({webhooks: await list()});
  });
  // Sends a sample event now and reports how the endpoint answered.
  app.post('/api/admin/webhooks/:id/test', settings, async (req, res) => {
    const h = (await db.query('SELECT * FROM webhooks WHERE id=$1', [req.params.id]))[0];
    if (!h) throw error('Integration not found.', 404);
    const ticket = {
      id: 'test',
      number: 0,
      label: 'WO-0000',
      title: 'Test from Facilities',
      status: 'Open',
      priority: 'Normal',
      request_type: 'maintenance',
      due_date: null,
      building: 'Test building',
      assignee: null,
      url: appUrl,
    };
    await db.query(
      'INSERT INTO webhook_deliveries(id,webhook_id,event,payload,created_at,send_after) VALUES($1,$2,$3,$4,$5,$5)',
      [
        randomUUID(),
        h.id,
        'created',
        JSON.stringify(message(h.kind, 'created', ticket, req.user.name)),
        new Date().toISOString(),
      ],
    );
    await deliver();
    const after = (await db.query('SELECT last_status FROM webhooks WHERE id=$1', [h.id]))[0];
    const failed = (
      await db.query(
        'SELECT last_error FROM webhook_deliveries WHERE webhook_id=$1 AND sent_at IS NULL ORDER BY created_at DESC LIMIT 1',
        [h.id],
      )
    )[0];
    res.json({status: after.last_status, error: failed?.last_error || null});
  });
  return {deliver, flush: () => (timer ? (clearTimeout(timer), flush()) : flush())};
}
