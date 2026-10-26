import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { planLegacyAssignments, applyLegacyAssignments } from '../src/legacy-assignment-reconciliation.js';

test('reconciliation binds all task IDs and explicit exceptions without rewriting prior work or assignments',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55989,f=await startLocalHarness({port,clusterOnly:true});
  const config={host:'127.0.0.1',port,user:'render2_fixture',database:'render2_local_test',password:'',ssl:false,
    connectionTimeoutMillis:5000,statement_timeout:15000,lock_timeout:8000,application_name:'assignment_universe_owned_55989'};
  const pool=new pg.Pool({...config,max:4}),writer=new pg.Client(config),operations=new Set();
  t.after(async()=>{
    try{
      await writer.query('ROLLBACK').catch(()=>{});await Promise.allSettled([...operations]);
      await Promise.allSettled([writer.end(),pool.end()]);
    }finally{await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
      t.diagnostic('Own PG55989 cleaned ENOENT; no configured DB, provider, production or existing copy used.');}
  });
  await writer.connect();
  const identity=(await pool.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  const expectedIdentity={database:identity.database,username:identity.username,address:identity.address,port:identity.port};
  const options={environment:'test',expectedIdentity};
  const writerPid=(await writer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  const insertSql=`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,propiedades_extra)
    VALUES($1,'Ambiguous synthetic label','edicion',$2::jsonb) RETURNING id`;
  async function insert(title,properties={workspace:'render_os'}){return (await pool.query(insertSql,[title,JSON.stringify(properties)])).rows[0].id;}
  async function choicesFor(taskId){return [{task_id:taskId,owner_id:91003,collaborator_ids:[91004]}];}
  async function exceptionsFor(choices){
    const selected=new Set(choices.map(row=>row.task_id));
    return (await pool.query('SELECT id FROM public.tareas ORDER BY id')).rows.filter(row=>!selected.has(row.id))
      .map(row=>({task_id:row.id,reason:'Explicit fixture review: preserve task and all existing bindings'}));
  }
  async function planFor(choices){return planLegacyAssignments(pool,choices,{...options,exceptions:await exceptionsFor(choices)});}
  const apply=(plan,selectedPool=pool)=>applyLegacyAssignments(selectedPool,plan,{...options,approvedPlanHash:plan.plan_hash});
  async function snapshot(){
    const hashes={};const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    for(const {tablename}of tables){assert.match(tablename,/^[a-z_][a-z0-9_]*$/);
      hashes[tablename]=(await pool.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM public."${tablename}" r`)).rows[0].hash;
    }
    return hashes;
  }
  async function eventually(predicate,message){const end=Date.now()+5000;
    while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail(message);
  }
  const selectedId=await insert('Selected synthetic task');
  const oldId=await insert('Previously normalized synthetic task');
  const outsideId=await insert('Archived foreign-scope synthetic task',{workspace:'other',papelera_render_os:true});
  await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91004,'responsable')",[oldId]);
  const choices=await choicesFor(selectedId);

  await t.test('omissions reject read-only; explicit exceptions include old normalized and foreign-scope IDs',async()=>{
    const before=await snapshot();await assert.rejects(planLegacyAssignments(pool,choices,options),error=>error.status===409);
    assert.deepEqual(await snapshot(),before);
    const plan=await planFor(choices);assert.equal(plan.version,2);assert.deepEqual(plan.snapshot.task_universe_ids,[selectedId,oldId,outsideId]);
    assert.deepEqual(plan.exceptions.map(row=>row.task_id),[oldId,outsideId]);
    assert.deepEqual(plan.snapshot.exception_assignments,[{tarea_id:oldId,usuario_id:91004,tipo:'responsable'}]);
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('new task outside choices invalidates exact selected-row snapshot without any assignment write',async()=>{
    const plan=await planFor(choices);await insert('New task after approval');
    // Use the planner's UTC normalization, not the observer's session timezone.
    const selected=(await planFor(choices)).snapshot.tasks[0];
    assert.equal(selected.source_hash,plan.snapshot.tasks[0].source_hash);
    const before=await snapshot();await assert.rejects(apply(plan),error=>error.status===409&&/universo/.test(error.message));
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('outside ID committed while apply waits for task-table lock is visible to the first serial snapshot',async()=>{
    const plan=await planFor(choices);await writer.query('BEGIN');
    const concurrentId=(await writer.query(insertSql,['Concurrent before lock',JSON.stringify({workspace:'render_os'})])).rows[0].id;
    let applyPid;
    const observedPool={async connect(){const db=await pool.connect();applyPid=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return {query:(sql,params)=>db.query(sql,params),release:error=>db.release(error)};}};
    // Attach rejection handling immediately so a failure cannot be unhandled.
    const pending=apply(plan,observedPool).then(result=>({result}),error=>({error}));operations.add(pending);
    try{await eventually(async()=>applyPid&&(await pool.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) blocked',[writerPid,applyPid])).rows[0].blocked,
      'Apply did not wait on the uncommitted task insert');}
    finally{await writer.query('COMMIT');}
    const result=await pending;operations.delete(pending);assert.equal(result.error?.status,409,result.error?.message);
    assert.match(result.error.message,/universo/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[])',[[selectedId,concurrentId]])).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM tareas WHERE id=$1',[concurrentId])).rows[0].n,1);
  });

  await t.test('insert arriving after universe validation cannot commit inside the assignment window',async()=>{
    const plan=await planFor(choices);let insertPromise,observedBlock=false;
    const gatedPool={async connect(){const db=await pool.connect();const pid=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return {release:error=>db.release(error),async query(sql,params){const result=await db.query(sql,params);
        if(sql==='SELECT id FROM public.tareas ORDER BY id'){
          insertPromise=writer.query(insertSql,['Created only after reconciliation commit',JSON.stringify({workspace:'render_os'})]);
          operations.add(insertPromise);insertPromise.catch(()=>{});
          await eventually(async()=>(await pool.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) blocked',[pid,writerPid])).rows[0].blocked,
            'Outside insert slipped past the retained task-universe lock');observedBlock=true;
        }
        return result;
      }};}};
    const before=await snapshot();const result=await apply(plan,gatedPool);assert.equal(result.assignments,2);assert.equal(observedBlock,true);
    const inserted=await insertPromise;operations.delete(insertPromise);
    const after=await snapshot();for(const name of Object.keys(before))if(!['tareas','tarea_asignaciones'].includes(name))assert.equal(after[name],before[name],name);
    assert.equal((await pool.query('SELECT count(*)::int n FROM tarea_asignaciones WHERE tarea_id=$1',[inserted.rows[0].id])).rows[0].n,0);
    assert.deepEqual((await pool.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id',[selectedId])).rows,
      [{usuario_id:91003,tipo:'responsable'},{usuario_id:91004,tipo:'colaborador'}]);
    assert.deepEqual((await pool.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1',[oldId])).rows,[{usuario_id:91004,tipo:'responsable'}]);
    const current=await snapshot();await assert.rejects(apply(plan),error=>error.status===409);assert.deepEqual(await snapshot(),current);
  });

  await t.test('late selected-assignment conflict aborts, preserving prior bindings and exception observations',async()=>{
    const freshId=await insert('Conflict synthetic task'),freshChoices=await choicesFor(freshId),plan=await planFor(freshChoices);
    await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91001,'colaborador')",[freshId]);
    const before=await snapshot();await assert.rejects(apply(plan),error=>error.status===409);assert.deepEqual(await snapshot(),before);
  });

  await t.test('338 owners plus 12 collaborators add exactly 350 relations while every other table and old binding stays intact',async()=>{
    const tasks=(await pool.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,propiedades_extra)
      SELECT 'Synthetic reviewed task '||n,'Ambiguous synthetic label','edicion','{"workspace":"render_os"}'::jsonb
      FROM generate_series(1,338) n RETURNING id`)).rows.sort((a,b)=>a.id-b.id);
    const selected=tasks.map((row,index)=>({task_id:row.id,owner_id:91003,collaborator_ids:index<12?[91004]:[]}));
    const plan=await planFor(selected),before=await snapshot();
    const old=(await pool.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones ORDER BY tarea_id,usuario_id')).rows;
    const result=await apply(plan);assert.equal(result.tasks,338);assert.equal(result.assignments,350);
    const after=await snapshot();for(const name of Object.keys(before))if(name!=='tarea_asignaciones')assert.equal(after[name],before[name],name);
    const actual=(await pool.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones ORDER BY tarea_id,usuario_id')).rows;
    const ids=new Set(tasks.map(row=>row.id));assert.deepEqual(actual.filter(row=>!ids.has(row.tarea_id)),old);
    assert.equal(actual.filter(row=>ids.has(row.tarea_id)&&row.tipo==='responsable').length,338);
    assert.equal(actual.filter(row=>ids.has(row.tarea_id)&&row.tipo==='colaborador').length,12);
    const committed=await snapshot();await assert.rejects(apply(plan),error=>error.status===409);assert.deepEqual(await snapshot(),committed);
  });
});
