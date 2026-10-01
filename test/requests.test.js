import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../db.js';
import {createApp,generateMaintenance} from '../server.js';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('additive request migration preserves legacy records and reopens idempotently',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'facilities-migration-'));
  const file=join(directory,'legacy.db');
  const legacy=new DatabaseSync(file);
  legacy.exec("CREATE TABLE work_orders (id TEXT PRIMARY KEY,title TEXT,description TEXT,building_id TEXT,asset_id TEXT,priority TEXT,status TEXT,assignee_id TEXT,requester_id TEXT,due_date TEXT,created_at TEXT,completed_at TEXT); INSERT INTO work_orders(id,title,status) VALUES('legacy','Existing repair','Open');");legacy.close();
  try {
    let db=await openDatabase(null,file);
    assert.equal((await db.query("SELECT request_type FROM work_orders WHERE id='legacy'"))[0].request_type,'maintenance');
    await db.close();db=await openDatabase(null,file);
    assert.equal((await db.query('SELECT * FROM work_orders')).length,1);
    assert.equal((await db.query('SELECT * FROM modules')).length,4);
    await db.close();
  } finally {for(const suffix of ['','-wal','-shm'])if(existsSync(file+suffix))unlinkSync(file+suffix);rmdirSync(directory);}
});

test('request types, admin settings, hidden records and personal notifications',async()=>{
  const db=await openDatabase(null,':memory:');
  const {app}=await createApp({AUTH_MODE:'demo',SEED_DEMO:'true'},db);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;let cookie='',csrf='';
  async function call(path,method='GET',body) {
    const response=await fetch(base+path,{method,redirect:'manual',headers:{cookie,'Content-Type':'application/json','x-csrf-token':csrf},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,body:response.headers.get('content-type')?.includes('json')?await response.json():null};
  }
  const request=(type,extra={})=>call('/api/orders','POST',{title:type+' test',building_id:'b1',due_date:'2026-10-02',request_type:type,...extra});
  try {
    await call('/auth/login');csrf=(await call('/api/me')).body.csrf;
    await db.query('INSERT INTO users VALUES($1,$2,$3,$4,$5)',['tech','tech','Taylor Tech','','technician']);
    await db.query('INSERT INTO users VALUES($1,$2,$3,$4,$5)',['manager','manager','Team Manager','','manager']);
    const tech=(await request('technology')).body.id;
    assert.ok(tech);
    assert.equal((await request('invalid')).status,400);
    assert.equal((await request('schedule')).status,400);
    assert.equal((await request('schedule',{starts_at:'2026-10-02T14:00',ends_at:'2026-10-02T13:00'})).status,400);
    assert.equal((await request('schedule',{starts_at:'2026-10-02T25:00',ends_at:'2026-10-03T13:00'})).status,400);
    const schedule=await request('schedule',{starts_at:'2026-10-02T09:00',ends_at:'2026-10-02T10:00'});
    assert.equal(schedule.status,201);
    assert.equal((await db.query('SELECT due_date FROM work_orders WHERE id=$1',[schedule.body.id]))[0].due_date,'2026-10-02');
    assert.equal((await call('/api/settings','PATCH',{technology:false})).status,200);
    assert.equal((await request('technology')).status,403);
    assert.ok(!(await call('/api/data')).body.orders.some(o=>o.id===tech));
    assert.equal((await call(`/api/orders/${tech}/comments`)).status,403);
    assert.equal((await call(`/api/orders/${tech}`,'PATCH',{status:'Completed'})).status,403);
    assert.equal((await call('/api/settings','PATCH',{technology:'false'})).status,400);
    assert.equal((await call('/api/settings','PATCH',{invented:true})).status,400);
    await call('/api/settings','PATCH',{technology:true});
    assert.ok((await call('/api/data')).body.orders.some(o=>o.id===tech));
    await call('/api/orders/'+tech,'PATCH',{assignee_id:'tech'});
    assert.equal((await db.query("SELECT * FROM notifications WHERE user_id='tech' AND event='assigned'")).length,1);
    // Notifications are scoped to the recipient; setting another user's inbox to read is rejected.
    const someoneElse=(await db.query("SELECT id FROM notifications WHERE user_id='tech'"))[0].id;
    assert.equal((await call('/api/notifications/read','POST',{id:someoneElse})).status,404);
    await db.query('UPDATE users SET role=$1 WHERE id=$2',['manager','demo-admin']);
    assert.equal((await call('/api/settings','PATCH',{technology:false})).status,403);
    await db.query('UPDATE users SET role=$1 WHERE id=$2',['requester','demo-admin']);
    assert.equal((await call('/api/preferences','PUT',{created:false,assigned:false,status:false,comment:false})).status,200);
    assert.equal((await call('/api/preferences')).body.comment,false);
    assert.equal((await call('/api/preferences','PUT',{comment:true})).status,400);
    // Use a technician session to exercise status/comment delivery to the requester.
    const adminCookie=cookie;
    // Swap only the isolated test session's user, keeping the signed cookie intact.
    const sessionRows=await db.query('SELECT * FROM sessions');
    const authenticated=sessionRows.find(r=>JSON.parse(r.body).userId==='demo-admin');
    const sessionBody=JSON.parse(authenticated.body);sessionBody.userId='tech';
    await db.query('UPDATE sessions SET body=$1 WHERE id=$2',[JSON.stringify(sessionBody),authenticated.id]);
    let before=(await db.query("SELECT * FROM notifications WHERE user_id='demo-admin'")).length;
    await call('/api/orders/'+tech,'PATCH',{status:'In progress'});
    await call('/api/orders/'+tech+'/comments','POST',{body:'Working on this'});
    assert.equal((await db.query("SELECT * FROM notifications WHERE user_id='demo-admin'")).length,before);
    sessionBody.userId='demo-admin';await db.query('UPDATE sessions SET body=$1 WHERE id=$2',[JSON.stringify(sessionBody),authenticated.id]);cookie=adminCookie;
    await call('/api/preferences','PUT',{created:true,assigned:true,status:true,comment:true});
    sessionBody.userId='tech';await db.query('UPDATE sessions SET body=$1 WHERE id=$2',[JSON.stringify(sessionBody),authenticated.id]);
    await call('/api/orders/'+tech+'/comments','POST',{body:'Ready for review'});
    assert.equal((await db.query("SELECT * FROM notifications WHERE user_id='demo-admin' AND event='comment'")).length,1);
    sessionBody.userId='demo-admin';await db.query('UPDATE sessions SET body=$1 WHERE id=$2',[JSON.stringify(sessionBody),authenticated.id]);
    const inbox=(await call('/api/notifications')).body;
    assert.equal(inbox.length,1);
    assert.equal((await call('/api/notifications/read','POST',{id:inbox[0].id})).status,200);
    assert.ok((await call('/api/notifications')).body[0].read_at);
    await db.query('UPDATE users SET role=$1 WHERE id=$2',['admin','demo-admin']);
    await call('/api/settings','PATCH',{notifications:false});
    sessionBody.userId='tech';await db.query('UPDATE sessions SET body=$1 WHERE id=$2',[JSON.stringify(sessionBody),authenticated.id]);
    await call('/api/orders/'+tech+'/comments','POST',{body:'No notification sent'});
    assert.equal((await db.query("SELECT * FROM notifications WHERE user_id='demo-admin'")).length,1);
    sessionBody.userId='demo-admin';await db.query('UPDATE sessions SET body=$1 WHERE id=$2',[JSON.stringify(sessionBody),authenticated.id]);
    await call('/api/settings','PATCH',{technology:false,maintenance:false,schedule:false});
    const hidden=(await call('/api/data')).body;
    assert.equal(hidden.orders.length,0);assert.equal(hidden.maintenance.length,0);assert.equal(hidden.notifications.length,0);
    assert.equal(await generateMaintenance(db),0);
    assert.equal((await call('/api/maintenance','POST',{title:'Disabled plan'})).status,403);
    assert.equal((await call('/api/maintenance/generate','POST')).status,403);
    await call('/api/settings','PATCH',{technology:true});assert.equal((await call('/api/data')).body.orders.length,1);
  } finally {await new Promise(resolve=>server.close(resolve));await db.close();}
});
