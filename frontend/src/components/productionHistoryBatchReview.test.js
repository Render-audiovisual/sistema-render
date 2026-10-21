import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createProductionHistoryBatchModel,productionHistoryBatchContract,parseProductionHistoryBatchContext,createProductionHistoryDraft,buildProductionHistoryBatchInput,parseProductionHistoryBatchResult} from './productionHistoryBatchReview.js';
import {validateProductionHistoryBatch} from '../../../backend/src/production-history-batches.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';

// Synthetic codec tests lifecycle only, NOT a guessed version-2 DTO contract.
const codec={parseContext(value,id){assert.equal(value.id,id);return{id}},createDraft(_context,previous){return{...(previous||{choice:''}),ack:false}},buildInput(context,draft,request_id){assert.equal(draft.ack,true);return{request_id,source:context.id,choice:draft.choice}},parseResult(value){assert.equal(value.ok,true);return{ok:true}}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){let live={token:'A',usuario:{id:1,rol:'admin',activo:true}},transport=async(_url,options)=>options.method?{ok:true}:{id:7};const calls=[],states=[],drafts=[];
 const model=createProductionHistoryBatchModel({sourceId:7,sesion:live,readSession:()=>live,request:async(url,options)=>{calls.push({url,options});return transport(url,options)},contract:codec,onChange:state=>states.push(state),onDraftStateChange:state=>drafts.push(state),createId:()=> 'synthetic-request'});
 return{model,calls,states,drafts,transport:fn=>{transport=fn},replace:()=>{live={token:'B',usuario:{id:2,rol:'admin',activo:true}}}};
}
test('absent exact codec fails closed without dispatch; explicit open uses pinned GET',async()=>{
 let called=false;const model=createProductionHistoryBatchModel({sourceId:7,sesion:{token:'A',usuario:{id:1,rol:'admin'}},readSession:()=>({token:'A',usuario:{id:1,rol:'admin'}}),request:()=>{called=true}});
 assert.equal(await model.open(),false);assert.equal(called,false);
 const f=fixture(),pending=f.model.open();assert.deepEqual(f.drafts[0],{dirty:false,busy:true});await pending;assert.equal(f.calls[0].url,'/api/producciones/reconciliaciones/lotes/origen/7');
});
test('unknown outcome freezes body and verification is explicit byte-identical, no auto retry',async()=>{
 const f=fixture();await f.model.open();f.model.update({choice:'video explicit',ack:true});f.transport(async()=>{throw new Error('offline')});
 await f.model.submit();assert.equal(f.model.snapshot.frozen,true);assert.equal(f.calls.length,2);assert.equal(f.model.update({choice:'different',ack:true}),false);assert.equal(await f.model.submit(),false);
 f.transport(async()=>({ok:true}));await f.model.submit({verify:true});assert.equal(f.calls[1].options.body,f.calls[2].options.body);assert.equal(f.model.snapshot.phase,'saved');
});
test('409 keeps draft, explicit reread resets acknowledgment and never auto rebases',async()=>{
 const f=fixture();await f.model.open();f.model.update({choice:'held',ack:true});f.transport(async()=>{throw Object.assign(new Error(),{status:409})});
 await f.model.submit();assert.equal(f.model.snapshot.draft.choice,'held');assert.equal(f.model.snapshot.canReviewAgain,true);assert.equal(f.calls.length,2);
 f.transport(async()=>({id:7}));await f.model.open({preserveDraft:true});assert.deepEqual(f.model.snapshot.draft,{choice:'held',ack:false});assert.equal(f.calls.length,3);
});
test('duplicate click is synchronously suppressed and pending cannot close',async()=>{
 const f=fixture();await f.model.open();f.model.update({choice:'held',ack:true});const d=deferred();f.transport(()=>d.promise);
 const first=f.model.submit();assert.equal(f.model.snapshot.busy,true);assert.equal(await f.model.submit(),false);assert.equal(f.model.close(),false);assert.equal(f.calls.length,2);d.resolve({ok:true});await first;
});
for(const boundary of ['session','unmount'])test(`late ${boundary} request cannot publish result or dispatch verification`,async()=>{
 const f=fixture();await f.model.open();f.model.update({choice:'held',ack:true});const d=deferred();f.transport(()=>d.promise);const pending=f.model.submit();
 if(boundary==='session')f.replace();else f.model.dispose();const count=f.states.length;d.resolve({ok:true});await pending;assert.equal(f.states.length,count);assert.equal(await f.model.submit({verify:true}),false);assert.equal(f.calls.length,2);
});
test('real JSX syntax, layout lifetime and admin/source mount; no Workspace changes needed',()=>{
 const component=readFileSync(new URL('./ProductionHistoryBatchReview.jsx',import.meta.url),'utf8'),page=readFileSync(new URL('../pages/Productions.jsx',import.meta.url),'utf8');
 for(const source of [component,page])assert.equal(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React},reportDiagnostics:true}).diagnostics.length,0);
 assert.match(component,/useLayoutEffect/);assert.match(component,/key=\{`\$\{view.key\}:\$\{props.sourceId\}`\}/);assert.match(component,/disabled=\{disabled\|\|!contract\}/);
 assert.match(page,/isAdmin&&visit.tarea_origen_id&&<ProductionHistoryBatchReview/);assert.match(page,/sesion=\{sesion\} onBatchDraftStateChange=\{onBatchDraftStateChange\}/);
});

const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
function actualContext(existing=false){
 const video={id:ids[1],visita_id:ids[0],video_origen_id:null,titulo:'Video existente',guion:'Guion literal',estado:'grabado',material_url:'',observaciones:'',tarea_edicion_id:null,tarea_entrega_id:null,publicacion_id:null,cliente_editorial_id:null,editor_id:null,fecha_entrega:null};
 return{version:2,source:{id:7,revision:4,titulo:'Visita histórica',cliente:{id:2,nombre:'Cliente'},fecha:'2026-10-21',content:{instructions:'<script>literal</script>',script:'No dividir',material:'',recorded_material:'',feedback:'Original',schedule:'Horario libre'}},visit:existing?{id:ids[0],revision:6,tarea_origen_id:7,cliente_id:2,fecha:'2026-10-21',titulo:'Visita ya registrada',observaciones:'Mantener',drive_url:'',participante_ids:[5],videos:[video]}:null,legacy_tasks:[{id:11,revision:8,titulo:'Edición A',estado:'aprobada',editor_id:5,fecha_entrega:'2026-10-22',eligibility:'adoptable',mapped_video_id:null},{id:12,revision:3,titulo:'Edición agregada',estado:'publicada',editor_id:null,fecha_entrega:null,eligibility:'preserve_only',mapped_video_id:null}],context_hash:'a'.repeat(64)};
}
function actualDraft(context,{existing=false,independent=false}={}){
 const draft=createProductionHistoryDraft(context);
 draft.videos=[{...(existing?{existing_video_id:ids[1]}:{local_key:ids[2],new_video:{titulo:'Identificado por persona',guion:'Guion',estado:'grabado',material_url:'https://example.test/video',observaciones:''}}),disposition:independent?'manual_independent':'adopt_original',task_id:independent?null:11,acknowledged:true}];
 draft.children=[{task_id:11,disposition:independent?'preserve_unmapped':'mapped',video_key:independent?null:existing?ids[1]:ids[2],reason:'Correspondencia revisada individualmente'},{task_id:12,disposition:'preserve_unmapped',video_key:null,reason:'Agrupa varios videos; se conserva sin división'}];draft.acknowledged=true;return draft;
}
test('exact v2 codec strips private bags, preserves literal source, never preselects videos or splits counts',()=>{
 const raw=actualContext(true),before=structuredClone(raw);raw.finance={secret:true};raw.source.content.unknown='drop';raw.visit.videos[0].metadata={secret:true};
 const context=parseProductionHistoryBatchContext(raw,7);assert.equal(context.source.content.instructions,'<script>literal</script>');assert.equal(context.finance,undefined);assert.equal(context.source.content.unknown,undefined);assert.equal(context.visit.videos[0].metadata,undefined);
 const draft=createProductionHistoryDraft(context);assert.deepEqual(draft.videos,[]);assert.ok(draft.children.every(child=>child.disposition===''));assert.equal(draft.acknowledged,false);assert.equal(raw.visit.titulo,before.visit.titulo);
});
test('exact payload accepted by actual backend validator, each child explicit, no copied approval or task mutation',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(),7),draft=actualDraft(context),before=structuredClone(draft),input=buildProductionHistoryBatchInput(context,draft,ids[3]);
 const validated=validateProductionHistoryBatch(input);assert.equal(validated.version,2);assert.equal(validated.expected_source_revision,4);assert.equal(validated.expected_context_hash,context.context_hash);assert.equal(validated.child_dispositions[0].expected_revision,8);assert.equal(validated.videos[0].task_id,11);assert.equal(validated.child_dispositions[1].disposition,'preserve_unmapped');
 assert.equal(JSON.stringify(input).includes('aprobada'),false);assert.equal(input.videos[0].acknowledged,undefined);assert.deepEqual(draft,before);
});
test('existing visit/video use observed UUID+revision, omit visit_fields and do not infer ordinal',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(true),7),draft=actualDraft(context,{existing:true}),input=buildProductionHistoryBatchInput(context,draft,ids[3]);
 assert.equal(input.visit_id,ids[0]);assert.equal(input.expected_visit_revision,6);assert.equal(input.visit_fields,undefined);assert.equal(input.videos[0].existing_video_id,ids[1]);assert.equal(input.videos[0].local_key,undefined);assert.equal(input.videos[0].video_ordinal,undefined);assert.doesNotThrow(()=>validateProductionHistoryBatch(input));
});
test('manual independent requires its own no-evidence acknowledgment separately from global',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(),7),draft=actualDraft(context,{independent:true});
 assert.equal(validateProductionHistoryBatch(buildProductionHistoryBatchInput(context,draft,ids[3])).videos[0].task_id,null);
 draft.videos[0].acknowledged=false;assert.throws(()=>buildProductionHistoryBatchInput(context,draft,ids[3]));draft.videos[0].acknowledged=true;draft.acknowledged=false;assert.throws(()=>buildProductionHistoryBatchInput(context,draft,ids[3]));
});
test('missing child decision/reason, duplicate task/video, preserved-only adoption and nonrecorded video reject locally',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(),7);
 const mutations=[d=>d.children.pop(),d=>{d.children[0].reason=' '},d=>{d.videos.push({...d.videos[0],local_key:ids[1]})},d=>{d.videos[0].task_id=12},d=>{d.videos[0].new_video.estado='pendiente'},d=>{d.videos[0].new_video.material_url='javascript:alert(1)'},d=>{d.videos[0].local_key+='\n'}];
 for(const mutate of mutations){const draft=actualDraft(context);mutate(draft);assert.throws(()=>buildProductionHistoryBatchInput(context,draft,ids[3]));}
});
test('context rejects invalid hash, IDs, dates, duplicate rows, wrong visit and malformed eligibility',()=>{
 const mutations=[c=>{c.context_hash+='\n'},c=>{c.source.fecha='2026-02-30'},c=>{c.source.revision=2147483648},c=>{c.legacy_tasks.push(c.legacy_tasks[0])},c=>{c.legacy_tasks[0].eligibility='ready'},c=>{c.visit.videos.push(c.visit.videos[0])},c=>{c.visit.videos[0].visita_id=ids[3]},c=>{c.visit.cliente_id=3}];
 for(const mutate of mutations){const value=actualContext(true);mutate(value);assert.throws(()=>parseProductionHistoryBatchContext(value,7));}
});
test('reread preserves explicit choices but resets all video/global acknowledgments; no stale child revision copied',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(),7),previous=actualDraft(context),fresh=structuredClone(context);fresh.legacy_tasks[0].revision++;
 const draft=createProductionHistoryDraft(fresh,previous);assert.equal(draft.videos[0].local_key,previous.videos[0].local_key);assert.equal(draft.videos[0].acknowledged,false);assert.equal(draft.acknowledged,false);assert.equal(draft.children[0].reason,previous.children[0].reason);
 draft.videos[0].acknowledged=true;draft.acknowledged=true;assert.equal(buildProductionHistoryBatchInput(fresh,draft,ids[3]).child_dispositions[0].expected_revision,9);
});
test('ACK validates exact existing visit/video identities, cardinality and UUIDs before success',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(true),7),input=buildProductionHistoryBatchInput(context,actualDraft(context,{existing:true}),ids[3]),ack={reconciliation_id:ids[2],visita_id:ids[0],video_ids:[ids[1]],created:false};
 assert.deepEqual(parseProductionHistoryBatchResult({...ack,finance:'drop'},input),ack);
 for(const value of [{...ack,visita_id:ids[3]},{...ack,video_ids:[ids[3]]},{...ack,created:1},{...ack,video_ids:[]},{...ack,reconciliation_id:ids[2]+'\n'}])assert.throws(()=>parseProductionHistoryBatchResult(value,input));
});
test('real v2 codec model lost reply freezes actual body, explicit verification only, malformed ACK cannot succeed',async()=>{
 const sesion={token:'A',usuario:{id:1,rol:'admin'}},calls=[];let fail=true;
 const model=createProductionHistoryBatchModel({sourceId:7,sesion,readSession:()=>sesion,contract:productionHistoryBatchContract,createId:()=>ids[3],request:async(url,options)=>{calls.push({url,options});if(!options.method)return actualContext();if(fail)throw new Error('lost reply');return{reconciliation_id:ids[1],visita_id:ids[0],video_ids:[ids[2]],created:false}}});
 await model.open();model.update(actualDraft(model.snapshot.context));await model.submit();assert.equal(calls.length,2);assert.equal(model.snapshot.frozen,true);fail=false;await model.submit({verify:true});assert.equal(calls[1].options.body,calls[2].options.body);assert.equal(model.snapshot.phase,'saved');
});
test('actual JSX exposes independent acknowledgment, reciprocal ID mapping, discard and both entry points',()=>{
 const source=readFileSync(new URL('./ProductionHistoryBatchReview.jsx',import.meta.url),'utf8'),v1=readFileSync(new URL('./ProductionReconciliation.jsx',import.meta.url),'utf8'),css=readFileSync(new URL('./ProductionHistoryBatchReview.css',import.meta.url),'utf8');
 assert.match(source,/ninguna entrega, corrección, aprobación ni publicación histórica constituye evidencia/);assert.match(source,/value="manual_independent"/);assert.match(source,/value="">Elegir explícitamente/);assert.match(source,/DiscardChangesDialog/);assert.match(source,/existing_video_id:video.id/);assert.match(source,/key=\{key\}/);assert.doesNotMatch(source,/dangerouslySetInnerHTML|localStorage|video_ordinal/);
 assert.match(v1,/\['legacy_editing','already_linked'\].includes/);assert.match(v1,/onDraftStateChange=\{reportBatch\}/);assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:600px\)/);
});
function callback(name,deps){
 const source=readFileSync(new URL('./ProductionHistoryBatchReview.jsx',import.meta.url),'utf8'),ast=ts.createSourceFile('Batch.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);let found;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)found=node.initializer;ts.forEachChild(node,visit)}visit(ast);assert.ok(found,name);return Function(...Object.keys(deps),`return (${found.getText(ast)})`)(...Object.values(deps));
}
test('actual component mapping callback pins exact task/video IDs, clears acknowledgments and removal never remaps',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(),7),draft=actualDraft(context,{independent:true});let next;
 callback('chooseDisposition',{draft,historyVideoKey:video=>video.existing_video_id??video.local_key,update:value=>{next=value}})(ids[2],'task:11');
 assert.equal(next.videos[0].task_id,11);assert.equal(next.videos[0].disposition,'adopt_original');assert.equal(next.videos[0].acknowledged,false);assert.equal(next.children[0].video_key,ids[2]);assert.equal(next.children[0].disposition,'mapped');assert.equal(next.acknowledged,false);
 callback('removeVideo',{draft:next,historyVideoKey:video=>video.existing_video_id??video.local_key,update:value=>{next=value}})(ids[2]);assert.equal(next.videos.length,0);assert.equal(next.children[0].disposition,'');assert.equal(next.children[0].video_key,null);
});
test('actual state-change callback invalidates adoption rather than hiding a selected task on nonrecorded video',()=>{
 const context=parseProductionHistoryBatchContext(actualContext(),7),draft=actualDraft(context);let next;
 callback('changeVideo',{draft,historyVideoKey:video=>video.existing_video_id??video.local_key,update:value=>{next=value}})(ids[2],{new_video:{...draft.videos[0].new_video,estado:'pendiente'}});
 assert.equal(next.videos[0].task_id,null);assert.equal(next.videos[0].disposition,'');assert.equal(next.children[0].disposition,'');assert.equal(next.videos[0].acknowledged,false);
});
test('genuine cookie observation is retained and a new bootstrap fences pending batch ACK and verification',async()=>{
 const store=createBrowserSessionState();const publish=id=>{const ticket=store.beginBootstrap();store.acceptBootstrap(ticket,{usuario:{id,nombre:'QA',usuario:'qa',rol:'admin'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});};publish(1);const session=store.getSession(),d=deferred(),calls=[],states=[];
 const model=createProductionHistoryBatchModel({sourceId:7,sesion:session,readSession:store.getSession,contract:productionHistoryBatchContract,onChange:state=>states.push(state),createId:()=>ids[3],request:async(url,options)=>{calls.push({url,options});return options.method?d.promise:actualContext()}});
 await model.open();model.update(actualDraft(model.snapshot.context));const pending=model.submit(),count=states.length;assert.ok(calls[1].options.sessionIntent);assert.equal(calls[1].options.headers.Authorization,undefined);publish(2);d.resolve({reconciliation_id:ids[1],visita_id:ids[0],video_ids:[ids[2]],created:true});await pending;assert.equal(states.length,count);assert.equal(await model.submit({verify:true}),false);assert.equal(calls.length,2);
});
for(const method of ['GET reread','POST'])test(`${method}403 purges private state/body and never permits verification, reopening or another dispatch`,async()=>{
 const f=fixture();await f.model.open();f.model.update({choice:'private held draft',ack:true});
 f.transport(async()=>{throw Object.assign(new Error('private server payload'),{status:403})});
 if(method==='GET reread')await f.model.open({preserveDraft:true});else await f.model.submit();
 assert.equal(f.model.snapshot.phase,'denied');for(const field of ['context','draft','result'])assert.equal(f.model.snapshot[field],null);
 assert.deepEqual(f.drafts.at(-1),{dirty:false,busy:false});assert.equal(f.model.snapshot.frozen,false);assert.equal(f.model.snapshot.canReviewAgain,false);assert.equal(f.model.current(),false);assert.doesNotMatch(JSON.stringify(f.model.snapshot),/private held draft|private server payload/);
 const count=f.calls.length;assert.equal(await f.model.submit({verify:true}),false);assert.equal(await f.model.submit(),false);assert.equal(await f.model.open(),false);assert.equal(f.model.update({choice:'retry'}),false);assert.equal(f.calls.length,count);
});
test('actual denied JSX renders static denial only: no private fields, form, links or verification controls',()=>{
 const source=readFileSync(new URL('./ProductionHistoryBatchReview.jsx',import.meta.url),'utf8'),ast=ts.createSourceFile('Batch.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
 const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name.text==='BatchReview');
 const code=ts.transpileModule(node.getText(ast),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
 let index=0;const state={phase:'denied',context:null,draft:null,result:null,busy:false,dirty:false};
 const deps={React,apiRequest:()=>{},productionHistoryBatchContract,useState:initial=>[index++===0?state:initial,()=>{}],useRef:value=>({current:value}),useLayoutEffect:()=>{},useNavigationGuard:()=>{}};
 const component=Function(...Object.keys(deps),`${code};return BatchReview;`)(...Object.values(deps));
 const html=renderToStaticMarkup(component({sourceId:7,sesion:{token:'synthetic',usuario:{id:1,rol:'admin'}}}));
 assert.match(html,/Revisión no disponible/);assert.doesNotMatch(html,/<form|<input|<textarea|<select|<a |Verificar|Consultar contenido|Guardar revisión|synthetic/);
});
