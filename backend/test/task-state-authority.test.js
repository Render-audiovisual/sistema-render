import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentTaskStateActor, assertCurrentTaskWriteActor } from '../src/task-state-authority.js';
import { persistAssignedTask } from '../src/task-persistence.js';
const actor = { id:7,rol:'produccion',session_version:2 };
test('text and state callers share one actor validation implementation',()=>{
  assert.equal(assertCurrentTaskStateActor,assertCurrentTaskWriteActor);
});
test('state writes require the same active persisted ID, role and session epoch, never a name or stale role', async () => {
  for(const patch of [null,{id:8},{activo:false},{session_version:3},{rol:'diseno'}]) {
    const db={query:async(sql,values)=>{
      assert.match(sql,/WHERE id=\$1 FOR SHARE$/); assert.deepEqual(values,[7]);
      return {rows:patch===null?[]:[{...actor,activo:true,...patch}]};
    }};
    await assert.rejects(assertCurrentTaskStateActor(db,actor),{status:401});
  }
  for(const bad of [{rol:'admin',nombre:'Franco'}, {...actor,id:'7'}, {...actor,session_version:0}, {...actor,session_version:'2'}])
    await assert.rejects(assertCurrentTaskStateActor({query:()=>assert.fail('Invalid actor must fail before SQL')},bad),{status:401});
  for(const rol of ['admin','community','produccion','diseno','edicion','programacion']) {
    const observed={...actor,rol};
    const result=await assertCurrentTaskStateActor({query:async()=>({rows:[{...observed,activo:true,nombre:'Renamed',importe:999}]})},observed);
    assert.deepEqual(result,{...observed,activo:true});
  }
});
test('actor SHARE is inside the task transaction and denial happens before any task UPDATE', async () => {
  const calls=[];
  const db={query:async sql=>{calls.push(sql);return {rows:[]};},release:()=>calls.push('RELEASE')};
  await assert.rejects(persistAssignedTask({connect:async()=>db},'UPDATE tareas QA',[],null,null,
    current=>assertCurrentTaskStateActor(current,actor)),{status:401});
  assert.deepEqual(calls,['BEGIN','SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE','ROLLBACK','RELEASE']);
});
test('actor binding is captured before waiting and database failure never falls back to stale authority', async () => {
  const input={...actor};let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const checked=assertCurrentTaskStateActor({query:async(_sql,values)=>{assert.deepEqual(values,[7]);await pending;return {rows:[{...actor,activo:true}]};}},input);
  input.id=8;input.rol='admin';input.session_version=3;release();
  assert.deepEqual(await checked,{...actor,activo:true});
  const calls=[],unavailable=new Error('Database unavailable');
  const db={query:async sql=>{calls.push(sql);if(sql.startsWith('SELECT'))throw unavailable;return {rows:[]};},release:()=>calls.push('RELEASE')};
  await assert.rejects(persistAssignedTask({connect:async()=>db},'UPDATE tareas QA',[],null,null,
    current=>assertCurrentTaskStateActor(current,actor)),error=>error===unavailable);
  assert.deepEqual(calls,['BEGIN','SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE','ROLLBACK','RELEASE']);
});
