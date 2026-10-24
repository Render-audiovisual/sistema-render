import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness,assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { persistAssignedTask } from '../src/task-persistence.js';

test('physical task creation captures authority and members atomically against actor revocation',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55875,f=await startLocalHarness({port,clusterOnly:true});
  const connections=new Set(),pools=new Set();
  t.after(async()=>{
    for(const c of connections)await c.query('ROLLBACK').catch(()=>{});
    await Promise.all([...connections].map(c=>c.end()));
    await Promise.all([...pools].map(p=>p.end()));
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own creation authority fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard=async db=>assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await db.query(identitySql)).rows[0]});
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await f.query(identitySql))[0]});
  const config={connectionString:url,statement_timeout:15000,lock_timeout:12000,connectionTimeoutMillis:5000};
  async function auxiliary(){
    const c=new pg.Client(config);await c.connect();connections.add(c);await guard(c);
    c.pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return c;
  }
  const monitor=await auxiliary();
  const pool=new pg.Pool({...config,max:1});pools.add(pool);
  const warm=await pool.connect();let writerPid;
  try{await guard(warm);writerPid=(await warm.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;}finally{warm.release();}
  const observed=promise=>{
    const state={promise,settled:false};
    promise.then(value=>{state.value=value;state.settled=true;},error=>{state.error=error;state.settled=true;});
    return state;
  };
  async function blocked(waiter,blocker,pending){
    const deadline=Date.now()+5000;
    do{
      if(pending.settled)assert.fail('Operation ended before the required PostgreSQL blocking edge');
      const {rows}=await monitor.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked',[waiter,blocker]);
      if(rows[0].blocked)return;
      await new Promise(resolve=>setTimeout(resolve,15));
    }while(Date.now()<deadline);
    assert.fail('Required pg_blocking_pids edge was not observed within 5 seconds');
  }
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  async function snapshot(excluded=[]){
    const result={};
    for(const table of tables.filter(name=>!excluded.includes(name))){
      const rows=await f.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);
      result[table]=hash(rows);
    }
    return result;
  }
  const assertHashes=(actual,expected)=>assert.deepEqual(Object.keys(expected).filter(name=>actual[name]!==expected[name]),[],
    'Unexpected public table mutation; only table names are reported');
  const userRow=async()=>(await f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id=91001'))[0].row;
  const otherUsers=()=>f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id<>91001 ORDER BY id');
  const otherUsersBefore=hash(await otherUsers());
  const resetActor=()=>f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=91001");
  const assignment={ownerId:91003,ownerName:'Luciano QA',collaboratorIds:[91002,91004],
    collaboratorNames:['Agustin QA','Designer QA'],hasCollaborators:true};
  const insert=`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
    VALUES($1,$2,'pendiente','edicion',$3::jsonb) RETURNING *`;
  let serial=0;
  const write=(after=null,before=null)=>persistAssignedTask(pool,insert,
    [`QA229 creation ${++serial}`,'Luciano QA',JSON.stringify({workspace:'render_os',colaboradores:['Agustin QA','Designer QA']})],
    assignment,after,before,{assignmentNotificationActor:{id:91001,rol:'admin',session_version:1},assignmentNotificationMode:'created'});

  for(const change of [
    {name:'inactive',sql:'UPDATE usuarios SET activo=false WHERE id=91001',patch:{activo:false}},
    {name:'epoch',sql:'UPDATE usuarios SET session_version=2 WHERE id=91001',patch:{session_version:2}},
    {name:'role',sql:"UPDATE usuarios SET rol='edicion' WHERE id=91001",patch:{rol:'edicion'}},
  ])await t.test(`${change.name} committed before actor SHARE denies creation without rows or context`,async()=>{
    await resetActor();
    const before=await snapshot(['usuarios']),oldUser=await userRow(),blocker=await auxiliary();let pending;
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM usuarios WHERE id=91001 FOR UPDATE');
      await blocker.query(change.sql);
      pending=observed(write());
      await blocked(writerPid,blocker.pid,pending);
      await blocker.query('COMMIT');
      await assert.rejects(pending.promise,{status:401});assert.equal(pending.value,undefined);
      assertHashes(await snapshot(['usuarios']),before);
      assert.equal(hash(await userRow()),hash({...oldUser,...change.patch,user_admin_version:oldUser.user_admin_version+1}));
    }finally{
      await blocker.query('ROLLBACK').catch(()=>{});
      if(pending)await Promise.allSettled([pending.promise]);
    }
  });
  await t.test('authorized creation holds actor SHARE through advisory barrier, INSERT and membership COMMIT',async()=>{
    await resetActor();
    const before=await snapshot(['usuarios','tareas','tarea_asignaciones']),oldUser=await userRow();
    const oldTasks=await f.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id');
    const oldMembers=await f.query('SELECT to_jsonb(a) AS row FROM tarea_asignaciones a ORDER BY to_jsonb(a)::text');
    const barrier=await auxiliary(),revoker=await auxiliary();let pending,revoke;
    let callbackTask,transactionRow;
    try{
      await barrier.query('BEGIN');await barrier.query('SELECT pg_advisory_xact_lock($1,$2)',[229,1]);
      pending=observed(write(async(db,task)=>{
        assert.equal((await db.query('SELECT session_version FROM usuarios WHERE id=91001')).rows[0].session_version,1);
        callbackTask=structuredClone(task);
        transactionRow=(await db.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[task.id])).rows[0].row;
      },async db=>{
        // persistAssignedTask invokes this on its actual transaction connection
        // only after the actor row has been verified and SHARE-locked.
        await db.query('SELECT pg_advisory_xact_lock($1,$2)',[229,1]);
      }));
      await blocked(writerPid,barrier.pid,pending);
      await revoker.query('BEGIN');
      revoke=observed(revoker.query('UPDATE usuarios SET session_version=2 WHERE id=91001'));
      await blocked(revoker.pid,writerPid,revoke);
      assert.equal(pending.settled,false);assert.equal(revoke.settled,false);
      await barrier.query('COMMIT');
      const result=await pending.promise,context=result.assignmentNotification;
      assert.equal(result.rows.length,1);assert.ok(context);assert.ok(callbackTask);
      const taskId=result.rows[0].id;
      assert.ok(Number.isSafeInteger(taskId)&&taskId>0);assert.equal(result.rows[0].revision,1);
      assert.equal(context.actorId,91001);assert.equal(context.actor,'Franco QA');
      assert.equal(context.tarea.id,taskId);assert.equal(context.tarea.revision,1);
      assert.deepEqual(context.destinatarioIds,[91002,91003,91004]);
      assert.ok(Object.isFrozen(context));assert.ok(Object.isFrozen(context.destinatarioIds));
      await revoke.promise;await revoker.query('COMMIT');
      assert.equal(hash(await userRow()),hash({...oldUser,session_version:2,user_admin_version:oldUser.user_admin_version+1}));
      const [stored]=await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[taskId]);
      assert.equal(hash(stored.row),hash(transactionRow),'Exactly the transaction-created task persists, including timestamp precision');
      assert.equal(stored.row.titulo,callbackTask.titulo);assert.equal(stored.row.asignado_a,'Luciano QA');
      assert.equal(stored.row.estado,'pendiente');assert.equal(stored.row.tipo_tarea,'edicion');assert.equal(stored.row.revision,1);
      assert.deepEqual(stored.row.propiedades_extra,{workspace:'render_os',colaboradores:['Agustin QA','Designer QA']});
      assert.equal(context.tarea.updated_at,new Date(callbackTask.updated_at).toISOString());
      assert.equal(context.tarea.asignado_a_id,91003);assert.deepEqual(context.tarea.colaborador_ids,[91002,91004]);
      assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id',[taskId]),[
        {usuario_id:91002,tipo:'colaborador'},{usuario_id:91003,tipo:'responsable'},{usuario_id:91004,tipo:'colaborador'},
      ]);
      assert.equal(hash(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id<>$1 ORDER BY id',[taskId])),hash(oldTasks));
      assert.equal(hash(await f.query('SELECT to_jsonb(a) AS row FROM tarea_asignaciones a WHERE tarea_id<>$1 ORDER BY to_jsonb(a)::text',[taskId])),hash(oldMembers));
      assertHashes(await snapshot(['usuarios','tareas','tarea_asignaciones']),before);
      assert.deepEqual(context.destinatarioIds,[91002,91003,91004],'Subsequent revocation does not mutate committed context');
    }finally{
      await barrier.query('ROLLBACK').catch(()=>{});
      await revoker.query('ROLLBACK').catch(()=>{});
      if(pending)await Promise.allSettled([pending.promise]);
      if(revoke)await Promise.allSettled([revoke.promise]);
    }
  });
  await t.test('callback failure rolls back INSERT and memberships and preserves original error identity',async()=>{
    await resetActor();const before=await snapshot();
    const sentinel=new Error('QA229 original callback failure');let insertedId;
    const pending=observed(write(async(db,task)=>{
      insertedId=task.id;
      assert.equal((await db.query('SELECT count(*)::int AS total FROM tarea_asignaciones WHERE tarea_id=$1',[task.id])).rows[0].total,3);
      throw sentinel;
    }));
    await assert.rejects(pending.promise,error=>error===sentinel);
    assert.ok(Number.isSafeInteger(insertedId));assert.equal(pending.value,undefined);
    assertHashes(await snapshot(),before);
    assert.deepEqual(await f.query('SELECT id FROM tareas WHERE id=$1',[insertedId]),[]);
    assert.deepEqual(await f.query('SELECT usuario_id FROM tarea_asignaciones WHERE tarea_id=$1',[insertedId]),[]);
    // Sequence advancement is deliberately not equated with committed rows.
  });
  assert.equal(hash(await otherUsers()),otherUsersBefore);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
  t.diagnostic(`Own cluster ${f.root}; ${tables.length} public tables observed; direct creation service only, no HTTP/notifier/provider claim`);
});
