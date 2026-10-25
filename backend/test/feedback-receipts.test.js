import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalFeedbackIntent, feedbackVersionIso, feedbackIdempotencyKey, feedbackIntentHash,
  feedbackConfirmationHash, lockFeedbackActor, findFeedbackReceipt, feedbackReplayResponse,
  insertFeedbackReceipt } from '../src/feedback-receipts.js';
import { createWilsonRouter, consumeFeedbackConfirmation } from '../src/wilson-integration.js';

const version='2026-10-20T12:00:00.123Z';
const token='11111111-1111-4111-8111-111111111111';
const create={seccion:'equipo',titulo:'Tema real',contenido:'Detalle real',responsables:['Destinatario'],permitir_duplicado:true,idempotency_key:'receipt-key'};
const edit={contenido:'Detalle actualizado',expected_updated_at:version,idempotency_key:'edit-key',permitir_duplicado:true};
const intent=(body=create,patch=false)=>canonicalFeedbackIntent(body,{operation:patch?'editar_feedback':'crear_feedback',targetId:patch?8:null});

test('feedback token consumption uses wall clock after lock waits, never transaction-start NOW()',()=>{
  const source=consumeFeedbackConfirmation.toString();
  assert.match(source,/used_at\s*=\s*clock_timestamp\(\)/i);
  assert.match(source,/expires_at\s*>\s*clock_timestamp\(\)/i);
  assert.doesNotMatch(source,/\bNOW\s*\(/i);
});

test('feedback token row is locked with exact scope before expiry is checked in a separate statement',async()=>{
  const calls=[];
  let expired=false;
  const db={async query(sql,params) {
    calls.push({sql,params});
    if(calls.length===1) {
      assert.match(sql,/SELECT token FROM integracion_confirmaciones/);
      assert.match(sql,/FOR UPDATE/);
      assert.doesNotMatch(sql,/expires_at|clock_timestamp|used_at/);
      // Simulate expiration during a wait on an unchanged token row.
      expired=true;return{rows:[{token}]};
    }
    assert.equal(expired,true);assert.match(sql,/expires_at>clock_timestamp\(\)/);
    return{rows:[]};
  }};
  const req={body:{confirmacion_token:token},wilson:{userId:7,channel:'telegram',actorId:'actor',groupId:'group'}};
  await assert.rejects(consumeFeedbackConfirmation(db,req,intent(),'key'),e=>e.status===409);
  assert.equal(calls.length,2);assert.deepEqual(calls[0].params,calls[1].params);
  assert.deepEqual(calls[0].params,[token,'telegram','actor','group','crear_feedback',null,
    feedbackConfirmationHash({intent:intent(),userId:7,key:'key'})]);
});

test('feedback mismatched token scope never proceeds to consumption UPDATE',async()=>{
  const calls=[];const db={async query(sql){calls.push(sql);return{rows:[]};}};
  await assert.rejects(consumeFeedbackConfirmation(db,{body:{confirmacion_token:token},wilson:{userId:7,channel:'whatsapp',actorId:'actor'}},intent(),'key'),e=>e.status===409);
  assert.equal(calls.length,1);assert.match(calls[0],/FOR UPDATE/);
});

test('pure canonical intent is stable across key order, aliases, trimming and transport secrets',()=>{
  const a=intent();
  const b=intent({tipo:'reunión',titulo:' Tema real ',detalle:' Detalle real ',responsable:'Destinatario',permitir_duplicado:true,
    confirmado:true,confirmacion_token:token,idempotency_key:'different-transport-key'});
  assert.deepEqual(a,b);assert.equal(feedbackIntentHash(a),feedbackIntentHash(b));
  assert.equal(feedbackIntentHash(a).length,64);
  assert.deepEqual(intent({...create,referencia:'x',feedback:{referencia:' x '}}),intent({...create,referencia:'x'}));
  assert.throws(()=>intent({...create,referencia:'x',feedback:{referencia:'y'}}),e=>e.status===400);
  assert.throws(()=>intent({...create,detalle:'conflicting detail'}),e=>e.status===400);
  assert.throws(()=>intent({...create,responsable:'Another person'}),e=>e.status===400);
});

test('PATCH intent preserves omission versus explicit empty string/list and binds target, version and duplicate choice',()=>{
  const a=intent(edit,true);
  assert.deepEqual(a.business,{contenido:'Detalle actualizado'});
  const b=intent({...edit,referencia:'',responsables:[]},true);
  assert.deepEqual(b.business,{contenido:'Detalle actualizado',referencia:'',responsables:[]});
  assert.notEqual(feedbackIntentHash(a),feedbackIntentHash(b));
  assert.notEqual(feedbackIntentHash(a),feedbackIntentHash(canonicalFeedbackIntent(edit,{operation:'editar_feedback',targetId:9})));
  assert.notEqual(feedbackIntentHash(a),feedbackIntentHash(intent({...edit,permitir_duplicado:false},true)));
  assert.notEqual(feedbackIntentHash(a),feedbackIntentHash(intent({...edit,expected_updated_at:'2026-10-20T12:00:00.124Z'},true)));
  assert.throws(()=>intent({expected_updated_at:version},true),e=>e.status===400);
});

test('reserved/unknown fields and malformed values never enter canonical mutation intent',()=>{
  for(const field of ['origen','confirmado_por','confirmado_por_id','confirmado_at','provenance_version','wilson_idempotency_key']) {
    for(const payload of [{...create,[field]:null},{...create,feedback:{[field]:'forged'}}])assert.throws(()=>intent(payload),e=>e.status===400);
  }
  for(const patch of [{importe:50},{titulo:[]},{contenido:null},{responsables:'Destinatario'},{cliente_id:'1'},
    {estado:'invalid'},{vigencia:'invalid'},{permitir_duplicado:'true'},{feedback:{unknown:true}},{contenido:'NUL\u0000text'}])assert.throws(()=>intent({...create,...patch}),e=>e.status===400);
});

test('client selectors reject competing identities; empty redundant client name is canonicalized away',()=>{
  assert.throws(()=>intent({...create,seccion:'cliente',cliente_id:1,cliente:'Wrong client'}),e=>e.status===400);
  const a=intent({...create,seccion:'cliente',cliente_id:1,cliente:''});
  assert.deepEqual(a,intent({...create,seccion:'cliente',cliente_id:1}));
  assert.throws(()=>intent({...create,cliente_id:1}),e=>e.status===400);
});

test('keys are bounded strings, reject every control character and conflicting header/body without truncation',()=>{
  assert.equal(feedbackIdempotencyKey({'idempotency-key':'  abc  '},{idempotency_key:'abc'}),'abc');
  assert.equal(feedbackIdempotencyKey({}, {idempotency_key:'x'.repeat(200)}).length,200);
  for(const key of [undefined,null,{},[],1,'','  ','x'.repeat(201),'a\u0000b','a\nb','a\tb','a\u007fb','a\u0085b']) {
    assert.throws(()=>feedbackIdempotencyKey({}, {idempotency_key:key}),e=>e.status===400);
  }
  assert.throws(()=>feedbackIdempotencyKey({'idempotency-key':'a'},{idempotency_key:'b'}),e=>e.status===400);
  assert.throws(()=>feedbackIdempotencyKey({'idempotency-key':['a']},{}),e=>e.status===400);
});

test('edit versions require a real ISO calendar/time with timezone and normalize milliseconds',()=>{
  assert.equal(feedbackVersionIso('2026-10-20T09:00:00.123456-03:00'),version);
  assert.equal(feedbackVersionIso(version),version);
  for(const value of ['2026-02-30T12:00:00Z','2026-10-20','2026-10-20T12:00:00','2026-10-20T24:00:00Z',{},0,'October 20 2026'])assert.throws(()=>feedbackVersionIso(value),e=>e.status===400);
});

test('feedback confirmation hash binds stable user, operation, target, intent and key',()=>{
  const a=feedbackConfirmationHash({intent:intent(),userId:7,key:'a'});
  assert.notEqual(a,feedbackConfirmationHash({intent:intent(),userId:8,key:'a'}));
  assert.notEqual(a,feedbackConfirmationHash({intent:intent(),userId:7,key:'b'}));
  assert.notEqual(a,feedbackConfirmationHash({intent:intent(edit,true),userId:7,key:'a'}));
  assert.throws(()=>feedbackConfirmationHash({intent:intent(),userId:'7',key:'a'}),e=>e.status===403);
});

function fixture(options={}) {
  const actorId='fictional-actor',actorHash=crypto.createHash('sha256').update(actorId).digest('hex');
  let user={id:7,usuario:'actor',nombre:'Current verified actor',rol:'diseno',activo:true,whatsapp_id_hash:actorHash,whatsapp_habilitado:true,...options.user};
  let note={id:8,titulo:'Tema real',contenido:'Original',categoria:'reunion',feedback:{cliente:'',responsables:['Destinatario'],responsable:'Destinatario',vigencia:'puntual',estado:'pendiente',referencia:'',flujo:'feedback'},creado_por:'Other author',modificado_por:'Other author',updated_at:version,created_at:version,eliminado_at:null};
  let receipts=[],confirmation=null,audits=0,notifications=0;let snapshot;
  const calls=[];
  const db={release(){},async query(sql,params=[]) {
    calls.push({sql,params});
    if(sql==='BEGIN'){snapshot=structuredClone({note,receipts,confirmation,audits,notifications});return{rows:[]};}
    if(sql==='COMMIT')return{rows:[]};
    if(sql==='ROLLBACK'){({note,receipts,confirmation,audits,notifications}=snapshot);return{rows:[]};}
    if(sql.startsWith('SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash'))return{rows:options.missingActor?[]:[user]};
    if(sql.startsWith('SELECT actor_hash,usuario_id,enabled'))return{rows:options.mapping?[options.mapping]:[]};
    if(sql.startsWith('SELECT u.id FROM usuarios'))return{rows:options.ambiguous?[{id:7},{id:9}]:[{id:7}]};
    if(sql.includes('pg_advisory_xact_lock'))return{rows:[]};
    if(sql.includes('FROM feedback_operation_receipts WHERE'))return{rows:receipts.filter(row=>row.actor_user_id===params[0]&&row.operation===params[1]&&row.idempotency_key===params[2])};
    if(sql==='SELECT id,nombre FROM clientes WHERE activo IS TRUE ORDER BY nombre')return{rows:[{id:1,nombre:'Current Client'}]};
    if(sql==='SELECT id,usuario,nombre,rol FROM usuarios WHERE activo IS TRUE ORDER BY nombre')return{rows:[{id:7,usuario:'actor',nombre:user.nombre,rol:user.rol},{id:9,usuario:'recipient',nombre:'Destinatario',rol:'edicion'}]};
    if(sql.startsWith('SELECT id,titulo,contenido,feedback,updated_at FROM notas_compartidas'))return{rows:[]};
    if(sql.includes('date_trunc(\'milliseconds\',updated_at)')) {
      assert.deepEqual(params,[8,version]);return{rows:options.missingNote?[]:[{...note,version_matches:!options.stale}]};
    }
    if(sql.startsWith('INSERT INTO integracion_confirmaciones')){confirmation={token:params[0],channel:params[1],actor:params[2],group:params[3],operation:params[4],target:params[5],hash:params[6],used:false};return{rows:[]};}
    if(sql.startsWith('SELECT token FROM integracion_confirmaciones')) {
      const valid=confirmation&&confirmation.token===params[0]&&confirmation.channel===params[1]&&confirmation.actor===params[2]&&confirmation.group===params[3]&&confirmation.operation===params[4]&&confirmation.target===params[5]&&confirmation.hash===params[6];
      return{rows:valid?[{token:params[0]}]:[]};
    }
    if(sql.startsWith('UPDATE integracion_confirmaciones')) {
      const valid=confirmation&&!confirmation.used&&confirmation.token===params[0]&&confirmation.channel===params[1]&&confirmation.actor===params[2]&&confirmation.group===params[3]&&confirmation.operation===params[4]&&confirmation.target===params[5]&&confirmation.hash===params[6];
      if(valid){confirmation.used=true;return{rows:[{token:params[0]}]};}return{rows:[]};
    }
    if(sql.startsWith('INSERT INTO notas_compartidas')){note={...note,titulo:params[0],contenido:params[1],categoria:params[2],creado_por:params[3],modificado_por:params[3],feedback:JSON.parse(params[4])};return{rows:[note]};}
    if(sql.startsWith('UPDATE notas_compartidas SET titulo=')){note={...note,titulo:params[0],contenido:params[1],categoria:params[2],feedback:JSON.parse(params[3]),modificado_por:params[4]};return{rows:[note]};}
    if(sql.startsWith('INSERT INTO integracion_auditoria')){audits++;return{rows:[]};}
    if(sql==='SELECT usuario, nombre FROM usuarios WHERE activo IS TRUE')return{rows:[{usuario:'recipient',nombre:'Destinatario'}]};
    if(sql.includes('INSERT INTO mia_private_task_notifications')){notifications++;if(options.failQueue)throw Error('Injected outbox failure');return{rows:[{id:1,fingerprint:'one-notification'}]};}
    if(sql.startsWith('INSERT INTO feedback_operation_receipts')) {
      const receipt={actor_user_id:params[0],operation:params[1],idempotency_key:params[2],payload_hash:params[3],note_id:params[4],note_updated_at:params[5],committed_at:version};receipts.push(receipt);
      return{rows:[{operation:receipt.operation,note_id:receipt.note_id,note_updated_at:receipt.note_updated_at,committed_at:receipt.committed_at}]};
    }
    if(sql.includes('FROM notas_compartidas WHERE id=$1'))return{rows:note?[note]:[]};
    throw Error('Unexpected mock query: '+sql);
  }};
  const pool={query:db.query.bind(db),connect:async()=>db};
  const router=createWilsonRouter({pool,env:{NODE_ENV:'test',WILSON_TELEGRAM_USER_BINDINGS:JSON.stringify({[actorId]:7})}});
  return {db,calls,get note(){return note;},set note(value){note=value;},get user(){return user;},get receipts(){return receipts;},get audits(){return audits;},get notifications(){return notifications;},get confirmation(){return confirmation;},
    async run(method,path,body,settings={}) {
      const req={body,headers:settings.headers??{},params:{id:'8'},wilson:{userId:7,actorRole:'diseno',actorId,actorName:'Untrusted label',confirmedBy:'Untrusted label',channel:'whatsapp',groupId:'',...settings.wilson}};
      const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
      const handler=router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route.stack[0].handle;
      await handler(req,res,error=>{throw error;});return res;
    },
    async confirm(payload=create,patch=false,settings={}) {
      return this.run('post','/confirmaciones',{operacion:patch?'editar_feedback':'crear_feedback',...(patch?{tarea_id:8}:{}),payload},settings);
    }};
}

test('current human mapping/role revalidation rejects inactive, unknown, automatic, ambiguous and remapped actors',async()=>{
  for(const options of [{user:{activo:false}},{user:{rol:'owner-impostor'}},{ambiguous:true},{missingActor:true},{user:{whatsapp_id_hash:'wrong'}}]) {
    const f=fixture(options);await assert.rejects(lockFeedbackActor(f.db,{userId:7,actorId:'fictional-actor',channel:'whatsapp'}),e=>e.status===403);
  }
  for(const wilson of [{userId:7,systemActor:true,channel:'telegram',actorId:'a'},{userId:'7',channel:'telegram',actorId:'a'}])await assert.rejects(lockFeedbackActor(fixture().db,wilson,{telegramUserId:7}),e=>e.status===403);
  await assert.rejects(lockFeedbackActor(fixture().db,{userId:7,actorId:'a',channel:'telegram'},{telegramUserId:8}),e=>e.status===403);
});

test('receipt lock/lookup scope includes stable user, operation and key; changed hash conflicts',async()=>{
  const f=fixture();assert.equal(await findFeedbackReceipt(f.db,{userId:7,operation:'crear_feedback',key:'a',payloadHash:'a'.repeat(64)}),null);
  assert.deepEqual(f.calls[0].params,[JSON.stringify(['feedback-receipt-v1',7,'crear_feedback','a'])]);
  assert.deepEqual(f.calls[1].params,[7,'crear_feedback','a']);
  await insertFeedbackReceipt(f.db,{userId:7,operation:'crear_feedback',key:'a',payloadHash:'a'.repeat(64),note:f.note});
  await assert.rejects(findFeedbackReceipt(f.db,{userId:7,operation:'crear_feedback',key:'a',payloadHash:'b'.repeat(64)}),e=>e.status===409);
  assert.equal(await findFeedbackReceipt(f.db,{userId:8,operation:'crear_feedback',key:'a',payloadHash:'b'.repeat(64)}),null);
  assert.equal(await findFeedbackReceipt(f.db,{userId:7,operation:'editar_feedback',key:'a',payloadHash:'b'.repeat(64)}),null);
});

test('both channels issue exact feedback tokens and atomically create one note/audit/outbox/receipt; replay is current DTO',async()=>{
  for(const channel of ['whatsapp','telegram']) {
    const f=fixture(),settings={wilson:{channel}};
    const issued=await f.confirm(create,false,settings);assert.equal(issued.statusCode,201);assert.equal(f.confirmation.channel,channel);
    const saved=await f.run('post','/feedback',{...create,confirmacion_token:issued.body.confirmacion_token},settings);
    assert.equal(saved.statusCode,201);assert.equal(saved.body.feedback.feedback.confirmado_por_id,7);assert.equal(saved.body.feedback.feedback.confirmado_por,'Current verified actor');
    assert.equal(saved.body.feedback.feedback.origen,channel==='whatsapp'?'mia_whatsapp':'wilson_telegram');
    assert.equal(f.audits,1);assert.equal(f.notifications,1);assert.equal(f.receipts.length,1);assert.equal(f.confirmation.used,true);
    assert.ok(!Object.hasOwn(f.note.feedback,'wilson_idempotency_key'));
    f.note.contenido='Later browser edit';const before=f.calls.length;
    const replay=await f.run('post','/feedback',create,settings);assert.equal(replay.statusCode,200);assert.equal(replay.body.idempotent,true);assert.equal(replay.body.result_current,true);
    assert.equal(replay.body.feedback.contenido,'Later browser edit');assert.deepEqual(Object.keys(replay.body.receipt).sort(),['operation','note_id','note_updated_at','committed_at'].sort());
    assert.equal(f.audits,1);assert.equal(f.notifications,1);assert.equal(f.receipts.length,1);
    assert.ok(!f.calls.slice(before).some(call=>call.sql.includes('FROM clientes')||call.sql.startsWith('UPDATE integracion_confirmaciones')));
  }
});

test('PATCH receipt replay precedes stale target/version/catalog checks and preserves omitted content',async()=>{
  const f=fixture();const issued=await f.confirm(edit,true);assert.equal(issued.statusCode,201);
  const updated=await f.run('patch','/feedback/:id',{...edit,confirmacion_token:issued.body.confirmacion_token});
  assert.equal(updated.statusCode,200);assert.equal(updated.body.updated,true);assert.equal(f.note.titulo,'Tema real');assert.equal(f.note.contenido,'Detalle actualizado');assert.equal(f.notifications,0);
  f.note=null;const replay=await f.run('patch','/feedback/:id',edit);assert.equal(replay.statusCode,200);assert.equal(replay.body.deleted,true);assert.equal(replay.body.feedback,null);assert.equal(replay.body.updated,false);
});

test('archived replay returns tombstone without archived contents, receipt contains no snapshots/secrets/keys',async()=>{
  const f=fixture();f.note.eliminado_at=version;
  const result=await feedbackReplayResponse(f.db,{operation:'crear_feedback',note_id:8,note_updated_at:version,committed_at:version,payload_hash:'secret-hash',idempotency_key:'secret-key'});
  assert.equal(result.archived,true);assert.equal(result.feedback,null);assert.doesNotMatch(JSON.stringify(result),/secret|Tema real|Original|payload_hash|idempotency_key/);
});

test('token/key/intent substitutions and boolean-only legacy confirmation cannot mutate feedback',async()=>{
  const f=fixture();const issued=await f.confirm();
  for(const body of [{...create,confirmado:true},{...create,confirmacion_token:token},
    {...create,contenido:'tampered',confirmacion_token:issued.body.confirmacion_token},
    {...create,idempotency_key:'other-key',confirmacion_token:issued.body.confirmacion_token}]) {
    const result=await f.run('post','/feedback',body);assert.ok([400,409].includes(result.statusCode));assert.equal(f.audits,0);assert.equal(f.notifications,0);assert.equal(f.receipts.length,0);assert.equal(f.confirmation.used,false);
  }
});

test('outbox fault rolls back token/note/audit/receipt and permits retry with same unconsumed token',async()=>{
  const options={failQueue:true},f=fixture(options);const issued=await f.confirm();
  await assert.rejects(f.run('post','/feedback',{...create,confirmacion_token:issued.body.confirmacion_token}),/Injected outbox failure/);
  assert.equal(f.confirmation.used,false);assert.equal(f.note.contenido,'Original');assert.equal(f.audits,0);assert.equal(f.notifications,0);assert.equal(f.receipts.length,0);
  options.failQueue=false;
  assert.equal((await f.run('post','/feedback',{...create,confirmacion_token:issued.body.confirmacion_token})).statusCode,201);
  assert.equal(f.audits,1);assert.equal(f.notifications,1);
});

test('stale PATCH and groupParticipantOnly feedback token/mutations fail before mutation',async()=>{
  const f=fixture({stale:true});assert.equal((await f.confirm(edit,true)).statusCode,409);
  assert.equal((await f.run('patch','/feedback/:id',{...edit,confirmacion_token:token})).statusCode,409);assert.equal(f.audits,0);
  const g=fixture(),settings={wilson:{groupParticipantOnly:true,groupId:'group'}};
  for(const result of [await g.confirm(create,false,settings),await g.run('post','/feedback',create,settings),await g.run('patch','/feedback/:id',edit,settings)])assert.equal(result.statusCode,403);
  assert.equal(g.calls.length,0);
});

test('replay still rejects current role/mapping loss before looking up committed receipt',async()=>{
  const f=fixture();const issued=await f.confirm();await f.run('post','/feedback',{...create,confirmacion_token:issued.body.confirmacion_token});
  f.user.activo=false;const start=f.calls.length;assert.equal((await f.run('post','/feedback',create)).statusCode,403);
  assert.ok(!f.calls.slice(start).some(call=>call.sql.includes('FROM feedback_operation_receipts')));
});
