import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { calculateFixedExpenses } from '../../../backend/src/automatic-finance.js';

// Execute actual callbacks/effects with injected transport/state, not mounted UI.
const source = readFileSync(new URL('./Sueldos.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Sueldos.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const text = n => n.getText(file);
function nodes(root,predicate) { const result=[]; function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit);}visit(root);return result; }
const owner=name=>file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${text(node)});`)(...Object.values(deps));
const callback=(name,deps)=>{const init=nodes(owner('SueldosContent'),n=>ts.isVariableDeclaration(n)&&text(n.name)===name)[0].initializer;return evaluate(ts.isCallExpression(init)&&text(init.expression)==='useCallback'?init.arguments[0]:init,deps);};
const effectNode=nodes(owner('SueldosContent'),n=>ts.isCallExpression(n)&&text(n.expression)==='useEffect'&&text(n.arguments[0]).includes('guard.request(`/api/sueldos'))[0].arguments[0];
const financeNumber=value=>typeof value==='number'&&Number.isFinite(value);
const financeDto=evaluate(owner('financeDto'),{financeNumber});
const contractRow=evaluate(owner('contractRow'),{});
const contractRows=evaluate(owner('contractRows'),{contractRow});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const row=(id=9,version=1)=>({id,nombre:'Contrato QA',importe_mensual:'100.50',inicia_el:'2026-09-01',finaliza_el:null,activo:true,contract_revision:`fc1:${id}:${version}`});
function dto(period='2026-10') {
  const summary={period,workPeriod:'2026-09',facturacion:100,sueldos:20,gastosFijosARS:10,resultadoARS:70,ingresos:[{nombre:'Contrato QA',importe:100,prorrateado:false,diasActivos:30,diasDelMes:30}],gastos:[{nombre:'Herramienta',categoria:'herramientas',moneda:'USD',importe:1,diaPago:10}]};
  return {finance:summary,previousFinance:{...summary,period:'2026-09',workPeriod:'2026-08'},exchangeRate:{original:2000,rounded:2000,source:'Cotización de respaldo',fallback:true},payroll:[{name:'QA',total:20}],payrollPending:[],billingHistory:[{period,total:100}]};
}
function fixture(request=async()=>({})) {
  const store=createBrowserSessionState();
  const accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,rol:'admin',nombre:'QA',usuario:'qa'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
  accept(7);const original=store.getSession();let mounted=true,context=0;
  const calls=[],effects=[];
  const make=contextual=>{const observed=context;return createCapturedRequest({session:original,readSession:()=>store.getSession(),isActive:()=>mounted&&(!contextual||observed===context),request:(url,options)=>{calls.push({url,options});return request(url,options);}});};
  let contracts=[],version=0;
  const deps={capture:()=>make(true),captureContracts:()=>make(false),contractRow,contractRows,financeDto,isSessionFailure,
    period:'2026-10',periodError:'',active:{current:false},contractActivity:{current:false},paymentActivity:{current:false},pendingPeriod:{current:null},financeGeneration:{current:0},contractsGeneration:{current:0},financeDeferred:{current:false},
    AbortController,URL,window:{location:{href:'http://localhost/sueldos?periodo=2026-10&keep=yes#summary'},history:{state:{qa:true},replaceState:(...args)=>effects.push(['url',...args])}},
    ...Object.fromEntries(['Loading','Error','Data','ContractsError','ContractsReady','ContractActive','Period','PeriodError','DeferredNotice'].map(name=>[`set${name}`,value=>effects.push([name,value])])),
    setContracts:value=>{contracts=typeof value==='function'?value(contracts):value;effects.push(['Contracts',contracts]);},
    setRefreshVersion:value=>{version=typeof value==='function'?value(version):value;effects.push(['refresh',version]);}};
  return{deps,calls,effects,get contracts(){return contracts;},switch:()=>accept(8),changeContext:()=>{context++;},unmount:()=>{mounted=false;},runFinance:()=>evaluate(effectNode,deps)()};
}

test('source parses with no raw fetch/JSON or embedded writer; genuine session and stable panel callbacks wired',()=>{
  assert.equal(file.parseDiagnostics.length,0);
  assert.equal(nodes(file,n=>ts.isCallExpression(n)&&(text(n.expression)==='fetch'||text(n.expression).endsWith('.json'))).length,0);
  assert.equal(owner('ClientsPanel'),undefined);assert.match(source,/import \{ FinanceContractsPanel \}/);
  assert.match(text(owner('SueldosPage')),/key=\{identity.current.epoch\} sesion=\{view.session\}/);
  assert.match(text(owner('SueldosPage')),/view.role !== 'admin'/);
  const panel=nodes(file,n=>ts.isJsxSelfClosingElement(n)&&text(n.tagName)==='FinanceContractsPanel')[0];
  for(const prop of ['sesion={view.session}','onSaved={onSaved}','onActivityChange={onActivityChange}'])assert.ok(text(panel).includes(prop));
  assert.doesNotMatch(text(panel),/key=/);
  assert.match(source,/\{finance && <>/);assert.doesNotMatch(source,/!loading && !error && finance/);
});

test('administration is outside every finance/loading/error gate, so summary failures cannot unmount its draft or confirmed ACK',()=>{
  const panel=nodes(file,n=>ts.isJsxSelfClosingElement(n)&&text(n.tagName)==='FinanceContractsPanel')[0];
  const conditions=[];
  for(let parent=panel.parent;parent;parent=parent.parent){
    if(ts.isConditionalExpression(parent))conditions.push(text(parent.condition));
    if(ts.isBinaryExpression(parent)&&parent.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)conditions.push(text(parent.left));
  }
  assert.deepEqual(conditions,['contractsReady']);
  const saved=nodes(owner('SueldosContent'),n=>ts.isVariableDeclaration(n)&&text(n.name)==='onSaved')[0];
  assert.doesNotMatch(text(saved),/setContractsReady|loadContracts|setLoading/);
  const administration=source.indexOf('<summary>Administrar contratos</summary>');
  assert.ok(administration>source.indexOf('<h2>Ingresos por contrato</h2>'));
  assert.ok(administration<source.indexOf('<summary>Detalle de sueldos y gastos</summary>'));
});

test('strict contract projection binds revision to positive PG ID and drops unknown bags',()=>{
  const input={...row(),metadata:{secret:'no'},cliente_id:42};assert.deepEqual(contractRow(input),row());
  for(const bad of [{...row(),contract_revision:'fc1:8:1'},{...row(),contract_revision:'fc1:9:0'},{...row(),contract_revision:'fc1:9:2147483648'},
    {...row(),id:'9'},{...row(),inicia_el:'2026-02-30'},{...row(),importe_mensual:''},{...row(),activo:'true'}])assert.throws(()=>contractRow(bad));
  assert.throws(()=>contractRows({}));assert.throws(()=>contractRows([row(),row()]));
  assert.throws(()=>contractRow({...row(),contract_revision:'fc1:9:1\n'}));
  for(const amount of ['0x10','1e2','1.001','01','00.50','1.',' 1','1 ','1\n','1000000000000','NaN','Infinity'])assert.throws(()=>contractRow({...row(),importe_mensual:amount}),amount);
  for(const amount of ['0','0.00','10','10.5','999999999999.99',0,100.25])assert.equal(contractRow({...row(),importe_mensual:amount}).importe_mensual,amount);
});

test('finance parser keeps actual fallback evidence and rejects malformed/wrong period DTO without fabricated numbers',()=>{
  const input=dto(),before=structuredClone(input);assert.equal(financeDto(input,'2026-10'),input);assert.deepEqual(input,before);assert.equal(input.exchangeRate.fallback,true);
  for(const bad of [{},{...input,finance:{...input.finance,period:'2026-11'}},{...input,finance:{...input.finance,facturacion:'100'}},
    {...input,exchangeRate:{...input.exchangeRate,fallback:undefined}},{...input,payroll:null},{...input,billingHistory:[{period:'bad',total:0}]}])assert.throws(()=>financeDto(bad,'2026-10'));
  assert.match(source,/exchangeRate\?\.fallback \? " is-fallback"/);assert.match(source,/exchangeRate\?\.source/);
});

test('actual finance effect captures cookie intent and suppresses success/errors after A→B, ABA, abort or unmount',async()=>{
  for(const action of ['switch','changeContext','unmount','abort'])for(const failure of [false,true]){
    const wait=deferred(),f=fixture(()=>wait.promise),cleanup=f.runFinance();assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].url,'/api/sueldos?periodo=2026-10');assert.ok(f.calls[0].options.sessionIntent);assert.equal(f.calls[0].options.headers.Authorization,undefined);
    if(action==='abort')cleanup();else f[action]();const count=f.effects.length;
    if(failure)wait.reject(new Error('private A'));else wait.resolve(dto());await settle();assert.equal(f.effects.length,count);
  }
});

test('current finance response paints verified DTO, preserves URL context, and failure never invents a fallback',async()=>{
  const f=fixture(async()=>dto());const cleanup=f.runFinance();await settle();assert.ok(f.effects.some(([name])=>name==='Data'));assert.ok(f.effects.some(([name,value])=>name==='Loading'&&value===false));
  const url=f.effects.find(([name])=>name==='url').at(-1);assert.equal(url.searchParams.get('keep'),'yes');assert.equal(url.hash,'#summary');cleanup();
  const g=fixture(async()=>({}));g.runFinance();await settle();assert.equal(g.effects.some(([name])=>name==='Data'),false);assert.ok(g.effects.some(([name])=>name==='Error'));
});

test('contract GET is session-scoped and independent of period; late account responses cannot replace contracts',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise),load=callback('loadContracts',f.deps),promise=load();f.changeContext();wait.resolve([row()]);await promise;
  assert.deepEqual(f.contracts,[row()]);assert.equal(f.calls[0].url,'/api/contratos');
  const late=deferred(),g=fixture(()=>late.promise),pending=callback('loadContracts',g.deps)();g.switch();late.resolve([row()]);await pending;assert.deepEqual(g.contracts,[]);
  const h=fixture(async()=>[row()]);h.deps.active.current=true;await callback('loadContracts',h.deps)();assert.equal(h.calls.length,0);
});

test('actual onSaved merges confirmed ACK without GET, invalidates pending reload and refreshes finance only',()=>{
  const f=fixture(),saved=callback('onSaved',f.deps),guard=f.deps.captureContracts();
  saved(row(),guard);saved(row(9,2),guard);saved(row(10),guard);
  assert.equal(f.calls.length,0);assert.equal(f.contracts.length,2);assert.equal(f.contracts[0].contract_revision,'fc1:9:2');assert.equal(f.deps.contractsGeneration.current,3);
  assert.equal(f.effects.filter(([name])=>name==='refresh').length,3);
  assert.throws(()=>saved({...row(),contract_revision:'bad'},guard));const before=f.effects.length;f.switch();assert.throws(()=>saved(row(),guard));assert.equal(f.effects.length,before);
});

test('dirty/busy panel defers finance loads and navigation until activity ends; month input disabled',()=>{
  const f=fixture(),activity=callback('onActivityChange',f.deps);activity(true);f.runFinance();assert.equal(f.calls.length,0);assert.equal(f.deps.financeDeferred.current,true);
  f.deps.pendingPeriod.current={period:'2026-11',error:''};activity(false);assert.equal(f.deps.active.current,false);assert.equal(f.deps.pendingPeriod.current,null);
  assert.ok(f.effects.some(([name,value])=>name==='Period'&&value==='2026-11'));assert.equal(f.effects.filter(([name])=>name==='refresh').length,1);
  assert.match(source,/disabled=\{contractActive\}/);assert.match(source,/if \(active.current\) return; try/);
});

test('popstate validates exact month, defers with honest notice and restores URL without losing child draft',()=>{
  const parse=evaluate(owner('salaryPeriod'),{URLSearchParams,currentPeriod:()=> '2026-10'});
  assert.equal(parse(''),'2026-10');assert.equal(parse('?periodo=2026-09'),'2026-09');
  for(const query of ['?periodo=2026-08','?periodo=2026-13','?periodo=2026-10&periodo=2026-11','?periodo=oops','?periodo=2026-10%0A','?periodo=%202026-10','?periodo=2026-10%20','?periodo=2026-10%0D%0A'])assert.throws(()=>parse(query));
  const f=fixture(),popNode=nodes(owner('SueldosContent'),n=>ts.isVariableDeclaration(n)&&text(n.name)==='pop')[0].initializer;
  f.deps.salaryPeriod=parse;f.deps.active.current=true;f.deps.window.location={href:'http://localhost/sueldos?periodo=2026-11&x=1#details',search:'?periodo=2026-11&x=1'};
  evaluate(popNode,f.deps)();assert.deepEqual(f.deps.pendingPeriod.current,{period:'2026-11',error:''});
  assert.equal(f.effects.some(([name])=>name==='Period'),false);assert.ok(f.effects.some(([name])=>name==='DeferredNotice'));
  const url=f.effects.find(([name])=>name==='url').at(-1);assert.equal(url.searchParams.get('periodo'),'2026-10');assert.equal(url.searchParams.get('x'),'1');assert.equal(url.hash,'#details');
});

test('nullable SQL payment day follows actual finance projection, without a frontend fallback',()=>{
  const expenses=calculateFixedExpenses([{nombre:'Nullable payment day',categoria:'herramientas',moneda:'ARS',importe:'10.00',dia_pago:null,inicia_el:'2026-01-01',finaliza_el:null}],'2026-10');
  assert.equal(expenses.items[0].diaPago,1); // Existing server model projects Number(dia_pago || 1).
  const value=dto();value.finance.gastos=expenses.items;assert.equal(financeDto(value,'2026-10'),value);
  const malformed=structuredClone(value);malformed.finance.gastos[0].diaPago=null;
  assert.throws(()=>financeDto(malformed,'2026-10'));assert.equal(malformed.finance.gastos[0].diaPago,null);
});
