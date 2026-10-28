import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredOwnerProfiles, rememberOwnerProfileSession, bindCapturedOwnerProfileAuthority } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';
import { createPublicationDispatchRouter, normalizePublicationDispatch } from '../src/publication-dispatch.js';
import { createWilsonChatRouter } from '../src/wilson-chat.js';

const env = {NODE_ENV:'test',RENDER_DB_ENVIRONMENT:'test',DATABASE_URL:'postgresql://synthetic@127.0.0.1/unit_test',
  RENDER_OWNER_PROFILES:JSON.stringify({accountId:1,francoUserId:31,agustinUserId:32})};
const revision = '2026-10-20T12:34:56.123456Z';
const draft = () => ({clientId:8,type:'reel',mode:'draft',caption:'QA',requestKey:'synthetic-draft-0001',expectedRevision:revision});
const routes = [
  ['dispatch POST','post','/',draft],
  ['dispatch PATCH','patch','/:id',draft],
  ['Wilson read marker','post','/conversacion/leida',()=>({})],
  ['Wilson message','post','/mensajes',()=>({contenido:'Hola'})],
  ['Wilson production preparation','post','/produccion/preparar',()=>({tarea_id:8,cantidad:2,fecha:'2026-10-20'})],
  ['Wilson reset','delete','/conversaciones',()=>({})],
];
function fixture({onConnect,wrongPool=false,duplicate=false,revokeReplay=false,failAt,rollbackFails=false,taskAvailable=true}={}) {
  const registered = new Map(), calls = [], releases = [], committed = [];
  const users = [1,31,32].map(id=>({id,rol:'admin',activo:true,session_version:1,nombre:`QA ${id}`,usuario:`qa-${id}`}));
  const failure = Error('synthetic operation failed'), rollbackFailure = Error('synthetic rollback failed');
  let staged, leases=0, begins=0;
  const rows = values => ({rows:values,rowCount:values.length});
  const db = {async query(sql,params=[]) {
    const text=sql.replace(/\s+/g,' ').trim();calls.push({sql:text,params:structuredClone(params)});
    if(text.startsWith('BEGIN')) { begins++;staged=[];if(revokeReplay&&begins===2)users[0].session_version++;return rows([]); }
    if(text==='ROLLBACK') { staged=undefined;if(rollbackFails)throw rollbackFailure;return rows([]); }
    if(failAt&&text.startsWith(failAt))throw failure;
    if(text==='COMMIT') {committed.push(...staged);staged=undefined;return rows([]);}
    if(text.includes('FROM usuarios WHERE id=ANY'))return rows(users.map(u=>({...u})));
    if(text.includes('FROM usuarios WHERE id=$1'))return rows(users.filter(u=>u.id===params[0]).map(u=>({...u})));
    if(text==='SELECT id,usuario,nombre,rol FROM usuarios ORDER BY nombre')return rows(users.map(u=>({...u})));
    if(text.startsWith('SELECT id FROM clientes'))return rows([{id:8}]);
    if(text.includes('FROM publicacion_envios e WHERE'))return rows([{id:'11',estado:'borrador',revision}]);
    if(text.includes('idempotency_key=$1'))return rows([{id:'11',creado_por_id:31,unchanged:true}]);
    if(text.includes('FROM publicacion_envios e JOIN clientes')) {
      const p=normalizePublicationDispatch(draft());
      return rows([{id:'11',...p,previewOnly:true,assets:[],targets:[]}]);
    }
    if(text.startsWith('INSERT INTO publicacion_envios')) {
      if(duplicate)throw Object.assign(Error('synthetic duplicate'),{code:'23505'});
      staged.push({sql:text,params});return rows([{id:'11'}]);
    }
    if(text.includes('SELECT t.* FROM tareas'))return rows(taskAvailable?[{id:8,titulo:'Visita QA',tipo_tarea:'produccion',propiedades_extra:{workspace:'render_os'}}]:[]);
    if(text.includes('FROM tareas t'))return rows([]);
    if(text.startsWith('SELECT COUNT(*)::int total FROM wilson_mensajes'))return rows([{total:2}]);
    if(text.includes('FROM wilson_mensajes'))return rows([]);
    if(/^(INSERT|UPDATE|DELETE)\b/.test(text)) {
      staged.push({sql:text,params});
      if(text.startsWith('INSERT INTO wilson_conversaciones'))return rows([{id:4,usuario_id:params[0]}]);
      if(text.startsWith('INSERT INTO wilson_mensajes'))return rows([{id:5,remitente:params[1],contenido:params[2]}]);
      if(text.startsWith('DELETE FROM wilson_conversaciones'))return rows([{id:4}]);
      return rows([]);
    }
    assert.fail(`Unexpected SQL: ${text}`);
  },release(error){releases.push(error);}};
  const pool={async connect(){leases++;await onConnect?.(users);return db;},query(){assert.fail('escaped transaction lease');}};
  bindDatabaseAuthorityClient(db,wrongPool?{}:pool);
  const policy=configuredOwnerProfiles(env,pool).policy;
  const router=Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(path,...handlers)=>registered.set(`${method}:${path}`,handlers)]));
  const express={Router:()=>router};
  createPublicationDispatchRouter({express,pool,requireRole:(...roles)=>(req,res,next)=>roles.includes(req.auth.rol)?next():res.status(403).json({error:'denied'})});
  // Separate routers have overlapping POST / only for dispatch; other paths differ.
  createWilsonChatRouter({express,pool});
  function auth(delegated=true,role='admin') {
    if(!delegated)return {id:31,session_version:1,rol:role,nombre:'QA'};
    const exp=Math.floor(Date.now()/1000)+3600;
    const value={id:31,session_version:1,rol:'admin',root_id:1,root_session_version:1,root_exp:exp,exp,owner_profile:'franco'};
    rememberOwnerProfileSession(value,value,policy);return value;
  }
  async function invoke(route,value=auth()) {
    const [,method,path,body]=route;
    const req={auth:value,params:{id:'11'},query:{},body:body()};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){assert.equal(staged,undefined,'respond only after transaction completion');this.body=body;return this;}};
    const handlers=registered.get(`${method}:${path}`);
    const run=async index=>handlers[index]?.(req,res,error=>error?Promise.reject(error):run(index+1));
    await run(0);return res;
  }
  return {pool,auth,invoke,users,calls,releases,committed,failure,rollbackFailure,get leases(){return leases;}};
}

for(const route of routes) {
  const [name]=route;
  test(`${name}: delegated principal retained before actor and domain; commit before response`,async()=>{
    const f=fixture();const res=await f.invoke(route);
    assert.ok([200,201].includes(res.statusCode));
    assert.match(f.calls[1].sql,/ORDER BY id FOR SHARE$/);
    assert.deepEqual(f.calls[1].params,[[1,31,32]]);
    assert.match(f.calls[2].sql,/FROM usuarios WHERE id=\$1 FOR SHARE$/);
    assert.equal(f.calls.at(-1).sql,'COMMIT');assert.deepEqual(f.releases,[undefined]);
  });
  for(const [reason,revoke] of [['root epoch',u=>u[0].session_version++],['root disabled',u=>u[0].activo=false],
    ['root demoted',u=>u[0].rol='edicion'],['actor epoch',u=>u[1].session_version++]]) {
    test(`${name}: ${reason} during lease wait rejects before domain`,async()=>{
      const f=fixture({onConnect:revoke});await assert.rejects(f.invoke(route),{status:401});
      assert.equal(f.committed.length,0);assert.equal(f.calls.length,3);
      assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.deepEqual(f.releases,[undefined]);
    });
  }
  test(`${name}: cross-pool client rejected before principal/domain query`,async()=>{
    const f=fixture({wrongPool:true});await assert.rejects(f.invoke(route),{status:401});
    assert.deepEqual(f.calls.map(q=>q.sql),['BEGIN ISOLATION LEVEL READ COMMITTED','ROLLBACK']);
  });
  test(`${name}: copied claims rejected before pool acquisition`,async()=>{
    const f=fixture();await assert.rejects(f.invoke(route,{...f.auth()}),{status:401});assert.equal(f.leases,0);
  });
  test(`${name}: immutable capture survives request mutation while leasing`,async()=>{
    let auth;
    const f=fixture({onConnect:()=>{auth.id=99;auth.session_version=9;auth.root_id=99;auth.rol='edicion';}});
    auth=f.auth();await f.invoke(route,auth);
    assert.deepEqual(f.calls[2].params,[31]);
    const insert=f.committed.find(q=>q.sql.startsWith('INSERT INTO publicacion_envios'));
    if(insert)assert.equal(insert.params[2],31);
  });
  test(`${name}: trusted scalar recapture preserves delegation`,async()=>{
    const f=fixture(),a=f.auth();
    await f.invoke(route,bindCapturedOwnerProfileAuthority(a,Object.freeze({id:a.id,session_version:a.session_version,rol:a.rol})));
    assert.ok(f.calls.some(q=>q.sql.includes('FROM usuarios WHERE id=ANY')));
  });
}

test('duplicate dispatch POST revalidates principal in replay transaction',async()=>{
  const f=fixture({duplicate:true});assert.equal((await f.invoke(routes[0])).statusCode,200);
  assert.equal(f.calls.filter(q=>q.sql.includes('FROM usuarios WHERE id=ANY')).length,2);
  assert.equal(f.calls.filter(q=>q.sql.startsWith('INSERT INTO publicacion_envios')).length,1);
});
test('revocation between dispatch insert failure and replay prevents receipt/domain access',async()=>{
  const f=fixture({duplicate:true,revokeReplay:true});await assert.rejects(f.invoke(routes[0]),{status:401});
  assert.equal(f.calls.some(q=>q.sql.includes('idempotency_key=$1')),false);assert.equal(f.committed.length,0);
});
test('Wilson message failure rolls back conversation and user message atomically',async()=>{
  const f=fixture({failAt:'SELECT id,usuario,nombre,rol FROM usuarios ORDER BY nombre'});
  await assert.rejects(f.invoke(routes[3]),error=>error===f.failure);
  assert.equal(f.committed.length,0);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
test('Wilson rollback failure discards lease and preserves original error',async()=>{
  const f=fixture({failAt:'UPDATE wilson_conversaciones',rollbackFails:true});
  await assert.rejects(f.invoke(routes[2]),error=>error===f.failure);assert.deepEqual(f.releases,[f.rollbackFailure]);
});
test('reset remains admin-only; employee messages remain ID-scoped',async()=>{
  const f=fixture();assert.equal((await f.invoke(routes[5],f.auth(false,'edicion'))).statusCode,403);assert.equal(f.leases,0);
  f.users[1].rol='edicion';await f.invoke(routes[3],f.auth(false,'edicion'));
  assert.equal(f.calls.some(q=>q.sql.includes('FROM usuarios WHERE id=ANY')),false);
  const reads=f.calls.filter(q=>q.sql.includes('FROM tareas t'));
  assert.ok(reads.length>0);for(const read of reads){assert.match(read.sql,/tarea_asignaciones/);assert.deepEqual(read.params,[31]);}
  assert.equal(f.committed.some(q=>q.sql.includes('wilson_acciones_pendientes')),false);
});
test('production preparation preserves task ACL and rolls back when task unavailable',async()=>{
  const f=fixture({taskAvailable:false});const result=await f.invoke(routes[4]);assert.equal(result.statusCode,404);assert.equal(f.committed.length,0);
});
test('dispatch current role and epoch are revalidated even without delegation',async()=>{
  const f=fixture({onConnect:u=>{u[1].rol='edicion';}});
  await assert.rejects(f.invoke(routes[0],f.auth(false,'community')),{status:401});assert.equal(f.committed.length,0);
});
test('employee cannot inspect or prepare a message to another explicitly named person',async()=>{
  const f=fixture();f.users[1].rol='edicion';f.users[2].nombre='Recipient Target';
  const route=['Wilson explicit other','post','/mensajes',()=>({contenido:'Mandale Recipient Target un mensaje'})];
  const res=await f.invoke(route,f.auth(false,'edicion'));
  assert.match(res.body.assistantMessage.contenido,/no mostrarte el detalle personal de otro integrante/);
  assert.equal(f.committed.some(q=>q.sql.includes('wilson_acciones_pendientes')),false);
  for(const q of f.calls.filter(q=>q.sql.includes('FROM tareas t')))assert.deepEqual(q.params,[31]);
});
test('admin prepares an owned pending message; no delivery occurs before confirmation',async()=>{
  const f=fixture();f.users[2].nombre='Recipient Target';
  const route=['Wilson admin reminder','post','/mensajes',()=>({contenido:'Mandale Recipient Target un mensaje'})];
  const res=await f.invoke(route);assert.equal(res.statusCode,201);
  const pending=f.committed.find(q=>q.sql.startsWith('INSERT INTO wilson_acciones_pendientes'));
  assert.equal(pending.params[2],31);assert.equal(JSON.parse(pending.params[3]).target_user_id,32);
  assert.equal(f.committed.filter(q=>q.sql.startsWith('INSERT INTO wilson_conversaciones')).length,1);
});
test('reset keeps cascade response counts and audits the retained current ID/name',async()=>{
  const f=fixture();const res=await f.invoke(routes[5]);
  assert.deepEqual(res.body,{ok:true,conversations_deleted:1,messages_deleted:2});
  const audit=f.committed.find(q=>q.sql.startsWith('INSERT INTO integracion_auditoria'));
  assert.deepEqual(audit.params,['31','QA 31',JSON.stringify({conversations_deleted:1,messages_deleted:2})]);
});
for(const route of [routes[0],routes[3],routes[5]])test(`${route[0]}: commit failure never reports success or retries external work`,async()=>{
  const f=fixture({failAt:'COMMIT'});await assert.rejects(f.invoke(route),error=>error===f.failure);
  assert.equal(f.committed.length,0);assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.leases,1);
});
test('dispatch duplicate plus failed rollback discards lease without replaying',async()=>{
  const f=fixture({duplicate:true,rollbackFails:true});await assert.rejects(f.invoke(routes[0]),{code:'23505'});
  assert.equal(f.calls.filter(q=>q.sql.startsWith('BEGIN')).length,1);
  assert.deepEqual(f.releases,[f.rollbackFailure]);
});
