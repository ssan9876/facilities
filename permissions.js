// What each role can do. Edit this file to change the defaults for the built-in roles or to add
// capabilities; administrators can override built-in roles and create custom roles in
// Settings → Roles, which is stored in the database and audited.
//
// Every API check asks for a capability (can(user, 'requests.assign')), never for a role name.
// The administrator role always has every capability so the workspace can't lock itself out.

import {randomUUID} from 'node:crypto';

// [id, group, label, description]
export const capabilityCatalog = [
  ['requests.view_all', 'Requests', 'See every request', 'Without it, people see only the requests they submitted.'],
  [
    'requests.edit_any',
    'Requests',
    'Edit any request',
    'Change title, place, priority and dates at any stage. Everyone can edit their own request while it is Open.',
  ],
  [
    'requests.edit_assigned',
    'Requests',
    'Edit the text of work assigned to them',
    'Change the title and description of requests assigned to them.',
  ],
  [
    'requests.update_assigned',
    'Requests',
    'Update work assigned to them',
    'Stamp status and record parts on requests assigned to them.',
  ],
  ['requests.update_any', 'Requests', 'Update any request', 'Stamp the status of any request.'],
  ['requests.assign', 'Requests', 'Assign work', 'Choose who a request is assigned to.'],
  ['requests.assignable', 'Requests', 'Can be assigned work', 'Appears in the "Assigned to" list.'],
  ['requests.delete', 'Requests', 'Delete requests', 'Permanently remove a request; the audit log keeps a record.'],
  ['requests.notified', 'Requests', 'Notified of new requests', 'Receives a notification for every new request.'],
  [
    'requests.moderate',
    'Requests',
    'Remove others’ comments and files',
    'Delete comments and attachments added by other people.',
  ],
  [
    'reservations.approve',
    'Requests',
    'Approve space reservations',
    'Approve or decline reservations for spaces that need approval.',
  ],
  [
    'records.manage',
    'Places',
    'Manage buildings, spaces and assets',
    'Add, edit, archive and delete places and equipment, and print QR report labels.',
  ],
  ['maintenance.view', 'Maintenance', 'See preventive maintenance', 'View recurring maintenance plans.'],
  [
    'maintenance.manage',
    'Maintenance',
    'Manage maintenance plans',
    'Create, edit, pause and delete plans, and generate due requests.',
  ],
  ['inventory.view', 'Stock', 'See inventory', 'View parts, stock levels and parts used on requests.'],
  ['inventory.manage', 'Stock', 'Manage parts and stock', 'Add and edit parts and adjust stock.'],
  [
    'parts.record_any',
    'Stock',
    'Record parts on any request',
    'Without it, parts can be recorded only on work assigned to them.',
  ],
  ['reports.view', 'Reports', 'View reports', 'Open the Reports page.'],
  ['reports.export', 'Reports', 'Download CSV exports', 'Export requests, assets, maintenance plans and parts.'],
  [
    'admin',
    'Administration',
    'Administer the workspace',
    'Settings, people, groups, roles, provisioning, audit log, email and updates.',
  ],
];
export const capabilityIds = capabilityCatalog.map(c => c[0]);

const manager = capabilityIds.filter(c => c !== 'admin');
export const builtinRoles = {
  requester: {name: 'Requester', description: 'Submits requests and follows their own tickets.', capabilities: []},
  technician: {
    name: 'Technician',
    description: 'Works assigned tickets in the field.',
    capabilities: [
      'requests.view_all',
      'requests.edit_assigned',
      'requests.update_assigned',
      'requests.assignable',
      'maintenance.view',
      'inventory.view',
      'reports.export',
    ],
  },
  manager: {name: 'Manager', description: 'Triages, assigns and plans work.', capabilities: manager},
  admin: {name: 'Administrator', description: 'Everything, including workspace settings.', capabilities: capabilityIds},
};
export const lockedRole = 'admin';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const clean = list => [...new Set(list)].filter(c => capabilityIds.includes(c));

// Loads built-in roles (with any database overrides) and custom roles onto db.roles.
export async function loadRoles(db) {
  const rows = await db.query('SELECT * FROM roles ORDER BY name');
  const map = {};
  for (const [id, role] of Object.entries(builtinRoles))
    map[id] = {id, ...role, builtin: true, locked: id === lockedRole, overridden: false};
  for (const row of rows) {
    const capabilities = clean(JSON.parse(row.capabilities));
    if (map[row.id]?.builtin) {
      if (row.id === lockedRole) continue;
      map[row.id] = {...map[row.id], capabilities, overridden: true};
    } else
      map[row.id] = {
        id: row.id,
        name: row.name,
        description: row.description,
        capabilities,
        builtin: false,
        locked: false,
        overridden: false,
      };
  }
  db.roles = map;
  return map;
}

export const capabilitiesFor = (db, roleId) =>
  roleId === lockedRole ? capabilityIds : (db.roles?.[roleId]?.capabilities ?? []);
export const can = (user, capability) => !!user?.capabilities?.includes(capability);
export const requireCap =
  (capability, message = 'Your role does not allow this.') =>
  (req, res, next) =>
    can(req.user, capability) ? next() : res.status(403).json({error: message});
// Role ids holding a capability, for queries such as "who is notified of new requests".
export const rolesWith = (db, capability) =>
  Object.keys(db.roles || builtinRoles).filter(id => capabilitiesFor(db, id).includes(capability));
export const sqlRoleList = (db, capability, startAt = 1) => {
  const ids = rolesWith(db, capability);
  return {sql: ids.length ? `role IN (${ids.map((_, i) => '$' + (startAt + i)).join(',')})` : '1=0', values: ids};
};

const slug = name =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export async function createRole(db, {name, description = '', capabilities = [], base}) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60)
    throw fail('Role name is required and must be under 60 characters.');
  if (typeof description !== 'string' || description.length > 200)
    throw fail('Description must be under 200 characters.');
  let id = slug(name) || 'role-' + randomUUID().slice(0, 8);
  if (db.roles[id]) id = `${id}-${randomUUID().slice(0, 4)}`;
  if (base && !db.roles[base]) throw fail('Choose an existing role to copy.');
  if (!Array.isArray(capabilities)) throw fail('capabilities must be a list.');
  const caps = clean(base ? capabilitiesFor(db, base) : capabilities).filter(c => c !== 'admin');
  await db.query('INSERT INTO roles(id,name,description,capabilities,created_at) VALUES($1,$2,$3,$4,$5)', [
    id,
    name.trim(),
    description.trim(),
    JSON.stringify(caps),
    new Date().toISOString(),
  ]);
  await loadRoles(db);
  return db.roles[id];
}

export async function updateRole(db, id, {name, description, capabilities}) {
  const role = db.roles[id];
  if (!role) throw fail('Role not found.', 404);
  if (role.locked) throw fail('The administrator role always has every capability.', 403);
  if (capabilities !== undefined && (!Array.isArray(capabilities) || capabilities.some(c => typeof c !== 'string')))
    throw fail('capabilities must be a list of capability ids.');
  const unknown = (capabilities || []).filter(c => !capabilityIds.includes(c));
  if (unknown.length) throw fail(`Unknown capability: ${unknown[0]}.`);
  // Only administrators administer; granting "admin" to another role would bypass the protected role.
  if ((capabilities || []).includes('admin')) throw fail('Only the administrator role can administer the workspace.');
  const next = {
    name: role.builtin || name === undefined ? role.name : String(name).trim(),
    description: role.builtin || description === undefined ? role.description : String(description).trim(),
    capabilities: capabilities === undefined ? role.capabilities : clean(capabilities),
  };
  if (!next.name || next.name.length > 60) throw fail('Role name is required and must be under 60 characters.');
  if (next.description.length > 200) throw fail('Description must be under 200 characters.');
  await db.query(
    'INSERT INTO roles(id,name,description,capabilities,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,capabilities=$4',
    [id, next.name, next.description, JSON.stringify(next.capabilities), new Date().toISOString()],
  );
  await loadRoles(db);
  return {before: role, after: db.roles[id]};
}

// Built-in roles reset to the defaults in this file; custom roles are deleted when no one holds them.
export async function removeRole(db, id) {
  const role = db.roles[id];
  if (!role) throw fail('Role not found.', 404);
  if (role.locked) throw fail('The administrator role cannot be changed.', 403);
  if (!role.builtin) {
    const holders = Number((await db.query('SELECT COUNT(*) AS n FROM users WHERE role=$1', [id]))[0].n);
    if (holders)
      throw fail(
        `${holders} ${holders === 1 ? 'person has' : 'people have'} this role. Move them to another role first.`,
        409,
      );
  }
  await db.query('DELETE FROM roles WHERE id=$1', [id]);
  await loadRoles(db);
  return role;
}
