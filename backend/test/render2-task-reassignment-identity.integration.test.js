import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness,assertFixtureIdentity,request,fixturePassword } from '../scripts/render2-local-test.js';

test('HTTP reassignment notifications retain real recipient and actor IDs through homonyms and renames',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55871});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own reassignment fixture cleanup ENOENT: ${f.root}; port55871`);
  });
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port:55871,
    url:'postgresql://render2_fixture@127.0.0.1:55871/render2_local_test',identity});
  const checked=(response,status=200)=>{
    assert.equal(response.status,status,'Expected fixture HTTP status (never print auth payload)');return response.body;
  };
  const login=checked(await request(f.base,'/api/login',{method:'POST',body:{usuario:'qa_franco',password:fixturePassword}}));
  const api=(route,method='GET',body)=>request(f.base,`/api${route}`,{token:login.token,method,body});
  // Only this physically guarded generated cluster is changed. Shared names
  // intentionally do not alter either account's stable ID or login key.
  await f.query("UPDATE usuarios SET nombre='QA226 same display label' WHERE id=ANY($1::int[])",[[91002,91003]]);
  const created=checked(await api('/tareas','POST',{
    titulo:'QA226 reassignment identities',workspace:'render_os',tipo_tarea:'edicion',estado:'pendiente',
    asignado_a_id:91003,colaborador_ids:[],fecha_vencimiento:'2026-10-29',
  }),201);
  const taskId=created.id;
  assert.ok(Number.isSafeInteger(taskId)&&taskId>0);
  const notices=()=>f.query(`SELECT id,tarea_id,motivo,destinatario,destinatario_clave,estado,detalles
    FROM mia_private_task_notifications WHERE tarea_id=$1 ORDER BY id`,[taskId]);
  async function waitCount(expected){
    const deadline=Date.now()+5000;
    do {
      const rows=await notices();
      assert.ok(rows.length<=expected,'Unexpected extra notification');
      if(rows.length===expected)return rows;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<deadline);
    assert.fail('Expected asynchronous enqueue did not settle within 5 seconds');
  }
  // Negative enqueue checks are bounded observations, not external delivery
  // assertions. Check repeatedly after each completed HTTP mutation.
  async function unchangedNotices(expected){
    for(let i=0;i<6;i++){
      assert.deepEqual(await notices(),expected);
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  const setupNotices=await waitCount(1);
  assert.equal(setupNotices[0].motivo,'creada');
  const route=`/tareas/${taskId}?workspace=render_os`;
  const read=async()=>checked(await api(route));
  async function patch(body){
    const current=await read();
    assert.equal(typeof current.updated_at,'string');assert.ok(Number.isFinite(Date.parse(current.updated_at)));
    return api(route,'PATCH',{expected_revision:current.revision,expected_updated_at:current.updated_at,...body});
  }
  const memberships=()=>f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id,tipo',[taskId]);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row=>row.tablename).filter(name=>!/^auth_|^browser_session/.test(name));
  assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  const mutable=new Set(['usuarios','tareas','tarea_asignaciones','mia_private_task_notifications']);
  async function stableHashes(){
    const result={};
    for(const table of tables.filter(name=>!mutable.has(name))){
      const [row]=await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`);
      result[table]=row.hash;
    }
    return result;
  }
  const baseline=await stableHashes();
  await t.test('same display name but different owner ID emits exactly the new real recipient',async()=>{
    const saved=checked(await patch({asignado_a_id:91002,colaborador_ids:[]}));
    assert.equal(saved.asignado_a_id,91002);assert.deepEqual(saved.colaborador_ids,[]);
    assert.deepEqual(await memberships(),[{usuario_id:91002,tipo:'responsable'}]);
    const rows=await waitCount(2);
    assert.deepEqual(rows.slice(0,1),setupNotices);
    const notice=rows[1];
    assert.equal(notice.motivo,'reasignada');assert.equal(Number(notice.tarea_id),taskId);
    assert.equal(notice.destinatario_clave,'qa_agustin');assert.equal(notice.estado,'pending');
    assert.equal(notice.detalles.destinatario_usuario_id,91002);
    assert.equal(notice.detalles.actor_usuario_id,91001);assert.equal(notice.detalles.actor,'Franco QA');
    await unchangedNotices(rows);
  });
  await t.test('unchanged IDs and rename of the same owner do not emit reassignment',async()=>{
    const before=await notices();
    checked(await patch({asignado_a_id:91002,colaborador_ids:[]}));
    await unchangedNotices(before);
    await f.query("UPDATE usuarios SET nombre='QA226 renamed same account' WHERE id=91002");
    const saved=checked(await patch({asignado_a_id:91002,colaborador_ids:[]}));
    assert.equal(saved.asignado_a_id,91002);assert.equal(saved.asignado_a,'QA226 renamed same account');
    await unchangedNotices(before);
  });
  await t.test('new collaborator receives one ID-bound notice; removal receives none',async()=>{
    checked(await patch({asignado_a_id:91002,colaborador_ids:[91004]}));
    const rows=await waitCount(3);
    assert.equal(rows[2].detalles.destinatario_usuario_id,91004);
    assert.equal(rows[2].detalles.actor_usuario_id,91001);
    assert.equal(rows[2].motivo,'reasignada');
    checked(await patch({asignado_a_id:91002,colaborador_ids:[]}));
    assert.deepEqual(await memberships(),[{usuario_id:91002,tipo:'responsable'}]);
    await unchangedNotices(rows);
  });
  await t.test('actor self-assignment is excluded by ID and inactive recipient fails without task changes',async()=>{
    const before=await notices();
    checked(await patch({asignado_a_id:91001,colaborador_ids:[]}));
    assert.deepEqual(await memberships(),[{usuario_id:91001,tipo:'responsable'}]);
    await unchangedNotices(before);
    await f.query('UPDATE usuarios SET activo=false WHERE id=91004');
    const taskBefore=await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[taskId]);
    checked(await patch({asignado_a_id:91004,colaborador_ids:[]}),400);
    assert.deepEqual(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE id=$1',[taskId]),taskBefore);
    assert.deepEqual(await memberships(),[{usuario_id:91001,tipo:'responsable'}]);
    await unchangedNotices(before);
  });
  assert.deepEqual(await stableHashes(),baseline,'Unrelated business tables unchanged');
  t.diagnostic(`Own fixture ${f.root}; unchanged unrelated tables=${tables.filter(name=>!mutable.has(name)).length}; no provider/delivery claim`);
});
