import test from 'node:test';
import assert from 'node:assert/strict';
import {withProductionReadSnapshot} from '../src/production-read-snapshot.js';

const auth=()=>({id:7,session_version:3,rol:'edicion'});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function fixture({actor={...auth(),activo:true},failureAt,rollbackFails=false,leaseGate,commitGate}={}){
  const calls=[],failure=Error('original read error'),rollbackError=Error('rollback error');let leases=0;
  const db={async query(sql,values=[]){
    sql=sql.replace(/\s+/g,' ').trim();calls.push({sql,values});
    if(sql==='ROLLBACK'&&rollbackFails)throw rollbackError;
    if(sql===failureAt)throw failure;
    if(sql==='COMMIT'&&commitGate)await commitGate.promise;
    if(sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios'))return{rows:actor?[structuredClone(actor)]:[]};
    return{rows:[]};
  },release(error){calls.push({sql:'RELEASE',error});}};
  const pool={async connect(){leases++;if(leaseGate)await leaseGate.promise;return db;},query(){assert.fail('Read escaped leased connection');}};
  return{pool,db,calls,failure,rollbackError,get leases(){return leases;}};
}
const actorQuery='SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1';
const sequence=f=>f.calls.map(call=>call.sql);

test('two callback reads share the leased RR read-only connection and preserve the exact result',async()=>{
  const f=fixture(),expected={videos:[{id:'video'}],fotos:[{id:'photo'}]};
  const result=await withProductionReadSnapshot(f.pool,auth(),async db=>{
    assert.equal(db,f.db);await db.query('SELECT videos');await db.query('SELECT photos');return expected;
  });
  assert.equal(result,expected);assert.equal(f.leases,1);
  assert.deepEqual(sequence(f),['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',actorQuery,'SELECT videos','SELECT photos','COMMIT','RELEASE']);
  assert.deepEqual(f.calls[1].values,[7]);assert.equal(f.calls.at(-1).error,undefined);
});
test('invalid int32 identity or epoch fails before leasing or invoking the callback',async()=>{
  for(const field of ['id','session_version'])for(const value of [undefined,null,0,-1,1.5,'7',NaN,Infinity,2147483648]){
    const f=fixture();await assert.rejects(withProductionReadSnapshot(f.pool,{...auth(),[field]:value},()=>assert.fail('domain read')),{status:401});
    assert.equal(f.leases,0);assert.deepEqual(f.calls,[]);
  }
});
test('maximum positive int32 values are accepted',async()=>{
  const observed={id:2147483647,session_version:2147483647},f=fixture({actor:{...observed,activo:true,rol:'produccion'}});
  assert.equal(await withProductionReadSnapshot(f.pool,observed,()=>42),42);
});
test('captured ID and epoch cannot change while connect waits; role is not an additional read restriction',async()=>{
  const leaseGate=deferred(),f=fixture({leaseGate,actor:{id:7,session_version:3,activo:true,rol:'programacion'}}),observed=auth();
  const pending=withProductionReadSnapshot(f.pool,observed,()=>42);
  observed.id=99;observed.session_version=99;observed.rol='admin';leaseGate.resolve();
  assert.equal(await pending,42);assert.deepEqual(f.calls[1].values,[7]);
});
for(const actor of [null,{id:8,session_version:3,activo:true},{id:7,session_version:4,activo:true},{id:7,session_version:3,activo:false},{id:7,session_version:3,activo:null},{id:'7',session_version:3,activo:true},{id:7,session_version:'3',activo:true}]){
  test(`unverified actor ${JSON.stringify(actor)} rejects before domain reads`,async()=>{
    const f=fixture({actor});await assert.rejects(withProductionReadSnapshot(f.pool,auth(),()=>assert.fail('domain read')),{status:401});
    assert.deepEqual(sequence(f),['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',actorQuery,'ROLLBACK','RELEASE']);
  });
}
test('result does not resolve or release before COMMIT completes',async()=>{
  const commitGate=deferred(),atCommit=deferred(),f=fixture({commitGate});let settled=false;
  const query=f.db.query;f.db.query=async(...args)=>{if(args[0]==='COMMIT')atCommit.resolve();return query(...args);};
  const pending=withProductionReadSnapshot(f.pool,auth(),()=>42).then(value=>{settled=true;return value;});
  await atCommit.promise;assert.equal(settled,false);assert.equal(sequence(f).includes('RELEASE'),false);
  commitGate.resolve();assert.equal(await pending,42);assert.equal(sequence(f).at(-1),'RELEASE');
});
for(const failureAt of ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',actorQuery,'SELECT videos','SELECT photos','COMMIT']){
  test(`failure at ${failureAt} rolls back, releases and preserves the original error`,async()=>{
    const f=fixture({failureAt});await assert.rejects(withProductionReadSnapshot(f.pool,auth(),async db=>{
      await db.query('SELECT videos');await db.query('SELECT photos');return{};
    }),error=>error===f.failure);
    assert.deepEqual(sequence(f).slice(-2),['ROLLBACK','RELEASE']);
    if(failureAt!=='COMMIT')assert.equal(sequence(f).includes('COMMIT'),false);
  });
}
test('synchronous callback failure and failed rollback discard the client without replacing the original error',async()=>{
  const f=fixture({rollbackFails:true}),original=Error('callback sentinel');
  await assert.rejects(withProductionReadSnapshot(f.pool,auth(),()=>{throw original;}),error=>error===original);
  assert.equal(f.calls.at(-1).error,f.rollbackError);assert.equal(sequence(f).includes('COMMIT'),false);
});
test('connect rejection is propagated without attempting rollback or domain reads',async()=>{
  const original=Error('connect sentinel');
  await assert.rejects(withProductionReadSnapshot({connect:async()=>{throw original;},query:()=>assert.fail('pool escape')},auth(),()=>assert.fail('domain read')),error=>error===original);
});
