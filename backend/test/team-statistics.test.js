import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTeamStatistics,readTeamStatistics,recoverHistoricalEditingCandidates,recoverReviewActivityCandidates} from '../src/team-statistics.js';
const users=[{id:8,nombre:'Augusto',rol:'diseno'},{id:9,nombre:'Luciano',rol:'edicion'},{id:10,nombre:'Germán',rol:'produccion'}];
test('review activity uses authenticated actor ID or corroborated legacy evidence, never a name alone',()=>{
 const row={task_id:21,key:'task:21',comment_id:101,content:'[Actividad] movió la tarea de En proceso a Para revisar',
  comment_at:'2026-11-03T17:43:27.672Z',actor_id:9};
 const signed=recoverReviewActivityCandidates([row]);assert.equal(signed.length,1);
 assert.equal(projectTeamStatistics(users,signed,'2026-10')[1].count,0);
 assert.equal(projectTeamStatistics(users,[...signed,...signed],'2026-11')[1].count,1);
 for(const patch of [{actor_id:8},{actor_id:'9'},{actor_id:null,author:'Luciano'},
  {content:'Propuesta de entrega: 2026-11-03'},{comment_at:'2026-11-03'},{comment_id:0}]){
  assert.deepEqual(recoverReviewActivityCandidates([{...row,...patch}]),[]);
 }
 const legacy={...row,actor_id:null,author:'Luciano',legacy_witness:true,audit_id:'100',
  event_id:'21:2026-10-05T14:01:34.731Z:tarea_en_revision',comment_at:'2026-10-05T14:01:49.584Z',audit_at:'2026-10-05T14:03:14.811Z'};
 assert.equal(recoverReviewActivityCandidates([legacy]).length,1);
 for(const patch of [{legacy_witness:false},{audit_id:null},{author:'Other'},{actor_id:8},
  {event_id:'22:2026-10-05T14:01:34.731Z:tarea_en_revision'},
  {comment_at:'2026-10-05T15:01:49.584Z'},{audit_at:'2026-10-04T14:03:14.811Z'}]){
  assert.deepEqual(recoverReviewActivityCandidates([{...legacy,...patch}]),[]);
 }
 const recovered=recoverReviewActivityCandidates([legacy]);
 const known={person_id:9,key:'task:21',task_id:21,date:'2026-10-05T14:01:34.731Z',priority:2};
 assert.equal(projectTeamStatistics(users,[...recovered,known,{...known,date:null}],'2026-10')[1].count,1);
 assert.equal(projectTeamStatistics(users,[...recovered,known,{...known,date:null}],'2026-10')[1].unverified,0);
});
test('historical delivery requires corroboration, exact task ID and Córdoba day; never modification dates alone',()=>{
 const row={task_id:21,audit_id:100,key:'task:21',event_id:'21:2026-10-21T02:47:12.749Z:tarea_en_revision',
  legacy_at:'2026-10-21T02:47:12.824Z',audit_at:'2026-10-21T02:47:31.135Z'};
 const recovered=recoverHistoricalEditingCandidates([row]);assert.equal(recovered.length,1);
 assert.equal(recoverHistoricalEditingCandidates([{...row,audit_id:'100'}]).length,1);
 assert.equal(projectTeamStatistics(users,recovered,'2026-10')[1].records[0].date,'2026-10-20');
 for(const patch of [{event_id:null},{event_id:'22:2026-10-21T02:47:12.749Z:tarea_en_revision'},
  {legacy_at:'2026-09-24T03:00:00Z'},{legacy_at:'2026-10-21T01:47:12.749Z'},
  {audit_at:'2026-10-20T02:00:00Z'},{audit_id:null},
  {event_id:'21:2026-10-21T02:47:12.749Z:tarea_finalizada'}]){
  assert.deepEqual(recoverHistoricalEditingCandidates([{...row,...patch}]),[]);
 }
 const person=projectTeamStatistics(users,[...recovered,...recovered,{person_id:9,key:'task:21',date:null}], '2026-10')[1];
 assert.equal(person.count,1);assert.equal(person.unverified,0);assert.equal(person.records[0].evidence_id,100);
 const canonical={person_id:9,key:'task:21',task_id:21,date:'2026-11-03T12:00:00Z',priority:0};
 assert.equal(projectTeamStatistics(users,[...recovered,canonical],'2026-10')[1].count,0);
 assert.equal(projectTeamStatistics(users,[...recovered,canonical],'2026-11')[1].count,1);
});
test('same piece, repeated deliveries and closure fallback count once; no deadline inference',()=>{
 const base={person_id:9,key:'piece:1',title:'Video',client:'QA',task_id:2};
 const rows=projectTeamStatistics(users,[{...base,date:'2026-11-03T12:00:00Z',priority:0},{...base,task_id:3,date:'2026-11-04T12:00:00Z',priority:0},
  {...base,date:'2026-10-31T12:00:00Z',priority:1},{...base,key:'task:4',date:null},{...base,key:'task:4',date:null}], '2026-11');
 const person=rows.find(r=>r.id===9);assert.equal(person.count,1);assert.equal(person.unverified,1);assert.equal(person.records[0].date,'2026-11-03');
 assert.equal(projectTeamStatistics(users,[{...base,date:'2026-10-31T12:00:00Z',priority:0},{...base,date:'2026-11-03T12:00:00Z',priority:0}],'2026-11')[1].count,0);
});
test('Córdoba month boundaries, invalid dates and missing stable identities do not invent counts',()=>{
 const input=[{person_id:8,key:'piece:1',date:'2026-11-01T01:00:00Z',task_id:1},{person_id:8,key:'piece:2',date:'2026-02-30',task_id:2}];
 assert.equal(projectTeamStatistics(users,input,'2026-11')[2].count,0);
 assert.equal(projectTeamStatistics(users,input,'2026-10')[2].count,1);
 assert.equal(projectTeamStatistics([],input,'2026-10')[2].count,null);
});
test('invalid month and revoked actor reject before report queries',async()=>{
 const calls=[],pool={connect:async()=>({query:async(sql)=>{calls.push(sql);return{rows:[]};},release(){}})};
 await assert.rejects(readTeamStatistics(pool,{id:1,rol:'admin',session_version:1},'2026-13'),{status:400});assert.equal(calls.length,0);
 await assert.rejects(readTeamStatistics(pool,{id:1,rol:'admin',session_version:1},'2026-11'),{status:401});assert.ok(calls.includes('ROLLBACK'));assert.equal(calls.length,3);
});
test('local HTTP team statistics deduplicate linked tasks and preserve source records',{
 skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:150000,
},async t=>{
 const {startLocalHarness,request,fixturePassword}=await import('../scripts/render2-local-test.js');
 const f=await startLocalHarness({port:55843});t.after(()=>f.cleanup());
 for(const u of users)await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
   SELECT $1,$2,$2,$3,password_hash,true,1 FROM usuarios WHERE id=91004
   ON CONFLICT(id) DO UPDATE SET rol=EXCLUDED.rol`,[u.id,`qa_team_${u.id}`,u.rol]);
 const [client]=await f.query("INSERT INTO clientes(nombre,activo) VALUES('Team QA',true) RETURNING id");
 const [piece]=await f.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES($1,'carrusel','pendiente','2026-11-05') RETURNING id",[client.id]);
 for(let i=0;i<2;i++){
  const [task]=await f.query(`INSERT INTO tareas(titulo,cliente_id,publicacion_id,asignado_a,tipo_tarea,subtipo,estado,propiedades_extra)
   VALUES('QA carousel',$1,$2,'QA','diseno','carrusel','finalizada','{"finalizada_at":"2026-11-03T12:00:00.000Z"}'::jsonb) RETURNING id`,[client.id,piece.id]);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,8,'responsable')",[task.id]);
 }
 const [edit]=await f.query("INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado) VALUES('QA video',$1,'QA','edicion','en_revision') RETURNING id",[client.id]);
 for(let i=0;i<2;i++)await f.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes,recorded_at)
  VALUES($1,$2,9,$3,$4,1,'https://example.com/qa','',$5)`,[randomUUID(),edit.id,randomUUID(),'a'.repeat(64),`2026-11-0${i+3}T12:00:00Z`]);
 const [historicalPiece]=await f.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES($1,'reel','pendiente','2026-11-05') RETURNING id",[client.id]);
 for(let i=0;i<2;i++){
  const [historical]=await f.query(`INSERT INTO tareas(titulo,cliente_id,publicacion_id,asignado_a,tipo_tarea,estado)
   VALUES('QA historical video',$1,$2,'QA','edicion','en_revision') RETURNING id`,[client.id,historicalPiece.id]);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,9,'responsable')",[historical.id]);
  await f.query(`INSERT INTO progreso_edicion_entregas(tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at)
   VALUES($1,'luciano','QA historical video',$2,'en_revision','2026-11-03T12:00:00Z')`,[historical.id,client.id]);
  for(let j=0;j<2;j++)await f.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,tarea_id,resultado,detalles,created_at)
   VALUES('mia','qa','qa','QA','entregar_evento_mia',$1,'ok',$2::jsonb,'2026-11-03T12:01:00Z')`,[historical.id,JSON.stringify({eventId:`${historical.id}:2026-11-03T12:00:00.000Z:tarea_en_revision`})]);
 }
 const activity='[Actividad] movió la tarea de En proceso a Para revisar';
 const [signedTask]=await f.query("INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado) VALUES('QA signed review',$1,'QA','edicion','en_revision') RETURNING id",[client.id]);
 const [legacyTask]=await f.query("INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado) VALUES('QA old review',$1,'QA','edicion','en_revision') RETURNING id",[client.id]);
 const [unproven]=await f.query("INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado) VALUES('QA unproven name',$1,'QA','edicion','en_revision') RETURNING id",[client.id]);
 for(const task of [signedTask,legacyTask,unproven])await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,9,'responsable')",[task.id]);
 for(let i=0;i<2;i++)await f.query(`INSERT INTO tarea_comentarios(tarea_id,autor,actor_usuario_id,contenido,created_at)
  VALUES($1,'QA renamed',9,$2,'2026-11-03T17:43:27Z')`,[signedTask.id,activity]);
 for(const task of [legacyTask,unproven]){
  await f.query(`INSERT INTO tarea_comentarios(tarea_id,autor,contenido,created_at) VALUES($1,'Luciano',$2,'2026-10-05T14:01:49Z')`,[task.id,activity]);
  await f.query(`INSERT INTO progreso_edicion_entregas(tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at)
   VALUES($1,'luciano','QA old review',$2,'en_revision','2026-09-25T03:00:00Z')`,[task.id,client.id]);
 }
 await f.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,tarea_id,resultado,detalles,created_at)
  VALUES('mia','qa','qa','QA','entregar_evento_mia',$1,'ok',$2::jsonb,'2026-10-05T14:03:14Z')`,[legacyTask.id,JSON.stringify({eventId:`${legacyTask.id}:2026-10-05T14:01:34.731Z:tarea_en_revision`})]);
 const [filming]=await f.query("INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado) VALUES('QA visit',$1,'QA','produccion','en_progreso') RETURNING id",[client.id]);
 await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,10,'responsable')",[filming.id]);
 const visit=randomUUID();await f.query("INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id) VALUES($1,$2,$3,'2026-11-04','QA visit',91001,91001)",[visit,filming.id,client.id]);
 await f.query("INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id) VALUES($1,$2,'QA filmed','grabado',91001,91001)",[randomUUID(),visit]);
 const batch=(id,changes={})=>({id,fecha:'2026-11-04',cantidad:4,usuario_id:10,usuario:'QA',created_at:'2026-11-04T12:00:00.000Z',...changes});
 const [legacyFilming]=await f.query(`INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado,propiedades_extra)
  VALUES('QA visit 04/11',$1,'QA','produccion','en_revision',$2::jsonb) RETURNING id`,[client.id,JSON.stringify({produccion_registros:[
   batch('legacy-main',{corregido_desde:8}),batch('legacy-main',{corregido_desde:8}),
   batch('uncertain-a',{cantidad:2,fecha:'2026-11-05'}),batch('uncertain-b',{cantidad:2,fecha:'2026-11-05',created_at:'2026-11-04T12:00:06.000Z'})]})]);
 const [dateConflict]=await f.query(`INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado,propiedades_extra)
  VALUES('QA visit 30/10',$1,'QA','produccion','en_revision',$2::jsonb) RETURNING id`,[client.id,JSON.stringify({produccion_registros:[batch('date-conflict')]})]);
 for(const task of [legacyFilming,dateConflict])await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,10,'responsable')",[task.id]);
 await f.query("UPDATE tareas SET propiedades_extra=$2::jsonb WHERE id=$1",[filming.id,JSON.stringify({produccion_registros:[batch('already-normalized',{cantidad:8})]})]);
 const before=await f.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id');
 const login=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_luciano',password:fixturePassword}});assert.equal(login.status,200);
 const result=await request(f.base,'/api/instagram/equipo?periodo=2026-11',{token:login.body.token});assert.equal(result.status,200);
 assert.deepEqual(result.body.rows.map(r=>r.count),[5,3,1]);assert.doesNotMatch(JSON.stringify(result.body),/importe|sueldo|password|email/);
 assert.equal(result.body.rows[0].records.length,2);assert.equal(result.body.rows[0].productionPending.length,4);
 assert.deepEqual((await request(f.base,'/api/instagram/equipo?periodo=2026-11',{token:login.body.token})).body,result.body);
 assert.equal(result.body.rows[1].records.filter(r=>r.evidence==='historical_review').length,1);
 assert.equal(result.body.rows[1].records.filter(r=>r.evidence==='review_activity').length,1);
 const october=await request(f.base,'/api/instagram/equipo?periodo=2026-10',{token:login.body.token});
 assert.equal(october.status,200);assert.equal(october.body.rows[1].count,1);
 assert.equal(october.body.rows[1].records[0].evidence,'corroborated_review_activity');
 assert.equal(october.body.rows[1].records[0].date,'2026-10-05');
 assert.deepEqual(await f.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id'),before);
 assert.equal((await request(f.base,'/api/instagram/equipo?periodo=2026-11')).status,401);
});
