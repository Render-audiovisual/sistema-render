import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness,assertFixtureIdentity,request,fixturePassword } from '../scripts/render2-local-test.js';

test('publication handoff approval queues only the selected publisher ID, including unchanged owners',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55877});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own publication handoff fixture cleanup ENOENT: ${f.root}; port55877`);
  });
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port:55877,
    url:'postgresql://render2_fixture@127.0.0.1:55877/render2_local_test',identity});
  const checked=(response,status=200)=>{
    assert.equal(response.status,status,'Expected principal HTTP status; do not print session payloads');return response.body;
  };
  const login=async usuario=>checked(await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}})).token;
  const admin=await login('qa_franco'),editor=await login('qa_luciano');
  const api=(route,method='GET',body,token=admin)=>request(f.base,`/api${route}`,{token,method,body});
  await f.query("UPDATE usuarios SET nombre='QA230 identical publisher label' WHERE id=ANY($1::int[])",[[91002,91004]]);
  await f.query("UPDATE usuarios SET rol='community' WHERE id=91004");
  const noInternal=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)){
      assert.ok(!['assignmentNotification','destinatarioIds','assignmentNotificationActor','assignmentNotificationMode'].includes(key),
        'Internal notification context must not enter public DTO');noInternal(child);
    }
  };
  const notices=id=>f.query(`SELECT id,tarea_id,motivo,destinatario_clave,detalles FROM mia_private_task_notifications
    WHERE tarea_id=$1 ORDER BY id`,[id]);
  async function waitCount(id,count){
    const deadline=Date.now()+5000;
    do{
      const rows=await notices(id);assert.ok(rows.length<=count,'Unexpected duplicate notification');
      if(rows.length===count)return rows;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<deadline);
    assert.fail('Expected notification enqueue did not settle within 5 seconds');
  }
  async function unchangedNotices(id,expected){
    // Bounded 300ms negative observation, not an external-delivery assertion.
    for(let n=0;n<6;n++){
      await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(await notices(id),expected);
    }
  }
  let serial=0;
  async function create({owner=91003,state='en_revision'}={}){
    const task=checked(await api('/tareas','POST',{
      titulo:`QA230 publication handoff ${++serial}`,workspace:'render_os',tipo_tarea:'edicion',subtipo:'video',estado:state,
      asignado_a_id:owner,colaborador_ids:[],fecha_vencimiento:'2026-10-29',
    }),201);
    noInternal(task);assert.equal(task.asignado_a_id,owner);
    const rows=await waitCount(task.id,1);
    assert.equal(rows[0].motivo,'creada');assert.equal(rows[0].detalles.destinatario_usuario_id,owner);
    return {task,baseline:rows};
  }
  const detail=async id=>checked(await api(`/tareas/${id}?workspace=render_os`));
  const approve=(id,publisher,revision,delivery)=>api(`/tareas/${id}/aprobar-publicacion?workspace=render_os`,'POST',{
    expected_revision:revision,responsable_publicacion_id:publisher,
    ...(delivery===undefined?{}:{expected_entrega_id:delivery}),
  });
  async function approvedNotice(id,publisher,baseline){
    const rows=await waitCount(id,baseline.length+1);
    assert.deepEqual(rows.slice(0,baseline.length),baseline);
    const notice=rows.at(-1);assert.equal(notice.motivo,'aprobada');
    assert.equal(notice.detalles.destinatario_usuario_id,publisher);assert.equal(notice.detalles.actor_usuario_id,91001);
    assert.equal(notice.detalles.actor,'Franco QA');
    assert.equal(notice.destinatario_clave,publisher===91004?'qa_designer':'qa_agustin');
    await unchangedNotices(id,rows);return rows;
  }
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row=>row.tablename).filter(name=>!/^auth_|^browser_session/.test(name));
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const mutable=new Set(['usuarios','tareas','tarea_asignaciones','mia_private_task_notifications','task_editing_deliveries','task_editing_reviews']);
  async function snapshot(names=tables){
    const hashes={};
    for(const table of names){
      const [row]=await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`);
      hashes[table]=row.hash;
    }
    return hashes;
  }
  const unchanged=(actual,expected)=>assert.deepEqual(Object.keys(expected).filter(table=>actual[table]!==expected[table]),[],
    'Unexpected public table change (table names only)');
  const unrelated=tables.filter(name=>!mutable.has(name)),before=await snapshot(unrelated);
  await t.test('homonymous community publisher receives exact ID-bound approval, not the other admin',async()=>{
    const {task,baseline}=await create();
    const result=checked(await approve(task.id,91004,task.revision));noInternal(result);
    assert.equal(result.estado,'aprobada');assert.equal(result.asignado_a_id,91004);assert.equal(result.revision,task.revision+1);
    assert.deepEqual(result.colaborador_ids,[91003]);
    assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id',[task.id]),[
      {usuario_id:91003,tipo:'colaborador'},{usuario_id:91004,tipo:'responsable'},
    ]);
    assert.deepEqual(await f.query('SELECT id FROM task_editing_deliveries WHERE task_id=$1',[task.id]),[]);
    await approvedNotice(task.id,91004,baseline);
  });
  await t.test('same publisher already responsible still receives approval event despite empty assignment delta',async()=>{
    const {task,baseline}=await create({owner:91004});
    const result=checked(await approve(task.id,91004,task.revision));noInternal(result);
    assert.equal(result.asignado_a_id,91004);assert.deepEqual(result.colaborador_ids,[]);
    await approvedNotice(task.id,91004,baseline);
  });
  await t.test('actor as publisher is excluded by real ID, with successful approval retained',async()=>{
    const {task,baseline}=await create();
    const result=checked(await approve(task.id,91001,task.revision));noInternal(result);
    assert.equal(result.estado,'aprobada');assert.equal(result.asignado_a_id,91001);
    await unchangedNotices(task.id,baseline);
  });
  for(const kind of ['inactive','wrong role'])await t.test(`${kind} publisher rejected without approval/task/membership changes`,async()=>{
    const {task,baseline}=await create();
    if(kind==='inactive')await f.query('UPDATE usuarios SET activo=false WHERE id=91004');
    else await f.query("UPDATE usuarios SET rol='diseno' WHERE id=91004");
    try{
      const old=await snapshot();
      checked(await approve(task.id,91004,task.revision),400);
      await unchangedNotices(task.id,baseline);unchanged(await snapshot(),old);
      const current=await detail(task.id);assert.equal(current.estado,'en_revision');assert.equal(current.revision,task.revision);
    }finally{await f.query("UPDATE usuarios SET activo=true,rol='community' WHERE id=91004");}
  });
  await t.test('CAS conflict produces no additional notice or approval evidence',async()=>{
    const {task,baseline}=await create(),old=await snapshot();
    checked(await approve(task.id,91004,task.revision+99),409);
    await unchangedNotices(task.id,baseline);unchanged(await snapshot(),old);
  });
  await t.test('real API artifact delivery is explicitly observed and retained by the approved handoff',async()=>{
    const {task,baseline}=await create({state:'pendiente'});
    const delivered=checked(await api(`/tareas-edicion/${task.id}/entregas`,'POST',{
      request_id:randomUUID(),expected_revision:task.revision,url:'https://example.invalid/qa230-real-api-artifact',
      notes:'QA230 explicit artifact, no publication fabricated',
    },editor),201);
    noInternal(delivered);assert.equal(typeof delivered.delivery_id,'string');
    const current=await detail(task.id);assert.equal(current.estado,'en_revision');
    // Delivery itself has no notification enqueue; retain the exact setup row.
    await unchangedNotices(task.id,baseline);
    const result=checked(await approve(task.id,91004,current.revision,delivered.delivery_id));noInternal(result);
    assert.equal(result.estado,'aprobada');assert.equal(result.asignado_a_id,91004);
    const [stored]=await f.query('SELECT propiedades_extra FROM tareas WHERE id=$1',[task.id]);
    assert.equal(stored.propiedades_extra.revision_aprobada_entrega_id,delivered.delivery_id);
    const artifacts=await f.query('SELECT id,actor_id,url FROM task_editing_deliveries WHERE task_id=$1',[task.id]);
    assert.deepEqual(artifacts,[{id:delivered.delivery_id,actor_id:91003,url:'https://example.invalid/qa230-real-api-artifact'}]);
    const reviews=await f.query('SELECT actor_id,delivery_id,action,task_revision FROM task_editing_reviews WHERE task_id=$1',[task.id]);
    assert.deepEqual(reviews,[{actor_id:91001,delivery_id:delivered.delivery_id,action:'aprobada',task_revision:result.revision}]);
    await approvedNotice(task.id,91004,baseline);
  });
  unchanged(await snapshot(unrelated),before);
  assert.deepEqual(await f.query('SELECT id FROM publicaciones'),[]);
  assert.deepEqual(await f.query('SELECT id FROM historias'),[]);
  noInternal(checked(await api('/tareas?workspace=render_os&limit=500')));
  t.diagnostic(`Own fixture ${f.root}; ${unrelated.length} unrelated public table hashes unchanged; enqueue only, no provider delivery claim`);
});
