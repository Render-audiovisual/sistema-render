import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {startLocalHarness,assertFixtureIdentity,request,fixturePassword} from '../scripts/render2-local-test.js';

test('state notification self-exclusion uses actor identity, not a distinct reviewer homonym',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55890,f=await startLocalHarness({port});
  t.after(async()=>{
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own state-actor fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,
    url:'postgresql://render2_fixture@127.0.0.1:55890/render2_local_test',identity});
  // Preserve current leader-name policy. Only synthetic fixture identities are
  // renamed: this does not choose a new reviewer, grant a role or configure SMTP.
  await f.query("UPDATE usuarios SET nombre='Franco' WHERE id=91001");
  await f.query("UPDATE usuarios SET usuario='lider',nombre='Agustín' WHERE id=91002");
  await f.query("UPDATE usuarios SET nombre='Franco' WHERE id=91003");
  const checked=(response,status=200)=>{assert.equal(response.status,status,'Unexpected principal HTTP status');return response.body;};
  const login=async usuario=>checked(await request(f.base,'/api/login',{method:'POST',body:{usuario,password:fixturePassword}}));
  const employee=await login('qa_luciano'),admin=await login('qa_franco');
  assert.equal(employee.usuario.id,91003);assert.equal(admin.usuario.id,91001);
  assert.equal(employee.usuario.nombre,'Franco');assert.equal(admin.usuario.nombre,'Franco');
  const api=(path,token,method='GET',body)=>request(f.base,`/api${path}`,{token,method,body});
  // The unchanged legacy resolver picks the first name/login match. Establish
  // that this controlled fixture resolves the EXISTING Franco target to the
  // administrator, not to the actor; do not silently test a different policy.
  const catalog=await f.query('SELECT id,usuario,nombre FROM usuarios WHERE activo IS TRUE');
  const normalize=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').trim().toLowerCase();
  const resolved=catalog.find(row=>[row.usuario,row.nombre].some(value=>normalize(value)==='franco'));
  assert.equal(resolved?.id,91001,'Fixture precondition: existing legacy Franco recipient resolves to admin, not employee');
  const tasks=[];
  for(const ownerId of [91003,91001]){
    const [row]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES($1,'Franco','pendiente','edicion','{"workspace":"render_os","qa254":"stable"}'::jsonb) RETURNING id`,
      [`QA254 actor identity ${ownerId}`]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')",[row.id,ownerId]);
    tasks.push(row.id);
  }
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row=>row.tablename).filter(name=>!/^auth_|^browser_session/.test(name));
  assert.ok(tables.length>30);assert.ok(tables.includes('usuarios')&&tables.includes('tarea_asignaciones'));
  assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function stableHashes(){const result={};for(const table of tables.filter(name=>!['tareas','mia_private_task_notifications'].includes(name))){
    result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
  }return result;}
  const baseline=await stableHashes();
  const rawTasks=()=>f.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id');
  let expectedTasks=await rawTasks();
  const notices=()=>f.query('SELECT to_jsonb(n) AS row FROM mia_private_task_notifications n ORDER BY id');
  let expectedNotices=await notices();assert.deepEqual(expectedNotices,[]);
  const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
  async function boundedUnchanged(expected){
    const until=Date.now()+300;
    do{assert.deepEqual(await notices(),expected,'No unintended additional notice');await pause();}while(Date.now()<until);
    assert.deepEqual(await notices(),expected);
  }
  async function transition(taskId,token,recipientKeys){
    const held=checked(await api(`/tareas/${taskId}?workspace=render_os`,token));
    assert.equal(held.estado,'pendiente');assert.equal(held.revision,1);
    const saved=checked(await api(`/tareas/${taskId}?workspace=render_os`,token,'PATCH',{
      estado:'en_progreso',expected_revision:held.revision,expected_updated_at:held.updated_at,
    }));
    assert.equal(saved.id,taskId);assert.equal(saved.estado,'en_progreso');assert.equal(saved.revision,held.revision+1);
    const target=expectedNotices.length+recipientKeys.length,deadline=Date.now()+5000;
    let rows;
    do{rows=await notices();assert.ok(rows.length<=target,'Unexpected extra recipient');if(rows.length===target)break;await pause();}while(Date.now()<deadline);
    assert.equal(rows.length,target,'Expected real asynchronous enqueue within bounded wait');
    const added=rows.filter(({row})=>Number(row.tarea_id)===taskId).map(({row})=>row);
    assert.deepEqual(added.map(row=>row.destinatario_clave).sort(),[...recipientKeys].sort());
    for(const notice of added){
      assert.equal(notice.motivo,'en_progreso');assert.equal(notice.estado,'pending');
      assert.equal(notice.detalles.actor,'Franco');assert.equal(notice.detalles.cliente,null);
      assert.notEqual(notice.destinatario_clave,'qa_luciano','The employee actor must not receive this event');
      assert.match(notice.fingerprint,/^[a-f0-9]{64}$/);
      // Legacy name routing has no new recipient-ID DTO requirement here.
    }
    assert.deepEqual(rows.filter(({row})=>Number(row.tarea_id)!==taskId),expectedNotices);
    expectedNotices=rows;await boundedUnchanged(expectedNotices);
    const stored=await rawTasks(),before=expectedTasks.find(({row})=>row.id===taskId).row;
    const after=stored.find(({row})=>row.id===taskId).row;
    assert.equal(after.estado,'en_progreso');assert.equal(after.revision,before.revision+1);
    assert.deepEqual(after.propiedades_extra,{...before.propiedades_extra,revision_aprobada:false,
      revision_aprobada_por_id:null,revision_aprobada_por:null,revision_aprobada_at:null,
      revision_aprobada_entrega_id:null,finalizada_at:null});
    const omit=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['estado','revision','updated_at','propiedades_extra'].includes(key)));
    assert.deepEqual(omit(after),omit(before));
    assert.deepEqual(stored.filter(({row})=>row.id!==taskId),expectedTasks.filter(({row})=>row.id!==taskId));
    expectedTasks=stored;
    const confirmed=checked(await api(`/tareas/${taskId}?workspace=render_os`,token));
    assert.equal(confirmed.estado,'en_progreso');assert.equal(confirmed.revision,saved.revision);
    assert.deepEqual(await notices(),expectedNotices);assert.deepEqual(await rawTasks(),expectedTasks);
    assert.deepEqual(await stableHashes(),baseline);
  }
  await t.test('assigned employee Franco does not suppress the distinct existing Franco reviewer',async()=>{
    await transition(tasks[0],employee.token,['lider','qa_franco']);
  });
  await t.test('same real Franco reviewer acting on his own task is still excluded by ID',async()=>{
    await transition(tasks[1],admin.token,['lider']);
  });
  await boundedUnchanged(expectedNotices);assert.equal(expectedNotices.length,3);
  assert.deepEqual(await stableHashes(),baseline);assert.deepEqual(await rawTasks(),expectedTasks);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row=>row.tablename).filter(name=>!/^auth_|^browser_session/.test(name)),tables);
  t.diagnostic(`${tables.length} domain tables observed; only two exact state/revision updates and three legacy-recipient notices allowed; bearer HTTP, no SMTP/provider/worker or reviewer-policy claim`);
});
