import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,generateMaintenance} from '../server.js';
import {openDatabase} from '../db.js';

// TEST_DATABASE_URL must name a disposable database, never the running workspace.
test('PostgreSQL supports settings, schedule requests, sessions and maintenance generation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const db=await openDatabase(process.env.TEST_DATABASE_URL);
  const {app}=await createApp({AUTH_MODE:'demo',SEED_DEMO:'true',SESSION_SECRET:'postgres-integration-test-secret'},db);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie='',csrf='';
  const call=async(path,method='GET',body)=>{
    const response=await fetch(base+path,{method,redirect:'manual',headers:{cookie,'Content-Type':'application/json','x-csrf-token':csrf},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,body:response.headers.get('content-type')?.includes('json')?await response.json():null};
  };
  try {
    assert.equal((await call('/auth/login')).status,302);
    csrf=(await call('/api/me')).body.csrf;
    const created=await call('/api/orders','POST',{request_type:'schedule',title:'PostgreSQL schedule',building_id:'b1',starts_at:'2026-10-02T09:00',ends_at:'2026-10-02T10:00',priority:'Normal'});
    assert.equal(created.status,201);
    assert.equal((await call('/api/settings','PATCH',{schedule:false})).status,200);
    assert.ok(!(await call('/api/data')).body.orders.some(x=>x.id===created.body.id));
    assert.equal((await call('/api/settings','PATCH',{schedule:true})).status,200);
    assert.ok((await call('/api/data')).body.orders.some(x=>x.id===created.body.id));
    assert.equal((await call('/api/maintenance','POST',{title:'PostgreSQL recurring',building_id:'b1',interval_days:1,next_due:'2020-01-01'})).status,201);
    assert.equal(await generateMaintenance(db),1);
    assert.equal(await generateMaintenance(db),0);
  } finally {await new Promise(resolve=>server.close(resolve));await db.close();}
});
