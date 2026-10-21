import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createTaskManualOrder,taskOrderInput,verifiedTaskOrderAck,validTaskOrderRevision,validTaskOrderSnapshot,taskOrderArrowAnchor} from '../features/render-os/utils/task-manual-order.js';
import {apiTaskPage,buildTaskPageUrl} from '../features/render-os/services/render-os-api.js';
import {getTaskViewState,updateTaskViewUrl,effectiveTaskFilterState} from '../features/render-os/utils/task-view-state.js';
import {createCapturedRequest,isSessionFailure} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
import {canUserEditTask,canUserMoveTask} from '../workspace-task-state.js';
import {canonicalTaskState} from '../features/render-os/constants.js';
const uuid='11111111-1111-4111-8111-111111111111',snapshot='a'.repeat(64),task={id:5,revision:7,estado:'en_revision',asignado_a_id:7},before={id:6,revision:3,estado:'en_revision'};
const selection=()=>({task:{...task},before:{...before},orderRevision:'9007199254740993'});
const ack=(input,extra={})=>({task_id:input.task_id,before_id:input.before_id,order_revision:(BigInt(input.expected_order_revision)+1n).toString(),replayed:false,changed:true,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
function fixture(transport,{cookie=false}={}){
 const store=createBrowserSessionState();const accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,rol:'admin',usuario:'qa',nombre:'QA'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
 if(cookie)accept(7);const session=cookie?store.getSession():{token:'a',usuario:{id:7,rol:'admin',activo:true}};let live=session,active=true,captures=0,ids=0;const calls=[];
 const capture=()=>{captures++;return createCapturedRequest({session,readSession:()=>live,isActive:()=>active,request:async(url,options)=>{calls.push({url,options});return transport(url,options,calls.length)}})};
 const model=createTaskManualOrder({capture,randomUUID:()=>{ids++;return uuid}});
 return{model,capture,calls,session,get ids(){return ids},get captures(){return captures},switch(){if(cookie){accept(8);live=store.getSession()}else live={token:'b',usuario:{id:8,rol:'admin',activo:true}}},unmount(){active=false}};
}
test('revision is exact positive canonical signed bigint string, while snapshot is closed lowercase64hex',()=>{
 for(const value of ['1','9007199254740993','9223372036854775807'])assert.equal(validTaskOrderRevision(value),true);
 for(const value of [0,1,'0','01','-1','1\n',' 1','1e2','9223372036854775808','999999999999999999999999'])assert.equal(validTaskOrderRevision(value),false);
 assert.equal(validTaskOrderSnapshot(snapshot),true);for(const value of [snapshot+'\n',snapshot.toUpperCase(),'a'.repeat(63),null])assert.equal(validTaskOrderSnapshot(value),false);
});
test('input and ACK are closed exact IDs/revisions with canonical same-column compatibility, no task fields',()=>{
 const input=taskOrderInput(selection(),uuid);assert.deepEqual(Object.keys(input),['request_id','task_id','expected_revision','before_id','expected_before_revision','expected_order_revision']);
 assert.deepEqual(verifiedTaskOrderAck({...ack(input),private_metadata:'drop'},input),ack(input));
 for(const change of [{order_revision:input.expected_order_revision},{order_revision:'1'},{task_id:8},{before_id:9},{changed:1},{changed:false},{replayed:'true'},{order_revision:'9007199254740995'}])assert.throws(()=>verifiedTaskOrderAck(ack(input,change),input));
 assert.equal(verifiedTaskOrderAck(ack(input,{changed:false,order_revision:input.expected_order_revision,replayed:true}),input).changed,false);
 assert.equal(verifiedTaskOrderAck(ack(input,{replayed:true}),input).replayed,true);
 const end=taskOrderInput({...selection(),before:null},uuid);assert.equal(end.before_id,null);assert.equal(end.expected_before_revision,null);
 assert.doesNotThrow(()=>taskOrderInput({...selection(),task:{...task,estado:'publicada'},before:{...before,estado:'finalizada'}},uuid));
 for(const change of [{task:{...task,revision:0}},{before:{...before,id:5}},{before:{...before,estado:'aprobada'}},{orderRevision:'0'}])assert.throws(()=>taskOrderInput({...selection(),...change},uuid));
 assert.throws(()=>taskOrderInput(selection(),uuid+'\n'));
});
test('uncertain move only explicit Verify repeats immutable body/UUID and original genuine actor',async()=>{
 for(const cookie of [false,true]){
  const f=fixture(async(url,options,n)=>{if(n===1)throw Error('lost');return ack(JSON.parse(options.body),{replayed:true})},{cookie});
  const data=selection();await assert.rejects(f.model.move(data));data.task.revision=99;data.before.id=99;data.orderRevision='22';
  assert.equal(f.model.snapshot.status,'uncertain');assert.equal(f.calls.length,1);await assert.rejects(f.model.move(selection()));assert.equal(f.calls.length,1);
  await f.model.verify();assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.equal(f.ids,1);assert.equal(f.captures,1);
  for(const call of f.calls){assert.equal(call.url,'/api/tareas/orden');assert.equal(call.options.method,'POST');if(cookie){assert.equal(call.options.sessionIntent.session,f.session);assert.equal(call.options.headers.Authorization,undefined)}else assert.equal(call.options.headers.Authorization,'Bearer a')}
 }
});
test('409 keeps frozen conflict until explicit reset; malformed ACK remains uncertain without false success',async()=>{
 const f=fixture(async()=>{throw Object.assign(Error('conflict'),{status:409})});await assert.rejects(f.model.move(selection()));assert.equal(f.model.snapshot.status,'conflict');
 await assert.rejects(f.model.verify());await assert.rejects(f.model.move(selection()));assert.equal(f.calls.length,1);f.model.reset();assert.equal(f.model.snapshot.locked,false);
 const bad=fixture(async(url,options)=>ack(JSON.parse(options.body),{order_revision:'1'}));await assert.rejects(bad.model.move(selection()));assert.equal(bad.model.snapshot.status,'uncertain');assert.equal(bad.calls.length,1);
});
test('pending, stale A/B, unmount and pre-submit account change cannot dispatch/retry under another actor',async()=>{
 for(const cookie of [false,true])for(const action of ['switch','unmount']){
  const wait=deferred(),f=fixture(()=>wait.promise,{cookie}),pending=f.model.move(selection());assert.equal(f.calls.length,1);
  assert.throws(()=>f.model.reset());await assert.rejects(f.model.move(selection()));f[action]();wait.resolve(ack(taskOrderInput(selection(),uuid)));
  await assert.rejects(pending,{code:'session_binding_obsolete'});await assert.rejects(f.model.verify());assert.equal(f.calls.length,1);
  const early=fixture(async()=>assert.fail('wrong actor'),{cookie});early[action]();await assert.rejects(early.model.move(selection()),{code:'session_binding_obsolete'});assert.equal(early.ids,0);assert.equal(early.calls.length,0);
 }
});
test('arrow anchors are loaded physical neighbours; partial boundary is not invented global end',()=>{
 const rows=[task,before,{...task,id:8},{...task,id:9}];assert.equal(taskOrderArrowAnchor(rows,1,'up'),rows[0]);assert.equal(taskOrderArrowAnchor(rows,0,'down'),rows[2]);
 assert.equal(taskOrderArrowAnchor(rows,2,'down'),undefined);assert.equal(taskOrderArrowAnchor(rows,3,'down'),undefined);
});
test('URL mode defaults date and roundtrips manual without losing task/filter context',()=>{
 for(const query of ['', '?sort=date','?sort=other','?sort=manual&sort=date'])assert.equal(getTaskViewState(query).sort,'date');
 const state=getTaskViewState('?view=board&task=5&client=6&sort=manual'),url=updateTaskViewUrl('https://render.test/workspace/tareas?task=5#detail',state);
 assert.equal(state.sort,'manual');assert.equal(url.searchParams.get('task'),'5');assert.equal(url.searchParams.get('sort'),'manual');assert.equal(url.hash,'#detail');
 assert.equal(updateTaskViewUrl(url,{...state,sort:'date'}).searchParams.has('sort'),false);
});
test('real page builder keeps date unchanged, requires manual continuation snapshot and preserves business filters',()=>{
 assert.equal(buildTaskPageUrl(),'/api/tareas?workspace=render_os&limit=50&offset=0');
 const url=new URL(buildTaskPageUrl({sort:'manual',offset:50,expectedSnapshot:snapshot,responsible:'id:7',client:'8',query:'copy'}),'https://render.test');
 assert.equal(url.searchParams.get('sort'),'manual');assert.equal(url.searchParams.get('expected_snapshot'),snapshot);assert.equal(url.searchParams.get('asignado_a_id'),'7');assert.equal(url.searchParams.get('cliente_id'),'8');
 assert.throws(()=>buildTaskPageUrl({sort:'manual',offset:50}));assert.throws(()=>buildTaskPageUrl({sort:'bad'}));assert.throws(()=>buildTaskPageUrl({sort:'manual',expectedSnapshot:snapshot+'\n'}));
});
test('real apiTaskPage parses exact manual headers including empty0/large revision; rejects stale/malformed pages',async()=>{
 const previous=globalThis.fetch;
 const response=(body,{revision='9007199254740993',hash=snapshot,total='1',status=200}={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'X-Task-Order-Revision':revision,'X-Task-Order-Snapshot':hash,'X-Total-Count':total}});
 try{
  globalThis.fetch=async()=>response([{id:5}]);const page=await apiTaskPage({sort:'manual'});assert.equal(page.orderRevision,'9007199254740993');assert.equal(page.orderSnapshot,snapshot);
  globalThis.fetch=async()=>response([],{total:'0'});assert.equal((await apiTaskPage({sort:'manual'})).total,0);
  for(const next of [response([{id:5}],{revision:'0'}),response([{id:5}],{total:'01'}),response([{id:5}],{total:'9007199254740992'}),response([],{}),response('not json'),response([{id:5},{id:5}],{total:'2'})]){globalThis.fetch=async()=>next;await assert.rejects(apiTaskPage({sort:'manual'}))}
  globalThis.fetch=async()=>response([{id:6}],{hash:'b'.repeat(64),total:'51'});await assert.rejects(apiTaskPage({sort:'manual',offset:50,expectedSnapshot:snapshot}),{status:409});
  globalThis.fetch=async()=>response({error:'changed'},{status:409});await assert.rejects(apiTaskPage({sort:'manual'}),{status:409});
 }finally{globalThis.fetch=previous}
});

// Actual page callbacks extracted with injected transport/effects, not mounted UI.
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function initializer(owner,name){const component=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===owner);let result;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)result=n.initializer;ts.forEachChild(n,visit)}visit(component);return result}
function callback(owner,name,deps){let init=initializer(owner,name);if(ts.isCallExpression(init)&&init.expression.getText(file)==='useCallback')init=init.arguments[0];const context={canonicalTaskState,effectiveTaskFilterState,...deps};return new Function(...Object.keys(context),`return (${init.getText(file)});`)(...Object.values(context))}
test('actual card drop uses same-column before anchor only; cross-column bubbles to existing state flow',()=>{
 const events=[],deps={sort:'manual',archiveMode:'active',manualReady:true,tasksLatestRef:{current:[task]},sesion:{usuario:{id:7,rol:'admin'}},canonicalTaskState,canUserEditTask,setDragOver:()=>{},onReorder:(...args)=>events.push(args)};
 const drop=callback('TasksView','dropBeforeTask',deps),event=()=>({dataTransfer:{types:['text/task-id'],getData:()=> '5'},preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}});
 const same=event();drop(same,before);assert.equal(same.stopped,true);assert.deepEqual(events,[[task,before]]);
 const other=event();drop(other,{...before,estado:'aprobada'});assert.equal(other.stopped,undefined);assert.equal(events.length,1);
});
test('actual own-card arrows use observed loaded anchors and explicit column end never becomes a state write',()=>{
 const events=[],deps={sort:'manual',archiveMode:'active',manualReady:true,canUserEditTask,taskOrderArrowAnchor,sesion:{usuario:{id:7,rol:'produccion'}},onReorder:(...args)=>events.push(args)};
 const controls=callback('TasksView','orderControls',deps),rows=[task,before,{...task,id:8}];
 const first=controls(task,rows,0);assert.equal(first.up,null);first.down();first.end();assert.deepEqual(events,[[task,rows[2]],[task,null]]);
 assert.equal(controls({...task,asignado_a_id:99},rows,0),undefined);assert.equal(controls(task,rows.slice(0,2),0).down,null);
 const dropDeps={sort:'manual',archiveMode:'active',manualReady:true,tasksLatestRef:{current:[task]},sesion:deps.sesion,canUserMoveTask,canonicalTaskState,setDragOver(){},onReorder:deps.onReorder,move:()=>assert.fail('same-column ordering must not write state'),compactBoard:false};
 dropDeps.canUserEditTask=canUserEditTask;
 const drop=callback('TasksView','dropOnProcessButton',dropDeps);drop({dataTransfer:{types:['text/task-id'],getData:()=> '5'},preventDefault(){}},{id:'en_revision'});
 assert.deepEqual(events.at(-1),[task,null]);
 const done={...task,estado:'finalizada'};dropDeps.tasksLatestRef.current=[done];assert.equal(canUserMoveTask(done,deps.sesion.usuario),false);
 callback('TasksView','dropOnProcessButton',dropDeps)({dataTransfer:{types:['text/task-id'],getData:()=> '5'},preventDefault(){}},{id:'finalizadas',dropState:'finalizada'});
 assert.deepEqual(events.at(-1),[done,null]);
});
function pageFixture(transport){
 const f=fixture(transport),effects=[],context='observed',observation={context};
 const deps={captureRequest:f.capture,orderModel:f.model,manualReady:true,sesion:f.session,canUserEditTask,isSessionFailure,orderContext:context,orderObservation:observation,orderContextRef:{current:observation},orderPageRef:{current:{revision:selection().orderRevision,snapshot,context,observation}},taskQueryGenerationRef:{current:7},setOrderMessage:value=>effects.push(['message',value]),renderOrder:()=>effects.push(['render'])};
 for(const name of ['OrderPage','LoadingMore','PagingBlocked','OrderReload'])deps[`set${name}`]=value=>effects.push([name,value]);
 deps.reloadTaskOrder=callback('WorkspaceReadOnlyPage','reloadTaskOrder',deps);
 return{f,deps,effects};
}
test('actual confirmed reorder invalidates paging and reloads first page; conflict never refreshes/retries',async()=>{
 const ok=pageFixture(async(url,options)=>ack(JSON.parse(options.body)));await callback('WorkspaceReadOnlyPage','reorderTask',ok.deps)(task,before);
 assert.equal(ok.deps.taskQueryGenerationRef.current,8);assert.equal(ok.deps.orderPageRef.current,null);assert.ok(ok.effects.some(([name])=>name==='OrderReload'));assert.equal(ok.f.calls.length,1);
 const bad=pageFixture(async()=>{throw Object.assign(Error('conflict'),{status:409})});await callback('WorkspaceReadOnlyPage','reorderTask',bad.deps)(task,before);
 assert.equal(bad.deps.taskQueryGenerationRef.current,7);assert.ok(!bad.effects.some(([name])=>name==='OrderReload'));assert.equal(bad.f.calls.length,1);assert.equal(bad.f.model.snapshot.status,'conflict');
});
test('actual reorder UI suppresses late account/unmount ACK and rejects stale filter observation before dispatch',async()=>{
 for(const action of ['switch','unmount']){
  const wait=deferred(),f=pageFixture(()=>wait.promise),pending=callback('WorkspaceReadOnlyPage','reorderTask',f.deps)(task,before);
  const count=f.effects.length;f.f[action]();wait.resolve(ack(taskOrderInput(selection(),uuid)));await pending;
  assert.equal(f.effects.length,count);assert.equal(f.deps.taskQueryGenerationRef.current,7);assert.equal(f.f.calls.length,1);
 }
 const f=pageFixture(async()=>assert.fail('stale filter must not send'));f.deps.orderContextRef.current={context:'observed'};
 await callback('WorkspaceReadOnlyPage','reorderTask',f.deps)(task,before);assert.equal(f.f.calls.length,0);
});
test('actual pagination sends original snapshot; stale/error/foreign pages never append or turn into success',async()=>{
 for(const scenario of ['409','mismatch','duplicate','context','ABA','generation','valid']){
  const effects=[],context='observed',observation={context},wait=deferred(),f=fixture(async()=>({}));
  const deps={captureRequest:f.capture,queryNotice:'',reviewScope:'',taskStatus:'all',reviewPageRef:{current:null},taskQueryGenerationRef:{current:3},tasks:[task],responsibleSelection:{ready:true,value:'all'},loadingMore:false,pagingBlocked:false,orderState:{busy:false},totalTasks:2,effectiveSort:'manual',orderPageRef:{current:{revision:'3',snapshot,context,observation}},orderContext:context,orderObservation:observation,orderContextRef:{current:observation},query:'',area:'all',client:'all',sector:'all',priority:'all',archiveMode:'active',isSessionFailure,apiTaskPage:async(options)=>{assert.equal(options.expectedSnapshot,snapshot);return wait.promise},setTasks:()=>effects.push('append'),setTotalTasks:()=>effects.push('total'),setLoadingMore:()=>{},setPagingBlocked:()=>effects.push('blocked'),setOrderMessage:()=>effects.push('message'),notify:()=>effects.push('notify')};
  const pending=callback('WorkspaceReadOnlyPage','loadMoreTasks',deps)();
  if(scenario==='context')deps.orderContextRef.current={context:'new'};if(scenario==='ABA')deps.orderContextRef.current={context};if(scenario==='generation')deps.taskQueryGenerationRef.current++;
  if(scenario==='409')wait.reject(Object.assign(Error('changed'),{status:409}));else wait.resolve({items:[scenario==='duplicate'?task:before],total:2,orderRevision:'3',orderSnapshot:scenario==='mismatch'?'b'.repeat(64):snapshot});
  await pending;assert.equal(effects.includes('append'),scenario==='valid');assert.equal(effects.includes('total'),scenario==='valid');
  if(['409','mismatch','duplicate'].includes(scenario))assert.ok(effects.includes('blocked'));
 }
});
test('source wires URL sort, explicit recovery, own-card controls and manual-only active board without state payloads',()=>{
 assert.equal(file.parseDiagnostics.length,0);assert.match(source,/setSort\(next.sort\)/);assert.match(source,/aria-label="Orden de tareas"/);
 assert.match(source,/manualControls=\{orderControls\(task,items,index\)\}/);assert.match(source,/minHeight:44/);assert.match(source,/>Al final<\/button>/);
 assert.match(source,/Verificar movimiento/);assert.match(source,/onRefreshOrder=\{refreshTaskOrder\}/);assert.match(source,/sort: effectiveSort/);
 const refresh=initializer('WorkspaceReadOnlyPage','refreshTaskOrder').getText(file);assert.match(refresh,/orderModel.reset\(\)/);assert.match(refresh,/reloadTaskOrder\(\)/);
 assert.doesNotMatch(readFileSync(new URL('../features/render-os/utils/task-manual-order.js',import.meta.url),'utf8'),/localStorage|Math.random|setTimeout/);
});
test('actual toolbar JSX is a compact independent control with closed optional help, not the filter grid',()=>{
 let toolbar;function visit(node){if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(attribute=>attribute.name?.getText(file)==='className'&&attribute.initializer?.text==='ros-order-toolbar'))toolbar=node;ts.forEachChild(node,visit)}visit(file);
 assert.ok(toolbar);const jsx=toolbar.getText(file);assert.doesNotMatch(jsx,/ros-filter-bar/);
 const compiled=ts.transpileModule(`const Toolbar=()=>(${jsx});`,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
 for(const sort of ['date','manual']){
  const Toolbar=new Function('React','sort','view','archiveMode','orderState','setSort','reviewScope',`${compiled};return Toolbar;`)(React,sort,'board','active',{busy:false},()=>{},'');
  const html=renderToStaticMarkup(React.createElement(Toolbar));assert.match(html,/aria-label="Orden de tareas"/);
  if(sort==='manual'){assert.match(html,/<summary>Orden compartido<\/summary>/);assert.match(html,/<details class="ros-order-help">/);assert.doesNotMatch(html,/<details[^>]* open/)}else assert.doesNotMatch(html,/<details/);
 }
});
test('existing final header layer scopes quiet order surfaces, wrapping and 44px targets without another stylesheet',()=>{
 const css=readFileSync(new URL('./TaskHeader.css',import.meta.url),'utf8');
 assert.match(css,/\.render-workspace \.ros-order-toolbar\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
 assert.match(css,/\.ros-order-toolbar select\s*\{[^}]*width: 128px;[^}]*max-width: 180px;[^}]*min-height: 44px;/);
 assert.match(css,/\.ros-order-help p\s*\{[^}]*font-size: 13px;[^}]*overflow-wrap: anywhere;/);
 assert.match(css,/\.ros-order-actions button\s*\{[^}]*min-height: 44px;[^}]*max-width: 100%;[^}]*border: 1px solid var\(--render-line\);[^}]*background: var\(--render-surface-soft\);/);
 assert.match(css,/\.ros-order-actions button:focus-visible/);
 assert.match(source,/className="ros-order-actions" role="group"/);
 assert.doesNotMatch(source,/import .*Order.*\.css/);
});
