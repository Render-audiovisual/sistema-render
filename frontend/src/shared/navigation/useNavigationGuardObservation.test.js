import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const hookSource=readFileSync(new URL('./useNavigationGuard.js',import.meta.url),'utf8');
const hookTree=ts.createSourceFile('hook.js',hookSource,ts.ScriptTarget.Latest,true);
const hook=hookTree.statements.find(node=>ts.isFunctionDeclaration(node));
function setup(){
  const ref={},records=[];let installed=false,cleanup;
  const use=Function('useRef','useEffect','registerNavigationGuard','window','return ('+hook.getText(hookTree).replace(/^export /,'')+');')(
    ()=>ref,effect=>{if(!installed){installed=true;cleanup=effect();}},(win,getStatus,options)=>{records.push({getStatus,options});return()=>{records.push('removed')}},{},
  );
  return{use,records,read:()=>records[0].options.readObservation(),cleanup:()=>cleanup()};
}

test('actual shared hook keeps observations stable between reads but invalidates each new render',()=>{
  const f=setup(),get=()=>({dirty:true,busy:false});f.use(get);
  const first=f.read();assert.equal(f.read(),first);f.use(get);assert.notEqual(f.read(),first);assert.equal(f.records.length,1);
  assert.deepEqual(f.records[0].getStatus(),{dirty:true,busy:false});f.cleanup();assert.equal(f.records[1],'removed');
});

test('actual shared hook detects ref-only draft changes without a render or a dirty/busy transition',()=>{
  const f=setup();let observation=Symbol('one');f.use(()=>({dirty:true,busy:false}),()=>observation);
  const first=f.read();assert.equal(f.read(),first);observation=Symbol('two');assert.notEqual(f.read(),first);
  const second=f.read();assert.equal(f.read(),second);assert.deepEqual(f.records[0].getStatus(),{dirty:true,busy:false});
});

test('invalid observation readers fail closed without hiding a valid dirty guard',()=>{
  for(const reader of [{},()=>{throw Error('Unobservable draft')}]){
    const f=setup();f.use(()=>({dirty:true,busy:false}),reader);assert.throws(()=>f.read());assert.equal(f.records[0].getStatus().dirty,true);
  }
});

test('actual Moodboard child draft callback advances the explicit token when React busy state remains false',()=>{
  const source=readFileSync(new URL('../../pages/MoodboardPreview.jsx',import.meta.url),'utf8');
  const tree=ts.createSourceFile('MoodboardPreview.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  let callback;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='onOperationBusy')callback=node.initializer;ts.forEachChild(node,visit);}visit(tree);assert.ok(callback);
  const owner=Symbol('draft'),operationOwners={current:new Set()},recoveryOwners={current:new Set([owner])},operationObservation={current:Symbol('before')},busy=[];
  const notify=Function('originCurrent','operationOwners','recoveryOwners','operationObservation','mounted','setOperationBusy','return ('+callback.getText(tree)+');')(
    ()=>true,operationOwners,recoveryOwners,operationObservation,{current:true},value=>busy.push(value));
  const f=setup();f.use(()=>({dirty:recoveryOwners.current.size>0,busy:operationOwners.current.size>0}),()=>operationObservation.current);
  const old=f.read();notify(owner,false,true);assert.notEqual(f.read(),old);assert.deepEqual(busy,[false]);
  assert.deepEqual(f.records[0].getStatus(),{dirty:true,busy:false});
});

test('actual production child and batch callbacks invalidate an already-dirty observation without a parent render',()=>{
  const source=readFileSync(new URL('../../pages/Productions.jsx',import.meta.url),'utf8');
  const tree=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const declarations=new Map();function visit(node){if(ts.isVariableDeclaration(node))declarations.set(node.name.getText(tree),node);ts.forEachChild(node,visit);}visit(tree);
  const dirty={current:new Set(['visit:1'])},productionObservation={current:Symbol('initial')},batchDraft={current:{dirty:true,busy:false}},busy=[];
  const onDirty=Function('dirty','productionObservation','return ('+declarations.get('onDirty').initializer.arguments[0].getText(tree)+');')(dirty,productionObservation);
  const onBatch=Function('batchDraft','setBatchBusy','onDirty','return ('+declarations.get('onBatchDraftStateChange').initializer.arguments[0].getText(tree)+');')(batchDraft,value=>busy.push(value),onDirty);
  const f=setup();f.use(()=>({dirty:dirty.current.size>0,busy:batchDraft.current.busy}),()=>productionObservation.current);
  const before=f.read();onDirty('visit:1',true);assert.notEqual(f.read(),before);assert.equal(dirty.current.size,1);
  const updated=f.read();onBatch({dirty:true,busy:false});assert.notEqual(f.read(),updated);assert.deepEqual(busy,[false]);
  assert.deepEqual(f.records[0].getStatus(),{dirty:true,busy:false});
});
