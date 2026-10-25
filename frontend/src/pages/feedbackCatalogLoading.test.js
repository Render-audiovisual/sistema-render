import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
import {feedbackResponsibleCatalog} from './feedbackResponsibleSelection.js';

const source=readFileSync(new URL('./Feedback.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Feedback.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const effects=[];
(function walk(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect')effects.push(node.arguments[0]);ts.forEachChild(node,walk);})(tree);
const effect=effects.find(node=>node.getText(tree).includes('scope.request("/api/clientes")'));
assert.ok(effect,'actual independent catalog effect');
const compiled=ts.transpileModule(`const effect=(${effect.getText(tree)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const people=[{id:13,nombre:'Same Name',usuario:'second',activo:true}];
function fixture(){
  const store=createBrowserSessionState();
  const bootstrap=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,usuario:`qa${id}`,nombre:'QA',rol:'admin',activo:true},session_context:String(id).repeat(43),csrf_token:'c'.repeat(43)});
  bootstrap(1);const original=store.getSession();
  const reads={'/api/clientes':deferred(),'/api/usuarios':deferred()},calls=[],writes=[];
  const state={users:[],clients:[],status:'initial',errors:{clients:'',users:''}};
  const set=key=>value=>{state[key]=typeof value==='function'?value(state[key]):value;writes.push(key);};
  const deps={view:{session:original},getSesion:()=>store.getSession(),createCapturedRequest,feedbackResponsibleCatalog,
    transport:(url,options)=>{calls.push({url,options});return reads[url].promise;},
    mounted:{current:true},contextEpoch:{current:0},window:{location:{pathname:'/feedback'}},
    setUsers:set('users'),setClients:set('clients'),setUsersStatus:set('status'),setCatalogErrors:set('errors')};
  const cleanup=Function(...Object.keys(deps),compiled+';return effect();')(...Object.values(deps));
  return{state,reads,calls,writes,deps,cleanup,bootstrap};
}
test('actual effect publishes users while clients fail, with an independent client error and loading transition',async()=>{
  const f=fixture();assert.equal(f.state.status,'loading');assert.equal(f.calls.length,2);
  assert.ok(f.calls.every(call=>call.options.headers['X-Render-Session-Context']));
  f.reads['/api/clientes'].reject(Object.assign(new Error('503'),{status:503}));await settle();
  assert.equal(f.state.status,'loading');assert.match(f.state.errors.clients,/clientes/);assert.equal(f.state.errors.users,'');
  f.reads['/api/usuarios'].resolve(people);await settle();
  assert.deepEqual(f.state.users,people);assert.equal(f.state.status,'ready');assert.match(f.state.errors.clients,/clientes/);
  f.cleanup();
});
test('actual effect publishes clients when users fail and reports only the people error',async()=>{
  const f=fixture();f.reads['/api/usuarios'].reject(new Error('503'));await settle();
  f.reads['/api/clientes'].resolve([{id:2,nombre:'Client'}]);await settle();
  assert.equal(f.state.status,'error');assert.equal(f.state.clients[0].id,2);
  assert.match(f.state.errors.users,/personas/);assert.equal(f.state.errors.clients,'');f.cleanup();
});
test('invalid users DTO fails closed without discarding successful clients',async()=>{
  const f=fixture();f.reads['/api/clientes'].resolve([{id:2,nombre:'Client'}]);f.reads['/api/usuarios'].resolve([{id:'13'}]);await settle();
  assert.equal(f.state.status,'error');assert.deepEqual(f.state.users,[]);assert.equal(f.state.clients.length,1);f.cleanup();
});
test('both failures retain both errors regardless of arrival order',async()=>{
  const f=fixture();f.reads['/api/usuarios'].reject(new Error('users'));await settle();f.reads['/api/clientes'].reject(new Error('clients'));await settle();
  assert.match(f.state.errors.clients,/clientes/);assert.match(f.state.errors.users,/personas/);f.cleanup();
});
for(const change of ['cleanup','context','session','sessionABA','unmount','route'])for(const failed of [false,true]){
  test(`late ${failed?'failure':'success'} cannot publish after ${change}`,async()=>{
    const f=fixture();
    if(change==='cleanup')f.cleanup();
    if(change==='context')f.deps.contextEpoch.current++;
    if(change==='session')f.bootstrap(2);
    if(change==='sessionABA'){f.bootstrap(2);f.bootstrap(1);}
    if(change==='unmount')f.deps.mounted.current=false;
    if(change==='route')f.deps.window.location.pathname='/tareas';
    const before=structuredClone(f.state),count=f.writes.length;
    if(failed){f.reads['/api/clientes'].reject(new Error('late'));f.reads['/api/usuarios'].reject(new Error('late'));}
    else{f.reads['/api/clientes'].resolve([{id:2,nombre:'Late'}]);f.reads['/api/usuarios'].resolve(people);}
    await settle();assert.deepEqual(f.state,before);assert.equal(f.writes.length,count);f.cleanup();
  });
}
test('canonical selector CSS permits unbroken identity labels to shrink and wrap',()=>{
  const css=readFileSync(new URL('./Feedback.css',import.meta.url),'utf8');
  assert.match(css,/\.rf-fields \.rf-people label>span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/);
});
