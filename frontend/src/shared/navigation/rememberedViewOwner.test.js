import test from 'node:test';
import assert from 'node:assert/strict';
import {createRememberedViewOwner} from './rememberedViewOwner.js';
import {createBrowserSessionState} from '../session/browser-session-state.js';
function fixture(){
 const state=createBrowserSessionState(),values=new Map(),events=new Map(),docEvents=new Map();
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const accept=id=>{assert.equal(state.acceptBootstrap(state.beginBootstrap(),{usuario:{id,usuario:'qa',nombre:'QA',rol:'diseno',activo:true},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)}),true);};accept(7);
 const win={location:{pathname:'/workspace/tareas',search:'?view=list&responsible=id%3A7'},localStorage:storage,addEventListener:(n,f)=>events.set(n,f),removeEventListener:(n,f)=>{if(events.get(n)===f)events.delete(n);}};
 const doc={visibilityState:'visible',addEventListener:(n,f)=>docEvents.set(n,f),removeEventListener:(n,f)=>{if(docEvents.get(n)===f)docEvents.delete(n);}};
 const owner=createRememberedViewOwner({session:state.getSession(),readSession:state.getSession,windowTarget:win,documentTarget:doc});
 return {owner,state,accept,win,doc,events,docEvents,values};
}
test('same-session departure stores only view preferences and reentry reads them',()=>{
 const h=fixture();assert.equal(h.values.size,0);h.events.get('render:before-navigation')();
 assert.match(h.owner.read('/workspace/tareas'),/view=list/);assert.match(h.owner.read('/workspace/tareas'),/responsible=id%3A7/);
 assert.equal(h.owner.read('/workspace/tareas?view=board'),'/workspace/tareas?view=board');
 h.owner.dispose();assert.equal(h.events.size,0);assert.equal(h.docEvents.size,0);
});
test('inactive account observation cannot write or read another identity, including A/B/A',()=>{
 const h=fixture();h.owner.save();const snapshot=[...h.values];const retained=h.events.get('pagehide');
 h.accept(8);assert.equal(h.owner.save(),false);assert.equal(h.owner.read('/workspace/tareas'),'/workspace/tareas');retained();assert.deepEqual([...h.values],snapshot);
 h.accept(7);assert.equal(h.owner.save(),false);assert.equal(h.owner.read('/workspace/tareas'),'/workspace/tareas');
 const next=createRememberedViewOwner({session:h.state.getSession(),readSession:h.state.getSession,windowTarget:h.win,documentTarget:h.doc});assert.match(next.read('/workspace/tareas'),/view=list/);next.dispose();h.owner.dispose();
});
test('pagehide, beforeunload and hidden document save preferences without canceling navigation',()=>{
 const h=fixture();for(const name of ['popstate','pagehide','beforeunload']){h.events.get(name)();assert.equal(h.values.size,1);}
 h.win.location.search='?view=calendar';h.docEvents.get('visibilitychange')();assert.match(h.owner.read('/workspace/tareas'),/view=list/);
 h.doc.visibilityState='hidden';h.docEvents.get('visibilitychange')();assert.match(h.owner.read('/workspace/tareas'),/view=calendar/);h.owner.dispose();
});
test('storage denial and retired callbacks never interrupt normal navigation',()=>{
 const h=fixture(),save=h.events.get('pagehide');Object.defineProperty(h.win,'localStorage',{get(){throw Error('blocked');}});
 assert.equal(h.owner.save(),false);assert.equal(h.owner.read('/workspace/tareas'),'/workspace/tareas');
 h.owner.dispose();save();assert.equal(h.values.size,0);
});
test('committed filter notification saves the departed view before a real Back-style URL change',()=>{
 const h=fixture();h.win.location.search='?view=responsibles&responsible=id%3A7';
 h.events.get('render:view-preference-change')();
 h.win.location.pathname='/inicio';h.win.location.search='';h.events.get('popstate')();
 assert.match(h.owner.read('/workspace/tareas'),/view=responsibles/);assert.match(h.owner.read('/workspace/tareas'),/responsible=id%3A7/);h.owner.dispose();
});
