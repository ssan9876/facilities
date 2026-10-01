// Live updates over Server-Sent Events. Every signed-in browser keeps one stream open (GET /api/stream)
// and receives:
//   notification  a new in-app notification for this person (sent by notify())
//   order         a ticket changed or was created/deleted ({id, deleted?}); only to people who can see it
//   data          workspace reference data changed (settings, forms, roles, groups, places, people…)
//   update/backup progress of a server update or backup, to people who manage them
// Ticket and data events come from the audit log hook, so every audited change is streamed once it has
// committed; bursts are coalesced. Events carry ids, not content: clients fetch through the normal,
// permission-checked API. One process holds the streams, which matches the single-container install.
import {stat} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {join} from 'node:path';
import {applyGrants, memberships, canOn, can} from './permissions.js';

const heartbeatMs = 25000;
// Each browser tab sends its own id (X-Live-Client) with API calls and on its stream, so a change is not
// echoed back to the tab that made it; that tab already shows the result.
const origin = new AsyncLocalStorage();
const tabId = value => (typeof value === 'string' && /^[\w-]{8,64}$/.test(value) ? value : null);
const maxStreamsPerUser = 8;

export function setupLive(app, db, env, {logger} = {}) {
  const clients = new Set();
  app.use((req, res, next) => origin.run({tab: tabId(req.get('x-live-client'))}, next));
  const send = (client, event, data) => {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
    } catch {
      clients.delete(client);
    }
  };
  // Grants are refreshed when roles, groups or people change, so audiences follow permission changes.
  const refreshGrants = async () => {
    const ids = [...new Set([...clients].map(c => c.user.id))];
    for (const id of ids) {
      const row = (await db.query('SELECT id,name,role,active FROM users WHERE id=$1', [id]))[0];
      for (const c of clients) {
        if (c.user.id !== id) continue;
        if (!row?.active) {
          c.res.end();
          clients.delete(c);
        } else c.user = applyGrants(db, {id: row.id, name: row.name, role: row.role}, await memberships(db, id));
      }
    }
  };

  // Pending changes, each with the tabs that caused them (null: no tab, so everyone is told).
  const pendingOrders = new Map();
  let pendingData = null,
    timer = null;
  const note = (set, tab) => (set.add(tab), set);
  const echo = (tabs, client) => tabs.size === 1 && client.tab && tabs.has(client.tab);
  const flush = async () => {
    timer = null;
    const orders = [...pendingOrders];
    pendingOrders.clear();
    const data = pendingData;
    pendingData = null;
    try {
      if (data) {
        await refreshGrants();
        for (const c of clients) if (!echo(data, c)) send(c, 'data', {});
      }
      for (const [id, tabs] of orders) {
        const order = (
          await db.query('SELECT id,request_type,building_id,requester_id,assignee_id FROM work_orders WHERE id=$1', [
            id,
          ])
        )[0];
        for (const c of clients) {
          if (echo(tabs, c)) continue;
          if (!order) send(c, 'order', {id, deleted: true});
          else if (
            order.requester_id === c.user.id ||
            order.assignee_id === c.user.id ||
            canOn(c.user, 'requests.view_all', order)
          )
            send(c, 'order', {id});
        }
      }
    } catch (err) {
      logger?.warn('live update failed', {error: err.message});
    }
  };
  // Changes inside a transaction are announced after a short delay, by which time they have committed.
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 150);
  };
  db.live = {
    changed(entityType, entityId) {
      if (!clients.size) return;
      const tab = origin.getStore()?.tab ?? null;
      if (entityType === 'work_order' && entityId)
        pendingOrders.set(entityId, note(pendingOrders.get(entityId) || new Set(), tab));
      else pendingData = note(pendingData || new Set(), tab);
      schedule();
    },
    toUsers(ids, event, data) {
      const wanted = new Set(ids);
      for (const c of clients) if (wanted.has(c.user.id)) send(c, event, data);
    },
    get size() {
      return clients.size;
    },
  };

  // Server update and backup progress: the host agent writes these files; watch them while someone listens.
  const watched = env.UPDATE_DIR
    ? {
        update: ['status.json', 'request.json'],
        backup: ['backup.json', 'backup-request.json'],
      }
    : {};
  const seen = {};
  const fingerprint = async files =>
    (
      await Promise.all(
        files.map(f =>
          stat(join(env.UPDATE_DIR, f)).then(
            s => `${s.mtimeMs}:${s.size}`,
            () => '-',
          ),
        ),
      )
    ).join('|');
  const watch = setInterval(async () => {
    for (const [event, files] of Object.entries(watched)) {
      const cap = event === 'update' ? 'admin.updates' : 'admin.data';
      const listeners = [...clients].filter(c => can(c.user, cap));
      if (!listeners.length) continue;
      const now = await fingerprint(files);
      if (seen[event] !== undefined && seen[event] !== now) for (const c of listeners) send(c, event, {});
      seen[event] = now;
    }
  }, 2000);
  watch.unref();

  app.get('/api/stream', (req, res) => {
    if (!req.user) return res.status(401).json({error: 'Sign in to receive live updates.'});
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const client = {res, user: req.user, tab: tabId(req.query.client)};
    // Keep the newest few streams per person (several tabs); older ones are closed.
    const mine = [...clients].filter(c => c.user.id === req.user.id);
    for (const old of mine.slice(0, Math.max(0, mine.length - maxStreamsPerUser + 1))) {
      old.res.end();
      clients.delete(old);
    }
    clients.add(client);
    res.write('retry: 5000\n\n');
    send(client, 'ready', {});
    const beat = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        /* closed below */
      }
    }, heartbeatMs);
    req.on('close', () => {
      clearInterval(beat);
      clients.delete(client);
    });
  });
  // Closes every stream (tests, shutdown).
  return {
    close() {
      clearInterval(watch);
      if (timer) clearTimeout(timer);
      for (const c of clients) c.res.end();
      clients.clear();
    },
  };
}
