import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMoodboardCategoriesRouter, normalizeMoodboardCategoryChanges, readMoodboardCategorySnapshot, applyMoodboardCategoryChanges } from '../src/moodboard-categories.js';

const key='11111111-2222-4333-8444-555555555555';
const actor=()=>({id:7,session_version:3,rol:'custom-role'});
const body=(changes=[{type:'rename',id:1,name:'New name'}],extra={})=>({request_id:key,expected_revision:5,changes,...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
// Transaction double only; SQL constraints/concurrency remain physical QA gates.
function fixture({current={...actor(),activo:true},failAt,rollbackFails=false,leaseGate,commitGate,temporaryCollisions=0}={}){
  const calls=[],failure=Object.assign(Error('synthetic failure'),typeof failAt==='object'?failAt:{}),rollbackError=Error('rollback failed');
  let state={revision:5,categories:[{id:1,nombre:'A',orden:1},{id:2,nombre:'B',orden:2}],receipts:[]},staged,connected=0;
  const db={async query(sql,params=[]){
    const text=sql.replace(/\s+/g,' ').trim();calls.push({sql:text,params:structuredClone(params)});
    if(text.startsWith('BEGIN')){staged=structuredClone(state);return{rows:[]};}
    if(text==='ROLLBACK'){staged=null;if(rollbackFails)throw rollbackError;return{rows:[]};}
    if(text==='COMMIT'){if(commitGate)await commitGate.promise;state=staged;staged=null;return{rows:[]};}
    if((typeof failAt==='string'&&text.startsWith(failAt))||(typeof failAt==='object'&&text.startsWith('UPDATE moodboard_categories')))throw failure;
    if(text.startsWith('SELECT pg_advisory'))return{rows:[]};
    if(text.startsWith('SELECT id,rol,activo,session_version'))return{rows:current?[structuredClone(current)]:[]};
    if(text.startsWith('SELECT id,category_revision'))return{rows:params[0]===9?[{id:9,category_revision:String(staged.revision)}]:[]};
    if(text.startsWith('SELECT board_id,payload_hash,result_revision'))return{rows:staged.receipts.filter(row=>row.actor_user_id===params[0]&&row.request_id===params[1])};
    if(text.startsWith('SELECT id,nombre,orden FROM moodboard_categories'))return{rows:structuredClone(staged.categories).sort((a,b)=>text.includes('ORDER BY id')?a.id-b.id:a.orden-b.orden||a.nombre.localeCompare(b.nombre)||a.id-b.id)};
    if(text.startsWith('SELECT lower(name)')){const normalized=params[0].map(value=>value.toLowerCase());return{rows:normalized.filter((value,index)=>normalized.indexOf(value)!==index).map(normalized=>({normalized}))};}
    if(text.startsWith('SELECT EXISTS(SELECT 1 FROM unnest'))return{rows:[{collision:temporaryCollisions-->0||params[0].some(value=>value.toLowerCase()===params[1].toLowerCase())}]};
    if(text.startsWith('DELETE FROM moodboard_categories')){staged.categories=staged.categories.filter(row=>row.id!==params[0]);staged.revision++;return{rows:[],rowCount:1};}
    if(text.startsWith('UPDATE moodboard_categories')){
      if(staged.categories.some(row=>row.id!==params[1]&&row.nombre.toLowerCase()===params[0].toLowerCase()))throw Object.assign(Error('duplicate'),{code:'23505'});
      staged.categories.find(row=>row.id===params[1]).nombre=params[0];staged.revision++;return{rows:[],rowCount:1};
    }
    if(text.startsWith('INSERT INTO moodboard_categories(')){
      if(staged.categories.some(row=>row.nombre.toLowerCase()===params[1].toLowerCase()))throw Object.assign(Error('duplicate'),{code:'23505'});
      staged.categories.push({id:Math.max(0,...staged.categories.map(row=>row.id))+1,nombre:params[1],orden:Math.max(0,...staged.categories.map(row=>row.orden))+1});staged.revision++;return{rows:[],rowCount:1};
    }
    if(text.startsWith('INSERT INTO moodboard_category_operations')){staged.receipts.push({actor_user_id:params[0],request_id:params[1],board_id:params[2],payload_hash:params[3],result_revision:String(params[4])});return{rows:[]};}
    throw Error('Unexpected SQL '+text);
  },release(error){calls.push({sql:'RELEASE',error});}};
  const pool={async connect(){connected++;if(leaseGate)await leaseGate.promise;return db;},query(){throw Error('escaped lease');}};
  return{pool,calls,failure,rollbackError,get state(){return state;},get connected(){return connected;},setCurrent(value){current=value;}};
}

test('closed normalization validates UUID/revision/100 changes, unique IDs and Unicode names without mutating input',()=>{
  const input=body([{type:'rename',id:1,name:'  😀'.trim()+'😀'.repeat(199)},{type:'create',name:' New '}]),before=structuredClone(input);
  const value=normalizeMoodboardCategoryChanges(input);assert.equal(value.changes[1].name,'New');assert.deepEqual(input,before);assert.ok(Object.isFrozen(value.changes));
  for(const input of [body([]),body(Array.from({length:101},()=>({type:'create',name:'x'}))),body([{type:'delete',id:1},{type:'rename',id:1,name:'x'}]),body([{type:'delete',id:'1'}]),body([{type:'create',name:'x',id:1}]),body([{type:'create',name:'😀'.repeat(201)}]),body([{type:'create',name:'\n'}]),body(undefined,{request_id:key+'\n'}),body(undefined,{expected_revision:-1}),body(undefined,{expected_revision:'5'}),{...body(),unknown:1}])assert.throws(()=>normalizeMoodboardCategoryChanges(input),error=>error.status===400);
});

test('invalid ID/query/actor/body fails before lease; custom roles remain accepted',async()=>{
  const f=fixture();
  for(const id of ['0','09','9\n','2147483648',9])await assert.rejects(readMoodboardCategorySnapshot(f.pool,actor(),id),error=>error.status===400);
  await assert.rejects(readMoodboardCategorySnapshot(f.pool,actor(),'9',{x:'y'}),error=>error.status===400);
  await assert.rejects(applyMoodboardCategoryChanges(f.pool,actor(),'9',{...body(),expected_revision:null}),error=>error.status===400);
  await assert.rejects(readMoodboardCategorySnapshot(f.pool,{...actor(),id:'7'},'9'),error=>error.status===401);
  assert.equal(f.connected,0);
  const result=await readMoodboardCategorySnapshot(f.pool,actor(),'9');assert.deepEqual(result,{version:1,board_id:9,revision:5,categories:f.state.categories});
  assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(f.calls.some(call=>/FOR (UPDATE|SHARE|NO KEY)/.test(call.sql)),false);
});

test('write order is explicit READ COMMITTED, account mutex, actor SHARE, board NO KEY UPDATE, sorted categories',async()=>{
  const f=fixture(),result=await applyMoodboardCategoryChanges(f.pool,actor(),'9',body([{type:'rename',id:1,name:'Renamed'},{type:'create',name:'Created'}]));
  const sql=f.calls.map(call=>call.sql);
  assert.deepEqual(sql.slice(0,4),['BEGIN ISOLATION LEVEL READ COMMITTED','SELECT pg_advisory_xact_lock(20261019,1)','SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE','SELECT id,category_revision FROM moodboard_boards WHERE id=$1 FOR NO KEY UPDATE']);
  assert.ok(sql.findIndex(value=>value.endsWith('ORDER BY id FOR UPDATE'))>3);
  assert.equal(result.operation.replayed,false);assert.equal(result.operation.result_revision,result.revision);assert.equal(result.revision,8);
  assert.deepEqual(result.categories.map(row=>row.nombre),['Renamed','B','Created']);assert.doesNotMatch(JSON.stringify(result),/__render_category_|payload_hash|actor_user_id/);
  assert.equal(f.state.receipts.length,1);assert.match(f.state.receipts[0].payload_hash,/^[0-9a-f]{64}$/);assert.deepEqual(sql.slice(-2),['COMMIT','RELEASE']);
});

test('valid final inventory allows rename before deletion in submitted order and atomic A/B swaps',async()=>{
  const deleted=fixture();const one=await applyMoodboardCategoryChanges(deleted.pool,actor(),'9',body([{type:'rename',id:1,name:'B'},{type:'delete',id:2}]));
  assert.deepEqual(one.categories,[{id:1,nombre:'B',orden:1}]);
  assert.ok(deleted.calls.findIndex(call=>call.sql.startsWith('DELETE FROM'))<deleted.calls.findIndex(call=>call.sql.startsWith('UPDATE moodboard_categories')));
  const swapped=fixture({temporaryCollisions:1}),two=await applyMoodboardCategoryChanges(swapped.pool,actor(),'9',body([{type:'rename',id:1,name:'B'},{type:'rename',id:2,name:'A'}]));
  assert.deepEqual(two.categories.map(row=>row.nombre),['B','A']);
  assert.equal(swapped.calls.filter(call=>call.sql.startsWith('SELECT EXISTS(SELECT 1 FROM unnest')).length,3);
  const duplicateCheck=swapped.calls.find(call=>call.sql.startsWith('SELECT lower(name)'));assert.deepEqual(duplicateCheck.params,[['B','A']]);
});

test('duplicate final names and foreign category IDs409 before category DML, preserving every row/revision',async()=>{
  for(const changes of [[{type:'rename',id:1,name:'b'}],[{type:'create',name:'a'}],[{type:'delete',id:999}]]){
    const f=fixture(),before=structuredClone(f.state);await assert.rejects(applyMoodboardCategoryChanges(f.pool,actor(),'9',body(changes)),error=>error.status===409);
    assert.deepEqual(f.state,before);assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);assert.equal(f.calls.at(-2).sql,'ROLLBACK');
  }
});

test('exact receipt replay returns CURRENT inventory with original result revision and zero repeated DML; mismatched key409',async()=>{
  const f=fixture(),input=body();const first=await applyMoodboardCategoryChanges(f.pool,actor(),'9',input);
  f.state.categories.push({id:99,nombre:'Peer category',orden:99});f.state.revision++;
  const index=f.calls.length,result=await applyMoodboardCategoryChanges(f.pool,actor(),'9',input);
  assert.equal(result.operation.replayed,true);assert.equal(result.operation.result_revision,first.revision);assert.equal(result.revision,first.revision+1);assert.equal(result.categories.at(-1).id,99);
  assert.equal(f.calls.slice(index).some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
  await assert.rejects(applyMoodboardCategoryChanges(f.pool,actor(),'9',body([{type:'create',name:'Different'}])),error=>error.status===409&&error.code==='MOODBOARD_CATEGORY_REPLAY_MISMATCH');
});

test('stale revision rejects without rebase; original actor/epoch/role/body are immutable across lease wait',async()=>{
  const stale=fixture();await assert.rejects(applyMoodboardCategoryChanges(stale.pool,actor(),'9',body(undefined,{expected_revision:4})),error=>error.status===409);
  assert.equal(stale.calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
  const leaseGate=deferred(),f=fixture({leaseGate}),held=actor(),input=body();
  const pending=applyMoodboardCategoryChanges(f.pool,held,'9',input);held.id=8;held.rol='admin';held.session_version=4;input.changes[0].name='Late change';
  leaseGate.resolve();const result=await pending;
  assert.equal(result.categories[0].nombre,'New name');assert.deepEqual(f.calls.find(call=>call.sql.includes('FROM usuarios WHERE')).params,[7]);assert.equal(f.state.receipts[0].actor_user_id,7);
});

test('revoked/disabled/changed role/wrong actor cannot read or replay receipts',async()=>{
  for(const current of [null,{...actor(),activo:false},{...actor(),activo:true,session_version:4},{...actor(),activo:true,rol:'admin'},{...actor(),activo:true,id:8}])for(const write of [false,true]){
    const f=fixture({current});await assert.rejects(write?applyMoodboardCategoryChanges(f.pool,actor(),'9',body()):readMoodboardCategorySnapshot(f.pool,actor(),'9'),error=>error.status===401);
    assert.equal(f.calls.some(call=>call.sql.includes('FROM moodboard_boards')||/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
    assert.equal(f.calls.at(-2).sql,'ROLLBACK');
  }
});

test('constraint/deadlock/serialization faults rollback whole batch409, no automatic retry or partial receipt',async()=>{
  for(const code of ['23505','40P01','40001']){
    const f=fixture({failAt:{code}}),before=structuredClone(f.state);
    await assert.rejects(applyMoodboardCategoryChanges(f.pool,actor(),'9',body([{type:'delete',id:2},{type:'rename',id:1,name:'Final'}])),error=>error.status===409);
    assert.deepEqual(f.state,before);assert.equal(f.connected,1);assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT INTO moodboard_category_operations')),false);
  }
});

test('no ACK before commit, failed receipt/rollback discards client and never masks original fault',async()=>{
  const commitGate=deferred(),f=fixture({commitGate});let settled=false;
  const pending=applyMoodboardCategoryChanges(f.pool,actor(),'9',body()).then(value=>{settled=true;return value;});
  for(let i=0;i<100;i++)await Promise.resolve();assert.equal(f.calls.at(-1).sql,'COMMIT');assert.equal(settled,false);
  commitGate.resolve();await pending;
  const failed=fixture({failAt:'INSERT INTO moodboard_category_operations',rollbackFails:true});
  await assert.rejects(applyMoodboardCategoryChanges(failed.pool,actor(),'9',body()),error=>error===failed.failure);
  assert.equal(failed.calls.at(-1).error,failed.rollbackError);assert.equal(failed.state.receipts.length,0);
});

test('router exact paths/no-store and201first/200replay/status errors use actual service',async()=>{
  const f=fixture(),router=createMoodboardCategoriesRouter({pool:f.pool});
  const res=()=>({statusCode:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}});
  for(const [method,path,expected] of [['get','/boards/:id/category-snapshot',200],['post','/boards/:id/category-changes',201],['post','/boards/:id/category-changes',200]]){
    const response=res(),req={auth:actor(),params:{id:'9'},query:{},body:body()};router.stack[0].handle(req,response,()=>{});
    const route=router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]);assert.ok(route);
    await route.route.stack[0].handle(req,response,error=>{throw error;});assert.equal(response.statusCode,expected);assert.equal(response.headers['Cache-Control'],'no-store');
  }
  const response=res(),handler=router.stack.find(layer=>layer.route?.methods.post).route.stack[0].handle;
  await handler({auth:actor(),params:{id:'9'},query:{},body:{...body(),changes:[]}},response,error=>{throw error;});assert.equal(response.statusCode,400);
});

test('084 is additive, immutable receipt, indexed restrictive FKs and category trigger preserves reference SET NULL contract',()=>{
  const sql=readFileSync(new URL('../migrations/084_moodboard_category_operations.sql',import.meta.url),'utf8');
  assert.match(sql,/ADD COLUMN category_revision BIGINT NOT NULL DEFAULT 0/);
  assert.match(sql,/payload_hash TEXT NOT NULL/);assert.match(sql,/PRIMARY KEY \(actor_user_id,request_id\)/);
  assert.match(sql,/board_id INTEGER NOT NULL REFERENCES moodboard_boards\(id\) ON DELETE RESTRICT/);
  assert.match(sql,/actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON moodboard_category_operations/);
  assert.match(sql,/AFTER INSERT OR UPDATE OR DELETE ON moodboard_categories/);
  assert.match(sql,/category_revision=category_revision\+1/);assert.match(sql,/ORDER BY id FOR NO KEY UPDATE/);
  assert.doesNotMatch(sql,/UPDATE moodboard_categories|DELETE FROM|INSERT INTO moodboard_|ALTER TABLE moodboard_references|DROP|GRANT|ROW LEVEL SECURITY/i);
});
