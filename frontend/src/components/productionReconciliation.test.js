import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from 'node:fs';
import {parseReconciliationContext,reconciliationInput,createProductionReconciliationModel}from './productionReconciliation.js';
const session=()=>({token:'local-test',usuario:{id:7,rol:'admin',activo:true}});
const context=()=>({version:1,source:{id:1,revision:3,titulo:'Visita histórica',cliente:{id:2,nombre:'Cliente'},fecha:'2026-10-20',
  content:{instructions:'Guion original',script:'Texto literal\n',material:'',recorded_material:'Material original',feedback:'Corrección',schedule:'Horario'}},
  history:{records_count:1,recorded_count:4,declared_count:6,confirmed:false},eligibility:{status:'ready',visita_id:null}});
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const result=()=>({reconciliation_id:uuid(1),visita_id:uuid(2),video_ids:[uuid(3)],created:true});
const fill=model=>{const draft=model.snapshot.draft;model.update({acknowledged:true,videos:[{...draft.videos[0],titulo:'Video identificado',guion:'Guion manual',estado:'grabado'}]});};
test('closed context projection preserves original strings but never carries arbitrary metadata or finances',()=>{
  const value=context();value.salary=100;value.source.private_finance=100;value.source.content.salary=200;
  assert.deepEqual(parseReconciliationContext(value,1),context());
  for(const patch of [{source:{...context().source,id:2}},{history:{...context().history,recorded_count:-1}},
    {eligibility:{status:'ready',visita_id:'bad'}},{source:{...context().source,fecha:'2026-02-30'}}])assert.throws(()=>parseReconciliationContext({...context(),...patch},1));
  const large=context();large.history.declared_count=3000000000;assert.equal(parseReconciliationContext(large,1).history.declared_count,3000000000);
  assert.throws(()=>parseReconciliationContext({...context(),source:{...context().source,cliente:null}},1));
});
test('opening never splits aggregate count into videos and explicit submission strips UI keys',async()=>{
  const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:session,request:async()=>context(),onChange:()=>{}});
  await model.open();assert.equal(model.snapshot.draft.videos.length,1);assert.equal(model.snapshot.draft.videos[0].estado,'planificado');
  assert.equal(model.snapshot.draft.videos[0].guion,'');assert.equal(model.snapshot.dirty,false);assert.throws(()=>reconciliationInput(context(),model.snapshot.draft,uuid(5)));
  fill(model);const body=reconciliationInput(context(),model.snapshot.draft,uuid(5));
  assert.equal(body.expected_source_revision,3);assert.equal(body.videos.length,1);assert.equal(body.videos[0].local_id,undefined);assert.equal(body.editor_id,undefined);
  assert.equal(body.acknowledgement,'videos_identificados_manualmente');model.dispose();
});
test('uncertain writes freeze immutable intent and retry the exact same request ID/body',async()=>{
  let fail=true;const calls=[];
  const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:session,createId:()=>uuid(9),onChange:()=>{},request:async(url,options)=>{
    if(!options?.method)return context();calls.push(options.body);if(fail)throw new Error('connection lost');return{...result(),created:false};}});
  await model.open();fill(model);await model.submit();assert.equal(model.snapshot.frozen,true);assert.equal(model.snapshot.canReviewAgain,false);
  assert.equal(model.update({titulo:'Changed'}),false);assert.equal(await model.open({preserveDraft:true}),false);
  fail=false;await model.submit({retry:true});assert.deepEqual(calls,[calls[0],calls[0]]);
  assert.equal(model.snapshot.phase,'saved');assert.equal(model.snapshot.dirty,false);assert.equal(model.snapshot.result.created,false);model.dispose();
});
test('definitive conflict requires explicit reread, preserves video draft and resets acknowledgement',async()=>{
  let revision=3,key=10,conflict=true;const calls=[];
  const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:session,createId:()=>uuid(key++),onChange:()=>{},request:async(url,options)=>{
    if(!options?.method){const value=context();value.source.revision=revision;return value;}
    calls.push(JSON.parse(options.body));if(conflict)throw Object.assign(new Error('stale'),{status:409});return result();}});
  await model.open();fill(model);await model.submit();assert.equal(model.snapshot.canReviewAgain,true);
  revision=4;await model.open({preserveDraft:true});assert.equal(model.snapshot.draft.videos[0].titulo,'Video identificado');
  assert.equal(model.snapshot.draft.acknowledged,false);assert.equal(model.snapshot.context.source.revision,4);
  conflict=false;model.update({acknowledged:true});await model.submit();assert.notEqual(calls[0].request_id,calls[1].request_id);assert.equal(calls[1].expected_source_revision,4);model.dispose();
});
test('session changes and denial wipe context; disposed late mutations cannot repaint',async()=>{
  for(const mutation of [s=>s.token='other',s=>s.usuario.id=8,s=>s.usuario.rol='diseno',s=>s.usuario.activo=false]) {
    let actual=session(),finish;const events=[];
    const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:()=>actual,onChange:s=>events.push(s),request:()=>new Promise(resolve=>finish=resolve)});
    const pending=model.open();mutation(actual);finish(context());await pending;assert.equal(model.snapshot.context,null);assert.equal(model.snapshot.phase,'denied');model.dispose();
  }
  let finish;const events=[];
  const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:session,onChange:s=>events.push(s),request:async(url,options)=>options?.method?new Promise(resolve=>finish=resolve):context()});
  await model.open();fill(model);const pending=model.submit();const count=events.length;model.dispose();finish(result());await pending;assert.equal(events.length,count);
});
test('failed explicit reread after conflict retains draft and POST session change never reports saved',async()=>{
  let failRead=false,actual=session(),finish;
  const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:()=>actual,onChange:()=>{},request:async(url,options)=>{
    if(options?.method)throw Object.assign(new Error('stale'),{status:409});if(failRead)throw new Error('offline');return context();}});
  await model.open();fill(model);await model.submit();failRead=true;await model.open({preserveDraft:true});
  assert.equal(model.snapshot.draft.videos[0].titulo,'Video identificado');assert.equal(model.snapshot.dirty,true);
  failRead=false;await model.open({preserveDraft:true});assert.equal(model.snapshot.draft.videos[0].titulo,'Video identificado');assert.equal(model.snapshot.draft.acknowledged,false);model.dispose();
  const post=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:()=>actual,onChange:()=>{},request:async(url,options)=>options?.method?new Promise(resolve=>finish=resolve):context()});
  await post.open();fill(post);const pending=post.submit();actual={...session(),token:'new-token'};finish(result());await pending;
  assert.equal(post.snapshot.phase,'denied');assert.equal(post.snapshot.context,null);assert.equal(post.snapshot.result,null);post.dispose();
});
test('wrong reply is uncertain, double-submit is suppressed and local invalid URLs never reach the server',async()=>{
  let writes=0,finish;
  const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:session,onChange:()=>{},request:async(url,options)=>{
    if(!options?.method)return context();writes++;return new Promise(resolve=>finish=resolve);}});
  await model.open();fill(model);model.update({drive_url:'javascript:alert(1)'});await model.submit();assert.equal(writes,0);
  model.update({drive_url:''});const pending=model.submit();assert.equal(await model.submit(),false);assert.equal(writes,1);
  finish({...result(),video_ids:[uuid(3),uuid(4)]});await pending;assert.equal(model.snapshot.frozen,true);assert.equal(model.snapshot.result,null);model.dispose();
});
test('parent keeps open reconciliation mounted through registry refreshes and shares dirty/busy guards',()=>{
  const parent=readFileSync(new URL('../pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  const component=readFileSync(new URL('./ProductionReconciliation.jsx',import.meta.url),'utf8');
  assert.match(parent,/isAdmin && <ProductionReconciliation/);assert.match(parent,/available=\{isProductionVisit && registry.ready && !registry.vinculo\}/);
  assert.match(parent,/taskDraftDirty =[\s\S]*?reconciliationDraft.dirty/);assert.match(parent,/taskWriteBusy =[^;]*reconciliationDraft.busy/);
  assert.match(component,/state.phase==='closed'&&!available/);assert.match(component,/key=\{video.local_id\}/);
  assert.match(component,/<DiscardChangesDialog/);assert.doesNotMatch(component,/dangerouslySetInnerHTML|localStorage|sessionStorage/);
});
