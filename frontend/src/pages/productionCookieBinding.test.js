import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
import {verifiedProductionDraftVisit} from './productionDraft.js';
import {assertProductionClient} from './productionRouteContext.js';
import {createProductionVisitObserver,newestProductionVisit,reconcileProductionVisitList} from './productionVisitObservation.js';

const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function find(predicate){let found;function walk(n){if(predicate(n))found=n;ts.forEachChild(n,walk);}walk(tree);assert.ok(found);return found;}
const callback=name=>find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)===name).initializer;
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
const productionWrite=evaluate(find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='productionWrite'),{positiveId:value=>Number.isSafeInteger(value)&&value>0});
const visit=(revision=1)=>({id:'11111111-1111-4111-8111-111111111111',revision,cliente_id:7,cliente_nombre:'QA',fecha:'2026-10-20',titulo:'Visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(cookie=true){
  const store=createBrowserSessionState();
  const accept=(id=7)=>{store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,rol:'admin',nombre:'QA',usuario:'qa'},session_context:(id===7?'a':'c').repeat(43),csrf_token:(id===7?'b':'d').repeat(43)});return store.getSession();};
  let live=cookie?accept():{token:'qa-original',usuario:{id:7,rol:'admin',activo:true}};
  const rendered=live,calls=[],effects=[],captures=[];
  let transport=async(url,options)=>options?.method?{visita:visit(2)}:visit(2);
  const deps={sesion:rendered,getSesion:()=>live,readEpoch:{current:0},openVersion:{current:0},refreshVersion:{current:0},writeLock:{current:false},batchDraft:{current:{busy:false}},resultDraft:{current:{busy:false,locked:false}},
    apiRequest:async(url,options)=>{calls.push({url,options});return transport(url,options);},
    createCapturedRequest:options=>{captures.push(options);return createCapturedRequest(options);},
    productionWrite,verifiedProductionDraftVisit,assertProductionClient,newestProductionVisit,reconcileProductionVisitList,month:'2026-10',clientId:'7',positiveId:value=>Number.isSafeInteger(value)&&value>0,visitDTO:value=>value?.visita||value};
  for(const name of ['Busy','Notice','Reload','Selected','Visits'])deps[`set${name}`]=value=>effects.push([name,value]);
  const observer=createProductionVisitObserver(()=>deps.readEpoch.current);
  deps.observeProductionVisit=value=>observer.observe(value);
  deps.refreshVisit=evaluate(callback('refreshVisit'),deps);
  const write=evaluate(callback('writeVisit'),deps);
  return{write,deps,calls,effects,captures,rendered,setTransport:value=>{transport=value;},switch(){live=cookie?accept(8):{token:'qa-replacement',usuario:{id:8,rol:'admin',activo:true}};},aba(){live=accept(8);live=accept(7);}};
}

for(const [path,method] of [['','PATCH'],['/videos','POST'],['/videos/video-a','PATCH'],['/fotos','POST'],['/fotos/photo-a','PATCH'],['/videos/video-a/enviar-edicion','POST'],['/videos/video-a/vincular-pieza','POST']])
  test(`cookie actual writeVisit ${method} ${path||'visit'} binds write and full readback to one original intent`,async()=>{
    const f=fixture(),input={titulo:'Held input',expected_revision:999};
    const result=await f.write(visit(),path,method,input);
    assert.equal(result.revision,2);assert.equal(f.captures.length,1);assert.equal(f.captures[0].session,f.rendered);
    assert.equal(f.calls.length,2);const [write,read]=f.calls;
    assert.equal(write.options.method,method);assert.equal(write.url,`/api/producciones/${visit().id}${path}`);
    assert.equal(JSON.parse(write.options.body).expected_revision,1,'CAS remains the revision supplied by the visible form');
    for(const call of f.calls){assert.equal(call.options.sessionIntent.session,f.rendered);assert.equal(new Headers(call.options.headers).has('Authorization'),false);assert.equal(new Headers(call.options.headers).get('X-Render-Session-Context'),f.rendered.session_context);}
    assert.equal(write.options.sessionIntent,read.options.sessionIntent);assert.equal(read.url,`/api/producciones/${visit().id}`);
    assert.equal(input.expected_revision,999);assert.deepEqual(f.effects.filter(([name])=>name==='Busy').map(([,value])=>value),[true,false]);
  });

test('legacy bearer still pins exact credential without cookie intent',async()=>{
  const f=fixture(false);await f.write(visit(),'','PATCH',{});
  for(const call of f.calls){assert.equal(new Headers(call.options.headers).get('Authorization'),'Bearer qa-original');assert.equal(call.options.sessionIntent,undefined);}
});
test('rendered A callback cannot dispatch when B is current before the first await',async()=>{
  const f=fixture();f.switch();await assert.rejects(f.write(visit(),'','PATCH',{}),{code:'session_binding_obsolete'});
  assert.equal(f.calls.length,0);assert.equal(f.effects.length,0);assert.equal(f.deps.writeLock.current,false);
});
for(const boundary of ['session','aba','filter','selection'])test(`late mutation ACK after ${boundary} cannot refresh, paint or acknowledge under a new observation`,async()=>{
  const f=fixture(),held=deferred();f.setTransport(()=>held.promise);
  const pending=f.write(visit(),'/videos','POST',{titulo:'Do not repeat'});assert.equal(f.calls.length,1);assert.equal(f.deps.writeLock.current,true);
  if(boundary==='session')f.switch();if(boundary==='aba')f.aba();if(boundary==='filter')f.deps.readEpoch.current++;if(boundary==='selection')f.deps.openVersion.current++;
  const before=f.effects.length;held.resolve({visita:visit(2)});
  await assert.rejects(pending,{code:'session_binding_obsolete'});assert.equal(f.calls.length,1);assert.equal(f.effects.length,before);assert.equal(f.deps.writeLock.current,false);
});
test('late full readback after cookie replacement cannot publish selected/list/reload or false saved notice',async()=>{
  const f=fixture(),held=deferred();f.setTransport(async(url,options)=>options?.method?{visita:visit(2)}:held.promise);
  const pending=f.write(visit(),'','PATCH',{});await settle();assert.equal(f.calls.length,2);
  f.switch();const before=f.effects.length;held.resolve(visit(2));await assert.rejects(pending,{code:'session_binding_obsolete'});
  assert.equal(f.effects.length,before);assert.equal(f.calls.length,2);
});
test('actual page cleanup invalidates an in-flight write before late completion',async()=>{
  const f=fixture(),held=deferred();f.setTransport(()=>held.promise);
  const effect=find(n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.arguments[0]?.getText(tree).includes("window.addEventListener('popstate',restore)"));
  const cleanup=evaluate(effect.arguments[0],{...f.deps,navigationRef:{current:()=>{}},window:{addEventListener(){},removeEventListener(){}}})();
  const pending=f.write(visit(),'','PATCH',{});cleanup();const before=f.effects.length;
  held.resolve({visita:visit(2)});await assert.rejects(pending,{code:'session_binding_obsolete'});
  assert.equal(f.calls.length,1);assert.equal(f.effects.length,before);
});
test('409 performs one same-intent GET, preserves visible CAS and never resends the write',async()=>{
  const f=fixture();f.setTransport(async(url,options)=>{if(options?.method)throw Object.assign(Error('conflict'),{status:409});return visit(3);});
  await assert.rejects(f.write(visit(),'/videos','POST',{}),error=>error.status===409&&/Conservamos|conservamos/.test(error.message));
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.sessionIntent,f.calls[1].options.sessionIntent);
  assert.equal(JSON.parse(f.calls[0].options.body).expected_revision,1);
  assert.equal(f.effects.some(([name])=>name==='Reload'),false);
});
test('confirmed ACK plus unavailable readback remains saved recovery, never a replay',async()=>{
  const f=fixture();f.setTransport(async(url,options)=>{if(options?.method)return{visita:visit(2)};throw Error('offline');});
  await assert.rejects(f.write(visit(),'/videos','POST',{}),error=>error.productionSaved===true&&/No repitas/.test(error.message));
  assert.equal(f.calls.length,2);assert.equal(f.effects.some(([name])=>name==='Reload'),false);
});
test('double click and batch busy deny before capturing or dispatching',async()=>{
  const f=fixture(),held=deferred();f.setTransport(()=>held.promise);
  const pending=f.write(visit(),'','PATCH',{});await assert.rejects(f.write(visit(),'','PATCH',{}),/otra operación/);
  assert.equal(f.captures.length,1);held.reject(Error('offline'));await assert.rejects(pending,/offline/);
  f.deps.batchDraft.current.busy=true;await assert.rejects(f.write(visit(),'','PATCH',{}),/otra operación/);assert.equal(f.captures.length,1);
});
for(const state of [{busy:true,locked:false},{busy:false,locked:true}])test(`result busy=${state.busy} locked=${state.locked} fences actual writeVisit before session capture`,async()=>{
  const f=fixture();f.deps.resultDraft.current=state;
  await assert.rejects(f.write(visit(),'/videos','POST',{}),/otra operación/);
  assert.equal(f.captures.length,0);assert.equal(f.calls.length,0);assert.deepEqual(f.effects,[]);
  assert.equal(f.deps.writeLock.current,false);assert.deepEqual(f.deps.resultDraft.current,state);
});
