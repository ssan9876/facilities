import {randomUUID} from 'node:crypto';
import {error, text, date, integer, bool} from './validation.js';
import {requireCap} from './permissions.js';

const records = requireCap('records.manage', 'Your role cannot manage buildings and assets.');
const plans = requireCap('maintenance.manage', 'Your role cannot manage maintenance plans.');
import {requireModule} from './requests.js';
import {audit, changes} from './audit.js';

// Records referenced by work history are archived rather than deleted; deletion is for mistakes.
const references = {
  building: [
    ['assets', 'building_id', 'assets'],
    ['work_orders', 'building_id', 'requests'],
    ['maintenance', 'building_id', 'maintenance plans'],
    ['spaces', 'building_id', 'spaces'],
    ['parts', 'building_id', 'parts'],
  ],
  asset: [
    ['work_orders', 'asset_id', 'requests'],
    ['maintenance', 'asset_id', 'maintenance plans'],
  ],
};
async function blockers(db, kind, id) {
  const found = [];
  for (const [table, column, label] of references[kind])
    if ((await db.query(`SELECT 1 AS found FROM ${table} WHERE ${column}=$1 LIMIT 1`, [id])).length) found.push(label);
  return found;
}
const archivedValue = (body, existing) =>
  body.archived === undefined
    ? existing.archived_at
    : bool(body.archived)
      ? existing.archived_at || new Date().toISOString()
      : null;
const lifecycle = (existing, archived) =>
  archived && !existing.archived_at ? 'archive' : !archived && existing.archived_at ? 'restore' : 'update';

export function setupRecords(app, db, {checkLocation}) {
  const q = db.query;
  const find = async (table, id, label) => {
    const row = (await q(`SELECT * FROM ${table} WHERE id=$1`, [id]))[0];
    if (!row) throw error(`${label} not found.`, 404);
    return row;
  };
  const pick = (body, existing, key, parse) => (body[key] === undefined ? existing[key] : parse());

  app.post('/api/buildings', records, async (req, res) => {
    const row = {
      id: randomUUID(),
      name: text(req.body, 'name'),
      address: text(req.body, 'address', 500, true),
      created_at: new Date().toISOString(),
    };
    await q('INSERT INTO buildings(id,name,address,created_at) VALUES($1,$2,$3,$4)', Object.values(row));
    await audit(db, req.user, 'building.create', 'building', row.id, `Added building ${row.name}`);
    res.status(201).json(row);
  });
  app.patch('/api/buildings/:id', records, async (req, res) => {
    const existing = await find('buildings', req.params.id, 'Building'),
      body = req.body || {};
    const next = {
      name: pick(body, existing, 'name', () => text(body, 'name')),
      address: pick(body, existing, 'address', () => text(body, 'address', 500, true)),
      archived_at: archivedValue(body, existing),
    };
    await q('UPDATE buildings SET name=$1,address=$2,archived_at=$3 WHERE id=$4', [
      next.name,
      next.address,
      next.archived_at,
      existing.id,
    ]);
    const action = lifecycle(existing, next.archived_at);
    await audit(
      db,
      req.user,
      'building.' + action,
      'building',
      existing.id,
      `${action === 'update' ? 'Updated' : action === 'archive' ? 'Archived' : 'Restored'} building ${next.name}`,
      changes(existing, next, ['name', 'address', 'archived_at']),
    );
    res.json({ok: true});
  });
  app.delete('/api/buildings/:id', records, async (req, res) => {
    const existing = await find('buildings', req.params.id, 'Building'),
      used = await blockers(db, 'building', existing.id);
    if (used.length)
      throw error(`${existing.name} still has ${used.join(', ')}. Archive it instead to keep that history.`, 409);
    await q('DELETE FROM buildings WHERE id=$1', [existing.id]);
    await audit(db, req.user, 'building.delete', 'building', existing.id, `Deleted building ${existing.name}`, {
      name: [existing.name, null],
      address: [existing.address, null],
    });
    res.json({ok: true});
  });

  app.post('/api/assets', records, async (req, res) => {
    const row = {
      id: randomUUID(),
      name: text(req.body, 'name'),
      building_id: text(req.body, 'building_id'),
      category: text(req.body, 'category'),
      serial: text(req.body, 'serial', 200, true),
      created_at: new Date().toISOString(),
    };
    await checkLocation(db, row.building_id);
    await q(
      'INSERT INTO assets(id,name,building_id,category,serial,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      Object.values(row),
    );
    await audit(db, req.user, 'asset.create', 'asset', row.id, `Added asset ${row.name}`);
    res.status(201).json(row);
  });
  app.patch('/api/assets/:id', records, async (req, res) => {
    const existing = await find('assets', req.params.id, 'Asset'),
      body = req.body || {};
    const next = {
      name: pick(body, existing, 'name', () => text(body, 'name')),
      category: pick(body, existing, 'category', () => text(body, 'category')),
      serial: pick(body, existing, 'serial', () => text(body, 'serial', 200, true)),
      building_id: pick(body, existing, 'building_id', () => text(body, 'building_id')),
      archived_at: archivedValue(body, existing),
    };
    if (next.building_id !== existing.building_id) {
      await checkLocation(db, next.building_id);
      // Moving would leave requests and plans pointing at an asset in a different building.
      if ((await blockers(db, 'asset', existing.id)).length)
        throw error(
          'This asset has requests or maintenance plans, so it cannot move buildings. Archive it and register it again in the new building.',
          409,
        );
    }
    await q('UPDATE assets SET name=$1,category=$2,serial=$3,building_id=$4,archived_at=$5 WHERE id=$6', [
      next.name,
      next.category,
      next.serial,
      next.building_id,
      next.archived_at,
      existing.id,
    ]);
    const action = lifecycle(existing, next.archived_at);
    await audit(
      db,
      req.user,
      'asset.' + action,
      'asset',
      existing.id,
      `${action === 'update' ? 'Updated' : action === 'archive' ? 'Archived' : 'Restored'} asset ${next.name}`,
      changes(existing, next, ['name', 'category', 'serial', 'building_id', 'archived_at']),
    );
    res.json({ok: true});
  });
  app.delete('/api/assets/:id', records, async (req, res) => {
    const existing = await find('assets', req.params.id, 'Asset'),
      used = await blockers(db, 'asset', existing.id);
    if (used.length)
      throw error(`${existing.name} still has ${used.join(', ')}. Archive it instead to keep that history.`, 409);
    await q('DELETE FROM assets WHERE id=$1', [existing.id]);
    await audit(db, req.user, 'asset.delete', 'asset', existing.id, `Deleted asset ${existing.name}`, {
      name: [existing.name, null],
      serial: [existing.serial, null],
    });
    res.json({ok: true});
  });

  const planFields = async (body, existing) => {
    const value = (key, parse) => (existing ? pick(body, existing, key, parse) : parse());
    const next = {
      title: value('title', () => text(body, 'title')),
      building_id: value('building_id', () => text(body, 'building_id')),
      asset_id: value('asset_id', () => text(body, 'asset_id', 200, true) || null),
      interval_days: value('interval_days', () => integer(body.interval_days, 'Interval', 1, 3650)),
      next_due: value('next_due', () => date(body.next_due)),
      active: value('active', () => Number(body.active === undefined ? true : bool(body.active))),
    };
    if (
      existing &&
      body.building_id !== undefined &&
      body.asset_id === undefined &&
      next.building_id !== existing.building_id
    )
      next.asset_id = null;
    if (!existing || next.building_id !== existing.building_id || next.asset_id !== existing.asset_id)
      await checkLocation(db, next.building_id, next.asset_id);
    return next;
  };
  app.post('/api/maintenance', plans, async (req, res) => {
    await requireModule(db, 'maintenance');
    const next = await planFields(req.body || {}, null),
      id = randomUUID();
    await q(
      'INSERT INTO maintenance(id,title,building_id,asset_id,interval_days,next_due,created_by,created_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        next.title,
        next.building_id,
        next.asset_id,
        next.interval_days,
        next.next_due,
        req.user.id,
        new Date().toISOString(),
        next.active,
      ],
    );
    await audit(db, req.user, 'maintenance.create', 'maintenance', id, `Created maintenance plan ${next.title}`);
    res.status(201).json({id});
  });
  app.patch('/api/maintenance/:id', plans, async (req, res) => {
    await requireModule(db, 'maintenance');
    const existing = await find('maintenance', req.params.id, 'Maintenance plan'),
      next = await planFields(req.body || {}, existing);
    await q(
      'UPDATE maintenance SET title=$1,building_id=$2,asset_id=$3,interval_days=$4,next_due=$5,active=$6 WHERE id=$7',
      [next.title, next.building_id, next.asset_id, next.interval_days, next.next_due, next.active, existing.id],
    );
    const diff = changes(existing, next, ['title', 'building_id', 'asset_id', 'interval_days', 'next_due', 'active']);
    await audit(
      db,
      req.user,
      'maintenance.' + ('active' in diff ? (next.active ? 'resume' : 'pause') : 'update'),
      'maintenance',
      existing.id,
      `${'active' in diff ? (next.active ? 'Resumed' : 'Paused') : 'Updated'} maintenance plan ${next.title}`,
      diff,
    );
    res.json({ok: true});
  });
  app.delete('/api/maintenance/:id', plans, async (req, res) => {
    await requireModule(db, 'maintenance');
    const existing = await find('maintenance', req.params.id, 'Maintenance plan');
    // Generated requests stay in the register; only the plan and its occurrence ledger are removed.
    await db.transaction(async tx => {
      await tx.query('DELETE FROM maintenance_runs WHERE plan_id=$1', [existing.id]);
      await tx.query('DELETE FROM maintenance WHERE id=$1', [existing.id]);
      await audit(
        tx,
        req.user,
        'maintenance.delete',
        'maintenance',
        existing.id,
        `Deleted maintenance plan ${existing.title}`,
        {title: [existing.title, null], interval_days: [existing.interval_days, null]},
      );
    });
    res.json({ok: true});
  });
}
