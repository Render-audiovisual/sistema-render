import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoutePrefetch} from './route-prefetch.js';
test('code prefetch only starts on intent, deduplicates repeated focus and never loads unknown or external routes',async()=>{
 let calls=0;const prefetch=createRoutePrefetch({'/calendario':async()=>{calls++;}});
 assert.equal(calls,0);
 const first=prefetch('/calendario?mes=2026-10'),second=prefetch('/calendario?mes=2026-11');
 assert.equal(first,second);assert.equal(await first,true);assert.equal(calls,1);
 for(const href of ['/sueldos','https://evil.test/calendario','//evil.test/calendario','javascript:alert(1)',null,'/__proto__'])assert.equal(await prefetch(href),false);
 assert.equal(calls,1);
});
test('low bandwidth and data saver skip speculative downloads; failed imports do not break navigation or poison retries',async()=>{
 let calls=0;const prefetch=createRoutePrefetch({'/lista':()=>{if(++calls===1)throw Error('offline');}});
 for(const connection of [{saveData:true},{effectiveType:'2g'},{effectiveType:'slow-2g'}])assert.equal(await prefetch('/lista',connection),false);
 assert.equal(calls,0);assert.equal(await prefetch('/lista'),false);assert.equal(await prefetch('/lista'),true);assert.equal(calls,2);
});
test('client administration and ordinary client cards keep separate code targets',async()=>{
 const calls=[];const prefetch=createRoutePrefetch({'/clientes':()=>calls.push('cards'),'/clientes?gestion=1':()=>calls.push('admin')});
 await prefetch('/clientes?periodo=2026-10');await prefetch('/clientes?gestion=1');assert.deepEqual(calls,['cards','admin']);
});
