import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { getResumenClientes } from '../clientesStats.js';
import { createClientCreation } from './clientCreate.js';

// Actual callbacks with injected effects and transport; not mounted React/browser.
const source = readFileSync(new URL('./Clientes.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Clientes.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = n => n.getText(file);
function nodes(root, predicate) { const result = []; function visit(n) { if (predicate(n)) result.push(n); ts.forEachChild(n,visit); } visit(root); return result; }
const owner = name => file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const evaluate = (node,deps) => new Function(...Object.keys(deps), `return (${text(node)});`)(...Object.values(deps));
function callback(name,deps) { const init = nodes(owner('ClientesAdminContent'),n => ts.isVariableDeclaration(n) && text(n.name) === name)[0].initializer; return evaluate(ts.isCallExpression(init) && text(init.expression) === 'useCallback' ? init.arguments[0] : init,deps); }
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const createdAck = {id:9,nombre:'QA Cliente',activo:true,agreement_revision:'a1:9:1:0:0',grupo_feed_id:null,
  rubro:'Servicios',cuota_reels:2,cuota_carruseles:0,dias_historias:[1],dias_reels:[],dias_carruseles:[],
  disenador_responsable:'QA',abono_mensual:100,fecha_inicio:'2026-10-01',configuracion_vigente_desde:'2026-10-01',configuracion_completa:true};
function fixture(request = async () => ({})) {
  const store = createBrowserSessionState();
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), {usuario:{id,rol:'admin',usuario:'qa',nombre:'QA'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
  accept(7); const original = store.getSession(); let active = true;
  const effects = [], calls = [], scope = createCapturedRequest({ session:original,readSession:()=>store.getSession(),isActive:()=>active,
    request:(url,options)=>{calls.push({url,options});return request(url,options);} });
  const deps = { capture:()=>scope,captureLifetime:()=>scope,view:{role:'admin'},createClientCreation,isSessionFailure,basicCreation:false,
    createRecovery:{current:null},setCreateStatus:value=>effects.push(['CreateStatus',value]),
    modalOpen:{current:false},deferredLoad:{current:false},pendingPeriod:{current:null},loadGeneration:{current:0},loaded:{current:false},denied:{current:false},creating:{current:false},createBaseline:{current:'{}'},
    periodError:null,mesSeleccionado:'2026-10',nuevoCliente:{nombre:'  QA Cliente  ',rubro:'Servicios',cuota_reels:'2',cuota_carruseles:'0',dias_historias:[1],dias_reels:[],dias_carruseles:[],disenador_responsable:'QA',abono_mensual:'100',vigente_desde:'2026-10'},
    validarCuota:value=>Number.isInteger(Number(value))&&Number(value)>=0,altaClienteValida:true,emptyClientForm:()=>({}),closeModal:()=>effects.push(['close']),
    ...Object.fromEntries(['Cargando','Error','Clientes','Historias','Publicaciones','LoadedPeriod','GuardandoCliente','ErrorAltaCliente','NuevoCliente','AltaClienteAbierta'].map(name=>[`set${name}`,value=>effects.push([name,value])])) };
  return {deps,calls,effects,switch:()=>accept(8),unmount:()=>{active=false;}};
}

test('source parses, zero raw fetch/JSON, shared hook/loader and genuine modal sessions are wired',()=>{
  assert.equal(file.parseDiagnostics.length,0);
  assert.equal(nodes(file,n=>ts.isCallExpression(n)&&(text(n.expression)==='fetch'||text(n.expression).endsWith('.json'))).length,0);
  assert.match(source,/createClientOverviewLoader\(capture\)/);
  assert.match(text(owner('ClientesAdminPage')), /key=\{identity.current.epoch\} sesion=\{view.session\}/);
  assert.match(text(owner('ClientesAdminPage')), /view.role !== 'admin'/);
  const modals=nodes(file,n=>ts.isJsxSelfClosingElement(n)&&['EditarCuotaClienteModal','DetalleClienteModal'].includes(text(n.tagName)));
  for(const modal of modals){assert.match(text(modal),/sesion=\{view.session\}/);assert.match(text(modal),/periodo=\{mesSeleccionado\}/);assert.match(text(modal),/key=\{`\$\{epoch\}:\$\{mesSeleccionado\}:\$\{cliente/);}
  assert.equal(modals.length,2);
});

test('actual creation captures original cookie, immutable body, one dispatch and verified ACK',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise),submit=callback('crearCliente',f.deps),event={preventDefault(){}};
  const pending=submit(event);await submit(event);assert.equal(f.calls.length,1);
  f.deps.nuevoCliente.nombre='Later';f.deps.nuevoCliente.dias_historias.push(2);
  const body=JSON.parse(f.calls[0].options.body);assert.equal(body.nombre,'QA Cliente');assert.deepEqual(body.dias_historias,[1]);
  assert.ok(f.calls[0].options.sessionIntent);assert.equal(f.calls[0].options.headers.Authorization,undefined);
  wait.resolve(createdAck);await pending;assert.ok(f.effects.some(([name])=>name==='close'));
});

test('late creation success/error after account change or unmount cannot paint/close/retry',async()=>{
  for(const action of ['switch','unmount'])for(const fail of [false,true]){
    const wait=deferred(),f=fixture(()=>wait.promise),promise=callback('crearCliente',f.deps)({preventDefault(){}});
    f[action]();const count=f.effects.length;
    if(fail)wait.reject(new Error('private'));else wait.resolve({id:9,nombre:'QA Cliente'});
    await promise;assert.equal(f.effects.length,count);assert.equal(f.calls.length,1);
  }
});

test('bad ACK or network failure preserves create draft and reports uncertainty, never automatic retry',async()=>{
  for(const response of [{}, {id:9,nombre:'Other'},new Error('offline')]){
    const f=fixture(async()=>{if(response instanceof Error)throw response;return response;});
    await callback('crearCliente',f.deps)({preventDefault(){}});
    assert.equal(f.calls.length,1);assert.equal(f.effects.some(([name])=>['close','NuevoCliente','AltaClienteAbierta'].includes(name)),false);
    assert.ok(f.effects.some(([name])=>name==='ErrorAltaCliente'));
  }
});

test('actual overview callback defers all requests during any modal and ignores result if modal opens mid-read',async()=>{
  const f=fixture(),wait=deferred();let calls=0;
  f.deps.overviewLoader={load:()=>{calls++;return wait.promise;}};
  const load=callback('cargarClientes',f.deps);f.deps.modalOpen.current=true;await load();assert.equal(calls,0);assert.equal(f.deps.deferredLoad.current,true);
  f.deps.modalOpen.current=false;const pending=load();f.deps.modalOpen.current=true;
  wait.resolve({clientes:[],historias:[],publicaciones:[]});await pending;
  assert.equal(f.effects.some(([name])=>['Clientes','Historias','Publicaciones'].includes(name)),false);
});

test('overview generation fences superseded reads, stale account and errors; busy cleanup remains current-only',async()=>{
  const f=fixture(),a=deferred(),b=deferred();let count=0;
  f.deps.overviewLoader={load:()=>++count===1?a.promise:b.promise};
  const load=callback('cargarClientes',f.deps),first=load(),second=load();
  b.resolve({clientes:[{id:2}],historias:[],publicaciones:[]});await second;
  const mark=f.effects.length;a.resolve({clientes:[{id:1}],historias:[],publicaciones:[]});await first;assert.equal(f.effects.length,mark);
  const c=deferred();f.deps.overviewLoader={load:()=>c.promise};const third=callback('cargarClientes',f.deps)();f.switch();const after=f.effects.length;c.reject(new Error('A'));await third;assert.equal(f.effects.length,after);
});

test('authorization failure stops background redispatch; initial visibility cannot supersede principal load',async()=>{
  const f=fixture();let calls=0;f.deps.overviewLoader={load:async()=>{calls++;throw Object.assign(new Error('revoked'),{status:401});}};
  const load=callback('cargarClientes',f.deps);await load();await load({silencioso:true});assert.equal(calls,1);
  const updateNode=nodes(owner('ClientesAdminContent'),n=>ts.isVariableDeclaration(n)&&text(n.name)==='update')[0].initializer;
  let updates=0;const loaded={current:false},update=evaluate(updateNode,{loaded,cargarClientes:()=>updates++});update();assert.equal(updates,0);loaded.current=true;update();assert.equal(updates,1);
});

test('period validation, modal period deferral and dirty create cancellation are actual callbacks',()=>{
  const parse=evaluate(owner('clientPeriod'),{URLSearchParams,getMesISO:()=> '2026-10'});
  assert.equal(parse(''),'2026-10');assert.equal(parse('?periodo=2026-02'),'2026-02');
  for(const query of ['?periodo=0000-01','?periodo=2026-13','?periodo=2026-10&periodo=2026-11'])assert.throws(()=>parse(query));
  const f=fixture();f.deps.window={confirm:()=>false};callback('cerrarAltaCliente',f.deps)();assert.equal(f.effects.length,0);
  f.deps.window.confirm=()=>true;callback('cerrarAltaCliente',f.deps)();assert.ok(f.effects.some(([name])=>name==='close'));
  assert.match(source,/pendingPeriod.current = next/);assert.match(source,/addEventListener\('popstate', pop\)/);
  assert.match(source,/loadedPeriod !== mesSeleccionado \? \[\]/);
});

test('deep URL restoration selects the same enriched monthly row as card, once only; polling never replaces held modal',()=>{
  const raw={id:1,nombre:'QA',activo:true,cuota_reels:0,cuota_carruseles:0,dias_historias:[1,4]};
  const filasTodas=getResumenClientes([raw],[],[],{mes:'2026-10',avanceDelMes:1});
  assert.equal(filasTodas[0].cuotaHistorias,9);
  assert.equal(filasTodas[0].historiasPublicadas,0);
  assert.equal(filasTodas[0].estadoGeneral.color,'rojo');
  const effect=nodes(owner('ClientesAdminContent'),n=>ts.isCallExpression(n)&&text(n.expression)==='useEffect'&&text(n.arguments[0]).includes('const requestedClient'))[0].arguments[0];
  let held=null,restored=false;
  const run=(rows,loadedPeriod='2026-10')=>evaluate(effect,{contextRestored:restored,loadedPeriod,mesSeleccionado:'2026-10',filasTodas:rows,modalOpen:{current:Boolean(held)},initialClientId:1,
    selectClient:value=>{held=value;},setContextRestored:value=>{restored=value;}})();
  run(filasTodas,'2026-09');assert.equal(held,null);
  run(filasTodas);assert.equal(held,filasTodas[0]);assert.equal(restored,true);
  const original=held;run([{...filasTodas[0],cuotaHistorias:99}]);assert.equal(held,original);assert.equal(held.cuotaHistorias,9);
  assert.match(text(effect),/filasTodas.find/);assert.doesNotMatch(text(effect),/clientes.find/);
});
