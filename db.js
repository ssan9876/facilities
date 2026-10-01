import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import pg from 'pg';

export async function openDatabase(url = process.env.DATABASE_URL, file = process.env.SQLITE_PATH || 'data/facilities.db') {
  let query, close;
  if (url) {
    const pool = new pg.Pool({connectionString: url});
    query = async (sql, values = []) => (await pool.query(sql, values)).rows;
    close = () => pool.end();
  } else {
    mkdirSync('data', {recursive: true});
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    query = async (sql, values = []) => {
      const params = [];
      const converted = sql.replace(/\$(\d+)/g, (_, n) => {params.push(values[Number(n)-1]); return '?';});
      const stmt = db.prepare(converted);
      return stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []);
    };
    close = async () => db.close();
  }
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, subject TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS buildings (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, building_id TEXT NOT NULL REFERENCES buildings(id), category TEXT NOT NULL, serial TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS work_orders (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, building_id TEXT NOT NULL REFERENCES buildings(id), asset_id TEXT REFERENCES assets(id), priority TEXT NOT NULL, status TEXT NOT NULL, assignee_id TEXT REFERENCES users(id), requester_id TEXT NOT NULL REFERENCES users(id), due_date TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT)',
    'CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders(id), user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS maintenance (id TEXT PRIMARY KEY, title TEXT NOT NULL, building_id TEXT NOT NULL REFERENCES buildings(id), asset_id TEXT REFERENCES assets(id), interval_days INTEGER NOT NULL, next_due TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS maintenance_runs (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES maintenance(id), due_date TEXT NOT NULL, work_order_id TEXT NOT NULL UNIQUE REFERENCES work_orders(id), UNIQUE(plan_id, due_date))',
    'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS work_orders_status ON work_orders(status)',
    'CREATE TABLE IF NOT EXISTS modules (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS notification_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), body TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL REFERENCES work_orders(id), event TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT)',
    'CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at)',
    'CREATE TABLE IF NOT EXISTS admin_settings (id TEXT PRIMARY KEY, body TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS user_groups (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT NOT NULL, auto_assign INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS group_members (group_id TEXT NOT NULL REFERENCES user_groups(id), user_id TEXT NOT NULL REFERENCES users(id), source TEXT NOT NULL, PRIMARY KEY(group_id,user_id,source))',
    'CREATE TABLE IF NOT EXISTS provisioning_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)',
  ]) await query(sql);
  // Additive migration: preserve existing requests and classify them as maintenance.
  const columns = url ? (await query("SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='work_orders'")) : await query('PRAGMA table_info(work_orders)');
  for (const [name,definition] of [['request_type',"TEXT NOT NULL DEFAULT 'maintenance'"],['starts_at','TEXT'],['ends_at','TEXT']]) {
    if (!columns.some(c=>c.name===name)) await query(`ALTER TABLE work_orders ADD COLUMN ${name} ${definition}`);
  }
  for (const key of ['maintenance','schedule','technology','notifications']) await query('INSERT INTO modules(id,enabled) VALUES($1,1) ON CONFLICT(id) DO NOTHING',[key]);
  const userColumns=url ? await query("SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'") : await query('PRAGMA table_info(users)');
  for(const [name,definition] of [['active','INTEGER NOT NULL DEFAULT 1'],['managed','INTEGER NOT NULL DEFAULT 0'],['user_name','TEXT'],['external_id','TEXT']]) if(!userColumns.some(c=>c.name===name)) await query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  await query('CREATE UNIQUE INDEX IF NOT EXISTS users_user_name ON users(user_name)');
  return {query, close};
}
