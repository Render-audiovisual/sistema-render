import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./Perfil.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Perfil.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function handler(name){let found;function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)===name)found=n.initializer;ts.forEachChild(n,walk);}walk(tree);assert.ok(found);return ts.transpileModule(`const handler=${found.getText(tree)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}
function fixture(kind,{dirty=true,accept=false,obsolete=false,fail=false,fields={}}={}){
  const calls=[],prompts=[],changes=[];let current=true;
  const guard={current:()=>current,request:(_fetch,url,options)=>{calls.push({url,options});return fail?Promise.resolve({ok:false,json:async()=>({code:'current_password_invalid'})}):new Promise(()=>{});}};
  const set=key=>value=>changes.push([key,value]);
  const deps={operationPending:{current:false},capture:()=>guard,fetch(){},window:{confirm:text=>{prompts.push(text);if(obsolete)current=false;return accept;}},
    perfilUsuario:{id:7,rol:'diseno',usuario:'original'},usuarioNuevo:kind==='username'?'new-name':dirty?'pending-name':'original',passwordUsuario:kind==='username'?'synthetic-current':dirty?'pending-current':'',
    actual:kind==='password'?'synthetic-current':dirty?'pending-current':'',nueva:kind==='password'?'synthetic-new':dirty?'pending-new':'',confirmar:kind==='password'?'synthetic-new':dirty?'pending-new':'',
    newPasswordError:()=>null,profileFailureMessage:()=> 'Error',setMensajeUsuario:set('messageUser'),setErrorUsuario:set('errorUser'),setEnviandoUsuario:set('busyUser'),setMensaje:set('message'),setError:set('error'),setEnviando:set('busy'),setActual:set('actual'),setNueva:set('new'),setConfirmar:set('confirm')};
  Object.assign(deps,fields);
  const invoke=Function(...Object.keys(deps),handler(kind==='username'?'handleCambiarUsuario':'handleSubmit')+';return handler;')(...Object.values(deps));
  return {calls,prompts,changes,deps,run:()=>invoke({preventDefault(){}})};
}
for(const field of ['actual','nueva','confirmar'])test(`username warns for sibling ${field} alone`,()=>{
  const f=fixture('username',{dirty:false,fields:{[field]:'pending'}});f.run();assert.equal(f.prompts.length,1);assert.equal(f.calls.length,0);
});
for(const fields of [{usuarioNuevo:'original '},{passwordUsuario:'pending'}])test(`password warns for isolated username draft ${Object.keys(fields)[0]}`,()=>{
  const f=fixture('password',{dirty:false,fields});f.run();assert.equal(f.prompts.length,1);assert.equal(f.calls.length,0);
});
for(const kind of ['username','password']){
  test(`${kind}: cancelling sibling draft loss sends nothing and keeps fields`,()=>{const f=fixture(kind);f.run();assert.equal(f.prompts.length,1);assert.equal(f.calls.length,0);assert.equal(f.deps.operationPending.current,false);assert.ok(!f.changes.some(([key])=>['actual','new','confirm'].includes(key)));});
  test(`${kind}: clean sibling does not prompt; explicit acceptance allows one request`,()=>{for(const options of [{dirty:false},{accept:true}]){const f=fixture(kind,options);f.run();assert.equal(f.calls.length,1);assert.equal(f.prompts.length,options.dirty===false?0:1);}});
  test(`${kind}: obsolete session after confirmation cannot send`,()=>{const f=fixture(kind,{accept:true,obsolete:true});f.run();assert.equal(f.calls.length,0);});
  test(`${kind}: failed accepted save keeps sibling and password fields`,async()=>{const f=fixture(kind,{accept:true,fail:true});f.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1);assert.ok(!f.changes.some(([key])=>['actual','new','confirm'].includes(key)));});
}
