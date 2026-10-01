// What each role can do. The capability catalog and the built-in role defaults live here. Roles can be
// overridden or added in Settings → Roles or in the access file (access.js); groups grant roles.
//
// Every API check asks for a capability, never for a role name: can(user, cap) for things that are not
// tied to one ticket, canOn(user, cap, order) for ticket work, which also honours a role's scope
// (request types and buildings). The administrator role always has every capability so the workspace
// cannot lock itself out.

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
    'admin.settings',
    'Administration',
    'Workspace settings',
    'Features, identity, workspace and notification delivery.',
  ],
  ['admin.forms', 'Administration', 'Request forms', 'Categories, questions and required fields for each type.'],
  [
    'admin.people',
    'Administration',
    'People and groups',
    'Provision and disable people, manage groups and provisioning tokens.',
  ],
  ['admin.roles', 'Administration', 'Roles and access', 'Roles, assignment rules and the access file.'],
  ['admin.audit', 'Administration', 'Audit log', 'Read and export the audit log.'],
  ['admin.data', 'Administration', 'Backups and data', 'Back up now and data retention.'],
  ['admin.updates', 'Administration', 'Updates', 'Install new releases.'],
  ['admin', 'Administration', 'Full administrator', 'Every capability. Only the Administrator role holds it.'],
];
export const capabilityIds = capabilityCatalog.map(c => c[0]);

export const adminSections = capabilityIds.filter(c => c.startsWith('admin.'));
// Capabilities that apply per ticket and so follow a role's scope.
export const ticketCapabilities = [
  'requests.view_all',
  'requests.edit_any',
  'requests.edit_assigned',
  'requests.update_assigned',
  'requests.update_any',
  'requests.assign',
  'requests.assignable',
  'requests.delete',
  'requests.notified',
  'requests.moderate',
  'reservations.approve',
  'parts.record_any',
];
export const requestTypeIds = ['maintenance', 'schedule', 'technology'];
const manager = capabilityIds.filter(c => c !== 'admin' && !adminSections.includes(c));
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
const parse = (text, fallback) => {
  try {
    return text == null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
};
export const cleanScope = scope => ({
  request_types: [...new Set(scope?.request_types || [])].filter(t => requestTypeIds.includes(t)),
  buildings: [...new Set(scope?.buildings || [])].filter(b => typeof b === 'string'),
});

// Loads built-in roles (with any overrides) and custom roles onto db.roles, and groups onto db.groups.
export async function loadRoles(db) {
  const rows = await db.query('SELECT * FROM roles ORDER BY name');
  const map = {};
  for (const [id, role] of Object.entries(builtinRoles))
    map[id] = {
      id,
      ...role,
      scope: cleanScope(),
      submit: null,
      builtin: true,
      locked: id === lockedRole,
      overridden: false,
      source: 'builtin',
    };
  for (const row of rows) {
    const extra = {
      capabilities: clean(parse(row.capabilities, [])),
      scope: cleanScope(parse(row.scope, {})),
      submit: parse(row.submit, null),
      source: row.source || 'ui',
    };
    if (map[row.id]?.builtin) {
      if (row.id === lockedRole) continue;
      map[row.id] = {...map[row.id], ...extra, overridden: true};
    } else
      map[row.id] = {
        id: row.id,
        name: row.name,
        description: row.description,
        ...extra,
        builtin: false,
        locked: false,
        overridden: false,
      };
  }
  db.roles = map;
  await loadGroups(db);
  return map;
}
export async function loadGroups(db) {
  const rows = await db.query('SELECT * FROM user_groups ORDER BY name');
  db.groups = Object.fromEntries(
    rows.map(g => [
      g.id,
      {
        ...g,
        auto_assign: !!g.auto_assign,
        members_managed: !!g.members_managed,
        roles: parse(g.roles, []).filter(r => db.roles?.[r]),
        sso: parse(g.sso, []),
        source: g.source || 'ui',
      },
    ]),
  );
  return db.groups;
}

export const capabilitiesFor = (db, roleId) =>
  roleId === lockedRole ? capabilityIds : (db.roles?.[roleId]?.capabilities ?? []);

// A person's grants: their own role plus every role granted by a group they belong to.
export function grantsFor(db, roleId, groupIds = []) {
  const roleIds = [roleId, ...groupIds.flatMap(g => db.groups?.[g]?.roles || [])];
  return [...new Set(roleIds)]
    .filter(id => db.roles?.[id])
    .map(id => ({
      role: id,
      capabilities: capabilitiesFor(db, id),
      scope: id === lockedRole ? cleanScope() : db.roles[id].scope || cleanScope(),
      submit: id === lockedRole ? null : db.roles[id].submit,
    }));
}
// Attaches grants, the union of capabilities and the request types the person may submit.
export function applyGrants(db, user, groupIds = []) {
  user.grants = grantsFor(db, user.role, groupIds);
  user.capabilities = capabilityIds.filter(c => user.grants.some(g => g.capabilities.includes(c)));
  user.submit_types = user.grants.some(g => !g.submit)
    ? null
    : [...new Set(user.grants.flatMap(g => g.submit))].filter(t => requestTypeIds.includes(t));
  user.group_ids = groupIds;
  return user;
}
export async function memberships(db, userId) {
  return (await db.query('SELECT DISTINCT group_id FROM group_members WHERE user_id=$1', [userId]))
    .map(r => r.group_id)
    .filter(id => db.groups?.[id]);
}

const inScope = (scope, order) =>
  (!scope?.request_types?.length || scope.request_types.includes(order.request_type)) &&
  (!scope?.buildings?.length || scope.buildings.includes(order.building_id));
export const can = (user, capability) => !!user?.capabilities?.includes(capability);
// Ticket work: the capability must come from a grant whose scope covers this ticket.
export const canOn = (user, capability, order) =>
  !!user?.grants?.some(g => g.capabilities.includes(capability) && inScope(g.scope, order));
export const canSubmit = (user, type) => !user?.submit_types || user.submit_types.includes(type);
// SQL for "tickets where this person holds the capability", with "?" placeholders and their values.
export function scopeSql(user, capability, alias = 'w') {
  const parts = [],
    values = [];
  for (const g of user?.grants || []) {
    if (!g.capabilities.includes(capability)) continue;
    const terms = [];
    if (g.scope.request_types.length) {
      terms.push(`${alias}.request_type IN (${g.scope.request_types.map(() => '?').join(',')})`);
      values.push(...g.scope.request_types);
    }
    if (g.scope.buildings.length) {
      terms.push(`${alias}.building_id IN (${g.scope.buildings.map(() => '?').join(',')})`);
      values.push(...g.scope.buildings);
    }
    if (!terms.length) return {sql: '1=1', values: []};
    parts.push(`(${terms.join(' AND ')})`);
  }
  return {sql: parts.length ? `(${parts.join(' OR ')})` : '1=0', values};
}
export const requireCap =
  (capability, message = 'Your role does not allow this.') =>
  (req, res, next) =>
    can(req.user, capability) ? next() : res.status(403).json({error: message});

// Everyone who holds a capability (for one ticket, when given): active people through their role and groups.
export async function usersWith(db, capability, order) {
  const [people, members] = await Promise.all([
    db.query('SELECT id,name,email,role FROM users WHERE active=1 ORDER BY name'),
    db.query('SELECT DISTINCT group_id,user_id FROM group_members'),
  ]);
  const byUser = {};
  for (const m of members) if (db.groups?.[m.group_id]) (byUser[m.user_id] ||= []).push(m.group_id);
  return people.filter(u => {
    const person = applyGrants(db, {...u}, byUser[u.id] || []);
    return order ? canOn(person, capability, order) : can(person, capability);
  });
}

// People who administer roles or people may hand out only what they hold themselves.
export function assertCanGrant(actor, capabilities) {
  if (!actor?.capabilities || can(actor, 'admin')) return;
  const missing = capabilities.filter(c => !can(actor, c));
  if (missing.length) throw fail(`You cannot grant capabilities you do not hold: ${missing.join(', ')}.`, 403);
}

const slug = name =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

// Scope and submit lists are validated against real buildings and request types.
export async function checkScope(db, scope) {
  if (scope === undefined) return undefined;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope))
    throw fail('scope must be an object with request_types and buildings lists.');
  for (const key of ['request_types', 'buildings'])
    if (scope[key] !== undefined && (!Array.isArray(scope[key]) || scope[key].some(v => typeof v !== 'string')))
      throw fail(`scope.${key} must be a list.`);
  const bad = (scope.request_types || []).find(t => !requestTypeIds.includes(t));
  if (bad) throw fail(`Unknown request type in scope: ${bad}.`);
  for (const b of scope.buildings || [])
    if (!(await db.query('SELECT id FROM buildings WHERE id=$1', [b])).length)
      throw fail(`Unknown building in scope: ${b}.`);
  return cleanScope(scope);
}
export function checkSubmit(submit) {
  if (submit === undefined || submit === null) return submit;
  if (!Array.isArray(submit) || submit.some(t => !requestTypeIds.includes(t)))
    throw fail(`submit must be a list of request types (${requestTypeIds.join(', ')}).`);
  return [...new Set(submit)];
}
const codeManaged = role => {
  if (role.source === 'code')
    throw fail(`The ${role.name} role is managed by the access file. Change it there and reload.`, 409);
};

export async function createRole(
  db,
  {id: wanted, name, description = '', capabilities = [], base, scope, submit},
  {actor, source = 'ui'} = {},
) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60)
    throw fail('Role name is required and must be under 60 characters.');
  if (typeof description !== 'string' || description.length > 200)
    throw fail('Description must be under 200 characters.');
  let id = wanted || slug(name) || 'role-' + randomUUID().slice(0, 8);
  if (db.roles[id] && !wanted) id = `${id}-${randomUUID().slice(0, 4)}`;
  if (base && !db.roles[base]) throw fail('Choose an existing role to copy.');
  if (!Array.isArray(capabilities)) throw fail('capabilities must be a list.');
  const unknown = capabilities.filter(c => !capabilityIds.includes(c));
  if (unknown.length) throw fail(`Unknown capability: ${unknown[0]}.`);
  const caps = clean(base ? capabilitiesFor(db, base) : capabilities).filter(c => c !== 'admin');
  assertCanGrant(actor, caps);
  const s = (await checkScope(db, scope)) ?? (base ? db.roles[base].scope : cleanScope());
  const sub = checkSubmit(submit) ?? (base ? db.roles[base].submit : null);
  await db.query(
    'INSERT INTO roles(id,name,description,capabilities,created_at,scope,submit,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      id,
      name.trim(),
      description.trim(),
      JSON.stringify(caps),
      new Date().toISOString(),
      JSON.stringify(s),
      sub ? JSON.stringify(sub) : null,
      source,
    ],
  );
  await loadRoles(db);
  return db.roles[id];
}

export async function updateRole(
  db,
  id,
  {name, description, capabilities, scope, submit},
  {actor, source = 'ui', fromCode = false} = {},
) {
  const role = db.roles[id];
  if (!role) throw fail('Role not found.', 404);
  if (role.locked) throw fail('The administrator role always has every capability.', 403);
  if (!fromCode) codeManaged(role);
  if (capabilities !== undefined && (!Array.isArray(capabilities) || capabilities.some(c => typeof c !== 'string')))
    throw fail('capabilities must be a list of capability ids.');
  const unknown = (capabilities || []).filter(c => !capabilityIds.includes(c));
  if (unknown.length) throw fail(`Unknown capability: ${unknown[0]}.`);
  // Only administrators administer; granting "admin" to another role would bypass the protected role.
  if ((capabilities || []).includes('admin')) throw fail('Only the administrator role can administer the workspace.');
  if (capabilities !== undefined) assertCanGrant(actor, capabilities);
  const custom = !role.builtin || fromCode;
  const next = {
    name: !custom || name === undefined ? role.name : String(name).trim(),
    description: !custom || description === undefined ? role.description : String(description).trim(),
    capabilities: capabilities === undefined ? role.capabilities : clean(capabilities),
    scope: (await checkScope(db, scope)) ?? role.scope,
    submit: submit === undefined ? role.submit : checkSubmit(submit),
  };
  if (!next.name || next.name.length > 60) throw fail('Role name is required and must be under 60 characters.');
  if (next.description.length > 200) throw fail('Description must be under 200 characters.');
  await db.query(
    'INSERT INTO roles(id,name,description,capabilities,created_at,scope,submit,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,capabilities=$4,scope=$6,submit=$7,source=$8',
    [
      id,
      next.name,
      next.description,
      JSON.stringify(next.capabilities),
      new Date().toISOString(),
      JSON.stringify(next.scope),
      next.submit ? JSON.stringify(next.submit) : null,
      source,
    ],
  );
  await loadRoles(db);
  return {before: role, after: db.roles[id]};
}

// Built-in roles reset to the defaults in this file; custom roles are deleted when no one holds them.
export async function removeRole(db, id, {fromCode = false} = {}) {
  const role = db.roles[id];
  if (!role) throw fail('Role not found.', 404);
  if (role.locked) throw fail('The administrator role cannot be changed.', 403);
  if (!fromCode) codeManaged(role);
  if (!role.builtin) {
    const holders = Number((await db.query('SELECT COUNT(*) AS n FROM users WHERE role=$1', [id]))[0].n);
    if (holders)
      throw fail(
        `${holders} ${holders === 1 ? 'person has' : 'people have'} this role. Move them to another role first.`,
        409,
      );
    const granting = Object.values(db.groups || {}).find(g => g.roles.includes(id));
    if (granting) throw fail(`The ${granting.name} group grants this role. Remove it from the group first.`, 409);
  }
  await db.query('DELETE FROM roles WHERE id=$1', [id]);
  await loadRoles(db);
  return role;
}
