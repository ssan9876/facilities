import test from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions, setupReleases} from '../releases.js';
test('stable release versions compare numerically and reject prereleases', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.1.0', '1.0.0'), -1);
  assert.throws(() => compareVersions('1.0.0-beta', '0.1.0'));
});
test('release checks are admin-only and repository configuration cannot change the request host', async () => {
  let handler;
  setupReleases({get: (_path, fn) => (handler = fn)}, {RELEASE_REPOSITORY: 'https://attacker.invalid'});
  let status, body;
  const res = {
    status(n) {
      status = n;
      return this;
    },
    json(b) {
      body = b;
      return this;
    },
  };
  await handler({user: {role: 'manager'}}, res);
  assert.equal(status, 403);
  await handler({user: {role: 'admin'}}, res);
  assert.equal(status, 503);
  assert.match(body.error, /repository/);
});
