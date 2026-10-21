import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createMoodboardCategoryOperation, moodboardCategoryDraftDirty } from './moodboardCategoryOperation.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { installUnsavedNavigation, registerNavigationGuard } from '../shared/navigation/unsaved.js';
import { requestAppNavigation } from '../shared/navigation/location.js';
const categories = () => [{id:11,nombre:'One',orden:1},{id:12,nombre:'Two',orden:2}];
const observation = (extra = {}) => ({version:1,board_id:9,revision:7,categories:categories(),...extra});
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const requestId = '00000000-0000-4000-8000-000000000001';
function ack(options, extra = {}) {
  return {...observation({revision:10,categories:[{id:11,nombre:'Renamed',orden:1},{id:13,nombre:'New',orden:3}]}),
    operation:{request_id:JSON.parse(options.body).request_id,replayed:false,result_revision:10},...extra};
}
function fixture(request = async (_url,options)=>options.method ? ack(options) : observation(), cookie = false) {
  let origin={},active=true,captures=0,reads=0,refreshError=false,ids=0;
  const store=createBrowserSessionState();
  if(cookie) store.acceptBootstrap(store.beginBootstrap(),{usuario:{id:1,usuario:'qa',nombre:'QA',rol:'admin'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
  let session=cookie?store.getSession():{token:'original',usuario:{id:1,rol:'admin'}};
  const original=session,calls=[];
  const capture=()=>{captures++;const selected=origin;return createCapturedRequest({session,readSession:()=>session,isActive:()=>active&&origin===selected,
    request:async(url,options)=>{calls.push({url,options});return request(url,options,calls.length);}})};
  const refresh=async guard=>{reads++;guard.assertCurrent();if(refreshError)throw Error('overview read failed');return {categories:categories()};};
  const model=createMoodboardCategoryOperation({boardId:9,capture,refresh,uuid:()=>requestId.slice(0,-1)+String(++ids)});
  return {model,calls,capture,refresh,original,get captures(){return captures},get reads(){return reads},
    failRefresh(value){refreshError=value},switch(){session={token:'replacement',usuario:{id:2,rol:'admin'}}},
    boardABA(){origin={};origin={}},unmount(){active=false}};
}
const draft = () => [{id:11,nombre:' Renamed ',orden:1}];

test('fresh snapshot is mandatory; immutable atomic rename/delete/create has one captured scope and synchronous submit guard',async()=>{
  const first=deferred(),f=fixture(async(_url,options)=>{if(!options.method)return observation();await first.promise;return ack(options)});
  await assert.rejects(f.model.save(draft(),'New'));assert.equal(f.calls.length,0);
  const prepared=await f.model.prepare();assert.equal(prepared.revision,7);assert.deepEqual(prepared.categories,categories());
  const edited=draft(),sent=f.model.save(edited,' New ');edited[0].nombre='MUTATED';
  await assert.rejects(f.model.save(draft(),'Duplicate'));await assert.rejects(f.model.prepare());
  assert.equal(f.calls.length,2);assert.equal(f.model.snapshot.busy,true);first.resolve();await sent;
  const write=f.calls[1];assert.equal(write.url,'/api/moodboards/boards/9/category-changes');
  assert.deepEqual(JSON.parse(write.options.body),{request_id:requestId,expected_revision:7,changes:[{type:'rename',id:11,name:'Renamed'},{type:'delete',id:12},{type:'create',name:'New'}]});
  assert.equal(f.captures,1);assert.equal(f.reads,1);assert.equal(f.model.snapshot.phase,'complete');
});
test('uncertainty is locked; only explicit verification retransmits the exact UUID/body and later replay snapshot is current',async()=>{
  let writes=0;
  const f=fixture(async(_url,options)=>{if(!options.method)return observation();if(++writes===1)throw Error('lost response');
    return ack(options,{revision:15,categories:categories(),operation:{request_id:requestId,replayed:true,result_revision:10}})});
  await f.model.prepare();await assert.rejects(f.model.save(draft(),'New'));
  assert.equal(f.model.snapshot.phase,'uncertain');assert.equal(writes,1);
  await assert.rejects(f.model.refresh());await assert.rejects(f.model.save(draft(),'Other'));assert.throws(()=>f.model.adoptReviewed());
  assert.equal(writes,1);const value=await f.model.verify();
  assert.equal(value.revision,15);assert.deepEqual(value.categories,categories(),'Do not infer old intent state from replay');
  assert.equal(f.calls[1].options.body,f.calls[2].options.body);assert.equal(writes,2);assert.equal(f.model.snapshot.phase,'complete');
});
for(const status of [400,404,409,413,422,428])test('definite '+status+' needs explicit read/review/adopt, never rebases or resubmits draft',async()=>{
  let reads=0,writes=0;
  const f=fixture(async(_url,options)=>{if(!options.method)return observation({revision:reads++?20:7});writes++;throw Object.assign(Error('rejected'),{status})});
  await f.model.prepare();await assert.rejects(f.model.save(draft(),'New'));assert.equal(f.model.snapshot.phase,'conflict');
  await assert.rejects(f.model.verify());await assert.rejects(f.model.save(draft(),'New'));
  await f.model.refresh();assert.equal(f.model.snapshot.phase,'conflict');await assert.rejects(f.model.save(draft(),'New'));
  assert.equal(writes,1);assert.equal(JSON.parse(f.calls[1].options.body).expected_revision,7);
  const current=f.model.adoptReviewed();assert.equal(current.revision,20);assert.equal(f.model.snapshot.phase,'idle');
  await assert.rejects(f.model.save(draft(),'Revised'));assert.equal(writes,2);
  const final=JSON.parse(f.calls.at(-1).options.body);assert.equal(final.expected_revision,20);assert.notEqual(final.request_id,requestId);
});
test('confirmed ACK plus failed refresh is read-only recovery, never another mutation',async()=>{
  const f=fixture();await f.model.prepare();f.failRefresh(true);
  await assert.rejects(f.model.save(draft(),'New'));assert.equal(f.model.snapshot.accepted,true);assert.equal(f.model.snapshot.phase,'read_failed');
  await assert.rejects(f.model.verify());assert.equal(f.calls.length,2);
  f.failRefresh(false);await f.model.verify();assert.equal(f.calls.length,2);assert.equal(f.reads,3);assert.equal(f.model.snapshot.phase,'complete');
});
for(const cookie of [false,true])for(const change of ['switch','boardABA','unmount'])test((cookie?'cookie':'bearer')+' '+change+' invalidates held ACK and forbids retry/read',async()=>{
  const pending=deferred(),f=fixture(async(_url,options)=>{if(!options.method)return observation();await pending.promise;return ack(options)},cookie);
  await f.model.prepare();const sent=f.model.save(draft(),'New');f[change]();pending.resolve();await assert.rejects(sent);
  assert.equal(f.model.snapshot.phase,'blocked');await assert.rejects(f.model.verify());await assert.rejects(f.model.refresh());assert.equal(f.calls.length,2);
  if(cookie)assert.equal(f.calls[1].options.sessionIntent.session,f.original);else assert.equal(f.calls[1].options.headers.Authorization,'Bearer original');
});
for(const patch of [{board_id:10},{version:2},{revision:'7'},{extra:true},{categories:[{id:11,nombre:'One',orden:1,board_id:9}]},{categories:[categories()[0],categories()[0]]}])
test('snapshot fails closed '+JSON.stringify(patch),async()=>{
  const f=fixture(async()=>observation(patch));await assert.rejects(f.model.prepare());await assert.rejects(f.model.save(draft(),'New'));assert.equal(f.calls.length,1);
});
for(const patch of [{board_id:10},{revision:6},{operation:{request_id:requestId,replayed:false,result_revision:7}},
  {operation:{request_id:requestId,replayed:'true',result_revision:10}},
  {operation:{request_id:'00000000-0000-4000-8000-000000000099',replayed:true,result_revision:10}},
  {operation:{request_id:requestId,replayed:false,result_revision:9}},
  {operation:{request_id:requestId,replayed:true,result_revision:11}},
  {operation:{request_id:requestId,replayed:true,result_revision:10,extra:true}}])
test('invalid mutation identity/revision stays uncertain '+JSON.stringify(patch),async()=>{
  const f=fixture(async(_url,options)=>options.method?ack(options,patch):observation());await f.model.prepare();await assert.rejects(f.model.save(draft(),'New'));
  assert.equal(f.model.snapshot.phase,'uncertain');assert.equal(f.model.snapshot.accepted,false);assert.equal(f.reads,0);assert.throws(()=>f.model.adoptReviewed());
});
test('foreign IDs, duplicate IDs, blanks, and no-op fail without POST',async()=>{
  const f=fixture();await f.model.prepare();
  for(const rows of [[{id:99,nombre:'Foreign'}],[...categories(),categories()[0]],[{id:11,nombre:' '}],categories()])await assert.rejects(f.model.save(rows,''));
  assert.equal(f.calls.length,1);assert.equal(f.model.snapshot.phase,'idle');
});
test('each StrictMode-like setup owns a fresh model; canceled first read/ACK cannot mutate the replacement',async()=>{
  const pending=deferred(),f=fixture(async()=>pending.promise);
  const old=f.model.prepare();f.model.cancel();
  const next=createMoodboardCategoryOperation({boardId:9,capture:f.capture,refresh:f.refresh});
  const fresh=next.prepare();pending.resolve(observation());await assert.rejects(old);await fresh;
  assert.equal(next.snapshot.phase,'idle');assert.equal(f.model.snapshot.phase,'blocked');await assert.rejects(f.model.prepare());
});
const source=readFileSync(new URL('./MoodboardPreview.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('MoodboardPreview.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=(root,predicate)=>{const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit)};visit(root);return result};
const editor=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CategoryEditor');
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${node.getText(file)});`)(...Object.values(deps));
const callback=(name,deps)=>evaluate(nodes(editor,node=>ts.isVariableDeclaration(node)&&node.name.getText(file)===name)[0].initializer,deps);
test('actual editor owns fresh setup/cleanup, reads before editing, stages deletion, shares scoped parent ownership',()=>{
  assert.equal(file.parseDiagnostics.length,0);const text=editor.getText(file);
  assert.doesNotMatch(text,/useMoodboardOperation|api\(/);
  assert.match(text,/model\.prepare\(\)/);assert.match(text,/entry\.model\.cancel\(\)/);
  assert.match(text,/Todos los cambios se guardan juntos/);assert.doesNotMatch(text,/guardado parcial|Cada cambio se guarda por separado/);
  const entry=nodes(file,node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='CategoryEditor')[0].getText(file);
  for(const prop of ['capture={captureOperation}','reload={reloadOperation}','onBusy={onOperationBusy}','scope.assertCurrent()'])assert.ok(entry.includes(prop));
});
test('actual effect replay creates two instances, cancels only old setup, and applies only live prepared draft',async()=>{
  const effects=[],models=[],drafts=[],ownership=[],holder={current:null},scope={current:()=>true};
  const initial={current:{capture:()=>scope,reload(){},onBusy:(...args)=>ownership.push(args)}};
  const layout=nodes(editor,node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useLayoutEffect')[0];
  const run=async(action,done)=>{const own=holder.current;const result=await action(own.model);if(own.active&&holder.current===own)done(result)};
  const effect=evaluate(layout.arguments[0],{holder,initial,boardId:9,run,installDraft:value=>drafts.push(value),
    operationOwner:{current:'operation'},draftOwner:{current:'draft'},
    createMoodboardCategoryOperation:options=>{const gate=deferred(),model={options,prepare:()=>gate.promise,cancel(){this.canceled=true}};models.push(model);effects.push(gate);return model}});
  const cleanupOld=effect();cleanupOld();const cleanupNew=effect();assert.equal(models[0].canceled,true);assert.equal(models[1].canceled,undefined);
  effects[0].resolve(observation({revision:1}));effects[1].resolve(observation({revision:2}));await Promise.resolve();await Promise.resolve();
  assert.deepEqual(drafts.map(row=>row.revision),[2]);assert.equal(models[1].options.capture(),scope);cleanupNew();assert.equal(models[1].canceled,true);
});
test('actual run synchronously fences duplicate submit and stale cleanup never releases replacement owner',async()=>{
  const gate=deferred(),ownership=[],entry={active:true,pending:false,scope:{current:()=>true},model:{snapshot:{phase:'uncertain'}}},holder={current:entry};
  const run=callback('run',{holder,initial:{current:{onBusy:(...args)=>ownership.push(args)}},operationOwner:{current:'owner'},setError(){},paint(){}});
  const first=run(()=>gate.promise);await run(()=>assert.fail('duplicate'));assert.equal(entry.pending,true);assert.equal(ownership.length,1);
  entry.active=false;holder.current={active:true};gate.resolve({});await first;assert.equal(ownership.length,1,'Old finally cannot clear new setup');
});
test('actual removal only stages draft and dirty owner; never starts a write',()=>{
  const draftObservation={current:{draft:categories(),newCategory:'New'}},dirty=[];
  callback('remove',{editable:()=>true,confirm:()=>true,draftObservation,setDraft(){},syncDraftOwner:()=>dirty.push(true)})({id:11,nombre:'One'});
  assert.deepEqual(draftObservation.current.draft,[categories()[1]]);assert.equal(draftObservation.current.newCategory,'New');assert.equal(dirty.length,1);
});
test('draft dirty is value-based, not model phase/changed flag; reverting values clears only genuine local changes', () => {
  assert.equal(moodboardCategoryDraftDirty(categories(), categories(), ''), false);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories().map(row => ({ ...row, changed: true })), ''), false);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories().map(row=>({...row,nombre:row.nombre+' edited'})), ''), true);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories(), 'New'), true);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories(), ' '), true);
  assert.equal(moodboardCategoryDraftDirty(categories(), categories().slice(1), ''), true);
});
test('actual draft owner/close callbacks consult product guard: cancel preserves fields, route/unload blocked, discard closes without saved classification', () => {
  const win = new EventTarget(); win.location = new URL('https://render.test/moodboards?board=9');
  const CustomEvent = class extends Event { constructor(type, options) { super(type, options); this.detail = options.detail; } };
  win.CustomEvent = CustomEvent; let accept = false, prompts = 0, closed = 0, saved = 0;
  win.confirm = () => { prompts++; return accept; };
  const operationOwners = { current: new Set() }, recoveryOwners = { current: new Set() }, mounted = { current: true };
  const busyNode = nodes(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'onOperationBusy')[0].initializer;
  const onBusy = evaluate(busyNode, { operationOwners, recoveryOwners, mounted, originCurrent: () => true, setOperationBusy() {} });
  const baseline = { current: categories() }, draftObservation = { current: { draft: categories(), newCategory: '' } }, draftOwner = { current: Symbol('draft') };
  const holder = {current:{active:true,pending:false,scope:{current:()=>true},model:{snapshot:{phase:'idle',busy:false}}}};
  const deps = { baseline, draftObservation, draftOwner, initial:{current:{onBusy}}, holder, editable:()=>!holder.current.pending&&holder.current.model.snapshot.phase==='idle', moodboardCategoryDraftDirty, busy: false,
    model: { snapshot: { phase: 'idle', busy: false } }, setDraft() {}, setNewCategory() {}, saved() { saved++; } };
  deps.syncDraftOwner = callback('syncDraftOwner', deps);
  deps.syncDraftOwner();
  const cleanup = ()=>onBusy(draftOwner.current,false,false);
  const session = { token: 'original', usuario: { id: 1, rol: 'admin' } };
  const statusNode = nodes(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'moodboardNavigationStatus')[0].initializer;
  const status = evaluate(statusNode, { sesion: session, getSesion: () => session, api: () => assert.fail('No mutation on discard'),
    createCapturedRequest, mounted, operationOwners, recoveryOwners });
  const installation = installUnsavedNavigation(win), off = registerNavigationGuard(win, status);
  try {
    const scope = { current: () => true };
    deps.approveDiscard = callback('approveDiscard', { holder, CustomEvent, window: win });
    deps.close = () => { closed++; }; deps.setError = () => assert.fail('Idle draft should use product discard prompt');
    const leave = callback('leave', deps), editName = callback('editName', deps), editNew = callback('editNewName', deps);
    editName(11, 'Unsaved rename'); editNew('Unsaved new category');
    assert.deepEqual(status(), { dirty: true, busy: false }); assert.equal(deps.model.snapshot.phase, 'idle');
    const before = structuredClone(draftObservation.current);
    leave(); assert.equal(closed, 0); assert.equal(prompts, 1); assert.deepEqual(draftObservation.current, before);
    assert.equal(requestAppNavigation(win, '/inicio'), false); assert.deepEqual(draftObservation.current, before);
    const unload = new Event('beforeunload', { cancelable: true }); win.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
    operationOwners.current.add('pending-other-write'); accept = true; leave(); assert.equal(closed, 0, 'Busy product guard still prevents discard'); operationOwners.current.clear();
    accept = false; editName(11, 'One'); editNew(''); assert.deepEqual(status(), { dirty: false, busy: false });
    editNew('Unsaved again'); accept = true; leave(); assert.equal(closed, 1); assert.equal(saved, 0);
    assert.equal(deps.model.snapshot.phase, 'idle'); assert.equal(status().dirty, true, 'Owner lives until actual close/unmount, not a fabricated save');
    cleanup(); assert.deepEqual(status(), { dirty: false, busy: false });
    assert.equal((editor.getText(file).match(/onClick=\{leave\}/g) || []).length, 3, 'Close, backdrop and Cancel share the guarded path');
  } finally { off(); installation.dispose(); }
});
