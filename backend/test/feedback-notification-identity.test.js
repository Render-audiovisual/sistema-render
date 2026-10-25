import test from 'node:test';
import assert from 'node:assert/strict';
import {encolarNotificacionPrivadaFeedback} from '../src/private-feedback-notifications.js';
import {feedbackFingerprint} from '../src/feedback-workflow.js';

const note={id:256,titulo:'QA256 shared note',updated_at:'2026-10-24T12:00:00Z',feedback:{cliente:'Client',responsables:['Recipient']}};
function fixture(catalog){
  const queries=[],inserts=[];
  const pool={async query(sql,params=[]){
    queries.push({sql,params});
    if(/\bFROM usuarios\b/.test(sql))return{rows:catalog.map(row=>({...row}))};
    assert.match(sql,/INSERT INTO mia_private_task_notifications/);inserts.push(params);
    return{rows:[{id:inserts.length,fingerprint:params[0]}]};
  }};
  return{queries,inserts,invoke:(options={})=>encolarNotificacionPrivadaFeedback({pool,nota:note,actor:'Author',env:{APP_URL:'https://example.invalid'},...options})};
}
test('new Feedback notice binds unique active recipient ID, actor ID and versioned fingerprint without rewriting its text',async()=>{
  const f=fixture([{id:12,usuario:'recipient_login',nombre:'Recipient'}]);
  const result=await f.invoke({actorId:7});assert.equal(result.encolado,true);assert.equal(f.inserts.length,1);
  assert.match(f.queries[0].sql,/SELECT\s+id\s*,\s*usuario\s*,\s*nombre\s+FROM usuarios WHERE activo IS TRUE/);
  const args=f.inserts[0];assert.equal(args[0],feedbackFingerprint(['feedback-recipient-id-v1',note.id,12,note.updated_at]));
  assert.equal(args[1],'Recipient');assert.equal(args[2],'recipient_login');assert.equal(args[3],note.id);
  assert.deepEqual(JSON.parse(args[6]),{cliente:'Client',actor:'Author',destinatario_usuario_id:12,actor_usuario_id:7});
});
for(const catalog of [
  [{id:12,usuario:'one',nombre:'Recipient'},{id:13,usuario:'two',nombre:'Recipient'}],
  [{id:12,usuario:'recipient',nombre:'One'},{id:13,usuario:'two',nombre:'Recipient'}],
  [{id:12,usuario:'one',nombre:'Récipient'},{id:13,usuario:'two',nombre:'Recipient'}],
])test(`ambiguous label resolves to no arbitrary first recipient: ${catalog.map(row=>row.usuario).join('/')}`,async()=>{
  for(const rows of [catalog,[...catalog].reverse()]){
    const f=fixture(rows),result=await f.invoke({actorId:7});assert.equal(result.encolado,false);assert.deepEqual(f.inserts,[]);
  }
});
test('unknown and ambiguous labels do not suppress a separate uniquely resolved responsible',async()=>{
  const f=fixture([{id:12,usuario:'one',nombre:'Recipient'},{id:13,usuario:'two',nombre:'Recipient'},
    {id:14,usuario:'unique_login',nombre:'Unique'}]);
  const result=await f.invoke({nota:{...note,feedback:{...note.feedback,responsables:['Unknown','Recipient','Unique']}}});
  assert.equal(result.encolado,true);assert.equal(f.inserts.length,1);assert.equal(f.inserts[0][2],'unique_login');
  assert.deepEqual(JSON.parse(f.inserts[0][6]),{cliente:'Client',actor:'Author',destinatario_usuario_id:14});
});
test('multiple label aliases and duplicate rows matching the same ID enqueue only once',async()=>{
  const recipient={id:12,usuario:'recipient_login',nombre:'Recipient'};
  const f=fixture([recipient,{...recipient}]);
  const result=await f.invoke({nota:{...note,feedback:{...note.feedback,responsables:['Recipient','recipient_login','RECIPIENT']}}});
  assert.equal(result.encolado,true);assert.equal(f.inserts.length,1);
  assert.equal(JSON.parse(f.inserts[0][6]).destinatario_usuario_id,12);
});
test('supplied actor ID preserves a distinct homonym and excludes the renamed actor by ID',async()=>{
  const f=fixture([{id:12,usuario:'other',nombre:'Author'},{id:7,usuario:'renamed_actor',nombre:'New name'}]);
  const result=await f.invoke({actorId:7,nota:{...note,feedback:{...note.feedback,responsables:['Author','New name']}}});
  assert.equal(result.encolado,true);assert.deepEqual(f.inserts.map(args=>args[2]),['other']);
  assert.equal(JSON.parse(f.inserts[0][6]).actor_usuario_id,7);
});
for(const actorId of [0,-1,'7',null,1.5,2147483648])test(`invalid supplied actor ID ${JSON.stringify(actorId)} denies before DB`,async()=>{
  const f=fixture([]);await assert.rejects(f.invoke({actorId}),{status:400});assert.deepEqual(f.queries,[]);assert.deepEqual(f.inserts,[]);
});
test('malformed recipient IDs never produce a legacy name fallback',async()=>{
  for(const id of [undefined,null,0,-1,'12',2147483648]){
    const f=fixture([{id,usuario:'recipient_login',nombre:'Recipient'}]);
    const result=await f.invoke({actorId:7});assert.equal(result.encolado,false);assert.deepEqual(f.inserts,[]);
  }
});
test('without actor ID legacy author exclusion remains, while admitted recipients still receive ID metadata',async()=>{
  const f=fixture([{id:7,usuario:'author_login',nombre:'Author'},{id:12,usuario:'recipient_login',nombre:'Recipient'}]);
  const result=await f.invoke({nota:{...note,feedback:{...note.feedback,responsables:['Author','Recipient']}}});
  assert.equal(result.encolado,true);assert.deepEqual(f.inserts.map(args=>args[2]),['recipient_login']);
  const details=JSON.parse(f.inserts[0][6]);assert.equal(details.destinatario_usuario_id,12);assert.equal(Object.hasOwn(details,'actor_usuario_id'),false);
});
