import test from 'node:test';
import assert from 'node:assert/strict';
import {feedbackResponsibleCatalog,feedbackResponsibleIds,feedbackResponsibleDisplay,toggleFeedbackResponsibleId} from './feedbackResponsibleSelection.js';
import {normalizeFeedbackResponsibleIds} from '../../../shared/feedback-responsibles.mjs';
import {feedbackNotesMutationBody,createFeedbackNotesMutation} from './feedbackNotesMutation.js';
import {parseFeedbackNote} from './feedbackNotesPagination.js';

const users=[{id:12,usuario:'first',nombre:'Homónimo',activo:true},{id:13,usuario:'second',nombre:'Homónimo',activo:true},
  {id:14,usuario:'old',nombre:'Anterior',activo:false}];
const stamp='2026-10-22T12:00:00.123000Z',key='11111111-1111-4111-8111-111111111111';
const note=feedback=>({id:7,titulo:'Title',contenido:'Body',categoria:'general',feedback,creado_por:'Author',modificado_por:'Author',
  created_at:stamp,updated_at:stamp,eliminado_at:null,resolved_client:'Client',section:'clients'});
const input=feedback=>({action:'create',fields:{titulo:'Title',contenido:'Body',categoria:'general',feedback}});

test('explicit IDs are sorted/cloned and legacy absence stays absent, never resolved from names',()=>{
  const raw={responsables:['Homónimo'],responsable_ids:[13,12]};
  const ids=feedbackResponsibleIds(raw);assert.deepEqual(ids,[12,13]);ids.push(14);assert.deepEqual(raw.responsable_ids,[13,12]);
  assert.equal(feedbackResponsibleIds({responsables:['Homónimo']}),null);
  assert.deepEqual(feedbackResponsibleIds({responsable_ids:[]}),[]);
});
for(const value of [null,'12',[0],[-1],['12'],[1.5],[2147483648],[12,12],Array.from({length:21},(_,i)=>i+1)]){
  test(`malformed ID selection fails closed in shared helper, request body and note DTO: ${JSON.stringify(value)}`,()=>{
    assert.throws(()=>normalizeFeedbackResponsibleIds(value));
    assert.throws(()=>feedbackNotesMutationBody(input({responsable_ids:value}),key));
    assert.throws(()=>parseFeedbackNote(note({responsable_ids:value}),false));
  });
}
test('human selection distinguishes homonyms, snapshots labels only after the toggle and never mutates the source',()=>{
  const legacy={responsables:['Homónimo'],responsable:'Homónimo'},before=structuredClone(legacy);
  const selected=toggleFeedbackResponsibleId(legacy,13,users);
  assert.deepEqual(selected.responsable_ids,[13]);assert.deepEqual(selected.responsables,['Homónimo']);assert.deepEqual(legacy,before);
  const both=toggleFeedbackResponsibleId(selected,12,users);assert.deepEqual(both.responsable_ids,[12,13]);
  assert.deepEqual(toggleFeedbackResponsibleId(both,13,users).responsable_ids,[12]);
});
test('inactive/unavailable IDs remain visible/removable, but cannot be added by name or ID',()=>{
  const current={responsable_ids:[14,15],responsables:['Old labels']};
  assert.deepEqual(feedbackResponsibleDisplay(current,users),['Anterior · old · #14 (inactivo)','Usuario #15 (no disponible)']);
  assert.deepEqual(toggleFeedbackResponsibleId(current,15,users).responsable_ids,[14]);
  assert.deepEqual(toggleFeedbackResponsibleId(current,14,[]).responsable_ids,[15]);
  for(const id of [14,15,'12'])assert.throws(()=>toggleFeedbackResponsibleId({responsable_ids:[]},id,users));
});
test('identity display follows renamed catalog rows, never matches another person using an old label',()=>{
  const renamed=[{...users[0],nombre:'Renamed'},{...users[1],nombre:'Homónimo'}];
  assert.deepEqual(feedbackResponsibleDisplay({responsable_ids:[12],responsables:['Homónimo']},renamed),['Renamed · first · #12']);
  assert.deepEqual(feedbackResponsibleDisplay({responsables:['Homónimo']},renamed),['Homónimo']);
});
test('catalog validates identity uniqueness/active flags and projects only presentation fields',()=>{
  const raw=users.map(user=>({...user,private:'not retained'})),catalog=feedbackResponsibleCatalog(raw);
  assert.deepEqual(catalog,users);assert.notEqual(catalog[0],raw[0]);
  for(const value of [null,[users[0],users[0]],[{...users[0],id:'12'}],[{...users[0],activo:undefined}],[{...users[0],usuario:''}]])assert.throws(()=>feedbackResponsibleCatalog(value));
});
test('body and DTO allow optional IDs but preserve the absent/empty distinction and clone arrays',()=>{
  for(const source of [{responsables:['Legacy']},{responsable_ids:[]},{responsable_ids:[13,12],responsables:['Snapshots']}]){
    const body=feedbackNotesMutationBody(input(source),key),dto=parseFeedbackNote(note(source),false);
    assert.equal(Object.hasOwn(body.fields.feedback,'responsable_ids'),Object.hasOwn(source,'responsable_ids'));
    assert.equal(Object.hasOwn(dto.feedback,'responsable_ids'),Object.hasOwn(source,'responsable_ids'));
    if(source.responsable_ids){assert.deepEqual(body.fields.feedback.responsable_ids,[...source.responsable_ids].sort((a,b)=>a-b));
      assert.notEqual(body.fields.feedback.responsable_ids,source.responsable_ids);assert.notEqual(dto.feedback.responsable_ids,source.responsable_ids);}
  }
});
test('held preflight and uncertain verification retain exactly the original UUID, IDs and labels',async()=>{
  let resolve;const held=new Promise(yes=>{resolve=yes;}),calls=[];let count=0;
  const scope={current:()=>true,assertCurrent(){},async request(url,options){calls.push({url,options});
    if(url.includes('/similares'))return held;if(++count===1)throw Error('lost ACK');throw Object.assign(Error('still unavailable'),{status:503});}};
  const model=createFeedbackNotesMutation({capture:()=>scope,randomUUID:()=>key,refresh:()=>assert.fail('no accepted ACK')});
  const feedback={cliente:'Client',flujo:'feedback',responsable_ids:[13],responsables:['Homónimo']};
  const pending=model.start(input(feedback),{checkDuplicates:true});
  feedback.responsable_ids[0]=12;feedback.responsables[0]='Changed';resolve({similares:[]});await assert.rejects(pending);
  assert.equal(model.snapshot.phase,'uncertain');await assert.rejects(model.verify());
  const writes=calls.filter(call=>call.options?.method==='POST');assert.equal(writes.length,2);assert.equal(writes[0].options.body,writes[1].options.body);
  const sent=JSON.parse(writes[0].options.body);assert.equal(sent.request_id,key);assert.deepEqual(sent.fields.feedback.responsable_ids,[13]);assert.deepEqual(sent.fields.feedback.responsables,['Homónimo']);
});
