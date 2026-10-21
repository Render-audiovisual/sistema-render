import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {startLocalHarness,request,fixturePassword,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {productionHistoryHash} from '../src/production-history.js';

test('078 preserves populated legacy provenance and mixed registry without historical backfill',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55733,deferProductionHistoryBatchMigration:true});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),{code:'ENOENT'});});
  const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA102 preserved history',true) RETURNING id");
  const [source]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,fecha_vencimiento,propiedades_extra)
    VALUES('QA102 original visit','Preserved display','en_revision','produccion','visita',$1,'2026-10-25',$2::jsonb) RETURNING *`,
  [client.id,JSON.stringify({workspace:'render_os',produccion_registros:[{cantidad:2,fecha:'2026-10-25'}],produccion_videos_previstos:2})]);
  const children=[];
  for(let n=1;n<=2;n++){
    const [child]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,fecha_vencimiento,aclaraciones,propiedades_extra)
      VALUES($1,'Preserved editor display','en_revision','edicion','video',$2,'2026-10-29',$3,$4::jsonb) RETURNING id,revision`,
    [`QA102 original editing ${n}`,client.id,`Keep original instructions ${n}`,JSON.stringify({workspace:n===1?'render_os':'qa102_historical_external',origen_visita_id:String(source.id)})]);
    children.push(child);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[child.id]);
  }
  const visitId=randomUUID(),oldReview=randomUUID(),videos=[randomUUID(),randomUUID(),randomUUID()];
  await f.query(`INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,drive_url,creado_por_id,actualizado_por_id)
    VALUES($1,$2,$3,'2026-10-25','QA102 mixed existing visit','https://example.invalid/qa102',91001,91001)`,[visitId,source.id,client.id]);
  for(let n=0;n<videos.length;n++)await f.query(`INSERT INTO produccion_videos(id,visita_id,titulo,guion,estado,material_url,creado_por_id,actualizado_por_id)
    VALUES($1,$2,$3,$4,$5,'https://example.invalid/video',91001,91001)`,
  [videos[n],visitId,`QA102 registered video ${n+1}`,`Keep script ${n+1}`,n===2?'planificado':'grabado']);
  await f.query('UPDATE produccion_videos SET tarea_edicion_id=$2,editor_id=91003,fecha_entrega=\'2026-10-29\' WHERE id=$1',[videos[0],children[0].id]);
  await f.query(`INSERT INTO produccion_reconciliaciones(id,actor_user_id,request_id,payload_hash,tarea_origen_id,source_revision,source_history_hash,visita_id)
    VALUES($1,91001,$2,$3,$4,$5,$6,$7)`,[oldReview,randomUUID(),'a'.repeat(64),source.id,source.revision,productionHistoryHash(source),visitId]);
  await f.query('INSERT INTO produccion_reconciliacion_videos(reconciliacion_id,video_id,ordinal) VALUES($1,$2,1)',[oldReview,videos[0]]);
  await f.query('INSERT INTO produccion_edicion_adopciones(reconciliacion_id,video_id,tarea_edicion_id,task_revision) VALUES($1,$2,$3,$4)',
    [oldReview,videos[0],children[0].id,children[0].revision]);
  const snapshot=async()=>{
    const rows={};
    for(const name of ['tareas','tarea_asignaciones','tarea_comentarios','task_editing_deliveries','task_editing_reviews','publicaciones','historias',
      'cliente_objetivo_piezas','cliente_objetivo_eventos','produccion_visitas','produccion_videos','produccion_reconciliaciones',
      'produccion_reconciliacion_videos','produccion_edicion_adopciones'])rows[name]=await f.query(`SELECT * FROM ${name} r ORDER BY to_jsonb(r)::text`);
    return rows;
  };
  const before=await snapshot();
  assert.equal((await f.query("SELECT nombre FROM _migrations WHERE nombre='078_production_history_batches.sql'")).length,0);
  await f.query(await readFile(new URL('../migrations/078_production_history_batches.sql',import.meta.url),'utf8'));
  assert.deepEqual(await snapshot(),before,'No task, script, video, original adoption or immutable evidence is reinterpreted by migration');
  for(const name of ['produccion_revision_lotes','produccion_revision_lote_videos','produccion_lote_edicion_mapeos','produccion_revision_lote_hijos'])
    assert.deepEqual(await f.query(`SELECT * FROM ${name}`),[]);
  await f.query("INSERT INTO _migrations(nombre) VALUES('078_production_history_batches.sql')");
  // Explicit fixture edit after the no-backfill assertion, not migration work.
  await f.query(`UPDATE tareas SET propiedades_extra=jsonb_set(propiedades_extra,'{workspace}','"render_os"'::jsonb) WHERE id=$1`,[children[1].id]);
  const reviewedBaseline=await snapshot();
  const login=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}});
  assert.equal(login.status,200,JSON.stringify(login.body));
  const token=login.body.token;
  const context=async()=>{
    const r=await request(f.base,`/api/producciones/reconciliaciones/lotes/origen/${source.id}`,{token});
    assert.equal(r.status,200,JSON.stringify(r.body));return r.body;
  };
  const payload=c=>({version:2,request_id:randomUUID(),source_task_id:source.id,expected_source_revision:c.source.revision,
    visit_id:visitId,expected_visit_revision:c.visit.revision,expected_context_hash:c.context_hash,
    videos:children.map((child,n)=>({existing_video_id:videos[n],disposition:'adopt_original',task_id:child.id})),
    child_dispositions:children.map((child,n)=>({task_id:child.id,expected_revision:c.legacy_tasks.find(t=>t.id===child.id).revision,
      disposition:'mapped',video_key:videos[n],reason:'Reviewed the original script and editing material manually.'})),
    acknowledgement:'correspondencias_revisadas_manualmente'});
  const submit=body=>request(f.base,'/api/producciones/reconciliaciones',{token,method:'POST',body});
  const body=payload(await context());
  const saved=await submit(body);
  assert.equal(saved.status,201,JSON.stringify(saved.body));
  const after=await snapshot();
  for(const name of Object.keys(reviewedBaseline).filter(n=>!['produccion_visitas','produccion_videos'].includes(n)))
    assert.deepEqual(after[name],reviewedBaseline[name],`${name}: batch review must preserve original rows`);
  assert.equal(after.produccion_videos.find(v=>v.id===videos[1]).tarea_edicion_id,children[1].id);
  assert.deepEqual(after.produccion_videos.find(v=>v.id===videos[2]),before.produccion_videos.find(v=>v.id===videos[2]));
  const replay=await submit(body);
  assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.deepEqual(replay.body.video_ids,saved.body.video_ids);
  assert.deepEqual(await snapshot(),after);

  // The second child must be locked too: a concurrent edit wins before a stale
  // rereview, which must roll back the entire batch without appending evidence.
  const staleBody=payload(await context());
  const barrier=new pg.Client({connectionString:'postgresql://render2_fixture@127.0.0.1:55733/render2_local_test'});
  await barrier.connect();let pending;
  try{
    const identity=(await barrier.query(`SELECT current_database() database,current_user username,
      host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
    assertFixtureIdentity({root:f.root,cwd:f.root,port:55733,url:'postgresql://render2_fixture@127.0.0.1:55733/render2_local_test',identity});
    await barrier.query('BEGIN');
    const pid=(await barrier.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await barrier.query('SELECT id FROM tareas WHERE id=$1 FOR UPDATE',[children[1].id]);
    const counts=await f.query('SELECT id FROM produccion_revision_lotes ORDER BY secuencia');
    pending=submit(staleBody);
    const deadline=Date.now()+2500;let blocked=false;
    while(Date.now()<deadline){
      blocked=(await barrier.query('SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid])).rowCount>0;
      if(blocked)break;
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    assert.equal(blocked,true,'batch must wait on the second original editing task');
    await barrier.query('UPDATE tareas SET titulo=$2,revision=revision+1 WHERE id=$1',[children[1].id,'QA102 concurrent second-child correction']);
    await barrier.query('COMMIT');
    const rejected=await pending;
    assert.equal(rejected.status,409,JSON.stringify(rejected.body));
    assert.deepEqual(await f.query('SELECT id FROM produccion_revision_lotes ORDER BY secuencia'),counts);
    assert.deepEqual((await snapshot()).produccion_videos,after.produccion_videos);
  }finally{
    await barrier.query('ROLLBACK').catch(()=>{});
    await Promise.allSettled([pending].filter(Boolean));await barrier.end();
  }
});
