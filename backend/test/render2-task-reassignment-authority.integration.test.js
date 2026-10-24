import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness,assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { persistAssignedTask } from '../src/task-persistence.js';

test('physical reassignment actor SHARE orders revocation against the committed task and context',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55872,f=await startLocalHarness({port,clusterOnly:true});
  const connections=new Set(),pools=new Set();
  t.after(async()=>{
    for(const c of connections)await c.query('ROLLBACK').catch(()=>{});
    await Promise.all([...connections].map(c=>c.end()));
    await Promise.all([...pools].map(p=>p.end()));
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own authority fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard=async db=>assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await db.query(identitySql)).rows[0]});
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await f.query(identitySql))[0]});
  const config={connectionString:url,statement_timeout:15000,lock_timeout:12000,connectionTimeoutMillis:5000};
  async function auxiliary(){
    const c=new pg.Client(config);await c.connect();connections.add(c);
    await guard(c);c.pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return c;
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
      if(pending.settled)assert.fail('Operation completed before its required PostgreSQL blocking edge');
      const {rows}=await monitor.query(`SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked`,[waiter,blocker]);
      if(rows[0].blocked)return;
      await new Promise(resolve=>setTimeout(resolve,15));
    }while(Date.now()<deadline);
    assert.fail('Required pg_blocking_pids edge was not observed within 5 seconds');
  }
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  async function snapshot(excluded=[]){
    const result={};
    for(const table of tables.filter(name=>!excluded.includes(name))){
      const rows=await f.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);
      result[table]=hash(rows);
    }
    return result;
  }
  const assertHashes=(actual,expected)=>assert.deepEqual(Object.keys(expected).filter(name=>actual[name]!==expected[name]),[],
    'Unexpected public table mutation (only table names are reported)');
  const actor=()=>({id:91001,rol:'admin',session_version:1});
  const newAssignment={ownerId:91002,ownerName:'Agustin QA',collaboratorIds:[],collaboratorNames:[],hasCollaborators:true};
  let serial=0;
  async function seed(){
    await f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=91001");
    const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES($1,'Luciano QA','pendiente','edicion','{"workspace":"render_os","colaboradores":[]}'::jsonb) RETURNING id,revision`,
    [`QA227 task ${++serial}`]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[task.id]);
    return task;
  }
  const sql=`UPDATE tareas SET asignado_a=$2,updated_at=now() WHERE id=$1 AND revision=$3 RETURNING *`;
  const write=(task,after=null,revision=task.revision)=>persistAssignedTask(pool,sql,[task.id,'Agustin QA',revision],newAssignment,after,null,
    {assignmentNotificationActor:actor(),assignmentNotificationTaskId:task.id});
  async function userRow(){return (await f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id=91001'))[0].row;}
  const otherUsers=()=>f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id<>91001 ORDER BY id');
  const otherUsersBefore=hash(await otherUsers());

  for(const change of [{name:'inactive',sql:'UPDATE usuarios SET activo=false WHERE id=91001',patch:{activo:false}},
    {name:'epoch',sql:'UPDATE usuarios SET session_version=2 WHERE id=91001',patch:{session_version:2}},
    {name:'role',sql:"UPDATE usuarios SET rol='edicion' WHERE id=91001",patch:{rol:'edicion'}}]){
    await t.test(`committed ${change.name} before actor authorization returns 401 with no domain/context`,async()=>{
      const task=await seed(),before=await snapshot(['usuarios']),oldUser=await userRow();
      const blocker=await auxiliary();let pending;
      try{
        await blocker.query('BEGIN');await blocker.query('SELECT id FROM usuarios WHERE id=91001 FOR UPDATE');
        await blocker.query(change.sql);
        pending=observed(write(task));
        await blocked(writerPid,blocker.pid,pending);
        await blocker.query('COMMIT');
        await assert.rejects(pending.promise,{status:401});
        assert.equal(pending.value,undefined);
        assertHashes(await snapshot(['usuarios']),before);
        assert.equal(hash(await userRow()),hash({...oldUser,...change.patch,user_admin_version:oldUser.user_admin_version+1}),
          'Only the intentional actor revocation and its monotonic administration version change');
      }finally{
        await blocker.query('ROLLBACK').catch(()=>{});
        if(pending)await Promise.allSettled([pending.promise]);
      }
    });
  }
  await t.test('authorized writer retains actor SHARE while task-blocked; revoker commits only after writer',async()=>{
    const task=await seed(),before=await snapshot(['usuarios','tareas','tarea_asignaciones']),oldUser=await userRow();
    const original=(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[task.id]))[0].row;
    const otherTasks=()=>f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id<>$1 ORDER BY id',[task.id]);
    const otherMemberships=()=>f.query('SELECT to_jsonb(a) AS row FROM tarea_asignaciones a WHERE tarea_id<>$1 ORDER BY to_jsonb(a)::text',[task.id]);
    const otherTaskHash=hash(await otherTasks()),otherMembershipHash=hash(await otherMemberships());
    const barrier=await auxiliary(),revoker=await auxiliary();let pending,revoke;
    let heldInside=false,committed=false;
    try{
      await barrier.query('BEGIN');await barrier.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[task.id]);
      pending=observed(write(task,async(db,saved)=>{
        assert.equal(saved.id,task.id);
        assert.equal((await db.query('SELECT session_version FROM usuarios WHERE id=91001')).rows[0].session_version,1);
        heldInside=true;
      }));
      await blocked(writerPid,barrier.pid,pending);
      await revoker.query('BEGIN');
      revoke=observed(revoker.query('UPDATE usuarios SET session_version=2 WHERE id=91001'));
      await blocked(revoker.pid,writerPid,revoke);
      assert.equal(pending.settled,false);assert.equal(revoke.settled,false);
      await barrier.query('COMMIT');
      const result=await pending.promise;committed=true;
      assert.equal(heldInside,true);
      const context=result.assignmentNotification;
      assert.ok(context);assert.equal(context.actorId,91001);assert.equal(context.actor,'Franco QA');
      assert.deepEqual(context.destinatarioIds,[91002]);assert.equal(context.tarea.id,task.id);
      assert.ok(Object.isFrozen(context));assert.ok(Object.isFrozen(context.destinatarioIds));
      await revoke.promise;await revoker.query('COMMIT');
      assert.equal(committed,true);
      assert.equal(hash(await userRow()),hash({...oldUser,session_version:2,user_admin_version:oldUser.user_admin_version+1}));
      const stored=(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[task.id]))[0].row;
      assert.equal(stored.asignado_a,'Agustin QA');assert.equal(stored.revision,original.revision+1);
      const stable=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['asignado_a','revision','updated_at'].includes(key)));
      assert.equal(hash(stable(stored)),hash(stable(original)));
      assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id',[task.id]),
        [{usuario_id:91002,tipo:'responsable'}]);
      assertHashes(await snapshot(['usuarios','tareas','tarea_asignaciones']),before);
      assert.equal(hash(await otherTasks()),otherTaskHash,'Other task rows unchanged');
      assert.equal(hash(await otherMemberships()),otherMembershipHash,'Other task membership rows unchanged');
      assert.deepEqual(context.destinatarioIds,[91002],'Later revocation does not mutate a committed event snapshot');
    }finally{
      await barrier.query('ROLLBACK').catch(()=>{});
      // Release any actor UPDATE before draining operations on failure.
      await revoker.query('ROLLBACK').catch(()=>{});
      if(pending)await Promise.allSettled([pending.promise]);
      if(revoke)await Promise.allSettled([revoke.promise]);
    }
  });
  await t.test('zero-row CAS publishes no context and callback rollback preserves exact original error/data',async()=>{
    const task=await seed(),before=await snapshot();
    const zero=await write(task,null,task.revision+99);
    assert.deepEqual(zero.rows,[]);assert.equal(Object.hasOwn(zero,'assignmentNotification'),false);
    assertHashes(await snapshot(),before);
    const sentinel=new Error('QA227 original callback error');
    await assert.rejects(write(task,async()=>{throw sentinel;}),error=>error===sentinel);
    assertHashes(await snapshot(),before);
  });
  assert.equal(hash(await otherUsers()),otherUsersBefore,'Other account rows unchanged');
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
  t.diagnostic(`Own cluster ${f.root}; ${tables.length} public tables observed; direct service only, no notifier/provider invoked`);
});
