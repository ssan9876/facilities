import {randomUUID} from 'node:crypto';
import {error, text, bool, manager, optionalInteger} from './validation.js';
import {audit, changes} from './audit.js';
import {moduleSettings} from './requests.js';

const blocking = "('pending','approved')";
const clock = v => v.slice(11);
const describe = (c, timezone) =>
  `${c.starts_at.slice(0, 10)} ${clock(c.starts_at)}–${c.ends_at.slice(0, 10) === c.starts_at.slice(0, 10) ? clock(c.ends_at) : c.ends_at.replace('T', ' ')} (${timezone})`;

// Must run inside a transaction. PostgreSQL locks the space row so concurrent bookings serialize;
// SQLite transactions are already serialized by the database wrapper.
export async function reserveSpace(tx, {spaceId, buildingId, starts, ends, excludeId = null, timezone}) {
  if (!spaceId) return {space_id: null, reservation_status: null};
  const space = (
    await tx.query(
      `SELECT * FROM spaces WHERE id=$1 AND archived_at IS NULL${tx.dialect === 'postgres' ? ' FOR UPDATE' : ''}`,
      [spaceId],
    )
  )[0];
  if (!space) throw error('Choose an available space.');
  if (space.building_id !== buildingId) throw error('The space must belong to the selected building.');
  const conflict = (
    await tx.query(
      `SELECT id,starts_at,ends_at FROM work_orders WHERE space_id=$1 AND reservation_status IN ${blocking} AND starts_at<$3 AND ends_at>$2 AND id<>$4 ORDER BY starts_at LIMIT 1`,
      [spaceId, starts, ends, excludeId || ''],
    )
  )[0];
  if (conflict)
    throw error(
      `${space.name} is already reserved ${describe(conflict, timezone)}. Choose another time or space.`,
      409,
    );
  return {space_id: space.id, reservation_status: space.requires_approval ? 'pending' : 'approved', space};
}

export function setupSpaces(app, db, env, {notify}) {
  const timezone = env.ORG_TIMEZONE || 'America/Phoenix';
  const requireSchedule = async () => {
    if (!(await moduleSettings(db)).schedule)
      throw error('Schedule requests are disabled. Contact your administrator.', 403);
  };
  const read = async id => {
    const s = (await db.query('SELECT * FROM spaces WHERE id=$1', [id]))[0];
    if (!s) throw error('Space not found.', 404);
    return s;
  };
  const fields = async (body = {}, existing) => {
    // Updates may send only the fields that change; creation validates every field.
    const pick = (key, parse) => (existing && body[key] === undefined ? existing[key] : parse());
    const building = pick('building_id', () => text(body, 'building_id'));
    if (
      building !== existing?.building_id &&
      !(await db.query('SELECT id FROM buildings WHERE id=$1 AND archived_at IS NULL', [building])).length
    )
      throw error('Choose an existing building.');
    return {
      name: pick('name', () => text(body, 'name', 120)),
      building_id: building,
      capacity: pick('capacity', () => optionalInteger(body.capacity, 'Capacity', 1, 100000)),
      requires_approval: pick('requires_approval', () => Number(bool(body.requires_approval))),
    };
  };
  app.post('/api/spaces', manager, async (req, res) => {
    await requireSchedule();
    const row = {id: randomUUID(), ...(await fields(req.body, null)), created_at: new Date().toISOString()};
    await db.query(
      'INSERT INTO spaces(id,building_id,name,capacity,requires_approval,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [row.id, row.building_id, row.name, row.capacity, row.requires_approval, row.created_at],
    );
    await audit(db, req.user, 'space.create', 'space', row.id, `Added space ${row.name}`);
    res.status(201).json(row);
  });
  app.patch('/api/spaces/:id', manager, async (req, res) => {
    const existing = await read(req.params.id),
      next = await fields(req.body, existing);
    if (
      next.building_id !== existing.building_id &&
      (await db.query('SELECT id FROM work_orders WHERE space_id=$1 LIMIT 1', [existing.id])).length
    )
      throw error(
        'This space has reservations, so it cannot move to another building. Archive it and add a new space instead.',
        409,
      );
    const archived =
      req.body.archived === undefined
        ? existing.archived_at
        : bool(req.body.archived)
          ? existing.archived_at || new Date().toISOString()
          : null;
    await db.query(
      'UPDATE spaces SET name=$1,building_id=$2,capacity=$3,requires_approval=$4,archived_at=$5 WHERE id=$6',
      [next.name, next.building_id, next.capacity, next.requires_approval, archived, existing.id],
    );
    await audit(
      db,
      req.user,
      archived && !existing.archived_at
        ? 'space.archive'
        : !archived && existing.archived_at
          ? 'space.restore'
          : 'space.update',
      'space',
      existing.id,
      `Updated space ${next.name}`,
      changes(existing, {...next, archived_at: archived}, [
        'name',
        'building_id',
        'capacity',
        'requires_approval',
        'archived_at',
      ]),
    );
    res.json({ok: true});
  });
  app.delete('/api/spaces/:id', manager, async (req, res) => {
    const existing = await read(req.params.id);
    if ((await db.query('SELECT id FROM work_orders WHERE space_id=$1 LIMIT 1', [existing.id])).length)
      throw error('This space has reservations. Archive it to keep their history.', 409);
    await db.query('DELETE FROM spaces WHERE id=$1', [existing.id]);
    await audit(db, req.user, 'space.delete', 'space', existing.id, `Deleted space ${existing.name}`);
    res.json({ok: true});
  });
  // Availability for the request form. Requesters see busy times without other people's titles.
  app.get('/api/spaces/:id/bookings', async (req, res) => {
    await requireSchedule();
    await read(req.params.id);
    const day = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw error('Choose a date.');
    const rows = await db.query(
      `SELECT id,title,starts_at,ends_at,reservation_status FROM work_orders WHERE space_id=$1 AND reservation_status IN ${blocking} AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at`,
      [req.params.id, day + 'T00:00', day + 'T23:59'],
    );
    res.json(
      rows.map(r =>
        req.user.role === 'requester'
          ? {starts_at: r.starts_at, ends_at: r.ends_at, reservation_status: r.reservation_status}
          : r,
      ),
    );
  });
  app.post('/api/orders/:id/reservation', async (req, res) => {
    const decision = req.body?.decision;
    if (!['approved', 'declined', 'cancelled'].includes(decision)) throw error('Choose approve, decline or cancel.');
    const result = await db.transaction(async tx => {
      const order = (await tx.query('SELECT * FROM work_orders WHERE id=$1', [req.params.id]))[0];
      if (!order || (req.user.role === 'requester' && order.requester_id !== req.user.id))
        throw error('Work order not found.', 404);
      if (!order.space_id) throw error('This request does not reserve a space.');
      const managerial = ['admin', 'manager'].includes(req.user.role);
      if (decision === 'cancelled' ? !(managerial || order.requester_id === req.user.id) : !managerial)
        throw error(
          decision === 'cancelled'
            ? 'Only the requester or a manager can cancel this reservation.'
            : 'A manager must approve or decline reservations.',
          403,
        );
      if (decision === 'approved')
        await reserveSpace(tx, {
          spaceId: order.space_id,
          buildingId: order.building_id,
          starts: order.starts_at,
          ends: order.ends_at,
          excludeId: order.id,
          timezone,
        });
      await tx.query('UPDATE work_orders SET reservation_status=$1,updated_at=$2 WHERE id=$3', [
        decision,
        new Date().toISOString(),
        order.id,
      ]);
      await audit(tx, req.user, 'reservation.' + decision, 'work_order', order.id, `Reservation ${decision}`, {
        reservation_status: [order.reservation_status, decision],
      });
      return order;
    });
    await notify(
      db,
      result,
      'status',
      [result.requester_id, result.assignee_id],
      req.user.id,
      `${req.user.name} ${decision === 'approved' ? 'approved' : decision === 'declined' ? 'declined' : 'cancelled'} the space reservation.`,
    );
    res.json({ok: true, reservation_status: decision});
  });
}
