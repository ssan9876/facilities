import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import pg from 'pg';
import {migrate} from './migrations.js';

// Both drivers expose query(sql, $n-values), transaction(fn) and close(). Code running inside
// transaction(fn) must use the tx argument; the SQLite plain query waits for open transactions.
export async function openDatabase(
  url = process.env.DATABASE_URL,
  file = process.env.SQLITE_PATH || 'data/facilities.db',
) {
  let db;
  if (url) {
    const pool = new pg.Pool({connectionString: url});
    const runner =
      client =>
      async (sql, values = []) =>
        (await client.query(sql, values)).rows;
    db = {
      dialect: 'postgres',
      query: runner(pool),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({dialect: 'postgres', query: runner(client)});
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      async session(fn) {
        const client = await pool.connect();
        try {
          return await fn({dialect: 'postgres', query: runner(client)});
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    if (file !== ':memory:') mkdirSync('data', {recursive: true});
    const sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const run = (sql, values = []) => {
      const params = [];
      const converted = sql.replace(/\$(\d+)/g, (_, n) => {
        params.push(values[Number(n) - 1]);
        return '?';
      });
      const stmt = sqlite.prepare(converted);
      return stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []);
    };
    // One connection: serialize transactions and hold plain queries until the open one finishes.
    let lock = Promise.resolve();
    db = {
      dialect: 'sqlite',
      query: async (sql, values) => {
        await lock;
        return run(sql, values);
      },
      async transaction(fn) {
        const previous = lock;
        let release;
        lock = new Promise(resolve => (release = resolve));
        await previous;
        try {
          run('BEGIN IMMEDIATE');
          const result = await fn({dialect: 'sqlite', query: async (sql, values) => run(sql, values)});
          run('COMMIT');
          return result;
        } catch (err) {
          try {
            run('ROLLBACK');
          } catch {
            /* already closed */
          }
          throw err;
        } finally {
          release();
        }
      },
      session: fn => fn({dialect: 'sqlite', query: async (sql, values) => run(sql, values)}),
      close: async () => {
        await lock;
        sqlite.close();
      },
    };
  }
  await migrate(db);
  return db;
}
