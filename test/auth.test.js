import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair, SignJWT, exportJWK, createLocalJWKSet} from 'jose';
import {resolveGroups, isGroupOverage, verifyLogoutToken, purgeExpiredSessions, roleForClaims} from '../auth.js';
import {revokeSessions} from '../administration.js';
import {startWorkspace} from './helpers.js';

const issuer = 'https://idp.example/oidc',
  audience = 'facilities-client';
async function keys() {
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const jwk = {...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256'};
  return {privateKey, jwks: createLocalJWKSet({keys: [jwk]})};
}
const logoutToken = (privateKey, claims = {}, {aud = audience, iss = issuer, typ = 'logout+jwt'} = {}) =>
  new SignJWT({events: {'http://schemas.openid.net/event/backchannel-logout': {}}, jti: crypto.randomUUID(), ...claims})
    .setProtectedHeader({alg: 'RS256', kid: 'k1', typ})
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .sign(privateKey);

test('sessions expire after eight hours and expired rows are purged', async () => {
  const w = await startWorkspace();
  try {
    assert.equal((await w.call('/api/data')).status, 200);
    const row = (await w.db.query('SELECT expires_at,user_id FROM sessions WHERE id=$1', [w.sessionId]))[0];
    const lifetime = Date.parse(row.expires_at) - Date.now();
    assert.ok(lifetime > 7.9 * 3600000 && lifetime <= 8 * 3600000, 'sliding eight-hour lifetime');
    assert.equal(row.user_id, 'demo-admin', 'sessions record their user for revocation');
    await w.db.query('UPDATE sessions SET expires_at=$1', [new Date(Date.now() - 1000).toISOString()]);
    assert.equal((await w.call('/api/data')).status, 401);
    await purgeExpiredSessions(w.db);
    assert.equal((await w.db.query('SELECT * FROM sessions')).length, 0);
  } finally {
    await w.close();
  }
});

test('revoking a user ends indexed and legacy sessions', async () => {
  const w = await startWorkspace();
  try {
    const future = new Date(Date.now() + 60000).toISOString();
    await w.db.query('INSERT INTO sessions(id,body,expires_at) VALUES($1,$2,$3)', [
      'legacy',
      JSON.stringify({userId: 'demo-admin'}),
      future,
    ]);
    await w.db.query('INSERT INTO sessions(id,body,expires_at,user_id) VALUES($1,$2,$3,$4)', [
      'other',
      JSON.stringify({userId: 'x'}),
      future,
      'x',
    ]);
    await revokeSessions(w.db, 'demo-admin');
    assert.deepEqual(
      (await w.db.query('SELECT id FROM sessions')).map(r => r.id),
      ['other'],
    );
  } finally {
    await w.close();
  }
});

test('Entra ID group overage is resolved through Microsoft Graph only when enabled', async () => {
  const overage = {
    sub: 'u1',
    _claim_names: {groups: 'src1'},
    _claim_sources: {src1: {endpoint: 'https://evil.example/groups'}},
  };
  assert.equal(isGroupOverage(overage), true);
  assert.equal(isGroupOverage({sub: 'u1', groups: ['a']}), false);
  assert.equal(isGroupOverage({sub: 'u1', hasgroups: 'true'}), true);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, init});
    return new Response(JSON.stringify({value: ['admins-object-id', 'other']}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  };
  const warnings = [];
  assert.equal(
    await resolveGroups(overage, 'token', {}, {fetchImpl, logger: {warn: m => warnings.push(m)}}),
    undefined,
  );
  assert.equal(calls.length, 0);
  assert.equal(warnings.length, 1);
  const groups = await resolveGroups(overage, 'token', {OIDC_GROUPS_OVERAGE: 'graph'}, {fetchImpl});
  assert.deepEqual(groups, ['admins-object-id', 'other']);
  assert.equal(
    calls[0].url,
    'https://graph.microsoft.com/v1.0/me/getMemberObjects',
    'token-supplied endpoints are ignored',
  );
  assert.equal(calls[0].init.headers.authorization, 'Bearer token');
  assert.equal(roleForClaims({sub: 'u1', groups}, {OIDC_ADMIN_GROUP: 'admins-object-id'}), 'admin');
  assert.deepEqual(
    await resolveGroups({sub: 'u1', groups: ['x']}, 'token', {OIDC_GROUPS_OVERAGE: 'graph'}, {fetchImpl}),
    ['x'],
    'no lookup without overage',
  );
  const failing = async () => new Response('nope', {status: 403});
  await assert.rejects(
    resolveGroups(overage, 'token', {OIDC_GROUPS_OVERAGE: 'graph'}, {fetchImpl: failing}),
    /Microsoft Graph/,
  );
});

test('back-channel logout tokens are validated strictly', async () => {
  const {privateKey, jwks} = await keys();
  const ok = await verifyLogoutToken(await logoutToken(privateKey, {sub: 'user-1', sid: 's-1'}), {
    issuer,
    audience,
    keys: jwks,
  });
  assert.equal(ok.sid, 's-1');
  const bad = async (token, pattern) =>
    assert.rejects(verifyLogoutToken(await token, {issuer, audience, keys: jwks}), pattern);
  await bad(logoutToken(privateKey, {sub: 'u', nonce: 'n'}), /nonce/);
  await bad(logoutToken(privateKey, {}), /sub or sid/);
  await bad(logoutToken(privateKey, {sub: 'u'}, {aud: 'someone-else'}), /aud/);
  await bad(logoutToken(privateKey, {sub: 'u'}, {iss: 'https://attacker.example'}), /iss/);
  await bad(logoutToken(privateKey, {sub: 'u', events: {}}), /event/);
  await bad(logoutToken(privateKey, {sub: 'u'}, {typ: 'at+jwt'}), /type/);
  const other = await keys();
  await bad(logoutToken(other.privateKey, {sub: 'u'}), /signature/);
});

test('the identity provider can end sessions through the back-channel endpoint', async () => {
  const {privateKey, jwks} = await keys();
  const w = await startWorkspace({OIDC_ISSUER: issuer, OIDC_CLIENT_ID: audience}, {logoutKeys: jwks});
  const post = token =>
    fetch(w.base + '/auth/backchannel-logout', {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams(token === undefined ? {} : {logout_token: token}),
    });
  try {
    const future = new Date(Date.now() + 60000).toISOString();
    await w.db.query(
      "INSERT INTO users(id,subject,name,email,role) VALUES('sso','https://idp.example/oidc|user-1','SSO User','','requester')",
    );
    for (const [id, sid] of [
      ['a', 'sid-a'],
      ['b', 'sid-b'],
    ])
      await w.db.query(
        'INSERT INTO sessions(id,body,expires_at,user_id,oidc_subject,oidc_sid) VALUES($1,$2,$3,$4,$5,$6)',
        [id, JSON.stringify({userId: 'sso'}), future, 'sso', `${issuer}|user-1`, sid],
      );
    await w.db.query(
      'INSERT INTO sessions(id,body,expires_at,user_id,oidc_subject,oidc_sid) VALUES($1,$2,$3,$4,$5,$6)',
      ['foreign', '{}', future, 'x', 'https://other-idp|user-1', 'sid-a'],
    );
    assert.equal((await post()).status, 400);
    assert.equal((await post('not-a-jwt')).status, 400);
    const bySid = await logoutToken(privateKey, {sid: 'sid-a'});
    const res = await post(bySid);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(
      (await w.db.query('SELECT id FROM sessions ORDER BY id')).map(r => r.id).filter(id => id !== w.sessionId),
      ['b', 'foreign'],
      'only the matching issuer session ends',
    );
    assert.equal((await post(bySid)).status, 400, 'replayed tokens are refused');
    assert.equal((await post(await logoutToken(privateKey, {sub: 'user-1'}))).status, 200);
    assert.ok(
      !(await w.db.query('SELECT id FROM sessions')).some(r => r.id === 'b'),
      'subject logout ends every session for that user',
    );
    assert.ok(
      (await w.call('/api/admin/audit?q=identity')).body.entries.some(e => e.action === 'auth.backchannel_logout'),
    );
    // The endpoint needs no cookie or CSRF token, and other POSTs still require them.
    assert.equal((await fetch(w.base + '/api/orders', {method: 'POST'})).status, 401);
  } finally {
    await w.close();
  }
});
