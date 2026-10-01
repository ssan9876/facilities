import session from 'express-session';
import * as oidc from 'openid-client';
import {randomUUID, randomBytes} from 'node:crypto';
import {defaultTimezone} from './dates.js';

export function roleForClaims(claims, env = process.env) {
  const groups = Array.isArray(claims.groups) ? claims.groups.filter(x => typeof x === 'string') : typeof claims.groups==='string' ? [claims.groups] : [];
  const allowed = (env.OIDC_ALLOWED_GROUPS || '').split(/\s+/).filter(Boolean);
  if (allowed.length && !allowed.some(g => groups.includes(g))) throw Object.assign(new Error('Your account is not in an allowed organization group.'), {status: 403});
  if ((env.OIDC_ADMIN_SUBJECT && claims.sub === env.OIDC_ADMIN_SUBJECT) || groups.includes(env.OIDC_ADMIN_GROUP || 'facilities-admins')) return 'admin';
  if (groups.includes(env.OIDC_MANAGER_GROUP || 'facilities-managers')) return 'manager';
  if (groups.includes(env.OIDC_TECHNICIAN_GROUP || 'facilities-technicians')) return 'technician';
  return 'requester';
}

export async function setupAuth(app, db, env) {
  const mode = env.AUTH_MODE || 'oidc';
  if (!['demo', 'oidc'].includes(mode)) throw new Error('AUTH_MODE must be demo or oidc.');
  if (env.NODE_ENV === 'production' && mode !== 'oidc') throw new Error('Demo authentication is disabled in production.');
  if (env.NODE_ENV === 'production' && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('replace-'))) throw new Error('Set a random SESSION_SECRET of at least 32 characters.');
  const appUrl = new URL(env.APP_URL || 'http://localhost:3000');
  const timezone=env.ORG_TIMEZONE||defaultTimezone;
  new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();
  if (env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') throw new Error('Production APP_URL must use HTTPS.');
  if (env.NODE_ENV === 'production' && (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET)) throw new Error('Production requires OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.');
  // SSO state cookies and callback URLs must share one canonical browser origin.
  // The health route is registered before this middleware for loopback probes.
  if(env.NODE_ENV==='production') app.use((req,res,next)=>{
    if(req.get('host')?.toLowerCase()!==appUrl.host.toLowerCase()) return res.redirect(308,appUrl.origin+req.originalUrl);
    next();
  });
  class Store extends session.Store {
    get(id, cb) { db.query('SELECT body FROM sessions WHERE id=$1 AND expires_at>$2', [id, new Date().toISOString()]).then(rows => cb(null, rows[0] ? JSON.parse(rows[0].body) : null)).catch(cb); }
    set(id, value, cb) { db.query('INSERT INTO sessions(id,body,expires_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET body=$2, expires_at=$3', [id, JSON.stringify(value), new Date(Date.now()+8*3600000).toISOString()]).then(() => cb?.()).catch(cb); }
    destroy(id, cb) { db.query('DELETE FROM sessions WHERE id=$1', [id]).then(() => cb?.()).catch(cb); }
    touch(id, value, cb) { this.set(id, value, cb); }
  }
  app.use(session({name:'facilities.sid', store:new Store(), secret:env.SESSION_SECRET || randomBytes(32).toString('hex'), resave:false, saveUninitialized:false, cookie:{httpOnly:true, sameSite:'lax', secure:appUrl.protocol==='https:', maxAge:8*3600000}}));
  let config;
  const getConfig = async () => {
    if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) throw Object.assign(new Error('SSO is not configured. Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.'), {status:503});
    return config ||= await oidc.discovery(new URL(env.OIDC_ISSUER), env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET);
  };
  const regenerate = req => new Promise((resolve,reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
  const save = req => new Promise((resolve,reject) => req.session.save(e => e ? reject(e) : resolve()));
  app.get('/auth/login', async (req,res) => {
    if (mode === 'demo') {
      const user = (await db.query("SELECT * FROM users WHERE subject=$1", ['demo-admin']))[0];
      await regenerate(req); req.session.userId=user.id; await save(req); return res.redirect('/');
    }
    const c = await getConfig();
    req.session.oidc = {verifier:oidc.randomPKCECodeVerifier(), state:oidc.randomState(), nonce:oidc.randomNonce(), at:Date.now()};
    const {verifier,state,nonce} = req.session.oidc;
    const target = oidc.buildAuthorizationUrl(c, {redirect_uri:new URL('/auth/callback', appUrl).href, scope:'openid profile email', code_challenge:await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method:'S256', state, nonce});
    await save(req); res.redirect(target.href);
  });
  app.get('/auth/callback', async (req,res) => {
    const pending = req.session.oidc;
    delete req.session.oidc; await save(req);
    if (!pending || Date.now()-pending.at>600000) throw Object.assign(new Error('Sign-in expired. Please sign in again.'), {status:400});
    const tokens = await oidc.authorizationCodeGrant(await getConfig(), new URL(req.originalUrl, appUrl), {pkceCodeVerifier:pending.verifier, expectedState:pending.state, expectedNonce:pending.nonce, idTokenExpected:true});
    const identity = tokens.claims();
    // Some providers release profile and group mappings through UserInfo.
    // openid-client validates the returned subject against the signed ID token.
    const c=await getConfig();
    const profile=c.serverMetadata().userinfo_endpoint ? await oidc.fetchUserInfo(c,tokens.access_token,identity.sub) : {};
    const claims = {...profile,...identity};
    const role = roleForClaims(claims,env);
    const subject = `${claims.iss}|${claims.sub}`;
    let user = (await db.query('SELECT * FROM users WHERE subject=$1', [subject]))[0];
    if (!user) {
      user={id:randomUUID()};
      await db.query('INSERT INTO users(id,subject,name,email,role) VALUES($1,$2,$3,$4,$5)', [user.id,subject,claims.name || claims.preferred_username || 'Team member',claims.email || '',role]);
    } else await db.query('UPDATE users SET name=$1,email=$2,role=$3 WHERE id=$4', [claims.name || 'Team member',claims.email || '',role,user.id]);
    await regenerate(req); req.session.userId=user.id; await save(req); res.redirect('/');
  });
  app.use(async (req,res,next) => {
    if (req.session.userId) req.user=(await db.query('SELECT id,name,email,role FROM users WHERE id=$1', [req.session.userId]))[0];
    next();
  });
  app.get('/api/me', (req,res) => {
    req.session.csrf ||= randomBytes(24).toString('hex');
    res.json({user:req.user || null, csrf:req.session.csrf, organization:env.ORG_NAME || 'My Organization', timezone, mode});
  });
  app.use('/api', (req,res,next) => {
    if (!req.user) return res.status(401).json({error:'Sign in to continue.'});
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && (!req.session.csrf || req.get('x-csrf-token')!==req.session.csrf)) return res.status(403).json({error:'Session expired. Refresh the page and try again.'});
    next();
  });
  app.post('/api/logout', (req,res,next) => req.session.destroy(e => e ? next(e) : res.clearCookie('facilities.sid').json({ok:true})));
}
