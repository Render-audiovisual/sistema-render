import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTeamStatistics,readTeamStatistics} from '../src/team-statistics.js';
const users=[{id:8,nombre:'Augusto',rol:'diseno'},{id:9,nombre:'Luciano',rol:'edicion'},{id:10,nombre:'Germán',rol:'produccion'}];
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
 const [filming]=await f.query("INSERT INTO tareas(titulo,cliente_id,asignado_a,tipo_tarea,estado) VALUES('QA visit',$1,'QA','produccion','en_progreso') RETURNING id",[client.id]);
 await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,10,'responsable')",[filming.id]);
 const visit=randomUUID();await f.query("INSERT INTO produccion_visitas(id,tarea_origen_id,cliente_id,fecha,titulo,creado_por_id,actualizado_por_id) VALUES($1,$2,$3,'2026-11-04','QA visit',91001,91001)",[visit,filming.id,client.id]);
 await f.query("INSERT INTO produccion_videos(id,visita_id,titulo,estado,creado_por_id,actualizado_por_id) VALUES($1,$2,'QA filmed','grabado',91001,91001)",[randomUUID(),visit]);
 const before=await f.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id');
 const login=await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_luciano',password:fixturePassword}});assert.equal(login.status,200);
 const result=await request(f.base,'/api/instagram/equipo?periodo=2026-11',{token:login.body.token});assert.equal(result.status,200);
 assert.deepEqual(result.body.rows.map(r=>r.count),[1,1,1]);assert.doesNotMatch(JSON.stringify(result.body),/importe|sueldo|password|email/);
 assert.deepEqual(await f.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id'),before);
 assert.equal((await request(f.base,'/api/instagram/equipo?periodo=2026-11')).status,401);
});
