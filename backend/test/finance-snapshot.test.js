import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFinanceActor, financePeriod, withFinanceSnapshot } from '../src/finance-snapshot.js';

test('financial period is one exact closed field, never coerced or defaulted', () => {
  assert.equal(financePeriod({periodo:'2026-09'}),'2026-09');
  assert.equal(financePeriod({periodo:'2027-01'}),'2027-01');
  for(const query of [null,{}, {periodo:'2026-08'}, {periodo:'0000-01'}, {periodo:'2026-13'}, {periodo:'2026-10\n'},
    {periodo:['2026-10']}, {periodo:{}}, {periodo:202610}, {periodo:'2026-10',rol:'admin'}]) {
    assert.throws(()=>financePeriod(query),{status:400});
  }
});
const fixture = (actor, {rollbackFailure=false}={}) => {
  const calls=[];let released;
  const db={async query(sql,params){calls.push([sql,params]);if(sql==='ROLLBACK'&&rollbackFailure)throw new Error('rollback failed');return{rows:sql.startsWith('SELECT id,rol')?[actor]:[]};},release(reason){released=reason||true;}};
  return{db,calls,pool:{async connect(){return db;}},get released(){return released;}};
};
const auth={id:1,session_version:2};
const administrator={...auth,activo:true,rol:'admin'};
test('captures only stable immutable authority, not labels or cached roles',()=>{
  const input={...auth,rol:'admin',nombre:'private'},captured=captureFinanceActor(input);input.id=7;
  assert.deepEqual(captured,auth);assert.equal(Object.isFrozen(captured),true);
  for(const bad of [null,{id:'1',session_version:2},{id:1,session_version:0}])assert.throws(()=>captureFinanceActor(bad),{status:401});
});
test('all inputs share one RR READ ONLY transaction and callback result follows commit',async()=>{
  const f=fixture(administrator);
  const result=await withFinanceSnapshot(f.pool,auth,async db=>{assert.equal(db,f.db);await db.query('SELECT 1');return{projection:123.45};});
  assert.deepEqual(result,{projection:123.45});
  assert.deepEqual(f.calls.map(([sql])=>sql),['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1','SELECT 1','COMMIT']);
  assert.equal(f.released,true);
});
test('pool wait cannot mutate captured identity or bypass current role/epoch/inactivity',async()=>{
  for(const actor of [undefined,{...administrator,activo:false},{...administrator,session_version:3},{...administrator,id:2},{...administrator,rol:'editor'}]){
    const f=fixture(actor);let read=false;
    const input={...auth};const originalConnect=f.pool.connect;f.pool.connect=async()=>{input.id=2;return originalConnect();};
    await assert.rejects(withFinanceSnapshot(f.pool,input,async()=>{read=true;}),{status:actor?.rol==='editor'?403:401});
    assert.deepEqual(f.calls[1][1],[1]);assert.equal(read,false);assert.equal(f.calls.at(-1)[0],'ROLLBACK');assert.equal(f.released,true);
  }
});
test('callback/commit failure never acknowledges data; failed rollback discards connection',async()=>{
  for(const rollbackFailure of [false,true]){
    const f=fixture(administrator,{rollbackFailure});
    await assert.rejects(withFinanceSnapshot(f.pool,auth,async()=>{throw new Error('read failed');}),/read failed/);
    assert.equal(f.calls.at(-1)[0],'ROLLBACK');assert.equal(f.released instanceof Error,rollbackFailure);
  }
  const f=fixture(administrator),original=f.db.query;f.db.query=async(...args)=>{if(args[0]==='COMMIT')throw new Error('commit failed');return original(...args);};
  await assert.rejects(withFinanceSnapshot(f.pool,auth,async()=>({private:true})),/commit failed/);assert.equal(f.calls.at(-1)[0],'ROLLBACK');
});
