import express from 'express';
import session from 'express-session';
import * as oidc from 'openid-client';
import {createRemoteJWKSet, jwtVerify} from 'jose';
import {randomUUID, randomBytes} from 'node:crypto';
import {defaultTimezone} from './dates.js';
import {setupProvisioning, workspaceSettings} from './administration.js';
import {audit} from './audit.js';
import {capabilitiesFor} from './permissions.js';

// Only same-origin paths are honoured after sign-in, so a link cannot redirect elsewhere.
export const safeReturn = value =>
  typeof value === 'string' && /^\/(?![/\\])[\w\-./?=&%]*$/.test(value) && value.length < 500 ? value : '/';

export function roleForClaims(claims, env = process.env) {
  const groups = Array.isArray(claims.groups)
    ? claims.groups.filter(x => typeof x === 'string')
    : typeof claims.groups === 'string'
      ? [claims.groups]
      : [];
  const allowed = (env.OIDC_ALLOWED_GROUPS || '').split(/\s+/).filter(Boolean);
  if (allowed.length && !allowed.some(g => groups.includes(g)))
    throw Object.assign(new Error('Your account is not in an allowed organization group.'), {status: 403});
  if (
    (env.OIDC_ADMIN_SUBJECT && claims.sub === env.OIDC_ADMIN_SUBJECT) ||
    groups.includes(env.OIDC_ADMIN_GROUP || 'facilities-admins')
  )
    return 'admin';
  if (groups.includes(env.OIDC_MANAGER_GROUP || 'facilities-managers')) return 'manager';
  if (groups.includes(env.OIDC_TECHNICIAN_GROUP || 'facilities-technicians')) return 'technician';
  return 'requester';
}

// Microsoft Entra ID omits the groups claim when a user is in too many groups ("overage") and
// points to Graph instead. With OIDC_GROUPS_OVERAGE=graph the signed-in user's memberships are read
// from Microsoft Graph /me/getMemberObjects (delegated User.Read). The endpoint is fixed; the
// token-supplied _claim_sources URL is never followed.
export const isGroupOverage = claims =>
  !claims.groups && (!!claims._claim_names?.groups || claims.hasgroups === true || claims.hasgroups === 'true');
export async function resolveGroups(claims, accessToken, env, {fetchImpl = fetch, logger} = {}) {
  if (!isGroupOverage(claims)) return claims.groups;
  if (env.OIDC_GROUPS_OVERAGE !== 'graph') {
    logger?.warn('identity provider reported group overage; set OIDC_GROUPS_OVERAGE=graph to look up memberships', {
      sub: claims.sub,
    });
    return undefined;
  }
  const response = await fetchImpl('https://graph.microsoft.com/v1.0/me/getMemberObjects', {
    method: 'POST',
    headers: {authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json'},
    body: JSON.stringify({securityEnabledOnly: false}),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok)
    throw Object.assign(
      new Error(
        'Your group memberships could not be read from Microsoft Graph. Try again or contact your administrator.',
      ),
      {status: 502},
    );
  const body = await response.json();
  if (!Array.isArray(body.value))
    throw Object.assign(new Error('Microsoft Graph returned an unexpected group response.'), {status: 502});
  return body.value.filter(x => typeof x === 'string');
}

const logoutEvent = 'http://schemas.openid.net/event/backchannel-logout';
const asymmetric = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
// OpenID Connect Back-Channel Logout 1.0 §2.6 validation.
export async function verifyLogoutToken(token, {issuer, audience, keys}) {
  const {payload, protectedHeader} = await jwtVerify(token, keys, {
    issuer,
    audience,
    algorithms: asymmetric,
    maxTokenAge: '5m',
    clockTolerance: 60,
  });
  if (protectedHeader.typ && !['logout+jwt', 'JWT'].includes(protectedHeader.typ))
    throw new Error('Unexpected logout token type.');
  if (typeof payload.events !== 'object' || !payload.events || typeof payload.events[logoutEvent] !== 'object')
    throw new Error('Missing back-channel logout event.');
  if (!payload.sub && !payload.sid) throw new Error('Logout token needs sub or sid.');
  if ('nonce' in payload) throw new Error('Logout tokens must not contain a nonce.');
  if (!payload.jti) throw new Error('Logout token needs jti.');
  return payload;
}
export async function revokeOidcSessions(db, {issuer, sub, sid}) {
  const subject = sub ? `${issuer}|${sub}` : null;
  const rows = sid
    ? await db.query('SELECT id,oidc_subject FROM sessions WHERE oidc_sid=$1', [sid])
    : await db.query('SELECT id,oidc_subject FROM sessions WHERE oidc_subject=$1', [subject]);
  const matching = rows.filter(r => (subject ? r.oidc_subject === subject : r.oidc_subject?.startsWith(issuer + '|')));
  for (const row of matching) await db.query('DELETE FROM sessions WHERE id=$1', [row.id]);
  return matching.length;
}
export const purgeExpiredSessions = async db =>
  db.query('DELETE FROM sessions WHERE expires_at<=$1', [new Date().toISOString()]);
export const sessionLifetimeMs = 8 * 3600000;

export async function setupAuth(app, db, env, {logger, logoutKeys} = {}) {
  const mode = env.AUTH_MODE || 'oidc';
  if (!['demo', 'oidc'].includes(mode)) throw new Error('AUTH_MODE must be demo or oidc.');
  if (env.NODE_ENV === 'production' && mode !== 'oidc')
    throw new Error('Demo authentication is disabled in production.');
  if (
    env.NODE_ENV === 'production' &&
    (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('replace-'))
  )
    throw new Error('Set a random SESSION_SECRET of at least 32 characters.');
  const appUrl = new URL(env.APP_URL || 'http://localhost:3000');
  const timezone = env.ORG_TIMEZONE || defaultTimezone;
  new Intl.DateTimeFormat('en-US', {timeZone: timezone}).format();
  if (env.NODE_ENV === 'production' && appUrl.protocol !== 'https:')
    throw new Error('Production APP_URL must use HTTPS.');
  if (env.NODE_ENV === 'production' && (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET))
    throw new Error('Production requires OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.');
  if (env.OIDC_GROUPS_OVERAGE && env.OIDC_GROUPS_OVERAGE !== 'graph')
    throw new Error('OIDC_GROUPS_OVERAGE must be graph or empty.');
  // SSO state cookies and callback URLs must share one canonical browser origin.
  // The health route is registered before this middleware for loopback probes.
  if (env.NODE_ENV === 'production')
    app.use((req, res, next) => {
      if (req.get('host')?.toLowerCase() !== appUrl.host.toLowerCase())
        return res.redirect(308, appUrl.origin + req.originalUrl);
      next();
    });
  setupProvisioning(app, db, env);
  let config;
  const getConfig = async () => {
    if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET)
      throw Object.assign(new Error('SSO is not configured. Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.'), {
        status: 503,
      });
    return (config ||= await oidc.discovery(new URL(env.OIDC_ISSUER), env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET));
  };

  // The identity provider calls this server-to-server when a user signs out there or is disabled.
  // It carries no session cookie or CSRF token; the signed logout token is the credential.
  const seenLogoutTokens = new Map();
  let remoteKeys;
  app.post('/auth/backchannel-logout', express.urlencoded({extended: false, limit: '16kb'}), async (req, res) => {
    const reject = description => res.status(400).json({error: 'invalid_request', error_description: description});
    if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID)
      return res.status(501).json({error: 'invalid_request', error_description: 'SSO is not configured.'});
    if (typeof req.body?.logout_token !== 'string') return reject('logout_token is required.');
    let claims, issuer;
    try {
      if (logoutKeys) issuer = env.OIDC_ISSUER;
      else {
        const metadata = (await getConfig()).serverMetadata();
        issuer = metadata.issuer;
        remoteKeys ||= createRemoteJWKSet(new URL(metadata.jwks_uri));
      }
      claims = await verifyLogoutToken(req.body.logout_token, {
        issuer,
        audience: env.OIDC_CLIENT_ID,
        keys: logoutKeys || remoteKeys,
      });
    } catch (err) {
      logger?.warn('rejected back-channel logout token', {error: err.message});
      return reject('The logout token is invalid.');
    }
    const now = Date.now();
    for (const [jti, expires] of seenLogoutTokens) if (expires < now) seenLogoutTokens.delete(jti);
    if (seenLogoutTokens.has(claims.jti)) return reject('The logout token was already used.');
    seenLogoutTokens.set(claims.jti, now + 10 * 60000);
    const ended = await revokeOidcSessions(db, {issuer: env.OIDC_ISSUER, sub: claims.sub, sid: claims.sid});
    const user = claims.sub
      ? (await db.query('SELECT id,name FROM users WHERE subject=$1', [`${env.OIDC_ISSUER}|${claims.sub}`]))[0]
      : null;
    await audit(
      db,
      {id: null, name: 'Identity provider'},
      'auth.backchannel_logout',
      'user',
      user?.id,
      `Identity provider signed out ${user?.name || 'a user'} (${ended} session${ended === 1 ? '' : 's'})`,
    );
    res.set('Cache-Control', 'no-store').status(200).end();
  });

  class Store extends session.Store {
    get(id, cb) {
      db.query('SELECT body FROM sessions WHERE id=$1 AND expires_at>$2', [id, new Date().toISOString()])
        .then(rows => cb(null, rows[0] ? JSON.parse(rows[0].body) : null))
        .catch(cb);
    }
    set(id, value, cb) {
      // Indexed identity columns let administrators and the identity provider end sessions directly.
      const identity = value.oidcIdentity || {};
      db.query(
        'INSERT INTO sessions(id,body,expires_at,user_id,oidc_subject,oidc_sid) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET body=$2, expires_at=$3, user_id=$4, oidc_subject=$5, oidc_sid=$6',
        [
          id,
          JSON.stringify(value),
          new Date(Date.now() + sessionLifetimeMs).toISOString(),
          value.userId || null,
          identity.subject || null,
          identity.sid || null,
        ],
      )
        .then(() => cb?.())
        .catch(cb);
    }
    destroy(id, cb) {
      db.query('DELETE FROM sessions WHERE id=$1', [id])
        .then(() => cb?.())
        .catch(cb);
    }
    touch(id, value, cb) {
      this.set(id, value, cb);
    }
  }
  app.use(
    session({
      name: 'facilities.sid',
      store: new Store(),
      secret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      cookie: {httpOnly: true, sameSite: 'lax', secure: appUrl.protocol === 'https:', maxAge: sessionLifetimeMs},
    }),
  );
  const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(e => (e ? reject(e) : resolve())));
  const save = req => new Promise((resolve, reject) => req.session.save(e => (e ? reject(e) : resolve())));
  app.get('/auth/login', async (req, res) => {
    const returnTo = safeReturn(req.query.return);
    if (mode === 'demo') {
      const user = (await db.query('SELECT * FROM users WHERE subject=$1', ['demo-admin']))[0];
      await regenerate(req);
      req.session.userId = user.id;
      await save(req);
      await audit(db, user, 'auth.login', 'user', user.id, 'Signed in (demo)');
      return res.redirect(returnTo);
    }
    const c = await getConfig();
    req.session.oidc = {
      verifier: oidc.randomPKCECodeVerifier(),
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      at: Date.now(),
      returnTo,
    };
    const {verifier, state, nonce} = req.session.oidc;
    const target = oidc.buildAuthorizationUrl(c, {
      redirect_uri: new URL('/auth/callback', appUrl).href,
      scope: 'openid profile email',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    await save(req);
    res.redirect(target.href);
  });
  app.get('/auth/callback', async (req, res) => {
    const pending = req.session.oidc;
    delete req.session.oidc;
    await save(req);
    if (!pending || Date.now() - pending.at > 600000)
      throw Object.assign(new Error('Sign-in expired. Please sign in again.'), {status: 400});
    const tokens = await oidc.authorizationCodeGrant(await getConfig(), new URL(req.originalUrl, appUrl), {
      pkceCodeVerifier: pending.verifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });
    const identity = tokens.claims();
    // Some providers release profile and group mappings through UserInfo.
    // openid-client validates the returned subject against the signed ID token.
    const c = await getConfig();
    const profile = c.serverMetadata().userinfo_endpoint
      ? await oidc.fetchUserInfo(c, tokens.access_token, identity.sub)
      : {};
    const claims = {...profile, ...identity};
    const groups = await resolveGroups(claims, tokens.access_token, env, {logger});
    if (groups !== undefined) claims.groups = groups;
    let role;
    try {
      role = roleForClaims(claims, env);
    } catch (err) {
      logger?.warn('sign-in denied', {reason: err.message, sub: claims.sub});
      throw err;
    }
    const subject = `${claims.iss}|${claims.sub}`;
    let user = (await db.query('SELECT * FROM users WHERE subject=$1', [subject]))[0];
    if (user && !user.active)
      throw Object.assign(new Error('Your FMX account is disabled. Contact your administrator.'), {status: 403});
    if (!user && (await workspaceSettings(db)).provisioned_only && claims.sub !== env.OIDC_ADMIN_SUBJECT)
      throw Object.assign(new Error('Your FMX account must be provisioned before you can sign in.'), {status: 403});
    if (!user) {
      user = {id: randomUUID(), name: claims.name || claims.preferred_username || 'Team member'};
      await db.query('INSERT INTO users(id,subject,name,email,role) VALUES($1,$2,$3,$4,$5)', [
        user.id,
        subject,
        user.name,
        claims.email || '',
        role,
      ]);
      await audit(db, user, 'user.create', 'user', user.id, `${user.name} joined through SSO as ${role}`);
    } else if (!user.managed) {
      if (user.role !== role)
        await audit(
          db,
          {id: null, name: 'Identity provider'},
          'user.role',
          'user',
          user.id,
          `${user.name}'s role changed from ${user.role} to ${role} at sign-in`,
          {role: [user.role, role]},
        );
      await db.query('UPDATE users SET name=$1,email=$2,role=$3 WHERE id=$4', [
        claims.name || 'Team member',
        claims.email || '',
        role,
        user.id,
      ]);
    }
    await regenerate(req);
    req.session.userId = user.id;
    req.session.oidcIdentity = {subject, sid: typeof claims.sid === 'string' ? claims.sid : null};
    await save(req);
    await audit(db, user, 'auth.login', 'user', user.id, 'Signed in');
    res.redirect(safeReturn(pending.returnTo));
  });
  app.use(async (req, res, next) => {
    if (req.session.userId)
      req.user = (
        await db.query('SELECT id,name,email,role FROM users WHERE id=$1 AND active=1', [req.session.userId])
      )[0];
    // Capabilities are resolved per request, so role changes apply immediately.
    if (req.user) {
      req.user.capabilities = capabilitiesFor(db, req.user.role);
      req.user.role_name = db.roles?.[req.user.role]?.name || req.user.role;
    }
    next();
  });
  app.get('/api/me', async (req, res) => {
    req.session.csrf ||= randomBytes(24).toString('hex');
    const branding = await workspaceSettings(db);
    res.json({
      user: req.user || null,
      csrf: req.session.csrf,
      organization: branding.name || env.ORG_NAME || 'My Organization',
      branding,
      timezone,
      mode,
    });
  });
  app.use('/api', (req, res, next) => {
    if (!req.user) return res.status(401).json({error: 'Sign in to continue.'});
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (!req.session.csrf || req.get('x-csrf-token') !== req.session.csrf)
    )
      return res.status(403).json({error: 'Session expired. Refresh the page and try again.'});
    next();
  });
  app.post('/api/logout', (req, res, next) => {
    const user = req.user;
    req.session.destroy(e =>
      e
        ? next(e)
        : audit(db, user, 'auth.logout', 'user', user.id, 'Signed out').then(
            () => res.clearCookie('facilities.sid').json({ok: true}),
            next,
          ),
    );
  });
}
