import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {productionLocation, initialProductionContext, productionReadUrl, assertProductionClient} from './productionRouteContext.js';
import {verifiedProductionDraftVisit} from './productionDraft.js';
const base='https://render.test/producciones',id='11111111-1111-4111-8111-111111111111';
const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function callback(name,deps){let found;function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)found=n.initializer;ts.forEachChild(n,walk);}walk(file);assert.ok(found);return Function(...Object.keys(deps),`return (${found.getText(file)});`)(...Object.values(deps));}
test('strict scalar client and month reject malformed context before reads',()=>{
  for(const query of ['cliente=0','cliente=-1','cliente=01','cliente=1.0','cliente=1e2','cliente=2147483648','cliente=','cliente=%201','cliente=1%0A','cliente=1&cliente=2','cliente[]=1','cliente[x]=1','mes=0000-01','mes=2026-13','mes=2026-01%0A','mes=2026-01&mes=2026-02','tab=no','visita=no']){
    assert.throws(()=>productionLocation(`${base}?${query}`),query);
    assert.ok(initialProductionContext(`${base}?${query}`,'2026-10-21').error);
  }
  assert.equal(productionLocation(`${base}?cliente=2147483647`).clientId,'2147483647');
  assert.ok(source.indexOf('initialProductionContext(window.location.href')<source.indexOf('Promise.all([apiRequest(productionReadUrl'));
  assert.match(source,/if\(contextError\)\{setLoading\(false\);return;\}/);
});
test('reload/back preserves month, pending and visit; clearing client is explicit',()=>{
  const href=`${base}?cliente=7&mes=2026-11&tab=pending&visita=${id}`;
  for(let n=0;n<3;n++)assert.deepEqual(productionLocation(href),{clientId:'7',month:'2026-11',tab:'pending',id});
  assert.equal(productionReadUrl({month:'2026-11',clientId:'7',tab:'calendar'}),'/api/producciones?mes=2026-11&cliente_id=7');
  assert.equal(productionReadUrl({month:'2026-11',clientId:'7',tab:'pending'}),'/api/producciones/pendientes?cliente_id=7');
  assert.equal(productionReadUrl({month:'2026-11',clientId:'',tab:'calendar'}),'/api/producciones?mes=2026-11');
});
function harness(){const effects=[],deps={readEpoch:{current:0},openVersion:{current:0},clientId:'7',tab:'calendar',month:'2026-11',contextError:'',today:'2026-10-21',dirty:{current:new Set()},productionLocation,assertProductionClient,verifiedProductionDraftVisit,writeProductionLocation:v=>effects.push(['url',v]),mayLeave:()=>true};
  for(const key of ['ListAvailable','Loading','ContextError','Error','ClientId','Tab','Month','Day','DetailLoading','Selected','Creating','Reload','Notice'])deps[`set${key}`]=value=>effects.push([key,value]);
  return {effects,deps};}
test('actual filter callback denies dirty/busy cancellation without state/history mutation',()=>{
  for(const reason of ['dirty','write','batch']){const h=harness();h.deps.mayLeave=()=>false;callback('changeContext',h.deps)('', 'pending');assert.deepEqual(h.effects,[],reason);assert.equal(h.deps.readEpoch.current,0);}
  const h=harness();callback('changeContext',h.deps)('','pending');
  assert.equal(h.deps.readEpoch.current,1);assert.equal(h.deps.openVersion.current,1);
  assert.deepEqual(h.effects.at(-1),['url',{month:'2026-11',clientId:'',tab:'pending'}]);
});
test('actual detail callback rejects mismatched client without retargeting URL/month',async()=>{
  const h=harness();h.deps.apiRequest=async()=>({id,revision:1,cliente_id:8,cliente_nombre:'B',fecha:'2026-11-20',titulo:'Visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]});
  await callback('openVisit',h.deps)(id);
  assert.ok(h.effects.some(([key,value])=>key==='Error'&&value.includes('no pertenece')));
  assert.ok(!h.effects.some(([key,value])=>key==='url'||key==='Month'||key==='Selected'&&value));
});
test('actual detail and refresh callbacks fence deferred reads after context change',async()=>{
  for(const name of ['openVisit','refreshVisit']){const h=harness();let resolve;h.deps.apiRequest=()=>new Promise(yes=>resolve=yes);h.deps.setVisits=()=>assert.fail('obsolete list update');
    const pending=callback(name,h.deps)(id);++h.deps.readEpoch.current;++h.deps.openVersion.current;
    const before=h.effects.length;
    resolve({id,revision:1,cliente_id:7,cliente_nombre:'A',fecha:'2026-11-20',titulo:'Visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]});
    if(name==='refreshVisit')await assert.rejects(pending,/contexto/);else await pending;
    assert.equal(h.effects.length,before);
  }
});
test('actual created callback switches client explicitly only after verified aggregate',()=>{
  const h=harness(),saved=callback('createdVisit',h.deps),guard={assertCurrent(){}};
  assert.throws(()=>saved({id},guard));assert.deepEqual(h.effects,[]);
  saved({id,revision:1,cliente_id:8,cliente_nombre:'B',fecha:'2026-12-20',titulo:'Visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]},guard);
  assert.ok(h.effects.some(([key,value])=>key==='ClientId'&&value==='8'));
  assert.deepEqual(h.effects.at(-1),['url',{id,month:'2026-12',clientId:'8',tab:'calendar'}]);
});
test('failed collection read remains unavailable; inactive history does not enter creation selector',()=>{
  assert.match(source,/!listAvailable \|\| contextError/);assert.match(source,/Lista no disponible/);
  assert.match(source,/setClients\(brands\)/);assert.match(source,/clients=clients.filter\(client=>client.activo === true\)/);
  assert.match(source,/client.activo === false \? ' \(inactivo\)'/);
  assert.equal(file.parseDiagnostics.length,0);
});
function collectionEffect(deps){let found;function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(file)==='useEffect'&&n.arguments[0]?.getText(file).includes('Promise.all([apiRequest(productionReadUrl'))found=n.arguments[0];ts.forEachChild(n,walk);}walk(file);assert.ok(found);return Function(...Object.keys(deps),`return (${found.getText(file)});`)(...Object.values(deps));}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('actual collection effect: invalid initial context dispatches nothing',()=>{
  const h=harness();h.deps.contextError='invalid';h.deps.AbortController=AbortController;h.deps.apiRequest=()=>assert.fail('must not fetch');h.deps.productionReadUrl=productionReadUrl;
  collectionEffect(h.deps)();assert.deepEqual(h.effects,[['Loading',true],['ListAvailable',false],['Error',''],['Loading',false]]);
});
test('actual collection effect fences obsolete GET even if transport ignores AbortSignal',async()=>{
  for(const abort of [false,true]){const h=harness();let resolve;
    Object.assign(h.deps,{AbortController,productionReadUrl,apiRequest:()=>new Promise(yes=>resolve=yes),setVisits:()=>assert.fail('stale list'),setPending:()=>assert.fail('stale pending'),setUsers:()=>assert.fail('stale users'),setClients:()=>assert.fail('stale clients')});
    // Three GETs; resolving all through the same external array simulates an uncooperative transport.
    const resolvers=[];h.deps.apiRequest=()=>new Promise(yes=>resolvers.push(yes));
    const cleanup=collectionEffect(h.deps)();const before=h.effects.length;
    if(abort)cleanup();else ++h.deps.readEpoch.current;
    resolvers[0]({visitas:[]});resolvers[1]([]);resolvers[2]([]);await settle();
    assert.equal(h.effects.length,before);
  }
});
test('actual collection effect failed read never claims zero rows or availability',async()=>{
  const h=harness();Object.assign(h.deps,{AbortController,productionReadUrl,apiRequest:async()=>{throw Error('offline')}});
  collectionEffect(h.deps)();await settle();
  assert.ok(h.effects.some(([key,value])=>key==='Error'&&value==='offline'));
  assert.ok(!h.effects.some(([key,value])=>key==='ListAvailable'&&value===true));
});
test('actual create transport rejects foreign-client ACK before created callback',async()=>{
  const h=harness();Object.assign(h.deps,{writeLock:{current:false},setBusy:()=>{}});
  const guard={assertCurrent(){},current:()=>true,request:async()=>({id,revision:1,cliente_id:8,cliente_nombre:'B',fecha:'2026-12-20',titulo:'Visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]})};
  await assert.rejects(callback('createVisit',h.deps)('{"cliente_id":7}',guard),/no pertenece/);
});
test('actual URL restore applies client/month/pending without history writes or confirmation',async()=>{
  const h=harness();h.deps.window={location:{href:`${base}?cliente=8&mes=2026-12&tab=pending`}};
  h.deps.mayLeave=()=>assert.fail('committed restore must not prompt');h.deps.openVisit=()=>assert.fail('no visit');
  h.deps.dirty.current.add('draft');
  const restore=callback('restoreProductionLocation',h.deps);
  await restore();assert.equal(h.deps.dirty.current.size,1);
  assert.ok(h.effects.some(([key,value])=>key==='ClientId'&&value==='8'));
  assert.ok(h.effects.some(([key,value])=>key==='Month'&&value==='2026-12'));
  assert.ok(h.effects.some(([key,value])=>key==='Tab'&&value==='pending'));
  await restore({discardDrafts:true});assert.equal(h.deps.dirty.current.size,0);
  assert.ok(!h.effects.some(([key])=>key==='url'));
  h.deps.window.location.href=`${base}?cliente=8&cliente=9`;
  await restore();assert.ok(h.effects.some(([key,value])=>key==='ContextError'&&value));
});
