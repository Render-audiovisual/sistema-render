import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTaskCreateAttempt,prepareTaskCreation,TASK_CREATE_SQL} from '../src/task-create-input.js';
import {captureTaskCreateReceipt} from '../src/task-create-receipts.js';
const policy={states:['pendiente','en_progreso','en_revision','aprobada','finalizada'],types:['diseno','edicion','produccion','community','administracion','desarrollo'],priorities:['baja','media','alta']};
const base=()=>({request_id:'12345678-1234-4234-8234-123456789abc',workspace:'render_os',titulo:'Task',asignado_a_id:7});
const hash=body=>captureTaskCreateReceipt(extractTaskCreateAttempt(body,policy).receipt).payloadHash;
test('explicit contract captures all defaults and canonical ID sets before any asynchronous work',()=>{
  const raw={...base(),colaborador_ids:[9,7,8,9],etiquetas:[' a ','','b'],resumen:' Summary '};
  const attempt=extractTaskCreateAttempt(raw,policy);
  assert.equal(Object.isFrozen(attempt.input),true);assert.equal(Object.isFrozen(attempt.input.colaborador_ids),true);
  assert.deepEqual(attempt.input.colaborador_ids,[8,9]);assert.deepEqual(attempt.input.etiquetas,['a','b']);
  assert.equal(attempt.input.resumen,'Summary');assert.equal(attempt.input.prioridad,'media');
  assert.equal(attempt.input.cliente_id,null);assert.equal(attempt.input.requiere_aprobacion,false);
  const before=hash(raw);raw.colaborador_ids.push(10);assert.deepEqual(attempt.input.colaborador_ids,[8,9]);
  assert.equal(before,hash({...base(),colaborador_ids:[8,9],etiquetas:['a','b'],resumen:'Summary'}));
  assert.notEqual(before,hash(raw));
});
test('absent request UUID keeps legacy contract; invalid present UUID never downgrades',()=>{
  assert.equal(extractTaskCreateAttempt({titulo:'Legacy',asignado_a:'Name'},policy),null);
  for(const request_id of [null,'','x',1,'12345678-1234-4234-8234-123456789abc\n'])assert.throws(()=>extractTaskCreateAttempt({...base(),request_id},policy),{status:400});
});
test('closed contract rejects labels, ignored fields, coercions, invalid dates and completed work',()=>{
  for(const extra of [{asignado_a:'Name'},{colaboradores:[]},{propiedades_extra:{}},{unknown:1},
    {asignado_a_id:'7'},{colaborador_ids:[true]},{cliente_id:'2'},{cliente_id:0},
    {titulo:' '},{titulo:12},{requiere_aprobacion:'false'},{fecha_vencimiento:'2026-02-30'},
    {estado:'aprobada'},{estado:'finalizada'},{estado:'publicada'},{estado:'programada'},
    {estado:{toString:null}},{estado:1},{estado:null},
    {tipo_tarea:'unknown'},{prioridad:'unknown'},{etiquetas:[1]},{produccion_videos_previstos:3},
    {produccion_videos_previstos:'3'},{workspace:'historical'}]){
    assert.throws(()=>extractTaskCreateAttempt({...base(),...extra},policy),{status:400});
  }
});
test('every meaningful accepted field participates in the immutable intent digest',()=>{
  const original=hash(base());
  for(const extra of [{titulo:'Other'},{asignado_a_id:8},{colaborador_ids:[9]},{cliente_id:2},{estado:'en_progreso'},
    {requiere_aprobacion:true},{escalada_a:'Owner'},{motivo:'Reason'},{fecha_vencimiento:'2026-10-29'},
    {historia_id:1},{publicacion_id:2},{tipo_tarea:'diseno'},{subtipo:'Carrusel'},{prioridad:'alta'},
    {aclaraciones:'Draft'},{material_referencia:'Drive'},{tarea_padre_id:3},{resumen:'Summary'},{etiquetas:['tag']}]){
    assert.notEqual(hash({...base(),...extra}),original,JSON.stringify(extra));
  }
  const visit={...base(),titulo:'Visita',tipo_tarea:'produccion'};
  assert.notEqual(hash({...visit,produccion_videos_previstos:3}),hash({...visit,produccion_videos_previstos:4}));
});
test('shared builder resolves IDs and validates parent on its supplied transaction, not a global pool',async()=>{
  const calls=[],db={query:async(sql,values)=>{calls.push({sql,values});
    if(sql.includes('FROM usuarios'))return{rows:[{id:7,nombre:'Current name',activo:true}]};
    return{rows:[{id:3}]};}};
  const input=extractTaskCreateAttempt({...base(),cliente_id:2,tarea_padre_id:3},policy).input;
  const result=await prepareTaskCreation(db,input,{id:1,rol:'admin'},policy);
  assert.equal(result.sql,TASK_CREATE_SQL);assert.equal(result.values[1],'Current name');
  assert.equal(result.values[14],3);assert.equal(result.assignment.ownerId,7);
  assert.equal(JSON.parse(result.values[5]).workspace,'render_os');
  assert.equal(calls.length,2);assert.match(calls[0].sql,/usuarios/);assert.match(calls[1].sql,/tareas/);
});
