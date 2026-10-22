import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplicationSession} from './application-session.js';
import {captureSessionBinding,sessionBindingMatches} from './session-binding.js';

const dto=id=>({usuario:{id,usuario:`qa_${id}`,nombre:'Synthetic',rol:'diseno'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
const response=value=>new Response(JSON.stringify(value),{headers:{'X-Render-Session-Context':value.session_context||'','Content-Type':'application/json'}});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)}};
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function setup(fetchImpl){
  const listeners=new Set();let tail=Promise.resolve();
  const locks={request(_name,_options,work){const result=tail.then(work);tail=result.catch(()=>{});return result}};
  const changes={subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}};
  const runtime=createApplicationSession({mode:'browser',fetchImpl,location:{origin:'http://127.0.0.1:5195'},locks,sessionChanges:changes});
  return {runtime,listeners,hint(){for(const fn of listeners)fn()}};
}
test('external hint withdraws actual account and all captured intents without adopting a message identity',async()=>{
  let calls=0;
  const f=setup(async()=>{calls++;return response(dto(7))});
  await f.runtime.start();const old=f.runtime.getSession(),binding=captureSessionBinding(old);
  assert.equal(sessionBindingMatches(binding,old),true);
  f.hint();assert.equal(f.runtime.getSnapshot().status,'anonymous');assert.equal(f.runtime.getSession(),null);
  assert.equal(sessionBindingMatches(binding,old),false);assert.equal(calls,1);
  f.runtime.dispose();assert.equal(f.listeners.size,0);f.hint();assert.equal(calls,1);
});
test('external hint cancels pending bootstrap publication even if the response ignores abort',async()=>{
  const gate=deferred();const f=setup(async()=>{await gate.promise;return response(dto(7))});
  const pending=f.runtime.start();await settle();assert.equal(f.runtime.getSnapshot().status,'loading');
  f.hint();assert.equal(f.runtime.getSnapshot().status,'anonymous');gate.resolve();
  assert.equal((await pending).ok,false);assert.equal(f.runtime.getSession(),null);f.runtime.dispose();
});
test('hint during cookie-setting login cannot release Web Lock early or publish a late account',async()=>{
  const gate=deferred();let posted=false,bootstraps=0;
  const f=setup(async url=>{
    if(url==='/api/sesion/desafio')return response({csrf_token:'c'.repeat(43)});
    if(url==='/api/login/browser'){posted=true;await gate.promise;return response(dto(8))}
    if(url==='/api/sesion'){bootstraps++;return response(dto(7))}
    throw Error('Unexpected fixture request');
  });
  await f.runtime.start();const login=f.runtime.login({kind:'password',body:{usuario:'synthetic',password:'fixture'}});
  await settle();assert.equal(posted,true);f.hint();assert.equal(f.runtime.getSnapshot().status,'anonymous');
  assert.throws(()=>f.runtime.login({kind:'password',body:{usuario:'synthetic2',password:'fixture'}}),error=>error.code==='browser_session_busy');
  gate.resolve();assert.equal((await login).ok,false);assert.equal(bootstraps,1);assert.equal(f.runtime.getSession(),null);f.runtime.dispose();
});
