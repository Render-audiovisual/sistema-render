import test from 'node:test';
import assert from 'node:assert/strict';
import { persistAssignedTask } from '../src/task-persistence.js';
import { buildAssignmentNotification } from '../src/task-reassignment-notifications.js';

const auth={id:7,rol:'admin',session_version:2};
const options=()=>({assignmentNotificationActor:{...auth},assignmentNotificationTaskId:11});
const assignment=()=>({ownerId:3,ownerName:'Same label',collaboratorIds:[4],collaboratorNames:['Other'],hasCollaborators:true});
function fixture({user={...auth,activo:true,nombre:'DB actor',usuario:'db_actor'},before=[{usuario_id:2,tipo:'responsable'},{usuario_id:3,tipo:'colaborador'}],zero=false,wrongId=false,failAt,rollbackFail=false,onConnect}={}) {
  const calls=[],releases=[];
  let members=structuredClone(before),connections=0,result;
  const task={id:wrongId?12:11,revision:2,titulo:'Task',propiedades_extra:{nested:{tags:['safe']}},updated_at:new Date('2026-10-01T00:00:00Z')};
  const error=new Error('original failure');
  const db={release:value=>releases.push(value),query:async(sql,values)=>{
    calls.push({sql,values:structuredClone(values)});
    if(sql===failAt)throw error;
    if(sql==='ROLLBACK'&&rollbackFail)throw new Error('rollback failure');
    if(sql.startsWith('SELECT id,rol,'))return {rows:user?[user]:[]};
    if(sql==='SELECT id FROM tareas WHERE id=$1 FOR UPDATE')return {rows:[{id:11}]};
    if(sql.startsWith('SELECT id FROM usuarios'))return {rows:values[0].map(id=>({id}))};
    if(sql.startsWith('SELECT usuario_id,tipo'))return {rows:structuredClone(members)};
    if(sql==='UPDATE TASK')return result={rows:zero?[]:[task]};
    if(sql.startsWith('DELETE FROM tarea_asignaciones'))members=[];
    if(sql.startsWith('INSERT INTO tarea_asignaciones'))members=values[1].map((id,i)=>({usuario_id:id,tipo:values[2][i]}));
    if(sql.startsWith('SELECT tarea_id, usuario_id, tipo'))return {rows:members.map(row=>({...row,tarea_id:11}))};
    return {rows:[]};
  }};
  const pool={connect:async()=>{connections++;await onConnect?.();return db;}};
  return {calls,releases,task,error,get result(){return result;},get connections(){return connections;},
    run:(a=assignment(),o=options(),after=null,beforeHook=null,values=[])=>persistAssignedTask(pool,'UPDATE TASK',values,a,after,beforeHook,o)};
}
test('opt-in locks actor then task, observes typed memberships and publishes frozen IDs only after COMMIT',async()=>{
  const f=fixture();
  const result=await f.run(undefined,undefined,async()=>{assert.equal(f.result.assignmentNotification,undefined);},async db=>{await db.query('APPROVAL HOOK');});
  assert.deepEqual(result.assignmentNotification.destinatarioIds,[3,4]);
  assert.equal(result.assignmentNotification.actorId,7);assert.equal(result.assignmentNotification.actor,'DB actor');
  const sql=f.calls.map(c=>c.sql);
  assert.ok(sql.indexOf('APPROVAL HOOK')>sql.findIndex(s=>s.startsWith('SELECT id,rol,')));
  assert.ok(sql.indexOf('SELECT id FROM tareas WHERE id=$1 FOR UPDATE')<sql.indexOf('UPDATE TASK'));
  assert.equal(sql.filter(s=>s.startsWith('SELECT usuario_id,tipo')).length,2);
  assert.equal(sql.at(-1),'COMMIT');
  assert.ok(Object.isFrozen(result.assignmentNotification));assert.ok(Object.isFrozen(result.assignmentNotification.destinatarioIds));
  assert.ok(Object.isFrozen(result.assignmentNotification.tarea.propiedades_extra.nested.tags));
  f.task.propiedades_extra.nested.tags.push('later');
  assert.deepEqual(result.assignmentNotification.tarea.propiedades_extra.nested.tags,['safe']);
  assert.equal(result.assignmentNotification.tarea.updated_at,'2026-10-01T00:00:00.000Z');
});
test('actor, target, assignment and nested SQL bindings are captured before lease await',async()=>{
  const o=options(),a=assignment(),values=[{nested:['original']}];
  const f=fixture({onConnect:()=>{o.assignmentNotificationActor.id=99;o.assignmentNotificationActor.rol='edicion';o.assignmentNotificationTaskId=99;a.ownerId=99;a.collaboratorIds.push(99);values[0].nested.push('mutated');}});
  const result=await f.run(a,o,null,null,values);
  assert.equal(f.calls.find(c=>c.sql.startsWith('SELECT id,rol,')).values[0],7);
  assert.deepEqual(f.calls.find(c=>c.sql==='UPDATE TASK').values,[{nested:['original']}]);
  assert.deepEqual(result.assignmentNotification.destinatarioIds,[3,4]);
});
test('invalid actor or target rejects before connecting',async()=>{
  for(const patch of [{assignmentNotificationActor:null},{assignmentNotificationActor:{...auth,id:'7'}},{assignmentNotificationActor:{...auth,session_version:0}},
    {assignmentNotificationActor:{...auth,rol:'unknown'}},{assignmentNotificationTaskId:0},{assignmentNotificationTaskId:2147483648}]){
    const f=fixture();await assert.rejects(f.run(assignment(),{...options(),...patch}));assert.equal(f.connections,0);
  }
});
test('missing inactive mismatched actor role or epoch fails before task/domain access',async()=>{
  for(const user of [null,{...auth,activo:false},{...auth,activo:true,id:8},{...auth,activo:true,rol:'edicion'},{...auth,activo:true,session_version:3}]){
    const f=fixture({user});await assert.rejects(f.run(),{status:401});
    assert.deepEqual(f.calls.map(c=>c.sql).slice(-1),['ROLLBACK']);
    assert.ok(!f.calls.some(c=>/FROM tareas|UPDATE TASK/.test(c.sql)));
  }
});
test('role-sensitive ID delta preserves promotion and ignores labels, removals and unchanged IDs',()=>{
  const actor={actorId:7,actor:'actual actor'},task={id:11,asignado_a:'same'};
  const build=(previous,next)=>buildAssignmentNotification(task,previous,next,actor).destinatarioIds;
  assert.deepEqual(build({ownerId:2,collaboratorIds:[3]},{ownerId:3,collaboratorIds:[2]}),[2,3]);
  assert.deepEqual(build({ownerId:3,collaboratorIds:[4,5]},{ownerId:3,collaboratorIds:[]}),[]);
  assert.deepEqual(build({ownerId:null,collaboratorIds:[]},{ownerId:3,collaboratorIds:[4,4]}),[3,4]);
  assert.deepEqual(build({ownerId:3,collaboratorIds:[4]},{ownerId:3,collaboratorIds:[4]}),[]);
});
test('zero CAS has no context and legacy opt-out has no extra actor/task capture',async()=>{
  const zero=fixture({zero:true});assert.equal((await zero.run()).assignmentNotification,undefined);
  for(const [a,o]of [[assignment(),{}],[null,options()]]){
    const f=fixture();const result=await f.run(a,o);assert.equal(result.assignmentNotification,undefined);
    assert.ok(!f.calls.some(c=>c.sql.startsWith('SELECT id,rol,')||c.sql.includes('FOR UPDATE')));
  }
});
test('wrong target, malformed stored membership, hook and COMMIT failures never publish context',async()=>{
  const wrong=fixture({wrongId:true});await assert.rejects(wrong.run(),{status:409});assert.equal(wrong.result.assignmentNotification,undefined);
  for(const before of [[{usuario_id:'2',tipo:'responsable'}],[{usuario_id:2,tipo:'unknown'}],[{usuario_id:2,tipo:'responsable'},{usuario_id:3,tipo:'responsable'}]]){
    const f=fixture({before});await assert.rejects(f.run(),{status:409});assert.ok(!f.calls.some(c=>c.sql==='UPDATE TASK'));
  }
  const hook=fixture();await assert.rejects(hook.run(undefined,undefined,async()=>{throw Error('hook failed');}),/hook failed/);
  assert.equal(hook.result.assignmentNotification,undefined);assert.ok(!hook.calls.some(c=>c.sql==='COMMIT'));
  const commit=fixture({failAt:'COMMIT'});await assert.rejects(commit.run(),error=>error===commit.error);
  assert.equal(commit.result.assignmentNotification,undefined);assert.equal(commit.calls.at(-1).sql,'ROLLBACK');
});
test('rollback failure preserves original error and discards connection',async()=>{
  const f=fixture({failAt:'UPDATE TASK',rollbackFail:true});
  await assert.rejects(f.run(),error=>error===f.error);
  assert.equal(f.releases[0].message,'rollback failure');assert.ok(!f.calls.some(c=>c.sql==='COMMIT'));
});
