import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness,assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { buscarDestinatario,notificarAsignacionTarea } from '../src/email-notifications.js';
import { encolarNotificacionPrivadaTarea } from '../src/private-task-notifications.js';

test('legacy notification lookups omit inactive accounts before enqueue or SMTP and retain active routing',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55880,f=await startLocalHarness({port,clusterOnly:true});
  let pool;
  t.after(async()=>{
    if(pool)await pool.end();
    await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own legacy-active fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const identitySql=`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await f.query(identitySql))[0]});
  pool=new pg.Pool({connectionString:url,max:2,statement_timeout:10000,connectionTimeoutMillis:5000});
  const connection=await pool.connect();
  try{assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity:(await connection.query(identitySql)).rows[0]});}
  finally{connection.release();}
  // Synthetic fixture identity only. Preserve the existing legacy Agustin ->
  // lider mapping; this test does NOT prescribe new leader/reviewer bindings.
  await pool.query(`UPDATE usuarios SET usuario='lider',nombre='Agustín',activo=false,
    email_notificaciones='qa237-leader@example.invalid' WHERE id=91002`);
  const task=(await pool.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
    VALUES('QA237 legacy recipient activity','Luciano QA','en_revision','edicion','{"workspace":"render_os"}'::jsonb)
    RETURNING *`)).rows[0];
  await pool.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')",[task.id]);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function snapshot(excluded=[]){
    const hashes={};
    for(const table of tables.filter(name=>!excluded.includes(name))){
      const [row]=await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`);
      hashes[table]=row.hash;
    }
    return hashes;
  }
  const same=(actual,expected)=>assert.deepEqual(Object.keys(expected).filter(name=>actual[name]!==expected[name]),[],
    'Unexpected public table change; report names only');
  const user=async()=>(await f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id=91002'))[0].row;
  const otherUsers=()=>f.query('SELECT to_jsonb(u) AS row FROM usuarios u WHERE id<>91002 ORDER BY id');
  const otherUsersBefore=await otherUsers();
  const baseline=await snapshot(['usuarios','mia_private_task_notifications']);
  const queued=()=>f.query('SELECT to_jsonb(n) AS row FROM mia_private_task_notifications n ORDER BY id');
  assert.deepEqual(await queued(),[]);
  const smtp=[];
  const transporter={sendMail:async message=>{smtp.push(message);return {messageId:`qa237-synthetic-${smtp.length}`};}};
  // Explicit object, not process.env: supplied transport means no DNS, socket,
  // nodemailer transporter creation, real credential or provider is used.
  const env=Object.freeze({SMTP_HOST:'smtp.example.invalid',SMTP_USER:'qa237@example.invalid',SMTP_PASS:'synthetic-only',
    EMAIL_FROM:'qa237@example.invalid',APP_URL:'https://example.invalid'});
  const notify=detail=>({pool,tarea:task,motivo:'revision',detalle:detail,nombresDestinatarios:['Agustín'],actor:'QA237 actor distinto',env});
  async function assertDenied(detail){
    const before=await snapshot(),beforeMail=smtp.length;
    assert.equal(await buscarDestinatario(pool,'Agustín'),null);
    assert.equal(await buscarDestinatario(pool,'lider'),null);
    const privateResult=await encolarNotificacionPrivadaTarea(notify(detail));
    assert.equal(privateResult.encolado,false);
    const mail=await notificarAsignacionTarea({...notify(detail),transporter});
    assert.deepEqual(mail,{enviado:false,razon:'responsable_sin_correo'});
    assert.equal(smtp.length,beforeMail);same(await snapshot(),before);
  }
  await t.test('initial inactive leader alias is absent from actual lookup, queue and mail',async()=>{
    await assertDenied('QA237 initial inactive');
  });
  await t.test('activation permits actual legacy alias lookup, one enqueue and fake SMTP delivery',async()=>{
    const old=await user();await pool.query('UPDATE usuarios SET activo=true WHERE id=91002');
    assert.deepEqual(await user(),{...old,activo:true,user_admin_version:old.user_admin_version+1});
    const before=await snapshot(['mia_private_task_notifications']);
    const found=await buscarDestinatario(pool,'Agustín');
    assert.equal(found.usuario,'lider');assert.equal(found.email_notificaciones,'qa237-leader@example.invalid');
    const privateResult=await encolarNotificacionPrivadaTarea(notify('QA237 active positive'));
    assert.equal(privateResult.encolado,true);assert.equal(privateResult.entregas.length,1);
    const rows=await queued();assert.equal(rows.length,1);
    const notice=rows[0].row;
    assert.equal(Number(notice.tarea_id),task.id);assert.equal(notice.motivo,'revision');
    assert.equal(notice.destinatario,'Agustín');assert.equal(notice.destinatario_clave,'lider');assert.equal(notice.estado,'pending');
    assert.deepEqual(notice.detalles,{cliente:null,actor:'QA237 actor distinto'});
    assert.match(notice.fingerprint,/^[a-f0-9]{64}$/);
    const mail=await notificarAsignacionTarea({...notify('QA237 active positive'),transporter});
    assert.equal(mail.enviado,true);assert.deepEqual(mail.destinatarios,['qa237-leader@example.invalid']);
    assert.equal(smtp.length,1);assert.equal(smtp[0].to,'qa237-leader@example.invalid');
    assert.match(smtp[0].subject,/revisión/);
    same(await snapshot(['mia_private_task_notifications']),before);
  });
  await t.test('subsequent deactivation prevents fresh enqueue/SMTP without rewriting the old notice',async()=>{
    const old=await user(),oldQueue=await queued();
    await pool.query('UPDATE usuarios SET activo=false WHERE id=91002');
    assert.deepEqual(await user(),{...old,activo:false,user_admin_version:old.user_admin_version+1});
    // Different detail => a distinct legacy fingerprint. A dedupe collision
    // cannot masquerade as successful inactive filtering.
    await assertDenied('QA237 newly inactive distinct intent');
    assert.deepEqual(await queued(),oldQueue);assert.equal(smtp.length,1);
  });
  same(await snapshot(['usuarios','mia_private_task_notifications']),baseline);
  assert.deepEqual(await otherUsers(),otherUsersBefore);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename),tables);
  t.diagnostic(`Own fixture ${f.root}; ${tables.length} public tables observed; SMTP is injected in memory, no HTTP/provider/delivery-worker claim`);
});
