import {randomUUID, randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import express from 'express';
import {scimRouter} from './scim.js';
import {audit, changes} from './audit.js';
import {can, capabilityCatalog, createRole, updateRole, removeRole} from './permissions.js';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const clean = (value, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw fail(`Enter text between 1 and ${max} characters.`);
  return value.trim();
};
const admin = (req, res, next) =>
  can(req.user, 'admin') ? next() : res.status(403).json({error: 'Administrator access required.'});
export async function workspaceSettings(db) {
  return JSON.parse((await db.query("SELECT body FROM admin_settings WHERE id='workspace'"))[0]?.body || '{}');
}
const safeUser = u => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: !!u.active,
  managed: !!u.managed,
  userName: u.user_name,
  oidc_subject: u.subject.includes('|') ? u.subject.slice(u.subject.indexOf('|') + 1) : null,
});
// Sessions created before the user_id column existed are matched from their stored body.
export async function revokeSessions(db, id) {
  await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
  for (const s of await db.query('SELECT id,body FROM sessions WHERE user_id IS NULL'))
    if (JSON.parse(s.body).userId === id) await db.query('DELETE FROM sessions WHERE id=$1', [s.id]);
}

export async function saveProvisionedUser(db, env, body, id, actor) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Send a user object.');
  if (body.externalId !== undefined && (typeof body.externalId !== 'string' || body.externalId.length > 1024))
    throw fail('externalId must be text under 1024 characters.');
  const existing = id ? (await db.query('SELECT * FROM users WHERE id=$1', [id]))[0] : null;
  if (id && !existing) throw fail('User not found.', 404);
  if (existing?.role === 'admin') throw fail('Provisioning cannot modify administrators.', 403);
  const sub =
    body.oidc_subject === undefined ? existing?.subject?.split('|').slice(1).join('|') : clean(body.oidc_subject, 255);
  if (!sub) throw fail('oidc_subject is required. Map the immutable identity-provider user ID.');
  if (sub === env.OIDC_ADMIN_SUBJECT) throw fail('The bootstrap administrator is protected.', 403);
  if (!env.OIDC_ISSUER) throw fail('Configure the OIDC issuer before provisioning users.', 503);
  const subject = `${env.OIDC_ISSUER}|${sub}`;
  if (existing && existing.subject !== subject) throw fail('The SSO subject cannot be changed.');
  const collision = (await db.query('SELECT id FROM users WHERE subject=$1', [subject]))[0];
  if (collision && collision.id !== id) throw fail('This SSO identity already exists. Update it by ID.', 409);
  const role = body.role ?? existing?.role ?? 'requester';
  if (role === 'admin' || !db.roles?.[role]) throw fail('Choose an existing role other than administrator.');
  if (body.active !== undefined && typeof body.active !== 'boolean') throw fail('active must be a boolean.');
  const name = clean(body.name ?? existing?.name, 120),
    email = body.email ?? existing?.email ?? '';
  if (typeof email !== 'string' || email.length > 254) throw fail('Enter a valid email value.');
  const userName = clean(body.userName ?? existing?.user_name ?? sub, 255);
  const taken = (await db.query('SELECT id FROM users WHERE user_name=$1', [userName]))[0];
  if (taken && taken.id !== id) throw fail('This username already exists.', 409);
  if (body.group_ids !== undefined) {
    if (
      !Array.isArray(body.group_ids) ||
      body.group_ids.length > 100 ||
      body.group_ids.some(x => typeof x !== 'string')
    )
      throw fail('group_ids must be a list of group IDs.');
    for (const g of body.group_ids)
      if (!(await db.query('SELECT id FROM user_groups WHERE id=$1', [g])).length) throw fail('Unknown group ID.');
  }
  const userId = id || randomUUID(),
    active = body.active ?? !!(existing?.active ?? 1);
  if (existing)
    await db.query(
      'UPDATE users SET name=$1,email=$2,role=$3,active=$4,managed=1,user_name=$5,external_id=$6 WHERE id=$7',
      [name, email, role, Number(active), userName, body.externalId ?? existing.external_id, userId],
    );
  else
    await db.query(
      'INSERT INTO users(id,subject,name,email,role,active,managed,user_name,external_id) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8)',
      [userId, subject, name, email, role, Number(active), userName, body.externalId ?? null],
    );
  // Manual memberships survive a provider replacing its own assignments.
  if (body.group_ids !== undefined) {
    for (const g of body.group_ids)
      await db.query("INSERT INTO group_members VALUES($1,$2,'provisioning') ON CONFLICT DO NOTHING", [g, userId]);
    for (const m of await db.query("SELECT group_id FROM group_members WHERE user_id=$1 AND source='provisioning'", [
      userId,
    ]))
      if (!body.group_ids.includes(m.group_id))
        await db.query("DELETE FROM group_members WHERE user_id=$1 AND group_id=$2 AND source='provisioning'", [
          userId,
          m.group_id,
        ]);
  }
  if (!existing)
    for (const g of await db.query('SELECT id FROM user_groups WHERE auto_assign=1'))
      await db.query("INSERT INTO group_members VALUES($1,$2,'automatic') ON CONFLICT DO NOTHING", [g.id, userId]);
  if (!active) await revokeSessions(db, userId);
  const saved = (await db.query('SELECT * FROM users WHERE id=$1', [userId]))[0];
  if (actor) {
    const diff = changes(existing || {}, saved, ['name', 'email', 'role', 'active', 'user_name', 'external_id']);
    if (!existing) await audit(db, actor, 'user.provision', 'user', userId, `Provisioned ${name} as ${role}`, diff);
    else if (Object.keys(diff).length)
      await audit(
        db,
        actor,
        'active' in diff ? (active ? 'user.enable' : 'user.disable') : 'user.update',
        'user',
        userId,
        `${'active' in diff ? (active ? 'Enabled' : 'Disabled') : 'Updated'} ${name}`,
        diff,
      );
  }
  return saved;
}

export function setupAdministration(app, db, env) {
  app.get('/api/admin', admin, async (req, res) =>
    res.json({
      settings: await workspaceSettings(db),
      users: (await db.query('SELECT * FROM users ORDER BY name')).map(safeUser),
      groups: await db.query('SELECT * FROM user_groups ORDER BY name'),
      members: await db.query('SELECT * FROM group_members'),
      keys: await db.query('SELECT id,name,expires_at,revoked FROM provisioning_keys ORDER BY expires_at'),
      roles: await rolesPayload(),
      capabilities: capabilityCatalog.map(([id, group, label, description]) => ({id, group, label, description})),
    }),
  );
  // Roles: built-in defaults come from permissions.js; overrides and custom roles live in the database.
  const rolesPayload = async () => {
    const counts = Object.fromEntries(
      (await db.query('SELECT role, COUNT(*) AS n FROM users GROUP BY role')).map(r => [r.role, Number(r.n)]),
    );
    const order = ['requester', 'technician', 'manager', 'admin'];
    return Object.values(db.roles)
      .map(r => ({...r, people: counts[r.id] || 0}))
      .sort(
        (a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99) || a.name.localeCompare(b.name),
      );
  };
  app.get('/api/admin/roles', admin, async (req, res) => res.json(await rolesPayload()));
  app.post('/api/admin/roles', admin, async (req, res) => {
    const role = await createRole(db, req.body || {});
    await audit(db, req.user, 'role.create', 'role', role.id, `Created role ${role.name}`, {
      capabilities: [null, role.capabilities.join(', ')],
    });
    res.status(201).json(role);
  });
  app.patch('/api/admin/roles/:id', admin, async (req, res) => {
    const {before, after} = await updateRole(db, req.params.id, req.body || {});
    const added = after.capabilities.filter(c => !before.capabilities.includes(c)),
      removed = before.capabilities.filter(c => !after.capabilities.includes(c));
    await audit(
      db,
      req.user,
      'role.update',
      'role',
      after.id,
      `Updated role ${after.name}${added.length ? ` · granted ${added.join(', ')}` : ''}${removed.length ? ` · removed ${removed.join(', ')}` : ''}`,
      changes(before, after, ['name', 'description']),
    );
    res.json(after);
  });
  app.delete('/api/admin/roles/:id', admin, async (req, res) => {
    const role = await removeRole(db, req.params.id);
    await audit(
      db,
      req.user,
      role.builtin ? 'role.reset' : 'role.delete',
      'role',
      role.id,
      role.builtin ? `Reset role ${role.name} to its defaults` : `Deleted role ${role.name}`,
    );
    res.json({ok: true});
  });
  app.put('/api/admin/workspace', admin, async (req, res) => {
    const name = clean(req.body.name, 80),
      welcome = clean(req.body.welcome, 200);
    const icon = req.body.icon ?? '';
    if (!['building', 'work', 'technology', 'calendar'].includes(icon) && icon !== '')
      throw fail('Choose a supported workspace icon.');
    if (typeof req.body.provisioned_only !== 'boolean') throw fail('Choose a sign-in policy.');
    const settings = {name, welcome, icon, provisioned_only: req.body.provisioned_only};
    const before = await workspaceSettings(db);
    await db.query("INSERT INTO admin_settings VALUES('workspace',$1) ON CONFLICT(id) DO UPDATE SET body=$1", [
      JSON.stringify(settings),
    ]);
    await audit(
      db,
      req.user,
      'settings.workspace',
      'settings',
      'workspace',
      'Updated workspace identity and sign-in policy',
      changes(before, settings, ['name', 'welcome', 'icon', 'provisioned_only']),
    );
    res.json(settings);
  });
  app.post('/api/admin/groups', admin, async (req, res) => {
    const name = clean(req.body.name, 80),
      description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (description.length > 300) throw fail('Description must be under 300 characters.');
    if ((await db.query('SELECT id FROM user_groups WHERE name=$1', [name])).length)
      throw fail('A group already uses that name.', 409);
    const id = randomUUID();
    await db.query('INSERT INTO user_groups VALUES($1,$2,$3,$4)', [
      id,
      name,
      description,
      Number(req.body.auto_assign === true),
    ]);
    await audit(db, req.user, 'group.create', 'group', id, `Created group ${name}`);
    res.status(201).json({id});
  });
  app.patch('/api/admin/groups/:id', admin, async (req, res) => {
    const before = (await db.query('SELECT * FROM user_groups WHERE id=$1', [req.params.id]))[0];
    if (!before) throw fail('Group not found.', 404);
    const name = clean(req.body.name, 80),
      description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (description.length > 300) throw fail('Description must be under 300 characters.');
    if ((await db.query('SELECT id FROM user_groups WHERE name=$1 AND id<>$2', [name, req.params.id])).length)
      throw fail('A group already uses that name.', 409);
    await db.query('UPDATE user_groups SET name=$1,description=$2,auto_assign=$3 WHERE id=$4', [
      name,
      description,
      Number(req.body.auto_assign === true),
      req.params.id,
    ]);
    await audit(
      db,
      req.user,
      'group.update',
      'group',
      req.params.id,
      `Updated group ${name}`,
      changes(before, {name, description, auto_assign: Number(req.body.auto_assign === true)}, [
        'name',
        'description',
        'auto_assign',
      ]),
    );
    res.json({ok: true});
  });
  app.put('/api/admin/groups/:id/members/:user', admin, async (req, res) => {
    const group = (await db.query('SELECT name FROM user_groups WHERE id=$1', [req.params.id]))[0],
      member = (await db.query('SELECT name FROM users WHERE id=$1', [req.params.user]))[0];
    if (!group || !member) throw fail('Group or user not found.', 404);
    if (typeof req.body.member !== 'boolean') throw fail('member must be a boolean.');
    if (req.body.member)
      await db.query("INSERT INTO group_members VALUES($1,$2,'manual') ON CONFLICT DO NOTHING", [
        req.params.id,
        req.params.user,
      ]);
    else await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [req.params.id, req.params.user]);
    await audit(
      db,
      req.user,
      req.body.member ? 'group.member_add' : 'group.member_remove',
      'group',
      req.params.id,
      `${req.body.member ? 'Added' : 'Removed'} ${member.name} ${req.body.member ? 'to' : 'from'} ${group.name}`,
    );
    res.json({ok: true});
  });
  app.post('/api/admin/users', admin, async (req, res) =>
    res.status(201).json(safeUser(await saveProvisionedUser(db, env, req.body, undefined, req.user))),
  );
  app.patch('/api/admin/users/:id', admin, async (req, res) =>
    res.json(safeUser(await saveProvisionedUser(db, env, req.body, req.params.id, req.user))),
  );
  app.post('/api/admin/keys', admin, async (req, res) => {
    const name = clean(req.body.name, 80),
      days = req.body.days ?? 90;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw fail('Expiration must be 1–365 days.');
    const id = randomUUID(),
      secret = `fmxp_${id}.${randomBytes(32).toString('base64url')}`,
      expires_at = new Date(Date.now() + days * 86400000).toISOString();
    await db.query('INSERT INTO provisioning_keys(id,name,digest,expires_at) VALUES($1,$2,$3,$4)', [
      id,
      name,
      createHash('sha256').update(secret).digest('hex'),
      expires_at,
    ]);
    await audit(
      db,
      req.user,
      'key.create',
      'provisioning_key',
      id,
      `Created provisioning token ${name} (expires ${expires_at.slice(0, 10)})`,
    );
    res.status(201).json({id, secret, expires_at});
  });
  app.delete('/api/admin/keys/:id', admin, async (req, res) => {
    const key = (await db.query('SELECT name,revoked FROM provisioning_keys WHERE id=$1', [req.params.id]))[0];
    if (!key) throw fail('Token not found.', 404);
    await db.query('UPDATE provisioning_keys SET revoked=1 WHERE id=$1', [req.params.id]);
    if (!key.revoked)
      await audit(
        db,
        req.user,
        'key.revoke',
        'provisioning_key',
        req.params.id,
        `Revoked provisioning token ${key.name}`,
      );
    res.json({ok: true});
  });
}

export function setupProvisioning(app, db, env) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.originalUrl.includes('/scim')) res.type('application/scim+json');
    next();
  });
  router.use(async (req, res, next) => {
    const token = req.get('authorization')?.match(/^Bearer (fmxp_([\w-]+)\.[\w-]+)$/)?.[1];
    const id = token?.slice(5).split('.')[0];
    const key = id ? (await db.query('SELECT * FROM provisioning_keys WHERE id=$1', [id]))[0] : null;
    const digest = createHash('sha256')
      .update(token || '')
      .digest();
    if (
      !key ||
      key.revoked ||
      key.expires_at <= new Date().toISOString() ||
      !timingSafeEqual(digest, Buffer.from(key.digest, 'hex'))
    )
      return res.status(401).json({error: 'A valid provisioning bearer token is required.'});
    req.provisioningActor = {id: null, name: `Provisioning · ${key.name}`};
    next();
  });
  router.get('/users', async (req, res) =>
    res.json({users: (await db.query('SELECT * FROM users ORDER BY name')).map(safeUser)}),
  );
  router.post('/users', async (req, res) =>
    res.status(201).json(safeUser(await saveProvisionedUser(db, env, req.body, undefined, req.provisioningActor))),
  );
  router.patch('/users/:id', async (req, res) =>
    res.json(safeUser(await saveProvisionedUser(db, env, req.body, req.params.id, req.provisioningActor))),
  );
  router.get('/groups', async (req, res) =>
    res.json({groups: await db.query('SELECT * FROM user_groups ORDER BY name')}),
  );
  router.use('/scim', scimRouter(db, env));
  app.use('/api/provisioning/v1', router);
  return router;
}
