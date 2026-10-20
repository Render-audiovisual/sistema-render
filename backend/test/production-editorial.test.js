import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { associateProductionEditorial, validateProductionEditorialSelection, productionEditorialCandidates } from '../src/production-editorial.js';
import { createProductionRegistryRouter } from '../src/production-registry.js';

const visitId='11111111-1111-4111-8111-111111111111',videoId='22222222-2222-4222-8222-222222222222';
const updated='2026-10-20T10:00:00.000Z';
const body={expected_revision:2,publicacion_id:30,expected_publicacion_updated_at:updated,tarea_id:20,expected_tarea_revision:4,objetivo_pieza_id:40,expected_objetivo_updated_at:updated};
const emptyBody={expected_revision:2,tarea_id:20,expected_tarea_revision:4,objetivo_pieza_id:40,expected_objetivo_updated_at:updated,fecha_programada:'2026-10-30'};
function fixture(options={}) {
  let visit={id:visitId,tarea_origen_id:10,cliente_id:1,cliente_nombre:'Cliente',fecha:'2026-10-20',revision:2,drive_url:'https://drive.test/material'};
  let task={id:20,cliente_id:1,publicacion_id:options.empty?null:30,historia_id:null,estado:'pendiente',revision:4,titulo:'Entrega canónica',fecha_vencimiento:'2026-12-01',tipo_tarea:'administracion',propiedades_extra:{workspace:'render_os',copy_trabajo:'COPY',origen_pieza:true,private_finance:'SECRET'}};
  let source={id:10,cliente_id:1,tipo_tarea:'produccion',titulo:'Visita',propiedades_extra:{workspace:'render_os',...(options.legacy?{produccion_registros:[{cantidad:3}]}:{})}};
  let slot=options.noSlot?null:{id:40,tarea_id:20,publicacion_id:options.empty?null:30,estado:'pendiente',tipo:'video',periodo:'2026-10',clave:'cliente-1',cuentas:[{id:1}],updated_at:updated,copy:'COPY FROM SLOT',numero:1};
  let publication=options.empty?null:{id:30,cliente_id:1,tipo:'video',estado:'pendiente',fecha_programada:'2026-10-30',updated_at:updated};
  let video={id:videoId,visita_id:visitId,video_origen_id:null,titulo:'Video filmado',guion:'NOT EDITORIAL COPY',estado:'grabado',material_url:'',observaciones:'',publicacion_id:options.linked?30:null,tarea_entrega_id:options.linked?20:null,cliente_editorial_id:options.linked?1:null,tarea_edicion_id:options.handed?20:null,editor_id:options.handed?7:null,fecha_entrega:options.handed?'2026-10-25':null};
  Object.assign(task,options.task);Object.assign(video,options.video);if(slot)Object.assign(slot,options.slot);if(publication)Object.assign(publication,options.publication);
  const calls=[];let snapshot,insertTasks=0,insertPublications=0;
  const db={release(){},async query(sql,params=[]) {
    calls.push({sql,params});
    if(sql==='BEGIN'){snapshot=structuredClone({visit,task,slot,publication,video,insertTasks,insertPublications});return{rows:[]};}
    if(sql==='ROLLBACK'){({visit,task,slot,publication,video,insertTasks,insertPublications}=snapshot);return{rows:[]};}
    if(sql==='COMMIT'||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
    if(sql.startsWith('WITH RECURSIVE familia'))return{rows:options.family?[{id:'ancestor'}]:[]};
    if(sql.startsWith('SELECT pv.*,v.tarea_origen_id')||sql.startsWith('SELECT pv.*,v.cliente_id'))return{rows:options.wrongScope?[]:[{...video,tarea_origen_id:10,cliente_id:1}]};
    if(sql.startsWith('SELECT t.* FROM tareas t WHERE'))return{rows:[source,task]};
    if(sql.startsWith('SELECT p.*,to_char'))return{rows:publication?[publication]:[]};
    if(sql.startsWith('SELECT s.*,o.clave'))return{rows:slot?[{...slot}]:[]};
    if(sql.startsWith('SELECT * FROM produccion_videos'))return{rows:[{...video,...(options.changedLink?{tarea_entrega_id:99}: {})}]};
    if(sql.startsWith('SELECT id FROM produccion_videos WHERE id<>'))return{rows:options.conflict?[{id:'other'}]:[]};
    if(sql.startsWith('SELECT id FROM tareas WHERE publicacion_id'))return{rows:options.ambiguous?[{id:20},{id:21}]:[{id:20}]};
    if(sql.includes("propiedades_extra->>'origen_visita_id'"))return{rows:options.legacyAggregate?[{id:50}]:[]};
    if(sql.startsWith('INSERT INTO publicaciones')){insertPublications++;publication={id:30,cliente_id:1,tipo:'video',estado:'pendiente',fecha_programada:params[1],copy:params[3]};return{rows:[publication]};}
    if(sql.startsWith('UPDATE tareas SET publicacion_id')){task.publicacion_id=params[1];task.revision++;return{rows:[]};}
    if(sql.startsWith('UPDATE cliente_objetivo_piezas SET publicacion_id')){slot.publicacion_id=params[1];return{rows:[]};}
    if(sql.startsWith('UPDATE produccion_videos SET publicacion_id')){if(options.bindingFailure)throw Object.assign(Error('tuple conflict'),{code:'23503',constraint:'produccion_editorial_tarea_publicacion_cliente_fk'},options.bindingError);video={...video,publicacion_id:params[2],tarea_entrega_id:params[3],cliente_editorial_id:params[4]};return{rows:[]};}
    if(sql.startsWith('SELECT propiedades_extra FROM tareas'))return{rows:[source]};
    if(sql==='SELECT id FROM cliente_objetivo_piezas WHERE publicacion_id=$1')return{rows:slot?[{id:slot.id}]:[]};
    if(sql.startsWith('SELECT p.id publicacion_id'))return{rows:[{publicacion_id:30,titulo:'Pieza',fecha_programada:'2026-10-30',publicacion_updated_at:updated,tarea_id:20,tarea_revision:4}]};
    if(sql.startsWith('SELECT s.id objetivo_pieza_id'))return{rows:[]};
    // Registry router/handoff queries. No real network, server or DB.
    if(sql.includes('FROM produccion_videos pv LEFT JOIN tareas'))return{rows:[video]};
    if(sql.startsWith('SELECT tarea_origen_id FROM produccion_visitas'))return{rows:[{tarea_origen_id:10}]};
    if(sql.startsWith('SELECT * FROM tareas WHERE'))return{rows:[source]};
    if(sql.includes('FROM produccion_visitas v JOIN clientes'))return{rows:[visit]};
    if(sql.includes('FROM produccion_fotos'))return{rows:[]};
    if(sql.startsWith('SELECT id,nombre FROM usuarios'))return{rows:params[0].filter(id=>!(options.inactiveMembers||[]).includes(id)).map(id=>({id,nombre:'Miembro actual #'+id}))};
    if(sql.includes('FROM usuarios WHERE'))return{rows:[{id:7,nombre:'Editor renombrado',rol:'edicion'}]};
    if(sql.includes('FROM clientes WHERE'))return{rows:[{id:1,nombre:'Cliente'}]};
    if(sql.startsWith('UPDATE tareas SET asignado_a=')){task={...task,asignado_a:params[1],fecha_vencimiento:params[2],material_referencia:params[3],tipo_tarea:'edicion',subtipo:'video',revision:task.revision+1,propiedades_extra:{...task.propiedades_extra,...JSON.parse(params[4])}};return{rows:[task]};}
    if(sql.startsWith('SELECT tarea_id, usuario_id'))return{rows:options.bindings||[{tarea_id:20,usuario_id:7,tipo:'responsable'}]};
    if(sql.startsWith('DELETE FROM tarea_asignaciones')||sql.startsWith('INSERT INTO tarea_asignaciones')){if(options.assignmentFailure&&sql.startsWith('INSERT'))throw Error('assignments failed');return{rows:[]};}
    if(sql.startsWith('UPDATE produccion_videos SET tarea_edicion_id')){video={...video,tarea_edicion_id:params[2],editor_id:params[3],fecha_entrega:params[4]};return{rows:[]};}
    if(sql.startsWith('UPDATE produccion_visitas SET revision')){visit.revision++;return{rows:[]};}
    if(sql.startsWith('SELECT t.*,to_char(t.fecha_vencimiento'))return{rows:[task]};
    if(sql.startsWith('SELECT pv.id,pv.visita_id,pv.titulo'))return{rows:[{id:params[0],visita_id:'33333333-3333-4333-8333-333333333333',titulo:'Anterior',guion:'Guion',estado:'pendiente'}]};
    if(sql==='SELECT cliente_id FROM produccion_visitas WHERE id=$1')return{rows:[{cliente_id:1}]};
    if(sql.startsWith('SELECT id FROM produccion_videos WHERE video_origen_id'))return{rows:[]};
    if(sql.startsWith('INSERT INTO produccion_videos('))return{rows:[]};
    if(sql.startsWith('INSERT INTO tareas')){insertTasks++;throw Error('Unexpected second delivery task');}
    if(sql.includes('FROM produccion_reconciliacion_videos rv'))return{rows:[]};
    throw Error('Unhandled mock SQL: '+sql);
  }};
  const deps={lockVisit:async()=>{calls.push({sql:'LOCK VISIT'});return visit;},readVisits:async()=>[{...visit,videos:[video]}],activeClient:async()=>{},bump:async()=>{visit.revision++;}};
  return {db,deps,calls,get task(){return task;},get video(){return video;},get visit(){return visit;},get slot(){return slot;},get publication(){return publication;},get insertTasks(){return insertTasks;},get insertPublications(){return insertPublications;},
    async associate(input=body,empty=false){await db.query('BEGIN');try{const result=await associateProductionEditorial(db,visitId,videoId,input,11,deps,empty);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}},
    async route(method,path,input=body,auth={id:11,rol:'admin'},query={periodo:'2026-10'}) {
      const pool={query:db.query.bind(db),connect:async()=>db};const router=createProductionRegistryRouter({express,pool});
      const req={auth,body:input,query,params:{id:visitId,videoId}};
      const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
      let allowed=false;router.stack[0].handle(req,res,()=>{allowed=true;});if(!allowed)return res;
      const handler=router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route.stack[0].handle;
      await handler(req,res,error=>{throw error;});return res;
    }};
}

test('closed selection validates stable numeric IDs, all versions and explicit slot/date',()=>{
  assert.equal(validateProductionEditorialSelection(body),body);
  assert.equal(validateProductionEditorialSelection(emptyBody,true),emptyBody);
  for(const patch of [{tarea_id:'20'},{expected_tarea_revision:0},{importe:1},{expected_revision:null},{expected_publicacion_updated_at:'invalid'},{objetivo_pieza_id:null}])assert.throws(()=>validateProductionEditorialSelection({...body,...patch}),e=>e.status===400);
  assert.throws(()=>validateProductionEditorialSelection({...emptyBody,fecha_programada:'2026-02-30'},true));
});
test('existing piece binds one canonical task, preserves goal/copy/state and ignores editing deadline month',async()=>{
  const f=fixture();const result=await f.associate();assert.equal(result.publicacion_id,30);assert.equal(result.tarea_id,20);
  assert.equal(f.video.tarea_entrega_id,20);assert.equal(f.video.tarea_edicion_id,null);assert.equal(f.visit.revision,3);
  assert.equal(f.insertTasks,0);assert.equal(f.insertPublications,0);assert.equal(f.task.estado,'pendiente');assert.equal(f.slot.publicacion_id,30);
  assert.equal(f.task.fecha_vencimiento,'2026-12-01');assert.equal(f.task.propiedades_extra.copy_trabajo,'COPY');
});
test('empty slot creates exactly one draft publication from video title and SLOT copy, zero tasks',async()=>{
  const f=fixture({empty:true});const result=await f.associate(emptyBody,true);
  assert.equal(result.created,true);assert.equal(f.insertPublications,1);assert.equal(f.insertTasks,0);
  assert.equal(f.publication.copy,'COPY FROM SLOT');assert.equal(f.publication.estado,'pendiente');
  assert.equal(f.task.publicacion_id,30);assert.equal(f.slot.publicacion_id,30);assert.equal(f.video.publicacion_id,30);
  assert.equal(f.video.tarea_edicion_id,null);assert.equal(f.task.estado,'pendiente');
  assert.deepEqual(f.calls.find(c=>c.sql.startsWith('INSERT INTO publicaciones')).params,[1,'2026-10-30','Video filmado','COPY FROM SLOT']);
});
test('exact existing and empty-slot retries ignore stale revisions without mutation after progress',async()=>{
  const f=fixture({linked:true,task:{estado:'finalizada'},publication:{estado:'publicada'}});
  assert.equal((await f.associate({...body,expected_revision:1,expected_tarea_revision:1})).created,false);
  assert.equal(f.visit.revision,2);assert.ok(!f.calls.some(c=>c.sql.startsWith('UPDATE')));
  const g=fixture({linked:true});assert.equal((await g.associate({...emptyBody,expected_revision:1},true)).created,false);
  await assert.rejects(g.associate({...emptyBody,fecha_programada:'2026-10-29'},true),e=>e.status===409);
});
test('conflicts fail closed for identity/client/state/format/period, duplicate tasks and ancestor chain',async()=>{
  for(const options of [{task:{cliente_id:2}},{task:{estado:'en_progreso'}},{task:{propiedades_extra:{workspace:'render_os',papelera_render_os:true}}},
    {publication:{tipo:'carrusel'}},{publication:{estado:'publicada'}},{publication:{fecha_programada:'2026-11-01'}},{slot:{cuentas:[{id:2}]}},
    {ambiguous:true},{family:true},{conflict:true},{legacy:true},{legacyAggregate:true},{changedLink:true},{video:{tarea_edicion_id:99}}]) {
    const f=fixture(options);await assert.rejects(f.associate(),e=>e.status===409);assert.equal(f.video.publicacion_id,null);assert.equal(f.insertTasks,0);
  }
});
test('stale and omitted existing slot versions reject before mutations',async()=>{
  for(const patch of [{expected_revision:1},{expected_tarea_revision:3},{expected_publicacion_updated_at:'2026-10-19T10:00:00Z'},{expected_objetivo_updated_at:'2026-10-19T10:00:00Z'}])await assert.rejects(fixture().associate({...body,...patch}),e=>e.status===409);
  const {objetivo_pieza_id,expected_objetivo_updated_at,...withoutSlot}=body;await assert.rejects(fixture().associate(withoutSlot),e=>e.status===409);
});
test('unscoped video is 404 and unbound/inactive/nonadmin association endpoints are denied',async()=>{
  await assert.rejects(fixture({wrongScope:true}).associate(),e=>e.status===404);
  for(const auth of [{rol:'admin'},{id:11,rol:'admin',activo:false},...['community','produccion','edicion','diseno','unknown'].map(rol=>({id:11,rol}))]) {
    const f=fixture();assert.equal((await f.route('post','/:id/videos/:videoId/vincular-pieza',body,auth)).statusCode,403);assert.equal(f.calls.length,0);
  }
});
test('binding failure rolls back draft, task/slot references and visit revision',async()=>{
  const f=fixture({empty:true,bindingFailure:true});await assert.rejects(f.associate(emptyBody,true),e=>e.code==='23503');
  assert.equal(f.insertPublications,0);assert.equal(f.task.publicacion_id,null);assert.equal(f.slot.publicacion_id,null);assert.equal(f.visit.revision,2);
});
test('association locks global, objective, sorted tasks, publication, slot, visit, video and rechecks full lineage',async()=>{
  const f=fixture();await f.associate();const sql=f.calls.map(c=>c.sql);
  const order=[sql.findIndex(s=>s.includes("hashtext('vinculo-objetivo-mensual')")),sql.findIndex(s=>s==='SELECT pg_advisory_xact_lock(hashtext($1))'),sql.findIndex(s=>s.includes('ORDER BY t.id FOR UPDATE')),sql.findIndex(s=>s.includes('FOR UPDATE OF p')),sql.findIndex(s=>s.includes('FOR UPDATE OF s')),sql.indexOf('LOCK VISIT'),sql.findIndex(s=>s.startsWith('SELECT * FROM produccion_videos'))];
  assert.deepEqual([...order].sort((a,b)=>a-b),order);assert.ok(order.every(i=>i>=0));
  assert.deepEqual(f.calls.find(c=>c.sql.includes('ORDER BY t.id FOR UPDATE')).params,[[10,20]]);
  assert.match(sql.find(s=>s.startsWith('WITH RECURSIVE')),/v.id=f.video_origen_id OR v.video_origen_id=f.id/);
});
test('candidate reads expose current linkage after progress and conservative SQL by client/month/unique canonical task',async()=>{
  const f=fixture();const result=await productionEditorialCandidates(f.db,visitId,videoId,'2026-10');assert.equal(result.publicaciones[0].publicacion_id,30);
  const sql=f.calls.find(c=>c.sql.startsWith('SELECT p.id publicacion_id')).sql;assert.match(sql,/count\(\*\)/);assert.match(sql,/to_char\(p.fecha_programada/);
  assert.doesNotMatch(sql,/to_char\(t.fecha_vencimiento/);
  const g=fixture({linked:true,task:{estado:'finalizada'}});const current=await productionEditorialCandidates(g.db,visitId,videoId,'2026-10');
  assert.deepEqual(current,{actual:{publicacion_id:30,tarea_entrega_id:20,objetivo_pieza_id:40},publicaciones:[],casilleros:[]});
});
test('linked handoff updates existing pending task, preserves copy/origin and never inserts task or publishes',async()=>{
  const f=fixture({linked:true});const result=await f.route('post','/:id/videos/:videoId/enviar-edicion',{expected_revision:2,editor_id:7,fecha_entrega:'2026-10-25'});
  assert.equal(result.statusCode,201);assert.equal(result.body.task.id,20);assert.equal(f.insertTasks,0);assert.equal(f.task.fecha_vencimiento,'2026-10-25');
  assert.equal(f.task.propiedades_extra.copy_trabajo,'COPY');assert.equal(f.task.propiedades_extra.origen_pieza,true);assert.equal(f.task.tipo_tarea,'edicion');
  assert.equal(f.video.tarea_edicion_id,20);assert.equal(f.slot.estado,'pendiente');assert.equal(f.publication.estado,'pendiente');
  // Admin's authorized task DTO bypass remains intact; team registry gets IDs only.
  assert.equal(result.body.task.propiedades_extra.private_finance,'SECRET');
  const calls=f.calls.map(c=>c.sql);assert.ok(calls.findIndex(s=>s.includes('ORDER BY t.id FOR UPDATE'))<calls.findIndex(s=>s.includes('FOR UPDATE OF v')));
});
test('begun linked handoff rejects; assignment failure rolls back adoption and domain errors map to 409',async()=>{
  const f=fixture({linked:true,task:{estado:'en_revision'}});assert.equal((await f.route('post','/:id/videos/:videoId/enviar-edicion',{expected_revision:2,editor_id:7,fecha_entrega:'2026-10-25'})).statusCode,409);
  const g=fixture({linked:true,assignmentFailure:true});await assert.rejects(g.route('post','/:id/videos/:videoId/enviar-edicion',{expected_revision:2,editor_id:7,fecha_entrega:'2026-10-25'}));
  assert.equal(g.task.tipo_tarea,'administracion');assert.equal(g.video.tarea_edicion_id,null);assert.equal(g.visit.revision,2);
  const h=fixture({empty:true,bindingFailure:true});assert.equal((await h.route('post','/:id/videos/:videoId/vincular-objetivo',emptyBody)).statusCode,409);
});
test('adoption preserves active bound former owner/collaborators only, never removed IDs or old labels',async()=>{
  const f=fixture({linked:true,bindings:[{tarea_id:20,usuario_id:8,tipo:'responsable'},
    {tarea_id:20,usuario_id:9,tipo:'colaborador'},{tarea_id:20,usuario_id:12,tipo:'colaborador'},
    {tarea_id:20,usuario_id:7,tipo:'colaborador'}],inactiveMembers:[12],
    task:{propiedades_extra:{workspace:'render_os',copy_trabajo:'COPY',colaboradores:['Renamed old label','Removed #99','Inactive #12']}}});
  const res=await f.route('post','/:id/videos/:videoId/enviar-edicion',{expected_revision:2,editor_id:7,fecha_entrega:'2026-10-25'});
  assert.equal(res.statusCode,201);
  assert.deepEqual(f.calls.find(c=>c.sql.startsWith('INSERT INTO tarea_asignaciones')).params,[20,[7,8,9],['responsable','colaborador','colaborador']]);
  assert.deepEqual(f.task.propiedades_extra.colaboradores,['Miembro actual #8','Miembro actual #9']);
  assert.deepEqual(f.calls.find(c=>c.sql.startsWith('SELECT id,nombre FROM usuarios')).params,[[8,9,12]]);
  assert.equal(f.task.propiedades_extra.copy_trabajo,'COPY');
});
test('registry reads share safe linkage IDs without exposing internal task metadata',async()=>{
  const f=fixture({linked:true});const res=await f.route('get','/:id',{}, {id:7,rol:'edicion'});
  assert.equal(res.body.visita.videos[0].publicacion_id,30);assert.equal(res.body.visita.videos[0].tarea_entrega_id,20);
  assert.equal(res.body.visita.videos[0].cliente_editorial_id,1);assert.doesNotMatch(JSON.stringify(res.body),/SECRET|copy_trabajo|private_finance/);
});
test('lineage continuation takes same global advisory immediately after BEGIN, before task/visit/video locks',async()=>{
  const f=fixture();const res=await f.route('post','/:id/videos',{expected_revision:2,video_origen_id:'44444444-4444-4444-8444-444444444444'});
  assert.equal(res.statusCode,201);const sql=f.calls.map(c=>c.sql);
  assert.equal(sql[0],'BEGIN');assert.match(sql[1],/hashtext\('vinculo-objetivo-mensual'\)/);
  assert.ok(sql.findIndex(s=>s.includes('pg_advisory_xact_lock'))<sql.findIndex(s=>s.includes('FOR UPDATE')));
  const family=f.calls.find(c=>c.sql.startsWith('WITH RECURSIVE familia'));
  assert.deepEqual(family.params,['44444444-4444-4444-8444-444444444444',true]);
});
test('continuation rejects editorial links on source itself or anywhere in its family before child insertion',async()=>{
  const f=fixture({family:true});const res=await f.route('post','/:id/videos',{expected_revision:2,video_origen_id:'44444444-4444-4444-8444-444444444444'});
  assert.equal(res.statusCode,409);assert.match(res.body.error,/transferencia explícita auditada/);
  const family=f.calls.find(c=>c.sql.startsWith('WITH RECURSIVE familia'));
  assert.equal(family.params[1],true);assert.match(family.sql,/\$2::boolean OR v.id<>\$1/);
  assert.ok(!f.calls.some(c=>c.sql.startsWith('INSERT INTO produccion_videos')));
  assert.equal(f.visit.revision,2);assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'));
});
test('unknown SQL faults reach global error handler after rollback, not a misleading CAS 409',async()=>{
  for(const code of ['P0001','23514','23503','40P01','40001']) {
    const f=fixture({empty:true,bindingFailure:true,bindingError:{code,constraint:'qa_registry_binding_failure'}});
    await assert.rejects(f.route('post','/:id/videos/:videoId/vincular-objetivo',emptyBody),error=>error.code===code);
    assert.ok(f.calls.some(call=>call.sql==='ROLLBACK'));assert.ok(!f.calls.some(call=>call.sql==='COMMIT'));
    assert.equal(f.task.publicacion_id,null);assert.equal(f.slot.publicacion_id,null);assert.equal(f.video.publicacion_id,null);
    assert.equal(f.insertPublications,0);assert.equal(f.visit.revision,2);
  }
});
