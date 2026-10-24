import test from 'node:test';
import assert from 'node:assert/strict';
import { withPersonalListWrite } from '../src/personal-list-write-authority.js';

const auth = () => ({ id: 7, rol: 'edicion', session_version: 3 });
const row = extra => ({ ...auth(), activo: true, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture({ actor = row(), query, connect } = {}) {
  const calls=[], releases=[];
  const db={ async query(sql, params) {
    calls.push({sql,params});
    if (query) { const result=await query(sql,params); if (result !== undefined) return result; }
    return {rows: sql.startsWith('SELECT id,rol,activo') ? (actor ? [actor] : []) : []};
  }, release(error) { releases.push(error); } };
  let leases=0;
  return {db,calls,releases,get leases(){return leases;},pool:{async connect(){leases++;await connect?.();return db;}}};
}
const ACTOR_SQL='SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR UPDATE';

test('exclusive current actor precedes every callback/domain statement and commit precedes return', async()=>{
  const f=fixture(),result={status:201,body:{id:'9007199254740993'}}, input={titulo:'Lista',ids:['9007199254740993']};
  const saved=await withPersonalListWrite(f.pool,auth(),input,async(db,captured,observed)=>{
    assert.equal(db,f.db);assert.deepEqual(observed,auth());assert.deepEqual(captured,input);
    assert.notEqual(captured,input);assert.notEqual(captured.ids,input.ids);
    assert.equal(Object.isFrozen(observed),true);assert.equal(Object.isFrozen(captured.ids),true);
    await db.query('UPDATE synthetic_domain SET posicion=$1',[1]);return result;
  });
  assert.equal(saved,result);assert.deepEqual(f.calls.map(c=>c.sql),['BEGIN ISOLATION LEVEL READ COMMITTED',ACTOR_SQL,'UPDATE synthetic_domain SET posicion=$1','COMMIT']);
  assert.deepEqual(f.calls[1].params,[7]);assert.deepEqual(f.releases,[undefined]);
});
test('identity and nested normalized input are synchronously captured before pool acquisition mutates caller objects',async()=>{
  const a=auth(), input={parent_id:'9223372036854775807',ids:['9007199254740993'],contenido:{items:[{texto:'Original',completado:false}]}};
  const f=fixture({connect(){a.id=8;a.rol='admin';a.session_version=4;input.parent_id='1';input.ids[0]='2';input.contenido.items[0].texto='Changed';}});
  await withPersonalListWrite(f.pool,a,input,async(_db,captured,observed)=>{
    assert.deepEqual(observed,auth());assert.equal(captured.parent_id,'9223372036854775807');assert.deepEqual(captured.ids,['9007199254740993']);
    assert.equal(captured.contenido.items[0].texto,'Original');
    assert.throws(()=>{captured.contenido.items[0].texto='Mutation';},TypeError);
    assert.throws(()=>{observed.rol='admin';},TypeError);
  });
  assert.deepEqual(f.calls[1].params,[7]);
});
test('invalid ID/epoch/empty role rejects401 before connection without coercion',async()=>{
  const invalid=[undefined,null,{},...['id','session_version'].flatMap(key=>[0,-1,'7',true,null,1.5,2147483648,NaN,Infinity].map(value=>({...auth(),[key]:value}))),
    ...['',' ',null,7,[]].map(rol=>({...auth(),rol}))];
  for(const a of invalid){const f=fixture();await assert.rejects(withPersonalListWrite(f.pool,a,{},()=>assert.fail('No callback')),{status:401});assert.equal(f.leases,0);}
});
test('role is exact observed authority, not a whitelist or a trimmed grant',async()=>{
  for(const rol of ['custom-staff',' admin ']){const f=fixture({actor:row({rol})});assert.equal(await withPersonalListWrite(f.pool,{...auth(),rol},null,(_db,input)=>input),null);}
  const f=fixture({actor:row({rol:'admin'})});await assert.rejects(withPersonalListWrite(f.pool,{...auth(),rol:' admin '},{},()=>assert.fail()),{status:401});
});
test('missing/inactive/wrong ID/current role or epoch rejects before domain work and rolls back',async()=>{
  for(const actor of [null,row({activo:false}),row({activo:'true'}),row({id:8}),row({id:'7'}),row({session_version:4}),row({session_version:'3'}),row({rol:'admin'})]){
    const f=fixture({actor});await assert.rejects(withPersonalListWrite(f.pool,auth(),{},()=>assert.fail('No domain callback')),{status:401});
    assert.deepEqual(f.calls.map(c=>c.sql),['BEGIN ISOLATION LEVEL READ COMMITTED',ACTOR_SQL,'ROLLBACK']);assert.deepEqual(f.releases,[undefined]);
  }
});
test('waiting actor lookup observes prior revocation and denies, rather than running with middleware authority',async()=>{
  for(const revoked of [row({session_version:4}),row({rol:'admin'}),row({activo:false})]){
    const entered=deferred(),barrier=deferred();const f=fixture({query:async sql=>{if(sql===ACTOR_SQL){entered.resolve();return barrier.promise;}}});
    const pending=withPersonalListWrite(f.pool,auth(),{},()=>assert.fail('Revoked before lock'));await entered.promise;
    barrier.resolve({rows:[revoked]});await assert.rejects(pending,{status:401});assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
});
test('authority is not re-read after its retained actor lock: admitted write commits, next operation denies',async()=>{
  let current=row();const domain=deferred(),commit=deferred();
  const f=fixture({query:async sql=>{if(sql===ACTOR_SQL)return{rows:[{...current}]};if(sql==='COMMIT')return commit.promise;}});
  const pending=withPersonalListWrite(f.pool,auth(),{},async db=>{domain.resolve();await db.query('UPDATE synthetic_domain SET value=1');return 'saved';});
  await domain.promise;
  // Mock future visibility only. Real PostgreSQL must queue the revoker behind
  // FOR UPDATE; this test does not claim to simulate row-lock scheduling.
  current=row({session_version:4});commit.resolve({rows:[]});assert.equal(await pending,'saved');
  assert.equal(f.calls.filter(c=>c.sql===ACTOR_SQL).length,1);
  await assert.rejects(withPersonalListWrite(f.pool,auth(),{},()=>assert.fail('Next request revoked')),{status:401});
});
test('callback result is never exposed while COMMIT is pending; undefined results also supported',async()=>{
  const entered=deferred(),held=deferred();let returned=false;
  const f=fixture({query:async sql=>{if(sql==='COMMIT'){entered.resolve();return held.promise;}}});
  const pending=withPersonalListWrite(f.pool,auth(),{},()=>undefined).then(value=>{returned=true;return value;});
  await entered.promise;assert.equal(returned,false);assert.equal(f.releases.length,0);
  held.resolve({rows:[]});assert.equal(await pending,undefined);assert.equal(returned,true);assert.equal(f.releases.length,1);
});
test('callback, actor query, BEGIN and COMMIT failures preserve original error, rollback and release',async()=>{
  for(const point of ['callback','actor','begin','commit']){
    const fault=new Error('synthetic failure');
    const f=fixture({query:sql=>{if((point==='actor'&&sql===ACTOR_SQL)||(point==='begin'&&sql.startsWith('BEGIN'))||(point==='commit'&&sql==='COMMIT'))throw fault;}});
    await assert.rejects(withPersonalListWrite(f.pool,auth(),{},()=>{if(point==='callback')throw fault;return 'not exposed';}),e=>e===fault);
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.deepEqual(f.releases,[undefined]);
  }
});
test('rollback failure discards client without masking domain error or returning result',async()=>{
  const original=Object.assign(new Error('conflict'),{status:409}),rollback=new Error('rollback failed');
  const f=fixture({query:sql=>{if(sql==='ROLLBACK')throw rollback;}});
  await assert.rejects(withPersonalListWrite(f.pool,auth(),{},async db=>{await db.query('UPDATE synthetic_domain SET value=1');throw original;}),e=>e===original);
  assert.deepEqual(f.releases,[rollback]);assert.ok(!f.calls.some(c=>c.sql==='COMMIT'));
});
test('failed lease has no transaction/cleanup on an unowned connection; uncloneable input fails prelease',async()=>{
  const fault=new Error('lease failed');let leases=0;
  await assert.rejects(withPersonalListWrite({connect(){leases++;throw fault;}},auth(),{},()=>{}),e=>e===fault);assert.equal(leases,1);
  const f=fixture();await assert.rejects(withPersonalListWrite(f.pool,auth(),{callback:()=>{}},()=>{}));assert.equal(f.leases,0);
});
