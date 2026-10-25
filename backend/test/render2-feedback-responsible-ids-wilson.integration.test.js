import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {access} from 'node:fs/promises';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {canonicalFeedbackIntent,feedbackIntentHash,feedbackConfirmationHash} from '../src/feedback-receipts.js';

const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`
  :value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

test('signed human Wilson Feedback binds explicit responsible IDs, preserves retired selections and rejects changed intent',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const port=55894,actorId='qa258-human-telegram';
  const f=await startLocalHarness({port,wilson:{publicKey:publicKey.export({type:'spki',format:'pem'}),
    allowedTelegramIds:actorId,telegramUserBindings:JSON.stringify({[actorId]:91001})}});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own Wilson responsible-IDs cleanup ENOENT: ${f.root}; port${port}`);});
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url:`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`,identity});
  await f.query("UPDATE usuarios SET nombre='QA258 Human' WHERE id=91001");
  await f.query("UPDATE usuarios SET nombre='QA258 Shared',whatsapp_habilitado=true WHERE id=ANY($1::int[])",[[91003,91004]]);
  const signed=async(route,body,method='POST')=>{
    const url=new URL(`/api/integraciones/wilson${route}`,f.base),timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID();
    const name='QA258 untrusted transport label';
    const message=['v2',timestamp,nonce,'telegram',actorId,'',name,method,`${url.pathname}${url.search}`,sha(body===undefined?'':canonical(body))].join('\n');
    const response=await fetch(url,{method,signal:AbortSignal.timeout(5000),headers:{
      'x-wilson-signature-version':'2','x-wilson-timestamp':timestamp,'x-wilson-nonce':nonce,
      'x-wilson-channel':'telegram','x-wilson-actor-id':actorId,'x-wilson-actor-name':name,
      'x-wilson-signature':crypto.sign('sha256',Buffer.from(message),privateKey).toString('base64'),
      ...(body===undefined?{}:{'content-type':'application/json'}),
      ...(body?.idempotency_key?{'idempotency-key':body.idempotency_key}:{}),
    },...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  const checked=(response,status=200)=>{assert.equal(response.status,status,'Unexpected signed principal HTTP status');return response.body;};
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const mutable=['usuarios','notas_compartidas','integracion_confirmaciones','integracion_auditoria','feedback_operation_receipts','mia_private_task_notifications'];
  async function hashes(all=false){const result={};for(const table of tables.filter(name=>all||!mutable.includes(name))){
    result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
  }return result;}
  const rows=table=>{assert.ok(mutable.includes(table));return f.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);};
  const state=async()=>Object.fromEntries(await Promise.all(mutable.map(async table=>[table,await rows(table)])));
  const otherBaseline=await hashes();let expected=await state();
  async function invariant(){assert.deepEqual(await hashes(),otherBaseline);assert.deepEqual(await state(),expected);}
  function unchangedExcept(next,allowed){for(const table of mutable.filter(name=>!allowed.includes(name)))assert.deepEqual(next[table],expected[table],`Unexpected mutation of ${table}`);}
  function appended(next,table,predicate){
    const added=next[table].filter(({row})=>predicate(row));assert.equal(added.length,1,`One new ${table} row required`);
    assert.equal(next[table].length,expected[table].length+1);assert.deepEqual(next[table].filter(({row})=>!predicate(row)),expected[table]);return added[0].row;
  }
  async function issue(payload,id=null){
    await invariant();
    const issued=checked(await signed('/confirmaciones',{operacion:id===null?'crear_feedback':'editar_feedback',...(id===null?{}:{tarea_id:id}),payload}),201);
    assert.equal(typeof issued.confirmacion_token,'string');
    const next=await state();unchangedExcept(next,['integracion_confirmaciones']);
    const row=appended(next,'integracion_confirmaciones',row=>row.token===issued.confirmacion_token);
    assert.equal(row.actor_id,actorId);assert.equal(row.canal,'telegram');assert.equal(row.used_at,null);
    const intent=canonicalFeedbackIntent(payload,{operation:id===null?'crear_feedback':'editar_feedback',targetId:id});
    assert.equal(row.payload_hash,feedbackConfirmationHash({intent,userId:91001,key:payload.idempotency_key}));
    expected=next;await invariant();return issued.confirmacion_token;
  }
  const mutate=(payload,token,id=null)=>signed(id===null?'/feedback':`/feedback/${id}`,{...payload,...(token===undefined?{}:{confirmacion_token:token})},id===null?'POST':'PATCH');
  function closedFeedback(body){
    assert.ok(body.feedback&&Number.isSafeInteger(body.feedback.id));
    assert.equal(body.feedback.feedback.confirmado_por_id,91001);assert.equal(body.feedback.feedback.confirmado_por,'QA258 Human');
    assert.equal(body.feedback.feedback.origen,'wilson_telegram');assert.equal(body.feedback.feedback.provenance_version,1);
    assert.equal(Object.hasOwn(body.feedback.feedback,'wilson_idempotency_key'),false);
    assert.deepEqual(Object.keys(body.receipt).sort(),['committed_at','note_id','note_updated_at','operation']);
  }
  async function accept(payload,token,id=null){
    await invariant();const body=checked(await mutate(payload,token,id),id===null?201:200);closedFeedback(body);
    const noteId=body.feedback.id,next=await state();
    unchangedExcept(next,['notas_compartidas','integracion_confirmaciones','integracion_auditoria','feedback_operation_receipts',...(id===null?['mia_private_task_notifications']:[])]);
    const priorToken=expected.integracion_confirmaciones.find(({row})=>row.token===token).row;
    const currentToken=next.integracion_confirmaciones.find(({row})=>row.token===token).row;
    assert.ok(currentToken.used_at);assert.deepEqual({...currentToken,used_at:null},priorToken);
    assert.deepEqual(next.integracion_confirmaciones.filter(({row})=>row.token!==token),expected.integracion_confirmaciones.filter(({row})=>row.token!==token));
    const receipt=appended(next,'feedback_operation_receipts',row=>row.idempotency_key===payload.idempotency_key);
    assert.equal(receipt.actor_user_id,91001);assert.equal(Number(receipt.note_id),noteId);
    const operation=id===null?'crear_feedback':'editar_feedback';assert.equal(receipt.operation,operation);
    assert.equal(receipt.payload_hash,feedbackIntentHash(canonicalFeedbackIntent(payload,{operation,targetId:id})));
    const audit=appended(next,'integracion_auditoria',row=>Number(row.detalles.feedback_id)===noteId&&row.accion===operation&&
      !expected.integracion_auditoria.some(({row:old})=>old.id===row.id));
    assert.equal(audit.actor_id,actorId);assert.equal(audit.actor_nombre,'QA258 Human');assert.equal(audit.canal,'telegram');
    const stored=next.notas_compartidas.find(({row})=>Number(row.id)===noteId).row;
    assert.deepEqual(stored.feedback,body.feedback.feedback);assert.equal(stored.contenido,body.feedback.contenido);
    if(id===null){
      appended(next,'notas_compartidas',row=>Number(row.id)===noteId);
      const added=next.mia_private_task_notifications.filter(({row})=>Number(row.feedback_id)===noteId);
      const ids=body.feedback.feedback.responsable_ids;
      assert.equal(next.mia_private_task_notifications.length,expected.mia_private_task_notifications.length+ids.length);
      assert.deepEqual(next.mia_private_task_notifications.filter(({row})=>Number(row.feedback_id)!==noteId),expected.mia_private_task_notifications);
      assert.deepEqual(added.map(({row})=>row.detalles.destinatario_usuario_id).sort((a,b)=>a-b),ids);
      for(const {row}of added){assert.equal(row.detalles.actor_usuario_id,91001);assert.equal(row.detalles.actor,'QA258 Human');
        assert.equal(row.estado,'pending');assert.equal(row.motivo,'feedback');assert.equal(row.tarea_id,null);
        assert.equal(row.destinatario_clave,row.detalles.destinatario_usuario_id===91003?'qa_luciano':'qa_designer');}
    }else{
      assert.deepEqual(next.notas_compartidas.filter(({row})=>Number(row.id)!==noteId),expected.notas_compartidas.filter(({row})=>Number(row.id)!==noteId));
      const before=expected.notas_compartidas.find(({row})=>Number(row.id)===noteId).row;
      const omit=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['contenido','feedback','modificado_por','updated_at'].includes(key)));
      assert.deepEqual(omit(stored),omit(before));
      assert.equal(Date.parse(stored.updated_at)>Date.parse(before.updated_at),true);
    }
    expected=next;await invariant();return body;
  }
  const createPayload=(title,ids)=>({seccion:'equipo',titulo:title,contenido:'QA258 signed human content',responsable_ids:ids,
    responsables:['Forged client label'],vigencia:'puntual',estado:'pendiente',permitir_duplicado:true,idempotency_key:crypto.randomUUID()});
  let first,both;
  await t.test('human confirmation binds exact IDs; chosen active homonym alone receives; exact replay is read-only and changed IDs409',async()=>{
    const payload=createPayload('QA258 single chosen homonym',[91003]);
    const withoutToken=await hashes(true),unconfirmed=await mutate(payload);
    assert.ok([400,403].includes(unconfirmed.status),'A human signature alone cannot replace confirmation');
    assert.deepEqual(await hashes(true),withoutToken);await invariant();
    const token=await issue(payload);
    const before=await hashes(true);
    const substituted=await mutate({...payload,responsable_ids:[91004]},token);assert.equal(substituted.status,409);
    assert.deepEqual(await hashes(true),before);await invariant();
    const saved=await accept(payload,token);first=saved.feedback;
    assert.deepEqual(first.feedback.responsable_ids,[91003]);assert.deepEqual(first.feedback.responsables,['QA258 Shared']);
    const after=await hashes(true),replay=checked(await mutate(payload));
    assert.equal(replay.idempotent,true);assert.equal(replay.created,false);assert.equal(replay.feedback.id,first.id);
    assert.deepEqual(replay.feedback.feedback,first.feedback);assert.deepEqual(await hashes(true),after);
    assert.equal((await mutate({...payload,responsable_ids:[91004]})).status,409);assert.deepEqual(await hashes(true),after);await invariant();
  });
  await t.test('explicit two-ID homonyms retain duplicate canonical labels and each gets exactly one notice',async()=>{
    const payload=createPayload('QA258 both chosen homonyms',[91004,91003]),token=await issue(payload);
    const saved=await accept(payload,token);both=saved.feedback;
    assert.deepEqual(both.feedback.responsable_ids,[91003,91004]);assert.deepEqual(both.feedback.responsables,['QA258 Shared','QA258 Shared']);
    assert.equal(expected.mia_private_task_notifications.length,3);
  });
  await t.test('text-only edits preserve both retired IDs and duplicate labels with or without unchanged-ID echo',async()=>{
    const old=expected.usuarios;await f.query('UPDATE usuarios SET activo=false WHERE id=ANY($1::int[])',[[91003,91004]]);
    const next=await state();unchangedExcept(next,['usuarios']);
    assert.deepEqual(next.usuarios.map(({row})=>row).sort((a,b)=>a.id-b.id),old.map(({row})=>[91003,91004].includes(row.id)
      ?{...row,activo:false,user_admin_version:row.user_admin_version+1}:row).sort((a,b)=>a.id-b.id));expected=next;await invariant();
    for(const echo of [false,true]){
      const current=checked(await signed(`/feedback/${both.id}`,undefined,'GET')).feedback;
      const payload={contenido:`QA258 unrelated edit ${echo}`,expected_updated_at:current.updated_at,permitir_duplicado:true,
        idempotency_key:crypto.randomUUID(),...(echo?{responsable_ids:[91004,91003],responsables:['Forged replacement label']}:{})};
      const token=await issue(payload,both.id),saved=await accept(payload,token,both.id);both=saved.feedback;
      assert.deepEqual(both.feedback.responsable_ids,[91003,91004]);assert.deepEqual(both.feedback.responsables,['QA258 Shared','QA258 Shared']);
      assert.equal(expected.mia_private_task_notifications.length,3,'Editing must not re-enqueue creation notices');
    }
  });
  await t.test('new inactive selection rolls back without consuming confirmation, receipt, note or notification',async()=>{
    const current=checked(await signed(`/feedback/${first.id}`,undefined,'GET')).feedback;
    const payload={contenido:'Must never be persisted',expected_updated_at:current.updated_at,responsable_ids:[91004],
      permitir_duplicado:true,idempotency_key:crypto.randomUUID()};
    const token=await issue(payload,first.id),before=await hashes(true);
    assert.equal((await mutate(payload,token,first.id)).status,422);assert.deepEqual(await hashes(true),before);await invariant();
    const storedToken=expected.integracion_confirmaciones.find(({row})=>row.token===token).row;assert.equal(storedToken.used_at,null);
    for(const ids of [[91003,91003],['91003'],[2147483648]]){
      const invalid=createPayload('QA258 invalid IDs',ids),stateBefore=await hashes(true);
      assert.equal((await mutate(invalid)).status,400);assert.deepEqual(await hashes(true),stateBefore);await invariant();
    }
  });
  await invariant();assert.equal(expected.notas_compartidas.length,2);assert.equal(expected.feedback_operation_receipts.length,4);
  assert.equal(expected.integracion_auditoria.length,4);assert.equal(expected.mia_private_task_notifications.length,3);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename),tables);
  t.diagnostic(`${tables.length} public tables observed with exact scoped note/token/receipt/audit/queue/user deltas; signed Telegram human HTTP, no browser/cookie/WhatsApp-delivery/provider or revocation-race claim`);
});
