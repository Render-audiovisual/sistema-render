import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withFinanceWrite } from '../src/finance-write-authority.js';

const auth={id:1,session_version:2};
const administrator={...auth,activo:true,rol:'admin'};
function fixture(actor=administrator,{rollbackFailure=false}={}){
 const calls=[];let released;
 const db={async query(sql,params){calls.push([sql,params]);if(sql==='ROLLBACK'&&rollbackFailure)throw new Error('rollback failed');return{rows:sql.includes('FROM usuarios')?[actor]:[]};},release(reason){released=reason||true;}};
 return{db,calls,pool:{async connect(){return db;}},get released(){return released;}};
}
test('financial writer takes account mutex before current authority and acknowledges only after commit',async()=>{
 const f=fixture();const result=await withFinanceWrite(f.pool,auth,async db=>{assert.equal(db,f.db);await db.query('SELECT financial_domain');return{verified:true};});
 assert.deepEqual(result,{verified:true});assert.deepEqual(f.calls.map(([sql])=>sql),[
  'BEGIN ISOLATION LEVEL READ COMMITTED','SELECT pg_advisory_xact_lock(20261019, 1)',
  'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE','SELECT financial_domain','COMMIT']);
 assert.deepEqual(f.calls[2][1],[1]);assert.equal(f.released,true);
});
test('financial writer captures immutable ID/epoch before lease and ignores mutable role labels',async()=>{
 const f=fixture(),input={...auth,rol:'admin',nombre:'not authority'},connect=f.pool.connect;
 f.pool.connect=async()=>{input.id=2;input.session_version=7;input.rol='admin';return connect();};
 await withFinanceWrite(f.pool,input,async()=>true);assert.deepEqual(f.calls[2][1],[1]);
});
test('invalid identity fails before acquiring any database lease',async()=>{
 for(const actor of [null,{id:'1',session_version:2},{id:1,session_version:0},{id:2147483648,session_version:1}]){
  let leases=0;await assert.rejects(withFinanceWrite({connect(){leases++;throw new Error('must not lease');}},actor,()=>{}),{status:401});assert.equal(leases,0);
 }
});
test('missing, replaced, inactive, epoch-revoked or demoted actor cannot reach financial mutation',async()=>{
 for(const actor of [null,{...administrator,id:3},{...administrator,activo:false},{...administrator,session_version:3},{...administrator,rol:'edicion'}]){
  const f=fixture(actor);let writes=0;
  await assert.rejects(withFinanceWrite(f.pool,{...auth,rol:'admin'},async()=>{writes++;}),{status:actor?.rol==='edicion'?403:401});
  assert.equal(writes,0);assert.equal(f.calls.at(-1)[0],'ROLLBACK');assert.equal(f.released,true);
 }
});
test('domain and commit errors never publish a result; uncertain rollback discards connection without masking original error',async()=>{
 for(const rollbackFailure of [false,true]){
  const f=fixture(administrator,{rollbackFailure});await assert.rejects(withFinanceWrite(f.pool,auth,async()=>{throw new Error('domain failed');}),/domain failed/);
  assert.equal(f.calls.at(-1)[0],'ROLLBACK');assert.equal(f.released instanceof Error,rollbackFailure);
 }
 const f=fixture(),query=f.db.query;
 f.db.query=async(...args)=>{if(args[0]==='COMMIT')throw new Error('commit failed');return query(...args);};
 await assert.rejects(withFinanceWrite(f.pool,auth,async()=>({money:'must not escape'})),/commit failed/);assert.equal(f.calls.at(-1)[0],'ROLLBACK');
});
test('all canonical financial contract routes use current authority, no-store, same-client conflict lookup and no formula changes',()=>{
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const routes=source.slice(source.indexOf('router.get("/contratos"'),source.indexOf('router.get("/sueldos"'));
 assert.equal((routes.match(/withFinanceWrite\(pool, req.auth/g)||[]).length,3);
 assert.match(routes,/withFinanceSnapshot\(pool, req.auth/);assert.doesNotMatch(routes,/pool\.query|contractNotUpdated\(pool/);
 assert.equal((routes.match(/res\.set\('Cache-Control','no-store'\)/g)||[]).length,4);
 assert.equal((routes.match(/contractNotUpdated\(db,id\)/g)||[]).length,2);
 assert.equal((routes.match(/contract_version = \$/g)||[]).length,1);assert.match(routes,/contract_version=\$2/);
 assert.doesNotMatch(routes,/DELETE FROM|cliente_abonos|team_payments|empleado_pagos|calculateSalary/);
});
