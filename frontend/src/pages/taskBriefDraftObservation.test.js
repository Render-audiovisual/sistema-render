import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { getUnifiedTaskContent, getCanonicalTaskContentMetadata, isLinkedProductionEditorialTask } from '../features/render-os/utils/task-content.js';
import { canonicalTaskState } from '../features/render-os/constants.js';
import { canRetryTaskUpdate, canUserMoveTaskToState } from '../workspace-task-state.js';
import { isTaskDraftDirty } from './taskNavigationGuard.js';

// Actual JSX handlers/effects and actual strict update queue. Only React's
// scheduling/setters and transport are fixtures; no mounted/native/DB claim.
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
function one(root, predicate) {
  const found = []; function walk(n) { if (predicate(n)) found.push(n); ts.forEachChild(n, walk); }
  walk(root); assert.equal(found.length, 1); return found[0];
}
const component = name => one(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const detail = component('TaskDetail');
const init = (name, owner = detail) => one(owner, n => ts.isVariableDeclaration(n) && n.name.getText(file) === name).initializer;
const reset = one(detail, n => ts.isIfStatement(n) && n.expression.getText(file).includes('briefDraftOwner.current.taskId'));
const observe = one(detail, n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect'
  && n.arguments[0]?.getText(file).includes('draftSourceRef.current = task')).arguments[0];
const readEffect = one(detail, n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect'
  && n.arguments[0]?.getText(file).includes('setComments([])')).arguments[0];
const input = one(component('TaskContentWorkspace'), n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(file) === 'textarea');
const change = input.attributes.properties.find(p => p.name?.getText(file) === 'onChange').initializer.expression;
const evaluate = (node, deps) => Function(...Object.keys(deps), `return (${node.getText(file)});`)(...Object.values(deps));
const execute = (node, deps) => Function(...Object.keys(deps), node.getText(file))(...Object.values(deps));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = (patch = {}) => ({ id:5,revision:1,updated_at:'2026-10-24T12:00:00.000Z',titulo:'QA216 shared task',
  estado:'en_revision',tipo_tarea:'edicion',asignado_a_id:91003,colaborador_ids:[],cliente_id:9,prioridad:'media',
  aclaraciones:'Original brief',propiedades_extra:{workspace:'render_os',resumen:'',etiquetas:[],colaboradores:[],guiones:'',copy_trabajo:''},...patch });
function fixture(transport = async (_url,options) => ({ ...row(),...JSON.parse(options.body),revision:2 })) {
  const store = createBrowserSessionState(), calls=[], effects=[];
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario:{id,rol:'admin',nombre:'QA',usuario:'qa'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43) });
  accept(91001); let active=true, rows=[row()];
  const deps={ task:rows[0],draft:{...rows[0],aclaraciones:getUnifiedTaskContent(rows[0])},draftSourceRef:{current:rows[0]},briefDraftOwner:{current:null},
    editing:false,saving:false,briefError:'',getUnifiedTaskContent,getCanonicalTaskContentMetadata,isLinkedProductionEditorialTask,
    isTaskDraftDirty,canonicalTaskState,canUserMoveTaskToState,isSessionFailure,canRetryTaskUpdate,
    canEditTask:true,canEditVisitClient:true,canEditVisitDate:true,isProductionVisit:false,legacyProductionEnabled:false,
    tasksRef:{current:rows},updateQueuesRef:{current:new Map()},clients:[],sesion:store.getSession(),tags:[],collaborators:[],metadata:rows[0].propiedades_extra,
    markReviewQueueStale(){},logActivity:async()=>{},notify(){},setReviewError:value=>effects.push(['reviewError',value]) };
  const captureFor = session => () => createCapturedRequest({session,readSession:store.getSession,isActive:()=>active,
    request:async(url,options={})=>{
      if (url.includes('/comentarios')) return [];
      calls.push({url,options}); return transport(url,options);
    }});
  deps.captureRequest=captureFor(deps.sesion);
  for(const name of ['DraftState','Saving','BriefError','Editing']) {
    const key=name==='DraftState'?'draft':name[0].toLowerCase()+name.slice(1);
    deps[`set${name}`]=value=>{ deps[key]=typeof value==='function'?value(deps[key]):value;effects.push([key,deps[key]]); };
  }
  deps.setTasks=update=>{rows=update(rows);effects.push(['tasks',rows]);};
  function render() {
    execute(reset,deps); deps.setDraft=evaluate(init('setDraft'),deps);
    deps.metadata=deps.task.propiedades_extra;
  }
  render();
  deps.onUpdate=evaluate(init('updateTask',component('WorkspaceReadOnlyPage')),deps);
  const resetDetailRead = () => {
    const noops=Object.fromEntries(['setComment','setCommenting','setCommentError','setComments','setLinkCopied','setProductionAmount','setProductionDate','setProductionCorrections','setProductionDriveLink','setPublicationResponsible'].map(name=>[name,()=>{}]));
    return evaluate(readEffect,{...deps,...noops,AbortController,apiJson(){},getHoyLocalISO:()=> '2026-10-24',onLoadSubtasks:async()=>[],renderCommentRead(){},
      commentDraftOwner:{current:{readGeneration:0,commentsRead:{confirmed:[]},creation:{snapshot:{busy:false,error:''}},initialized:true}},mergeTaskComments:()=>[]})();
  };
  resetDetailRead();
  return {deps,calls,effects,render,resetDetailRead,get rows(){return rows;},
    type(value){render();evaluate(change,deps)({target:{value}});render();},
    save:()=>evaluate(init('save'),deps)(), retainedSave:()=>evaluate(init('save'),deps),
    cancel:()=>evaluate(init('cancelEditing'),deps)(),retainedCancel:()=>evaluate(init('cancelEditing'),deps),
    observe(task){rows=[task];deps.tasksRef.current=rows;deps.task=task;render();evaluate(observe,deps)();render();},
    switchTask(id){deps.task=row({id});render();resetDetailRead();render();},
    switchSession(id){accept(id);deps.sesion=store.getSession();deps.captureRequest=captureFor(deps.sesion);render();resetDetailRead();render();},
    unmount(){active=false;},
  };
}

test('OP215-01: actual background effect preserves dirty rev1 and strict real queue rejects rev2 without PATCH',async()=>{
  const h=fixture();h.type('My unsaved brief');const owner=h.deps.briefDraftOwner.current;
  h.observe(row({revision:2,aclaraciones:'Collaborator confirmed brief',updated_at:'2026-10-24T12:01:00Z'}));
  assert.equal(h.deps.editing,false,'Always-visible editor does not require explicit editing=true');
  assert.equal(owner.baseline.revision,1);assert.equal(h.deps.draft.aclaraciones,'My unsaved brief');
  await h.save();assert.deepEqual(h.calls,[]);assert.match(h.deps.briefError,/cambió.*borrador/);
  assert.equal(h.deps.draft.aclaraciones,'My unsaved brief');assert.equal(owner.baseline.revision,1);
});

test('normal save sends original CAS once, then confirmed ACK updates baseline and clears dirty',async()=>{
  const h=fixture();h.type('Saved A');await h.save();
  assert.equal(h.calls.length,1);const sent=JSON.parse(h.calls[0].options.body);
  assert.equal(sent.expected_revision,1);assert.equal(sent.aclaraciones,'Saved A');
  assert.equal(h.deps.briefDraftOwner.current.baseline.revision,2);assert.equal(h.deps.draft.revision,2);
  assert.equal(h.deps.draft.aclaraciones,'Saved A');assert.equal(h.deps.briefError,'');assert.equal(h.deps.saving,false);
  assert.equal(isTaskDraftDirty(h.deps.briefDraftOwner.current.baseline,h.deps.draft),false);
});

test('queued save freezes input/CAS before async; changed queue task rejects without hidden rebase',async()=>{
  const gate=deferred(),h=fixture();h.deps.updateQueuesRef.current.set(5,gate.promise);h.type('A');const sent=h.save();
  h.type('B');h.observe(row({revision:2,aclaraciones:'Remote C'}));gate.resolve();await sent;
  assert.deepEqual(h.calls,[]);assert.equal(h.deps.draft.aclaraciones,'B');assert.equal(h.deps.briefDraftOwner.current.baseline.revision,1);
  assert.match(h.deps.briefError,/Cancelar/);assert.equal(h.deps.saving,false);
});

test('queued unchanged task sends A even if draft object is mutated before queue runs',async()=>{
  const gate=deferred(),h=fixture();h.deps.updateQueuesRef.current.set(5,gate.promise);h.type('A');const sent=h.save();
  h.deps.draft.aclaraciones='External mutation after dispatch';gate.resolve();await sent;
  assert.equal(JSON.parse(h.calls[0].options.body).aclaraciones,'A');
});

for(const edits of [['B'],['B','A'],['']]){
  test(`ACK owns baseline but cannot repaint newer unsent edits ${JSON.stringify(edits)}`,async()=>{
    const wait=deferred(),h=fixture(()=>wait.promise);h.type('A');const sent=h.save();await Promise.resolve();
    await h.save();assert.equal(h.calls.length,1,'Synchronous pending fence denies double click');
    for(const value of edits)h.type(value);
    const draft=h.deps.draft,generation=h.deps.briefDraftOwner.current.generation;
    wait.resolve(row({revision:2,aclaraciones:'A'}));await sent;
    assert.equal(h.deps.draft,draft);assert.equal(h.deps.draft.aclaraciones,edits.at(-1));
    assert.equal(h.deps.briefDraftOwner.current.generation,generation);assert.equal(h.deps.briefDraftOwner.current.baseline.revision,2);
    assert.equal(h.deps.saving,false);
  });
}

for(const status of [409,500,undefined]){
  test(`failed write ${status??'network'} exposes brief error and keeps draft/baseline without retry`,async()=>{
    const h=fixture(async()=>{throw Object.assign(new Error('failure'),{status});});h.type('Keep B');await h.save();
    assert.equal(h.deps.draft.aclaraciones,'Keep B');assert.equal(h.deps.briefDraftOwner.current.baseline.revision,1);
    assert.match(h.deps.briefError,status===409?/revisión original/:/Conservamos tu texto/);
    assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,1);
  });
}

test('cancel explicitly adopts current task and resets error; new edit can save its revision',async()=>{
  const h=fixture(async(_url,options)=>({...row({revision:3}),...JSON.parse(options.body),revision:3}));h.type('Old draft');
  h.observe(row({revision:2,aclaraciones:'Remote content'}));await h.save();assert.match(h.deps.briefError,/cambió/);
  h.cancel();assert.equal(h.deps.briefError,'');assert.equal(h.deps.draft.aclaraciones,'Remote content');
  assert.equal(h.deps.briefDraftOwner.current.baseline.revision,2);h.type('New explicit edit');await h.save();
  assert.equal(JSON.parse(h.calls[0].options.body).expected_revision,2);
});

test('pristine remote observation advances baseline; same-owner read reset cannot retire dirty baseline/pending save',async()=>{
  const wait=deferred(),h=fixture(()=>wait.promise);h.observe(row({revision:2,aclaraciones:'Remote'}));
  assert.equal(h.deps.briefDraftOwner.current.baseline.revision,2);h.type('A');const sent=h.save();await Promise.resolve();
  const owner=h.deps.briefDraftOwner.current,pending=owner.pending;h.resetDetailRead();
  assert.equal(owner.pending,pending);assert.equal(h.deps.saving,true);assert.equal(h.deps.draft.aclaraciones,'A');
  h.cancel();assert.equal(owner.pending,pending,'Cancel cannot retire dispatched attempt');
  wait.resolve(row({revision:3,aclaraciones:'A'}));await sent;assert.equal(owner.baseline.revision,3);
});

for(const field of ['resumen','etiquetas']){
  test(`remote observation also protects dirty ${field} without explicit editing mode`,()=>{
    const h=fixture();h.deps.setDraft({...h.deps.draft,[field]:'Local draft value'});h.render();
    h.observe(row({revision:2}));assert.equal(h.deps.draft[field],'Local draft value');assert.equal(h.deps.briefDraftOwner.current.baseline.revision,1);
  });
}

for(const transition of ['task','task ABA','session','session ABA','unmount']){
  for(const failure of [false,true]){
    test(`late ${failure?'failure':'ACK'} and retained save/cancel cannot repaint ${transition}`,async()=>{
      const wait=deferred(),h=fixture(()=>wait.promise);h.type('Old A');const oldSave=h.retainedSave(),oldCancel=h.retainedCancel(),sent=oldSave();await flush();
      if(transition.startsWith('task')){h.switchTask(6);if(transition.endsWith('ABA'))h.switchTask(5);}
      else if(transition.startsWith('session')){h.switchSession(91002);if(transition.endsWith('ABA'))h.switchSession(91001);}
      else h.unmount();
      h.type('New draft');const detailEffects=()=>h.effects.filter(([key])=>key!=='tasks');const count=detailEffects().length;
      await oldSave();oldCancel();
      if(failure)wait.reject(new Error('Old failure'));else wait.resolve(row({revision:2,aclaraciones:'Old A'}));await sent;
      assert.equal(detailEffects().length,count);assert.equal(h.deps.draft.aclaraciones,'New draft');assert.equal(h.calls.length,1);
    });
  }
}

test('new-owner reset releases old UI busy; old finally cannot unlock a new pending save',async()=>{
  const waits=[deferred(),deferred()];let n=0;const h=fixture(()=>waits[n++].promise);
  h.type('Old A');const first=h.save();await flush();assert.equal(h.deps.saving,true);
  h.switchTask(6);assert.equal(h.deps.saving,false);h.deps.tasksRef.current=[h.deps.task];h.type('New B');const second=h.save();await flush();
  const owner=h.deps.briefDraftOwner.current,pending=owner.pending;assert.ok(pending);assert.equal(h.deps.saving,true);
  waits[0].resolve(row({revision:2,aclaraciones:'Old A'}));await first;
  assert.equal(owner.pending,pending);assert.equal(h.deps.saving,true);assert.equal(h.deps.draft.aclaraciones,'New B');
  waits[1].resolve(row({id:6,revision:2,aclaraciones:'New B'}));await second;assert.equal(h.deps.saving,false);assert.equal(owner.baseline.revision,2);
});

test('brief error is rendered unconditionally beside editor, not behind review capability',()=>{
  assert.match(detail.getText(file),/\{briefError && <div className="ros-inline-error" role="alert">\{briefError\}<\/div>\}/);
});

for(const status of [undefined,500,502,503]){
  test(`strict PATCH409 + recovery GET ${status??'network'} keeps detail row, original baseline and unsaved brief`,async()=>{
    const h=fixture(async(_url,options)=>{
      throw Object.assign(new Error(options.method==='PATCH'?'Conflict':'Transient read failure'),{status:options.method==='PATCH'?409:status});
    });
    h.type('Keep this draft');const owner=h.deps.briefDraftOwner.current;await h.save();
    assert.deepEqual(h.calls.map(c=>c.options.method||'GET'),['PATCH','GET']);
    assert.equal(h.rows.length,1,'Selected detail must not unmount on an unavailable recovery read');
    assert.equal(h.rows[0].id,5);assert.equal(h.rows[0].revision,1);
    assert.equal(h.rows[0].aclaraciones,'Original brief','Rollback optimistic row without rewriting the local draft');
    assert.equal(h.deps.tasksRef.current[0].revision,1);assert.equal(owner.baseline.revision,1);
    assert.equal(h.deps.draft.aclaraciones,'Keep this draft');assert.match(h.deps.briefError,/revisión original/);
    assert.equal(h.deps.saving,false);
  });
}

for(const status of [401,403,404]){
  test(`authoritative recovery GET ${status} still retires the inaccessible row`,async()=>{
    const h=fixture(async(_url,options)=>{throw Object.assign(new Error('Denied'),{status:options.method==='PATCH'?409:status});});
    h.type('Local brief');await h.save();
    assert.deepEqual(h.calls.map(c=>c.options.method||'GET'),['PATCH','GET']);assert.deepEqual(h.rows,[]);
  });
}

test('ordinary inline update retains its existing recovery-read-failure policy',async()=>{
  const h=fixture(async(_url,options)=>{throw Object.assign(new Error('failure'),{status:options.method==='PATCH'?409:500});});
  await assert.rejects(h.deps.onUpdate(5,{prioridad:'alta'},''),{status:409});assert.deepEqual(h.rows,[]);
});

test('strict HTTP conflict with successful fresh GET preserves dirty baseline and does not retry',async()=>{
  const h=fixture(async(_url,options)=>{if(options.method==='PATCH')throw Object.assign(new Error('Conflict'),{status:409});return row({revision:2,aclaraciones:'Remote authoritative content'});});
  h.type('My brief');await h.save();h.observe(h.rows[0]);
  assert.deepEqual(h.calls.map(c=>c.options.method||'GET'),['PATCH','GET']);
  assert.equal(h.deps.task.revision,2);assert.equal(h.deps.briefDraftOwner.current.baseline.revision,1);
  assert.equal(h.deps.draft.aclaraciones,'My brief');assert.match(h.deps.briefError,/revisión original/);
});
