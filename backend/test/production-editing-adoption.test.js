import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProductionEditingAdoption, persistProductionEditingAdoption } from '../src/production-editing-adoption.js';

const source={id:7,cliente_id:3};
const input={task_id:9,expected_revision:4,video_ordinal:2};
const task={id:9,revision:4,cliente_id:3,tipo_tarea:'edicion',historia_id:null,publicacion_id:null,
  deadline:'2026-10-28',workspace:'render_os',source_id:'7',archived:null,trashed:null,video_source:null,registry_source:null};
const owner={id:11,rol:'edicion',activo:true};
function fixture({children=[{id:9}],row=task,owners=[owner],goals=[],videos=[],projects=[]}={}) {
  const calls=[];
  const db={async query(sql,values){calls.push({sql,values});
    if(sql.includes("origen_visita_id'=$1"))return{rows:children};
    if(sql.includes('FROM tareas WHERE id=$1'))return{rows:row?[row]:[]};
    if(sql.includes('FROM cliente_objetivo_piezas'))return{rows:goals};
    if(sql.includes('FROM proyecto_tareas'))return{rows:projects};
    if(sql.includes('FROM produccion_videos WHERE'))return{rows:videos};
    if(sql.includes('FROM tarea_asignaciones'))return{rows:owners};
    throw Error(`Unexpected query ${sql}`);
  }};
  return{db,calls};
}
test('adoption derives real ID owner and delivery deadline without rewriting any task evidence',async()=>{
  const f=fixture(),value=await prepareProductionEditingAdoption(f.db,source,input);
  assert.deepEqual(value,{taskId:9,revision:4,editorId:11,deadline:'2026-10-28',ordinal:2});
  assert.ok(f.calls.some(({sql})=>sql.includes('FOR SHARE OF u')));
  for(const {sql}of f.calls)assert.doesNotMatch(sql,/\b(?:UPDATE|INSERT|DELETE)\b/);
});
test('adoption refuses ambiguity, stale revision, wrong client/type/workspace, archives and old registry markers',async()=>{
  for(const children of [[],[{id:10}],[{id:9},{id:10}]])await assert.rejects(prepareProductionEditingAdoption(fixture({children}).db,source,input),{status:409});
  for(const patch of [{revision:5},{cliente_id:4},{tipo_tarea:'diseno'},{workspace:null},{source_id:'8'},
    {archived:'true'},{trashed:'true'},{historia_id:1},{publicacion_id:1},{video_source:'old'},{registry_source:'old'},
    {deadline:null},{deadline:'2026-02-30'}])await assert.rejects(prepareProductionEditingAdoption(fixture({row:{...task,...patch}}).db,source,input),{status:409});
});
test('adoption never infers an editor from names or inactive/other-role/multiple owners',async()=>{
  for(const owners of [[],[owner,{...owner,id:12}],[{...owner,id:'11'}],[{...owner,activo:false}],[{...owner,rol:'produccion'}]])
    await assert.rejects(prepareProductionEditingAdoption(fixture({owners}).db,source,input),{status:409});
  const f=fixture({owners:[{...owner,rol:'admin'}]});assert.equal((await prepareProductionEditingAdoption(f.db,source,input)).editorId,11);
});
test('adoption refuses existing goal and per-video editing/delivery links rather than moving them',async()=>{
  for(const options of [{goals:[{id:1}]},{videos:[{id:'other'}]},{projects:[{tarea_id:9}]}])
    await assert.rejects(prepareProductionEditingAdoption(fixture(options).db,source,input),{status:409});
});
test('persist records only exact video/task snapshot and receipt, never touches task, delivery or review rows',async()=>{
  const calls=[];const db={async query(sql,values){calls.push({sql,values});return{rows:[]};}};
  await persistProductionEditingAdoption(db,{taskId:9,revision:4,editorId:11,deadline:'2026-10-28'},'receipt','video');
  assert.equal(calls.length,2);
  assert.match(calls[0].sql,/UPDATE produccion_videos/);assert.deepEqual(calls[0].values,['video',9,11,'2026-10-28']);
  assert.match(calls[1].sql,/INSERT INTO produccion_edicion_adopciones/);assert.deepEqual(calls[1].values,['receipt','video',9,4]);
  for(const {sql}of calls)assert.doesNotMatch(sql,/(?:UPDATE|INSERT INTO|DELETE FROM) (?:tareas|task_editing|comentarios|tarea_asignaciones)/);
});
