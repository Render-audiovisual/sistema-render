import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readRouteKey} from './location.js';
import {createExplicitLogoutNavigation} from './explicitLogoutNavigation.js';
import {createBrowserSessionState} from '../session/browser-session-state.js';
import {loginHrefForDestination} from './login-destination.js';
const source=readFileSync(new URL('../../App.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('App.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function declaration(name){let found;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)found=node;ts.forEachChild(node,visit);}visit(tree);assert.ok(found);return found;}
function evaluate(node,deps){return Function(...Object.keys(deps),'return ('+node.getText(tree)+');')(...Object.values(deps));}
function fixture(){
  const snapshot=Object.freeze({status:'authenticated',session:Object.freeze({usuario:Object.freeze({id:7,rol:'diseno'})})});
  let current=snapshot,throws=false;const token=Object.freeze({}),calls=[],epoch={current:0},owner={current:{token}};
  const win={location:new URL('https://render.test/moodboards?board=3')};
  const deps={explicitLogout:{current:null},createExplicitLogoutNavigation,subscribeApplicationSession:()=>()=>{},rememberedViews:{current:null},getApplicationSessionSnapshot:()=>{if(throws)throw Error('private session failure');return current;},sessionSnapshot:snapshot,
    navigationEpoch:epoch,navigationOwner:owner,navigationLifetime:token,route:readRouteKey(win),path:win.location.pathname,window:win,readRouteKey,
    navigationConfirmation:{request:()=>Promise.resolve(false)},navigateWithConfirmation:(window,href,options)=>{calls.push({window,href,options});return Promise.resolve(true);}};
  const navigate=evaluate(declaration('navigateSidebar').initializer.arguments[0],deps);
  return{snapshot,token,calls,epoch,owner,win,deps,navigate,setSnapshot:value=>{current=value},fail:()=>{throws=true}};
}

test('actual Sidebar restores a remembered bare destination through the same guarded request',async()=>{
  const f=fixture(),reads=[];
  f.deps.rememberedViews.current={read:href=>{reads.push(href);return '/calendario?scope=mine&tipo=hito';}};
  assert.equal(await f.navigate('/calendario'),true);
  assert.deepEqual(reads,['/calendario']);assert.equal(f.calls.length,1);assert.equal(f.calls[0].href,'/calendario?scope=mine&tipo=hito');
  assert.equal(f.calls[0].options.isCurrent(),true);
});

test('actual logout saves current preferences before withdrawing identity but stale logout cannot touch another user',()=>{
  const f=fixture(),calls=[];f.deps.cerrarSesion=()=>calls.push('logout');f.deps.rememberedViews.current={save:()=>calls.push('preferences')};
  const logout=evaluate(declaration('logout').initializer.arguments[0],f.deps);
  logout();assert.deepEqual(calls,['preferences','logout']);
  f.setSnapshot({...f.snapshot});logout();assert.deepEqual(calls,['preferences','logout']);
});

test('actual Sidebar callback captures route/runtime identity and supplies one guarded controlled request',async()=>{
  const f=fixture();assert.equal(await f.navigate('/producciones'),true);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].href,'/producciones');assert.equal(f.calls[0].options.present,f.deps.navigationConfirmation.request);
  assert.equal(f.calls[0].options.isCurrent(),true);
  f.setSnapshot({...f.snapshot});assert.equal(f.calls[0].options.isCurrent(),false,'same account data cannot reuse another runtime observation');
  assert.equal(await f.navigate('/clientes'),false);assert.equal(f.calls.length,1);
});

test('actual Sidebar callback fails closed before dispatch on session/route/owner mismatch or reader failure',async()=>{
  for(const change of [f=>f.setSnapshot(null),f=>{f.win.location=new URL('https://render.test/clientes')},f=>{f.owner.current={token:{}}},f=>f.fail()]){
    const f=fixture();change(f);assert.equal(await f.navigate('/producciones'),false);assert.deepEqual(f.calls,[]);
  }
});

test('actual popstate observer invalidates route ABA synchronously, without rewriting history',async()=>{
  const f=fixture();await f.navigate('/producciones');const observed=f.calls[0].options.isCurrent;
  const trace=[];
  const sync=evaluate(declaration('syncPath').initializer,{navigationEpoch:f.epoch,setNavigationTick:update=>trace.push(['tick',update(0)]),setRoute:route=>trace.push(['route',route]),readRouteKey,window:f.win});
  f.win.location=new URL('https://render.test/clientes');sync();
  f.win.location=new URL('https://render.test/moodboards?board=3');sync();
  assert.equal(f.epoch.current,2);assert.equal(readRouteKey(f.win),f.deps.route);assert.equal(observed(),false);
  assert.deepEqual(trace,[['tick',1],['route','/clientes'],['tick',1],['route','/moodboards?board=3']]);
});

test('current session or presentation lifetime changes invalidate a held callback even before next render',async()=>{
  for(const change of [f=>f.setSnapshot({...f.snapshot,session:null,status:'anonymous'}),f=>{f.owner.current={token:{}}},f=>{f.epoch.current++},f=>{f.win.location=new URL('https://render.test/inicio')}]){
    const f=fixture();await f.navigate('/producciones');change(f);assert.equal(f.calls[0].options.isCurrent(),false);
  }
});

test('child-owned query/hash changes may navigate without a parent popstate, but later changes invalidate consent',async()=>{
  const f=fixture();f.win.location=new URL('https://render.test/moodboards?board=4#references');
  assert.equal(await f.navigate('/producciones'),true);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].options.isCurrent(),true);
  f.win.location=new URL('https://render.test/moodboards?board=5#references');assert.equal(f.calls[0].options.isCurrent(),false);
});

function logoutAppFixture() {
  const store=createBrowserSessionState(),replacements=[],calls=[];
  const login=(id=7)=>{store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,usuario:'qa',nombre:'QA',rol:'diseno'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});return store.getSnapshot();};
  const original=login(),location=new URL('https://render.test/workspace/tareas?responsible=id%3A7&client=9#detail');
  location.replace=href=>replacements.push(href);
  const deps={explicitLogout:{current:null},createExplicitLogoutNavigation,getApplicationSessionSnapshot:store.getSnapshot,
    subscribeApplicationSession:store.subscribe,sessionSnapshot:original,rememberedViews:{current:{save:()=>calls.push('save')}},window:{location},readRouteKey,loginHrefForDestination};
  const logout=(...args)=>evaluate(declaration('logout').initializer.arguments[0],deps)(...args);
  const gates=[];
  function visit(node){if(ts.isIfStatement(node)&&(node.expression.getText(tree)==='!sesion'||node.expression.getText(tree).includes('explicitLogout.current?.destination')))gates.push(node);ts.forEachChild(node,visit);}
  visit(tree);assert.equal(gates.length,2);
  const gate=snapshot=>Function(...Object.keys({...deps,sesion:snapshot.session,sessionSnapshot:snapshot}),gates.map(node=>node.getText(tree)).join('\n'))(...Object.values({...deps,sesion:snapshot.session,sessionSnapshot:snapshot}));
  return{store,login,original,deps,logout,gate,replacements,calls};
}

for(const result of [{revoked:true},{revoked:false,reason:'unconfirmed'}])test(`actual App logout gate is neutral before completion, never adds next or claims revoked=${result.revoked}`,async()=>{
  const h=logoutAppFixture();let resolve;const wait=new Promise(done=>{resolve=done;});
  h.deps.cerrarSesion=()=>{h.calls.push('logout');h.store.withdrawObservation();return wait;};
  const pending=h.logout();h.gate(h.store.getSnapshot());
  assert.deepEqual(h.calls,['save','logout']);assert.deepEqual(h.replacements,['/login']);
  assert.equal(await h.logout(),false,'Double click must not call controller/logout again');
  resolve(result);assert.equal(await pending,result);assert.deepEqual(h.replacements,['/login'],'Completion never redirects');
});

test('actual App expiry/direct anonymous gate retains full next, including later expiry after logout and fresh A',async()=>{
  const h=logoutAppFixture();h.store.withdrawObservation();h.gate(h.store.getSnapshot());
  assert.deepEqual(h.replacements,[loginHrefForDestination(readRouteKey(h.deps.window))]);
  const fresh=h.login();h.deps.sessionSnapshot=fresh;
  h.deps.cerrarSesion=()=>{h.store.withdrawObservation();return{revoked:true};};
  const logout=evaluate(declaration('logout').initializer.arguments[0],h.deps);
  await logout();h.gate(h.store.getSnapshot());assert.equal(h.replacements.at(-1),'/login');
  h.login();h.store.withdrawObservation();h.gate(h.store.getSnapshot());
  assert.equal(h.replacements.at(-1),loginHrefForDestination(readRouteKey(h.deps.window)));
});

test('actual App stale A completion never navigates B or chooses neutral for B subsequent expiry',async()=>{
  const h=logoutAppFixture();let resolve;h.deps.cerrarSesion=()=>new Promise(done=>{resolve=done;});
  const pending=h.logout(),b=h.login(8);h.gate(b);assert.deepEqual(h.replacements,[]);
  resolve({revoked:true});await pending;assert.deepEqual(h.replacements,[]);
  h.store.withdrawObservation();h.gate(h.store.getSnapshot());
  assert.deepEqual(h.replacements,[loginHrefForDestination(readRouteKey(h.deps.window))]);
});
