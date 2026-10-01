import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../db.js';
import {migrate, migrations, latestMigration} from '../migrations.js';

test('a fresh database records every migration once', async () => {
  const db = await openDatabase(null, ':memory:');
  try {
    const applied = (await db.query('SELECT id FROM schema_migrations ORDER BY id')).map(r => r.id);
    assert.deepEqual(
      applied,
      migrations.map(m => m.id),
    );
    assert.equal(applied.at(-1), latestMigration);
    await migrate(db);
    assert.equal(
      (await db.query('SELECT COUNT(*) AS n FROM schema_migrations'))[0].n,
      migrations.length,
      're-running is a no-op',
    );
    const modules = Object.fromEntries((await db.query('SELECT * FROM modules')).map(r => [r.id, r.enabled]));
    assert.deepEqual(modules, {maintenance: 1, schedule: 1, technology: 1, notifications: 1, email: 0, inventory: 1});
  } finally {
    await db.close();
  }
});

test('an installation from before versioned migrations upgrades in place', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'facilities-upgrade-'));
  const file = join(folder, 'v020.db');
  try {
    // Schema as created by version 0.2.0, with data.
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, subject TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, managed INTEGER NOT NULL DEFAULT 0, user_name TEXT, external_id TEXT);
      CREATE TABLE buildings (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE work_orders (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, building_id TEXT NOT NULL, asset_id TEXT, priority TEXT NOT NULL, status TEXT NOT NULL, assignee_id TEXT, requester_id TEXT NOT NULL, due_date TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, request_type TEXT NOT NULL DEFAULT 'maintenance', starts_at TEXT, ends_at TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE modules (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
      INSERT INTO modules VALUES('maintenance',1),('schedule',0),('technology',1),('notifications',1);
      INSERT INTO users(id,subject,name,email,role) VALUES('u','s','U','','admin');
      INSERT INTO buildings VALUES('b','Main','',  '2026-01-01');
      INSERT INTO work_orders(id,title,description,building_id,priority,status,requester_id,due_date,created_at) VALUES('w','Old','', 'b','Normal','Open','u','2026-01-02','2026-01-01');
      INSERT INTO sessions VALUES('old','{"userId":"u"}','2099-01-01');`);
    legacy.close();
    const db = await openDatabase(null, file);
    try {
      assert.equal(
        (await db.query("SELECT enabled FROM modules WHERE id='schedule'"))[0].enabled,
        0,
        'existing choices are preserved',
      );
      const order = (await db.query("SELECT * FROM work_orders WHERE id='w'"))[0];
      assert.equal(order.title, 'Old');
      assert.equal(order.space_id, null);
      assert.equal(order.reservation_status, null);
      assert.equal((await db.query('SELECT active FROM maintenance'))?.length, 0);
      assert.equal((await db.query("SELECT user_id FROM sessions WHERE id='old'"))[0].user_id, null);
      assert.equal((await db.query('SELECT COUNT(*) AS n FROM schema_migrations'))[0].n, migrations.length);
    } finally {
      await db.close();
    }
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
});

test('a failing migration rolls back and is retried on the next start', async () => {
  const db = await openDatabase(null, ':memory:');
  try {
    const broken = [
      ...migrations,
      {
        id: 999,
        name: 'broken',
        async up(q) {
          await q('CREATE TABLE half_done (id TEXT)');
          await q('SELECT * FROM missing_table');
        },
      },
    ];
    await assert.rejects(migrate(db, broken), /Database migration 999 \(broken\) failed/);
    assert.equal(
      (await db.query("SELECT name FROM sqlite_master WHERE name='half_done'")).length,
      0,
      'partial changes are rolled back',
    );
    assert.equal((await db.query('SELECT * FROM schema_migrations WHERE id=999')).length, 0);
    const fixed = [
      ...migrations,
      {
        id: 999,
        name: 'fixed',
        async up(q) {
          await q('CREATE TABLE half_done (id TEXT)');
        },
      },
    ];
    await migrate(db, fixed);
    assert.equal((await db.query('SELECT name FROM schema_migrations WHERE id=999'))[0].name, 'fixed');
  } finally {
    await db.close();
  }
});

test('transactions roll back together and serialize on SQLite', async () => {
  const db = await openDatabase(null, ':memory:');
  try {
    await assert.rejects(
      db.transaction(async tx => {
        await tx.query("INSERT INTO buildings(id,name,address,created_at) VALUES('t','T','','x')");
        throw new Error('stop');
      }),
      /stop/,
    );
    assert.equal((await db.query("SELECT * FROM buildings WHERE id='t'")).length, 0);
    const order = [];
    await Promise.all([
      db.transaction(async tx => {
        order.push('a1');
        await new Promise(r => setTimeout(r, 20));
        await tx.query('SELECT 1');
        order.push('a2');
      }),
      db.transaction(async () => {
        order.push('b1');
      }),
      db.query('SELECT 1').then(() => order.push('q')),
    ]);
    assert.deepEqual(order, ['a1', 'a2', 'b1', 'q']);
  } finally {
    await db.close();
  }
});
