import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../db.js';
import {createApp} from '../server.js';

test('REST and SCIM provisioning protect identities, revoke access and preserve manual groups', async () => {
  const db = await openDatabase(null, ':memory:');
  const {app} = await createApp(
    {AUTH_MODE: 'demo', OIDC_ISSUER: 'https://idp.example/oidc', OIDC_ADMIN_SUBJECT: 'bootstrap'},
    db,
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '',
    csrf = '',
    token = '';
  const call = async (path, method = 'GET', body, bearer = false) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        cookie: bearer ? '' : cookie,
        'x-csrf-token': csrf,
        'Content-Type': path.includes('/scim') ? 'application/scim+json' : 'application/json',
        ...(bearer ? {authorization: 'Bearer ' + token} : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.headers.get('set-cookie') && !bearer) cookie = res.headers.get('set-cookie').split(';')[0];
    return {status: res.status, data: res.status === 204 || res.status === 302 ? null : await res.json()};
  };
  try {
    await call('/auth/login');
    csrf = (await call('/api/me')).data.csrf;
    assert.equal(
      (
        await call('/api/admin/workspace', 'PUT', {
          name: 'Campus',
          welcome: 'Welcome to campus.',
          icon: 'calendar',
          provisioned_only: true,
        })
      ).status,
      200,
    );
    assert.equal((await call('/api/me')).data.organization, 'Campus');
    const g = (await call('/api/admin/groups', 'POST', {name: 'Everyone', auto_assign: true})).data.id;
    const key = await call('/api/admin/keys', 'POST', {name: 'Syntra', days: 30});
    token = key.data.secret;
    assert.equal((await call('/api/admin')).data.keys[0].digest, undefined);
    assert.notEqual((await db.query('SELECT digest FROM provisioning_keys'))[0].digest, token);
    const root = '/api/provisioning/v1',
      scim = root + '/scim',
      ext = 'urn:fmx:params:scim:schemas:extension:identity:2.0:User';
    assert.equal((await call(root + '/users')).status, 401);
    assert.equal(
      (await call(root + '/users', 'POST', {oidc_subject: 'bootstrap', name: 'Protected'}, true)).status,
      403,
    );
    const created = await call(
      scim + '/Users',
      'POST',
      {
        userName: 'ada',
        displayName: 'Ada',
        externalId: 'syntra-action-marker',
        active: true,
        [ext]: {subject: 'immutable-ada'},
      },
      true,
    );
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.equal(created.data[ext].subject, 'immutable-ada');
    assert.deepEqual(created.data.groups, [{value: g}]);
    assert.equal(
      (await call(scim + '/Users?filter=' + encodeURIComponent('userName eq "ada"'), 'GET', undefined, true)).data
        .totalResults,
      1,
    );
    assert.equal((await call(root + '/users/' + id, 'PATCH', {oidc_subject: 'changed'}, true)).status, 400);
    assert.equal((await call(root + '/users/' + id, 'PATCH', {role: 'admin'}, true)).status, 400);
    await call('/api/admin/groups/' + g + '/members/' + id, 'PUT', {member: true});
    await call(root + '/users/' + id, 'PATCH', {group_ids: []}, true);
    assert.ok((await db.query("SELECT * FROM group_members WHERE user_id=$1 AND source='manual'", [id])).length);
    const now = new Date(Date.now() + 60000).toISOString();
    await db.query('INSERT INTO sessions(id,body,expires_at) VALUES($1,$2,$3)', [
      'disabled-test',
      JSON.stringify({userId: id}),
      now,
    ]);
    assert.equal(
      (await call(scim + '/Users/' + id, 'PATCH', {Operations: [{op: 'replace', path: 'active', value: false}]}, true))
        .status,
      200,
    );
    assert.equal((await db.query('SELECT * FROM sessions WHERE id=$1', ['disabled-test'])).length, 0);
    assert.equal(
      (await call(scim + '/Users/' + id, 'PATCH', {Operations: [{op: 'replace', path: 'active', value: true}]}, true))
        .data.active,
      true,
    );
    assert.equal(
      (
        await call(
          scim + '/Groups/' + g,
          'PATCH',
          {Operations: [{op: 'add', path: 'members', value: [{value: id}]}]},
          true,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          scim + '/Groups/' + g,
          'PATCH',
          {Operations: [{op: 'remove', path: `members[value eq "${id}"]`}]},
          true,
        )
      ).status,
      200,
    );
    assert.ok((await db.query("SELECT * FROM group_members WHERE user_id=$1 AND source='manual'", [id])).length);
    await call('/api/admin/keys/' + key.data.id, 'DELETE');
    assert.equal((await call(root + '/users', 'GET', undefined, true)).status, 401);
    await db.query("UPDATE users SET role='requester' WHERE id='demo-admin'");
    assert.equal((await call('/api/admin')).status, 403);
  } finally {
    await new Promise(r => server.close(r));
    await db.close();
  }
});
