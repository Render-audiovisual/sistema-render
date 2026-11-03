import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSectionRetry} from './section-retry.js';
import {installUnsavedNavigation,registerNavigationGuard} from './unsaved.js';
function fixture(){const target=new EventTarget(),location=new URL('https://render.test/clientes?periodo=2026-10');let retries=0,current=true;
 class CustomEvent extends Event{constructor(type,options){super(type,options);this.detail=options.detail;}}
 const win={location,CustomEvent,addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target),dispatchEvent:target.dispatchEvent.bind(target),confirm:()=>false};
 installUnsavedNavigation(win);return {win,run:()=>requestSectionRetry(win,{isCurrent:()=>current,retry:()=>retries++}),get retries(){return retries;},invalidate(){current=false;}};
}
test('explicit section retry stays in the document and honors busy/dirty safeguards',()=>{
 const f=fixture();assert.equal(f.run(),true);assert.equal(f.retries,1);
 const stop=registerNavigationGuard(f.win,()=>({dirty:true,busy:false}));assert.equal(f.run(),false);assert.equal(f.retries,1);stop();
 const busy=registerNavigationGuard(f.win,()=>({dirty:false,busy:true}));assert.equal(f.run(),false);busy();
 assert.equal(f.run(),true);assert.equal(f.retries,2);
});
test('stale callbacks and a listener changing the route or identity cannot retry another section',()=>{
 for(const change of ['route','session']){const f=fixture();f.win.addEventListener('render:before-navigation',()=>{if(change==='route')f.win.location.pathname='/sueldos';else f.invalidate();});assert.equal(f.run(),false);assert.equal(f.retries,0);}
 const f=fixture();f.invalidate();assert.equal(f.run(),false);assert.equal(f.retries,0);
});
