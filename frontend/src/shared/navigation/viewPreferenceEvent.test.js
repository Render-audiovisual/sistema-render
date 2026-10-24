import test from 'node:test';
import assert from 'node:assert/strict';
import {notifyViewPreferenceChange} from './viewPreferenceEvent.js';
test('filter notification emits one event without navigation or history mutation',()=>{
 const events=[],win={Event,dispatchEvent:event=>events.push(event.type),history:new Proxy({},{get(){assert.fail('No history operation');}})};
 assert.equal(notifyViewPreferenceChange(win),true);assert.deepEqual(events,['render:view-preference-change']);
});
test('unavailable or throwing notification cannot fail the completed filter update',()=>{
 for(const win of [{},{Event,dispatchEvent(){throw Error('closed');}},{get CustomEvent(){throw Error('unavailable');}}])assert.equal(notifyViewPreferenceChange(win),false);
});
