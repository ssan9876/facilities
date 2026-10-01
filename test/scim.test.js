import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWorkspace} from './helpers.js';

const ext = 'urn:fmx:params:scim:schemas:extension:identity:2.0:User';
const errorSchema = 'urn:ietf:params:scim:api:messages:2.0:Error';

test('SCIM handles discovery, paging, filters, patch paths and errors', async () => {
  const w = await startWorkspace({OIDC_ISSUER: 'https://idp.example/oidc', OIDC_ADMIN_SUBJECT: 'bootstrap'});
  const token = (await w.call('/api/admin/keys', 'POST', {name: 'Syntra', days: 1})).body.secret;
  const scim = async (path, method = 'GET', body) => {
    const res = await fetch(w.base + '/api/provisioning/v1/scim' + path, {
      method,
      headers: {authorization: 'Bearer ' + token, 'content-type': 'application/scim+json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      type: res.headers.get('content-type'),
      body: res.status === 204 ? null : await res.json(),
    };
  };
  const create = (n, extra = {}) =>
    scim('/Users', 'POST', {
      userName: `user${n}`,
      displayName: `User ${n}`,
      emails: [{value: `u${n}@example.test`}],
      [ext]: {subject: `sub-${n}`},
      ...extra,
    });
  try {
    const config = await scim('/ServiceProviderConfig');
    assert.equal(config.body.patch.supported, true);
    assert.match(config.type, /application\/scim\+json/);
    assert.equal((await scim('/Schemas')).body.totalResults, 3);
    assert.equal((await scim('/ResourceTypes')).body.Resources[0].endpoint, '/Users');
    const ids = [];
    for (let i = 1; i <= 5; i++) ids.push((await create(i)).body.id);
    // Paging uses 1-based startIndex and reports the full total.
    const page = (await scim('/Users?startIndex=2&count=2')).body;
    assert.deepEqual([page.totalResults, page.startIndex, page.itemsPerPage], [6, 2, 2]);
    for (const bad of ['startIndex=0', 'count=-1', 'count=5000', 'startIndex=x'])
      assert.equal((await scim('/Users?' + bad)).status, 400, bad);
    // Equality filters are case-insensitive and support escaped quotes.
    assert.equal((await scim('/Users?filter=' + encodeURIComponent('userName eq "USER3"'))).body.totalResults, 1);
    assert.equal((await scim('/Users?filter=' + encodeURIComponent('userName eq "nobody"'))).body.totalResults, 0);
    const unsupported = await scim('/Users?filter=' + encodeURIComponent('userName co "user"'));
    assert.equal(unsupported.status, 400);
    assert.deepEqual(unsupported.body.schemas, [errorSchema]);
    assert.equal(unsupported.body.status, '400');
    // Duplicate identities and usernames conflict.
    assert.equal((await create(1)).status, 409);
    assert.equal((await create(9, {userName: 'user2'})).status, 409);
    assert.equal((await scim('/Users', 'POST', {userName: 'nosub'})).status, 400, 'the immutable subject is required');
    // PATCH paths.
    const id = ids[0];
    const patch = ops =>
      scim('/Users/' + id, 'PATCH', {schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: ops});
    assert.equal(
      (
        await patch([
          {op: 'replace', path: 'name.givenName', value: 'Ada'},
          {op: 'replace', path: 'name.familyName', value: 'Lovelace'},
        ])
      ).body.displayName,
      'Ada Lovelace',
    );
    assert.equal(
      (await patch([{op: 'replace', path: 'emails', value: [{value: 'ada@example.test'}]}])).body.emails[0].value,
      'ada@example.test',
    );
    assert.equal(
      (await patch([{op: 'replace', value: {displayName: 'Countess', active: true}}])).body.displayName,
      'Countess',
      'path-less replace',
    );
    assert.equal((await patch([{op: 'remove', path: 'displayName'}])).status, 400);
    assert.equal((await patch([{op: 'replace', path: 'title', value: 'x'}])).status, 400);
    assert.equal((await patch([])).status, 400);
    assert.equal((await patch([{op: 'replace', path: 'active', value: 'yes'}])).status, 400, 'active must be boolean');
    assert.equal(
      (await scim('/Users/missing', 'PATCH', {Operations: [{op: 'replace', path: 'active', value: false}]})).status,
      404,
    );
    // PUT replaces the profile but never the subject.
    const put = await scim('/Users/' + id, 'PUT', {
      userName: 'ada',
      displayName: 'Ada L',
      active: true,
      [ext]: {subject: 'sub-1'},
    });
    assert.equal(put.body.userName, 'ada');
    assert.equal((await scim('/Users/' + id, 'PUT', {userName: 'ada', [ext]: {subject: 'changed'}})).status, 400);
    // DELETE deactivates rather than erasing history.
    assert.equal((await scim('/Users/' + ids[1], 'DELETE')).status, 204);
    assert.equal((await scim('/Users/' + ids[1])).body.active, false);
    assert.equal((await w.db.query('SELECT active FROM users WHERE id=$1', [ids[1]]))[0].active, 0);
    // The protected bootstrap administrator cannot be modified.
    assert.equal(
      (await scim('/Users/demo-admin', 'PATCH', {Operations: [{op: 'replace', path: 'active', value: false}]})).status,
      403,
    );
    // Groups: filters, unknown members and membership removal of provisioning-sourced rows only.
    const group = (await w.call('/api/admin/groups', 'POST', {name: 'Technicians'})).body.id;
    assert.equal(
      (await scim('/Groups?filter=' + encodeURIComponent('displayName eq "technicians"'))).body.totalResults,
      1,
    );
    assert.equal(
      (
        await scim(`/Groups/${group}`, 'PATCH', {
          Operations: [{op: 'add', path: 'members', value: [{value: 'nobody'}]}],
        })
      ).status,
      400,
    );
    assert.equal(
      (await scim(`/Groups/${group}`, 'PATCH', {Operations: [{op: 'replace', path: 'displayName', value: 'x'}]}))
        .status,
      400,
    );
    assert.equal(
      (
        await scim(`/Groups/${group}`, 'PATCH', {
          Operations: [{op: 'add', path: 'members', value: ids.slice(2).map(value => ({value}))}],
        })
      ).body.members.length,
      3,
    );
    assert.equal(
      (await scim(`/Groups/${group}`, 'PATCH', {Operations: [{op: 'remove', path: `members[value eq "${ids[2]}"]`}]}))
        .body.members.length,
      2,
    );
    assert.equal((await scim('/Groups/missing')).status, 404);
    // Every provisioning change is attributed to the connection in the audit log.
    const audit = (await w.call('/api/admin/audit')).body.entries;
    assert.ok(audit.some(e => e.actor_name === 'Provisioning · Syntra' && e.action === 'user.provision'));
    assert.ok(audit.some(e => e.actor_name === 'Provisioning · Syntra' && e.action === 'user.disable'));
    assert.ok(audit.some(e => e.actor_name === 'Provisioning · Syntra' && e.action === 'group.sync'));
    // Expired tokens stop working.
    await w.db.query('UPDATE provisioning_keys SET expires_at=$1', [new Date(Date.now() - 1000).toISOString()]);
    assert.equal((await scim('/Users')).status, 401);
  } finally {
    await w.close();
  }
});
