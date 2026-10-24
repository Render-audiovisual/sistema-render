import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {goalPreparationBody,goalPreparationRevision,goalQuotaProgress,goalQuotaReviewBody,validGoalQuotaRevision,verifiedGoalPreparationAck} from './clientGoalQuota.js';
import {clientOperationHref} from './clientOperation.js';
import * as goalLocation from './clientGoalLocation.js';
import {createCapturedRequest,isSessionFailure} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
import {registerNavigationGuard,installUnsavedNavigation} from '../shared/navigation/unsaved.js';

const revision='a'.repeat(64);
const client=()=>({clave:'grupo-3',cliente_id:7,nombre:'Feed compartido',cuentas:[{id:7,nombre:'Cuenta A'},{id:8,nombre:'Cuenta B'}],preparado:false,reels:2,carruseles:1,cuota_actual:{reels:2,carruseles:1},cuota_desactualizada:false,cuota_revision:null,preparacion_revision:revision,piezas:[]});
const input=()=>({client:client(),period:'2026-11',role:'community',acknowledged:true,formats:{video:[11],carrusel:[12,13]},accounts:{7:[12],8:[13]}});
const source=readFileSync(new URL('./ClientesObjetivos.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('ClientesObjetivos.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const owner=name=>file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
function nodes(root,predicate){const found=[];function visit(n){if(predicate(n))found.push(n);ts.forEachChild(n,visit);}visit(root);return found;}
function callback(component,name,deps){const initializer=nodes(owner(component),n=>ts.isVariableDeclaration(n)&&n.name.getText(file)===name)[0].initializer;return new Function(...Object.keys(deps),`return (${initializer.getText(file)});`)(...Object.values(deps));}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('normal preparation body pins observed month/group/hash, actual IDs, all accounts, acknowledgment and existing CM/admin rights',()=>{
 const data=input(),before=structuredClone(data),body=goalPreparationBody(data);
 assert.deepEqual(body,{periodo:'2026-11',clave:'grupo-3',responsables:[11,12,13],responsables_por_formato:{video:[11],carrusel:[12,13]},responsables_por_cuenta:{7:[12],8:[13]},expected_preparation_revision:revision});assert.deepEqual(data,before);
 data.accounts[7].push(99);data.formats.video.push(99);assert.deepEqual(body.responsables_por_cuenta[7],[12]);assert.deepEqual(body.responsables_por_formato.video,[11]);
 assert.ok(goalPreparationBody({...input(),role:'admin'}));
 for(const patch of [{acknowledged:false},{role:'diseno'},{role:'Líder'},{period:'2026-09'},{period:'2026-11\n'},{formats:{video:['11'],carrusel:[12]}},{accounts:{7:[12]}},{accounts:{7:[12],8:[99]}}])assert.throws(()=>goalPreparationBody({...input(),...patch}));
 for(const patch of [{preparacion_revision:null},{preparacion_revision:revision+'\n'},{preparacion_revision:'A'.repeat(64)},{clave:'grupo-3\n'},{cuota_desactualizada:true},{reels:0,carruseles:0},{cuentas:[{id:7},{id:7}]},{reels:101}])assert.throws(()=>goalPreparationBody({...input(),client:{...client(),...patch}}));
 const orphan={...client(),preparado:true,cuota_actual:null,preparacion_revision:null};assert.equal(goalPreparationRevision(orphan),null);assert.throws(()=>goalPreparationBody({...input(),client:orphan}));
 assert.throws(()=>goalPreparationRevision({...client(),preparacion_revision:undefined}));
});
function fixture(transport,role='community'){
 const store=createBrowserSessionState();const accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,rol:role,nombre:'QA',usuario:'qa'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});accept(11);
 const session=store.getSession();let current=session,active=true;const calls=[],effects=[];
 const capture=()=>createCapturedRequest({session,readSession:()=>current,isActive:()=>active,request:(url,options)=>{calls.push({url,options});return transport(url,options);}});
 const deps={...input(),view:{role},capture,captureLifetime:capture,pending:{current:false},reviewBlocked:{current:false},reconciling:false,goalPreparationBody,goalQuotaReviewBody,verifiedGoalPreparationAck,isSessionFailure,saved:result=>effects.push(['saved',result])};
 for(const key of ['Busy','Error','Blocked'])deps[`set${key}`]=value=>effects.push([key,value]);
 return{deps,calls,effects,submit:()=>callback('PrepareGoal','submit',deps)({preventDefault(){}}),replace(){accept(12);current=store.getSession();},obsolete(){active=false;}};
}
test('actual normal submit is single-flight, immutable original cookie/hash; wrong ACK, unknown or conflict cannot be retried or rebased',async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise),pending=f.submit();await f.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/cliente-objetivos/preparar');assert.ok(f.calls[0].options.sessionIntent);assert.equal(f.calls[0].options.headers.Authorization,undefined);
 f.deps.client.preparacion_revision='b'.repeat(64);f.deps.formats.video.push(99);assert.equal(JSON.parse(f.calls[0].options.body).expected_preparation_revision,revision);assert.deepEqual(JSON.parse(f.calls[0].options.body).responsables_por_formato.video,[11]);
 wait.resolve({objetivo_id:5,creadas:3,vinculadas:0});await pending;await f.submit();assert.equal(f.calls.length,1);assert.equal(f.effects.filter(([key])=>key==='saved').length,1);
 for(const value of [Object.assign(Error('stale'),{status:409}),Object.assign(Error('unknown'),{status:503}),Error('network'),{}, {objetivo_id:5,creadas:'1',vinculadas:0}]){
  const f=fixture(async()=>{if(value instanceof Error)throw value;return value;}),before=structuredClone(f.deps.formats);await f.submit();await f.submit();assert.equal(f.calls.length,1);assert.equal(f.deps.reviewBlocked.current,true);assert.deepEqual(f.deps.formats,before);assert.equal(f.effects.some(([key])=>key==='saved'),false);assert.ok(f.effects.some(([key,message])=>key==='Error'&&message.includes('Cerrá y volvé a abrir')));
 }
 const wrong=fixture(async()=>({objetivo_id:99,creadas:0,vinculadas:0}));wrong.deps.client={...client(),preparado:true,id:5,cuota_revision:revision};await wrong.submit();assert.equal(wrong.effects.some(([key])=>key==='saved'),false);
});
test('actual no-ack/unauthorized actions do not dispatch; late actor, context ABA and unmount have no continuation effects',async()=>{
 for(const patch of [{acknowledged:false},{view:{role:'produccion'}}]){const f=fixture(()=>assert.fail('must not request'));Object.assign(f.deps,patch);await f.submit();assert.equal(f.calls.length,0);}
 for(const action of ['replace','obsolete'])for(const fail of [false,true]){const wait=deferred(),f=fixture(()=>wait.promise),promise=f.submit();f[action]();const count=f.effects.length;fail?wait.reject(Error('late')):wait.resolve({objetivo_id:5,creadas:0,vinculadas:0});await promise;assert.equal(f.effects.length,count);await f.submit();assert.equal(f.calls.length,1);}
});
test('closing ordinary preparation invalidates and reloads the baseline even without an intervening poll; busy close is refused',()=>{
 const effects=[],deps={preparing:true,loaded:{current:true},modalOpen:{current:true},pendingPeriod:{current:null},deferred:{current:false}};
 for(const key of ['Loading','Preparing','SelectedPiece','Revision'])deps[`set${key}`]=value=>effects.push([key,value]);
 callback('GoalPage','closeModal',deps)();assert.equal(deps.loaded.current,false);assert.ok(effects.some(([key])=>key==='Revision'));assert.ok(effects.some(([key,value])=>key==='Loading'&&value));
 const close={pending:{current:true},capture:()=>({current:()=>true}),close:()=>assert.fail('pending closes'),acknowledged:false};callback('PrepareGoal','closeSafely',close)();
 const open={capture:()=>({current:()=>true}),loaded:deps.loaded,modalOpen:{current:false},canManage:true,historic:false,client:client(),total:3,validGoalQuotaRevision,setPreparing:()=>assert.fail('cannot open an outdated baseline')};callback('GoalPage','openPreparation',open)();
});
function component(name,deps){const code=ts.transpileModule(owner(name).getText(file),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;return new Function(...Object.keys(deps),`${code};return ${name};`)(...Object.values(deps));}
function renderPage(value,role='community'){
 const state=['2026-11','',{periodo:'2026-11',clientes:[value]},'',false,value.clave,null,0,false,''];let index=0;
 const deps={...goalLocation,React,useRef:initial=>({current:initial}),useState:()=>[state[index++],()=>{}],useEffect(){},useGoalSession:()=>({view:{role,session:{}},epoch:0,capture:()=>({current:()=>true})}),goalPeriod:()=> '2026-11',currentMonth:()=> '2026-11',goalQuotaProgress,validGoalQuotaRevision,clientOperationHref,window:{location:{search:'?periodo=2026-11',hostname:'render.test'}},GoalIcon:()=>null,GoalLoading:()=>null,PageState:()=>null,PrepareGoal:()=>null,PieceDetail:()=>null,GoalPieceButton:()=>null,monthLabel:()=> 'noviembre de 2026'};
 deps.useGoalDraftMemory=()=>null;
 deps.draftMemory=null;
 return renderToStaticMarkup(React.createElement(component('GoalPage',deps),{sesion:{}}));
}
test('actual page SSR unprepared basic/nominal/shared has no compliance ratios or scheduler promises; zero quota is not missing agreement',()=>{
 const basic={...client(),reels:0,carruseles:0,cuota_actual:{reels:0,carruseles:0}},html=renderPage(basic);
 assert.match(html,/No hay piezas incluidas/);assert.doesNotMatch(html,/role="progressbar"|0%|0 de 0|0\/0|Objetivo completado|automática|automáticamente|gestion=1|Preparar objetivo del mes/);
 const admin=renderPage(basic,'admin');assert.match(admin,/gestion=1&amp;cliente=7/);assert.match(admin,/gestion=1&amp;cliente=8/);assert.doesNotMatch(admin,/abono|Sin acuerdo|Sin configuración|\$/);
 const nominal=renderPage(client());assert.match(nominal,/Cuota del mes: 2 reels · 1 carruseles compartidos/);assert.match(nominal,/Preparar objetivo del mes/);assert.doesNotMatch(nominal,/role="progressbar"|0%|0 de 2/);
 const prepared={...client(),id:5,preparado:true,cuota_revision:revision};const ready=renderPage(prepared);assert.match(ready,/role="progressbar"/);assert.match(ready,/0 de 2/);assert.match(ready,/Actualizar responsables y completar objetivo/);
});
test('actual modal SSR shows selected month, observed quota, all real accounts and unchecked acknowledgment, without multiplying shared quota',()=>{
 const deps={React,useGoalModalFocus(){},useNavigationGuard(){},useGoalSession:()=>({view:{role:'community'},capture:()=>({current:()=>true}),captureLifetime:()=>({current:()=>true})}),useRef:initial=>({current:initial}),useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect(){},monthLabel:()=> 'noviembre de 2026',Modal:({children,title})=>React.createElement('section',null,React.createElement('h1',null,title),children),validGoalQuotaRevision};
 const html=renderToStaticMarkup(React.createElement(component('PrepareGoal',deps),{sesion:{},client:client(),period:'2026-11',close(){},saved(){}}));
 assert.match(html,/Preparar objetivo del mes/);assert.match(html,/noviembre de 2026/);assert.match(html,/2 reels · 1 carruseles/);assert.match(html,/Cuenta A · #7/);assert.match(html,/Cuenta B · #8/);assert.match(html,/no por cuenta/);assert.match(html,/no es sólo un cambio de asignaciones/);assert.match(html,/Confirmar preparación del mes/);assert.match(html,/disabled=""/);assert.doesNotMatch(html,/checked=""/);
});
class Target {
 listeners=new Map();
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);return !event.defaultPrevented;}
}
const navEvent=(type,extra={})=>({type,defaultPrevented:false,cancelable:true,preventDefault(){this.defaultPrevented=true;},...extra});
function navigationFixture(f){
 const win=new Target();win.location=new URL('https://render.test/clientes?periodo=2026-11');win.navigation=new Target();win.prompts=[];win.accept=false;win.confirm=message=>{win.prompts.push(message);return win.accept;};
 Object.assign(f.deps,{selected:{video:[11],carrusel:[12,13]},accounts:{7:[12],8:[13]},acknowledged:false});f.deps.initialSelection={current:JSON.stringify({selected:f.deps.selected,accounts:f.deps.accounts})};
 const get=()=>callback('PrepareGoal','preparationNavigationStatus',f.deps)();
 const hookSource=readFileSync(new URL('../shared/navigation/useNavigationGuard.js',import.meta.url),'utf8'),hookFile=ts.createSourceFile('hook.js',hookSource,ts.ScriptTarget.Latest,true),hook=hookFile.statements.find(n=>ts.isFunctionDeclaration(n));
 let cleanup;const latest={current:null};
 const useGuard=new Function('useRef','useEffect','registerNavigationGuard','window',`return (${hook.getText(hookFile).replace(/^export /,'')});`)(()=>latest,effect=>{cleanup=effect();},registerNavigationGuard,win);
 const installation=installUnsavedNavigation(win);useGuard(get);
 const send=(type,extra)=>{const event=navEvent(type,extra);win.dispatchEvent(event);return event;};
 return{win,get,link:()=>send('render:before-navigation',{detail:{href:'/inicio'}}),unload:()=>send('beforeunload'),cleanup:()=>{cleanup();installation.dispose();}};
}
test('actual modal getter and actual shared hook protect dirty/uncertain navigation and beforeunload without local-close double prompts',()=>{
 const f=fixture(async()=>({})),n=navigationFixture(f);
 try {
  assert.deepEqual(n.get(),{dirty:false,busy:false});assert.equal(n.link().defaultPrevented,false);
  f.deps.selected.video.push(99);assert.equal(n.link().defaultPrevented,true);assert.equal(n.unload().defaultPrevented,true);assert.equal(n.win.prompts.length,1);
  n.win.accept=true;assert.equal(n.link().defaultPrevented,false);assert.deepEqual(f.deps.selected.video,[11,99]);
  f.deps.selected.video.pop();f.deps.reviewBlocked.current=true;assert.equal(n.get().dirty,true);n.win.accept=false;assert.equal(n.link().defaultPrevented,true);
  f.deps.window=n.win;f.deps.close=()=>assert.fail('cancel keeps review');callback('PrepareGoal','closeSafely',f.deps)();assert.match(n.win.prompts.at(-1),/puede haberse guardado sin confirmación/);
  const count=n.win.prompts.length;n.win.accept=true;let closed=0;f.deps.close=()=>closed++;callback('PrepareGoal','closeSafely',f.deps)();assert.equal(closed,1);assert.equal(n.win.prompts.length,count+1);
 } finally {n.cleanup();}
});
test('actual pending POST blocks sidebar/unload synchronously; obsolete actor and hook cleanup release protection without abort claims',async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise),n=navigationFixture(f);f.deps.acknowledged=true;
 try {
  const promise=f.submit();assert.equal(f.deps.pending.current,true);assert.equal(n.get().busy,true);assert.equal(n.link().defaultPrevented,true);assert.equal(n.unload().defaultPrevented,true);assert.equal(n.win.prompts.length,0);
  f.replace();assert.deepEqual(n.get(),{dirty:false,busy:false});assert.equal(n.link().defaultPrevented,false);assert.equal(n.unload().defaultPrevented,false);
  const count=f.effects.length;wait.reject(Error('unconfirmed late write'));await promise;assert.equal(f.effects.length,count);
 } finally {n.cleanup();}
 assert.equal(n.link().defaultPrevented,false);assert.equal(n.unload().defaultPrevented,false);
 const calls=nodes(owner('PrepareGoal'),node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useNavigationGuard');assert.equal(calls.length,1);assert.equal(calls[0].arguments[0].getText(file),'preparationNavigationStatus');
});
test('overview requires preparation observation; no client form effect posts or quota mutation payload leaks',()=>{
 assert.equal(file.parseDiagnostics.length,0);assert.match(owner('goalOverview').getText(file),/goalPreparationRevision\(client\)/);
 assert.match(owner('PrepareGoal').getText(file),/goalPreparationBody\(\{client,period,formats,accounts,role:view.role,acknowledged\}\)/);
 assert.doesNotMatch(source,/Generación mensual automática|Cada mes se generan|Guardar responsables/);
 for(const effect of nodes(owner('GoalPage'),n=>ts.isCallExpression(n)&&n.expression.getText(file)==='useEffect'))assert.doesNotMatch(effect.getText(file),/method: 'POST'|\/preparar/);
});
