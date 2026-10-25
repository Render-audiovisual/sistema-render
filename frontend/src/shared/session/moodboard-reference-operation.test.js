import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest} from './captured-request.js';
import {createBrowserSessionState} from './browser-session-state.js';
import {createMoodboardReferenceOperation,createMoodboardTaskLinkOperation,verifiedMoodboardReference} from './moodboard-reference-operation.js';
import {createMoodboardBoardLoader} from './moodboard-board-loader.js';
import {registerNavigationGuard,installUnsavedNavigation} from '../navigation/unsaved.js';
import {readMoodboardLocation,resolveMoodboardBoard,moodboardBoardUrl} from '../../pages/moodboardLocation.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const error=status=>Object.assign(new Error('synthetic failure'),{status});
const row=(linked=false)=>({id:9,board_id:7,category_id:1,titulo:'Reference',nota:'saved',etiquetas:[],estado:'libre',tipo_fuente:'enlace',enlace_externo:'https://example.test',archivo_nombre:null,autor_id:1,autor_nombre:'QA',created_at:'2026-10-22T10:00:00.000Z',updated_at:'2026-10-22T10:00:00.000Z',categoria:'General',tareas:linked?[{id:3,titulo:'Task'}]:[],revision:0});
const data=extra=>({title:'Reference',note:'saved',category_id:1,tags:[],external_url:'https://example.test',image_data:null,...extra});
const ack=options=>({version:1,reference:row(),operation:{request_id:JSON.parse(options.body).request_id,action:'create',reference_id:9,result_revision:0,replayed:false}});
const bundle=linked=>({references:[row(linked)],categories:[],tasks:[{id:3}]});
function fixture({cookie=false}={}){
 const store=createBrowserSessionState();
 const accept=id=>{const ticket=store.beginBootstrap();assert.equal(store.acceptBootstrap(ticket,{usuario:{id,nombre:'QA',usuario:'qa',rol:'diseno'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)}),true);return store.getSession()};
 let live=cookie?accept(1):{token:'A',usuario:{id:1,rol:'diseno',activo:true}},active=true;
 const rendered=live,calls=[],reads=[];
 let transport=async(url,options)=>url.endsWith('/reference-operations')?ack(options):null,read=async()=>bundle(false);
 const capture=()=>createCapturedRequest({session:rendered,readSession:()=>live,isActive:()=>active,request:async(url,options)=>{calls.push({url,options});return transport(url,options)}});
 const refresh=async scope=>{scope.assertCurrent();reads.push(scope);const result=await read();scope.assertCurrent();return result};
 return{calls,reads,capture,refresh,setTransport:fn=>{transport=fn},setRead:fn=>{read=fn},switchActor:()=>{live=cookie?accept(2):{token:'B',usuario:{id:2,rol:'diseno',activo:true}}},unmount:()=>{active=false},create:()=>createMoodboardReferenceOperation({boardId:7,taskId:3,capture,refresh}),links:linked=>createMoodboardTaskLinkOperation({boardId:7,reference:row(linked),capture,refresh})};
}

test('closed creation identity rejects malformed, wrong-board and unsafe IDs',()=>{
 for(const value of [null,{id:0,board_id:7},{id:'9',board_id:7},{id:9,board_id:8},{id:2147483648,board_id:7}])assert.throws(()=>verifiedMoodboardReference(value,7));
 assert.deepEqual(verifiedMoodboardReference({...row(),secret:'drop'},7),{id:9,board_id:7});
});
test('definite create400 preserves correctable attempt, corrected explicit submit uses new immutable body',async()=>{
 const f=fixture(),op=f.create();f.setTransport(async()=>{throw error(400)});
 await assert.rejects(op.create(data({note:'bad'})));assert.equal(op.snapshot.phase,'idle');assert.equal(op.snapshot.canFinish,false);
 f.setTransport(async (url,options)=>url.endsWith('/reference-operations')?ack(options):null);f.setRead(async()=>bundle(true));
 await op.create(data({note:'corrected'}));assert.equal(op.snapshot.phase,'complete');
 assert.deepEqual(f.calls.filter(x=>x.url.endsWith('/reference-operations')).map(x=>JSON.parse(x.options.body).fields.note),['bad','corrected']);
});
for(const kind of ['network','500','malformed'])test(`unknown create ${kind} freezes creation, refresh never infers identity`,async()=>{
 const f=fixture(),op=f.create();f.setTransport(async()=>{if(kind==='malformed')return{};throw kind==='500'?error(500):new Error('offline')});
 await assert.rejects(op.create(data({title:'same title'})));assert.equal(op.snapshot.phase,'creation_uncertain');
 await assert.rejects(op.create(data({title:'same title'})));await assert.rejects(op.refresh());assert.equal(op.snapshot.createdId,null);assert.throws(()=>op.finish());assert.equal(f.calls.length,1);
 f.setTransport(async(url,options)=>url.endsWith('/reference-operations')?ack(options):null);f.setRead(async()=>bundle(true));await op.verifyCreate();assert.equal(op.snapshot.createdId,9);assert.equal(f.calls.length,3);assert.equal(f.calls[0].options.body,f.calls[1].options.body);
});
test('create success link503 retains ID; read-only recovery and finish never recreate/relink',async()=>{
 const f=fixture(),op=f.create();f.setTransport(async (url,options)=>{if(url.endsWith('/reference-operations'))return ack(options);throw error(503)});
 await assert.rejects(op.create(data({note:'saved'})));assert.equal(op.snapshot.createdId,9);assert.equal(op.snapshot.phase,'link_uncertain');
 await assert.rejects(op.retryLink());await op.refresh();assert.equal(op.snapshot.phase,'observed_missing');assert.equal(op.finish().referenceId,9);
 assert.equal(f.calls.length,2);assert.equal(f.reads.length,1);
});
test('definite link400 permits only explicit same-reference retry',async()=>{
 const f=fixture(),op=f.create();f.setTransport(async (url,options)=>{if(url.endsWith('/reference-operations'))return ack(options);throw error(400)});
 await assert.rejects(op.create(data({note:'saved'})));assert.equal(op.snapshot.canRetryLink,true);
 f.setTransport(async()=>null);f.setRead(async()=>bundle(true));await op.retryLink();
 assert.equal(f.calls.filter(x=>x.url.endsWith('/reference-operations')).length,1);assert.equal(f.calls[1].url,f.calls[2].url);assert.equal(op.snapshot.phase,'complete');
});
for(const initiallyLinked of [false,true])test(`uncertain ${initiallyLinked?'DELETE':'POST'} observes peer result, never replays`,async()=>{
 const f=fixture(),op=f.links(initiallyLinked);f.setTransport(async()=>{throw error(503)});
 await assert.rejects(op.change(3,!initiallyLinked));assert.equal(op.isLinked(3),initiallyLinked);await assert.rejects(op.retryWrite());
 f.setRead(async()=>bundle(initiallyLinked));await op.refresh();assert.equal(op.isLinked(3),initiallyLinked);assert.equal(op.snapshot.locked,false);assert.equal(f.calls.length,1);
 f.setTransport(async()=>null);f.setRead(async()=>bundle(!initiallyLinked));await op.change(3,!initiallyLinked);assert.equal(f.calls.length,2);
});
test('ACK plus failed read locks checkbox, refresh only honors later peer unlink',async()=>{
 const f=fixture(),op=f.links(false);f.setRead(async()=>{throw error(500)});
 await assert.rejects(op.change(3,true));assert.equal(op.isLinked(3),true);assert.equal(op.snapshot.writeConfirmed,true);assert.equal(op.snapshot.phase,'refresh_failed');
 await assert.rejects(op.change(3,false));await assert.rejects(op.retryWrite());f.setRead(async()=>bundle(false));await op.refresh();assert.equal(op.isLinked(3),false);assert.equal(f.calls.length,1);
});
test('composer never claims current linkage after ACK followed by observed peer unlink',async()=>{
 const f=fixture(),op=f.create();await op.create(data({note:'saved'}));assert.equal(op.snapshot.writeConfirmed,true);assert.equal(op.snapshot.phase,'observed_missing');
});
test('synchronous busy lock blocks double submit and double checkbox',async()=>{
 for(const type of ['create','links']){const f=fixture(),d=deferred(),op=type==='create'?f.create():f.links(false);f.setTransport(url=>type==='create'&&!url.endsWith('/reference-operations')?Promise.resolve(null):d.promise);
 const pending=type==='create'?op.create(data({})):op.change(3,true);await assert.rejects(type==='create'?op.create(data({})):op.change(3,true));assert.equal(f.calls.length,1);
 d.resolve(type==='create'?ack(f.calls[0].options):null);await pending;
 }
});
for(const cookie of [false,true])for(const boundary of ['before','after','unmount'])test(`${cookie?'cookie':'bearer'} ${boundary} cannot stage writes under new identity/lifetime`,async()=>{
 const f=fixture({cookie}),op=f.create(),d=deferred();f.setTransport(()=>d.promise);
 if(boundary==='before'){f.switchActor();await assert.rejects(op.create(data({})));assert.equal(f.calls.length,0);return}
 const pending=op.create(data({}));if(boundary==='unmount')f.unmount();else f.switchActor();d.resolve(ack(f.calls[0].options));await assert.rejects(pending);assert.equal(f.calls.length,1);assert.equal(f.reads.length,0);await assert.rejects(op.refresh());
});

// Execute real source callbacks without claiming a mounted browser test.
const source=readFileSync(new URL('../../pages/MoodboardPreview.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('MoodboardPreview.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function initializer(owner,name,deps){const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===owner);let found;function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found=n.initializer;ts.forEachChild(n,walk)}walk(fn);assert.ok(found,name);return Function(...Object.keys(deps),`return (${found.getText(ast)})`)(...Object.values(deps))}
test('actual Composer submit/recovery callbacks use one model and never fake success after rejection',async()=>{
 const f=fixture(),model=f.create();f.setTransport(async(url,options)=>{if(url.endsWith('/reference-operations'))return ack(options);throw error(503)});
 let saved=0,pending;const run=(action,done)=>pending=Promise.resolve().then(()=>action(model)).then(value=>done?.(value,model)).catch(()=>{});
 const draft={current:{kind:'link',url:'https://example.test',image:'',title:'x',note:'note',category:'1',tags:'a,b'}},baseline={current:''},syncDraft=()=>{};
 const completed=initializer('Composer','completed',{baseline,draft,syncDraft,saved:()=>saved++});
 const submit=initializer('Composer','submit',{operation:{busy:false},getModel:()=>model,run,draft,completed});
 submit({preventDefault(){}});await pending;assert.equal(saved,0);assert.equal(f.calls.length,2);
 await model.refresh();
 const finish=initializer('Composer','finish',{operation:{busy:false},getModel:()=>model,run,baseline,draft,syncDraft,saved:()=>saved++});finish();await pending;assert.equal(saved,1);assert.equal(f.calls.length,2);
});
test('actual shared run catches update/delete failures and prevents rapid duplicate mutations',async()=>{
 const pending={current:false},d=deferred(),guard={current:()=>true,assertCurrent(){}},errors=[];
 const run=initializer('useMoodboardOperation','run',{pending,captureCurrent:()=>guard,setError:e=>errors.push(e),paint:()=>{},onBusy:undefined,owner:{current:Symbol()},model:{snapshot:{phase:'idle'}},mounted:{current:true}});
 let writes=0;const first=run(async()=>{writes++;await d.promise;throw new Error('update failed')});await run(async()=>{writes++});d.resolve();await first;assert.equal(writes,1);assert.equal(errors.at(-1),'update failed');assert.equal(pending.current,false);
});
test('actual pending run registers synchronously; controlled board selection and activation cannot discard operation',async()=>{
 const operationOwners={current:new Set()},recoveryOwners={current:new Set()},states=[],owner={current:Symbol('first')},d=deferred();
 const operationObservation={current:Symbol('initial')},initialObservation=operationObservation.current;
 const signal=initializer('MoodboardContent','onOperationBusy',{operationOwners,recoveryOwners,operationObservation,originCurrent:()=>true,mounted:{current:true},setOperationBusy:x=>states.push(x)});
 const guard={current:()=>true,assertCurrent(){}},pending={current:false},model={snapshot:{phase:'idle'}};
 const run=initializer('useMoodboardOperation','run',{pending,captureCurrent:()=>guard,setError:()=>{},paint:()=>{},onBusy:signal,owner,model,mounted:{current:true}});
 const request=run(async()=>{assert.equal(operationOwners.current.has(owner.current),true);await d.promise;model.snapshot.phase='creation_uncertain';throw error(503)});
 assert.equal(states.at(-1),true);
 assert.notEqual(operationObservation.current,initialObservation,'synchronous pending notification rotates controlled observation');
 // No other dependencies supplied: any mutation/navigation beyond the busy guard would fail.
 initializer('MoodboardContent','chooseBoard',{operationOwners})(8);
 initializer('MoodboardContent','activateBoard',{operationOwners})(8);
 initializer('MoodboardContent','applyLocation',{operationOwners,locationRef:{current:{selection:null}},catalog:{current:[]}})({selection:{boardId:8}});
 const newer=Symbol('newer');signal(newer,true);d.resolve();await request;
 assert.equal(operationOwners.current.has(newer),true);assert.equal(operationOwners.current.has(owner.current),false);assert.equal(recoveryOwners.current.has(owner.current),true);
 const beforeNotification=operationObservation.current;
 signal(owner.current,false);assert.notEqual(operationObservation.current,beforeNotification,'even a false notification rotates observation');
 assert.equal(operationOwners.current.has(newer),true);signal(newer,false);assert.equal(states.at(-1),false);
});
test('blocked controlled location never compensates, overwrites or traverses browser history',()=>{
 const operationOwners={current:new Set([Symbol()])};
 const apply=initializer('MoodboardContent','applyLocation',{operationOwners,locationRef:{current:{selection:null}},catalog:{current:[]},window:{history:new Proxy({},{get(){throw new Error('History compensation is forbidden')}})}});
 apply({selection:{boardId:8}});
 assert.doesNotMatch(source,/heldOperationUrl|history\.(?:go|back|forward)\s*\(/);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='MoodboardContent');let declaration;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='applyLocation')declaration=n;ts.forEachChild(n,visit)}visit(fn);
 const body=declaration.initializer.body;
 assert.equal(body.statements[0].getText(ast),'if(operationOwners.current.size&&!allowEscape)return;');
 const guardCalls=[];function guardVisitor(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useNavigationGuard')guardCalls.push(n);ts.forEachChild(n,guardVisitor)}guardVisitor(fn);
 assert.equal(guardCalls.length,1);assert.equal(guardCalls[0].arguments[0].getText(ast),'moodboardNavigationStatus');
 assert.equal(guardCalls[0].arguments.length,2,'ref-only observations use an explicit provider');
 const operationObservation={current:Symbol('first')};
 const read=Function('operationObservation',`return (${guardCalls[0].arguments[1].getText(ast)});`)(operationObservation);
 assert.equal(read(),operationObservation.current);operationObservation.current=Symbol('next');assert.equal(read(),operationObservation.current);
});
test('actual noncancelable pop follows new URL while pending and invalidates old board write scope',async()=>{
 const operationOwners={current:new Set([Symbol()])},boardObservation={current:{id:7,generation:1}},oldOrigin=boardObservation.current,effects=[],d=deferred();
 const sesion={token:'A',usuario:{id:1,rol:'diseno'}};
 const scope=createCapturedRequest({session:sesion,readSession:()=>sesion,isActive:()=>boardObservation.current===oldOrigin,request:()=>d.promise});
 const pending=scope.request('/api/moodboards/boards/7/references',{method:'POST'});
 const deps={operationOwners,boardObservation,boardLoader:{current:{cancel(){}}},loadGeneration:{current:1}};
 for(const key of ['Refs','Categories','Tasks','ContextTask','Selected','Composer','CategoryEditor','Status','Category','Query','BoardId','BoardEpoch','Loading'])deps[`set${key}`]=value=>effects.push([key,value]);
 const activateBoard=initializer('MoodboardContent','activateBoard',deps),catalog={current:[{id:7},{id:8}]},locationRef={current:{selection:{boardId:7}}};
 const window={location:{href:'https://render.test/moodboards?board=8&other=keep#note'},history:{state:{},replaceState(_state,_title,url){assert.equal(url,'/moodboards?board=8&other=keep#note')}}};
 const applyLocation=initializer('MoodboardContent','applyLocation',{operationOwners,catalog,locationRef,setLocation:()=>{},activateBoard,setError:()=>{},setLoading:()=>{},resolveMoodboardBoard,moodboardBoardUrl,window});
 const pop=initializer('MoodboardContent','pop',{applyLocation,currentMoodboardLocation:()=>({selection:readMoodboardLocation('?board=8'),error:''})});
 pop();assert.equal(boardObservation.current.id,8);assert.equal(locationRef.current.selection.boardId,8);assert.equal(scope.current(),false);
 assert.ok(effects.some(([key,value])=>key==='Composer'&&value===false));assert.ok(effects.some(([key,value])=>key==='BoardId'&&value===8));
 d.resolve(row());await assert.rejects(pending,error=>error.code==='session_binding_obsolete');
});
test('unmount then late failed finally cannot resurrect old recovery or clear newer busy owner',async()=>{
 for(const boardChanged of [false,true]){
  const operationOwners={current:new Set()},recoveryOwners={current:new Set()},parentMounted={current:true},childMounted={current:true},old={current:Symbol('old')},newOwner=Symbol('new'),d=deferred();let sameOrigin=true,paints=0;
  const operationObservation={current:Symbol('initial')};
  const signal=initializer('MoodboardContent','onOperationBusy',{operationOwners,recoveryOwners,operationObservation,originCurrent:()=>sameOrigin,mounted:parentMounted,setOperationBusy:()=>{}});
  const guard={current:()=>childMounted.current&&sameOrigin,assertCurrent(){if(!this.current())throw error(401)}};
  const run=initializer('useMoodboardOperation','run',{pending:{current:false},captureCurrent:()=>guard,setError:()=>{},paint:()=>{paints++},onBusy:signal,owner:old,model:{snapshot:{phase:'creation_uncertain'}},mounted:childMounted});
  const pending=run(async()=>{await d.promise;throw error(503)});
  childMounted.current=false;signal(old.current,false);signal(newOwner,true);if(boardChanged)sameOrigin=false;
  const before=paints;d.resolve();await pending;
  assert.equal(paints,before);assert.equal(recoveryOwners.current.has(old.current),false);assert.equal(operationOwners.current.has(old.current),false);assert.equal(operationOwners.current.has(newOwner),true);
  // Even an erroneously late old callback cannot register recovery in a new board.
  sameOrigin=false;signal(old.current,false,true);assert.equal(recoveryOwners.current.has(old.current),false);assert.equal(operationOwners.current.has(newOwner),true);
 }
});
test('actual navigation getter integrates shared link/unload/traverse protection and releases obsolete actor',()=>{
 const sesion={token:'A',usuario:{id:1,rol:'diseno'}},operationOwners={current:new Set([Symbol()])},recoveryOwners={current:new Set()};let live=sesion;
 const status=initializer('MoodboardContent','moodboardNavigationStatus',{sesion,getSesion:()=>live,createCapturedRequest,api:()=>{},mounted:{current:true},operationOwners,recoveryOwners});
 const win=new EventTarget();win.location=new URL('https://render.test/moodboards?board=7');win.navigation=new EventTarget();let confirmations=0;win.confirm=()=>{confirmations++;return false};
 const unregister=registerNavigationGuard(win,status),installed=installUnsavedNavigation(win);
 const link=()=>{const event=new Event('render:before-navigation',{cancelable:true});event.detail={href:'/inicio'};win.dispatchEvent(event);return event};
 assert.equal(link().defaultPrevented,true);assert.equal(confirmations,0);
 const unload=new Event('beforeunload',{cancelable:true});win.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
 const traverse=new Event('navigate',{cancelable:true});Object.assign(traverse,{navigationType:'traverse',destination:{sameDocument:true,url:'https://render.test/inicio'}});win.navigation.dispatchEvent(traverse);assert.equal(traverse.defaultPrevented,true);
 operationOwners.current.clear();recoveryOwners.current.add(Symbol());assert.equal(link().defaultPrevented,true);assert.equal(confirmations,1);
 live={token:'B',usuario:{id:2,rol:'admin'}};assert.deepEqual(status(),{dirty:false,busy:false});assert.equal(link().defaultPrevented,false);
 unregister();installed.dispose();
});
test('actual panel uses fresh visible peer link/unlink and click intent agrees before passive observe',()=>{
 for(const visible of [true,false]){
  const model={isLinked:()=>!visible,change:(id,desired)=>{assert.equal(id,3);assert.equal(desired,!visible)}};
  const isLinked=initializer('ReferencePanel','isLinked',{state:{locked:false},model,item:row(visible)});
  assert.equal(isLinked(3),visible);
  const toggle=initializer('ReferencePanel','toggle',{write:{busy:false,snapshot:{locked:false}},run:action=>action(),model,isLinked});toggle({id:3});
  const locked=initializer('ReferencePanel','isLinked',{state:{locked:true},model,item:row(visible)});assert.equal(locked(3),!visible);
 }
});
test('actual finish consumes only task query preserving board/client/hash and does not remount',()=>{
 const locationRef={current:{selection:{boardId:7,clientId:2,taskId:3},error:''}},calls=[];let state,closed=false;
 const window={location:{href:'https://render.test/moodboards?board=7&cliente=2&task=3&other=x#note'},history:{state:{keep:1},replaceState(...args){calls.push(args)}}};
 const finish=initializer('MoodboardContent','finishReference',{window,originCurrent:()=>true,locationRef,setLocation:x=>{state=x},setComposer:x=>{closed=!x}});
 finish({assertCurrent(){}});assert.equal(calls[0][2],'/moodboards?board=7&cliente=2&other=x#note');assert.equal(state.selection.taskId,null);assert.equal(closed,true);
});
test('actual parent load returns coherent recovery snapshot and propagates only requested failures',async()=>{
 for(const shouldThrow of [false,true]){
  const session={token:'A',usuario:{id:1,rol:'diseno'}},failure=error(503),effects=[];
  const deps={sesion:session,getSesion:()=>session,mounted:{current:true},boardObservation:{current:{id:7}},boardLoader:{current:null},loadGeneration:{current:0},locationRef:{current:{selection:null}},catalog:{current:[]},createCapturedRequest,createMoodboardBoardLoader,api:async()=>{throw failure},moodboardTaskIntent:()=>null};
  for(const name of ['Loading','Refs','Categories','Tasks','ContextTask','Error','Selected','Composer','Boards'])deps[`set${name}`]=value=>effects.push([name,value]);
  const load=initializer('MoodboardContent','load',deps),pending=load(7,deps.boardObservation.current,false,{throwOnError:shouldThrow});
  if(shouldThrow)await assert.rejects(pending,e=>e===failure);else assert.equal(await pending,undefined);
  assert.ok(effects.some(([name])=>name==='Error'));assert.deepEqual(effects.at(-1),['Loading',false]);
  deps.api=async url=>url.endsWith('/references')?[row()]:[];
  const result=await initializer('MoodboardContent','load',deps)(7);assert.deepEqual(result,{references:[row()],categories:[],tasks:[]});
 }
});
test('actual parent load board ABA/session/unmount suppresses late data, errors and callbacks',async()=>{
 for(const boundary of ['boardABA','session','unmount'])for(const reject of [false,true]){
  const session={token:'A',usuario:{id:1,rol:'admin'}},calls=[],effects=[];
  const deps={sesion:session,getSesion:()=>session,mounted:{current:true},boardObservation:{current:{id:7}},boardLoader:{current:null},loadGeneration:{current:0},locationRef:{current:{selection:null}},catalog:{current:[]},createCapturedRequest,createMoodboardBoardLoader,api:()=>{const d=deferred();calls.push(d);return d.promise},moodboardTaskIntent:()=>null};
  for(const name of ['Loading','Refs','Categories','Tasks','ContextTask','Error','Selected','Composer','Boards'])deps[`set${name}`]=value=>effects.push([name,value]);
  const pending=initializer('MoodboardContent','load',deps)(7),count=effects.length;
  if(boundary==='boardABA')deps.boardObservation.current={id:7};else if(boundary==='session')session.token='B';else deps.mounted.current=false;
  calls.forEach(d=>reject?d.reject(error(500)):d.resolve([]));await pending;assert.equal(effects.length,count);
 }
});
test('actual full-board load updates rail/catalog 0→1→0, preserving IDs, clients and other boards independently of gallery filters',async()=>{
 const session={token:'A',usuario:{id:1,rol:'diseno'}},clients=[{id:2,nombre:'Client'}],other={id:8,nombre:'Other',clientes:[],total_referencias:42};
 let boards=[{id:7,nombre:'Selected',clientes:clients,total_referencias:0},other],references=[];
 const deps={sesion:session,getSesion:()=>session,mounted:{current:true},boardObservation:{current:{id:7}},boardLoader:{current:null},loadGeneration:{current:0},locationRef:{current:{selection:null}},catalog:{current:boards},createCapturedRequest,createMoodboardBoardLoader,
   api:async url=>url.endsWith('/references')?references:[],moodboardTaskIntent:()=>null,status:'aprobada',query:'does-not-match',
   setBoards:update=>{boards=update(boards)}};
 for(const name of ['Loading','Refs','Categories','Tasks','ContextTask','Error','Selected','Composer'])deps[`set${name}`]=()=>{};
 const load=initializer('MoodboardContent','load',deps);
 await load(7);assert.equal(boards[0].total_referencias,0);
 references=[{...row(),estado:'descartada'}];await load(7);assert.equal(boards[0].total_referencias,1,'Count comes from the full response, not the approved/search-filtered gallery');
 assert.equal(deps.catalog.current[0].total_referencias,1);assert.equal(boards[0].clientes,clients);assert.equal(boards[1],other);assert.equal(deps.catalog.current[1],other);assert.deepEqual(boards.map(item=>item.id),[7,8]);
 references=[];await load(7);assert.equal(boards[0].total_referencias,0);assert.equal(deps.catalog.current[0].total_referencias,0);assert.equal(boards[1].total_referencias,42);
});
test('held old-board/account/generation result and deferred rail updater cannot overwrite current counts',async()=>{
 for(const boundary of ['boardABA','session','unmount','generation'])for(const deferredUpdater of [false,true]){
   const session={token:'A',usuario:{id:1,rol:'diseno'}},gates=[],initial=[{id:7,total_referencias:0},{id:8,total_referencias:5}];let update=null,updates=0;
   const deps={sesion:{token:'A',usuario:{id:1,rol:'diseno'}},getSesion:()=>session,mounted:{current:true},boardObservation:{current:{id:7}},boardLoader:{current:null},loadGeneration:{current:0},locationRef:{current:{selection:null}},catalog:{current:initial},createCapturedRequest,createMoodboardBoardLoader,moodboardTaskIntent:()=>null,
     api:()=>{const gate=deferred();gates.push(gate);return gate.promise},setBoards:value=>{update=value;updates++}};
   for(const name of ['Loading','Refs','Categories','Tasks','ContextTask','Error','Selected','Composer'])deps[`set${name}`]=()=>{};
   const pending=initializer('MoodboardContent','load',deps)(7);
   const invalidate=()=>{if(boundary==='boardABA')deps.boardObservation.current={id:7};else if(boundary==='session')session.token='B';else if(boundary==='unmount')deps.mounted.current=false;else deps.loadGeneration.current++;};
   if(!deferredUpdater)invalidate();gates[0].resolve([row()]);gates[1].resolve([]);gates[2].resolve([]);await pending;
   if(deferredUpdater){assert.equal(updates,1);invalidate();assert.equal(update(initial),initial,'React updater rechecks scope and generation when executed');}
   else{assert.equal(updates,0);assert.equal(deps.catalog.current,initial,'Stale response cannot update the synchronous catalog either');}
 }
});
test('JSX wiring keeps stable model, rendered actor and one caught mutation gate',()=>{
 assert.equal(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React},reportDiagnostics:true}).diagnostics.length,0);
 assert.match(source,/useState\(\(\)=>factory\(captureCurrent\)\)/);
 assert.match(source,/session:sesion,readSession:getSesion,request:api/);
 assert.match(source,/saved=\{finishReference\}/);
 const panel=source.slice(source.indexOf('function ReferencePanel'),source.indexOf('function Composer'));
 assert.doesNotMatch(panel,/await api\(/);assert.match(panel,/submit\('edit',item,\{status\}\)/);assert.match(panel,/submit\('delete',item\)/);assert.match(panel,/disabled=\{locked\}/);
 assert.match(source,/if\(options.throwOnError\)throw reason/);
});
test('both recovery surfaces use scoped quiet controls, shared gutters and 44px mobile targets',()=>{
 const css=readFileSync(new URL('../../pages/MoodboardPreview.css',import.meta.url),'utf8');
 for(const owner of ['Composer','ReferencePanel']){
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===owner);
  assert.match(fn.getText(ast),/className="moodboard-detail-section moodboard-recovery"/);
 }
 const rule=selector=>{const start=css.indexOf(selector+'{');assert.notEqual(start,-1,selector);return css.slice(start,css.indexOf('}',start)+1)};
 const recovery=rule('.moodboard-recovery'),button=rule('.moodboard-recovery>button');
 assert.match(recovery,/flex-wrap:wrap/);assert.match(recovery,/gap:8px/);assert.match(recovery,/padding:16px/);assert.match(recovery,/font-size:13px/);
 for(const expected of [/min-height:44px/,/max-width:100%/,/min-width:0/,/font:inherit/,/font-size:13px/,/border:1px solid #d7dcd3/,/border-radius:9px/,/white-space:normal/])assert.match(button,expected);
 assert.match(rule('.moodboard-composer>.moodboard-recovery'),/margin:16px 22px/);
 assert.match(rule('.moodboard-composer>.moodboard-error'),/margin:14px 22px/);
 assert.match(rule('.moodboard-recovery>button:focus-visible'),/outline:2px solid/);
});
