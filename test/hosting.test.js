import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {openDatabase} from '../db.js';
import http from 'node:http';

test('production redirects alternate LAN hosts before SSO and keeps loopback health available',async()=>{
  const db=await openDatabase(null,':memory:');
  const {app}=await createApp({NODE_ENV:'production',AUTH_MODE:'oidc',APP_URL:'https://fmx.example.test',SESSION_SECRET:'a'.repeat(48),OIDC_ISSUER:'https://idp.example.test',OIDC_CLIENT_ID:'test-client',OIDC_CLIENT_SECRET:'test-secret'},db);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const redirect=await fetch(base+'/auth/login?next=work',{redirect:'manual'});
    assert.equal(redirect.status,308);
    assert.equal(redirect.headers.get('location'),'https://fmx.example.test/auth/login?next=work');
    assert.equal(redirect.headers.get('set-cookie'),null);
    assert.equal((await fetch(base+'/health')).status,200);
    const status=await new Promise((resolve,reject)=>http.get(base+'/api/data',{headers:{Host:'fmx.example.test'}},response=>{assert.equal(response.headers['cache-control'],'no-store');response.resume();resolve(response.statusCode);}).on('error',reject));
    assert.equal(status,401);
  } finally {await new Promise(resolve=>server.close(resolve));await db.close();}
});
