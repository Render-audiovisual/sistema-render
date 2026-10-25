import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {persistAssignedTask} from '../src/task-persistence.js';
import {syncProductionVisitFromTask} from '../src/production-registry.js';

test('task creation receipt shares the existing assignment/visit transaction and fences replay',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55925,f=await startLocalHarness({port,clusterOnly:true});let pool;
  t.after(async()=>{try{await pool?.end();}finally{await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');t.diagnostic('Owned task-create receipt fixture removed.');}});
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity});
  pool=new pg.Pool({connectionString:url,max:6,options:'-c statement_timeout=15000'});
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA307 task receipts',true) RETURNING id");
  const users=await f.query('SELECT id,nombre,rol,session_version FROM usuarios WHERE id=ANY($1::int[])',[[91001,91002,91003]]);
  const actor=id=>{const u=users.find(row=>row.id===id);return{id:u.id,rol:u.rol,session_version:u.session_version};};
  const assignment={ownerId:91003,ownerName:users.find(row=>row.id===91003).nombre,collaboratorIds:[],collaboratorNames:[],hasCollaborators:true};
  const sql=`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra,fecha_vencimiento,tarea_padre_id)
    VALUES($1,$2,$3,'pendiente',$4,'{"workspace":"render_os"}'::jsonb,'2026-10-29',$5) RETURNING *`;
  const create=({requestId=randomUUID(),title='QA307 task',kind='desarrollo',parent=null,actorId=91001,after}={})=>persistAssignedTask(pool,sql,
    [title,assignment.ownerName,client.id,kind,parent],assignment,
    after??((db,task)=>syncProductionVisitFromTask(db,task,actorId)),null,
    {assignmentNotificationActor:actor(actorId),assignmentNotificationMode:'created',
      createReceipt:{requestId,intent:{workspace:'render_os',title,ownerId:assignment.ownerId,clientId:client.id,kind,parent}}});
  const count=async table=>Number((await f.query(`SELECT count(*) n FROM ${table}`))[0].n);
  await t.test('concurrent same attempt has one task/assignment/receipt and only one notification result',async()=>{
    const requestId=randomUUID(),results=await Promise.all([create({requestId}),create({requestId})]);
    assert.equal(results[0].rows[0].id,results[1].rows[0].id);
    assert.deepEqual(results.map(r=>r.creationReplayed).sort(),[false,true]);
    assert.equal(results.filter(r=>r.assignmentNotification).length,1);
    assert.equal(await count('tareas'),1);assert.equal(await count('tarea_asignaciones'),1);assert.equal(await count('task_create_receipts'),1);
  });
  await t.test('subtask and visit replay preserve one origin each; replay bypasses hooks',async()=>{
    const parent=(await f.query('SELECT id FROM tareas ORDER BY id'))[0].id;
    for(const args of [{title:'QA307 child',parent},{title:'QA307 Visita',kind:'produccion'}]){
      const requestId=randomUUID(),first=await create({...args,requestId});
      const second=await create({...args,requestId,after:()=>assert.fail('Replay cannot run afterSave')});
      assert.equal(first.rows[0].id,second.rows[0].id);assert.equal(second.creationReplayed,true);
      assert.equal(second.assignmentNotification,undefined);
      assert.equal(second.rows[0].tarea_padre_id,args.parent??null);
    }
    assert.equal(await count('tareas'),3);assert.equal(await count('task_create_receipts'),3);
    assert.equal(await count('produccion_visitas'),1);assert.equal(await count('produccion_visita_participantes'),1);
  });
  await t.test('same key changed intent conflicts; actor namespace and distinct keys remain independent',async()=>{
    const requestId=randomUUID(),first=await create({requestId});
    await assert.rejects(create({requestId,title:'Different'}),{status:409});
    const other=await create({requestId,actorId:91002});assert.notEqual(first.rows[0].id,other.rows[0].id);
    const deliberate=await create();assert.notEqual(first.rows[0].id,deliberate.rows[0].id);
  });
  await t.test('rollback after derived visit leaves no partial task, members, visit or receipt',async()=>{
    const before=await Promise.all(['tareas','tarea_asignaciones','produccion_visitas','task_create_receipts'].map(count));
    const requestId=randomUUID();
    await assert.rejects(create({requestId,title:'QA307 Visita rollback',kind:'produccion',after:async(db,task)=>{
      await syncProductionVisitFromTask(db,task,91001);throw Error('Synthetic afterSave failure');
    }}),/Synthetic afterSave/);
    assert.deepEqual(await Promise.all(['tareas','tarea_asignaciones','produccion_visitas','task_create_receipts'].map(count)),before);
    assert.equal((await create({requestId,title:'QA307 Visita rollback',kind:'produccion'})).creationReplayed,false);
  });
  await t.test('replay does not revalidate inactive recipients; deleted task never recreates and receipt remains immutable',async()=>{
    const requestId=randomUUID(),first=await create({requestId});
    await f.query('UPDATE usuarios SET activo=false WHERE id=91003');
    assert.equal((await create({requestId})).rows[0].id,first.rows[0].id);
    await f.query('UPDATE usuarios SET activo=true WHERE id=91003');
    await f.query('DELETE FROM tareas WHERE id=$1',[first.rows[0].id]);
    const before=await count('tareas');await assert.rejects(create({requestId}),{status:404});assert.equal(await count('tareas'),before);
    await assert.rejects(pool.query('DELETE FROM task_create_receipts WHERE request_id=$1',[requestId]),{code:'23514'});
  });
  await t.test('revoked actor cannot recover even a known receipt',async()=>{
    const requestId=randomUUID();await create({requestId});
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001');
    await assert.rejects(create({requestId}),{status:401});
  });
});
