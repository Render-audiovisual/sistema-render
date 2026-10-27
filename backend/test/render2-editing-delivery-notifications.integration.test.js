import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {startLocalHarness,request,fixturePassword,assertFixtureIdentity} from '../scripts/render2-local-test.js';

// Opt-in only: actual mounted server -> committed delivery -> actual private
// notification queue. Clean disposable harness has no SMTP/provider secrets.
test('canonical editing delivery queues one post-commit review notice; replay/read/stale never duplicate it',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55979,f=await startLocalHarness({port});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');
    t.diagnostic(`Own delivery-notification fixture stopped port55979; cleanup ENOENT: ${f.root}`);
  });
  const [identity]=await f.query(`SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:'postgresql://render2_fixture@127.0.0.1:55979/render2_local_test',identity});
  const ok=(response,status=200)=>{assert.equal(response.status,status,'Expected principal HTTP status');return response.body;};
  // Preserve current recipients exactly: Franco resolves uniquely by existing
  // compatibility label; Agustin's historical login alias "lider" is absent.
  await f.query("UPDATE usuarios SET nombre='Franco' WHERE id=91001");
  const users=await f.query('SELECT id,usuario,nombre,rol,activo FROM usuarios ORDER BY id');
  assert.deepEqual(users.find(u=>u.id===91001),{id:91001,usuario:'qa_franco',nombre:'Franco',rol:'admin',activo:true});
  assert.equal(users.some(u=>u.usuario==='lider'),false);
  assert.equal(users.filter(u=>u.activo&&u.nombre==='Franco').length,1);
  const [seed]=await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,subtipo,estado,prioridad,fecha_vencimiento,propiedades_extra)
    VALUES('QA395 canonical delivery review','Luciano QA','edicion','video','en_progreso','media','2026-10-30',
      '{"workspace":"render_os","qa_notification_preserve":"QA395"}') RETURNING id,revision`);
  await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[seed.id]);
  const login=async usuario=>ok(await request(f.base,'/api/login',{
    method:'POST',body:{usuario,password:fixturePassword},
  })).token;
  const employee=await login('qa_luciano'),admin=await login('qa_franco');
  const api=(token,method='GET',body)=>request(f.base,`/api/tareas-edicion/${seed.id}/entregas`,{token,method,body});
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.equal(tables.length,110);
  const allowed=new Set(['tareas','task_editing_deliveries','mia_private_task_notifications','progreso_edicion_entregas']);
  const snapshot=async()=>{
    const hashes={};for(const table of tables){
      assert.match(table,/^[a-z_][a-z0-9_]*$/);
      hashes[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) hash FROM "${table}" r`))[0].hash;
    }return hashes;
  };
  const notices=()=>f.query('SELECT * FROM mia_private_task_notifications ORDER BY id');
  const deliveries=()=>f.query('SELECT * FROM task_editing_deliveries ORDER BY id');
  const progress=()=>f.query('SELECT * FROM progreso_edicion_entregas ORDER BY id');
  const task=async()=>(await f.query('SELECT * FROM tareas WHERE id=$1',[seed.id]))[0];
  assert.deepEqual(await notices(),[]);assert.deepEqual(await deliveries(),[]);assert.deepEqual(await progress(),[]);
  assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
  const before=await snapshot(),original=await task();
  const intent={request_id:randomUUID(),expected_revision:seed.revision,
    url:'https://example.invalid/qa395/edited-version-1',notes:'QA395 explicit editing delivery'};
  let created,stable;
  await t.test('fresh201 commits revision+1 and eventually persists exactly one real review notice with bound actor/recipient/task',async()=>{
    created=ok(await api(employee,'POST',intent),201);assert.equal(created.replayed,false);
    assert.equal(created.task.id,seed.id);assert.equal(created.task.estado,'en_revision');
    assert.equal(created.task.revision,seed.revision+1);assert.equal(created.deliveries.length,1);
    const saved=await task();assert.equal(saved.estado,'en_revision');assert.equal(saved.revision,original.revision+1);
    assert.equal(saved.propiedades_extra.revision_aprobada,false);
    assert.equal(saved.propiedades_extra.qa_notification_preserve,'QA395');
    for(const field of ['titulo','asignado_a','tipo_tarea','subtipo','prioridad','fecha_vencimiento','cliente_id'])
      assert.deepEqual(saved[field],original[field],`Delivery preserves ${field}`);
    const rows=await deliveries();assert.equal(rows.length,1);const receipt=rows[0];
    assert.equal(receipt.id,created.delivery_id);assert.equal(receipt.task_id,seed.id);assert.equal(receipt.actor_id,91003);
    assert.equal(receipt.request_id,intent.request_id);assert.equal(receipt.task_revision,saved.revision);
    assert.equal(receipt.url,intent.url);assert.equal(receipt.notes,intent.notes);
    const ledger=await progress();assert.equal(ledger.length,1,'Only delivered task obtains operational credit');
    const credit=ledger[0];assert.match(String(credit.id),/^[1-9]\d*$/);
    assert.ok(Number.isFinite(Date.parse(credit.created_at)));assert.ok(Number.isFinite(Date.parse(credit.updated_at)));
    assert.deepEqual(credit,{
      id:credit.id,tarea_id:String(seed.id),editor_clave:'user:91003',titulo_snapshot:original.titulo,
      cliente_id:original.cliente_id,estado_actual:'en_revision',entregada_at:receipt.recorded_at,
      activa:true,baja_at:null,created_at:credit.created_at,updated_at:credit.updated_at,
      editor_user_id:91003,origen_registro:'canonical_delivery',delivery_id:receipt.id,task_revision:saved.revision,
    },'Exact task/editor/artifact/date/state ledger row; no unbounded ledger exception');
    // Fire-and-forget is observed by durable evidence, not by a fixed delay.
    const deadline=Date.now()+5000;let queued;
    do{queued=await notices();if(queued.length)break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
    assert.equal(queued.length,1,'Actual mounted server hook must enqueue once');const notice=queued[0];
    assert.equal(String(notice.tarea_id),String(seed.id));assert.equal(notice.motivo,'revision');assert.equal(notice.estado,'pending');
    assert.equal(notice.destinatario,'Franco');assert.equal(notice.destinatario_clave,'qa_franco');
    assert.equal(notice.detalles.actor_usuario_id,91003);assert.equal(notice.detalles.destinatario_usuario_id,91001);
    assert.equal(notice.detalles.actor,'Luciano QA');assert.ok(notice.mensaje.includes(saved.titulo));
    assert.ok(notice.tarea_url.endsWith(`/workspace/tareas?task=${seed.id}`));
    const expectedFingerprint=createHash('sha256').update(JSON.stringify([
      seed.id,'revision','qa_franco',new Date(saved.updated_at).toISOString(),'',
    ])).digest('hex');
    assert.equal(notice.fingerprint,expectedFingerprint,'Current legacy-label event fingerprint remains bound to this task/event/recipient key');
    stable=await snapshot();
    assert.deepEqual(tables.filter(name=>stable[name]!==before[name]).sort(),[...allowed].sort(),
      'Only task state, delivery receipt, asserted operational credit and private notification queue may change');
    for(const table of tables)if(!allowed.has(table))assert.equal(stable[table],before[table],table);
  });
  await t.test('replay200, both actual GETs and stale409 preserve all110 hashes and do not enqueue again',async()=>{
    assert.ok(created&&stable,'Fresh commit and durable queue must pass first');
    const replay=ok(await api(employee,'POST',intent));assert.equal(replay.replayed,true);
    assert.equal(replay.delivery_id,created.delivery_id);assert.deepEqual(replay.deliveries,created.deliveries);
    for(const token of [employee,admin]){
      const read=ok(await api(token));assert.equal(read.deliveries.length,1);
      assert.equal(read.deliveries[0].id,created.delivery_id);assert.equal(read.task.revision,seed.revision+1);
    }
    ok(await api(employee,'POST',{...intent,request_id:randomUUID()}),409);
    assert.equal((await notices()).length,1);assert.equal((await deliveries()).length,1);
    assert.deepEqual(await snapshot(),stable,'Replay/read/CAS rejection preserve physical rows across all110 tables, including ledger');
    assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
    t.diagnostic('110-table post-setup/login baseline; only4 explicitly asserted tables changed, remaining106 invariant; no provider delivery claimed');
  });
});
