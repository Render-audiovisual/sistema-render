import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createProductionRegistryRouter, syncProductionVisitFromTask, validateProductionVisit, validateProductionItem} from '../src/production-registry.js';

const visitId='11111111-1111-4111-8111-111111111111',videoId='22222222-2222-4222-8222-222222222222';
const sourceTask={id:10,cliente_id:1,fecha_vencimiento:'2026-10-19',titulo:'Visita producción',tipo_tarea:'produccion',propiedades_extra:{workspace:'render_os'}};
const visitBody={cliente_id:1,fecha:'2026-10-19',titulo:'Visita',participante_ids:[11]};
function fixture({linked=true,legacy=false,wrongScope=false,failAssignments=false,lineage=false,existingTask=false,editorRole='edicion',missingEditor=false,archived=false,sourceClientAfterLock=1}={}) {
  const calls=[];let prior;let tasksCreated=0;
  let visit={id:visitId,tarea_origen_id:linked?10:null,cliente_id:1,cliente_nombre:'Cliente',fecha:'2026-10-19',titulo:'Visita',participante_ids:[11],observaciones:'Notas',drive_url:'https://drive.example.test/material',revision:1};
  let video={id:videoId,visita_id:visitId,video_origen_id:null,titulo:'Video 1',guion:'Guion completo',estado:'grabado',material_url:'',observaciones:'Material',tarea_edicion_id:existingTask?500:null,editor_id:existingTask?7:null,fecha_entrega:existingTask?'2026-10-22':null};
  let source=structuredClone(sourceTask);
  if(archived) source.propiedades_extra.archivada_render_os=true;
  let task={id:500,revision:1,cliente_id:1,estado:'pendiente',fecha_vencimiento:'2026-10-22',propiedades_extra:{private_finance:'PRIVATE'}};
  const db={release(){calls.push({sql:'RELEASE'});},async query(sql,params=[]){
    calls.push({sql,params});
    if(sql==='BEGIN'){prior=structuredClone({visit,video,source,task,tasksCreated});return{rows:[]};}
    if(sql==='ROLLBACK'){({visit,video,source,task,tasksCreated}=prior);return{rows:[]};}
    if(sql==='COMMIT')return{rows:[]};
    if(sql==="SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))")return{rows:[]};
    if(sql.startsWith('WITH RECURSIVE familia AS'))return{rows:[]};
    if(sql.startsWith('SELECT tarea_origen_id FROM produccion_visitas'))return{rows:[{tarea_origen_id:visit.tarea_origen_id}]};
    if(sql.startsWith('SELECT id,cliente_id,to_char'))return{rows:linked?[{id:visitId,cliente_id:visit.cliente_id,fecha:visit.fecha}]:[]};
    if(sql.startsWith('SELECT v.cliente_id FROM produccion_videos'))return{rows:[]};
    if(sql.startsWith('SELECT id FROM produccion_reconciliaciones WHERE visita_id='))return{rows:[]};
    if(sql==='SELECT cliente_id FROM produccion_visitas WHERE id=$1')return{rows:sourceClientAfterLock===null?[]:[{cliente_id:sourceClientAfterLock}]};
    if(sql==='SELECT id FROM produccion_videos WHERE visita_id=$1 ORDER BY id FOR UPDATE')return{rows:[{id:videoId}]};
    if(sql.startsWith('SELECT id FROM tareas WHERE id='))return{rows:[{id:10}]};
    if(sql.startsWith('SELECT * FROM tareas'))return{rows:[sql.includes('workspace')?source:task]};
    if(sql.startsWith('SELECT t.*,to_char(t.fecha_vencimiento'))return{rows:[task]};
    if(sql.includes("propiedades_extra->>'origen_visita_id'"))return{rows:legacy?[{id:99}]:[]};
    if(sql.includes('FROM clientes WHERE'))return{rows:[{id:params[0],nombre:'Cliente'}]};
    if(sql.includes('FROM usuarios WHERE'))return{rows:missingEditor?[]:params[0].map(id=>({id,nombre:'Editor',rol:editorRole}))};
    if(sql.startsWith('SELECT tarea_id, usuario_id'))return{rows:[{tarea_id:500,usuario_id:7,tipo:'responsable'},{tarea_id:10,usuario_id:11,tipo:'responsable'}]};
    if(sql.includes('FROM produccion_visitas v JOIN clientes'))return{rows:[{...visit,private_finance:'PRIVATE'}]};
    if(sql.startsWith('SELECT pv.id FROM produccion_videos'))return{rows:lineage?[{id:videoId}]:[]};
    if(sql.startsWith('SELECT pv.id,pv.visita_id,pv.titulo'))return{rows:[{...video,id:params[0],visita_id:'33333333-3333-4333-8333-333333333333',estado:'pendiente'}]};
    if(sql.includes('FROM produccion_videos pv LEFT JOIN tareas'))return{rows:wrongScope?[]:[{...video,private_finance:'PRIVATE',editor_actual_id:7,fecha_entrega_actual:'2026-10-23',tarea_estado:'en_revision'}]};
    if(sql.startsWith('SELECT id FROM produccion_videos WHERE video_origen_id'))return{rows:lineage?[{id:videoId}]:[]};
    if(sql.includes('FROM produccion_fotos'))return{rows:[]};
    if(sql.startsWith('SELECT id FROM produccion_videos WHERE id='))return{rows:wrongScope?[]:[{id:videoId}]};
    if(sql.startsWith('INSERT INTO tareas(')){assert.match(sql,/RETURNING \*,to_char\(fecha_vencimiento,'YYYY-MM-DD'\) AS fecha_vencimiento/);tasksCreated++;task={id:500,revision:1,cliente_id:params[2],titulo:params[0],fecha_vencimiento:params[3],estado:'pendiente',propiedades_extra:JSON.parse(params[6])};return{rows:[task]};}
    if(sql.startsWith('INSERT INTO tarea_asignaciones')){if(failAssignments)throw Error('assignment failure');return{rows:[]};}
    if(sql.startsWith('DELETE FROM tarea_asignaciones'))return{rows:[]};
    if(sql.startsWith('UPDATE produccion_videos SET tarea_edicion_id')){video={...video,tarea_edicion_id:params[2],editor_id:params[3],fecha_entrega:params[4]};return{rows:[]};}
    if(sql.startsWith('UPDATE produccion_visitas SET revision')){visit.revision++;return{rows:[]};}
    if(sql.startsWith('UPDATE tareas SET fecha_vencimiento')){source.fecha_vencimiento=params[1];if(params[2])source.cliente_id=params[2];return{rows:[]};}
    if(sql.startsWith('UPDATE produccion_visitas SET fecha=')){visit.fecha=params[1];return{rows:[]};}
    if(sql.startsWith('INSERT INTO produccion_visitas(')){visit={...visit,id:params[0],tarea_origen_id:params[1],cliente_id:params[2],fecha:params[3],titulo:params[4]};return{rows:[{id:visit.id}]};}
    if(sql.startsWith('DELETE FROM produccion_visita_participantes'))return{rows:[]};
    if(sql.startsWith('INSERT INTO produccion_visita_participantes')){visit.participante_ids=params[1];return{rows:[]};}
    if(sql.startsWith('INSERT INTO produccion_videos(')||sql.startsWith('UPDATE produccion_videos SET titulo=')||sql.startsWith('INSERT INTO produccion_fotos('))return{rows:[]};
    throw Error(`Unexpected unit query: ${sql}`);
  }};
  const pool={query:db.query.bind(db),connect:async()=>db};
  const router=createProductionRegistryRouter({express,pool});
  return {calls,db,get visit(){return visit;},get source(){return source;},get tasksCreated(){return tasksCreated;},get video(){return video;},
    async run(method,path,body={},auth={id:11,rol:'admin'},params={},query={}){
      const req={auth,body,query,params:{id:visitId,videoId,...params}};
      const res={statusCode:200,status(c){this.statusCode=c;return this;},json(value){this.body=value;return this;}};
      let allowed=false;router.stack[0].handle(req,res,()=>{allowed=true;});if(!allowed)return res;
      const run=router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route.stack[0].handle;
      await run(req,res,error=>{throw error;});return res;
    }};
}

test('closed inputs reject financial bags, invalid dates, URLs, string IDs and revisions',()=>{
  for(const extra of [{importe:1},{propiedades_extra:{finance:1}},{fecha:'2026-02-31'},{cliente_id:'1'},{participante_ids:['11']},{drive_url:'javascript:alert(1)'}])assert.throws(()=>validateProductionVisit({...visitBody,...extra}));
  assert.deepEqual(validateProductionVisit({...visitBody,participante_ids:[11,11]}).participante_ids,[11]);
  for(const expected_revision of [undefined,0,-1,'1',1.1])assert.throws(()=>validateProductionItem({titulo:'Video',expected_revision},'videos'));
  assert.throws(()=>validateProductionItem({titulo:'Video',expected_revision:1,estado:'publicada'},'videos'));
  assert.throws(()=>validateProductionItem({tipo:'Fotos',expected_revision:1,drive_url:'https://user:pass@example.test'},'fotos'));
});
test('all verified members can read, unbound and inactive identities fail closed',async()=>{
  for(const rol of ['admin','community','produccion','edicion','diseno','unknown'])assert.equal((await fixture().run('get','/:id',{}, {id:11,rol})).statusCode,200);
  for(const auth of [{rol:'admin'},{id:'11',rol:'admin'},{id:11,activo:false}])assert.equal((await fixture().run('get','/:id',{},auth)).statusCode,403);
});
test('read DTO exposes only scalar operational fields, complete guion and current editing state',async()=>{
  const res=await fixture().run('get','/:id');
  assert.equal(JSON.stringify(res.body).includes('PRIVATE'),false);
  assert.equal(res.body.visita.videos[0].guion,'Guion completo');
  assert.equal(res.body.visita.videos[0].tarea_estado,'en_revision');
  assert.equal(res.body.visita.videos[0].fecha_entrega_actual,'2026-10-23');
});
test('month/UUID validation and pending route do not invent filters or lineage',async()=>{
  assert.equal((await fixture().run('get','/',{},undefined,{}, {mes:'2026-13'})).statusCode,400);
  assert.equal((await fixture().run('get','/:id',{},undefined,{id:'bad'})).statusCode,400);
  const f=fixture();await f.run('get','/pendientes');
  assert.match(f.calls[0].sql,/NOT EXISTS\(SELECT 1 FROM produccion_videos child WHERE child.video_origen_id=pv.id\)/);
});
test('handoff creates exactly one pending video task with IDs atomically and source-first locks',async()=>{
  const f=fixture();const res=await f.run('post','/:id/videos/:videoId/enviar-edicion',{expected_revision:1,editor_id:7,fecha_entrega:'2026-10-22'});
  assert.equal(res.statusCode,201);assert.equal(f.tasksCreated,1);assert.equal(f.visit.revision,2);
  assert.equal(res.body.task.estado,'pendiente');
  assert.equal(res.body.task.fecha_vencimiento,'2026-10-22');
  assert.equal(res.body.task.propiedades_extra.origen_produccion_video_id,videoId);
  assert.equal(res.body.task.propiedades_extra.produccion_visita_id,visitId);
  assert.equal(res.body.task.propiedades_extra.origen_visita_id,undefined);
  const sql=f.calls.map(call=>call.sql);
  assert.ok(sql.findIndex(s=>s.startsWith('SELECT * FROM tareas'))<sql.findIndex(s=>s.includes('FOR UPDATE OF v')));
  assert.ok(sql.findIndex(s=>s.includes('FOR UPDATE OF v'))<sql.findIndex(s=>s.includes('FOR UPDATE OF pv')));
  assert.deepEqual(f.calls.find(call=>call.sql.startsWith('INSERT INTO tarea_asignaciones')).params,[500,[7],['responsable']]);
  assert.equal(sql.at(-2),'COMMIT');assert.equal(sql.at(-1),'RELEASE');
});
test('admin only handoff, stale revisions, wrong child scopes, legacy aggregates and inactive editors fail without task creation',async()=>{
  const body={expected_revision:1,editor_id:7,fecha_entrega:'2026-10-22'};
  assert.equal((await fixture().run('post','/:id/videos/:videoId/enviar-edicion',body,{id:11,rol:'edicion'})).statusCode,403);
  for(const [options,input,status] of [[{}, {...body,expected_revision:2},409],[{wrongScope:true},body,404],[{legacy:true},body,409],[{missingEditor:true},body,400]]){
    const f=fixture(options);assert.equal((await f.run('post','/:id/videos/:videoId/enviar-edicion',input)).statusCode,status);assert.equal(f.tasksCreated,0);
  }
});
test('exact duplicate handoff can return an existing task with stale visit revision, never retarget it',async()=>{
  const f=fixture({existingTask:true});
  const body={expected_revision:99,editor_id:7,fecha_entrega:'2026-10-22'};
  const res=await f.run('post','/:id/videos/:videoId/enviar-edicion',body);
  assert.equal(res.body.created,false);assert.equal(f.tasksCreated,0);assert.equal(f.visit.revision,1);
  assert.equal(res.body.task.fecha_vencimiento,'2026-10-22');
  assert.ok(f.calls.some(call=>call.sql.includes("to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento")));
  assert.equal((await f.run('post','/:id/videos/:videoId/enviar-edicion',{...body,editor_id:8})).statusCode,409);
});
test('assignment failure rolls back task, video link and aggregate revision',async()=>{
  const f=fixture({failAssignments:true});
  await assert.rejects(f.run('post','/:id/videos/:videoId/enviar-edicion',{expected_revision:1,editor_id:7,fecha_entrega:'2026-10-22'}),/assignment failure/);
  assert.equal(f.tasksCreated,0);assert.equal(f.video.tarea_edicion_id,null);assert.equal(f.visit.revision,1);assert.equal(f.calls.at(-2).sql,'ROLLBACK');
});
test('registry date edit updates source date in the same transaction without changing edit deadlines',async()=>{
  const f=fixture();const res=await f.run('patch','/:id',{expected_revision:1,fecha:'2026-10-20'});
  assert.equal(res.statusCode,200);assert.equal(f.source.fecha_vencimiento,'2026-10-20');assert.equal(f.visit.revision,2);
  assert.equal(f.calls.filter(call=>call.sql.startsWith('UPDATE tareas')).length,1);
});
test('client change rejects any existing video lineage, not just editing tasks',async()=>{
  const f=fixture({lineage:true});assert.equal((await f.run('patch','/:id',{expected_revision:1,cliente_id:2})).statusCode,409);assert.equal(f.visit.cliente_id,1);
  assert.match(f.calls.find(call=>call.sql.startsWith('SELECT pv.id FROM')).sql,/pv.video_origen_id IS NOT NULL OR EXISTS/);
});
test('child mutations require aggregate revision and reject cross-visit child IDs',async()=>{
  const stale=fixture();assert.equal((await stale.run('post','/:id/videos',{expected_revision:2,titulo:'Video'})).statusCode,409);
  const foreign=fixture({wrongScope:true});assert.equal((await foreign.run('patch','/:id/videos/:itemId',{expected_revision:1,titulo:'Video'},undefined,{itemId:videoId})).statusCode,404);
  const f=fixture();assert.equal((await f.run('post','/:id/fotos',{expected_revision:1,tipo:'Producto'})).statusCode,201);assert.equal(f.visit.revision,2);
});
test('manual pending reuse copies full script/title, preserves source and links by UUID',async()=>{
  const f=fixture();const origin='44444444-4444-4444-8444-444444444444';
  assert.equal((await f.run('post','/:id/videos',{expected_revision:1,video_origen_id:origin})).statusCode,201);
  const advisory=f.calls.findIndex(call=>call.sql==="SELECT pg_advisory_xact_lock(hashtext('vinculo-objetivo-mensual'))");
  const visitLock=f.calls.findIndex(call=>call.sql.startsWith('SELECT tarea_origen_id FROM produccion_visitas'));
  assert.ok(advisory>0 && visitLock>advisory,'Lineage serialization precedes any visit/source lock');
  const insert=f.calls.find(call=>call.sql.startsWith('INSERT INTO produccion_videos('));
  assert.ok(insert.params.includes('Guion completo'));assert.ok(insert.params.includes('Video 1'));assert.ok(insert.params.includes(origin));
  assert.equal(f.calls.some(call=>call.sql.startsWith('UPDATE produccion_videos')),false);
});
test('source sync is insert-only, normalized IDs only, and never writes task metadata or creates videos',async()=>{
  const f=fixture({linked:false});const result=await syncProductionVisitFromTask(f.db,sourceTask,11);
  assert.ok(result.id);assert.deepEqual(result.participante_ids,[11]);
  assert.equal(f.calls.some(call=>/^(BEGIN|COMMIT|UPDATE tareas|INSERT INTO produccion_videos)/.test(call.sql)),false);
  assert.match(f.calls.find(call=>call.sql.startsWith('INSERT INTO produccion_visitas')).sql,/ON CONFLICT\(tarea_origen_id\) DO NOTHING/);
});
test('existing source sync guards client/date/type/workspace changes before classification early return',async()=>{
  for(const change of [{cliente_id:2},{fecha_vencimiento:null},{fecha_vencimiento:'2026-10-20'},{tipo_tarea:'edicion'},{propiedades_extra:{}}]){
    const f=fixture();await assert.rejects(syncProductionVisitFromTask(f.db,{...sourceTask,...change},11),error=>error.status===409);
    assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT')),false);
  }
  const f=fixture();assert.equal(await syncProductionVisitFromTask(f.db,{...sourceTask,titulo:'Visita producción nueva etiqueta'},11),null);
});
test('source hook rejects linked editing task client changes and leaves current dates/owners independent',async()=>{
  const db={async query(sql){if(sql.startsWith('SELECT v.cliente_id'))return{rows:[{cliente_id:1}]};return{rows:[]};}};
  await assert.rejects(syncProductionVisitFromTask(db,{id:500,cliente_id:2,tipo_tarea:'edicion'},11),error=>error.status===409);
  assert.equal(await syncProductionVisitFromTask(db,{id:500,cliente_id:1,tipo_tarea:'edicion'},11),null);
});

test('archiving a linked source does not overwrite, reject or immobilize its registry',async()=>{
  for(const flag of ['archivada_render_os','papelera_render_os']) for(const value of [true,'true']) {
    const f=fixture();
    assert.equal(await syncProductionVisitFromTask(f.db,{...sourceTask,propiedades_extra:{workspace:'render_os',[flag]:value}},11),null);
    assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT INTO produccion_visitas')),false);
  }
  const f=fixture({archived:true});
  assert.equal((await f.run('patch','/:id',{expected_revision:1,fecha:'2026-10-20'})).statusCode,200);
  assert.equal(f.visit.revision,2);
  assert.equal((await f.run('post','/:id/videos/:videoId/enviar-edicion',{expected_revision:2,editor_id:7,fecha_entrega:'2026-10-22'})).statusCode,201);
});

test('normal synchronization preserves unlinked aggregate historical production without creating a new registry',async()=>{
  for(const metadata of [
    {produccion_registros:[{cantidad:3,nota:'Keep historical aggregate'}]},
    {produccion_registros:'malformed historical record'},
    {produccion_registros:{}},
    {produccion_confirmada_at:'2026-10-01T12:00:00Z'},
  ]) {
    const f=fixture({linked:false});
    const task={...sourceTask,propiedades_extra:{workspace:'render_os',...metadata}};
    const before=structuredClone(task);
    assert.equal(await syncProductionVisitFromTask(f.db,task,11),null);
    assert.deepEqual(task,before);
    assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE) /.test(call.sql)),false);
  }
  const f=fixture({linked:false,legacy:true});
  assert.equal(await syncProductionVisitFromTask(f.db,sourceTask,11),null);
  assert.equal(f.calls.some(call=>call.sql.includes("propiedades_extra->>'origen_visita_id'")),true);
  assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE) /.test(call.sql)),false);
  const explicit=fixture({linked:false,legacy:true});
  const response=await explicit.run('post','/',{...visitBody,tarea_origen_id:10});
  assert.equal(response.statusCode,409);
  assert.match(response.body.error,/histórica/);
  assert.equal(explicit.calls.some(call=>/^(INSERT|UPDATE|DELETE) /.test(call.sql)),false);
});

test('historical guard preserves an existing registry and does not classify empty record collections as history',async()=>{
  const linked=fixture({linked:true,legacy:true});
  assert.equal(await syncProductionVisitFromTask(linked.db,{...sourceTask,propiedades_extra:{workspace:'render_os',produccion_registros:[{cantidad:2}]}},11),null);
  assert.equal(linked.calls.some(call=>/^(INSERT|UPDATE|DELETE) /.test(call.sql)),false);
  for(const records of [[],null]) {
    const fresh=fixture({linked:false});
    assert.ok(await syncProductionVisitFromTask(fresh.db,{...sourceTask,propiedades_extra:{workspace:'render_os',produccion_registros:records}},11));
    assert.equal(fresh.calls.filter(call=>call.sql.startsWith('INSERT INTO produccion_visitas')).length,1);
    assert.equal(fresh.calls.some(call=>call.sql.startsWith('INSERT INTO produccion_videos')),false);
  }
});

test('archived unlinked tasks are not auto-registered or explicitly attached as available origins',async()=>{
  for(const flag of ['archivada_render_os','papelera_render_os']) {
    const f=fixture({linked:false});
    assert.equal(await syncProductionVisitFromTask(f.db,{...sourceTask,propiedades_extra:{workspace:'render_os',[flag]:true}},11),null);
    assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT INTO produccion_visitas')),false);
  }
  const f=fixture({archived:true,linked:false});
  assert.equal((await f.run('post','/',{...visitBody,tarea_origen_id:10})).statusCode,404);
});

test('client change takes ordered own-video locks before checking newly committed lineage',async()=>{
  const f=fixture({lineage:true});
  const res=await f.run('patch','/:id',{expected_revision:1,cliente_id:2});
  assert.equal(res.statusCode,409);
  const lock=f.calls.findIndex(call=>call.sql==='SELECT id FROM produccion_videos WHERE visita_id=$1 ORDER BY id FOR UPDATE');
  const lineageCheck=f.calls.findIndex(call=>call.sql.startsWith('SELECT pv.id FROM produccion_videos'));
  assert.ok(lock>0&&lineageCheck>lock);
  assert.deepEqual(f.calls[lock].params,[visitId]);
  assert.equal(f.calls.some(call=>call.sql.startsWith('UPDATE tareas')||call.sql.startsWith('UPDATE produccion_visitas')),false);
  assert.equal(f.visit.cliente_id,1);assert.equal(f.visit.revision,1);
});

test('resume rechecks source client in a new statement after locking video, rejecting stale joined client',async()=>{
  for(const sourceClientAfterLock of [2,null]) {
    const f=fixture({sourceClientAfterLock});
    const res=await f.run('post','/:id/videos',{expected_revision:1,video_origen_id:'44444444-4444-4444-8444-444444444444'});
    assert.equal(res.statusCode,409);
    const lock=f.calls.findIndex(call=>call.sql.includes('FOR UPDATE OF pv'));
    const fresh=f.calls.findIndex(call=>call.sql==='SELECT cliente_id FROM produccion_visitas WHERE id=$1');
    assert.ok(lock>0&&fresh>lock);
    assert.deepEqual(f.calls[fresh].params,['33333333-3333-4333-8333-333333333333']);
    assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT INTO produccion_videos')||call.sql.startsWith('UPDATE produccion_visitas')),false);
    assert.equal(f.visit.revision,1);assert.equal(f.calls.at(-2).sql,'ROLLBACK');
  }
});
