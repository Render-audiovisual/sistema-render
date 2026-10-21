import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackBrowserAliasInput, feedbackBrowserAliasBody } from '../src/feedback-browser-compat.js';
test('legacy adapters preserve explicit intent/version and never infer omitted preconditions', () => {
  assert.deepEqual(feedbackBrowserAliasInput('create',{body:{titulo:'A'}}),{action:'create',fields:{titulo:'A'}});
  assert.deepEqual(feedbackBrowserAliasInput('edit',{params:{id:'12'},body:{request_id:'uuid',expected_updated_at:'observed',feedback:{referencia:'x'}}}),
    {action:'edit',request_id:'uuid',expected_updated_at:'observed',note_id:12,fields:{feedback:{referencia:'x'}}});
  assert.deepEqual(feedbackBrowserAliasInput('trash',{params:{id:'12'},query:{permanente:'true'},body:{request_id:'uuid',expected_updated_at:'observed'}}),
    {action:'purge',request_id:'uuid',expected_updated_at:'observed',note_id:12});
});
test('legacy URL cannot override action/target or smuggle query/coercion/provenance into business fields', () => {
  for (const req of [{params:{id:'01'}},{params:{id:'2147483648'}},{params:{id:'1'},body:[]},
    {params:{id:'1'},body:{action:'purge'}},{params:{id:'1'},body:{note_id:9}},
    {params:{id:'1'},body:{origen:'mia_whatsapp'}},{params:{id:'1'},query:{permanente:['true']}},
    {params:{id:'1'},query:{permanente:'TRUE'}}]) assert.throws(()=>feedbackBrowserAliasInput('trash',req),error=>error.status===400);
  assert.throws(()=>feedbackBrowserAliasInput('create',{query:{permanente:'true'}}),error=>error.status===400);
});
test('legacy replay does not invent an active note after purge and exposes current visibility', () => {
  const operation={action:'create',note_id:12,replayed:true};
  assert.deepEqual(feedbackBrowserAliasBody({body:{operation,note:null}}),{id:12,unavailable:true,operation});
  const current={id:12,eliminado_at:null};
  const archivedOperation={...operation,action:'trash'};
  assert.deepEqual(feedbackBrowserAliasBody({body:{operation:archivedOperation,note:current}}),{ok:true,operation:archivedOperation,note:current});
});
