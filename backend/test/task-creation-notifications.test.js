import test from 'node:test';
import assert from 'node:assert/strict';
import { persistAssignedTask } from '../src/task-persistence.js';
import { captureAssignmentNotification } from '../src/task-reassignment-notifications.js';

const auth=()=>({id:7,rol:'admin',session_version:2});
const options=()=>({assignmentNotificationActor:auth(),assignmentNotificationMode:'created'});
const assignment=()=>({ownerId:3,ownerName:'homonym',collaboratorIds:[7,4],collaboratorNames:['actor label','homonym'],hasCollaborators:true});
function fixture({returnedId=11,rowCount=1,user={...auth(),activo:true,nombre:'DB actor',usuario:'db_actor'},failAt,rollbackFail=false,onConnect,corruptMembers=false}={}){
  const calls=[],releases=[];
  let connections=0,members=[],result;
  const task={id:returnedId,revision:1,asignado_a:'homonym',titulo:'Created task',propiedades_extra:{nested:{tags:['initial']}}};
  const error=new Error('original create error');
  const db={release:error=>releases.push(error),query:async(sql,values)=>{
    calls.push({sql,values:structuredClone(values)});
    if(sql===failAt)throw error;
    if(sql==='ROLLBACK'&&rollbackFail)throw Error('rollback failed');
    if(sql.startsWith('SELECT id,rol,'))return {rows:user?[user]:[]};
    if(sql.startsWith('SELECT id FROM usuarios'))return {rows:values[0].map(id=>({id}))};
    if(sql==='INSERT TASK')return result={rows:Array.from({length:rowCount},()=>task)};
    if(sql.startsWith('DELETE FROM tarea_asignaciones'))members=[];
    if(sql.startsWith('INSERT INTO tarea_asignaciones'))members=values[1].map((id,i)=>({usuario_id:id,tipo:values[2][i]}));
    if(sql.startsWith('SELECT tarea_id, usuario_id, tipo'))return {rows:members.map(row=>({...row,tarea_id:returnedId}))};
    if(sql.startsWith('SELECT usuario_id,tipo'))return {rows:corruptMembers?[{usuario_id:'3',tipo:'responsable'}]:structuredClone(members)};
    return {rows:[]};
  }};
  const pool={connect:async()=>{connections++;await onConnect?.();return db;}};
  return {calls,releases,task,error,get connections(){return connections;},get result(){return result;},
    run:(a=assignment(),o=options(),after=null,before=null,values=[])=>persistAssignedTask(pool,'INSERT TASK',values,a,after,before,o)};
}
test('created mode reads committed members, captures all IDs including actor, and publishes only after COMMIT',async()=>{
  const f=fixture();
  const result=await f.run(undefined,undefined,async(db)=>{
    assert.equal(f.result.assignmentNotification,undefined);await db.query('AFTER SAVE');
  },async(db)=>{await db.query('BEFORE SAVE');});
  const context=result.assignmentNotification;
  assert.deepEqual(context.destinatarioIds,[3,4,7]);
  assert.equal(context.actorId,7);assert.equal(context.actor,'DB actor');
  // Transport excludes actor by ID; persistence captures actual members, not labels.
  assert.deepEqual(context.tarea.colaborador_ids,[7,4]);
  const sql=f.calls.map(call=>call.sql);
  assert.equal(sql.some(s=>s.includes('FROM tareas')&&s.includes('FOR UPDATE')),false);
  assert.ok(sql.findIndex(s=>s.startsWith('SELECT id,rol,'))<sql.indexOf('BEFORE SAVE'));
  assert.equal(sql.filter(s=>s.startsWith('SELECT usuario_id,tipo')).length,1);
  assert.ok(sql.indexOf('INSERT TASK')<sql.findIndex(s=>s.startsWith('INSERT INTO tarea_asignaciones')));
  assert.equal(sql.at(-1),'COMMIT');assert.deepEqual(f.releases,[undefined]);
  assert.ok(Object.isFrozen(context));assert.ok(Object.isFrozen(context.destinatarioIds));
  assert.ok(Object.isFrozen(context.tarea.propiedades_extra.nested.tags));
  f.task.propiedades_extra.nested.tags.push('late');
  assert.deepEqual(context.tarea.propiedades_extra.nested.tags,['initial']);
});
test('creation captures mode/actor/assignment/nested bindings synchronously before lease',async()=>{
  const o=options(),a=assignment(),values=[{nested:['initial']}];
  const f=fixture({onConnect:()=>{
    o.assignmentNotificationMode='bad';o.assignmentNotificationActor.id=99;o.assignmentNotificationActor.rol='edicion';
    a.ownerId=99;a.collaboratorIds.push(99);values[0].nested.push('late');
  }});
  const result=await f.run(a,o,null,null,values);
  assert.equal(result.assignmentNotification.actorId,7);assert.deepEqual(result.assignmentNotification.destinatarioIds,[3,4,7]);
  assert.deepEqual(f.calls.find(c=>c.sql==='INSERT TASK').values,[{nested:['initial']}]);
});
test('unsupported mode, any provided creation task ID, or missing actor fails before connect',async()=>{
  for(const o of [{assignmentNotificationMode:'bad'},{assignmentNotificationMode:null},{...options(),assignmentNotificationMode:'reassigned'},
    {assignmentNotificationMode:'created'},{...options(),assignmentNotificationActor:null},
    ...[undefined,null,11,0].map(id=>({...options(),assignmentNotificationTaskId:id}))]){
    const f=fixture();await assert.rejects(f.run(assignment(),o));assert.equal(f.connections,0);
  }
  assert.deepEqual(captureAssignmentNotification({assignmentNotificationActor:auth(),assignmentNotificationTaskId:11}),
    {...auth(),taskId:11},'Default reassignment capture shape remains compatible');
  const defaultMissing=fixture();await assert.rejects(defaultMissing.run(assignment(),{assignmentNotificationActor:auth()}),{status:400});
  const legacy=fixture();const result=await legacy.run(assignment(),{});
  assert.equal(result.assignmentNotification,undefined);assert.equal(legacy.calls.some(c=>c.sql.startsWith('SELECT id,rol,')),false);
});
test('created requires exactly one positive int32 returned ID before replacement',async()=>{
  for(const config of [{rowCount:0},{rowCount:2},...[undefined,null,'11',0,-1,1.5,2147483648].map(returnedId=>({returnedId}))]){
    // undefined would use the fixture default; explicitly erase that returned ID.
    const f=fixture(config);if(Object.hasOwn(config,'returnedId')&&config.returnedId===undefined)f.task.id=undefined;
    await assert.rejects(f.run(),{status:409});
    assert.equal(f.result.assignmentNotification,undefined);
    assert.equal(f.calls.some(c=>c.sql.startsWith('DELETE FROM tarea_asignaciones')),false);
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
});
test('explicit mode never silently opts out with null assignment; legacy absent mode still does',async()=>{
  for(const o of [options(),{assignmentNotificationMode:'created'},{assignmentNotificationMode:'bad'},
    {...options(),assignmentNotificationMode:'bad'},{assignmentNotificationMode:null}]){
    const f=fixture();await assert.rejects(f.run(null,o),{status:400});assert.equal(f.connections,0);
  }
  for(const o of [{},{assignmentNotificationActor:auth(),assignmentNotificationTaskId:11}]){
    const f=fixture();const result=await f.run(null,o);
    assert.equal(result.assignmentNotification,undefined);assert.equal(f.connections,1);
    assert.equal(f.calls.some(c=>c.sql.startsWith('SELECT id,rol,')),false);
  }
});
test('revoked or mismatched actor never reaches creation',async()=>{
  for(const user of [null,{...auth(),activo:false},{...auth(),activo:true,id:9},{...auth(),activo:true,rol:'edicion'},{...auth(),activo:true,session_version:3}]){
    const f=fixture({user});await assert.rejects(f.run(),{status:401});
    assert.equal(f.calls.some(c=>c.sql==='INSERT TASK'),false);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
});
test('membership, callback, insert and COMMIT failures never expose creation context',async()=>{
  const corrupt=fixture({corruptMembers:true});await assert.rejects(corrupt.run(),{status:409});assert.equal(corrupt.result.assignmentNotification,undefined);
  const hook=fixture();await assert.rejects(hook.run(undefined,undefined,async()=>{throw Error('hook failed');}),/hook failed/);
  assert.equal(hook.result.assignmentNotification,undefined);assert.equal(hook.calls.some(c=>c.sql==='COMMIT'),false);
  for(const failAt of ['INSERT TASK','COMMIT']){
    const f=fixture({failAt});await assert.rejects(f.run(),error=>error===f.error);
    assert.equal(f.result?.assignmentNotification,undefined);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
  const rollback=fixture({failAt:'COMMIT',rollbackFail:true});
  await assert.rejects(rollback.run(),error=>error===rollback.error);
  assert.equal(rollback.result.assignmentNotification,undefined);assert.equal(rollback.releases[0].message,'rollback failed');
});
