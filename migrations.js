// Versioned schema migrations. Each migration runs once, in its own transaction, and is
// recorded in schema_migrations. Append new migrations; never edit or reorder applied ones.
// Migration 1 is the pre-versioning schema and is idempotent so existing installations adopt it.

async function columns(q, dialect, table) {
  const rows =
    dialect === 'postgres'
      ? await q(
          'SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',
          [table],
        )
      : await q(`PRAGMA table_info(${table})`);
  return new Set(rows.map(r => r.name));
}
async function addColumns(q, dialect, table, definitions) {
  const existing = await columns(q, dialect, table);
  for (const [name, definition] of definitions)
    if (!existing.has(name)) await q(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
const binary = dialect => (dialect === 'postgres' ? 'BYTEA' : 'BLOB');

export const migrations = [
  {
    id: 1,
    name: 'baseline',
    async up(q, dialect) {
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
      ])
        await q(sql);
      // Existing requests are classified as maintenance.
      await addColumns(q, dialect, 'work_orders', [
        ['request_type', "TEXT NOT NULL DEFAULT 'maintenance'"],
        ['starts_at', 'TEXT'],
        ['ends_at', 'TEXT'],
      ]);
      for (const key of ['maintenance', 'schedule', 'technology', 'notifications'])
        await q('INSERT INTO modules(id,enabled) VALUES($1,1) ON CONFLICT(id) DO NOTHING', [key]);
      await addColumns(q, dialect, 'users', [
        ['active', 'INTEGER NOT NULL DEFAULT 1'],
        ['managed', 'INTEGER NOT NULL DEFAULT 0'],
        ['user_name', 'TEXT'],
        ['external_id', 'TEXT'],
      ]);
      await q('CREATE UNIQUE INDEX IF NOT EXISTS users_user_name ON users(user_name)');
    },
  },
  {
    id: 2,
    name: 'audit-log',
    async up(q) {
      await q(
        'CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, summary TEXT NOT NULL, details TEXT)',
      );
      await q('CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity_type, entity_id, created_at)');
      await q('CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created_at)');
    },
  },
  {
    id: 3,
    name: 'record-lifecycle',
    async up(q, dialect) {
      await addColumns(q, dialect, 'buildings', [['archived_at', 'TEXT']]);
      await addColumns(q, dialect, 'assets', [['archived_at', 'TEXT']]);
      await addColumns(q, dialect, 'maintenance', [['active', 'INTEGER NOT NULL DEFAULT 1']]);
      await addColumns(q, dialect, 'work_orders', [['updated_at', 'TEXT']]);
      await addColumns(q, dialect, 'comments', [['edited_at', 'TEXT']]);
      await q('CREATE INDEX IF NOT EXISTS work_orders_requester ON work_orders(requester_id)');
      await q('CREATE INDEX IF NOT EXISTS work_orders_type_status ON work_orders(request_type, status)');
      await q('CREATE INDEX IF NOT EXISTS work_orders_due ON work_orders(due_date)');
      await q('CREATE INDEX IF NOT EXISTS comments_order ON comments(work_order_id, created_at)');
    },
  },
  {
    id: 4,
    name: 'attachments',
    async up(q, dialect) {
      await q(
        `CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders(id), file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, data ${binary(dialect)} NOT NULL, uploaded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)`,
      );
      await q('CREATE INDEX IF NOT EXISTS attachments_order ON attachments(work_order_id)');
    },
  },
  {
    id: 5,
    name: 'email-delivery',
    async up(q) {
      await q(
        'CREATE TABLE IF NOT EXISTS email_outbox (id TEXT PRIMARY KEY, user_id TEXT, to_address TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, send_after TEXT NOT NULL, sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)',
      );
      await q('CREATE INDEX IF NOT EXISTS email_outbox_pending ON email_outbox(sent_at, send_after)');
      // Email stays off until an administrator configures SMTP and enables it.
      await q('INSERT INTO modules(id,enabled) VALUES($1,0) ON CONFLICT(id) DO NOTHING', ['email']);
    },
  },
  {
    id: 6,
    name: 'inventory',
    async up(q) {
      await q(
        'CREATE TABLE IF NOT EXISTS parts (id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL, building_id TEXT REFERENCES buildings(id), location TEXT NOT NULL, quantity INTEGER NOT NULL, min_quantity INTEGER NOT NULL DEFAULT 0, unit_cost_cents INTEGER, archived_at TEXT, created_at TEXT NOT NULL)',
      );
      await q(
        'CREATE TABLE IF NOT EXISTS part_usage (id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id), quantity INTEGER NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)',
      );
      await q('CREATE INDEX IF NOT EXISTS part_usage_order ON part_usage(work_order_id)');
      await q('INSERT INTO modules(id,enabled) VALUES($1,1) ON CONFLICT(id) DO NOTHING', ['inventory']);
    },
  },
  {
    id: 7,
    name: 'reservations',
    async up(q, dialect) {
      await q(
        'CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id), name TEXT NOT NULL, capacity INTEGER, requires_approval INTEGER NOT NULL DEFAULT 0, archived_at TEXT, created_at TEXT NOT NULL)',
      );
      await addColumns(q, dialect, 'work_orders', [
        ['space_id', 'TEXT REFERENCES spaces(id)'],
        ['reservation_status', 'TEXT'],
      ]);
      await q('CREATE INDEX IF NOT EXISTS work_orders_space ON work_orders(space_id, starts_at)');
    },
  },
  {
    id: 8,
    name: 'session-identity',
    async up(q, dialect) {
      await addColumns(q, dialect, 'sessions', [
        ['user_id', 'TEXT'],
        ['oidc_sid', 'TEXT'],
        ['oidc_subject', 'TEXT'],
      ]);
      await q('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)');
      await q('CREATE INDEX IF NOT EXISTS sessions_oidc ON sessions(oidc_subject, oidc_sid)');
      await q('CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)');
    },
  },
  {
    id: 9,
    name: 'ticket-numbers',
    async up(q, dialect) {
      // Human-facing sequential ticket numbers (WO-0001), allocated from an atomic counter.
      await addColumns(q, dialect, 'work_orders', [['number', 'INTEGER']]);
      await q('CREATE TABLE IF NOT EXISTS counters (id TEXT PRIMARY KEY, value INTEGER NOT NULL)');
      const rows = await q('SELECT id FROM work_orders WHERE number IS NULL ORDER BY created_at, id');
      let next = Number((await q('SELECT COALESCE(MAX(number),0) AS n FROM work_orders'))[0].n);
      for (const row of rows) await q('UPDATE work_orders SET number=$1 WHERE id=$2', [++next, row.id]);
      await q("INSERT INTO counters(id,value) VALUES('work_order',$1) ON CONFLICT(id) DO UPDATE SET value=$1", [next]);
      await q('CREATE UNIQUE INDEX IF NOT EXISTS work_orders_number ON work_orders(number)');
    },
  },
];

export async function migrate(db, list = migrations) {
  // A PostgreSQL advisory lock keeps simultaneously starting containers from racing.
  await db.session(async conn => {
    if (db.dialect === 'postgres') await conn.query('SELECT pg_advisory_lock(7264001)');
    try {
      await conn.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
      );
      const applied = new Set((await conn.query('SELECT id FROM schema_migrations')).map(r => Number(r.id)));
      for (const migration of list) {
        if (applied.has(migration.id)) continue;
        await conn.query('BEGIN');
        try {
          await migration.up(conn.query, db.dialect);
          await conn.query('INSERT INTO schema_migrations(id,name,applied_at) VALUES($1,$2,$3)', [
            migration.id,
            migration.name,
            new Date().toISOString(),
          ]);
          await conn.query('COMMIT');
        } catch (err) {
          await conn.query('ROLLBACK').catch(() => {});
          throw new Error(`Database migration ${migration.id} (${migration.name}) failed: ${err.message}`, {
            cause: err,
          });
        }
      }
    } finally {
      if (db.dialect === 'postgres') await conn.query('SELECT pg_advisory_unlock(7264001)');
    }
  });
}

export const latestMigration = migrations.at(-1).id;
