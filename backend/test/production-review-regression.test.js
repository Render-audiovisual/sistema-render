import test from 'node:test';
import assert from 'node:assert/strict';
import { createWilsonRouter } from '../src/wilson-integration.js';
import { getProductionProgress } from '../src/production-visits.js';
import { validateProductionHandoff } from '../src/task-workflow.js';
const actor = {channel:'whatsapp',actorId:'+5493794693647',actorName:'Franco Altamirano',groupId:'',userId:1,actorRole:'admin'};
const visit=(id,extra)=>({id,titulo:'Visita: seis referencias',tipo_tarea:'produccion',subtipo:'visita',estado:'en_progreso',asignado_a:'Germán',updated_at:'2026-10-15T12:00:00.000Z',propiedades_extra:{workspace:'render_os',...extra}});
test('review preview and confirmation preserve German declarations independently of planning/references',async()=>{
 const rows=[visit(1935,{referencias:['a','b','c','d'],produccion_registros:[{cantidad:2,registrado_por:'Germán'}]}),visit(1942,{produccion_videos_previstos:6,produccion_registros:[{cantidad:5,registrado_por:'Germán'}]}),visit(99,{referencias:['a','b','c'],produccion_videos_previstos:3})];
 const original=structuredClone(rows.map(r=>r.propiedades_extra));let confirmation;let updates=0;
 const query=async(sql,args=[])=>{
  if(sql.includes('INSERT INTO integracion_confirmaciones')) confirmation={token:args[0],actor_id:actor.actorId,informante_actor_id:actor.actorId,informante_actor_nombre:actor.actorName,payload:JSON.parse(args[5])};
  if(sql.includes('FROM integracion_confirmaciones'))return {rows:[confirmation]};
  if(sql.includes('FROM tareas'))return {rows};
  if(sql.includes("UPDATE tareas SET estado='en_revision'")){updates++;const metadata=JSON.parse(args[1]);for(const row of rows){row.estado='en_revision';Object.assign(row.propiedades_extra,metadata);}}
  return {rows:[]};
 };
 const router=createWilsonRouter({pool:{connect:async()=>({query,release(){}})},env:{NODE_ENV:'test'}});
 const run=async(path,body)=>{const handler=router.stack.find(l=>l.route?.path===path).route.stack[0].handle;const response={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({wilson:actor,body,headers:{},get(){return undefined;}},response,e=>{throw e;});return response;};
 const preview=await run('/lotes/revision/previsualizar',{task_ids:rows.map(r=>r.id)});assert.equal(preview.code,201);assert.equal(updates,0);
 const result=await run('/lotes/revision/confirmar',{confirmacion_token:preview.body.confirmacion_token});assert.equal(result.code,200);assert.equal(result.body.updated,true);assert.equal(updates,1);
 rows.forEach((row,i)=>{assert.equal(row.estado,'en_revision');for(const key of Object.keys(original[i]))assert.deepEqual(row.propiedades_extra[key],original[i][key]);assert.equal(row.propiedades_extra.produccion_confirmada_at,undefined);assert.equal(row.propiedades_extra.produccion_finalizada_at,undefined);});
 assert.equal(getProductionProgress(rows[0]).recorded,2);assert.equal(getProductionProgress(rows[1]).recorded,5);assert.equal(getProductionProgress(rows[2]).recorded,0);
});
test('no planned amount never fabricates one missing video in handoff error',()=>{assert.match(validateProductionHandoff(visit(1,{produccion_registros:[{cantidad:2}]})),/declaración de finalización/);assert.doesNotMatch(validateProductionHandoff(visit(1,{})),/faltan 1/);});
