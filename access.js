// Access as code: roles, groups, SSO role mapping and ticket assignment rules declared in one YAML file
// (ACCESS_FILE, default config/access.yaml). The file is validated as a whole and applied at startup and
// from Settings → Roles → Reload. Anything it defines is marked source='code' and read-only in the UI;
// roles, groups and rules it does not mention stay editable there. A file that fails validation changes
// nothing: the last good configuration stays active and the error is shown in Settings.
import {readFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import {audit} from './audit.js';
import {
  builtinRoles,
  capabilityCatalog,
  capabilityIds,
  lockedRole,
  loadRoles,
  requestTypeIds,
  requireCap,
  usersWith,
} from './permissions.js';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const strategies = ['least_busy', 'round_robin'];
const idPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const accessFilePath = env => env.ACCESS_FILE || path.join(process.cwd(), 'config', 'access.yaml');

export async function accessStatus(db) {
  return JSON.parse((await db.query("SELECT body FROM admin_settings WHERE id='access'"))[0]?.body || '{}');
}
async function saveStatus(db, status) {
  await db.query("INSERT INTO admin_settings VALUES('access',$1) ON CONFLICT(id) DO UPDATE SET body=$1", [
    JSON.stringify(status),
  ]);
  db.access = status;
}

// ---- Validation: turns the YAML document into a plan with every name resolved to an id. ----
export async function planAccess(db, text) {
  const doc = YAML.parseDocument(text, {prettyErrors: true});
  if (doc.errors.length) throw fail(`The access file is not valid YAML: ${doc.errors[0].message}`);
  const spec = doc.toJS() || {};
  const errors = [];
  const at = (where, message) => errors.push(`${where}: ${message}`);
  const list = (value, where) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string' && typeof v !== 'number')) {
      at(where, 'must be a list of names');
      return [];
    }
    return value.map(String);
  };
  if (typeof spec !== 'object' || Array.isArray(spec)) throw fail('The access file must be a YAML mapping.');
  const known = ['version', 'roles', 'groups', 'sso', 'assignment'];
  for (const key of Object.keys(spec)) if (!known.includes(key)) at(key, `unknown section (use ${known.join(', ')})`);
  if (spec.version !== undefined && spec.version !== 1) at('version', 'only version 1 is supported');

  const [buildings, categories, users] = await Promise.all([
    db.query('SELECT id,name FROM buildings'),
    db.query('SELECT id,name,request_type FROM categories WHERE archived_at IS NULL'),
    db.query('SELECT id,name,email,user_name,active FROM users'),
  ]);
  const building = (value, where) => {
    const b = buildings.find(x => x.id === value || x.name.toLowerCase() === value.toLowerCase());
    if (!b) at(where, `no building named "${value}"`);
    return b?.id;
  };
  const person = (value, where) => {
    const v = value.toLowerCase();
    const u = users.find(x => (x.email && x.email.toLowerCase() === v) || (x.user_name || '').toLowerCase() === v);
    if (!u) at(where, `no person with email or username "${value}"`);
    return u?.id;
  };
  const types = (value, where) => {
    const items = list(value, where);
    for (const t of items) if (!requestTypeIds.includes(t)) at(where, `unknown request type "${t}"`);
    return items.filter(t => requestTypeIds.includes(t));
  };

  // Roles. Capabilities accept "group.*" wildcards; "extends" copies another role first.
  const rolesSpec = spec.roles ?? {};
  if (typeof rolesSpec !== 'object' || Array.isArray(rolesSpec)) at('roles', 'must be a mapping of role ids');
  const roleIds = Object.keys(rolesSpec || {});
  const expand = (items, where) =>
    items.flatMap(c => {
      if (c.endsWith('.*')) {
        const found = capabilityIds.filter(id => id.startsWith(c.slice(0, -1)) && id !== 'admin');
        if (!found.length) at(where, `"${c}" matches no capability`);
        return found;
      }
      if (c === 'admin') at(where, 'only the administrator role holds "admin"');
      else if (!capabilityIds.includes(c)) at(where, `unknown capability "${c}"`);
      return capabilityIds.includes(c) && c !== 'admin' ? [c] : [];
    });
  const resolved = {};
  const resolving = new Set();
  const resolveRole = (id, trail) => {
    if (resolved[id]) return resolved[id];
    const r = rolesSpec[id];
    if (!r) {
      const existing = db.roles[id];
      return existing ? {capabilities: existing.capabilities, scope: existing.scope, submit: existing.submit} : null;
    }
    const where = `roles.${id}`;
    if (resolving.has(id)) {
      at(where, `extends itself through ${trail.join(' → ')}`);
      return {capabilities: [], scope: {request_types: [], buildings: []}, submit: null};
    }
    resolving.add(id);
    if (typeof r !== 'object' || Array.isArray(r)) {
      at(where, 'must be a mapping');
      return {capabilities: [], scope: {request_types: [], buildings: []}, submit: null};
    }
    const allowed = ['name', 'description', 'extends', 'capabilities', 'add', 'remove', 'scope', 'submit'];
    for (const key of Object.keys(r)) if (!allowed.includes(key)) at(where, `unknown key "${key}"`);
    let base = {capabilities: [], scope: {request_types: [], buildings: []}, submit: null};
    if (r.extends !== undefined) {
      if (r.extends === lockedRole) at(where, 'cannot extend the administrator role');
      else {
        const parent = resolveRole(String(r.extends), [...trail, id]);
        if (!parent) at(where, `extends unknown role "${r.extends}"`);
        else base = parent;
      }
    }
    if (r.capabilities !== undefined && r.extends !== undefined)
      at(where, 'use either capabilities or extends with add/remove, not both');
    let caps = r.capabilities !== undefined ? expand(list(r.capabilities, `${where}.capabilities`), where) : [];
    if (r.capabilities === undefined) caps = [...base.capabilities];
    caps.push(...expand(list(r.add, `${where}.add`), where));
    const removed = expand(list(r.remove, `${where}.remove`), where);
    caps = [...new Set(caps)].filter(c => !removed.includes(c) && c !== 'admin');
    let scope = base.scope;
    if (r.scope !== undefined) {
      if (!r.scope || typeof r.scope !== 'object' || Array.isArray(r.scope))
        at(`${where}.scope`, 'must have request_types and/or buildings');
      else {
        for (const key of Object.keys(r.scope))
          if (!['request_types', 'buildings'].includes(key)) at(`${where}.scope`, `unknown key "${key}"`);
        scope = {
          request_types: types(r.scope.request_types, `${where}.scope.request_types`),
          buildings: list(r.scope.buildings, `${where}.scope.buildings`)
            .map(b => building(b, `${where}.scope.buildings`))
            .filter(Boolean),
        };
      }
    }
    const submit = r.submit !== undefined ? types(r.submit, `${where}.submit`) : base.submit;
    resolving.delete(id);
    return (resolved[id] = {capabilities: caps, scope, submit});
  };
  const roles = [];
  for (const id of roleIds) {
    const where = `roles.${id}`;
    if (id === lockedRole) {
      at(where, 'the administrator role always has every capability and cannot be configured');
      continue;
    }
    if (!idPattern.test(id)) at(where, 'role ids use lowercase letters, numbers and hyphens (max 40)');
    const r = rolesSpec[id] || {};
    const builtin = !!builtinRoles[id];
    const name = builtin ? builtinRoles[id].name : String(r.name ?? '').trim();
    if (!builtin && (!name || name.length > 60)) at(where, 'needs a name under 60 characters');
    const description = builtin ? builtinRoles[id].description : String(r.description ?? '').trim();
    if (description.length > 200) at(where, 'description must be under 200 characters');
    const rr = resolveRole(id, []);
    roles.push({id, name, description, builtin, ...rr});
  }
  const roleExists = id => !!rolesSpec[id] || !!db.roles[id];

  // Groups grant roles and can match SSO group claims; listing members makes the file own membership.
  const groupsSpec = spec.groups ?? {};
  if (typeof groupsSpec !== 'object' || Array.isArray(groupsSpec)) at('groups', 'must be a mapping of group keys');
  const groups = [];
  const names = new Set();
  for (const [key, g] of Object.entries(groupsSpec || {})) {
    const where = `groups.${key}`;
    if (!idPattern.test(key)) at(where, 'group keys use lowercase letters, numbers and hyphens (max 40)');
    if (!g || typeof g !== 'object' || Array.isArray(g)) {
      at(where, 'must be a mapping');
      continue;
    }
    const allowed = ['name', 'description', 'roles', 'sso', 'auto_assign', 'members'];
    for (const k of Object.keys(g)) if (!allowed.includes(k)) at(where, `unknown key "${k}"`);
    const name = String(g.name ?? key).trim();
    if (!name || name.length > 80) at(where, 'name must be under 80 characters');
    if (names.has(name.toLowerCase())) at(where, `another group is also named "${name}"`);
    names.add(name.toLowerCase());
    const description = String(g.description ?? '').trim();
    if (description.length > 300) at(where, 'description must be under 300 characters');
    const groupRoles = list(g.roles, `${where}.roles`);
    for (const r of groupRoles) if (!roleExists(r)) at(`${where}.roles`, `unknown role "${r}"`);
    if (g.auto_assign !== undefined && typeof g.auto_assign !== 'boolean')
      at(where, 'auto_assign must be true or false');
    groups.push({
      key,
      name,
      description,
      roles: groupRoles,
      sso: list(g.sso, `${where}.sso`),
      auto_assign: g.auto_assign === true,
      members:
        g.members === undefined ? null : list(g.members, `${where}.members`).map(m => person(m, `${where}.members`)),
    });
  }

  // SSO: which role a person signs in with, matched in file order.
  let sso = null;
  if (spec.sso !== undefined) {
    const s = spec.sso || {};
    for (const k of Object.keys(s)) if (!['roles', 'default_role'].includes(k)) at('sso', `unknown key "${k}"`);
    const map = {};
    for (const [role, claims] of Object.entries(s.roles || {})) {
      if (!roleExists(role) && role !== lockedRole) at('sso.roles', `unknown role "${role}"`);
      map[role] = list(claims, `sso.roles.${role}`);
    }
    const fallback = s.default_role ?? 'requester';
    if (!roleExists(fallback) || fallback === lockedRole)
      at('sso.default_role', `must be an existing role other than administrator`);
    sso = {roles: map, default_role: fallback};
  }

  // Assignment rules: the first matching rule assigns a new ticket.
  if (spec.assignment !== undefined && !Array.isArray(spec.assignment)) at('assignment', 'must be a list of rules');
  const groupKeys = new Set(groups.map(g => g.key));
  const rules = (Array.isArray(spec.assignment) ? spec.assignment : []).map((r, i) => {
    const where = `assignment[${i + 1}]`;
    if (!r || typeof r !== 'object') {
      at(where, 'must be a mapping');
      return null;
    }
    const allowed = ['name', 'request_type', 'category', 'buildings', 'assign_to', 'strategy', 'active'];
    for (const k of Object.keys(r)) if (!allowed.includes(k)) at(where, `unknown key "${k}"`);
    const name = String(r.name ?? '').trim();
    if (!name || name.length > 80) at(where, 'needs a name under 80 characters');
    const type = r.request_type === undefined ? null : String(r.request_type);
    if (type && !requestTypeIds.includes(type)) at(where, `unknown request type "${type}"`);
    let category = null;
    if (r.category !== undefined) {
      const matches = categories.filter(
        c => c.name.toLowerCase() === String(r.category).toLowerCase() && (!type || c.request_type === type),
      );
      if (!matches.length) at(where, `no category named "${r.category}"${type ? ` for ${type}` : ''}`);
      else if (matches.length > 1) at(where, `"${r.category}" exists for several types; set request_type`);
      else category = matches[0].id;
    }
    const target = r.assign_to || {};
    const kinds = ['group', 'role', 'user'].filter(k => target[k] !== undefined);
    let kind = null,
      targetId = null;
    if (kinds.length !== 1) at(where, 'assign_to needs exactly one of group, role or user');
    else {
      kind = kinds[0];
      const value = String(target[kind]);
      if (kind === 'group') {
        if (!groupKeys.has(value) && !Object.values(db.groups || {}).some(g => g.id === value))
          at(where, `unknown group "${value}"`);
        targetId = value;
      } else if (kind === 'role') {
        if (!roleExists(value)) at(where, `unknown role "${value}"`);
        targetId = value;
      } else targetId = person(value, where);
    }
    const strategy = r.strategy ?? 'least_busy';
    if (!strategies.includes(strategy)) at(where, `strategy must be ${strategies.join(' or ')}`);
    return {
      name,
      request_type: type,
      category_id: category,
      buildings: list(r.buildings, `${where}.buildings`)
        .map(b => building(b, `${where}.buildings`))
        .filter(Boolean),
      target_kind: kind,
      target_id: targetId,
      strategy,
      active: r.active !== false,
    };
  });
  if (errors.length)
    throw Object.assign(fail(`The access file has ${errors.length} problem${errors.length === 1 ? '' : 's'}.`), {
      problems: errors,
    });
  return {roles, groups, sso, rules: rules.filter(Boolean)};
}

// ---- Apply: one transaction; rows the file no longer mentions are handed back to the UI. ----
export async function applyPlan(db, plan, actor) {
  const now = new Date().toISOString();
  const summary = {roles: plan.roles.length, groups: plan.groups.length, rules: plan.rules.length};
  await db.transaction(async tx => {
    const fileRoles = new Set(plan.roles.map(r => r.id));
    for (const r of plan.roles)
      await tx.query(
        'INSERT INTO roles(id,name,description,capabilities,created_at,scope,submit,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,capabilities=$4,scope=$6,submit=$7,source=$8',
        [
          r.id,
          r.name,
          r.description,
          JSON.stringify(r.capabilities),
          now,
          JSON.stringify(r.scope),
          r.submit ? JSON.stringify(r.submit) : null,
          'code',
        ],
      );
    for (const row of await tx.query("SELECT id FROM roles WHERE source='code'")) {
      if (fileRoles.has(row.id)) continue;
      const held = Number((await tx.query('SELECT COUNT(*) AS n FROM users WHERE role=$1', [row.id]))[0].n);
      if (builtinRoles[row.id] || !held) await tx.query('DELETE FROM roles WHERE id=$1', [row.id]);
      else await tx.query("UPDATE roles SET source='ui' WHERE id=$1", [row.id]);
    }
    const keep = new Set();
    for (const g of plan.groups) {
      const existing = (
        await tx.query(
          'SELECT id FROM user_groups WHERE code_key=$1 OR id=$1 OR LOWER(name)=LOWER($2) ORDER BY code_key',
          [g.key, g.name],
        )
      )[0];
      const id = existing?.id || g.key;
      const values = [
        id,
        g.name,
        g.description,
        Number(g.auto_assign),
        JSON.stringify(g.roles),
        JSON.stringify(g.sso),
        Number(g.members !== null),
        g.key,
      ];
      if (existing)
        await tx.query(
          "UPDATE user_groups SET name=$2,description=$3,auto_assign=$4,roles=$5,sso=$6,members_managed=$7,code_key=$8,source='code' WHERE id=$1",
          values,
        );
      else
        await tx.query(
          "INSERT INTO user_groups(id,name,description,auto_assign,roles,sso,members_managed,code_key,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'code')",
          values,
        );
      keep.add(id);
      if (g.members !== null) {
        await tx.query("DELETE FROM group_members WHERE group_id=$1 AND source IN ('code','manual')", [id]);
        for (const u of new Set(g.members))
          await tx.query("INSERT INTO group_members VALUES($1,$2,'code') ON CONFLICT DO NOTHING", [id, u]);
      } else await tx.query("DELETE FROM group_members WHERE group_id=$1 AND source='code'", [id]);
    }
    for (const row of await tx.query("SELECT id FROM user_groups WHERE source='code'"))
      if (!keep.has(row.id))
        await tx.query("UPDATE user_groups SET source='ui',code_key=NULL,members_managed=0,sso='[]' WHERE id=$1", [
          row.id,
        ]);
    // Group keys in rules become the group's id.
    const groupIds = Object.fromEntries(
      (await tx.query("SELECT id,code_key FROM user_groups WHERE source='code'")).map(g => [g.code_key, g.id]),
    );
    await tx.query("DELETE FROM assignment_rules WHERE source='code'");
    let sort = 0;
    for (const r of plan.rules)
      await tx.query(
        "INSERT INTO assignment_rules(id,name,sort,request_type,category_id,buildings,target_kind,target_id,strategy,active,source,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'code',$11)",
        [
          randomUUID(),
          r.name,
          sort++,
          r.request_type,
          r.category_id,
          JSON.stringify(r.buildings),
          r.target_kind,
          r.target_kind === 'group' ? groupIds[r.target_id] || r.target_id : r.target_id,
          r.strategy,
          Number(r.active),
          now,
        ],
      );
  });
  await loadRoles(db);
  if (actor !== false)
    await audit(
      db,
      actor || {id: null, name: 'Access file'},
      'access.apply',
      'settings',
      'access',
      `Applied the access file: ${summary.roles} roles, ${summary.groups} groups, ${summary.rules} assignment rules`,
    );
  return summary;
}

// Reads, validates and applies the file. Failures are recorded and leave the last good configuration.
export async function loadAccessFile(db, env, {actor, logger} = {}) {
  const file = accessFilePath(env);
  const previous = await accessStatus(db);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const status = {...previous, file, present: false, checked_at: new Date().toISOString()};
    await saveStatus(db, status);
    if (actor) throw fail(`No access file at ${file}.`, 404);
    return status;
  }
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  try {
    const plan = await planAccess(db, text);
    const summary = await applyPlan(db, plan, actor);
    const status = {
      file,
      present: true,
      ok: true,
      hash,
      applied_at: new Date().toISOString(),
      summary,
      sso: plan.sso,
      problems: [],
    };
    await saveStatus(db, status);
    logger?.info('access file applied', {file, ...summary});
    return status;
  } catch (err) {
    const status = {
      ...previous,
      file,
      present: true,
      ok: false,
      failed_hash: hash,
      failed_at: new Date().toISOString(),
      error: err.message,
      problems: err.problems || [],
    };
    await saveStatus(db, status);
    logger?.warn('access file rejected', {file, error: err.message, problems: err.problems});
    if (actor) throw Object.assign(fail(err.message, 422), {problems: err.problems || []});
    return status;
  }
}

// ---- Export the current configuration as a starting access file. ----
export async function exportAccess(db) {
  const buildings = Object.fromEntries((await db.query('SELECT id,name FROM buildings')).map(b => [b.id, b.name]));
  const categories = Object.fromEntries((await db.query('SELECT id,name FROM categories')).map(c => [c.id, c.name]));
  const people = Object.fromEntries(
    (await db.query('SELECT id,email,user_name FROM users')).map(u => [u.id, u.email || u.user_name]),
  );
  const scopeOut = s =>
    s.request_types.length || s.buildings.length
      ? {
          ...(s.request_types.length ? {request_types: s.request_types} : {}),
          ...(s.buildings.length ? {buildings: s.buildings.map(b => buildings[b] || b)} : {}),
        }
      : undefined;
  const roles = {};
  for (const r of Object.values(db.roles)) {
    if (r.locked || (r.builtin && !r.overridden)) continue;
    roles[r.id] = {
      ...(r.builtin ? {} : {name: r.name, description: r.description || undefined}),
      capabilities: r.capabilities,
      scope: scopeOut(r.scope),
      submit: r.submit || undefined,
    };
  }
  const groups = {};
  const keyOf = g =>
    g.code_key ||
    (idPattern.test(g.id)
      ? g.id
      : g.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 40));
  const manual = await db.query("SELECT group_id,user_id FROM group_members WHERE source IN ('manual','code')");
  for (const g of Object.values(db.groups)) {
    const members = manual
      .filter(m => m.group_id === g.id)
      .map(m => people[m.user_id])
      .filter(Boolean);
    groups[keyOf(g)] = {
      name: g.name,
      description: g.description || undefined,
      roles: g.roles.length ? g.roles : undefined,
      sso: g.sso.length ? g.sso : undefined,
      auto_assign: g.auto_assign || undefined,
      members: members.length ? members : undefined,
    };
  }
  const rules = (await db.query('SELECT * FROM assignment_rules ORDER BY sort,created_at')).map(r => ({
    name: r.name,
    request_type: r.request_type || undefined,
    category: r.category_id ? categories[r.category_id] : undefined,
    buildings: JSON.parse(r.buildings).length ? JSON.parse(r.buildings).map(b => buildings[b] || b) : undefined,
    assign_to: {
      [r.target_kind]:
        r.target_kind === 'group'
          ? keyOf(db.groups[r.target_id] || {id: r.target_id, name: r.target_id})
          : r.target_kind === 'user'
            ? people[r.target_id]
            : r.target_id,
    },
    strategy: r.strategy,
    active: r.active ? undefined : false,
  }));
  const status = await accessStatus(db);
  const body = {
    version: 1,
    roles,
    groups,
    ...(status.sso ? {sso: status.sso} : {}),
    assignment: rules,
  };
  return (
    `# Facilities access file, exported ${new Date().toISOString().slice(0, 10)}.\n` +
    '# Save it as config/access.yaml (ACCESS_FILE) and use Settings → Roles → Reload to apply it.\n' +
    '# The template (Settings → Roles → Download template) documents every option.\n' +
    YAML.stringify(body, {lineWidth: 0})
  );
}

// ---- The template: every capability with its description, and a worked example. ----
export function accessTemplate() {
  const byGroup = {};
  for (const [id, group, label, description] of capabilityCatalog)
    (byGroup[group] ||= []).push([id, label, description]);
  const catalog = Object.entries(byGroup)
    .map(
      ([group, caps]) =>
        `#   ${group}\n` +
        caps.map(([id, label, description]) => `#     ${id.padEnd(26)} ${label}. ${description}`).join('\n'),
    )
    .join('\n');
  const builtins = Object.entries(builtinRoles)
    .map(([id, r]) => `#   ${id.padEnd(11)} ${r.name}: ${r.description}`)
    .join('\n');
  return `# Facilities access file (version 1)
#
# Declares roles, groups, the SSO sign-in role mapping and ticket assignment rules. Save it as
# config/access.yaml next to the app (or set ACCESS_FILE), then restart or use Settings → Roles → Reload.
# The whole file is checked first: if anything is wrong, nothing changes and the problems are listed in
# Settings → Roles. Everything defined here is read-only in Settings; anything not mentioned stays editable.
#
# Capabilities (use "requests.*" style wildcards to take a whole group):
${catalog}
#
# Built-in roles (list them under roles: to change their capabilities; the administrator role is fixed):
${builtins}
#
# A role's scope limits its ticket capabilities (requests.*, reservations.approve, parts.record_any) to
# some request types and/or buildings. "submit" limits which request types its holders can open; leave
# it out to allow every enabled type. A person's access is their own role plus every role their groups
# grant, so give someone a narrow base role and add scoped roles through groups.
version: 1

roles:
  # Override a built-in role.
  technician:
    capabilities:
      - requests.view_all
      - requests.edit_assigned
      - requests.update_assigned
      - requests.assignable
      - maintenance.view
      - inventory.view

  # A custom role built from another one.
  north-plumber:
    name: North Campus plumber
    description: Works plumbing tickets in North Campus.
    extends: technician
    add: [parts.record_any]
    remove: [maintenance.view]
    scope:
      request_types: [maintenance]
      buildings: [North Campus]
    submit: [maintenance]

  # An IT administrator who only installs updates and reads the audit log.
  it-admin:
    name: IT administrator
    capabilities: [admin.updates, admin.data, admin.audit]

groups:
  plumbers:
    name: Plumbers
    description: Everyone who takes plumbing work.
    roles: [north-plumber]          # roles this group grants on top of each member's own role
    sso: [facilities-plumbers]       # members join and leave from this SSO group claim at sign-in
    # members: [pat@example.org]     # listing members makes the file own the membership
    # auto_assign: true              # every newly provisioned person joins

# Which role people sign in with, from their SSO group claims (first match wins). Replaces the
# OIDC_ADMIN_GROUP / OIDC_MANAGER_GROUP / OIDC_TECHNICIAN_GROUP variables when present.
sso:
  roles:
    admin: [facilities-admins]
    manager: [facilities-managers]
    technician: [facilities-technicians]
  default_role: requester

# New tickets are assigned by the first matching rule to someone in its group or role who can be
# assigned that ticket. least_busy picks whoever has the fewest open tickets; round_robin takes turns.
assignment:
  - name: North Campus plumbing
    request_type: maintenance
    category: Plumbing              # a category of the request type (Settings → Request forms)
    buildings: [North Campus]
    assign_to: {group: plumbers}    # or {role: technician} or {user: pat@example.org}
    strategy: least_busy
`;
}

// ---- Assignment: the first matching rule picks someone for a new, unassigned ticket. ----
const ruleMatches = (r, order) =>
  (!r.request_type || r.request_type === order.request_type) &&
  (!r.category_id || r.category_id === order.category_id) &&
  (!JSON.parse(r.buildings).length || JSON.parse(r.buildings).includes(order.building_id));

export async function autoAssign(db, orderId, {notify} = {}) {
  const order = (await db.query('SELECT * FROM work_orders WHERE id=$1', [orderId]))[0];
  if (!order || order.assignee_id) return null;
  const rules = await db.query('SELECT * FROM assignment_rules WHERE active=1 ORDER BY sort,created_at');
  const rule = rules.find(r => ruleMatches(r, order));
  if (!rule) return null;
  const eligible = await usersWith(db, 'requests.assignable', order);
  let pool;
  if (rule.target_kind === 'user') pool = eligible.filter(u => u.id === rule.target_id);
  else if (rule.target_kind === 'group') {
    const members = new Set(
      (await db.query('SELECT user_id FROM group_members WHERE group_id=$1', [rule.target_id])).map(m => m.user_id),
    );
    pool = eligible.filter(u => members.has(u.id));
  } else {
    const granting = Object.values(db.groups || {})
      .filter(g => g.roles.includes(rule.target_id))
      .map(g => g.id);
    const viaGroup = new Set(
      granting.length
        ? (
            await db.query(
              `SELECT user_id FROM group_members WHERE group_id IN (${granting.map((_, i) => '$' + (i + 1)).join(',')})`,
              granting,
            )
          ).map(m => m.user_id)
        : [],
    );
    pool = eligible.filter(u => u.role === rule.target_id || viaGroup.has(u.id));
  }
  if (!pool.length) return null;
  // Take turns from whoever was picked last; least_busy first narrows to the fewest open tickets.
  if (rule.strategy === 'least_busy') {
    const load = Object.fromEntries(
      (
        await db.query(
          `SELECT assignee_id, COUNT(*) AS n FROM work_orders WHERE status<>'Completed' AND assignee_id IS NOT NULL GROUP BY assignee_id`,
        )
      ).map(r => [r.assignee_id, Number(r.n)]),
    );
    const least = Math.min(...pool.map(u => load[u.id] || 0));
    pool = pool.filter(u => (load[u.id] || 0) === least);
  }
  const ordered = [...pool].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const after = ordered.findIndex(u => u.id === rule.last_user_id);
  const pick = ordered[(after + 1) % ordered.length];
  await db.query('UPDATE work_orders SET assignee_id=$1,updated_at=$2 WHERE id=$3 AND assignee_id IS NULL', [
    pick.id,
    new Date().toISOString(),
    order.id,
  ]);
  await db.query('UPDATE assignment_rules SET last_user_id=$1 WHERE id=$2', [pick.id, rule.id]);
  await audit(
    db,
    {id: null, name: 'Assignment rules'},
    'order.auto_assign',
    'work_order',
    order.id,
    `Assigned to ${pick.name} by the rule “${rule.name}”`,
    {assignee_id: [null, pick.id]},
  );
  if (notify) await notify(db, order, 'assigned', [pick.id], null, `A new request was assigned to you (${rule.name}).`);
  return pick;
}

// ---- Routes: status, reload, export, template and the assignment rules editable in Settings. ----
export function setupAccess(app, db, env, {logger} = {}) {
  const roles = requireCap('admin.roles', 'Your role cannot manage roles and access.');
  const rulesPayload = async () =>
    (await db.query('SELECT * FROM assignment_rules ORDER BY sort,created_at')).map(r => ({
      ...r,
      active: !!r.active,
      buildings: JSON.parse(r.buildings),
    }));
  app.get('/api/admin/access', roles, async (req, res) =>
    res.json({status: await accessStatus(db), file: accessFilePath(env), rules: await rulesPayload()}),
  );
  app.post('/api/admin/access/reload', roles, async (req, res) => {
    const status = await loadAccessFile(db, env, {actor: req.user, logger});
    res.json({status, rules: await rulesPayload()});
  });
  app.get('/api/admin/access/export.yaml', roles, async (req, res) => {
    res
      .type('application/yaml')
      .attachment('access.yaml')
      .send(await exportAccess(db));
  });
  app.get('/api/admin/access/template.yaml', roles, (req, res) => {
    res.type('application/yaml').attachment('access.example.yaml').send(accessTemplate());
  });
  const ruleBody = async body => {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw fail('Give the rule a name under 80 characters.');
    const type = body.request_type || null;
    if (type && !requestTypeIds.includes(type)) throw fail('Choose a valid request type.');
    const category = body.category_id || null;
    if (category) {
      const c = (await db.query('SELECT request_type FROM categories WHERE id=$1', [category]))[0];
      if (!c) throw fail('Choose an existing category.');
      if (type && c.request_type !== type) throw fail('The category belongs to a different request type.');
    }
    const buildings = body.buildings ?? [];
    if (!Array.isArray(buildings)) throw fail('buildings must be a list.');
    for (const b of buildings)
      if (!(await db.query('SELECT id FROM buildings WHERE id=$1', [b])).length)
        throw fail('Choose existing buildings.');
    if (!['group', 'role', 'user'].includes(body.target_kind)) throw fail('Assign to a group, a role or a person.');
    const target = String(body.target_id || '');
    const exists =
      body.target_kind === 'group'
        ? !!db.groups[target]
        : body.target_kind === 'role'
          ? !!db.roles[target]
          : !!(await db.query('SELECT id FROM users WHERE id=$1', [target])).length;
    if (!exists) throw fail('Choose who the rule assigns to.');
    const strategy = body.strategy || 'least_busy';
    if (!strategies.includes(strategy)) throw fail('Choose least busy or round robin.');
    return {name, type, category, buildings: [...new Set(buildings)], kind: body.target_kind, target, strategy};
  };
  const editable = async id => {
    const rule = (await db.query('SELECT * FROM assignment_rules WHERE id=$1', [id]))[0];
    if (!rule) throw fail('Rule not found.', 404);
    if (rule.source === 'code') throw fail('This rule is managed by the access file. Change it there and reload.', 409);
    return rule;
  };
  app.post('/api/admin/assignment-rules', roles, async (req, res) => {
    const r = await ruleBody(req.body || {});
    const id = randomUUID();
    const sort = 1000 + Number((await db.query("SELECT COUNT(*) AS n FROM assignment_rules WHERE source='ui'"))[0].n);
    await db.query(
      "INSERT INTO assignment_rules(id,name,sort,request_type,category_id,buildings,target_kind,target_id,strategy,active,source,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'ui',$10)",
      [
        id,
        r.name,
        sort,
        r.type,
        r.category,
        JSON.stringify(r.buildings),
        r.kind,
        r.target,
        r.strategy,
        new Date().toISOString(),
      ],
    );
    await audit(db, req.user, 'assignment.create', 'settings', id, `Created assignment rule ${r.name}`);
    res.status(201).json({id, rules: await rulesPayload()});
  });
  app.patch('/api/admin/assignment-rules/:id', roles, async (req, res) => {
    const before = await editable(req.params.id);
    const r = await ruleBody({...before, buildings: JSON.parse(before.buildings), ...req.body});
    const active = req.body.active === undefined ? !!before.active : req.body.active === true;
    await db.query(
      'UPDATE assignment_rules SET name=$1,request_type=$2,category_id=$3,buildings=$4,target_kind=$5,target_id=$6,strategy=$7,active=$8 WHERE id=$9',
      [
        r.name,
        r.type,
        r.category,
        JSON.stringify(r.buildings),
        r.kind,
        r.target,
        r.strategy,
        Number(active),
        before.id,
      ],
    );
    await audit(db, req.user, 'assignment.update', 'settings', before.id, `Updated assignment rule ${r.name}`);
    res.json({rules: await rulesPayload()});
  });
  app.delete('/api/admin/assignment-rules/:id', roles, async (req, res) => {
    const before = await editable(req.params.id);
    await db.query('DELETE FROM assignment_rules WHERE id=$1', [before.id]);
    await audit(db, req.user, 'assignment.delete', 'settings', before.id, `Deleted assignment rule ${before.name}`);
    res.json({rules: await rulesPayload()});
  });
}
