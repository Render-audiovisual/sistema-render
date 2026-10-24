import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {validateGoalQuota,goalQuotaProgress,goalQuotaReviewBody,validGoalQuotaRevision,verifiedGoalPreparationAck,goalPreparationBody} from './clientGoalQuota.js';
import {createCapturedRequest,isSessionFailure} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
import {clientOperationHref} from './clientOperation.js';
import * as goalLocation from './clientGoalLocation.js';
const fingerprint='a'.repeat(64);
const piece=(id,tipo,numero,estado='pendiente')=>({id,tipo,numero,estado,en_cuota:numero<=1,titulo:`Contenido ${id}`,responsables:['QA'],tarea_id:id+100});
const client=()=>({id:8,cliente_id:9,clave:'cliente-9',nombre:'Cliente QA',cuentas:[{id:9,nombre:'Cliente QA'}],preparado:true,reels:1,carruseles:1,cuota_actual:{reels:3,carruseles:0},cuota_desactualizada:true,cuota_revision:fingerprint,piezas:[piece(1,'video',1,'finalizada'),piece(2,'carrusel',1),piece(3,'video',2,'finalizada'),piece(4,'carrusel',2,'publicada')]});
const input=()=>({client:client(),period:'2026-11',formats:{video:[7],carrusel:[8]},accounts:{9:[8]},role:'admin',acknowledged:true});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
test('closed quota observation requires real counts, strict flags, exact64hex and numbered quota membership',()=>{
 const value=client(),original=structuredClone(value);assert.deepEqual(validateGoalQuota(value),{prepared:true,current:{reels:3,carruseles:0},stored:{reels:1,carruseles:1},drift:true,revision:fingerprint});assert.deepEqual(value,original);
 for(const patch of [{cuota_actual:undefined},{cuota_actual:{reels:-1,carruseles:0}},{cuota_actual:{reels:'3',carruseles:0}},{cuota_desactualizada:'true'},{cuota_revision:null},{cuota_revision:fingerprint+'\n'},{cuota_revision:'A'.repeat(64)}])assert.throws(()=>validateGoalQuota({...client(),...patch}));
 for(const patch of [{numero:undefined},{numero:0},{numero:'1'},{en_cuota:undefined},{en_cuota:'true'},{en_cuota:false}]){const value=client();value.piezas[0]={...value.piezas[0],...patch};assert.throws(()=>validateGoalQuota(value))}
 const duplicate=client();duplicate.piezas.push({...duplicate.piezas[0],id:99});assert.throws(()=>validateGoalQuota(duplicate));
 const historic=client();historic.cuota_actual=null;historic.cuota_revision=null;assert.equal(validateGoalQuota(historic).current,null);
 const unprepared={...client(),preparado:false,piezas:[],cuota_desactualizada:false,cuota_revision:null};assert.doesNotThrow(()=>validateGoalQuota(unprepared));
});
test('all-format and per-format progress excludes additional completed work without deleting it',()=>{
 const value=client(),before=structuredClone(value),total=goalQuotaProgress(value),video=goalQuotaProgress(value,'video'),carousel=goalQuotaProgress(value,'carrusel');
 assert.equal(total.completed,1);assert.deepEqual(total.quota.map(item=>item.id),[1,2]);assert.deepEqual(total.additional.map(item=>item.id),[3,4]);assert.equal(video.completed,1);assert.equal(carousel.completed,0);assert.deepEqual(value,before);
 const zero=client();zero.reels=0;zero.carruseles=0;zero.piezas.forEach(item=>{item.en_cuota=false});validateGoalQuota(zero);assert.equal(goalQuotaProgress(zero).completed,0);assert.equal(goalQuotaProgress(zero).additional.length,4);
});
test('review body pins resource/month/fingerprint and ID selections, with explicit admin preservation acknowledgement',()=>{
 const data=input(),before=structuredClone(data),body=goalQuotaReviewBody(data);
 assert.deepEqual(body,{periodo:'2026-11',clave:'cliente-9',responsables:[7,8],responsables_por_formato:{video:[7],carrusel:[8]},expected_quota_revision:fingerprint});assert.deepEqual(data,before);
 data.formats.video.push(99);assert.deepEqual(body.responsables_por_formato.video,[7]);
 for(const patch of [{role:'community'},{role:'diseno'},{acknowledged:false},{period:'2026-11\n'},{period:'2026-09'},{formats:{video:['7'],carrusel:[8]}}])assert.throws(()=>goalQuotaReviewBody({...input(),...patch}));
 for(const revision of [null,fingerprint+'\n','finance',7])assert.throws(()=>goalQuotaReviewBody({...input(),client:{...client(),cuota_revision:revision}}));
 const shared=input();shared.client.cuentas.push({id:10,nombre:'Otra cuenta'});shared.accounts={9:[8],10:[7]};assert.deepEqual(goalQuotaReviewBody(shared).responsables_por_cuenta,{'9':[8],'10':[7]});
 delete shared.accounts[10];assert.throws(()=>goalQuotaReviewBody(shared));
 assert.equal(validGoalQuotaRevision(fingerprint),true);assert.equal(validGoalQuotaRevision(fingerprint+'\n'),false);
});
test('ACK projects only confirmed preparation counters and must target the held objective for review',()=>{
 assert.deepEqual(verifiedGoalPreparationAck({objetivo_id:8,creadas:2,vinculadas:0,finance:{secret:1}},8),{objetivo_id:8,creadas:2,vinculadas:0});
 for(const value of [{objetivo_id:9,creadas:2,vinculadas:0},{objetivo_id:8,creadas:'2',vinculadas:0},{objetivo_id:8,creadas:-1,vinculadas:0},{}])assert.throws(()=>verifiedGoalPreparationAck(value,8));
});
const source=readFileSync(new URL('./ClientesObjetivos.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('ClientesObjetivos.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const found=[];function visit(n){if(predicate(n))found.push(n);ts.forEachChild(n,visit)}visit(root);return found}
const owner=name=>file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
function callback(component,name,deps){const node=nodes(owner(component),n=>ts.isVariableDeclaration(n)&&n.name.getText(file)===name)[0].initializer;return new Function(...Object.keys(deps),`return (${node.getText(file)});`)(...Object.values(deps))}
function fixture(transport){
 const store=createBrowserSessionState(),accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,rol:'admin',usuario:'qa',nombre:'QA'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});accept(7);
 const session=store.getSession();let live=session,active=true;const effects=[],calls=[],data=input();
 const capture=()=>createCapturedRequest({session,readSession:()=>live,isActive:()=>active,request:async(url,options)=>{calls.push({url,options});return transport(url,options)}});
 const deps={...data,view:{role:'admin'},capture,captureLifetime:capture,pending:{current:false},reviewBlocked:{current:false},reconciling:true,shared:false,goalQuotaReviewBody,verifiedGoalPreparationAck,isSessionFailure,saved:value=>effects.push(['saved',value])};
 for(const name of ['Busy','Error','Blocked'])deps[`set${name}`]=value=>effects.push([name,value]);
 return{deps,effects,calls,submit:()=>callback('PrepareGoal','submit',deps)({preventDefault(){}}),switch(){accept(8);live=store.getSession()},unmount(){active=false},changeContext(){active=false}};
}
test('actual review submits once with immutable observed fingerprint and original cookie; verified ACK alone calls saved',async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise),pending=f.submit();await f.submit();assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].url,'/api/cliente-objetivos/reconciliar');assert.equal(f.calls[0].options.headers.Authorization,undefined);assert.ok(f.calls[0].options.sessionIntent);
 f.deps.formats.video.push(99);f.deps.client.cuota_revision='b'.repeat(64);const body=JSON.parse(f.calls[0].options.body);assert.equal(body.expected_quota_revision,fingerprint);assert.deepEqual(body.responsables_por_formato.video,[7]);
 wait.resolve({objetivo_id:8,creadas:2,vinculadas:0});await pending;assert.ok(f.effects.some(([name])=>name==='saved'));
});
test('actual 409/network/ambiguous ACK preserves selections and blocks every resubmit until modal reload/reopen',async()=>{
 for(const response of [Object.assign(Error('stale'),{status:409}),Error('lost response'),{objetivo_id:99,creadas:0,vinculadas:0},{}]){
  const f=fixture(async()=>{if(response instanceof Error)throw response;return response}),before=structuredClone(f.deps.formats);
  await f.submit();await f.submit();assert.equal(f.calls.length,1);assert.equal(f.deps.reviewBlocked.current,true);assert.deepEqual(f.deps.formats,before);assert.ok(!f.effects.some(([name])=>name==='saved'));assert.ok(f.effects.some(([name,value])=>name==='Error'&&value.includes('Cerrá y volvé a abrir')));
 }
});
test('actual review requires admin/ack before dispatch; stale session/context/unmount cannot paint or refresh',async()=>{
 for(const patch of [{acknowledged:false},{view:{role:'community'}}]){const f=fixture(async()=>assert.fail('no authority'));Object.assign(f.deps,patch);await f.submit();assert.equal(f.calls.length,0);assert.equal(f.deps.reviewBlocked.current,false)}
 for(const action of ['switch','unmount','changeContext'])for(const fail of [false,true]){
  const wait=deferred(),f=fixture(()=>wait.promise),pending=f.submit();f[action]();const count=f.effects.length;
  fail?wait.reject(Object.assign(Error('stale'),{status:409})):wait.resolve({objetivo_id:8,creadas:0,vinculadas:0});await pending;assert.equal(f.effects.length,count);assert.equal(f.calls.length,1);
 }
});
test('actual toggle cannot change pending/blocked draft and changing selection requires a fresh acknowledgement',()=>{
 const changes=[],deps={pending:{current:false},reviewBlocked:{current:false},capture:()=>({current:()=>true}),shared:false,reconciling:true,setSelected:fn=>changes.push(fn({video:[7]})),setAccounts:()=>assert.fail('not shared'),setAcknowledged:value=>changes.push(value)};
 const toggle=callback('PrepareGoal','toggle',deps);toggle({key:'video'},8);assert.deepEqual(changes,[{video:[7,8]},false]);deps.pending.current=true;toggle({key:'video'},9);deps.pending.current=false;deps.reviewBlocked.current=true;toggle({key:'video'},9);assert.equal(changes.length,2);
});
test('closing review invalidates loaded baseline and triggers actual overview reload before reopening',()=>{
 const effects=[],deps={preparing:'reconcile',loaded:{current:true},modalOpen:{current:true},pendingPeriod:{current:null},deferred:{current:false}};
 for(const name of ['Loading','Preparing','SelectedPiece','Period','LocationError','Revision'])deps[`set${name}`]=value=>effects.push([name,value]);
 callback('GoalPage','closeModal',deps)();assert.equal(deps.loaded.current,false);assert.ok(effects.some(([name,value])=>name==='Loading'&&value===true));assert.ok(effects.some(([name])=>name==='Revision'));
 const openDeps={capture:()=>({current:()=>true}),loaded:deps.loaded,canReviewQuota:true,modalOpen:{current:false},deferred:{current:false},setPreparing:()=>assert.fail('cannot reopen stale observation')};callback('GoalPage','openQuotaReview',openDeps)();
});
test('actual page render counts only quota on sidebar/summary/formats and retains additional task detail actions',()=>{
 const value=client(),data={periodo:'2026-11',clientes:[value]},state=['2026-11','',data,'',false,value.clave,null,0,false,''];let index=0;
 const declarations=[owner('GoalPieceButton'),owner('GoalPage')].map(node=>node.getText(file)).join('\n');
 const compiled=ts.transpileModule(declarations,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
 const STATES={finalizada:'Finalizada',publicada:'Finalizada',pendiente:'Pendiente'};
 const deps={...goalLocation,React,useRef:initial=>({current:initial}),useState:()=>[state[index++],()=>{}],useEffect(){},useGoalSession:()=>({view:{role:'admin',session:{}},epoch:0,capture:()=>({current:()=>true})}),goalPeriod:()=> '2026-11',currentMonth:()=> '2026-11',goalQuotaProgress,validGoalQuotaRevision,window:{location:{search:'?periodo=2026-11',hostname:'render.test'}},GoalIcon:()=>null,GoalLoading:()=>null,PageState:()=>null,PrepareGoal:()=>null,PieceDetail:()=>null,monthLabel:()=> 'noviembre de 2026',done:piece=>['finalizada','publicada'].includes(piece.estado),pieceLabel:piece=>piece.tipo==='video'?`Reel ${piece.numero}`:piece.titulo,STATES};
 deps.useGoalDraftMemory=()=>null;
 deps.draftMemory=null;
 const Page=new Function('clientOperationHref',...Object.keys(deps),`${compiled};return GoalPage;`)(clientOperationHref,...Object.values(deps));const html=renderToStaticMarkup(React.createElement(Page,{sesion:{}}));
 assert.match(html,/Cliente QA: 1 de 2 completados/);assert.match(html,/aria-valuenow="1"/);assert.match(html,/1 de 1/);assert.match(html,/0 de 1/);assert.match(html,/Contenido adicional/);assert.match(html,/No cuenta para la cuota/);assert.match(html,/Reel 2/);assert.match(html,/Contenido 4/);assert.match(html,/Revisar cuota/);
 assert.equal((html.match(/class="cg-piece(?: is-done)?"/g)||[]).length,4);
});
test('source strict overview validation, review mode key, held revision and background-modal deferral remain connected',()=>{
 assert.equal(file.parseDiagnostics.length,0);assert.match(owner('goalOverview').getText(file),/validateGoalQuota\(client\)/);
 assert.match(source,/mode=\{preparing === 'reconcile' \? 'reconcile' : 'prepare'\}/);assert.match(source,/\$\{client.clave\}:\$\{preparing === 'reconcile'/);
 assert.match(source,/if \(modalOpen.current\) \{ deferred.current = true; return; \}/);
 assert.match(source,/disabled=\{busy \|\| blocked\}/);assert.match(source,/Revisé ambas cuotas/);
 assert.doesNotMatch(source,/piece\.en_cuota !== false|\/reconciliar.*\.then/);
});
