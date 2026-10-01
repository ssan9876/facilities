import {openDatabase} from '../db.js';
import {createApp} from '../server.js';

// Starts an isolated in-memory workspace signed in as the demo administrator.
// as(userId) switches the same signed session to another user, so role checks are exercised per request.
export async function startWorkspace(env = {}, options = {}) {
  const db = await openDatabase(null, ':memory:');
  const created = await createApp({AUTH_MODE: 'demo', SEED_DEMO: 'true', LOG_LEVEL: 'silent', ...env}, db, options);
  const {app, live} = created;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '',
    csrf = '';
  async function call(path, method = 'GET', body, headers = {}) {
    const raw = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {cookie, 'x-csrf-token': csrf, ...(raw ? {} : {'Content-Type': 'application/json'}), ...headers},
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json')
      ? await res.json()
      : type.startsWith('text/')
        ? await res.text()
        : Buffer.from(await res.arrayBuffer());
    return {status: res.status, body: data, headers: res.headers};
  }
  await call('/auth/login');
  csrf = (await call('/api/me')).body.csrf;
  const sessionId = (await db.query("SELECT id FROM sessions WHERE user_id='demo-admin'"))[0].id;
  async function as(userId) {
    const row = (await db.query('SELECT body FROM sessions WHERE id=$1', [sessionId]))[0];
    const body = JSON.parse(row.body);
    body.userId = userId;
    await db.query('UPDATE sessions SET body=$1,user_id=$2 WHERE id=$3', [JSON.stringify(body), userId, sessionId]);
  }
  async function addUser(id, role, extra = {}) {
    await db.query('INSERT INTO users(id,subject,name,email,role) VALUES($1,$2,$3,$4,$5)', [
      id,
      id,
      extra.name || id,
      extra.email || '',
      role,
    ]);
  }
  const close = async () => {
    live.close();
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
    await db.close();
  };
  return {
    server: created,
    db,
    call,
    as,
    addUser,
    close,
    base,
    get cookie() {
      return cookie;
    },
    sessionId,
  };
}
