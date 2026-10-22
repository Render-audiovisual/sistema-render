import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationDiscardController} from './navigationDiscardController.js';
function fixture(){
 let lifetime={},current=true;const queries=[],invoker={},fallback={};
 const controller=createNavigationDiscardController({readLifetime:()=>lifetime,getDocument:()=>({activeElement:invoker,querySelector:selector=>{queries.push(selector);return fallback}})});
 const activate=()=>controller.activate(lifetime),host=controller.attachHost(),lease=activate();
 const intent=()=>({signal:new AbortController().signal,isCurrent:()=>current});
 return{controller,host,lease,activate,intent,queries,invoker,fallback,setCurrent:value=>{current=value},changeLifetime:()=>{lifetime={}},get lifetime(){return lifetime}};
}
test('only one pending confirmation; second request is denied without replacing the first',async()=>{
 const f=fixture(),first=f.controller.request(f.intent()),view=f.controller.getSnapshot();
 assert.equal(await f.controller.request(f.intent()),false);assert.equal(f.controller.getSnapshot(),view);assert.equal(f.controller.isCurrent(view),true);
 assert.equal(f.controller.resolve(view,true),true);assert.equal(await first,true);assert.equal(f.controller.getSnapshot(),null);assert.equal(f.controller.resolve(view,true),false);
});
test('cancel is false once, subscribers observe only child-facing snapshot transitions',async()=>{
 const f=fixture(),seen=[],off=f.controller.subscribe(()=>seen.push(f.controller.getSnapshot()));
 const pending=f.controller.request(f.intent());assert.equal(seen.length,1);const view=seen[0];assert.deepEqual(Object.keys(view),['id','invoker','fallback']);assert.equal(view.invoker,f.invoker);assert.equal(view.fallback,f.fallback);
 f.controller.resolve(view,false);assert.equal(await pending,false);assert.equal(seen.length,2);assert.equal(seen[1],null);off();off();
 assert.match(f.queries[0],/\.sidebar button\[aria-label="Abrir menú"\]/);assert.match(f.queries[0],/Cerrar menú/);
});
test('already aborted, missing predicate, malformed signal and invalid owner lifetime fail closed',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort();
 for(const intent of [null,{}, {signal:abort.signal,isCurrent:()=>true},{signal:new AbortController().signal},{signal:{aborted:false},isCurrent:()=>true},{signal:new AbortController().signal,isCurrent:()=>{throw Error('stale')}}])assert.equal(await f.controller.request(intent),false);
 assert.equal(f.controller.getSnapshot(),null);f.controller.deactivate(f.lease);assert.equal(await f.controller.request(f.intent()),false);
});
test('signal abort resolves false and removes old listener before a subsequent confirmation',async()=>{
 const f=fixture(),abort=new AbortController(),first=f.controller.request({signal:abort.signal,isCurrent:()=>true}),old=f.controller.getSnapshot();abort.abort();assert.equal(await first,false);assert.equal(f.controller.getSnapshot(),null);
 const second=f.controller.request(f.intent()),view=f.controller.getSnapshot();assert.notEqual(view,old);abort.abort();assert.equal(f.controller.getSnapshot(),view);assert.equal(f.controller.resolve(old,true),false);f.controller.resolve(view,false);assert.equal(await second,false);
});
test('predicate recheck at acceptance denies stale guard observation, without clearing other ownership',async()=>{
 const f=fixture(),pending=f.controller.request(f.intent()),view=f.controller.getSnapshot();f.setCurrent(false);assert.equal(f.controller.isCurrent(view),false);assert.equal(f.controller.resolve(view,true),false);assert.equal(await pending,false);
});
test('lifetime changes before layout cleanup cannot accept a previous account/route request',async()=>{
 const f=fixture(),pending=f.controller.request(f.intent()),view=f.controller.getSnapshot();f.changeLifetime();assert.equal(f.controller.isCurrent(view),false);assert.equal(f.controller.resolve(view,true),false);assert.equal(await pending,false);
});
test('lifetime activation denies old pending; stale cleanup cannot deactivate new StrictMode lease',async()=>{
 const f=fixture(),pending=f.controller.request(f.intent()),old=f.controller.getSnapshot();f.changeLifetime();const lease=f.activate();assert.equal(await pending,false);
 f.controller.deactivate(f.lease);const next=f.controller.request(f.intent()),current=f.controller.getSnapshot();assert.ok(current);assert.equal(f.controller.resolve(old,true),false);f.controller.resolve(current,true);assert.equal(await next,true);f.controller.deactivate(lease);
});
test('root deactivate rejects pending and stable controller can activate a fresh setup',async()=>{
 const f=fixture(),pending=f.controller.request(f.intent());f.controller.deactivate(f.lease);assert.equal(await pending,false);assert.equal(await f.controller.request(f.intent()),false);
 f.activate();const next=f.controller.request(f.intent());f.controller.resolve(f.controller.getSnapshot(),true);assert.equal(await next,true);
});
test('host unmount denies even when root owner stays active; request cannot hang without a mounted host',async()=>{
 const f=fixture(),pending=f.controller.request(f.intent());f.controller.detachHost(f.host);assert.equal(await pending,false);assert.equal(await f.controller.request(f.intent()),false);
 const host=f.controller.attachHost();f.controller.detachHost(f.host);const next=f.controller.request(f.intent());assert.ok(f.controller.getSnapshot());f.controller.resolve(f.controller.getSnapshot(),true);assert.equal(await next,true);f.controller.detachHost(host);
});
test('host and route ABA never let an old modal settle a new pending request',async()=>{
 const f=fixture(),first=f.controller.request(f.intent()),old=f.controller.getSnapshot();f.controller.detachHost(f.host);const host=f.controller.attachHost();assert.equal(await first,false);
 f.changeLifetime();f.activate();f.changeLifetime();f.activate();const second=f.controller.request(f.intent()),view=f.controller.getSnapshot();assert.equal(f.controller.resolve(old,true),false);assert.equal(f.controller.getSnapshot(),view);f.controller.detachHost(host);assert.equal(await second,false);
});
test('request captures optional fallback without exposing caller intent or lifetime in the child snapshot',async()=>{
 const f=fixture(),fallback={},intent={...f.intent(),fallbackFocus:fallback,href:'/not-rendered',secret:'never-projected'},pending=f.controller.request(intent),view=f.controller.getSnapshot();
 assert.equal(view.fallback,fallback);assert.equal(f.queries.length,0);assert.deepEqual(Object.keys(view),['id','invoker','fallback']);assert.equal(f.controller.getServerSnapshot(),null);f.controller.resolve(view,false);assert.equal(await pending,false);
});
test('retired abort listener cannot reject a subsequent modal',async()=>{
 const f=fixture(),abort=new AbortController(),first=f.controller.request({signal:abort.signal,isCurrent:()=>true});f.controller.resolve(f.controller.getSnapshot(),true);assert.equal(await first,true);
 const second=f.controller.request(f.intent()),view=f.controller.getSnapshot();abort.abort();assert.equal(f.controller.getSnapshot(),view);f.controller.resolve(view,true);assert.equal(await second,true);
});
test('controller instances have independent ownership and no navigation or persistence side effects',async()=>{
 const a=fixture(),b=fixture(),first=a.controller.request(a.intent()),second=b.controller.request(b.intent());a.controller.resolve(a.controller.getSnapshot(),false);assert.equal(await first,false);assert.ok(b.controller.getSnapshot());b.controller.resolve(b.controller.getSnapshot(),true);assert.equal(await second,true);
});
