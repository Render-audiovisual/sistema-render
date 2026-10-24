import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import {startLocalHarness,request,fixturePassword,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {createTaskComment} from '../src/task-comment-receipts.js';
import {assertCoreSchemaReady} from '../src/startup-schema.js';

test('comment receipt: isolated principal HTTP, concurrency, recovery, tombstones and live authority',{
 skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:240000,
},async t=>{
 const f=await startLocalHarness({port:55861});let pool;
 t.after(async()=>{await pool?.end();await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');t.diagnostic(`Own comment fixture cleanup ENOENT ${f.root}`);});
 const url='postgresql://render2_fixture@127.0.0.1:55861/render2_local_test';
 const identitySql="SELECT current_database() AS database,current_user AS username,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory";
 const verify=identity=>assertFixtureIdentity({root:f.root,cwd:f.root,port:55861,url,identity});verify((await f.query(identitySql))[0]);
 pool=new pg.Pool({connectionString:url,max:6,statement_timeout:15000,application_name:'qa208-comment-receipts'});verify((await pool.query(identitySql)).rows[0]);
 const api=(path,token,method='GET',body)=>request(f.base,`/api${path}`,{token,method,body});
 const checked=(result,status=200)=>{assert.equal(result.status,status,'Principal status, no credential payload logging');return result.body;};
 const login=async usuario=>checked(await api('/login',null,'POST',{usuario,password:fixturePassword})).token;
 const admin=await login('qa_franco'),staff=await login('qa_luciano'),other=await login('qa_designer');
 const makeTask=async()=>checked(await api('/tareas',admin,'POST',{titulo:'QA208 comment operation',workspace:'render_os',tipo_tarea:'edicion',asignado_a_id:91003,colaborador_ids:[91004]}),201).id;
 const taskId=await makeTask();
 const path=id=>`/tareas/${id}/comentarios`;
 const post=(body,token=staff,id=taskId)=>api(`${path(id)}?workspace=render_os`,token,'POST',body);
 const recover=(key,token=staff,id=taskId)=>api(`${path(id)}/solicitudes/${encodeURIComponent(key)}?workspace=render_os`,token);
 const counts=async()=>({comments:(await f.query('SELECT count(*)::int AS n FROM tarea_comentarios'))[0].n,receipts:(await f.query('SELECT count(*)::int AS n FROM task_comment_create_receipts'))[0].n});
 const state=async()=>({comments:await f.query('SELECT to_jsonb(t) AS row FROM tarea_comentarios t ORDER BY id'),receipts:await f.query('SELECT to_jsonb(t) AS row FROM task_comment_create_receipts t ORDER BY actor_user_id,request_id')});
 const actor=async()=>{const [a]=await f.query('SELECT id,rol,session_version FROM usuarios WHERE id=91003');return a;};
 const intent=(requestId=randomUUID(),contenido='QA208 confirmed')=>({taskId,workspace:'render_os',requestId,payload:{autor:'Ignored staff label',contenido}});

 await t.test('same actor/key concurrent writes create exactly one comment and recover without DML',async()=>{
  const key=randomUUID(),body={request_id:key,autor:'Forged label',contenido:'  QA208 one comment  '},before=await counts();
  const responses=await Promise.all(Array.from({length:4},()=>post(body)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,200,201]);
  const first=responses[0].body;assert.equal(first.autor,'Luciano QA');assert.equal(first.contenido,'QA208 one comment');assert.equal(first.creation_request_id,key);
  for(const result of responses)assert.deepEqual(result.body,first);
  assert.deepEqual(await counts(),{comments:before.comments+1,receipts:before.receipts+1});
  const beforeRecovery=await counts(),beforeState=await state();assert.deepEqual(checked(await recover(key)),first);assert.deepEqual(await state(),beforeState);
  const response=await fetch(new URL(`/api${path(taskId)}/solicitudes/${key}?workspace=render_os`,f.base),{headers:{Authorization:`Bearer ${staff}`}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const listing=await fetch(new URL(`/api${path(taskId)}?workspace=render_os`,f.base),{headers:{Authorization:`Bearer ${staff}`}});
  assert.equal(listing.status,200);assert.equal(listing.headers.get('cache-control'),'no-store');
  assert.ok((await listing.json()).some(row=>row.id===first.id&&row.contenido===first.contenido));
  checked(await post({...body,contenido:'Different intent'}),409);
  const anotherTask=await makeTask();checked(await post(body,staff,anotherTask),409);checked(await recover(key,staff,anotherTask),404);
  assert.deepEqual(await counts(),beforeRecovery);
  assert.deepEqual(await state(),beforeState);
 });
 await t.test('actor scope, distinct UUIDs and legacy writers use one business writer',async()=>{
  const key=randomUUID(),body={request_id:key,contenido:'QA208 deliberate same text'},a=checked(await post(body),201);
  checked(await recover(key,other),404);const b=checked(await post(body,other),201);assert.notEqual(a.id,b.id);assert.equal(b.autor,'Designer QA');
  const c=checked(await post({...body,request_id:randomUUID()}),201);assert.notEqual(a.id,c.id);
  const before=await counts(),legacy=checked(await post({autor:'Ignored',contenido:'QA208 legacy still works'}),201);
  assert.equal(Object.hasOwn(legacy,'creation_request_id'),false);assert.equal(legacy.autor,'Luciano QA');assert.equal((await counts()).receipts,before.receipts);
  for(const request_id of [null,'',12,{},`${randomUUID()}\n`])checked(await post({request_id,contenido:'Invalid key'}),400);
 });
 await t.test('different concurrent intents conflict, never merge equal text by heuristics',async()=>{
  const key=randomUUID(),before=await counts();
  const result=await Promise.all([post({request_id:key,contenido:'QA208 race A'}),post({request_id:key,contenido:'QA208 race B'})]);
  assert.deepEqual(result.map(r=>r.status).sort(),[201,409]);assert.deepEqual(await counts(),{comments:before.comments+1,receipts:before.receipts+1});
  assert.equal(checked(await recover(key)).id,result.find(r=>r.status===201).body.id);
 });
 await t.test('staff rename does not change intent identity; explicit admin author remains hash-bound',async()=>{
  const key=randomUUID(),body={request_id:key,autor:'Ignored label',contenido:'QA208 rename-safe intent'},original=checked(await post(body),201);
  await f.query("UPDATE usuarios SET nombre='Renamed QA208' WHERE id=91003");
  try{assert.deepEqual(checked(await post(body)),original);assert.deepEqual(checked(await recover(key)),original);}
  finally{await f.query("UPDATE usuarios SET nombre='Luciano QA' WHERE id=91003");}
  const adminBody={request_id:randomUUID(),autor:'QA208 explicit admin',contenido:'QA208 admin intent'};
  const created=checked(await post(adminBody,admin),201);assert.equal(created.autor,adminBody.autor);
  checked(await post({...adminBody,autor:'Changed admin author'},admin),409);
 });
 await t.test('recovery and replay recheck write ACL, not possession of a valid receipt',async()=>{
  const key=randomUUID(),body={request_id:key,contenido:'QA208 ACL current'},created=checked(await post(body),201),before=await state();
  await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003',[taskId]);
  try{checked(await recover(key),404);checked(await post(body),404);assert.deepEqual(await state(),before);}
  finally{await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[taskId]);}
  assert.equal(checked(await recover(key)).id,created.id);
 });
 await t.test('deleted comments retain immutable tombstone and cannot be resurrected',async()=>{
  const key=randomUUID(),body={request_id:key,contenido:'QA208 tombstone'},comment=checked(await post(body),201);
  await f.query('DELETE FROM tarea_comentarios WHERE id=$1',[comment.id]);const before=await counts();
  checked(await recover(key),409);checked(await post(body),409);assert.deepEqual(await counts(),before);
  await assert.rejects(pool.query('DELETE FROM task_comment_create_receipts WHERE actor_user_id=$1 AND request_id=$2',[91003,key]),e=>e.code==='23514');
 });
 await t.test('failed receipt insertion rolls back the preceding comment in the same transaction',async()=>{
  const before=await counts(),wrapped={connect:async()=>{const db=await pool.connect();return{query:async(sql,values)=>{if(/INSERT INTO task_comment_create_receipts/.test(sql))throw Error('QA208 receipt failure');return db.query(sql,values);},release:()=>db.release()};}};
  await assert.rejects(createTaskComment(wrapped,await actor(),intent()),/QA208 receipt failure/);assert.deepEqual(await counts(),before);
 });
 await t.test('assignment removed while writer waits on task is checked after acquiring task lock',async()=>{
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[taskId]);
  let entered;const ready=new Promise(r=>{entered=r;});
  const wrapped={connect:async()=>{const db=await pool.connect();return{query:(sql,values)=>{const result=db.query(sql,values);if(/FROM tareas/.test(sql)&&/FOR SHARE/.test(sql))entered();return result;},release:()=>db.release()};}};
  const before=await state(),pending=createTaskComment(wrapped,await actor(),intent());const denied=assert.rejects(pending,e=>e.status===404);denied.catch(()=>{});let timer;
  try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Missing task lock barrier')),5000);})]);await blocker.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003',[taskId]);await blocker.query('COMMIT');await denied;assert.deepEqual(await state(),before);}
  finally{clearTimeout(timer);await blocker.query('ROLLBACK');blocker.release();}
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[taskId]);
 });
 await t.test('revocation before current actor lock rejects without comment or receipt',async()=>{
  const observed=await actor(),before=await counts(),blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
  const pending=createTaskComment(pool,observed,intent()),denied=assert.rejects(pending,e=>e.status===401);
  try{await blocker.query('COMMIT');await denied;assert.deepEqual(await counts(),before);}finally{await blocker.query('ROLLBACK');blocker.release();}
 });
 await t.test('revocation after retained authority waits for the authorized commit',async()=>{
  let enter,release,timer;const ready=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;});
  const wrapped={connect:async()=>{const db=await pool.connect();return{query:async(sql,values)=>{
    if(/FROM tareas/.test(sql)&&/FOR SHARE/.test(sql)){enter();await gate;}return db.query(sql,values);
  },release:()=>db.release()};}};
  const observed=await actor(),before=await counts(),operation=createTaskComment(wrapped,observed,intent());operation.catch(()=>{});
  let revoker,revocation;
  try{
    await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Missing actor-retention barrier')),5000);})]);
    revoker=await pool.connect();const {rows:[{pid}]}=await revoker.query('SELECT pg_backend_pid() AS pid');
    revocation=revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');revocation.catch(()=>{});
    const until=Date.now()+3000;let blocked=false;
    while(Date.now()<until){const {rows:[{n}]}=await pool.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[pid]);if(n>0){blocked=true;break;}}
    assert.equal(blocked,true,'Real revoker must wait on held actor row');
    release();assert.equal((await operation).replayed,false);await revocation;
    assert.deepEqual(await counts(),{comments:before.comments+1,receipts:before.receipts+1});
    assert.equal((await actor()).session_version,observed.session_version+1);
  }finally{clearTimeout(timer);release();await operation.catch(()=>{});await revocation?.catch(()=>{});revoker?.release();}
 });
 await t.test('startup rejects disabled receipt binding without attempting schema repair',async()=>{
  await assertCoreSchemaReady(pool);await f.query('ALTER TABLE task_comment_create_receipts DISABLE TRIGGER task_comment_create_receipt_immutable');
  try{await assert.rejects(assertCoreSchemaReady(pool),/task-comment receipt guard is not compatible/);}finally{await f.query('ALTER TABLE task_comment_create_receipts ENABLE TRIGGER task_comment_create_receipt_immutable');}
 });
});
