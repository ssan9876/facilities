import express from 'express';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './db.js';
import {setupAuth} from './auth.js';
import {dateInTimezone} from './dates.js';
import {moduleSettings,requireModule,notify,preferences,visibleNotifications,setupSettings} from './requests.js';
import {setupReleases,installedVersion} from './releases.js';

const statuses = ['Open', 'In progress', 'On hold', 'Completed'];
const priorities = ['Low', 'Normal', 'High', 'Urgent'];
const today = () => dateInTimezone();
const error = (message,status=400) => Object.assign(new Error(message),{status});
const text = (body,key,max=200,optional=false) => {
  const value=body[key];
  if (optional && (value==null || value==='')) return '';
  if (typeof value!=='string' || !value.trim() || value.length>max) throw error(`${key.replaceAll('_',' ')} is required and must be under ${max} characters.`);
  return value.trim();
};
const date = value => {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) throw error('Enter a valid date.');
  return value;
};
const canManage = user => ['admin','manager'].includes(user.role);
const manager = (req,res,next) => canManage(req.user) ? next() : res.status(403).json({error:'A manager or administrator must make this change.'});

export async function createApp(env=process.env, dbOverride) {
  const db=dbOverride || await openDatabase(env.DATABASE_URL,env.SQLITE_PATH);
  const q=db.query;
  if (env.AUTH_MODE==='demo' && env.NODE_ENV!=='production') {
    await q('INSERT INTO users(id,subject,name,email,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(subject) DO NOTHING',['demo-admin','demo-admin','Alex Morgan','alex@example.test','admin']);
    if (env.SEED_DEMO==='true' && !(await q('SELECT id FROM buildings')).length) await seed(db);
  }
  const app=express();
  app.disable('x-powered-by');
  if (env.NODE_ENV==='production') app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"], 'style-src':["'self'"], 'font-src':["'self'"], 'img-src':["'self'","data:"]}}}));
  app.use(express.json({limit:'64kb'}));
  app.get('/health', async (req,res) => {await q('SELECT 1');res.json({ok:true,version:installedVersion});});
  app.use(['/api','/auth'],(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  await setupAuth(app,db,env);
  setupSettings(app,db);
  setupReleases(app,env);
  const checkLocation = async (building,asset) => {
    if (!(await q('SELECT id FROM buildings WHERE id=$1',[building])).length) throw error('Choose an existing building.');
    if (asset && !(await q('SELECT id FROM assets WHERE id=$1 AND building_id=$2',[asset,building])).length) throw error('The asset must belong to the selected building.');
  };
  const accessibleOrder = async req => {
    const order=(await q('SELECT * FROM work_orders WHERE id=$1',[req.params.id]))[0];
    if (!order || (req.user.role==='requester' && order.requester_id!==req.user.id)) throw error('Work order not found.',404);
    await requireModule(db,order.request_type);
    return order;
  };
  app.get('/api/data', async (req,res) => {
    const restricted=req.user.role==='requester';
    const [buildings,assets,orders,maintenance,users]=await Promise.all([
      q('SELECT * FROM buildings ORDER BY name'),q('SELECT * FROM assets ORDER BY name'),
      q(`SELECT w.*, b.name AS building, a.name AS asset, u.name AS assignee, r.name AS requester FROM work_orders w JOIN buildings b ON b.id=w.building_id LEFT JOIN assets a ON a.id=w.asset_id LEFT JOIN users u ON u.id=w.assignee_id JOIN users r ON r.id=w.requester_id ${restricted?'WHERE w.requester_id=$1':''} ORDER BY w.created_at DESC`,restricted?[req.user.id]:[]),
      restricted ? [] : q('SELECT m.*,b.name AS building,a.name AS asset FROM maintenance m JOIN buildings b ON b.id=m.building_id LEFT JOIN assets a ON a.id=m.asset_id ORDER BY m.next_due'),
      restricted ? [] : q('SELECT id,name,role FROM users ORDER BY name'),
    ]);
    const modules=await moduleSettings(db);
    const counts=req.user.role==='admin'?await q('SELECT request_type,COUNT(*) AS count FROM work_orders GROUP BY request_type'):[];
    res.json({buildings,assets,orders:orders.filter(o=>modules[o.request_type]),maintenance:modules.maintenance?maintenance:[],users,modules,moduleCounts:Object.fromEntries(counts.map(r=>[r.request_type,Number(r.count)])),preferences:await preferences(db,req.user.id),notifications:await visibleNotifications(db,req.user)});
  });
  app.post('/api/buildings',manager,async (req,res) => {
    const row={id:randomUUID(),name:text(req.body,'name'),address:text(req.body,'address',500,true),created_at:new Date().toISOString()};
    await q('INSERT INTO buildings(id,name,address,created_at) VALUES($1,$2,$3,$4)',Object.values(row));res.status(201).json(row);
  });
  app.post('/api/assets',manager,async (req,res) => {
    const row={id:randomUUID(),name:text(req.body,'name'),building_id:text(req.body,'building_id'),category:text(req.body,'category'),serial:text(req.body,'serial',200,true),created_at:new Date().toISOString()};
    await checkLocation(row.building_id);await q('INSERT INTO assets(id,name,building_id,category,serial,created_at) VALUES($1,$2,$3,$4,$5,$6)',Object.values(row));res.status(201).json(row);
  });
  app.post('/api/orders',async (req,res) => {
    const body=req.body;
    const requestType=body.request_type||'maintenance';
    await requireModule(db,requestType);
    const title=text(body,'title'),description=text(body,'description',5000,true),building=text(body,'building_id'),asset=text(body,'asset_id',200,true)||null;
    const priority=body.priority||'Normal';if (!priorities.includes(priority)) throw error('Choose a valid priority.');
    let starts=null,ends=null;
    if (requestType==='schedule') {
      const localTime=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)&&date(v.slice(0,10))&&Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60;
      if (!localTime(body.starts_at)||!localTime(body.ends_at)||body.ends_at<=body.starts_at) throw error('Schedule requests need valid start and end times, with the end after the start.');
      starts=body.starts_at;ends=body.ends_at;
    }
    const due=date(requestType==='schedule'?starts.slice(0,10):body.due_date);await checkLocation(building,asset);
    const id=randomUUID();
    await q('INSERT INTO work_orders(id,title,description,building_id,asset_id,priority,status,requester_id,due_date,created_at,request_type,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,title,description,building,asset,priority,'Open',req.user.id,due,new Date().toISOString(),requestType,starts,ends]);
    const recipients=await q("SELECT id FROM users WHERE role IN ('admin','manager')");
    await notify(db,{id},'created',recipients.map(u=>u.id),req.user.id,`${req.user.name} submitted a ${requestType} request.`);
    res.status(201).json({id});
  });
  app.patch('/api/orders/:id',async (req,res) => {
    const row=await accessibleOrder(req);
    if (req.user.role==='requester' || (req.user.role==='technician' && row.assignee_id!==req.user.id)) throw error('Only managers or the assigned technician can update this work order.',403);
    const status=req.body.status??row.status;if (!statuses.includes(status)) throw error('Choose a valid status.');
    let assignee=row.assignee_id;
    if ('assignee_id' in req.body) {
      if (!canManage(req.user)) throw error('A manager must assign work orders.',403);
      assignee=req.body.assignee_id||null;
      if (assignee && !(await q("SELECT id FROM users WHERE id=$1 AND role IN ('admin','manager','technician')",[assignee])).length) throw error('Choose a technician or manager.');
    }
    await q('UPDATE work_orders SET status=$1, assignee_id=$2, completed_at=$3 WHERE id=$4',[status,assignee,status==='Completed'?(row.completed_at||new Date().toISOString()):null,row.id]);
    if (assignee!==row.assignee_id&&assignee) await notify(db,row,'assigned',[assignee],req.user.id,`${req.user.name} assigned this request to you.`);
    if (status!==row.status) await notify(db,row,'status',[row.requester_id,assignee],req.user.id,`${req.user.name} changed the status to ${status}.`);
    res.json({ok:true});
  });
  app.get('/api/orders/:id/comments',async (req,res) => {await accessibleOrder(req);res.json(await q('SELECT c.*,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.work_order_id=$1 ORDER BY c.created_at',[req.params.id]));});
  app.post('/api/orders/:id/comments',async (req,res) => {
    const row=await accessibleOrder(req);await q('INSERT INTO comments(id,work_order_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),req.params.id,req.user.id,text(req.body,'body',5000),new Date().toISOString()]);
    await notify(db,row,'comment',[row.requester_id,row.assignee_id],req.user.id,`${req.user.name} added a comment.`);res.status(201).json({ok:true});
  });
  app.post('/api/maintenance',manager,async (req,res) => {
    await requireModule(db,'maintenance');
    const title=text(req.body,'title'),building=text(req.body,'building_id'),asset=text(req.body,'asset_id',200,true)||null;
    const interval=Number(req.body.interval_days);if (!Number.isInteger(interval)||interval<1||interval>3650) throw error('Interval must be between 1 and 3650 days.');
    const due=date(req.body.next_due);await checkLocation(building,asset);
    const id=randomUUID();await q('INSERT INTO maintenance(id,title,building_id,asset_id,interval_days,next_due,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,title,building,asset,interval,due,req.user.id,new Date().toISOString()]);res.status(201).json({id});
  });
  app.post('/api/maintenance/generate',manager,async (req,res) => {await requireModule(db,'maintenance');res.json({generated:await generateMaintenance(db)});});
  app.use(express.static(fileURLToPath(new URL('./public',import.meta.url))));
  app.use((err,req,res,next) => {
    if (!err.status || err.status>=500) console.error(err.message);
    res.status(err.status||500).json({error:err.status?err.message:'Something went wrong. Try again or contact your administrator.'});
  });
  return {app,db};
}

export async function generateMaintenance(db) {
  if (!(await moduleSettings(db)).maintenance) return 0;
  let count=0;
  const plans=await db.query('SELECT * FROM maintenance WHERE next_due<=$1',[today()]);
  for (const plan of plans) {
    // Deterministic keys and the unique occurrence constraint prevent duplicate orders across processes.
    const id=`pm-${plan.id}-${plan.next_due}`;
    await db.query('INSERT INTO work_orders(id,title,description,building_id,asset_id,priority,status,requester_id,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING',[id,plan.title,`Scheduled maintenance. Recurs every ${plan.interval_days} days.`,plan.building_id,plan.asset_id,'Normal','Open',plan.created_by,plan.next_due,new Date().toISOString()]);
    const inserted=await db.query('INSERT INTO maintenance_runs(id,plan_id,due_date,work_order_id) VALUES($1,$2,$3,$4) ON CONFLICT(plan_id,due_date) DO NOTHING RETURNING id',[randomUUID(),plan.id,plan.next_due,id]);
    if (inserted.length) {
      count++;
      const recipients=await db.query("SELECT id FROM users WHERE role IN ('admin','manager')");
      await notify(db,{id},'created',recipients.map(u=>u.id),null,'A scheduled maintenance request is ready.');
    }
    const next=new Date(plan.next_due+'T12:00:00Z');
    do {next.setUTCDate(next.getUTCDate()+plan.interval_days);} while (next.toISOString().slice(0,10)<=today());
    await db.query('UPDATE maintenance SET next_due=$1 WHERE id=$2 AND next_due=$3',[next.toISOString().slice(0,10),plan.id,plan.next_due]);
  }
  return count;
}

async function seed(db) {
  const now=new Date().toISOString();
  for (const [id,name,address] of [['b1','North Campus','1200 North Central Avenue'],['b2','Operations Center','240 West Industrial Drive'],['b3','Community Center','800 East Park Road']]) await db.query('INSERT INTO buildings VALUES($1,$2,$3,$4)',[id,name,address,now]);
  for (const [id,name,b,category,serial] of [['a1','Rooftop HVAC · Unit 04','b1','HVAC','RTU-004'],['a2','Main circulation pump','b3','Plumbing','PMP-021'],['a3','Emergency generator','b2','Electrical','GEN-008']]) await db.query('INSERT INTO assets VALUES($1,$2,$3,$4,$5,$6)',[id,name,b,category,serial,now]);
  const day=offset=>{const d=new Date(today()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
  for (const [i,title,b,a,priority,status,offset] of [[1,'Air conditioning not cooling — east wing','b1','a1','Urgent','Open',-1],[2,'Replace lobby ceiling lights','b3',null,'Normal','In progress',1],[3,'Inspect emergency generator','b2','a3','High','Open',0],[4,'Repair leaking circulation pump','b3','a2','High','On hold',2],[5,'Adjust conference room door closer','b2',null,'Low','Open',5],[6,'Replace HVAC return filters','b1','a1','Normal','Completed',-2]]) await db.query('INSERT INTO work_orders(id,title,description,building_id,asset_id,priority,status,assignee_id,requester_id,due_date,created_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[`demo-${i}`,title,'Illustrative demo work order. Replace demo records with your organization’s real information.',b,a,priority,status,'demo-admin','demo-admin',day(offset),now,status==='Completed'?now:null]);
  await db.query('INSERT INTO maintenance VALUES($1,$2,$3,$4,$5,$6,$7,$8)',['pm1','Monthly HVAC inspection','b1','a1',30,day(3),'demo-admin',now]);
  await db.query('INSERT INTO maintenance VALUES($1,$2,$3,$4,$5,$6,$7,$8)',['pm2','Generator load test','b2','a3',90,day(7),'demo-admin',now]);
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const {app,db}=await createApp();
  const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',async err=>{
    if(err){console.error(`Unable to start Facilities: ${err.message}`);await db.close();process.exit(1);}
    console.log(`Facilities running at ${process.env.APP_URL||'http://localhost:3000'}`);
  });
  if (process.env.AUTH_MODE!=='demo') {
    const tick=()=>generateMaintenance(db).catch(e=>console.error('Maintenance generation failed:',e.message));
    await tick();const timer=setInterval(tick,3600000);timer.unref();
  }
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{await db.close();process.exit(0);}));
}
