import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import pg from 'pg';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {encolarNotificacionPrivadaFeedback} from '../src/private-feedback-notifications.js';
import {feedbackFingerprint} from '../src/feedback-workflow.js';

test('private Feedback notification resolver excludes inactive accounts before enqueue and preserves existing notices',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55891,f=await startLocalHarness({port,clusterOnly:true});
  let pool;
  t.after(async()=>{
    try{if(pool)await pool.end();}finally{
      await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
      t.diagnostic(`Own Feedback-active fixture cleanup ENOENT: ${f.root}; port${port}`);
    }
  });
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  const guard={root:f.root,cwd:f.root,port,url};
  assertFixtureIdentity({...guard,identity:(await f.query(identitySql))[0]});
  pool=new pg.Pool({connectionString:url,max:2,statement_timeout:10000,connectionTimeoutMillis:5000});
  const connection=await pool.connect();
  try{assertFixtureIdentity({...guard,identity:(await connection.query(identitySql)).rows[0]});}
  finally{connection.release();}

  await pool.query('UPDATE usuarios SET activo=false WHERE id=91003');
  const [note]=await f.query(`INSERT INTO notas_compartidas(titulo,contenido,categoria,creado_por,modificado_por,feedback,updated_at)
    VALUES ('QA255 private Feedback activity','Synthetic stored note remains unchanged','general','QA255 actor','QA255 actor',
      '{"flujo":"feedback","estado":"pendiente","responsables":["qa_luciano"],"cliente":""}'::jsonb,
      '2026-10-01T12:00:00.000Z') RETURNING *`);
  assert.ok(Number.isSafeInteger(Number(note.id))&&Number(note.id)>0);
  assert.deepEqual(note.feedback.responsables,['qa_luciano']);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row=>row.tablename);
  assert.ok(tables.length>30);assert.ok(tables.includes('notas_compartidas')&&tables.includes('usuarios'));
  assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded=[]){const result={};for(const table of tables.filter(name=>!excluded.includes(name))){
    result[table]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`))[0].hash;
  }return result;}
  const same=(actual,expected)=>assert.deepEqual(Object.keys(expected).filter(table=>actual[table]!==expected[table]),[],
    'Unexpected changed public tables (names only)');
  const user=async()=>(await f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id=91003'))[0].row;
  const others=()=>f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id<>91003 ORDER BY id');
  const queued=()=>f.query('SELECT to_jsonb(n) AS row FROM mia_private_task_notifications n ORDER BY id');
  const oldOthers=await others(),stableBaseline=await snapshot(['usuarios','mia_private_task_notifications']);
  let expectedUser=await user();assert.equal(expectedUser.activo,false);
  let expectedQueue=await queued();assert.deepEqual(expectedQueue,[]);
  const actor='QA255 distinct actor',env=Object.freeze({APP_URL:'https://example.invalid'});
  const times=['2026-10-01T12:00:00.000Z','2026-10-02T12:00:00.000Z','2026-10-03T12:00:00.000Z'];
  const fingerprint=time=>feedbackFingerprint(['feedback',Number(note.id),'qa_luciano',time]);
  assert.equal(new Set(times.map(fingerprint)).size,3,'Distinct attempts cannot be mistaken for queue deduplication');
  // Distinct synthetic incoming event observations, same persisted note ID.
  // No SQL note edit is made; this is resolver/enqueue QA, not a write-route test.
  async function notify(time){
    const input={...structuredClone(note),updated_at:time};
    const before=structuredClone(input);
    const result=await encolarNotificacionPrivadaFeedback({pool,nota:input,actor,env});
    assert.deepEqual(input,before,'Notifier must not mutate its event input');return result;
  }
  async function deny(time){
    const before=await snapshot();
    const result=await notify(time);
    assert.deepEqual(result,{encolado:false,razon:'responsable_sin_usuario'});
    assert.deepEqual(await queued(),expectedQueue);same(await snapshot(),before);
  }
  async function toggle(active){
    await pool.query('UPDATE usuarios SET activo=$1 WHERE id=91003',[active]);
    expectedUser={...expectedUser,activo:active,user_admin_version:expectedUser.user_admin_version+1};
    assert.deepEqual(await user(),expectedUser,'Only requested activity and trigger074 counter may change');
    assert.deepEqual(await others(),oldOthers);same(await snapshot(['usuarios','mia_private_task_notifications']),stableBaseline);
  }

  await t.test('initial inactive responsible resolves to no recipient and causes no table changes',async()=>{
    await deny(times[0]);
  });
  await t.test('activation allows one exact pending Feedback notice through the actual resolver',async()=>{
    await toggle(true);
    const before=await snapshot(['mia_private_task_notifications']);
    const result=await notify(times[1]);assert.equal(result.encolado,true);assert.equal(result.entregas.length,1);
    assert.equal(result.duplicadas,0);
    const rows=await queued();assert.equal(rows.length,1);const notice=rows[0].row;
    assert.equal(notice.fingerprint,fingerprint(times[1]));assert.equal(notice.destinatario_clave,'qa_luciano');
    assert.equal(notice.destinatario,'Luciano QA');assert.equal(Number(notice.feedback_id),Number(note.id));
    assert.equal(notice.tarea_id,null);assert.equal(notice.motivo,'feedback');assert.equal(notice.estado,'pending');
    assert.deepEqual(notice.detalles,{cliente:null,actor});
    assert.equal(notice.tarea_url,`https://example.invalid/feedback?section=team&note=${note.id}`);
    assert.match(notice.mensaje,/QA255 private Feedback activity/);
    // pg returns BIGSERIAL as a string; to_jsonb's id is parsed as a number.
    assert.deepEqual(result.entregas.map(row=>({id:Number(row.id),fingerprint:row.fingerprint})),
      [{id:Number(notice.id),fingerprint:notice.fingerprint}]);
    expectedQueue=rows;same(await snapshot(['mia_private_task_notifications']),before);
  });
  await t.test('deactivation prevents a fresh timestamp fingerprint without rewriting the accepted notice',async()=>{
    await toggle(false);
    assert.notEqual(fingerprint(times[2]),expectedQueue[0].row.fingerprint);
    await deny(times[2]);assert.deepEqual(await queued(),expectedQueue);
  });
  same(await snapshot(['usuarios','mia_private_task_notifications']),stableBaseline);
  assert.deepEqual(await user(),expectedUser);assert.deepEqual(await others(),oldOthers);
  assert.deepEqual(await queued(),expectedQueue);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row=>row.tablename),tables);
  assertFixtureIdentity({...guard,identity:(await f.query(identitySql))[0]});
  t.diagnostic(`${tables.length} public tables observed; only two activity/trigger074 updates and one Feedback enqueue after baseline; real PG resolver/service, no HTTP, SMTP, provider or delivery worker`);
});
