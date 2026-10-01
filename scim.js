import express from 'express';
import {saveProvisionedUser} from './administration.js';

const userSchema='urn:ietf:params:scim:schemas:core:2.0:User',groupSchema='urn:ietf:params:scim:schemas:core:2.0:Group';
const extension='urn:fmx:params:scim:schemas:extension:identity:2.0:User';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
export function scimRouter(db,env){
  const router=express.Router();
  router.use((req,res,next)=>{res.type('application/scim+json');next();});
  const user=async u=>({schemas:[userSchema,extension],id:u.id,userName:u.user_name||u.subject,externalId:u.external_id||undefined,displayName:u.name,active:!!u.active,emails:u.email?[{value:u.email,primary:true}]:[],[extension]:{subject:u.subject.split('|').slice(1).join('|')},groups:(await db.query('SELECT DISTINCT group_id FROM group_members WHERE user_id=$1',[u.id])).map(m=>({value:m.group_id})),meta:{resourceType:'User'}});
  const group=async g=>({schemas:[groupSchema],id:g.id,displayName:g.name,members:(await db.query('SELECT DISTINCT user_id FROM group_members WHERE group_id=$1',[g.id])).map(m=>({value:m.user_id})),meta:{resourceType:'Group'}});
  const findUser=async id=>{const u=(await db.query('SELECT * FROM users WHERE id=$1',[id]))[0];if(!u)throw error('User not found.',404);return u;};
  const convert=b=>({oidc_subject:b[extension]?.subject??b.oidc_subject,name:b.displayName??(b.name?`${b.name.givenName||''} ${b.name.familyName||''}`.trim():undefined),email:b.emails?.[0]?.value,userName:b.userName,externalId:b.externalId,active:b.active});
  router.get('/ServiceProviderConfig',(req,res)=>res.json({schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],patch:{supported:true},bulk:{supported:false,maxOperations:0,maxPayloadSize:0},filter:{supported:true,maxResults:1000},changePassword:{supported:false},sort:{supported:false},etag:{supported:false},authenticationSchemes:[{type:'oauthbearertoken',name:'Provisioning bearer token',description:'Administrator-created expiring token',primary:true}]}));
  router.get('/Schemas',(req,res)=>res.json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:3,startIndex:1,itemsPerPage:3,Resources:[{id:userSchema,name:'User',attributes:[{name:'userName',type:'string',required:true,multiValued:false},{name:'active',type:'boolean',multiValued:false},{name:'externalId',type:'string',multiValued:false},{name:'emails',type:'complex',multiValued:true,subAttributes:[{name:'value',type:'string'}]}]},{id:groupSchema,name:'Group',attributes:[{name:'displayName',type:'string',required:true,multiValued:false}]},{id:extension,name:'FMXIdentity',attributes:[{name:'subject',type:'string',required:true,multiValued:false,mutability:'immutable'}]}]}));
  router.get('/ResourceTypes',(req,res)=>res.json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:2,startIndex:1,itemsPerPage:2,Resources:[{id:'User',name:'User',endpoint:'/Users',schema:userSchema,schemaExtensions:[{schema:extension,required:true}]},{id:'Group',name:'Group',endpoint:'/Groups',schema:groupSchema}]}));
  for(const kind of ['Users','Groups'])router.get('/'+kind,async(req,res)=>{
    let rows=await db.query(kind==='Users'?'SELECT * FROM users ORDER BY id':'SELECT * FROM user_groups ORDER BY id');
    if(req.query.filter){const match=String(req.query.filter).match(/^(userName|externalId|displayName|id) eq "((?:[^"\\]|\\.)*)"$/);if(!match)throw error('Only equality filters on userName, externalId, displayName and id are supported.');const val=JSON.parse('"'+match[2]+'"'),field={userName:'user_name',externalId:'external_id',displayName:kind==='Users'?'name':'name',id:'id'}[match[1]];rows=rows.filter(r=>String(r[field]??'').toLowerCase()===val.toLowerCase());}
    const start=Number(req.query.startIndex??1),count=Number(req.query.count??100);
    if(!Number.isInteger(start)||start<1||!Number.isInteger(count)||count<0||count>1000)throw error('Invalid pagination.');
    const page=rows.slice(start-1,start-1+count);res.json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:rows.length,startIndex:start,itemsPerPage:page.length,Resources:await Promise.all(page.map(kind==='Users'?user:group))});
  });
  router.get('/Users/:id',async(req,res)=>res.json(await user(await findUser(req.params.id))));
  router.post('/Users',async(req,res)=>{const u=await saveProvisionedUser(db,env,convert(req.body));res.status(201).location(`${req.baseUrl}/Users/${u.id}`).json(await user(u));});
  router.put('/Users/:id',async(req,res)=>res.json(await user(await saveProvisionedUser(db,env,convert(req.body),req.params.id))));
  router.patch('/Users/:id',async(req,res)=>{
    const current=await findUser(req.params.id),patch={},ops=req.body.Operations;
    if(!Array.isArray(ops)||!ops.length||ops.length>50)throw error('Operations must contain 1–50 changes.');
    const profile={givenName:current.name,familyName:''};
    for(const op of ops){if(!['add','replace'].includes(String(op.op).toLowerCase()))throw error('Unsupported user patch operation.');if(!op.path){Object.assign(patch,convert(op.value||{}));continue;}switch(op.path){case 'active':patch.active=op.value;break;case 'userName':patch.userName=op.value;break;case 'displayName':patch.name=op.value;break;case 'externalId':patch.externalId=op.value;break;case 'emails':patch.email=op.value?.[0]?.value;break;case 'name':patch.name=`${op.value?.givenName||''} ${op.value?.familyName||''}`.trim();break;case 'name.givenName':profile.givenName=op.value;patch.name=`${profile.givenName} ${profile.familyName}`.trim();break;case 'name.familyName':profile.familyName=op.value;patch.name=`${profile.givenName} ${profile.familyName}`.trim();break;default:throw error('Unsupported user patch path.');}}
    res.json(await user(await saveProvisionedUser(db,env,patch,req.params.id)));
  });
  router.delete('/Users/:id',async(req,res)=>{await saveProvisionedUser(db,env,{active:false},req.params.id);res.status(204).end();});
  router.get('/Groups/:id',async(req,res)=>{const g=(await db.query('SELECT * FROM user_groups WHERE id=$1',[req.params.id]))[0];if(!g)throw error('Group not found.',404);res.json(await group(g));});
  router.patch('/Groups/:id',async(req,res)=>{
    const g=(await db.query('SELECT * FROM user_groups WHERE id=$1',[req.params.id]))[0];if(!g)throw error('Group not found.',404);
    const ops=req.body.Operations;if(!Array.isArray(ops)||!ops.length||ops.length>100)throw error('Invalid group operations.');
    const changes=[];for(const op of ops){const action=String(op.op).toLowerCase(),match=op.path?.match(/^members\[value eq "([\w-]+)"\]$/);if(!['add','remove'].includes(action)||!(op.path==='members'||match))throw error('Only add/remove group memberships are supported.');const ids=match?[match[1]]:Array.isArray(op.value)?op.value.map(m=>m.value):[op.value?.value];for(const id of ids){if(typeof id!=='string'||!(await db.query('SELECT id FROM users WHERE id=$1',[id])).length)throw error('Unknown member.');changes.push({action,id});}}
    for(const {action,id} of changes)if(action==='add')await db.query("INSERT INTO group_members VALUES($1,$2,'provisioning') ON CONFLICT DO NOTHING",[g.id,id]);else await db.query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2 AND source='provisioning'",[g.id,id]);res.json(await group(g));
  });
  router.use((err,req,res,next)=>res.status(err.status||500).json({schemas:['urn:ietf:params:scim:api:messages:2.0:Error'],status:String(err.status||500),detail:err.status?err.message:'Provisioning failed.'}));
  return router;
}
