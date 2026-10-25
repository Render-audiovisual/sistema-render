import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectMixedProductionRecording} from '../src/production-registry-compatibility.js';
test('any canonical origin rejects aggregate writes even without artifacts; unlinked legacy remains supported',async()=>{
 for(const linked of [false,true]){
  const calls=[],db={query:async(sql,values)=>{calls.push({sql,values});return{rows:linked?[{id:'visit'}]:[]};}};
  if(linked)await assert.rejects(rejectMixedProductionRecording(db,7),{status:409});else await rejectMixedProductionRecording(db,7);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].values,[7]);assert.match(calls[0].sql,/v.tarea_origen_id=\$1/);
  assert.doesNotMatch(calls[0].sql,/EXISTS|produccion_videos|produccion_fotos|INSERT|UPDATE|DELETE/);
 }
});
