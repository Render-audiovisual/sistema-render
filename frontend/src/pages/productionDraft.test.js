import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createProductionDraft, productionMediaDraft, productionVisitDraft, verifiedProductionDraftVisit } from './productionDraft.js';
import { productionVisitEditInput } from './productionVisitEdit.js';

const aggregate = (revision=1) => ({id:'visit-a',revision,cliente_id:12,cliente_nombre:'QA',fecha:'2026-10-20',titulo:'QA visit',
  observaciones:'',drive_url:'https://example.invalid/qa',participante_ids:[7],
  videos:[{id:'video-a',visita_id:'visit-a',titulo:'Video',guion:'Original',estado:'planificado',material_url:'',observaciones:''}],
  fotos:[{id:'photo-a',tipo:'Fotos',estado:'realizada',drive_url:'',observaciones:''}]});
const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const found=[];const visit=n=>{if(predicate(n))found.push(n);ts.forEachChild(n,visit)};visit(root);return found;}
const fn=name=>nodes(ast,ts.isFunctionDeclaration).find(n=>n.name?.text===name);
const evaluate=(node,context)=>new Function(...Object.keys(context),`return (${node.getText(ast)});`)(...Object.values(context));

for(const kind of ['videos','fotos'])test(`${kind}: dirty sibling keeps original revision and blocks fresh-prop overwrite`,()=>{
  const a=aggregate(),project=visit=>productionMediaDraft(visit[kind][0],kind);
  const dirty=createProductionDraft(a,project(a)),clean=createProductionDraft(a,project(a));
  dirty.edit({...dirty.snapshot.draft,observaciones:'my draft'});
  const b=aggregate(2);b[kind][0].estado=kind==='videos'?'grabado':'pendiente';
  dirty.observe(b,project(b));clean.observe(b,project(b));
  assert.equal(dirty.snapshot.visit.revision,1);assert.equal(dirty.snapshot.blocked,true);
  assert.equal(dirty.snapshot.draft.observaciones,'my draft');
  assert.equal(clean.snapshot.visit.revision,2);assert.equal(clean.snapshot.draft.estado,b[kind][0].estado);
  assert.throws(()=>dirty.begin(b),{status:409});
  dirty.observe(a,project(a));assert.throws(()=>dirty.begin(a),{status:409},'ABA must not clear conflict');
  assert.equal(dirty.beginReload(()=>false),false);assert.equal(dirty.snapshot.dirty,true);
  assert.equal(dirty.beginReload(()=>true),true);assert.equal(dirty.snapshot.dirty,true,'retain draft until read accepted');
  dirty.complete(b,project(b));assert.equal(dirty.snapshot.dirty,false);
  dirty.edit({...dirty.snapshot.draft,observaciones:'fresh notes'});
  const intent=dirty.begin(b);assert.equal(intent.visit.revision,2);assert.equal(intent.draft.estado,b[kind][0].estado);
});

test('visit and handoff remain bound to observed context, including submit before any observation effect',()=>{
  for(const project of [productionVisitDraft,()=>({editorId:'',date:''})]){
    const a=aggregate(),b=aggregate(2),model=createProductionDraft(a,project(a));
    model.edit({...model.snapshot.draft,observaciones:'edited',editorId:'7',date:'2026-10-29'});
    assert.throws(()=>model.begin(b),{status:409});
    assert.equal(model.snapshot.visit.revision,1);assert.equal(model.snapshot.blocked,true);
  }
});

test('409 readback and uncertain POST never enable second click; reload never retries writes',()=>{
  for(const failure of [Object.assign(new Error('conflict'),{status:409}),new TypeError('network')]){
    const a=aggregate(),model=createProductionDraft(a,productionMediaDraft(null,'videos'));
    model.edit({...model.snapshot.draft,titulo:'new video'});model.begin(a);
    assert.throws(()=>model.begin(a),/otra operación/);
    model.fail(failure);model.observe(aggregate(2),productionMediaDraft(null,'videos'));
    assert.throws(()=>model.begin(aggregate(2)),{status:409});
    assert.equal(model.snapshot.draft.titulo,'new video');
    assert.equal(model.snapshot.uncertain,failure.status!==409);
    assert.equal(model.beginReload(()=>true),true);
    assert.equal(model.snapshot.dirty,true);
    model.complete(aggregate(2),productionMediaDraft(null,'videos'));
    assert.equal(model.snapshot.draft.titulo,'');assert.equal(model.snapshot.blocked,false);
  }
});

test('confirmed save/readback failure is saved, not uncertain; failed recovery preserves saved status',()=>{
  const a=aggregate(),model=createProductionDraft(a,productionVisitDraft(a));
  model.edit({...model.snapshot.draft,titulo:'saved title'});model.begin(a);
  model.fail(Object.assign(new Error('readback unavailable'),{productionSaved:true}));
  assert.equal(model.snapshot.saved,true);assert.equal(model.snapshot.uncertain,false);
  assert.throws(()=>model.begin(a),{status:409});
  assert.equal(model.beginReload(()=>true),true);model.fail(new Error('offline'));
  assert.equal(model.snapshot.saved,true);assert.equal(model.snapshot.uncertain,false);
  assert.equal(model.snapshot.draft.titulo,'saved title');
});

test('incomplete/foreign aggregates cannot replace baseline or clear blocked draft',()=>{
  for(const bad of [{id:'visit-a',revision:2},{...aggregate(2),videos:undefined},{...aggregate(2),fotos:[{}]},
    {...aggregate(2),participante_ids:null},{...aggregate(2),id:'other'}]){
    const a=aggregate(),model=createProductionDraft(a,productionVisitDraft(a));
    model.edit({...model.snapshot.draft,titulo:'preserve'});
    assert.throws(()=>verifiedProductionDraftVisit(bad,'visit-a'));
    model.observe(bad,{});assert.equal(model.snapshot.blocked,true);
    assert.equal(model.beginReload(()=>true),true);
    assert.throws(()=>model.complete(bad,{}));model.fail(new Error('invalid read'));
    assert.equal(model.snapshot.draft.titulo,'preserve');assert.equal(model.snapshot.dirty,true);
  }
  assert.equal(verifiedProductionDraftVisit({visita:aggregate()},'visit-a').revision,1);
});

test('confirmed writes require advancing revision; accepted full readbacks do not regress to old props',()=>{
  const a=aggregate(),b=aggregate(2),model=createProductionDraft(a,productionVisitDraft(a));
  model.edit({...model.snapshot.draft,titulo:'changed'});model.begin(a);
  assert.throws(()=>model.complete(a,productionVisitDraft(a)),{status:409});
  model.complete(b,productionVisitDraft(b));model.observe(a,productionVisitDraft(a));
  assert.equal(model.snapshot.visit.revision,2);assert.equal(model.snapshot.blocked,false);
});

test('actual form submits send captured intent and do not dispatch when stale',async()=>{
  for(const name of ['MediaForm','VisitEditor','SendToEditing']){
    const a=aggregate(),project=name==='VisitEditor'?productionVisitDraft:name==='SendToEditing'?()=>({editorId:'7',date:'2026-10-29'}):v=>productionMediaDraft(v.videos[0],'videos');
    const model=createProductionDraft(a,project(a));let latest=a,writes=0,created=0;
    const form={begin:()=>model.begin(latest),complete:value=>model.complete(value,project(value)),fail:error=>model.fail(error)};
    const context={form,draft:model.snapshot.draft,visit:a,item:a.videos[0],kind:'videos',video:a.videos[0],
      editorId:'7',date:'2026-10-29',hasMaterial:true,positiveId:Number.isSafeInteger,safeProductionUrl:()=>true,
      productionVisitEditInput,setError(){},onCreated(){created++},async onWrite(visit){writes++;assert.equal(visit.revision,1);return aggregate(2)}};
    const declaration=nodes(fn(name),ts.isVariableDeclaration).find(n=>n.name.getText(ast)==='submit');
    const submit=evaluate(declaration.initializer,context);
    latest=aggregate(2);await submit({preventDefault(){}});
    assert.equal(writes,0,name);assert.equal(created,0,name);
  }
});

test('hook mutates latest/observations only in commit effects, reports dirty/pending synchronously',async()=>{
  const refs=[],states=[],effects=[];let refIndex=0,stateIndex=0,latestArgs;
  const reports=[];
  const context={createProductionDraft,verifiedProductionDraftVisit,visitDTO:value=>value?.visita||value,
    useRef:value=>refs[refIndex++] ||= {current:value},
    useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}]},
    useLayoutEffect:effect=>effects.push(effect),window:{confirm:()=>true}};
  const hook=evaluate(fn('useProductionDraft'),context);
  const render=visit=>{refIndex=0;stateIndex=0;effects.length=0;latestArgs={visit,source:productionVisitDraft,key:'visit:visit-a',onDirty:(_key,value)=>reports.push(value),onReload:async()=>aggregate(3)};return hook(latestArgs)};
  let form=render(aggregate());for(const effect of [...effects])effect();
  form.edit({...form.draft,titulo:'dirty'});assert.equal(reports.at(-1),true,'no passive-effect gap after edit');
  const before=JSON.stringify(states[0].snapshot),pointer=refs[0].current;
  form=render(aggregate(2));assert.equal(JSON.stringify(states[0].snapshot),before,'speculative render cannot rebase/block');
  assert.equal(refs[0].current,pointer,'latest pointer remains committed');
  assert.throws(()=>form.begin(),{status:409},'submit before effect independently checks rendered revision');
  assert.equal(reports.at(-1),true);
  for(const effect of [...effects])effect();
  assert.equal(states[0].snapshot.blocked,true);
  await form.reload();assert.equal(states[0].snapshot.visit.revision,3);
  assert.equal(reports.at(-1),false,'clear only after verified reload accepted');
});

test('actual writeVisit distinguishes saved ACK from readback and never falls back to partial response',async()=>{
  const declaration=nodes(fn('ProductionsPage'),ts.isVariableDeclaration).find(n=>n.name.getText(ast)==='writeVisit');
  for(const confirmed of [true,false]){
    let sends=0;
    const write=evaluate(declaration.initializer,{writeLock:{current:false},batchDraft:{current:{dirty:false,busy:false}},setBusy(){},setNotice(){},setReload(){},
      productionWrite:async()=>{sends++;return confirmed?{visita:aggregate(2)}:{id:'video-only'}},
      refreshVisit:async()=>{throw new Error('readback unavailable')},positiveId:Number.isSafeInteger,visitDTO:value=>value?.visita||value});
    await assert.rejects(write(aggregate(),'/videos','POST',{}),error=>{assert.equal(error.productionSaved,confirmed);assert.match(error.message,/No repitas/);return true});
    assert.equal(sends,1);
  }
});

test('recovery UI stays absent on pristine forms; full read validation precedes publication',()=>{
  assert.equal(ast.parseDiagnostics.length,0);
  assert.match(fn('DraftRecovery').getText(ast),/if\(!form.dirty && !form.blocked\)return null/);
  const refresh=nodes(fn('ProductionsPage'),ts.isVariableDeclaration).find(n=>n.name.getText(ast)==='refreshVisit').initializer.getText(ast);
  assert.ok(refresh.indexOf('verifiedProductionDraftVisit(')<refresh.indexOf('setSelected('));
});
