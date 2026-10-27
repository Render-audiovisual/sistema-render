import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {access} from 'node:fs/promises';
import {startLocalHarness,request,fixturePassword,assertFixtureIdentity} from '../scripts/render2-local-test.js';

// Actual principal PATCH and private queue, never an injected notifier.
// Disposable opt-in harness has no configured database/SMTP/provider secrets.
test('generic task approval notifies current assigned IDs once without editorial publication',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55981,f=await startLocalHarness({port});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');
    t.diagnostic(`Own task-approval notification fixture stopped port55981; cleanup ENOENT: ${f.root}`);
  });
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:'postgresql://render2_fixture@127.0.0.1:55981/render2_local_test',
    identity:(await f.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
      inet_server_port() port,current_setting('data_directory') directory`))[0]});
  const ok=(response,status=200)=>{assert.equal(response.status,status,'Expected principal HTTP status');return response.body;};
  const [seed]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,subtipo,estado,prioridad,fecha_vencimiento,propiedades_extra)
    VALUES('QA397 generic approval notice','Luciano QA','edicion','video','en_revision','media','2026-10-30',
      '{"workspace":"render_os","revision_aprobada":false,"qa_preserve":"QA397"}') RETURNING id,revision`);
  await f.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
    VALUES($1,91003,'responsable'),($1,91004,'colaborador')`,[seed.id]);
  const deliveryId=randomUUID();
  await f.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes)
    VALUES($1,$2,91003,$3,$4,$5,'https://example.invalid/qa397/edited-version','QA397 explicit seeded artifact')`,
  [deliveryId,seed.id,randomUUID(),'a'.repeat(64),seed.revision]);
  await f.query(`INSERT INTO progreso_edicion_entregas
    (tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at,activa,
     editor_user_id,origen_registro,delivery_id,task_revision)
    SELECT t.id,'user:91003',t.titulo,t.cliente_id,t.estado,d.recorded_at,true,
      91003,'canonical_delivery',d.id,t.revision FROM tareas t
    JOIN task_editing_deliveries d ON d.task_id=t.id WHERE t.id=$1 AND d.id=$2`,[seed.id,deliveryId]);
  const login=async usuario=>ok(await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}})).token;
  const admin=await login('qa_franco'),employee=await login('qa_luciano');
  const path=`/api/tareas/${seed.id}?workspace=render_os`;
  const api=(token=admin,method='GET',body)=>request(f.base,path,{token,method,body});
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.equal(tables.length,110);
  const allowed=new Set(['tareas','task_editing_reviews','mia_private_task_notifications','progreso_edicion_entregas']);
  const snapshot=async()=>{
    const hashes={};for(const table of tables){
      assert.match(table,/^[a-z_][a-z0-9_]*$/);
      hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`))[0].hash;
    }return hashes;
  };
  const notices=()=>f.query('SELECT * FROM mia_private_task_notifications ORDER BY id');
  const decisions=()=>f.query('SELECT * FROM task_editing_reviews ORDER BY id');
  const task=async()=>(await f.query('SELECT * FROM tareas WHERE id=$1',[seed.id]))[0];
  const progress=()=>f.query('SELECT * FROM progreso_edicion_entregas ORDER BY id');
  const originalProgress=await progress();assert.equal(originalProgress.length,1);
  assert.equal(originalProgress[0].tarea_id,String(seed.id));assert.equal(originalProgress[0].editor_user_id,91003);
  assert.equal(originalProgress[0].delivery_id,deliveryId);assert.equal(originalProgress[0].estado_actual,'en_revision');
  assert.equal(originalProgress[0].entregada_at,(await f.query('SELECT recorded_at FROM task_editing_deliveries WHERE id=$1',[deliveryId]))[0].recorded_at);
  const publicationCount=async()=>(await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n;
  assert.deepEqual(await notices(),[]);assert.deepEqual(await decisions(),[]);assert.equal(await publicationCount(),0);
  const before=await snapshot(),original=await task();
  const intent={estado:'aprobada',expected_revision:seed.revision,expected_entrega_id:deliveryId};
  let approved,stable;
  await t.test('approval200 persists exact delivery decision and two current-ID approval notices, not reassignment',async()=>{
    approved=ok(await api(admin,'PATCH',intent));assert.equal(approved.estado,'aprobada');
    assert.equal(approved.revision,seed.revision+1);
    const saved=await task();assert.equal(saved.estado,'aprobada');assert.equal(saved.revision,original.revision+1);
    assert.equal(saved.propiedades_extra.revision_aprobada,true);
    assert.equal(saved.propiedades_extra.revision_aprobada_por_id,91001);
    assert.equal(saved.propiedades_extra.revision_aprobada_entrega_id,deliveryId);
    assert.equal(saved.propiedades_extra.qa_preserve,'QA397');
    for(const field of ['titulo','asignado_a','tipo_tarea','subtipo','prioridad','fecha_vencimiento','cliente_id'])
      assert.deepEqual(saved[field],original[field],`Approval preserves ${field}`);
    const rows=await decisions();assert.equal(rows.length,1);const decision=rows[0];
    assert.equal(decision.task_id,seed.id);assert.equal(decision.delivery_id,deliveryId);
    assert.equal(decision.actor_id,91001);assert.equal(decision.action,'aprobada');
    assert.equal(decision.task_revision,saved.revision);assert.equal(decision.notes,'');
    const ledger=await progress();assert.equal(ledger.length,1);const credit=ledger[0];
    assert.ok(Date.parse(credit.updated_at)>=Date.parse(originalProgress[0].updated_at));
    assert.deepEqual(credit,{...originalProgress[0],estado_actual:'aprobada',task_revision:saved.revision,
      updated_at:credit.updated_at},'Approval retains active credit, exact task/editor/date/artifact and snapshots');
    const deadline=Date.now()+5000;let queued;
    do{queued=await notices();if(queued.length>=2)break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
    assert.equal(queued.length,2,'Actual mounted approval route queues exactly both current assignees');
    assert.deepEqual(queued.map(n=>n.detalles.destinatario_usuario_id).sort((a,b)=>a-b),[91003,91004]);
    assert.equal(new Set(queued.map(n=>n.fingerprint)).size,2);
    for(const notice of queued){
      const recipient=notice.detalles.destinatario_usuario_id;
      assert.equal(String(notice.tarea_id),String(seed.id));assert.equal(notice.motivo,'aprobada');
      assert.equal(notice.estado,'pending');assert.equal(notice.detalles.actor_usuario_id,91001);
      assert.equal(notice.detalles.actor,'Franco QA');
      assert.equal(notice.destinatario_clave,recipient===91003?'qa_luciano':'qa_designer');
      assert.equal(notice.fingerprint,createHash('sha256').update(JSON.stringify([
        'task-recipient-id-v1',seed.id,'aprobada',recipient,saved.revision,'Franco QA aprobó el trabajo.',
      ])).digest('hex'));assert.ok(notice.mensaje.includes(saved.titulo));
      assert.ok(notice.mensaje.includes('La tarea fue aprobada'));
      assert.ok(notice.tarea_url.endsWith(`/workspace/tareas?task=${seed.id}`));
    }
    assert.equal(await publicationCount(),0);
    stable=await snapshot();
    assert.deepEqual(tables.filter(table=>stable[table]!==before[table]).sort(),[...allowed].sort(),
      'Only task, approval journal, asserted operational credit and private queue may change');
    for(const table of tables)if(!allowed.has(table))assert.equal(stable[table],before[table],table);
  });
  await t.test('stale approval409 and actual task/history GETs preserve every110-table hash and queue count',async()=>{
    assert.ok(approved&&stable,'Fresh approval and both notifications must pass first');
    ok(await api(admin,'PATCH',intent),409);
    for(const token of [admin,employee]){
      const current=ok(await api(token));assert.equal(current.estado,'aprobada');assert.equal(current.revision,seed.revision+1);
      const history=ok(await request(f.base,`/api/tareas-edicion/${seed.id}/revisiones`,{token}));
      assert.equal(history.decisions.length,1);assert.equal(history.decisions[0].delivery_id,deliveryId);
      assert.equal(history.decisions[0].action,'aprobada');
    }
    assert.equal((await notices()).length,2);assert.equal((await decisions()).length,1);
    assert.equal(await publicationCount(),0);assert.deepEqual(await snapshot(),stable);
    t.diagnostic('Post-setup/login110-table baseline:4 explicitly asserted tables changed,106 invariant; no provider delivery claimed');
  });
  await t.test('approval plus reassignment emits only approval to the new member and preserves previous task/notices',async()=>{
    assert.ok(stable);assert.deepEqual(await snapshot(),stable);
    // Explicit second setup phase, not a hidden mutation by the approval writer.
    const [second]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
      VALUES('QA397 approval and reassignment','Luciano QA','edicion','en_revision',
        '{"workspace":"render_os","revision_aprobada":false}') RETURNING id,revision`);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[second.id]);
    const artifact=randomUUID();
    await f.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes)
      VALUES($1,$2,91003,$3,$4,$5,'https://example.invalid/qa397/reassigned-artifact','QA397 setup')`,
    [artifact,second.id,randomUUID(),'b'.repeat(64),second.revision]);
    await f.query(`INSERT INTO progreso_edicion_entregas
      (tarea_id,editor_clave,titulo_snapshot,cliente_id,estado_actual,entregada_at,activa,
       editor_user_id,origen_registro,delivery_id,task_revision)
      SELECT t.id,'user:91003',t.titulo,t.cliente_id,t.estado,d.recorded_at,true,
        91003,'canonical_delivery',d.id,t.revision FROM tareas t
      JOIN task_editing_deliveries d ON d.task_id=t.id WHERE t.id=$1 AND d.id=$2`,[second.id,artifact]);
    const phaseProgress=await progress();assert.equal(phaseProgress.length,2);
    const secondCredit=phaseProgress.find(row=>row.tarea_id===String(second.id));assert.ok(secondCredit);
    assert.equal(secondCredit.editor_user_id,91003);assert.equal(secondCredit.delivery_id,artifact);
    assert.equal(secondCredit.entregada_at,(await f.query('SELECT recorded_at FROM task_editing_deliveries WHERE id=$1',[artifact]))[0].recorded_at);
    const physicalCredit=()=>f.query('SELECT to_jsonb(p) row,xmin::text xmin,ctid::text ctid FROM progreso_edicion_entregas p WHERE tarea_id=$1',[seed.id]);
    const priorCredit=await physicalCredit();
    const observed=ok(await request(f.base,`/api/tareas/${second.id}?workspace=render_os`,{token:admin}));
    const firstTask=await f.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=$1',[seed.id]);
    const physicalNotices=()=>f.query('SELECT to_jsonb(n) row,xmin::text xmin,ctid::text ctid FROM mia_private_task_notifications n ORDER BY id');
    const priorNotices=await physicalNotices(),phase=await snapshot();
    const result=ok(await request(f.base,`/api/tareas/${second.id}?workspace=render_os`,{token:admin,method:'PATCH',body:{
      estado:'aprobada',expected_revision:second.revision,expected_entrega_id:artifact,
      expected_updated_at:observed.updated_at,
      asignado_a_id:91002,colaborador_ids:[],
    }}));
    assert.equal(result.estado,'aprobada');assert.equal(result.asignado_a_id,91002);
    assert.deepEqual(result.colaborador_ids,[]);
    const deadline=Date.now()+5000;let all;
    do{all=await notices();if(all.length>=3)break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
    assert.equal(all.length,3,'Exactly one new event, never approval plus reassignment');
    const added=all.filter(row=>String(row.tarea_id)===String(second.id));assert.equal(added.length,1);
    assert.equal(added[0].motivo,'aprobada');assert.equal(added[0].detalles.destinatario_usuario_id,91002);
    assert.equal(added[0].detalles.actor_usuario_id,91001);
    assert.equal(added[0].fingerprint,createHash('sha256').update(JSON.stringify([
      'task-recipient-id-v1',second.id,'aprobada',91002,result.revision,'Franco QA aprobó el trabajo.',
    ])).digest('hex'));
    assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1',[second.id]),[
      {usuario_id:91002,tipo:'responsable'},
    ]);
    const journal=await f.query('SELECT actor_id,action,delivery_id,task_revision FROM task_editing_reviews WHERE task_id=$1',[second.id]);
    assert.deepEqual(journal,[{actor_id:91001,action:'aprobada',delivery_id:artifact,task_revision:result.revision}]);
    const finalProgress=await progress();assert.equal(finalProgress.length,2);
    const finalCredit=finalProgress.find(row=>row.tarea_id===String(second.id));
    assert.ok(Date.parse(finalCredit.updated_at)>=Date.parse(secondCredit.updated_at));
    assert.deepEqual(finalCredit,{...secondCredit,estado_actual:'aprobada',task_revision:result.revision,
      updated_at:finalCredit.updated_at},'Reassignment to91002 must not transfer the original91003 delivery credit or date');
    assert.deepEqual(await physicalCredit(),priorCredit,'First task ledger tuple remains physically unchanged');
    const currentNotices=await physicalNotices();
    for(const prior of priorNotices)assert.deepEqual(currentNotices.find(row=>row.row.id===prior.row.id),prior);
    assert.deepEqual(await f.query('SELECT to_jsonb(t) row,xmin::text xmin,ctid::text ctid FROM tareas t WHERE id=$1',[seed.id]),firstTask);
    const after=await snapshot();
    assert.deepEqual(tables.filter(table=>phase[table]!==after[table]).sort(),[
      'mia_private_task_notifications','progreso_edicion_entregas','tarea_asignaciones','tareas','task_editing_reviews',
    ].sort());
    assert.equal(await publicationCount(),0);
    t.diagnostic('Separate reassignment phase: current member91002 only, no reasignada event; prior rows physically invariant');
  });
});
