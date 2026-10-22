import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeMoodboardReferenceOperation, applyMoodboardReferenceOperation, readMoodboardReference, readMoodboardReferences } from '../src/moodboard-reference-write.js';

const key='11111111-2222-4333-8444-555555555555',otherKey='22222222-2222-4333-8444-555555555555';
const filename='a'.repeat(64)+'.png';
const auth=()=>({id:7,session_version:3,rol:'custom',nombre:'Cached actor'});
const time='2026-10-21T12:00:00.000001Z';
const ref=patch=>({id:11,board_id:9,category_id:3,titulo:'Original',nota:'Exact original',etiquetas:['one'],estado:'libre',tipo_fuente:'enlace',enlace_externo:'https://example.test/reference',archivo_nombre:null,autor_id:7,autor_nombre:'Original actor',created_at:time,updated_at:time,revision:'0',categoria:'Photos',tareas:[{id:1,titulo:'Visible task'}],...patch});
const create=fields=>({request_id:key,action:'create',board_id:9,fields:{title:'New',note:'New note',category_id:3,tags:['qa'],external_url:'https://example.test/reference',...fields}});
const edit=(fields={title:'Edited'},extra={})=>({request_id:key,action:'edit',board_id:9,reference_id:11,expected_revision:0,fields,...extra});
const del=extra=>({request_id:key,action:'delete',board_id:9,reference_id:11,expected_revision:0,...extra});
const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
const imageIntent=()=>create({image_data:png,external_url:''});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
// Actual service against a transaction/IO double; not a PG/FK or filesystem proof.
function fixture({references=[ref()],current={...auth(),activo:true,nombre:'Current DB actor',usuario:'dbuser'},failAt,rollbackFails=false,commitGate,commitAmbiguous=false,leaseGate,storageCreated=true,storageFailure=false,cleanupFailure=false}={}){
  const calls=[],failure=Error('synthetic failure'),rollbackError=Error('rollback failed');let state={references:structuredClone(references),receipts:[]},staged,leases=0;
  const db={async query(sql,params=[]){
    const compact=sql.replace(/\s+/g,' ').trim();calls.push({sql:compact,params:structuredClone(params)});
    if(compact.startsWith('BEGIN')){staged=structuredClone(state);return{rows:[]};}
    if(compact==='ROLLBACK'){staged=null;if(rollbackFails)throw rollbackError;return{rows:[]};}
    if(failAt&&compact.startsWith(failAt))throw failure;
    if(compact==='COMMIT'){if(commitGate)await commitGate.promise;state=staged;staged=null;if(commitAmbiguous){commitAmbiguous=false;throw failure;}return{rows:[]};}
    if(compact.startsWith('SELECT pg_advisory'))return{rows:[]};
    if(compact.startsWith('SELECT id,rol,activo,session_version'))return{rows:current?[structuredClone(current)]:[]};
    if(compact.includes('FROM moodboard_reference_operations'))return{rows:staged.receipts.filter(row=>row.actor_user_id===params[0]&&row.request_id===params[1])};
    if(compact.startsWith('SELECT id FROM moodboard_boards'))return{rows:params[0]===9?[{id:9}]:[]};
    if(compact.startsWith('SELECT id FROM moodboard_categories'))return{rows:params[0]===3&&params[1]===9?[{id:3}]:[]};
    if(compact.startsWith('SELECT id,board_id,category_id'))return{rows:structuredClone(staged.references.filter(row=>row.id===params[0]))};
    if(compact.startsWith('SELECT id FROM moodboard_references WHERE archivo_nombre'))return{rows:staged.references.filter(row=>row.archivo_nombre===params[0]&&row.id!==params[1]).map(row=>({id:row.id}))};
    if(compact.startsWith('SELECT id FROM moodboard_references'))return{rows:staged.references.filter(row=>row.id===params[0]&&row.board_id===params[1]).map(row=>({id:row.id}))};
    if(compact.startsWith('SELECT r.id,r.board_id')){
      assert.doesNotMatch(compact,/r\.\*/);assert.match(compact,/rt\.reference_id=r\.id/);assert.match(compact,/bc\.board_id=r\.board_id AND bc\.cliente_id=t\.cliente_id/);
      return{rows:structuredClone(staged.references.filter(row=>compact.includes('WHERE r.board_id=$1')?row.board_id===params[0]:row.id===params[0]))};
    }
    if(compact.startsWith('INSERT INTO moodboard_references(')){
      const id=Math.max(10,...staged.references.map(row=>row.id))+1;
      staged.references.push(ref({id,board_id:params[0],category_id:params[1],titulo:params[2],nota:params[3],etiquetas:params[4],tipo_fuente:params[5],enlace_externo:params[6],archivo_nombre:params[7],autor_id:params[8],autor_nombre:params[9]}));return{rows:[{id}],rowCount:1};
    }
    if(compact.startsWith('UPDATE moodboard_references')){
      const row=staged.references.find(row=>row.id===params.at(-1));assert.ok(row);
      for(const field of ['titulo','nota','category_id','etiquetas','estado']){const match=new RegExp(`${field}=\\$(\\d+)`).exec(compact);if(match)row[field]=params[Number(match[1])-1];}
      row.revision=String(Number(row.revision)+1);return{rows:[],rowCount:1};
    }
    if(compact.startsWith('DELETE FROM moodboard_references')){staged.references=staged.references.filter(row=>row.id!==params[0]);return{rows:[],rowCount:1};}
    if(compact.startsWith('INSERT INTO moodboard_reference_operations')){staged.receipts.push({actor_user_id:params[0],request_id:params[1],action:params[2],payload_hash:params[3],board_id:params[4],reference_id:params[5],result_revision:String(params[6])});return{rows:[]};}
    throw Error('Unexpected SQL '+compact);
  },release(error){calls.push({sql:'RELEASE',error});}};
  const storage={async prepare(input){calls.push({sql:'FS_PREPARE',input});if(storageFailure)throw failure;return{filename,created:storageCreated};},async remove(value){calls.push({sql:'FS_REMOVE',filename:value});if(cleanupFailure)throw Error('cleanup failed');}};
  return{calls,storage,failure,rollbackError,get state(){return state;},get leases(){return leases;},pool:{async connect(){leases++;if(leaseGate)await leaseGate.promise;return db;},query(){throw Error('escaped lease');}}};
}

test('closed intent requires key/observed revision, preserves typed fields and rejects malformed URLs/images/limits',()=>{
  assert.throws(()=>normalizeMoodboardReferenceOperation({...edit(),request_id:undefined}),error=>error.status===400);
  const missing={...edit()};delete missing.expected_revision;assert.throws(()=>normalizeMoodboardReferenceOperation(missing),error=>error.status===428);
  const value=normalizeMoodboardReferenceOperation(create({title:' 🌈 ',tags:[' one ','one','two']}));assert.equal(value.fields.title,'🌈');assert.deepEqual(value.fields.tags,['one','two']);
  assert.equal(normalizeMoodboardReferenceOperation(imageIntent()).image.extension,'png');
  assert.equal(normalizeMoodboardReferenceOperation(create({external_url:'https://pin.it/abc'})).fields.source,'pinterest');
  assert.equal(normalizeMoodboardReferenceOperation(create({title:'😀'.repeat(200)})).fields.title.length,400);
  for(const input of [{...create(),extra:1},{...create(),board_id:'9'},{...edit(),expected_revision:'0'},{...edit(),expected_revision:-1},edit({image_data:png}),edit({category_id:'3'}),create({category_id:null}),create({note:''}),create({title:'x'.repeat(201)}),create({note:'x'.repeat(20001)}),create({tags:Array(51).fill('x')}),create({tags:['😀'.repeat(101)]}),create({external_url:'javascript:alert(1)'}),create({external_url:'/relative'}),create({external_url:'https://user:pass@example.test/x'}),create({external_url:'https://example.test/\nx'}),create({image_data:'data:image/png;base64,QQ==',external_url:''}),create({image_data:png.replace('image/png','image/jpeg'),external_url:''}),{...del(),fields:{}},{...create(),request_id:key+'\n'}])assert.throws(()=>normalizeMoodboardReferenceOperation(input),error=>error.status===400);
});

test('shared reader returns closed nullable historical DTO and current task ACL under one RR snapshot',async()=>{
  const f=fixture({references:[ref({titulo:null,category_id:null,categoria:null,autor_id:null,metadata:{salary:999},tareas:[{id:1,titulo:'Visible task',private:1}]})]});
  const result=await readMoodboardReferences(f.pool,auth(),'9');assert.equal(result[0].titulo,null);assert.equal(result[0].revision,0);assert.deepEqual(result[0].tareas,[{id:1,titulo:'Visible task'}]);assert.doesNotMatch(JSON.stringify(result),/metadata|salary|private/);
  assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const read=f.calls.find(call=>call.sql.startsWith('SELECT r.id'));assert.deepEqual(read.params,[9,7]);assert.match(read.sql,/workspace/);assert.match(read.sql,/tarea_asignaciones/);
  assert.equal((await readMoodboardReference(f.pool,auth(),11)).id,11);await assert.rejects(readMoodboardReference(f.pool,auth(),99),error=>error.status===404);
  assert.deepEqual(f.calls.slice(-2).map(call=>call.sql),['ROLLBACK','RELEASE']);
});

test('account mutex→current actor SHARE→receipt→board NO KEY UPDATE→reference UPDATE; edit CAS and no arbitrary role restriction',async()=>{
  const f=fixture(),result=await applyMoodboardReferenceOperation(f.pool,auth(),edit(),{storage:f.storage});
  assert.equal(result.status,200);assert.equal(result.body.reference.titulo,'Edited');assert.equal(result.body.operation.result_revision,1);
  const sql=f.calls.map(call=>call.sql);assert.deepEqual(sql.slice(0,2),['BEGIN ISOLATION LEVEL READ COMMITTED','SELECT pg_advisory_xact_lock(20261019,1)']);assert.match(sql[2],/FROM usuarios WHERE id=\$1 FOR SHARE$/);
  assert.ok(sql.findIndex(value=>value.includes('FROM moodboard_reference_operations'))<sql.findIndex(value=>value.includes('FROM moodboard_boards')));assert.ok(sql.findIndex(value=>value.includes('FROM moodboard_boards'))<sql.findIndex(value=>value.includes('FROM moodboard_references')&&value.endsWith('FOR UPDATE')));
  assert.deepEqual(sql.slice(-2),['COMMIT','RELEASE']);assert.equal(result.body.operation.replayed,false);assert.equal(f.state.receipts.length,1);
});

test('historical foreign-board category survives status/title edit unless category is explicitly changed',async()=>{
  const f=fixture({references:[ref({category_id:99,categoria:null,titulo:null})]});
  const result=await applyMoodboardReferenceOperation(f.pool,auth(),edit({status:'aprobada'}));assert.equal(result.body.reference.category_id,99);assert.equal(result.body.reference.titulo,null);assert.equal(result.body.reference.estado,'aprobada');assert.equal(f.calls.some(call=>call.sql.includes('FROM moodboard_categories')),false);
  const explicit=fixture({references:[ref({category_id:99,categoria:null})]});await assert.rejects(applyMoodboardReferenceOperation(explicit.pool,auth(),edit({category_id:99})),error=>error.status===409);assert.equal(explicit.state.references[0].category_id,99);
  const cleared=fixture({references:[ref({category_id:99,categoria:null})]});assert.equal((await applyMoodboardReferenceOperation(cleared.pool,auth(),edit({category_id:null}))).body.reference.category_id,null);
});

test('category and board validation precede any file/create; stale revision and wrong board never mutate',async()=>{
  for(const input of [imageIntent(),create()]){
    input.fields.category_id=99;const f=fixture();await assert.rejects(applyMoodboardReferenceOperation(f.pool,auth(),input,{storage:f.storage}),error=>error.status===409);assert.equal(f.calls.some(call=>call.sql==='FS_PREPARE'||call.sql.startsWith('INSERT')),false);
  }
  for(const input of [edit(undefined,{expected_revision:1}),edit(undefined,{board_id:10})]){
    const f=fixture();await assert.rejects(applyMoodboardReferenceOperation(f.pool,auth(),input),error=>[404,409].includes(error.status));assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
  }
});

test('first create201 stores DB actor, replay200 current state/links; same key different body conflicts before files/DML',async()=>{
  const f=fixture({references:[]}),input=create(),first=await applyMoodboardReferenceOperation(f.pool,auth(),input,{storage:f.storage});assert.equal(first.status,201);assert.equal(first.body.reference.autor_nombre,'Current DB actor');assert.equal(first.body.operation.result_revision,0);
  f.state.references[0].titulo='Peer updated';f.state.references[0].revision='4';f.state.references[0].tareas=[];
  const index=f.calls.length,replay=await applyMoodboardReferenceOperation(f.pool,auth(),input,{storage:f.storage});assert.equal(replay.body.reference.titulo,'Peer updated');assert.equal(replay.body.reference.revision,4);assert.equal(replay.body.operation.result_revision,0);assert.equal(replay.body.operation.replayed,true);assert.deepEqual(replay.body.reference.tareas,[]);assert.equal(f.calls.slice(index).some(call=>/^(INSERT|UPDATE|DELETE|FS_)/.test(call.sql)),false);
  await assert.rejects(applyMoodboardReferenceOperation(f.pool,auth(),create({title:'Other'}),{storage:f.storage}),error=>error.status===409&&error.code==='MOODBOARD_REFERENCE_REPLAY_MISMATCH');
  assert.equal(f.state.references.length,1);assert.equal(f.state.receipts.length,1);
});

test('confirmed delete returns null and last observed revision; replay never recreates or cleans files again',async()=>{
  const f=fixture({references:[ref({archivo_nombre:filename,tipo_fuente:'imagen',enlace_externo:null,revision:'5'})]}),input=del({expected_revision:5});
  const result=await applyMoodboardReferenceOperation(f.pool,auth(),input,{storage:f.storage});assert.equal(result.body.reference,null);assert.equal(result.body.operation.result_revision,5);assert.equal(f.state.receipts.length,1);
  const commit=f.calls.findIndex(call=>call.sql==='COMMIT'),remove=f.calls.findIndex(call=>call.sql==='FS_REMOVE');assert.ok(remove>commit);
  const index=f.calls.length,replay=await applyMoodboardReferenceOperation(f.pool,auth(),input,{storage:f.storage});assert.equal(replay.body.reference,null);assert.equal(replay.body.operation.replayed,true);assert.equal(f.calls.slice(index).some(call=>/^(INSERT|UPDATE|DELETE|FS_)/.test(call.sql)),false);
});

test('delete cleanup preserves shared historical filename and confirmed result survives cleanup failure',async()=>{
  const shared=fixture({references:[ref({archivo_nombre:filename}),ref({id:12,board_id:10,archivo_nombre:filename})]});await applyMoodboardReferenceOperation(shared.pool,auth(),del(),{storage:shared.storage});assert.equal(shared.calls.some(call=>call.sql==='FS_REMOVE'),false);assert.equal(shared.state.references.length,1);
  const failed=fixture({references:[ref({archivo_nombre:filename})],cleanupFailure:true});assert.equal((await applyMoodboardReferenceOperation(failed.pool,auth(),del(),{storage:failed.storage})).status,200);assert.equal(failed.state.references.length,0);
});

test('own newly created file compensates only after proven rollback with COMMIT never attempted; reused files retained',async()=>{
  for(const storageCreated of [true,false]){
    const f=fixture({references:[],failAt:'INSERT INTO moodboard_reference_operations',storageCreated});await assert.rejects(applyMoodboardReferenceOperation(f.pool,auth(),imageIntent(),{storage:f.storage}),error=>error===f.failure);
    assert.equal(f.state.references.length,0);assert.equal(f.calls.some(call=>call.sql==='FS_REMOVE'),storageCreated);
    if(storageCreated)assert.ok(f.calls.findIndex(call=>call.sql==='FS_REMOVE')>f.calls.findIndex(call=>call.sql==='ROLLBACK'));
  }
  const rollback=fixture({references:[],failAt:'INSERT INTO moodboard_references(',rollbackFails:true});await assert.rejects(applyMoodboardReferenceOperation(rollback.pool,auth(),imageIntent(),{storage:rollback.storage}),error=>error===rollback.failure);assert.equal(rollback.calls.some(call=>call.sql==='FS_REMOVE'),false);assert.equal(rollback.calls.at(-1).error,rollback.rollbackError);
});

test('ambiguous COMMIT retains image and receipt; explicit exact replay creates neither another file nor another reference',async()=>{
  const f=fixture({references:[],commitAmbiguous:true});await assert.rejects(applyMoodboardReferenceOperation(f.pool,auth(),imageIntent(),{storage:f.storage}),error=>error.status===503&&error.code==='MOODBOARD_REFERENCE_COMMIT_UNCERTAIN');assert.equal(f.calls.some(call=>call.sql==='FS_REMOVE'),false);assert.equal(f.state.references.length,1);
  const start=f.calls.length,replay=await applyMoodboardReferenceOperation(f.pool,auth(),imageIntent(),{storage:f.storage});assert.equal(replay.body.operation.replayed,true);assert.equal(replay.body.reference.archivo_nombre,filename);assert.equal(f.calls.slice(start).some(call=>/^(INSERT|UPDATE|DELETE|FS_)/.test(call.sql)),false);
});

test('storage preparation fault cannot insert/ACK; delete ambiguous commit never removes its asset',async()=>{
  const f=fixture({references:[],storageFailure:true});await assert.rejects(applyMoodboardReferenceOperation(f.pool,auth(),imageIntent(),{storage:f.storage}),error=>error===f.failure);assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT')||call.sql==='FS_REMOVE'),false);
  const deleted=fixture({references:[ref({archivo_nombre:filename})],commitAmbiguous:true});await assert.rejects(applyMoodboardReferenceOperation(deleted.pool,auth(),del(),{storage:deleted.storage}),error=>error.status===503);assert.equal(deleted.calls.some(call=>call.sql==='FS_REMOVE'),false);
});

test('captured session/body cannot become another actor while lease waits; revoked role/epoch/active denied before receipt/storage',async()=>{
  const leaseGate=deferred(),f=fixture({references:[],leaseGate}),held=auth(),input=create();const pending=applyMoodboardReferenceOperation(f.pool,held,input,{storage:f.storage});held.id=8;held.rol='admin';held.session_version=4;input.fields.note='Late';leaseGate.resolve();const result=await pending;assert.equal(result.body.reference.nota,'New note');assert.equal(result.body.reference.autor_id,7);assert.deepEqual(f.calls[2].params,[7]);
  for(const current of [null,{...auth(),activo:false},{...auth(),activo:true,session_version:4},{...auth(),activo:true,rol:'admin'}]){
    const denied=fixture({current});await assert.rejects(applyMoodboardReferenceOperation(denied.pool,auth(),imageIntent(),{storage:denied.storage}),error=>error.status===401);assert.equal(denied.calls.some(call=>call.sql.includes('FROM moodboard_reference_operations')||call.sql==='FS_PREPARE'),false);
  }
});

test('result waits for COMMIT; query/ID malformed fail before lease and source uses no FS duplication/whole-row DTO',async()=>{
  const f=fixture();await assert.rejects(readMoodboardReference(f.pool,auth(),'011'),error=>error.status===400);await assert.rejects(readMoodboardReferences(f.pool,auth(),9,{x:'y'}),error=>error.status===400);assert.equal(f.leases,0);
  const commitGate=deferred(),pendingFixture=fixture({commitGate});let settled=false;const pending=applyMoodboardReferenceOperation(pendingFixture.pool,auth(),edit()).then(value=>{settled=true;return value;});for(let i=0;i<100;i++)await Promise.resolve();assert.equal(pendingFixture.calls.at(-1).sql,'COMMIT');assert.equal(settled,false);commitGate.resolve();await pending;
  const source=readFileSync(new URL('../src/moodboard-reference-write.js',import.meta.url),'utf8');assert.doesNotMatch(source,/pool\.query|Promise\.all|node:fs|r\.\*/);assert.match(source,/contract:'moodboard-reference-operation-v1'/);
});

test('086 is additive, keeps legacy simpleFK, revision includes all UPDATEs and no tasklink revision invention',()=>{
  const sql=readFileSync(new URL('../migrations/086_moodboard_reference_operations.sql',import.meta.url),'utf8');assert.match(sql,/ADD COLUMN revision BIGINT NOT NULL DEFAULT 0/);assert.match(sql,/NEW\.revision := OLD\.revision\+1/);assert.match(sql,/BEFORE UPDATE ON moodboard_references/);assert.match(sql,/ON DELETE SET NULL \(category_id\) NOT VALID/);assert.match(sql,/PRIMARY KEY\(actor_user_id,request_id\)/);assert.match(sql,/reference_id INTEGER NOT NULL CHECK/);assert.match(sql,/BEFORE UPDATE OR DELETE ON moodboard_reference_operations/);
  assert.doesNotMatch(sql,/DROP CONSTRAINT|REFERENCES moodboard_references|UPDATE moodboard_references SET|DELETE FROM|INSERT INTO|moodboard_reference_tasks/);
});
