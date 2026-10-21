import test from 'node:test';
import assert from 'node:assert/strict';
import {findProductionAdoptedEditingTasks,findProductionAdoptedEditingTask} from '../src/production-editing-adoption.js';

test('adopted task discovery includes every legacy and batch mapping in canonical ID order',async()=>{
  const calls=[];
  const db={query:async(sql,values)=>{calls.push({sql,values});return{rows:[{tarea_edicion_id:9},{tarea_edicion_id:4},{tarea_edicion_id:9}]};}};
  assert.deepEqual(await findProductionAdoptedEditingTasks(db,'reviewed-visit'),[4,9]);
  assert.match(calls[0].sql,/produccion_edicion_adopciones/);
  assert.match(calls[0].sql,/UNION SELECT m\.tarea_edicion_id FROM produccion_lote_edicion_mapeos/);
  assert.match(calls[0].sql,/ORDER BY tarea_edicion_id/);
  assert.deepEqual(calls[0].values,['reviewed-visit']);
});
test('the compatibility helper never silently chooses the first task in a multi-mapping visit',async()=>{
  const db=ids=>({query:async()=>({rows:ids.map(tarea_edicion_id=>({tarea_edicion_id}))})});
  assert.equal(await findProductionAdoptedEditingTask(db([]),'visit'),null);
  assert.equal(await findProductionAdoptedEditingTask(db([4]),'visit'),4);
  assert.equal(await findProductionAdoptedEditingTask(db([9,4]),'visit'),null);
  for(const value of [null,0,-1,'4',2147483648])await assert.rejects(findProductionAdoptedEditingTasks(db([4,value]),'visit'),{status:409});
});
