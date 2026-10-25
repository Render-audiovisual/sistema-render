import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeedbackResponsibleIds} from '../../shared/feedback-responsibles.mjs';
import {normalizeFeedback} from '../src/feedback-fields.js';
import {resolveFeedbackResponsibleSelection} from '../src/feedback-responsibles.js';
import {feedbackNoteMetadataDto} from '../src/feedback-notes-read.js';
import {normalizeFeedbackBrowserOperation} from '../src/feedback-browser-write.js';
import {encolarNotificacionPrivadaFeedback} from '../src/private-feedback-notifications.js';

test('optional IDs stay absent for legacy data; explicit arrays are bounded, strict and cloned',()=>{
  assert.equal(Object.hasOwn(normalizeFeedback({responsables:['Legacy']}),'responsable_ids'),false);
  const input=[12,7],parsed=normalizeFeedbackResponsibleIds(input);
  assert.deepEqual(parsed,[7,12]);assert.deepEqual(input,[12,7]);assert.notEqual(parsed,input);
  for(const value of [null,undefined,'7',{},[0],[-1],['7'],[1.5],[2147483648],[7,7],Array.from({length:21},(_,i)=>i+1)]){
    assert.throws(()=>normalizeFeedbackResponsibleIds(value),{status:400});
  }
  assert.deepEqual(normalizeFeedback({responsable_ids:[]}).responsable_ids,[]);
});
test('explicit selection derives labels from the locked active ID rows, never supplied homonym text',async()=>{
  const calls=[],patch={responsable_ids:[12,7],responsables:['Forged'],responsable:'Forged'};
  const result=await resolveFeedbackResponsibleSelection({query:async(sql,params)=>{
    calls.push({sql,params});return{rows:[{id:7,nombre:'Same',usuario:'one'},{id:12,nombre:'Same',usuario:'two'}]};
  }},patch);
  assert.deepEqual(calls[0].params,[[7,12]]);assert.match(calls[0].sql,/activo IS TRUE.*ORDER BY id FOR SHARE/s);
  assert.deepEqual(result,{responsable_ids:[7,12],responsables:['Same','Same'],responsable:'Same'});
  assert.deepEqual(patch.responsables,['Forged']);
});
test('new or changed unavailable IDs fail without retaining a forged display label',async()=>{
  for(const rows of [[],[{id:12,nombre:'Other',usuario:'other'}]]){
    await assert.rejects(resolveFeedbackResponsibleSelection({query:async()=>({rows})},{responsable_ids:[7],responsables:['Forged']}),{status:422});
  }
});
test('unchanged retired IDs preserve identity and labels without requiring a new active selection',async()=>{
  const current={responsable_ids:[7],responsables:['Historical'],responsable:'Historical'};
  const db={query:async()=>assert.fail('No reinterpretation of unchanged identities')};
  const result=await resolveFeedbackResponsibleSelection(db,{responsable_ids:[7],estado:'resuelto'},current);
  assert.deepEqual(result,{responsable_ids:[7],responsables:['Historical'],responsable:'Historical',estado:'resuelto'});
  assert.notEqual(result.responsable_ids,current.responsable_ids);
  assert.deepEqual(await resolveFeedbackResponsibleSelection(db,{estado:'resuelto'},current),{estado:'resuelto',responsable_ids:[7]});
  const homonyms={responsable_ids:[7,12],responsables:['Same','Same'],responsable:'Same'};
  assert.deepEqual((await resolveFeedbackResponsibleSelection(db,{responsable_ids:[12,7]},homonyms)).responsables,['Same','Same']);
});
test('legacy label edits cannot silently retain different explicit identities; unchanged echo remains compatible',async()=>{
  const current={responsable_ids:[7],responsables:['Historical'],responsable:'Historical'},db={query:async()=>assert.fail('No name lookup')};
  await assert.rejects(resolveFeedbackResponsibleSelection(db,{responsables:['Other']},current),{status:409});
  assert.deepEqual(await resolveFeedbackResponsibleSelection(db,{responsables:['Historical']},current),{responsables:['Historical'],responsable_ids:[7]});
  assert.deepEqual(await resolveFeedbackResponsibleSelection(db,{responsables:['Legacy']},{}),{responsables:['Legacy']});
});
test('browser intent captures IDs without coercion; read metadata rejects malformed persisted IDs',()=>{
  const body={request_id:'10000000-0000-4000-8000-000000000001',action:'create',fields:{feedback:{responsable_ids:[12,7],flujo:'feedback'}}};
  const input=normalizeFeedbackBrowserOperation(body);assert.deepEqual(input.fields.feedback.responsable_ids,[7,12]);
  assert.equal(Object.isFrozen(input.fields.feedback.responsable_ids),true);body.fields.feedback.responsable_ids.push(9);
  assert.deepEqual(input.fields.feedback.responsable_ids,[7,12]);
  const metadata={responsable_ids:[12,7],responsables:['Name']},dto=feedbackNoteMetadataDto(metadata);
  assert.deepEqual(dto.responsable_ids,[7,12]);assert.notEqual(dto.responsable_ids,metadata.responsable_ids);
  for(const value of [null,['7'],[7,7]])assert.throws(()=>feedbackNoteMetadataDto({responsable_ids:value}),{status:500});
});
test('explicit notifier IDs ignore ambiguous labels and empty/invalid arrays never fall back to names',async()=>{
  const calls=[],pool={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT')){assert.match(sql,/id=ANY/);assert.deepEqual(params,[[12]]);return{rows:[{id:12,nombre:'Same',usuario:'chosen'}]};}
    return{rows:[{id:1}]};
  }};
  const nota={id:1,titulo:'QA',updated_at:'2026-10-24T12:00:00Z',feedback:{responsable_ids:[12],responsables:['Same']}};
  assert.equal((await encolarNotificacionPrivadaFeedback({pool,nota,actorId:7})).encolado,true);
  assert.equal(JSON.parse(calls[1].params[6]).destinatario_usuario_id,12);
  calls.length=0;
  assert.equal((await encolarNotificacionPrivadaFeedback({pool,nota:{...nota,feedback:{...nota.feedback,responsable_ids:[]}},actorId:7})).encolado,false);
  assert.deepEqual(calls,[]);
  await assert.rejects(encolarNotificacionPrivadaFeedback({pool,nota:{...nota,feedback:{...nota.feedback,responsable_ids:['12']}},actorId:7}),{status:400});
  assert.deepEqual(calls,[]);
});
