import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {blankMonthlyAgreementDraft,createMonthlyAgreementOperation,MONTHLY_AGREEMENT_DESIGNERS} from './monthlyAgreement.js';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {registerNavigationGuard,installUnsavedNavigation} from '../shared/navigation/unsaved.js';
import {hasNoConfiguredMonthlyAgreement} from '../pages/clientCreate.js';

const source=readFileSync(new URL('./StartMonthlyAgreementModal.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('StartMonthlyAgreementModal.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const parentSource=readFileSync(new URL('./ClienteModals.jsx',import.meta.url),'utf8'),parentFile=ts.createSourceFile('ClienteModals.jsx',parentSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const owner=(name,ast=file)=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
function nodes(root,predicate){const found=[];function visit(n){if(predicate(n))found.push(n);ts.forEachChild(n,visit);}visit(root);return found;}
function callback(name,deps){const node=nodes(owner('StartMonthlyAgreementSession'),n=>ts.isVariableDeclaration(n)&&n.name.getText(file)===name)[0].initializer;return new Function(...Object.keys(deps),`return (${node.getText(file)});`)(...Object.values(deps));}
function component(names,deps){const code=ts.transpileModule(names.map(name=>owner(name).getText(file)).join('\n'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;return new Function(...Object.keys(deps),`${code};return ${names.at(-1)};`)(...Object.values(deps));}
const context=()=>({version:1,eligible:true,agreement_revision:'a1:7:1:0:0',cliente:{id:7,nombre:'Cliente <script>',activo:true,rubro:null,fecha_inicio:null}});
const form=()=>({vigente_desde:'2026-11',cuota_reels:'2',cuota_carruseles:'1',abono_mensual:'100',dias_historias:[1],dias_reels:[],dias_carruseles:[],rubro:'Estudio',disenador_responsable:'Augusto'});
const ack=()=>({version:1,cliente:{id:7,nombre:'Cliente <script>',activo:true,rubro:'Estudio',fecha_inicio:'2026-11-01',cuota_reels:2,cuota_carruseles:1,grupo_feed_id:null,configuracion_completa:true,configuracion_vigente_desde:'2026-11-01',abono_vigente_desde:'2026-11-01',abono_mensual:'100.00',dias_historias:[1],dias_reels:[],dias_carruseles:[],disenador_responsable:'Augusto',agreement_revision:'a1:7:4:0:0'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(request){
 const session={token:'synthetic-A',usuario:{id:11,rol:'admin',activo:true}};let live=session,active=true;const states=[],effects=[],calls=[];
 const capture=()=>createCapturedRequest({session,readSession:()=>live,isActive:()=>active,request:(url,options)=>{calls.push({url,options});return request(url,options);}});
 const operation=createMonthlyAgreementOperation({clientId:7,capture,onChange:s=>states.push(s)});
 const deps={allowed:true,capture,operation,agreementBodyRef:{current:null},closeFocusIntent:{current:null},blankMonthlyAgreementDraft,draft:form(),acknowledged:true,publishing:{current:false},closing:{current:false},onSaved:async(row,guard)=>{guard.assertCurrent();effects.push(['saved',row]);},setDraft:value=>effects.push(['draft',value]),setAcknowledged:value=>effects.push(['ack',value]),setCallbackError:value=>effects.push(['error',value])};
 return{operation,states,effects,calls,deps,capture,submit:()=>callback('submit',deps)({preventDefault(){}}),replace(){live={token:'synthetic-B',usuario:{id:12,rol:'admin',activo:true}};},unmount(){active=false;operation.dispose();}};
}
function render(state,draft=blankMonthlyAgreementDraft(),allowed=true){
 let index=0;const values=[state,draft,false,false,''];
 const deps={React,useState:()=>[values[index++],()=>{}],useRef:initial=>({current:initial}),useEffect(){},useLayoutEffect(){},useNavigationGuard(){},blankMonthlyAgreementDraft,MONTHLY_AGREEMENT_DESIGNERS,WEEKDAYS:[[1,'Lun'],[2,'Mar'],[3,'Mié'],[4,'Jue'],[5,'Vie'],[6,'Sáb'],[0,'Dom']],Modal:({children,className,title})=>React.createElement('section',{className},React.createElement('h1',null,title),children)};
 return renderToStaticMarkup(React.createElement(component(['AgreementDays','StartMonthlyAgreementSession'],deps),{clientId:7,allowed,capture:()=>({current:()=>true})}));
}
test('actual modal SSR presents empty required values, explicit zero policy and reference-only designer, consistent touch/mobile CSS',()=>{
 assert.equal(file.parseDiagnostics.length,0);const html=render({status:'ready',context:context(),result:null,error:'',busy:false,attempted:false});
 assert.match(html,/Cliente &lt;script&gt;/);assert.doesNotMatch(html,/<script>|value="0"|value="100"|checked=""/);assert.match(html,/value=""/);assert.match(html,/elegí al menos uno/);assert.match(html,/pueden quedar vacíos/);assert.match(html,/no asigna permisos ni responsables/);assert.match(html,/Iniciar acuerdo mensual/);assert.match(html,/disabled=""/);assert.equal((html.match(/<option[^>]*selected=""/g)||[]).length,1);
 const css=readFileSync(new URL('./StartMonthlyAgreementModal.css',import.meta.url),'utf8');assert.match(css,/min-height:44px/);assert.match(css,/focus-visible/);assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);assert.doesNotMatch(css,/^:root|@keyframes|--[^:]+:\s*#/m);
});
test('actual denied/ineligible render has no private draft or form; malformed/ineligible context never starts configuration',()=>{
 const privateDraft={...form(),rubro:'PRIVATE',abono_mensual:'987.65'};
 const denied=render({status:'denied',context:null,result:null,error:'',busy:false},privateDraft);assert.doesNotMatch(denied,/PRIVATE|987|Cliente|<form|<input|<select/);assert.match(denied,/Se retiraron los datos/);
 const ineligible=render({status:'ineligible',context:null,result:null,error:'Revisá la cartera.',busy:false},privateDraft);assert.doesNotMatch(ineligible,/PRIVATE|987|<form|<input|<select/);assert.match(ineligible,/Cerrar y revisar cartera/);
});
test('actual authorized saved modal reads verified chosen-month quota and ARS agreement amount without claiming payment or created tasks',()=>{
 const state={status:'saved',context:null,result:ack().cliente,error:'',busy:false,attempted:true},html=render(state);
 assert.match(html,/Inicio: 2026-11-01/);assert.match(html,/2 reels · 1 carruseles/);assert.match(html,/Abono mensual acordado · ARS/);assert.match(html,/100,00/);assert.match(html,/Abono acordado; no es un pago registrado/);assert.match(html,/Esta operación no crea tareas, publicaciones ni pagos/);assert.doesNotMatch(html,/<form|type="submit"/);
 assert.doesNotMatch(render(state,blankMonthlyAgreementDraft(),false),/100,00|2 reels|2026-11-01/);
});
test('actual submit callback calls parent only after verified complete ACK and distinguishes refresh callback failure from write failure',async()=>{
 const f=fixture(async(_url,options)=>options.method==='GET'?context():ack());await f.operation.load();await f.submit();assert.equal(f.effects.filter(([key])=>key==='saved').length,1);assert.ok(f.effects.some(([key,value])=>key==='draft'&&value.abono_mensual===''));
 const bad=fixture(async(_url,options)=>options.method==='GET'?context():{version:1,cliente:{id:7}});await bad.operation.load();await bad.submit();assert.equal(bad.effects.length,0);assert.equal(bad.operation.snapshot.status,'blocked');await bad.submit();assert.equal(bad.calls.length,2);
 const refresh=fixture(async(_url,options)=>options.method==='GET'?context():ack());await refresh.operation.load();refresh.deps.onSaved=async()=>{throw Error('read refresh failed');};await refresh.submit();assert.ok(refresh.effects.some(([key,message])=>key==='error'&&message.includes('El acuerdo se guardó')));await refresh.submit();assert.equal(refresh.calls.length,2);assert.equal(refresh.operation.snapshot.status,'saved');
});
test('actual pending submit duplicates and late account/unmount continuations do not notify, repaint or issue new requests',async()=>{
 for(const action of ['replace','unmount']){
  const wait=deferred(),f=fixture((_url,options)=>options.method==='GET'?Promise.resolve(context()):wait.promise);await f.operation.load();const pending=f.submit();await f.submit();assert.equal(f.calls.length,2);f[action]();const count=f.effects.length;wait.resolve(ack());await pending;assert.equal(f.effects.length,count);await f.submit();assert.equal(f.calls.length,2);
 }
});
test('actual local recovery is two-step, close remains blocked during POST, and closing uncertain attempt only asks parent to refresh (no POST)',async()=>{
 const f=fixture(async(_url,options)=>{if(options.method==='GET')return context();throw Error('lost response');});await f.operation.load();await f.submit();
 const effects=[];Object.assign(f.deps,{dirty:true,confirmClose:false,setConfirmClose:value=>effects.push(['confirm',value]),onClose:async(guard,options)=>{guard.assertCurrent();effects.push(['close',options]);}});f.deps.closeNow=callback('closeNow',f.deps);callback('closeSafely',f.deps)();assert.deepEqual(effects,[['confirm',true]]);assert.equal(f.calls.length,2);
 f.deps.setConfirmClose(false);assert.equal(effects.filter(([key])=>key==='close').length,0);await f.deps.closeNow();assert.deepEqual(effects.at(-1),['close',{refresh:true}]);assert.equal(f.calls.length,2);
 const wait=deferred(),pending=fixture((_url,options)=>options.method==='GET'?Promise.resolve(context()):wait.promise);await pending.operation.load();const task=pending.submit();const deps={...pending.deps,dirty:true,closeNow:()=>assert.fail('pending cannot close'),setConfirmClose:()=>assert.fail('pending cannot ask to close')};callback('closeSafely',deps)();wait.resolve(ack());await task;
});
test('actual effect replay disposes first scoped controller and creates a fresh reader; stale first GET cannot publish after StrictMode-style cleanup',async()=>{
 const pending=[],f=fixture(()=>{const d=deferred();pending.push(d);return d.promise;}),effects=[];
 const effect=nodes(owner('StartMonthlyAgreementSession'),n=>ts.isCallExpression(n)&&n.expression.getText(file)==='useEffect')[0].arguments[0];const operationRef={current:null};
 const run=new Function('allowed','clientId','capture','operationRef','createMonthlyAgreementOperation','setState',`return (${effect.getText(file)});`)(true,7,f.capture,operationRef,createMonthlyAgreementOperation,s=>effects.push(s));
 const firstCleanup=run();const first=operationRef.current;firstCleanup();const secondCleanup=run();assert.notEqual(operationRef.current,first);assert.equal(f.calls[0].options.signal.aborted,true);
 pending[0].resolve(context());pending[1].resolve(context());await new Promise(resolve=>setTimeout(resolve,0));assert.equal(effects.filter(s=>s.status==='ready').length,1);secondCleanup();assert.equal(operationRef.current,null);
});
test('actual shared navigation registration protects synchronous busy/unknown draft and releases stale account or disposal',async()=>{
 class Target{listeners=new Map();addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);return!event.defaultPrevented;}}
 const win=new Target();win.location=new URL('https://render.test/clientes?gestion=1');win.navigation=new Target();win.confirm=()=>false;
 const event=type=>({type,detail:{href:'/inicio'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
 const wait=deferred(),f=fixture((_url,options)=>options.method==='GET'?Promise.resolve(context()):wait.promise);await f.operation.load();f.deps.dirty=true;
 const status=()=>callback('monthlyAgreementNavigationStatus',f.deps)();const installation=installUnsavedNavigation(win),unregister=registerNavigationGuard(win,status);
 try{const dirty=event('render:before-navigation');win.dispatchEvent(dirty);assert.equal(dirty.defaultPrevented,true);const task=f.submit();assert.equal(status().busy,true);const unload=event('beforeunload');win.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);f.replace();assert.deepEqual(status(),{dirty:false,busy:false});wait.reject(Error('late'));await task;const forced=event('render:before-navigation');win.dispatchEvent(forced);assert.equal(forced.defaultPrevented,false);}finally{unregister();installation.dispose();}
 assert.match(source,/useNavigationGuard\(monthlyAgreementNavigationStatus\)/);assert.doesNotMatch(source,/localStorage|window.confirm|fetch\(/);
});
test('actual parent button is restricted to basic and real admin view, opens independent modal by numeric client ID and refreshes/denies through current guards',()=>{
 assert.equal(parentFile.parseDiagnostics.length,0);const wrapper=owner('DetalleClienteModal',parentFile).getText(parentFile),detail=owner('DetalleClienteSession',parentFile).getText(parentFile);
 assert.match(wrapper,/canStartAgreement=\{view.binding\?\.role === 'admin'/);assert.match(wrapper,/Number.isInteger\(view.id\)/);assert.match(detail,/basicClient && canStartAgreement && cliente.fecha_inicio === null && cliente.fecha_fin === null && <button/);assert.match(detail,/Configurar acuerdo mensual/);assert.match(detail,/<StartMonthlyAgreementModal sesion=\{sesion\} clientId=\{cliente.id\}/);assert.match(detail,/onAccessDenied=\{denyDetailAccess\}/);
 const mount=nodes(owner('DetalleClienteSession',parentFile),n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(parentFile)==='StartMonthlyAgreementModal')[0];
 const get=key=>mount.attributes.properties.find(p=>p.name?.getText(parentFile)===key).initializer.expression;
 let current=true;const effects=[],guard={current:()=>current,assertCurrent(){if(!current)throw Error('stale');}};const deps={nestedEditing:{current:true},setStartingAgreement:value=>effects.push(['starting',value]),onCuotaActualizada:async()=>effects.push(['refresh']),onClose:()=>effects.push(['close']),onClienteActualizado:async row=>effects.push(['row',row.id])};
 assert.equal(mount.attributes.properties.some(p=>p.name?.getText(parentFile)==='onSaved'),false);
 const close=new Function(...Object.keys(deps),`return (${get('onClose').getText(parentFile)});`)(...Object.values(deps));
 return (async()=>{await close(guard,{refresh:true});assert.deepEqual(effects,[['refresh'],['starting',false],['close']]);current=false;const count=effects.length;await assert.rejects(close(guard,{refresh:true}));assert.equal(effects.length,count);})();
});
test('November confirmed ACK stays in agreement modal: no optimistic November fee/config projection into October parent; close explicitly reloads held October',async()=>{
 const october={periodo:'2026-10',abono_mensual:'50.00',cuota_reels:0},before=structuredClone(october),effects=[];
 const f=fixture(async(_url,options)=>options.method==='GET'?context():ack());delete f.deps.onSaved;await f.operation.load();await f.submit();assert.equal(f.operation.snapshot.status,'saved');assert.equal(f.operation.snapshot.result.configuracion_vigente_desde,'2026-11-01');assert.deepEqual(october,before);
 const mount=nodes(owner('DetalleClienteSession',parentFile),n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(parentFile)==='StartMonthlyAgreementModal')[0];
 const closeNode=mount.attributes.properties.find(p=>p.name?.getText(parentFile)==='onClose').initializer.expression;
 const deps={nestedEditing:{current:true},setStartingAgreement:value=>effects.push(['starting',value]),onCuotaActualizada:async()=>effects.push(['GET-period',october.periodo]),onClose:()=>effects.push(['close']),onClienteActualizado:()=>assert.fail('must not merge future row')};
 const close=new Function(...Object.keys(deps),`return (${closeNode.getText(parentFile)});`)(...Object.values(deps));await close(f.capture(),{refresh:true});assert.deepEqual(effects,[['GET-period','2026-10'],['starting',false],['close']]);assert.deepEqual(october,before);
});
test('actual October basic projection with a known future zero agreement has no first-agreement CTA, future fee or global no-history assertion',()=>{
 const basic={id:7,nombre:'Cliente QA',activo:true,agreement_revision:'a1:7:4:0:0',grupo_feed_id:null,cuota_reels:0,cuota_carruseles:0,rubro:null,fecha_inicio:null,fecha_fin:null,configuracion_vigente_desde:null,configuracion_completa:false,abono_mensual:null,abono_vigente_desde:null};
 const future={...basic,fecha_inicio:'2026-11-01'};assert.equal(hasNoConfiguredMonthlyAgreement(future),true);
 const compiled=ts.transpileModule(owner('DetalleClienteSession',parentFile).getText(parentFile),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
 const actualHelper=name=>{const declaration=nodes(parentFile,n=>ts.isVariableDeclaration(n)&&n.name.getText(parentFile)===name)[0];return new Function(`return (${declaration.initializer.getText(parentFile)});`)();};
 const deps={React,hasNoConfiguredMonthlyAgreement,useRef:current=>({current}),useState:initial=>[initial,()=>{}],Modal:({children,title})=>React.createElement('section',null,title,children),getEstadoLabel:()=> 'Sin clasificación',getTipoPublicacionLabel:()=> 'Pieza',monthStart:actualHelper('monthStart'),validPeriod:actualHelper('validPeriod')};
 const Detail=new Function(...Object.keys(deps),`${compiled};return DetalleClienteSession;`)(...Object.values(deps));
 const detail=(cliente,canStartAgreement=true)=>renderToStaticMarkup(React.createElement(Detail,{cliente,canStartAgreement,periodo:'2026-10',capture:()=>({current:()=>true}),historias:[],publicaciones:[],onClose(){}}));
 const html=detail(future);assert.match(html,/Sin acuerdo mensual vigente en este período/);assert.match(html,/No hay cuotas ni abono mensual vigentes para 2026-10/);assert.match(html,/Inicio del acuerdo registrado: 2026-11-01/);assert.doesNotMatch(html,/Configurar acuerdo mensual|Sin acuerdo mensual configurado|No tiene cuotas|\$|Abono mensual<|cliente-detail-metrics/);
 assert.match(detail(basic),/Configurar acuerdo mensual/);assert.doesNotMatch(detail(basic,false),/Configurar acuerdo mensual/);assert.doesNotMatch(detail({...basic,fecha_fin:undefined}),/Configurar acuerdo mensual/);assert.doesNotMatch(detail({...basic,fecha_fin:'2026-10-20'}),/Configurar acuerdo mensual/);
});
test('all actual sibling actions are disabled during either nested editor and synchronously refuse a second modal before rerender',()=>{
 const detail=owner('DetalleClienteSession',parentFile),actions=nodes(detail,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(parentFile)==='div'&&n.openingElement.attributes.properties.some(p=>p.name?.getText(parentFile)==='className'&&p.initializer?.getText(parentFile)==='"modal-actions cliente-detail-actions"'))[0];
 const buttons=nodes(actions,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(parentFile)==='button');assert.equal(buttons.length,5);
 for(const button of buttons){const disabled=button.openingElement.attributes.properties.find(p=>p.name?.getText(parentFile)==='disabled');assert.match(disabled.initializer.getText(parentFile),/editandoCuota/);assert.match(disabled.initializer.getText(parentFile),/startingAgreement/);}
 const byCode=text=>buttons.find(button=>button.getText(parentFile).includes(text));
 const handler=button=>button.openingElement.attributes.properties.find(p=>p.name?.getText(parentFile)==='onClick').initializer.expression;
 let current=true;const effects=[],deps={capture:()=>({current:()=>current}),pending:{current:false},nestedEditing:{current:false},detailAccessDenied:{current:false},setStartingAgreement:value=>effects.push(['start',value]),setEditandoCuota:value=>effects.push(['edit',value]),cliente:{id:7},periodo:'2026-10',clientOperationHref:()=>'/clientes/operacion?cliente=7&periodo=2026-10',navigateWithinApp:()=>effects.push(['navigate']),window:{history:{pushState:()=>effects.push(['push'])},dispatchEvent:()=>effects.push(['pop'])},PopStateEvent:class{}};
 const evaluate=button=>new Function(...Object.keys(deps),`return (${handler(button).getText(parentFile)});`)(...Object.values(deps));
 const start=evaluate(byCode('setStartingAgreement(true)')),edit=evaluate(byCode('setEditandoCuota(true)'));
 start();edit();start();evaluate(byCode('Ver operación del cliente'))();evaluate(byCode('Abrir moodboard'))();assert.deepEqual(effects,[['start',true]]);assert.equal(deps.nestedEditing.current,true);
 deps.nestedEditing.current=false;edit();start();assert.deepEqual(effects,[['start',true],['edit',true]]);assert.equal(deps.nestedEditing.current,true);
 deps.nestedEditing.current=false;current=false;edit();start();assert.equal(effects.length,2);
});
