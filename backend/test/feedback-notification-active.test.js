import test from 'node:test';
import assert from 'node:assert/strict';
import {encolarNotificacionPrivadaFeedback,crearMensajePrivadoFeedback} from '../src/private-feedback-notifications.js';
import {feedbackFingerprint} from '../src/feedback-workflow.js';

const activeQuery='SELECT id, usuario, nombre FROM usuarios WHERE activo IS TRUE';
const note={id:255,titulo:'QA255 feedback sintético',updated_at:'2026-10-24T12:00:00Z',
  feedback:{cliente:'QA255 cliente',estado:'pendiente',responsables:['QA Recipient']}};
function fixture(catalog){
  const queries=[],inserts=[],seen=new Set();
  const pool={async query(sql,params=[]){
    queries.push({sql,params});
    if(/^SELECT (?:id, )?usuario, nombre FROM usuarios/.test(sql)){
      // Query-contract adapter only, not a physical PostgreSQL filtering test.
      // The unfixed query deliberately exposes the inactive row to the caller.
      return{rows:catalog.filter(row=>sql===activeQuery?row.activo===true:true)
        .map(({id,usuario,nombre})=>({id,usuario,nombre}))};
    }
    assert.match(sql,/INSERT INTO mia_private_task_notifications/);
    assert.match(sql,/ON CONFLICT\(fingerprint\) DO NOTHING/);
    inserts.push(params);
    if(seen.has(params[0]))return{rows:[]};
    seen.add(params[0]);return{rows:[{id:seen.size,fingerprint:params[0]}]};
  }};
  return{queries,inserts,pool,invoke:(options={})=>encolarNotificacionPrivadaFeedback({pool,nota:note,actor:'QA Author',
    env:{APP_URL:'https://example.invalid'},...options})};
}

test('inactive feedback responsible cannot enqueue and the lookup requires activo IS TRUE',async()=>{
  const f=fixture([{id:12,usuario:'qa_recipient',nombre:'QA Recipient',activo:false}]);
  const result=await f.invoke();
  assert.deepEqual(result,{encolado:false,razon:'responsable_sin_usuario'});
  assert.deepEqual(f.queries,[{sql:activeQuery,params:[]}]);assert.deepEqual(f.inserts,[]);
});
test('active feedback responsible retains message/author and dedupes labels with the identity-v1 fingerprint',async()=>{
  const f=fixture([
    {id:7,usuario:'qa_author',nombre:'QA Author',activo:true},
    {id:12,usuario:'qa_recipient',nombre:'QA Recipient',activo:true},
    {id:13,usuario:'qa_inactive',nombre:'Inactive Other',activo:false},
  ]);
  const input={...note,feedback:{...note.feedback,responsables:['QA Author','QA Recipient','QA RECIPIENT','Inactive Other']}};
  const before=structuredClone(input),first=await f.invoke({nota:input});
  assert.equal(first.encolado,true);assert.equal(first.duplicadas,0);assert.equal(first.entregas.length,1);
  assert.equal(f.queries[0].sql,activeQuery);assert.equal(f.inserts.length,1);
  const fingerprint=feedbackFingerprint(['feedback-recipient-id-v1',note.id,12,note.updated_at]);
  const message=crearMensajePrivadoFeedback({nota:input,appUrl:'https://example.invalid'});
  assert.deepEqual(f.inserts[0],[fingerprint,'QA Recipient','qa_recipient',note.id,message.text,message.url,
    JSON.stringify({cliente:'QA255 cliente',actor:'QA Author',destinatario_usuario_id:12})]);
  assert.equal(Object.hasOwn(JSON.parse(f.inserts[0][6]),'actor_usuario_id'),false);
  assert.deepEqual(input,before);
  const repeated=await f.invoke({nota:input});
  assert.equal(repeated.encolado,false);assert.equal(repeated.duplicadas,1);assert.deepEqual(repeated.entregas,[]);
  assert.equal(f.inserts.length,2);assert.deepEqual(f.inserts[1],f.inserts[0],'Existing retry fingerprint/payload remains unchanged');
});
test('an active author selected as the only responsible remains excluded by legacy name normalization',async()=>{
  const f=fixture([{id:7,usuario:'qa_author',nombre:'QA Author',activo:true}]);
  const result=await f.invoke({nota:{...note,feedback:{...note.feedback,responsables:['QA AUTHOR','qa_author']}},actor:'QA Author'});
  assert.deepEqual(result,{encolado:false,razon:'responsable_sin_usuario'});
  assert.deepEqual(f.queries,[{sql:activeQuery,params:[]}]);assert.deepEqual(f.inserts,[]);
});
