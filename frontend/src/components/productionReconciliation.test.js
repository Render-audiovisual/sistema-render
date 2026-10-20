import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from 'node:fs';
import ts from 'typescript';
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
  assert.deepEqual(parseReconciliationContext(value,1),{...context(),legacy_editing_tasks:[]});
  for(const patch of [{source:{...context().source,id:2}},{history:{...context().history,recorded_count:-1}},
    {eligibility:{status:'ready',visita_id:'bad'}},{source:{...context().source,fecha:'2026-02-30'}}])assert.throws(()=>parseReconciliationContext({...context(),...patch},1));
  const large=context();large.history.declared_count=3000000000;assert.equal(parseReconciliationContext(large,1).history.declared_count,3000000000);
  assert.throws(()=>parseReconciliationContext({...context(),source:{...context().source,cliente:null}},1));
});
test('legacy editing tasks default empty for old contexts and project only bounded closed scalar fields',()=>{
  assert.deepEqual(parseReconciliationContext(context(),1).legacy_editing_tasks,[]);
  const tasks=Object.freeze([Object.freeze({id:2147483647,revision:2147483647,titulo:'<img src=x onerror=alert(1)>',estado:'en_revision',
    href:'javascript:alert(1)',metadata:{finance:999},deliveries:[{private:true}]})]);
  const value={...context(),eligibility:{status:'legacy_editing',visita_id:null},legacy_editing_tasks:tasks},before=JSON.stringify(value);
  assert.deepEqual(parseReconciliationContext(value,1).legacy_editing_tasks,[{id:2147483647,revision:2147483647,
    titulo:'<img src=x onerror=alert(1)>',estado:'en_revision',en_workspace:false}]);
  assert.equal(JSON.stringify(value),before);
  const fifty=Array.from({length:50},(_,index)=>({id:index+1,revision:1,titulo:'x'.repeat(20000),estado:'x'.repeat(100)}));
  assert.equal(parseReconciliationContext({...context(),eligibility:{status:'legacy_editing',visita_id:null},legacy_editing_tasks:fifty},1).legacy_editing_tasks.length,50);
});
test('workspace marker is strictly boolean and absent marker defaults false, never inferred from names or URLs',()=>{
  const task={id:9,revision:2,titulo:'Edición original',estado:'en_revision'};
  const blocked={...context(),eligibility:{status:'legacy_editing',visita_id:null}};
  for(const en_workspace of [true,false]){
    const parsed=parseReconciliationContext({...blocked,legacy_editing_tasks:[{...task,en_workspace}]},1);
    assert.deepEqual(parsed.legacy_editing_tasks,[{...task,en_workspace}]);
  }
  assert.deepEqual(parseReconciliationContext({...blocked,legacy_editing_tasks:[{...task,workspace:'render_os',href:'/workspace/tareas?task=9'}]},1).legacy_editing_tasks,
    [{...task,en_workspace:false}]);
  for(const en_workspace of [undefined,null,'true','false',1,0,{},[]]){
    assert.throws(()=>parseReconciliationContext({...blocked,legacy_editing_tasks:[{...task,en_workspace}]},1));
  }
});
test('existing editing history is never eligible; empty legacy status is compatible only when field was absent',()=>{
  const task={id:9,revision:2,titulo:'Edición original',estado:'en_revision'};
  assert.throws(()=>parseReconciliationContext({...context(),legacy_editing_tasks:[task]},1));
  assert.deepEqual(parseReconciliationContext({...context(),legacy_editing_tasks:[]},1).legacy_editing_tasks,[]);
  const previous={...context(),eligibility:{status:'legacy_editing',visita_id:null}};
  assert.deepEqual(parseReconciliationContext(previous,1).legacy_editing_tasks,[]);
  assert.throws(()=>parseReconciliationContext({...previous,legacy_editing_tasks:[]},1));
  assert.throws(()=>parseReconciliationContext({...previous,legacy_editing_tasks:undefined},1));
  const draft={acknowledged:true,participante_ids:[],videos:[]};
  assert.throws(()=>reconciliationInput(parseReconciliationContext(previous,1),draft,uuid(9)));
});
test('legacy editing arrays reject malformed types, duplicate IDs, unsafe integers and oversized text',()=>{
  const task={id:9,revision:2,titulo:'Edición original',estado:'pendiente'};
  for(const tasks of [null,{},'tasks',[null],[[]],Array(51).fill(task),[task,{...task}],
    ...[0,-1,'9',1.5,Infinity,2147483648].map(id=>[{...task,id}]),
    ...[0,-1,'2',1.5,Infinity,2147483648].map(revision=>[{...task,revision}]),
    [{...task,titulo:null}],[{...task,titulo:{text:'not a string'}}],[{...task,titulo:'x'.repeat(20001)}],
    [{...task,estado:null}],[{...task,estado:7}],[{...task,estado:'x'.repeat(101)}]]){
    assert.throws(()=>parseReconciliationContext({...context(),legacy_editing_tasks:tasks},1));
  }
});
test('legacy tasks remain visible on every blocked status without enabling reconciliation writes',async()=>{
  for(const status of ['legacy_editing','unavailable','already_linked','not_historical']){
    let writes=0;
    const value={...context(),eligibility:{status,visita_id:status==='already_linked'?uuid(2):null},
      legacy_editing_tasks:[{id:9,revision:2,titulo:'Original',estado:'en_revision'}]};
    const model=createProductionReconciliationModel({taskId:1,sesion:session(),readSession:session,onChange:()=>{},request:async(_url,options)=>{
      if(options?.method){writes++;throw new Error('Must not submit blocked context');}return value;}});
    await model.open();assert.deepEqual(model.snapshot.context.legacy_editing_tasks,value.legacy_editing_tasks.map(task=>({...task,en_workspace:false})));
    fill(model);assert.equal(await model.submit(),false);assert.equal(writes,0);model.dispose();
  }
});
test('actual blocked UI renders canonical ID-derived links and escaped title/state, never API URLs or edit controls',()=>{
  // Real JSX AST/source guards only, not mounted React behavior.
  const source=readFileSync(new URL('./ProductionReconciliation.jsx',import.meta.url),'utf8');
  const file=ts.createSourceFile('ProductionReconciliation.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(file.parseDiagnostics.length,0);
  const nodes=(root,predicate)=>{const found=[];const visit=node=>{if(predicate(node))found.push(node);ts.forEachChild(node,visit);};visit(root);return found;};
  const branch=nodes(file,node=>ts.isConditionalExpression(node)&&node.condition.getText(file)==="context.eligibility.status!=='ready'")[0];
  assert.ok(branch,'Existing eligibility condition remains the only form gate');
  const blocked=branch.whenTrue.getText(file),ready=branch.whenFalse.getText(file);
  assert.match(blocked,/context.legacy_editing_tasks.length>0/);
  assert.match(blocked,/context.legacy_editing_tasks.map\(task=>/);
  assert.match(blocked,/key=\{task.id\}/);
  assert.match(blocked,/href=\{`\/workspace\/tareas\?task=\$\{task.id\}`\}/);
  assert.match(blocked,/\{task.titulo\|\|'Sin título'\} · #\{task.id\}/);
  assert.match(blocked,/\{legacyTaskStateLabel\(task.estado\)\}/);
  assert.match(source,/en_revision:'En revisión'/);
  assert.match(source,/finalizada:'Trabajo finalizado'/);
  assert.match(source,/publicada:'Trabajo finalizado \(estado histórico\)'/);
  const workspaceBranch=nodes(branch.whenTrue,node=>ts.isConditionalExpression(node)&&node.condition.getText(file)==='task.en_workspace===true')[0];
  assert.ok(workspaceBranch,'A task link requires explicit backend workspace marker true');
  assert.match(workspaceBranch.whenTrue.getText(file),/<a href=\{`\/workspace\/tareas\?task=\$\{task.id\}`\}/);
  const outside=workspaceBranch.whenFalse.getText(file);
  assert.match(outside,/\{task.titulo\|\|'Sin título'\} · #\{task.id\}/);
  assert.match(outside,/Registro histórico fuera de Tareas; conservado para revisión manual./);
  assert.doesNotMatch(outside,/<a\b|href=|onClick=/);
  assert.match(blocked,/Las entregas y correcciones existentes permanecen en su tarea original. No se dividen automáticamente./);
  assert.doesNotMatch(blocked,/<form|<input|<textarea|type="submit"|\.submit\(|task.href|task.url|dangerouslySetInnerHTML/);
  assert.match(ready,/<form/);
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
