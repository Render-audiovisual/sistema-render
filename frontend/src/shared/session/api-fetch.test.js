import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from 'node:fs';
import {createAuthenticatedApiFetch}from './api-fetch.js';

const session=(token='A',id=7)=>({token,usuario:{id,usuario:`qa-${id}`,nombre:'QA',rol:'edicion'}});
const response=(status=200,body={ok:true})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function fixture(fetchImpl,locationFields={}){
  let raw=JSON.stringify(session());const calls=[],removed=[],navigated=[];
  const storage={getItem:()=>raw,removeItem:key=>{removed.push(key);raw=null;}};
  const location={pathname:'/perfil',...locationFields,replace:path=>navigated.push(path)};
  const fetch=createAuthenticatedApiFetch({storage,location,apiBase:'https://example.invalid',fetchImpl:async(...args)=>{calls.push(args);return fetchImpl(...args);}});
  return{fetch,calls,removed,navigated,set:value=>{raw=value===null?null:JSON.stringify(value);},get raw(){return raw;}};
}
test('actual sent captured Authorization is preserved rather than replaced by a newer local account',async()=>{
  const f=fixture(async()=>response());f.set(session('B',8));
  const controller=new AbortController();await f.fetch('/api/usuarios/foto',{method:'PATCH',headers:{Authorization:'Bearer A','X-QA':'kept'},signal:controller.signal,body:'QA'});
  const [url,init]=f.calls[0];assert.equal(url,'https://example.invalid/api/usuarios/foto');
  assert.equal(init.headers.get('Authorization'),'Bearer A');assert.equal(init.headers.get('X-QA'),'kept');
  assert.equal(init.signal,controller.signal);assert.equal(init.body,'QA');
  await f.fetch('/api/inicio');assert.equal(f.calls[1][1].headers.get('Authorization'),'Bearer B');
});
test('late 401 from A cannot erase, redirect or authenticate a subsequent B session',async()=>{
  let complete;const f=fixture(()=>new Promise(resolve=>{complete=resolve;}));
  const pending=f.fetch('/api/inicio');f.set(session('B',8));complete(response(401));
  assert.equal((await pending).status,401);assert.equal(JSON.parse(f.raw).token,'B');
  assert.deepEqual([f.removed,f.navigated],[[],[]]);
});
test('same token with a changed local identity is not cleared by an obsolete bound request',async()=>{
  let complete;const f=fixture(()=>new Promise(resolve=>{complete=resolve;}));
  const pending=f.fetch('/api/inicio');f.set(session('A',8));complete(response(401));await pending;
  assert.equal(JSON.parse(f.raw).usuario.id,8);assert.deepEqual([f.removed,f.navigated],[[],[]]);
});
test('a current bound unauthorized session clears only its key and requires login',async()=>{
  const f=fixture(async()=>response(401));await f.fetch('/api/inicio');
  assert.equal(f.raw,null);assert.deepEqual(f.removed,['render_sesion']);assert.deepEqual(f.navigated,['/login?next=%2Fperfil']);
});
test('current bound 401 preserves canonical task query and hash in login destination',async()=>{
  const f=fixture(async()=>response(401),{pathname:'/workspace/tareas',search:'?task=42&view=responsibles',hash:'#detail'});
  await f.fetch('/api/tareas/42');
  assert.deepEqual(f.navigated,['/login?next=%2Fworkspace%2Ftareas%3Ftask%3D42%26view%3Dresponsibles%23detail']);
  assert.equal(new URL(f.navigated[0],'https://render.test').searchParams.get('next'),'/workspace/tareas?task=42&view=responsibles#detail');
});
test('unknown/API locations fall back to plain login and current login never nests next',async()=>{
  for(const pathname of ['/unknown','/api/tareas']){
    const f=fixture(async()=>response(401),{pathname,search:'?next=%2Fsueldos',hash:'#private'});
    await f.fetch('/api/inicio');assert.deepEqual(f.navigated,['/login']);assert.deepEqual(f.removed,['render_sesion']);
  }
  const login=fixture(async()=>response(401),{pathname:'/login',search:'?next=%2Fperfil',hash:'#form'});
  await login.fetch('/api/inicio');assert.deepEqual(login.navigated,[]);assert.deepEqual(login.removed,['render_sesion']);
});
test('explicit unrelated credentials and initially anonymous requests cannot clear a current login',async()=>{
  const f=fixture(async()=>response(401));await f.fetch('/api/inicio',{headers:{Authorization:'Bearer other'}});assert.deepEqual([f.removed,f.navigated],[[],[]]);
  let complete;const anonymous=fixture(()=>new Promise(resolve=>{complete=resolve;}));anonymous.set(null);
  const pending=anonymous.fetch('/api/inicio');anonymous.set(session('B',8));complete(response(401));await pending;assert.deepEqual([anonymous.removed,anonymous.navigated],[[],[]]);
});
test('wrong current password is a form error, not a session invalidation, and response body remains readable',async()=>{
  for(const path of ['/api/usuarios/perfil','/api/usuarios/password']){
    const f=fixture(async()=>response(401,{error:'Wrong password',code:'current_password_invalid'}));
    const result=await f.fetch(path,{method:'PATCH'});assert.equal((await result.json()).code,'current_password_invalid');
    assert.deepEqual([f.removed,f.navigated],[[],[]]);assert.equal(JSON.parse(f.raw).token,'A');
  }
  const revoked=fixture(async()=>response(401,{error:'Session revoked'}));await revoked.fetch('/api/usuarios/password');assert.deepEqual(revoked.removed,['render_sesion']);
});
test('login errors including query variants are handled by login rather than invalidating another session',async()=>{
  for(const path of ['/api/login','/api/login/google','/api/login?returnTo=%2Finicio']){
    const f=fixture(async()=>response(401));await f.fetch(path);assert.deepEqual(f.removed,[]);
  }
});
test('non-API input is delegated unchanged without credentials or URL rewrite',async()=>{
  for(const path of ['/apiculture','https://example.invalid/api/inicio','/assets/asset.js']){
    const f=fixture(async()=>response());const init={method:'GET'};await f.fetch(path,init);
    assert.equal(f.calls[0][0],path);assert.equal(f.calls[0][1],init);
  }
});
test('network failure never mutates storage and bootstrap uses the tested transport',async()=>{
  const f=fixture(async()=>{throw Error('offline');});await assert.rejects(f.fetch('/api/inicio'),/offline/);assert.deepEqual(f.removed,[]);
  const main=readFileSync(new URL('../../main.jsx',import.meta.url),'utf8');
  assert.match(main,/const applicationSession = createApplicationSession\(\{ mode: 'bearer', fetchImpl: fetchOriginal/);
  assert.match(main,/window.fetch = applicationSession.fetch/);
  assert.doesNotMatch(main,/response.status === 401|headers.set\("Authorization"/);
});
