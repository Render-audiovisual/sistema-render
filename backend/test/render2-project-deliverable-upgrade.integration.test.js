import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {access,readFile} from 'node:fs/promises';
import pg from 'pg';
import {startLocalHarness,request,fixturePassword,assertFixtureIdentity} from '../scripts/render2-local-test.js';

test('079 preserves historical approvals and waits on the observed deliverable before rejecting concurrent content changes',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55736,deferProjectDeliverableApprovalMigration:true});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),{code:'ENOENT'});});
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA103 preserved project client',true) RETURNING id");
  const projectId=randomUUID(),deliverableId=randomUUID();
  await f.query(`INSERT INTO proyectos(id,titulo,cliente_id,responsable_id,tipo,creado_por_id,actualizado_por_id,request_id,request_hash)
    VALUES($1,'QA103 historical web project',$2,91003,'web',91001,91001,$3,$4)`,[projectId,client.id,randomUUID(),'a'.repeat(64)]);
  await f.query(`INSERT INTO proyecto_entregables(id,proyecto_id,titulo,url,observaciones,estado,aprobado_por_id,aprobado_at)
    VALUES($1,$2,'QA103 preserved delivery','https://example.invalid/qa103-original','Keep the original observation',
      'aprobado',91001,'2026-10-01T12:00:00Z')`,[deliverableId,projectId]);
  await f.query(`INSERT INTO proyecto_actividad(proyecto_id,actor_id,accion,recurso_id,estado_anterior,estado_nuevo)
    VALUES($1,91001,'editar_entregable',$2,'en_revision','aprobado')`,[projectId,deliverableId]);
  const tables=['proyectos','proyecto_entregables','proyecto_actividad','tareas','tarea_asignaciones','publicaciones','historias',
    'task_editing_deliveries','task_editing_reviews','editorial_publicacion_eventos'];
  const snapshot=async()=>{
    const result={};
    for(const table of tables){
      const value=table==='proyecto_entregables'?"to_jsonb(r)-ARRAY['contenido_revision','entregable_revision','aprobacion_actual_id']":"to_jsonb(r)";
      result[table]=await f.query(`SELECT ${value} row FROM ${table} r ORDER BY to_jsonb(r)::text`);
    }
    return result;
  };
  const before=await snapshot();
  assert.deepEqual(await f.query("SELECT nombre FROM _migrations WHERE nombre='079_project_deliverable_approvals.sql'"),[]);
  await f.query(await readFile(new URL('../migrations/079_project_deliverable_approvals.sql',import.meta.url),'utf8'));
  assert.deepEqual(await snapshot(),before,'Migration must not reinterpret original approval or business records');
  assert.deepEqual(await f.query('SELECT * FROM proyecto_entregable_aprobaciones'),[]);
  await f.query("INSERT INTO _migrations(nombre) VALUES('079_project_deliverable_approvals.sql')");
  const logged=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}});
  assert.equal(logged.status,200,JSON.stringify(logged.body));const token=logged.body.token;
  const read=async()=>{
    const response=await request(f.base,`/api/proyectos/${projectId}`,{token});
    assert.equal(response.status,200,JSON.stringify(response.body));return response.body.proyecto;
  };
  const bodyFor=project=>{
    const d=project.entregables.find(item=>item.id===deliverableId);
    return {request_id:randomUUID(),expected_revision:project.revision,expected_entregable_revision:d.entregable_revision,
      expected_content_revision:d.contenido_revision,expected_content_hash:d.contenido_hash};
  };
  const approve=body=>request(f.base,`/api/proyectos/${projectId}/entregables/${deliverableId}/aprobaciones`,{token,method:'POST',body});
  const legacy=await read();const old=legacy.entregables.find(item=>item.id===deliverableId);
  assert.equal(old.estado,'aprobado');assert.equal(old.aprobacion_versionada,false);assert.equal(old.aprobacion_actual_id,null);
  assert.equal(old.aprobado_por_id,91001);assert.equal(new Date(old.aprobado_at).toISOString(),'2026-10-01T12:00:00.000Z');
  const firstBody=bodyFor(legacy),first=await approve(firstBody);
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal(first.body.proyecto.entregables.find(item=>item.id===deliverableId).aprobacion_versionada,true);
  const stable=await snapshot();const replay=await approve(firstBody);
  assert.equal(replay.status,200,JSON.stringify(replay.body));assert.deepEqual(replay.body.aprobacion,first.body.aprobacion);
  assert.deepEqual(await snapshot(),stable);

  const stale=bodyFor(await read());let pending;
  const barrier=new pg.Client({connectionString:'postgresql://render2_fixture@127.0.0.1:55736/render2_local_test'});
  await barrier.connect();
  try{
    const identity=(await barrier.query(`SELECT current_database() database,current_user username,
      host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
    assertFixtureIdentity({root:f.root,cwd:f.root,port:55736,url:'postgresql://render2_fixture@127.0.0.1:55736/render2_local_test',identity});
    await barrier.query('BEGIN');const pid=(await barrier.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await barrier.query('SELECT id FROM proyecto_entregables WHERE id=$1 FOR UPDATE',[deliverableId]);
    pending=approve(stale);const deadline=Date.now()+2500;let blocked=false;
    while(Date.now()<deadline){
      blocked=(await barrier.query('SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid])).rowCount>0;
      if(blocked)break;await new Promise(resolve=>setTimeout(resolve,15));
    }
    assert.equal(blocked,true,'approval must wait on its exact observed deliverable');
    await barrier.query("UPDATE proyecto_entregables SET url='https://example.invalid/qa103-concurrent' WHERE id=$1",[deliverableId]);
    await barrier.query('COMMIT');
    const result=await pending;assert.equal(result.status,409,JSON.stringify(result.body));
    const current=(await read()).entregables.find(item=>item.id===deliverableId);
    assert.equal(current.estado,'en_revision');assert.equal(current.aprobacion_versionada,false);assert.equal(current.aprobacion_actual_id,null);
    assert.equal((await f.query('SELECT * FROM proyecto_entregable_aprobaciones')).length,1);
    const after=await snapshot();
    for(const table of tables.filter(name=>name!=='proyecto_entregables'))assert.deepEqual(after[table],stable[table],table);
    const finalReplay=await approve(firstBody);assert.equal(finalReplay.status,200,JSON.stringify(finalReplay.body));
    assert.equal(finalReplay.body.proyecto.entregables.find(item=>item.id===deliverableId).estado,'en_revision');
    assert.deepEqual(await snapshot(),after,'Receipt replay cannot reactivate the historical approval');
  }finally{
    await barrier.query('ROLLBACK').catch(()=>{});await Promise.allSettled([pending].filter(Boolean));await barrier.end();
  }
  // Revalidate authority after an actual DB wait, not just from JWT claims.
  const beforeRevocation=await snapshot(),authorityBody=bodyFor(await read());
  const actorBarrier=new pg.Client({connectionString:'postgresql://render2_fixture@127.0.0.1:55736/render2_local_test'});
  await actorBarrier.connect();let authorityPending;
  try{
    const identity=(await actorBarrier.query(`SELECT current_database() database,current_user username,
      host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
    assertFixtureIdentity({root:f.root,cwd:f.root,port:55736,url:'postgresql://render2_fixture@127.0.0.1:55736/render2_local_test',identity});
    await actorBarrier.query('BEGIN');const pid=(await actorBarrier.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await actorBarrier.query('SELECT id FROM usuarios WHERE id=91001 FOR UPDATE');
    authorityPending=approve(authorityBody);const deadline=Date.now()+2500;let blocked=false;
    while(Date.now()<deadline){
      blocked=(await actorBarrier.query('SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid])).rowCount>0;
      if(blocked)break;await new Promise(resolve=>setTimeout(resolve,15));
    }
    assert.equal(blocked,true,'approval must wait on current authenticated actor authority');
    await actorBarrier.query("UPDATE usuarios SET rol='edicion',session_version=session_version+1 WHERE id=91001");
    await actorBarrier.query('COMMIT');
    const denied=await authorityPending;assert.equal(denied.status,401,JSON.stringify(denied.body));
    assert.deepEqual(await snapshot(),beforeRevocation);
    assert.equal((await f.query('SELECT * FROM proyecto_entregable_aprobaciones')).length,1);
  }finally{
    await actorBarrier.query('ROLLBACK').catch(()=>{});await Promise.allSettled([authorityPending].filter(Boolean));await actorBarrier.end();
  }
});
