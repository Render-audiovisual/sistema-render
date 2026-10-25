import test from 'node:test';
import assert from 'node:assert/strict';
import {readTaskCreationAttempt} from '../src/task-create-recovery.js';
const requestId='12345678-1234-4234-8234-123456789abc';
const auth=()=>({id:7,rol:'diseno',session_version:1});
function fixture({missing=false,revoked=false,gone=false}={}){
  const calls=[];let released=0;
  const db={release:()=>{released++;},query:async(sql,values)=>{
    calls.push({sql,values});
    if(sql.startsWith('SELECT id,rol,activo'))return{rows:[{id:7,rol:'diseno',activo:!revoked,session_version:1,nombre:'QA'}]};
    if(sql.includes('FROM task_create_receipts'))return{rows:missing?[]:[{task_id:3,task_revision:1}]};
    if(sql.includes('FROM tareas t'))return{rows:gone?[]:[{id:3,revision:4,titulo:'Current title'}]};
    if(sql.includes('FROM tarea_asignaciones'))return{rows:[{tarea_id:3,usuario_id:8,tipo:'responsable'}]};
    return{rows:[]};
  }};
  return{calls,pool:{connect:async()=>db},released:()=>released};
}
test('recovery binds receipt to current actor and returns current authorized task without DML',async()=>{
  const f=fixture(),result=await readTaskCreationAttempt(f.pool,auth(),requestId.toUpperCase());
  assert.equal(result.requestId,requestId);assert.equal(result.task.revision,4);assert.equal(result.task.asignado_a_id,8);
  assert.deepEqual(f.calls.find(call=>call.sql.includes('FROM task_create_receipts')).values,[7,requestId]);
  assert.equal(f.calls[0].sql,'BEGIN');assert.equal(f.calls.at(-1).sql,'COMMIT');
  assert.doesNotMatch(f.calls.map(call=>call.sql).join('\n'),/\b(?:INSERT|UPDATE|DELETE)\b/);assert.equal(f.released(),1);
});
test('missing receipt/gone task are404 and revoked actor is401; rollback never creates a replacement',async()=>{
  for(const [flags,status] of [[{missing:true},404],[{gone:true},404],[{revoked:true},401]]){
    const f=fixture(flags);await assert.rejects(readTaskCreationAttempt(f.pool,auth(),requestId),error=>{
      assert.equal(error.status,status);if(status===404)assert.equal(error.message,'El intento guardado no está disponible.');return true;
    });
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.released(),1);
    assert.doesNotMatch(f.calls.map(call=>call.sql).join('\n'),/\b(?:INSERT|UPDATE|DELETE)\b/);
  }
});
test('invalid request, filters or actor reject before leasing',async()=>{
  const pool={connect:()=>assert.fail('No lease')};
  await assert.rejects(readTaskCreationAttempt(pool,auth(),'bad'),{status:400});
  await assert.rejects(readTaskCreationAttempt(pool,auth(),requestId,{q:'x'}),{status:400});
  await assert.rejects(readTaskCreationAttempt(pool,{},requestId),{status:401});
});
