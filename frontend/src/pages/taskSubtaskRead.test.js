import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest} from '../shared/session/captured-request.js';

const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length,0);
const detail=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TaskDetail');assert.ok(detail);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const effects=nodes(detail,node=>ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect');
const readEffect=effects.find(node=>node.arguments[0].getText(tree).includes('subtaskReadOwner.current = owner'));assert.ok(readEffect);
const retry=nodes(detail,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='retrySubtasks')[0]?.initializer;assert.ok(retry);
const extract=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const owner={current:null},calls=[],updates=[],cleanups=[];
  const session={token:'synthetic-subtask-read',usuario:{id:7,usuario:'qa_subtask',rol:'produccion'}},sessionRef={current:session};
  const retained=Object.freeze([{id:21,titulo:'Already loaded subtask'}]);
  const form=Object.freeze({draft:'Unsaved brief',comment:'Unsaved comment',confirmedComment:31});
  let state={loading:true,error:''},epoch=0,active=true;
  const captureRequest=()=>createCapturedRequest({session,readSession:()=>sessionRef.current,isActive:()=>active,request:async()=>assert.fail('Effect delegates to existing onLoadSubtasks')});
  const deps={AbortController,subtaskReadOwner:owner,captureRequest,
    setSubtaskRead:value=>{state=typeof value==='function'?value(state):value;updates.push(state);},
    setSubtaskRetry:value=>{epoch=typeof value==='function'?value(epoch):value;},
    onLoadSubtasks:(id,options)=>{const held={id,options,...deferred()};calls.push(held);return held.promise;}};
  return{owner,calls,updates,sessionRef,retained,form,get state(){return state;},get epoch(){return epoch;},
    mount(id=9){const cleanup=extract(readEffect.arguments[0],{...deps,task:id===null?null:{id}})();if(cleanup)cleanups.push(cleanup);return cleanup;},
    retry:extract(retry,deps),retire(){active=false;},cleanup(){for(const fn of cleanups)fn();}};
}

test('actual subtask effect is independent of comment/draft reset and retries have their own dependency',()=>{
  assert.equal(readEffect.arguments[1].getText(tree),'[task?.id,onLoadSubtasks,captureRequest,subtaskRetry]');
  const setters=nodes(readEffect.arguments[0],node=>ts.isCallExpression(node)&&/^set[A-Z]/.test(node.expression.getText(tree)));
  assert.deepEqual([...new Set(setters.map(node=>node.expression.getText(tree)))],['setSubtaskRead']);
  const commentEffect=effects.find(node=>node.arguments[0].getText(tree).includes('owner.commentsRead = commentsRead'));assert.ok(commentEffect);
  assert.doesNotMatch(commentEffect.getText(tree),/onLoadSubtasks|subtaskRetry|setSubtaskRead/);
});

test('actual loading failure is visible and retains loaded rows, unsaved form and confirmed comments',async()=>{
  const f=fixture(),rows=f.retained,form=f.form;f.mount();
  assert.deepEqual(f.state,{loading:true,error:''});assert.equal(f.calls.length,1);assert.equal(f.calls[0].id,9);
  assert.ok(f.calls[0].options.signal instanceof AbortSignal);
  f.calls[0].reject(new Error('QA invalid collection response'));await flush();
  assert.deepEqual(f.state,{loading:false,error:'QA invalid collection response'});assert.equal(f.owner.current.loading,false);
  assert.equal(f.retained,rows);assert.equal(f.form,form);assert.equal(f.calls.length,1);
  f.cleanup();
});

test('actual retry synchronously latches double click and successful read clears only subtask error',async()=>{
  const f=fixture();f.mount();f.retry();assert.equal(f.epoch,0,'Cannot retry during loading');
  f.calls[0].reject(new Error('QA first read failed'));await flush();
  const staleRetry=f.retry;staleRetry();staleRetry();assert.equal(f.epoch,1);assert.equal(f.owner.current.loading,true);
  // Simulate React committing the retry dependency and cleaning old effect.
  f.cleanup();f.mount();assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.signal.aborted,true);
  assert.deepEqual(f.state,{loading:true,error:''});f.calls[1].resolve([]);await flush();
  assert.deepEqual(f.state,{loading:false,error:''});assert.equal(f.owner.current.loading,false);
  assert.deepEqual(f.form,{draft:'Unsaved brief',comment:'Unsaved comment',confirmedComment:31});
  assert.deepEqual(f.retained,[{id:21,titulo:'Already loaded subtask'}]);f.cleanup();
});

test('late task A success or failure cannot replace task B status, including stale A cleanup',async()=>{
  for(const outcome of ['resolve','reject']){
    const f=fixture(),cleanupA=f.mount(9),a=f.calls[0];
    // Owner identity, not just abort, fences a read already superseded by B.
    f.mount(10);const ownerB=f.owner.current;cleanupA();assert.equal(f.owner.current,ownerB);
    const before=f.updates.length;
    if(outcome==='resolve')a.resolve([{id:99}]);else a.reject(new Error('Stale A failure'));
    await flush();assert.equal(f.updates.length,before);assert.deepEqual(f.state,{loading:true,error:''});
    assert.equal(f.calls[1].id,10);f.calls[1].resolve([]);await flush();assert.deepEqual(f.state,{loading:false,error:''});f.cleanup();
  }
});

test('unmount and retired session drop late success/failure; obsolete retry cannot start another read',async()=>{
  for(const retired of ['unmount','session','inactive'])for(const outcome of ['resolve','reject']){
    const f=fixture();f.mount();const before=f.updates.length;
    if(retired==='unmount')f.cleanup();else if(retired==='session')f.sessionRef.current=null;else f.retire();
    f.retry();assert.equal(f.epoch,0);
    if(outcome==='resolve')f.calls[0].resolve([]);else f.calls[0].reject(new Error('Obsolete failure'));
    await flush();assert.equal(f.updates.length,before);assert.equal(f.calls.length,1);
    if(retired==='unmount')assert.equal(f.calls[0].options.signal.aborted,true);f.cleanup();
  }
});

test('absent task starts no read; an error without message receives explicit fallback text',async()=>{
  const empty=fixture();empty.mount(null);assert.equal(empty.calls.length,0);empty.retry();assert.equal(empty.epoch,0);
  for(const reason of [{},null,undefined,{message:{}}]){
    const f=fixture();f.mount();f.calls[0].reject(reason);await flush();
    assert.deepEqual(f.state,{loading:false,error:'No se pudieron cargar las subtareas.'});f.cleanup();
  }
});

test('actual organization JSX remains available on read failure/loading, with status, alert and guarded retry button',()=>{
  const attr=(opening,key)=>opening.attributes.properties.find(node=>ts.isJsxAttribute(node)&&node.name.getText(tree)===key);
  const sections=nodes(detail,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='section'
    &&attr(node.openingElement,'className')?.initializer?.text==='ros-work-block ros-work-organization');assert.equal(sections.length,1);
  const section=sections[0];assert.match(section.parent.getText(tree),/subtaskRead.loading \|\| subtaskRead.error/);
  const openings=nodes(section,node=>ts.isJsxOpeningElement(node));
  assert.ok(openings.some(node=>attr(node,'role')?.initializer?.text==='status'));
  assert.ok(openings.some(node=>attr(node,'role')?.initializer?.text==='alert'));
  const buttons=openings.filter(node=>node.tagName.getText(tree)==='button'&&attr(node,'onClick')?.initializer?.expression?.getText(tree)==='retrySubtasks');
  assert.equal(buttons.length,1);assert.equal(attr(buttons[0],'disabled').initializer.expression.getText(tree),'subtaskRead.loading');
  assert.equal(buttons[0].parent.children.map(node=>node.getText(tree)).join(''),'Reintentar subtareas');
  assert.match(section.getText(tree),/subtasks\.map\(\(subtask\) =>/);
});
