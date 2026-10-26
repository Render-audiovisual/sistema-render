import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';
import { planLegacyAssignments, applyLegacyAssignments } from '../src/legacy-assignment-reconciliation.js';

test('explicit legacy ID reconciliation preserves original work and manual report closures independently', {
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
 const port=55999,f=await startLocalHarness({port});
 const pool=new pg.Pool({connectionString:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,max:2,connectionTimeoutMillis:5000});
 t.after(async()=>{await pool.end();await f.cleanup();await assert.rejects(access(f.root),{code:'ENOENT'});});
 const identity=(await pool.query("SELECT current_database() AS database,current_user AS username,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory")).rows[0];
 assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
 const expectedIdentity={database:identity.database,username:identity.username,address:identity.address,port:identity.port},options={environment:'test',expectedIdentity};
 const api=(route,token,method='GET',body)=>request(f.base,'/api'+route,{token,method,body});
 const ownerLogin=await api('/login',null,'POST',{usuario:'qa_franco',password:fixturePassword});assert.equal(ownerLogin.status,200);
 const employeeLogin=await api('/login',null,'POST',{usuario:'qa_luciano',password:fixturePassword});assert.equal(employeeLogin.status,200);
 const tokens=[ownerLogin.body.token,employeeLogin.body.token];
 const tasks=(await pool.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,fecha_vencimiento,propiedades_extra)
   VALUES('QA explicit reconciliation one','Historical duplicate label','edicion','2026-11-05','{"workspace":"render_os"}'),
   ('QA explicit reconciliation two','Historical duplicate label','diseno','2026-11-06','{"workspace":"render_os"}') RETURNING id`)).rows;
 const choices=[{task_id:tasks[0].id,owner_id:91003,collaborator_ids:[]},{task_id:tasks[1].id,owner_id:91004,collaborator_ids:[91003]}];
 async function snapshot(){
  const names=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const hashes={};for(const {tablename}of names){assert.match(tablename,/^[a-z_][a-z0-9_]*$/);
   hashes[tablename]=(await pool.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text) ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM public."${tablename}" r`)).rows[0].hash;
  }return hashes;
 }
 const baseline=await snapshot();const stale=await planLegacyAssignments(pool,choices,options);assert.deepEqual(await snapshot(),baseline,'planning is read-only');
 assert.equal(stale.version,2);assert.deepEqual(stale.exceptions,[]);
 assert.deepEqual(stale.snapshot.task_universe_ids,tasks.map(task=>task.id).sort((a,b)=>a-b),
  'the initial selection explicitly covers the entire synthetic task universe');
 await pool.query("UPDATE tareas SET titulo=titulo||' changed' WHERE id=$1",[tasks[1].id]);
 const beforeStale=await snapshot();await assert.rejects(applyLegacyAssignments(pool,stale,{...options,approvedPlanHash:stale.plan_hash}),e=>e.status===409);assert.deepEqual(await snapshot(),beforeStale);
 const plan=await planLegacyAssignments(pool,choices,options),before=await snapshot();
 const result=await applyLegacyAssignments(pool,plan,{...options,approvedPlanHash:plan.plan_hash});assert.equal(result.tasks,2);assert.equal(result.assignments,3);
 const after=await snapshot();for(const name of Object.keys(before))if(name!=='tarea_asignaciones')assert.equal(after[name],before[name],name+' must remain physically unchanged');
 assert.deepEqual((await pool.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id',[tasks.map(x=>x.id)])).rows,[
  {tarea_id:tasks[0].id,usuario_id:91003,tipo:'responsable'},
  {tarea_id:tasks[1].id,usuario_id:91003,tipo:'colaborador'},
  {tarea_id:tasks[1].id,usuario_id:91004,tipo:'responsable'},
 ]);
 await assert.rejects(applyLegacyAssignments(pool,plan,{...options,approvedPlanHash:plan.plan_hash}),e=>e.status===409);assert.deepEqual(await snapshot(),after,'repeat cannot duplicate/overwrite');
 const home=await api('/inicio',tokens[1]);assert.equal(home.status,200);assert.equal(home.body.summary.open,2);
 const detail=await api(`/tareas/${tasks[0].id}?workspace=render_os`,tokens[1]);assert.equal(detail.status,200);assert.equal(detail.body.asignado_a_id,91003);
 assert.equal((await api('/sueldos?periodo=2026-10',tokens[1])).status,403);
 const missing=await api('/reportes/datos',tokens[1]);assert.equal(missing.status,200);assert.deepEqual(missing.body.cierresMensuales,{disponible:false,registros:[]});
 // Legacy schema/data exists only inside this owned disposable fixture.
 await pool.query(`CREATE TABLE public.reporte_cierres_mensuales(periodo date NOT NULL,usuario_id integer NOT NULL REFERENCES usuarios(id),nombre_snapshot text NOT NULL,porcentaje smallint NOT NULL,motivo text,autorizado_por text,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(periodo,usuario_id))`);
 await pool.query(`INSERT INTO public.reporte_cierres_mensuales(periodo,usuario_id,nombre_snapshot,porcentaje,motivo,autorizado_por)
   VALUES('2026-09-01',91003,'Same historical name',100,'QA_PRIVATE_CLOSURE_AMOUNT','QA_PRIVATE_CLOSURE_AMOUNT'),
   ('2026-09-01',91004,'Same historical name',75,'QA_PRIVATE_CLOSURE_AMOUNT','QA_PRIVATE_CLOSURE_AMOUNT')`);
 const beforeReports=await snapshot();
 for(const token of tokens){const report=await api('/reportes/datos',token);assert.equal(report.status,200);
  assert.deepEqual(report.body.cierresMensuales.registros.map(r=>[r.periodo,r.usuario_id,r.porcentaje]),[['2026-09-01',91003,100],['2026-09-01',91004,75]]);
  assert.equal(report.body.cierresMensuales.disponible,true);assert.doesNotMatch(JSON.stringify(report.body),/QA_PRIVATE_CLOSURE_AMOUNT|"motivo"|"autorizado_por"/);
  assert.equal(report.body.tareasRenderOs.find(r=>r.id===tasks[0].id).estado,'pendiente');assert.deepEqual(report.body.publicaciones,[]);
 }
 assert.deepEqual(await snapshot(),beforeReports,'report reads must not rewrite any history, tasks or publication');
 const third=(await pool.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,propiedades_extra)
   VALUES('QA concurrent direct assignment','Untrusted label','diseno','{"workspace":"render_os"}') RETURNING id`)).rows[0];
 const concurrentChoices=[{task_id:third.id,owner_id:91004,collaborator_ids:[]}];
 const beforeCoverage=await snapshot();
 await assert.rejects(planLegacyAssignments(pool,concurrentChoices,options),e=>e.status===409&&/universo/.test(e.message));
 assert.deepEqual(await snapshot(),beforeCoverage,'partial choices cannot silently omit previously reconciled tasks');
 const exceptions=tasks.map(task=>({task_id:task.id,reason:'Preserve the three explicitly reconciled fixture bindings without reassigning'}));
 const concurrentPlan=await planLegacyAssignments(pool,concurrentChoices,{...options,exceptions});let insertedBeforeLock=false;
 assert.deepEqual(concurrentPlan.exceptions,exceptions.slice().sort((a,b)=>a.task_id-b.task_id));
 assert.deepEqual(concurrentPlan.snapshot.task_universe_ids,[...tasks.map(task=>task.id),third.id].sort((a,b)=>a-b));
 assert.deepEqual(concurrentPlan.snapshot.exception_assignments,(
  await pool.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id',[tasks.map(task=>task.id)])).rows);
 const beforeConcurrent=await snapshot();
 const guardedPool={async connect(){const db=await pool.connect();return{release:error=>db.release(error),async query(sql,params){
  if(sql.startsWith('LOCK TABLE public.tarea_asignaciones')){
   await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91001,'colaborador')",[third.id]);insertedBeforeLock=true;
  }
  return db.query(sql,params);
 }};}};
 await assert.rejects(applyLegacyAssignments(guardedPool,concurrentPlan,{...options,approvedPlanHash:concurrentPlan.plan_hash}),e=>e.status===409);
 assert.equal(insertedBeforeLock,true);
 assert.deepEqual((await pool.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1',[third.id])).rows,[{usuario_id:91001,tipo:'colaborador'}],
  'newly committed direct assignment is visible to the first serial snapshot and never overwritten');
 const afterConcurrent=await snapshot();for(const name of Object.keys(beforeConcurrent))if(name!=='tarea_asignaciones')
  assert.equal(afterConcurrent[name],beforeConcurrent[name],name+' remains physically unchanged after concurrent rejection');
 assert.deepEqual((await pool.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id',
  [tasks.map(task=>task.id)])).rows,concurrentPlan.snapshot.exception_assignments,'all prior excepted bindings remain exact');
});
