import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
let callback;
function walk(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='onBatchSaved')callback=node.initializer;
  ts.forEachChild(node,walk);
}
walk(tree);
assert.ok(callback,'actual onBatchSaved callback exists');
const id='11111111-1111-4111-8111-111111111111';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(){
  const held=deferred(),notices=[],calls=[];
  // Keep red delegation assertions free of unrelated unhandled rejections.
  held.promise.catch(()=>{});
  let current=true;
  const guard={assertCurrent(){if(!current)throw Object.assign(Error('obsolete session'),{code:'session_binding_obsolete'});},current:()=>current,
    request:()=>assert.fail('batch must delegate its read to refreshVisit')};
  const deps={readEpoch:{current:0},openVersion:{current:0},refreshVersion:{current:0},
    refreshVisit:(...args)=>{++deps.refreshVersion.current;calls.push(args);return held.promise;},setNotice:value=>notices.push(value),
    setSelected:()=>assert.fail('batch must not publish selected independently'),
    setVisits:()=>assert.fail('batch must not publish collection independently')};
  const saved=Function(...Object.keys(deps),`return (${callback.getText(tree)});`)(...Object.values(deps));
  return{held,notices,calls,guard,saved,deps,retire(){current=false;}};
}
const consulting='Revisión guardada. Consultando la visita actual…';
const success='Revisión guardada. Se muestra la visita actual.';
const warning='Revisión guardada; no pudimos actualizar la visita. Volvé a consultarla, sin repetir la revisión.';

test('actual batch callback delegates one no-store read with the original guard, then acknowledges current success',async()=>{
  const f=fixture(),pending=f.saved({visita_id:id},f.guard);
  assert.deepEqual(f.calls,[[id,f.guard,{cache:'no-store'}]]);
  assert.deepEqual(f.notices,[consulting]);
  f.held.resolve({id,revision:3});await pending;
  assert.deepEqual(f.notices,[consulting,success]);assert.equal(f.calls.length,1);
});
test('current read failure retains the saved warning without repeating the batch',async()=>{
  const f=fixture(),pending=f.saved({visita_id:id},f.guard);
  f.held.reject(Error('offline'));await pending;
  assert.deepEqual(f.calls,[[id,f.guard,{cache:'no-store'}]]);
  assert.deepEqual(f.notices,[consulting,warning]);
});
test('superseded shared-arbiter failure publishes no warning or success',async()=>{
  const f=fixture(),pending=f.saved({visita_id:id},f.guard);
  assert.deepEqual(f.calls,[[id,f.guard,{cache:'no-store'}]]);
  f.notices.push('newer observation');
  f.held.reject(Object.assign(Error('old read'),{code:'production_read_obsolete'}));await pending;
  assert.deepEqual(f.notices,[consulting,'newer observation']);
});
test('retired guard suppresses a late read failure',async()=>{
  const f=fixture(),pending=f.saved({visita_id:id},f.guard);
  assert.equal(f.calls.length,1);f.retire();
  f.held.reject(Error('offline'));await pending;
  assert.deepEqual(f.notices,[consulting]);
});
test('retired guard cannot acknowledge a late successful read',async()=>{
  const f=fixture(),pending=f.saved({visita_id:id},f.guard);
  assert.equal(f.calls.length,1);f.retire();
  f.held.resolve({id,revision:3});await pending;
  assert.deepEqual(f.notices,[consulting]);
});
test('already obsolete batch callback cannot dispatch or repaint',async()=>{
  const f=fixture();f.retire();
  await assert.rejects(f.saved({visita_id:id},f.guard),{code:'session_binding_obsolete'});
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,[]);
});
for(const boundary of ['readEpoch','openVersion','refreshVersion']){
  for(const outcome of ['success','failure'])test(`batch ${outcome} after ${boundary} changes cannot replace a newer notice`,async()=>{
    const f=fixture(),pending=f.saved({visita_id:id},f.guard);
    assert.deepEqual(f.calls,[[id,f.guard,{cache:'no-store'}]]);
    ++f.deps[boundary].current;f.notices.push('newer observation');
    if(outcome==='success')f.held.resolve({id,revision:3});else f.held.reject(Error('offline'));
    await pending;assert.deepEqual(f.notices,[consulting,'newer observation']);
  });
}
