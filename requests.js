import {randomUUID} from 'node:crypto';

export const requestTypes = ['maintenance','schedule','technology'];
export const defaultPreferences = {created:true,assigned:true,status:true,comment:true};
export async function moduleSettings(db) {
  return Object.fromEntries((await db.query('SELECT * FROM modules')).map(row=>[row.id,row.enabled===1]));
}
export async function requireModule(db,type) {
  if (!requestTypes.includes(type)) throw Object.assign(new Error('Choose Maintenance, Schedule, or Technology.'),{status:400});
  if (!(await moduleSettings(db))[type]) throw Object.assign(new Error('This request type is disabled. Contact your administrator.'),{status:403});
}
export async function preferences(db,userId) {
  const row=(await db.query('SELECT body FROM notification_preferences WHERE user_id=$1',[userId]))[0];
  return {...defaultPreferences,...(row?JSON.parse(row.body):{})};
}
export async function notify(db,order,event,recipients,actorId,message) {
  if (!(await moduleSettings(db)).notifications) return;
  for (const userId of new Set(recipients.filter(id=>id&&id!==actorId))) {
    if (!(await preferences(db,userId))[event]) continue;
    await db.query('INSERT INTO notifications(id,user_id,order_id,event,message,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),userId,order.id,event,message,new Date().toISOString()]);
  }
}
export async function visibleNotifications(db,user) {
  const enabled=await moduleSettings(db);
  const rows=await db.query("SELECT n.*,w.title,w.request_type,w.requester_id FROM notifications n JOIN work_orders w ON w.id=n.order_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 100",[user.id]);
  return rows.filter(n=>enabled[n.request_type]&&(user.role!=='requester'||n.requester_id===user.id));
}
export function setupSettings(app,db) {
  const admin=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Only an administrator can change workspace settings.'});
  app.patch('/api/settings',admin,async(req,res)=>{
    const body=req.body;
    if (!body||Array.isArray(body)||!Object.keys(body).length||Object.keys(body).some(k=>!['maintenance','schedule','technology','notifications'].includes(k)||typeof body[k]!=='boolean')) return res.status(400).json({error:'Settings must contain known modules with true or false values.'});
    // One statement avoids partially saving an organization's module selection.
    const params=[];const cases=Object.entries(body).map(([key,value])=>{params.push(key,value?1:0);return `WHEN $${params.length-1} THEN $${params.length}`;});
    await db.query(`UPDATE modules SET enabled=CASE id ${cases.join(' ')} ELSE enabled END`,params);
    res.json({modules:await moduleSettings(db)});
  });
  app.get('/api/preferences',async(req,res)=>res.json(await preferences(db,req.user.id)));
  app.put('/api/preferences',async(req,res)=>{
    const body=req.body;
    if (!body||Object.keys(body).length!==4||Object.keys(defaultPreferences).some(k=>typeof body[k]!=='boolean')||Object.keys(body).some(k=>!(k in defaultPreferences))) return res.status(400).json({error:'Provide true or false for all four notification preferences.'});
    await db.query('INSERT INTO notification_preferences(user_id,body) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET body=$2',[req.user.id,JSON.stringify(body)]);
    res.json(body);
  });
  app.get('/api/notifications',async(req,res)=>res.json(await visibleNotifications(db,req.user)));
  app.post('/api/notifications/read',async(req,res)=>{
    const rows=await visibleNotifications(db,req.user);
    const id=req.body?.id;
    if (id && !rows.some(n=>n.id===id)) return res.status(404).json({error:'Notification not found.'});
    for (const row of rows.filter(n=>!n.read_at&&(!id||n.id===id))) await db.query('UPDATE notifications SET read_at=$1 WHERE id=$2 AND user_id=$3',[new Date().toISOString(),row.id,req.user.id]);
    res.json({ok:true});
  });
}
