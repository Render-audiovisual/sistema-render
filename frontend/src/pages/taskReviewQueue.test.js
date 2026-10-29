import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getTaskViewState, updateTaskViewUrl, taskQueryNotice, effectiveTaskFilterState, taskMatchesReviewScope } from '../features/render-os/utils/task-view-state.js';
import { buildTaskPageUrl, apiTaskPage } from '../features/render-os/services/render-os-api.js';
import { isWorkingTask } from '../features/render-os/utils/working-task-view.js';
import { homeReviewTaskHref } from './personalHome.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { STATUSES } from '../features/render-os/constants.js';
import { canonicalTaskState } from '../features/render-os/constants.js';
import { canUserEditTask, canRetryTaskUpdate } from '../workspace-task-state.js';
import { taskOrderArrowAnchor } from '../features/render-os/utils/task-manual-order.js';
import { taskVisibleWindow } from '../features/render-os/utils/task-visible-window.js';
import { taskMatchesResponsible } from '../features/render-os/utils/task-responsible-filter.js';
import { keepsTaskOpen, isTaskDraftDirty } from './taskNavigationGuard.js';
import { registerNavigationGuard, installUnsavedNavigation } from '../shared/navigation/unsaved.js';
import {parseTaskCreationAck} from './taskCreationAttempt.js';
const creationId='12345678-1234-4234-8234-123456789abc';

const snapshot='a'.repeat(64), task=(id,extra={})=>({id,revision:1,titulo:`Task ${id}`,estado:'en_revision',asignado_a_id:7,colaborador_ids:[],propiedades_extra:{},...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit)}visit(root);return result;}
const owner=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(ast)});`)(...Object.values(deps));
function callback(component,name,deps){let init=nodes(owner(component),n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)[0].initializer;if(ts.isCallExpression(init)&&init.expression.getText(ast)==='useCallback')init=init.arguments[0];return evaluate(init,deps);}

test('Home clean queue links select only scope and list; reload/URL preserve all explicit intersections',()=>{
 for(const scope of ['personal','team']){
  const href=homeReviewTaskHref(scope);assert.equal(href,`/workspace/tareas?view=list&review_scope=${scope}`);
  const state=getTaskViewState(new URL(href,'https://render.test').search);assert.equal(state.status,'en_revision');assert.equal(state.reviewScope,scope);assert.equal(state.responsible,'all');assert.equal(state.sort,'date');
  const before=`https://render.test${href}&estado=en_revision&client=9&responsible=id%3A7&sector=diseno&priority=alta&area=web&q=copy&task=12#detail`;
  const observed=getTaskViewState(new URL(before).search),updated=updateTaskViewUrl(before,observed);
  assert.deepEqual(getTaskViewState(updated.search),observed);assert.equal(updated.searchParams.get('task'),'12');assert.equal(updated.hash,'#detail');
  assert.equal(taskQueryNotice(observed,'admin'),'');
 }
 for(const value of ['',null,'all','team&responsible=id:8'])assert.equal(homeReviewTaskHref(value),null);
});

test('state and review URL validation fail closed on duplicate, invalid, contradictory, nonadmin team or manual/trash queue',()=>{
 for(const estado of ['pendiente','en_progreso','en_revision','aprobada','finalizada']){
  const state=getTaskViewState(`?estado=${estado}&sort=manual`);assert.equal(state.status,estado);assert.equal(taskQueryNotice(state,'admin'),'');
 }
 for(const query of ['?estado=bad','?estado=en_revision&estado=aprobada','?review_scope=','?review_scope=team&review_scope=personal','?review_scope=bad','?review_scope=personal&estado=pendiente','?review_scope=personal&mode=trash','?review_scope=personal&sort=manual'])assert.ok(taskQueryNotice(getTaskViewState(query),'admin'),query);
 assert.ok(taskQueryNotice(getTaskViewState('?review_scope=team'),'edicion'));assert.equal(taskQueryNotice(getTaskViewState('?review_scope=personal'),'edicion'),'');
});

test('effective legacy approval is read-only strict boolean, personal membership uses owner/collaborator IDs, no approval grant',()=>{
 const legacy=task(1,{propiedades_extra:{revision_aprobada:true}}),before=structuredClone(legacy);
 assert.equal(effectiveTaskFilterState(legacy),'aprobada');assert.equal(taskMatchesReviewScope(legacy,'team',{id:7,rol:'admin'}),false);
 assert.equal(effectiveTaskFilterState(task(2,{propiedades_extra:{revision_aprobada:'true'}})),'en_revision');assert.equal(effectiveTaskFilterState(task(2,{estado:'publicada'})),'finalizada');assert.deepEqual(legacy,before);
 assert.equal(taskMatchesReviewScope(task(3),'personal',{id:7,rol:'edicion'}),true);
 assert.equal(taskMatchesReviewScope(task(3,{asignado_a_id:8,colaborador_ids:[7]}),'personal',{id:7,rol:'diseno'}),true);
 assert.equal(taskMatchesReviewScope(task(3,{asignado_a_id:8,asignado_a:'Same name'}),'personal',{id:7,nombre:'Same name',rol:'admin'}),false);
 assert.equal(taskMatchesReviewScope(task(3),'team',{id:7,rol:'edicion'}),false);
});

test('API builder retains every business filter and requires the exact review token only for continuation',()=>{
 const settings={reviewScope:'personal',status:'en_revision',offset:50,expectedReviewSnapshot:snapshot,responsible:'id:7',client:'9',sector:'edicion',priority:'alta',area:'web',query:' copy '};
 const url=new URL(buildTaskPageUrl(settings),'https://render.test');
 assert.deepEqual(Object.fromEntries(url.searchParams),{workspace:'render_os',limit:'50',offset:'50',estado:'en_revision',review_scope:'personal',expected_review_snapshot:snapshot,asignado_a_id:'7',cliente_id:'9',tipo_tarea:'edicion',prioridad:'alta',area:'web',q:'copy'});
 assert.throws(()=>buildTaskPageUrl({...settings,expectedReviewSnapshot:undefined}));
 for(const change of [{reviewScope:'bad'},{status:'aprobada'},{sort:'manual'},{archiveMode:'trash'},{expectedReviewSnapshot:snapshot+'\n'}])assert.throws(()=>buildTaskPageUrl({...settings,...change}));
 assert.throws(()=>buildTaskPageUrl({expectedReviewSnapshot:snapshot}));
 assert.equal(new URL(buildTaskPageUrl({reviewScope:'team'}),'https://render.test').searchParams.get('estado'),'en_revision');
});

test('real page adapter validates all review headers/body before returning and preserves the original request options',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let next,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return next};
 const response=(items,headers={})=>new Response(JSON.stringify(items),{headers:{'X-Total-Count':'3','X-Task-Review-Snapshot':snapshot,...headers}});
 const signal=new AbortController().signal,options={signal,headers:{Authorization:'Bearer synthetic'}};
 next=response([task(1),task(2)]);const first=await apiTaskPage({reviewScope:'personal',limit:2},options);assert.equal(first.reviewSnapshot,snapshot);assert.equal(first.total,3);assert.equal(calls[0].options,options);
 next=response([task(3)]);assert.equal((await apiTaskPage({reviewScope:'personal',limit:2,offset:2,expectedReviewSnapshot:snapshot},options)).items[0].id,3);
 for(const bad of [new Response('[]',{headers:{'X-Total-Count':'0'}}),response([task(1)],{'X-Task-Review-Snapshot':'A'.repeat(64)}),response([task(1),task(1)]),response({},{}),response([task(1),task(2)],{'X-Total-Count':'03'}),new Response('{',{headers:{'X-Total-Count':'0','X-Task-Review-Snapshot':snapshot}})]){
  next=bad;await assert.rejects(apiTaskPage({reviewScope:'personal',limit:2},options));
 }
 next=response([task(3)],{'X-Task-Review-Snapshot':'b'.repeat(64)});await assert.rejects(apiTaskPage({reviewScope:'personal',limit:2,offset:2,expectedReviewSnapshot:snapshot},options),{status:409});
 next=new Response(JSON.stringify({error:'changed'}),{status:409});await assert.rejects(apiTaskPage({reviewScope:'personal'},options),{status:409});
});

function fixture(transport){
 let session={token:'synthetic',usuario:{id:7,rol:'admin',activo:true}},live=session,active=true;
 const observation={},state={tasks:[task(1)],total:2,effects:[],requests:[]};
 const captureRequest=()=>createCapturedRequest({session,readSession:()=>live,isActive:()=>active,request:async()=>{throw Error('No direct request expected')}});
 const deps={detailOnlyTaskId:null,captureRequest,isSessionFailure,queryNotice:'',taskQueryGenerationRef:{current:2},tasks:state.tasks,tasksRef:{current:state.tasks},responsibleSelection:{ready:true,value:'all',status:'ready'},loadingMore:false,pagingBlocked:false,orderState:{busy:false},orderModel:{snapshot:{busy:false}},totalTasks:2,
  taskStatus:'en_revision',reviewScope:'personal',effectiveSort:'date',orderPageRef:{current:null},reviewPageRef:{current:{snapshot,total:2,observation}},orderObservation:observation,orderContextRef:{current:observation},query:'',area:'all',client:'all',sector:'all',priority:'all',archiveMode:'active',orderContext:'queue',
  apiTaskPage:async options=>{state.requests.push(options);return transport(options)},notify:()=>state.effects.push('notify'),
  window:{location:{href:'https://render.test/workspace/tareas?view=list&review_scope=personal',search:'?view=list&review_scope=personal'},dispatchEvent:()=>true,setTimeout:fn=>{state.timer=fn;return 1},clearTimeout:()=>{}},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}}};
 for(const name of ['LoadingMore','PagingBlocked','OrderMessage','OrderPage','Error','Loading','OrderReload'])deps[`set${name}`]=value=>state.effects.push([name,value]);
 deps.setTasks=value=>{state.tasks=typeof value==='function'?value(state.tasks):value;state.effects.push('tasks')};deps.setTotalTasks=value=>{state.total=typeof value==='function'?value(state.total):value;state.effects.push('total')};
 return{state,deps,more:()=>callback('WorkspaceReadOnlyPage','loadMoreTasks',deps)(),replace(){live={token:'B',usuario:{id:8,rol:'admin',activo:true}}},unmount(){active=false},aba(){deps.orderContextRef.current={}}};
}

for(const scenario of ['valid','409','missingSnapshot','foreignSnapshot','changedTotal','duplicate','actor','unmount','ABA','generation'])test(`actual queue pagination ${scenario} preserves first-page token and never appends stale/invalid results`,async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise),pending=f.more();assert.equal(f.state.requests[0].expectedReviewSnapshot,snapshot);assert.equal(f.state.requests[0].status,'en_revision');assert.equal(f.state.requests[0].reviewScope,'personal');
 if(scenario==='actor')f.replace();if(scenario==='unmount')f.unmount();if(scenario==='ABA')f.aba();if(scenario==='generation')f.deps.taskQueryGenerationRef.current++;
 if(scenario==='409')wait.reject(Object.assign(new Error('changed'),{status:409}));else wait.resolve({items:[task(scenario==='duplicate'?1:2)],total:scenario==='changedTotal'?3:2,reviewSnapshot:scenario==='missingSnapshot'?undefined:scenario==='foreignSnapshot'?'b'.repeat(64):snapshot});
 await pending;assert.equal(f.state.effects.includes('tasks'),scenario==='valid');assert.equal(f.state.effects.includes('total'),scenario==='valid');assert.equal(f.state.requests.length,1);
 if(['409','missingSnapshot','foreignSnapshot','changedTotal','duplicate'].includes(scenario)){assert.ok(f.state.effects.some(item=>Array.isArray(item)&&item[0]==='PagingBlocked'&&item[1]===true));assert.equal(f.deps.reviewPageRef.current.snapshot,snapshot);}
});

test('actual first-page effect captures review token and discards superseded filters/session/cleanup before publication',async()=>{
 const effect=nodes(owner('WorkspaceReadOnlyPage'),n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('apiTaskPage({ offset: 0'))[0].arguments[0];
 for(const scenario of ['valid','context','actor','cleanup']){
  const wait=deferred(),f=fixture(()=>wait.promise),cleanup=evaluate(effect,f.deps)();assert.equal(f.deps.reviewPageRef.current,null);f.state.timer();
  if(scenario==='context')f.aba();if(scenario==='actor')f.replace();if(scenario==='cleanup')cleanup();const count=f.state.effects.length;
  wait.resolve({items:[task(1)],total:2,reviewSnapshot:snapshot});await settle();
  if(scenario==='valid'){assert.equal(f.deps.reviewPageRef.current.snapshot,snapshot);assert.equal(f.deps.reviewPageRef.current.observation,f.deps.orderObservation)}else assert.equal(f.state.effects.length,count);
  cleanup();
 }
});

test('explicit refresh respects busy/dirty navigation gate and clears only pagination snapshot without automatic retry',()=>{
 for(const allowed of [false,true]){const f=fixture(async()=>({}));f.deps.window.dispatchEvent=()=>allowed;
  callback('WorkspaceReadOnlyPage','refreshReviewQueue',f.deps)();assert.equal(f.deps.reviewPageRef.current===null,allowed);assert.equal(f.deps.taskQueryGenerationRef.current,allowed?3:2);assert.equal(f.state.requests.length,0);
  assert.equal(f.state.effects.some(item=>item[0]==='OrderReload'),allowed);
 }
});

test('actual state/archive/exit controls leave queue deliberately, retaining other filters; clean-filter action clears scope',()=>{
 const changes=[],deps={setReviewScope:value=>changes.push(['scope',value]),setTaskStatus:value=>changes.push(['state',value]),setArchiveMode:value=>changes.push(['archive',value])};
 callback('TasksView','changeTaskStatus',deps)('aprobada');assert.deepEqual(changes,[['scope',''],['state','aprobada']]);changes.length=0;
 callback('TasksView','changeTaskStatus',deps)('en_revision');assert.deepEqual(changes,[['state','en_revision']]);changes.length=0;
 callback('TasksView','changeArchiveMode',deps)('trash');assert.deepEqual(changes,[['scope',''],['archive','trash']]);changes.length=0;
 callback('TasksView','exitReviewQueue',deps)();assert.deepEqual(changes,[['scope',''],['state','all']]);
 assert.match(source,/setTaskStatus\(next.status\); setReviewScope\(next.reviewScope\)/);assert.match(source,/archiveMode, taskStatus, reviewScope\]/);
 assert.match(source,/status:taskStatus, reviewScope/);assert.match(source,/setReviewScope\(''\); \};/);
});

test('actual queue JSX renders scope and explicit recovery; manual option is disabled; Home uses the real clean helper',()=>{
 const banner=nodes(owner('TasksView'),n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='section'&&n.openingElement.attributes.properties.some(p=>p.name?.getText(ast)==='aria-label'&&p.initializer?.text==='Cola de revisión'))[0];
 const compiled=ts.transpileModule(`const Banner=()=>(${banner.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 for(const reviewScope of ['team','personal']){const deps={React,reviewScope,visible:[task(1),task(2)],totalTasks:13,view:'list',setView:()=>{},orderMessage:'La cola cambió',loadingMore:false,orderState:{busy:false},queryNotice:'',onRefreshReview:()=>{},exitReviewQueue:()=>{}};
  const html=renderToStaticMarkup(Function(...Object.keys(deps),`${compiled};return React.createElement(Banner);`)(...Object.values(deps)));assert.match(html,new RegExp(reviewScope==='team'?'Revisión del equipo':'Tu trabajo en revisión'));assert.match(html,/Mostrando 2 de 13/);assert.match(html,/Actualizar cola desde el principio/);assert.match(html,/Salir de la cola/);
 }
 assert.doesNotMatch(source,/aria-label="Orden de tareas"/);assert.match(source,/!reviewScope && sort === 'manual'/);
 const home=readFileSync(new URL('./QuickHome.jsx',import.meta.url),'utf8');assert.match(home,/href=\{homeReviewTaskHref\(data.review.scope\)\}/);assert.match(home,/Ver toda la cola de revisión/);
 const css=readFileSync(new URL('./TaskHeader.css',import.meta.url),'utf8');assert.match(css,/\.render-workspace \.ros-review-queue \{[^}]*flex-wrap: wrap;/);assert.match(css,/\.ros-review-queue button \{[^}]*min-height: 44px;/);assert.match(css,/\.ros-review-queue button:focus-visible/);
});

function mutationFixture(reviewScope='personal',write=async(url,options)=>url==='/api/tareas'?{version:1,task:task(99,{estado:'pendiente',propiedades_extra:{workspace:'render_os'}}),operation:{request_id:JSON.parse(options.body).request_id,task_id:99,replayed:false}}:task(1,{estado:'aprobada',revision:2})){
 const f=fixture(async()=>assert.fail('No queue GET after a local mutation')),writes=[],session={token:'synthetic',usuario:{id:7,rol:'admin',activo:true}};
 const guard=createCapturedRequest({session,readSession:()=>session,request:async(url,options)=>{writes.push({url,options});return write(url,options)}});
 Object.assign(f.deps,{captureRequest:()=>guard,reviewScope,reviewScopeRef:{current:reviewScope},clients:[],users:[],sesion:session,updateQueuesRef:{current:new Map()},canRetryTaskUpdate,logActivity:async()=>{},notify:()=>{},
  markReviewQueueStale:null,parseTaskCreationAck,createdAdmissions:{current:{ids:new Set()}}});
 f.deps.markReviewQueueStale=callback('WorkspaceReadOnlyPage','markReviewQueueStale',f.deps);
 f.deps.updateTask=callback('WorkspaceReadOnlyPage','updateTask',f.deps);
 f.deps.productionTaskSnapshot=callback('WorkspaceReadOnlyPage','productionTaskSnapshot',f.deps);
 return{...f,writes};
}

test('actual approve callback removes a row from effective queue and invalidates snapshot immediately without rewriting observed total or GET',async()=>{
 const f=mutationFixture();await callback('WorkspaceReadOnlyPage','approveTask',f.deps)(f.state.tasks[0]);
 assert.equal(f.writes.length,1);assert.equal(JSON.parse(f.writes[0].options.body).expected_revision,1);assert.equal(f.deps.reviewPageRef.current,null);
 assert.equal(f.state.total,2);assert.equal(f.state.effects.includes('total'),false);assert.ok(f.state.effects.some(value=>value[0]==='PagingBlocked'&&value[1]===true));
 const visibleInit=nodes(owner('TasksView'),n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='visible')[0].initializer.arguments[0];
 const visible=evaluate(visibleInit,{isWorkingTask,tasks:f.state.tasks,archiveMode:'active',taskStatus:'en_revision',reviewScope:'personal',sesion:f.deps.sesion,area:'all',responsible:'all',client:'all',sector:'all',priority:'all',query:'',effectiveTaskFilterState,taskMatchesReviewScope,taskMatchesResponsible})();
 assert.deepEqual(visible,[]);await f.more();assert.equal(f.state.requests.length,0);assert.equal(f.writes.length,1);
});

test('actual create admits one direct-only row and marks observed total stale instead of fabricating counts',async()=>{
 for(const scope of ['personal','']){
  const f=mutationFixture(scope),created=await callback('WorkspaceReadOnlyPage','createTask',f.deps)({titulo:'New task',estado:'pendiente',request_id:creationId});
  assert.equal(f.writes.length,1);assert.equal(f.state.total,2);assert.equal(created.task.__renderOsDirectOnly,true);assert.equal(f.state.requests.length,0);
  assert.ok(f.state.effects.some(value=>value[0]==='PagingBlocked'&&value[1]===true));
  if(scope){assert.equal(f.deps.reviewPageRef.current,null);await f.more();assert.equal(f.state.requests.length,0)}
 }
});

test('actual parent admits POST and repeated GET confirmation once by ID without repeated activity or total changes',async()=>{
 const row=task(99,{estado:'pendiente',propiedades_extra:{workspace:'render_os'}});
 const f=mutationFixture('',async(_url,options)=>({version:1,task:row,operation:{request_id:creationId,task_id:99,replayed:options.method==='GET'}}));
 let activities=0;f.deps.logActivity=async()=>{activities++;};
 const create=callback('WorkspaceReadOnlyPage','createTask',f.deps),input={titulo:'Task99',request_id:creationId};
 await create(input);await create(input,{method:'GET'});await create(input,{method:'GET'});
 assert.equal(f.state.tasks.filter(item=>item.id===99).length,1);assert.equal(f.deps.tasksRef.current.filter(item=>item.id===99).length,1);
 assert.equal(activities,1);assert.equal(f.state.total,2);assert.equal(f.writes.filter(item=>item.options.method==='POST').length,1);
 assert.equal(f.writes.filter(item=>item.options.method==='GET').length,2);
});

test('actual parent recovery after hidden ACK admits one row but does not replay creation activity',async()=>{
 const row=task(99,{estado:'pendiente',propiedades_extra:{workspace:'render_os'}});
 const f=mutationFixture('',async(_url,options)=>{
  if(options.method==='POST')throw new TypeError('Synthetic hidden ACK');
  return{version:1,task:row,operation:{request_id:creationId,task_id:99,replayed:true}};
 });
 f.deps.logActivity=()=>assert.fail('Recovery does not create activity');
 const create=callback('WorkspaceReadOnlyPage','createTask',f.deps),input={titulo:'Task99',request_id:creationId};
 await assert.rejects(create(input));assert.equal(f.state.tasks.some(item=>item.id===99),false);
 await create(input,{method:'GET'});assert.equal(f.state.tasks.filter(item=>item.id===99).length,1);assert.equal(f.state.total,2);
});

test('repeated confirmation after refreshed inventory cannot hide or overwrite its newer server row',async()=>{
 const row=task(99,{estado:'pendiente',propiedades_extra:{workspace:'render_os'}});
 const f=mutationFixture('',async(_url,options)=>({version:1,task:row,operation:{request_id:creationId,task_id:99,replayed:options.method==='GET'}}));
 const create=callback('WorkspaceReadOnlyPage','createTask',f.deps),input={titulo:'Task99',request_id:creationId};await create(input);
 const refreshed={...row,revision:3,titulo:'Newer server title'};
 f.state.tasks=[refreshed];f.deps.tasksRef.current=f.state.tasks;
 const effects=f.state.effects.length;
 const result=await create(input,{method:'GET'});
 assert.equal(f.state.tasks[0],refreshed);assert.equal(f.state.tasks[0].__renderOsDirectOnly,undefined);
 assert.equal(result.task,refreshed);assert.equal(f.state.effects.length,effects);
});

test('mixed review and historical approvals have no manual controls/drop anchor or state writes',()=>{
 const legacy=task(2,{propiedades_extra:{revision_aprobada:true}}),ordinary=task(1,{estado:'aprobada'}),last=task(3,{estado:'aprobada'}),end=task(4,{estado:'aprobada'}),events=[];
 const deps={sort:'manual',archiveMode:'active',manualReady:true,canUserEditTask,canonicalTaskState,effectiveTaskFilterState,taskOrderArrowAnchor,sesion:{usuario:{id:7,rol:'admin'}},onReorder:(...args)=>events.push(args)};
 assert.equal(callback('TasksView','orderControls',deps)(legacy,[ordinary,legacy,last,end],1),undefined);
 for(const item of [ordinary,legacy,last,end])assert.equal(callback('TasksView','orderControls',deps)(item,[ordinary,legacy,last,end],0),undefined);
 assert.deepEqual(events,[]);
 events.length=0;const event={dataTransfer:{types:['text/task-id'],getData:()=>String(ordinary.id)},preventDefault(){},stopPropagation(){this.stopped=true}};
 callback('TasksView','dropBeforeTask',{...deps,tasksLatestRef:{current:[ordinary]},setDragOver:()=>{}})(event,legacy);assert.equal(event.stopped,true);assert.deepEqual(events,[]);
 callback('TasksView','dropOnProcessButton',{...deps,tasksLatestRef:{current:[legacy]},setDragOver:()=>{},move:()=>assert.fail('Historical label is not an approval intent')})({...event,dataTransfer:{...event.dataTransfer,getData:()=>String(legacy.id)}},{id:'aprobada'});assert.deepEqual(events,[]);assert.equal(legacy.estado,'en_revision');
});

test('actual TaskDetail guard receives refresh context and blocks dirty draft/comment or saving despite same task URL',()=>{
 const guardNode=nodes(owner('TaskDetail'),n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useNavigationGuard')[0].arguments[0];
 const dirtyNode=nodes(owner('TaskDetail'),n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='taskDraftDirty')[0].initializer;
 for(const state of ['draft','comment','upload','uploading','saving','clean']){
  const f=fixture(async()=>assert.fail('No implicit GET')),listeners=new Map();let confirmations=0;
  const win={location:new URL('https://render.test/workspace/tareas?review_scope=personal&task=1'),addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),confirm:()=>{confirmations++;return false},
    dispatchEvent:event=>{listeners.get(event.type)?.(event);return !event.defaultPrevented}};
  const installed=installUnsavedNavigation(win),original=task(1);
  const dirty=evaluate(dirtyNode,{task:original,draft:state==='draft'?{...original,titulo:'Unsaved'}:original,comment:state==='comment'?'Unsaved comment':'',commentDraftOwner:{current:{creation:{snapshot:{locked:false,busy:false}}}},isTaskDraftDirty,deliveryDirty:false,uploadDirty:state==='upload',coordinationDraft:{dirty:false},reconciliationDraft:{dirty:false},isProductionVisitTask:()=>false});
  const getStatus=evaluate(guardNode,{discardDialogOpen:false,taskDraftDirty:dirty,taskWriteBusy:state==='saving'||state==='uploading',commentDraftOwner:{current:{creation:{snapshot:{locked:false,busy:false}}}},archivePendingRef:{current:false},closeApprovedRef:{current:false},keepsTaskOpen,task:original});
  assert.deepEqual(getStatus({to:win.location.href,type:'link'}),{dirty:false,busy:false});
  const unregister=registerNavigationGuard(win,getStatus);f.deps.window=win;f.deps.CustomEvent=class{constructor(type,options){this.type=type;Object.assign(this,options);this.defaultPrevented=false}preventDefault(){this.defaultPrevented=true}};
  callback('WorkspaceReadOnlyPage','refreshReviewQueue',f.deps)();
  assert.equal(f.deps.reviewPageRef.current===null,state==='clean');assert.equal(confirmations,['draft','comment','upload'].includes(state)?1:0);
  unregister();installed.dispose();
 }
});

test('confirmed write during initial GET releases loading; late old GET cannot overwrite or hide stale banner',async()=>{
 const wait=deferred(),f=mutationFixture(),effect=nodes(owner('WorkspaceReadOnlyPage'),n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('apiTaskPage({ offset: 0'))[0].arguments[0];
 f.deps.apiTaskPage=async options=>{f.state.requests.push(options);return wait.promise};const cleanup=evaluate(effect,f.deps)();f.state.timer();
 await callback('WorkspaceReadOnlyPage','approveTask',f.deps)(f.state.tasks[0]);assert.ok(f.state.effects.some(value=>value[0]==='Loading'&&value[1]===false));
 const count=f.state.effects.length;wait.resolve({items:[task(1)],total:2,reviewSnapshot:snapshot});await settle();assert.equal(f.state.effects.length,count);assert.equal(f.state.tasks[0].estado,'aprobada');assert.equal(f.state.requests.length,1);cleanup();
});

test('explicit queue refresh GET failure retains selected task/data and uses banner instead of destructive page error',async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise),effect=nodes(owner('WorkspaceReadOnlyPage'),n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('apiTaskPage({ offset: 0'))[0].arguments[0];
 f.deps.window.location.search='?review_scope=personal&task=1';const held=f.state.tasks[0];
 const cleanup=evaluate(effect,f.deps)();f.state.timer();const mark=f.state.effects.length;wait.reject(new TypeError('Synthetic unavailable'));await settle();
 assert.equal(f.state.tasks[0],held);assert.equal(f.state.total,2);
 assert.ok(f.state.effects.slice(mark).some(value=>value[0]==='OrderMessage'));assert.equal(f.state.effects.slice(mark).some(value=>value[0]==='Error'),false);assert.equal(f.state.effects.slice(mark).includes('tasks'),false);cleanup();
});

test('actual list SSR keeps all review rows reachable and ordinary rows continue beyond the initial 500',()=>{
 const list=nodes(owner('TasksView'),n=>ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(p=>p.name?.getText(ast)==='className'&&p.initializer?.text==='ros-task-list'))[0];
 const compiled=ts.transpileModule(`const List=()=>(${list.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 for(const [reviewScope,listLimit] of [['personal',500],['',500],['',1000]]){
  const visible=Array.from({length:501},(_,index)=>task(index+1));
  const listWindow=taskVisibleWindow(visible,reviewScope?visible.length:listLimit,500);
  const deps={React,visible,listWindow,reviewScope,users:[],openTask:()=>{},setListLimit:()=>{},orderState:{busy:false,locked:false},AreaBadge:()=>null,STATUSES,effectiveTaskFilterState,taskResponsiblesLabel:()=> 'Member #7',formatDate:()=> 'Sin fecha'};
  const html=renderToStaticMarkup(Function(...Object.keys(deps),`${compiled};return React.createElement(List);`)(...Object.values(deps)));
  assert.equal((html.match(/<button/g)||[]).length,listWindow.items.length+Number(listWindow.hasMore));
  if(reviewScope||listLimit>500){assert.match(html,/Task 501/);assert.doesNotMatch(html,/Mostrar más tareas en lista/)}
  else{assert.doesNotMatch(html,/Task 501/);assert.match(html,/Mostrar más tareas en lista/);assert.match(html.replace(/<!--.*?-->/g,''),/Mostrando 500 de 501 tareas cargadas/);}
 }
});

for(const method of ['updateTask','createTask','approveTask','registerProduction','confirmProduction','correctProduction','bulkTaskAction'])for(const status of [undefined,503])test(`unknown ${method} ${status??'network'} blocks queue continuation without count fabrication or queue GET`,async()=>{
 const wait=deferred(),f=mutationFixture('personal',()=>wait.promise),observed=f.deps.reviewPageRef.current;
 const args={updateTask:[1,{titulo:'Edit'},null],createTask:[{titulo:'New',estado:'pendiente',request_id:creationId}],approveTask:[task(1)],registerProduction:[task(1),1,'2026-10-21'],confirmProduction:[task(1)],correctProduction:[task(1),{id:1,cantidad:1},2],bulkTaskAction:[[1],'papelera']}[method];
 const pending=callback('WorkspaceReadOnlyPage',method,f.deps)(...args);const rejection=assert.rejects(pending);await settle();assert.equal(f.writes.length,1);
 wait.reject(Object.assign(new TypeError('Synthetic unknown commit'),status===undefined?{}:{status}));await rejection;
 assert.equal(f.state.total,2);assert.equal(f.deps.reviewPageRef.current,null);assert.notEqual(observed,null);
 assert.ok(f.state.effects.some(value=>value[0]==='OrderMessage'&&value[1].includes('puede haber cambiado')));
 assert.equal(f.state.requests.length,0);await f.more();assert.equal(f.state.requests.length,0);assert.equal(f.writes.length,1);
});

test('known prewrite400 does not invalidate queue, but 409 with a newer task read does; neither fabricates a new count',async()=>{
 for(const status of [400,409]){
  const f=mutationFixture('personal',async(_url,options)=>{if(options.method==='GET')return task(1,{revision:2,titulo:'Changed'});throw Object.assign(new Error('Rejected'),{status})});
  await assert.rejects(callback('WorkspaceReadOnlyPage','approveTask',f.deps)(task(1)),{status});assert.equal(f.state.total,2);
  assert.equal(f.deps.reviewPageRef.current===null,status===409);assert.equal(f.state.requests.length,0);assert.equal(f.writes.filter(call=>call.options.method==='PATCH').length,1);
 }
});
