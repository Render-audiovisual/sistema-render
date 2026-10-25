import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTaskBulkAction } from '../src/task-bulk-actions.js';

function fixture({ denied = false, revoked = false, updateFailure = false } = {}) {
  const events = []; let metadata;
  const db = { release(){ events.push('release'); }, async query(sql, params) {
    events.push(sql);
    if (sql.includes('FROM usuarios WHERE id=$1 FOR SHARE')) return {rows: revoked ? [] : [{id:7,rol:'edicion',activo:true,session_version:1}]};
    if (sql.includes('ORDER BY id FOR UPDATE')) { assert.deepEqual(params, [[1,2]]); return {rowCount:2,rows:[{id:1},{id:2}]}; }
    if (sql.includes('FROM tareas t')) { assert.deepEqual(params,[[1,2],7]); return {rowCount:denied?1:2}; }
    if (sql.includes('SELECT nombre,usuario')) return {rows:[{nombre:'Verified actor',usuario:'qa'}]};
    if (sql.startsWith('UPDATE tareas')) {
      if(updateFailure) throw new Error('synthetic update failure');
      metadata=JSON.parse(params[1]);return {rowCount:2,rows:[{id:'2'},{id:'1'}]};
    }
    return {rows:[]};
  }};
  return {events,get metadata(){return metadata;},pool:{async connect(){events.push('connect');return db;}}};
}
const auth=()=>({id:7,rol:'edicion',session_version:1,nombre:'Untrusted stale name'});
test('failed rollback discards the connection without replacing the original failure',async()=>{
  const original=new Error('write failed'),rollback=new Error('connection lost');let released;
  const db={async query(sql){if(sql==='ROLLBACK')throw rollback;if(sql.includes('FROM usuarios'))throw original;},release(error){released=error;}};
  await assert.rejects(applyTaskBulkAction({connect:async()=>db},{auth:auth(),ids:[1],action:'papelera'}),error=>error===original);
  assert.equal(released,rollback);
});
test('captures original identity and sorted IDs before connection, commits atomically and uses retained identity label',async()=>{
  const f=fixture(),identity=auth(),ids=[2,1];
  const pending=applyTaskBulkAction(f.pool,{auth:identity,ids,action:'papelera'});
  identity.id=99;identity.rol='admin';ids[0]=99;
  assert.deepEqual(await pending,{ok:true,accion:'papelera',ids:[2,1],cantidad:2});
  assert.equal(f.metadata.papelera_por,'Verified actor');assert.equal(f.metadata.papelera_render_os,true);
  assert.ok(f.events.findIndex(sql=>sql.includes('FOR SHARE')) < f.events.findIndex(sql=>sql.includes('FOR UPDATE')));
  assert.ok(f.events.findIndex(sql=>sql.includes('FOR UPDATE')) < f.events.findIndex(sql=>sql.includes('FROM tareas t')));
  assert.deepEqual(f.events.slice(-2),['COMMIT','release']);
});
test('mixed authorization rolls back all rows; revoked actor never obtains task locks',async()=>{
  for(const options of [{denied:true},{revoked:true}]) {
    const f=fixture(options);
    await assert.rejects(applyTaskBulkAction(f.pool,{auth:auth(),ids:[1,2],action:'restaurar'}),error=>error.status===(options.revoked?401:403));
    assert.ok(!f.events.some(sql=>sql.startsWith('UPDATE tareas')));
    if(options.revoked)assert.ok(!f.events.some(sql=>sql.includes('FOR UPDATE')));
    assert.deepEqual(f.events.slice(-2),['ROLLBACK','release']);
  }
});
test('update failure rolls back and releases; invalid intent never acquires connection',async()=>{
  const f=fixture({updateFailure:true});
  await assert.rejects(applyTaskBulkAction(f.pool,{auth:auth(),ids:[1,2],action:'restaurar'}),/synthetic/);
  assert.deepEqual(f.events.slice(-2),['ROLLBACK','release']);
  for(const ids of [[],[1,1],[0],[NaN],Array.from({length:251},(_,i)=>i+1)]) {
    const invalid=fixture();
    await assert.rejects(applyTaskBulkAction(invalid.pool,{auth:auth(),ids,action:'papelera'}),error=>error.status===400);
    assert.deepEqual(invalid.events,[]);
  }
});
