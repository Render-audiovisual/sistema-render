import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureSessionBinding,sessionBindingMatches,sessionRequestOptions} from '../shared/session/session-binding.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';

const source=readFileSync(new URL('./PersonalLists.jsx',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function setup(initial){
 let live=initial;
 const mounted={current:true},binding={current:captureSessionBinding(initial)},controllers={current:new Set()},calls=[];
 const window={setTimeout:()=>1,clearTimeout:()=>{}};
 const currentCode=extract('  const currentSession =','  const updateLists =');
 const requestCode=extract('  const scopedRequest =','  useEffect(()=>{');
 const factory=new Function('useCallback','getSesion','mounted','binding','controllers','window','apiRequest','sessionBindingMatches','sessionRequestOptions',`${currentCode}\n${requestCode}\nreturn {currentSession,scopedRequest};`);
 const page=factory(fn=>fn,()=>live,mounted,binding,controllers,window,(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject})),sessionBindingMatches,sessionRequestOptions);
 return {...page,calls,mounted,controllers,setLive:value=>{live=value}};
}
function cookies(){
 const store=createBrowserSessionState();
 const accept=(id=17,context='a',csrf='b')=>{const ticket=store.beginBootstrap();store.acceptBootstrap(ticket,{usuario:{id,nombre:'Fixture',usuario:'fixture',rol:'edicion'},session_context:context.repeat(43),csrf_token:csrf.repeat(43)});return store.getSession()};
 return {store,accept};
}
test('actual page transport uses genuine cookie intent with no Authorization and preserves immutable body',async()=>{
 const cookie=cookies(),initial=cookie.accept(),h=setup(initial),body=JSON.stringify({titulo:'Exacto',expected_version:4});
 const pending=h.scopedRequest('/api/listas-personales/9',{method:'PATCH',body,headers:{'Content-Type':'application/json'}});
 const call=h.calls[0],headers=new Headers(call.options.headers);
 assert.equal(headers.has('Authorization'),false);assert.equal(headers.get('X-Render-CSRF'),'b'.repeat(43));
 assert.equal(cookie.store.isCurrent(call.options.sessionIntent),true);assert.equal(call.options.body,body);
 call.resolve({id:'9',version:5});assert.deepEqual(await pending,{id:'9',version:5});assert.equal(h.controllers.current.size,0);
});
test('actual page cookie A→B→A observation rejects old ACK and delayed dispatch',async()=>{
 const cookie=cookies(),a=cookie.accept(),h=setup(a),pending=h.scopedRequest('/api/listas-personales');
 h.setLive(cookie.accept(18,'c','d'));h.setLive(cookie.accept(17,'a','b'));
 h.calls[0].resolve([]);await assert.rejects(pending,/sesión cambió/);
 await assert.rejects(h.scopedRequest('/api/listas-personales',{method:'POST',body:'{}'}),/sesión cambió/);
 assert.equal(h.calls.length,1);assert.equal(h.currentSession(),false);
});
test('actual page bearer remains supported; changed actor and unmount cannot publish or dispatch',async()=>{
 const a={token:'fixture-a',usuario:{id:17,rol:'edicion',activo:true}},h=setup(a);
 const pending=h.scopedRequest('/api/listas-personales');assert.equal(new Headers(h.calls[0].options.headers).get('Authorization'),'Bearer fixture-a');
 h.mounted.current=false;h.calls[0].resolve([]);await assert.rejects(pending,/sesión cambió/);
 await assert.rejects(h.scopedRequest('/api/listas-personales'),/sesión cambió/);assert.equal(h.calls.length,1);
 const other=setup(a);other.setLive({...a,usuario:{...a.usuario,id:18}});assert.equal(other.currentSession(),false);
});
test('cookie clones and failed initial capture never become authority; queue receives exact original DTO',async()=>{
 const cookie=cookies(),initial=cookie.accept(),h=setup({...initial});
 h.setLive(initial);await assert.rejects(h.scopedRequest('/api/listas-personales'),/sesión cambió/);assert.equal(h.calls.length,0);
 assert.match(source,/session:captured.current,readSession:getSesion,request:scopedRequest/);
 assert.doesNotMatch(source,/captured.current.token|initial\?\.token/);
 assert.match(source,/if \(!bindingInitialized.current\)/);
});
