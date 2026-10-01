// CSV import for setting up a workspace: buildings, assets, parts and people. Every row is checked first
// (Preview); Import then creates the valid rows and reports the rest. Columns are matched by header name.
import {randomUUID} from 'node:crypto';
import express from 'express';
import {audit} from './audit.js';
import {error} from './validation.js';
import {can} from './permissions.js';
import {saveProvisionedUser} from './administration.js';

const maxRows = 2000;

// RFC 4180: commas, quoted fields with "" escapes, CRLF or LF line ends.
export function parseCsv(input) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  const text = String(input).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// [column, required, help]
export const importKinds = {
  buildings: {
    cap: 'records.manage',
    label: 'Buildings',
    columns: [
      ['name', true, 'Building name'],
      ['address', false, 'Street address'],
    ],
  },
  assets: {
    cap: 'records.manage',
    label: 'Assets',
    columns: [
      ['name', true, 'Asset name'],
      ['building', true, 'Building name (must exist or be in the same import)'],
      ['category', false, 'For example HVAC, Plumbing'],
      ['serial', false, 'Serial or tag number'],
    ],
  },
  parts: {
    cap: 'inventory.manage',
    label: 'Parts',
    columns: [
      ['name', true, 'Part name'],
      ['sku', false, 'Part number'],
      ['building', false, 'Building where it is stocked'],
      ['location', false, 'Shelf or room'],
      ['quantity', false, 'On hand (whole number)'],
      ['reorder_at', false, 'Reorder when at or below'],
      ['unit_cost', false, 'Cost per unit, for example 12.50'],
    ],
  },
  people: {
    cap: 'admin.people',
    label: 'People',
    columns: [
      ['name', true, 'Display name'],
      ['oidc_subject', true, 'Immutable SSO subject (user ID at the identity provider)'],
      ['email', false, 'Email address'],
      ['role', false, 'Role id or name (default: requester)'],
    ],
  },
};

export function templateCsv(kind) {
  const k = importKinds[kind];
  return k.columns.map(c => c[0]).join(',') + '\r\n';
}

export function setupImport(app, db, env) {
  const kindFor = req => {
    const k = importKinds[req.params.kind];
    if (!k) throw error('Choose buildings, assets, parts or people.', 404);
    if (!can(req.user, k.cap)) throw error(`Your role cannot import ${k.label.toLowerCase()}.`, 403);
    return k;
  };
  app.get('/api/import/:kind/template.csv', (req, res) => {
    kindFor(req);
    res.attachment(`${req.params.kind}-template.csv`).type('text/csv').send(templateCsv(req.params.kind));
  });
  app.post('/api/import/:kind', express.json({limit: '5mb'}), async (req, res) => {
    const kind = req.params.kind,
      k = kindFor(req);
    const table = parseCsv(req.body?.csv || '');
    if (!table.length) throw error('The file is empty.');
    const header = table[0].map(h =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
    );
    const missing = k.columns.filter(([c, required]) => required && !header.includes(c)).map(c => c[0]);
    if (missing.length)
      throw error(`Add the column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} to the first row.`);
    const body = table.slice(1);
    if (body.length > maxRows) throw error(`Import at most ${maxRows} rows at a time.`);
    const apply = req.body?.apply === true;
    const [buildings, assets, parts, roles] = await Promise.all([
      db.query('SELECT id,name FROM buildings WHERE archived_at IS NULL'),
      db.query('SELECT name,building_id FROM assets WHERE archived_at IS NULL'),
      db.query('SELECT name,sku FROM parts WHERE archived_at IS NULL'),
      Promise.resolve(Object.values(db.roles)),
    ]);
    const buildingByName = new Map(buildings.map(b => [b.name.toLowerCase(), b.id]));
    const seen = new Set();
    const results = [];
    let created = 0;
    for (const [n, cells] of body.entries()) {
      const line = n + 2;
      const row = Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
      const values = Object.fromEntries(k.columns.map(([c]) => [c, row[c] ?? '']));
      let problem = null;
      for (const [c, required] of k.columns) if (required && !values[c]) problem ||= `${c} is required`;
      const long = k.columns.find(([c]) => values[c].length > 200);
      if (long) problem ||= `${long[0]} must be under 200 characters`;
      const key = `${values.name.toLowerCase()}|${(values.building || values.sku || '').toLowerCase()}`;
      if (!problem && seen.has(key)) problem = 'duplicate row in this file';
      seen.add(key);
      const number = (v, label, {decimal = false} = {}) => {
        if (v === '') return null;
        const x = Number(v.replace(/[$,]/g, ''));
        if (!Number.isFinite(x) || x < 0 || (!decimal && !Number.isInteger(x)))
          problem ||= `${label} must be a ${decimal ? 'number' : 'whole number'}`;
        return x;
      };
      let action = null;
      if (!problem && kind === 'buildings') {
        if (buildingByName.has(values.name.toLowerCase())) problem = 'a building with this name already exists';
        else
          action = async () => {
            const id = randomUUID();
            await db.query('INSERT INTO buildings(id,name,address,created_at) VALUES($1,$2,$3,$4)', [
              id,
              values.name,
              values.address,
              new Date().toISOString(),
            ]);
            buildingByName.set(values.name.toLowerCase(), id);
          };
      }
      if (!problem && kind === 'assets') {
        const lookup = () => buildingByName.get(values.building.toLowerCase());
        if (!lookup()) problem = `no building named “${values.building}”`;
        if (
          !problem &&
          assets.some(a => a.name.toLowerCase() === values.name.toLowerCase() && a.building_id === lookup())
        )
          problem = 'this asset already exists in that building';
        if (!problem)
          action = async () =>
            db.query('INSERT INTO assets(id,name,building_id,category,serial,created_at) VALUES($1,$2,$3,$4,$5,$6)', [
              randomUUID(),
              values.name,
              lookup(),
              values.category,
              values.serial,
              new Date().toISOString(),
            ]);
      }
      if (!problem && kind === 'parts') {
        const quantity = number(values.quantity, 'quantity') ?? 0,
          reorder = number(values.reorder_at, 'reorder_at') ?? 0,
          cost = number(values.unit_cost, 'unit_cost', {decimal: true});
        const building = values.building ? buildingByName.get(values.building.toLowerCase()) : null;
        if (values.building && !building) problem ||= `no building named “${values.building}”`;
        if (!problem && parts.some(p => p.name.toLowerCase() === values.name.toLowerCase() && p.sku === values.sku))
          problem = 'this part already exists';
        if (!problem)
          action = async () =>
            db.query(
              'INSERT INTO parts(id,name,sku,building_id,location,quantity,min_quantity,unit_cost_cents,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
              [
                randomUUID(),
                values.name,
                values.sku,
                building,
                values.location,
                quantity,
                reorder,
                cost == null ? null : Math.round(cost * 100),
                new Date().toISOString(),
              ],
            );
      }
      if (!problem && kind === 'people') {
        const role =
          roles.find(r => r.id === values.role || r.name.toLowerCase() === values.role.toLowerCase())?.id ||
          (values.role ? null : 'requester');
        if (!role || role === 'admin')
          problem = `choose an existing role other than administrator for “${values.role}”`;
        else
          action = async () =>
            saveProvisionedUser(
              db,
              env,
              {name: values.name, email: values.email, oidc_subject: values.oidc_subject, role},
              undefined,
              req.user,
            );
      }
      if (apply && action && !problem)
        try {
          await action();
          created++;
        } catch (err) {
          problem = err.message.replace(/\.$/, '');
        }
      results.push({line, values, error: problem});
    }
    if (apply && created)
      await audit(
        db,
        req.user,
        'import.' + kind,
        'settings',
        kind,
        `Imported ${created} ${k.label.toLowerCase()} from CSV`,
      );
    res.json({
      rows: results,
      created,
      valid: results.filter(r => !r.error).length,
      invalid: results.filter(r => r.error).length,
    });
  });
}
