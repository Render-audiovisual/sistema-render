import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {captureReleaseSnapshot,compareReleaseSnapshot,validateReleaseSnapshot} from '../src/release-preservation-snapshot.js';
const hash='a'.repeat(64),security='b'.repeat(64);
const ctx={read_only:'on',isolation:'repeatable read',snapshot:'10:11:',database:'fixture',username:'fixture',address:'127.0.0.1',port:55995};
function fake({context=ctx,data=hash,rows='2',changedContext=false,filtered=false,sqlError=false}={}){
  const calls=[];let contexts=0;
  return {calls,async query(sql){calls.push(sql);if(sqlError)throw Error('password:SECRET raw financial row');
    if(sql.includes("transaction_read_only"))return{rows:[{...context,...(changedContext&&contexts++?{snapshot:'changed'}:{})}]};
    if(sql.includes('set_config'))return{rows:[]};
    if(sql.includes('row_security_active'))return{rows:[{name:'tareas',oid:'10',filtered}]};
    if(sql.includes('format_type'))return{rows:[{name:'id',type:'integer',notNull:true}]};
    if(sql.includes('AS rows'))return{rows:[{rows,hash:data}]};
    if(sql.includes("'owner'"))return{rows:[{hash:security}]};
    throw Error('Unexpected fake SQL');
  }};
}
test('snapshot is closed metadata/hash only, stable across transactions and SELECT-only',async()=>{
  const db=fake(),snapshot=await captureReleaseSnapshot(db);
  assert.equal(snapshot.version,1);assert.equal(snapshot.tables[0].rows,'2');assert.equal(snapshot.tables[0].dataSha256,hash);
  assert.deepEqual(validateReleaseSnapshot(snapshot),snapshot);assert.doesNotMatch(JSON.stringify(snapshot),/SECRET|password/);
  assert.ok(db.calls.every(sql=>sql.trim().startsWith('SELECT ')));
  assert.deepEqual(await captureReleaseSnapshot(fake()),snapshot);
  assert.equal((await compareReleaseSnapshot(fake(),snapshot)).matches,true);
});
test('new IDs even without count change invalidate the snapshot, as do new row counts',async()=>{
  const reference=await captureReleaseSnapshot(fake());
  for(const options of [{data:'c'.repeat(64)},{data:'c'.repeat(64),rows:'3'}]){
    const difference=await compareReleaseSnapshot(fake(options),reference);
    assert.equal(difference.matches,false);assert.deepEqual(difference.changedTables,['tareas']);
  }
});
test('read-write, non-repeatable, changing snapshots and filtered RLS cannot certify data',async()=>{
  for(const options of [{context:{...ctx,read_only:'off'}},{context:{...ctx,isolation:'read committed'}},
    {changedContext:true},{filtered:true},{sqlError:true}]){
    await assert.rejects(captureReleaseSnapshot(fake(options)),e=>!e.message.includes('SECRET')&&!e.message.includes('password'));
  }
});
test('malformed or tampered baseline fails before any SQL',async()=>{
  const source=await captureReleaseSnapshot(fake());
  for(const change of [{...source,extra:true},{...source,sha256:'f'.repeat(64)},
    {...source,tables:[{...source.tables[0],rows:'3'}]}]){
    const db=fake();await assert.rejects(compareReleaseSnapshot(db,change));assert.equal(db.calls.length,0);
  }
  const empty={version:1,identity:source.identity,tables:[]};
  assert.throws(()=>validateReleaseSnapshot({...empty,sha256:createHash('sha256').update(JSON.stringify(empty)).digest('hex')}));
});
