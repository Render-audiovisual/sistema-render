import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest,isSessionFailure} from '../shared/session/captured-request.js';
import {canRetryTaskUpdate} from '../workspace-task-state.js';

const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function callback(name,deps){let found;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)found=node.initializer;ts.forEachChild(node,visit)}visit(file);assert.ok(found);return new Function(...Object.keys(deps),`return (${found.getText(file)});`)(...Object.values(deps))}
const original={id:5,revision:7,estado:'en_revision',titulo:'Observed',tipo_tarea:'diseno',propiedades_extra:{workspace:'render_os'},updated_at:'2026-10-20T10:00:00Z'};
const conflict=()=>Object.assign(new Error('Changed'),{status:409});
function fixture({task=original,transport}={}){
 let items=[{...task}],live={token:'a',usuario:{id:7,rol:'admin',activo:true}},active=true;
 const session=live,calls=[],effects=[],deps={tasksRef:{current:items},updateQueuesRef:{current:new Map()},clients:[],users:[],canRetryTaskUpdate,isSessionFailure};
 deps.captureRequest=()=>createCapturedRequest({session,readSession:()=>live,isActive:()=>active,request:async(url,options={})=>{calls.push({url,options});return transport(url,options,calls)}});
 deps.setTasks=update=>{items=update(items);effects.push('paint')};deps.notify=()=>effects.push('notify');deps.logActivity=async()=>effects.push('activity');
 deps.updateTask=callback('updateTask',deps);deps.approveTask=callback('approveTask',deps);
 return{deps,calls,effects,get items(){return items},switch(){live={token:'b',usuario:{id:8,rol:'admin',activo:true}}},unmount(){active=false}};
}
test('actual non-editing approval sends observed task revision and never retries unseen content after 409',async()=>{
 const fresh={...original,revision:8,titulo:'Unseen content'};
 const f=fixture({transport:async(url,options)=>{if(options.method==='PATCH')throw conflict();return fresh}});
 await assert.rejects(f.deps.approveTask(original),{status:409});
 const patches=f.calls.filter(call=>call.options.method==='PATCH');assert.equal(patches.length,1);assert.equal(JSON.parse(patches[0].options.body).expected_revision,7);
 assert.equal(f.items[0].estado,'en_revision');assert.equal(f.items[0].titulo,'Unseen content');assert.ok(!f.effects.includes('activity'));
});
test('actual direct boundary blocks retries for approval, finalization and historical publicada even without explicit revision',async()=>{
 for(const estado of ['aprobada','finalizada','publicada']){
  const previous={...original,estado:estado==='aprobada'?'en_revision':'aprobada'};
  const f=fixture({task:previous,transport:async(url,options)=>{if(options.method==='PATCH')throw conflict();return {...previous,revision:8,titulo:'Unseen'}}});
  await assert.rejects(f.deps.updateTask(5,{estado}),{status:409});
  assert.equal(f.calls.filter(call=>call.options.method==='PATCH').length,1);assert.equal(f.calls.length,2);
 }
});
test('critical queued action holds invocation revision; changed local task cannot silently become its baseline',async()=>{
 for(const estado of ['aprobada','finalizada','publicada']){
  let release;const gate=new Promise(resolve=>{release=resolve}),f=fixture({transport:async()=>assert.fail('stale action dispatched')});
  f.deps.updateQueuesRef.current.set(5,gate);
  const pending=f.deps.updateTask(5,{estado});f.deps.tasksRef.current=[{...original,revision:8}];release();
  await assert.rejects(pending,{status:409});assert.deepEqual(f.calls,[]);assert.deepEqual(f.effects,[]);
 }
});
test('approval uses supplied task observation even if local task has already advanced; explicit refreshed approval succeeds',async()=>{
 const f=fixture({transport:async(url,options)=>({...original,revision:9,estado:JSON.parse(options.body).estado})});
 f.deps.tasksRef.current=[{...original,revision:8}];
 await assert.rejects(f.deps.approveTask(original),{status:409});assert.equal(f.calls.length,0);
 const result=await f.deps.approveTask({...original,revision:8});assert.equal(result.estado,'aprobada');assert.equal(JSON.parse(f.calls[0].options.body).expected_revision,8);
});
test('ordinary compatible edits retain one intended retry with fresh CAS and original payload',async()=>{
 let writes=0;const fresh={...original,revision:8,titulo:'Other content'};
 const f=fixture({transport:async(url,options)=>{if(options.method!=='PATCH')return fresh;if(++writes===1)throw conflict();return {...fresh,revision:9,prioridad:'alta'}}});
 await f.deps.updateTask(5,{prioridad:'alta'});
 const patches=f.calls.filter(call=>call.options.method==='PATCH');assert.equal(patches.length,2);
 assert.deepEqual(patches.map(call=>JSON.parse(call.options.body).expected_revision),[7,8]);assert.equal(f.items[0].prioridad,'alta');
});
test('critical action late success or conflict cannot refresh, retry or paint after session replacement/unmount',async()=>{
 for(const change of ['switch','unmount'])for(const fail of [false,true]){
  let resolve,reject;const wait=new Promise((yes,no)=>{resolve=yes;reject=no});const f=fixture({transport:()=>wait});
  const pending=f.deps.updateTask(5,{estado:'finalizada'});await Promise.resolve();await Promise.resolve();assert.equal(f.calls.length,1);
  f[change]();const count=f.effects.length;fail?reject(conflict()):resolve({...original,revision:8,estado:'finalizada'});
  await assert.rejects(pending,{code:'session_binding_obsolete'});assert.equal(f.calls.length,1);assert.equal(f.effects.length,count);
 }
});
