import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness,assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { persistAssignedTask } from '../src/task-persistence.js';
import { assertCurrentEditingApprover } from '../src/editing-approval.js';
import { assertCurrentPublicationRecipient } from '../src/publication-recipient-authority.js';

test('publication recipient SHARE rechecks outer-read authority and retains eligibility through commit',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55878,f=await startLocalHarness({port,clusterOnly:true});
  const connections=new Set(),pools=new Set();
  t.after(async()=>{
    for(const c of connections)await c.query('ROLLBACK').catch(()=>{});
    await Promise.all([...connections].map(c=>c.end()));await Promise.all([...pools].map(p=>p.end()));
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own recipient authority fixture cleanup ENOENT: ${f.root}; port${port}`);
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
  const monitor=await auxiliary(),pool=new pg.Pool({...config,max:1});pools.add(pool);
  const warm=await pool.connect();let writerPid;
  try{await guard(warm);writerPid=(await warm.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;}finally{warm.release();}
  const observed=promise=>{
    const state={promise,settled:false};
    promise.then(value=>{state.value=value;state.settled=true;},error=>{state.error=error;state.settled=true;});return state;
  };
  async function blocked(waiter,blocker,pending){
    const deadline=Date.now()+5000;
    do{
      if(pending.settled)assert.fail('Operation ended before the required PostgreSQL blocking edge');
      if((await monitor.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked',[waiter,blocker])).rows[0].blocked)return;
      await new Promise(resolve=>setTimeout(resolve,15));
    }while(Date.now()<deadline);
    assert.fail('Required pg_blocking_pids edge was not observed within 5 seconds');
  }
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  async function snapshot(excluded=[]){
    const result={};
    for(const table of tables.filter(name=>!excluded.includes(name)))result[table]=hash(await f.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`));
    return result;
  }
  const same=(actual,expected)=>assert.deepEqual(Object.keys(expected).filter(name=>actual[name]!==expected[name]),[],
    'Unexpected public table mutation; only table names are reported');
  const recipientRow=async()=>(await f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id=91004'))[0].row;
  const otherUsers=()=>f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id<>91004 ORDER BY id');
  const usersBefore=hash(await otherUsers());
  const auth=Object.freeze({id:91001,rol:'admin',session_version:1});
  let serial=0;
  async function seed(owner=91003){
    await f.query("UPDATE usuarios SET activo=true,rol='community' WHERE id=91004");
    const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      SELECT $1,nombre,'en_revision','edicion','{"workspace":"render_os","colaboradores":[]}'::jsonb FROM usuarios WHERE id=$2
      RETURNING id,revision`,[`QA231 publication task ${++serial}`,owner]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')",[task.id,owner]);
    return {...task,owner};
  }
  async function outerPrecheck(){
    const rows=await f.query("SELECT id,nombre FROM usuarios WHERE id=$1 AND activo=TRUE AND rol IN ('admin','community')",[91004]);
    assert.equal(rows.length,1);return rows[0];
  }
  function write(task,{after=null,revision=task.revision}={}){
    const collaborators=task.owner===91004?[]:[task.owner];
    return persistAssignedTask(pool,`UPDATE tareas SET asignado_a=$2,estado='aprobada',
      propiedades_extra=propiedades_extra || $3::jsonb,updated_at=now()
      WHERE id=$1 AND revision=$4 AND estado='en_revision' RETURNING *`,
    [task.id,'Designer QA',JSON.stringify({revision_aprobada:true,responsable_publicacion_id:91004}),revision],
    {ownerId:91004,ownerName:'Designer QA',collaboratorIds:collaborators,collaboratorNames:collaborators.map(()=>'Luciano QA'),hasCollaborators:true},
    after,async db=>{
      await assertCurrentEditingApprover(db,auth);
      await assertCurrentPublicationRecipient(db,91004);
    },{assignmentNotificationActor:auth,assignmentNotificationTaskId:task.id});
  }
  for(const change of [
    {name:'inactive',sql:'UPDATE usuarios SET activo=false WHERE id=91004',patch:{activo:false}},
    {name:'role',sql:"UPDATE usuarios SET rol='diseno' WHERE id=91004",patch:{rol:'diseno'}},
  ])await t.test(`outer precheck becomes stale: ${change.name} before recipient SHARE rejects all writes`,async()=>{
    const task=await seed();await outerPrecheck();
    const before=await snapshot(['usuarios']),old=await recipientRow(),blocker=await auxiliary();let pending;
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM usuarios WHERE id=91004 FOR UPDATE');await blocker.query(change.sql);
      pending=observed(write(task));await blocked(writerPid,blocker.pid,pending);
      // The writer is past its actor guard and blocked on the recipient's row.
      assert.equal((await monitor.query('SELECT query FROM pg_stat_activity WHERE pid=$1',[writerPid])).rows[0].query,
        'SELECT id,nombre,rol,activo FROM usuarios WHERE id=$1 FOR SHARE');
      await blocker.query('COMMIT');await assert.rejects(pending.promise,{status:400});
      assert.equal(pending.value,undefined);same(await snapshot(['usuarios']),before);
      assert.equal(hash(await recipientRow()),hash({...old,...change.patch,user_admin_version:old.user_admin_version+1}));
    }finally{await blocker.query('ROLLBACK').catch(()=>{});if(pending)await Promise.allSettled([pending.promise]);}
  });
  await t.test('authorized recipient is SHARE-retained while task waits; role revoker waits until successful commit',async()=>{
    const task=await seed();await outerPrecheck();
    const before=await snapshot(['usuarios','tareas','tarea_asignaciones']),old=await recipientRow();
    const oldTask=(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[task.id]))[0].row;
    const otherTasks=()=>f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id<>$1 ORDER BY id',[task.id]);
    const otherMembers=()=>f.query('SELECT to_jsonb(a) AS row FROM tarea_asignaciones a WHERE tarea_id<>$1 ORDER BY to_jsonb(a)::text',[task.id]);
    const otherTaskHash=hash(await otherTasks()),otherMemberHash=hash(await otherMembers());
    const barrier=await auxiliary(),revoker=await auxiliary();let pending,revoke,authorizedInside=false;
    try{
      await barrier.query('BEGIN');await barrier.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[task.id]);
      pending=observed(write(task,{after:async db=>{
        const user=(await db.query('SELECT rol,activo FROM usuarios WHERE id=91004')).rows[0];
        assert.deepEqual(user,{rol:'community',activo:true});authorizedInside=true;
      }}));
      await blocked(writerPid,barrier.pid,pending);
      await revoker.query('BEGIN');revoke=observed(revoker.query("UPDATE usuarios SET rol='diseno' WHERE id=91004"));
      await blocked(revoker.pid,writerPid,revoke);
      assert.equal(pending.settled,false);assert.equal(revoke.settled,false);
      await barrier.query('COMMIT');const result=await pending.promise;
      assert.equal(authorizedInside,true);
      const context=result.assignmentNotification;assert.ok(context);assert.equal(context.actorId,91001);
      assert.equal(context.actor,'Franco QA');assert.equal(context.tarea.asignado_a_id,91004);
      // The route targets current publisher, NOT delta (which also includes
      // the old owner newly becoming a collaborator).
      assert.deepEqual(context.destinatarioIds,[91003,91004]);
      assert.deepEqual([context.tarea.asignado_a_id],[91004]);assert.ok(Object.isFrozen(context));
      await revoke.promise;await revoker.query('COMMIT');
      assert.equal(hash(await recipientRow()),hash({...old,rol:'diseno',user_admin_version:old.user_admin_version+1}));
      const stored=(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[task.id]))[0].row;
      assert.equal(stored.revision,oldTask.revision+1);assert.equal(stored.asignado_a,'Designer QA');assert.equal(stored.estado,'aprobada');
      assert.deepEqual(stored.propiedades_extra,{...oldTask.propiedades_extra,revision_aprobada:true,responsable_publicacion_id:91004});
      const stable=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['revision','asignado_a','estado','propiedades_extra','updated_at'].includes(key)));
      assert.equal(hash(stable(stored)),hash(stable(oldTask)));
      assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id',[task.id]),[
        {usuario_id:91003,tipo:'colaborador'},{usuario_id:91004,tipo:'responsable'},
      ]);
      assert.equal(hash(await otherTasks()),otherTaskHash);assert.equal(hash(await otherMembers()),otherMemberHash);
      same(await snapshot(['usuarios','tareas','tarea_asignaciones']),before);
    }finally{
      await barrier.query('ROLLBACK').catch(()=>{});await revoker.query('ROLLBACK').catch(()=>{});
      if(pending)await Promise.allSettled([pending.promise]);if(revoke)await Promise.allSettled([revoke.promise]);
    }
  });
  await t.test('unchanged publisher has empty delta but route target remains owner; CAS zero and rollback publish nothing',async()=>{
    const task=await seed(91004);await outerPrecheck();const before=await snapshot();
    const zero=await write(task,{revision:task.revision+99});assert.deepEqual(zero.rows,[]);assert.equal(zero.assignmentNotification,undefined);
    same(await snapshot(),before);
    const sentinel=new Error('QA231 original callback failure');let failedResult;
    await assert.rejects(write(task,{after:async()=>{throw sentinel;}}).then(result=>{failedResult=result;}),error=>error===sentinel);
    assert.equal(failedResult,undefined);same(await snapshot(),before);
    const result=await write(task);assert.deepEqual(result.assignmentNotification.destinatarioIds,[]);
    assert.deepEqual([result.assignmentNotification.tarea.asignado_a_id],[91004]);
    same(await snapshot(['tareas','tarea_asignaciones']),Object.fromEntries(Object.entries(before)
      .filter(([name])=>!['tareas','tarea_asignaciones'].includes(name))));
  });
  assert.equal(hash(await otherUsers()),usersBefore);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
  t.diagnostic(`Own cluster ${f.root}; ${tables.length} public tables observed; direct persistence/guards only, no HTTP/notifier/provider claim`);
});
