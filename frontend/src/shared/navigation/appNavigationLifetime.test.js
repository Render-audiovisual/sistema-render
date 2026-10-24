import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readRouteKey} from './location.js';
const source=readFileSync(new URL('../../App.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('App.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function declaration(name){let found;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)found=node;ts.forEachChild(node,visit);}visit(tree);assert.ok(found);return found;}
function evaluate(node,deps){return Function(...Object.keys(deps),'return ('+node.getText(tree)+');')(...Object.values(deps));}
function fixture(){
  const snapshot=Object.freeze({status:'authenticated',session:Object.freeze({usuario:Object.freeze({id:7,rol:'diseno'})})});
  let current=snapshot,throws=false;const token=Object.freeze({}),calls=[],epoch={current:0},owner={current:{token}};
  const win={location:new URL('https://render.test/moodboards?board=3')};
  const deps={rememberedViews:{current:null},getApplicationSessionSnapshot:()=>{if(throws)throw Error('private session failure');return current;},sessionSnapshot:snapshot,
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
