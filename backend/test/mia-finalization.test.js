import test from 'node:test';
import assert from 'node:assert/strict';
import {createWilsonRouter} from '../src/wilson-integration.js';
const task={id:1933,titulo:'Historia destacada',asignado_a:'Ana Mayerro',estado:'en_revision',updated_at:new Date('2026-10-12'),propiedades_extra:{workspace:'render_os'},tipo_tarea:'diseno'};
function fixture(actor='Ana Mayerro', changed=false){
 const queries=[];const snapshot={...task,updated_at:task.updated_at.toISOString()};
 const client={release(){},async query(sql,args){queries.push({sql,args});if(sql.includes('FROM integracion_confirmaciones'))return {rows:[{payload:{tasks:[snapshot]},informante_actor_id:'ana',informante_actor_nombre:'Ana',actor_id:'ana'}]};if(sql.includes('FROM tareas'))return {rows:[{...task,...(changed?{estado:'en_progreso'}:{})}]};return {rows:[]};}};
 const pool={connect:async()=>client};const router=createWilsonRouter({pool,env:{NODE_ENV:'test'}});
 const req={body:{task_ids:[1933],confirmacion_token:'token'},wilson:{channel:'whatsapp',actorName:actor,actorId:'ana',actorRole:'comunicacion',userId:2,groupId:'',privateChat:true}};
 const res={code:200,status(n){this.code=n;return this},json(value){this.body=value;return this}};
 async function call(path){const route=router.stack.find(x=>x.route?.path===path);await route.route.stack[0].handle(req,res,error=>{throw error});return res;}
 return {call,queries,res};
}
test('finalización admite tarea propia en revisión sin cambiarla durante el resumen',async()=>{const f=fixture();await f.call('/lotes/finalizacion/previsualizar');assert.equal(f.res.code,201);assert.match(f.res.body.text,/Finalizadas/);assert.equal(f.queries.some(q=>q.sql.includes('UPDATE tareas')),false)});
test('no permite finalizar una tarea ajena',async()=>{const f=fixture('Luciano');await f.call('/lotes/finalizacion/previsualizar');assert.equal(f.res.code,403);assert.equal(f.queries.some(q=>q.sql.includes('UPDATE tareas')),false)});
test('confirmación guarda el estado real de finalización y la fecha',async()=>{const f=fixture();await f.call('/lotes/finalizacion/confirmar');assert.equal(f.res.body.updated,true);const write=f.queries.find(q=>q.sql.includes('UPDATE tareas'));assert.match(write.sql,/estado='publicada'/);assert.ok(JSON.parse(write.args[1]).finalizada_at)});
test('un cambio concurrente cancela todo el cierre',async()=>{const f=fixture('Ana Mayerro',true);await f.call('/lotes/finalizacion/confirmar');assert.equal(f.res.code,409);assert.equal(f.queries.some(q=>q.sql.includes('UPDATE tareas')),false)});
