import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {productionLocation, initialProductionContext, productionReadUrl, assertProductionClient, productionCalendarDay, validProductionDay} from './productionRouteContext.js';
import {verifiedProductionDraftVisit} from './productionDraft.js';
import {createProductionVisitObserver,newestProductionVisit,reconcileProductionVisitList} from './productionVisitObservation.js';
const base='https://render.test/producciones',id='11111111-1111-4111-8111-111111111111';
const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function callback(name,deps){let found;function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)found=n.initializer;ts.forEachChild(n,walk);}walk(file);assert.ok(found);return Function(...Object.keys(deps),`return (${found.getText(file)});`)(...Object.values(deps));}
test('resume rejects the source visit locally while preserving valid other-visit writes',async()=>{
  const video={id:'video-source',visita_id:id,cliente_id:7};
  for(const selected of [null,{id,cliente_id:7},{id:'other',cliente_id:8},{id:'other',cliente_id:7}]){
    const writes=[],notices=[];
    const resume=callback('resume',{selected,setNotice:message=>notices.push(message),writeVisit:async(...args)=>writes.push(args)});
    await resume(video);
    const valid=selected?.id==='other'&&selected.cliente_id===7;
    assert.equal(writes.length,valid?1:0);
    if(valid)assert.deepEqual(writes[0],[selected,'/videos','POST',{video_origen_id:video.id}]);
    else assert.equal(notices.length,1);
    if(selected?.id===id)assert.match(notices[0],/ya está.*Elegí otra visita/);
  }
});
test('pending resume button disables same visit, other client, missing destination and busy state',()=>{
  let button;
  function walk(node){if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(file)==='button'&&node.children.some(child=>ts.isJsxText(child)&&child.text.trim()==='Retomar en la visita seleccionada'))button=node;ts.forEachChild(node,walk);}walk(file);assert.ok(button);
  const attr=name=>button.openingElement.attributes.properties.find(n=>n.name?.text===name)?.initializer.expression.getText(file);
  const disabled=Function('busy','selected','video',`return (${attr('disabled')});`),title=Function('selected','video',`return (${attr('title')});`);
  const video={visita_id:id,cliente_id:7};
  for(const selected of [null,{id,cliente_id:7},{id:'other',cliente_id:8}])assert.equal(disabled(false,selected,video),true);
  assert.equal(disabled(true,{id:'other',cliente_id:7},video),true);
  assert.equal(disabled(false,{id:'other',cliente_id:7},video),false);
  assert.match(title({id,cliente_id:7},video),/Elegí otra visita/);
  assert.equal(title({id:'other',cliente_id:7},video),undefined);
});
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
  for(let n=0;n<3;n++)assert.deepEqual(productionLocation(href),{clientId:'7',month:'2026-11',day:null,tab:'pending',id});
  assert.equal(productionReadUrl({month:'2026-11',clientId:'7',tab:'calendar'}),'/api/producciones?mes=2026-11&cliente_id=7');
  assert.equal(productionReadUrl({month:'2026-11',clientId:'7',tab:'pending'}),'/api/producciones/pendientes?cliente_id=7');
  assert.equal(productionReadUrl({month:'2026-11',clientId:'',tab:'calendar'}),'/api/producciones?mes=2026-11');
});
function harness(){const effects=[],deps={readEpoch:{current:0},openVersion:{current:0},refreshVersion:{current:0},clientId:'7',tab:'calendar',month:'2026-11',day:'2026-11-20',contextError:'',today:'2026-10-21',dirty:{current:new Set()},contextGate:{current:{invalidate(){}}},productionLocation,productionCalendarDay,validProductionDay,assertProductionClient,verifiedProductionDraftVisit,writeProductionLocation:v=>effects.push(['url',v]),mayLeave:action=>action()};
  Object.assign(deps,{newestProductionVisit,reconcileProductionVisitList});
  const observer=createProductionVisitObserver(()=>deps.readEpoch.current);
  deps.visitObserver={current:observer};deps.setBankObservation=()=>{};
  deps.observeProductionVisit=value=>observer.observe(value);
  deps.openVisit=(...args)=>callback('openVisit',deps)(...args);
  for(const key of ['ListAvailable','Loading','ContextError','Error','ClientId','Tab','Month','Day','DetailLoading','Selected','Creating','Reload','Notice'])deps[`set${key}`]=value=>effects.push([key,value]);
  return {effects,deps};}
test('actual filter callback denies dirty/busy cancellation without state/history mutation',()=>{
  for(const reason of ['dirty','write','batch']){const h=harness();h.deps.mayLeave=()=>false;callback('changeContext',h.deps)('', 'pending');assert.deepEqual(h.effects,[],reason);assert.equal(h.deps.readEpoch.current,0);}
  const h=harness();callback('changeContext',h.deps)('','pending');
  assert.equal(h.deps.readEpoch.current,1);assert.equal(h.deps.openVersion.current,1);
  assert.deepEqual(h.effects.at(-1),['url',{month:'2026-11',day:'2026-11-20',clientId:'',tab:'pending'}]);
  assert.ok(h.effects.some(([key,value])=>key==='Day'&&value==='2026-11-20'),'same-month filter changes preserve the selected calendar day');
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
  assert.deepEqual(h.effects.at(-1),['url',{id,month:'2026-12',day:'2026-12-20',clientId:'8',tab:'calendar'}]);
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
    Object.assign(h.deps,{AbortController,productionReadUrl,apiRequest:()=>new Promise(yes=>resolve=yes),setVisits:()=>assert.fail('stale list'),setPending:()=>assert.fail('stale pending'),setPendingPhotos:()=>assert.fail('stale photos'),setUsers:()=>assert.fail('stale users'),setClients:()=>assert.fail('stale clients')});
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
test('pending collection publishes both media kinds only after validating the client contract',async()=>{
 for(const bank of [null,{videos:[],fotos:[{id:'photo',visita_id:id,cliente_id:7}]},{videos:[]},{videos:[],fotos:'bad'},{videos:[],fotos:[{cliente_id:8}]}]){
  const h=harness();h.deps.tab='pending';let index=0;
  const results=[{visitas:[]},[],[],bank];
  Object.assign(h.deps,{AbortController,productionReadUrl,positiveId:n=>Number.isSafeInteger(n)&&n>0,apiRequest:async()=>results[index++]});
  for(const key of ['Visits','Pending','PendingPhotos','Users','Clients'])h.deps[`set${key}`]=value=>h.effects.push([key,value]);
  collectionEffect(h.deps)();await settle();
  const valid=Array.isArray(bank?.fotos)&&bank.fotos.every(p=>p.cliente_id===7);
  assert.equal(h.effects.some(([k,v])=>k==='ListAvailable'&&v===true),valid);
  assert.equal(h.effects.some(([k])=>k==='PendingPhotos'),valid);
  if(valid)assert.deepEqual(h.effects.find(([k])=>k==='PendingPhotos')[1],bank.fotos);
  else assert.ok(h.effects.some(([k])=>k==='Error'));
 }
});
test('actual create transport rejects foreign-client ACK before created callback',async()=>{
  const h=harness();Object.assign(h.deps,{writeLock:{current:false},setBusy:()=>{}});
  const guard={assertCurrent(){},current:()=>true,request:async()=>({id,revision:1,cliente_id:8,cliente_nombre:'B',fecha:'2026-12-20',titulo:'Visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]})};
  await assert.rejects(callback('createVisit',h.deps)('{"cliente_id":7}',guard),/no pertenece/);
});
test('actual URL restore applies client/month/pending without history writes or confirmation',async()=>{
  const h=harness();h.deps.window={location:{href:`${base}?cliente=8&mes=2026-12&dia=2026-12-19&tab=pending`}};
  h.deps.mayLeave=()=>assert.fail('committed restore must not prompt');h.deps.openVisit=()=>assert.fail('no visit');
  h.deps.dirty.current.add('draft');
  const restore=callback('restoreProductionLocation',h.deps);
  await restore();assert.equal(h.deps.dirty.current.size,1);
  assert.ok(h.effects.some(([key,value])=>key==='ClientId'&&value==='8'));
  assert.ok(h.effects.some(([key,value])=>key==='Month'&&value==='2026-12'));
  assert.ok(h.effects.some(([key,value])=>key==='Day'&&value==='2026-12-19'),'restore uses the explicit observed URL day');
  assert.ok(h.effects.some(([key,value])=>key==='Tab'&&value==='pending'));
  await restore({discardDrafts:true});assert.equal(h.deps.dirty.current.size,0);
  assert.ok(!h.effects.some(([key])=>key==='url'));
  h.deps.window.location.href=`${base}?cliente=8&cliente=9`;
  await restore();assert.ok(h.effects.some(([key,value])=>key==='ContextError'&&value));
});

test('explicit day reload/back stays exact; invalid or cross-month days never become a broader context',()=>{
  const href=`${base}?cliente=7&mes=2026-11&dia=2026-11-20&tab=pending&visita=${id}`;
  assert.deepEqual(productionLocation(href),{clientId:'7',month:'2026-11',day:'2026-11-20',tab:'pending',id});
  assert.equal(productionCalendarDay(productionLocation(href),'2026-10-21'),'2026-11-20');
  for(const query of ['mes=2026-11&dia=2026-12-01','dia=2026-02-30','dia=2026-11-20&dia=2026-11-21','dia[]=2026-11-20']){
    assert.throws(()=>productionLocation(`${base}?${query}`),query);
    assert.ok(initialProductionContext(`${base}?${query}`,'2026-10-21').error);
  }
});
test('actual month change writes the new first day, never an old-month selection',()=>{
  const h=harness();callback('changeContext',h.deps)('7','calendar','2026-12');
  assert.deepEqual(h.effects.at(-1),['url',{month:'2026-12',day:'2026-12-01',clientId:'7',tab:'calendar'}]);
  assert.ok(h.effects.some(([key,value])=>key==='Day'&&value==='2026-12-01'));
});
