import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteLegacyTask } from '../src/task-deletion.js';

const auth = () => ({id:7,rol:'admin',session_version:1});
function fixture({actor={id:7,rol:'admin',activo:true,session_version:1},missing=false,writeError,rollbackError}={}) {
  const events=[];let released;
  const db={async query(sql,params){
    events.push({sql,params});
    if(sql.includes('FROM usuarios'))return {rows:actor?[actor]:[]};
    if(sql.startsWith('DELETE')){if(writeError)throw writeError;return {rows:missing?[]:[{id:8}]};}
    if(sql==='ROLLBACK'&&rollbackError)throw rollbackError;
    return {rows:[]};
  },release(error){released=error;events.push({sql:'release'});}};
  return {events,get released(){return released;},pool:{async connect(){events.push({sql:'connect'});return db;}}};
}
test('deletion captures original identity before lease and retains admin authority until commit',async()=>{
  const f=fixture(),identity=auth();
  const pending=deleteLegacyTask(f.pool,{auth:identity,id:8,renderOs:true});
  identity.id=99;identity.rol='edicion';identity.session_version=9;
  assert.deepEqual(await pending,{ok:true});
  assert.deepEqual(f.events.map(event=>event.sql.split('\n')[0]),['connect','BEGIN ISOLATION LEVEL READ COMMITTED','SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE','DELETE FROM tareas','COMMIT','release']);
  assert.deepEqual(f.events[2].params,[7]);
  assert.match(f.events[3].sql,/propiedades_extra->>'workspace' = 'render_os'/);
  assert.deepEqual(f.events[3].params,[8]);
});
test('revoked or non-admin actors cannot reach DELETE and roll back',async()=>{
  for(const actor of [null,{id:7,rol:'admin',activo:false,session_version:1},{id:7,rol:'admin',activo:true,session_version:2},{id:7,rol:'edicion',activo:true,session_version:1}]){
    const f=fixture({actor});
    await assert.rejects(deleteLegacyTask(f.pool,{auth:auth(),id:8}),error=>error.status===401);
    assert.ok(!f.events.some(event=>event.sql.startsWith('DELETE')));
    assert.deepEqual(f.events.slice(-2).map(event=>event.sql),['ROLLBACK','release']);
  }
  const f=fixture({actor:{id:7,rol:'edicion',activo:true,session_version:1}});
  await assert.rejects(deleteLegacyTask(f.pool,{auth:{...auth(),rol:'edicion'},id:8}),error=>error.status===403);
  assert.ok(!f.events.some(event=>event.sql.startsWith('DELETE')));
});
test('missing rows and FK failures roll back; failed rollback discards connection without hiding cause',async()=>{
  const missing=fixture({missing:true});
  await assert.rejects(deleteLegacyTask(missing.pool,{auth:auth(),id:8}),error=>error.status===404);
  assert.deepEqual(missing.events.slice(-2).map(event=>event.sql),['ROLLBACK','release']);
  const original=Object.assign(new Error('linked fixture'),{code:'23503'}),rollbackError=new Error('connection lost');
  const f=fixture({writeError:original,rollbackError});
  await assert.rejects(deleteLegacyTask(f.pool,{auth:auth(),id:8}),error=>error===original);
  assert.equal(f.released,rollbackError);
});
test('invalid intent cannot acquire a connection and legacy unscoped delete retains existing predicate',async()=>{
  for(const id of [undefined,null,0,-1,'8',NaN,1.2,2147483648]){
    const f=fixture();await assert.rejects(deleteLegacyTask(f.pool,{auth:auth(),id}),error=>error.status===400);
    assert.equal(f.events.length,0);
  }
  const f=fixture();await deleteLegacyTask(f.pool,{auth:auth(),id:8});
  assert.doesNotMatch(f.events.find(event=>event.sql.startsWith('DELETE')).sql,/workspace/);
});
