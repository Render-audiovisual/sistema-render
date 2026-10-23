import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWilsonTask, buildWilsonConfirmationHash, createWilsonRouter, findWilsonDuplicates, validateWilsonProductionLink } from '../src/wilson-integration.js';
const catalog={clients:[{id:2,nombre:'iPhone Shop'}],users:[{id:9,nombre:'Luciano',usuario:'Luciano',rol:'edicion'}]};
const payload={titulo:'iPhone Shop | Edición | Cambio de batería',cliente_id:2,responsables:['Luciano'],sector:'edicion',fecha_vencimiento:'2026-10-25',material:'https://drive.google.com/drive/folders/material',tarea_origen_id:1963,notificar_asignacion:false};
const visit={id:1963,titulo:'VISITA iPhone Shop',cliente_id:2,tipo_tarea:'produccion',estado:'en_progreso',material_referencia:payload.material,propiedades_extra:{workspace:'render_os',produccion_registros:[{cantidad:1,fecha:'2026-10-20'}]}};
test('partial recorded visit links without completing production and keeps true duplicates',()=>{
 const {task,errors}=buildWilsonTask(payload,catalog);assert.deepEqual(errors,[]);assert.equal(task.tarea_padre_id,1963);
 assert.equal(validateWilsonProductionLink(task,visit),null);
 assert.equal(findWilsonDuplicates(task,[visit]).length,1); // no unchecked exemption
 assert.equal(findWilsonDuplicates(task,[visit],{verifiedSourceId:1963}).length,0);
 assert.equal(findWilsonDuplicates(task,[visit,{...task,id:2000}],{verifiedSourceId:1963})[0].id,2000);
 for(const source of [null,{...visit,cliente_id:3},{...visit,tipo_tarea:'edicion'},{...visit,material_referencia:'other'},{...visit,propiedades_extra:{workspace:'render_os'}},{...visit,propiedades_extra:{...visit.propiedades_extra,workspace:'other'}},{...visit,propiedades_extra:{...visit.propiedades_extra,archivada_render_os:true}}])assert.ok(validateWilsonProductionLink(task,source));
 for(const tarea_origen_id of [0,-1,'foo',1.2])assert.ok(buildWilsonTask({...payload,tarea_origen_id},catalog).errors.length);
 assert.notEqual(buildWilsonConfirmationHash({operation:'crear',payload}),buildWilsonConfirmationHash({operation:'crear',payload:{...payload,tarea_origen_id:1964}}));
});
function fixture(){
 let rows=[structuredClone(visit)],notifications=0,confirm=true;const queries=[];
 const query=async(sql,args=[])=>{
  queries.push([sql,args]);
  if(sql.startsWith('SELECT id,nombre FROM clientes'))return {rows:catalog.clients};
  if(sql.startsWith('SELECT id,usuario'))return {rows:catalog.users};
  if(sql.includes('UPDATE integracion_confirmaciones'))return {rows:confirm?[{token:'exact'}]:[]};
  if(sql.includes('wilson_idempotency_key')&&sql.includes('SELECT'))return {rows:rows.filter(r=>r.propiedades_extra?.wilson_idempotency_key===args[0])};
  if(sql.includes('WHERE t.id=$1'))return {rows:rows.filter(r=>r.id===args[0])};
  if(sql.includes('FROM tareas t'))return {rows};
  if(sql.includes('INSERT INTO tareas')){const task={id:2000,titulo:args[0],asignado_a:args[1],cliente_id:args[2],estado:'pendiente',propiedades_extra:JSON.parse(args[3]),fecha_vencimiento:args[4],tipo_tarea:args[5],aclaraciones:args[8],material_referencia:args[9],tarea_padre_id:args[10]};rows.push(task);return {rows:[task]};}
  return {rows:[]};
 };
 const client={query,release(){}};const router=createWilsonRouter({pool:{connect:async()=>client,query},notifyAssignment(){notifications++;},env:{NODE_ENV:'test'}});
 async function run(body,key='first',actorRole='admin'){
  const handler=router.stack.find(l=>l.route?.path==='/tareas'&&l.route.methods.post).route.stack[0].handle;
  const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await handler({body,headers:{'idempotency-key':key},wilson:{channel:'whatsapp',actorId:'+5493794693647',actorName:actorRole==='admin'?'Franco Altamirano':'Germán',groupId:'',privateChat:true,userId:1,actorRole}},res,e=>{throw e;});return res;
 }
 return {run,rows,queries,notifications:()=>notifications,disableConfirmation(){confirm=false;}};
}
test('signed creation persists parent, audit and quiet assignment; second key cannot bypass duplicate',async()=>{
 const f=fixture();const before=structuredClone(f.rows[0]);
 const created=await f.run({...payload,confirmacion_token:'exact'});assert.equal(created.code,201);assert.equal(created.body.task.tarea_padre_id,1963);assert.equal(created.body.task.fecha_vencimiento,'2026-10-25');assert.deepEqual(created.body.task.responsables,['Luciano']);assert.deepEqual(f.rows[0],before);assert.equal(f.notifications(),0);
 assert.ok(f.queries.some(([sql,args])=>sql.includes('pg_advisory_xact_lock')&&args[0]==='wilson:client:2'));
 assert.ok(f.queries.some(([sql])=>sql.includes('FOR UPDATE OF t')));
 assert.ok(f.queries.some(([sql,args])=>sql.includes('integracion_auditoria')&&JSON.parse(args[7]).sourceTaskId===1963));
 const second=await f.run({...payload,confirmacion_token:'exact',permitir_duplicado:true},'second');assert.equal(second.code,409);assert.equal(f.rows.length,2);
 const replay=await f.run({...payload,confirmacion_token:'used'},'first');assert.equal(replay.body.idempotent,true);assert.equal(f.rows.length,2);
});
test('existing confirmation and private-assignment permissions remain required',async()=>{
 const f=fixture();f.disableConfirmation();assert.equal((await f.run({...payload,confirmacion_token:'wrong'})).code,409);assert.equal(f.rows.length,1);
 const other=fixture();assert.equal((await other.run({...payload,confirmacion_token:'exact'},'unauthorized','produccion')).code,403);assert.equal(other.rows.length,1);
});
