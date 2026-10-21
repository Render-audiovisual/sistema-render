import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createFeedbackNotesMutation,feedbackNotesMutationBody,parseFeedbackNotesMutation} from './feedbackNotesMutation.js';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
const id='00000000-0000-4000-8000-000000000001';
const old='2026-10-22T10:00:00.123000Z',fresh='2026-10-22T10:00:00.124000Z';
const note=(extra={})=>({id:620,titulo:'Title',contenido:'Content',categoria:'general',feedback:{cliente:'Client',responsable:'Ana',responsables:['Ana'],estado:'pendiente',flujo:'feedback'},creado_por:'Author',modificado_por:'Editor',eliminado_at:null,created_at:old,updated_at:old,resolved_client:'Client',section:'clients',...extra});
const fields=()=>({titulo:'Title',contenido:'Content',categoria:'general',feedback:{cliente:'Client',responsables:['Ana'],flujo:'feedback'}});
const input=(action='create')=>({action,...(action==='create'?{}:{note:note()}),...(['create','edit'].includes(action)?{fields:fields()}:{})});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
function ack(body,extra={}){return{version:1,note:body.action==='purge'?null:note({updated_at:fresh,eliminado_at:body.action==='trash'?fresh:null}),operation:{request_id:body.request_id,action:body.action,note_id:620,note_updated_at:body.action==='purge'?'2026-10-22T10:00:00.123Z':'2026-10-22T10:00:00.124Z',replayed:false},...extra};}
function fixture({transport,refresh:read,cookie=false}={}){
  let active=true,epoch=0,captures=0,reads=0,keys=0;
  const store=createBrowserSessionState();if(cookie)store.acceptBootstrap(store.beginBootstrap(),{usuario:{id:1,usuario:'qa',nombre:'QA',rol:'admin'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
  let session=cookie?store.getSession():{token:'owner',usuario:{id:1,rol:'admin'}};
  const original=session,calls=[],changes=[];
  const capture=()=>{captures++;const origin=epoch;return createCapturedRequest({session,readSession:()=>session,isActive:()=>active&&epoch===origin,
    request:async(url,options)=>{calls.push({url,options});return transport?transport(url,options):url.includes('/similares')?{similares:[]}:ack(JSON.parse(options.body));}})};
  const model=createFeedbackNotesMutation({capture,refresh:async(scope,value)=>{reads++;return read?read(scope,value):{items:[value?.note].filter(Boolean)}} ,onChange:value=>changes.push(value),randomUUID:()=>id.slice(0,-1)+String(++keys)});
  return{model,calls,changes,original,get captures(){return captures},get reads(){return reads},switch(){session={token:'other',usuario:{id:2,rol:'community'}}},context(){epoch++},aba(){epoch++;epoch++},unmount(){active=false}};
}
for(const action of ['create','edit','trash','restore','purge'])test(action+' sends dedicated closed operation with observed version; no source DTO/provenance copied',async()=>{
  const f=fixture(),observed=input(action);if(action==='restore'||action==='purge')observed.note=note({eliminado_at:old});
  const result=await f.model.start(observed);assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/notas/operaciones');assert.equal(f.calls[0].options.method,'POST');
  const body=JSON.parse(f.calls[0].options.body);assert.equal(body.request_id,id);assert.equal(body.action,action);
  if(action==='create'){assert.equal(Object.hasOwn(body,'note_id'),false);assert.equal(Object.hasOwn(body,'expected_updated_at'),false)}else{assert.equal(body.note_id,620);assert.equal(body.expected_updated_at,old)}
  assert.equal(f.captures,1);assert.equal(f.reads,1);assert.equal(f.model.snapshot.phase,'complete');assert.equal(result.ack.operation.note_id,620);
  f.model.complete();assert.equal(f.model.snapshot.locked,false);
});
test('body is immutable and UUID/capture precede held duplicate check; synchronous duplicate submit is denied',async()=>{
  const gate=deferred(),f=fixture({transport:async(url,options)=>url.includes('similares')?gate.promise:ack(JSON.parse(options.body))}),value=input();
  const first=f.model.start(value,{checkDuplicates:true});value.fields.titulo='Changed';value.fields.feedback.responsables.push('Injected');
  await assert.rejects(f.model.start(input()));assert.equal(f.captures,1);assert.equal(f.calls.length,1);
  gate.resolve({similares:[{id:1000,titulo:'Duplicate',cliente:'Client'}]});const result=await first;
  assert.equal(result.duplicates[0].id,1000);assert.equal(f.model.snapshot.phase,'duplicates');assert.equal(f.calls.length,1);
  await f.model.confirmCreate();const body=JSON.parse(f.calls[1].options.body);assert.equal(body.request_id,id);assert.equal(body.fields.titulo,'Title');assert.deepEqual(body.fields.feedback.responsables,['Ana']);
});
test('known-unsent duplicate can be released explicitly; failed preflight never dispatches POST or leaves uncertain receipt',async()=>{
  const f=fixture({transport:async()=>({similares:[{id:620,titulo:'Old'}]})});await f.model.start(input(),{checkDuplicates:true});f.model.releaseUnsent();assert.equal(f.model.snapshot.phase,'idle');assert.equal(f.model.snapshot.locked,false);
  const bad=fixture({transport:async()=>{throw Error('GET failed')}});await assert.rejects(bad.model.start(input(),{checkDuplicates:true}));assert.equal(bad.model.snapshot.phase,'idle');assert.equal(bad.model.snapshot.locked,false);assert.equal(bad.calls.length,1);
});
for(const action of ['create','edit','trash','restore'])test(action+' unknown outcome only verifies exact same UUID/body, never GET-rebases or new intent',async()=>{
  let writes=0;const f=fixture({transport:async(_url,options)=>{const body=JSON.parse(options.body);if(++writes===1)throw Error('Response lost');return ack(body,{note:note({updated_at:'2026-10-22T10:00:00.130000Z',eliminado_at:action==='restore'?fresh:null}),operation:{...ack(body).operation,replayed:true}})}});
  await assert.rejects(f.model.start(input(action)));assert.equal(f.model.snapshot.phase,'uncertain');assert.equal(f.model.snapshot.locked,true);await assert.rejects(f.model.start(input(action)));await assert.rejects(f.model.observe());assert.throws(()=>f.model.complete());
  const result=await f.model.verify();assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.equal(result.ack.note.updated_at,'2026-10-22T10:00:00.130000Z');assert.equal(result.ack.operation.replayed,true);
});
test('ACK confirmed then read failed retries only refresh; accepted receipt cannot be POSTed again',async()=>{
  let failing=true;const f=fixture({refresh:async()=>{if(failing)throw Error('GET failed');return{items:[]}}});
  await assert.rejects(f.model.start(input()));assert.equal(f.model.snapshot.phase,'read_failed');assert.equal(f.model.snapshot.accepted.note.id,620);
  await assert.rejects(f.model.verify());assert.equal(f.calls.length,1);failing=false;await f.model.verify();assert.equal(f.calls.length,1);assert.equal(f.reads,3);assert.equal(f.model.snapshot.phase,'complete');
});
test('purged create replay is confirmed/unavailable, never a fabricated replacement or extra POST',async()=>{
  let count=0;const f=fixture({transport:async(_url,options)=>{if(++count===1)throw Error('lost');const body=JSON.parse(options.body);return ack(body,{note:null,operation:{...ack(body).operation,replayed:true}})}});
  await assert.rejects(f.model.start(input()));const result=await f.model.verify();assert.equal(result.ack.note,null);assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.body,f.calls[1].options.body);
});
test('409 explicit observation can cross to trash but never rebases preserved intent/draft',async()=>{
  const value=input('edit'),before=structuredClone(value);let get=0;
  const f=fixture({transport:async(url,options)=>{if(options.method==='POST')throw Object.assign(Error('Stale'),{status:409});if(++get===1)throw Object.assign(Error('Not in live collection'),{status:404});return{version:1,item:note({updated_at:fresh,eliminado_at:fresh})}}});
  await assert.rejects(f.model.start(value));assert.equal(f.model.snapshot.phase,'conflict');await assert.rejects(f.model.verify());await assert.rejects(f.model.start(input('edit')));assert.equal(f.calls.length,1);
  await f.model.observe();assert.equal(f.model.snapshot.phase,'reviewed');assert.equal(f.model.snapshot.observed.note.eliminado_at,fresh);assert.deepEqual(value,before);assert.equal(JSON.parse(f.calls[0].options.body).expected_updated_at,old);
  const current=f.model.releaseConflict();assert.equal(current.note.updated_at,fresh);assert.equal(f.model.snapshot.locked,false);assert.equal(f.calls.filter(row=>row.options.method==='POST').length,1);
});
for(const status of [400,413,422,428])test('definite '+status+' precommit rejection permits corrected new intent only by explicit submit',async()=>{
  let count=0;const f=fixture({transport:async(_url,options)=>{if(++count===1)throw Object.assign(Error('Bad input'),{status});return ack(JSON.parse(options.body))}});
  await assert.rejects(f.model.start(input()));assert.equal(f.model.snapshot.phase,'idle');assert.equal(f.model.snapshot.locked,false);assert.equal(f.calls.length,1);await f.model.start(input());assert.notEqual(JSON.parse(f.calls[0].options.body).request_id,JSON.parse(f.calls[1].options.body).request_id);
});
for(const patch of [{version:2},{note:note({id:621,updated_at:fresh})},{operation:{request_id:id,action:'restore',note_id:620,note_updated_at:fresh,replayed:false}},{operation:{request_id:id,action:'create',note_id:620,note_updated_at:fresh,replayed:'true'}},{note:note({updated_at:old})},{note:null},{extra:true}])test('malformed ACK stays uncertain '+JSON.stringify(patch),async()=>{
  const f=fixture({transport:async(_url,options)=>ack(JSON.parse(options.body),patch)});await assert.rejects(f.model.start(input()));assert.equal(f.model.snapshot.phase,'uncertain');assert.equal(f.model.snapshot.accepted,null);assert.equal(f.reads,0);
});
test('fresh ACK verifies timestamp instant across ms/µs, immutable ID/action, and current replay monotonicity',()=>{
  const body=feedbackNotesMutationBody(input('edit'),id);assert.equal(parseFeedbackNotesMutation(ack(body),body).note.id,620);
  assert.throws(()=>parseFeedbackNotesMutation(ack(body,{operation:{...ack(body).operation,note_id:1}}),body));
  assert.throws(()=>parseFeedbackNotesMutation(ack(body,{note:note({updated_at:old}),operation:{...ack(body).operation,replayed:true}}),body));
});
for(const cookie of [false,true])for(const change of ['switch','context','aba','unmount'])test((cookie?'cookie':'bearer')+' '+change+' while ACK held cannot publish, refresh, verify or recapture',async()=>{
  const gate=deferred(),f=fixture({cookie,transport:async()=>gate.promise});const pending=f.model.start(input());const count=f.changes.length;f[change]();gate.resolve(ack(JSON.parse(f.calls[0].options.body)));await assert.rejects(pending);
  assert.equal(f.model.snapshot.phase,'blocked');assert.equal(f.reads,0);assert.equal(f.changes.length,count);await assert.rejects(f.model.verify());assert.equal(f.calls.length,1);assert.equal(f.captures,1);
  if(cookie)assert.equal(f.calls[0].options.sessionIntent.session,f.original);else assert.equal(f.calls[0].options.headers.Authorization,'Bearer owner');
});
for(const change of ['switch','aba'])test(change+' during preflight denies later mutation from captured actor',async()=>{
  const gate=deferred(),f=fixture({transport:async()=>gate.promise}),pending=f.model.start(input(),{checkDuplicates:true});f[change]();gate.resolve({similares:[]});await assert.rejects(pending);assert.equal(f.calls.length,1);assert.equal(f.reads,0);
});
test('fresh effect model survives canceled predecessor; old readback cannot complete new context',async()=>{
  const gate=deferred(),oldModel=fixture({refresh:async()=>gate.promise}),pending=oldModel.model.start(input());await Promise.resolve();await Promise.resolve();oldModel.model.cancel();
  const next=fixture();await next.model.start(input());gate.resolve({items:[]});await assert.rejects(pending);assert.equal(next.model.snapshot.phase,'complete');assert.equal(oldModel.model.snapshot.phase,'blocked');
});
test('validation rejects unobserved versions, IDs and private metadata before dispatch',()=>{
  for(const value of [{action:'edit',note:{id:620},fields:fields()},{action:'trash',note:{id:'620',updated_at:old}},{...input(),fields:{...fields(),private:'x'}},{...input(),fields:{...fields(),feedback:{wilson_idempotency_key:'x'}}},{action:'purge',note:note(),fields:{}}])assert.throws(()=>feedbackNotesMutationBody(value,id));
});
test('legacy nullable business fields remain compatible without admitting provenance or arbitrary JSON',()=>{
  const value=input('edit');value.fields.feedback={cliente:null,referencia:null,responsable:null,responsables:null,estado:null,vigencia:null,flujo:null};
  const body=feedbackNotesMutationBody(value,id);assert.deepEqual(body.fields.feedback,value.fields.feedback);assert.notEqual(body.fields.feedback,value.fields.feedback);
});
const source=readFileSync(new URL('./Feedback.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('Feedback.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=(root,predicate)=>{const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit)};visit(root);return result};
const component=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='FeedbackContent');
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${node.getText(file)});`)(...Object.values(deps));
const handler=(name,deps)=>evaluate(nodes(component,node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)[0],deps);
test('actual ACK callback settles receipt before invalidating context, seeds verified page, does not invent purged note',()=>{
  for(const current of [note(),null]){const effects=[],result={ack:{note:current,operation:{replayed:true}},data:{items:[]}};
    handler('acceptMutation',{mutationRef:{current:{model:{snapshot:{phase:'complete'},complete:()=>effects.push('settled')}}},trash:false,setSelected:value=>effects.push(['selected',value]),setDraft(){},setBaseline(){},setDuplicates(){},setConflict(){},setError(){},setMessage:value=>effects.push(value),markFeedbackSeen(){},sesion:null,restartNotes:(...args)=>effects.push(['restart',...args])})(result);
    assert.equal(effects[0],'settled');assert.deepEqual(effects.at(-1),['restart',current,result.data]);if(!current)assert.ok(effects.some(value=>typeof value==='string'&&value.includes('eliminada definitivamente')));
  }
});
test('actual UI gate is synchronous before render, rejects duplicate action and suppresses old-context ACK',async()=>{
  const gate=deferred(),entry={active:true,scope:{current:()=>true},model:{}},mutationRef={current:entry},lock={current:false},accepted=[];
  const run=handler('runMutation',{mutationRef,lock,setBusy(){},setError(){},setConflict(){},setDuplicates(){},acceptMutation:result=>accepted.push(result)});
  const pending=run(()=>gate.promise);assert.equal(lock.current,true);await run(()=>assert.fail('double submit'));entry.scope.current=()=>false;gate.resolve({ack:{}});await pending;assert.deepEqual(accepted,[]);
});
test('old-context finally cannot clear the lock owned by a newer operation',async()=>{
  const gate=deferred(),entry={active:true,scope:{current:()=>true},model:{}},mutationRef={current:entry},lock={current:false};
  const run=handler('runMutation',{mutationRef,lock,setBusy:()=>{},setError(){},setConflict(){},setDuplicates(){},acceptMutation:()=>assert.fail('Old ACK')});
  const pending=run(()=>gate.promise);entry.active=false;entry.scope.current=()=>false;mutationRef.current={active:true,scope:{current:()=>true},model:{}};lock.current=true;
  gate.resolve({ack:{}});await pending;assert.equal(lock.current,true);
});
test('actual recovery close guard denies uncertain/read-failed even without a draft, allows only explicit unsent discard',()=>{
  for(const phase of ['uncertain','read_failed','conflict','reviewed'])assert.equal(handler('canLeave',{mutationRef:{current:{model:{snapshot:{locked:true,phase}}}},lock:{current:false},dirty:false,window:{confirm:()=>assert.fail('Not discardable')}})(),false);
  let released=0;assert.equal(handler('canLeave',{mutationRef:{current:{model:{snapshot:{locked:true,phase:'duplicates'},releaseUnsent:()=>released++}}},lock:{current:false},dirty:false,window:{confirm:()=>false}})(),false);assert.equal(released,0);
});
test('actual conflict finish refreshes only after explicit release and never updates draft timestamp',()=>{
  const effects=[],draft={id:620,updated_at:old,contenido:'Keep'},before=structuredClone(draft);
  handler('finishConflict',{mutationRef:{current:{model:{snapshot:{phase:'reviewed'},releaseConflict:()=>{effects.push('release');return{note:note({updated_at:fresh})}}}}},lock:{current:false},trash:false,setConflict:value=>effects.push(value),setError(){},setMessage(){},setSelected(){},restartNotes:()=>effects.push('refresh')})();
  assert.deepEqual(draft,before);assert.equal(effects[0],'release');assert.equal(effects.at(-1),'refresh');
});
test('source has dedicated controller/recovery controls and fresh layout ownership; no legacy write request',()=>{
  assert.equal(file.parseDiagnostics.length,0);assert.match(source,/createFeedbackNotesMutation/);assert.match(source,/entry\.model\.cancel\(\)/);assert.match(source,/Verificar el mismo intento/);assert.match(source,/Actualizar listado confirmado/);
  for(const name of ['persistDraft','toggleStatus','trashAction'])assert.doesNotMatch(nodes(component,node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)[0].getText(file),/request\(|writeRequest\(|method:/);
});
