import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {loginHrefForDestination,readLoginDestination,resolveLoginDestination} from '../shared/navigation/login-destination.js';
import {createLoginAttempts} from '../shared/session/login-attempt.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const appSource=read('../App.jsx'),loginSource=read('./Login.jsx');
const app=ts.createSourceFile('App.jsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const login=ts.createSourceFile('Login.jsx',loginSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const found=[];function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit)}visit(root);return found}
const text=(node,file)=>node.getText(file);
function navigate(capturedDestination,window){
 const property=nodes(login,n=>ts.isPropertyAssignment(n)&&n.name.getText(login)==='navigate')[0];
 return new Function('capturedDestination','window','resolveLoginDestination',`return (${text(property.initializer,login)});`)(capturedDestination,window,resolveLoginDestination);
}
test('actual anonymous App gate preserves full route using the closed login destination policy',()=>{
 const gate=nodes(app,n=>ts.isIfStatement(n)&&text(n.expression,app)==='!sesion')[0];
 const replacements=[],window={location:{replace:value=>replacements.push(value)}};
 const route='/workspace/tareas?task=42';
 new Function('sesion','window','route','loginHrefForDestination',text(gate,app))(null,window,route,loginHrefForDestination);
 assert.deepEqual(replacements,[loginHrefForDestination(route)]);
 assert.equal(readLoginDestination(new URL(replacements[0],'https://render.test').search),route);
});
test('actual authenticated login App branch resolves held destination against current role',()=>{
 const branch=nodes(app,n=>ts.isIfStatement(n)&&text(n.expression,app)==='sesion')[0];
 for(const user of [{id:1,rol:'admin'},{id:2,rol:'diseno'}]){
  const values=[],search='?next='+encodeURIComponent('/workspace/tareas?task=42');
  const window={location:{search,replace:value=>values.push(value)}};
  new Function('sesion','window','readLoginDestination','resolveLoginDestination',text(branch,app))({usuario:user},window,readLoginDestination,resolveLoginDestination);
  assert.deepEqual(values,[resolveLoginDestination(readLoginDestination(search),user)]);
 }
});
test('actual Login navigation uses initially captured destination, never live changed query or username authority',()=>{
 const captured={current:readLoginDestination('?next='+encodeURIComponent('/workspace/tareas?task=42'))},values=[];
 const window={location:{search:'?next='+encodeURIComponent('/sueldos'),replace:value=>values.push(value)}};
 const user={id:7,usuario:'franco',rol:'diseno'};
 navigate(captured,window)(user);
 assert.deepEqual(values,[resolveLoginDestination(captured.current,user)]);
 assert.notEqual(values[0],'/sueldos');
});
test('real attempts cleanup on login-query remount suppresses late old navigation and persistence',async()=>{
 let resolve;const pending=new Promise(yes=>{resolve=yes}),events=[];
 const nav=navigate({current:'/workspace/tareas?task=42'},{location:{replace:value=>events.push(['navigate',value])}});
 const attempts=createLoginAttempts({getRuntime:()=>null,readSession:()=>null,request:()=>pending,save:()=>events.push(['save']),navigate:nav,onState(){}});
 attempts.mount();const result=attempts.login('password',{usuario:'qa',password:'synthetic'});attempts.cleanup();
 resolve({ok:true,json:async()=>({token:'synthetic',usuario:{id:7,usuario:'qa',nombre:'QA',rol:'diseno'}})});
 assert.equal(await result,false);assert.deepEqual(events,[]);
});
test('source keys Login only by complete route and retains same-route pending/error lifecycle',()=>{
 assert.equal(app.parseDiagnostics.length,0);assert.equal(login.parseDiagnostics.length,0);
 const mount=nodes(app,n=>ts.isJsxSelfClosingElement(n)&&text(n.tagName,app)==='LoginPage')[0];
 assert.match(text(mount,app),/key=\{route\}/);assert.match(text(mount,app),/sessionPending=\{sessionSnapshot.status === 'loading'\}/);
  const key=mount.attributes.properties.find(attribute=>attribute.name?.getText(app)==='key');
  assert.equal(key.initializer.expression.getText(app),'route');
 assert.match(appSource,/sessionSnapshot.status === 'loading' && path !== '\/login'/);
 assert.match(appSource,/sessionSnapshot.status === 'error' && path !== '\/login'/);
 assert.match(loginSource,/capturedDestination = useRef\(readLoginDestination\(window.location.search\)\)/);
 assert.match(loginSource,/return \(\) => attempts.cleanup\(\)/);
 assert.doesNotMatch(loginSource,/getRutaUsuario|\.dispose\(|localStorage/);
});
