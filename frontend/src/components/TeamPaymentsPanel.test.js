import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {blankTeamPaymentDraft,formatTeamPaymentARS,teamPaymentToday} from './teamPayments.js';
import {installUnsavedNavigation,registerNavigationGuard} from '../shared/navigation/unsaved.js';
const parse=path=>ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const panel=parse('./TeamPaymentsPanel.jsx'),page=parse('../pages/Sueldos.jsx'),contracts=parse('./FinanceContractsPanel.jsx');
const owner=(file,name)=>file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit);}visit(root);return result;}
const variable=(file,component,name)=>nodes(owner(file,component),n=>ts.isVariableDeclaration(n)&&n.name.getText(file)===name)[0].initializer;
function value(file,node,deps){const init=ts.isCallExpression(node)&&node.expression.getText(file)==='useCallback'?node.arguments[0]:node;return new Function(...Object.keys(deps),`return (${init.getText(file)});`)(...Object.values(deps));}
const row=()=>({id:7,recipient_id:11,recipient_name:'Alex <img>',recorded_by_id:3,recorded_by_name:'Owner',fecha_pago:'2026-10-20',periodo_trabajo:'2026-09',importe:'125000.50',referencia:'<script>literal',drive_url:null,provenance:'manual',status:'recorded',revision:'pay1:7:1',created_at:'2026-10-21T10:00:00.000Z',voided_at:null,voided_by_id:null,void_reason:null});
function render(extra={}){
 const state={status:'ready',list:{periodo:'2026-10',items:[row()],total_recorded_ars:'125000.50'},recipients:[{id:11,nombre:'Alex',usuario:'alex',rol:'diseno'}],result:null,error:'',busy:false,uncertain:false,locked:false,hasIntent:false,...extra};
 const values=['2026-10',state,extra.mode||null,blankTeamPaymentDraft(),'',false,false];let index=0;
 const code=ts.transpileModule([owner(panel,'PaymentReadback'),owner(panel,'PaymentsSession')].map(n=>n.getText(panel)).join('\n'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
 const deps={React,useState:()=>[values[index++],()=>{}],useRef:current=>({current}),useEffect(){},useNavigationGuard(){},blankTeamPaymentDraft,formatTeamPaymentARS,teamPaymentToday};
 const Component=new Function(...Object.keys(deps),`${code};return PaymentsSession;`)(...Object.values(deps));return renderToStaticMarkup(React.createElement(Component,{actorId:3,capture:()=>({current:()=>true}),disabled:false}));
}
test('actual panel SSR separates manual records from projections and shows cents, real/work dates and IDs with escaped literals',()=>{
 assert.equal(panel.parseDiagnostics.length,0);const html=render();assert.match(html,/Pagos registrados manualmente/);assert.match(html,/No son sueldos calculados/);assert.match(html,/no transfiere dinero/);assert.match(html,/ARS 125\.000,50/);assert.doesNotMatch(html,/125\.001/);assert.match(html,/2026-10-20/);assert.match(html,/2026-09/);assert.match(html,/#11/);assert.match(html,/Owner · #3/);assert.match(html,/Alex &lt;img&gt;/);assert.match(html,/&lt;script&gt;literal/);assert.doesNotMatch(html,/<img|<script/);
 const create=render({mode:{kind:'create'}});assert.match(create,/Elegir persona por ID/);assert.match(create,/No se toma del sueldo calculado/);assert.match(create,/value=""/);assert.doesNotMatch(create,/checked=""|min="2026-09"|value="125000/);
 const voided={...row(),status:'voided',revision:'pay1:7:2',voided_at:'2026-10-21T11:00:00.000Z',voided_by_id:4,void_reason:'Duplicado'};
 const replay=render({status:'confirmed',hasIntent:true,result:{replayed:true,payment:voided}});assert.match(replay,/Envío encontrado · versión actual/);assert.match(replay,/Registro anulado/);assert.doesNotMatch(replay,/Total manual registrado vigente/);
 const denied=render({status:'denied',list:null,recipients:[]});assert.doesNotMatch(denied,/Alex|125\.000|<input|<form/);
 const css=readFileSync(new URL('./TeamPaymentsPanel.css',import.meta.url),'utf8');assert.match(css,/min-height:44px/);assert.match(css,/focus-visible/);assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
});
test('actual confirmed-result effect focuses and scrolls once per result, respects stale session and mobile header spacing',()=>{
 const effect=nodes(owner(panel,'PaymentsSession'),node=>ts.isCallExpression(node)&&node.expression.getText(panel)==='useEffect'&&node.arguments[0].getText(panel).includes('focusedResult.current=state.result'))[0];
 const calls=[],state={status:'confirmed',result:{payment:row()}},focusedResult={current:null},confirmationRef={current:{focus:options=>calls.push(['focus',options]),scrollIntoView:options=>calls.push(['scroll',options])}};let current=true;
 const run=value(panel,effect.arguments[0],{state,focusedResult,confirmationRef,capture:()=>({current:()=>current})});run();run();assert.deepEqual(calls,[['focus',{preventScroll:true}],['scroll',{block:'start',behavior:'auto'}]]);
 state.status='ready';state.result={payment:row()};run();assert.equal(calls.length,2);state.status='confirmed';current=false;run();assert.equal(calls.length,2);current=true;run();assert.equal(calls.length,4);
 const html=render({status:'confirmed',hasIntent:true,result:{replayed:false,payment:row()}});assert.match(html,/class="tp-recovery tp-confirmation"[^>]*tabindex="-1"/);
 const css=readFileSync(new URL('./TeamPaymentsPanel.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:980px\)\{\.team-payments \.tp-confirmation\{scroll-margin-top:calc\(var\(--render-mobile-header-height,64px\) \+ 24px\)\}/);
});
function financeFixture(){
 let current=true;const effects=[],deps={captureContracts:()=>({current:()=>current}),contractActivity:{current:false},paymentActivity:{current:false},active:{current:false},pendingPeriod:{current:null},financeDeferred:{current:false},setContractActive:v=>effects.push(['active',v]),setPaymentActive:v=>effects.push(['payment',v]),setPeriod:v=>effects.push(['period',v]),setPeriodError(){},setDeferredNotice(){},setRefreshVersion(){}};
 deps.onActivityChange=value(page,variable(page,'SueldosContent','onActivityChange'),deps);deps.requestContractEdit=value(page,variable(page,'SueldosContent','requestContractEdit'),deps);deps.onPaymentActivityChange=value(page,variable(page,'SueldosContent','onPaymentActivityChange'),deps);
 return{deps,effects,stale(){current=false;}};
}
test('actual parent callbacks mutually admit one editor synchronously and old contract idle cleanup cannot clear payment activity',()=>{
 const f=financeFixture(),d=f.deps;assert.equal(d.requestContractEdit(),true);assert.equal(d.contractActivity.current,true);assert.equal(d.onPaymentActivityChange(true),false);assert.equal(d.paymentActivity.current,false);
 d.onActivityChange(false);assert.equal(d.onPaymentActivityChange(true),true);assert.equal(d.requestContractEdit(),false);assert.equal(d.active.current,true);d.onActivityChange(false);assert.equal(d.active.current,true);assert.equal(d.paymentActivity.current,true);
 d.onPaymentActivityChange(false);assert.equal(d.active.current,false);f.stale();const count=f.effects.length;assert.equal(d.requestContractEdit(),false);assert.equal(d.onPaymentActivityChange(true),false);assert.equal(f.effects.length,count);
 const text=page.text;assert.ok(text.indexOf('<TeamPaymentsPanel')>text.indexOf('role="note"'));assert.ok(text.indexOf('<TeamPaymentsPanel')<text.indexOf('{loading &&'));assert.match(text,/onBeforeEdit=\{requestContractEdit\}/);assert.match(text,/disabled=\{paymentActive\}/);assert.match(text,/disabled=\{contractActive && !paymentActive\}/);
});
test('actual contract admission blocks writes/field edits while payment editor owns the fence, and cent step is preserved',()=>{
 const f=financeFixture();f.deps.onPaymentActivityChange(true);let updated=0;
 const deps={disabled:false,capture:()=>({current:()=>true}),onBeforeEdit:f.deps.requestContractEdit};const admit=value(contracts,variable(contracts,'ContractsSession','admitEdit'),deps);assert.equal(admit(),false);
 const save=value(contracts,variable(contracts,'ContractsSession','saveContract'),{pending:{current:false},blockedRef:{current:null},admitEdit:admit,capture:()=>assert.fail('no captured write while forbidden')});save('create');
 const fields=variable(contracts,'ContractsSession','fields');const money=nodes(fields,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(contracts)==='input'&&n.attributes.properties.some(p=>p.name?.getText(contracts)==='aria-label'&&p.initializer?.text==='Monto mensual'))[0];const onChange=money.attributes.properties.find(p=>p.name?.getText(contracts)==='onChange').initializer.expression;
 const change=value(contracts,onChange,{pending:{current:false},admitEdit:admit,update:()=>updated++,value:{importe_mensual:'1.00'}});change({target:{value:'2.50'}});assert.equal(updated,0);assert.equal(money.attributes.properties.find(p=>p.name?.getText(contracts)==='step').initializer.text,'0.01');
 f.deps.onPaymentActivityChange(false);change({target:{value:'2.50'}});assert.equal(updated,1);assert.equal(f.deps.onPaymentActivityChange(true),false);
});
test('actual contract shared navigation getter blocks sidebar/unload while pending or conflicted, but stale actor releases it',()=>{
 class Target{listeners=new Map();addEventListener(t,fn){if(!this.listeners.has(t))this.listeners.set(t,new Set());this.listeners.get(t).add(fn);}removeEventListener(t,fn){this.listeners.get(t)?.delete(fn);}dispatchEvent(e){for(const fn of this.listeners.get(e.type)||[])fn(e);}}
 let current=true;const deps={capture:()=>({current:()=>current}),dirty:false,blockedRef:{current:{kind:'create'}},pending:{current:false}},get=value(contracts,variable(contracts,'ContractsSession','contractNavigationStatus'),deps);
 const win=new Target();win.location=new URL('https://render.test/sueldos');win.navigation=new Target();win.confirm=()=>false;const install=installUnsavedNavigation(win),off=registerNavigationGuard(win,get);const send=type=>{const event={type,detail:{href:'/inicio'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};win.dispatchEvent(event);return event;};
 try{assert.equal(send('render:before-navigation').defaultPrevented,true);deps.pending.current=true;assert.equal(send('beforeunload').defaultPrevented,true);assert.equal(get().busy,true);current=false;assert.deepEqual(get(),{dirty:false,busy:false});assert.equal(send('render:before-navigation').defaultPrevented,false);}finally{off();install.dispose();}
 assert.match(contracts.text,/useNavigationGuard\(contractNavigationStatus\)/);
});

test('actual payment navigation getter reaches the shared cancelable protocol for a draft, pending request and obsolete identity',()=>{
 class Target{listeners=new Map();addEventListener(t,fn){if(!this.listeners.has(t))this.listeners.set(t,new Set());this.listeners.get(t).add(fn);}removeEventListener(t,fn){this.listeners.get(t)?.delete(fn);}dispatchEvent(e){for(const fn of this.listeners.get(e.type)||[])fn(e);}}
 let current=true,status='ready',confirmations=0;
 const deps={capture:()=>({current:()=>current}),snapshot:()=>({status}),dirty:true};
 const get=value(panel,variable(panel,'PaymentsSession','paymentNavigationStatus'),deps);
 const win=new Target();win.location=new URL('https://render.test/sueldos');win.navigation=new Target();win.confirm=()=>{confirmations++;return false;};
 const install=installUnsavedNavigation(win),off=registerNavigationGuard(win,get);
 const send=type=>{const event={type,detail:{href:'/workspace/tareas'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};win.dispatchEvent(event);return event;};
 try{
  assert.equal(send('render:before-navigation').defaultPrevented,true);assert.equal(confirmations,1);
  assert.equal(send('beforeunload').defaultPrevented,true);
  status='writing';deps.dirty=false;assert.equal(send('render:before-navigation').defaultPrevented,true);assert.equal(confirmations,1);
  status='uncertain';deps.dirty=true;assert.equal(send('render:before-navigation').defaultPrevented,true);assert.equal(confirmations,2);
  current=false;assert.deepEqual(get(),{dirty:false,busy:false});assert.equal(send('render:before-navigation').defaultPrevented,false);
  current=true;status='denied';assert.deepEqual(get(),{dirty:false,busy:false});
 }finally{off();install.dispose();}
 assert.match(panel.text,/useNavigationGuard\(paymentNavigationStatus\)/);
});
