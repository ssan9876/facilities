import {randomUUID} from 'node:crypto';
import {error, text, integer, bool, manager, staff, canManage} from './validation.js';
import {requireFeature} from './requests.js';
import {audit, changes} from './audit.js';

const cents = value => {
  if (value == null || value === '') return null;
  const s = String(value).trim().replace(/^\$/, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw error('Enter a unit cost such as 12.50.');
  return Math.round(Number(s) * 100);
};
export const listParts = db =>
  db.query('SELECT p.*,b.name AS building FROM parts p LEFT JOIN buildings b ON b.id=p.building_id ORDER BY p.name');

export function setupInventory(app, db, {accessibleOrder}) {
  const q = db.query;
  const enabled = () => requireFeature(db, 'inventory', 'Inventory');
  const find = async id => {
    const p = (await q('SELECT * FROM parts WHERE id=$1', [id]))[0];
    if (!p) throw error('Part not found.', 404);
    return p;
  };
  const fields = async (body, existing) => {
    const pick = (key, parse) => (existing && body[key] === undefined ? existing[key] : parse());
    const building = pick('building_id', () => text(body, 'building_id', 200, true) || null);
    if (
      building &&
      building !== existing?.building_id &&
      !(await q('SELECT id FROM buildings WHERE id=$1 AND archived_at IS NULL', [building])).length
    )
      throw error('Choose an existing building.');
    return {
      name: pick('name', () => text(body, 'name')),
      sku: pick('sku', () => text(body, 'sku', 100, true)),
      building_id: building,
      location: pick('location', () => text(body, 'location', 200, true)),
      min_quantity: pick('min_quantity', () =>
        body.min_quantity == null || body.min_quantity === ''
          ? 0
          : integer(body.min_quantity, 'Reorder level', 0, 1000000),
      ),
      unit_cost_cents: pick('unit_cost_cents', () => cents(body.unit_cost)),
    };
  };
  app.get('/api/parts', staff, async (req, res) => {
    await enabled();
    res.json(await listParts(db));
  });
  app.post('/api/parts', manager, async (req, res) => {
    await enabled();
    const body = req.body || {},
      row = {
        id: randomUUID(),
        ...(await fields(body, null)),
        quantity:
          body.quantity == null || body.quantity === '' ? 0 : integer(body.quantity, 'Quantity on hand', 0, 1000000),
        created_at: new Date().toISOString(),
      };
    await q(
      'INSERT INTO parts(id,name,sku,building_id,location,quantity,min_quantity,unit_cost_cents,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        row.id,
        row.name,
        row.sku,
        row.building_id,
        row.location,
        row.quantity,
        row.min_quantity,
        row.unit_cost_cents,
        row.created_at,
      ],
    );
    await audit(db, req.user, 'part.create', 'part', row.id, `Added part ${row.name} with ${row.quantity} on hand`);
    res.status(201).json(row);
  });
  app.patch('/api/parts/:id', manager, async (req, res) => {
    await enabled();
    const existing = await find(req.params.id),
      body = req.body || {};
    if ('quantity' in body) throw error('Use a stock adjustment to change the quantity on hand.');
    const next = await fields(body, existing);
    next.archived_at =
      body.archived === undefined
        ? existing.archived_at
        : bool(body.archived)
          ? existing.archived_at || new Date().toISOString()
          : null;
    await q(
      'UPDATE parts SET name=$1,sku=$2,building_id=$3,location=$4,min_quantity=$5,unit_cost_cents=$6,archived_at=$7 WHERE id=$8',
      [
        next.name,
        next.sku,
        next.building_id,
        next.location,
        next.min_quantity,
        next.unit_cost_cents,
        next.archived_at,
        existing.id,
      ],
    );
    await audit(
      db,
      req.user,
      'part.update',
      'part',
      existing.id,
      `Updated part ${next.name}`,
      changes(existing, next, [
        'name',
        'sku',
        'building_id',
        'location',
        'min_quantity',
        'unit_cost_cents',
        'archived_at',
      ]),
    );
    res.json({ok: true});
  });
  app.post('/api/parts/:id/adjust', manager, async (req, res) => {
    await enabled();
    const delta = integer(req.body?.delta, 'Adjustment', -1000000, 1000000);
    if (!delta) throw error('Enter a non-zero adjustment.');
    const reason = text(req.body, 'reason', 200, true) || (delta > 0 ? 'Restock' : 'Correction');
    const part = await find(req.params.id);
    const updated = await q('UPDATE parts SET quantity=quantity+$1 WHERE id=$2 AND quantity+$1>=0 RETURNING quantity', [
      delta,
      part.id,
    ]);
    if (!updated.length) throw error(`Only ${part.quantity} on hand; the adjustment would make stock negative.`, 409);
    await audit(
      db,
      req.user,
      'part.adjust',
      'part',
      part.id,
      `${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} × ${part.name} (${reason})`,
      {quantity: [part.quantity, Number(updated[0].quantity)], reason: [null, reason]},
    );
    res.json({quantity: Number(updated[0].quantity)});
  });
  app.delete('/api/parts/:id', manager, async (req, res) => {
    await enabled();
    const part = await find(req.params.id);
    if ((await q('SELECT id FROM part_usage WHERE part_id=$1 LIMIT 1', [part.id])).length)
      throw error(`${part.name} has been used on requests. Archive it instead to keep that history.`, 409);
    await q('DELETE FROM parts WHERE id=$1', [part.id]);
    await audit(db, req.user, 'part.delete', 'part', part.id, `Deleted part ${part.name}`, {
      name: [part.name, null],
      quantity: [part.quantity, null],
    });
    res.json({ok: true});
  });

  const canRecord = (req, order) =>
    canManage(req.user) || (req.user.role === 'technician' && order.assignee_id === req.user.id);
  app.post('/api/orders/:id/parts', async (req, res) => {
    await enabled();
    const order = await accessibleOrder(req);
    if (!canRecord(req, order)) throw error('Only managers or the assigned technician can record parts.', 403);
    const quantity = integer(req.body?.quantity, 'Quantity', 1, 100000),
      part = await find(text(req.body, 'part_id'));
    if (part.archived_at) throw error('This part is archived.');
    const result = await db.transaction(async tx => {
      // The conditional decrement keeps concurrent usage from overdrawing stock.
      const updated = await tx.query(
        'UPDATE parts SET quantity=quantity-$1 WHERE id=$2 AND quantity>=$1 RETURNING quantity',
        [quantity, part.id],
      );
      if (!updated.length)
        throw error(
          `Only ${(await tx.query('SELECT quantity FROM parts WHERE id=$1', [part.id]))[0].quantity} × ${part.name} on hand.`,
          409,
        );
      const id = randomUUID();
      await tx.query(
        'INSERT INTO part_usage(id,part_id,work_order_id,quantity,user_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [id, part.id, order.id, quantity, req.user.id, new Date().toISOString()],
      );
      await audit(tx, req.user, 'part.use', 'work_order', order.id, `Used ${quantity} × ${part.name}`, {
        part: [null, part.name],
        quantity: [null, quantity],
      });
      return {id, remaining: Number(updated[0].quantity)};
    });
    res.status(201).json({...result, low: result.remaining <= part.min_quantity});
  });
  app.delete('/api/orders/:id/parts/:usage', async (req, res) => {
    await enabled();
    const order = await accessibleOrder(req);
    if (!canRecord(req, order)) throw error('Only managers or the assigned technician can change parts.', 403);
    await db.transaction(async tx => {
      const usage = (
        await tx.query(
          'SELECT u.*,p.name FROM part_usage u JOIN parts p ON p.id=u.part_id WHERE u.id=$1 AND u.work_order_id=$2',
          [req.params.usage, order.id],
        )
      )[0];
      if (!usage) throw error('Part usage not found.', 404);
      await tx.query('DELETE FROM part_usage WHERE id=$1', [usage.id]);
      await tx.query('UPDATE parts SET quantity=quantity+$1 WHERE id=$2', [usage.quantity, usage.part_id]);
      await audit(
        tx,
        req.user,
        'part.return',
        'work_order',
        order.id,
        `Returned ${usage.quantity} × ${usage.name} to stock`,
        {part: [usage.name, null], quantity: [usage.quantity, null]},
      );
    });
    res.json({ok: true});
  });
}
