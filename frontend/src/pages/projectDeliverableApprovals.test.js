import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest,isSessionFailure} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
import {parseProject,isProjectChildCreation,parseProjectChildCreation,buildProjectMutation,buildProjectDeliverableApproval,parseProjectDeliverableApproval,projectDeliverableApprovalLabel,createProjectsTransport,projectError} from './projectsModel.js';
import {normalizeProjectDeliverableApprovalInput} from '../../../backend/src/project-deliverable-approvals.js';

const PROJECT='11111111-1111-4111-8111-111111111111',CHILD='22222222-2222-4222-8222-222222222222',REQUEST='33333333-3333-4333-8333-333333333333',RECEIPT='44444444-4444-4444-8444-444444444444';
const hash='a'.repeat(64),when='2026-10-21T12:00:00.000Z';
const item=()=>({id:CHILD,titulo:'Contenido observado',url:'https://example.test/review',observaciones:'<script>literal</script>',estado:'en_revision',aprobado_por_id:null,aprobado_at:null,contenido_revision:3,entregable_revision:5,contenido_hash:hash,aprobacion_actual_id:null,aprobacion_versionada:false});
const project=(child=item(),revision=8)=>({id:PROJECT,titulo:'Proyecto',tipo:'web',estado:'en_curso',revision,cliente:{id:2,nombre:'Cliente'},responsable:{id:1,nombre:'QA'},fecha_inicio:null,fecha_entrega:null,archivado:false,counts:{tareas:0,finalizadas:0,hitos:0,entregables:1},descripcion:'',miembro_ids:[],permissions:{administrar:true,editar:true},etapas:[],hitos:[],entregables:[child],tareas:[],actividad:[],tareas_no_disponibles:0});
const form=()=>({seq:1,kind:'deliverable-approve',projectId:PROJECT,childId:CHILD,requestId:REQUEST,baseRevision:8,observedDeliverable:Object.freeze(item()),draft:{acknowledged:true},initial:{acknowledged:false},busy:false,conflict:false});
const ack=()=>({proyecto:project({...item(),estado:'aprobado',entregable_revision:6,aprobacion_actual_id:RECEIPT,aprobacion_versionada:true,aprobado_por_id:1,aprobado_at:when},9),aprobacion:{id:RECEIPT,entregable_id:CHILD,contenido_revision:3,entregable_revision:6,contenido_hash:hash,actor_id:1,aprobado_at:when},replayed:false});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const source=readFileSync(new URL('./Projects.jsx',import.meta.url),'utf8'),ast=ts.createSourceFile('Projects.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function callback(name,deps){let found;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,visit)}visit(ast);assert.ok(found,name);return Function(...Object.keys(deps),`${found.getText(ast)};return ${name}`)(...Object.values(deps));}
function harness({cookie=false}={}){
 const store=createBrowserSessionState();const publish=id=>{const ticket=store.beginBootstrap();store.acceptBootstrap(ticket,{usuario:{id,nombre:'QA',usuario:'qa',rol:'admin'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)})};if(cookie)publish(1);
 let live=cookie?store.getSession():{token:'A',usuario:{id:1,rol:'admin',activo:true}},active=true,transportFn=async()=>ack();
 const sesion=live,calls=[],paints=[],formRef={current:form()},mutationBusy={current:false},detailReadGeneration={current:0},selectionRef={current:{id:PROJECT}},detailRef={current:{status:'ready',data:project(),error:''}};
 formRef.current.scope=createCapturedRequest({session:sesion,readSession:()=>live,isActive:()=>active,request:async(url,options)=>{calls.push({url,options});return transportFn(url,options)}});
 const originalScope=formRef.current.scope;
 const deps={formRef,mutationBusy,detailReadGeneration,selectionRef,sesion,captureAction:()=>originalScope,isProjectChildCreation,parseProjectChildCreation,buildProjectMutation,parseProject,parseProjectDeliverableApproval,projectError,transport:{cancel:key=>paints.push(['cancel',key]),read:async()=>({proyecto:project()}),write:(mutation,scope)=>scope.request(mutation.path,{method:mutation.method,body:JSON.stringify(mutation.body)})},setForm:update=>{formRef.current=typeof update==='function'?update(formRef.current):update;paints.push(['form',formRef.current])},setDetail:update=>{detailRef.current=typeof update==='function'?update(detailRef.current):update;paints.push(['detail',detailRef.current])},setMessage:value=>paints.push(['message',value]),setListRefresh:()=>paints.push(['list']),selectProject:()=>paints.push(['select'])};
 deps.detailStateRef=detailRef;deps.admin=true;deps.isSessionFailure=isSessionFailure;
 deps.publishDetail=callback('publishDetail',deps);deps.canUseProjectObservation=callback('canUseProjectObservation',deps);
 deps.purgeProjectAccess=scope=>{if(scope.current()){formRef.current=null;paints.push(['purge'])}};
 return{...deps,calls,paints,detailRef,submit:callback('submit',deps),refreshDetail:callback('refreshDetail',deps),setRead:fn=>{deps.transport.read=fn},transport:fn=>{transportFn=fn},replace:()=>{if(cookie){publish(2);live=store.getSession()}else live={token:'B',usuario:{id:2,rol:'admin',activo:true}}},unmount:()=>{active=false}};
}
test('exact approval POST uses observed versions/hash, UUID and explicit independent confirmation',()=>{
 const current=form(),before=structuredClone(current),mutation=buildProjectMutation(current);
 assert.equal(mutation.path,`/api/proyectos/${PROJECT}/entregables/${CHILD}/aprobaciones`);assert.deepEqual(normalizeProjectDeliverableApprovalInput(mutation.body),mutation.body);assert.deepEqual(current,before);
 assert.deepEqual(Object.keys(mutation.body),['request_id','expected_revision','expected_entregable_revision','expected_content_revision','expected_content_hash']);
 for(const mutate of [f=>{f.draft.acknowledged=false},f=>{f.requestId+='\n'},f=>{f.observedDeliverable={...item(),contenido_hash:hash+'\n'}},f=>{f.observedDeliverable={...item(),entregable_revision:2147483648}}]){const f=form();mutate(f);assert.throws(()=>buildProjectDeliverableApproval(f));}
});
test('generic create/edit never creates approval and approved content edit omits approval status',()=>{
 const base={kind:'deliverable-create',requestId:REQUEST,projectId:PROJECT,baseRevision:8,draft:{titulo:'Entrega',url:'',observaciones:'',estado:'aprobado'}};assert.throws(()=>buildProjectMutation(base));
 const existing={...item(),estado:'aprobado'},f={...base,kind:'deliverable-edit',childId:CHILD,initial:existing,draft:{...existing,titulo:'Contenido nuevo'}};
 const result=buildProjectMutation(f);assert.deepEqual(result.body,{expected_revision:8,titulo:'Contenido nuevo'});assert.equal(result.path.endsWith('/aprobaciones'),false);
 f.initial={...existing,estado:'en_revision'};assert.throws(()=>buildProjectMutation(f));
});
test('closed DTO requires complete coherent version fields; legacy approval is labelled unversioned, never verified',()=>{
 const legacy={...item(),estado:'aprobado',aprobado_por_id:1,aprobado_at:when};for(const key of ['contenido_revision','entregable_revision','contenido_hash','aprobacion_actual_id','aprobacion_versionada'])delete legacy[key];
 const parsed=parseProject(project(legacy),true).entregables[0];assert.equal(parsed.aprobacion_versionada,false);assert.match(projectDeliverableApprovalLabel(parsed),/histórica no versionada/);assert.equal(parsed.contenido_hash,null);
 for(const changes of [{contenido_hash:hash+'\n'},{contenido_revision:0},{aprobacion_versionada:'true'},{aprobacion_versionada:true},{aprobacion_actual_id:RECEIPT+'\n'}])assert.throws(()=>parseProject(project({...item(),...changes}),true));
 const value=ack().proyecto;value.entregables[0].secret='drop';assert.equal(parseProject(value,true).entregables[0].secret,undefined);
});
test('ACK binds actor/project/deliverable/content and exact advancing revisions; replay does not reassert current proof',()=>{
 const f=form();assert.equal(parseProjectDeliverableApproval(ack(),f,1).revision,9);
 for(const mutate of [a=>{a.aprobacion.actor_id=2},a=>{a.aprobacion.entregable_id=REQUEST},a=>{a.aprobacion.contenido_hash='b'.repeat(64)},a=>{a.aprobacion.entregable_revision=5},a=>{a.proyecto.id=REQUEST},a=>{a.proyecto.entregables[0].aprobacion_versionada=false},a=>{a.replayed='true'}]){const a=ack();mutate(a);assert.throws(()=>parseProjectDeliverableApproval(a,f,1));}
 const replay=ack();replay.replayed=true;replay.proyecto=project({...item(),titulo:'Más reciente',contenido_revision:4,entregable_revision:7},10);const parsed=parseProjectDeliverableApproval(replay,f,1);assert.equal(parsed.entregables[0].aprobacion_versionada,false);
});
test('actual submit validates ACK before success and dispatches no generic approval PATCH',async()=>{
 const h=harness();await h.submit({preventDefault(){}});assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'POST');assert.equal(h.formRef.current,null);assert.ok(h.paints.some(([kind])=>kind==='detail'));
});
test('actual lost-reply callback freezes body+UUID; only explicit verify resends identical request',async()=>{
 const h=harness();h.transport(async()=>{throw new Error('offline')});await h.submit({preventDefault(){}});assert.equal(h.formRef.current.uncertain,true);assert.equal(h.formRef.current.requestId,REQUEST);assert.equal(h.calls.length,1);
 await h.submit({preventDefault(){}});assert.equal(h.calls.length,1);h.transport(async()=>ack());await h.submit({preventDefault(){}},{verify:true});assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.body,h.calls[1].options.body);assert.equal(h.formRef.current,null);
});
test('malformed ACK is uncertain; stale409 retains form with no automatic GET/retry/rebase',async()=>{
 for(const mode of ['malformed','conflict']){const h=harness();h.transport(async()=>{if(mode==='malformed')return{proyecto:project()};throw Object.assign(new Error(),{status:409})});await h.submit({preventDefault(){}});assert.equal(h.calls.length,1);assert.ok(h.formRef.current);assert.equal(h.formRef.current.baseRevision,8);assert.equal(h.paints.some(([kind,value])=>kind==='detail'&&value.data?.revision===9),false);if(mode==='conflict'){assert.equal(h.formRef.current.conflict,true);await h.submit({preventDefault(){}},{verify:true});assert.equal(h.calls.length,1);}else assert.equal(h.formRef.current.uncertain,true);}
});
for(const cookie of [false,true])test(`actual ${cookie?'cookie':'bearer'} late A result and queued verification never dispatch/paint under B`,async()=>{
 const h=harness({cookie}),d=deferred();h.transport(()=>d.promise);const pending=h.submit({preventDefault(){}}),count=h.paints.length;h.replace();d.resolve(ack());await pending;assert.equal(h.paints.length,count);await h.submit({preventDefault(){}},{verify:true});assert.equal(h.calls.length,1);
});
test('actual unmount/context-ABA guard suppresses late response, duplicate click and private repaint',async()=>{
 const h=harness(),d=deferred();h.transport(()=>d.promise);const pending=h.submit({preventDefault(){}});await h.submit({preventDefault(){}});assert.equal(h.calls.length,1);const count=h.paints.length;h.unmount();d.resolve(ack());await pending;assert.equal(h.paints.length,count);
});
test('actual403 removes approval intent and detail; no subsequent verification',async()=>{
 const h=harness();h.transport(async()=>{throw Object.assign(new Error('private'),{status:403})});await h.submit({preventDefault(){}});assert.equal(h.formRef.current,null);assert.ok(h.paints.some(([kind])=>kind==='purge'));await h.submit({preventDefault(){}},{verify:true});assert.equal(h.calls.length,1);
});
test('actual refresh blocks retained approval until a verified read; pending write blocks new reads and400 preserves observed data',async()=>{
 for(const failedWrite of [false,true])for(const failedRead of [false,true]){
  const h=harness(),old=deferred(),write=deferred();let reads=0;
  h.setRead(()=>{reads++;return old.promise});h.transport(()=>write.promise);
  const reading=h.refreshDetail(true);assert.equal(h.detailRef.current.status,'loading');
  await h.submit({preventDefault(){}});assert.equal(h.calls.length,0,'Pending observation cannot authorize approval');
  if(failedRead)old.reject(new Error('transient read failure'));else old.resolve({proyecto:project()});await reading;
  if(failedRead){assert.equal(h.detailRef.current.status,'error');assert.equal(h.detailRef.current.data.revision,8);await h.submit({preventDefault(){}});assert.equal(h.calls.length,0);h.setRead(async()=>{reads++;return{proyecto:project()}});await h.refreshDetail(true);}
  assert.equal(h.detailRef.current.status,'ready');
  const saving=h.submit({preventDefault(){}});assert.equal(h.calls.length,1);const beforeReads=reads;
  await h.refreshDetail();assert.equal(reads,beforeReads,'A same-project refresh cannot begin during the write');
  if(failedWrite)write.reject(Object.assign(new Error('validation'),{status:400}));else write.resolve(ack());await saving;
  assert.equal(h.detailRef.current.status,'ready');assert.equal(h.detailRef.current.data.revision,failedWrite?8:9);assert.equal(h.detailRef.current.error,'');
  if(!failedWrite)assert.equal(h.detailRef.current.data.entregables[0].aprobacion_versionada,true);
  else{assert.equal(h.formRef.current.busy,false);assert.equal(h.formRef.current.reviewed,false);}
 }
});
test('real purge callback clears form/observed content/catalog and cancels old reads, not another actor',()=>{
 const formRef={current:form()},effects=[],scope={current:()=>true};const purge=callback('purgeProjectAccess',{formRef,transport:{cancel:key=>effects.push(['cancel',key])},setForm:v=>effects.push(['form',v]),setCatalog:v=>effects.push(['catalog',v]),setMessage:v=>effects.push(['message',v]),publishDetail:v=>effects.push(['detail',v])});
 purge(scope);assert.equal(formRef.current,null);assert.equal(effects.find(([kind])=>kind==='detail')[1].data,null);assert.deepEqual(effects.find(([kind])=>kind==='catalog')[1].users,[]);const count=effects.length;purge({current:()=>false});assert.equal(effects.length,count);
});
test('actual transport optional action scope keeps original captured headers and stops stale dispatch',async()=>{
 const h=harness(),scope=h.formRef.current.scope,transport=createProjectsTransport(()=>{throw new Error('must use captured action')});await transport.write(buildProjectMutation(h.formRef.current),scope);assert.equal(h.calls.length,1);h.replace();await assert.rejects(transport.write(buildProjectMutation(form()),scope));assert.equal(h.calls.length,1);transport.dispose();
});
test('real transport suppresses both stale read errors and successful DTOs before page continuations',async()=>{
 for(const fail of [false,true]){const d=deferred();let current=true,calls=0;const transport=createProjectsTransport(()=>{calls++;return d.promise},{isCurrent:()=>current});const pending=transport.read('detail',`/api/proyectos/${PROJECT}`);current=false;if(fail)d.reject(new Error('private old failure'));else d.resolve({proyecto:project()});assert.equal(await pending,undefined);assert.equal(await transport.read('detail','/never'),undefined);assert.equal(calls,1);transport.dispose();}
});
test('JSX separates observed review from content editing and disables adoption of a newer approval revision',()=>{
 assert.equal(ast.parseDiagnostics.length,0);assert.match(source,/kind\.startsWith\("deliverable-"\) && kind!=='deliverable-approve'/);assert.match(source,/Options values=\{DELIVERABLE_EDIT_STATES\}/);assert.match(source,/Revisé este título, enlace y observaciones/);assert.match(source,/form\.kind==='deliverable-approve'\|\|isProjectChildCreation\(form.kind\)\)return/);assert.match(source,/kind!=='deliverable-approve' && !isProjectChildCreation\(kind\) && <button[^>]+onClick=\{adoptRevision\}/);assert.match(source,/useLayoutEffect/);assert.match(source,/key=\{view.key\}/);assert.match(source,/Verificar la misma solicitud/);assert.doesNotMatch(source,/dangerouslySetInnerHTML/);
 const css=readFileSync(new URL('./Projects.css',import.meta.url),'utf8');assert.match(css,/min-height:44px/);assert.match(css,/\.pr-form-fields\{display:contents/);
});
test('actual editor opening effect focuses/scrolls once per new sequence, never on retry, busy or disconnected heading',()=>{
 const editor=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ProjectEditor');let effect;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[1]?.getText(ast)==='[form.seq]')effect=node.arguments[0];ts.forEachChild(node,visit)}visit(editor);assert.ok(effect);
 const calls=[],form={seq:1,busy:false},focusedSequence={current:null},editorHeading={current:{isConnected:true,focus:options=>calls.push(['focus',options]),scrollIntoView:options=>calls.push(['scroll',options])}};
 const run=Function('form','focusedSequence','editorHeading',`return (${effect.getText(ast)})`)(form,focusedSequence,editorHeading);
 run();assert.deepEqual(calls,[['focus',{preventScroll:true}],['scroll',{block:'start',behavior:'auto'}]]);
 run();form.error='retry';form.busy=true;run();form.busy=false;run();assert.equal(calls.length,2);
 form.seq=2;form.busy=true;run();form.busy=false;run();assert.equal(calls.length,2,'No delayed focus stealing after pending settles');
 form.seq=3;editorHeading.current.isConnected=false;run();assert.equal(calls.length,2);
 form.seq=4;editorHeading.current.isConnected=true;run();assert.equal(calls.length,4);
 assert.match(editor.getText(ast),/id="pr-editor-title" ref=\{editorHeading\} tabIndex=\{-1\}/);
 const css=readFileSync(new URL('./Projects.css',import.meta.url),'utf8');assert.match(css,/\.pr-editor #pr-editor-title\{scroll-margin-top:88px\}/);
});
