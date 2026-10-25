import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Executes the actual orchestration callback, not a mounted React/DOM test.
const source=readFileSync(new URL('./ProductionResultRegister.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('ProductionResultRegister.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
let run;
function walk(node) { if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='run')run=node.initializer; ts.forEachChild(node,walk); }
walk(tree); assert.ok(run);
const deferred=()=>{let resolve; const promise=new Promise(yes=>{resolve=yes;}); return {promise,resolve};};
function fixture(saved=async()=>{}) {
  let current=true; const events=[],pending={current:false},active={current:true};
  const scope={assertCurrent(){assert.ok(current,'obsolete scope');}};
  const snapshot={status:'confirmed',busy:false,locked:false};
  const deps={pending,active,visit:{id:'visit-a'},heldScope:{current:scope},model:{current:{snapshot}},
    callbacks:{current:{onSaved:async(id,captured)=>{events.push(['read',id,captured]);await saved();},onState:state=>events.push(['state',state])}},
    setWorking:value=>events.push(['working',value]),setState:value=>events.push(['local-state',value]),setReadbackError:value=>events.push(['error',value])};
  const callback=Function(...Object.keys(deps),`return (${run.getText(tree)});`)(...Object.values(deps));
  return {callback,pending,active,scope,events,snapshot,retire(){current=false;}};
}
test('actual result callback retains synchronous latch through ACK and readback with exact captured scope',async()=>{
  const read=deferred(),f=fixture(()=>read.promise); let writes=0;
  const first=f.callback(async()=>{writes++;return true;});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.pending.current,true);
  await f.callback(async()=>{writes++;return true;}); assert.equal(writes,1);
  assert.deepEqual(f.events.find(row=>row[0]==='read'),['read','visit-a',f.scope]);
  assert.equal(f.events.some(row=>row[0]==='state'),false);
  read.resolve();await first;
  assert.equal(f.pending.current,false);assert.equal(f.events.at(-1)[0],'state');
  assert.ok(f.events.some(row=>row[0]==='working'&&row[1]===false));
});
test('retired scope cannot perform readback and saved-but-unread outcome remains explicit',async()=>{
  const f=fixture();f.retire();await f.callback(async()=>true);
  assert.equal(f.events.some(row=>row[0]==='read'),false);
  assert.ok(f.events.some(row=>row[0]==='error'&&row[1].includes('está registrado')));
});
test('a retired model snapshot replaces stale local writing state after orchestration ends',async()=>{
  const f=fixture();Object.assign(f.snapshot,{status:'blocked',busy:false,locked:true});
  await f.callback(async()=>false);
  assert.deepEqual(f.events.find(row=>row[0]==='local-state'),['local-state',f.snapshot]);
  assert.equal(f.events.find(row=>row[0]==='local-state')[1].status,'blocked');
});
test('unmounted callback does not read or publish a late accepted result',async()=>{
  const ack=deferred(),f=fixture();const pending=f.callback(()=>ack.promise);
  f.active.current=false;const before=f.events.length;ack.resolve(true);await pending;
  assert.equal(f.events.length,before);assert.equal(f.pending.current,false);
});
test('a retained handler after unmount cannot start a new transport or change parent locks',async()=>{
  const f=fixture();f.active.current=false;let dispatched=0;
  await f.callback(async()=>{dispatched++;return true;});
  assert.equal(dispatched,0);assert.deepEqual(f.events,[]);assert.equal(f.pending.current,false);
});
test('uncertain result releases busy orchestration without readback or inventing confirmation',async()=>{
  const f=fixture();await f.callback(async()=>false);
  assert.equal(f.events.some(row=>row[0]==='read'),false);assert.equal(f.pending.current,false);
});
