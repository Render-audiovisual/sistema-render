import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTeamWorkCards} from './team-work-cards.js';
import {getReportPeriodRange} from './report-utils.js';
const range={desde:'2026-10-01',hasta:'2026-11-01'};
const users=[{id:8,nombre:'Augusto',rol:'diseno'},{id:12,nombre:'Mariano',rol:'diseno'},{id:10,nombre:'Germán',rol:'produccion'},{id:9,nombre:'Luciano',rol:'edicion'},{id:11,nombre:'Oriana',rol:'community'},{id:15,nombre:'Ana',rol:'community'},{id:1,nombre:'Líder',rol:'admin'}];
const task=(id,user,type,extra={})=>({id,asignado_a_id:user,tipo_tarea:type,titulo:type==='diseno'?'Carrusel de prueba':'Reel de prueba',estado:'en_revision',fecha_vencimiento:'2026-10-10',cliente_nombre:'Cliente QA',propiedades_extra:{workspace:'render_os'},...extra});
test('explicit report month has full exclusive bounds including leap years and year transitions',()=>{
 assert.deepEqual(getReportPeriodRange('2028-02').desde,'2028-02-01');assert.equal(getReportPeriodRange('2028-02').hasta,'2028-03-01');assert.equal(getReportPeriodRange('2028-02').dias,29);
 assert.equal(getReportPeriodRange('2026-12').hasta,'2027-01-01');
});
test('separate person cards count delivered tasks by IDs, preserve status distinctions and deduplicate across reports',()=>{
 const first=task(1,8,'diseno'),second=task(2,12,'diseno',{estado:'finalizada'}),editing=task(3,9,'edicion');
 const data={usuarios:users,tareas:[first,second],tareasRenderOs:[first,editing,task(4,8,'diseno',{estado:'pendiente'}),task(5,8,'diseno',{fecha_vencimiento:'2026-11-01'})]};
 const before=JSON.stringify(data),cards=buildTeamWorkCards(data,range);
 assert.equal(cards.length,6);assert.equal(cards.find(c=>c.id===8).count,1);assert.equal(cards.find(c=>c.id===8).pending,1);
 assert.equal(cards.find(c=>c.id===12).count,1);assert.equal(cards.find(c=>c.id===9).count,1);
 assert.equal(JSON.stringify(data),before);
});
test('trash and archived tasks cannot create work credit and names never resolve identities',()=>{
 const cards=buildTeamWorkCards({usuarios:users,tareas:[task(1,null,'diseno',{asignado_a:'Augusto'}),task(2,8,'diseno',{propiedades_extra:{archivada_render_os:'true'}}),task(3,8,'diseno',{propiedades_extra:{papelera_render_os:true}})]},range);
 assert.equal(cards.find(c=>c.id===8).count,0);
});
test('filming counts recorded video IDs once, excludes attendees as authors and prevents normalized/historical double counting',()=>{
 const origin=task(1,10,'produccion',{produccion_registro_individual:true,propiedades_extra:{produccion_registros:[{id:'old',cantidad:99,fecha:'2026-10-05'}]}});
 const visits=[{id:'visit',tarea_origen_id:1,fecha:'2026-10-05',participante_ids:[10,9],videos:[{id:'video',estado:'grabado'},{id:'video',estado:'grabado'},{id:'pending',estado:'pendiente'}]}];
 const old=task(2,10,'produccion',{propiedades_extra:{produccion_registros:[{id:'record',cantidad:3,fecha:'2026-10-08'},{id:'record',cantidad:3,fecha:'2026-10-08'}]}});
 const cards=buildTeamWorkCards({usuarios:users,tareas:[origin,old],producciones:{visitas:visits}},range);
 assert.equal(cards.find(c=>c.id===10).count,4);assert.equal(cards.find(c=>c.id===9).count,0);
});
function confirmed(id,actor,extra={}){return {id,cliente_id:2,tipo:'carrusel',estado:'publicada','fecha_publicación_real':'2026-10-10T15:00:00.000Z',publicacion_evidencia:{classification:'confirmada_manualmente',revision:1,confirmation:{id:'11111111-1111-4111-8111-111111111111',actor_id:actor,source:'manual',occurred_at:'2026-10-10T15:00:00.000Z',recorded_at:'2026-10-10T15:01:00.000Z'}},...extra};}
test('community counts only dated manual publication confirmations by actor ID, never completed tasks, client assignments or legacy dates',()=>{
 const ana=confirmed(1,15),oriana=confirmed(2,11);
 const cards=buildTeamWorkCards({usuarios:users,publicaciones:[ana,ana,oriana,confirmed(3,15,{publicacion_evidencia:null}),confirmed(4,1)],tareas:[task(9,15,'diseno',{estado:'finalizada'})]},range);
 assert.equal(cards.find(c=>c.id===15).count,1);assert.equal(cards.find(c=>c.id===11).count,1);
 assert.equal(cards.find(c=>c.id===15).unattributed,1);
 assert.equal(buildTeamWorkCards({usuarios:users,publicaciones:[ana]}, {desde:'2026-11-01',hasta:'2026-12-01'}).find(c=>c.id===15).count,0);
});
