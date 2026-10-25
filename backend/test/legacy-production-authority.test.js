import test from 'node:test';
import assert from 'node:assert/strict';
import {captureLegacyProductionActor,retainLegacyProductionActor,retainIntegrationProductionLeader,
  assertLegacyProductionTaskAccess} from '../src/legacy-production-authority.js';

test('browser capture is immutable and current identity is retained before reading its label',async()=>{
  const auth={id:7,rol:'admin',session_version:2,nombre:'Untrusted label'},captured=captureLegacyProductionActor(auth);
  auth.id=8;auth.rol='edicion';assert.deepEqual(captured,{id:7,rol:'admin',session_version:2});assert.ok(Object.isFrozen(captured));
  const calls=[];
  const db={async query(sql,params){calls.push([sql,params]);return{rows:sql.includes('FOR SHARE')
    ?[{id:7,rol:'admin',session_version:2,activo:true}]:[{nombre:'Verified name',usuario:'verified'}]};}};
  const actor=await retainLegacyProductionActor(db,captured,{leader:true});
  assert.equal(actor.nombre,'Verified name');assert.ok(Object.isFrozen(actor));assert.match(calls[0][0],/FOR SHARE/);
  assert.deepEqual(calls[0][1],[7]);
});
test('browser authority rejects stale epoch and non-admin confirmation without reading labels',async()=>{
  for(const stale of [true,false]) {
    let count=0;
    const db={async query(){count++;return{rows:[{id:7,rol:'edicion',session_version:stale?3:2,activo:true}]};}};
    await assert.rejects(retainLegacyProductionActor(db,{id:7,rol:'edicion',session_version:2},{leader:true}),e=>e.status===(stale?401:403));
    assert.equal(count,1);
  }
});
test('borrowed integration confirmation requires a mapped active database admin, never a display name',async()=>{
  for(const id of [null,0,'7',2147483648]) await assert.rejects(
    retainIntegrationProductionLeader({query:()=>assert.fail('Invalid identity must not query')},id),e=>e.status===403);
  for(const row of [null,{id:7,rol:'admin',activo:false},{id:7,rol:'edicion',activo:true}]) await assert.rejects(
    retainIntegrationProductionLeader({async query(sql,params){assert.match(sql,/FOR SHARE/);assert.deepEqual(params,[7]);return{rows:row?[row]:[]};}},7),e=>e.status===403);
  const actor=await retainIntegrationProductionLeader({query:async()=>({rows:[{id:7,rol:'admin',activo:true,nombre:'Verified'}]})},7);
  assert.equal(actor.nombre,'Verified');assert.ok(Object.isFrozen(actor));
});
test('fresh task ACL uses stable ID for members, admin bypass only after retained authority and fails closed',async()=>{
  for(const rol of ['admin','produccion']) {
    const db={async query(sql,params){assert.match(sql,/workspace.*render_os/);assert.deepEqual(params,rol==='admin'?[9]:[9,7]);
      assert.equal(sql.includes('tarea_asignaciones'),rol!=='admin');return{rows:[{id:9}]};}};
    await assertLegacyProductionTaskAccess(db,{id:7,rol},9);
  }
  await assert.rejects(assertLegacyProductionTaskAccess({query:async()=>({rows:[]})},{id:7,rol:'produccion'},9),e=>e.status===404);
});
