import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {startLocalHarness,request,fixturePassword,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {taskNotificationEligible} from '../src/task-notification-eligibility.js';

// Actual mounted correction endpoint and durable notification queue only.
// Opt-in fresh PostgreSQL, no SMTP config, external provider or injected notifier.
test('canonical correction notifies current assigned IDs, never historical delivery author; retries stay read-only',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55980,f=await startLocalHarness({port});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');
    t.diagnostic(`Own correction-notification fixture stopped port55980; cleanup ENOENT: ${f.root}`);
  });
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:'postgresql://render2_fixture@127.0.0.1:55980/render2_local_test',
    identity:(await f.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
      inet_server_port() port,current_setting('data_directory') directory`))[0]});
  const ok=(response,status=200)=>{assert.equal(response.status,status,'Expected principal HTTP status');return response.body;};
  await f.query('UPDATE usuarios SET whatsapp_habilitado=true WHERE id=ANY($1::int[])',[[91003,91004]]);
  const [seed]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,subtipo,estado,prioridad,fecha_vencimiento,propiedades_extra)
    VALUES('QA396 current assignment corrections','Luciano QA','edicion','video','en_revision','media','2026-10-30',
      '{"workspace":"render_os","qa_preserve":"QA396","revision_aprobada":false}') RETURNING id,revision`);
  await f.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
    VALUES($1,91003,'responsable'),($1,91004,'colaborador')`,[seed.id]);
  const deliveryId=randomUUID();
  // Explicit fixture history, not an inferred artifact or a provider upload.
  await f.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes)
    VALUES($1,$2,91002,$3,$4,$5,'https://example.invalid/qa396/historical-delivery','QA396 seeded historical author')`,
  [deliveryId,seed.id,randomUUID(),'a'.repeat(64),seed.revision]);
  assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id',[seed.id]),[
    {usuario_id:91003,tipo:'responsable'},{usuario_id:91004,tipo:'colaborador'},
  ]);
  const login=async usuario=>ok(await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}})).token;
  const admin=await login('qa_franco'),employee=await login('qa_luciano');
  const api=(suffix,token=admin,method='GET',body)=>request(f.base,`/api/tareas-edicion/${seed.id}/${suffix}`,{token,method,body});
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.equal(tables.length,109);
  const allowed=new Set(['tareas','task_editing_reviews','mia_private_task_notifications']);
  const snapshot=async()=>{
    const hashes={};for(const table of tables){
      assert.match(table,/^[a-z_][a-z0-9_]*$/);
      hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`))[0].hash;
    }return hashes;
  };
  const notices=()=>f.query('SELECT * FROM mia_private_task_notifications ORDER BY id');
  // Real persisted-notification predicate, executed against this owned fixture;
  // no regex oracle, routing provider, message send or API delivery claim.
  const eligibilityDb={query:async(sql,values)=>({rows:await f.query(sql,values)})};
  const decisions=()=>f.query('SELECT * FROM task_editing_reviews ORDER BY id');
  const task=async()=>(await f.query('SELECT * FROM tareas WHERE id=$1',[seed.id]))[0];
  assert.deepEqual(await notices(),[]);assert.deepEqual(await decisions(),[]);
  assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
  const before=await snapshot(),original=await task();
  const notes='QA396 Corregir audio y conservar el montaje actual';
  const intent={request_id:randomUUID(),expected_revision:seed.revision,expected_entrega_id:deliveryId,notes};
  let created,stable;
  await t.test('fresh correction201 commits one exact decision and two assigned-ID notices, excluding historical author and acting admin',async()=>{
    created=ok(await api('correcciones',admin,'POST',intent),201);assert.equal(created.replayed,false);
    assert.equal(created.task.estado,'en_progreso');assert.equal(created.task.revision,seed.revision+1);
    assert.equal(created.decisions.length,1);assert.equal(created.latest_delivery.id,deliveryId);
    const saved=await task();assert.equal(saved.estado,'en_progreso');assert.equal(saved.revision,original.revision+1);
    assert.equal(saved.propiedades_extra.revision_aprobada,false);assert.equal(saved.propiedades_extra.qa_preserve,'QA396');
    for(const field of ['titulo','asignado_a','tipo_tarea','subtipo','prioridad','fecha_vencimiento','cliente_id'])
      assert.deepEqual(saved[field],original[field],`Correction preserves ${field}`);
    const rows=await decisions();assert.equal(rows.length,1);const receipt=rows[0];
    assert.equal(receipt.id,created.decision_id);assert.equal(receipt.task_id,seed.id);assert.equal(receipt.actor_id,91001);
    assert.equal(receipt.delivery_id,deliveryId);assert.equal(receipt.action,'correcciones');assert.equal(receipt.notes,notes);
    assert.equal(receipt.request_id,intent.request_id);assert.equal(receipt.task_revision,saved.revision);
    const deadline=Date.now()+5000;let queued;
    do{queued=await notices();if(queued.length>=2)break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
    assert.equal(queued.length,2,'Actual server must queue exactly both current assignees');
    assert.deepEqual(queued.map(n=>n.detalles.destinatario_usuario_id).sort((a,b)=>a-b),[91003,91004]);
    assert.equal(new Set(queued.map(n=>n.fingerprint)).size,2);
    for(const notice of queued){
      const recipient=notice.detalles.destinatario_usuario_id;
      assert.equal(String(notice.tarea_id),String(seed.id));assert.equal(notice.motivo,'correcciones');
      assert.equal(notice.estado,'pending');assert.equal(notice.detalles.actor_usuario_id,91001);
      assert.notEqual(recipient,91002,'Historical delivery author is not a current assignment');
      assert.notEqual(recipient,91001,'Acting admin is not a recipient');
      assert.equal(notice.destinatario_clave,recipient===91003?'qa_luciano':'qa_designer');
      assert.ok(notice.mensaje.split('\n').includes(notes),'Notification detail is the exact committed correction notes');
      assert.ok(notice.mensaje.includes(saved.titulo));assert.ok(notice.tarea_url.endsWith(`/workspace/tareas?task=${seed.id}`));
      const fingerprint=createHash('sha256').update(JSON.stringify([
        'task-recipient-id-v1',seed.id,'correcciones',recipient,saved.revision,notes,
      ])).digest('hex');
      assert.equal(notice.fingerprint,fingerprint,'ID/event-version/detail-bound fingerprint');
    }
    stable=await snapshot();
    assert.deepEqual(tables.filter(table=>stable[table]!==before[table]).sort(),[...allowed].sort());
    for(const table of tables)if(!allowed.has(table))assert.equal(stable[table],before[table],table);
    for(const notice of queued)assert.equal(await taskNotificationEligible(eligibilityDb,notice),true,
      'Both current active WhatsApp-enabled assignments are initially eligible');
    assert.deepEqual(await snapshot(),stable,'Initial eligibility checks are read-only across all109 tables');
  });
  await t.test('replay200, current history GETs and stale409 add no decision/notice and preserve all109 physical-table hashes',async()=>{
    assert.ok(created&&stable,'Fresh decision and both notices must succeed first');
    const replay=ok(await api('correcciones',admin,'POST',intent));assert.equal(replay.replayed,true);
    assert.equal(replay.decision_id,created.decision_id);assert.deepEqual(replay.decisions,created.decisions);
    for(const token of [admin,employee]){
      const history=ok(await api('revisiones',token));assert.equal(history.decisions.length,1);
      assert.equal(history.decisions[0].id,created.decision_id);assert.equal(history.task.revision,seed.revision+1);
    }
    ok(await api('correcciones',admin,'POST',{...intent,request_id:randomUUID()}),409);
    assert.equal((await notices()).length,2);assert.equal((await decisions()).length,1);
    assert.deepEqual(await snapshot(),stable);
    assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
    t.diagnostic('109-table post-setup/login baseline; only3 explicit tables changed,106 invariant; no provider delivery claimed');
  });
  await t.test('explicit fixture membership removal revokes only collaborator delivery eligibility; SQL checks remain mutation-free',async()=>{
    assert.ok(stable,'Prior correction/replay stages must succeed first');
    assert.deepEqual(await snapshot(),stable);
    const removed=await f.query(`DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91004
      AND tipo='colaborador' RETURNING usuario_id`,[seed.id]);
    assert.deepEqual(removed,[{usuario_id:91004}],'Intentional setup-stage mutation removes exactly the collaborator');
    const afterRemoval=await snapshot();
    assert.deepEqual(tables.filter(table=>afterRemoval[table]!==stable[table]),['tarea_asignaciones'],
      'The only additional mutation is the explicit fixture membership deletion, outside the correction writer');
    const queued=await notices();assert.equal(queued.length,2);
    for(const notice of queued){
      const recipient=notice.detalles.destinatario_usuario_id;
      assert.equal(await taskNotificationEligible(eligibilityDb,notice),recipient===91003,
        'Current owner remains eligible; removed collaborator is denied for correcciones');
    }
    assert.deepEqual(await snapshot(),afterRemoval,'Eligibility reads never rewrite queue, assignments or any public-table tuple');
    assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
    t.diagnostic('Separate explicit membership-removal stage: only tarea_asignaciones changed; subsequent109-table SQL eligibility reads invariant');
  });
});
