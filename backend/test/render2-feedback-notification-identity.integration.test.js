import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity,request,fixturePassword} from '../scripts/render2-local-test.js';
import {feedbackFingerprint} from '../src/feedback-workflow.js';
import {taskNotificationEligible} from '../src/task-notification-eligibility.js';

test('new Feedback notices bind IDs, commit with browser receipts and fail closed at delivery eligibility',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55892,f=await startLocalHarness({port});let pool;
  t.after(async()=>{
    try{
      if(pool){
        try{await pool.query('DROP TRIGGER IF EXISTS qa256_feedback_queue_failure ON mia_private_task_notifications');
          await pool.query('DROP FUNCTION IF EXISTS qa256_feedback_queue_failure()');}
        finally{await pool.end();}
      }
    }finally{await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
      t.diagnostic(`Own Feedback-identity fixture cleanup ENOENT: ${f.root}; port${port}`);}
  });
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard={root:f.root,cwd:f.root,port,url};
  assertFixtureIdentity({...guard,identity:(await f.query(identitySql))[0]});
  pool=new pg.Pool({connectionString:url,max:2,statement_timeout:10000,connectionTimeoutMillis:5000});
  const lease=await pool.connect();
  try{assertFixtureIdentity({...guard,identity:(await lease.query(identitySql)).rows[0]});}finally{lease.release();}
  await pool.query("UPDATE usuarios SET nombre='QA256 Actor' WHERE id=91001");
  await pool.query("UPDATE usuarios SET nombre='QA256 Target',whatsapp_habilitado=true WHERE id=91003");
  const checked=(response,status=200)=>{assert.equal(response.status,status,'Unexpected principal HTTP status');return response.body;};
  const login=checked(await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}}));
  assert.equal(login.usuario.id,91001);assert.ok(login.token);
  const api=(path,method='GET',body)=>request(f.base,`/api${path}`,{token:login.token,method,body});
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const mutable=new Set(['usuarios','notas_compartidas','feedback_browser_operations','mia_private_task_notifications']);
  async function hashes(all=false){const result={};for(const table of tables.filter(name=>all||!mutable.has(name))){
    result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
  }return result;}
  const rows=table=>{assert.ok(mutable.has(table));return f.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);};
  const stable=await hashes();
  let expectedUsers=await rows('usuarios'),expectedNotes=await rows('notas_compartidas'),
    expectedReceipts=await rows('feedback_browser_operations'),expectedQueue=await rows('mia_private_task_notifications');
  assert.deepEqual(expectedNotes,[]);assert.deepEqual(expectedReceipts,[]);assert.deepEqual(expectedQueue,[]);
  async function invariant(){
    assert.deepEqual(await hashes(),stable);assert.deepEqual(await rows('usuarios'),expectedUsers);
    assert.deepEqual(await rows('notas_compartidas'),expectedNotes);assert.deepEqual(await rows('feedback_browser_operations'),expectedReceipts);
    assert.deepEqual(await rows('mia_private_task_notifications'),expectedQueue);
  }
  async function userPatch(id,patch){
    const keys=Object.keys(patch);assert.ok(keys.length&&keys.every(key=>['nombre','usuario','activo','whatsapp_habilitado'].includes(key)));
    const old=expectedUsers.find(({row})=>row.id===id).row;
    await pool.query(`UPDATE usuarios SET ${keys.map((key,index)=>`${key}=$${index+1}`).join(',')} WHERE id=$${keys.length+1}`,[...Object.values(patch),id]);
    const next={...old,...patch,user_admin_version:old.user_admin_version+1};
    expectedUsers=expectedUsers.map(({row})=>({row:row.id===id?next:row}));
    // to_jsonb text order may depend on names, so compare by stable identity.
    expectedUsers.sort((a,b)=>JSON.stringify(a.row).localeCompare(JSON.stringify(b.row)));
    const actual=await rows('usuarios');
    assert.deepEqual([...actual].sort((a,b)=>a.row.id-b.row.id),[...expectedUsers].sort((a,b)=>a.row.id-b.row.id));
    expectedUsers=actual;await invariant();
  }
  const intent=(title,responsibles)=>({request_id:randomUUID(),action:'create',fields:{titulo:title,contenido:'QA256 synthetic Feedback',categoria:'general',
    feedback:{cliente:'',responsables:responsibles,responsable:responsibles[0]||'',referencia:'',estado:'pendiente',vigencia:'puntual',flujo:'feedback'}}});
  function closed(body){
    assert.deepEqual(Object.keys(body).sort(),['note','operation','version']);assert.equal(body.version,1);
    const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){
      assert.ok(!['notification','destinatarioIds','actorId','destinatario_usuario_id','actor_usuario_id'].includes(key),'No internal notification context in public DTO');walk(child);
    }};walk(body);
  }
  async function create(input,recipientIds){
    await invariant();
    const body=checked(await api('/notas/operaciones','POST',input),201);closed(body);
    assert.equal(body.operation.request_id,input.request_id);assert.equal(body.operation.action,'create');assert.equal(body.operation.replayed,false);
    assert.equal(body.note.titulo,input.fields.titulo);assert.equal(body.note.contenido,input.fields.contenido);
    assert.equal(body.operation.note_id,body.note.id);
    const notes=await rows('notas_compartidas'),receipts=await rows('feedback_browser_operations'),queue=await rows('mia_private_task_notifications');
    assert.equal(notes.length,expectedNotes.length+1);assert.equal(receipts.length,expectedReceipts.length+1);
    assert.deepEqual(notes.filter(({row})=>Number(row.id)!==body.note.id),expectedNotes);
    const note=notes.find(({row})=>Number(row.id)===body.note.id).row;
    assert.equal(note.titulo,input.fields.titulo);assert.equal(note.creado_por,body.note.creado_por);
    assert.deepEqual(note.feedback,body.note.feedback);assert.equal(note.eliminado_at,null);
    assert.deepEqual(receipts.filter(({row})=>row.request_id!==input.request_id),expectedReceipts);
    const receipt=receipts.find(({row})=>row.request_id===input.request_id).row;
    assert.equal(receipt.actor_user_id,91001);assert.equal(receipt.action,'create');assert.equal(Number(receipt.note_id),body.note.id);
    assert.match(receipt.payload_hash,/^[a-f0-9]{64}$/);assert.equal(Date.parse(receipt.note_updated_at),Date.parse(body.note.updated_at));
    assert.equal(queue.length,expectedQueue.length+recipientIds.length,'HTTP success must already expose the committed queue, not a delayed callback');
    const added=queue.filter(({row})=>Number(row.feedback_id)===body.note.id).map(({row})=>row);
    assert.deepEqual(added.map(row=>row.detalles.destinatario_usuario_id).sort((a,b)=>a-b),recipientIds);
    for(const notice of added){
      assert.equal(notice.motivo,'feedback');assert.equal(notice.tarea_id,null);assert.equal(notice.estado,'pending');
      assert.deepEqual(notice.detalles,{cliente:null,actor:body.note.creado_por,destinatario_usuario_id:91003,actor_usuario_id:91001});
      assert.equal(notice.destinatario_clave,'qa_luciano');
      assert.equal(notice.fingerprint,feedbackFingerprint(['feedback-recipient-id-v1',body.note.id,91003,body.note.updated_at]));
      assert.notEqual(notice.fingerprint,feedbackFingerprint(['feedback',body.note.id,'qa_luciano',body.note.updated_at]));
      assert.match(notice.tarea_url,new RegExp(`/feedback\\?section=team&note=${body.note.id}$`));
    }
    assert.deepEqual(queue.filter(({row})=>Number(row.feedback_id)!==body.note.id),expectedQueue);
    expectedNotes=notes;expectedReceipts=receipts;expectedQueue=queue;await invariant();
    return {body,added};
  }
  let firstNotice;
  await t.test('HTTP create atomically stores one ID-bound notice despite two labels; exact receipt replay never re-enqueues',async()=>{
    const input=intent('QA256 unique recipient',['qa_luciano','QA256 Target']);
    const saved=await create(input,[91003]);firstNotice=saved.added[0];
    assert.equal(await taskNotificationEligible(pool,firstNotice),true);
    const before=await hashes(true),replayed=checked(await api('/notas/operaciones','POST',input));closed(replayed);
    assert.equal(replayed.operation.replayed,true);assert.equal(replayed.note.id,saved.body.note.id);
    assert.deepEqual(replayed.note,saved.body.note);assert.deepEqual(await hashes(true),before);await invariant();
  });
  await t.test('ambiguous and unknown labels still save notes but cannot guess or fan out recipients',async()=>{
    await userPatch(91001,{nombre:'QA256 Shared'});await userPatch(91003,{nombre:'QA256 Shared'});await userPatch(91004,{nombre:'QA256 Shared'});
    await create(intent('QA256 ambiguous recipient',['QA256 Shared']),[]);
    await create(intent('QA256 unknown recipient',['QA256 no such user']),[]);
  });
  await t.test('unique username retains distinct recipient despite actor/recipient display-name homonym',async()=>{
    const saved=await create(intent('QA256 distinct actor homonym',['qa_luciano']),[91003]);
    assert.equal(saved.body.note.creado_por,'QA256 Shared');assert.equal(saved.added[0].destinatario,'QA256 Shared');
    assert.equal(await taskNotificationEligible(pool,saved.added[0]),true);await invariant();
  });
  await t.test('existing eligibility denies inactive, WhatsApp-disabled and reused-key ownership without changing the notice',async()=>{
    assert.ok(firstNotice);assert.equal(await taskNotificationEligible(pool,firstNotice),true);
    await userPatch(91003,{activo:false});assert.equal(await taskNotificationEligible(pool,firstNotice),false);
    await userPatch(91003,{activo:true});assert.equal(await taskNotificationEligible(pool,firstNotice),true);
    await userPatch(91003,{whatsapp_habilitado:false});assert.equal(await taskNotificationEligible(pool,firstNotice),false);
    await userPatch(91003,{whatsapp_habilitado:true});assert.equal(await taskNotificationEligible(pool,firstNotice),true);
    await userPatch(91003,{usuario:'qa256_retired_target'});await userPatch(91004,{usuario:'qa_luciano'});
    assert.equal(await taskNotificationEligible(pool,firstNotice),false,'Old key must not redirect an ID-bound notice to a different user');
    await userPatch(91004,{usuario:'qa_designer'});await userPatch(91003,{usuario:'qa_luciano'});
    assert.equal(await taskNotificationEligible(pool,firstNotice),true);await invariant();
  });
  await t.test('queue INSERT failure rolls back note and receipt; same UUID succeeds exactly once after removing own trigger',async()=>{
    const input=intent('QA256 rollback attempt',['qa_luciano']);
    await pool.query(`CREATE FUNCTION qa256_feedback_queue_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.motivo='feedback' AND position('QA256 rollback attempt' in NEW.mensaje)>0 THEN
        RAISE EXCEPTION 'QA256 expected own queue failure' USING ERRCODE='P0001';
      END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER qa256_feedback_queue_failure BEFORE INSERT ON mia_private_task_notifications
      FOR EACH ROW EXECUTE FUNCTION qa256_feedback_queue_failure()`);
    const before=await hashes(true);
    try{
      const failed=await api('/notas/operaciones','POST',input);assert.equal(failed.status,500,'Queue failure must not acknowledge a committed note');
      assert.deepEqual(await hashes(true),before,'No note, operation receipt or queue row from the failed transaction');await invariant();
      assert.deepEqual(await f.query('SELECT request_id FROM feedback_browser_operations WHERE actor_user_id=91001 AND request_id=$1',[input.request_id]),[]);
    }finally{
      await pool.query('DROP TRIGGER qa256_feedback_queue_failure ON mia_private_task_notifications');
      await pool.query('DROP FUNCTION qa256_feedback_queue_failure()');
    }
    const saved=await create(input,[91003]);assert.equal(saved.body.operation.replayed,false);
    const beforeReplay=await hashes(true),replayed=checked(await api('/notas/operaciones','POST',input));
    assert.equal(replayed.operation.replayed,true);assert.equal(replayed.note.id,saved.body.note.id);
    assert.deepEqual(await hashes(true),beforeReplay);await invariant();
  });
  await invariant();assert.equal(expectedNotes.length,5);assert.equal(expectedReceipts.length,5);assert.equal(expectedQueue.length,3);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename),tables);
  assertFixtureIdentity({...guard,identity:(await f.query(identitySql))[0]});
  t.diagnostic(`${tables.length} public tables observed with exact notes/receipts/notices/users deltas; ${tables.length-mutable.size} unrelated tables unchanged; real bearer HTTP and delivery predicate, no native/cookie/provider/worker or full responsible-ID UI claim; sequences are not asserted unchanged after rollback`);
});
