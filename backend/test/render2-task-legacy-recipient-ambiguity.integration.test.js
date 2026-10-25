import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {access} from 'node:fs/promises';
import {startLocalHarness,assertFixtureIdentity} from '../scripts/render2-local-test.js';
import {buscarDestinatario,notificarAsignacionTarea} from '../src/email-notifications.js';
import {encolarNotificacionPrivadaTarea,crearMensajePrivadoTarea} from '../src/private-task-notifications.js';

test('legacy recipient ambiguity uses real PG identities before channel eligibility, never first-match or fanout',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const port=55897,f=await startLocalHarness({port,clusterOnly:true});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),error=>error.code==='ENOENT');
    t.diagnostic(`Own legacy ambiguity cleanup ENOENT: ${f.root}; port${port}`);});
  const url=`postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const [identity]=await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({root:f.root,cwd:f.root,port,url,identity});
  // Adapter only changes result shape. Every resolver SQL and INSERT executes
  // against the identity-guarded fixture; no mocked DB matching logic.
  const pool={query:async(sql,params=[])=>({rows:await f.query(sql,params)})};
  const updated=await f.query(`UPDATE usuarios SET nombre=$1,activo=true,
    email_notificaciones=CASE WHEN id=91003 THEN $2 ELSE NULL END
    WHERE id=ANY($3::int[]) RETURNING id,usuario,nombre,activo,email_notificaciones`,
  ['QA261 Shared','qa261-recipient@example.invalid',[91003,91004]]);
  assert.deepEqual(updated.map(row=>row.id).sort((a,b)=>a-b),[91003,91004]);
  const chosen=updated.find(row=>row.id===91003),other=updated.find(row=>row.id===91004);
  assert.notEqual(chosen.usuario,other.usuario);assert.equal(other.email_notificaciones,null);
  const [task]=await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,propiedades_extra)
    VALUES($1,$2,'en_revision','edicion','{"workspace":"render_os"}'::jsonb) RETURNING *`,
  ['QA261 ambiguity fixture',chosen.nombre]);
  const tables=(await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename);
  assert.ok(tables.length>30);assert.ok(tables.every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
  async function hashes(exclude=[]){const result={};for(const name of tables.filter(name=>!exclude.includes(name))){
    result[name]=(await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${name}" t`))[0].hash;
  }return result;}
  const sameHashes=(actual,expected)=>assert.deepEqual(Object.keys(expected).filter(name=>actual[name]!==expected[name]),[],
    'Unexpected public table changes (table names only)');
  const queue=()=>f.query('SELECT to_jsonb(n) AS row FROM mia_private_task_notifications n ORDER BY id');
  const baseline=await hashes(['mia_private_task_notifications']),queueBefore=await queue();
  const smtp=[];
  const transporter={async sendMail(message){smtp.push(message);return{messageId:`qa261-memory-${smtp.length}`};}};
  const env=Object.freeze({SMTP_HOST:'smtp.example.invalid',SMTP_USER:'qa261@example.invalid',SMTP_PASS:'synthetic-only',
    EMAIL_FROM:'qa261@example.invalid',APP_URL:'https://example.invalid'});
  const options=labels=>({pool,tarea:task,motivo:'revision',detalle:'QA261 exact event',nombresDestinatarios:labels,
    actor:'QA261 distinct actor',actorId:91001,env});
  await t.test('two active homonyms, one without email, are denied in lookup, SMTP and private queue without any DML',async()=>{
    const before=await hashes();
    assert.equal(await buscarDestinatario(pool,'QA261 Shared'),null);
    assert.equal((await notificarAsignacionTarea({...options(['QA261 Shared']),transporter})).enviado,false);
    assert.equal((await encolarNotificacionPrivadaTarea(options(['QA261 Shared']))).encolado,false);
    assert.equal(smtp.length,0);sameHashes(await hashes(),before);assert.deepEqual(await queue(),queueBefore);
  });
  await t.test('unique username resolves the intended ID, with exactly one legacy notice and in-memory SMTP message',async()=>{
    const recipient=await buscarDestinatario(pool,chosen.usuario);assert.equal(recipient.id,91003);
    const result=await encolarNotificacionPrivadaTarea(options([chosen.usuario,chosen.usuario.toUpperCase()]));
    assert.equal(result.encolado,true);assert.equal(result.entregas.length,1);
    const mailed=await notificarAsignacionTarea({...options([chosen.usuario]),transporter});
    assert.equal(mailed.enviado,true);assert.deepEqual(mailed.destinatarios,[chosen.email_notificaciones]);
    assert.equal(smtp.length,1);assert.equal(smtp[0].to,chosen.email_notificaciones);
    const all=await queue(),added=all.filter(({row})=>!queueBefore.some(({row:old})=>old.id===row.id));
    assert.equal(added.length,1);assert.equal(all.length,queueBefore.length+1);
    assert.deepEqual(all.filter(({row})=>queueBefore.some(({row:old})=>old.id===row.id)),queueBefore);
    const row=added[0].row,notification=crearMensajePrivadoTarea({...options([]),clienteNombre:null,appUrl:env.APP_URL});
    const eventVersion=task.updated_at||task.created_at||task.fecha_vencimiento||'sin-version';
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([Number(task.id),'revision',chosen.usuario.toLowerCase(),eventVersion,'QA261 exact event'])).digest('hex');
    assert.equal(row.fingerprint,fingerprint);assert.equal(Number(row.tarea_id),task.id);
    assert.equal(row.destinatario,chosen.nombre);assert.equal(row.destinatario_clave,chosen.usuario.toLowerCase());
    assert.equal(row.motivo,'revision');assert.equal(row.estado,'pending');assert.equal(row.intentos,0);
    assert.equal(row.mensaje,notification.text);assert.equal(row.tarea_url,notification.url);
    assert.deepEqual(row.detalles,{cliente:null,actor:'QA261 distinct actor',destinatario_usuario_id:91003,actor_usuario_id:91001});
    assert.equal(row.claimed_at,null);assert.equal(row.delivered_at,null);assert.ok(Number.isFinite(Date.parse(row.created_at)));
    sameHashes(await hashes(['mia_private_task_notifications']),baseline);
  });
  await t.test('ambiguous and empty labels after a positive delivery neither enqueue additional notices nor send mail',async()=>{
    const before=await hashes(),mailCount=smtp.length;
    for(const label of ['QA261 Shared','','   ']){
      assert.equal(await buscarDestinatario(pool,label),null);
      assert.equal((await notificarAsignacionTarea({...options([label]),transporter})).enviado,false);
      assert.equal((await encolarNotificacionPrivadaTarea(options([label]))).encolado,false);
    }
    assert.equal(smtp.length,mailCount);sameHashes(await hashes(),before);
  });
  sameHashes(await hashes(['mia_private_task_notifications']),baseline);
  assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.tablename),tables);
  t.diagnostic(`${tables.length} public tables observed after synthetic setup; only one exact private-queue row added; actual resolver SQL with fixture query adapter, SMTP double only; no HTTP, provider, worker or revocation-race claim`);
});
